// Independent-review B1/B2/B3 negatives: real product publishers/HTTP, disposable fixture boards only.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { unlink, readdir, readFile, rename, writeFile, mkdir, rm, symlink } from 'node:fs/promises';
import syncFs, { writeFileSync, existsSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import cp from 'node:child_process';
import { createServer } from 'node:http';
import { fixture, barrier } from './fixtures/adoption-support.mjs';
import { IDS } from './fixtures/adoption-fixture.mjs';
import { ConfigStore } from '../dist/config.js';
import { Intercom } from '../dist/runtime.js';
import { HandoffWorkflow } from '../dist/handoff.js';
import { parseClaim, committedActiveClaimMatches, claimEvidenceEstablished } from '../dist/adoption.js';
import { launchers } from '../dist/launcher.js';
import { saveWorkerReport, readWorkerReports } from '../dist/reports.js';

for (const phase of ['prepared', 'active']) test(`B1 missing worktree with committed ${phase} fences ordinary/status/handoff BEFORE mutate`, async t => {
  const f = await fixture(); let runtime;
  t.after(async () => { await runtime?.close(); await f.dispose(); });
  let entered = 0;
  class TrackedStore extends ConfigStore {
    update(id, mutate, guard) { return super.update(id, c => { entered++; return mutate(c); }, guard); }
  }
  const store = new TrackedStore(f.home), pair = (await store.read()).agents[0];
  // Legacy current coordinator starts before intent, then actual receive-status shares this store.
  runtime = new Intercom({ cwd: f.home, sessionId: () => IDS.gone, roleDirectory: path.join(f.home, 'roles/developer'), workerRole: '', busy: () => false,
    deliver: () => assert.fail('no model turn'), notify() {}, setName: async () => {} },
  { store: () => store, launch: async () => assert.fail('no launch'), listen: async () => ({ port: pair.port, close: async () => {} }), observe: () => ({ record() {}, close() {}, maintain() {} }) });
  await runtime.start();
  await store.update(IDS.gone, c => { c.agents.at(-1).closeJob.state = 'awaiting_handoff'; });
  if (phase === 'prepared') {
    await f.workflow({ phase: async p => { if (p === 'prepared-committed') throw Error('review fixture interruption'); } }).run(f.context, 'adopt');
  } else await f.claim.writeAndCommit(await f.declaration({ sessionId: pair.sessionId, port: pair.port }));
  assert.equal(parseClaim(await f.claim.read()).phase, phase);
  await unlink(f.claimPath()); entered = 0;
  const before = await f.board.read(), head = await f.claim.head();
  await assert.rejects(store.update(IDS.gone, c => { c.multiplexer = 'none'; }), /ADOPTION_NOT_READY/);
  await assert.rejects(runtime.receive({ version: 1, from: IDS.workerOne, to: IDS.gone, kind: 'status', payload: { port: 12345, busy: false } }), /ADOPTION_NOT_READY/);
  // The actual persisted pending job forces recover's real ordinary-publication path.
  const handoff = new HandoffWorkflow({ state: async () => {
    const config = await store.read();
    return { id: IDS.gone, config, me: config.agents[0] };
  }, assertCurrent() {}, update: mutate => store.update(IDS.gone, mutate), send: async () => assert.fail('no send'), deliver: () => assert.fail('no turn'), busy: () => false });
  try { await assert.rejects(handoff.recover(), /ADOPTION_NOT_READY/); } finally { handoff.dispose(); }
  assert.equal(entered, 0); assert.equal(await f.board.read(), before); assert.equal(await f.claim.head(), head);
});

const payloads = {
  report: ['report', { status: 'ready_for_review', summary: 'must never persist or notify' }],
  clear: ['report', { status: 'clear', summary: '' }],
  registration: ['registration', { port: 12345, projectDirectory: '.', role: 'developer' }],
  status: ['status', { port: 12345, busy: false }],
  handoff: ['handoff_report', { jobId: 'fixture-orphan', instanceId: 'fixture-instance', summary: 'must not alter jobs' }],
  message: ['message', { message: 'must not start a turn' }],
};
async function post(runtime, key) {
  const [kind, payload] = payloads[key];
  const response = await fetch(`http://127.0.0.1:${runtime.endpoint.port}/intercom`, { method: 'POST', body: JSON.stringify({ version: 1, from: IDS.workerOne, to: IDS.fresh, kind, payload }) });
  return { status: response.status, body: await response.text() };
}
async function reportBytes(f) {
  const directory = path.join(f.home, '.pi-intercom/reports');
  return Promise.all((await readdir(directory)).sort().map(async name => [name, await readFile(path.join(directory, name), 'utf8')]));
}
async function damageAnchor(f, damage) {
  const active = await f.claim.read();
  if (damage === 'malformed-newest-restored') { await f.claim.write('# malformed newer evidence\n'); await f.claim.commit(); await f.claim.write(active); }
  if (damage === 'deleted-newest-restored') { await f.gitOk(['rm', 'coordinator-claim.md']); await f.gitOk(['commit', '-qm', 'fixture latest deletion']); await f.claim.write(active); }
  if (damage === 'missing-worktree') await unlink(f.claimPath());
}
const prior = { version: 1, sessionId: IDS.workerOne, status: 'blocked', summary: 'preserve prior evidence', updatedAt: '2026-10-16T00:00:00.000Z' };
test('B2 already-running malformed newest claim with restored old bytes closes before the first effect', async t => {
  const f = await fixture({ runtime: true }); t.after(f.dispose);
  const runtime = await f.startRuntime(); assert.equal((await runtime.adoptCoordinator(f.context, 'adopt')).ok, true);
  assert.equal(runtime.coordinatorActionReady(), true);
  await saveWorkerReport(f.home, prior);
  const before = await f.board.read(), reports = await reportBytes(f), roles = [...runtime.registeredRoles], jobs = [...runtime.handoff.jobs];
  await damageAnchor(f, 'malformed-newest-restored');
  await assert.rejects(runtime.tool('list', {}), /ADOPTION_NOT_READY/);
  for (const key of Object.keys(payloads)) { const response = await post(runtime, key); assert.equal(response.status, 400, response.body); assert.match(response.body, /ADOPTION_NOT_READY/); }
  await assert.rejects(runtime.tool('list', {}), /ADOPTION_NOT_READY/);
  assert.equal(runtime.coordinatorActionReady(), false);
  assert.equal((await runtime.adoptCoordinator(f.context, 'status')).code, 'RECORD');
  assert.equal(await f.board.read(), before); assert.deepEqual(await reportBytes(f), reports);
  assert.deepEqual([...runtime.registeredRoles], roles); assert.deepEqual([...runtime.handoff.jobs], jobs); assert.equal(f.messages.length, 0);
});

test('B3 real failed promotion → read-only pending status → same-command write-free retry → proceed', async t => {
  const f = await fixture({ runtime: true }); t.after(f.dispose); let swaps = 0;
  const runtime = await f.startRuntime({ store: root => new ConfigStore(root, { rename: async (from, to) => { swaps++; await rename(from, to); } }) });
  const promote = runtime.promoteCoordinator.bind(runtime); runtime.promoteCoordinator = async () => { throw Error('review promotion failure'); };
  assert.equal((await runtime.adoptCoordinator(f.context, 'adopt')).code, 'PROMOTION_PENDING'); assert.equal(swaps, 1);
  const head = await f.claim.head(), raw = await f.board.read(), claim = await f.claim.read();
  const status = await runtime.adoptCoordinator(f.context, 'status');
  assert.equal(status.code, 'PROMOTION_PENDING'); assert.equal(status.ok, false); assert.equal(status.exitCode, 1);
  assert.ok(status.lines.some(line => line.includes('write-free promotion retry'))); assert.ok(!status.lines.some(line => /proceed/.test(line)));
  assert.equal(runtime.coordinatorActionReady(), false);
  assert.equal(await f.claim.head(), head); assert.equal(await f.board.read(), raw); assert.equal(await f.claim.read(), claim);
  runtime.promoteCoordinator = promote;
  assert.equal((await runtime.adoptCoordinator(f.context, 'adopt')).code, 'CLAIM_OK');
  const ready = await runtime.adoptCoordinator(f.context, 'status'); assert.equal(ready.code, 'OK'); assert.ok(ready.lines.includes('STATUS OK: b — proceed'));
  assert.equal(runtime.coordinatorActionReady(), true); assert.equal(swaps, 1);
  assert.equal(await f.claim.head(), head); assert.equal(await f.board.read(), raw); assert.equal(await f.claim.read(), claim);
});

test('ordinary config publication proves evidence after temp close, independently of cheap runtime preparation', async t => {
  const f = await fixture({ runtime: true }); t.after(f.dispose); let armed = false, renames = 0;
  class StagedStore extends ConfigStore {
    async openTemporary(file) {
      const handle = await super.openTemporary(file), close = handle.close.bind(handle);
      handle.close = async () => { await close(); if (armed) { armed = false; await f.claim.write('malformed after config temp close\\n'); } };
      return handle;
    }
  }
  const runtime = await f.startRuntime({ store: root => new StagedStore(root, { rename: async (...args) => { renames++; await rename(...args); } }) });
  assert.equal((await runtime.adoptCoordinator(f.context, 'adopt')).ok, true);
  const before = await f.board.read(), swaps = renames; armed = true;
  await assert.rejects(runtime.receive({ version: 1, from: IDS.workerOne, to: IDS.fresh, kind: 'status', payload: { port: 12345, busy: false } }), /ADOPTION_NOT_READY/);
  assert.equal(await f.board.read(), before); assert.equal(renames, swaps);
  assert.equal((await readdir(path.join(f.home, '.pi-intercom'))).some(name => name.endsWith('.tmp')), false);
});

// Approved 6edcf27 store/runtime split: hold real cleanup/release, not a guard ordinal.
async function boundaryFixture(t, options = {}) {
  const f = await fixture({ runtime: true }), readGate = barrier(), releaseGate = barrier(), cleanupGate = barrier(), reportGate = barrier();
  const c = { mutations: 0, mutatedConfigs: [], renames: 0, stopped: 0, pending: [], phases: [], pauseRead: false, holdRelease: false, holdCleanup: false };
  let runtime;
  class ControlledStore extends ConfigStore {
    async exclusive(run, guard) { if (c.acquire) { const action = c.acquire; c.acquire = undefined; await action(this); } return super.exclusive(run, guard); }
    async acquireLock(guard) {
      const lock = await super.acquireLock(guard);
      return { ...lock, release: async () => { if (c.holdRelease) await releaseGate.wait(); return lock.release(); } };
    }
    async read() {
      if (c.pauseRead && existsSync(this.lockDirectory)) { c.pauseRead = false; await readGate.wait(); }
      if (c.readError && existsSync(this.lockDirectory)) throw c.readError;
      return super.read();
    }
    async openTemporary(file) {
      if (c.tempError) throw c.tempError;
      const handle = await super.openTemporary(file), close = handle.close.bind(handle);
      handle.close = async () => { await close(); if (c.stage) { const action = c.stage; c.stage = undefined; await action(this); } };
      return handle;
    }
    update(id, mutate, guard) {
      return super.update(id, config => { c.mutations++; c.mutatedConfigs.push(config); if (c.mutateHook) { const hook = c.mutateHook; c.mutateHook = undefined; hook(config); } return mutate(config); }, phase => {
        try { guard?.(phase); }
        finally { if (phase) c.phases.push({ phase, ready: runtime?.coordinatorActionReady(), epoch: runtime?.actionEpoch() }); }
      });
    }
  }
  const originalUnlink = fs.unlink;
  fs.unlink = async (...args) => { if (c.holdCleanup && String(args[0]).startsWith(path.join(f.home, '.pi-intercom/config.json.')) && String(args[0]).endsWith('.tmp')) await cleanupGate.wait(); return originalUnlink(...args); };
  syncBuiltinESMExports();
  t.after(async () => { readGate.release(); releaseGate.release(); cleanupGate.release(); reportGate.release(); await Promise.allSettled(c.pending); fs.unlink = originalUnlink; syncBuiltinESMExports(); await f.dispose(); });
  runtime = await f.startRuntime({
    store: root => new ControlledStore(root, { ...options, rename: async (...args) => { c.renames++; if (c.renameError) throw c.renameError; if (c.renameAction) return c.renameAction(...args); return rename(...args); } }),
    reminderClock: { schedule: () => () => { c.stopped++; } },
    adoption: { ...f.workflowOptions, reportPhase: async phase => { if (c.pauseReport && phase === 'before-save') { c.pauseReport = false; await reportGate.wait(); } } },
  });
  assert.equal((await runtime.adoptCoordinator(f.context, 'adopt')).ok, true);
  const track = promise => { c.pending.push(promise); promise.catch(() => {}); return promise; };
  return { f, runtime, c, readGate, releaseGate, cleanupGate, reportGate, track };
}
const statusMessage = { version: 1, from: IDS.workerOne, to: IDS.fresh, kind: 'status', payload: { port: 12345, busy: false } };

// Ordinary admission error origins are distinct: a missing config file (ENOENT), an unreadable one
// (EACCES from the store read), an unusable schema, and a foreign current pair. Each must notify
// `authority-refused` synchronously while the same update's release is still held. Malformed JSON is
// not repeated here; it has real publisher coverage below and at the startup writer.
for (const fault of ['missing', 'unreadable', 'schema', 'foreign']) test(`ordinary admission prefix closes BEFORE held release: ${fault}`, { timeout: 15000 }, async t => {
  const b = await boundaryFixture(t), { f, runtime: r, c } = b;
  await saveWorkerReport(f.home, prior); c.pauseReport = true;
  const oldReport = b.track(r.receive({ ...statusMessage, kind: 'report', payload: payloads.report[1] })); await b.reportGate.reached;
  const before = await f.board.read(), swaps = c.renames, epoch = r.actionEpoch(); r.reminders.arm();
  c.pauseRead = true; c.holdRelease = true;
  const pending = b.track(r.receive(statusMessage)); await b.readGate.reached;
  if (fault === 'missing') await unlink(r.store.file);
  if (fault === 'unreadable') c.readError = Object.assign(Error('fixture read EACCES'), { code: 'EACCES' });
  if (fault === 'schema') await f.board.write('{"version":2}');
  if (fault === 'foreign') { const config = JSON.parse(before); config.agents[0].sessionId = 'different-coordinator'; await f.board.write(JSON.stringify(config)); }
  b.readGate.release(); await b.releaseGate.reached;
  assert.equal(r.coordinatorActionReady(), false); assert.notEqual(r.actionEpoch(), epoch); assert.equal(c.stopped, 1);
  assert.equal(c.mutations, 0); assert.equal(c.renames, swaps); assert.deepEqual(await readWorkerReports(f.home, [IDS.workerOne]), [prior]);
  assert.ok(c.phases.some(p => p.phase === 'authority-refused' && p.ready === false));
  c.readError = undefined; await f.board.write(before); c.holdRelease = false; b.releaseGate.release();
  await assert.rejects(pending, error => fault === 'missing' ? error.code === 'ENOENT' : fault === 'unreadable' ? error.code === 'EACCES' : /config|coordinator permission|schema|version/.test(String(error)));
  assert.equal((await r.adoptCoordinator(f.context, 'adopt')).ok, true);
  b.reportGate.release(); await assert.rejects(oldReport, /ADOPTION_NOT_READY/);
  assert.equal(f.messages.length, 0); assert.equal(await f.board.read(), before); assert.deepEqual(await readWorkerReports(f.home, [IDS.workerOne]), [prior]);
});

test('final store authority closes BEFORE temp cleanup when the newest claim is malformed', { timeout: 15000 }, async t => {
  const fault = 'malformed';
  const b = await boundaryFixture(t), { f, runtime: r, c } = b;
  const before = await f.board.read(), claim = await f.claim.read(), oldPort = r.endpoint.port, responsibility = r.responsibility, swaps = c.renames;
  const oldGit = process.env.GIT_DIR; t.after(() => { if (oldGit === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = oldGit; });
  c.holdCleanup = true; r.reminders.arm();
  c.stage = async () => {
    if (fault === 'malformed') await f.claim.write('malformed at final store boundary\n');
    if (fault === 'missing') await unlink(f.claimPath());
    if (fault === 'deleted-latest') { await f.gitOk(['rm', 'coordinator-claim.md']); await f.gitOk(['commit', '-qm', 'fixture latest deletion']); await f.claim.write(claim); }
    if (fault === 'history-unavailable') process.env.GIT_DIR = path.join(f.home, 'unavailable-git');
    if (fault === 'different-valid-active') { const pair = JSON.parse(before).agents[0]; await f.claim.writeAndCommit(await f.declaration({ sessionId: pair.sessionId, port: pair.port })); assert.equal(committedActiveClaimMatches(f.home, await f.claim.read()), true); }
    if (fault === 'promotion') r.responsibility = undefined;
    if (fault === 'endpoint') r.endpoint.port++;
  };
  const pending = b.track(r.tool('set_multiplexer', { multiplexer: 'none' })); await b.cleanupGate.reached;
  assert.equal(r.coordinatorActionReady(), false); assert.equal(c.stopped, 1); assert.equal(c.renames, swaps); assert.equal(await f.board.read(), before);
  if (oldGit === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = oldGit;
  r.responsibility = responsibility; r.endpoint.port = oldPort;
  await f.claim.write(claim); if (['deleted-latest', 'different-valid-active'].includes(fault)) await f.claim.commit();
  c.holdCleanup = false; b.cleanupGate.release(); await assert.rejects(pending, /ADOPTION_NOT_READY/);
  assert.equal((await r.adoptCoordinator(f.context, 'adopt')).ok, true);
});

// Claim-history admission inside the held lock: absent bytes, malformed bytes, a directory where the
// claim file belongs, and an unverifiable history query are four distinct refusals.
for (const fault of ['claim-missing', 'claim-malformed', 'claim-directory', 'query']) test(`inside-lock claim admission refuses BEFORE mutator/release: ${fault}`, async t => {
  const b = await boundaryFixture(t), { f, runtime: r, c } = b;
  const raw = await f.claim.read(), before = await f.board.read(), swaps = c.renames, oldGit = process.env.GIT_DIR;
  t.after(() => { if (oldGit === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = oldGit; });
  c.pauseRead = true; c.holdRelease = true;
  const pending = b.track(r.tool('set_multiplexer', { multiplexer: 'none' })); await b.readGate.reached;
  if (fault === 'claim-missing') await unlink(f.claimPath());
  if (fault === 'claim-malformed') await f.claim.write('malformed admission claim\n');
  if (fault === 'claim-directory') { await unlink(f.claimPath()); await mkdir(f.claimPath()); }
  if (fault === 'query') process.env.GIT_DIR = path.join(f.home, 'unavailable-git');
  b.readGate.release(); await b.releaseGate.reached;
  assert.equal(r.coordinatorActionReady(), false); assert.equal(c.mutations, 0); assert.equal(c.renames, swaps); assert.equal(await f.board.read(), before);
  if (oldGit === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = oldGit;
  if (fault === 'claim-directory') await rm(f.claimPath(), { recursive: true });
  await f.claim.write(raw); c.holdRelease = false; b.releaseGate.release(); await assert.rejects(pending, /ADOPTION_NOT_READY/);
});

// Acquisition-path authority refusal: an aliased authority root, a config symlink, a board path of the
// wrong type, and a failing authority inspection are distinct branches of the same synchronous signal.
for (const fault of ['alias', 'config-symlink', 'board-type', 'inspection']) test(`ordinary acquisition authority-path refusal signals synchronously: ${fault}`, async t => {
  const b = await boundaryFixture(t), { f, runtime: r, c } = b;
  const root = r.store.root, file = r.store.file, before = await f.board.read(), original = syncFs.lstatSync;
  let inspect = false;
  t.after(() => { syncFs.lstatSync = original; syncBuiltinESMExports(); });
  syncFs.lstatSync = (...args) => { if (inspect && String(args[0]) === root) throw Object.assign(Error('fixture authority inspection EACCES'), { code: 'EACCES' }); return original(...args); }; syncBuiltinESMExports();
  c.acquire = async store => {
    if (fault === 'alias') { const alias = path.join(root, 'app/root-alias'); await symlink(root, alias); store.root = alias; }
    if (fault === 'config-symlink') { await rename(file, `${file}.backup`); await symlink(`${file}.backup`, file); }
    if (fault === 'board-type') { await rename(path.dirname(file), path.join(root, '.board-backup')); await writeFile(path.dirname(file), 'not a directory'); }
    if (fault === 'inspection') inspect = true;
  };
  const pending = b.track(r.tool('set_multiplexer', { multiplexer: 'none' })); await assert.rejects(pending);
  assert.equal(r.coordinatorActionReady(), false); assert.equal(c.mutations, 0);
  assert.ok(c.phases.some(p => p.phase === 'authority-refused' && !p.ready));
  inspect = false; r.store.root = root;
  if (fault === 'config-symlink') { await unlink(file); await rename(`${file}.backup`, file); }
  if (fault === 'board-type') { await unlink(path.dirname(file)); await rename(path.join(root, '.board-backup'), path.dirname(file)); }
  assert.equal(await f.board.read(), before);
});

test('direct store preserves the originating foreign-pair refusal when the guard throws', async t => {
  const fault = 'foreign', guardKind = 'throw';
  const f = await fixture(); t.after(f.dispose);
  const marker = Object.assign(Error('fixture read EACCES'), { code: 'EACCES' });
  class ReadStore extends ConfigStore { async read() { if (fault === 'read') throw marker; return super.read(); } }
  if (fault === 'missing') await unlink(f.configPath());
  if (fault === 'JSON') await f.board.write('{bad');
  if (fault === 'schema') await f.board.write('{"version":2}');
  if (fault === 'foreign') { const config = await f.board.parsed(); config.agents[0].sessionId = 'foreign-coordinator'; await f.board.write(JSON.stringify(config)); }
  if (fault === 'claim') await f.claim.write('uncommitted invalid evidence\n');
  let mutated = false, notified = 0;
  const guard = guardKind === 'absent' ? undefined : phase => { if (phase === 'authority-refused') { notified++; if (guardKind === 'throw') throw Error('must not mask originating error'); } };
  await assert.rejects(new ReadStore(f.home).update(IDS.gone, () => { mutated = true; }, guard), error => {
    if (fault === 'missing') return error.code === 'ENOENT';
    if (fault === 'read') return error === marker;
    if (fault === 'JSON') return error instanceof SyntaxError;
    return /config|coordinator permission|ADOPTION_NOT_READY/.test(String(error)) && !String(error).includes('mask');
  });
  assert.equal(mutated, false); assert.equal(notified, guardKind === 'absent' ? 0 : 1);
});

// Negative classification only: an authority-enabled epoch stays open for each distinct non-authority
// error site (caller guard, mutator, post-mutator validation, temporary file, rename, lock contention,
// lock I/O, lost ownership token, release). Each cell pins the exact error object it must produce, so
// a cell cannot pass on another fault's error: release injects its own distinct error into the owner
// file unlink, and only that error satisfies its assertion.
for (const fault of ['lifecycle', 'mutator', 'post-schema', 'temp', 'rename', 'contention', 'lock-io', 'token', 'release']) test(`non-authority ${fault} failure does NOT close an authority-enabled epoch`, async t => {
  const b = await boundaryFixture(t), { f, runtime: r, c } = b;
  const before = await f.board.read(), epoch = r.actionEpoch(), marker = Object.assign(Error('invalid config schema/version (fixture non-authority EACCES)'), { code: 'EACCES' });
  const releaseError = Object.assign(Error('fixture release failure (non-authority EACCES)'), { code: 'EACCES' });
  let released = false;
  const open = fs.open, unlinkFile = fs.unlink;
  t.after(() => { fs.open = open; fs.unlink = unlinkFile; syncBuiltinESMExports(); });
  if (fault === 'temp') c.tempError = marker;
  if (fault === 'rename') c.renameError = marker;
  if (fault === 'contention') await mkdir(r.store.lockDirectory);
  if (fault === 'lock-io') fs.open = async (...args) => { if (String(args[0]).endsWith('/config.lock/owner.json')) throw marker; return open(...args); };
  if (fault === 'token') c.stage = async () => { const file = path.join(r.store.lockDirectory, 'owner.json'); const owner = JSON.parse(await readFile(file, 'utf8')); await writeFile(file, JSON.stringify({ ...owner, token: 'foreign-fixture-token' })); };
  if (fault === 'release') fs.unlink = async (...args) => { if (String(args[0]).endsWith('/config.lock/owner.json')) { released = true; throw releaseError; } return unlinkFile(...args); };
  syncBuiltinESMExports();
  const guard = r.configGuard(r.validity(), epoch, fault === 'lifecycle' ? () => { throw marker; } : undefined);
  const expected = { lifecycle: marker, mutator: marker, temp: marker, rename: marker, 'lock-io': marker, release: releaseError }[fault];
  await assert.rejects(r.store.update(IDS.fresh, config => { if (fault === 'mutator' || fault === 'release') throw marker; if (fault === 'post-schema') config.version = 2; else config.multiplexer = 'none'; }, guard), error => expected !== undefined ? error === expected
    : fault === 'post-schema' ? /invalid config schema\/version/.test(String(error))
      : fault === 'contention' ? /lock is held by another process/.test(String(error))
        : /ownership is uncertain/.test(String(error)));
  if (fault === 'release') assert.equal(released, true, 'the release injection must actually be reached');
  assert.equal(r.coordinatorActionReady(), true); assert.equal(r.actionEpoch(), epoch); assert.equal(await f.board.read(), before);
  assert.ok(!c.phases.some(p => p.phase === 'authority-refused'));
});

test('late old guard refusal cannot close a newer reopened epoch', async t => {
  const invalidation = 'reopened';
  const b = await boundaryFixture(t), r = b.runtime, old = r.configGuard(r.validity(), r.actionEpoch());
  r.closeActionEpoch('fixture old operation');
  if (invalidation === 'lifecycle') { r.generation++; r.openActionEpoch(); }
  else assert.equal((await r.adoptCoordinator(b.f.context, 'adopt')).ok, true);
  const current = r.actionEpoch(); await assert.rejects(Promise.resolve().then(() => old('authority-refused')));
  assert.equal(r.coordinatorActionReady(), true); assert.equal(r.actionEpoch(), current);
});

test('final store proof is independent of a throwing runtime guard', async t => {
  const guardKind = 'throw';
  const f = await fixture(); t.after(f.dispose);
  const pair = (await f.board.parsed()).agents[0]; await f.claim.writeAndCommit(await f.declaration({ sessionId: pair.sessionId, port: pair.port }));
  const before = await f.board.read(); let notified = 0, renames = 0, injected = false;
  class Store extends ConfigStore { async openTemporary(file) { const handle = await super.openTemporary(file), close = handle.close.bind(handle); handle.close = async () => { await close(); if (!injected) { injected = true; await f.claim.write('malformed after staging\n'); } }; return handle; } }
  const guard = guardKind === 'absent' ? undefined : phase => { if (phase === 'authority-refused') { notified++; if (guardKind === 'throw') throw Error('notification must not mask proof refusal'); } };
  const store = new Store(f.home, { rename: async (...args) => { renames++; return rename(...args); } });
  await assert.rejects(store.update(IDS.gone, config => { config.multiplexer = 'none'; }, guard), /ADOPTION_NOT_READY/);
  assert.equal(renames, 0); assert.equal(await f.board.read(), before); assert.equal(notified, guardKind === 'absent' ? 0 : 1);
});

test('Windows simulated retry repeats local/store proof before another rename; closure precedes cleanup', { timeout: 15000 }, async t => {
  let b, backoffs = 0;
  b = await boundaryFixture(t, { platform: 'win32', delay: async () => {
    backoffs++; const raw = await b.f.claim.read(); await b.f.claim.write('malformed during EPERM backoff\n'); await b.f.claim.commit(); await b.f.claim.write(raw);
  } });
  const { f, runtime: r, c } = b, before = await f.board.read(), attempts = c.renames;
  c.holdCleanup = true; c.renameAction = async () => { throw Object.assign(Error('fixture reader EPERM'), { code: 'EPERM' }); }; r.reminders.arm();
  const pending = b.track(r.tool('set_multiplexer', { multiplexer: 'none' })); await b.cleanupGate.reached;
  assert.equal(r.coordinatorActionReady(), false); assert.equal(c.stopped, 1); assert.equal(c.renames, attempts + 1); assert.equal(backoffs, 1); assert.equal(c.mutations, 1);
  assert.equal(await f.board.read(), before); c.holdCleanup = false; b.cleanupGate.release(); await assert.rejects(pending, /ADOPTION_NOT_READY/);
});

// One representative per ordinary publisher: each closes authority synchronously while its own lock
// release is still held, rather than at later runtime shutdown.
for (const writer of ['status', 'tool', 'configure', 'remove', 'metadata']) test(`ordinary runtime ${writer} publisher carries refusal phases before held release`, { timeout: 15000 }, async t => {
  const b = await boundaryFixture(t), { f, runtime: r, c } = b;
  if (writer === 'metadata') await r.store.update(IDS.fresh, config => { config.agents[0].dashboardPort = 11001; }, r.configGuard(r.validity(), r.actionEpoch()));
  const before = await f.board.read(), swaps = c.renames; c.mutations = 0; c.pauseRead = true; c.holdRelease = true;
  let work;
  if (writer === 'status') work = r.receive(statusMessage);
  if (writer === 'tool') work = r.tool('set_multiplexer', { multiplexer: 'none' });
  if (writer === 'configure') work = r.tool('configure_worker', { sessionId: IDS.workerOne, name: 'Builder', description: 'fixture update', port: JSON.parse(before).agents[1].port, projectDirectory: 'app' });
  if (writer === 'remove') work = r.tool('remove_worker', { to: 'Builder' });
  if (writer === 'handoff') work = r.handoff.recover();
  if (writer === 'metadata') work = r.retireDashboardMetadata();
  const pending = b.track(work); await b.readGate.reached; await f.board.write('{invalid-current-config'); b.readGate.release(); await b.releaseGate.reached;
  assert.equal(r.coordinatorActionReady(), false); assert.equal(c.mutations, 0); assert.equal(c.renames, swaps);
  await f.board.write(before); c.holdRelease = false; b.releaseGate.release(); await assert.rejects(pending, SyntaxError); assert.equal(await f.board.read(), before);
});

test('startup port ordinary writer closes authority before held release, not later runtime shutdown', { timeout: 15000 }, async t => {
  const f = await fixture({ runtime: true, self: true }), gate = barrier(); let runtime, mutations = 0;
  const config = await f.board.parsed(); for (const agent of config.agents) delete agent.closeJob;
  await f.board.write(JSON.stringify(config)); const before = await f.board.read(), pair = config.agents[0];
  await f.claim.writeAndCommit(await f.declaration({ sessionId: IDS.gone, port: pair.port }));
  class Store extends ConfigStore {
    async update(id, mutate, guard) { await f.board.write('{malformed startup config'); return super.update(id, c => { mutations++; return mutate(c); }, guard); }
    async acquireLock(guard) { const lock = await super.acquireLock(guard); return { ...lock, release: async () => { await gate.wait(); return lock.release(); } }; }
  }
  runtime = new Intercom({ cwd: f.home, sessionId: () => IDS.gone, roleDirectory: path.join(f.home, 'roles/orchestrator'), rolesDirectory: path.join(f.home, 'roles'), workerRole: '', busy: () => false, deliver: () => assert.fail('no model'), notify() {}, setName: async () => {} },
    { launch: async () => assert.fail('no launch'), store: root => new Store(root), observe: () => ({ record() {}, close() {}, maintain() {} }), adoption: { projectsHome: f.home, rolesDirectory: path.join(f.home, 'roles') } });
  t.after(async () => { gate.release(); await runtime.close(); await f.dispose(); });
  const pending = runtime.start(); pending.catch(() => {}); await gate.reached;
  assert.equal(runtime.active, true, 'shutdown cannot yet have observed the pending store error'); assert.equal(runtime.coordinatorActionReady(), false); assert.equal(mutations, 0);
  await f.board.write(before); gate.release(); await assert.rejects(pending, SyntaxError); assert.equal(await f.board.read(), before);
});

test('non-Orchestrator runtime retains native read error and gains no refusal policy', async t => {
  const f = await fixture(); let runtime; t.after(async () => { await runtime?.close(); await f.dispose(); });
  const pair = (await f.board.parsed()).agents[0], marker = Object.assign(Error('fixture native read EACCES'), { code: 'EACCES' }); let fault = false;
  class Store extends ConfigStore { async read() { if (fault) throw marker; return super.read(); } }
  runtime = new Intercom({ cwd: f.home, sessionId: () => IDS.gone, roleDirectory: path.join(f.home, 'roles/developer'), workerRole: '', busy: () => false, deliver() {}, notify() {}, setName: async () => {} },
    { store: root => new Store(root), launch: async () => assert.fail('no launch'), listen: async () => ({ port: pair.port, close: async () => {} }), observe: () => ({ record() {}, close() {}, maintain() {} }) });
  await runtime.start(); const epoch = runtime.actionEpoch(); fault = true;
  await assert.rejects(runtime.store.update(IDS.gone, () => assert.fail('no mutate'), runtime.configGuard(runtime.validity(), epoch)), error => error === marker);
  assert.equal(runtime.authorityEnabled, false); assert.equal(runtime.coordinatorActionReady(), true); assert.equal(runtime.actionEpoch(), epoch);
});

async function handoffBoundary(t, operation) {
  const b = await boundaryFixture(t), h = b.runtime.handoff; h.background = () => {};
  if (operation !== 'request') await b.runtime.tool('close_worker', { to: 'Builder' });
  if (operation === 'report') { await h.transition(h.jobs.get(IDS.workerOne), 'awaiting_handoff'); h.jobs.get(IDS.workerOne).instanceId = 'fixture-instance'; }
  b.c.mutations = 0; b.c.mutatedConfigs = [];
  b.run = () => operation === 'request' ? b.runtime.tool('close_worker', { to: 'Builder' }) : operation === 'transition' ? h.transition(h.jobs.get(IDS.workerOne), 'awaiting_handoff') : h.receive('handoff_report', IDS.workerOne, { jobId: h.jobs.get(IDS.workerOne).job.jobId, instanceId: 'fixture-instance', summary: 'public fixture summary' });
  return b;
}
// Surviving transition-site cell: at mutation timing the mutator body itself re-enters targetForUpdate,
// so this is the in-mutator job-predicate fence, not the guard wiring (proved separately below).
for (const fault of ['disposed', 'ended', 'map', 'deadline']) test(`handoff transition mutation retains local ${fault} fence`, { timeout: 15000 }, async t => {
  const operation = 'transition', timing = 'mutation';
  const b = await handoffBoundary(t, operation), { runtime: r, c, f } = b, h = r.handoff, gate = barrier();
  t.after(gate.release);
  const before = await f.board.parsed(), epoch = r.actionEpoch(); let p;
  const invalidate = () => { p = h.jobs.get(IDS.workerOne); if (fault === 'disposed') h.disposed = true; if (fault === 'ended') p.ended = true; if (fault === 'map') h.jobs.set(IDS.workerOne, { ...p }); if (fault === 'deadline') p.job.deadlineAt = '2000-01-01T00:00:00.000Z'; };
  if (timing === 'queued') c.acquire = () => gate.wait();
  if (timing === 'mutation') c.mutateHook = invalidate;
  if (timing === 'staging') c.stage = invalidate;
  const pending = b.track(b.run()); if (timing === 'queued') { await gate.reached; invalidate(); gate.release(); }
  await assert.rejects(pending, /invalid handoff protocol\/state/);
  const after = await f.board.parsed(), worker = after.agents.find(a => a.sessionId === IDS.workerOne);
  assert.equal(worker.handoff, undefined); assert.notEqual(worker.closeJob?.state, operation === 'request' ? 'requested' : operation === 'transition' ? 'awaiting_handoff' : 'awaiting_settlement');
  assert.equal(r.coordinatorActionReady(), true); assert.equal(r.actionEpoch(), epoch); assert.ok(!c.phases.some(e => e.phase === 'authority-refused'));
  assert.deepEqual(after.agents.filter(a => a.sessionId !== IDS.workerOne), before.agents.filter(a => a.sessionId !== IDS.workerOne));
  if (operation === 'report' && timing === 'mutation') assert.equal(c.mutatedConfigs[0].agents.find(a => a.sessionId === IDS.workerOne).handoff, undefined);
  if (operation === 'transition') assert.equal(p.job.state, timing === 'staging' ? 'awaiting_handoff' : 'requested'); // prior admitted in-memory mutation is not rolled back
});

// Each update site also passes its OWN guard to the store: request (src/handoff.ts:147-152), transition
// (:118-123), report (:250-255). One guard proof per site, at the boundary that site's mutator body
// cannot already refuse: request's mutator has no job predicate, so only its post-mutator guard check can
// refuse; transition re-enters targetForUpdate inside its mutator, so its queued pre-mutator guard check
// is the distinct one; report likewise, so its staging/final-rename guard check is used. The report
// deadline predicate at that same boundary already has a surviving proof in tests/handoff.test.mjs
// ('summary temporary-file sync crossing deadline cannot publish a late handoff or close').
const HANDOFF_GUARD_SITES = [
  ['request', 'mutation', ['disposed', 'ended', 'map', 'deadline']],
  ['transition', 'queued', ['disposed', 'ended', 'map', 'deadline']],
  ['report', 'staging', ['disposed', 'ended', 'map']],
];
for (const [operation, timing, faults] of HANDOFF_GUARD_SITES) for (const fault of faults) test(`handoff ${operation} ${timing} update-site guard retains local ${fault} fence`, { timeout: 15000 }, async t => {
  const b = await handoffBoundary(t, operation), { runtime: r, c, f } = b, h = r.handoff, gate = barrier();
  t.after(gate.release);
  const before = await f.board.parsed(), epoch = r.actionEpoch(); let p;
  const invalidate = () => { p = h.jobs.get(IDS.workerOne); if (fault === 'disposed') h.disposed = true; if (fault === 'ended') p.ended = true; if (fault === 'map') h.jobs.set(IDS.workerOne, { ...p }); if (fault === 'deadline') p.job.deadlineAt = '2000-01-01T00:00:00.000Z'; };
  if (timing === 'queued') c.acquire = () => gate.wait();
  if (timing === 'mutation') c.mutateHook = invalidate;
  if (timing === 'staging') c.stage = invalidate;
  const pending = b.track(b.run());
  if (timing === 'queued') { await gate.reached; invalidate(); gate.release(); }
  await assert.rejects(pending, /invalid handoff protocol\/state/);
  const after = await f.board.parsed(), worker = after.agents.find(a => a.sessionId === IDS.workerOne);
  assert.equal(worker.handoff, undefined, 'a refused update publishes no handoff summary');
  assert.notEqual(worker.closeJob?.state, operation === 'request' ? 'requested' : operation === 'transition' ? 'awaiting_handoff' : 'awaiting_settlement');
  assert.equal(r.coordinatorActionReady(), true); assert.equal(r.actionEpoch(), epoch); // local fence only: tenure stays open
  assert.ok(!c.phases.some(e => e.phase === 'authority-refused'));
  assert.deepEqual(after.agents.filter(a => a.sessionId !== IDS.workerOne), before.agents.filter(a => a.sessionId !== IDS.workerOne));
  if (timing === 'queued') assert.equal(c.mutations, 0, 'a queued guard refusal stops before the mutator');
});
for (const fault of ['missing', 'coordinator', 'job', 'port', 'directory']) test(`handoff transition target retains ${fault} predicate before mutation`, async t => {
  const operation = 'transition';
  const b = await handoffBoundary(t, operation), { runtime: r, c, f } = b, epoch = r.actionEpoch();
  c.mutateHook = config => { const a = config.agents.find(a => a.sessionId === IDS.workerOne); if (fault === 'missing') config.agents = config.agents.filter(x => x !== a); if (fault === 'coordinator') a.coordinator = true; if (fault === 'job') a.closeJob.jobId = 'different-job'; if (fault === 'port') a.port++; if (fault === 'directory') a.projectDirectory = '.'; };
  await assert.rejects(b.run(), /invalid handoff protocol\/state/);
  const worker = (await f.board.parsed()).agents.find(a => a.sessionId === IDS.workerOne); assert.equal(worker.handoff, undefined);
  assert.equal(r.coordinatorActionReady(), true); assert.equal(r.actionEpoch(), epoch);
});

// Second target site: the report update calls targetForUpdate immediately before the summary is
// persisted (src/handoff.ts:250-255), a separate call from transition's. One registered case, one fresh
// boundary per predicate (a refused report fails its job, so state cannot be reused), and the staged
// summary must not be present in the config that was being mutated.
test('handoff report target retains every targetForUpdate predicate before the summary is saved', { timeout: 40000 }, async t => {
  for (const fault of ['missing', 'coordinator', 'job', 'port', 'directory']) {
    const b = await handoffBoundary(t, 'report'), { runtime: r, c, f } = b, epoch = r.actionEpoch();
    c.mutateHook = config => { const a = config.agents.find(a => a.sessionId === IDS.workerOne); if (fault === 'missing') config.agents = config.agents.filter(x => x !== a); if (fault === 'coordinator') a.coordinator = true; if (fault === 'job') a.closeJob.jobId = 'different-job'; if (fault === 'port') a.port++; if (fault === 'directory') a.projectDirectory = '.'; };
    await assert.rejects(b.run(), /invalid handoff protocol\/state/, fault);
    const staged = c.mutatedConfigs[0].agents.find(a => a.sessionId === IDS.workerOne);
    assert.ok(staged === undefined || staged.handoff === undefined, `${fault}: a refused summary must not enter the mutating config`);
    assert.equal((await f.board.parsed()).agents.find(a => a.sessionId === IDS.workerOne).handoff, undefined, fault);
    assert.notEqual((await f.board.parsed()).agents.find(a => a.sessionId === IDS.workerOne).closeJob?.state, 'awaiting_settlement', fault);
    assert.equal(r.coordinatorActionReady(), true, fault); assert.equal(r.actionEpoch(), epoch, fault);
  }
});

test('nested unrelated handoff full guard stays full inside synchronous store mutation; throw leaks no mode', async t => {
  const b = await handoffBoundary(t, 'request'), { runtime: r, c, f } = b; const marker = Error('fixture mutator failure');
  c.mutateHook = () => { throw marker; }; await assert.rejects(b.run(), error => error === marker); assert.equal(r.coordinatorActionReady(), true);
  let children = 0, nestedRefused = false; const original = cp.spawnSync;
  cp.spawnSync = function(...args) { if (args[0] === 'git') children++; return original.apply(this, args); }; syncBuiltinESMExports();
  t.after(() => { cp.spawnSync = original; syncBuiltinESMExports(); });
  c.mutateHook = () => { const before = children; r.handoff.valid(); assert.ok(children > before, 'nested check executes real Git'); writeFileSync(f.claimPath(), 'malformed inside nested full guard\n'); try { r.handoff.valid(); } finally { nestedRefused = !r.coordinatorActionReady(); } };
  await assert.rejects(b.run(), /ADOPTION_NOT_READY/); assert.equal(nestedRefused, true); assert.equal(r.coordinatorActionReady(), false);
  assert.equal((await f.board.parsed()).agents.find(a => a.sessionId === IDS.workerOne).closeJob, undefined);
});
test('handoff queued update retains the original reopen guard', async t => {
  const invalidation = 'reopen';
  const b = await handoffBoundary(t, 'transition'), { runtime: r, c, f } = b, before = await f.board.read();
  c.pauseRead = true; const pending = b.track(b.run()); await b.readGate.reached;
  r.closeActionEpoch('fixture handoff admission'); if (invalidation === 'lifecycle') r.generation++; r.openActionEpoch();
  const epoch = r.actionEpoch(); b.readGate.release(); await assert.rejects(pending, /ADOPTION_NOT_READY|runtime lifecycle replaced/);
  assert.equal(r.coordinatorActionReady(), true); assert.equal(r.actionEpoch(), epoch); assert.equal(await f.board.read(), before);
});
for (const boundary of ['inspect-guard', 'inspect-return', 'close-guard', 'before-submit', 'commit-return', 'close-return']) test(`handoff ${boundary} full proof detects malformed newest evidence`, { timeout: 15000 }, async t => {
  const damage = 'malformed';
  const b = await handoffBoundary(t, boundary.startsWith('inspect') ? 'transition' : 'report'), { runtime: r, f } = b, h = r.handoff, p = h.jobs.get(IDS.workerOne), gate = barrier();
  const oldGit = process.env.GIT_DIR; t.after(() => { gate.release(); if (oldGit === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = oldGit; });
  let sends = 0, paneActions = 0, background;
  h.ctx.send = async (_to, kind) => { sends++; if (kind === 'close_commit' && boundary === 'commit-return') await gate.wait(); };
  h.ctx.provider.inspect = async (_proof, _id, guard) => { if (boundary === 'inspect-guard') await gate.wait(); guard(); if (boundary === 'inspect-return') await gate.wait(); };
  h.ctx.provider.close = async (_proof, _id, guard, beforeSubmit) => {
    if (boundary === 'close-guard') await gate.wait(); guard();
    if (boundary === 'before-submit') await gate.wait(); await beforeSubmit(); guard(); paneActions++;
    if (boundary === 'close-return') await gate.wait(); return { paneClosed: true, workerExited: true };
  };
  h.background = work => { background = b.track(Promise.resolve().then(work)); };
  if (boundary.startsWith('inspect')) await h.receive('close_identity', IDS.workerOne, { jobId: p.job.jobId, instanceId: 'fixture-instance', identity: { workspaceId: 'fixture', paneId: 'fixture', terminalId: 'fixture', sessionId: IDS.workerOne, sessionFile: path.join(f.home, 'sessions/fixture.jsonl'), pid: process.pid, processStart: 'fixture' } });
  else { await b.run(); await h.receive('close_ready', IDS.workerOne, { jobId: p.job.jobId, instanceId: 'fixture-instance', readyNonce: 'fixture-nonce' }); }
  await gate.reached; const raw = await f.claim.read(), before = await f.board.read();
  if (damage === 'malformed') { await f.claim.write('malformed newest provider evidence\n'); await f.claim.commit(); await f.claim.write(raw); }
  if (damage === 'deleted') { await f.gitOk(['rm', 'coordinator-claim.md']); await f.gitOk(['commit', '-qm', 'fixture provider deletion']); await f.claim.write(raw); }
  if (damage === 'unavailable') process.env.GIT_DIR = path.join(f.home, 'unavailable-git');
  gate.release(); await background;
  assert.equal(r.coordinatorActionReady(), false); assert.equal(await f.board.read(), before); assert.equal(paneActions, boundary === 'close-return' ? 1 : 0); assert.equal(sends, ['commit-return', 'close-return'].includes(boundary) ? 1 : 0);
});

test('legacy absence is rediscovered on the next reentrant update', async t => {
  const startsWithRepo = false, outerOwner = true;
  const f = await fixture(); t.after(f.dispose); const before = await f.board.read(), pair = (await f.board.parsed()).agents[0];
  if (!startsWithRepo) await rm(path.join(f.home, '.git'), { recursive: true });
  let injected = false;
  class Store extends ConfigStore {
    async openTemporary(file) { const handle = await super.openTemporary(file), close = handle.close.bind(handle); handle.close = async () => {
      await close(); if (injected) return; injected = true;
      if (!startsWithRepo) { await f.gitOk(['init', '-q']); await f.gitOk(['config', 'user.name', 'Fixture']); await f.gitOk(['config', 'user.email', 'fixture@example.invalid']); }
      await f.claim.writeAndCommit(await f.declaration({ sessionId: pair.sessionId, port: pair.port }));
      await f.gitOk(['rm', 'coordinator-claim.md']); await f.gitOk(['commit', '-qm', 'fixture established then deleted during staging']);
    }; return handle; }
  }
  let renames = 0;
  const store = new Store(f.home, { rename: async (...args) => { renames++; return rename(...args); } });
  const exercise = async () => {
    // External add/commit/delete during staging bypasses the mutex: neither first outcome is promised.
    await store.update(IDS.gone, config => { config.multiplexer = 'none'; }).catch(error => assert.match(String(error), /ADOPTION_NOT_READY/));
    assert.equal(injected, true); const after = await f.board.read(), attempts = renames;
    await assert.rejects(store.update(IDS.gone, () => assert.fail('NEXT update must refuse before mutation')), /ADOPTION_NOT_READY/);
    assert.equal(renames, attempts); assert.equal(await f.board.read(), after);
    assert.deepEqual(JSON.parse(after).agents, JSON.parse(before).agents);
  };
  if (outerOwner) await store.transaction(exercise); else await exercise();
});

test('supported declaration waits for ordinary legacy writer, rechecks preview, then independently declares', { timeout: 15000 }, async t => {
  const f = await fixture({ self: true }), hold = barrier(), attempted = barrier(); let ordinary, competing;
  t.after(async () => { hold.release(); attempted.release(); await Promise.allSettled([ordinary, competing]); await f.dispose(); });
  const store = new ConfigStore(f.home), before = await f.board.read(), head = await f.claim.head();
  ordinary = store.update(IDS.gone, async config => { await hold.wait(); config.multiplexer = 'none'; }); ordinary.catch(() => {}); await hold.reached;
  class QueuedStore extends ConfigStore { outerQueue(run) { void attempted.wait(); return super.outerQueue(run); } }
  let settled = false;
  competing = f.workflow({ storeFor: root => new QueuedStore(root) }).run(f.context, 'adopt').finally(() => { settled = true; }); competing.catch(() => {});
  await attempted.reached; assert.equal(settled, false); assert.equal(existsSync(f.claimPath()), false); assert.equal(await f.claim.head(), head); assert.equal(await f.board.read(), before);
  hold.release(); await ordinary; assert.equal((await competing).code, 'STALE_PREVIEW'); assert.equal(existsSync(f.claimPath()), false);
  assert.equal((await f.workflow().run(f.context, 'adopt')).ok, true); assert.equal(parseClaim(await f.claim.read()).phase, 'active');
  await store.update(IDS.gone, config => { config.agents[1].busy = false; }); // newly valid active evidence is accepted, not a negative cache
});

test('fresh full proof detects a missing intent object without changing active bytes', async t => {
  const f = await fixture({ runtime: true }); t.after(f.dispose);
  const runtime = await f.startRuntime(); assert.equal((await runtime.adoptCoordinator(f.context, 'adopt')).ok, true);
  const raw = await f.claim.read(), record = parseClaim(raw);
  assert.equal(committedActiveClaimMatches(f.home, raw), true);
  await unlink(path.join(f.home, '.git/objects', record.intentCommit.slice(0, 2), record.intentCommit.slice(2)));
  assert.equal(await f.claim.read(), raw);
  assert.equal(committedActiveClaimMatches(f.home, raw), false);
  await assert.rejects(runtime.tool('list', {}), /ADOPTION_NOT_READY/);
});

// A readable intent object is not ancestry: shallow/graft/replace each break the merge-base check only.
for (const damage of ['shallow', 'graft', 'replace']) test(`fresh full proof detects ${damage} intent ancestry without changing active bytes or anchor`, async t => {
  const f = await fixture({ runtime: true }); t.after(f.dispose);
  const runtime = await f.startRuntime(); assert.equal((await runtime.adoptCoordinator(f.context, 'adopt')).ok, true);
  const raw = await f.claim.read(), record = parseClaim(raw), active = (await f.claim.log())[0];
  assert.equal(committedActiveClaimMatches(f.home, raw), true);
  if (damage === 'shallow') await writeFile(path.join(f.home, '.git/shallow'), `${active}\n`);
  if (damage === 'graft') await writeFile(path.join(f.home, '.git/info/grafts'), `${active}\n`);
  if (damage === 'replace') {
    const tree = (await f.gitOk(['rev-parse', `${active}^{tree}`])).trim();
    const replacement = (await f.gitOk(['commit-tree', tree, '-m', 'fixture parentless replacement'])).trim();
    await f.gitOk(['replace', active, replacement]);
  }
  assert.equal(await f.claim.read(), raw);
  await f.gitOk(['cat-file', '-e', record.intentCommit]); // the intent object itself is still readable
  assert.equal(await f.claim.at(active), raw);            // and the newest committed bytes are unchanged
  assert.equal(committedActiveClaimMatches(f.home, raw), false, 'ancestry, not object availability, is the broken predicate');
  await assert.rejects(runtime.tool('list', {}), /ADOPTION_NOT_READY/);
});

test('newest committed exact restoration is current proof, not historical opening-commit equality', async t => {
  const f = await fixture({ runtime: true }); t.after(f.dispose);
  const runtime = await f.startRuntime(); assert.equal((await runtime.adoptCoordinator(f.context, 'adopt')).ok, true);
  const raw = await f.claim.read(), opening = await f.claim.head();
  await f.claim.write('malformed intervening commit\n'); await f.claim.commit();
  await f.claim.write(raw); await f.claim.commit(); assert.notEqual(await f.claim.head(), opening);
  await runtime.tool('list', {}); assert.equal(runtime.coordinatorActionReady(), true);
  await damageAnchor(f, 'malformed-newest-restored');
  await assert.rejects(runtime.tool('list', {}), /ADOPTION_NOT_READY/);
  await f.claim.write(raw); await f.claim.commit();
  await assert.rejects(runtime.tool('list', {}), /ADOPTION_NOT_READY/, 'restoration does not reopen a closed epoch');
  assert.equal((await runtime.adoptCoordinator(f.context, 'adopt')).ok, true);
  await runtime.tool('list', {});
});

test('benign Git environment preserves an ordinary non-repository writer', async t => {
  const f = await fixture(); t.after(f.dispose); await rm(path.join(f.home, '.git'), { recursive: true, force: true });
  const variable = 'GIT_TRACE', prior = process.env[variable], spawn = cp.spawn; let children = 0;
  process.env[variable] = '1';
  cp.spawn = function (...args) { if (args[0] === 'git') children++; return spawn.apply(this, args); }; syncBuiltinESMExports();
  t.after(() => { cp.spawn = spawn; syncBuiltinESMExports(); if (prior === undefined) delete process.env[variable]; else process.env[variable] = prior; });
  await new ConfigStore(f.home).update(IDS.gone, config => { config.multiplexer = 'none'; });
  assert.equal((await f.board.parsed()).multiplexer, 'none'); assert.equal(children, 0);
});

test('Git context cannot use the zero-Git absence shortcut', async t => {
  const f = await fixture(); t.after(f.dispose); await rm(path.join(f.home, '.git'), { recursive: true, force: true });
  const variable = 'GIT_DIR', prior = process.env[variable], spawn = cp.spawn; let children = 0, mutated = false;
  process.env[variable] = path.join(f.home, 'unavailable-fixture-context');
  cp.spawn = function (...args) { if (args[0] === 'git') children++; return spawn.apply(this, args); }; syncBuiltinESMExports();
  t.after(() => { cp.spawn = spawn; syncBuiltinESMExports(); if (prior === undefined) delete process.env[variable]; else process.env[variable] = prior; });
  const before = await f.board.read();
  await assert.rejects(new ConfigStore(f.home).update(IDS.gone, () => { mutated = true; }), /ADOPTION_NOT_READY/);
  assert.equal(mutated, false); assert.equal(children, 1); assert.equal(await f.board.read(), before);
});

test('configured external Git directory with claim history is not nonrepo absence', async t => {
  const a = await fixture(), b = await fixture(); t.after(a.dispose); t.after(b.dispose);
  await a.claim.writeAndCommit(await a.declaration()); await rm(path.join(b.home, '.git'), { recursive: true, force: true });
  const prior = { GIT_DIR: process.env.GIT_DIR, GIT_WORK_TREE: process.env.GIT_WORK_TREE };
  process.env.GIT_DIR = path.join(a.home, '.git'); process.env.GIT_WORK_TREE = a.home;
  t.after(() => { for (const [key, value] of Object.entries(prior)) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
  assert.equal(await claimEvidenceEstablished(b.home), true);
  let mutated = false; const before = await b.board.read();
  await assert.rejects(new ConfigStore(b.home).update(IDS.gone, () => { mutated = true; }), /ADOPTION_NOT_READY/);
  assert.equal(mutated, false); assert.equal(await b.board.read(), before);
});

// Absence is rediscovered on every update, across each layout Git itself discovers: ancestor `.git`
// directory, `.git` worktree file, bare repository, damaged bare markers, and a configured external
// context. The plain newly-initialized repository has a surviving proof in 'legacy absence is
// rediscovered on the next reentrant update'; these five are separate discovery predicates.
for (const layout of ['ancestor', 'worktree', 'bare', 'damaged-bare', 'context']) test(`NEXT ordinary update discovers newly appeared ${layout}`, async t => {
  const f = await fixture(); t.after(f.dispose); await rm(path.join(f.home, '.git'), { recursive: true });
  const home = path.join(f.home, 'nested'), board = path.join(home, '.pi-intercom'); await mkdir(board, { recursive: true }); await writeFile(path.join(board, 'config.json'), await f.board.read());
  const store = new ConfigStore(home); await store.update(IDS.gone, config => { config.multiplexer = 'none'; }); const before = await readFile(store.file, 'utf8');
  const oldDir = process.env.GIT_DIR; t.after(() => { if (oldDir === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = oldDir; });
  if (layout === 'damaged-bare') await writeFile(path.join(home, 'HEAD'), 'ref: refs/heads/main\n');
  else {
    const repo = layout === 'ancestor' ? f.home : layout === 'context' ? path.join(f.home, 'external') : home; await mkdir(repo, { recursive: true });
    const flags = layout === 'bare' ? ['--work-tree=' + home] : [];
    await f.gitOk(['init', '-q', ...(layout === 'bare' ? ['--bare'] : layout === 'worktree' ? ['--separate-git-dir=' + path.join(f.home, 'metadata')] : [])], repo);
    await f.gitOk(['config', 'user.name', 'Fixture'], repo); await f.gitOk(['config', 'user.email', 'fixture@example.invalid'], repo);
    const file = path.join(layout === 'context' ? repo : home, 'coordinator-claim.md'), relative = path.relative(repo, file);
    await writeFile(file, 'fixture claimed history\n'); await f.gitOk([...flags, 'add', '--', relative], repo); await f.gitOk([...flags, 'commit', '-qm', 'fixture established'], repo);
    await f.gitOk([...flags, 'rm', '--', relative], repo); await f.gitOk([...flags, 'commit', '-qm', 'fixture deleted'], repo);
    if (layout === 'context') process.env.GIT_DIR = path.join(repo, '.git');
  }
  await assert.rejects(store.update(IDS.gone, () => assert.fail('new context/history must be checked before mutating')), /ADOPTION_NOT_READY/);
  assert.equal(await readFile(store.file, 'utf8'), before);
});

// No negative cache: an absence found once is re-discovered on the next call, and a repository that
// appears afterwards is fail-closed uncertainty, never 'already known absent'.
for (const layout of ['none', 'ancestor', 'worktree', 'bare', 'damaged-bare', 'context']) test(`uncached absence discovery: ${layout}`, async t => {
  const f = await fixture(); t.after(f.dispose);
  let home = f.home;
  if (layout === 'ancestor') { home = path.join(f.home, 'app/web'); }
  else {
    await rm(path.join(f.home, '.git'), { recursive: true, force: true });
    if (layout === 'worktree') await writeFile(path.join(home, '.git'), 'gitdir: /nonexistent-intercom-fixture\n');
    if (layout === 'bare') {
      await f.gitOk(['init', '--bare', '-q']);
      await f.gitOk(['config', 'user.name', 'Fixture']); await f.gitOk(['config', 'user.email', 'fixture@example.invalid']);
      await writeFile(path.join(home, 'empty-tree'), '');
      const tree = (await f.gitOk(['hash-object', '-w', '-t', 'tree', path.join(home, 'empty-tree')])).trim();
      const commit = (await f.gitOk(['commit-tree', tree, '-m', 'fixture bare history'])).trim();
      await f.gitOk(['update-ref', 'HEAD', commit]);
    }
    if (layout === 'damaged-bare') await mkdir(path.join(home, 'objects'));
  }
  const priorGitDir = process.env.GIT_DIR;
  if (layout === 'context') process.env.GIT_DIR = path.join(home, 'unavailable-git');
  const original = cp.spawn; let children = 0;
  cp.spawn = function (...args) { if (args[0] === 'git') children++; return original.apply(this, args); };
  syncBuiltinESMExports();
  t.after(() => { cp.spawn = original; syncBuiltinESMExports(); if (priorGitDir === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = priorGitDir; });
  if (['worktree', 'damaged-bare', 'context'].includes(layout)) await assert.rejects(claimEvidenceEstablished(home), /ADOPTION_NOT_READY/);
  else assert.equal(await claimEvidenceEstablished(home), false);
  assert.equal(children, layout === 'none' ? 0 : 1);
  if (layout === 'none') {
    await f.gitOk(['init', '-q']);
    await assert.rejects(claimEvidenceEstablished(home), /ADOPTION_NOT_READY/);
    assert.equal(children, 1, 'new unborn repository is rediscovered/fail-closed, never cached absent');
  }
});

// Name-casing is platform behaviour, not decoration: a POSIX comparison is case-sensitive, a simulated
// Windows one is not, and indexed GIT_CONFIG_KEY_*/VALUE_* injection is context on both.
for (const platform of ['linux', 'win32']) for (const variable of ['git_dir', 'GiT_DiR', 'git_config_key_0', 'GiT_CoNfIg_VaLuE_12', 'GiT_TrAcE']) test(`simulated ${platform} context-name casing: ${variable}`, async t => {
  const f = await fixture(); t.after(f.dispose); await rm(path.join(f.home, '.git'), { recursive: true });
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform'), priorValue = process.env[variable], spawn = cp.spawn; let calls = 0;
  try {
    process.env[variable] = 'fixture-marker'; Object.defineProperty(process, 'platform', { ...descriptor, value: platform });
    cp.spawn = function (...args) { if (args[0] === 'git') calls++; return spawn.apply(this, args); }; syncBuiltinESMExports();
    const relevant = /^(git_dir|git_config_(key|value)_\d+)$/i.test(variable);
    if (platform === 'win32' && relevant) await assert.rejects(claimEvidenceEstablished(f.home), /ADOPTION_NOT_READY/);
    else assert.equal(await claimEvidenceEstablished(f.home), false);
    assert.equal(calls, platform === 'win32' && relevant ? 1 : 0); assert.equal(process.env[variable], 'fixture-marker');
  } finally { Object.defineProperty(process, 'platform', descriptor); cp.spawn = spawn; syncBuiltinESMExports(); if (priorValue === undefined) delete process.env[variable]; else process.env[variable] = priorValue; }
});

// After-save re-checks the newest committed evidence, not merely the local epoch, which stays open here:
// the report is saved and the notification is refused, never reported as delivered or unsaved.
test('after-save notify freshly proves committed evidence while the local epoch stays open', async t => {
  const f = await fixture({ runtime: true }); t.after(f.dispose); let armed = false;
  const runtime = await f.startRuntime({ adoption: { projectsHome: f.home, rolesDirectory: path.join(f.home, 'roles'), listSessions: f.workflowOptions.listSessions,
    reportPhase: async phase => { if (armed && phase === 'after-save') { armed = false; await damageAnchor(f, 'malformed-newest-restored'); } } } });
  assert.equal((await runtime.adoptCoordinator(f.context, 'adopt')).ok, true);
  await saveWorkerReport(f.home, prior); armed = true;
  const response = await post(runtime, 'report');
  assert.equal(response.status, 400, response.body);
  assert.match(response.body, /Report stored; coordinator notification blocked\/not submitted/);
  const reports = await readWorkerReports(f.home, [IDS.workerOne]);
  assert.equal(reports[0].summary, payloads.report[1].summary, 'saved bytes are not rolled back');
  assert.equal(f.messages.length, 0, 'a blocked notification is never a submitted turn');
  assert.equal(runtime.coordinatorActionReady(), false, 'external evidence change closes the epoch');
});

for (const stage of ['snapshot', 'probe']) test(`worker_status ${stage} final return rejects a malformed newest claim with restored old bytes`, async t => {
  const f = await fixture({ runtime: true }); t.after(f.dispose); const gate = barrier(); let runtime, armed = false;
  if (stage === 'probe') {
    const server = createServer(async (_request, response) => { await gate.wait(); response.end(JSON.stringify({ version: 1, sessionId: IDS.workerOne })); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const config = await f.board.parsed(); config.agents[1].port = server.address().port; await f.board.write(JSON.stringify(config));
  } else {
    // Snapshot-only return is its own barrier: the page is built and proven before any probe exists.
    const original = fs.open;
    fs.open = async (...args) => { const handle = await original(...args); if (armed && String(args[0]) === runtime.store.file) { armed = false; await gate.wait(); } return handle; };
    syncBuiltinESMExports(); t.after(() => { fs.open = original; syncBuiltinESMExports(); });
  }
  runtime = await f.startRuntime(); assert.equal((await runtime.adoptCoordinator(f.context, 'adopt')).ok, true);
  armed = true;
  const pending = runtime.tool('worker_status', { probe: stage === 'probe' });
  const refused = assert.rejects(pending, /ADOPTION_NOT_READY/); await gate.reached;
  await damageAnchor(f, 'malformed-newest-restored');
  gate.release(); await refused;
});

test('create_worker carries the admitted epoch through the runtime await', { timeout: 15000 }, async t => {
  const f = await fixture({ runtime: true }); t.after(f.dispose); const gate = barrier(); t.after(gate.release); let launches = 0, armed = false;
  const runtime = await f.startRuntime({ launch: async () => { launches++; return { commandSubmitted: true }; }, probe: async () => { await gate.wait(); return { state: 'disconnected' }; } });
  runtime.options.probe = f.probeWorker;
  assert.equal((await runtime.adoptCoordinator(f.context, 'adopt')).ok, true);
  runtime.options.probe = async () => { await gate.wait(); return { state: 'disconnected' }; };
  const original = fs.realpath;
  fs.realpath = async (...args) => { const result = await original(...args); if (armed && String(args[0]) === path.join(f.home, 'app')) { armed = false; await gate.wait(); } return result; };
  syncBuiltinESMExports(); t.after(() => { fs.realpath = original; syncBuiltinESMExports(); });
  armed = true;
  const pending = runtime.tool('create_worker', { projectDirectory: 'app' });
  const refused = assert.rejects(pending, /ADOPTION_NOT_READY/); await gate.reached;
  await damageAnchor(f, 'malformed-newest-restored');
  gate.release(); await refused; assert.equal(launches, 0);
});

// resume_worker has its own await chain after adoption: the resume preflight probe, then the project
// directory TOCTOU check, then a fresh state read. No dispatch is authorized on a stale proof.
for (const site of ['probe', 'directory']) for (const interruption of ['malformed-newest-restored', 'closed']) test(`resume_worker carries the admitted epoch across the ${site} await: ${interruption}`, { timeout: 15000 }, async t => {
  const f = await fixture({ runtime: true }); t.after(f.dispose); const gate = barrier(); t.after(gate.release); let launches = 0, armed = false;
  const runtime = await f.startRuntime({ launch: async () => { launches++; return { commandSubmitted: true }; }, probe: async () => { await gate.wait(); return { state: 'disconnected' }; } });
  runtime.options.probe = f.probeWorker; // adoption keeps real probes; only the later resume awaits are held
  assert.equal((await runtime.adoptCoordinator(f.context, 'adopt')).ok, true);
  if (site === 'probe') runtime.options.probe = async () => { await gate.wait(); return { state: 'disconnected' }; };
  else {
    runtime.options.probe = async () => ({ state: 'disconnected' });
    const original = fs.realpath;
    fs.realpath = async (...args) => { const result = await original(...args); if (armed && String(args[0]) === path.join(f.home, 'app')) { armed = false; await gate.wait(); } return result; };
    syncBuiltinESMExports(); t.after(() => { fs.realpath = original; syncBuiltinESMExports(); });
    armed = true;
  }
  const pending = runtime.tool('resume_worker', { to: 'Builder', confirmClosed: true });
  const refused = assert.rejects(pending, /ADOPTION_NOT_READY/); await gate.reached;
  if (interruption === 'closed') runtime.closeActionEpoch('fixture resume await'); else await damageAnchor(f, interruption);
  gate.release(); await refused; assert.equal(launches, 0);
});

test('launch observation cannot authorize dispatch after the claim is damaged', async t => {
  const f = await fixture({ runtime: true }); t.after(f.dispose); let runtime, armed = false, launches = 0;
  runtime = await f.startRuntime({ launch: async () => { launches++; }, observe: () => ({ close() {}, record(event, metadata) {
    if (armed && event === 'launch.result' && metadata.outcome === 'attempted') writeFileSync(f.claimPath(), 'malformed observation-time evidence\n');
  } }) });
  assert.equal((await runtime.adoptCoordinator(f.context, 'adopt')).ok, true); armed = true;
  await assert.rejects(runtime.tool('create_worker', {}), /ADOPTION_NOT_READY/); assert.equal(launches, 0);
});

test('admitted composite launch completes across role-preflight invalidation; next dispatch is refused', async t => {
  const f = await fixture({ runtime: true }); t.after(f.dispose); const gate = barrier(), calls = [];
  const adapter = launchers({ platform: 'linux', extension: '/fixture/index.ts', env: { HERDR_ENV: '1', HERDR_WORKSPACE_ID: 'fixture' }, sessionExists: async () => true,
    run: async (file, args) => {
      calls.push({ file, args });
      if (args[0] === '--print') await gate.wait();
      if (file === 'sh') return '/fixture/pi-role\n';
      if (args[0] === 'tab') return JSON.stringify({ result: { tab: { tab_id: 'fixture-tab' }, root_pane: { pane_id: 'fixture-pane' } } });
      return '';
    } });
  let dispatches = 0;
  const runtime = await f.startRuntime({ launch: request => { dispatches++; return adapter.launch(request); } });
  assert.equal((await runtime.adoptCoordinator(f.context, 'adopt')).ok, true);
  const pending = runtime.tool('create_worker', { role: 'developer' }); await gate.reached;
  runtime.closeActionEpoch('fixture AFTER admitted dispatch'); gate.release();
  const result = await pending;
  assert.equal(result.commandSubmitted, true); assert.equal(result.tab, 'fixture-tab'); assert.equal(result.pane, 'fixture-pane');
  assert.equal(result.registrationAwaited, false); assert.equal(dispatches, 1);
  assert.deepEqual(calls.map(call => call.args[0]), ['-c', '--print', 'tab', 'pane']);
  await assert.rejects(runtime.tool('create_worker', {}), /ADOPTION_NOT_READY/); assert.equal(dispatches, 1); assert.equal(calls.length, 4, 'no cleanup/retry/replacement');
});
