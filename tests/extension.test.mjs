import test from 'node:test';
import assert from 'node:assert/strict';
import extension from '../dist/index.js';
import { mkdtemp, mkdir, rm, access, writeFile, readFile } from 'node:fs/promises';
import { Server } from 'node:net';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ConfigStore } from '../dist/config.js';
import { Intercom } from '../dist/runtime.js';
import { listen, send } from '../dist/transport.js';
import { readObservationSnapshot } from '../dist/snapshot.js';
import { ADOPTION_CHANNEL, ADOPTION_PROTOCOL } from '../dist/index.js';
import { REMINDER_TEXT } from '../dist/reminders.js';
import { REMINDER_CONFIGURATION_DIAGNOSTIC, REMINDER_FILE_ENV } from '../dist/reminder-content.js';

// These exercise the Windows/Linux adapter, but never construct a Pi host or launch a process.
async function adapter(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'intercom-quality-adapter-'));
  const inheritedHerdr = process.env.HERDR_ENV;
  delete process.env.HERDR_ENV;
  const tools = new Map(), events = new Map(), flags = new Map(), flagValues = new Map(), messages = [], notices = [], names = [], widgets = [];
  const channels = new Map();
  // Pi's public event bus delivers synchronously to handlers that return before their first await.
  const bus = {
    on: (channel, handler) => {
      const handlers = channels.get(channel) ?? new Set();
      handlers.add(handler); channels.set(channel, handlers);
      return () => { handlers.delete(handler); if (!handlers.size) channels.delete(channel); };
    },
    emit: (channel, data) => { for (const handler of [...(channels.get(channel) ?? [])]) handler(data); },
  };
  let id = 'adapter-coordinator', idle = true, name = '', failName = false;
  const pi = {
    registerTool: tool => tools.set(tool.name, tool), on: (event, handler) => events.set(event, handler), events: bus,
    registerFlag: (name, options) => flags.set(name, options), getFlag: name => flagValues.get(name),
    getSessionName: () => name,
    setSessionName: value => { if (failName) throw new Error('injected name failure'); name = value; names.push(value); },
    sendUserMessage: (content, options) => messages.push({ content, options }),
  };
  extension(pi);
  const ctx = { cwd: root, mode: 'tui', isProjectTrusted: () => true, isIdle: () => idle,
    sessionManager: { getSessionId: () => id, getBranch: () => [], getSessionFile: () => undefined }, ui: { notify: (text, level) => notices.push({ text, level }),
      setWidget: (...args) => widgets.push(args) } };
  t.after(async () => {
    try { await events.get('session_shutdown')(); }
    finally {
      if (inheritedHerdr === undefined) delete process.env.HERDR_ENV; else process.env.HERDR_ENV = inheritedHerdr;
      await rm(root, { recursive: true, force: true });
    }
  });
  return { root, ctx, tools, events, flags, messages, notices, names, widgets,
    setRootFlag: value => flagValues.set('intercom-root', value),
    // What a role-local frontend sees: exactly the offers registered so far, without invoking any.
    adoptionOffers: () => { const payload = { offers: [] }; bus.emit(ADOPTION_CHANNEL, payload); return payload.offers; },
    setId: value => { id = value; }, setIdle: value => { idle = value; }, failName: value => { failName = value; },
    setDelivery: deliver => { pi.sendUserMessage = deliver; },
    start: () => events.get('session_start')({}, ctx),
    prompt: () => events.get('before_agent_start')({ systemPrompt: 'Original system prompt' }, ctx),
    invoke: (operation, args = {}) => tools.get(`intercom_${operation}`).execute('test', args, undefined, undefined, ctx) };
}
const supportedHost = { skip: !['win32', 'linux'].includes(process.platform) ? 'Windows/Linux extension startup adapter' : false };

