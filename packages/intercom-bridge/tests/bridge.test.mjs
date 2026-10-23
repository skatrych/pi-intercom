// End-to-end over real loopback HTTP: pi-intercom's own coordinator runtime (repo ../../dist, no LLM;
// the test plays the coordinator agent by calling its tools) and the bridge driving a fake CLI binary.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Intercom } from '../../../dist/runtime.js';
import { ConfigStore } from '../../../dist/config.js';
import { envelope as extensionEnvelope, send as extensionSend } from '../../../dist/transport.js';
import { Bridge } from '../dist/bridge.js';
import { cursor, agy } from '../dist/adapters.js';
import { send } from '../dist/wire.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FAKE = path.join(here, 'fixtures', 'fake-cli.mjs');
const skip = process.platform === 'win32' ? 'fake CLI uses a POSIX shebang' : false;

async function until(check, what, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) { const v = await check(); if (v) return v; if (Date.now() > end) assert.fail(`timed out waiting for ${what}`); await new Promise(r => setTimeout(r, 25)); }
}
async function board(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'intercom-bridge-'));
  await new ConfigStore(root).initialize('coord', 12345);
  const messages = [], all = [];
  const host = { cwd: root, sessionId: () => 'coord', busy: () => false, deliver: text => messages.push(text), setName: async () => {}, notify: () => {},
    abort: () => assert.fail('must not abort'), shutdown: () => assert.fail('must not shutdown') };
  // Conformance: every envelope the bridge sends must pass the extension's own validator.
  const wire = [];
  const coordinator = new Intercom(host, { launch: async () => ({ launched: true }),
    probe: async a => ({ sessionId: a.sessionId, state: 'disconnected', checkedAt: new Date().toISOString(), reason: 'refused' }) });
  await coordinator.start();
  const log = path.join(root, 'fake.log');
  const bridges = [];
  const bridge = (adapter, extra = {}) => {
    const b = new Bridge({ adapter, root, bin: FAKE, stateDir: path.join(root, 'state'), turnTimeoutMs: 3000, env: { ...process.env, FAKE_CLI_LOG: log }, log: () => {},
      send: async (port, m) => { extensionEnvelope(m); wire.push(m); return send(port, m); }, ...extra });
    bridges.push(b); return b;
  };
  t.after(async () => { for (const b of bridges) await b.close(); await coordinator.close(); await rm(root, { recursive: true, force: true }); });
  const argv = async () => (await readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  return { root, coordinator, messages, bridge, wire, argv };
}
async function enlist(b, ctx, name) {
  await b.start();
  await until(() => ctx.messages.find(m => m.includes('registration') && m.includes(b.sessionId)), 'registration');
  await ctx.coordinator.tool('configure_worker', { sessionId: b.sessionId, port: b.port, projectDirectory: '.', name, description: `Run ${name} turns.` });
  await ctx.coordinator.tool('reload_worker', { to: name });
}

test('cursor worker: register, configure, instruction -> report, resume on second turn', { skip }, async t => {
  const ctx = await board(t);
  const b = ctx.bridge(cursor);
  await enlist(b, ctx, 'Cursor1');
  await ctx.coordinator.tool('send', { to: 'Cursor1', message: 'Say hello' });
  await until(() => ctx.messages.find(m => m.includes('worker report') && m.includes('echo: Say hello')), 'first report');
  const first = (await ctx.argv())[0];
  assert.equal(first.argv.includes('--resume'), false);
  assert.ok(first.argv.at(-1).includes('Responsibility: Run Cursor1 turns.'), 'first turn carries responsibility context');
  const cliSession = b.cliSessionId; assert.ok(cliSession);
  await ctx.coordinator.tool('send', { to: 'Cursor1', message: 'Again' });
  await until(() => ctx.messages.find(m => m.includes('echo: Again')), 'second report');
  const second = (await ctx.argv())[1];
  assert.deepEqual(second.argv.slice(second.argv.indexOf('--resume'), second.argv.indexOf('--resume') + 2), ['--resume', cliSession]);
  assert.equal(second.argv.at(-1).includes('Responsibility:'), false, 'context not repeated within one CLI session');
  assert.equal(ctx.wire.filter(m => m.kind === 'report').every(m => m.payload.status === 'ready_for_review'), true);
});

test('failures become blocked reports; long results add a full-text message; status on request', { skip }, async t => {
  const ctx = await board(t);
  const b = ctx.bridge(cursor);
  await enlist(b, ctx, 'Cursor2');
  await ctx.coordinator.tool('send', { to: 'Cursor2', message: 'FAIL please' });
  await until(() => ctx.messages.find(m => m.includes('Report: blocked') && m.includes('Authentication required')), 'blocked report');
  await ctx.coordinator.tool('send', { to: 'Cursor2', message: 'LONG answer' });
  await until(() => ctx.wire.filter(m => m.kind === 'report').length === 2, 'long report');
  const full = ctx.wire.find(m => m.kind === 'message');
  assert.ok(full.payload.message.length > 3000 && full.payload.message.length <= 48000);
  assert.ok(ctx.wire.at(-1).payload.summary.length <= 2000);
  await ctx.coordinator.tool('send', { to: 'Cursor2', message: 'HANG forever' });
  await until(() => ctx.messages.find(m => m.includes('timed out after 3000 ms')), 'timeout report', 10000);
  await ctx.coordinator.tool('request_status', { to: 'Cursor2' });
  await until(() => ctx.messages.find(m => m.includes('[Intercom status') && m.includes(b.sessionId)), 'status');
});

