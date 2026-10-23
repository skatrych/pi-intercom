// Real-CLI smoke run: pi-intercom coordinator runtime (no LLM) + bridge + an authenticated CLI.
// Usage: node scripts/smoke.mjs <cursor|agy> [bin]   (needs `npm run build` at repo root and here)
// Sends two tiny instructions; the second checks conversation resume. Prints a short transcript.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Intercom } from '../../../dist/runtime.js';
import { ConfigStore } from '../../../dist/config.js';
import { Bridge } from '../dist/bridge.js';
import { adapter } from '../dist/adapters.js';

const [name = 'cursor', bin] = process.argv.slice(2);
const root = await mkdtemp(path.join(tmpdir(), 'bridge-smoke-'));
const log = line => console.log(`[bridge] ${line}`);
const messages = [];
await new ConfigStore(root).initialize('smoke-coordinator', 12345);
const coordinator = new Intercom({ cwd: root, sessionId: () => 'smoke-coordinator', busy: () => false, deliver: t => { messages.push(t); console.log(`[coordinator inbox] ${t.split('\n').slice(0, 3).join(' | ')}`); },
  setName: async () => {}, notify: () => {}, abort: () => {}, shutdown: () => {} }, { launch: async () => ({ launched: true }) });
await coordinator.start();
const bridge = new Bridge({ adapter: adapter(name), root, bin, stateDir: path.join(root, 'state'), turnTimeoutMs: 180_000, log });
const wait = async (pred, ms) => { const end = Date.now() + ms; while (!messages.some(pred)) { if (Date.now() > end) throw new Error('timeout'); await new Promise(r => setTimeout(r, 200)); } };
try {
  await bridge.start();
  await wait(m => m.includes('registration'), 10_000);
  await coordinator.tool('configure_worker', { sessionId: bridge.sessionId, port: bridge.port, projectDirectory: '.', name: 'Smoke', description: 'Answer tiny smoke-test prompts briefly. Do not use tools.' });
  await coordinator.tool('reload_worker', { to: 'Smoke' });
  await coordinator.tool('send', { to: 'Smoke', message: 'Reply with exactly the single word PONG and nothing else.' });
  await wait(m => m.includes('worker report'), 180_000);
  await coordinator.tool('send', { to: 'Smoke', message: 'Repeat the single word you replied with last time, nothing else.' });
  await wait(m => m.split('worker report').length > 1 && messages.filter(x => x.includes('worker report')).length >= 2, 180_000);
  console.log(`[result] cli session ${bridge.cliSessionId}; reports received: ${messages.filter(m => m.includes('worker report')).length}`);
} finally { await bridge.close(); await coordinator.close(); await rm(root, { recursive: true, force: true }); }
