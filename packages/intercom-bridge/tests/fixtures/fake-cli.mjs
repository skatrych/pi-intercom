#!/usr/bin/env node
// Credential-free stand-in for cursor-agent and agy headless runs. Emits each CLI's documented NDJSON
// shapes. Prompt markers select behavior: FAIL (auth-style exit 1), LONG (3000-char answer),
// LINGER (agy: stays alive after its result), HANG (never answers), IGNORE_TERM (ignore SIGTERM),
// SUCCESS_IGNORE_TERM (success JSON then ignore SIGTERM), LINGER_EXIT9 (success, SIGTERM → exit 9),
// LINGER_DELAYED_EXIT0 (success, SIGTERM → exit 0 after delay; B1 ordering), EXIT9 (success JSON then exit 9),
// DRIFT_ID (return a different session than --resume), NO_ID (success without conversation id),
// SECRET_STDERR (token on stderr then fail), BAD_CONTENT (assistant content that makes the parser throw),
// CJK_HUGE (large multibyte result).
import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const argv = process.argv.slice(2);
if (process.env.FAKE_CLI_LOG) appendFileSync(process.env.FAKE_CLI_LOG, JSON.stringify({ argv, cwd: process.cwd(), pid: process.pid }) + '\n');
const isCursor = argv.includes('--workspace');
const prompt = isCursor ? argv[argv.indexOf('--') + 1] : (argv.find(a => a.startsWith('--print=')) ?? '').slice(8);
const flag = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const resume = isCursor ? flag('--resume') : flag('--conversation');
let id = resume ?? randomUUID();
if (prompt.includes('DRIFT_ID')) id = 'drifted-conversation-id';
if (prompt.includes('NO_ID')) id = '';
const out = o => process.stdout.write(JSON.stringify(o) + '\n');
/** Bounded lifetime for SIGTERM-ignoring fixtures so stock npm test leaves no orphans (reviewer used 900ms). */
const selfExitMs = () => {
  const n = Number(process.env.FAKE_CLI_SELF_EXIT_MS);
  return Number.isFinite(n) && n > 0 ? n : 900;
};

if (prompt.includes('IGNORE_TERM') && !prompt.includes('SUCCESS_IGNORE_TERM')) {
  // Register before any await/timer so a fast parent timeout cannot race past an unhandled SIGTERM.
  process.on('SIGTERM', () => { /* ignore — review repro for unbounded settle */ });
  process.on('SIGINT', () => { /* ignore */ });
  // Keep the event loop alive independently of the self-exit timer.
  const keep = setInterval(() => {}, 1000);
  // Mandatory bounded self-exit (default 900ms). Override with FAKE_CLI_SELF_EXIT_MS if needed.
  setTimeout(() => { clearInterval(keep); process.exit(0); }, selfExitMs());
} else if (prompt.includes('SECRET_STDERR')) {
  process.stderr.write('Authorization: Bearer sk-test-credential-should-not-reach-board\n');
  process.exit(1);
} else if (prompt.includes('HANG')) {
  setInterval(() => {}, 1000);
} else if (prompt.includes('FAIL')) {
  process.stderr.write('Error: Authentication required. Please run login first.\n');
  process.exit(1);
} else if (prompt.includes('BAD_CONTENT')) {
  // Non-iterable assistant content → cursor.parse throws (for...of on a number).
  out({ type: 'system', subtype: 'init', session_id: id || randomUUID(), model: 'fake' });
  out({ type: 'assistant', message: { role: 'assistant', content: 12345 }, session_id: id || randomUUID() });
  out({ type: 'result', subtype: 'success', is_error: false, result: 'should-not-matter', session_id: id || randomUUID() });
} else {
  const answer = prompt.includes('CJK_HUGE')
    ? '字'.repeat(47000)
    : prompt.includes('LONG') ? 'x'.repeat(3000) : `echo: ${prompt.split('\n')[1] ?? ''}`;
  if (isCursor) {
    const sid = prompt.includes('NO_ID') ? undefined : id;
    out({ type: 'system', subtype: 'init', ...(sid ? { session_id: sid } : {}), model: 'fake' });
    out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: answer }] }, ...(sid ? { session_id: sid } : {}) });
    out({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1, result: answer, ...(sid ? { session_id: sid } : {}) });
  } else {
    const cid = prompt.includes('NO_ID') ? undefined : id;
    out({ event: 'init', ...(cid ? { conversation_id: cid } : {}), init: { cwd: process.cwd() } });
    out({ event: 'step_update', step_update: { ...(cid ? { conversation_id: cid } : {}), step_index: 1, state: 'DONE', step_type: 'agent_response', text_delta: answer } });
    out({ event: 'result', result: { ...(cid ? { conversation_id: cid } : {}), status: 'SUCCESS', response: answer, num_turns: 1 } });
  }
  if (prompt.includes('EXIT9') && !prompt.includes('LINGER_EXIT9')) process.exit(9);
  if (prompt.includes('SUCCESS_IGNORE_TERM')) {
    process.on('SIGTERM', () => { /* ignore after success — R1 unsettled linger */ });
    setTimeout(() => process.exit(0), selfExitMs());
  } else if (prompt.includes('LINGER_EXIT9')) {
    // Stay alive until SIGTERM, then exit 9 within the observation window (R1).
    process.on('SIGTERM', () => process.exit(9));
    setInterval(() => {}, 1000);
  } else if (prompt.includes('LINGER_DELAYED_EXIT0')) {
    // Success, then on first SIGTERM schedule a delayed clean exit (B1: later abort/deadline must still block).
    const delay = Number(process.env.FAKE_CLI_DELAYED_EXIT_MS);
    const ms = Number.isFinite(delay) && delay > 0 ? delay : 300;
    process.on('SIGTERM', () => { setTimeout(() => process.exit(0), ms); });
    setInterval(() => {}, 1000);
  } else if (prompt.includes('LINGER')) {
    setInterval(() => {}, 1000);
  }
}