test('agy worker: conversation resume and a CLI that lingers after its result', { skip }, async t => {
  const ctx = await board(t);
  const b = ctx.bridge(agy);
  await enlist(b, ctx, 'Agy1');
  await ctx.coordinator.tool('send', { to: 'Agy1', message: 'LINGER then answer' });
  await until(() => ctx.messages.find(m => m.includes('Report: ready_for_review') && m.includes('echo: LINGER')), 'agy report');
  await ctx.coordinator.tool('send', { to: 'Agy1', message: 'next' });
  await until(() => ctx.messages.find(m => m.includes('echo: next')), 'agy second report');
  const second = (await ctx.argv())[1];
  assert.equal(second.argv[second.argv.indexOf('--conversation') + 1], b.cliSessionId);
});

test('receiver rules: stale recipient, unconfigured sender, unloaded worker, coordinator-only controls', { skip }, async t => {
  const ctx = await board(t);
  const b = ctx.bridge(cursor);
  await b.start();
  const env = (kind, from, payload = {}, to = b.sessionId) => ({ version: 1, kind, from, to, payload });
  await assert.rejects(extensionSend(b.port, env('message', 'coord', { message: 'x' }, 'someone-else')), /mismatch/);
  await assert.rejects(extensionSend(b.port, env('message', 'stranger', { message: 'x' })), /configured sender/);
  await ctx.coordinator.tool('configure_worker', { sessionId: b.sessionId, port: b.port, projectDirectory: '.', name: 'W', description: 'd' });
  await assert.rejects(extensionSend(b.port, env('message', 'coord', { message: 'x' })), /responsibility/);
  await assert.rejects(extensionSend(b.port, env('stop', 'coord')), /disabled/);
  await assert.rejects(extensionSend(b.port, env('close_prepare', 'coord', {})), /./);
  const health = await (await fetch(`http://127.0.0.1:${b.port}/intercom/health`)).json();
  assert.deepEqual(health, { version: 1, sessionId: b.sessionId });
});

test('resume: a restarted bridge with the same session sends status and keeps its CLI conversation', { skip }, async t => {
  const ctx = await board(t);
  const first = ctx.bridge(cursor);
  await enlist(first, ctx, 'Cursor3');
  await ctx.coordinator.tool('send', { to: 'Cursor3', message: 'one' });
  await until(() => ctx.messages.find(m => m.includes('echo: one')), 'first');
  const cliSession = first.cliSessionId;
  await first.close();
  const again = ctx.bridge(cursor, { sessionId: first.sessionId });
  await again.start();
  await until(() => ctx.messages.find(m => m.includes('[Intercom status') && m.includes('"configured":true')), 'resume status');
  assert.equal(again.cliSessionId, cliSession);
  await ctx.coordinator.tool('send', { to: 'Cursor3', message: 'two' });
  await until(() => ctx.messages.find(m => m.includes('echo: two')), 'after resume');
  const last = (await ctx.argv()).at(-1).argv;
  assert.equal(last[last.indexOf('--resume') + 1], cliSession);
});

test('CLI process: SIGTERM aborts the running turn, reports blocked, and exits 0', { skip }, async t => {
  const ctx = await board(t);
  const cli = path.join(here, '..', 'dist', 'cli.js');
  const child = spawn(process.execPath, [cli, 'run', '--agent', 'cursor', '--root', ctx.root, '--bin', FAKE, '--state-dir', path.join(ctx.root, 'state')], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', d => { out += d; });
  const started = await until(() => { try { return JSON.parse(out.split('\n')[0]); } catch { return undefined; } }, 'cli start');
  await until(() => ctx.messages.find(m => m.includes(started.sessionId)), 'registration');
  await ctx.coordinator.tool('configure_worker', { sessionId: started.sessionId, port: started.port, projectDirectory: '.', name: 'Proc', description: 'd' });
  await ctx.coordinator.tool('reload_worker', { to: 'Proc' });
  await ctx.coordinator.tool('send', { to: 'Proc', message: 'HANG here' });
  await new Promise(r => setTimeout(r, 300));
  child.kill('SIGTERM');
  const code = await new Promise(r => child.on('exit', r));
  assert.equal(code, 0);
  await until(() => ctx.messages.find(m => m.includes('Report: blocked') && m.includes('bridge shutting down')), 'shutdown report');
});

test('CLI spawn: reports a started detached worker, and fails loudly when the worker dies at startup', { skip }, async t => {
  const ctx = await board(t);
  const cli = path.join(here, '..', 'dist', 'cli.js');
  const run = args => new Promise(resolve => { const c = spawn(process.execPath, [cli, ...args]); let out = '', err = ''; c.stdout.on('data', d => { out += d; }); c.stderr.on('data', d => { err += d; }); c.on('exit', code => resolve({ code, out, err })); });
  const ok = await run(['spawn', '--agent', 'cursor', '--root', ctx.root, '--bin', FAKE, '--state-dir', path.join(ctx.root, 'state')]);
  assert.equal(ok.code, 0);
  const info = JSON.parse(ok.out);
  assert.ok(info.port > 0 && info.pid > 0);
  await until(() => ctx.messages.find(m => m.includes(info.sessionId)), 'spawned registration');
  process.kill(info.pid, 'SIGTERM');
  const empty = await mkdtemp(path.join(tmpdir(), 'intercom-bridge-noboard-'));
  t.after(() => rm(empty, { recursive: true, force: true }));
  const bad = await run(['spawn', '--agent', 'cursor', '--root', empty, '--state-dir', path.join(empty, 'state')]);
  assert.notEqual(bad.code, 0);
  assert.match(bad.err, /exited during startup[\s\S]*board config unreadable/);
});
