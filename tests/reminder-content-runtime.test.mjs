import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, symlink, unlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { DEFAULT_REMINDER_INTERVAL_MS, REMINDER_TEXT } from '../dist/reminders.js';
import { REMINDER_CONFIGURATION_DIAGNOSTIC, REMINDER_FILE_ENV, nodeReminderFileSystem } from '../dist/reminder-content.js';
import { Intercom } from '../dist/runtime.js';
import { createFixture } from './fixtures/adoption-fixture.mjs';
import { commitFirstDeclaration } from './fixtures/wakeup-fixture.mjs';

const BUILTIN_SHA256 = '9e43de4e65e55169db497e536a8406799947de5507fde3c51f0724b1c7d9aaea';
const INTERVAL = DEFAULT_REMINDER_INTERVAL_MS;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const sha = text => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
const settle = () => new Promise(resolve => setImmediate(resolve));
/** Waits until the runtime has actually reached a point (e.g. an in-flight load), not an arbitrary delay. */
async function until(condition) {
  const deadline = Date.now() + 2000;
  while (!condition()) {
    assert.ok(Date.now() < deadline, 'expected runtime step was not reached');
    await settle();
  }
}
async function settled(reminders) {
  const deadline = Date.now() + 2000;
  while (reminders?.checking) {
    assert.ok(Date.now() < deadline, 'reminder eligibility check did not finish');
    await settle();
  }
  await settle();
}
function recordingClock() {
  let now = 0, next = 0;
  const pending = new Map(), callbacks = [], delays = [];
  return {
    pending, callbacks, delays,
    schedule(callback, delay) {
      delays.push(delay);
      const id = ++next; pending.set(id, { callback, due: now + delay }); callbacks.push(callback);
      return () => pending.delete(id);
    },
    advance(milliseconds) {
      now += milliseconds;
      for (const [id, entry] of [...pending]) if (entry.due <= now) { pending.delete(id); entry.callback(); }
    },
  };
}

/**
 * Real Intercom runtimes on one committed projects-home board. The coordinator is a canonical
 * Orchestrator launch with committed first-declaration evidence, so the wake-up path applies exactly
 * as in production. The reminder selector and file access are injected seams: every environment read
 * and every lstat/open of the selected path is counted, so "once per start" and "never per tick" are
 * observed directly rather than inferred. The worker runtime is a plain session with its own selector
 * seam, proving the built-in fallthrough and that workers never own the wake-up path.
 */
async function harness(t, { selector, productionEnv = false, workerSelector } = {}) {
  const f = await createFixture();
  const clock = recordingClock(), deliveries = [], notices = [], endpoints = new Map();
  let port = 41001, busy = false, hold = null;
  const listens = { count: 0 };
  // The coordinator always rebinds its committed board port (preferred); every other session takes a
  // fresh port, so restarts and replacements keep the committed coordinator identity valid.
  const fakeListen = async (preferred, accept) => {
    listens.count++;
    const p = typeof preferred === 'number' && !endpoints.has(preferred) ? preferred : port++;
    endpoints.set(p, accept);
    return { port: p, close: async () => { endpoints.delete(p); } };
  };
  const transport = {
    listen: fakeListen,
    send: async (p, message) => { const accept = endpoints.get(p); if (!accept) throw new Error('offline'); await accept(message); },
    launch: async () => ({ submitted: true }),
    probe: async () => [],
  };
  const reads = { env: 0, lstat: [], open: [] };
  const files = {
    lstat: async file => { reads.lstat.push(file); if (hold) { const gate = hold; hold = null; await gate; } return nodeReminderFileSystem.lstat(file); },
    open: async (file, flags) => { reads.open.push(file); return nodeReminderFileSystem.open(file, flags); },
  };
  const host = id => ({ cwd: f.home, sessionId: () => id, busy: () => busy,
    deliver: (text, _busy, submission) => deliveries.push({ id, text, submission }),
    setName: async () => {}, notify: text => notices.push({ id, text }) });
  let current = selector;
  const selectorSeam = () => { reads.env++; return current; };
  t.after(async () => { await c.close().catch(() => {}); await w.close().catch(() => {}); await f.dispose(); });
  // The coordinator's first fake endpoint becomes the board port committed into the declaration.
  const c = new Intercom({ ...host('c'), roleDirectory: path.join(f.home, 'roles/orchestrator'), rolesDirectory: path.join(f.home, 'roles'), workerRole: '' }, {
    ...transport, reminderClock: clock, reminderFiles: files,
    adoption: { projectsHome: f.home, rolesDirectory: path.join(f.home, 'roles') },
    ...(productionEnv ? {} : { reminderFileEnv: selectorSeam }),
  });
  const w = new Intercom(host('w'), { ...transport, reminderFileEnv: () => workerSelector });
  await commitFirstDeclaration(f, { sessionId: 'c', port: 41000 });
  const reminders = () => deliveries.filter(d => d.id === 'c' && d.submission !== undefined);
  // Ordinary lifecycle notices share this channel; only the fixed diagnostic counts as a configuration error.
  const diagnostics = () => notices.filter(n => n.text === REMINDER_CONFIGURATION_DIAGNOSTIC);
  const start = async () => { await c.start(); await w.start(); };
  const arm = async () => c.tool('configure_worker', { sessionId: 'w', port: w.endpoint.port, projectDirectory: '.', name: 'Worker', description: 'Assigned scope' });
  const tick = async (milliseconds = INTERVAL) => {
    clock.advance(milliseconds);
    await settled(c.reminders);
    if (c.reminders && reminders().length > tick.correlated) {
      tick.correlated = reminders().length;
      c.reminders.attemptResolved(); c.reminders.activitySettled();
      await settle();
    }
  };
  tick.correlated = 0;
  return {
    f, c, w, clock, deliveries, notices, diagnostics, reads, reminders, listens, start, arm, tick,
    setSelector: value => { current = value; },
    holdNextLstat: () => { let release; hold = new Promise(resolve => { release = resolve; }); return release; },
    setBusy: value => { busy = value; },
  };
}

