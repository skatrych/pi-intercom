import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { Intercom } from '../dist/runtime.js';
import { ConfigStore, expandHome, resolveRoleDirectory } from '../dist/config.js';
import { envelope } from '../dist/transport.js';

const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pause = () => new Promise(resolve => setTimeout(resolve, 5));
async function until(check) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) { if (await check()) return; await pause(); }
  assert.fail('condition did not settle');
}

async function setup(t, extra = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'intercom-roles-'));
  const developer = path.join(root, 'roles', 'developer');
  const architect = path.join(root, 'roles', 'architect');
  const verifier = path.join(root, 'roles', "verifier O'Brien $HOME;$(echo bad)");
  await mkdir(developer, { recursive: true });
  await mkdir(architect, { recursive: true });
  await mkdir(verifier, { recursive: true });
  await new ConfigStore(root).initialize('c', 12345);
  await new ConfigStore(root).update('c', config => { config.roles = { developer, architect, verifier }; });
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
  return { start, launches, events, root, developer, architect, verifier };
}
const configure = (runtime, sessionId, port, name, extra = {}) => runtime.tool('configure_worker', {
  sessionId, port, projectDirectory: '.', name, description: `${name} remit`, ...extra,
});

test('worker creation without a role preserves the existing launch request', async t => {
  const f = await setup(t), c = await f.start('c');
  await c.runtime.tool('create_worker', { projectDirectory: '.' });
  assert.equal(f.launches.length, 1);
  assert.equal(f.launches[0].cwd, f.root);
  assert.equal(f.launches[0].role, undefined);
  assert.equal(f.launches[0].agentDir, undefined);
  assert.equal(f.launches[0].sessionId, undefined);
});

test('configured roles resolve independently and unknown or unusable roles do not launch', async t => {
  const f = await setup(t), c = await f.start('c');
  const created = await c.runtime.tool('create_worker', { role: 'developer', projectDirectory: '.' });
  assert.equal(created.role, 'developer');
  assert.equal(f.events.filter(event => event.event === 'launch.result' && event.metadata.piRole === 'developer').length > 0, true);
  await c.runtime.tool('create_worker', { role: 'architect', projectDirectory: 'roles/architect' });
  await c.runtime.tool('create_worker', { role: 'verifier', projectDirectory: '.' });
  assert.deepEqual(f.launches.map(launch => [launch.role, launch.agentDir]), [
    ['developer', f.developer], ['architect', f.architect], ['verifier', f.verifier],
  ]);
  assert.equal(f.launches[1].cwd, f.architect);
  for (const role of ['does-not-exist', 'constructor', 'toString', 'hasOwnProperty', '/tmp/developer', '..', 'developer/../../etc']) {
    await assert.rejects(c.runtime.tool('create_worker', { role, projectDirectory: '.' }), /unknown role|invalid role/);
  }
  const inherited = Object.create({ constructor: f.developer });
  await assert.rejects(resolveRoleDirectory({ version: 1, multiplexer: 'herdr', agents: [], roles: inherited }, 'constructor'), /unknown role constructor/);
  await assert.rejects(c.runtime.tool('create_worker', { role: 1, projectDirectory: '.' }), /invalid role/);
  const missing = path.join(f.root, 'missing-role');
  const file = path.join(f.root, 'role-file');
  await writeFile(file, 'not a directory');
  await c.runtime.store.update('c', config => { config.roles.missing = missing; config.roles.file = file; });
  await assert.rejects(c.runtime.tool('create_worker', { role: 'missing', projectDirectory: '.' }), new RegExp(`role missing directory unavailable: ${escapeRegExp(missing)}`));
  await assert.rejects(c.runtime.tool('create_worker', { role: 'file', projectDirectory: '.' }), /role file path is not a directory/);
  assert.equal(f.launches.length, 3);
  assert.equal((await c.runtime.store.read()).agents.length, 1);
});

