import test from 'node:test';
import assert from 'node:assert/strict';
import { cursor, agy, adapter } from '../dist/adapters.js';
import { clip, envelope } from '../dist/wire.js';
import { parse } from '../dist/cli.js';

test('cursor args: print + stream-json, resume/model/force only when set, prompt after --', () => {
  assert.deepEqual(cursor.args({ prompt: '-p hi', cwd: '/w' }), ['--print', '--output-format', 'stream-json', '--trust', '--workspace', '/w', '--', '-p hi']);
  const a = cursor.args({ prompt: 'x', cwd: '/w', resume: 'S1', model: 'm', autoApprove: true });
  assert.deepEqual(a.slice(6), ['--resume', 'S1', '--model', 'm', '--force', '--', 'x']);
});
test('agy args: stream-json, conversation resume, prompt bound to --print=', () => {
  assert.deepEqual(agy.args({ prompt: '-x', cwd: '/w' }), ['--output-format', 'stream-json', '--print=-x']);
  assert.deepEqual(agy.args({ prompt: 'x', cwd: '/w', resume: 'C', model: 'm', autoApprove: true }),
    ['--output-format', 'stream-json', '--conversation', 'C', '--model', 'm', '--dangerously-skip-permissions', '--print=x']);
});
test('cursor parse: result event wins, session from any event, error result', () => {
  assert.deepEqual(cursor.parse([{ type: 'system', subtype: 'init', session_id: 'S' }, { type: 'assistant', message: { content: [{ type: 'text', text: 'a' }] } }, { type: 'result', subtype: 'success', is_error: false, result: 'done', session_id: 'S' }]),
    { ok: true, text: 'done', cliSessionId: 'S' });
  const e = cursor.parse([{ type: 'system', session_id: 'S' }, { type: 'assistant', message: { content: [{ type: 'text', text: 'partial' }] } }]);
  assert.equal(e.ok, false); assert.equal(e.text, 'partial'); assert.equal(e.cliSessionId, 'S');
  assert.equal(cursor.parse([{ type: 'result', subtype: 'error', is_error: true }]).ok, false);
});
test('agy parse: stream result, json-format object, documented auth-failure shape', () => {
  assert.deepEqual(agy.parse([{ event: 'init', conversation_id: 'C' }, { event: 'step_update', step_update: { conversation_id: 'C', step_type: 'agent_response', text_delta: 'hi' } }, { event: 'result', result: { conversation_id: 'C', status: 'SUCCESS', response: 'hi\n' } }]),
    { ok: true, text: 'hi\n', cliSessionId: 'C' });
  // Observed from agy 1.4.6 without credentials (stream-json): empty conversation id, ERROR status.
  const auth = agy.parse([{ event: 'result', result: { conversation_id: '', status: 'ERROR', response: '', error: 'authentication failed or timed out' } }]);
  assert.deepEqual(auth, { ok: false, text: '', cliSessionId: undefined, error: 'authentication failed or timed out' });
  assert.equal(agy.parse([{ conversation_id: 'C', status: 'CANCELED', response: '' }]).error, 'agy status CANCELED');
  assert.equal(agy.parse([]).ok, false);
});
test('adapter lookup and CLI argument parsing', () => {
  assert.equal(adapter('cursor'), cursor);
  assert.throws(() => adapter('codex'), /unknown agent/);
  assert.equal(parse(['run', '--agent', 'agy', '--turn-timeout', '5']).timeoutMs, 5000);
  assert.throws(() => parse(['run']), /Usage/);
  assert.throws(() => parse(['run', '--agent', 'cursor', '--turn-timeout=-1']), /positive/);
});
test('wire: clip marks truncation within limit; envelope rejects bad shapes', () => {
  const c = clip('a'.repeat(100), 50); assert.equal(c.length, 50); assert.match(c, /truncated/);
  assert.equal(clip('short', 50), 'short');
  assert.throws(() => envelope({ version: 2, kind: 'message', from: 'a', to: 'b', payload: {} }), /version/);
  assert.throws(() => envelope({ version: 1, kind: 'message', from: 'a', to: 'b', payload: {} }), /message/);
});
