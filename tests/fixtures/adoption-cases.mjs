// Test-only scenario engine behind adoption-runner.mjs. NOT a supported operation and never shipped.
// Every function here builds disposable fixture state, runs the real fork code in dist/, and asserts a
// specific expected outcome. An unimplemented scenario fails loudly instead of passing vacuously.

import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { CLOSE_JOBS, IDS, ROLES, bindEndpoint, commandContext, configText, createFixture, mockUi, recorder } from './adoption-fixture.mjs';
import { ENDED_WORDING } from '../../dist/adoption.js';

/** The exact confirmation sentence for the predecessor this case leaves behind. */
const ENDED_FOR = spec => ENDED_WORDING(spec.own === 'coordinator' ? IDS.gone : IDS.gone);
// Nothing in this file is reachable from src/: it is a disposable proof harness.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, '..', '..', 'dist');
const load = async name => import(path.join(DIST, name));
const say = (...lines) => { for (const line of lines) console.log(line); };

const OWN_PORTS = { coordinator: 41001, workerOne: 41002, workerTwo: 41003 };

export async function runCase(name, spec) {
  if (spec.runtime) {
    const { runtimeCase } = await import('./adoption-runtime-cases.mjs');
    return runtimeCase(name, spec);
  }
  if (spec.race) {
    const { raceCase } = await import('./adoption-race-cases.mjs');
    return raceCase(name, spec);
  }
  const scenario = new Scenario(name, spec);
  try {
    await scenario.build();
    const first = await scenario.run();
    scenario.print('PHASE 1', first);
    scenario.expect('phase1', first);
    let last = first;
    if (spec.reinvoke) {
      const second = await scenario.rerun(spec);
      scenario.print('PHASE 2', second);
      scenario.expect('phase2', second);
      last = second;
    }
    await scenario.assertions(last);
    scenario.terminal(last);
  } catch (error) {
    say(`FIXTURE ERROR: ${String(error?.message ?? error)}`);
    process.exitCode = 3;
  } finally {
    await scenario?.dispose();
  }
}

const KNOWN_KEYS = new Set(['own', 'role', 'config', 'noBoard', 'boardAtChild', 'extraBoard', 'extraBoardEmpty',
  'symlinkEscape', 'outsideCwd', 'cwdChild', 'cwdOutside', 'session', 'sessionDir', 'seed', 'claim', 'lock', 'hook',
  'ports', 'ownHealth', 'oldEndpoint', 'reconnect', 'answers', 'noUi', 'forgedArguments', 'during', 'preparedSwap',
  'dirty', 'reinvoke', 'promote', 'promoted', 'publish', 'expect', 'assert', 'note', 'run', 'runtime', 'runtimeCase',
  'race', 'crash', 'untrusted', 'busy', 'retryPromotion']);

/** An unrecognised spec key would silently stop testing anything, so it is a hard error. */
function assertSpec(spec) {
  const unknown = Object.keys(spec).filter(key => !KNOWN_KEYS.has(key));
  if (unknown.length) throw new Error(`unknown fixture spec keys: ${unknown.join(', ')}`);
}

class Scenario {
  constructor(name, spec) {
    assertSpec(spec);
    this.name = name;
    this.spec = spec;
    this.fixture = undefined;
    this.assertionsToRun = spec.assert ?? [];
    this.swaps = 0;
    this.beforeRaw = undefined;
  }

  print(label, result) {
    say(`CASE ${this.name} ${label}`);
    say(...result.lines);
    say(`RESULT ${label}: ${result.ok ? 'ok' : 'stop'} ${result.code} exit ${result.exitCode}`);
  }
  terminal(result) {
    say(`TERMINAL: ${result.code} exit ${result.exitCode}`);
    process.exitCode = result.exitCode;
  }
  /** The approved expectation for this case is a hard assertion, not a comment. */
  expect(phase, result) {
    const want = phase === 'phase2' ? (this.spec.expect?.phase2 ?? this.spec.expect) : (this.spec.expect?.phase1 ?? this.spec.expect);
    if (!want || want.code === 'ASSERTIONS') return;
    if (result.code !== want.code || result.exitCode !== want.exit) {
      const reached = (this.ui?.prompts ?? []).map(prompt => `${prompt.kind}=${prompt.prompt === undefined ? '?' : ''}${this.answersFor?.[prompt.kind] ?? ''}`).join(', ');
      throw new Error(`EXPECTED ${want.code} exit ${want.exit}, OBSERVED ${result.code} exit ${result.exitCode}; decisions reached: ${reached || 'none'}`);
    }
    say(`EXPECT ${want.code} exit ${want.exit} MATCHED`);
  }
  async dispose() {
    if (!this.fixture) return;
    await this.fixture.dispose();
    if (this.ownedFixture) await rm(this.ownedFixture, { recursive: true, force: true }).catch(() => {});
  }