test('adapter without root flag ignores ancestor config and inherited root env', supportedHost, async t => {
  const a = await adapter(t), store = new ConfigStore(a.root);
  await store.initialize({ sessionId: 'parent-coordinator', port: 12345 });
  const before = await readFile(store.file, 'utf8');
  const child = path.join(a.root, 'independent-child'); await mkdir(child);
  const oldEnv = process.env.PI_INTERCOM_ROOT;
  process.env.PI_INTERCOM_ROOT = a.root;
  t.after(() => { if (oldEnv === undefined) delete process.env.PI_INTERCOM_ROOT; else process.env.PI_INTERCOM_ROOT = oldEnv; });
  a.ctx.cwd = child; await a.start();
  assert.equal((await new ConfigStore(child).read()).agents[0].sessionId, 'adapter-coordinator');
  assert.equal(await readFile(store.file, 'utf8'), before);
  assert.match((await a.prompt()).systemPrompt, /Identity: Coordinator/);
});
test('explicit CLI root equal to cwd survives replacement; a descendant cwd binds the same board', supportedHost, async t => {
  const a = await adapter(t), registrations = [];
  const coordinator = await listen(undefined, async message => { registrations.push(message); });
  t.after(() => coordinator.close());
  await new ConfigStore(a.root).initialize({ sessionId: 'workspace-coordinator', port: coordinator.port });
  a.setRootFlag(a.root); a.setId('same-root-worker'); await a.start();
  assert.equal(registrations[0].from, 'same-root-worker');
  assert.match((await a.prompt()).systemPrompt, /Anonymous\/unloaded worker/);
  a.setId('replacement-worker'); await a.start();
  assert.equal(registrations.at(-1).from, 'replacement-worker');
  const child = path.join(a.root, "worker O'Brien"); await mkdir(child);
  // The subfolder session binds the ancestor board it was launched with; it never creates its own.
  a.ctx.cwd = child; await a.start();
  await assert.rejects(a.invoke('list'), /no coordinator privileges/);
  assert.equal(a.notices.filter(notice => notice.level === 'error').length, 0);
  await assert.rejects(access(path.join(child, '.pi-intercom')), /ENOENT/);
});
test('explicit ancestor root is admitted: the ancestor board is read and no child config is created', supportedHost, async t => {
  const a = await adapter(t), store = new ConfigStore(a.root);
  await store.initialize({ sessionId: 'parent-coordinator', port: 12345 });
  const before = await readFile(store.file, 'utf8');
  const child = path.join(a.root, 'child'); await mkdir(child);
  a.ctx.cwd = child; a.setRootFlag(a.root);
  const originalRead = ConfigStore.prototype.read;
  let reads = 0;
  ConfigStore.prototype.read = async function() { reads++; return originalRead.call(this); };
  try { await a.start(); }
  finally { ConfigStore.prototype.read = originalRead; }
  assert.ok(reads > 0, 'the ancestor board is the session config');
  assert.equal(a.notices.filter(notice => notice.level === 'error').length, 0);
  // Admitted as a worker: no coordinator authority, and nothing is written to the child directory.
  await assert.rejects(a.invoke('list'), /no coordinator privileges/);
  assert.equal(await readFile(store.file, 'utf8'), before);
  await assert.rejects(access(path.join(child, '.pi-intercom')), /ENOENT/);
});
test('empty, relative or configless explicit roots never fall back or start a listener', supportedHost, async t => {
  const a = await adapter(t), originalListen = Server.prototype.listen;
  Server.prototype.listen = function() { assert.fail('invalid root must fail before listening'); };
  try {
    for (const root of ['', '.', a.root]) {
      a.setRootFlag(root); await a.start();
      await assert.rejects(a.invoke('list'), /not initialized/);
      await assert.rejects(access(path.join(a.root, '.pi-intercom')), /ENOENT/);
    }
  } finally { Server.prototype.listen = originalListen; }
});

test('empty roster skips monitor; first registered worker requests it without probing liveness', supportedHost, async t => {
  const a = await adapter(t); await a.start();
  assert.equal(a.widgets.length, 0);
  assert.equal(a.messages.length, 0);
  assert.equal(a.notices.some(n => /monitor|Herdr/i.test(n.text)), false);
  await a.invoke('configure_worker', {sessionId:'saved-worker',name:'Builder',description:'Saved worker',port:12346,projectDirectory:'.'});
  assert.ok(a.notices.some(n => /not inside Herdr/.test(n.text)));
  await a.invoke('send', {to:'Coordinator',message:'Messaging works without monitor'});
  assert.equal(a.messages.length, 1);
  const count = a.notices.filter(n => /monitor|Herdr/i.test(n.text)).length;
  a.setId('monitor-replacement-worker'); await a.start();
  assert.equal(a.widgets.length, 0);
  assert.equal(a.notices.filter(n => /monitor|Herdr/i.test(n.text)).length, count, 'worker sessions do not request a monitor');
});

