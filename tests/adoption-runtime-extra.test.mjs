// Runtime startup boundaries for ADR 0025: safe-root first-board initialization, board isolation and the
// private boot-only port recovery. These run the real Intercom startup against disposable projects-home
// directories; they never start Pi, a model, a worker or a TUI.
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import { mkdir, lstat, realpath } from 'node:fs/promises';
import { Intercom } from '../dist/runtime.js';
import { ConfigStore } from '../dist/config.js';
import { probeWorker } from '../dist/connections.js';
import { listen } from '../dist/transport.js';
import { createFixture, configText, IDS } from './fixtures/adoption-fixture.mjs';

/** A free loopback port, reserved and released: never a guessed or fixed endpoint. */
async function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); });
  });
}

async function setup(t, options = {}) {
  const f = await createFixture();
  const roles = path.join(f.home, 'roles');
  await mkdir(path.join(roles, 'orchestrator'), { recursive: true });
  if (options.cwdRelative) await mkdir(path.join(f.home, options.cwdRelative), { recursive: true });
  const cwd = options.cwd ?? (options.cwdRelative ? path.join(f.home, options.cwdRelative) : f.home);
  if (options.style) await f.board.write(configText(options.style, f.ports()));
  const runtimes = [];
  t.after(async () => { for (const runtime of runtimes) await runtime.close().catch(() => {}); await f.dispose(); });
  const start = async (id = IDS.fresh, overrides = {}) => {
    const notices = [], events = [], outbound = [];
    const host = {
      cwd, sessionId: () => id, busy: () => false,
      roleDirectory: path.join(roles, 'orchestrator'), rolesDirectory: roles, workerRole: '',
      deliver: () => assert.fail('startup must not start a model turn'), notify: text => notices.push(text), setName: async () => {},
    };
    const runtime = new Intercom(host, {
      launch: async () => assert.fail('startup must not launch a worker'),
      probe: overrides.probe ?? probeWorker,
      send: async (port, message) => { outbound.push({ port, message }); throw new Error('fixture has no destination'); },
      observe: overrides.observe ?? (() => ({ record: (event, metadata) => events.push({ event, metadata }), close: async () => {}, maintain: () => { throw new Error('no maintenance expected'); } })),
      adoption: { projectsHome: options.projectsHome ?? f.home, rolesDirectory: roles },
      ...overrides.runtime,
    });
    runtimes.push(runtime);
    await runtime.start();
    return { runtime, notices, events, outbound };
  };
  const context = { cwd, mode: 'tui', hasUI: true, isProjectTrusted: () => true, isIdle: () => true,
    sessionManager: { getSessionId: () => options.id ?? IDS.fresh }, ui: { confirm: async () => false } };
  return { ...f, cwd, roles, start, context };
}

test('safe-root startup creates the first board with zero questions, then loads responsibility', async t => {
  const f = await setup(t);
  const { runtime, notices } = await f.start();
  const config = await new ConfigStore(f.home).read();
  const board = config.agents.find(agent => agent.coordinator);
  assert.equal(config.agents.length, 1);
  assert.equal(board.sessionId, IDS.fresh);
  assert.equal(board.port, runtime.endpoint.port);
  assert.equal(runtime.responsibility?.coordinator, true);
  assert.deepEqual(notices.filter(text => /question|adopt/i.test(text)), []);
  // No legacy claim or evidence file was created by initialization.
  await assert.rejects(lstat(path.join(f.home, 'coordinator-claim.md')), { code: 'ENOENT' });
  assert.equal((await runtime.adoptCoordinator(f.context, 'status')).code, 'OK');
});

test('an empty root metadata directory is an allowed absence', async t => {
  const f = await setup(t);
  await mkdir(path.join(f.home, '.pi-intercom'), { recursive: true });
  const started = await f.start();
  assert.equal((await new ConfigStore(f.home).read()).agents[0].port, started.runtime.endpoint.port);
  assert.equal(started.runtime.responsibility?.coordinator, true);
});

test('a child directory with no board is held and never gets a private board', async t => {
  const f = await setup(t, { cwdRelative: 'app' });
  const { runtime, notices } = await f.start();
  assert.equal(runtime.responsibility, undefined);
  assert.equal(await runtime.coordinatorActionReady(), false);
  assert.ok(notices.some(text => /private board is never created/.test(text)));
  await assert.rejects(lstat(path.join(f.home, 'app', '.pi-intercom')), { code: 'ENOENT' });
});

