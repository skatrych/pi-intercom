// Version-specific offline evidence, NOT a production dependency or a real-host AC5 proof.
// Uses the pinned Pi 1.4.0 AgentSession, ExtensionRunner, Agent and in-memory SessionManager.
// Only resources, model runtime/auth, UI and stream transport are fabricated. No SDK discovery,
// filesystem session persistence, real HOME fallback, credentials, network provider or installation.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import extension from '../../dist/index.js';
import { Intercom } from '../../dist/runtime.js';
import { createFixture } from './adoption-fixture.mjs';
import { commitFirstDeclaration } from './wakeup-fixture.mjs';

export const MINUTE = 60_000;
export const drain = () => new Promise(resolve => setImmediate(resolve));
export async function until(condition) {
  const bound = Date.now() + 5000;
  while (!condition()) { assert.ok(Date.now() < bound, 'native dispatcher did not reach expected step'); await drain(); }
}
export function gate() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

export async function nativeHost(t) {
  const home = await mkdtemp(path.join(tmpdir(), 'intercom-native-home-'));
  let fixtureHome, session;
  const cleanupGates = [];
  const keys = ['HOME', 'USERPROFILE', 'PI_CODING_AGENT_DIR', 'PI_OFFLINE', 'PI_ROLE_DIR', 'PI_ROLES_DIR', 'PI_INTERCOM_PROJECTS_HOME', 'PI_INTERCOM_WORKER_ROLE', 'HERDR_ENV', 'PI_INTERCOM_REMINDER_FILE', 'PI_INTERCOM_REMINDER_MINUTES'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  t.after(async () => {
    try {
      for (const pending of cleanupGates) pending.release();
      if (session) {
        try { await session.abort(); await session._extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' }); }
        finally { session.dispose(); }
      }
    } finally {
      if (fixtureHome) await rm(fixtureHome, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
      for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
  });
  process.env.HOME = home; process.env.USERPROFILE = home;
  process.env.PI_CODING_AGENT_DIR = path.join(home, 'agent'); process.env.PI_OFFLINE = '1';
  // Import only AFTER fabricating HOME/agent directory. Dependency imports cannot fall back to real HOME.
  const requireHost = createRequire(import.meta.resolve('pi-wakeup-test-host'));
  const manifest = requireHost('../package.json');
  assert.equal(manifest.version, '1.4.0');
  const host = await import('pi-wakeup-test-host');
  const { Agent } = await import(pathToFileURL(path.join(path.dirname(requireHost.resolve('@earendil-works/pi-agent-core/package.json')), 'dist/index.js')).href);
  const f = await createFixture();
  fixtureHome = f.home;
  const manager = host.SessionManager.inMemory(f.home);
  await commitFirstDeclaration(f, { sessionId: manager.getSessionId(), port: await freePort(), claim: true });
  process.env.PI_ROLE_DIR = path.join(f.home, 'roles/orchestrator');
  process.env.PI_ROLES_DIR = path.join(f.home, 'roles');
  process.env.PI_INTERCOM_PROJECTS_HOME = f.home;
  process.env.PI_INTERCOM_REMINDER_MINUTES = '1';
  for (const key of ['PI_INTERCOM_WORKER_ROLE', 'HERDR_ENV', 'PI_INTERCOM_REMINDER_FILE']) delete process.env[key];
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let intercom;
  const originalStart = Intercom.prototype.start;
  t.mock.method(Intercom.prototype, 'start', function (...args) { intercom = this; return originalStart.apply(this, args); });
  const bus = host.createEventBus();
  const submissions = [], errors = [], notices = [], observed = [], requests = [];
  function registrations() {
    const runtime = host.createExtensionRuntime();
    const ext = { path: '<fabricated-intercom>', resolvedPath: '<fabricated-intercom>', handlers: new Map(), tools: new Map(), commands: new Map(), shortcuts: new Map(), flags: new Map(), messageRenderers: new Map() };
    const pi = {
      on(name, handler) { const handlers = ext.handlers.get(name) ?? []; handlers.push(handler); ext.handlers.set(name, handlers); },
      registerTool(tool) { ext.tools.set(tool.name, { definition: tool, extensionPath: ext.path }); },
      registerFlag() {}, getFlag: () => undefined, events: bus,
      getSessionName: () => runtime.getSessionName(), setSessionName: name => runtime.setSessionName(name),
      sendMessage(message, options) { submissions.push({ message, options }); return runtime.sendMessage(message, options); },
      sendUserMessage() { assert.fail('wake-up must not use an explicit user/steering fallback'); },
    };
    extension(pi);
    return { runtime, ext };
  }
  let loaded = registrations();
  const model = { id: 'offline-script', name: 'offline-script', provider: 'fixture', api: 'fixture', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 1000 };
  const state = { hold: undefined, reason: 'stop', text: 'offline scripted response', errorMessage: 'offline scripted failure', failPreparation: false };
  const streamFn = (_model, context, options) => {
    requests.push(context.messages);
    const done = gate();
    const stream = {
      async *[Symbol.asyncIterator]() { yield await done.promise; },
      result: async () => { const event = await done.promise; return event.message ?? event.error; },
    };
    void (async () => {
      if (state.hold) await Promise.race([state.hold.promise, new Promise(resolve => options.signal?.addEventListener('abort', resolve, { once: true }))]);
      const reason = options.signal?.aborted ? 'aborted' : state.reason;
      const message = { role: 'assistant', content: [{ type: 'text', text: state.text }], api: 'fixture', provider: 'fixture', model: model.id, stopReason: reason, timestamp: Date.now(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, ...(reason === 'error' ? { errorMessage: state.errorMessage } : {}) };
      done.release(reason === 'error' || reason === 'aborted' ? { type: 'error', reason, error: message } : { type: 'done', reason, message });
    })();
    return stream;
  };
  const agent = new Agent({ initialState: { model, tools: [], systemPrompt: 'Offline fixture' }, streamFn, convertToLlm: host.convertToLlm });
  const settings = host.SettingsManager.inMemory({ compaction: { enabled: false, reserveTokens: 100, keepRecentTokens: 100 }, retry: { enabled: false, maxRetries: 1, baseDelayMs: 120_000, maxAgentDelayMs: 120_000 } });
  // Explicit trust is fabricated fixture metadata, never inferred from a production config.
  settings.isProjectTrusted = () => true;
  const resources = {
    getExtensions: () => ({ extensions: [loaded.ext], runtime: loaded.runtime, errors: [] }),
    reload: async () => { loaded = registrations(); },
    getSystemPrompt: () => 'Offline fixture', getAppendSystemPrompt: () => [],
    getSkills: () => ({ skills: [], diagnostics: [] }), getAgentsFiles: () => ({ agentsFiles: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
  };
  const modelRuntime = { getModel: () => model, getPhysicalModel: () => model, getAvailableSnapshot: () => [model], getAll: () => [model], getAuth: () => { assert.fail('no real authentication path'); }, isUsingOAuth: () => false };
  session = new host.AgentSession({ agent, sessionManager: manager, settingsManager: settings, resourceLoader: resources, modelRuntime, cwd: f.home, baseToolsOverride: {}, initialActiveToolNames: [] });
  await session.bindExtensions({ mode: 'tui', uiContext: { notify: (text, level) => notices.push({ text, level }), setStatus() {}, setWidget() {} }, onError: error => errors.push(error) });
  const runner = session._extensionRunner;
  // Preparation failure is a failing resource/preparation seam, not fabricated settlement events.
  const prepare = session._preparePromptAndToolLoadout.bind(session);
  session._preparePromptAndToolLoadout = (...args) => { if (state.failPreparation) throw new Error('offline prepared-run failure'); return prepare(...args); };
  session.subscribe(event => observed.push(event));
  return { session, agent, manager, runner, get runtime() { return loaded.runtime; }, get intercom() { return intercom; }, state, submissions, notices, errors, observed, requests, tick: ms => t.mock.timers.tick(ms),
    gate() { const pending = gate(); cleanupGates.push(pending); return pending; },
    on(name, handler) { const handlers = loaded.ext.handlers.get(name) ?? []; handlers.push(handler); loaded.ext.handlers.set(name, handlers); },
    async drained() { await until(() => !intercom.reminders.checking); },
  };
}
