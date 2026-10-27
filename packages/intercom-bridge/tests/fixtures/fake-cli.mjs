#!/usr/bin/env node
// Credential-free stand-in for cursor-agent and agy headless runs. Emits each CLI's documented NDJSON
// shapes. Prompt markers select behavior: FAIL (auth-style exit 1), LONG (3000-char answer),
// LINGER (agy: stays alive after its result), HANG (never answers), IGNORE_TERM (ignore SIGTERM),
// EXIT9 (success JSON then exit 9), DRIFT_ID (return a different session than --resume),
// NO_ID (success without conversation id), SECRET_STDERR (token on stderr then fail),
// BAD_CONTENT (assistant content that makes the parser throw), CJK_HUGE (large multibyte result).
import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const argv = process.argv.slice(2);
if (process.env.FAKE_CLI_LOG) appendFileSync(process.env.FAKE_CLI_LOG, JSON.stringify({ argv, cwd: process.cwd() }) + '\n');
const isCursor = argv.includes('--workspace');
const prompt = isCursor ? argv[argv.indexOf('--') + 1] : (argv.find(a => a.startsWith('--print=')) ?? '').slice(8);
const flag = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const resume = isCursor ? flag('--resume') : flag('--conversation');
let id = resume ?? randomUUID();
if (prompt.includes('DRIFT_ID')) id = 'drifted-conversation-id';
if (prompt.includes('NO_ID')) id = '';
const out = o => process.stdout.write(JSON.stringify(o) + '\n');

if (prompt.includes('IGNORE_TERM')) {
  process.on('SIGTERM', () => { /* ignore — review repro for unbounded settle */ });
  // Optional delayed self-exit so a missing settle bound would eventually complete (review used ~800ms).
  const delay = Number(process.env.FAKE_CLI_SELF_EXIT_MS ?? 0);
  if (delay > 0) setTimeout(() => process.exit(0), delay);
  else setInterval(() => {}, 1000);
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
    if (prompt.includes('LINGER')) setInterval(() => {}, 1000);
  }
  if (prompt.includes('EXIT9')) process.exit(9);
}