const writeFileAt = (dir, name, bytes) => writeFile(path.join(dir, name), bytes).then(() => path.join(dir, name));

test('unset selector: zero file touches, the exact built-in text and its pinned metadata on every arrival', async t => {
  const f = await harness(t, { selector: undefined });
  await f.start();
  assert.equal(f.reads.env, 1, 'the selector is read once per runtime start');
  assert.deepEqual(f.reads.lstat, []);
  assert.deepEqual(f.reads.open, []);
  await f.tick(); await f.tick();
  const delivered = f.reminders();
  assert.equal(delivered.length, 2);
  for (const d of delivered) {
    assert.equal(d.text, REMINDER_TEXT);
    assert.equal(d.submission.source, 'builtin');
    assert.equal(d.submission.sha256, BUILTIN_SHA256);
    assert.match(d.submission.attemptId, UUID);
  }
  assert.notEqual(delivered[0].submission.attemptId, delivered[1].submission.attemptId, 'each arrival has its own attempt id');
  assert.deepEqual(f.reads.lstat, []);
  assert.equal(f.diagnostics().length, 0, 'the default path emits no reminder diagnostic');
});

test('a valid file is read exactly once per runtime start and never on a tick, arm or tool call', async t => {
  const f = await harness(t, { selector: undefined });
  const file = await writeFileAt(f.f.home, 'reminder.txt', '  Arbitrary generic text.\nSecond line.  \n');
  f.setSelector(file);
  await f.start();
  assert.equal(f.reads.env, 1);
  assert.deepEqual(f.reads.lstat, [file], 'one lstat per start');
  assert.deepEqual(f.reads.open, [file], 'one open per start');
  await f.tick(); await f.tick(); await f.tick();
  await f.arm();
  await f.c.tool('reload_worker', { to: 'Worker' });
  assert.equal(f.reminders().length, 3);
  assert.deepEqual(f.reads.lstat, [file]);
  assert.deepEqual(f.reads.open, [file]);
  assert.equal(f.reads.env, 1, 'no selector reread while the runtime runs');
  for (const d of f.reminders()) {
    assert.equal(d.text, '  Arbitrary generic text.\nSecond line.  \n', 'delivered exactly as the file, once per arrival');
    assert.deepEqual({ source: d.submission.source, sha256: d.submission.sha256 }, { source: 'file', sha256: sha('  Arbitrary generic text.\nSecond line.  \n') });
  }
  assert.doesNotMatch(JSON.stringify(f.reminders()), /reminder\.txt/, 'the path never reaches a delivery');
});

