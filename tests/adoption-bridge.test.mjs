import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import extension, { ADOPTION_CHANNEL } from '../dist/index.js';
import { mkdir } from 'node:fs/promises';
import { fixture } from './fixtures/adoption-support.mjs';
import { createFixture, configText } from './fixtures/adoption-fixture.mjs';

// The bridge is a discovery/routing seam, never an authority: the backend independently checks role,
// session identity and the captured context, and every adoption answer comes from the host's own dialog.

for (const launch of ['developer', 'metadata-only', 'contradictory']) test(`backend authorization independent of frontend: ${launch}`, async t => {
  const f = await fixture({ launch });
  t.after(() => f.dispose());
  const before = await f.board.read();
  assert.equal((await f.adopt()).code, 'AUTH');
  assert.equal(await f.board.read(), before);
  assert.equal(f.ui.prompts.length, 0);
});

function fakePi(handlers, bus) {
  return {
    registerFlag() {}, getFlag: () => undefined,
    on: (event, handler) => handlers.set(event, handler),
    registerTool() {}, getSessionName: () => '', setSessionName() {},
    sendUserMessage: () => assert.fail('startup/adoption must not start a model turn'),
    events: { on: (channel, handler) => { bus.set(channel, handler); return () => bus.delete(channel); } },
  };
}

/**
 * The real adapter over a disposable projects-home directory, with the operator environment pinned.
 * This deliberately does NOT use the runtime-backed support fixture: the adapter under test owns the only
 * runtime, so no second process can occupy the saved endpoint.
 */
async function adapter(t, options = {}) {
  const f = await createFixture();
  await mkdir(path.join(f.home, 'roles/orchestrator'), { recursive: true });
  await mkdir(path.join(f.home, 'roles/developer'), { recursive: true });
  if (!options.noBoard) await f.board.write(configText(options.style ?? 'full', f.ports()));
  f.id = 'fresh-orchestrator';
  const keys = ['PI_ROLE_DIR', 'PI_ROLES_DIR', 'PI_INTERCOM_PROJECTS_HOME', 'PI_INTERCOM_WORKER_ROLE'];
  const prior = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.PI_ROLE_DIR = path.join(f.home, 'roles/orchestrator');
  process.env.PI_ROLES_DIR = path.join(f.home, 'roles');
  process.env.PI_INTERCOM_PROJECTS_HOME = f.home;
  delete process.env.PI_INTERCOM_WORKER_ROLE;
  const handlers = new Map(), bus = new Map();
  extension(fakePi(handlers, bus));
  t.after(async () => {
    await handlers.get('session_shutdown')?.().catch(() => {});
    await f.dispose();
    for (const [key, value] of Object.entries(prior)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  });
  const ctx = {
    cwd: f.home, mode: 'tui', hasUI: true, isProjectTrusted: () => true, isIdle: () => true,
    sessionManager: { getSessionId: () => f.id, getBranch: () => [] },
    ui: options.hostUi ?? { notify() {}, setWidget() {} },
  };
  const offers = () => { const payload = { offers: [] }; bus.get(ADOPTION_CHANNEL)(payload); return payload.offers; };
  return { f, handlers, bus, ctx, offers };
}

test('first-board startup through the real adapter: zero questions, zero adoption, board created and loaded', async t => {
  const a = await adapter(t, { noBoard: true });
  await a.handlers.get('session_start')({}, a.ctx);
  // The adoption offer exists for the session, but startup itself never invokes it.
  assert.equal(a.offers().length, 1);
  const config = await new a.f.ConfigStore(a.f.home).read();
  const board = config.agents.find(agent => agent.coordinator);
  assert.equal(board.sessionId, a.f.id);
  assert.ok(board.port > 0);
  // No adoption question was asked at startup: the board was created directly by runtime initialization.
  // The adapter fixture never wires an adoption UI: reaching a question would have failed the test.
  assert.equal(a.offers().length, 1, 'the offer exists but startup did not invoke it');
  const prompt = await a.handlers.get('before_agent_start')({ systemPrompt: 'original fixture prompt' }, a.ctx);
  assert.match(prompt.systemPrompt, /Identity: Coordinator/);
  await a.handlers.get('session_shutdown')();
});

test('bridge rejects a copied session manager and never consults caller dialogs', async t => {
  const a = await adapter(t);
  await a.handlers.get('session_start')({}, a.ctx);
  const offers = a.offers();
  assert.equal(offers.length, 1);
  const forged = { ...a.ctx, sessionManager: { ...a.ctx.sessionManager } };
  assert.equal((await offers[0].run(forged, 'adopt')).code, 'SESSION_CHANGED');
  const before = await a.f.board.read();
  let callerSurfaceUsed = false;
  const callerUi = {
    input: async () => { callerSurfaceUsed = true; },
    confirm: async () => { callerSurfaceUsed = true; },
    select: async () => { callerSurfaceUsed = true; },
    custom: async () => { callerSurfaceUsed = true; },
  };
  // The captured host UI here offers no selection surface, so this is a named HOST refusal; the caller's
  // dialog objects are never invoked whichever answer the captured host would have given.
  const result = await offers[0].run({ ...a.ctx, ui: callerUi }, 'adopt');
  assert.equal(result.ok, false);
  assert.equal(callerSurfaceUsed, false);
  assert.equal(await a.f.board.read(), before);
  await a.handlers.get('session_shutdown')();
  assert.equal(a.bus.has(ADOPTION_CHANNEL), false);
  assert.equal((await offers[0].run(a.ctx, 'adopt')).code, 'SESSION_CHANGED');
});

test('bridge routes the single adoption question to the host selection dialog, kind and prompt intact', async t => {
  const asked = [];
  const forbidden = name => () => assert.fail(`an adoption question must never reach the host ${name} surface`);
  const hostUi = {
    notify() {}, setWidget() {},
    input: forbidden('input'), confirm: forbidden('confirm'), select: forbidden('select'), editor: forbidden('editor'),
    custom: async factory => {
      const component = factory({ terminal: { columns: 80, rows: 24 }, requestRender() {} }, { fg: (_name, value) => value }, {}, () => {});
      asked.push({ title: component.question, paint: component.render(78).join('\n') });
      return undefined; // A dismissal is a decline, never a yes.
    },
  };
  const a = await adapter(t, { hostUi });
  await a.handlers.get('session_start')({}, a.ctx);
  const offers = a.offers();
  assert.equal(offers.length, 1);
  const result = await offers[0].run(a.ctx, 'adopt');
  assert.equal(asked.length, 1, `expected exactly one routed question, saw ${JSON.stringify(asked.map(entry => entry.title))}`);
  assert.match(asked[0].title, /^Intercom coordinator adoption · adoptCoordinator\n/, 'the decision kind must survive the adapter');
  assert.match(asked[0].paint, /→ No/, 'the visible selection defaults to No');
  assert.ok(asked[0].title.includes(a.f.home), 'the question carries the board root');
  assert.ok(asked[0].title.includes(a.f.id), 'and the session id');
  assert.equal(result.code, 'CANCELLED', 'a dismissed selection ends as a named refusal');
  await a.handlers.get('session_shutdown')();
});
