// ADR 0025 P1 evidence: the lock is a real kernel lock on a permanent regular file, released by
// process death without deleting anything, not inherited by children, and never replaced by a weaker
// fallback. Contention and crash release are proved with separate OS processes, not mocked locks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import path from 'node:path';
import { lstat, readdir, readFile, rm } from 'node:fs/promises';
import { createFixture, configText, IDS } from './fixtures/adoption-fixture.mjs';
import { ConfigStore } from '../dist/config.js';
import { acquireConfigLock, ConfigLockContention, ConfigLockUnavailable, LegacyConfigLock, nativeLockProvider } from '../dist/native-lock.js';
import { mkdir } from 'node:fs/promises';

const holder = fileURLToPathSafe();
function fileURLToPathSafe() { return path.resolve('tests/fixtures/lock-holder.mjs'); }

async function board(t, style = 'single') {
  const f = await createFixture();
  t.after(() => f.dispose());
  await f.board.write(configText(style, f.ports()));
  return f;
}
function child(home, mode) {
  const proc = fork(holder, [mode, home], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'], env: { ...process.env } });
  const ready = new Promise((resolve, reject) => {
    proc.once('message', resolve);
    proc.once('exit', code => reject(new Error(`holder exited before ready (${code})`)));
    proc.once('error', reject);
  });
  return { proc, ready };
}
const stop = proc => new Promise(resolve => { proc.once('exit', resolve); proc.kill('SIGKILL'); });

test('a held kernel lock contends without fabricating an owner; process death releases it', async t => {
  const f = await board(t);
  const { proc, ready } = child(f.home, 'hold');
  const info = await ready;
  t.after(() => proc.kill('SIGKILL'));
  const store = new ConfigStore(f.home);
  await assert.rejects(store.transaction(async () => {}), error => error instanceof ConfigLockContention);
  // The guard is a permanent regular file and the failed contender never removed it.
  assert.equal((await lstat(store.lockFile)).isFile(), true);
  // Kill the holder: the kernel releases the lock; nothing is deleted or rewritten.
  await stop(proc);
  const inode = (await lstat(store.lockFile)).ino;
  await store.transaction(async () => {});
  assert.equal((await lstat(store.lockFile)).ino, inode, 'the same guard inode is reused, never replaced');
  assert.deepEqual(await readdir(path.dirname(store.lockFile)), ['config.json', 'config.lock']);
  void info;
});

test('a long-lived child of the holder does not inherit the lock', async t => {
  const f = await board(t);
  const { proc, ready } = child(f.home, 'hold-and-child');
  const info = await ready;
  t.after(async () => { proc.kill('SIGKILL'); try { process.kill(info.childPid, 'SIGKILL'); } catch { /* already gone */ } });
  await stop(proc);
  const store = new ConfigStore(f.home);
  await store.transaction(async () => {});
  assert.ok(info.childPid > 0);
});

test('a crash inside a held transaction leaves the old complete config and re-acquires without cleanup', async t => {
  const f = await board(t);
  const before = await f.board.read();
  const { proc, ready } = child(f.home, 'crash-in-transaction');
  await ready;
  await stop(proc);
  const store = new ConfigStore(f.home);
  assert.equal(await readFile(store.file, 'utf8'), before);
  await store.transaction(async () => {});
  assert.equal((await lstat(store.lockFile)).isFile(), true);
});

test('a crash after the synced temp but before publication leaves the old config intact', async t => {
  const f = await board(t);
  const before = await f.board.read();
  const { proc, ready } = child(f.home, 'crash-after-temp');
  await ready;
  await stop(proc);
  const store = new ConfigStore(f.home);
  assert.equal(await readFile(store.file, 'utf8'), before, 'the old complete JSON is still authoritative');
  const leftovers = await readdir(path.dirname(store.file));
  assert.ok(leftovers.some(name => name.endsWith('.tmp')), 'the crashed call owned its temp; a human/later maintenance may remove it');
  await store.transaction(async () => {});
  assert.equal((await lstat(store.lockFile)).isFile(), true);
});

test('a crash after publication leaves the new complete config and a reusable guard', async t => {
  const f = await board(t);
  const { proc, ready } = child(f.home, 'publish');
  await ready;
  await stop(proc);
  const store = new ConfigStore(f.home);
  assert.equal((await store.read()).multiplexer, 'none', 'the published bytes are complete and readable');
  await store.transaction(async () => {});
});

test('nesting reuses the held handle; the guard is never unlinked by release', async t => {
  const f = await board(t);
  const store = new ConfigStore(f.home);
  const caller = { sessionId: IDS.gone, port: f.ports().coordinator };
  await store.transaction(async () => {
    const inode = (await lstat(store.lockFile)).ino;
    await store.update(caller, config => { config.multiplexer = 'none'; });
    assert.equal((await lstat(store.lockFile)).ino, inode, 'a nested write takes no second lock and no second file');
  });
  assert.equal((await store.read()).multiplexer, 'none');
});

test('an unavailable provider fails closed with no weaker fallback and no config write', async t => {
  const f = await board(t);
  const before = await f.board.read();
  const store = new ConfigStore(f.home, { lockProvider: async () => { throw new ConfigLockUnavailable('injected binding failure'); } });
  await assert.rejects(store.update({ sessionId: IDS.gone, port: f.ports().coordinator }, config => { config.multiplexer = 'none'; }), error => error instanceof ConfigLockUnavailable);
  assert.equal(await f.board.read(), before);
});

test('replacing the guard file during a transaction refuses publication', async t => {
  const f = await board(t);
  const before = await f.board.read();
  class ReplacingStore extends ConfigStore {
    async openTemporary(file) {
      const handle = await super.openTemporary(file);
      return {
        writeFile: data => handle.writeFile(data), sync: () => handle.sync(),
        close: async () => {
          await handle.close();
          // Replace the guard with a different inode: the held handle no longer matches the path.
          await rm(this.lockFile, { force: true });
          await (await import('node:fs/promises')).writeFile(this.lockFile, '');
        },
      };
    }
  }
  const store = new ReplacingStore(f.home);
  await assert.rejects(store.update({ sessionId: IDS.gone, port: f.ports().coordinator }, config => { config.multiplexer = 'none'; }), error => error instanceof ConfigLockUnavailable);
  assert.equal(await f.board.read(), before);
});

test('a legacy directory lock is refused untouched; no conversion or stealing', async t => {
  const f = await board(t);
  await mkdir(path.join(f.home, '.pi-intercom/config.lock'));
  const guard = path.join(f.home, '.pi-intercom/config.lock');
  await assert.rejects(acquireConfigLock(guard), error => error instanceof LegacyConfigLock);
  assert.equal((await lstat(guard)).isDirectory(), true);
});

test('the provider exposes the exact synchronous surface the adapter uses', async () => {
  const provider = await nativeLockProvider();
  assert.equal(typeof provider.tryLock, 'function');
  assert.equal(typeof provider.unlock, 'function');
});