test('a changed, deleted or replaced file mid-runtime leaves the snapshot unchanged and triggers no read', async t => {
  const f = await harness(t, { selector: undefined });
  const file = await writeFileAt(f.f.home, 'reminder.txt', 'version one');
  const other = await writeFileAt(f.f.home, 'elsewhere.txt', 'version two');
  f.setSelector(file);
  await f.start();
  await f.tick();
  await writeFile(file, 'version edited in place');
  await f.tick();
  await unlink(file);
  await f.tick();
  await symlink(other, file);
  await f.tick();
  await writeFile(file, 'replacement after link removal'.repeat(3));
  await f.tick();
  assert.deepEqual(f.reminders().map(d => d.text), Array(5).fill('version one'));
  assert.deepEqual(f.reads.lstat, [file]);
  assert.deepEqual(f.reads.open, [file]);
});

test('an explicit restart rereads at the same selector and never reuses the previous text', async t => {
  const f = await harness(t, { selector: undefined });
  const file = await writeFileAt(f.f.home, 'reminder.txt', 'first text');
  f.setSelector(file);
  await f.start(); await f.tick();
  const stale = f.clock.callbacks.at(-1);
  await f.c.close();
  assert.equal(f.clock.pending.size, 0, 'close disposes the old timer');
  await writeFile(file, 'second text');
  await f.c.start();
  assert.equal(f.reads.env, 2, 'a fresh runtime reads the selector again');
  assert.deepEqual(f.reads.lstat, [file, file]);
  assert.deepEqual(f.reads.open, [file, file]);
  stale(); await settled(f.c.reminders);
  assert.deepEqual(f.reminders().map(d => d.text), ['first text'], 'a stale callback from the old runtime cannot deliver');
  await f.tick();
  assert.deepEqual(f.reminders().map(d => d.text), ['first text', 'second text']);
  assert.equal(f.reminders()[1].submission.sha256, sha('second text'));
});

test('a corrected selection after a failed start is accepted only by an explicit restart, with no replayed diagnostic', async t => {
  const f = await harness(t, { selector: undefined });
  const file = await writeFileAt(f.f.home, 'reminder.txt', '   ');
  f.setSelector(file);
  await f.start(); await f.tick(); await f.tick();
  assert.equal(f.reminders().length, 0);
  assert.equal(f.notices.filter(n => n.text === REMINDER_CONFIGURATION_DIAGNOSTIC).length, 1);
  await writeFile(file, 'corrected text');
  await f.c.close();
  await f.c.start();
  assert.equal(f.notices.filter(n => n.text === REMINDER_CONFIGURATION_DIAGNOSTIC).length, 1, 'valid restart adds no diagnostic');
  assert.equal(f.clock.pending.size, 1, 'a fresh runtime with valid content starts one fresh schedule');
  await f.tick();
  assert.deepEqual(f.reminders().map(d => d.text), ['corrected text']);
});

test('an async load that completes after shutdown cannot arm reminders or deliver anything', async t => {
  const f = await harness(t, { selector: undefined });
  const file = await writeFileAt(f.f.home, 'reminder.txt', 'late text');
  f.setSelector(file);
  const release = f.holdNextLstat();
  const starting = f.c.start();
  await until(() => f.reads.lstat.length === 1);
  await f.c.close();
  release();
  await assert.rejects(starting, /lifecycle replaced|inactive/);
  assert.equal(f.listens.count, 0, 'a shut-down start never opens its endpoint');
  assert.equal(f.c.reminders, undefined, 'no reminder object exists for the shut-down runtime');
  assert.equal(f.clock.pending.size, 0);
  assert.equal(f.clock.delays.length, 0);
  await assert.rejects(f.c.tool('configure_worker', { sessionId: 'w', port: 1, projectDirectory: '.', name: 'Worker', description: 'x' }));
  assert.equal(f.reminders().length, 0);
});

test('an async load that completes after replacement cannot overwrite the replacement runtime', async t => {
  const f = await harness(t, { selector: undefined });
  const oldFile = await writeFileAt(f.f.home, 'old.txt', 'old text');
  const newFile = await writeFileAt(f.f.home, 'new.txt', 'new text');
  f.setSelector(oldFile);
  const release = f.holdNextLstat();
  await f.w.start();
  const oldStart = f.c.start();
  await until(() => f.reads.lstat.length === 1);
  // The old start is still awaiting its load; a replacement runtime now starts with the new selection.
  await f.c.close();
  f.setSelector(newFile);
  await f.c.start();
  release();
  await assert.rejects(oldStart, /lifecycle replaced|inactive/);
  // Only the replacement opened an endpoint (the worker's start plus the replacement coordinator's start).
  assert.equal(f.listens.count, 2, 'the replaced start never opens an endpoint');
  await f.tick();
  assert.deepEqual(f.reminders().map(d => d.text), ['new text'], 'only the current replacement text is ever delivered');
});

