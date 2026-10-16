// Private IPC participant for fixed disposable process-race/crash tests; never shipped/CLI product.
import path from 'node:path';
import { readFile, rename } from 'node:fs/promises';
import { AdoptionWorkflow, ENDED_WORDING } from '../../dist/adoption.js';
import { ConfigStore } from '../../dist/config.js';
import { listen } from '../../dist/transport.js';
import { HandoffWorkflow } from '../../dist/handoff.js';
import { Intercom } from '../../dist/runtime.js';
import { IDS } from './adoption-fixture.mjs';

let release;
process.on('message', async message => {
  if (message.type === 'release') { release?.(); return; }
  if (message.type !== 'start') return;
  const { root, action, hold, preferredPort } = message;
  const id = message.id ?? IDS.fresh;
  let endpoint;
  const wait = async stage => {
    process.send({ type: 'barrier', stage });
    await new Promise(resolve => { release = resolve; }); release = undefined;
  };
  try {
    let swaps = 0, promoted = false, epoch = 0;
    const store = new ConfigStore(root, { lockOwner: () => ({ sessionId: action === 'adopt' ? id : IDS.gone }),
      rename: async (from, to) => { swaps++; await rename(from, to); } });
    if (action === 'adopt') {
      endpoint = await listen(preferredPort ?? 0, async () => { throw Error('no worker traffic in process fixture'); }, () => ({ version: 1, sessionId: id }));
      process.send({ type: 'endpoint', port: endpoint.port });
      const { probeWorker } = await import('../../dist/connections.js');
      const sessionFile = path.join(root, `.pi/default-sessions/2026-10-16T09-00-00-000Z_${id}.jsonl`);
      let previewHeld = false;
      const ui = { input: async ({ kind }) => kind === 'endedWording' ? ENDED_WORDING(IDS.gone) : 'issue31 fixture authorization',
        confirm: async () => { if (hold === 'preview' && !previewHeld) { previewHeld = true; await wait('preview'); } return true; } };
      const context = { cwd: root, mode: 'tui', hasUI: true, isProjectTrusted: () => true, isIdle: () => true, ui,
        sessionManager: { getSessionId: () => id, getSessionFile: () => sessionFile, getSessionDir: () => path.dirname(sessionFile) } };
      const workflow = new AdoptionWorkflow({ projectsHome: root, rolesDirectory: path.join(root, 'roles'), roleDirectory: path.join(root, 'roles/orchestrator'),
        storeFor: () => store, sessionId: () => id, endpointPort: () => endpoint.port, busy: () => false,
        probe: probeWorker, listSessions: async () => [{ id, path: sessionFile }], promote: async () => { promoted = true; }, responsibilityLoaded: () => promoted,
        readiness: { close: () => ++epoch, current: () => epoch, open() {} }, phase: async phase => { if (phase === hold) await wait(phase); } });
      const result = await workflow.run(context, 'adopt');
      process.send({ type: 'result', result, swaps, promoted });
    } else if (action === 'initialize') {
      if (hold === 'before-lock') await wait('before-lock');
      const result = await store.initialize(IDS.gone, message.port);
      process.send({ type: 'result', result });
    } else if (action === 'handoff') {
      const workflow = new HandoffWorkflow({ state: async () => ({ id: IDS.gone, config: await store.read(), me: (await store.read()).agents[0] }), assertCurrent() {},
        update: async mutate => { await store.update(IDS.gone, async config => { if (hold === 'locked') await wait('locked'); await mutate(config); }); },
        send: async () => { throw Error('no send'); }, deliver() {}, busy: () => false });
      await workflow.recover(); workflow.dispose(); process.send({ type: 'result', result: true });
    } else if (action === 'status') {
      const config = await store.read();
      const runtime = new Intercom({ cwd: root, sessionId: () => IDS.gone, roleDirectory: path.join(root, 'roles/developer'), workerRole: '', busy: () => false, deliver() {}, notify() {}, setName: async () => {} },
        { launch: async () => { throw Error('no fixture launch'); }, store: () => store,
          // No old live endpoint: exercise the actual receive-status publication after boot settles.
          listen: async () => ({ port: config.agents[0].port, close: async () => {} }), observe: () => ({ record() {}, close() {}, maintain() {} }) });
      await runtime.start(); await wait('ready');
      try {
        await runtime.receive({ version: 1, kind: 'status', from: IDS.workerOne, to: IDS.gone, payload: { port: message.port ?? config.agents.at(-1).port, busy: false } });
        process.send({ type: 'result', result: await store.read() });
      } finally { await runtime.close(); }
    } else if (action === 'update') {
      if (hold === 'queued') {
        const before = await store.read();
        if (before.agents[0].sessionId !== IDS.gone) throw Error('fixture must queue while old id still governs');
        await wait('queued');
      }
      const config = await store.update(IDS.gone, async config => {
        if (hold === 'locked') await wait('locked');
        config.multiplexer = 'none';
      });
      process.send({ type: 'result', result: config });
    } else throw Error(`unknown fixture process action ${action}`);
  } catch (error) { process.send({ type: 'failure', name: error.constructor.name, message: String(error) }); }
  finally { await endpoint?.close(); process.disconnect(); }
});
