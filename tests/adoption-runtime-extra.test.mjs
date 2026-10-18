import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { lstat, mkdir, readdir } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
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
    if (damage === 'dirty-active') {
      const changed = renderClaim({ ...record, date: record.date === '2026-10-17' ? '2027-01-01' : '2026-10-17' });
      assert.notEqual(changed, renderClaim(record)); await f.claim.write(changed);
    }
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

for (const instant of ['2026-10-17T00:00:00.000Z', '2026-12-31T23:59:59.999Z', '2027-01-01T00:00:00.000Z']) test(`generated date equality is not corruption; genuinely different date fences: ${instant}`, async t => {
  const f = await fixture({ runtime: true }); t.after(f.dispose);
  const runtime = await f.startRuntime();
  await runtime.adoptCoordinator(f.context, 'status');
  runtime.adoption.options.now = () => new Date(instant); // fixture clock, not wall-calendar corruption
  assert.equal((await runtime.adoptCoordinator(f.context, 'adopt')).ok, true);
  const record = JSON.parse((await f.claim.read()).split('```json\n')[1].split('\n```')[0]);
  assert.equal(record.date, instant.slice(0, 10));
  const equal = renderClaim({ ...record, date: instant.slice(0, 10) });
  assert.equal(equal, await f.claim.read()); await f.claim.write(equal);
  await runtime.tool('list', {});
  const changed = renderClaim({ ...record, date: record.date === '2026-10-17' ? '2027-01-01' : '2026-10-17' });
  assert.notEqual(changed, equal); await f.claim.write(changed);
  await assert.rejects(runtime.tool('list', {}), /ADOPTION_NOT_READY/);
  const before = await f.board.read();
  await assert.rejects(runtime.receive({ version: 1, kind: 'status', from: IDS.workerOne, to: IDS.fresh, payload: { port: 12345, busy: false } }), /ADOPTION_NOT_READY/);
  assert.equal(await f.board.read(), before);
});

for (const interruption of ['epoch', 'external-evidence']) test(`report save final rename checks ${interruption} (HTTP 400, no save)`, async t => {
  const f = await fixture({ runtime: true }); t.after(f.dispose);
  let ready = false, crossed = false;
  const runtime = await f.startRuntime();
  const original = fs.lstat;
  t.after(() => { fs.lstat = original; syncBuiltinESMExports(); });
  fs.lstat = async (...args) => {
    const info = await original(...args);
    const file = String(args[0]);
    if (ready && file.endsWith('.json') && path.dirname(file) === path.join(f.home, '.pi-intercom/reports')
      && (await readdir(path.dirname(file))).some(name => name.endsWith('.tmp'))) {
      crossed = true;
      if (interruption === 'epoch') runtime.closeActionEpoch('fixture staged report / final target inspection before rename');
      else await f.claim.write('malformed external evidence at final target inspection\n');
    }
    return info;
  };
  syncBuiltinESMExports();
  assert.equal((await runtime.adoptCoordinator(f.context, 'adopt')).ok, true);
  const stored = { version: 1, sessionId: IDS.workerOne, status: 'blocked', summary: 'prior stored evidence', updatedAt: '2026-10-16T00:00:00.000Z' };
  await saveWorkerReport(f.home, stored); ready = true;
  const response = await fetch(`http://127.0.0.1:${runtime.endpoint.port}/intercom`, { method: 'POST', body: JSON.stringify({ version: 1, from: IDS.workerOne, to: IDS.fresh, kind: 'report', payload: { status: 'clear', summary: '' } }) });
  assert.equal(response.status, 400); assert.match(await response.text(), /ADOPTION_NOT_READY.*no report stored or cleared/);
  assert.equal(crossed, true, 'readiness crossed after staging at the real final-publication boundary');
  assert.equal((await readdir(path.join(f.home, '.pi-intercom/reports'))).some(name => name.endsWith('.tmp')), false, 'unpublished staging cleaned');
  assert.deepEqual(await readWorkerReports(f.home, [IDS.workerOne]), [stored]);
  assert.equal(f.messages.length, 0);
});