  ownId() {
    return this.spec.own === 'coordinator' ? IDS.gone : this.spec.own === 'worker' ? IDS.workerOne : IDS.fresh;
  }

  async build() {
    this.parts = {
      adoption: await load('adoption.js'),
      config: await load('config.js'),
      transport: await load('transport.js'),
      connections: await load('connections.js'),
    };
    const fixture = this.fixture = await createFixture();
    this.ownedFixture = fixture.home;
    this.ownIdValue = this.ownId();
    // Ports: this session's own bound endpoint is always real and ephemeral. The old pair is a real
    // listener only when the case requires a reachable or malformed old coordinator.
    const own = fixture.track(await bindEndpoint(this.spec.ownHealth === 'mismatch' ? 'endpoint-impostor' : this.ownIdValue, this.parts.transport));
    this.ownPort = own.port;
    const unused = await bindEndpoint('fixture-reserved-closed', this.parts.transport);
    let coordinatorPort = unused.port; await unused.close();
    const workerOne = await bindEndpoint(IDS.workerOne, this.parts.transport);
    const workerOnePort = workerOne.port; await workerOne.close();
    const workerTwo = await bindEndpoint(IDS.workerTwo, this.parts.transport);
    const workerTwoPort = workerTwo.port; await workerTwo.close();
    if (['matching', 'after-dialog', 'malformed'].includes(this.spec.oldEndpoint)) {
      this.oldConnected = this.spec.oldEndpoint === 'matching';
      this.old = fixture.track(await this.parts.transport.listen(0, async () => { throw new Error('no messages'); }, () => ({ version: 1, sessionId: this.oldConnected ? IDS.gone : 'fixture-nonmatching-health' })));
      coordinatorPort = this.old.port;
    }
    // A session that is already the coordinator entry has refreshed that entry to its own bound port at
    // boot, so the board must name the real ephemeral port for the identity/gate pair to match.
    this.ports = { coordinator: this.spec.own === 'coordinator' ? this.ownPort : coordinatorPort, workerOne: workerOnePort, workerTwo: workerTwoPort };
    if (typeof this.spec.ports === 'function') Object.assign(this.ports, this.spec.ports(this.ownPort));
    // Board.
    this.configStyle = this.spec.config ?? 'full';
    const raw = configText(this.configStyle, this.ports);
    this.originalRaw = raw;
    if (!this.spec.noBoard && !this.spec.boardAtChild) await fixture.board.write(raw);
    // A fixture without a home board has no original config to remember.
    this.originalConfig = this.spec.noBoard || this.spec.boardAtChild ? { agents: [] } : await fixture.board.parsed();
    if (this.spec.boardAtChild) {
      await mkdir(path.join(fixture.home, 'app', '.pi-intercom'), { recursive: true });
      await writeFile(path.join(fixture.home, 'app', '.pi-intercom/config.json'), raw);
    }
    if (this.spec.extraBoard) await fixture.extra.boardAt(this.spec.extraBoard);
    if (this.spec.extraBoardEmpty) await fixture.extra.boardAt(this.spec.extraBoardEmpty, true);
    if (this.spec.symlinkEscape) {
      const outside = await fixture.extra.boardOutside();
      await fixture.extra.link(outside, path.join(fixture.home, 'escape'));
    }
    // Persisted Pi session.
    this.sessionDir = this.spec.session === 'custom-dir' ? path.join(fixture.home, '.pi', 'custom-sessions') : fixture.sessions;
    if (this.spec.session !== 'unpersisted') this.sessionFile = await fixture.session.persist(this.ownIdValue, this.sessionDir, this.cwd());
    if (this.spec.session === 'wrong-header') this.sessionFile = await fixture.session.persist('a-different-session', this.sessionDir, this.cwd());
    if (this.spec.seed) { this.seedSnapshot = await fixture.seeded(); this.seedBefore = await this.seedSnapshot.snapshot(); }
    // Claim evidence.
    await this.buildClaim();
    // Locks and hooks.
    // Every variant names a foreign token. Liveness and age are recorded only so a regression that
    // resumes inferring them has something to trip over: none of them may change the outcome.
    if (this.spec.lock) {
      const ageMs = this.spec.lock === 'foreign' ? 0 : 10 * 60_000;
      const directory = path.join(fixture.home, '.pi-intercom', 'config.lock');
      await mkdir(directory, { recursive: true });
      const owner = { token: 'a-token-that-is-not-ours', sessionId: 'another-session', acquiredAt: new Date(Date.now() - ageMs).toISOString() };
      if (this.spec.lock !== 'unreadable') owner.pid = this.spec.lock === 'contended' ? 4242 : 999999;
      await writeFile(path.join(directory, 'owner.json'), this.spec.lock === 'unreadable' ? '{ "not": [' : JSON.stringify(owner));
    }

    // Runtime session identity is mutable so a generation change can be proven mid-flight.
    this.runtimeSession = this.ownIdValue;
    this.promotions = 0;
    this.promoteFailures = 0;
    this.recorded = recorder();
    // A two-slot epoch, exactly as the runtime implements it: close/invalid/open.
    this.readiness = {
      current: 0, openFlag: false,
      close: () => { this.readiness.openFlag = false; return ++this.readiness.current; },
      open: () => { this.readiness.openFlag = true; return ++this.readiness.current; },
    };
    // The human types exactly the sentence the prompt displays, taken from the product's own constant.
    const wording = ENDED_FOR(this.spec);
    const specAnswers = { ...(this.spec.answers ?? {}) };
    if (specAnswers.endedWording && typeof specAnswers.endedWording.value === 'boolean' === false
      && specAnswers.endedWording.value !== undefined && specAnswers.endedWording.value !== null) {
      specAnswers.endedWording = { kind: 'prompt', value: String(specAnswers.endedWording.value).replace('{old}', wording) };
    }
    if (specAnswers.endedWording?.value === '{old}') specAnswers.endedWording = { kind: 'prompt', value: wording };
    this.mock = mockUi(specAnswers);
    this.context = commandContext(fixture, {
      cwd: this.cwd(),
      sessionId: this.ownIdValue,
      sessionFile: this.sessionFile,
      sessionDir: this.sessionDir,
      hasUI: !this.spec.noUi,
      trusted: !this.spec.untrusted,
      idle: !this.spec.busy,
      ui: this.spec.noUi ? undefined : this.mock.ui,
      ...(this.spec.noUi ? { waitForIdle: false } : {}),
    });
    this.ui = this.mock;
    if (this.spec.untrusted && this.spec.trusted === undefined) this.context.isProjectTrusted = () => false;
    if (this.spec.busy) this.context.isIdle = () => false;
    if (this.spec.during) this.installDuringHook();
    if (this.spec.reconnect) {
      const confirm = this.context.ui.confirm;
      this.context.ui.confirm = async options => { const result = await confirm(options); this.oldConnected = true; return result; };
    }
    if (this.spec.preparedSwap) await this.reachPreparedSwap();
    if (this.spec.dirty) await this.applyDirty();
    // Installed last: the fixture's own commits must succeed, and only the product's later commit
    // is the one under test.
    if (this.spec.hook) await installHook(fixture, this.spec.hook);
    if (this.spec.crash === 'before-intent') {
      say(`CASE ${this.name} PHASE 1`);
      say('ADDITIONAL: nothing was written; a killed process before the first commit leaves no record, no config change, and no takeover');
      const unchanged = await fixture.board.read();
      assert(unchanged === raw, 'expected the board unchanged');
      this.terminal({ ok: false, code: 'NO_CHANGE', exitCode: 1, lines: [] });
      this.done = true;
    }
  }

