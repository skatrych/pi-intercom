import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { lstat, mkdir } from 'node:fs/promises';
import { Intercom } from '../dist/runtime.js';
import { ConfigStore } from '../dist/config.js';
import { fixture } from './fixtures/adoption-support.mjs';
import { saveWorkerReport, readWorkerReports } from '../dist/reports.js';
import { IDS } from './fixtures/adoption-fixture.mjs';
import { renderClaim } from '../dist/adoption.js';

test('REAL default observer cannot turn held no-board root into implicit initialization', async t => {
  const f = await fixture({ runtime: true, noBoard: true }); t.after(f.dispose);
  const runtime = await f.startRuntime({ observe: undefined });
  runtime.recordObservation('host.activity', { phase: 'working', outcome: 'started' });
  await runtime.observer?.pending;
  await assert.rejects(lstat(path.join(f.home, '.pi-intercom')), { code: 'ENOENT' });
  assert.equal(runtime.coordinatorActionReady(), false);
  const status = await runtime.adoptCoordinator(f.context, 'status');
  assert.equal(status.ok, true); assert.ok(status.lines.some(line => line.startsWith('BOOT STATE: a')));
  await assert.rejects(lstat(path.join(f.home, '.pi-intercom')), { code: 'ENOENT' });
  const declared = await runtime.adoptCoordinator(f.context, 'adopt');
  assert.equal(declared.code, 'DECLARED', declared.lines.join('\n'));
  assert.equal(runtime.coordinatorActionReady(), true);
  assert.equal((await f.board.parsed()).agents[0].sessionId, IDS.fresh);
});

test('REAL default observer leaves no-board child and home untouched through shutdown', async t => {
  const f = await fixture({ runtime: true, noBoard: true }); let runtime;
  t.after(async () => { await runtime?.close(); await f.dispose(); });
  runtime = new Intercom({ cwd: path.join(f.home, 'app'), sessionId: () => IDS.fresh, roleDirectory: path.join(f.home, 'roles/orchestrator'), rolesDirectory: path.join(f.home, 'roles'), workerRole: '', busy: () => false, deliver: () => assert.fail('no model'), notify() {}, setName: async () => {} },
    { launch: async () => assert.fail('no launch'), adoption: { projectsHome: f.home, rolesDirectory: path.join(f.home, 'roles') } });
  await runtime.start(); runtime.recordObservation('host.activity', { phase: 'working', outcome: 'started' }); await runtime.observer?.pending;
  await runtime.close();
  for (const root of [f.home, path.join(f.home, 'app')]) await assert.rejects(lstat(path.join(root, '.pi-intercom')), { code: 'ENOENT' });
});

test('Orchestrator discovery never reads or logs into a board ABOVE counted projects home', async t => {
  const f = await fixture({ runtime: true }); const home = path.join(f.home, 'projects'); await mkdir(home);
  let runtime; const discover = ConfigStore.discover; let discoveries = 0;
  t.after(async () => { ConfigStore.discover = discover; await runtime?.close(); await f.dispose(); });
  ConfigStore.discover = async cwd => { discoveries++; return discover(cwd); };
  const before = await f.board.read();
  runtime = new Intercom({ cwd: home, sessionId: () => IDS.fresh, roleDirectory: path.join(f.home, 'roles/orchestrator'), rolesDirectory: path.join(f.home, 'roles'), workerRole: '', busy: () => false, deliver: () => assert.fail('no model'), notify() {}, setName: async () => {} },
    { launch: async () => assert.fail('no launch'), adoption: { projectsHome: home, rolesDirectory: path.join(f.home, 'roles') } });
  await runtime.start(); await runtime.observer?.pending;
  assert.equal(discoveries, 0); assert.equal(runtime.store.root, home);
  assert.equal(await f.board.read(), before);
  await assert.rejects(lstat(path.join(home, '.pi-intercom')), { code: 'ENOENT' });
  await assert.rejects(lstat(path.join(f.home, '.pi-intercom/logs')), { code: 'ENOENT' });
});