test('a selector change in the process environment never reaches a running runtime; a restart reads the new value', async t => {
  const saved = process.env[REMINDER_FILE_ENV];
  t.after(() => { if (saved === undefined) delete process.env[REMINDER_FILE_ENV]; else process.env[REMINDER_FILE_ENV] = saved; });
  const f = await harness(t, { productionEnv: true });
  const first = await writeFileAt(f.f.home, 'first.txt', 'inherited first');
  const second = await writeFileAt(f.f.home, 'second.txt', 'inherited second');
  process.env[REMINDER_FILE_ENV] = first;
  await f.start(); await f.tick();
  // A child shell cannot change this process: a later export is simply not observed by the running runtime.
  process.env[REMINDER_FILE_ENV] = second;
  await f.tick();
  assert.deepEqual(f.reminders().map(d => d.text), ['inherited first', 'inherited first']);
  assert.deepEqual(f.reads.lstat, [first], 'no reread of the new value while running');
  await f.c.close();
  await f.c.start();
  assert.deepEqual(f.reads.lstat, [first, second], 'a fresh runtime (Pi /reload) reads the current process value');
});

test('an unset inherited environment value keeps the default for a fresh runtime', async t => {
  const saved = process.env[REMINDER_FILE_ENV];
  t.after(() => { if (saved === undefined) delete process.env[REMINDER_FILE_ENV]; else process.env[REMINDER_FILE_ENV] = saved; });
  const f = await harness(t, { productionEnv: true });
  delete process.env[REMINDER_FILE_ENV];
  await f.start(); await f.tick();
  assert.deepEqual(f.reminders().map(d => d.text), [REMINDER_TEXT]);
  assert.deepEqual(f.reads.lstat, []);
});

const INVALID = [
  ['empty selector', { selector: '' }],
  ['whitespace-padded relative selector', { selector: ' reminder.txt' }],
  ['relative selector', { selector: 'reminder.txt' }],
  ['missing absolute file', { selector: '/does/not/exist/reminder.txt' }],
  ['directory', { dir: true }],
  ['oversize file', { bytes: Buffer.alloc(16385, 0x61) }],
  ['invalid UTF-8', { bytes: Buffer.from([0xc3, 0x28]) }],
  ['BOM', { bytes: Buffer.from([0xef, 0xbb, 0xbf, 0x61]) }],
  ['CRLF', { bytes: Buffer.from('a\r\nb') }],
  ['NUL', { bytes: Buffer.from('a\0b') }],
  ['DEL', { bytes: Buffer.from('a\x7fb') }],
  ['whitespace-only', { bytes: Buffer.from(' \n\t ') }],
  ['too many code points', { bytes: Buffer.from('a'.repeat(4001)) }],
  ['symlink to valid text', { link: true }],
];
for (const [label, spec] of INVALID) {
  test(`present-but-invalid selection (${label}) suppresses every reminder send with one sanitized diagnostic`, async t => {
    if (spec.link && process.platform === 'win32') return t.skip('symlink creation is privilege-dependent on Windows');
    const f = await harness(t, { selector: undefined });
    if (spec.selector !== undefined) f.setSelector(spec.selector);
    else if (spec.dir) { const dir = path.join(f.f.home, 'folder'); await mkdir(dir); f.setSelector(dir); }
    else if (spec.link) { const target = await writeFileAt(f.f.home, 'target.txt', 'valid target'); const link = path.join(f.f.home, 'link.txt'); await symlink(target, link); f.setSelector(link); }
    else { const file = await writeFileAt(f.f.home, 'bad.txt', spec.bytes); f.setSelector(file); }
    await f.start();
    assert.deepEqual(f.diagnostics(), [{ id: 'c', text: REMINDER_CONFIGURATION_DIAGNOSTIC }], 'exactly one diagnostic');
    assert.equal(f.reads.env, 1, 'no retry of the selection on any later event');
    assert.equal(f.clock.pending.size, 0, 'no timer is armed when content is invalid');
    await f.tick(); await f.tick(); await f.tick();
    assert.equal(f.reminders().length, 0, 'no reminder text is ever sent');
    assert.equal(f.diagnostics().length, 1, 'no diagnostic is repeated on ticks');
    // The diagnostic is fixed: no path, raw value, contents or error text escapes it.
    assert.equal(f.diagnostics()[0].text.includes(f.f.home), false);
    assert.equal(f.diagnostics()[0].text.includes('aaaa'), false);
    assert.ok(f.reads.lstat.length <= 1, 'at most one lstat per start');
  });
}

