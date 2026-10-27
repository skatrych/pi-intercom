import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import extension from '../dist/index.js';
import { Intercom } from '../dist/runtime.js';
import {
  ATTEMPT_WARNING_MS, REMINDER_ADMISSION_DIAGNOSTIC, REMINDER_ATTEMPT_DIAGNOSTIC,
  REMINDER_MINUTES_ENV, REMINDER_TEXT, isWakeupEntry, WAKEUP_CUSTOM_TYPE,
} from '../dist/reminders.js';
import { createFixture } from './fixtures/adoption-fixture.mjs';
import { commitFirstDeclaration } from './fixtures/wakeup-fixture.mjs';

const supportedHost = { skip: !['win32', 'linux'].includes(process.platform) ? 'Windows/Linux extension orchestrator adapter' : false };
const MINUTE = 60 * 1000;
const settle = () => new Promise(resolve => setImmediate(resolve));
/** Real I/O inside the reminder check needs the event loop, not a fixed number of ticks. */
async function waitFor(condition, limit = 3000) {
  const started = Date.now();
  while (!condition()) {
    assert.ok(Date.now() - started < limit, 'expected adapter step was not reached');
    await settle();
  }
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * Orchestrator adapter fixture: one committed projects-home board, a canonical Orchestrator launch
 * through the supported process-environment seams, and the extension's own real runtime. Mock timers
 * make the idle expiry deterministic without any injected scheduler seam, so the actual index.ts
 * deliver → pi.sendMessage adapter, the attempt fence, and the correlation path are what run.
 */
async function orchestratorAdapter(t) {
  let runtime;
  const start = Intercom.prototype.start;
  t.mock.method(Intercom.prototype, 'start', function (...args) { runtime = this; return start.apply(this, args); });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const saved = { minutes: process.env[REMINDER_MINUTES_ENV], file: process.env.PI_INTERCOM_REMINDER_FILE, role: process.env.PI_ROLE_DIR, roles: process.env.PI_ROLES_DIR, home: process.env.PI_INTERCOM_PROJECTS_HOME, worker: process.env.PI_INTERCOM_WORKER_ROLE, herdr: process.env.HERDR_ENV };
  t.after(async () => {
    for (const [name, value] of [['PI_ROLE_DIR', saved.role], ['PI_ROLES_DIR', saved.roles], ['PI_INTERCOM_PROJECTS_HOME', saved.home], ['PI_INTERCOM_WORKER_ROLE', saved.worker], ['HERDR_ENV', saved.herdr], ['PI_INTERCOM_REMINDER_FILE', saved.file], ['PI_INTERCOM_REMINDER_MINUTES', saved.minutes]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
  delete process.env.PI_INTERCOM_REMINDER_FILE;
  process.env[REMINDER_MINUTES_ENV] = '1';
  const f = await createFixture();
  const port = await freePort();
  await commitFirstDeclaration(f, { sessionId: 'adapter-orchestrator', port, claim: true });
  process.env.PI_ROLE_DIR = path.join(f.home, 'roles/orchestrator');
  process.env.PI_ROLES_DIR = path.join(f.home, 'roles');
  process.env.PI_INTERCOM_PROJECTS_HOME = f.home;
  delete process.env.PI_INTERCOM_WORKER_ROLE;
  delete process.env.HERDR_ENV;
  const submissions = [], steered = [], notices = [];
  let branch = [];
  const ctx = {
    cwd: f.home, mode: 'tui', isProjectTrusted: () => true, isIdle: () => true,
    sessionManager: { getSessionId: () => 'adapter-orchestrator', getBranch: () => branch, getSessionFile: () => undefined },
    ui: { notify: (text, level) => notices.push({ text, level }) },
  };
  const events = new Map();
  const channels = new Map();
  const bus = { on: (channel, handler) => { channels.set(channel, handler); return () => channels.delete(channel); }, emit: (channel, data) => channels.get(channel)?.(data) };
  const tools = new Map();
  const pi = {
    registerTool: tool => tools.set(tool.name, tool),
    on: (event, handler) => events.set(event, handler),
    events: bus,
    registerFlag: () => {},
    getFlag: () => undefined,
    getSessionName: () => '',
    setSessionName: () => {},
    sendUserMessage: content => steered.push(content),
    // The supported reminder-only dispatcher: exactly what src/index.ts wakeupSubmission calls.
    sendMessage: (message, options) => submissions.push({ message, options }),
  };
  extension(pi);
  await events.get('session_start')({}, ctx);
  t.after(async () => { await events.get('session_shutdown')(); await rm(f.home, { recursive: true, force: true }); });
  const settleRun = entries => events.get('agent_settled')({ aborted: false }, { ...ctx, sessionManager: { ...ctx.sessionManager, getBranch: () => entries } });
  return { f, tools, ctx, events, runtime, setBranch: entries => { branch = entries; }, submissions, steered, notices, tick: ms => t.mock.timers.tick(ms), settleRun };
}

const OWN_SHA256 = createHash('sha256').update(REMINDER_TEXT, 'utf8').digest('hex');

test('an idle expiry dispatches through the Orchestrator adapter as one triggerTurn custom message', supportedHost, async t => {
  const a = await orchestratorAdapter(t);
  assert.equal(a.submissions.length, 0, 'startup arms one interval; nothing is submitted before the expiry');
  a.tick(MINUTE);
  await waitFor(() => a.submissions.length === 1);
  assert.deepEqual(a.submissions[0].options, { triggerTurn: true });
  assert.deepEqual(a.submissions[0].message, {
    customType: WAKEUP_CUSTOM_TYPE,
    content: REMINDER_TEXT,
    display: true,
    details: { attemptId: a.submissions[0].message.details.attemptId, reminderSource: 'builtin', reminderSha256: OWN_SHA256 },
  });
  assert.equal(a.steered.length, 0, 'the reminder never uses the ordinary steering path');
  // An idle-triggered custom run still gets the standard identity context injected (no payload access).
  const prompt = await a.events.get('before_agent_start')({ systemPrompt: 'Original', messageType: 'custom', message: a.submissions[0].message }, a.ctx);
  assert.match(prompt.systemPrompt, /Identity: Coordinator/);
  assert.match(prompt.systemPrompt, /Responsibility is not a work assignment/);
  assert.equal(a.submissions.length, 1);
});

test('tree summarization activity invalidates the old deadline and settles one fresh interval', supportedHost, async t => {
  const a = await orchestratorAdapter(t);
  a.tick(50_000); // t=50: armed idle still ten seconds short of the first expiry
  await a.events.get('session_before_tree')({ preparation: {}, signal: new AbortController().signal }, a.ctx);
  await settle();
  a.tick(5000); // t=55: the t=60 expiry no longer exists anywhere
  assert.equal(a.submissions.length, 0, 'the pre-tree invalidation cannot submit the stale deadline');
  await a.events.get('session_tree')({ newLeafId: null, oldLeafId: null }, a.ctx);
  await settle();
  a.tick(59_999);
  assert.equal(a.submissions.length, 0, 'the full interval restarts when summarization settles');
  a.tick(1); // t=115 = 55 + one full interval
  await waitFor(() => a.submissions.length === 1);
});

test('a cancelled tree operation without completion invalidates the old deadline before its proof drains', supportedHost, async t => {
  const a = await orchestratorAdapter(t);
  a.tick(50_000);
  await a.events.get('session_before_tree')({ preparation: {}, signal: AbortSignal.abort() }, a.ctx);
  // Cancellation/failure means session_tree never arrives. Cross the ORIGINAL expiry and wait for
  // any admitted real filesystem proof to drain before the absence assertion (mutation-sensitive).
  a.tick(10_000);
  await waitFor(() => !a.runtime.reminders.checking);
  assert.equal(a.submissions.length, 0, 'no stale expiry after a cancelled pre-tree operation');
  a.tick(50_000); // t=110: observation, not admission; no completion event has rescued the deadline
  await waitFor(() => !a.runtime.reminders.checking);
  assert.equal(a.submissions.length, 0, 'observe idle conservatively after failed summarization');
  a.tick(MINUTE);
  await waitFor(() => a.submissions.length === 1);
});

test('a delayed unrelated agent_settled fences the attempt; owned consumption inside a run resolves it', supportedHost, async t => {
  const a = await orchestratorAdapter(t);
  a.tick(MINUTE);
  await waitFor(() => a.submissions.length === 1);
  const attempt = a.submissions[0].message.details.attemptId;
  // A settlement that does not contain the owned message is not correlation: the fence holds.
  await a.settleRun([]);
  a.tick(5 * MINUTE); await settle(); await settle();
  assert.equal(a.submissions.length, 1, 'no resubmission past unrelated settlements');
  // An owned type with another attempt id, or a custom (non-message) entry, fails correlation too.
  await a.settleRun([
    { type: 'custom_message', customType: WAKEUP_CUSTOM_TYPE, content: 'x', display: true, details: { attemptId: 'other-attempt' } },
    { type: 'custom', customType: WAKEUP_CUSTOM_TYPE, details: { attemptId: attempt } },
  ]);
  a.tick(MINUTE); await settle();
  assert.equal(a.submissions.length, 1, 'only the identified custom_message entry correlates');
  // The accepted steering race: the owned message shows up inside an already-running run's own branch.
  await a.settleRun([{ type: 'custom_message', customType: WAKEUP_CUSTOM_TYPE, content: REMINDER_TEXT, display: true, details: { attemptId: attempt } }]);

  // The fresh interval admits again through the actual adapter: recurrence without a fixture shim.
  a.tick(MINUTE);
  await waitFor(() => a.submissions.length === 2);
  assert.equal(isWakeupEntry(a.submissions[1].message, a.submissions[1].message.details.attemptId), false, 'the submission itself is not a persisted entry');
  assert.notEqual(a.submissions[1].message.details.attemptId, attempt, 'the new attempt carries its own id');
  assert.equal(a.submissions[1].message.details.reminderSha256, OWN_SHA256);
});

test('a submission without any host lifecycle evidence keeps the fence and warns once at the bound', supportedHost, async t => {
  const a = await orchestratorAdapter(t);
  a.tick(MINUTE);
  await waitFor(() => a.submissions.length === 1);
  // No settle is driven at all; the attempt's bounded uncertainty observation runs to its bound.
  a.tick(ATTEMPT_WARNING_MS - 1); await settle();
  assert.equal(a.notices.some(n => n.text === REMINDER_ATTEMPT_DIAGNOSTIC), false);
  a.tick(1); await settle();
  assert.equal(a.notices.filter(n => n.text === REMINDER_ATTEMPT_DIAGNOSTIC).length, 1, 'exactly one warning');
  a.tick(5 * MINUTE); await settle();
  assert.equal(a.submissions.length, 1, 'no blind retry after the warning');
  assert.equal(a.notices.filter(n => n.text === REMINDER_ATTEMPT_DIAGNOSTIC).length, 1, 'no repeated warnings');
  assert.equal(a.notices.some(n => n.text === REMINDER_ADMISSION_DIAGNOSTIC), false, 'a submitted attempt does not emit the admission diagnostic');
});
