// Disposable Orchestrator wake-up fixtures (Swactory #68 stage 3). Never a product writer: a temporary
// projects-home Git repository, a hand-written board, committed first-declaration evidence, fake
// loopback endpoints and a fake clock. No live board, install, provider call or model turn is involved.
import assert from 'node:assert/strict';
import path from 'node:path';
import { createFixture, IDS } from './adoption-fixture.mjs';
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

/**
 * Write a single-coordinator board on the fixture home. Under the ADR 0025 design the board config
 * entry is the whole coordinator authority: the entry's sessionId plus the actually bound port are
 * everything the boot and every effect re-verify, and a batch of legacy or fresh claim artifacts has
 * zero influence. The `claim` option is accepted and ignored so callers keep a uniform shape.
 */
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
  // boardPort names a port other than the bound 41001 exactly when a test wants a held authority:
  // ADR 0025 makes a stale pair (not a missing claim artifact) the unauthorized shape.
  await commitFirstDeclaration(f, { sessionId: id, port: options.boardPort ?? 41001, claim: (options.claim ?? 'ready') === 'ready' });
  const state = { busy: false };
  const deliveries = [], notices = [];
  const reads = { minutes: 0 };
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
    ...(options.reminderMinutesEnv ? { reminderMinutesEnv: () => { reads.minutes++; return options.reminderMinutesEnv(); } } : {}),
    ...(options.reminderFileEnv ? { reminderFileEnv: options.reminderFileEnv } : {}),
    ...(options.reminderFiles ? { reminderFiles: options.reminderFiles } : {}),
    ...(options.overrides ?? {}),
  });
  t.after(async () => { await runtime.close().catch(() => {}); await f.dispose(); });
  const reminders = () => deliveries.filter(d => d.submission !== undefined);
  const api = {
    f, id, runtime, clock, deliveries, notices, reminders, endpoints, reads,
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
