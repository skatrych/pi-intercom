import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ATTEMPT_WARNING_MS, BUILTIN_REMINDER_CONTENT, CoordinatorIdleReminders, DEFAULT_REMINDER_INTERVAL_MS,
  REMINDER_ATTEMPT_DIAGNOSTIC, REMINDER_STOP_REASON, REMINDER_TEXT, reminderIntervalMs, isWakeupEntry, WAKEUP_CUSTOM_TYPE,
} from '../dist/reminders.js';
import { recordingClock, settled, wakeupRuntime } from './fixtures/wakeup-fixture.mjs';

const INTERVAL = DEFAULT_REMINDER_INTERVAL_MS;

/** Unit harness: fake clock, injectable eligibility gate, generation-guarded host. */
function unit({ interval = INTERVAL, busy = false, eligible = true } = {}) {
  const clock = recordingClock();
  const delivered = [], warnings = [];
  const state = { busy, eligible, guardEpoch: 0, reads: 0 };
  const host = {
    captureGuard() {
      const at = state.guardEpoch;
      return () => { if (state.guardEpoch !== at) throw new Error('guard epoch changed'); };
    },
    async eligible() {
      state.reads++;
      return state.eligible;
    },
    busy: () => state.busy,
    deliver: (text, submission) => delivered.push({ text, submission, at: clock.now }),
    warn: message => warnings.push(message),
  };
  const reminders = new CoordinatorIdleReminders(host, clock, interval, BUILTIN_REMINDER_CONTENT);
  return {
    clock, delivered, warnings, reminders, state,
    setBusy: value => { state.busy = value; },
    setEligible: value => { state.eligible = value; },
    bumpGuard: () => { state.guardEpoch++; },
    /** Gate the awaited eligibility proof of the next admission window; later reads resolve immediately. */
    gate: () => {
      let resolveProof;
      host.eligible = async () => { state.reads++; return new Promise(resolve => { resolveProof = resolve; }); };
      return value => {
        resolveProof(value);
        host.eligible = async () => { state.reads++; return state.eligible; };
      };
    },
  };
}

test('the interval parser, constants and built-in content are unchanged by the scheduler rewrite', () => {
  assert.equal(reminderIntervalMs(undefined), INTERVAL);
  assert.equal(reminderIntervalMs('35791'), 35791 * 60000);
  assert.equal(reminderIntervalMs('35792'), INTERVAL);
  assert.equal(reminderIntervalMs('0'), INTERVAL);
  assert.equal(BUILTIN_REMINDER_CONTENT.text, REMINDER_TEXT);
});

for (const interval of [INTERVAL, 60000]) {
  test(`one full idle interval gates the first wake-up; correlation and settle arm the next [${interval}ms]`, async () => {
    const u = unit({ interval });
    u.reminders.arm();
    u.clock.advance(interval - 1); await settled(u.reminders);
    assert.equal(u.delivered.length, 0);
    assert.deepEqual(u.clock.delays, [interval]);
    u.clock.advance(1); await settled(u.reminders);
    assert.equal(u.delivered.length, 1);
    assert.equal(u.delivered[0].text, REMINDER_TEXT);
    assert.deepEqual({ source: u.delivered[0].submission.source, sha256: u.delivered[0].submission.sha256 },
      { source: 'builtin', sha256: BUILTIN_REMINDER_CONTENT.sha256 });
    assert.equal(u.clock.pending.size, 1, 'the admitted attempt leaves one handle');
    // Without correlation the attempt stays fenced: no backlog and no second attempt.
    u.clock.advance(2 * interval); await settled(u.reminders);
    assert.equal(u.delivered.length, 1);
    u.reminders.attemptResolved(); u.reminders.activitySettled();
    u.clock.advance(interval - 1); await settled(u.reminders);
    assert.equal(u.delivered.length, 1, 'a fresh full interval starts only after known completion');
    u.clock.advance(1); await settled(u.reminders);
    assert.equal(u.delivered.length, 2);
    assert.notEqual(u.delivered[0].submission.attemptId, u.delivered[1].submission.attemptId);
    u.reminders.dispose();
  });
}

