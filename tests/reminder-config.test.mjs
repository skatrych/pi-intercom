import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import extension from '../dist/index.js';
import {
  DEFAULT_REMINDER_INTERVAL_MS, DEFAULT_REMINDER_MINUTES, MAX_REMINDER_MINUTES, MIN_REMINDER_MINUTES,
  REMINDER_MINUTES_ENV, REMINDER_TEXT, reminderIntervalMs,
} from '../dist/reminders.js';
import { Intercom } from '../dist/runtime.js';
import { ConfigStore } from '../dist/config.js';

const MINUTE = 60 * 1000;
const settle = () => new Promise(resolve => setImmediate(resolve));
async function settled(reminders) {
  const deadline = Date.now() + 2000;
  while (reminders?.checking) {
    assert.ok(Date.now() < deadline, 'reminder role check did not finish');
    await settle();
  }
}

/** Records the exact delays the runtime schedules instead of asserting one upfront, so an override cannot be masked. */
function recordingClock() {
  let now = 0, next = 0;
  const pending = new Map(), callbacks = [];
  return {
    pending, callbacks, delays: [],
    schedule(callback, delay) {
      this.delays.push(delay);
      const id = ++next; pending.set(id, { callback, due: now + delay }); callbacks.push(callback);
      return () => pending.delete(id);
    },
    advance(milliseconds) {
      now += milliseconds;
      for (const [id, entry] of [...pending]) if (entry.due <= now) { pending.delete(id); entry.callback(); }
    },
  };
}

/** Passed to harness() so the coordinator uses production's process.env reader. */
const PRODUCTION_ENV = Symbol('production process.env reader');

async function harness(t, readEnv) {
  const root = await mkdtemp(path.join(tmpdir(), 'intercom-reminder-config-'));
  await new ConfigStore(root).initialize('c', 12345);
  const clock = recordingClock(), messages = [], endpoints = new Map();
  let port = 30000, busy = false;
  const transport = {
    reminderClock: clock,
    listen: async (_preferred, accept) => { const p = port++; endpoints.set(p, accept); return { port: p, close: async () => { endpoints.delete(p); } }; },
    send: async (p, message) => { const accept = endpoints.get(p); if (!accept) throw new Error('offline'); await accept(message); },
    launch: async () => ({ submitted: true }),
    probe: async () => [],
  };
  // Only the coordinator arms reminders, so only its environment is under test;
  // the worker's seam is pinned so an inherited operator value cannot leak in.
  const seam = readEnv === PRODUCTION_ENV ? undefined : (readEnv ?? (() => undefined));
  const reads = { count: 0 };
  const reader = seam ? () => { reads.count++; return seam(); } : undefined;
  const host = id => ({ cwd: root, sessionId: () => id, busy: () => busy,
    deliver: text => messages.push({ id, text }), setName: async () => {}, notify() {} });
  const c = new Intercom(host('c'), { ...transport, ...(reader ? { reminderMinutesEnv: reader } : {}) });
  const w = new Intercom(host('w'), { ...transport, reminderMinutesEnv: () => undefined });
  t.after(async () => { await w.close().catch(() => {}); await c.close().catch(() => {}); await rm(root, { recursive: true, force: true }); });
  const reminderCount = () => messages.filter(message => message.id === 'c' && message.text === REMINDER_TEXT).length;
  return {
    c, w, clock, messages, reads, reminderCount, setBusy: value => { busy = value; },
    start: async () => { await c.start(); await w.start(); },
    // A valid coordinator worker call arms before its effect; a repeat call resets.
    arm: async () => c.tool('configure_worker', { sessionId: 'w', port: w.endpoint.port, projectDirectory: '.', name: 'Worker', description: 'Assigned scope' }),
    tick: async milliseconds => { clock.advance(milliseconds); await settled(c.reminders); },
  };
}

test('configuration contract constants', () => {
  assert.equal(REMINDER_MINUTES_ENV, 'PI_INTERCOM_REMINDER_MINUTES');
  assert.equal(DEFAULT_REMINDER_MINUTES, 5);
  assert.equal(MIN_REMINDER_MINUTES, 1);
  assert.equal(MAX_REMINDER_MINUTES, 35791);
  assert.equal(DEFAULT_REMINDER_INTERVAL_MS, 5 * MINUTE);
  // The bound keeps a configured delay inside Node's signed 32-bit timeout maximum.
  assert.equal(MAX_REMINDER_MINUTES * MINUTE, 2147460000);
  assert.ok(MAX_REMINDER_MINUTES * MINUTE <= 2147483647);
  assert.ok((MAX_REMINDER_MINUTES + 1) * MINUTE > 2147483647);
});