test('Orchestrator discovery never reads or writes above the counted projects home', async t => {
  const f = await createFixture();
  const home = path.join(f.home, 'projects');
  await mkdir(home);
  const roles = path.join(f.home, 'roles');
  await mkdir(path.join(roles, 'orchestrator'), { recursive: true });
  await f.board.write(configText('single', f.ports()));
  const before = await f.board.read();
  let discoveries = 0;
  const original = ConfigStore.discover;
  ConfigStore.discover = async cwd => { discoveries++; return original(cwd); };
  t.after(() => { ConfigStore.discover = original; });
  const runtime = new Intercom({ cwd: home, sessionId: () => IDS.fresh, busy: () => false, roleDirectory: path.join(roles, 'orchestrator'), rolesDirectory: roles, workerRole: '',
    deliver: () => assert.fail('no model'), notify() {}, setName: async () => {} },
  { launch: async () => assert.fail('no launch'), adoption: { projectsHome: home, rolesDirectory: roles } });
  t.after(async () => { await runtime.close(); await f.dispose(); });
  await runtime.start();
  assert.equal(discoveries, 0, 'the counted projects home is the only discovery root');
  assert.equal(runtime.store.root, await realpath(home));
  assert.equal(await f.board.read(), before, 'a board above the projects home is untouched');
  // The first board is created at the counted projects home itself, never above it or in a child.
  assert.equal((await new ConfigStore(home).read()).agents[0].sessionId, IDS.fresh);
});

test('boot fallback publishes the verified port before any observer write or responsibility load', async t => {
  const occupied = await listen(0, async () => {}, () => ({ version: 1, sessionId: 'someone-else' }));
  const f = await setup(t, { style: 'single' });
  await f.board.write((await f.board.read()).replace(`"port": ${f.ports().coordinator}`, `"port": ${occupied.port}`));
  const events = [], maintain = [];
  const { runtime } = await f.start(IDS.gone, {
    observe: () => ({ record: (event, metadata) => events.push({ event, metadata }), close: async () => {}, maintain: () => { maintain.push('maintain'); } }),
  });
  await occupied.close();
  assert.notEqual(runtime.endpoint.port, occupied.port);
  const board = (await new ConfigStore(f.home).read()).agents.find(agent => agent.coordinator);
  assert.equal(board.sessionId, IDS.gone);
  assert.equal(board.port, runtime.endpoint.port, 'the verified fallback port was published');
  assert.equal(runtime.responsibility?.coordinator, true, 'responsibility loads only after publication');
  // The observer may only see coordinator events after the exact pair and responsibility are loaded.
  assert.deepEqual(events[0], { event: 'runtime.starting', metadata: {} });
  const portUpdate = events.find(entry => entry.metadata?.operation === 'port_update');
  assert.ok(portUpdate, 'the verified port publication is recorded');
  assert.equal(portUpdate.metadata.port, runtime.endpoint.port);
  assert.ok(events.every(entry => entry.event !== 'config.changed' || entry === events[events.indexOf(portUpdate)]), 'no other config event');
  assert.ok(maintain.length <= 1, 'maintenance cannot precede publication/load');
});

test('same-port startup performs no redundant port write', async t => {
  const saved = await reservePort();
  const f = await setup(t, { style: 'single' });
  await f.board.write((await f.board.read()).replace(`"port": ${f.ports().coordinator}`, `"port": ${saved}`));
  const before = await f.board.read();
  const { runtime, events } = await f.start(IDS.gone);
  assert.equal(runtime.endpoint.port, saved);
  assert.equal(await f.board.read(), before, 'no config write for an already matching port');
  assert.equal(events.some(entry => entry.metadata?.operation === 'port_update'), false);
  assert.equal(runtime.responsibility?.coordinator, true);
});

test('boot fallback refuses when the saved pair still answers at its endpoint', async t => {
  const live = await listen(0, async () => {}, () => ({ version: 1, sessionId: IDS.gone }));
  const f = await setup(t, { style: 'single' });
  await f.board.write((await f.board.read()).replace(`"port": ${f.ports().coordinator}`, `"port": ${live.port}`));
  const before = await f.board.read();
  const { runtime, notices } = await f.start(IDS.gone);
  await live.close();
  assert.notEqual(runtime.endpoint.port, live.port);
  assert.equal(runtime.responsibility, undefined);
  assert.equal(await runtime.coordinatorActionReady(), false);
  assert.ok(notices.some(text => /still answers at its endpoint/.test(text)));
  assert.equal(await f.board.read(), before, 'a live saved pair is never rebound');
});

test('boot fallback refuses an unverifiable own endpoint and runs no later effect', async t => {
  const occupied = await listen(0, async () => {}, () => ({ version: 1, sessionId: 'someone-else' }));
  const f = await setup(t, { style: 'single' });
  await f.board.write((await f.board.read()).replace(`"port": ${f.ports().coordinator}`, `"port": ${occupied.port}`));
  const notMine = async agent => ({ sessionId: agent.sessionId, state: 'unknown', checkedAt: null, reason: 'timeout' });
  const { runtime, notices } = await f.start(IDS.gone, { probe: notMine });
  await occupied.close();
  assert.equal(runtime.responsibility, undefined);
  assert.equal(await runtime.coordinatorActionReady(), false);
  assert.ok(notices.some(text => /did not verify session/.test(text)));
});