test('a busy expiry sample sends nothing, completes zero reviews and restarts observation without a backlog', async () => {
  const u = unit();
  u.reminders.arm();
  u.setBusy(true);
  u.clock.advance(INTERVAL); await settled(u.reminders);
  assert.equal(u.delivered.length, 0);
  assert.equal(u.state.reads, 0, 'a busy sample never opens an eligibility read');
  u.setBusy(false);
  u.reminders.activitySettled();
  u.clock.advance(INTERVAL - 1); await settled(u.reminders);
  assert.equal(u.delivered.length, 0);
  u.clock.advance(1); await settled(u.reminders);
  assert.equal(u.delivered.length, 1);
  u.reminders.dispose();
});

test('busy work lasting longer than X produces no queued and no immediate catch-up reminder', async () => {
  const u = unit();
  u.reminders.arm();
  u.reminders.activityStarted();
  u.clock.advance(3 * INTERVAL); await settled(u.reminders);
  assert.equal(u.delivered.length, 0, 'no catch-up anywhere inside one long busy span');
  assert.equal(u.clock.pending.size, 1, 'one handle, no accumulating ticks');
  u.reminders.activitySettled();
  u.clock.advance(INTERVAL - 1); await settled(u.reminders);
  assert.equal(u.delivered.length, 0);
  u.clock.advance(1); await settled(u.reminders);
  assert.equal(u.delivered.length, 1);
  u.reminders.dispose();
});

test('activity concurrent with an expiry invalidates the stale deadline before any sample', async () => {
  const u = unit();
  u.reminders.arm();
  u.clock.advance(INTERVAL - 1);
  u.setBusy(true);
  u.reminders.activityStarted();
  u.clock.advance(1); await settled(u.reminders);
  assert.equal(u.delivered.length, 0, 'the replaced deadline cannot fire');
  u.setBusy(false);
  u.reminders.activitySettled();
  u.clock.advance(INTERVAL); await settled(u.reminders);
  assert.equal(u.delivered.length, 1);
  u.reminders.dispose();
});

test('stale timer callbacks after dispose, suspend or re-arm are fenced and never deliver', async () => {
  for (const action of ['dispose', 'suspend']) {
    const u = unit();
    u.reminders.arm();
    const stale = u.clock.callbacks.at(-1);
    u.reminders[action]();
    stale(); await settled(u.reminders);
    assert.equal(u.delivered.length, 0);
    assert.equal(u.clock.pending.size, 0);
  }
  const u = unit();
  u.reminders.arm();
  const stale = u.clock.callbacks.at(-1);
  u.reminders.arm(); // a later authorization transition replaces the fresh observation
  stale(); await settled(u.reminders);
  assert.equal(u.delivered.length, 0);
  u.clock.advance(INTERVAL); await settled(u.reminders);
  assert.equal(u.delivered.length, 1, 'only the fresh schedule delivers');
  u.reminders.dispose();
});

test('failed eligibility suspends the loop without a timer; a later authorization transition re-arms fresh', async () => {
  const u = unit();
  u.setEligible(false);
  u.reminders.arm();
  u.clock.advance(INTERVAL); await settled(u.reminders);
  assert.equal(u.delivered.length, 0);
  assert.equal(u.clock.pending.size, 0, 'a non-eligible session leaves no scheduled wake-up');
  u.clock.advance(5 * INTERVAL); await settled(u.reminders);
  assert.equal(u.delivered.length, 0);
  u.setEligible(true);
  u.reminders.arm();
  assert.deepEqual(u.clock.delays.at(-1), INTERVAL);
  u.clock.advance(INTERVAL); await settled(u.reminders);
  assert.equal(u.delivered.length, 1);
  u.reminders.dispose();
});

test('runtime/authority guard loss during the awaited proof suppresses unsubmitted input and re-observes idle', async () => {
  const u = unit();
  const release = u.gate();
  u.reminders.arm();
  u.clock.advance(INTERVAL);
  assert.equal(u.state.reads, 1, 'the one admitted attempt opens exactly one eligibility read');
  u.bumpGuard(); // authority/root/runtime changed while the proof still awaits
  release(true);
  await settled(u.reminders);
  assert.equal(u.delivered.length, 0, 'an independent change suppresses the attempt completely');
  // No blind immediate retry: the drained loop re-observes idle and starts a full fresh interval.
  u.clock.advance(INTERVAL); await settled(u.reminders);
  u.clock.advance(INTERVAL); await settled(u.reminders);
  assert.equal(u.delivered.length, 1);
  assert.equal(u.state.reads, 2, 'the later attempt re-proves eligibility');
  u.reminders.dispose();
});

