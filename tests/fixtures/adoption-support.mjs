// Disposable fixture helpers only, never a product/CLI writer.
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { createFixture, configText, commandContext, mockUi, IDS, ROLES } from './adoption-fixture.mjs';
import { listen } from '../../dist/transport.js';
import { probeWorker } from '../../dist/connections.js';
import { Intercom } from '../../dist/runtime.js';
import { AdoptionWorkflow } from '../../dist/adoption.js';

/** The affirmative default for the only adoption decision: one native yes/no. */
export const yesUI = (onAsk) => mockUi({ adoptCoordinator: 'confirm', ...(onAsk ? { onAsk } : {}) });
export const declineUI = () => mockUi({ adoptCoordinator: 'decline' });

/** A free loopback port, reserved then released: never a guessed or hard-coded endpoint. */
export async function freePort() {
  const endpoint = await listen(0, async () => {});
  const port = endpoint.port;
  await endpoint.close();
  return port;
}

/**
 * A real Intercom runtime on a disposable projects-home fixture, with the canonical Orchestrator launch
 * role and the real bounded loopback probe. Tests call the same public entry point production uses:
 * `runtime.adoptCoordinator(context, 'adopt' | 'status')`.
 */
export async function fixture(options = {}) {
  const f = await createFixture();
  const roles = path.join(f.home, ROLES.directory);
  const oldPort = options.oldPort ?? await freePort();
  const ports = { coordinator: oldPort, workerOne: await freePort(), workerTwo: await freePort() };
  if (!options.noBoard) await f.board.write(configText(options.style ?? 'full', ports));
  const id = options.id ?? (options.self ? IDS.gone : IDS.fresh);
  const cwd = options.cwd ?? (options.cwdRelative ? path.join(f.home, options.cwdRelative) : f.home);
  const ui = options.ui ?? yesUI(options.onAsk);
  const context = commandContext(f, { sessionId: id, ui: ui.ui, cwd, ...options.context });
  const messages = [], notices = [], sends = [];
  const state = { loaded: false, promotions: 0 };
  const launch = options.launch ?? 'orchestrator';
  const roleDirectory = options.roleDirectory ?? (launch === 'metadata-only' ? '' : path.join(roles, launch === 'developer' ? ROLES.developer : ROLES.orchestrator));
  const workerRole = options.workerRole ?? (launch === 'contradictory' ? ROLES.developer : '');
  let runtime;
  const host = {
    cwd,
    sessionId: () => (options.currentId?.() ?? id),
    busy: () => Boolean(options.busy?.()),
    roleDirectory,
    rolesDirectory: roles,
    workerRole,
    deliver: text => messages.push(text),
    notify: text => notices.push(text),
    setName: async name => { notices.push(`renamed:${name}`); },
  };
  const runtimeOptions = {
    launch: async () => { throw new Error('adoption must not launch a worker'); },
    probe: probeWorker,
    send: async (port, message) => { sends.push({ port, message }); throw new Error('fixture has no destination endpoint'); },
    observe: () => ({ record() {}, close() {}, maintain() { throw new Error('adoption must not run maintenance'); } }),
    adoption: { projectsHome: f.home, rolesDirectory: roles },
    ...options.runtime,
  };
  runtime = new Intercom(host, runtimeOptions);
  await runtime.start();
  const disposed = f.dispose;
  f.dispose = async () => { await runtime.close().catch(() => {}); await disposed(); };
  const adopt = (verb = 'adopt') => runtime.adoptCoordinator(context, verb);
  const currentPair = async () => {
    const config = await f.ConfigStoreFor(f.home).read();
    const board = config.agents.find(agent => agent.coordinator);
    return { sessionId: board.sessionId, port: board.port };
  };
  const boardConfig = async () => (await f.ConfigStoreFor(f.home).read());
  return Object.assign(f, { id, context, ui, runtime, messages, notices, sends, ports, oldPort, state, adopt, currentPair, boardConfig });
}

/**
 * The same workflow without a runtime, for cases that must control the captured identity/port, the
 * promotion outcome or a lock/provider seam directly. Reads and writes still go through the real store.
 */
export function standalone(f, options = {}) {
  const roles = path.join(f.home, ROLES.directory);
  const id = options.id ?? IDS.fresh;
  const port = options.port ?? 42123;
  const ui = options.ui ?? yesUI();
  const context = commandContext(f, { sessionId: id, ui: ui.ui });
  const state = { loaded: Boolean(options.loaded) };
  const workflow = new AdoptionWorkflow({
    roleDirectory: options.roleDirectory ?? path.join(roles, ROLES.orchestrator),
    rolesDirectory: roles, projectsHome: f.home,
    storeFor: root => f.ConfigStoreFor(root, options.storeOptions),
    sessionId: () => id, busy: () => false,
    endpointPort: () => options.portValue?.() ?? port,
    probe: options.probe ?? (async agent => ({ sessionId: agent.sessionId,
      state: agent.sessionId === id && agent.port === (options.portValue?.() ?? port) ? 'connected' : 'disconnected',
      checkedAt: null, reason: agent.sessionId === id && agent.port === (options.portValue?.() ?? port) ? 'verified' : 'refused' })),
    promote: options.promote ?? (async () => { state.loaded = true; }),
    responsibilityLoaded: () => state.loaded,
    ...(options.phase ? { phase: options.phase } : {}),
  });
  return { workflow, context, ui, state, id, port };
}

/** Remove the board after a successful startup: the command-time "no config" case. */
export async function removeBoard(f) {
  await rm(path.join(f.home, '.pi-intercom'), { recursive: true, force: true });
}