test('startup with a saved disconnected worker still requests monitor without renaming coordinator', supportedHost, async t => {
  const a = await adapter(t), store = new ConfigStore(a.root);
  await store.initialize({ sessionId: 'adapter-coordinator', port: 12345 });
  await store.configure({ sessionId: 'adapter-coordinator', port: 12345 }, {sessionId:'offline-worker',name:'Offline',description:'Retained worker',port:12346,projectDirectory:'.'});
  await a.start();
  assert.ok(a.notices.some(n => /not inside Herdr/.test(n.text)));
  assert.deepEqual(a.names, []);
});

test('phase telemetry uses only public discriminants and never reads reasoning or tool payloads', supportedHost, async t => {
  const a = await adapter(t); await a.start();
  await a.events.get('agent_start')({}, a.ctx);
  const privatePayload = { get delta() { assert.fail('must not read reasoning'); }, type: 'thinking_delta' };
  await a.events.get('message_update')({ assistantMessageEvent: privatePayload, get message() { assert.fail('must not read message'); } }, a.ctx);
  await a.events.get('message_update')({ assistantMessageEvent: privatePayload }, a.ctx);
  await a.events.get('tool_execution_start')({ toolCallId: 't', toolName: 'read', get args() { assert.fail('must not read arguments'); } }, a.ctx);
  await a.events.get('tool_execution_end')({ toolCallId: 't', get result() { assert.fail('must not read result'); } }, a.ctx);
  await a.events.get('agent_settled')({}, a.ctx);
  await a.events.get('session_shutdown')();
  const snapshot = await readObservationSnapshot(a.root);
  const phases = snapshot.events.filter(e => e.event === 'host.activity');
  assert.deepEqual(phases.map(e => [e.phase, e.detail]), [
    ['working', 'processing'], ['thinking', 'thinking'], ['tool', 'reading_files'], ['working', 'processing'], ['idle', 'settled'],
  ]);
});

test('handoff settlement observes only persisted successful tool IDs and new input invalidates readiness', supportedHost, async t => {
  const a = await adapter(t); await a.start();
  const originalSettled = Intercom.prototype.workerSettled, originalStarted = Intercom.prototype.workerStarted;
  let ids, invalidations = 0;
  Intercom.prototype.workerSettled = function(value) { ids = [...value]; };
  Intercom.prototype.workerStarted = function() { invalidations++; };
  t.after(() => { Intercom.prototype.workerSettled = originalSettled; Intercom.prototype.workerStarted = originalStarted; });
  const privateBody = () => assert.fail('must not inspect message bodies or reasoning');
  a.ctx.sessionManager.getBranch = () => [
    {type:'message',message:{role:'assistant',get content(){return privateBody();}}},
    {type:'message',message:{role:'toolResult',toolCallId:'saved',isError:false,get content(){return privateBody();}}},
    {type:'message',message:{role:'toolResult',toolCallId:'failed',isError:true,get content(){return privateBody();}}},
    {type:'custom',get message(){return privateBody();}},
  ];
  await a.events.get('input')({},a.ctx);
  await a.events.get('agent_start')({},a.ctx);
  await a.events.get('agent_settled')({},a.ctx);
  assert.equal(invalidations,2); assert.deepEqual(ids,['saved']);
});

