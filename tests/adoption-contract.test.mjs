import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFile, rename, mkdir, symlink, readFile } from 'node:fs/promises';
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