test('activity starting after the single idle sample while the proof awaits cannot cancel the admitted attempt', async () => {
  const u = unit();
  const release = u.gate();
  u.reminders.arm();
  u.clock.advance(INTERVAL); // admitted; proof in flight
  u.setBusy(true);
  u.reminders.activityStarted();
  u.reminders.activitySettled();
  u.setBusy(false);
  release(true);
  await settled(u.reminders);
  assert.equal(u.delivered.length, 1, 'no post-sample idle/activity/deadline recheck cancels an admitted attempt');
  assert.equal(u.clock.pending.size, 1);
  u.reminders.dispose();
});

test('a proof that outlives one additional interval is suppressed as too old and drained, never submitted', async () => {
  const u = unit();
  const release = u.gate();
  u.reminders.arm();
  u.clock.advance(INTERVAL); // admission window bounded by one interval from the captured due
  u.clock.advance(INTERVAL); // the age bound elapses while the proof still pends
  release(true);
  await settled(u.reminders);
  assert.equal(u.delivered.length, 0, 'a beyond-bound window submits nothing');
  assert.equal(u.clock.pending.size, 1, 'the loop is drained, not disarmed');
  u.clock.advance(INTERVAL); await settled(u.reminders);
  u.clock.advance(INTERVAL); await settled(u.reminders);
  assert.equal(u.delivered.length, 1, 'observation resumes and a new full interval admits again');
  u.reminders.dispose();
});

test('the unconfirmed attempt is warned about once and stays fenced with no resubmission', async () => {
  const u = unit();
  u.reminders.arm();
  u.clock.advance(INTERVAL); await settled(u.reminders);
  assert.equal(u.delivered.length, 1);
  assert.equal(u.clock.delays.at(-1), ATTEMPT_WARNING_MS, 'the single handle runs the bounded warning');
  u.clock.advance(ATTEMPT_WARNING_MS - 1); await settled(u.reminders);
  assert.equal(u.warnings.length, 0);
  u.clock.advance(1); await settled(u.reminders);
  assert.deepEqual(u.warnings, [REMINDER_ATTEMPT_DIAGNOSTIC], 'exactly one bounded warning from the same handle');
  u.clock.advance(5 * INTERVAL); await settled(u.reminders);
  assert.equal(u.delivered.length, 1, 'no blind retry, resubmission or catch-up');
  assert.equal(u.warnings.length, 1, 'no repeated warnings');
  // Correlation retires the fence and starts the next full interval.
  u.reminders.attemptResolved(); u.reminders.activitySettled();
  u.clock.advance(INTERVAL - 1); await settled(u.reminders);
  assert.equal(u.delivered.length, 1);
  u.clock.advance(1); await settled(u.reminders);
  assert.equal(u.delivered.length, 2);
  u.reminders.dispose();
});

test('a busy arm waits for observed idle, never counting busy time as idle', async () => {
  const u = unit();
  u.setBusy(true);
  u.reminders.arm();
  assert.deepEqual(u.clock.delays, [INTERVAL]);
  u.clock.advance(INTERVAL); await settled(u.reminders);
  assert.equal(u.delivered.length, 0);
  u.setBusy(false);
  u.reminders.activitySettled();
  u.clock.advance(INTERVAL); await settled(u.reminders);
  assert.equal(u.delivered.length, 1);
  u.reminders.dispose();
});

test('an idle observation without any settle event establishes fresh X from the observation itself', async () => {
  const u = unit();
  u.setBusy(true);
  u.reminders.arm();
  u.setBusy(false);
  u.clock.advance(INTERVAL); await settled(u.reminders); // the poll observes idle here
  u.clock.advance(INTERVAL - 1); await settled(u.reminders);
  assert.equal(u.delivered.length, 0);
  u.clock.advance(1); await settled(u.reminders);
  assert.equal(u.delivered.length, 1, 'a full interval elapsed after idle was first observed');
  u.reminders.dispose();
});