test('single extension registers all agreed tools without starting resources in factory', async () => {
  const tools = new Map(), events = new Map(), flags = new Map(), channels = new Map();
  const factoryBus = {
    on: (channel, handler) => { channels.set(channel, handler); return () => channels.delete(channel); },
    emit: (channel, data) => channels.get(channel)?.(data),
  };
  // Factory registration registers tools, session event handlers, and one adoption service listener.
  // It starts no resources, opens no listener, writes no config, and invokes no adoption.
  extension({ registerTool: t => tools.set(t.name, t), on: (name, handler) => events.set(name, handler), events: factoryBus,
    registerFlag: (name, options) => flags.set(name, options), getFlag: () => assert.fail('flags resolve only during session_start') });
  assert.equal(flags.get('intercom-root').type, 'string');
  assert.equal(flags.get('intercom-root').default, undefined);
  assert.equal(tools.size, 16);
  assert.deepEqual([...channels.keys()], [ADOPTION_CHANNEL]);
  assert.equal(ADOPTION_CHANNEL, 'intercom:coordinator-adoption:v1');
  assert.equal(ADOPTION_PROTOCOL, 1);
  assert.deepEqual([...events.keys()], ['session_start', 'session_shutdown', 'input', 'agent_start', 'agent_settled', 'message_update', 'tool_execution_start', 'tool_execution_end', 'before_agent_start']);
  const configure = tools.get('intercom_configure_worker');
  assert.deepEqual([...configure.parameters.required].sort(), ['description', 'name', 'port', 'projectDirectory', 'sessionId']);
  const create = tools.get('intercom_create_worker');
  assert.equal(create.parameters.properties.role.type, 'string');
  assert.equal((create.parameters.required ?? []).includes('role'), false);
  assert.equal(configure.parameters.properties.role.type, 'string');
  assert.equal(configure.parameters.required.includes('role'), false);
  assert.match(create.description, /pi-role/);
  assert.match(create.description, /does not change PI_CODING_AGENT_DIR/);
  assert.match(tools.get('intercom_stop_worker').description, /disabled/);
  assert.match(tools.get('intercom_reload_worker').description, /NOT Pi extension reload/);
  assert.match(tools.get('intercom_stop_reminders').description, /Coordinator only/);
  assert.deepEqual(Object.keys(tools.get('intercom_stop_reminders').parameters.properties), []);
  await assert.rejects(tools.get('intercom_list').execute('test', {}, undefined, undefined, {}), /not initialized/);
  // Before any session starts, discovery yields no runnable service, and a malformed payload is ignored.
  const beforeStart = { offers: [] };
  factoryBus.emit(ADOPTION_CHANNEL, beforeStart);
  assert.equal(beforeStart.offers.length, 1);
  const refused = await beforeStart.offers[0].run({ sessionManager: { getSessionId: () => 'anything' } }, 'status');
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'SESSION_CHANGED');
  assert.equal(refused.exitCode, 1);
  await events.get('session_shutdown')();
  await events.get('session_shutdown')();
});

test('reminder stop tool routes through runtime with the owning cancellation signal', supportedHost, async t => {
  const a = await adapter(t); await a.start();
  const original = Intercom.prototype.tool;
  const controller = new AbortController();
  let received;
  Intercom.prototype.tool = async function(operation, args, id, signal) {
    received = { operation, args, id, signal };
    return { stopped: true };
  };
  t.after(() => { Intercom.prototype.tool = original; });
  const tool = a.tools.get('intercom_stop_reminders');
  const result = await tool.execute('stop-test', {}, controller.signal, undefined, a.ctx);
  assert.deepEqual(received, { operation: 'stop_reminders', args: {}, id: 'stop-test', signal: controller.signal });
  assert.deepEqual(JSON.parse(result.content[0].text), { stopped: true });
  received = undefined; controller.abort();
  await assert.rejects(tool.execute('cancelled', {}, controller.signal, undefined, a.ctx), /abort/i);
  assert.equal(received, undefined, 'an already-cancelled tool must not reach runtime');
});

test('adapter rejects untrusted/noninteractive startup before creating config', supportedHost, async t => {
  const a = await adapter(t);
  a.ctx.isProjectTrusted = () => false;
  await assert.rejects(a.start(), /trust/);
  await assert.rejects(access(path.join(a.root, '.pi-intercom', 'config.json')), /ENOENT/);
  await assert.rejects(a.invoke('list'), /not initialized/);
  a.ctx.isProjectTrusted = () => true; a.ctx.mode = 'rpc';
  await assert.rejects(a.start(), /interactive/);
  await assert.rejects(access(path.join(a.root, '.pi-intercom', 'config.json')), /ENOENT/);
  assert.equal(a.messages.length, 0);
});

