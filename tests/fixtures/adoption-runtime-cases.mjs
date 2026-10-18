// Real Intercom + loopback HTTP fixtures. No live board, model, auth, workers, or lifecycle provider.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fixture, barrier } from './adoption-support.mjs';
import { IDS } from './adoption-fixture.mjs';
import { Intercom } from '../../dist/runtime.js';
import { listen, send } from '../../dist/transport.js';
import { saveWorkerReport, readWorkerReports } from '../../dist/reports.js';

const turn = () => new Promise(resolve => setImmediate(resolve));
const payloads = [
  ['registration', { port: 12345, projectDirectory: '.', role: 'developer' }],
  ['report', { status: 'blocked', summary: 'new report' }], ['report', { status: 'clear', summary: '' }],
  ['status', { port: 12345, busy: false }], ['message', { message: 'do not deliver while closed' }],
  ['handoff_report', { jobId: 'fixture-orphan', instanceId: 'fixture-instance', summary: 'test public handoff' }],
];
async function post(runtime, kind, payload) {
  const response = await fetch(`http://127.0.0.1:${runtime.endpoint.port}/intercom`, { method: 'POST', body: JSON.stringify({ version: 1, from: IDS.workerOne, to: IDS.fresh, kind, payload, correlationId: randomUUID() }) });
  return { status: response.status, body: await response.text() };
}
function clock() {
  const timers = [];
  return { timers, schedule(callback) { const timer = { callback, active: true }; timers.push(timer); return () => { timer.active = false; }; },
    fire() { const timer = timers.find(timer => timer.active); assert.ok(timer, 'timer actually armed'); timer.active = false; timer.callback(); } };
}
async function blocked(f, runtime, timer) {
  const before = await f.board.read(), reports = await readWorkerReports(f.home, [IDS.workerOne]);
  const cache = [...runtime.registeredRoles], messages = f.messages.length;
  await assert.rejects(runtime.tool('list', {}), /ADOPTION_NOT_READY|anonymous/);
  for (const [kind, payload] of payloads) {
    const result = await post(runtime, kind, payload);
    assert.equal(result.status, 400, `${kind}: ${result.body}`);
    assert.match(result.body, /ADOPTION_NOT_READY/);
  }
  runtime.reminders.arm(); timer.fire(); await turn(); await turn();
  assert.equal(f.messages.length, messages);
  assert.equal(timer.timers.filter(timer => timer.active).length, 0, 'closed-epoch timer has no deferred interval/replay');
  assert.equal(await f.board.read(), before);
  assert.deepEqual(await readWorkerReports(f.home, [IDS.workerOne]), reports);
  assert.deepEqual([...runtime.registeredRoles], cache);
  assert.equal(runtime.coordinatorActionReady(), false);
}
async function phaseProof(name) {
  const bootstrap = name === 'bootstrap-claim-callbacks';
  const declaration = name === 'declaration-claim-callbacks';
  const f = await fixture({ runtime: true, noBoard: bootstrap });
  try {
    const timer = clock(), gate = barrier();
    const phaseNames = { 'callbacks-after-swap': 'published', 'callbacks-active-dirty': 'active-written', 'callbacks-before-promotion': 'before-promotion' };
    const recovery = name === 'clean-advance-claim-callbacks';
    const phase = recovery ? 'before-promotion' : phaseNames[name] ?? 'published';
    let interrupt = recovery;
    const opts = { projectsHome: f.home, rolesDirectory: path.join(f.home, 'roles'), listSessions: f.workflowOptions.listSessions,
      phase: async step => { if (interrupt && step === 'published') { interrupt = false; throw Error('fixture crash boundary after swap'); } if (step === phase) await gate.wait(); } };
    const runtime = await f.startRuntime({ reminderClock: timer, adoption: opts });
    const endpoint = runtime.endpoint;
    if (declaration) {
      const config = await f.board.parsed(); config.agents[0].sessionId = IDS.fresh; config.agents[0].port = endpoint.port;
      await f.board.write(JSON.stringify(config));
    }
    const initialSends = f.sends.length;
    if (!bootstrap) await saveWorkerReport(f.home, { version: 1, sessionId: IDS.workerOne, status: 'blocked', summary: 'previous stored evidence', updatedAt: '2026-10-16T00:00:00.000Z' });
    if (name === 'callbacks-commit-failed') await writeFile(path.join(f.home, '.git/hooks/pre-commit'), '#!/bin/sh\nif grep -q \'"phase": "active"\' coordinator-claim.md; then exit 1; fi\n', { mode: 0o755 });
    if (name === 'callbacks-promotion-pending') runtime.promoteCoordinator = async () => { throw Error('fixture promotion blocked'); };
    // Bootstrap/declaration have no swap; stop immediately after active write instead.
    if (bootstrap || declaration) opts.phase = async step => { if (step === 'active-written') await gate.wait(); };
    if (recovery) {
      const stopped = await runtime.adoptCoordinator(f.context, 'adopt'); assert.equal(stopped.ok, false);
      assert.equal(runtime.coordinatorActionReady(), false);
    }
    const pending = runtime.adoptCoordinator(f.context, 'adopt');
    if (name === 'callbacks-commit-failed' || name === 'callbacks-promotion-pending') {
      gate.release(); const result = await pending;
      assert.equal(result.code, name === 'callbacks-commit-failed' ? 'GIT' : 'PROMOTION_PENDING', result.lines.join('\n'));
      await blocked(f, runtime, timer);
    } else {
      await Promise.race([gate.reached, pending.then(result => { throw Error(`workflow ended before required barrier: ${result.lines.join('; ')}`); })]);
      await blocked(f, runtime, timer); gate.release();
      const result = await pending; assert.equal(result.ok, true, result.lines.join('\n'));
      assert.equal(runtime.coordinatorActionReady(), true);
      assert.equal(runtime.endpoint, endpoint);
      assert.equal(runtime.responsibility.name, 'Coordinator');
      assert.equal(f.sends.length, initialSends, 'adoption sent no worker request');
      const result2 = await post(runtime, 'report', { status: 'ready_for_review', summary: 'newly sent after readiness' });
      if (!bootstrap) assert.equal(result2.status, 202, result2.body);
      assert.equal((await f.board.parsed()).agents.find(a => a.name === 'Reviewer')?.closeJob?.state, bootstrap ? undefined : 'awaiting_handoff');
    }
    console.log(`ASSERT ${name} PASS: HTTP 400, unchanged evidence/cache/config, zero turns while fenced; same endpoint promotion`);
  } finally { await f.dispose(); }
}
async function crossEpoch(name) {
  const f = await fixture({ runtime: true });
  try {
    const timer = clock(), gate = barrier(); let enabled = false;
    const opts = { projectsHome: f.home, rolesDirectory: path.join(f.home, 'roles'), listSessions: f.workflowOptions.listSessions,
      reportPhase: async phase => { if (enabled && phase === (name === 'stored-report-notify-cross-epoch' ? 'after-save' : 'before-save')) await gate.wait(); } };
    const runtime = await f.startRuntime({ reminderClock: timer, adoption: opts });
    assert.equal((await runtime.adoptCoordinator(f.context, 'adopt')).ok, true);
    await saveWorkerReport(f.home, { version: 1, sessionId: IDS.workerOne, status: 'blocked', summary: 'seed report', updatedAt: '2026-10-16T00:00:00.000Z' });
    const before = await readWorkerReports(f.home, [IDS.workerOne]), delivered = f.messages.length;
    let pending;
    if (name === 'reminder-cross-epoch') {
      const state = runtime.state.bind(runtime); let once = true;
      runtime.state = async () => { const value = await state(); if (once) { once = false; await gate.wait(); } return value; };
      runtime.reminders.arm(); timer.fire(); pending = Promise.resolve();
    } else if (name === 'handoff-cross-epoch') {
      const state = runtime.handoff.ctx.state;
      runtime.handoff.ctx.state = async () => { const value = await state(); await gate.wait(); return value; };
      pending = post(runtime, 'handoff_report', { jobId: 'fixture-orphan', instanceId: 'fixture-instance', summary: 'old epoch handoff' });
    } else if (name === 'callbacks-cross-epoch') {
      const state = runtime.state.bind(runtime); let once = true;
      runtime.state = async () => { const value = await state(); if (once) { once = false; await gate.wait(); } return value; };
      pending = post(runtime, 'registration', { port: 12345, projectDirectory: '.', role: 'developer' });
    } else if (name === 'queued-report-cross-epoch') {
      runtime.reportWrites = gate.wait();
      pending = post(runtime, 'report', { status: 'blocked', summary: 'queued report' });
      while (!runtime.pendingReports) await turn();
    } else { enabled = true; pending = post(runtime, 'report', { status: 'blocked', summary: 'persisted before notification' }); }
    await gate.reached;
    runtime.closeActionEpoch('fixture readiness epoch closed'); runtime.openActionEpoch();
    gate.release(); const result = await pending; await turn(); await turn();
    if (result) {
      assert.equal(result.status, 400, result.body);
      assert.match(result.body, name === 'stored-report-notify-cross-epoch' ? /Report stored; coordinator notification blocked\/not submitted/ : /ADOPTION_NOT_READY/);
    }
    assert.equal(f.messages.length, delivered);
    const after = await readWorkerReports(f.home, [IDS.workerOne]);
    if (name === 'stored-report-notify-cross-epoch') assert.equal(after[0].summary, 'persisted before notification');
    else assert.deepEqual(after, before);
    enabled = false;
    const fresh = await post(runtime, 'report', { status: 'ready_for_review', summary: 'fresh traffic succeeds' });
    assert.equal(fresh.status, 202, fresh.body);
    assert.equal(f.messages.length, delivered + 1, 'no replay: only new report delivered');
    console.log(`ASSERT ${name} PASS: old epoch blocked, saved-versus-unsaved distinguished, fresh traffic succeeds without replay`);
  } finally { await f.dispose(); }
}
async function deliveryProof(name) {
  const f = await fixture({ runtime: true }); let worker;
  try {
    const arrivals = [];
    const old = f.track(await listen(0, async message => { arrivals.push(message); }, () => ({ version: 1, sessionId: IDS.gone })));
    const config = await f.board.parsed(); config.agents[0].port = old.port; await f.board.write(JSON.stringify(config));
    const runtime = await f.startRuntime();
    const destinations = [];
    worker = new Intercom({ cwd: f.home, roleDirectory: path.join(f.home, 'roles/developer'), workerRole: '', sessionId: () => IDS.workerOne, busy: () => false, deliver: () => assert.fail('adoption cannot send worker work'), notify() {}, setName: async () => {} },
      { launch: async () => assert.fail('no launch'), send: async (port, envelope) => { destinations.push(port); await send(port, envelope); } });
    await worker.start();
    destinations.length = 0; await worker.report(); assert.equal(destinations[0], old.port);
    await old.close();
    const endpoint = runtime.endpoint, generation = worker.generation;
    assert.equal((await runtime.adoptCoordinator(f.context, 'adopt')).ok, true);
    assert.equal(runtime.endpoint, endpoint); assert.equal(runtime.responsibility.name, 'Coordinator');
    await worker.report();
    assert.equal(destinations.at(-1), endpoint.port); assert.equal(worker.generation, generation, 'no worker restart/reload');
    await worker.tool('report_work', { status: 'ready_for_review', summary: 'post-adoption report' });
    assert.equal((await readWorkerReports(f.home, [IDS.workerOne]))[0].summary, 'post-adoption report');
    assert.match(f.messages.at(-1), /post-adoption report/);
    assert.equal((await f.board.parsed()).agents.find(a => a.name === 'Reviewer').closeJob.state, 'awaiting_handoff');
    await assert.rejects(runtime.tool('close_worker', { to: 'Reviewer' }), /pending|uncertain|active|owned|fenced/i);
    console.log(`ASSERT ${name} PASS: two actual worker sends route old→new from disk; same promoted endpoint; report/status work; orphan job fenced`);
  } finally { await worker?.close(); await f.dispose(); }
}
export async function runtimeCase(name) {
  try {
    if (name === 'send-destination-changes') await deliveryProof(name);
    else if (['callbacks-cross-epoch', 'queued-report-cross-epoch', 'stored-report-notify-cross-epoch', 'reminder-cross-epoch', 'handoff-cross-epoch'].includes(name)) await crossEpoch(name);
    else await phaseProof(name);
    console.log('TERMINAL: ASSERTIONS exit 0');
  } catch (error) { console.error(`FIXTURE ERROR: ${error.stack}`); process.exitCode = 3; }
}