test('accepted values are trimmed ASCII whole minutes within the bounds', () => {
  for (const [raw, minutes] of [
    ['1', 1], ['2', 2], ['5', 5], ['60', 60], ['35791', 35791],
    ['01', 1], ['0002', 2], ['00000000000000000000000000000000000000000005', 5],
    [' 7 ', 7], ['\t9\n', 9], ['\u00a03\u00a0', 3],
  ]) assert.equal(reminderIntervalMs(raw), minutes * MINUTE, JSON.stringify(raw));
});

test('anything else silently uses the five-minute default', () => {
  for (const raw of [
    undefined, '', ' ', '\t\n',
    '0', '00', '000', '000000000000000000000000000000000000000000000000',
    '-0', '-1', '+2', '2-5',
    '2.5', '.5', '2.', '2,5', '0.0001',
    '2e3', '1e0', '1e-3', '0x10', '0b1', '0o7',
    '2min', '2 min', '5 minutes', 'min2', '2m', '1_000', '1 000',
    'NaN', 'undefined', 'Infinity', '-Infinity', 'null', 'true',
    '٣', '٢٤٦', '２', 'five',
    '35792', '35799', '35791.0', '99999999999999999999', '4294967296', '2147483648', '9007199254740993',
    '0.5', '1e999',
  ]) {
    assert.equal(reminderIntervalMs(raw), DEFAULT_REMINDER_INTERVAL_MS, JSON.stringify(raw));
    assert.ok(Number.isSafeInteger(reminderIntervalMs(raw)), JSON.stringify(raw));
    assert.ok(reminderIntervalMs(raw) >= MIN_REMINDER_MINUTES * MINUTE, JSON.stringify(raw));
    assert.ok(reminderIntervalMs(raw) <= MAX_REMINDER_MINUTES * MINUTE, JSON.stringify(raw));
  }
});

test('reminder text stays fixed, interval-neutral and free of operator input', () => {
  assert.deepEqual(REMINDER_TEXT, 'Intercom reminder: Review outstanding delegated work and worker reports. If follow-up is needed, take the next appropriate action. Do not assume workers have finished or stopped.\n\nIf there is genuinely nothing to follow up on, call intercom_stop_reminders. Otherwise, reminders continue at the configured interval; a new worker call resets the timer.\n\nThis reminder does not authorize new work, retries, worker closure, or publication.');
  assert.match(REMINDER_TEXT, /Otherwise, reminders continue at the configured interval; a new worker call resets the timer\./);
  assert.match(REMINDER_TEXT, /This reminder does not authorize new work, retries, worker closure, or publication\./);
  assert.doesNotMatch(REMINDER_TEXT, /five minutes|\b\d+ minutes?\b/i);
  assert.doesNotMatch(REMINDER_TEXT, new RegExp(REMINDER_MINUTES_ENV));
});

test('no tool description promises a fixed reminder interval', () => {
  const tools = new Map();
  const channels = new Map();
  const bus = { on: (channel, handler) => { const set = (channels.get(channel) ?? new Set()); set.add(handler); channels.set(channel, set); return () => { set.delete(handler); if (!set.size) channels.delete(channel); }; }, emit: (channel, data) => { for (const handler of [...(channels.get(channel) ?? [])]) handler(data); } };
  extension({ registerTool: tool => tools.set(tool.name, tool), on: () => {}, events: bus });
  assert.ok(tools.has('intercom_stop_reminders'));
  for (const [name, tool] of tools) {
    assert.doesNotMatch(tool.description, /five[- ]minutes?|\bevery \d+ minutes?\b/i, name);
    assert.doesNotMatch(tool.description, new RegExp(REMINDER_MINUTES_ENV), name);
  }
  assert.match(tools.get('intercom_stop_reminders').description, /orchestration reminders at their configured interval/);
});

for (const [label, raw, delay] of [
  ['unset', undefined, 5 * MINUTE],
  ['blank', '   ', 5 * MINUTE],
  ['valid one minute', '1', 1 * MINUTE],
  ['valid ordinary override', '2', 2 * MINUTE],
  ['trimmed leading zeros', ' 0007 ', 7 * MINUTE],
  ['upper boundary', '35791', 35791 * MINUTE],
  ['zero is not a disable switch', '0', 5 * MINUTE],
  ['malformed exponent', '2e3', 5 * MINUTE],
  ['above boundary', '35792', 5 * MINUTE],
  ['unsafe huge value', '99999999999999999999', 5 * MINUTE],
]) {
  test(`runtime schedules the validated interval: ${label}`, async t => {
    const f = await harness(t, () => raw);
    assert.equal(f.reads.count, 0, 'construction alone must not read the environment');
    await f.start();
    assert.equal(f.reads.count, 1, 'one read per runtime start');
    assert.deepEqual(f.clock.delays, [], 'startup remains disarmed');
    await f.arm();
    assert.deepEqual(f.clock.delays, [delay]);
    await f.arm();
    assert.deepEqual(f.clock.delays, [delay, delay]);
    assert.equal(f.reads.count, 1, 'tool calls must not reread the environment');
    // The validated delay is the only tick: no early delivery, then recurrence.
    await f.tick(delay - 1);
    assert.equal(f.reminderCount(), 0);
    await f.tick(1);
    assert.equal(f.reminderCount(), 1);
    await f.tick(delay);
    assert.equal(f.reminderCount(), 2);
    assert.deepEqual(f.clock.delays, [delay, delay, delay, delay]);
    // Invalid input never disables, clamps or blocks normal work.
    await f.c.tool('reload_worker', { to: 'Worker' });
    await f.w.tool('report_status', {});
    await f.c.tool('stop_reminders', {});
    assert.equal(f.reads.count, 1);
  });
}

