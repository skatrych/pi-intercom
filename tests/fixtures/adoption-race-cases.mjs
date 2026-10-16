// Barrier-controlled separate Node processes. Killing/lock repair below affects ONLY children and
// temporary fixture directories owned here. Product never reclaims a stale lock or infers owner death.
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './adoption-support.mjs';
import { IDS } from './adoption-fixture.mjs';
import { parseClaim } from '../../dist/adoption.js';

function participant(f, args) {
  const child = fork(new URL('./adoption-process.mjs', import.meta.url), [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...process.env, PI_ROLE_DIR: '', PI_INTERCOM_WORKER_ROLE: '' } });
  const messages = [], listeners = [];
  let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  child.on('message', message => { messages.push(message); for (const wake of listeners.splice(0)) wake(); });
  const wait = async type => {
    const deadline = Date.now() + 10000;
    for (;;) {
      const found = messages.find(message => type === 'done' ? ['result', 'failure'].includes(message.type) : message.type === type);
      if (found) return found;
      if (Date.now() > deadline) throw Error(`process fixture timeout waiting ${type}: ${JSON.stringify(messages)} ${stderr}`);
      await Promise.race([new Promise(resolve => listeners.push(resolve)), new Promise(resolve => setTimeout(resolve, 10))]);
    }
  };
  child.send({ type: 'start', root: f.home, ...args });
  return { child, exited, wait, release: () => child.send({ type: 'release' }), dispose: async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await exited; } };
}
async function withProcesses(options, run) {
  const f = await fixture({ runtime: true, ...options }); const processes = [];
  const start = args => { const p = participant(f, args); processes.push(p); return p; };
  try { await run(f, start); }
  finally { for (const p of processes) await p.dispose(); await f.dispose(); }
}
async function statusWins(kind = 'status') {
  await withProcesses({}, async (f, start) => {
    const writer = kind === 'status' ? start({ action: kind }) : undefined;
    if (writer) await writer.wait('barrier'); // Actual runtime boot finishes BEFORE the frozen preview.
    const adopter = start({ action: 'adopt', hold: 'preview' }); await adopter.wait('barrier');
    const publication = writer ?? start({ action: kind });
    writer?.release(); const written = await publication.wait('done'); assert.equal(written.type, 'result', JSON.stringify(written));
    const changed = await f.board.read(); adopter.release(); const done = await adopter.wait('done');
    assert.equal(done.result.code, 'STALE_PREVIEW', JSON.stringify(done));
    assert.equal(await f.board.read(), changed); assert.equal((await f.claim.log()).length, 0);
  });
}
async function adoptionWins(kind = 'status') {
  await withProcesses({}, async (f, start) => {
    const writer = kind === 'status' ? start({ action: kind }) : undefined;
    if (writer) await writer.wait('barrier');
    const adopter = start({ action: 'adopt', hold: 'prepared-committed' }); await adopter.wait('barrier');
    const publication = writer ?? start({ action: kind }); writer?.release();
    const busy = await publication.wait('done');
    assert.equal(busy.name, 'StaleConfigLock', JSON.stringify(busy));
    adopter.release(); const done = await adopter.wait('done'); assert.equal(done.result.code, 'OK', JSON.stringify(done));
    assert.equal(done.swaps, 1); assert.equal((await f.board.parsed()).agents[0].sessionId, IDS.fresh);
    const old = start({ action: 'update' }); const stale = await old.wait('done');
    assert.equal(stale.type, 'failure'); assert.match(stale.message, /coordinator permission required/);
    assert.equal((await f.board.parsed()).multiplexer, 'herdr');
  });
}
async function queuedOldUpdate() {
  await withProcesses({}, async (f, start) => {
    const old = start({ action: 'update', hold: 'queued' }); await old.wait('barrier');
    const adopter = start({ action: 'adopt' }); const adopted = await adopter.wait('done');
    assert.equal(adopted.result.code, 'OK', JSON.stringify(adopted));
    const active = await f.board.read();
    old.release(); const stale = await old.wait('done');
    assert.equal(stale.type, 'failure'); assert.match(stale.message, /coordinator permission required/);
    assert.equal(await f.board.read(), active, 'prequeued old authority cannot publish after acquiring the lock');
  });
}
async function twoAdopters() {
  await withProcesses({}, async (f, start) => {
    await f.session.persist(IDS.other);
    const first = start({ action: 'adopt', hold: 'preview' }), second = start({ action: 'adopt', id: IDS.other, hold: 'preview' });
    await Promise.all([first.wait('barrier'), second.wait('barrier')]);
    first.release(); const won = await first.wait('done'); assert.equal(won.result.code, 'OK');
    second.release(); const lost = await second.wait('done'); assert.equal(lost.result.code, 'STALE_PREVIEW', JSON.stringify(lost));
    assert.equal(won.swaps + lost.swaps, 1); assert.equal((await f.board.parsed()).agents[0].sessionId, IDS.fresh);
  });
}
async function initializeRace() {
  await withProcesses({ noBoard: true }, async (f, start) => {
    // Both processes are held before lock acquisition, then race no-replace initialization.
    const first = start({ action: 'initialize', hold: 'before-lock', port: 12345 }), second = start({ action: 'initialize', hold: 'before-lock', port: 12346 });
    await Promise.all([first.wait('barrier'), second.wait('barrier')]); first.release(); second.release();
    const done = await Promise.all([first.wait('done'), second.wait('done')]);
    assert.equal(done.filter(message => message.type === 'result' && message.result === true).length, 1);
    assert.ok(done.every(message => message.type === 'result' || message.name === 'StaleConfigLock'), JSON.stringify(done));
    assert.equal((await f.board.scan()).config.agents.length, 1);
  });
}
async function claimChanged() {
  await withProcesses({}, async (f, start) => {
    const adopter = start({ action: 'adopt', hold: 'preview' }); await adopter.wait('barrier');
    const board = (await f.board.parsed()).agents[0];
    const record = await f.declaration({ sessionId: board.sessionId, port: board.port });
    await f.claim.writeAndCommit(record); const head = await f.claim.head();
    adopter.release(); const stopped = await adopter.wait('done');
    assert.equal(stopped.result.code, 'STALE_PREVIEW', JSON.stringify(stopped));
    assert.equal(await f.claim.head(), head); assert.equal(stopped.swaps, 0);
  });
}
async function crashProof(boundary) {
  await withProcesses({}, async (f, start) => {
    const phases = { 'before-intent': 'before-intent', 'after-intent': 'prepared-committed', 'after-config': 'published', 'after-claim': 'active-written', 'after-promotion': 'promoted' };
    const p = start({ action: 'adopt', hold: phases[boundary] });
    const endpoint = await p.wait('endpoint'); await p.wait('barrier');
    const before = await f.board.read(), inode = (await stat(f.configPath())).ino;
    const committed = (await f.claim.log())[0];
    if (boundary === 'before-intent') assert.equal(committed, undefined);
    else assert.equal(parseClaim(await f.claim.at(committed)).phase, boundary === 'after-promotion' ? 'active' : 'prepared');
    p.child.kill('SIGKILL'); assert.equal((await p.exited).signal, 'SIGKILL');
    const contender = start({ action: 'update' }); const held = await contender.wait('done');
    if (boundary === 'after-promotion') assert.match(held.message, /coordinator permission required/);
    else assert.equal(held.name, 'StaleConfigLock', 'crashed process lock is NOT automatically stolen');
    assert.equal(await f.board.read(), before);
    // Explicit fixture maintenance after independently observed owned-child exit (not product logic).
    if (boundary !== 'after-promotion') await rm(path.join(f.home, '.pi-intercom/config.lock'), { recursive: true });
    const recovery = start({ action: 'adopt', preferredPort: endpoint.port });
    const result = await recovery.wait('done'); assert.equal(result.type, 'result', JSON.stringify(result));
    assert.equal(result.result.code, boundary === 'after-promotion' ? 'CLAIM_OK' : ['after-config', 'after-claim'].includes(boundary) ? 'RECOVERED' : 'OK', JSON.stringify(result));
    if (['after-config', 'after-claim', 'after-promotion'].includes(boundary)) {
      assert.equal(result.swaps, 0); assert.equal((await stat(f.configPath())).ino, inode); assert.equal(await f.board.read(), before);
    } else assert.equal(result.swaps, 1);
    if (boundary === 'after-promotion') assert.equal((await f.claim.log())[0], committed);
    if (boundary === 'after-intent') {
      const active = parseClaim(await f.claim.read()), original = parseClaim(await f.claim.at(committed));
      assert.equal(active.transitionId, original.transitionId);
      assert.notEqual(active.intentCommit, committed, 'fresh confirmation commits refreshed intent before publication');
    }
  });
}
export async function raceCase(name, spec) {
  try {
    if (spec.crash) await crashProof(spec.crash);
    else if (['race-outer-queue', 'race-process-queue', 'status-wins'].includes(name)) await statusWins();
    else if (['race-filesystem', 'adoption-wins'].includes(name)) await adoptionWins();
    else if (name === 'queued-old-update') await queuedOldUpdate();
    else if (['race-reminder-handoff-restart', 'handoff-write-race'].includes(name)) await statusWins('handoff');
    else if (name === 'initialize-race') await initializeRace();
    else if (name === 'race-claim-cleanup') await claimChanged();
    else if (['race-two-adopters', 'two-adopters'].includes(name)) await twoAdopters();
    else if (name === 'race-kill-intents') await crashProof('after-intent');
    else throw Error(`unimplemented process proof ${name}`);
    console.log(`ASSERT ${name} PASS: independent processes, deterministic barriers, valid complete JSON, no lost/stale publication or automatic stale-lock recovery`);
    console.log('TERMINAL: ASSERTIONS exit 0');
  } catch (error) { console.error(`FIXTURE ERROR: ${error.stack}`); process.exitCode = 3; }
}