test('adapter startup is passive, adds responsibility, routes idle/steering and replaces session listener', supportedHost, async t => {
  const a = await adapter(t); await a.start();
  assert.equal(a.messages.length, 0);
  assert.deepEqual(a.names, []);
  const prompt = await a.prompt();
  assert.match(prompt.systemPrompt, /^Original system prompt/);
  assert.match(prompt.systemPrompt, /Identity: Coordinator \(adapter-coordinator\)/);
  assert.match(prompt.systemPrompt, /Responsibility is not a work assignment/);
  const store = new ConfigStore(a.root), old = (await store.read()).agents[0];
  await a.invoke('send', { to: 'Coordinator', message: 'Idle message' });
  assert.deepEqual(a.messages.at(-1).options, { deliverAs: 'steer' });
  a.setIdle(false);
  await a.invoke('send', { to: 'Coordinator', message: 'Busy message' });
  assert.deepEqual(a.messages.at(-1).options, { deliverAs: 'steer' });
  // A replaced session must not inherit the old coordinator role or listener.
  a.setId('replacement-worker');
  await a.start();
  await assert.rejects(a.invoke('create_worker'), /permission/);
  assert.match((await a.prompt()).systemPrompt, /Anonymous\/unloaded worker/);
  await assert.rejects(send(old.port, { version: 1, kind: 'message', from: old.sessionId, to: old.sessionId,
    payload: { message: 'Must not reach old session' } }));
  await a.events.get('session_shutdown')();
  await assert.rejects(a.invoke('list'), /not initialized/);
  assert.equal(await a.prompt(), undefined);
});

test('adapter always supplies steering: installed host keeps idle normal and handles idle-snapshot to busy-acceptance race', supportedHost, async t => {
  // Source-backed mocked compatibility probe, not a live Pi session. Deliberately
  // fail if the pinned host changes this branch rather than testing stale copied behavior.
  const hostSource = await readFile(fileURLToPath(new URL('./core/agent-session.js', import.meta.resolve('@earendil-works/pi-coding-agent'))), 'utf8');
  assert.match(hostSource, /streamingBehavior: options\?\.deliverAs/);
  const start = hostSource.indexOf('// If streaming, queue via steer()');
  const end = hostSource.indexOf('// Flush any pending bash', start);
  assert.ok(start >= 0 && end > start, 'installed prompt streaming branch must remain identifiable');
  const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
  const accept = new AsyncFunction('options', 'expandedText', 'currentImages',
    `const preflightResult = undefined; ${hostSource.slice(start, end)} return 'normal idle prompt continues';`);
  const queued = [], host = { isStreaming: true,
    _queueSteer: async text => { queued.push(text); },
    _queueFollowUp: async () => assert.fail('must not switch to follow-up delivery') };
  await assert.rejects(accept.call(host, undefined, 'negative control'), /Agent is already processing/);
  const a = await adapter(t); await a.start();
  const submissions = [];
  let busyAtAcceptance = false;
  a.setDelivery((content, options) => {
    // Pi can await input hooks after Intercom samples isIdle; another message can
    // start processing there. Reproduce that change without launching any host.
    submissions.push(Promise.resolve().then(() => {
      host.isStreaming = busyAtAcceptance;
      return accept.call(host, { streamingBehavior: options?.deliverAs }, content);
    }).then(value => ({ value }), error => ({ error })));
  });
  await a.invoke('send', { to: 'Coordinator', message: 'Idle normal prompt' });
  assert.deepEqual(await submissions[0], { value: 'normal idle prompt continues' });
  assert.equal(queued.length, 0, 'explicit steering does not queue when host is idle');
  // ctx.isIdle remains true: the runtime snapshot is deliberately stale.
  busyAtAcceptance = true;
  await a.invoke('send', { to: 'Coordinator', message: 'Race-safe incoming prompt' });
  assert.equal((await submissions[1]).error, undefined);
  assert.equal(queued.length, 1); assert.match(queued[0], /Race-safe incoming prompt/);
});

