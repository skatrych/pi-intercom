import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { appendFile, writeFile, rename, mkdir, symlink, readFile, lstat } from 'node:fs/promises';
import { fixture, standalone, declineUI } from './fixtures/adoption-support.mjs';
import { createFixture, configText, mockUi, IDS } from './fixtures/adoption-fixture.mjs';
import { ConfigStore, ConfigPreviewChanged } from '../dist/config.js';
import { ConfigLockContention, LegacyConfigLock } from '../dist/native-lock.js';

const barrier = () => {
  let release, arrived;
  const reached = new Promise(resolve => { arrived = resolve; });
  const resume = new Promise(resolve => { release = resolve; });
  return { reached, release, wait: async () => { arrived(); await resume; } };
};

for (const damage of ['absent', 'dirty-valid', 'malformed', 'stale', 'symlink']) test(`legacy claim state has zero influence: ${damage}`, async t => {
  const f = await fixture();
  t.after(() => f.dispose());
  const claim = path.join(f.home, 'coordinator-claim.md');
  if (damage === 'dirty-valid') await writeFile(claim, '# a previous claim, rewritten and uncommitted\n');
  if (damage === 'malformed') await writeFile(claim, '{ this is not a claim record\n');
  if (damage === 'stale') await mkdir(path.join(f.home, '.git'), { recursive: true });
  if (damage === 'symlink') {
    const target = path.join(f.home, 'foreign-target');
    await writeFile(target, 'foreign bytes\n');
    try { await symlink(target, claim); }
    catch (error) {
      if (process.platform === 'win32' && error.code === 'EPERM') { t.skip('file symlinks require Windows privilege; the other claim variants cover irrelevance'); return; }
      throw error;
    }
  }
  const beforeClaim = await readFile(claim, 'utf8').catch(() => undefined);
  const result = await f.adopt();
  assert.equal(result.code, 'OK', result.lines.join('\n'));
  assert.equal((await f.boardConfig()).agents.find(agent => agent.coordinator).sessionId, IDS.fresh);
  if (beforeClaim !== undefined) assert.equal(await readFile(claim, 'utf8'), beforeClaim, 'the claim is never read, followed or rewritten');
});

test('published replacement with failed local promotion retries load-only, with no new write or question', async t => {
  let home, prompts = 0;
  const ui = mockUi({ adoptCoordinator: 'confirm', onAsk: async () => { prompts++; } });
  const f = await fixture({ ui });
  t.after(() => f.dispose());
  home = f.home;
  // A standalone workflow can force the promotion failure deterministically.
  const first = standalone(f, { port: 42231, promote: async () => 'injected local load failure', ui });
  const result = await first.workflow.run(first.context, 'adopt');
  assert.equal(result.code, 'PROMOTION_PENDING', result.lines.join('\n'));
  assert.match(result.lines.join(' '), /config replaced/);
  const published = await f.board.read();
  const retry = standalone(f, { port: 42231, loaded: false, ui: declineUI() });
  const loaded = await retry.workflow.run(retry.context, 'adopt');
  assert.equal(loaded.code, 'CURRENT');
  assert.equal(retry.ui.prompts.length, 0, 'a matching retry asks nothing');
  assert.equal(await f.board.read(), published, 'a matching retry writes nothing');
  assert.equal(prompts, 1);
  void home;
});

test('ancestor path replacement while the question is open invalidates the preview', async t => {
  let home;
  const ui = mockUi({ adoptCoordinator: 'confirm', onAsk: async () => {
    changed = true;
    await rename(path.join(home, 'app'), path.join(home, 'app-original'));
    await mkdir(path.join(home, 'app'));
  } });
  let changed = false;
  const f = await fixture({ cwdRelative: 'app', ui });
  t.after(() => f.dispose());
  home = f.home;
  const before = await f.board.read();
  const result = await f.adopt();
  assert.equal(result.code, 'STALE_PREVIEW', result.lines.join('\n'));
  assert.equal(changed, true);
  assert.equal(await f.board.read(), before);
});

test('nested transaction on another board still acquires that board lock', async t => {
  const a = await createFixture();
  const b = await createFixture();
  t.after(async () => { await a.dispose(); await b.dispose(); });
  await a.board.write(configText('single', a.ports()));
  await b.board.write(configText('single', b.ports()));
  await mkdir(path.join(b.home, '.pi-intercom/config.lock'));
  const storeB = new ConfigStore(b.home);
  await assert.rejects(
    new ConfigStore(a.home).transaction(() => storeB.update({ sessionId: IDS.gone, port: b.ports().coordinator }, c => { c.multiplexer = 'none'; })),
    error => error instanceof LegacyConfigLock,
  );
  assert.equal((await b.board.parsed()).multiplexer, 'herdr');
});

test('an old coordinator update queued before publication cannot publish after the replacement', async t => {
  const f = await fixture();
  t.after(() => f.dispose());
  const gate = barrier();
  let mutated = false;
  const store = new ConfigStore(f.home);
  const workflow = standalone(f, { port: 42230, phase: async phase => { if (phase === 'before-publish') await gate.wait(); } });
  const adoption = workflow.workflow.run(workflow.context, 'adopt');
  await gate.reached; // The adoption transaction now holds the all-writer lock.
  const old = store.update({ sessionId: IDS.gone, port: f.ports.coordinator }, () => { mutated = true; });
  const refused = assert.rejects(old, /coordinator permission required|does not match the board/);
  gate.release();
  assert.equal((await adoption).code, 'OK');
  await refused;
  assert.equal(mutated, false);
  assert.equal((await f.board.parsed()).multiplexer, 'herdr');
});