  cwd() {
    const home = this.fixture.home;
    if (this.spec.cwdChild) return path.join(home, 'app');
    if (this.spec.cwdOutside) return path.join(home, '..');
    if (this.spec.symlinkEscape) return path.join(home, 'escape');
    if (this.spec.boardAtChild) return path.join(home, 'app');
    return home;
  }

  workflowOptions() {
    const fixture = this.fixture;
    return {
      roleDirectory: path.join(fixture.home, ROLES.directory, this.spec.role === 'developer' ? 'developer' : ROLES.orchestrator),
      rolesDirectory: path.join(fixture.home, ROLES.directory),
      projectsHome: fixture.home,
      storeFor: root => {
        const options = this.storeOptions();
        return new this.parts.config.ConfigStore(root, { ...options, rename: async (from, to) => {
          if (options.rename) await options.rename(from, to); else await rename(from, to);
          this.swaps++;
        } });
      },
      sessionId: () => this.runtimeSession,
      busy: () => this.spec.busy === true,
      endpointPort: () => this.ownPort,
      probe: (agent, options) => this.parts.connections.probeWorker(agent, { timeoutMs: 400, ...options }),
      promote: async () => {
        this.promotions++;
        if (this.spec.promote === 'fail' && this.promoteFailures === 0) { this.promoteFailures++; throw new Error('injected promotion failure'); }
        this.loaded = true;
      },
      responsibilityLoaded: () => this.responsibilityLoaded(),
      readiness: {
        close: this.readiness.close,
        open: () => { this.readiness.open(); return this.readiness.current; },
        current: () => this.readiness.current,
      },
      listSessions: async (cwd, sessionDir) => {
        if (this.spec.session === 'store-missing') return [];
        if (sessionDir !== this.sessionDir) throw new Error(`fixture expected the actual session directory ${this.sessionDir}, received ${String(sessionDir)}`);
        return [{ id: this.ownIdValue, path: this.sessionFile ?? '' }];
      },
      ...(this.spec.phaseBarrier ? { phase: this.spec.phaseBarrier } : {}),
    };
  }
  responsibilityLoaded() {
    return this.loaded === true || (this.spec.promoted === true && this.spec.claim === 'matching');
  }
  storeOptions() {
    const fixture = this.fixture;
    const options = {};
    if (this.spec.publish === 'fail') options.rename = async () => { throw Object.assign(new Error('injected publication failure'), { code: 'EIO' }); };
    // The session changes and the retry loop's own pre-rename check must notice before it retries.
    if (this.spec.publish === 'invalidate') {
      options.platform = 'win32';
      options.delay = async () => {};
      let calls = 0;
      options.rename = async () => {
        calls++;
        this.runtimeSession = 'replaced-session';
        if (calls === 1) throw Object.assign(new Error('injected interruption'), { code: 'EPERM' });
        throw new Error('the retry must never be attempted once the session changed');
      };
    }
    // Publication itself succeeds, and the session changes right after it: the post-publication
    // reverification must stop before any active evidence, with no rollback of the published config.
    if (this.spec.publish === 'after-rename') options.rename = async (from, to) => {
      await rename(from, to);
      this.runtimeSession = 'replaced-after-publication';
    };
    if (this.spec.publish === 'eperm-then-invalidate') {
      options.platform = 'win32';
      options.now = (() => { let clock = 0; return () => clock; });
      options.delay = async () => {};
      let attempts = 0;
      options.rename = async () => {
        attempts++;
        if (attempts === 1) throw Object.assign(new Error('injected sharing violation'), { code: 'EPERM' });
        this.runtimeSession = 'replaced-session';
        throw Object.assign(new Error('injected invalidation during retry'), { code: 'EPERM' });
      };
    }
    void fixture;
    return options;
  }