test('adapter anonymous configure/reload loads responsibility without a work turn; name errors remain explicit', supportedHost, async t => {
  const a = await adapter(t), registrations = [];
  const coordinator = await listen(undefined, async message => { registrations.push(message); });
  t.after(() => coordinator.close());
  const store = new ConfigStore(a.root); await store.initialize({ sessionId: 'other-coordinator', port: coordinator.port });
  a.setId('adapter-worker'); await a.start();
  assert.equal(registrations.length, 1); assert.equal(registrations[0].kind, 'registration');
  assert.match((await a.prompt()).systemPrompt, /Anonymous\/unloaded worker/);
  const workerPort = registrations[0].payload.port;
  await store.configure({ sessionId: 'other-coordinator', port: coordinator.port }, { sessionId: 'adapter-worker', name: 'Quality', port: workerPort,
    projectDirectory: '.', description: 'Only review explicitly assigned work' });
  assert.match((await a.prompt()).systemPrompt, /Anonymous\/unloaded worker/);
  const control = { version: 1, kind: 'reload', from: 'other-coordinator', to: 'adapter-worker', payload: {} };
  a.failName(true);
  await assert.rejects(send(workerPort, control), /injected name failure/);
  assert.equal(a.messages.length, 0);
  assert.match((await a.prompt()).systemPrompt, /Only review explicitly assigned work/);
  // Failed name sync leaves useful endpoint and loaded responsibility intact, with explicit reload recovery.
  a.failName(false); await send(workerPort, control);
  assert.deepEqual(a.names, ['Quality']);
  assert.equal(a.messages.length, 0);
  await send(workerPort, { ...control, kind: 'message', payload: { message: 'Explicit review task' } });
  assert.equal(a.messages.length, 1);
  assert.match(a.messages[0].content, /Explicit review task/);
});

