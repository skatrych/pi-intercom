// End-to-end over real loopback HTTP: pi-intercom's own coordinator runtime (repo ../../dist, no LLM;
// the test plays the coordinator agent by calling its tools) and the bridge driving a fake CLI binary.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Intercom } from '../../../dist/runtime.js';
import { ConfigStore } from '../../../dist/config.js';
import { envelope as extensionEnvelope, send as extensionSend } from '../../../dist/transport.js';
import { Bridge } from '../dist/bridge.js';
import { cursor, agy } from '../dist/adapters.js';
import { runTurn } from '../dist/runner.js';
import { acquireOwnership, loadState, saveState } from '../dist/state.js';
import { send, clipBytes, BODY_LIMIT } from '../dist/wire.js';
import { configFile } from '../dist/board.js';

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
    const b = new Bridge({ adapter, root, bin: FAKE, stateDir: path.join(root, 'state'), turnTimeoutMs: 3000, settleMs: 200, env: { ...process.env, FAKE_CLI_LOG: log }, log: () => {},
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
  // Public board error is exit-code based — raw stderr (e.g. auth text) must not appear.
  await until(() => ctx.messages.find(m => m.includes('Report: blocked') && m.includes('exited with code 1')), 'blocked report');
  assert.equal(ctx.messages.some(m => m.includes('Authentication required')), false);
  await ctx.coordinator.tool('send', { to: 'Cursor2', message: 'LONG answer' });
  // Report is mandatory and sent first; wait until both the report and optional full-text message are on the wire.
  await until(() => ctx.wire.filter(m => m.kind === 'report').length === 2
    && ctx.wire.some(m => m.kind === 'message' && m.payload.message.includes('full result')), 'long report+message');
  const reports = ctx.wire.filter(m => m.kind === 'report');
  const full = ctx.wire.find(m => m.kind === 'message' && m.payload.message.includes('full result'));
  assert.ok(full.payload.message.length > 3000 && full.payload.message.length <= 48000);
  assert.ok(reports.at(-1).payload.summary.length <= 2000);
  const longReportIdx = ctx.wire.findIndex(m => m.kind === 'report' && String(m.payload.summary).includes('xxx'));
  const longMsgIdx = ctx.wire.findIndex(m => m.kind === 'message' && m.payload.message.includes('full result'));
  assert.ok(longReportIdx >= 0 && longMsgIdx >= 0 && longReportIdx < longMsgIdx);
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

// --- Review REQUEST CHANGES regressions (P1/P2) ---

test('P1: SIGTERM settle is bounded when the child ignores it', { skip }, async () => {
  const started = Date.now();
  const result = await runTurn(cursor, { prompt: 'IGNORE_TERM please', cwd: process.cwd() }, {
    bin: FAKE, timeoutMs: 100, settleMs: 150, lingerMs: 50,
  });
  const elapsed = Date.now() - started;
  assert.equal(result.ok, false);
  assert.match(result.error, /did not exit within 150 ms after SIGTERM/);
  assert.ok(elapsed < 700, `settled in ${elapsed} ms (must not wait for a late self-exit)`);
});

test('P1: terminal JSON success does not override nonzero exit; parse throws become blocked', { skip }, async () => {
  const exit9 = await runTurn(cursor, { prompt: 'EXIT9 boom', cwd: process.cwd() }, { bin: FAKE, timeoutMs: 3000, settleMs: 200 });
  assert.equal(exit9.ok, false);
  assert.match(exit9.error, /emitted success but exited with code 9/);

  const bad = await runTurn(cursor, { prompt: 'BAD_CONTENT', cwd: process.cwd() }, { bin: FAKE, timeoutMs: 3000, settleMs: 200 });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /malformed CLI output/);
});

test('P1: continuity refuses ID drift, missing ID, corrupt state, and concurrent owners', { skip }, async t => {
  const ctx = await board(t);
  const b = ctx.bridge(cursor);
  await enlist(b, ctx, 'Cont1');
  await ctx.coordinator.tool('send', { to: 'Cont1', message: 'bind me' });
  await until(() => ctx.messages.find(m => m.includes('echo: bind me')), 'bind');
  const bound = b.cliSessionId; assert.ok(bound);

  await ctx.coordinator.tool('send', { to: 'Cont1', message: 'DRIFT_ID now' });
  await until(() => ctx.messages.find(m => m.includes('Report: blocked') && m.includes('conversation ID drifted')), 'drift blocked');
  assert.equal(b.cliSessionId, bound, 'saved ID must not be replaced');

  const ctx2 = await board(t);
  const fresh = ctx2.bridge(cursor);
  await enlist(fresh, ctx2, 'Cont2');
  await ctx2.coordinator.tool('send', { to: 'Cont2', message: 'NO_ID please' });
  await until(() => ctx2.messages.find(m => m.includes('Report: blocked') && m.includes('without a conversation ID')), 'missing id blocked');

  const stateDir = path.join(ctx.root, 'corrupt-state');
  await mkdir(stateDir, { recursive: true });
  await writeFile(path.join(stateDir, 'same-session.json'), JSON.stringify({ version: 99, sessionId: 'same-session', agent: 'cursor' }));
  await assert.rejects(loadState(stateDir, 'same-session'), /corrupt or incompatible/);

  const ownerDir = path.join(ctx.root, 'owner-state');
  const release = await acquireOwnership(ownerDir, 'shared-worker');
  t.after(() => release());
  await assert.rejects(acquireOwnership(ownerDir, 'shared-worker'), /already owned/);

  const a = ctx.bridge(cursor, { sessionId: 'exclusive-a', stateDir: path.join(ctx.root, 'ex-a') });
  // Same session id, shared state dir → second start must fail.
  const shared = path.join(ctx.root, 'shared-own');
  const first = ctx.bridge(cursor, { sessionId: 'dup-session', stateDir: shared });
  await first.start();
  const second = ctx.bridge(cursor, { sessionId: 'dup-session', stateDir: shared });
  await assert.rejects(second.start(), /already owned/);
  void a;
});

test('P2: uncertain closeJob fences reload/message; revoked board entry blocks queued turn', { skip }, async t => {
  const ctx = await board(t);
  const b = ctx.bridge(cursor, { turnTimeoutMs: 5000, settleMs: 200 });
  await enlist(b, ctx, 'Fence1');

  // Inject uncertain closeJob directly into the board config (bridge is read-only on config).
  const raw = JSON.parse(await readFile(configFile(ctx.root), 'utf8'));
  const worker = raw.agents.find(a => a.sessionId === b.sessionId);
  worker.closeJob = {
    jobId: '00000000-0000-4000-8000-000000000001',
    state: 'uncertain',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deadlineAt: new Date(Date.now() + 60_000).toISOString(),
  };
  await writeFile(configFile(ctx.root), JSON.stringify(raw, null, 2) + '\n');

  const env = (kind, payload = {}) => ({ version: 1, kind, from: 'coord', to: b.sessionId, payload });
  await assert.rejects(extensionSend(b.port, env('reload')), /reload is fenced|close is active or uncertain/);
  await assert.rejects(extensionSend(b.port, env('message', { message: 'should not run' })), /close is active or uncertain|new Intercom work is fenced/);

  // Clear fence, queue a hanging turn, then remove the worker from the board before it runs.
  delete worker.closeJob;
  await writeFile(configFile(ctx.root), JSON.stringify(raw, null, 2) + '\n');
  // Reload responsibility again after fence clear.
  await extensionSend(b.port, env('reload'));

  const ctx3 = await board(t);
  const logs = [];
  const slow = ctx3.bridge(cursor, { turnTimeoutMs: 1500, settleMs: 150, log: line => logs.push(line) });
  await enlist(slow, ctx3, 'Revoke1');
  // Fill the running slot with HANG, then queue a second turn; remove worker before the second spawns.
  await ctx3.coordinator.tool('send', { to: 'Revoke1', message: 'HANG first' });
  await new Promise(r => setTimeout(r, 100));
  await ctx3.coordinator.tool('send', { to: 'Revoke1', message: 'second should be revoked' });
  const cfg = JSON.parse(await readFile(configFile(ctx3.root), 'utf8'));
  cfg.agents = cfg.agents.filter(a => a.sessionId !== slow.sessionId);
  await writeFile(configFile(ctx3.root), JSON.stringify(cfg, null, 2) + '\n');
  // Queued turn must observe revocation and must not spawn the CLI. Delivery to the coordinator may
  // also fail once the entry is gone; the authority check before spawn is the contract under test.
  await until(() => logs.some(l => l.includes('no longer configured') || l.includes('result delivery failed')), 'revocation handled', 10000);
  const argv = await ctx3.argv();
  assert.equal(argv.filter(e => JSON.stringify(e.argv).includes('second should be revoked')).length, 0, 'revoked turn must not spawn CLI');
  assert.ok(logs.some(l => l.includes('no longer configured')), 'turn must record board revocation before spawn');
  assert.equal(argv.length, 1, 'only the in-flight HANG turn may have spawned');
});

test('P2: huge Unicode full-result cannot suppress the mandatory report; stderr secrets stay local', { skip }, async t => {
  const ctx = await board(t);
  const b = ctx.bridge(cursor);
  await enlist(b, ctx, 'Uni1');
  await ctx.coordinator.tool('send', { to: 'Uni1', message: 'CJK_HUGE please' });
  await until(() => ctx.wire.some(m => m.kind === 'report' && m.payload.status === 'ready_for_review'), 'cjk report');
  const report = ctx.wire.find(m => m.kind === 'report' && m.payload.status === 'ready_for_review');
  assert.ok(report.payload.summary.length <= 2000);
  // Optional full message may be clipped or skipped; report must already be present.
  const reportIdx = ctx.wire.indexOf(report);
  assert.equal(reportIdx >= 0, true);
  for (const m of ctx.wire) {
    assert.ok(Buffer.byteLength(JSON.stringify(m), 'utf8') <= BODY_LIMIT);
  }

  await ctx.coordinator.tool('send', { to: 'Uni1', message: 'SECRET_STDERR now' });
  await until(() => ctx.messages.find(m => m.includes('Report: blocked')), 'secret blocked');
  assert.equal(ctx.messages.some(m => m.includes('sk-test-credential')), false);
  assert.equal(ctx.wire.filter(m => m.kind === 'report').some(m => String(m.payload.summary).includes('sk-test-credential')), false);
});

test('P2: clipBytes bounds UTF-8 payloads', () => {
  const cjk = '字'.repeat(1000);
  const clipped = clipBytes(cjk, 100);
  assert.ok(Buffer.byteLength(clipped, 'utf8') <= 100);
  assert.match(clipped, /truncated/);
});

test('P2: sanitizeId rejects pathy session names; state save round-trips', async t => {
  const { sanitizeId } = await import('../dist/state.js');
  assert.equal(sanitizeId('cursor-bridge-abc'), 'cursor-bridge-abc');
  assert.equal(sanitizeId('a/../b'), 'a_.._b');
  const dir = await mkdtemp(path.join(tmpdir(), 'bridge-state-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await saveState(dir, { version: 1, agent: 'cursor', sessionId: 's1', cliSessionId: 'c1' });
  assert.deepEqual(await loadState(dir, 's1'), { version: 1, agent: 'cursor', sessionId: 's1', cliSessionId: 'c1' });
});
