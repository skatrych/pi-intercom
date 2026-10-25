// Final-effect and publication boundaries after ADR 0025: the current config pair is re-read at every
// effect, so a coordinator replaced by another cooperating process cannot keep acting, and already
// submitted/stored outcomes are reported truthfully instead of replayed.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { fixture } from './fixtures/adoption-support.mjs';
import { createFixture, configText, IDS } from './fixtures/adoption-fixture.mjs';
import { ConfigStore } from '../dist/config.js';
import { readWorkerReports, saveWorkerReport } from '../dist/reports.js';
import { REMINDER_TEXT } from '../dist/reminders.js';

/** A valid board whose coordinator pair was replaced by another cooperating process. */
function replaced(original, sessionId = 'other-coordinator', port = 42999) {
  const config = JSON.parse(original);
  const board = config.agents.find(agent => agent.coordinator);
  board.sessionId = sessionId;
  board.port = port;
  return `${JSON.stringify(config, null, 2)}\n`;
}

test('the store final proof refuses config drift even when the caller guard is a no-op', async t => {
  const f = await createFixture();
  t.after(() => f.dispose());
  await f.board.write(configText('single', f.ports()));
  const before = await f.board.read();
  class DriftingStore extends ConfigStore {
    async openTemporary(file) {
      const handle = await super.openTemporary(file);
      return {
        writeFile: data => handle.writeFile(data), sync: () => handle.sync(),
        close: async () => { await handle.close(); await writeFile(this.file, replaced(before)); },
      };
    }
  }
  const store = new DriftingStore(f.home);
  await assert.rejects(store.update({ sessionId: IDS.gone, port: f.ports().coordinator }, config => { config.multiplexer = 'none'; }), /config changed after admission|coordinator permission required|does not match the board/);
  assert.equal(await f.board.read(), replaced(before), 'the drifted board is authoritative; our mutation was not published');
});

test('every Windows retry re-checks the pair; a revocation between attempts refuses the next rename', async t => {
  const f = await createFixture();
  t.after(() => f.dispose());
  await f.board.write(configText('single', f.ports()));
  const before = await f.board.read();
  let clock = 0, attempts = 0, delays = 0;
  const store = new ConfigStore(f.home, {
    platform: 'win32', now: () => clock,
    delay: async ms => { clock += ms; delays++; if (delays === 1) await writeFile(f.configPath(), replaced(before)); },
    rename: async (from, to) => {
      attempts++;
      if (attempts === 1) throw Object.assign(new Error('sharing conflict'), { code: 'EPERM' });
      const { rename } = await import('node:fs/promises');
      await rename(from, to);
    },
  });
  await assert.rejects(store.update({ sessionId: IDS.gone, port: f.ports().coordinator }, config => { config.multiplexer = 'none'; }), /does not match the board|config changed|coordinator permission required/);
  assert.equal(attempts, 1, 'the second attempt was never submitted');
  assert.equal(await f.board.read(), replaced(before));
});

test('a send re-checks the current pair after state read and never dispatches for a replaced coordinator', async t => {
  const f = await fixture();
  t.after(() => f.dispose());
  assert.equal((await f.adopt()).code, 'OK');
  const before = await f.board.read();
  let dispatched = 0;
  // Simulate the replacement happening between the state read and the dispatch guard.
  const original = f.runtime.state.bind(f.runtime);
  let calls = 0;
  f.runtime.state = async () => {
    const state = await original();
    if (++calls === 1) await writeFile(f.configPath(), replaced(before));
    return state;
  };
  const send = f.runtime.options.send;
  f.runtime.options.send = async (...args) => { dispatched++; return send(...args); };
  await assert.rejects(f.runtime.tool('send', { to: 'Builder', message: 'work' }), /no longer a configured entry|does not match the board/);
  assert.equal(dispatched, 0);
});