test('coordinator startup opens only the messaging listener and activity hooks stay passive', supportedHost, async t => {
  const a = await adapter(t), bound = [];
  const originalListen = Server.prototype.listen;
  Server.prototype.listen = function(...args) {
    this.once('listening', () => { const address = this.address(); if (address && typeof address !== 'string') bound.push(address.port); });
    return originalListen.apply(this, args);
  };
  try { await a.start(); } finally { Server.prototype.listen = originalListen; }
  const config = await new ConfigStore(a.root).read();
  assert.deepEqual(bound, [config.agents[0].port]);
  assert.equal(a.notices.some(n => /read-only dashboard:|http:\/\//.test(n.text)), false);
  const list = JSON.parse((await a.invoke('list')).content[0].text);
  assert.equal(list.dashboardUrl, undefined);
  a.setIdle(false);
  await a.events.get('agent_start')({ message: 'PRIVATE_EVENT_BODY' }, a.ctx);
  a.setIdle(true);
  await a.events.get('agent_settled')({ message: 'PRIVATE_EVENT_BODY' }, a.ctx);
  assert.equal(a.messages.length, 0, 'activity telemetry must not prompt a worker');
  await a.events.get('session_shutdown')();
  await assert.rejects(send(bound[0], { version: 1, kind: 'message', from: 'adapter-coordinator', to: 'adapter-coordinator', payload: { message: 'closed' } }));
  const snapshot = await readObservationSnapshot(a.root);
  const activity = snapshot.events.filter(event => event.event === 'host.activity');
  assert.deepEqual(activity.map(event => [event.outcome, event.busy]), [['started', true], ['settled', false]]);
  assert.doesNotMatch(JSON.stringify(snapshot.events), /PRIVATE_EVENT_BODY|task\.completed/);
});

test('failed legacy metadata migration leaves messaging usable', supportedHost, async t => {
  const a = await adapter(t), store = new ConfigStore(a.root);
  await store.initialize({ sessionId: 'adapter-coordinator', port: 12345 });
  const legacy = await store.read(); legacy.agents[0].dashboardPort = 34568;
  await writeFile(store.file, JSON.stringify(legacy));
  const originalUpdate = ConfigStore.prototype.update;
  ConfigStore.prototype.update = function(caller, mutate, guard) {
    return originalUpdate.call(this, caller, async config => {
      const hadLegacy = config.agents.some(agent => agent.dashboardPort !== undefined);
      await mutate(config);
      if (hadLegacy && !config.agents.some(agent => agent.dashboardPort !== undefined)) throw new Error('injected migration failure');
    }, guard);
  };
  try { await a.start(); } finally { ConfigStore.prototype.update = originalUpdate; }
  assert.ok(a.notices.some(notice => ['warning', 'error'].includes(notice.level) && /legacy|migration|metadata/i.test(notice.text)));
  assert.equal(JSON.parse(await readFile(store.file, 'utf8')).agents[0].dashboardPort, 34568);
  await a.invoke('send', { to: 'Coordinator', message: 'Messaging survives migration failure' });
  assert.equal(a.messages.length, 1);
});

test('coordinator startup removes legacy dashboardPort without exposing a browser URL', supportedHost, async t => {
  const a = await adapter(t), store = new ConfigStore(a.root);
  await store.initialize({ sessionId: 'adapter-coordinator', port: 12345 });
  const legacy = await store.read(); legacy.agents[0].dashboardPort = 34568;
  await writeFile(store.file, JSON.stringify(legacy));
  await a.start();
  assert.equal(JSON.parse(await readFile(store.file, 'utf8')).agents[0].dashboardPort, undefined);
  const list = JSON.parse((await a.invoke('list')).content[0].text);
  assert.equal(list.dashboardUrl, undefined);
  await a.invoke('send', { to: 'Coordinator', message: 'Messaging survives browser retirement' });
  assert.equal(a.messages.length, 1);
});

test('shutdown during pending legacy migration fences the write and new monitor setup', supportedHost, async t => {
  const a = await adapter(t), store = new ConfigStore(a.root), bound = [];
  // A free saved port means startup binds its configured port and no boot port recovery is involved: this
  // test targets the legacy dashboard migration fence, not the P3 recovery path.
  const reservation = await listen(undefined, async () => {});
  const savedPort = reservation.port;
  await reservation.close();
  await store.initialize({ sessionId: 'adapter-coordinator', port: savedPort });
  const legacy = await store.read(); legacy.agents[0].dashboardPort = 34568;
  await writeFile(store.file, JSON.stringify(legacy));
  const originalUpdate = ConfigStore.prototype.update, originalListen = Server.prototype.listen;
  let entered, release;
  const pendingWrite = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  ConfigStore.prototype.update = function(caller, mutate, guard) {
    return originalUpdate.call(this, caller, async config => {
      const hadLegacy = config.agents.some(agent => agent.dashboardPort !== undefined);
      await mutate(config);
      if (hadLegacy && !config.agents.some(agent => agent.dashboardPort !== undefined)) { entered(); await gate; }
    }, guard);
  };
  Server.prototype.listen = function(...args) {
    const failed = () => this.off('listening', listening);
    const listening = () => {
      this.off('error', failed);
      const address = this.address();
      if (address && typeof address !== 'string') bound.push(address.port);
    };
    this.once('listening', listening);
    this.once('error', failed);
    try { return originalListen.apply(this, args); }
    catch (error) { this.off('listening', listening); this.off('error', failed); throw error; }
  };
  let starting;
  try {
    starting = a.start();
    await Promise.race([pendingWrite, starting.then(() => { throw new Error('startup ended before migration'); })]);
    await a.events.get('session_shutdown')();
    release(); await starting;
  } finally {
    release();
    ConfigStore.prototype.update = originalUpdate; Server.prototype.listen = originalListen;
    await starting;
  }
  assert.equal(bound.length, 1);
  assert.equal(a.notices.some(notice => /monitor|Herdr/i.test(notice.text)), false, 'obsolete startup never reaches monitor ensure');
  const saved = JSON.parse(await readFile(store.file, 'utf8'));
  assert.equal(saved.agents[0].dashboardPort, 34568, 'guard prevents obsolete migration write');
  await assert.rejects(send(bound[0], { version: 1, kind: 'message', from: 'adapter-coordinator', to: 'adapter-coordinator', payload: { message: 'closed' } }));
  await assert.rejects(a.invoke('list'), /not initialized/);
});

test('worker name-sync failure still retains its endpoint and configured permissions', supportedHost, async t => {
  const a = await adapter(t); await a.start();
  await a.invoke('configure_worker', {sessionId:'name-failure-worker',name:'Builder',description:'Saved worker',port:12346,projectDirectory:'.'});
  a.setId('name-failure-worker'); a.failName(true); await a.start();
  assert.ok(a.notices.some(n => /Name\/responsibility synchronization failed/.test(n.text)));
  await a.invoke('list');
});

test('coordinator startup does not attempt name synchronization; malformed config reports failure', supportedHost, async t => {
  const a = await adapter(t); a.failName(true); await a.start();
  assert.equal(a.notices.some(n => /Name\/responsibility synchronization failed/.test(n.text)), false);
  assert.deepEqual(a.names, []);
  assert.equal(a.messages.length, 0);
  await a.invoke('list');
  await a.invoke('send', { to: 'Coordinator', message: 'Endpoint retained' });
  assert.equal(a.messages.length, 1);
  await a.events.get('session_shutdown')();
  const store = new ConfigStore(a.root); await writeFile(store.file, '{broken');
  await a.start();
  assert.ok(a.notices.some(n => n.level === 'error'));
  await assert.rejects(a.invoke('list'), /not initialized/);
});

// Reminder text reaches the model only through the real adapter's user-message path. Mock timers make the
// default five-minute tick deterministic; the real board reads and sendUserMessage capture stay in place.
async function reminderAdapter(t, selector) {
  const saved = { file: process.env[REMINDER_FILE_ENV], minutes: process.env.PI_INTERCOM_REMINDER_MINUTES };
  t.after(() => {
    for (const [name, value] of [[REMINDER_FILE_ENV, saved.file], ['PI_INTERCOM_REMINDER_MINUTES', saved.minutes]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
  delete process.env.PI_INTERCOM_REMINDER_MINUTES;
  if (selector === undefined) delete process.env[REMINDER_FILE_ENV]; else process.env[REMINDER_FILE_ENV] = selector;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const a = await adapter(t);
  await a.start();
  // configure_worker is a qualifying coordinator call: it arms the timer before its own effect.
  await a.invoke('configure_worker', { sessionId: 'worker-session', port: 1, projectDirectory: '.', name: 'Worker', description: 'Assigned scope' });
  const sent = () => a.messages.filter(m => m.options?.deliverAs === 'steer');
  // Real I/O inside the reminder check needs the event loop, not a fixed number of ticks.
  const waitFor = async (condition, limit = 3000) => {
    const started = Date.now();
    while (!condition()) {
      if (Date.now() - started > limit) return false;
      await new Promise(resolve => setImmediate(resolve));
    }
    return true;
  };
  return { a, sent, waitFor, tick: () => t.mock.timers.tick(5 * 60 * 1000) };
}

test('adapter: a selected file is the exact model input, once per interval, with the steering delivery shape', supportedHost, async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'intercom-reminder-adapter-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const text = '  Generic check: list any stalled work.\n\nPlain text with trailing spaces.  \n';
  const file = path.join(dir, 'reminder text.txt');
  await writeFile(file, text);
  const r = await reminderAdapter(t, file);
  r.tick();
  assert.equal(await r.waitFor(() => r.sent().length === 1), true, 'one reminder is submitted on the first full interval');
  assert.equal(r.sent()[0].content, text, 'model input is the selected text, byte-for-byte');
  assert.deepEqual(r.sent()[0].options, { deliverAs: 'steer' });
  assert.equal(r.sent().filter(m => m.content === text).length, 1, 'never an appended or duplicated generic message');
  assert.equal(r.sent().some(m => m.content === REMINDER_TEXT), false);
  r.tick();
  assert.equal(await r.waitFor(() => r.sent().length === 2), true);
  assert.equal(r.sent()[1].content, text);
  assert.equal(r.a.notices.filter(n => n.text === REMINDER_CONFIGURATION_DIAGNOSTIC).length, 0);
});

test('adapter: an unset selector keeps the built-in literal as the exact model input', supportedHost, async t => {
  const r = await reminderAdapter(t, undefined);
  r.tick();
  assert.equal(await r.waitFor(() => r.sent().length === 1), true);
  assert.equal(r.sent()[0].content, REMINDER_TEXT);
  assert.deepEqual(r.sent()[0].options, { deliverAs: 'steer' });
});

test('adapter: an invalid selection sends nothing and emits one fixed notice', supportedHost, async t => {
  const r = await reminderAdapter(t, '');
  r.tick();
  await r.waitFor(() => r.a.notices.some(n => n.text === REMINDER_CONFIGURATION_DIAGNOSTIC));
  for (let i = 0; i < 3; i++) r.tick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(r.sent().length, 0, 'no reminder text is sent while the selection is invalid');
  assert.deepEqual(r.a.notices.filter(n => n.text === REMINDER_CONFIGURATION_DIAGNOSTIC), [{ text: REMINDER_CONFIGURATION_DIAGNOSTIC, level: 'info' }]);
});
