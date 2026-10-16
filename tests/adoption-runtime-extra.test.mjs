import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fixture } from './fixtures/adoption-support.mjs';
import { saveWorkerReport, readWorkerReports } from '../dist/reports.js';
import { IDS } from './fixtures/adoption-fixture.mjs';
import { renderClaim } from '../dist/adoption.js';

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