for (const damage of ['absent', 'dirty-active', 'newest-malformed', 'prepared']) test(`boot coordinator side effects fenced by ${damage} claim`, async t => {
  const f = await fixture({ runtime: true, self: true }); t.after(f.dispose);
  const config = await f.board.parsed(), pair = config.agents[0];
  if (damage !== 'absent') {
    const record = await f.declaration({ sessionId: pair.sessionId, port: pair.port });
    await f.claim.writeAndCommit(record);
    if (damage === 'dirty-active') await f.claim.write(renderClaim({ ...record, date: '2026-10-17' }));
    if (damage === 'newest-malformed') { await f.claim.write('invalid latest claim\n'); await f.claim.commit(); await f.claim.write(renderClaim(record)); }
    if (damage === 'prepared') await f.claim.write('invalid interrupted record bytes\n');
  }
  let maintenance = 0;
  const before = await f.board.read();
  const runtime = await f.startRuntime({ observe: () => ({ record() {}, close() {}, maintain() { maintenance++; } }) });
  assert.equal(runtime.coordinatorActionReady(), false);
  assert.equal(await f.board.read(), before, 'no pending-close recovery or port refresh while evidence unresolved');
  assert.equal(maintenance, 0);
  await assert.rejects(runtime.tool('list', {}), /ADOPTION_NOT_READY/);
});

test('a claim changed after promotion closes tools and incoming callbacks, not silently approval', async t => {
  const f = await fixture({ runtime: true }); t.after(f.dispose);
  const runtime = await f.startRuntime(); assert.equal((await runtime.adoptCoordinator(f.context, 'adopt')).ok, true);
  const record = JSON.parse((await f.claim.read()).split('```json\n')[1].split('\n```')[0]);
  await f.claim.write(renderClaim({ ...record, date: '2026-10-17' }));
  await assert.rejects(runtime.tool('list', {}), /ADOPTION_NOT_READY/);
  const before = await f.board.read();
  await assert.rejects(runtime.receive({ version: 1, kind: 'status', from: IDS.workerOne, to: IDS.fresh, payload: { port: 12345, busy: false } }), /ADOPTION_NOT_READY/);
  assert.equal(await f.board.read(), before);
});

test('report save checks actual runtime epoch immediately before report rename (HTTP 400, no save)', async t => {
  const f = await fixture({ runtime: true }); t.after(f.dispose);
  let ready = false, calls = 0, runtime;
  const adoption = { ...f.workflowOptions, reportPhase: async phase => {
    if (ready && phase === 'before-save') {
      const original = runtime.assertActionReady.bind(runtime);
      runtime.assertActionReady = epoch => {
        if (++calls === 7) runtime.closeActionEpoch('fixture final report-publication barrier');
        original(epoch);
      };
    }
  } };
  runtime = await f.startRuntime({ adoption });
  assert.equal((await runtime.adoptCoordinator(f.context, 'adopt')).ok, true);
  const stored = { version: 1, sessionId: IDS.workerOne, status: 'blocked', summary: 'prior stored evidence', updatedAt: '2026-10-16T00:00:00.000Z' };
  await saveWorkerReport(f.home, stored); ready = true;
  const response = await fetch(`http://127.0.0.1:${runtime.endpoint.port}/intercom`, { method: 'POST', body: JSON.stringify({ version: 1, from: IDS.workerOne, to: IDS.fresh, kind: 'report', payload: { status: 'clear', summary: '' } }) });
  assert.equal(response.status, 400); assert.match(await response.text(), /ADOPTION_NOT_READY.*no report stored or cleared/);
  assert.equal(calls, 7, 'readiness crossed exactly at final publication guard');
  assert.deepEqual(await readWorkerReports(f.home, [IDS.workerOne]), [stored]);
  assert.equal(f.messages.length, 0);
});
