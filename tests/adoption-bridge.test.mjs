import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { lstat } from 'node:fs/promises';
import extension, { ADOPTION_CHANNEL } from '../dist/index.js';
import { fixture } from './fixtures/adoption-support.mjs';
import { commandContext, IDS } from './fixtures/adoption-fixture.mjs';
import { Intercom } from '../dist/runtime.js';

for (const launch of ['developer', 'metadata-only', 'contradictory']) test(`backend authorization independent of frontend: ${launch}`, async t => {
  const f = await fixture({ runtime: true });
  const runtime = new Intercom({ cwd: f.home, sessionId: () => IDS.fresh, roleDirectory: launch === 'metadata-only' ? '' : path.join(f.home, 'roles', launch === 'developer' ? 'developer' : 'orchestrator'),
    rolesDirectory: path.join(f.home, 'roles'), workerRole: launch === 'contradictory' ? 'developer' : 'orchestrator', busy: () => false, deliver() {}, setName: async () => {}, notify() {} },
  { launch: async () => assert.fail('no launch'), send: async () => { throw Error('fixture no old endpoint'); }, adoption: { projectsHome: f.home, rolesDirectory: path.join(f.home, 'roles') } });
  t.after(async () => { await runtime.close(); await f.dispose(); }); await runtime.start();
  const before = await f.board.read();
  assert.equal((await runtime.adoptCoordinator(f.context, 'adopt')).code, 'AUTH');
  assert.equal(await f.board.read(), before); assert.equal(f.ui.prompts.length, 0);
});