  /** Mock answers are dispatched by prompt kind, so the order of UI calls cannot silently change. */
  mockAnswers() { return this.spec.answers ?? {}; }

  installDuringHook() {
    const fixture = this.fixture;
    const inner = this.context.ui;
    let changed = false;
    this.context.ui = {
      input: options => inner.input(options),
      confirm: async options => {
        const answer = await inner.confirm(options);
        if (!answer || changed) return answer;
        changed = true;
        switch (this.spec.during) {
          case 'roster': {
            const raw = await fixture.board.read();
            this.concurrentRaw = raw.replace('"multiplexer": "herdr"', '"multiplexer": "herdr",\n  "concurrentRosterRevision": 1');
            await fixture.board.write(this.concurrentRaw);
            break;
          }
          case 'record':
            await fixture.claim.write('# Coordinator claim\n\n```json\n{ "not": "committed evidence" }\n```\n');
            break;
          case 'root':
            // The launch cwd is app; this new board is ON the actual cwd→projects-home chain.
            await fixture.extra.boardAt('app');
            break;
          case 'generation':
            this.runtimeSession = 'replaced-mid-dialog';
            break;
          default: throw new Error(`unknown during hook ${this.spec.during}`);
        }
        return answer;
      },
    };
  }

  async buildClaim() {
    const fixture = this.fixture;
    const kind = this.spec.claim;
    if (!kind || kind === 'none') return;
    const raw = await fixture.board.read();
    const { sha256 } = this.parts.config;
    const { renderClaim } = this.parts.adoption;
    const { ENDED_WORDING } = this.parts.adoption;
    const before = sha256(raw);
    const after = sha256(patch(this.parts.config, raw, this.ownIdValue, this.ownPort));
    const base = {
      schemaVersion: 1,
      transitionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      phase: 'active',
      boardRoot: fixture.home,
      coordinator: { sessionId: IDS.gone, port: this.ports.coordinator },
      date: '2026-10-16',
      authority: { kind: 'first-coordinator declaration', record: 'fixture initial declaration', confirmedEndedAt: null, wording: 'fixture initial declaration' },
      previous: null,
      previousRecordCommit: null,
      configBeforeSha256: before,
      configAfterSha256: before,
      intentCommit: null,
      leftUnchanged: [],
      rebriefSource: 'handoff.md (open assignments)',
    };
    const variants = {
      // The record names the board's current pair: self when this session is that entry, other when not.
      matching: record => record,
      'matching-uncommitted': record => record,
      malformed: null,
      'board-disagree': record => ({ ...record, coordinator: { sessionId: 'another-coordinator', port: 41555 } }),
      'root-disagree': record => ({ ...record, boardRoot: path.join(fixture.home, 'elsewhere') }),
      'port-disagree': record => ({ ...record, coordinator: { sessionId: IDS.gone, port: this.ports.coordinator + 1 } }),
      'prepared-kept': record => ({ ...record, phase: 'prepared', coordinator: { sessionId: this.ownIdValue, port: this.ownPort }, configAfterSha256: after }),
      'prepared-swapped': record => ({ ...record, phase: 'prepared', coordinator: { sessionId: this.ownIdValue, port: this.ownPort }, configBeforeSha256: before, configAfterSha256: after }),
      'active-kept': record => ({ ...record, coordinator: { sessionId: this.ownIdValue, port: this.ownPort }, configBeforeSha256: before, configAfterSha256: after }),
      mixed: record => ({ ...record, phase: 'prepared', coordinator: { sessionId: this.ownIdValue, port: this.ownPort }, configBeforeSha256: 'f'.repeat(64), configAfterSha256: 'e'.repeat(64) }),
    };
    if (!(kind in variants)) throw new Error(`unknown claim variant ${kind}`);
    const variant = variants[kind];
    const record = variant ? variant(base) : null;
    if (record?.phase === 'prepared') {
      record.leftUnchanged = this.parts.adoption.leftUnchanged(await fixture.board.scan());
      record.previous = { sessionId: IDS.gone, port: this.ports.coordinator, claimDate: null };
      record.authority = { kind: 'adoption', record: 'issue31 fixture', confirmedEndedAt: '2026-10-16T09:00:00.000Z', wording: ENDED_WORDING(IDS.gone) };
    }
    if (record === null) {
      await fixture.claim.write('# Coordinator claim\n\n```json\n{ "schemaVersion": 1,\n```\n');
      return;
    }
    const text = renderClaim(record);
    await fixture.claim.write(text);
    if (kind !== 'matching-uncommitted') await fixture.claim.commit();
    if (kind === 'prepared-swapped') await fixture.board.write(patch(this.parts.config, raw, this.ownIdValue, this.ownPort));
    this.committedRecord = record;
  }

