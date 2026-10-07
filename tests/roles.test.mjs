import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Intercom } from '../dist/runtime.js';
import { ConfigStore } from '../dist/config.js';
import { envelope } from '../dist/transport.js';
import { sanitizeObservation } from '../dist/observability.js';
import { readObservationSnapshot } from '../dist/snapshot.js';
import { workerStatusPage } from '../dist/worker-status.js';

const pause = () => new Promise(resolve => setTimeout(resolve, 5));
async function until(check) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) { if (await check()) return; await pause(); }
  assert.fail('condition did not settle');
}

async function setup(t, extra = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'intercom-roles-'));
  await new ConfigStore(root).initialize('c', 12345);
  let nextPort = 31000;
  const endpoints = new Map(), all = [], launches = [], events = [];
  const options = {
    listen: async (_port, accept) => {
      const port = nextPort++; endpoints.set(port, accept);
      return { port, close: async () => { endpoints.delete(port); } };
    },
    send: async (port, message) => {
      const accept = endpoints.get(port); if (!accept) throw new Error('unreachable');
      await accept(message);
    },
    launch: async request => { launches.push(request); return { launched: true }; },
    probe: async agent => ({ sessionId: agent.sessionId, state: 'disconnected', checkedAt: new Date().toISOString(), reason: 'refused' }),
    observe: () => ({ record: (event, metadata) => events.push({ event, metadata }), close: async () => {} }),
    ...extra,
  };
  async function start(id, workerRole) {
    const messages = [], notices = [];
    const host = { cwd: root, sessionId: () => id, busy: () => false, workerRole,
      deliver: (text, busy) => messages.push({ text, busy }), setName: async () => {}, notify: text => notices.push(text) };
    const runtime = new Intercom(host, options); all.push(runtime);
    try { await runtime.start(); }
    catch (error) { error.notices = notices; throw error; }
    return { runtime, messages, notices };
  }
  t.after(async () => {
    for (const runtime of all) await runtime.close();
    await rm(root, { recursive: true, force: true });
  });
  return { start, launches, events, root };
}
const configure = (runtime, sessionId, port, name, extra = {}) => runtime.tool('configure_worker', {
  sessionId, port, projectDirectory: '.', name, description: `${name} remit`, ...extra,
});

test('worker creation without a role preserves the existing launch request', async t => {
  const f = await setup(t), c = await f.start('c');
  const created = await c.runtime.tool('create_worker', { projectDirectory: '.' });
  assert.equal(f.launches.length, 1);
  assert.equal(f.launches[0].cwd, f.root);
  assert.equal(f.launches[0].role, undefined);
  assert.equal(f.launches[0].agentDir, undefined);
  assert.equal(f.launches[0].sessionId, undefined);
  assert.equal(created.role, undefined);
  assert.equal(JSON.stringify(f.launches[0]).includes('PI_CODING_AGENT_DIR'), false);
});

test('create_worker accepts a logical role and does not resolve a Pi home', async t => {
  const f = await setup(t), c = await f.start('c');
  const created = await c.runtime.tool('create_worker', { role: 'developer', projectDirectory: '.' });
  assert.equal(created.role, 'developer');
  assert.equal(f.events.some(event => event.event === 'launch.result' && event.metadata.piRole === 'developer'), true);
  await c.runtime.tool('create_worker', { role: 'architect', projectDirectory: '.' });
  await c.runtime.tool('create_worker', { role: 'dev.role-1', projectDirectory: '.' });
  await c.runtime.tool('create_worker', { role: 'constructor', projectDirectory: '.' });
  assert.deepEqual(f.launches.map(launch => launch.role), ['developer', 'architect', 'dev.role-1', 'constructor']);
  for (const launch of f.launches) {
    assert.equal(launch.agentDir, undefined);
    assert.equal(launch.cwd, f.root);
    assert.equal(JSON.stringify(launch).includes('PI_CODING_AGENT_DIR'), false);
  }
  assert.equal((await c.runtime.store.read()).agents.length, 1);
  assert.equal((await c.runtime.store.read()).roles, undefined);
});

