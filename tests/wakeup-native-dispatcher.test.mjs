import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { nativeHost, until, drain, MINUTE } from './fixtures/wakeup-native-host.mjs';
import { ATTEMPT_WARNING_MS, REMINDER_ATTEMPT_DIAGNOSTIC, REMINDER_TEXT, WAKEUP_CUSTOM_TYPE } from '../dist/reminders.js';

const test = (name, run) => nodeTest(name, { timeout: 15_000 }, run);

// These execute native Pi 1.4.0 dispatcher methods against an in-memory session and scripted stream.
// They prove offline plumbing/lifecycle only, NOT a deployed version or actual model compliance/AC5.
test('Pi 1.4.0 native idle custom dispatch starts Agent, exposes full model input and recurs after settlement', async t => {
  const a = await nativeHost(t);
  a.tick(MINUTE);
  await until(() => a.observed.some(e => e.type === 'agent_settled'));
  assert.equal(a.submissions.length, 1);
  assert.deepEqual(a.submissions[0].options, { triggerTurn: true });
  assert.equal(a.observed.filter(e => e.type === 'agent_start').length, 1);
  assert.equal(a.requests.length, 1);
  const modelText = a.requests[0].filter(m => m.role === 'user').flatMap(m => m.content).filter(c => c.type === 'text').map(c => c.text);
  assert.deepEqual(modelText, [REMINDER_TEXT], 'native custom projection carries full selected text to the provider seam');
  const custom = a.manager.getBranch().filter(e => e.type === 'custom_message' && e.customType === WAKEUP_CUSTOM_TYPE);
  assert.equal(custom.length, 1);
  assert.equal(custom[0].content, REMINDER_TEXT);
  assert.deepEqual(custom[0].details, a.submissions[0].message.details, 'source/hash/attempt metadata survive native persistence');
  a.tick(MINUTE - 1); await drain();
  assert.equal(a.submissions.length, 1);
  a.tick(1);
  await until(() => a.observed.filter(e => e.type === 'agent_settled').length === 2);
  assert.equal(a.submissions.length, 2);
  assert.equal(a.requests.length, 2);
  assert.deepEqual(a.errors, []);
});

test('Pi 1.4.0 native reload invalidates the old runtime and starts exactly one fresh idle observation', async t => {
  const a = await nativeHost(t);
  const oldIntercom = a.intercom;
  const oldReminders = oldIntercom.reminders;
  const oldRuntime = a.runtime;
  a.tick(50_000);
  await a.session.reload();
  assert.notEqual(a.intercom, oldIntercom);
  assert.equal(oldReminders.disposed, true);
  assert.throws(() => oldRuntime.assertActive(), /stale/);
  a.tick(10_000); await a.drained(); assert.equal(a.submissions.length, 0, 'old t=60s deadline is gone');
  a.tick(49_999); await a.drained(); assert.equal(a.submissions.length, 0);
  a.tick(1);
  await until(() => a.observed.some(e => e.type === 'agent_settled'));
  assert.equal(a.submissions.length, 1, 'new runtime submits at t=110s without transcript replay');
  await a.session._extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' });
  a.tick(5 * MINUTE); await drain();
  assert.equal(a.submissions.length, 1, 'shutdown disposes all local callbacks');
  assert.deepEqual(a.errors, []);
});

const unrelated = content => ({ customType: 'offline-unrelated', content, display: false });

test('Pi 1.4.0 delayed unrelated settlement natively defers then steers the one owned reminder into competing work', async t => {
  const a = await nativeHost(t);
  const notification = a.gate();
  let delayed = false;
  a.on('agent_settled', async () => { if (!delayed) { delayed = true; await notification.promise; } });
  const starts = [];
  a.on('before_agent_start', event => { starts.push(event.message.customType); });
  const oldRun = a.session.sendCustomMessage(unrelated('first run'), { triggerTurn: true });
  await until(() => delayed);
  assert.equal(a.session.isIdle, true, 'native idle omits awaited notification dispatch');
  a.tick(MINUTE);
  await until(() => a.submissions.length === 1);
  await a.drained();
  assert.equal(a.session._deferredSettledActions.length, 1, 'native dispatcher, not adapter mock, owns deferral');
  assert.equal(a.requests.length, 1, 'API submission is not consumption');
  a.tick(ATTEMPT_WARNING_MS);
  assert.equal(a.notices.filter(n => n.text === REMINDER_ATTEMPT_DIAGNOSTIC).length, 1);
  assert.ok(a.intercom.reminders.attempt, 'unrelated settlement must not retire the owned fence');
  // An independent run starts while notification dispatch still awaits. Version-specific actual
  // _startRun exercises competition without adding a fallback or queue-mode option in Intercom.
  a.state.hold = a.gate();
  const competing = a.session._startRun({ messageType: 'custom', message: { role: 'custom', ...unrelated('competing run'), timestamp: Date.now() } });
  await until(() => a.requests.length === 2);
  notification.release(); await oldRun;
  assert.equal(a.session._deferredSettledActions.length, 0);
  assert.equal(a.agent.hasQueuedMessages(), true, 'native deferred send became ordinary host steering');
  assert.equal(a.submissions.length, 1, 'Intercom submits once, never an explicit fallback');
  assert.deepEqual(a.submissions[0].options, { triggerTurn: true });
  assert.equal(starts.includes(WAKEUP_CUSTOM_TYPE), false, 'busy consumption needs no new custom-start event');
  a.state.hold.release(); a.state.hold = undefined;
  await competing;
  assert.equal(a.requests.length, 3, 'the native Agent drains steering in the containing run');
  assert.ok(a.requests[2].some(m => m.role === 'user' && m.content.some(c => c.text === REMINDER_TEXT)));
  assert.equal(a.intercom.reminders.attempt, undefined, 'native persistence plus containing settlement resolves correlation');
  a.tick(MINUTE - 1); await drain(); assert.equal(a.submissions.length, 1);
  a.tick(1); await until(() => a.submissions.length === 2);
  await until(() => a.session.isIdle);
  assert.deepEqual(a.errors, []);
});

