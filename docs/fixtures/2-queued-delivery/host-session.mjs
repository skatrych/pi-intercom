// Planning fixture: actual installed Pi AgentSession; scripted provider only.
// No production packages, settings, sessions or endpoints are changed.
// Run: node host-session.mjs <provided-root> <fork|upstream|host> <busy|idle|before-settle|input-cross-settle|assistant-end|tool-end|agent-end|settled|auth-race|native-auth-race|input-order> [--assert]
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const SDK = '/home/agentdev/tools/npm/lib/node_modules/@earendil-works/pi-coding-agent';
const { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } = await import(`${SDK}/dist/index.js`);
const { AssistantMessageEventStream } = await import(`${SDK}/node_modules/@earendil-works/pi-ai/dist/index.js`);
const { Type } = await import(`${SDK}/node_modules/typebox/build/index.mjs`).catch(() => import(`${SDK}/node_modules/typebox`));
const [root, variant = 'fork', shape = 'busy'] = process.argv.slice(2);
assert.equal(root, '/tmp/pi-intercom-2.OnAFFC', 'only coordinator-provided root authorized');
assert.ok(['fork', 'upstream', 'host'].includes(variant));
const tree = variant === 'host' ? 'fork' : variant;
const cwd = `${root}/runs/sdk/cwd`;
assert.equal(await fs.access('/tmp/.pi-intercom').then(() => true, () => false), false);
assert.equal(await fs.access('/.pi-intercom').then(() => true, () => false), false);
const artifact = `${root}/${tree}/dist/index.js`;
const extension = (await import(pathToFileURL(artifact).href)).default;
const { send } = await import(pathToFileURL(`${root}/${tree}/dist/transport.js`).href);
const settings = SettingsManager.inMemory({ defaultProjectTrust: 'always', compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: 'off' });
const rows = []; const log = (type, data = {}) => { const row = { at: Date.now(), type, ...data }; rows.push(row); console.log(JSON.stringify(row)); };
const gate = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
const toolEntered = gate(), toolRelease = gate(), inputEntered = gate(), inputRelease = gate(), authEntered = gate(), authRelease = gate();
let piAPI, session, requests = 0, firstInput = true, injected = false, ambientReady = false, firstAmbient = true;
const model = { id: 'scripted', name: 'Scripted fixture', api: 'fixture-stream', provider: 'fixture', baseUrl: '', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 1000 };
const stream = () => {
  const out = new AssistantMessageEventStream();
  const message = { role: 'assistant', api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), content: [], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop' };
  const n = ++requests;
  queueMicrotask(() => {
    out.push({ type: 'start', partial: message });
    if (n === 1 && ['busy', 'tool-end', 'auth-race', 'native-auth-race'].includes(shape)) { message.content = [{ type: 'toolCall', id: 'hold-1', name: 'fixture_hold', arguments: {} }]; message.stopReason = 'toolUse'; }
    else message.content = [{ type: 'text', text: `scripted response ${n}` }];
    out.push({ type: 'done', reason: message.stopReason, message }); out.end();
  });
  return out;
};
const loader = new DefaultResourceLoader({ cwd, agentDir: cwd, settingsManager: settings, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
  agentsFilesOverride: () => [], systemPromptOverride: () => 'Isolated delivery fixture.',
  extensionFactories: [pi => {
    piAPI = pi;
    if (shape === 'native-auth-race') pi.registerProvider({ id: 'fixture', name: 'Ambient fixture', getModels: () => [model], stream, streamSimple: stream,
      auth: { apiKey: { name: 'Ambient fixture', resolve: async () => undefined, check: async () => {
        if (!ambientReady) return undefined;
        if (firstAmbient) { firstAmbient = false; log('auth.held'); authEntered.resolve(); await authRelease.promise; log('auth.released'); }
        return { type: 'api_key', source: 'fixture ambient' };
      } } } });
    else pi.registerProvider('fixture', { api: model.api, apiKey: 'fixture-only-not-a-secret', models: [model], streamSimple: stream });
    pi.registerTool({ name: 'fixture_hold', label: 'Hold', description: 'Controlled releasable fixture tool.', parameters: Type.Object({}), execute: async () => { log('tool.held'); toolEntered.resolve(); await toolRelease.promise; log('tool.released'); return { content: [{ type: 'text', text: 'released' }], details: {} }; } });
    pi.on('input', async event => {
      if (event.source === 'extension' && ['input-cross-settle', 'input-order'].includes(shape) && firstInput) { firstInput = false; log('input.held'); inputEntered.resolve(); await inputRelease.promise; log('input.released'); }
    });
    for (const [target, eventName] of [['assistant-end', 'message_end'], ['tool-end', 'tool_execution_end'], ['agent-end', 'agent_end'], ['settled', 'agent_settled']]) {
      pi.on(eventName, async event => {
        if (shape !== target || injected || (target === 'assistant-end' && event.message.role !== 'assistant')) return;
        injected = true; log('edge.inject', { eventName, idle: session.isIdle }); await deliver('M1');
      });
    }
    pi.on('agent_before_settle', async () => {
      log('boundary', { idle: session.isIdle });
      if (!injected && ['before-settle', 'input-cross-settle'].includes(shape)) {
        injected = true; await deliver('M1');
        if (shape === 'input-cross-settle') await inputEntered.promise;
      }
    });
  }, ...(variant === 'host' ? [] : [extension])],
});
await loader.reload();
assert.deepEqual(loader.getExtensions().errors, []);
const runtime = await ModelRuntime.create({ authPath: `${cwd}/fixture-auth.json`, modelsPath: `${cwd}/fixture-models.json` });
if (shape !== 'native-auth-race') await runtime.setRuntimeApiKey('fixture', 'fixture-only-not-a-secret');
const sm = SessionManager.inMemory(cwd);
({ session } = await createAgentSession({ cwd, agentDir: cwd, modelRuntime: runtime, model, thinkingLevel: 'off', settingsManager: settings, sessionManager: sm, resourceLoader: loader, tools: ['fixture_hold', 'intercom_*'] }));
session.subscribe(event => {
  if (event.type === 'tool_execution_end') log('tool.end', { isError: event.isError, result: event.result });
  if (event.type === 'message_end' && event.message.role === 'assistant') log('assistant.end', { stopReason: event.message.stopReason, error: event.message.errorMessage });
  if (event.type === 'message_start' && event.message.role === 'user') log('consumed', { text: event.message.content.filter(x => x.type === 'text').map(x => x.text).join(''), idle: session.isIdle });
  if (['agent_start', 'agent_end', 'agent_settled', 'queue_update'].includes(event.type)) log(event.type, { idle: session.isIdle, ...(event.type === 'queue_update' ? { steering: event.steering } : {}) });
});
const boardFile = `${cwd}/.pi-intercom/config.json`;
await fs.mkdir(path.dirname(boardFile), { recursive: true });
await fs.writeFile(boardFile, JSON.stringify({ version: 1, multiplexer: 'herdr', agents: [{ sessionId: sm.getSessionId(), name: 'Coordinator', coordinator: true, description: 'Isolated fixture receiver', port: 12345, projectDirectory: '.' }] }));
await session.bindExtensions({ mode: 'tui', onError: error => log('extension.error', { event: error.event, error: error.error }) });
// Script only model/auth services, never AgentSession queues, input, lifecycle or transport.
session.agent.streamFunction = stream;
piAPI.setActiveTools(['fixture_hold']);
if (shape !== 'native-auth-race') runtime.hasConfiguredAuth = () => true;
const board = JSON.parse(await fs.readFile(boardFile, 'utf8'));
const own = board.agents.find(a => a.sessionId === sm.getSessionId());
assert.ok(own, 'fixture receiver configured and responsibility-loaded');
async function deliver(marker) {
  log(variant === 'host' ? 'sdk.send' : 'transport.send', { marker, idle: session.isIdle });
  if (variant === 'host') session.sendUserMessage(marker, { deliverAs: 'steer' }).catch(error => log('extension.error', { event: 'direct_sdk_send', error: error.message }));
  else await send(own.port, { version: 1, kind: 'message', from: own.sessionId, to: own.sessionId, payload: { message: marker }, correlationId: `${variant}-${shape}-${marker}` });
  log(variant === 'host' ? 'sdk.returned' : 'transport.receipt', { marker });
}
async function silentWindow() { log('observe.begin', { boundMs: 30000, idle: session.isIdle }); await new Promise(r => setTimeout(r, 30000)); log('observe.end', { idle: session.isIdle, pending: session.pendingMessageCount }); }
try {
  log('manifest', { pi: JSON.parse(await fs.readFile(`${SDK}/package.json`)).version, artifact, variant, shape, os: process.platform, session: sm.getSessionId(), deadlineMs: 30000, provider: 'scripted-no-network', activeTools: session.getActiveToolNames() });
  if (shape === 'busy') {
    const run = session.prompt('START'); await Promise.race([toolEntered.promise, new Promise((_, reject) => setTimeout(() => reject(new Error('fixture tool failed to hold within 5s')), 5000))]);
    for (const marker of ['M1', 'M2', 'SAME', 'SAME']) await deliver(marker);
    toolRelease.resolve(); await run; await silentWindow();
  } else if (['before-settle', 'input-cross-settle', 'assistant-end', 'tool-end', 'agent-end', 'settled'].includes(shape)) {
    if (shape === 'tool-end') toolRelease.resolve();
    await session.prompt('START'); inputRelease.resolve(); await silentWindow();
  } else if (['auth-race', 'native-auth-race'].includes(shape)) {
    // native-auth-race uses the supported provider availability contract, without replacing ModelRuntime methods.
    if (shape === 'native-auth-race') { await runtime.refresh({ allowNetwork: false }); assert.equal(runtime.hasConfiguredAuth('fixture'), false); ambientReady = true; }
    else runtime.hasConfiguredAuth = () => false;
    let firstAuth = true;
    if (shape === 'auth-race') runtime.checkAuth = async () => { if (firstAuth) { firstAuth = false; log('auth.held'); authEntered.resolve(); await authRelease.promise; log('auth.released'); } return { type: 'api_key' }; };
    await deliver('M1'); await authEntered.promise;
    await deliver('M2');
    // On a future FIFO-admission implementation M2 cannot start before M1 auth.
    // Release the driver gate after at most 500ms in that case, rather than deadlock the regression.
    let fallback;
    await Promise.race([toolEntered.promise, new Promise(r => { fallback = setTimeout(() => { log('driver.auth-release-fallback'); r(); }, 500); })]);
    clearTimeout(fallback); authRelease.resolve();
    await Promise.race([toolEntered.promise, new Promise((_, reject) => setTimeout(() => reject(new Error('no tool start after auth release within 5s')), 5000))]);
    await new Promise(r => setTimeout(r, 20)); toolRelease.resolve(); await silentWindow();
  } else if (shape === 'input-order') {
    await deliver('M1'); await inputEntered.promise; await deliver('M2'); await new Promise(r => setTimeout(r, 20)); inputRelease.resolve(); await silentWindow();
  } else if (shape === 'idle') { await deliver('M1'); await silentWindow(); }
  else throw new Error('unsupported shape');
  log('result', { consumed: rows.filter(r => r.type === 'consumed').map(r => r.text), errors: rows.filter(r => r.type === 'extension.error'), requests, idle: session.isIdle, pending: session.pendingMessageCount });
  if (process.argv.includes('--assert')) {
    const markers = rows.filter(r => r.type === 'consumed').map(r => r.text.split('\n').at(-1)).filter(t => t !== 'START');
    const expected = shape === 'busy' ? ['M1', 'M2', 'SAME', 'SAME'] : ['auth-race', 'native-auth-race', 'input-order'].includes(shape) ? ['M1', 'M2'] : ['M1'];
    assert.deepEqual(markers, expected, 'valid submitted inputs must be consumed once in submission order');
    assert.equal(rows.filter(r => r.type === 'extension.error').length, 0, 'no processing rejection');
    let held = false;
    for (const row of rows) {
      if (row.type === 'tool.held') held = true;
      if (row.type === 'tool.released') held = false;
      if (row.type === 'agent_settled') assert.equal(held, false, 'must not settle another active tool run');
    }
    assert.equal(session.isIdle, true); assert.equal(session.pendingMessageCount, 0);
  }
} finally {
  toolRelease.resolve(); inputRelease.resolve(); authRelease.resolve();
  await session.waitForIdle();
  await session.extensionRunner.emit({ type: 'session_shutdown' });
  session.dispose();
}