test('the legacy directory lock is named at boot and never converted or stolen', async t => {
  const occupied = await listen(0, async () => {}, () => ({ version: 1, sessionId: 'someone-else' }));
  const f = await setup(t, { style: 'single' });
  await f.board.write((await f.board.read()).replace(`"port": ${f.ports().coordinator}`, `"port": ${occupied.port}`));
  await mkdir(path.join(f.home, '.pi-intercom/config.lock'));
  const before = await f.board.read();
  const { runtime, notices } = await f.start(IDS.gone);
  await occupied.close();
  assert.equal(runtime.responsibility, undefined);
  assert.ok(notices.some(text => /obsolete directory lock/.test(text) && /offline upgrade/.test(text)));
  assert.equal(await f.board.read(), before);
  assert.equal((await lstat(path.join(f.home, '.pi-intercom/config.lock'))).isDirectory(), true);
});

test('competing first-board initializers never overwrite the winner and the loser is not promoted', async t => {
  const f = await setup(t);
  const [first, second] = await Promise.all([f.start(IDS.fresh), f.start(IDS.other)]);
  const config = await new ConfigStore(f.home).read();
  const board = config.agents.find(agent => agent.coordinator);
  assert.equal(config.agents.length, 1);
  assert.ok([IDS.fresh, IDS.other].includes(board.sessionId));
  const winner = board.sessionId === IDS.fresh ? first : second;
  const loser = winner === first ? second : first;
  assert.equal(winner.runtime.responsibility?.sessionId, board.sessionId);
  assert.equal(loser.runtime.responsibility, undefined, 'a losing initializer claims no authority');
  assert.equal(await loser.runtime.coordinatorActionReady(), false);
});

test('a child cwd is held even when the projects home already has empty metadata', async t => {
  const f = await setup(t, { cwdRelative: 'app' });
  // The metadata directory exists at the projects home, but there is no config: still not a child board.
  await mkdir(path.join(f.home, '.pi-intercom'), { recursive: true });
  const { runtime, notices } = await f.start();
  assert.equal(runtime.responsibility, undefined);
  assert.equal(await runtime.coordinatorActionReady(), false);
  assert.ok(notices.some(text => /private board is never created/.test(text)));
  await assert.rejects(lstat(path.join(f.home, '.pi-intercom/config.json')), { code: 'ENOENT' });
  await assert.rejects(lstat(path.join(f.home, 'app', '.pi-intercom')), { code: 'ENOENT' });
});

test('a second board appearing during the boot probe stops the port publication', async t => {
  const occupied = await listen(0, async () => {}, () => ({ version: 1, sessionId: 'foreign' }));
  const f = await setup(t, { style: 'single', cwdRelative: 'app' });
  await f.board.write((await f.board.read()).replace(`"port": ${f.ports().coordinator}`, `"port": ${occupied.port}`));
  const before = await f.board.read();
  const probe = async (agent, options) => {
    if (agent.port === occupied.port) await mkdir(path.join(f.home, 'app', '.pi-intercom'), { recursive: true });
    return probeWorker(agent, options);
  };
  const { runtime, notices } = await f.start(IDS.gone, { probe });
  await occupied.close();
  assert.equal(runtime.responsibility, undefined);
  assert.equal(await runtime.coordinatorActionReady(), false);
  assert.ok(notices.some(text => /ancestor board layout changed during boot/.test(text)));
  assert.equal(await f.board.read(), before, 'the fallback port was not published');
});

test('a revocation during handoff recovery blocks maintenance and the ready notice', async t => {
  const f = await setup(t, { style: 'single' });
  const before = await f.board.read();
  const replacement = (() => { const c = JSON.parse(before); c.agents[0].sessionId = 'another-coordinator'; c.agents[0].port = 43113; return JSON.stringify(c); })();
  let maintained = 0; const notices = [];
  class RevokingIntercom extends Intercom {
    startServices(guard) {
      super.startServices(guard);
      this.handoff.recover = async () => { await f.board.write(replacement); };
    }
  }
  const roles = f.roles;
  const runtime = new RevokingIntercom({ cwd: f.home, sessionId: () => IDS.gone, busy: () => false,
    roleDirectory: path.join(roles, 'orchestrator'), rolesDirectory: roles, workerRole: '',
    deliver: () => {}, notify: text => notices.push(text), setName: async () => {} },
  { launch: async () => assert.fail('no launch'), probe: probeWorker,
    observe: () => ({ record() {}, close: async () => {}, maintain: () => { maintained++; } }),
    adoption: { projectsHome: f.home, rolesDirectory: roles } });
  t.after(() => runtime.close());
  await runtime.start();
  assert.equal(maintained, 0, 'maintenance must not run after the pair is revoked during recovery');
  assert.equal(await runtime.coordinatorActionReady(), false);
  assert.ok(notices.some(text => /stopped naming this exact pair during boot recovery/.test(text)));
  assert.ok(!notices.some(text => /Coordinator ready/.test(text)));
});

test('malformed existing config stops startup with no write and no implicit repair', async t => {
  const f = await setup(t);
  await f.board.write('{ "version": 1, "agents": [');
  const before = await f.board.read();
  await assert.rejects(f.start(), /malformed JSON/);
  assert.equal(await f.board.read(), before);
});
