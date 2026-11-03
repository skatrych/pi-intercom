// The monitor callback is a routed UI effect of a coordinator, not an authority of its own. Its final
// pane operations must re-prove the exact current coordinator pair after every await (ADR 0025).
import test from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { promisify } from 'node:util';
import { createFixture, configText, IDS } from './fixtures/adoption-fixture.mjs';

function replaced(raw) {
  const config = JSON.parse(raw);
  const board = config.agents.find(agent => agent.coordinator);
  board.sessionId = 'replacement-coordinator';
  board.port = 43993;
  return JSON.stringify(config);
}

test('a replaced coordinator cannot submit a monitor pane split', { timeout: 20000 }, async t => {
  const f = await createFixture();
  await f.board.write(configText('full', f.ports()));
  const original = cp.execFile;
  const prior = { herdr: process.env.HERDR_ENV, pane: process.env.HERDR_PANE_ID, role: process.env.PI_ROLE_DIR,
    roles: process.env.PI_ROLES_DIR, home: process.env.PI_INTERCOM_PROJECTS_HOME, worker: process.env.PI_INTERCOM_WORKER_ROLE };
  process.env.HERDR_ENV = '1'; process.env.HERDR_PANE_ID = 'caller';
  process.env.PI_ROLE_DIR = path.join(f.home, 'roles/orchestrator');
  process.env.PI_ROLES_DIR = path.join(f.home, 'roles');
  process.env.PI_INTERCOM_PROJECTS_HOME = f.home;
  delete process.env.PI_INTERCOM_WORKER_ROLE;
  t.after(async () => {
    cp.execFile = original; syncBuiltinESMExports();
    for (const [key, value] of Object.entries({ HERDR_ENV: prior.herdr, HERDR_PANE_ID: prior.pane })) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    for (const [key, value] of Object.entries({ PI_ROLE_DIR: prior.role, PI_ROLES_DIR: prior.roles, PI_INTERCOM_PROJECTS_HOME: prior.home, PI_INTERCOM_WORKER_ROLE: prior.worker })) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  });
  let split = 0;
  cp.execFile = function () {};
  cp.execFile[promisify.custom] = async (file, args) => {
    assert.equal(file, 'herdr');
    if (args[1] === 'current') return { stdout: JSON.stringify({ result: { pane: { pane_id: 'caller', tab_id: 'tab', workspace_id: 'ws' } } }) };
    if (args[1] === 'list') {
      // Another cooperating process replaces the board while the monitor is inspecting panes.
      await writeFile(f.configPath(), replaced(await readFile(f.configPath(), 'utf8')));
      return { stdout: JSON.stringify({ result: { panes: [{ pane_id: 'caller', tab_id: 'tab', workspace_id: 'ws' }] } }) };
    }
    if (args[1] === 'split') { split++; throw new Error('forbidden split after revocation'); }
    throw new Error(`unexpected Herdr call ${args.join(' ')}`);
  };
  syncBuiltinESMExports();
  const { default: extension } = await import('../dist/index.js');
  const events = new Map(), notices = [];
  const pi = { on: (name, fn) => events.set(name, fn), registerTool() {}, registerFlag() {}, getFlag() {},
    getSessionName: () => '', setSessionName() {}, sendUserMessage() {}, events: { on() { return () => {}; }, emit() {} } };
  extension(pi);
  const ctx = { cwd: f.home, mode: 'tui', isProjectTrusted: () => true, isIdle: () => true,
    sessionManager: { getSessionId: () => IDS.gone, getSessionFile: () => undefined, getBranch: () => [] },
    ui: { notify: (text, level) => notices.push({ text, level }), setWidget() {} } };
  t.after(async () => { await events.get('session_shutdown')?.(); await f.dispose(); });
  await events.get('session_start')({}, ctx);
  assert.equal(split, 0, 'no pane split may be submitted after the pair was revoked');
  assert.ok(notices.some(entry => /monitor/i.test(entry.text)), 'the refusal is surfaced as a monitor warning');
  assert.equal((await readFile(f.configPath(), 'utf8')).includes('replacement-coordinator'), true, 'the replacement is authoritative');
});
