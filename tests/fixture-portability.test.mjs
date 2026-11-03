import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { barrier } from './fixtures/adoption-support.mjs';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
// A nested `node --test` must be a standalone runner, not inherit the parent's
// test-child IPC mode (which bypasses normal CLI reporter/exit behavior).
const childEnv = { ...process.env };
delete childEnv.NODE_TEST_CONTEXT;
const childOptions = { cwd: root, env: childEnv, timeout: 90_000, maxBuffer: 2 * 1024 * 1024 };
const windowsSkips = [
  ['present-but-invalid selection (symlink to valid text) suppresses every reminder send with one sanitized diagnostic', 'symlink creation is privilege-dependent on Windows'],
  ['a special device selection is refused before any open by the runtime', 'Linux device fixture'],
  ['a FIFO selection is refused without blocking the runtime start', 'POSIX-only'],
];

function assertChildResults(stdout, platform) {
  assert.match(stdout, /^# fail 0\r?$/m);
  assert.match(stdout, /^# cancelled 0\r?$/m);
  const expected = platform === 'win32' ? windowsSkips : [];
  const actual = [...stdout.matchAll(/^ok \d+ - (.+) # SKIP(?: ([^\r\n]*))?\r?$/gm)].map(match => [match[1], match[2] ?? '']);
  // Account for exact existing platform cases, not a blanket allowance for N skips.
  assert.deepEqual(actual, expected, 'only the named platform skips and their reasons are allowed');
  assert.match(stdout, new RegExp(`^# skipped ${expected.length}\\r?$`, 'm'));
}

test('canonical fixture homes support aliased temporary directories through actual wake-up adapters', { timeout: 100_000 }, async t => {
  const scratch = await realpath(await mkdtemp(path.join(tmpdir(), 'intercom-fixture-path-')));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const physical = path.join(scratch, 'physical'), alias = path.join(scratch, 'alias');
  await mkdir(physical);
  // A junction needs no Windows symlink privilege. On Unix a directory symlink
  // reproduces the same noncanonical tmpdir contract, not a Windows-host claim.
  await symlink(physical, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.notEqual(alias, await realpath(alias));
  const { stdout } = await execute(process.execPath, [
    '--test', '--test-reporter=tap', '--import', './tests/support/scrub-process-env.mjs',
    'tests/adoption-contract.test.mjs', 'tests/reminders.test.mjs',
    'tests/reminder-content-runtime.test.mjs', 'tests/wakeup-extension.test.mjs',
    'tests/wakeup-native-dispatcher.test.mjs',
  ], { ...childOptions, env: { ...childEnv, TMPDIR: alias, TEMP: alias, TMP: alias } });
  assertChildResults(stdout, process.platform);
  t.diagnostic(`Aliased-temp child: 0 failed, 0 cancelled, ${process.platform === 'win32' ? windowsSkips.length : 0} explicitly accounted platform skips`);
});

test('portable child accounting rejects missing, unexpected or changed skips and nonzero failures/cancellations', () => {
  const output = (skips, { failed = 0, cancelled = 0, count = skips.length } = {}) => [
    ...skips.map(([name, reason], index) => `ok ${index + 1} - ${name} # SKIP ${reason}`),
    `# fail ${failed}`, `# cancelled ${cancelled}`, `# skipped ${count}`, '',
  ].join('\n');
  assertChildResults(output([]), 'linux');
  assertChildResults(output(windowsSkips), 'win32');
  assertChildResults(output(windowsSkips).replaceAll('\n', '\r\n'), 'win32');
  const unexpected = ['newly skipped wake-up coverage', 'unexpected'];
  for (const skips of [
    [unexpected, ...windowsSkips.slice(1)], // same count cannot hide a replacement
    windowsSkips.slice(1),
    [...windowsSkips, unexpected],
    [[windowsSkips[0][0], 'changed reason'], ...windowsSkips.slice(1)],
    [[windowsSkips[0][0], ''], ...windowsSkips.slice(1)],
  ]) assert.throws(() => assertChildResults(output(skips), 'win32'), /only the named platform skips/);
  assert.throws(() => assertChildResults(output([unexpected]), 'linux'), /only the named platform skips/);
  assert.throws(() => assertChildResults(output(windowsSkips, { count: 0 }), 'win32'));
  assert.throws(() => assertChildResults(output(windowsSkips, { failed: 1 }), 'win32'));
  assert.throws(() => assertChildResults(output(windowsSkips, { cancelled: 1 }), 'win32'));
});

test('early canonical-path refusal reports the missed barrier and naturally closes its child', { timeout: 20_000 }, async () => {
  await assert.rejects(execute(process.execPath, [
    '--test', '--test-reporter=tap', '--import', './tests/support/scrub-process-env.mjs',
    'tests/fixtures/adoption-missed-barrier.mjs',
  ], { ...childOptions, timeout: 18_000 }), error => {
    assert.equal(error.killed, false, 'the child must exit on its own, not via timeout/force-exit');
    assert.equal(error.signal, null);
    assert.equal(error.code, 1, 'one intentional test failure, not a terminated process');
    assert.match(error.stdout, /workflow completed before barrier: BOARD_PATH/);
    assert.match(error.stdout, /# fail 1\b/);
    assert.match(error.stdout, /# cancelled 0\b/);
    return true;
  });
});

test('a barrier bounds an unresolved phase and preserves rejection/success evidence', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const missing = barrier();
  const expired = assert.rejects(missing.until(new Promise(() => {})), /workflow barrier not reached within bound/);
  t.mock.timers.tick(5000);
  await expired;
  await assert.rejects(barrier().until(Promise.reject(new Error('workflow rejected'))), /workflow rejected/);
  const reached = barrier(), waiting = reached.wait();
  await reached.until(waiting);
  reached.release(); await waiting;
});