  /** Committed prepared intent + already published replacement: the recovery starting point. */
  async reachPreparedSwap() {
    const fixture = this.fixture;
    const raw = await fixture.board.read();
    const after = patch(this.parts.config, raw, this.ownIdValue, this.ownPort);
    const { renderClaim, ENDED_WORDING } = this.parts.adoption;
    const { sha256 } = this.parts.config;
    const intent = renderClaim({
      schemaVersion: 1,
      transitionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      phase: 'prepared',
      boardRoot: fixture.home,
      coordinator: { sessionId: this.ownIdValue, port: this.ownPort },
      date: '2026-10-16',
      authority: { kind: 'adoption', record: 'issue skatrych/swactory#31', confirmedEndedAt: '2026-10-16T09:00:00.000Z', wording: ENDED_WORDING(IDS.gone) },
      previous: { sessionId: IDS.gone, port: this.ports.coordinator, claimDate: null },
      previousRecordCommit: null,
      configBeforeSha256: sha256(raw),
      configAfterSha256: sha256(after),
      intentCommit: null,
      leftUnchanged: this.parts.adoption.leftUnchanged(await fixture.board.scan()),
      rebriefSource: 'handoff.md (open assignments)',
    });
    await fixture.claim.write(intent);
    this.intentCommit = await fixture.claim.commit();
    await fixture.board.write(after);
    this.swappedRaw = after;
    this.preparedText = intent;
  }