test('Pi 1.4.0 post-sample work during awaited authority proof still admits once with no second idle query', async t => {
  const a = await nativeHost(t);
  const proof = a.gate();
  const reminderHost = a.intercom.reminders.host;
  const eligible = reminderHost.eligible;
  t.mock.method(reminderHost, 'eligible', async () => { await proof.promise; return eligible(); });
  const busy = t.mock.method(reminderHost, 'busy');
  a.tick(MINUTE);
  assert.equal(busy.mock.calls.length, 1, 'the due expiry samples native host idle once');
  a.state.hold = a.gate();
  const competing = a.session.sendCustomMessage(unrelated('post-sample work'), { triggerTurn: true });
  await until(() => a.requests.length === 1);
  proof.release(); await until(() => a.submissions.length === 1);
  assert.equal(busy.mock.calls.length, 1, 'post-sample activity cannot become a repeated idle veto');
  assert.equal(a.agent.hasQueuedMessages(), true, 'native busy dispatcher owns the accepted steering race');
  a.state.hold.release(); a.state.hold = undefined;
  await competing;
  assert.equal(a.submissions.length, 1);
  assert.equal(a.intercom.reminders.attempt, undefined);
  assert.deepEqual(a.errors, []);
});

test('Pi 1.4.0 before-agent-start preparation remains busy across X and receives no catch-up', async t => {
  const a = await nativeHost(t);
  const preparation = a.gate(); let preparing = false;
  a.on('before_agent_start', async event => { if (event.message.customType === 'offline-unrelated') { preparing = true; await preparation.promise; } });
  a.tick(50_000);
  const run = a.session.sendCustomMessage(unrelated('slow startup'), { triggerTurn: true });
  await until(() => preparing);
  assert.equal(a.session.isIdle, false);
  assert.equal(a.requests.length, 0);
  a.tick(3 * MINUTE); await a.drained(); assert.equal(a.submissions.length, 0);
  preparation.release(); await run;
  a.tick(MINUTE - 1); await a.drained(); assert.equal(a.submissions.length, 0);
  a.tick(1); await until(() => a.submissions.length === 1);
  await until(() => a.observed.filter(e => e.type === 'agent_settled').length === 2);
  assert.deepEqual(a.errors, []);
});

test('Pi 1.4.0 real preparation failure is swallowed by public sendMessage and retains the bounded unknown fence', async t => {
  const a = await nativeHost(t);
  a.state.failPreparation = true;
  a.tick(MINUTE);
  await until(() => a.errors.some(e => e.event === 'send_message'));
  assert.equal(a.submissions.length, 1);
  assert.equal(a.observed.filter(e => e.type === 'agent_start').length, 0);
  assert.equal(a.observed.filter(e => e.type === 'agent_settled').length, 0, 'native preparation failure emits no settlement');
  assert.equal(a.requests.length, 0);
  assert.equal(a.session.isIdle, true);
  a.tick(ATTEMPT_WARNING_MS - 1); assert.equal(a.notices.filter(n => n.text === REMINDER_ATTEMPT_DIAGNOSTIC).length, 0);
  a.tick(1);
  assert.equal(a.notices.filter(n => n.text === REMINDER_ATTEMPT_DIAGNOSTIC).length, 1);
  a.tick(10 * MINUTE); await a.drained();
  assert.equal(a.submissions.length, 1, 'native swallowed error never causes blind replay');
  assert.ok(a.intercom.reminders.attempt);
});

test('Pi 1.4.0 native runtime replacement during awaited proof suppresses only the stale unsubmitted attempt', async t => {
  const a = await nativeHost(t);
  const proof = a.gate();
  const oldHost = a.intercom.reminders.host;
  const eligible = oldHost.eligible;
  t.mock.method(oldHost, 'eligible', async () => { await proof.promise; return eligible(); });
  a.tick(MINUTE);
  assert.equal(a.intercom.reminders.checking, true);
  await a.session.reload();
  proof.release(); await drain(); await drain();
  assert.equal(a.submissions.length, 0, 'a replaced runtime must not submit even after its one idle sample');
  a.tick(MINUTE - 1); await a.drained(); assert.equal(a.submissions.length, 0);
  a.tick(1); await until(() => a.observed.some(e => e.type === 'agent_settled'));
  assert.equal(a.submissions.length, 1, 'only the replacement runtime owns the fresh interval');
  assert.deepEqual(a.errors, []);
});