test('real adapter stays read-only while no-board host persists an ordinary non-coordinating turn', async t => {
  const f = await fixture({ runtime: true, noBoard: true });
  const keys = ['PI_ROLE_DIR', 'PI_ROLES_DIR', 'PI_INTERCOM_PROJECTS_HOME', 'PI_INTERCOM_WORKER_ROLE'];
  const prior = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.PI_ROLE_DIR = path.join(f.home, 'roles/orchestrator'); process.env.PI_ROLES_DIR = path.join(f.home, 'roles'); process.env.PI_INTERCOM_PROJECTS_HOME = f.home; delete process.env.PI_INTERCOM_WORKER_ROLE;
  const handlers = new Map(), bus = new Map();
  t.after(async () => { await handlers.get('session_shutdown')?.(); await f.dispose(); for (const [key, value] of Object.entries(prior)) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
  extension({ registerFlag() {}, getFlag: () => undefined, on: (event, handler) => handlers.set(event, handler), registerTool() {}, getSessionName: () => '', setSessionName() {}, sendUserMessage: () => assert.fail('no model turn'),
    events: { on: (channel, handler) => { bus.set(channel, handler); return () => bus.delete(channel); } } });
  const ctx = { ...f.context, sessionManager: { ...f.context.sessionManager, getBranch: () => [] }, ui: { notify() {}, setWidget() {} } };
  await handlers.get('session_start')({}, ctx);
  const offers = []; bus.get(ADOPTION_CHANNEL)({ offers }); assert.equal(offers.length, 1);
  const prompt = await handlers.get('before_agent_start')({ systemPrompt: 'original fixture prompt' }, ctx);
  assert.match(prompt.systemPrompt, /ordinary non-coordinating turn may persist/);
  await handlers.get('agent_start')({}, ctx); await handlers.get('agent_settled')({}, ctx);
  await handlers.get('session_shutdown')();
  await assert.rejects(lstat(path.join(f.home, '.pi-intercom')), { code: 'ENOENT' });
});

test('bridge rejects copied session manager and uses captured UI, never caller dialogs', async t => {
  const f = await fixture({ runtime: true });
  const prior = { role: process.env.PI_ROLE_DIR, roles: process.env.PI_ROLES_DIR, home: process.env.PI_INTERCOM_PROJECTS_HOME, worker: process.env.PI_INTERCOM_WORKER_ROLE };
  process.env.PI_ROLE_DIR = path.join(f.home, 'roles/orchestrator'); process.env.PI_ROLES_DIR = path.join(f.home, 'roles'); process.env.PI_INTERCOM_PROJECTS_HOME = f.home; delete process.env.PI_INTERCOM_WORKER_ROLE;
  t.after(() => { for (const [key, value] of Object.entries({ PI_ROLE_DIR: prior.role, PI_ROLES_DIR: prior.roles, PI_INTERCOM_PROJECTS_HOME: prior.home, PI_INTERCOM_WORKER_ROLE: prior.worker })) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
  const handlers = new Map(), bus = new Map();
  const pi = { registerFlag() {}, getFlag: () => undefined, on: (event, fn) => handlers.set(event, fn), registerTool() {}, getSessionName: () => '', setSessionName() {}, sendUserMessage: () => assert.fail('no model turn'),
    events: { on: (channel, fn) => { bus.set(channel, fn); return () => bus.delete(channel); } } };
  extension(pi);
  const ctx = { ...f.context, ui: { input: async () => undefined, confirm: async () => false, notify() {}, setWidget() {} } };
  await handlers.get('session_start')({}, ctx); t.after(async () => { await handlers.get('session_shutdown')(); await f.dispose(); });
  const offers = []; bus.get(ADOPTION_CHANNEL)({ offers }); assert.equal(offers.length, 1);
  const forged = { ...ctx, sessionManager: { ...ctx.sessionManager } };
  assert.equal((await offers[0].run(forged, 'adopt')).code, 'SESSION_CHANGED');
  const before = await f.board.read();
  const callerUi = { input: async () => assert.fail('caller input must not run'), confirm: async () => assert.fail('caller confirm must not run') };
  const result = await offers[0].run({ ...ctx, ui: callerUi }, 'adopt');
  // This fixture's hand-written session id is not in the actual host's SessionManager.list, so machine
  // evidence refuses before any human decision. In either case, caller authority is never consulted.
  assert.equal(result.ok, false); assert.equal(await f.board.read(), before);
  await handlers.get('session_shutdown')(); assert.equal(bus.has(ADOPTION_CHANNEL), false);
  assert.equal((await offers[0].run(ctx, 'adopt')).code, 'SESSION_CHANGED');
});

// MINOR 3 / issue #12 AC2: the routing seam at runtime. A swapped kind/prompt wiring in adoptionContext
// would otherwise pass every typecheck: this reaches the real interaction through the captured extension
// context, where the only thing a question may touch is the host's own selection dialog.
test('bridge routes the adoption decision to the host selection dialog, with kind and prompt intact', async t => {
  const f = await fixture({ runtime: true, noBoard: true });
  const prior = Object.fromEntries(['PI_ROLE_DIR', 'PI_ROLES_DIR', 'PI_INTERCOM_PROJECTS_HOME', 'PI_INTERCOM_WORKER_ROLE'].map(key => [key, process.env[key]]));
  process.env.PI_ROLE_DIR = path.join(f.home, 'roles/orchestrator');
  process.env.PI_ROLES_DIR = path.join(f.home, 'roles');
  process.env.PI_INTERCOM_PROJECTS_HOME = f.home;
  delete process.env.PI_INTERCOM_WORKER_ROLE;
  const handlers = new Map(), bus = new Map();
  t.after(async () => {
    await handlers.get('session_shutdown')?.(); await f.dispose();
    for (const [key, value] of Object.entries(prior)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  });
  extension({ registerFlag() {}, getFlag: () => undefined, on: (event, handler) => handlers.set(event, handler), registerTool() {}, getSessionName: () => '', setSessionName() {}, sendUserMessage: () => assert.fail('no model turn'),
    events: { on: (channel, handler) => { bus.set(channel, handler); return () => bus.delete(channel); } } });

  const asked = [];
  const forbidden = name => () => assert.fail(`an adoption question must never reach the host ${name} surface`);
  const ctx = {
    ...f.context,
    sessionManager: { ...f.context.sessionManager, getBranch: () => [] },
    ui: {
      notify() {}, setWidget() {},
      // Every other host interaction surface is booby-trapped: the adoption flow must not use one.
      input: forbidden('input'), confirm: forbidden('confirm'), select: forbidden('select'), editor: forbidden('editor'),
      custom: async factory => {
        const component = factory({ terminal: { columns: 80, rows: 24 }, requestRender() {} }, { fg: (_name, value) => value }, {}, () => {});
        asked.push({ title: component.question, paint: component.render(78).join('\n') });
        return undefined;
      },
    },
  };
  await handlers.get('session_start')({}, ctx);
  const offers = []; bus.get(ADOPTION_CHANNEL)({ offers }); assert.equal(offers.length, 1);
  const result = await offers[0].run(ctx, 'adopt');
  assert.equal(asked.length, 1, `expected exactly one routed question, saw ${JSON.stringify(asked.map(entry => entry.title))}`);
  assert.match(asked[0].title, /^Intercom coordinator adoption · boardInitialize\n/, 'the decision kind must survive the adapter');
  assert.match(asked[0].paint, /→ No/, 'the visible selection defaults to No');
  assert.ok(asked[0].title.includes(f.home), 'the question carries the board root');
  assert.ok(asked[0].title.includes(f.id), 'and the session id');
  assert.equal(result.code, 'CANCELLED', 'a dismissed selection ends as a named refusal');
});
