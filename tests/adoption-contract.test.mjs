import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { appendFile, writeFile, rename, mkdir, symlink, readFile, lstat } from 'node:fs/promises';
import { fixture, barrier } from './fixtures/adoption-support.mjs';
import { bootClaimEvidence, renderClaim, parseClaim } from '../dist/adoption.js';
import { ConfigStore } from '../dist/config.js';

for (const damage of ['dirty-valid', 'newest-malformed', 'deleted-latest', 'uncommitted-active', 'wrong-pair']) {
  test(`claim gate fails closed: ${damage}`, async t => {
    const f = await fixture({ self: true }); t.after(f.dispose);
    const record = await f.declaration();
    await f.claim.writeAndCommit(record);
    if (damage === 'dirty-valid') await f.claim.write(renderClaim({ ...record, date: '2026-10-17' }));
    if (damage === 'newest-malformed') { await f.claim.write('# broken newest evidence\n'); await f.claim.commit(); await f.claim.write(renderClaim(record)); }
    if (damage === 'deleted-latest') { await f.gitOk(['rm', 'coordinator-claim.md']); await f.gitOk(['commit', '-qm', 'fixture deletion']); await f.claim.write(renderClaim(record)); }
    if (damage === 'uncommitted-active') { await f.gitOk(['rm', 'coordinator-claim.md']); await f.gitOk(['commit', '-qm', 'fixture deletion']); await f.claim.write(renderClaim({ ...record, date: '2026-10-17' })); }
    if (damage === 'wrong-pair') { const config = await f.board.parsed(); config.agents[0].port++; await f.board.write(JSON.stringify(config)); }
    const pair = (await f.board.parsed()).agents[0];
    const evidence = await bootClaimEvidence({ home: f.home, identity: pair });
    assert.equal(evidence.ready, false);
    const before = await f.board.read(), claim = await f.claim.read();
    const result = await f.workflow().run(f.context, 'adopt');
    assert.equal(result.ok, false, result.lines.join('\n'));
    assert.equal(f.state.ready, false);
    assert.equal(await f.board.read(), before); assert.equal(await f.claim.read(), claim);
  });
}

test('active same-command promotion retry reopens readiness without record/config publication', async t => {
  const f = await fixture(); t.after(f.dispose);
  let fails = true, writes = 0;
  const workflow = f.workflow({ promote: async () => { if (fails) throw Error('fixture promotion blocked'); f.state.loaded = true; },
    storeFor: root => new ConfigStore(root, { rename: async (from, to) => { writes++; await rename(from, to); } }) });
  assert.equal((await workflow.run(f.context, 'adopt')).code, 'PROMOTION_PENDING');
  assert.equal(f.state.ready, false); assert.equal(writes, 1);
  const head = await f.claim.head(), raw = await f.board.read(); fails = false;
  assert.equal((await workflow.run(f.context, 'adopt')).code, 'CLAIM_OK');
  assert.equal(f.state.ready, true); assert.equal(writes, 1);
  assert.equal(await f.claim.head(), head); assert.equal(await f.board.read(), raw);
});

for (const repeat of [false, true]) test(`failed active commit exact dirty recovery, repeat failure=${repeat}`, async t => {
  const f = await fixture(); t.after(f.dispose); let swaps = 0;
  await writeFile(path.join(f.home, '.git/hooks/pre-commit'), '#!/bin/sh\nif grep -q \'"phase": "active"\' coordinator-claim.md; then exit 1; fi\n', { mode: 0o755 });
  const workflow = f.workflow({ storeFor: root => new ConfigStore(root, { rename: async (from, to) => { swaps++; await rename(from, to); } }) });
  assert.equal((await workflow.run(f.context, 'adopt')).code, 'GIT');
  assert.equal(f.state.ready, false); assert.equal(swaps, 1);
  const intentCommit = (await f.claim.log())[0];
  const intent = parseClaim(await f.claim.at(intentCommit));
  assert.equal(intent.phase, 'prepared');
  assert.equal(await f.claim.read(), renderClaim({ ...intent, phase: 'active', intentCommit }));
  assert.equal((await f.gitOk(['diff', '--cached', '--name-only'])).trim(), '');
  if (repeat) { assert.equal((await workflow.run(f.context, 'adopt')).code, 'GIT'); assert.equal(f.state.ready, false); assert.equal(swaps, 1); }
  await f.hooks.allow();
  assert.equal((await workflow.run(f.context, 'adopt')).code, 'RECOVERED');
  assert.equal(swaps, 1); assert.equal(f.state.ready, true);
  assert.equal((await workflow.run(f.context, 'adopt')).code, 'CLAIM_OK');
  assert.equal(swaps, 1);
});