test('a report whose coordinator is replaced before save is refused and stores nothing', async t => {
  const f = await fixture();
  t.after(() => f.dispose());
  // Adopt first so a coordinator exists, then adopt again from a standalone workflow replacing the pair.
  assert.equal((await f.adopt()).code, 'OK');
  const current = await f.board.read();
  await saveWorkerReport(f.home, { version: 1, sessionId: IDS.workerOne, status: 'blocked', summary: 'prior', updatedAt: new Date().toISOString() });
  f.runtime.options.adoption.reportPhase = async phase => {
    if (phase === 'admitted') await writeFile(f.configPath(), replaced(current, 'another-coordinator', 43001));
  };
  const response = await fetch(`http://127.0.0.1:${f.runtime.endpoint.port}/intercom`, { method: 'POST', body: JSON.stringify({ version: 1, from: IDS.workerOne, to: f.id, kind: 'report', payload: { status: 'clear', summary: '' } }) });
  assert.equal(response.status, 400);
  assert.match(await response.text(), /COORDINATOR_NOT_AUTHORIZED|coordinator permission/);
  assert.equal((await readWorkerReports(f.home, [IDS.workerOne]))[0].status, 'blocked', 'the prior stored report was not cleared');
});

test('a saved report is kept when the coordinator is replaced before notification, with no replay', async t => {
  const f = await fixture();
  t.after(() => f.dispose());
  assert.equal((await f.adopt()).code, 'OK');
  const current = await f.board.read();
  const delivered = [];
  f.runtime.host.deliver = text => delivered.push(text);
  f.runtime.options.adoption.reportPhase = async phase => {
    if (phase === 'after-save') await writeFile(f.configPath(), replaced(current, 'another-coordinator', 43002));
  };
  await assert.rejects(f.runtime.receive({ version: 1, kind: 'report', from: IDS.workerOne, to: f.id, payload: { status: 'ready_for_review', summary: 'public outcome' } }), /Report stored/);
  assert.equal((await readWorkerReports(f.home, [IDS.workerOne]))[0].status, 'ready_for_review', 'saved bytes are preserved');
  assert.deepEqual(delivered, [], 'no notification and no replay after revocation');
});

test('a replaced coordinator cannot write worker status into the board', async t => {
  const f = await fixture();
  t.after(() => f.dispose());
  assert.equal((await f.adopt()).code, 'OK');
  const current = await f.board.read();
  await writeFile(f.configPath(), replaced(current, 'another-coordinator', 43003));
  const before = await readFile(f.configPath(), 'utf8');
  await assert.rejects(f.runtime.receive({ version: 1, kind: 'status', from: IDS.workerOne, to: f.id, payload: { port: 45123, busy: false } }), /coordinator permission required|does not match the board/);
  assert.equal(await readFile(f.configPath(), 'utf8'), before);
});

test('a reminder is not delivered once the coordinator pair is replaced', async t => {
  const f = await fixture();
  t.after(() => f.dispose());
  assert.equal((await f.adopt()).code, 'OK');
  const delivered = [];
  let tick;
  const clock = { schedule: callback => { tick = callback; return () => {}; } };
  f.runtime.reminders.dispose();
  // Re-create the scheduler with a controllable clock over the same runtime semantics.
  const { CoordinatorReminders } = await import('../dist/reminders.js');
  f.runtime.reminders = new CoordinatorReminders({
    captureGuard: () => () => {},
    isCoordinator: async () => (await f.runtime.state()).me?.coordinator === true,
    busy: () => false,
    deliver: message => { delivered.push(message); },
  }, clock, 60_000);
  f.runtime.reminders.arm();
  await writeFile(f.configPath(), replaced(await f.board.read(), 'another-coordinator', 43004));
  tick();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(delivered, []);
  assert.doesNotMatch(JSON.stringify(delivered), new RegExp(REMINDER_TEXT.slice(0, 20)));
});

test('a launch is not dispatched once the current pair no longer matches', async t => {
  const f = await fixture();
  t.after(() => f.dispose());
  assert.equal((await f.adopt()).code, 'OK');
  const current = await f.board.read();
  let launched = 0;
  f.runtime.options.launch = async () => { launched++; return { launched: true }; };
  const original = f.runtime.state.bind(f.runtime);
  let calls = 0;
  f.runtime.state = async () => {
    const state = await original();
    if (++calls === 1) await writeFile(f.configPath(), replaced(current, 'another-coordinator', 43005));
    return state;
  };
  await assert.rejects(f.runtime.tool('create_worker', { projectDirectory: '.' }), /no longer a configured entry|does not match the board|COORDINATOR_NOT_AUTHORIZED/);
  assert.equal(launched, 0);
});
