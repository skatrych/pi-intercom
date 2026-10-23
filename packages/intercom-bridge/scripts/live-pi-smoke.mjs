// Live smoke (needs tmux, a logged-in cursor-agent, `npm run build` at the root and in the bridge): interactive pi TUI (in tmux) as coordinator with pi-intercom loaded, OpenRouter free
// model, one cursor bridge worker. The key is read by a launcher script into pi's env only; logs are
// built from pi's session JSONL and sanitized.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';

const [MODEL, OUT] = process.argv.slice(2);
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..'), S = 'pismoke';
const KEY_FILE = process.env.OPENROUTER_KEY_FILE;
if (!MODEL || !OUT || !KEY_FILE) { console.error('Usage: OPENROUTER_KEY_FILE=<file> node live-pi-smoke.mjs <openrouter model id> <log file>'); process.exit(2); }
const key = readFileSync(KEY_FILE, 'utf8').trim();
const board = mkdtempSync(path.join(tmpdir(), 'pi-board-'));
const agentDir = path.join(board, '..', `${path.basename(board)}-pi-config`), sessions = path.join(agentDir, 'sessions'), bridgeState = path.join(agentDir, 'bridge-state');
mkdirSync(sessions, { recursive: true });
writeFileSync(path.join(agentDir, 'models.json'), JSON.stringify({ providers: { openrouter: { baseUrl: 'https://openrouter.ai/api/v1', apiKey: '$OPENROUTER_API_KEY', api: 'openai-completions',
  models: [{ id: MODEL, name: MODEL, reasoning: false, input: ['text'], contextWindow: 131072, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
const launcher = path.join(agentDir, 'launch.sh');
writeFileSync(launcher, `#!/bin/sh
export OPENROUTER_API_KEY="$(cat '${KEY_FILE}')"
export PI_CODING_AGENT_DIR='${agentDir}' PI_INTERCOM_BRIDGE_STATE='${bridgeState}' PATH="${path.dirname(process.execPath)}:${homedir()}/.local/bin:$PATH"
cd '${board}' && exec '${REPO}/node_modules/.bin/pi' --provider openrouter --model '${MODEL}' --thinking off --no-extensions -e '${REPO}/src/index.ts' --approve --session-dir '${sessions}'
`); chmodSync(launcher, 0o700);
const lines = [];
const redact = s => String(s).split(key).join('<redacted>').replace(/sk-or-[A-Za-z0-9_-]+/g, '<redacted>')
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>').split(agentDir).join('<pi-config>').split(board).join('<board>').split(homedir()).join('~');
const log = s => { const l = `${new Date().toISOString().slice(11, 19)} ${redact(s)}`; lines.push(l); console.log(l.slice(0, 260)); };
const cut = (s, n = 300) => { s = typeof s === 'string' ? s : JSON.stringify(s); return s.length > n ? s.slice(0, n) + '…' : s; };
const tmux = (...a) => execFileSync('tmux', a, { encoding: 'utf8' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pane = () => tmux('capture-pane', '-p', '-t', S).split('\n').filter(l => l.trim()).slice(-25).join('\n');

try { tmux('kill-session', '-t', S); } catch {}
tmux('new-session', '-d', '-s', S, '-x', '220', '-y', '50', launcher);
const BRIDGE = `node ${REPO}/packages/intercom-bridge/dist/cli.js spawn --agent cursor --root . --bin ${homedir()}/.local/bin/cursor-agent`;
const PROMPT = `You are the Intercom coordinator. Step 1: run this exact shell command once with bash: ${BRIDGE} . Step 2: then end your turn and wait; an Intercom registration message from that worker will arrive as a new message. Step 3: when it arrives, call intercom_configure_worker with the reported sessionId, port and projectDirectory, name "CursorSmoke", description "Answers tiny smoke-test prompts."; then intercom_reload_worker with to "CursorSmoke"; then intercom_send with to "CursorSmoke" and message "Reply with exactly the single word PONG and nothing else."; then end your turn and wait. Step 4: when the worker report arrives, reply with one line: REPORT RECEIVED: <report text>, and call no more tools.`;
await sleep(8000);
log(`[tui at start]\n${pane()}`);
tmux('send-keys', '-t', S, '-l', PROMPT); await sleep(500); tmux('send-keys', '-t', S, 'Enter');
log(`[driver → pi] prompt sent (${PROMPT.length} chars): ${cut(PROMPT, 600)}`);
let seen = 0, llm = 0, acked = false, reportIn = false, why = '8 minute timeout';
const tools = [];
const deadline = Date.now() + 8 * 60_000;
while (Date.now() < deadline) {
  await sleep(2000);
  const files = existsSync(sessions) ? readdirSync(sessions, { recursive: true }).filter(f => String(f).endsWith('.jsonl')) : [];
  if (!files.length) continue;
  const entries = readFileSync(path.join(sessions, String(files[0])), 'utf8').trim().split('\n').map(l => { try { return JSON.parse(l); } catch { return undefined; } }).filter(Boolean);
  for (const e of entries.slice(seen)) {
    if (e.type === 'model_change') log(`[session] model ${e.provider}/${e.modelId}`);
    if (e.type !== 'message' && e.type !== 'custom_message') continue;
    const m = e.message ?? { role: 'custom', content: e.content };
    const parts = Array.isArray(m.content) ? m.content : [{ type: 'text', text: m.content }];
    const text = parts.filter(p => p?.type === 'text').map(p => p.text).join('');
    if (m.role === 'assistant') {
      llm++;
      const calls = parts.filter(p => p?.type === 'toolCall').map(p => { tools.push(p.name); return `${p.name}(${cut(p.arguments, 220)})`; });
      log(`[assistant #${llm}${m.stopReason ? ` ${m.stopReason}` : ''}${m.errorMessage ? ` error=${cut(m.errorMessage, 200)}` : ''}] ${cut(text, 300)}${calls.length ? ` calls: ${calls.join('; ')}` : ''}`);
      if (reportIn && /REPORT RECEIVED/i.test(text)) acked = true;
    } else if (m.role === 'toolResult') log(`[tool result ${m.toolName}${m.isError ? ' ERROR' : ''}] ${cut(text, 300)}`);
    else if (text !== PROMPT) { if (/\[Intercom worker report/.test(text)) reportIn = true; log(`[pi input ${m.role}] ${cut(text, 400)}`); }
  }
  seen = entries.length;
  if (acked) { why = 'coordinator acknowledged the worker report'; break; }
  if (llm >= 14) { why = 'LLM call cap reached'; break; }
}
await sleep(1500);
log(`STOP: ${why}; LLM calls=${llm}; tools=${tools.join(', ')}; reportDelivered=${reportIn}`);
log(`[tui at end]\n${pane()}`);
try { tmux('kill-session', '-t', S); } catch {}
if (existsSync(bridgeState)) for (const f of readdirSync(bridgeState).filter(f => f.endsWith('.log'))) {
  lines.push(`--- bridge log ${redact(f)}`); for (const l of readFileSync(path.join(bridgeState, f), 'utf8').trim().split('\n')) lines.push(redact(l));
}
try { execFileSync('pkill', ['-f', `cli.js run .*${board}`]); } catch {}
writeFileSync(OUT, lines.join('\n') + '\n');