test('invalid role syntax fails before launch', async t => {
  let launched = false;
  const f = await setup(t, { launch: async () => { launched = true; return { launched: true }; } });
  const c = await f.start('c');
  for (const role of ['../../something', "developer'; touch pwned; '", 'has space', '..', '.hidden', 'a'.repeat(65), 'dev\nx', '/tmp/developer']) {
    await assert.rejects(c.runtime.tool('create_worker', { role, projectDirectory: '.' }), /invalid role/);
  }
  await assert.rejects(c.runtime.tool('create_worker', { role: 1, projectDirectory: '.' }), /invalid role/);
  assert.equal(launched, false);
});

test('reported role is persisted, listed, and resumed through the same logical role', async t => {
  const f = await setup(t), c = await f.start('c');
  const w = await f.start('w', 'developer');
  assert.match(c.messages.at(-1).text, /"role":"developer"/);
  assert.equal((await c.runtime.store.read()).agents.length, 1);
  await configure(c.runtime, 'w', w.runtime.endpoint.port, 'Builder');
  const saved = (await c.runtime.store.read()).agents.find(agent => agent.sessionId === 'w');
  assert.equal(saved.role, 'developer');
  assert.equal(saved.name, 'Builder');
  const listed = await c.runtime.tool('list', {});
  assert.equal(listed.agents.find(agent => agent.sessionId === 'w').role, 'developer');
  await configure(c.runtime, 'w', w.runtime.endpoint.port, 'Builder');
  assert.equal((await c.runtime.store.read()).agents.find(agent => agent.sessionId === 'w').role, 'developer');
  await c.runtime.tool('resume_worker', { to: 'Builder', confirmClosed: true });
  assert.equal(f.launches.length, 1);
  assert.equal(f.launches[0].role, 'developer');
  assert.equal(f.launches[0].agentDir, undefined);
  assert.equal(f.launches[0].sessionId, 'w');
  assert.equal(f.launches[0].cwd, f.root);
  assert.equal(f.events.some(event => event.event === 'launch.result' && event.metadata.operation === 'resume_worker' && event.metadata.piRole === 'developer'), true);
});

test('explicit configure role is resumed, and a legacy worker keeps the existing launch', async t => {
  const f = await setup(t), c = await f.start('c');
  await configure(c.runtime, 'legacy', 32001, 'Legacy');
  await configure(c.runtime, 'checker', 32002, 'Checker', { role: 'verifier' });
  await c.runtime.tool('resume_worker', { to: 'Legacy', confirmClosed: true });
  await c.runtime.tool('resume_worker', { to: 'Checker', confirmClosed: true });
  assert.equal(f.launches[0].role, undefined);
  assert.equal(f.launches[0].agentDir, undefined);
  assert.equal(f.launches[0].sessionId, 'legacy');
  assert.equal(f.launches[1].role, 'verifier');
  assert.equal(f.launches[1].agentDir, undefined);
  assert.equal(f.launches[1].sessionId, 'checker');
});

test('a pi-role launch failure is propagated and does not drop the saved role', async t => {
  const launches = [];
  const f = await setup(t, {
    launch: async request => { launches.push(request); throw new Error("pi-role: role 'developer' not found"); },
  });
  const c = await f.start('c');
  await configure(c.runtime, 'w', 32003, 'Builder', { role: 'developer' });
  await assert.rejects(c.runtime.tool('resume_worker', { to: 'Builder', confirmClosed: true }), /role 'developer' not found/);
  assert.equal(launches.length, 1);
  assert.equal(launches[0].role, 'developer');
  assert.equal(launches[0].sessionId, 'w');
  assert.equal((await c.runtime.store.read()).agents.find(agent => agent.sessionId === 'w').role, 'developer');
});

test('explicit role wins, a saved role survives later edits, and a differing report does not replace it', async t => {
  const f = await setup(t), c = await f.start('c');
  const reported = await f.start('w', 'architect');
  const explicit = await configure(c.runtime, 'w', reported.runtime.endpoint.port, 'Builder', { role: 'developer' });
  assert.equal(explicit.role, 'developer');
  assert.equal(explicit.roleNote, undefined);
  const renamed = await configure(c.runtime, 'w', reported.runtime.endpoint.port, 'Renamed');
  assert.equal(renamed.role, 'developer');
  assert.match(renamed.roleNote, /reported role architect differs from persisted role developer; persisted role kept/);
  assert.equal((await c.runtime.store.read()).agents.find(agent => agent.sessionId === 'w').role, 'developer');
  const same = await f.start('same', 'architect');
  const kept = await configure(c.runtime, 'same', same.runtime.endpoint.port, 'Architect');
  assert.equal(kept.role, 'architect');
  assert.equal(kept.roleNote, undefined);
});

