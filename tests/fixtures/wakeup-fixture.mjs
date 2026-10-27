// Disposable Orchestrator wake-up fixtures (Swactory #68 stage 3). Never a product writer: a temporary
// projects-home Git repository, a hand-written board, committed first-declaration evidence, fake
// loopback endpoints and a fake clock. No live board, install, provider call or model turn is involved.
import assert from 'node:assert/strict';
import path from 'node:path';
import { createFixture, IDS } from './adoption-fixture.mjs';
import { scanConfig } from '../../dist/config.js';
import { leftUnchanged, renderClaim } from '../../dist/adoption.js';
import { Intercom } from '../../dist/runtime.js';

/** Fake clock: every scheduled delay is recorded, and advance runs due callbacks strictly by due time. */
export function recordingClock() {
  let now = 0, next = 0;
  const pending = new Map(), callbacks = [], delays = [];
  return {
    pending, callbacks, delays, get now() { return now; },
    schedule(callback, delay) {
      delays.push(delay);
      const id = ++next; pending.set(id, { callback, due: now + delay }); callbacks.push(callback);
      return () => pending.delete(id);
    },
    advance(milliseconds) {
      now += milliseconds;
      for (const [id, entry] of [...pending]) if (entry.due <= now) { pending.delete(id); entry.callback(); }
    },
  };
}

const settle = () => new Promise(resolve => setImmediate(resolve));
/** Waits out a wake-up admission window in flight (deliver happens synchronously once it resolves). */
export async function settled(reminders) {
  const deadline = Date.now() + 2000;
  while (reminders?.checking) {
    assert.ok(Date.now() < deadline, 'wake-up eligibility check did not finish');
    await settle();
  }
  await settle();
}

/** Write a single-coordinator board on the fixture home and commit matching first-declaration evidence. */
export async function commitFirstDeclaration(f, { sessionId, port, claim = true }) {
  await f.board.write(`{
  "version": 1,
  "multiplexer": "herdr",
  "agents": [
    {
      "sessionId": "${sessionId}",
      "name": "Coordinator",
      "coordinator": true,
      "description": "Coordinate workers.",
      "port": ${port},
      "projectDirectory": "."
    }
  ]
}
`);
  if (!claim) return;
  const scanned = await scanConfig(await f.board.read());
  const hash = f.sha256(scanned.raw);
  const record = {
    schemaVersion: 1, transitionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', phase: 'active', boardRoot: f.home,
    coordinator: { sessionId, port }, date: '2026-10-16',
    authority: { kind: 'first-coordinator declaration', record: 'fixture declaration record', confirmedEndedAt: null, wording: 'fixture declaration wording' },
    previous: null, previousRecordCommit: null,
    configBeforeSha256: hash, configAfterSha256: hash, intentCommit: null,
    leftUnchanged: leftUnchanged(scanned), rebriefSource: 'handoff.md (open assignments)',
  };
  await f.claim.writeAndCommit(record);
}

/**
 * One Orchestrator fixture runtime on a committed projects-home board.
 * options: { sessionId, roleDirectory, clock, claim:'ready'|'absent', reminderMinutesEnv,
 *            reminderFileEnv, reminderFiles, tickWithoutCorrelation }
 */
export async function wakeupRuntime(t, options = {}) {
  const f = await createFixture();
  const id = options.sessionId ?? IDS.gone; // the board coordinator entry must name this session
  const clock = options.clock ?? recordingClock();
  // Endpoints always rebind the coordinator's declared board port, so a restart keeps the committed
  // claim identity valid and the bound port observable.
  const endpoints = new Map();
  let openListeners = 0;
  const listen = async (_preferred, accept) => {
    openListeners++;
    endpoints.set(41001, accept);
    return { port: 41001, close: async () => { openListeners--; if (openListeners <= 0) endpoints.delete(41001); } };
  };
  await commitFirstDeclaration(f, { sessionId: id, port: 41001, claim: (options.claim ?? 'ready') === 'ready' });
  const state = { busy: false };
  const deliveries = [], notices = [];
  const runtime = new Intercom({
    cwd: f.home, sessionId: () => id,
    roleDirectory: path.join(f.home, 'roles', options.roleDirectory ?? 'orchestrator'),
    rolesDirectory: path.join(f.home, 'roles'), workerRole: '',
    busy: () => state.busy,
    deliver: (text, busy, submission) => deliveries.push({ id, text, busy, submission: submission ? { ...submission } : undefined }),
    setName: async () => {}, notify: text => notices.push(text),
  }, {
    launch: options.launch ?? (async () => ({ submitted: true })),
    listen,
    send: async (p, message) => { const ep = endpoints.get(p); if (!ep) throw new Error('offline'); await ep(message); },
    probe: async () => [],
    observe: () => ({ record() {}, close() {}, maintain() {} }),
    adoption: { projectsHome: f.home, rolesDirectory: path.join(f.home, 'roles') },
    reminderClock: clock,
    ...(options.reminderMinutesEnv ? { reminderMinutesEnv: options.reminderMinutesEnv } : {}),
    ...(options.reminderFileEnv ? { reminderFileEnv: options.reminderFileEnv } : {}),
    ...(options.reminderFiles ? { reminderFiles: options.reminderFiles } : {}),
    ...(options.overrides ?? {}),
  });
  t.after(async () => { await runtime.close().catch(() => {}); await f.dispose(); });
  const reminders = () => deliveries.filter(d => d.submission !== undefined);
  const api = {
    f, id, runtime, clock, deliveries, notices, reminders, endpoints,
    setBusy: value => { state.busy = value; },
    /**
     * One observed interval; when a wake-up arrived inside it, correlate the owned attempt like the
     * extension does (entry + containing-run settle) so the next tick is the fresh interval.
     */
    tick: async (milliseconds = 300000) => {
      clock.advance(milliseconds);
      await settled(runtime.reminders);
      if (!options.tickWithoutCorrelation && reminders().length > api._correlated) {
        api._correlated = reminders().length;
        runtime.reminders?.attemptResolved();
        runtime.reminders?.activitySettled();
        await settle();
      }
    },
    _correlated: 0,
  };
  return api;
}