test('Pi 1.4.0 native retry gap after agent_end remains busy and cannot trigger a reminder', async t => {
  const a = await nativeHost(t);
  a.session.settingsManager.setRetryEnabled(true);
  a.state.reason = 'error'; a.state.errorMessage = '429 rate limit';
  const run = a.session.sendCustomMessage(unrelated('retry work'), { triggerTurn: true });
  await until(() => a.observed.some(e => e.type === 'auto_retry_start'));
  assert.ok(a.observed.some(e => e.type === 'agent_end'));
  assert.equal(a.observed.some(e => e.type === 'agent_settled'), false, 'agent_end alone is not idle');
  assert.equal(a.session.isIdle, false);
  a.tick(MINUTE); await a.drained(); assert.equal(a.submissions.length, 0);
  a.state.reason = 'stop';
  a.tick(MINUTE); await run;
  assert.equal(a.requests.length, 2);
  assert.equal(a.observed.filter(e => e.type === 'agent_settled').length, 1);
  a.tick(MINUTE - 1); await a.drained(); assert.equal(a.submissions.length, 0);
  a.tick(1); await until(() => a.observed.filter(e => e.type === 'agent_settled').length === 2);
  assert.equal(a.submissions.length, 1);
  assert.deepEqual(a.errors, []);
});

for (const outcome of ['error', 'aborted']) {
  test(`Pi 1.4.0 automatic ${outcome} run processing settles before a fresh full idle interval`, async t => {
    const a = await nativeHost(t);
    a.tick(50_000);
    a.state.hold = a.gate();
    a.state.reason = outcome;
    const run = a.session.sendCustomMessage(unrelated('controlled work'), { triggerTurn: true });
    await until(() => a.requests.length === 1);
    a.tick(3 * MINUTE); await a.drained();
    assert.equal(a.submissions.length, 0, 'busy native run cannot accrue idle time or catch-up');
    if (outcome === 'aborted') await a.session.abort();
    else a.state.hold.release();
    await run;
    a.state.hold = undefined; a.state.reason = 'stop';
    assert.equal(a.session.isIdle, true);
    assert.equal(a.observed.filter(e => e.type === 'agent_settled').length, 1);
    assert.equal(a.observed.find(e => e.type === 'agent_settled').aborted, outcome === 'aborted');
    a.tick(MINUTE - 1); await a.drained(); assert.equal(a.submissions.length, 0);
    a.tick(1); await until(() => a.submissions.length === 1);
    await until(() => a.observed.filter(e => e.type === 'agent_settled').length === 2);
    assert.deepEqual(a.errors, []);
  });
}

test('Pi 1.4.0 automatic compaction gap and cancelled pre-hook stay busy until native settlement', async t => {
  const a = await nativeHost(t);
  // Build a transcript large enough for the real host threshold calculation, not a synthetic event.
  a.manager.appendMessage({ role: 'user', content: [{ type: 'text', text: 'x'.repeat(12000) }], timestamp: Date.now() });
  a.manager.appendMessage({ role: 'assistant', content: [{ type: 'text', text: 'seed' }], api: 'fixture', provider: 'fixture', model: 'offline-script', stopReason: 'stop', timestamp: Date.now(), usage: { input: 3000, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 3001, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
  a.agent.state.messages = a.manager.buildSessionProjection().messages;
  a.agent.state.model.contextWindow = 2000;
  a.session.settingsManager.setCompactionEnabled(true);
  const compact = a.gate(); let compacting = false;
  a.on('session_before_compact', async () => { compacting = true; await compact.promise; return { cancel: true }; });
  a.tick(50_000);
  const run = a.session.sendCustomMessage(unrelated('after compaction'), { triggerTurn: true });
  await until(() => compacting);
  assert.equal(a.session.isIdle, false, 'automatic compaction remains native busy work');
  a.tick(3 * MINUTE); await a.drained();
  assert.equal(a.submissions.length, 0, 'native compaction/startup busy time is not idle');
  compact.release();
  await until(() => a.observed.some(e => e.type === 'agent_settled'));
  await run;
  assert.ok(a.observed.some(e => e.type === 'compaction_start' && e.reason !== 'manual'));
  assert.ok(a.observed.some(e => e.type === 'compaction_end' && e.reason !== 'manual' && e.aborted));
  assert.equal(a.observed.filter(e => e.type === 'agent_settled').length, 1);
  a.tick(MINUTE - 1); await a.drained(); assert.equal(a.submissions.length, 0);
  a.tick(1); await until(() => a.submissions.length === 1);
  await until(() => a.observed.filter(e => e.type === 'agent_settled').length === 2);
  assert.deepEqual(a.errors, []);
});
