#!/usr/bin/env node
// Credential-free stand-in for cursor-agent and agy headless runs. Emits each CLI's documented NDJSON
// shapes. Prompt markers select behavior: FAIL (auth-style exit 1), LONG (3000-char answer),
// LINGER (agy: stays alive after its result), HANG (never answers).
import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const argv = process.argv.slice(2);
if (process.env.FAKE_CLI_LOG) appendFileSync(process.env.FAKE_CLI_LOG, JSON.stringify({ argv, cwd: process.cwd() }) + '\n');
const isCursor = argv.includes('--workspace');
const prompt = isCursor ? argv[argv.indexOf('--') + 1] : (argv.find(a => a.startsWith('--print=')) ?? '').slice(8);
const flag = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const id = (isCursor ? flag('--resume') : flag('--conversation')) ?? randomUUID();
const out = o => process.stdout.write(JSON.stringify(o) + '\n');
if (prompt.includes('HANG')) setInterval(() => {}, 1000);
else if (prompt.includes('FAIL')) { process.stderr.write('Error: Authentication required. Please run login first.\n'); process.exit(1); }
else {
  const answer = prompt.includes('LONG') ? 'x'.repeat(3000) : `echo: ${prompt.split('\n')[1] ?? ''}`;
  if (isCursor) {
    out({ type: 'system', subtype: 'init', session_id: id, model: 'fake' });
    out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: answer }] }, session_id: id });
    out({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1, result: answer, session_id: id });
  } else {
    out({ event: 'init', conversation_id: id, init: { cwd: process.cwd() } });
    out({ event: 'step_update', step_update: { conversation_id: id, step_index: 1, state: 'DONE', step_type: 'agent_response', text_delta: answer } });
    out({ event: 'result', result: { conversation_id: id, status: 'SUCCESS', response: answer, num_turns: 1 } });
    if (prompt.includes('LINGER')) setInterval(() => {}, 1000);
  }
}