test('outer queue precedes native acquisition, which precedes mutation; the guard is a regular file', async t => {
  const f = await createFixture();
  t.after(() => f.dispose());
  await f.board.write(configText('single', f.ports()));
  const gate = barrier(), order = [];
  class QueuedStore extends ConfigStore {
    async outerQueue(run) { await gate.wait(); order.push('outer'); return run(); }
  }
  const store = new QueuedStore(f.home);
  const pending = store.update({ sessionId: IDS.gone, port: f.ports().coordinator }, async config => {
    const guard = await lstat(store.lockFile);
    assert.equal(guard.isFile(), true);
    order.push('mutate');
    config.multiplexer = 'none';
  });
  await gate.reached;
  await assert.rejects(lstat(store.lockFile), { code: 'ENOENT' });
  gate.release();
  await pending;
  assert.deepEqual(order, ['outer', 'mutate']);
});

test('two stores serialize through the process queue and both updates survive', async t => {
  const f = await createFixture();
  t.after(() => f.dispose());
  await f.board.write(configText('single', f.ports()));
  const a = new ConfigStore(f.home), b = new ConfigStore(f.home);
  const gate = barrier();
  const first = a.transaction(async config => {
    // Hold the shared process queue while the second store is queued.
    await gate.wait();
    return config;
  });
  await gate.reached;
  const second = b.transaction(async () => 'second ran');
  gate.release();
  await first;
  assert.equal(await second, 'second ran');
  // The permanent guard is a regular file and was never unlinked by either release.
  assert.equal((await lstat(a.lockFile)).isFile(), true);
});

test('repeated matching invocation is load-only: one question total, no extra write', async t => {
  const f = await fixture();
  t.after(() => f.dispose());
  assert.equal((await f.adopt()).code, 'OK');
  const afterFirst = await f.board.read();
  assert.equal(f.ui.prompts.length, 1);
  assert.equal((await f.adopt()).code, 'CURRENT');
  assert.equal(f.ui.prompts.length, 1, 'no second question');
  assert.equal(await f.board.read(), afterFirst);
});

test('concurrent historical log append survives adoption; reports and claim bytes are untouched', async t => {
  const f = await createFixture();
  t.after(() => f.dispose());
  await f.board.write(configText('full', f.ports()));
  const seeded = await f.seeded();
  const before = await seeded.snapshot();
  const name = Object.keys(before.logs)[0], appended = '{"version":1,"event":"fixture.concurrent-worker-append"}\n';
  let appendedOnce = false;
  const s = standalone(f, { port: 42232, phase: async phase => {
    if (phase === 'before-publish' && !appendedOnce) { appendedOnce = true; await appendFile(path.join(seeded.logDirectory, name), appended); }
  } });
  const result = await s.workflow.run(s.context, 'adopt');
  assert.equal(result.code, 'OK', result.lines.join('\n'));
  assert.deepEqual(await seeded.snapshot(), { ...before, logs: { ...before.logs, [name]: before.logs[name] + appended } });
});

test('an endpoint change at temporary close refuses before the captured pair is published', async t => {
  const f = await createFixture();
  t.after(() => f.dispose());
  await f.board.write(configText('single', f.ports()));
  const before = await f.board.read();
  let endpointPort = f.ports().coordinator + 100;
  class DriftStore extends ConfigStore {
    async openTemporary(file) {
      const handle = await super.openTemporary(file);
      return {
        writeFile: data => handle.writeFile(data), sync: () => handle.sync(),
        // The runtime rebinds its endpoint during the staging awaits, after the last snapshot.
        close: async () => { await handle.close(); endpointPort++; },
      };
    }
  }
  const store = new DriftStore(f.home);
  const s = standalone(f, { portValue: () => endpointPort });
  s.workflow.options.storeFor = () => store;
  const result = await s.workflow.run(s.context, 'adopt');
  assert.equal(result.code, 'IDENTITY', result.lines.join('\n'));
  assert.equal(await f.board.read(), before, 'the board must be byte-for-byte unchanged');
});

test('preview hash binds the answer; a same-semantic reformat still refuses', async t => {
  const f = await createFixture();
  t.after(() => f.dispose());
  await f.board.write(configText('full', f.ports()));
  const preview = await f.board.read();
  const store = new ConfigStore(f.home);
  await f.board.write(preview.replace('"multiplexer": "herdr"', '"multiplexer":   "herdr"'));
  await assert.rejects(store.replaceCoordinatorEntry({
    sessionId: IDS.fresh, port: 42233, previewRawSha256: (await import('../dist/config.js')).sha256(preview),
    assertPreview: () => {}, assertValid: () => {},
  }), error => error instanceof ConfigPreviewChanged);
});

test('duplicate keys and non-roundtrippable values refuse before any write', async t => {
  const f = await createFixture();
  t.after(() => f.dispose());
  for (const text of [
    configText('duplicateKeys', f.ports()),
    configText('duplicateEscaped', f.ports()),
    configText('single', f.ports()).replace('"port": 41001', '"port": 41001, "port": 41001'),
    configText('single', f.ports()).replace('"port": 41001', '"port": 1e999'),
    configText('single', f.ports()).replace('"multiplexer": "herdr"', '"multiplexer": "herdr", "zero": -0'),
  ]) {
    await f.board.write(text);
    const s = standalone(f, { port: 42234 });
    const result = await s.workflow.run(s.context, 'adopt');
    assert.equal(result.code, 'CONFIG', result.lines.join('\n'));
    assert.equal(await f.board.read(), text);
  }
});
