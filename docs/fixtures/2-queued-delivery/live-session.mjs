// One bounded authenticated observation through default Pi model/auth services.
// Authentication is never read, copied, or printed. Isolated SDK with TUI contract, not a rendered TUI.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const SDK = '/home/agentdev/tools/npm/lib/node_modules/@earendil-works/pi-coding-agent';
const { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } = await import(`${SDK}/dist/index.js`);
const { Type } = await import(`${SDK}/node_modules/typebox/build/index.mjs`);
const [root] = process.argv.slice(2);
assert.equal(root, '/tmp/pi-intercom-2.OnAFFC');
const cwd = `${root}/runs/live/cwd`;
for (const ancestor of ['/tmp/.pi-intercom', '/.pi-intercom']) assert.equal(await fs.access(ancestor).then(() => true, () => false), false);
const artifact = `${root}/fork/dist/index.js`;
const extension = (await import(pathToFileURL(artifact).href)).default;
const { send } = await import(pathToFileURL(`${root}/fork/dist/transport.js`).href);
const settings = SettingsManager.inMemory({ defaultProjectTrust: 'always', compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: 'off' });
// modelsPath:null keeps catalog persistence out of installed config; credential access stays with Pi.
const runtime = await ModelRuntime.create({ modelsPath: null, allowModelNetwork: false });
const model = runtime.getModel(process.env.PI_PROVIDER, process.env.PI_MODEL);
assert.ok(model, 'current authenticated model must be in default Pi catalog');
const log = (type, data = {}) => console.log(JSON.stringify({ at: Date.now(), type, ...data }));
let entered, release;
const toolEntered = new Promise(r => entered = r), toolRelease = new Promise(r => release = r);
let consumed = 0, errors = 0, session;
const loader = new DefaultResourceLoader({ cwd, agentDir: cwd, settingsManager: settings, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
  agentsFilesOverride: () => [], systemPromptOverride: () => 'This is an isolated host-delivery observation. Follow the prompt exactly; do not access external tools or files.',
  extensionFactories: [pi => pi.registerTool({ name: 'fixture_hold', label: 'Hold', description: 'Wait for fixture driver release.', parameters: Type.Object({}), execute: async () => {
    log('tool.held'); entered(); await toolRelease; log('tool.released'); return { content: [{ type: 'text', text: 'released' }], details: {} };
  } }), extension],
});
await loader.reload();
assert.deepEqual(loader.getExtensions().errors, []);
const sm = SessionManager.inMemory(cwd);
({ session } = await createAgentSession({ cwd, agentDir: cwd, modelRuntime: runtime, model, thinkingLevel: 'off', settingsManager: settings, sessionManager: sm, resourceLoader: loader, tools: ['fixture_hold', 'intercom_*'] }));
await fs.mkdir(`${cwd}/.pi-intercom`, { recursive: true });
await fs.writeFile(`${cwd}/.pi-intercom/config.json`, JSON.stringify({ version: 1, multiplexer: 'herdr', agents: [{ sessionId: sm.getSessionId(), name: 'Coordinator', coordinator: true, description: 'Isolated authenticated fixture receiver', port: 12346, projectDirectory: '.' }] }));
session.subscribe(event => {
  if (event.type === 'message_start' && event.message.role === 'user') {
    const text = event.message.content.filter(x => x.type === 'text').map(x => x.text).join('');
    if (text.includes('LIVE-M1')) { consumed++; log('consumed', { marker: 'LIVE-M1', count: consumed }); }
  }
  if (event.type === 'message_end' && event.message.role === 'assistant') { if (event.message.stopReason === 'error') errors++; log('assistant.end', { stopReason: event.message.stopReason }); }
  if (['agent_start', 'agent_end', 'agent_settled'].includes(event.type)) log(event.type, { idle: session.isIdle });
});
await session.bindExtensions({ mode: 'tui', onError: error => { errors++; log('extension.error', { event: error.event }); } });
const board = JSON.parse(await fs.readFile(`${cwd}/.pi-intercom/config.json`, 'utf8'));
const own = board.agents.find(a => a.sessionId === sm.getSessionId());
assert.ok(own);
log('manifest', { pi: JSON.parse(await fs.readFile(`${SDK}/package.json`)).version, artifact, provider: model.provider, model: model.id, mode: 'SDK bound tui, no rendered TUI', auth: 'default Pi service, no synthetic delays', deadlineMs: 30000 });
try {
  let runError = false;
  const run = session.prompt('Call fixture_hold exactly once. After it returns, acknowledge any inbound marker and reply DONE. Do not call other tools.').catch(() => { runError = true; log('prompt.error'); });
  let timer;
  try { await Promise.race([toolEntered, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('no controlled tool start within 60s')), 60000); })]); }
  finally { clearTimeout(timer); }
  log('transport.send', { marker: 'LIVE-M1', idle: session.isIdle });
  await send(own.port, { version: 1, kind: 'message', from: own.sessionId, to: own.sessionId, payload: { message: 'LIVE-M1: acknowledge this isolated fixture marker, no work assigned.' }, correlationId: 'live-M1' });
  log('transport.receipt', { marker: 'LIVE-M1' });
  release(); log('observe.begin', { boundMs: 30000 });
  await new Promise(r => setTimeout(r, 30000));
  log('result', { consumed, errors, runError, idle: session.isIdle, pending: session.pendingMessageCount, noSecondSend: true });
  if (!session.isIdle) await session.abort();
  await run;
} finally {
  release();
  if (!session.isIdle) await session.abort();
  await session.extensionRunner.emit({ type: 'session_shutdown' });
  session.dispose();
}
