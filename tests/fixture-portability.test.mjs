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
  assert.match(stdout, /# fail 0\b/);
  assert.match(stdout, /# cancelled 0\b/);
  assert.match(stdout, /# skipped 0\b/);
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
