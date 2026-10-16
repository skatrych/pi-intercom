// Independent-review B1/B2/B3 negatives: real product publishers/HTTP, disposable fixture boards only.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { unlink, readdir, readFile, rename } from 'node:fs/promises';
import { fixture } from './fixtures/adoption-support.mjs';
import { IDS } from './fixtures/adoption-fixture.mjs';
import { ConfigStore } from '../dist/config.js';
import { Intercom } from '../dist/runtime.js';
import { HandoffWorkflow } from '../dist/handoff.js';
import { parseClaim } from '../dist/adoption.js';
import { saveWorkerReport, readWorkerReports } from '../dist/reports.js';

for (const phase of ['prepared', 'active']) test(`B1 missing worktree with committed ${phase} fences ordinary/status/handoff BEFORE mutate`, async t => {
  const f = await fixture(); let runtime;
  t.after(async () => { await runtime?.close(); await f.dispose(); });
  let entered = 0;
  class TrackedStore extends ConfigStore {
    update(id, mutate, guard) { return super.update(id, c => { entered++; return mutate(c); }, guard); }
  }
  const store = new TrackedStore(f.home), pair = (await store.read()).agents[0];
  // Legacy current coordinator starts before intent, then actual receive-status shares this store.
  runtime = new Intercom({ cwd: f.home, sessionId: () => IDS.gone, roleDirectory: path.join(f.home, 'roles/developer'), workerRole: '', busy: () => false,
    deliver: () => assert.fail('no model turn'), notify() {}, setName: async () => {} },
  { store: () => store, launch: async () => assert.fail('no launch'), listen: async () => ({ port: pair.port, close: async () => {} }), observe: () => ({ record() {}, close() {}, maintain() {} }) });
  await runtime.start();
  await store.update(IDS.gone, c => { c.agents.at(-1).closeJob.state = 'awaiting_handoff'; });
  if (phase === 'prepared') {
    await f.workflow({ phase: async p => { if (p === 'prepared-committed') throw Error('review fixture interruption'); } }).run(f.context, 'adopt');
  } else await f.claim.writeAndCommit(await f.declaration({ sessionId: pair.sessionId, port: pair.port }));
  assert.equal(parseClaim(await f.claim.read()).phase, phase);
  await unlink(f.claimPath()); entered = 0;
  const before = await f.board.read(), head = await f.claim.head();
  await assert.rejects(store.update(IDS.gone, c => { c.multiplexer = 'none'; }), /ADOPTION_NOT_READY/);
  await assert.rejects(runtime.receive({ version: 1, from: IDS.workerOne, to: IDS.gone, kind: 'status', payload: { port: 12345, busy: false } }), /ADOPTION_NOT_READY/);
  // The actual persisted pending job forces recover's real ordinary-publication path.
  const handoff = new HandoffWorkflow({ state: async () => {
    const config = await store.read();
    return { id: IDS.gone, config, me: config.agents[0] };
  }, assertCurrent() {}, update: mutate => store.update(IDS.gone, mutate), send: async () => assert.fail('no send'), deliver: () => assert.fail('no turn'), busy: () => false });
  try { await assert.rejects(handoff.recover(), /ADOPTION_NOT_READY/); } finally { handoff.dispose(); }
  assert.equal(entered, 0); assert.equal(await f.board.read(), before); assert.equal(await f.claim.head(), head);
});