test('invalid reminder text leaves ordinary messaging, coordinator reads and reporting functional', async t => {
  const f = await harness(t, { selector: undefined });
  const bad = await writeFileAt(f.f.home, 'bad.txt', '\r\n');
  f.setSelector(bad);
  await f.start();
  await f.arm();
  const listed = await f.c.tool('list', {});
  assert.deepEqual(listed.agents.map(a => a.name).sort(), ['Coordinator', 'Worker'].sort());
  await f.c.tool('reload_worker', { to: 'Worker' });
  await f.w.tool('send', { to: 'Coordinator', message: 'ordinary worker finding' });
  await f.w.tool('report_work', { status: 'blocked', summary: 'Need input' });
  assert.ok(f.deliveries.some(d => d.id === 'c' && d.submission === undefined && d.text.includes('ordinary worker finding')), 'ordinary delivery is unchanged');
  await assert.rejects(f.w.tool('stop_reminders', {}), /coordinator permission/);
  assert.deepEqual(await f.c.tool('stop_reminders', {}), { stopped: false, reason: 'idle_wakeups_are_automatic' });
  assert.equal(f.reminders().length, 0);
});

test('a worker runtime with invalid selected text reports once and keeps worker messaging working', async t => {
  const f = await harness(t, { selector: undefined, workerSelector: 'relative.txt' });
  await f.start();
  assert.deepEqual(f.diagnostics(), [{ id: 'w', text: REMINDER_CONFIGURATION_DIAGNOSTIC }]);
  // The worker is configured and loaded by the coordinator, then speaks normally despite its bad selection.
  await f.arm();
  await f.c.tool('reload_worker', { to: 'Worker' });
  await f.w.tool('send', { to: 'Coordinator', message: 'worker still reachable' });
  assert.ok(f.deliveries.some(d => d.id === 'c' && d.text.includes('worker still reachable')));
});

test('a runtime restart after a valid selection starts one fresh schedule with no replay or storm', async t => {
  const f = await harness(t, { selector: undefined });
  const file = await writeFileAt(f.f.home, 'reminder.txt', 'steady text');
  f.setSelector(file);
  await f.start(); await f.tick(); await f.tick(); await f.tick();
  assert.equal(f.reminders().length, 3);
  await f.c.close(); await f.c.start();
  assert.equal(f.reminders().length, 3, 'a restart does not replay transcript or expired deadlines');
  assert.equal(f.clock.pending.size, 1, 'one fresh schedule starts on the new runtime');
  await f.tick();
  assert.equal(f.reminders().length, 4);
});

test('the interval and the content selector are independent snapshots taken at the same start', async t => {
  const f = await harness(t, { selector: undefined });
  const file = await writeFileAt(f.f.home, 'reminder.txt', 'interval neutral text');
  f.setSelector(file);
  await f.start();
  assert.deepEqual(f.clock.delays, [INTERVAL], 'selecting text never changes the default interval');
  assert.equal(f.reminders().length, 0);
});

test('a special device selection is refused before any open by the runtime', { skip: process.platform !== 'linux' && 'Linux device fixture' }, async t => {
  const f = await harness(t, { selector: undefined });
  f.setSelector('/dev/null');
  await f.start();
  assert.deepEqual(f.reads.open, [], 'the device is refused from lstat, before any open');
  assert.equal(f.diagnostics().length, 1);
  await f.tick();
  assert.equal(f.reminders().length, 0);
});

test('a FIFO selection is refused without blocking the runtime start', { skip: process.platform === 'win32' && 'POSIX-only', timeout: 15000 }, async t => {
  const f = await harness(t, { selector: undefined });
  const fifo = path.join(f.f.home, 'pipe');
  if (spawnSync('mkfifo', [fifo]).status !== 0) return t.skip('mkfifo unavailable');
  f.setSelector(fifo);
  await f.start();
  assert.deepEqual(f.reads.open, [], 'no open of a FIFO');
  assert.equal(f.diagnostics().length, 1);
  assert.equal(f.reminders().length, 0);
});