test('ancestor path replacement during UI invalidates preview before intent', async t => {
  const f = await fixture(); t.after(f.dispose);
  f.context.cwd = path.join(f.home, 'app');
  await f.session.persist(f.id, f.sessions, f.context.cwd);
  const confirm = f.context.ui.confirm;
  let changed = false;
  f.context.ui = { ...f.context.ui, confirm: async options => {
    const result = await confirm(options);
    if (changed) return result;
    changed = true;
    await rename(path.join(f.home, 'app'), path.join(f.home, 'app-original'));
    await mkdir(path.join(f.home, 'app'));
    return result;
  } };
  const before = await f.board.read();
  assert.equal((await f.workflow().run(f.context, 'adopt')).code, 'STALE_PREVIEW');
  assert.equal(await f.board.read(), before); assert.equal((await f.claim.log()).length, 0);
});

test('record symlink is refused without touching its target', async t => {
  const f = await fixture(); t.after(f.dispose);
  const target = path.join(f.home, '.pi/foreign'); await writeFile(target, 'foreign');
  await symlink(target, f.claimPath());
  assert.equal((await f.workflow().run(f.context, 'adopt')).ok, false);
  assert.equal(await readFile(target, 'utf8'), 'foreign');
});

test('nested transaction on another board still acquires that board mutex', async t => {
  const a = await fixture(), b = await fixture(); t.after(a.dispose); t.after(b.dispose);
  await mkdir(path.join(b.home, '.pi-intercom/config.lock'));
  await assert.rejects(new ConfigStore(a.home).transaction(() => new ConfigStore(b.home).update('gone-coordinator', c => { c.multiplexer = 'none'; })), /lock is held/);
  assert.equal((await b.board.parsed()).multiplexer, 'herdr');
});

test('old-authority update already queued on the local store cannot publish after adoption', async t => {
  const f = await fixture(); t.after(f.dispose);
  const gate = barrier(), store = new ConfigStore(f.home);
  const workflow = f.workflow({ storeFor: () => store, phase: async phase => { if (phase === 'prepared-committed') await gate.wait(); } });
  const adoption = workflow.run(f.context, 'adopt'); await gate.reached;
  let mutated = false;
  const old = store.update('gone-coordinator', () => { mutated = true; });
  const refused = assert.rejects(old, /coordinator permission required/);
  gate.release(); assert.equal((await adoption).ok, true); await refused;
  assert.equal(mutated, false); assert.equal((await f.board.parsed()).multiplexer, 'herdr');
});

test('outer queue precedes local filesystem acquisition, which precedes mutation', async t => {
  const f = await fixture(); t.after(f.dispose); const gate = barrier(), order = [];
  class QueuedStore extends ConfigStore {
    async outerQueue(run) { await gate.wait(); order.push('outer'); return run(); }
  }
  const store = new QueuedStore(f.home);
  const pending = store.update('gone-coordinator', async config => {
    assert.equal((await lstat(store.lockDirectory)).isDirectory(), true);
    order.push('mutate'); config.multiplexer = 'none';
  });
  await gate.reached; await assert.rejects(lstat(store.lockDirectory), { code: 'ENOENT' });
  gate.release(); await pending; assert.deepEqual(order, ['outer', 'mutate']);
});

test('supported repeated invocation binds confirmation to UUID/hash and timestamps after wording', async t => {
  const f = await fixture(); t.after(f.dispose);
  const transitionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', before = await f.board.read();
  let time = '2026-10-16T00:00:00.000Z';
  const input = f.context.ui.input;
  f.context.ui = { ...f.context.ui, input: async options => {
    const value = await input(options);
    if (options.kind === 'endedWording') time = '2026-10-16T01:00:00.000Z';
    return value;
  } };
  const workflow = f.workflow({ uuid: () => transitionId, now: () => new Date(time) });
  assert.equal((await workflow.run(f.context, 'adopt')).ok, true);
  const record = parseClaim(await f.claim.read());
  const preview = f.ui.prompts.find(prompt => prompt.kind === 'adoptTransition').prompt;
  assert.ok(preview.includes(transitionId)); assert.ok(preview.includes(f.sha256(before)));
  assert.equal(record.transitionId, transitionId); assert.equal(record.authority.confirmedEndedAt, time);
  const head = await f.claim.head(), active = await f.board.read();
  assert.equal((await workflow.run(f.context, 'adopt')).code, 'CLAIM_OK');
  assert.equal(await f.claim.head(), head); assert.equal(await f.board.read(), active);
  assert.equal(f.ui.prompts.filter(prompt => prompt.kind === 'adoptTransition').length, 1);
});

test('concurrent historical log append is retained while adoption preserves all seeded evidence bytes', async t => {
  const f = await fixture(); t.after(f.dispose);
  const historical = await f.seeded(), before = await historical.snapshot();
  const name = Object.keys(before.logs)[0], appended = '{"version":1,"event":"fixture.concurrent-worker-append"}\n';
  const result = await f.workflow({ phase: async phase => { if (phase === 'prepared-committed') await appendFile(path.join(historical.logDirectory, name), appended); } }).run(f.context, 'adopt');
  assert.equal(result.ok, true, result.lines.join('\n'));
  assert.deepEqual(await historical.snapshot(), { ...before, logs: { ...before.logs, [name]: before.logs[name] + appended } });
});
