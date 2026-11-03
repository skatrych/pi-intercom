import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_REMINDER_INTERVAL_MS, DEFAULT_REMINDER_MINUTES, MAX_REMINDER_MINUTES, MIN_REMINDER_MINUTES,
  REMINDER_MINUTES_ENV, REMINDER_STOP_REASON, REMINDER_TEXT, reminderIntervalMs,
} from '../dist/reminders.js';

const MINUTE = 60 * 1000;

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

/**
 * The legacy steering-era text stays pinned byte-for-byte: unset configurations keep it exactly, and
 * the generic loader (tests/reminder-content*.test.mjs) replaces it only through a valid selection.
 * Note: the built-in text's stop guidance is superseded by the truthful non-stopping tool below; the
 * text is transitional until the Swactory six-question payload is configured.
 */
test('the built-in reminder text is unchanged, interval-free and free of operator input', () => {
  assert.deepEqual(REMINDER_TEXT, 'Intercom reminder: Review outstanding delegated work and worker reports. If follow-up is needed, take the next appropriate action. Do not assume workers have finished or stopped.\n\nIf there is genuinely nothing to follow up on, call intercom_stop_reminders. Otherwise, reminders continue at the configured interval; a new worker call resets the timer.\n\nThis reminder does not authorize new work, retries, worker closure, or publication.');
  assert.doesNotMatch(REMINDER_TEXT, /five minutes|\b\d+ minutes?\b/i);
  assert.doesNotMatch(REMINDER_TEXT, new RegExp(REMINDER_MINUTES_ENV));
});

test('the stop tool is truthful and non-stopping, and no tool description promises a fixed interval', async () => {
  assert.equal(REMINDER_STOP_REASON, 'idle_wakeups_are_automatic');
  const tools = new Map();
  const channels = new Map();
  const bus = { on: (channel, handler) => { const set = (channels.get(channel) ?? new Set()); set.add(handler); channels.set(channel, set); return () => { set.delete(handler); if (!set.size) channels.delete(channel); }; }, emit: (channel, data) => { for (const handler of [...(channels.get(channel) ?? [])]) handler(data); } };
  const extension = (await import('../dist/index.js')).default;
  extension({ registerTool: tool => tools.set(tool.name, tool), on: () => {}, events: bus, registerFlag: () => {}, getFlag: () => undefined, sendMessage: () => {}, sendUserMessage: () => {} });
  assert.ok(tools.has('intercom_stop_reminders'));
  for (const [name, tool] of tools) {
    assert.doesNotMatch(tool.description, /five[- ]minutes?|\bevery \d+ minutes?\b/i, name);
    assert.doesNotMatch(tool.description, new RegExp(REMINDER_MINUTES_ENV), name);
  }
  const description = tools.get('intercom_stop_reminders').description;
  assert.match(description, /not stoppable/);
  assert.doesNotMatch(description, /next worker-directed call|until the next/);
});