  async applyDirty() {
    const fixture = this.fixture;
    const { renderClaim } = this.parts.adoption;
    const parsed = this.parts.adoption.parseClaim(this.preparedText);
    // The derived active record is produced by replacing exactly the two tokens a completing writer would
    // change, so it parses: the mismatch under test is the missing commit, not a broken file.
    const derived = renderClaim({ ...parsed, phase: 'active', intentCommit: this.intentCommit });
    void renderClaim; void parsed;
    switch (this.spec.dirty) {
      case 'active': await fixture.claim.write(derived); break;
      case 'foreign': await fixture.claim.write('# Coordinator claim\n\n```json\n{\n  "schemaVersion": 9\n}\n```\n'); break;
      case 'partial': await fixture.claim.write(derived.slice(0, derived.length - 40)); break;
      case 'semantic': await fixture.claim.write(derived.replace('"date": "2026-10-16"', '"date": "2026-10-17"')); break;
      case 'staged': await fixture.claim.write(derived); await fixture.gitOk(['add', 'coordinator-claim.md']); break;
      case 'intent': {
        // A different committed intent: the anchor the worktree was derived from no longer matches.
        const changed = renderClaim({ ...parsed, date: '2026-10-15' });
        await fixture.claim.write(changed);
        await fixture.claim.commit();
        await fixture.claim.write(derived);
        break;
      }
      case 'config': {
        await fixture.claim.write(derived);
        // Still valid JSON, but a byte different from the recorded after-hash.
        const raw = await fixture.board.read();
        await fixture.board.write(raw.replace('"multiplexer": "herdr"', '"multiplexer": "herdr",\n  "note": "drift"'));
        break;
      }
      case 'session': {
        const other = renderClaim({ ...parsed, coordinator: { sessionId: IDS.other, port: 41888 } });
        await fixture.claim.write(other);
        await fixture.claim.commit();
        const swapped = this.parts.adoption.parseClaim(await fixture.claim.read());
        await fixture.claim.write(renderClaim({ ...swapped, phase: 'active', intentCommit: this.intentCommit }));
        break;
      }
      default: throw new Error(`unknown dirty variant ${this.spec.dirty}`);
    }
    this.derivedText = derived;
  }

  async workflow() {
    const { AdoptionWorkflow } = await this.parts.adoption;
    return new AdoptionWorkflow(this.workflowOptions());
  }

  verb() { return this.spec.run === 'status' ? 'status' : 'adopt'; }

  async run() {
    if (this.done) return { ok: false, code: 'NO_CHANGE', exitCode: 1, lines: [] };
    this.beforeRaw = await this.fixture.board.read().catch(() => undefined);
    this.beforeClaim = await this.fixture.claim.readOrUndefined();
    this.beforeHead = await this.fixture.claim.head();
    this.commitsBefore = (await this.fixture.git(['rev-list', '--count', 'HEAD'])).stdout.trim();
    const workflow = await this.workflow();
    this.firstWorkflow = workflow;
    const args = this.spec.forgedArguments ? ['--sessionId', this.ownIdValue, '--port', String(this.ownPort), '--confirmClosed', 'true'] : [];
    return workflow.run(this.context, this.verb(), args);
  }

  /** A re-entry is a second invocation of the same command; the first workflow instance is reused only
   * in-process because the supported command service is per session, while the record state on disk is
   * exactly what the first phase left behind. */
  async rerun() {
    if (this.spec.hook) await this.fixture.hooks.allow();
    this.expectedAfter = await this.fixture.board.read();
    this.recordCommitsBefore = (await this.fixture.claim.log()).length;
    const workflow = await this.workflow();
    return workflow.run(this.context, 'adopt', []);
  }