test('registration role must be a logical name on the wire', () => {
  const base = { version: 1, kind: 'registration', from: 'w', to: 'c', payload: { port: 1, projectDirectory: '.' } };
  assert.equal(envelope(base).payload.role, undefined);
  assert.equal(envelope({ ...base, payload: { ...base.payload, role: 'dev.role-1' } }).payload.role, 'dev.role-1');
  for (const role of ['/tmp/dev', '', 'a'.repeat(65), 'has space', 'dev\nx', 1, 'constructor/../x', '../../something']) {
    assert.throws(() => envelope({ ...base, payload: { ...base.payload, role } }), /invalid role/);
  }
});

test('a malformed worker role is reported directly and does not register', async t => {
  const f = await setup(t), c = await f.start('c');
  await assert.rejects(f.start('w', 'not a role'), error => {
    assert.match(String(error), /invalid worker role/);
    assert.match(error.notices.join('\n'), /Invalid PI_INTERCOM_WORKER_ROLE/);
    assert.doesNotMatch(error.notices.join('\n'), /Coordinator unreachable/);
    return true;
  });
  assert.equal(c.messages.length, 0);
});

test('logical role is visible in the observation snapshot and worker status', async t => {
  const f = await setup(t), c = await f.start('c');
  await configure(c.runtime, 'w', 32004, 'Builder', { role: 'developer' });
  const snapshot = await readObservationSnapshot(f.root);
  assert.equal(snapshot.config.agents.find(agent => agent.sessionId === 'w').role, 'developer');
  assert.equal(snapshot.config.agents.find(agent => agent.coordinator).role, undefined);
  const page = workerStatusPage(snapshot, { name: 'Builder' });
  assert.equal(page.workers[0].role, 'developer');
  const valid = { version: 1, timestamp: new Date().toISOString(), writerId: '01900000-0000-7000-8000-000000000001', sessionId: 's', event: 'launch.result' };
  assert.equal(sanitizeObservation({ ...valid, piRole: 'dev.role-1' }).piRole, 'dev.role-1');
  assert.equal(sanitizeObservation({ ...valid, piRole: '../developer' }).piRole, undefined);
  assert.equal(sanitizeObservation({ ...valid, piRole: 'developer', role: 'worker' }).role, 'worker');
});

test('close retains the saved role for the following resume', async t => {
  const identity = { workspaceId: 'space', paneId: 'pane', terminalId: 'terminal', sessionId: 'w', sessionFile: '/private/session.jsonl', pid: 123, processStart: '456' };
  const f = await setup(t, {
    closeTimeoutMs: 2000,
    closeProvider: {
      getIdentity: async () => ({ ...identity }),
      inspect: async (_proof, _id, guard) => { guard(); },
      close: async (_proof, _id, guard, beforeSubmit) => { guard(); await beforeSubmit(); guard(); return { paneClosed: true, workerExited: true }; },
    },
  });
  const c = await f.start('c');
  const w = await f.start('w', 'developer');
  await configure(c.runtime, 'w', w.runtime.endpoint.port, 'Builder');
  await c.runtime.tool('reload_worker', { to: 'Builder' });
  const job = (await c.runtime.tool('close_worker', { to: 'Builder' })).job;
  await until(() => w.messages.some(message => message.text.includes('intercom_report_handoff')));
  await w.runtime.tool('report_handoff', { jobId: job.jobId, summary: 'Role stays with the worker.' }, 'handoff-tool');
  w.runtime.workerSettled(new Set(['handoff-tool']));
  await until(async () => (await c.runtime.store.read()).agents.find(agent => agent.sessionId === 'w')?.closeJob?.state === 'closed');
  const saved = (await c.runtime.store.read()).agents.find(agent => agent.sessionId === 'w');
  assert.equal(saved.role, 'developer');
  assert.equal(saved.closeJob.state, 'closed');
  await c.runtime.tool('resume_worker', { to: 'Builder', confirmClosed: true });
  assert.equal(f.launches.at(-1).role, 'developer');
  assert.equal(f.launches.at(-1).agentDir, undefined);
  assert.equal(f.launches.at(-1).sessionId, 'w');
});