test('repeated invalidation and settle cycles never accumulate timers or missed intervals', async () => {
  const u = unit();
  u.reminders.arm();
  for (const at of [10, 1000, 40_000]) {
    u.clock.advance(at);
    u.reminders.activityStarted();
    u.clock.advance(500);
    u.reminders.activitySettled();
    await settled(u.reminders);
  }
  assert.equal(u.delivered.length, 0);
  assert.equal(u.clock.pending.size, 1);
  u.clock.advance(INTERVAL); await settled(u.reminders);
  assert.equal(u.delivered.length, 1);
  u.reminders.dispose();
});

test('correlated completion starts the next full interval and never replays a missed deadline', async () => {
  const u = unit();
  u.reminders.arm();
  u.clock.advance(INTERVAL); await settled(u.reminders);
  u.clock.advance(2 * INTERVAL); await settled(u.reminders); // fenced; the missed expiry is lost forever
  u.reminders.attemptResolved(); u.reminders.activitySettled();
  u.clock.advance(INTERVAL); await settled(u.reminders);
  assert.equal(u.delivered.length, 2, 'exactly one new attempt per fresh interval');
  u.reminders.attemptResolved(); u.reminders.activitySettled();
  u.clock.advance(INTERVAL); await settled(u.reminders);
  assert.equal(u.delivered.length, 3);
  u.reminders.dispose();
});

test('a second due expiry while one admission window is open never starts a parallel check', async () => {
  const u = unit();
  const release = u.gate();
  u.reminders.arm();
  u.clock.advance(INTERVAL); // admission window opens with exactly one eligibility read
  u.clock.advance(1000); // time passes; the window's own handle is the only timer
  assert.equal(u.state.reads, 1);
  assert.equal(u.clock.pending.size, 1, 'no second expiry handle while the window is open');
  release(true);
  await settled(u.reminders);
  assert.equal(u.state.reads, 1, 'never two parallel checks');
  assert.equal(u.delivered.length, 1);
  u.reminders.dispose();
});

test('wake-up entry correlation accepts only the identified custom_message entry', () => {
  assert.equal(isWakeupEntry({ type: 'custom_message', customType: WAKEUP_CUSTOM_TYPE, details: { attemptId: 'a' } }, 'a'), true);
  assert.equal(isWakeupEntry({ type: 'custom_message', customType: WAKEUP_CUSTOM_TYPE, details: { attemptId: 'b' } }, 'a'), false);
  assert.equal(isWakeupEntry({ type: 'custom', customType: WAKEUP_CUSTOM_TYPE, details: { attemptId: 'a' } }, 'a'), false);
  assert.equal(isWakeupEntry({ type: 'custom_message', customType: 'other', details: { attemptId: 'a' } }, 'a'), false);
  assert.equal(isWakeupEntry(null, 'a'), false);
  assert.equal(isWakeupEntry({ type: 'message', message: {} }, 'a'), false);
});

// ---- Runtime wiring: a real authorized Orchestrator fixture on a committed projects-home board ----

test('an eligible zero-worker Orchestrator startup arms one fresh interval without any worker call', async t => {
  const f = await wakeupRuntime(t);
  assert.equal(f.clock.pending.size, 0, 'nothing armed before start');
  await f.runtime.start();
  assert.equal(f.runtime.coordinatorActionReady(), true);
  assert.deepEqual(f.clock.delays, [DEFAULT_REMINDER_INTERVAL_MS]);
  await f.tick();
  assert.equal(f.reminders().length, 1);
  assert.equal(f.reminders()[0].text, REMINDER_TEXT);
  assert.equal(f.reminders()[0].busy, false);
  await f.tick();
  await f.tick();
  assert.equal(f.reminders().length, 3, 'scheduled recurrence continues without worker calls');
});