test('busy ticks at an override interval still skip without catch-up', async t => {
  const f = await harness(t, () => '1');
  await f.start(); await f.arm();
  f.setBusy(true);
  await f.tick(1 * MINUTE);
  assert.equal(f.reminderCount(), 0);
  await f.tick(1 * MINUTE);
  assert.equal(f.reminderCount(), 0);
  f.setBusy(false);
  await f.tick(1 * MINUTE);
  assert.equal(f.reminderCount(), 1, 'one check per interval, never a backlog of the skipped ticks');
});

test('a runtime keeps its startup interval while the environment changes, and a fresh runtime rereads it', async t => {
  let value = '2';
  const f = await harness(t, () => value);
  await f.start();
  assert.equal(f.reads.count, 1);
  await f.arm();
  assert.deepEqual(f.clock.delays, [2 * MINUTE]);
  // A later shell export cannot reach this process: no reread, no rearm.
  value = '10';
  await f.arm();
  assert.deepEqual(f.clock.delays, [2 * MINUTE, 2 * MINUTE]);
  assert.equal(f.reads.count, 1, 'the interval is stable for the whole runtime');
  await f.tick(2 * MINUTE);
  assert.equal(f.reminderCount(), 1);
  const stale = f.clock.callbacks.at(-1);
  // Restarting the runtime is the supported way to adopt a new value.
  await f.c.close();
  assert.equal(f.clock.pending.size, 0, 'close disposes the previous runtime timer');
  stale(); await settle();
  assert.equal(f.reminderCount(), 1, 'a stale callback from the old runtime cannot deliver');
  value = '1';
  await f.c.start();
  assert.equal(f.reads.count, 2, 'a fresh runtime reads the environment again');
  assert.deepEqual(f.clock.delays, [2 * MINUTE, 2 * MINUTE, 2 * MINUTE], 'the old timer is not restored or rearmed');
  await f.arm();
  assert.deepEqual(f.clock.delays.at(-1), 1 * MINUTE, 'the new runtime uses the new interval');
  await f.tick(1 * MINUTE);
  assert.equal(f.reminderCount(), 2);
});

test('the production path reads the inherited process environment once per runtime', async t => {
  const inherited = process.env[REMINDER_MINUTES_ENV];
  const f = await harness(t, PRODUCTION_ENV); // No injected seam: this is the production default reader.
  try {
    process.env[REMINDER_MINUTES_ENV] = '1';
    await f.start();
    await f.arm();
    assert.deepEqual(f.clock.delays, [1 * MINUTE], 'an inherited variable reaches scheduling');
    await f.tick(1 * MINUTE);
    assert.equal(f.reminderCount(), 1);
    delete process.env[REMINDER_MINUTES_ENV];
    await f.c.close();
    await f.c.start();
    await f.arm();
    assert.deepEqual(f.clock.delays.at(-1), DEFAULT_REMINDER_INTERVAL_MS, 'a fresh runtime without the variable returns to the default');
    await f.tick(DEFAULT_REMINDER_INTERVAL_MS);
    assert.equal(f.reminderCount(), 2);
  } finally {
    if (inherited === undefined) delete process.env[REMINDER_MINUTES_ENV];
    else process.env[REMINDER_MINUTES_ENV] = inherited;
  }
});

test('an invalid operator value cannot block worker operations', async t => {
  const f = await harness(t, () => '-5 minutes');
  await f.start();
  await f.arm();
  assert.deepEqual(f.clock.delays, [DEFAULT_REMINDER_INTERVAL_MS]);
  await f.c.tool('reload_worker', { to: 'Worker' });
  await f.c.tool('request_status', { to: 'Worker' });
  const listed = await f.c.tool('list', {});
  assert.deepEqual(listed.agents.map(agent => agent.name).sort(), ['Coordinator', 'Worker']);
  await assert.rejects(f.w.tool('stop_reminders', {}), /coordinator permission/);
  await f.w.tool('send', { to: 'Coordinator', message: 'worker finding' });
  await f.w.tool('report_work', { status: 'blocked', summary: 'Need input' });
  assert.equal(f.reminderCount(), 0, 'worker traffic does not arm or accelerate the coordinator timer');
});