test('tilde role directories expand to the home directory before use', async () => {
  const relative = 'no-such-intercom-role-dir';
  const resolved = path.join(homedir(), relative);
  assert.equal(expandHome(`~/${relative}`), resolved);
  assert.equal(expandHome('~'), homedir());
  await assert.rejects(resolveRoleDirectory({ version: 1, multiplexer: 'herdr', agents: [], roles: { developer: `~/${relative}` } }, 'developer'),
    new RegExp(`role developer directory unavailable: ${escapeRegExp(resolved)}`));
  await assert.rejects(resolveRoleDirectory({ version: 1, multiplexer: 'herdr', agents: [], roles: { developer: 'roles/developer' } }, 'developer'), /must be absolute or start with ~\//);
  await assert.rejects(resolveRoleDirectory({ version: 1, multiplexer: 'herdr', agents: [], roles: { developer: '~user/roles' } }, 'developer'), /~user is not expanded/);
});

test('reported role is persisted on configure, preserved across edits, and resumed with the same directory', async t => {
  const f = await setup(t), c = await f.start('c');
  const w = await f.start('w', 'developer');
  assert.match(c.messages.at(-1).text, /"role":"developer"/);
  assert.equal((await c.runtime.store.read()).agents.length, 1);
  await configure(c.runtime, 'w', w.runtime.endpoint.port, 'Builder');
  const saved = (await c.runtime.store.read()).agents.find(agent => agent.sessionId === 'w');
  assert.equal(saved.role, 'developer');
  assert.equal(saved.name, 'Builder');
  assert.equal(saved.description, 'Builder remit');
  await configure(c.runtime, 'w', w.runtime.endpoint.port, 'Builder');
  assert.equal((await c.runtime.store.read()).agents.find(agent => agent.sessionId === 'w').role, 'developer');
  await c.runtime.tool('resume_worker', { to: 'Builder', confirmClosed: true });
  assert.equal(f.launches.length, 1);
  assert.equal(f.launches[0].role, 'developer');
  assert.equal(f.launches[0].agentDir, f.developer);
  assert.equal(f.launches[0].sessionId, 'w');
  assert.equal(f.launches[0].cwd, f.root);
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
  assert.equal(f.launches[1].agentDir, f.verifier);
  assert.equal(f.launches[1].sessionId, 'checker');
});

test('a persisted role removed from configuration does not resume under another Pi home', async t => {
  const f = await setup(t), c = await f.start('c');
  await configure(c.runtime, 'w', 32003, 'Builder', { role: 'architect' });
  await c.runtime.store.update('c', config => { delete config.roles; });
  assert.equal((await c.runtime.store.read()).agents.find(agent => agent.sessionId === 'w').role, 'architect');
  await assert.rejects(c.runtime.tool('resume_worker', { to: 'Builder', confirmClosed: true }), /unknown role architect/);
  assert.equal(f.launches.length, 0);
  await assert.rejects(configure(c.runtime, 'other', 32004, 'Other', { role: 'architect' }), /unknown role architect/);
  assert.equal((await c.runtime.store.read()).agents.some(agent => agent.sessionId === 'other'), false);
});

test('explicit role wins, a saved role survives later edits, and a stale report does not block them', async t => {
  const f = await setup(t), c = await f.start('c');
  const reported = await f.start('w', 'architect');
  const explicit = await configure(c.runtime, 'w', reported.runtime.endpoint.port, 'Builder', { role: 'developer' });
  assert.equal(explicit.role, 'developer');
  assert.equal(explicit.roleNote, undefined);
  const renamed = await configure(c.runtime, 'w', reported.runtime.endpoint.port, 'Renamed');
  assert.equal(renamed.role, 'developer');
  assert.match(renamed.roleNote, /reported role architect differs from persisted role developer; persisted role kept/);
  assert.equal((await c.runtime.store.read()).agents.find(agent => agent.sessionId === 'w').role, 'developer');
  const stale = await f.start('stale', 'verifier');
  await c.runtime.store.update('c', config => { delete config.roles.verifier; });
  await assert.rejects(configure(c.runtime, 'stale', stale.runtime.endpoint.port, 'Checker'), /reported role verifier is not configured/);
  assert.equal((await c.runtime.store.read()).agents.some(agent => agent.sessionId === 'stale'), false);
  const kept = await configure(c.runtime, 'stale', stale.runtime.endpoint.port, 'Checker', { role: 'developer' });
  assert.equal(kept.role, 'developer');
  await c.runtime.store.update('c', config => { delete config.roles.developer; });
  const edited = await configure(c.runtime, 'stale', stale.runtime.endpoint.port, 'Checker');
  assert.equal(edited.role, 'developer');
  assert.match(edited.roleNote, /reported role verifier differs from persisted role developer/);
  const same = await f.start('same', 'architect');
  await configure(c.runtime, 'same', same.runtime.endpoint.port, 'Architect');
  await c.runtime.store.update('c', config => { delete config.roles.architect; });
  const keptArchitect = await configure(c.runtime, 'same', same.runtime.endpoint.port, 'Architect');
  assert.equal(keptArchitect.role, 'architect');
  assert.equal(keptArchitect.roleNote, undefined);
});

test('registration role must be a logical name on the wire', () => {
  const base = { version: 1, kind: 'registration', from: 'w', to: 'c', payload: { port: 1, projectDirectory: '.' } };
  assert.equal(envelope(base).payload.role, undefined);
  assert.equal(envelope({ ...base, payload: { ...base.payload, role: 'developer' } }).payload.role, 'developer');
  for (const role of ['/tmp/dev', '', 'a'.repeat(65), 'has space', 'dev\nx', 1, 'constructor/../x']) {
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
  assert.equal(f.launches.at(-1).agentDir, f.developer);
  assert.equal(f.launches.at(-1).sessionId, 'w');
});
