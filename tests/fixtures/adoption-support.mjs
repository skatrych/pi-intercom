// Disposable fixture helpers only, never a product/CLI writer.
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import { createFixture, configText, commandContext, mockUi, IDS } from './adoption-fixture.mjs';
import { AdoptionWorkflow, ENDED_WORDING, leftUnchanged } from '../../dist/adoption.js';
import { listen } from '../../dist/transport.js';
import { Intercom } from '../../dist/runtime.js';

export const barrier = () => {
  let release, arrived;
  const reached = new Promise(resolve => { arrived = resolve; });
  const resume = new Promise(resolve => { release = resolve; });
  return { reached, release, wait: async () => { arrived(); await resume; } };
};
export const yesUI = () => mockUi({ boardInitialize: 'confirm', adoptionDecision: 'confirm', adoptTransition: 'confirm', authorityRecord: 'issue31 fixture authorization', endedWording: ENDED_WORDING(IDS.gone), finalizeTransition: 'confirm' });
export async function fixture(options = {}) {
  const f = await createFixture();
  await mkdir(path.join(f.home, 'roles/orchestrator'), { recursive: true });
  await mkdir(path.join(f.home, 'roles/developer'), { recursive: true });
  const ports = [];
  for (const id of ['old', IDS.workerOne, IDS.workerTwo]) {
    const endpoint = await listen(0, async () => { throw new Error('fixture only'); }, () => ({ version: 1, sessionId: id }));
    ports.push(endpoint.port); await endpoint.close();
  }
  if (!options.noBoard) await f.board.write(configText('full', { coordinator: ports[0], workerOne: ports[1], workerTwo: ports[2] }));
  const id = options.self ? IDS.gone : IDS.fresh;
  const sessionFile = await f.session.persist(id);
  const ui = yesUI();
  const context = commandContext(f, { sessionId: id, sessionFile, ui: ui.ui });
  const state = { epoch: 0, ready: false, loaded: false, swaps: 0, promotions: 0 };
  const runtimeList = [];
  const baseDispose = f.dispose;
  f.dispose = async () => { for (const runtime of runtimeList) await runtime.close(); await baseDispose(); await rm(f.home, { recursive: true, force: true }); };
  const endpoint = options.runtime ? undefined : f.track(await listen(0, async () => { throw new Error('no worker traffic'); }, () => ({ version: 1, sessionId: id })));
  if (options.self && !options.noBoard && endpoint) await f.board.write((await f.board.read()).replace(String(ports[0]), String(endpoint.port)));
  const workflowOptions = {
    roleDirectory: path.join(f.home, 'roles/orchestrator'), rolesDirectory: path.join(f.home, 'roles'), projectsHome: f.home,
    storeFor: root => f.ConfigStoreFor(root), sessionId: () => id, busy: () => false,
    endpointPort: () => endpoint?.port,
    probe: (agent, opts) => f.probeWorker(agent, opts),
    promote: async () => { state.promotions++; state.loaded = true; }, responsibilityLoaded: () => state.loaded,
    readiness: { close: () => { state.ready = false; return ++state.epoch; }, current: () => state.epoch, ready: () => state.ready, open: () => { state.ready = true; return ++state.epoch; } },
    listSessions: async () => [{ id, path: sessionFile }],
  };
  const workflow = overrides => new AdoptionWorkflow({ ...workflowOptions, ...overrides });
  const messages = [], notices = [], sends = [];
  const startRuntime = async overrides => {
    const runtime = new Intercom({ cwd: f.home, sessionId: () => id, roleDirectory: path.join(f.home, 'roles/orchestrator'), rolesDirectory: path.join(f.home, 'roles'), workerRole: '', busy: () => false,
      deliver: text => messages.push(text), notify: text => notices.push(text), setName: async () => assert.fail('adoption must not rename worker') },
    { launch: async () => assert.fail('no worker launch'),
      closeProvider: { getIdentity: async () => assert.fail('no pane identity'), inspect: async () => assert.fail('no pane inspect'), close: async () => assert.fail('no pane close') },
      observe: () => ({ record() {}, close() {}, maintain() { assert.fail('no adoption maintenance'); } }),
      send: async (...args) => { sends.push(args); throw new Error('fixture old endpoint unreachable'); },
      adoption: { projectsHome: f.home, rolesDirectory: path.join(f.home, 'roles'), listSessions: workflowOptions.listSessions }, ...overrides });
    runtimeList.push(runtime); await runtime.start(); return runtime;
  };
  const declaration = async (pair = { sessionId: id, port: endpoint.port }) => {
    const scanned = await f.board.scan(), hash = f.sha256(scanned.raw);
    return { schemaVersion: 1, transitionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', phase: 'active', boardRoot: f.home, coordinator: pair, date: '2026-10-16',
      authority: { kind: 'first-coordinator declaration', record: 'fixture declaration', confirmedEndedAt: null, wording: 'fixture declaration' }, previous: null, previousRecordCommit: null,
      configBeforeSha256: hash, configAfterSha256: hash, intentCommit: null, leftUnchanged: leftUnchanged(scanned), rebriefSource: 'handoff.md (open assignments)' };
  };
  return Object.assign(f, { id, context, ui, state, workflowOptions, workflow, endpoint, startRuntime, declaration, messages, notices, sends });
}