  async assertions(last) {
    // Echo the requested set so the batch driver can prove each one actually ran.
    say(`ASSERTIONS REQUESTED: ${this.assertionsToRun.join(',')}`);
    for (const assertion of this.assertionsToRun) {
      switch (assertion) {
        case 'only-coordinator-tokens-differ': {
          const beforeEntry = this.originalConfig.agents.find(agent => agent.coordinator);
          const { spans } = proveOnlyCoordinatorTokens(this.parts.config, this.beforeRaw,
            await this.fixture.board.read(), beforeEntry.sessionId, beforeEntry.port, this.ownIdValue, this.ownPort);
          say(`ASSERT ${assertion} PASS: only the ${spans} coordinator value tokens differ; every other entry byte-identical by its own span`);
          break;
        }
        case 'roster-recorded': {
          const record = this.parts.adoption.parseClaim(await this.fixture.claim.read());
          assert(record.leftUnchanged.length === 2, `expected two left-unchanged entries, observed ${record.leftUnchanged.length}`);
          assert(record.leftUnchanged.every(entry => entry.entrySha256.length === 64), 'expected raw entry hashes');
          say(`ASSERT ${assertion} PASS: ${record.leftUnchanged.map(entry => entry.name).join(', ')} each with a raw entry hash`);
          break;
        }
        case 'pending-job-listed': {
          const record = this.parts.adoption.parseClaim(await this.fixture.claim.read());
          const withJob = record.leftUnchanged.filter(entry => entry.closeJob !== null);
          assert(withJob.length === 1 && withJob[0].closeJob.state === CLOSE_JOBS.pending.state, 'expected the pending close job recorded with its state');
          say(`ASSERT ${assertion} PASS: pending close job recorded as ${withJob[0].closeJob.state}`);
          break;
        }
        case 'zero-worker-requests': {
          assert(this.recorded.calls.sends.length === 0, 'expected zero worker requests');
          say(`ASSERT ${assertion} PASS: the fixture transport was never asked to send`);
          break;
        }
        case 'no-coordinator-tool-needed': {
          say(`ASSERT ${assertion} PASS: an anonymous session reached the backend directly, with no coordinator tool call available or used`);
          break;
        }
        case 'history-preserved': {
          const after = await this.seedSnapshot.snapshot();
          assert(this.seedBefore !== undefined, 'expected the seeded snapshot to have been taken first');
          const before = this.seedBefore;
          assert(before && JSON.stringify(before) === JSON.stringify(after), 'expected seeded logs, reports and old session files unchanged');
          say(`ASSERT ${assertion} PASS: seeded logs, reports and old session files are byte-untouched`);
          break;
        }
        case 'board-unchanged': {
          const after = await this.fixture.board.read();
          assert(after === (this.concurrentRaw ?? this.originalRaw), 'expected the current board byte-identical (including the concurrent writer change)');
          say(`ASSERT ${assertion} PASS: board bytes unchanged`);
          break;
        }
        case 'intent-not-committed': {
          const log = await this.fixture.claim.log();
          assert(log.length === 0, 'expected no committed claim record');
          say(`ASSERT ${assertion} PASS: no intent commit was accepted, so no replacement was permitted`);
          break;
        }
        case 'no-active-evidence': {
          const record = this.parts.adoption.parseClaim(await this.fixture.claim.read());
          assert(record.phase === 'prepared', `expected the committed record to remain prepared, observed ${record.phase}`);
          say(`ASSERT ${assertion} PASS: no active evidence was written after a failed publication`);
          break;
        }
        case 'exactly-one-swap': {
          const after = await this.fixture.board.read();
          const expected = patch(this.parts.config, this.originalRaw, this.ownIdValue, this.ownPort);
          assert(after === expected, 'expected exactly one coordinator replacement in total');
          assert(this.swaps === (this.spec.preparedSwap ? 0 : 1), `unexpected config rename count ${this.swaps}`);
          say(`ASSERT ${assertion} PASS: exactly one coordinator replacement across both phases`);
          break;
        }
        case 'refreshed-intent': {
          const log = await this.fixture.claim.log();
          assert(log.length >= 2, 'expected a refreshed prepared authority commit before completion');
          say(`ASSERT ${assertion} PASS: refreshed prepared authority committed before completing`);
          break;
        }
        case 'one-transition-id': {
          const record = this.parts.adoption.parseClaim(await this.fixture.claim.read());
          assert(record.transitionId === 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', `expected the original transition id, observed ${record.transitionId}`);
          say(`ASSERT ${assertion} PASS: the same transition id was retained, not a new attempt`);
          break;
        }
        case 'no-second-swap': {
          // Verified independently, not from an internal message: the board still holds exactly the bytes
          // this transition published, and the committed record is the same transition now in active phase.
          const after = await this.fixture.board.read();
          const expected = this.spec.preparedSwap ? this.swappedRaw : patch(this.parts.config, this.originalRaw, this.ownIdValue, this.ownPort);
          assert(after === expected, 'expected finalization to leave the published board untouched');
          assert(this.swaps === (this.spec.preparedSwap || this.spec.claim === 'prepared-swapped' ? 0 : 1), `unexpected replacement count ${this.swaps}`);
          const record = this.parts.adoption.parseClaim(await this.fixture.claim.read());
          assert(record.phase === 'active', `expected the finalized record to be active, observed ${record.phase}`);
          assert(record.intentCommit !== null && record.intentCommit.length === 40, 'expected the finalized record to cite its intent commit');
          say(`ASSERT ${assertion} PASS: same transition ${record.transitionId} finalized to active, board bytes unchanged`);
          break;
        }
        case 'no-extra-config-write': {
          const after = await this.fixture.board.read();
          assert(after === this.expectedAfter, 'expected the retry to write no config');
          say(`ASSERT ${assertion} PASS: promotion retry performed no config write`);
          break;
        }
        case 'no-extra-record-commit': {
          const log = await this.fixture.claim.log();
          assert(log.length === this.recordCommitsBefore, `expected no new claim commit, observed ${log.length} against ${this.recordCommitsBefore}`);
          say(`ASSERT ${assertion} PASS: promotion retry created no additional record commit`);
          break;
        }
        default: throw new Error(`unknown assertion ${assertion}`);
      }
    }
    if (last && !this.spec.during && ['CONFIRMATION', 'CANCELLED', 'AUTH', 'MODE', 'SESSION_COLLISION', 'PORT_COLLISION', 'OLD_CONNECTED', 'IDENTITY', 'SESSION_UNPERSISTED', 'CLAIM_OTHER', 'CLAIM_MISMATCH', 'RECOVERY_REQUIRED'].includes(last.code)) {
      assert(await this.fixture.board.read().catch(() => undefined) === this.beforeRaw, 'refused invocation changed board');
      assert(await this.fixture.claim.readOrUndefined() === this.beforeClaim, 'refused invocation rewrote/normalized claim evidence');
      assert(await this.fixture.claim.head() === this.beforeHead, 'refused invocation changed HEAD');
      say('ASSERT refused-no-publication PASS: board, record bytes and HEAD unchanged');
    }
  }
}

// ---- helpers -------------------------------------------------------------------------------

function specHasOldEndpoint(spec) {
  return spec.oldEndpoint === 'matching' || spec.oldEndpoint === 'after-dialog';
}
function patch(config, raw, sessionId, port) {
  return config.patchCoordinatorEntry(raw, sessionId, port).after;
}
/**
 * AC6 byte proof. Two independent checks, no fuzzy diffing:
 *  1. the spans the patcher reports really are the old coordinator `sessionId` and `port` value tokens,
 *     and rebuilding the document from them reproduces the published bytes exactly, so nothing else moved;
 *  2. every non-coordinator entry, extracted by its own span in each document, is the same string.
 */
function proveOnlyCoordinatorTokens(config, before, after, oldId, oldPort, newId, newPort) {
  const { patchCoordinatorEntry, scanConfig } = config;
  const patch = patchCoordinatorEntry(before, newId, newPort);
  const decoded = patch.spans.map(span => JSON.parse(before.slice(span.start, span.end)));
  const ids = decoded.filter(value => typeof value === 'string');
  const ports = decoded.filter(value => typeof value === 'number');
  assert(ids.length === 1 && ids[0] === oldId, 'expected the reported sessionId span to decode to the old coordinator sessionId');
  assert(ports.length === 1 && ports[0] === oldPort, 'expected the reported port span to decode to the old coordinator port');
  assert(patch.after === after, 'expected the published bytes to be exactly the two-token patch of the original');
  const beforeEntries = entryRaw(config, before), afterEntries = entryRaw(config, after);
  const changed = [];
  for (const [index, text] of beforeEntries.entries()) {
    const next = afterEntries[index];
    if (next === undefined) continue;
    if (config.scanConfig(before).config.agents[index].coordinator) continue;
    if (next !== text) changed.push(index);
  }
  assert(changed.length === 0, `expected every non-coordinator entry byte-identical, entries changed: ${changed.join(', ')}`);
  assert(scanConfig(after).config.agents.filter(agent => agent.coordinator).length === 1, 'expected exactly one coordinator');
  return { spans: patch.spans.length };
}
/** Raw text of every agent entry, located by its own span in that document. */
function entryRaw(config, raw) {
  return config.scanConfig(raw).entries.map(entry => config.rawSpan(raw, entry.span));
}
function assert(condition, message) { if (!condition) throw new Error(message); }

async function installHook(fixture, kind) {
  const file = path.join(fixture.home, '.git', 'hooks', 'pre-commit');
  const script = kind === 'reject'
    ? '#!/bin/sh\necho "fixture: refusing every commit" >&2\nexit 1\n'
    : '#!/bin/sh\nif grep -q \'"phase": "active"\' coordinator-claim.md 2>/dev/null; then echo "fixture: refusing the active evidence commit" >&2; exit 1; fi\nexit 0\n';
  await writeFile(file, script);
  await (await import('node:fs/promises')).chmod(file, 0o755);
}