test('a non-Orchestrator or unauthorized session never schedules a wake-up', async t => {
  const developer = await wakeupRuntime(t, { roleDirectory: 'developer' });
  await developer.runtime.start();
  assert.equal(developer.clock.pending.size, 0, 'a plain coordinator session has no wake-up path');

  const held = await wakeupRuntime(t, { claim: 'absent' });
  await held.runtime.start();
  assert.equal(held.runtime.coordinatorActionReady(), false);
  assert.equal(held.clock.pending.size, 0);
});

test('busy startup waits for observed idle before one full interval', async t => {
  const f = await wakeupRuntime(t);
  f.setBusy(true);
  await f.runtime.start();
  assert.deepEqual(f.clock.delays, [DEFAULT_REMINDER_INTERVAL_MS]);
  f.clock.advance(DEFAULT_REMINDER_INTERVAL_MS); await settled(f.runtime.reminders);
  assert.equal(f.reminders().length, 0, 'the busy observation sample sends nothing');
  f.setBusy(false);
  f.runtime.reminders.activitySettled();
  f.clock.advance(DEFAULT_REMINDER_INTERVAL_MS); await settled(f.runtime.reminders);
  assert.equal(f.reminders().length, 1, 'the fresh interval starts from observed idle');
});

test('authority loss suspends the wake-up loop; reopened authorization arms a fresh interval', async t => {
  const f = await wakeupRuntime(t);
  await f.runtime.start();
  assert.deepEqual(f.clock.delays, [DEFAULT_REMINDER_INTERVAL_MS]);
  // A coordinator transaction closes readiness through real paths; stage it as adoption tests do.
  const epoch = f.runtime.closeActionEpoch('fixture: independent authority check closed');
  assert.equal(typeof epoch, 'number');
  assert.equal(f.clock.pending.size, 0, 'suspension cancels the loop timer');
  f.clock.advance(5 * DEFAULT_REMINDER_INTERVAL_MS); await settled(f.runtime.reminders);
  assert.equal(f.reminders().length, 0);
  f.runtime.openActionEpoch(); // the promotion/adoption-open path of the runtime
  assert.deepEqual(f.clock.delays.at(-1), DEFAULT_REMINDER_INTERVAL_MS, 'reauthorization arms fresh; nothing restored');
  await f.tick();
  assert.equal(f.reminders().length, 1);
});

test('worker-directed operations neither arm, reset, nor own the wake-up signal; the stop tool is truthful', async t => {
  const f = await wakeupRuntime(t);
  await f.runtime.start();
  assert.deepEqual(f.clock.delays, [DEFAULT_REMINDER_INTERVAL_MS]);
  const handles = f.clock.callbacks.length;
  await f.runtime.tool('create_worker', {});
  assert.equal(f.clock.callbacks.length, handles, 'a coordinator operation adds no timer');
  f.clock.advance(DEFAULT_REMINDER_INTERVAL_MS - 1); await settled(f.runtime.reminders);
  assert.equal(f.reminders().length, 0, 'the coordinator operation did not reset the deadline');
  f.clock.advance(1); await settled(f.runtime.reminders);
  assert.equal(f.reminders().length, 1);
  assert.deepEqual(await f.runtime.tool('stop_reminders', {}), { stopped: false, reason: REMINDER_STOP_REASON });
  // Nothing was cancelled and no disable bit was stored: the unconfirmed attempt keeps its bounded
  // warning handle, and the loop continues observing.
  f.clock.advance(ATTEMPT_WARNING_MS); await settled(f.runtime.reminders);
  assert.equal(f.clock.pending.size, 1, 'the stop tool changes nothing about the loop');
});

test('a session restart disposes old callbacks, starts one fresh deadline and replays nothing', async t => {
  const f = await wakeupRuntime(t);
  await f.runtime.start();
  await f.tick();
  assert.equal(f.reminders().length, 1);
  const stale = f.clock.callbacks.at(-1);
  await f.runtime.close();
  assert.equal(f.clock.pending.size, 0);
  await f.runtime.start();
  assert.deepEqual(f.clock.delays.at(-1), DEFAULT_REMINDER_INTERVAL_MS, 'one fresh deadline only');
  stale(); await settled(f.runtime.reminders);
  assert.equal(f.reminders().length, 1, 'the stale old callback cannot deliver for the new runtime');
  await f.tick();
  assert.equal(f.reminders().length, 2);
});