const payloads = {
  report: ['report', { status: 'ready_for_review', summary: 'must never persist or notify' }],
  clear: ['report', { status: 'clear', summary: '' }],
  registration: ['registration', { port: 12345, projectDirectory: '.', role: 'developer' }],
  status: ['status', { port: 12345, busy: false }],
  handoff: ['handoff_report', { jobId: 'fixture-orphan', instanceId: 'fixture-instance', summary: 'must not alter jobs' }],
  message: ['message', { message: 'must not start a turn' }],
};
async function post(runtime, key) {
  const [kind, payload] = payloads[key];
  const response = await fetch(`http://127.0.0.1:${runtime.endpoint.port}/intercom`, { method: 'POST', body: JSON.stringify({ version: 1, from: IDS.workerOne, to: IDS.fresh, kind, payload }) });
  return { status: response.status, body: await response.text() };
}
async function reportBytes(f) {
  const directory = path.join(f.home, '.pi-intercom/reports');
  return Promise.all((await readdir(directory)).sort().map(async name => [name, await readFile(path.join(directory, name), 'utf8')]));
}
async function damageAnchor(f, damage) {
  const active = await f.claim.read();
  if (damage === 'malformed-newest-restored') { await f.claim.write('# malformed newer evidence\n'); await f.claim.commit(); await f.claim.write(active); }
  if (damage === 'deleted-newest-restored') { await f.gitOk(['rm', 'coordinator-claim.md']); await f.gitOk(['commit', '-qm', 'fixture latest deletion']); await f.claim.write(active); }
  if (damage === 'missing-worktree') await unlink(f.claimPath());
}
const prior = { version: 1, sessionId: IDS.workerOne, status: 'blocked', summary: 'preserve prior evidence', updatedAt: '2026-10-16T00:00:00.000Z' };
for (const damage of ['malformed-newest-restored', 'deleted-newest-restored', 'missing-worktree']) for (const first of ['tool', 'report', 'clear', 'registration']) {
  test(`B2 ALREADY-RUNNING ${damage}, first effect=${first}: no authority/persistence/cache/job/turn`, async t => {
    const f = await fixture({ runtime: true }); t.after(f.dispose);
    const runtime = await f.startRuntime(); assert.equal((await runtime.adoptCoordinator(f.context, 'adopt')).ok, true);
    assert.equal(runtime.coordinatorActionReady(), true);
    await saveWorkerReport(f.home, prior);
    const before = await f.board.read(), reports = await reportBytes(f), roles = [...runtime.registeredRoles], jobs = [...runtime.handoff.jobs];
    await damageAnchor(f, damage);
    if (first === 'tool') await assert.rejects(runtime.tool('list', {}), /ADOPTION_NOT_READY/);
    else { const response = await post(runtime, first); assert.equal(response.status, 400); assert.match(response.body, /ADOPTION_NOT_READY/); }
    for (const key of Object.keys(payloads)) { const response = await post(runtime, key); assert.equal(response.status, 400, response.body); assert.match(response.body, /ADOPTION_NOT_READY/); }
    await assert.rejects(runtime.tool('list', {}), /ADOPTION_NOT_READY/);
    assert.equal(runtime.coordinatorActionReady(), false);
    assert.equal((await runtime.adoptCoordinator(f.context, 'status')).code, 'RECORD');
    assert.equal(await f.board.read(), before); assert.deepEqual(await reportBytes(f), reports);
    assert.deepEqual([...runtime.registeredRoles], roles); assert.deepEqual([...runtime.handoff.jobs], jobs); assert.equal(f.messages.length, 0);
  });
}

for (const phase of ['before-save', 'after-save']) test(`B2 anchor changes at ${phase}: final guard preserves save/notification distinction`, async t => {
  const f = await fixture({ runtime: true }); t.after(f.dispose); let armed = false;
  const runtime = await f.startRuntime({ adoption: { projectsHome: f.home, rolesDirectory: path.join(f.home, 'roles'), listSessions: f.workflowOptions.listSessions,
    reportPhase: async p => { if (armed && p === phase) { armed = false; await damageAnchor(f, 'malformed-newest-restored'); } } } });
  assert.equal((await runtime.adoptCoordinator(f.context, 'adopt')).ok, true);
  await saveWorkerReport(f.home, prior); armed = true;
  const response = await post(runtime, 'report'); assert.equal(response.status, 400);
  const reports = await readWorkerReports(f.home, [IDS.workerOne]);
  if (phase === 'before-save') { assert.match(response.body, /ADOPTION_NOT_READY/); assert.deepEqual(reports, [prior]); }
  else { assert.match(response.body, /Report stored; coordinator notification blocked\/not submitted/); assert.equal(reports[0].summary, payloads.report[1].summary); }
  assert.equal(f.messages.length, 0); assert.equal(runtime.coordinatorActionReady(), false);
});

test('B3 real failed promotion → read-only pending status → same-command write-free retry → proceed', async t => {
  const f = await fixture({ runtime: true }); t.after(f.dispose); let swaps = 0;
  const runtime = await f.startRuntime({ store: root => new ConfigStore(root, { rename: async (from, to) => { swaps++; await rename(from, to); } }) });
  const promote = runtime.promoteCoordinator.bind(runtime); runtime.promoteCoordinator = async () => { throw Error('review promotion failure'); };
  assert.equal((await runtime.adoptCoordinator(f.context, 'adopt')).code, 'PROMOTION_PENDING'); assert.equal(swaps, 1);
  const head = await f.claim.head(), raw = await f.board.read(), claim = await f.claim.read();
  const status = await runtime.adoptCoordinator(f.context, 'status');
  assert.equal(status.code, 'PROMOTION_PENDING'); assert.equal(status.ok, false); assert.equal(status.exitCode, 1);
  assert.ok(status.lines.some(line => line.includes('write-free promotion retry'))); assert.ok(!status.lines.some(line => /proceed/.test(line)));
  assert.equal(runtime.coordinatorActionReady(), false);
  assert.equal(await f.claim.head(), head); assert.equal(await f.board.read(), raw); assert.equal(await f.claim.read(), claim);
  runtime.promoteCoordinator = promote;
  assert.equal((await runtime.adoptCoordinator(f.context, 'adopt')).code, 'CLAIM_OK');
  const ready = await runtime.adoptCoordinator(f.context, 'status'); assert.equal(ready.code, 'OK'); assert.ok(ready.lines.includes('STATUS OK: b — proceed'));
  assert.equal(runtime.coordinatorActionReady(), true); assert.equal(swaps, 1);
  assert.equal(await f.claim.head(), head); assert.equal(await f.board.read(), raw); assert.equal(await f.claim.read(), claim);
});
