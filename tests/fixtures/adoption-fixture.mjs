// Test-only fixture kit for coordinator adoption. NOT a supported operation and NOT shipped: nothing in
// src/ imports it. It builds a temporary projects-home git repository with a hand-written
// `.pi-intercom/config.json`, a persisted Pi session header, an ephemeral loopback endpoint standing in
// for "this runtime's ready notification", and a mock Pi UI. No live board, installed role, real port,
// Pi worker, model turn, or cancellation is involved.

import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// Windows-safe ESM specifier: bare absolute paths (C:\...) are parsed as URL schemes.
const dist = async name => import(pathToFileURL(path.join(ROOT, 'dist', name)).href);
const execute = promisify(execFile);

export const IDS = { gone: 'gone-coordinator', fresh: 'fresh-orchestrator', workerOne: 'worker-one', workerTwo: 'worker-two', other: 'another-session' };
/** A role tree of the shape `pi-role` uses, so the canonical launch-role check has something real. */
export const ROLES = { directory: 'roles', orchestrator: 'orchestrator' };

const PENDING_JOB = { jobId: 'job-pending-1', state: 'awaiting_handoff', createdAt: '2026-10-16T09:00:00.000Z', updatedAt: '2026-10-16T09:00:01.000Z', deadlineAt: '2026-10-16T09:02:01.000Z' };
const UNCERTAIN_JOB = { jobId: 'job-uncertain-2', state: 'uncertain', createdAt: '2026-10-16T09:00:00.000Z', updatedAt: '2026-10-16T09:00:02.000Z', deadlineAt: '2026-10-16T09:02:02.000Z' };
export const CLOSE_JOBS = { pending: PENDING_JOB, uncertain: UNCERTAIN_JOB };

/** Hand-written shapes. None is produced by a supported writer, and several are deliberately irregular. */
export const configs = {
  /** Two workers, one pending and one uncertain close job. */
  full: ports => `{
      "version": 1,
      "multiplexer": "herdr",
      "agents": [
        {
          "sessionId": "${IDS.gone}",
          "name": "Coordinator",
          "coordinator": true,
          "description": "Coordinate workers.",
          "port": ${ports.coordinator},
          "projectDirectory": "."
        },
        {
          "sessionId": "${IDS.workerOne}",
          "name": "Builder",
          "coordinator": false,
          "description": "Build assigned work.",
          "port": ${ports.workerOne},
          "projectDirectory": "app"
        },
        {
          "sessionId": "${IDS.workerTwo}",
          "name": "Reviewer",
          "coordinator": false,
          "description": "Review assigned work.",
          "port": ${ports.workerTwo},
          "projectDirectory": "app/web",
          "role": "verifier",
          "closeJob": ${JSON.stringify(PENDING_JOB, null, 6).replace(/\n/g, '\n        ')}
        }
      ]
    }
    `.replace(/^ {4}/gm, ''),
  single: ports => `{
      "version": 1,
      "multiplexer": "herdr",
      "agents": [
        {
          "sessionId": "${IDS.gone}",
          "name": "Coordinator",
          "coordinator": true,
          "description": "Coordinate workers.",
          "port": ${ports.coordinator},
          "projectDirectory": "."
        }
      ]
    }
    `.replace(/^ {4}/gm, ''),
  minified: ports => `{"version":1,"multiplexer":"herdr","agents":[{"sessionId":"${IDS.gone}","name":"Coordinator","coordinator":true,"description":"Coordinate workers.","port":${ports.coordinator},"projectDirectory":"."},{"sessionId":"${IDS.workerOne}","name":"Builder","coordinator":false,"description":"Build assigned work.","port":${ports.workerOne},"projectDirectory":"app"},{"sessionId":"${IDS.workerTwo}","name":"Reviewer","coordinator":false,"description":"Review assigned work.","port":${ports.workerTwo},"projectDirectory":"app/web","closeJob":${JSON.stringify(UNCERTAIN_JOB)}}]}`,
  irregular: ports => `{"version":    1,   "multiplexer":"herdr",
  "agents":[
    {"coordinator":true,   "sessionId":"${IDS.gone}","name":"Coordinator",
      "description":"Coordinate workers.",   "port":   ${ports.coordinator},"projectDirectory":".","unknownTolerance":{"kept":"exactly as written","nested":[1,2,3]}},
    {"sessionId":"${IDS.workerOne}","name":"Builder","coordinator":false,"description":"Build assigned work.",
      "port":${ports.workerOne},"projectDirectory":"app","unknownField":"kept too"},
    {"sessionId":"${IDS.workerTwo}","name":"Reviewer","coordinator":false,"description":"Review assigned work.",
      "port":${ports.workerTwo},"projectDirectory":"app/web","closeJob":{"jobId":"${PENDING_JOB.jobId}","state":"${PENDING_JOB.state}",
        "createdAt":"${PENDING_JOB.createdAt}","updatedAt":"${PENDING_JOB.updatedAt}","deadlineAt":"${PENDING_JOB.deadlineAt}"}}
  ]}
  `,
  /** An unknown top-level field and an unknown entry field, in ordinary formatting. */
  unknownField: ports => `{
      "version": 1,
      "multiplexer": "herdr",
      "writtenBy": "a newer tool",
      "agents": [
        {
          "sessionId": "${IDS.gone}",
          "name": "Coordinator",
          "coordinator": true,
          "description": "Coordinate workers.",
          "port": ${ports.coordinator},
          "projectDirectory": ".",
          "futureField": { "kept": "verbatim" }
        },
        {
          "sessionId": "${IDS.workerOne}",
          "name": "Builder",
          "coordinator": false,
          "description": "Build assigned work.",
          "port": ${ports.workerOne},
          "projectDirectory": "app",
          "unknownEntry": 7
        }
      ]
    }
    `.replace(/^ {4}/gm, ''),
  duplicateKeys: ports => `{
      "version": 1,
      "version": 1,
      "multiplexer": "herdr",
      "agents": [
        {"sessionId": "${IDS.gone}", "name": "Coordinator", "coordinator": true, "description": "Coordinate workers.", "port": ${ports.coordinator}, "projectDirectory": "."}
      ]
    }
    `.replace(/^ {4}/gm, ''),
  badVersion: ports => configs.full(ports).replace('"version": 1,', '"version": 2,'),
  badSchema: ports => configs.full(ports).replace('"multiplexer": "herdr"', '"multiplexer": "screen"'),
};

// No fallback: an unrecognised shape silently becomes a valid board and the case proves nothing.
export const configText = (style, ports) => {
  const shape = configs[style];
  if (!shape) throw new Error(`unknown config shape ${style}`);
  return shape(ports);
};

/** Ephemeral loopback ports only. Never an existing or live port. */
export async function bindEndpoint(sessionId, transport) {
  const endpoint = await transport.listen(0, async () => { throw new Error('fixture endpoint accepts no messages'); }, () => ({ version: 1, sessionId }));
  return endpoint;
}

export async function createFixture(options = {}) {
  const { ConfigStore, scanConfig, sha256, validateConfig } = await dist('config.js');
  const { renderClaim } = await dist('adoption.js');
  const { listen } = await dist('transport.js');
  const { probeWorker } = await dist('connections.js');
  // os.tmpdir() can contain an 8.3 alias on Windows (or a symlink on Unix). The
  // positive fixture must use the same canonical home as the production safety gates.
  // Explicit homes remain untouched so negative alias fixtures can still exercise refusal.
  const home = options.home ?? await realpath(await mkdtemp(path.join(tmpdir(), 'intercom-adopt-')));
  const sessions = path.join(home, '.pi/default-sessions');
  const endpoints = [];
  const removed = [];

  const git = async (args, cwd = home) => {
    try { const { stdout } = await execute('git', args, { cwd, timeout: 10_000 }); return { code: 0, stdout, stderr: '' }; }
    catch (error) { return { code: typeof error.code === 'number' ? error.code : 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }; }
  };
  const gitOk = async (args, cwd) => {
    const result = await git(args, cwd);
    if (result.code !== 0) throw new Error(`fixture git ${args.join(' ')} failed: ${(result.stderr || '').trim()}`);
    return result.stdout;
  };

  await mkdir(path.join(home, 'app', 'web'), { recursive: true });
  await mkdir(path.join(home, 'roles', 'orchestrator'), { recursive: true });
  await mkdir(path.join(home, 'roles', 'developer'), { recursive: true });
  await gitOk(['init', '-q', '--initial-branch=main']);
  await gitOk(['config', 'user.email', 'fixture@example.invalid']);
  await gitOk(['config', 'user.name', 'Intercom Fixture']);
  await writeFile(path.join(home, 'AGENTS.md'), '# Fixture projects home\n');
  await writeFile(path.join(home, 'handoff.md'), '# Handoff\n\nNo assignments recorded.\n');
  // The real projects home ignores tooling-owned state; a fixture that ignored nothing would refuse
  // every commit for files no commit could ever contain.
  await writeFile(path.join(home, '.gitignore'), '/.pi-intercom/\n/.pi/\n');
  await gitOk(['add', 'AGENTS.md', 'handoff.md', '.gitignore']);
  await gitOk(['commit', '-q', '-m', 'fixture: projects home base']);
  await mkdir(sessions, { recursive: true });

  const configPath = () => path.join(home, '.pi-intercom/config.json');
  const claimPath = () => path.join(home, 'coordinator-claim.md');
  const board = {
    write: async text => {
      await mkdir(path.join(home, '.pi-intercom'), { recursive: true });
      await writeFile(configPath(), text);
    },
    read: async () => readFile(configPath(), 'utf8'),
    scan: async () => scanConfig(await board.read()),
    /** Structural checks: validateConfig throws on an unusable board rather than reporting a list. */
    parsed: async () => JSON.parse(await board.read()),
    invalid: async () => {
      try { validateConfig(JSON.parse(await board.read())); return undefined; }
      catch (error) { return String(error); }
    },
  };
  const claim = {
    write: async text => writeFile(claimPath(), text),
    read: async () => readFile(claimPath(), 'utf8'),
    readOrUndefined: async () => { try { return await claim.read(); } catch { return undefined; } },
    /** The same argv sequence the workflow uses, so a fixture record is committed the real way. */
    commit: async () => {
      await gitOk(['add', '--', 'coordinator-claim.md']);
      await gitOk(['commit', '-q', '--only', 'coordinator-claim.md', '-m', 'fixture: coordinator evidence']);
      return (await gitOk(['rev-parse', 'HEAD'])).trim();
    },
    /** Write then commit, exactly as committed evidence must be. */
    writeAndCommit: async record => { await claim.write(renderClaim(record)); return claim.commit(); },
    head: async () => (await gitOk(['rev-parse', 'HEAD'])).trim(),
    log: async () => (await gitOk(['log', '--format=%H', '--', 'coordinator-claim.md'])).trim().split('\n').filter(Boolean),
    at: async revision => (await gitOk(['show', `${revision}:coordinator-claim.md`])),
    status: async () => (await gitOk(['status', '--porcelain=v1', '--untracked-files=all'])),
  };
  const session = {
    /** One persisted Pi session header, the shape Pi writes as the first line of a session file. */
    persist: async (id, directory = sessions, cwd = home) => {
      const file = path.join(directory, `2026-10-16T09-00-00-000Z_${id}.jsonl`);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, `${JSON.stringify({ type: 'session', version: 3, id, timestamp: '2026-10-16T09:00:00.000Z', cwd })}\n`);
      return file;
    },
    header: async file => JSON.parse((await readFile(file, 'utf8')).split('\n', 1)[0]),
    rewriteHeader: async (file, id) => writeFile(file, `${JSON.stringify({ type: 'session', version: 3, id, timestamp: '2026-10-16T09:00:00.000Z', cwd: home })}\n`),
  };
  const extra = {
    /** Another `.pi-intercom` directory: the AC1 count assertion, not a cleanup item. */
    boardAt: async relative => {
      const directory = path.join(home, relative);
      await mkdir(path.join(directory, '.pi-intercom'), { recursive: true });
      return directory;
    },
    boardOutside: async () => {
      const directory = await mkdtemp(path.join(tmpdir(), 'intercom-adopt-outside-'));
      removed.push(directory);
      await mkdir(path.join(directory, '.pi-intercom'), { recursive: true });
      await writeFile(path.join(directory, '.pi-intercom/config.json'), configText('single', { coordinator: 41001, workerOne: 41002, workerTwo: 41003 }));
      return directory;
    },
    link: async (target, linkName) => symlink(target, linkName, 'dir'),
  };
  const hooks = {
    reject: async () => {
      const file = path.join(home, '.git/hooks/pre-commit');
      await writeFile(file, '#!/bin/sh\necho "fixture: refusing" >&2\nexit 1\n');
      await chmod(file, 0o755);
    },
    allow: async () => { await rm(path.join(home, '.git/hooks/pre-commit'), { force: true }); },
  };
  const seeded = async () => {
    const logDirectory = path.join(home, '.pi-intercom/logs'), reportDirectory = path.join(home, '.pi-intercom/reports');
    await mkdir(logDirectory, { recursive: true });
    await mkdir(reportDirectory, { recursive: true });
    await writeFile(path.join(logDirectory, 'writer-11111111-1111-4111-8111-111111111111.jsonl'), '{"version":1,"event":"runtime.ready"}\n');
    await writeFile(path.join(reportDirectory, 'a'.repeat(64) + '.json'), '{"version":1,"status":"blocked","summary":"seed"}\n');
    await writeFile(path.join(home, '.pi-intercom/keep.txt'), 'do not touch\n');
    await session.persist(IDS.gone, path.join(home, '.pi/old-sessions'));
    const read = async directory => Object.fromEntries(await Promise.all((await readdir(directory)).sort().map(async name => [name, await readFile(path.join(directory, name), 'utf8')])));
    return {
      logDirectory, reportDirectory,
      snapshot: async () => ({
        logs: await read(logDirectory),
        reports: await read(reportDirectory),
        keep: await readFile(path.join(home, '.pi-intercom/keep.txt'), 'utf8'),
        oldSessions: await read(path.join(home, '.pi/old-sessions')),
      }),
    };
  };
  return {
    home, sessions, ConfigStore, ConfigStoreFor: (root, storeOptions) => new ConfigStore(root, storeOptions),
    configPath, claimPath, scanConfig, sha256, renderClaim, board, claim, session, extra, hooks, seeded,
    git, gitOk, probeWorker, listen, removed,
    ports: () => ({ coordinator: 41001, workerOne: 41002, workerTwo: 41003 }),
    keep: () => { removed.length = 0; },
    dispose: async () => {
      for (const endpoint of endpoints) await endpoint.close().catch(() => {});
      for (const directory of removed) await rm(directory, { recursive: true, force: true }).catch(() => {});
    },
    track: endpoint => { endpoints.push(endpoint); return endpoint; },
  };
}

/**
 * A controllable mock of the one surface the adoption workflow may ask a question on: a yes/no decision.
 * Answers are keyed by a stable decision `kind`, never by call order, and every call records the full
 * prompt *string* the workflow constructed. That proves a question was built with the expected content
 * and that answers are routed by identity — it proves nothing about a terminal. Whether the two choices
 * are actually selectable, whether the safe one is preselected, and whether the whole question is painted
 * are the subject of `adoption-ui.test.mjs`, which drives the host's real dialog component and reads its
 * real rendered lines.
 *
 * Two structural guarantees, both issue #12 acceptance criteria, are enforced here rather than asserted
 * case by case:
 *
 * - there is **no `input` member at all**. A workflow that still asked for typed text would throw
 *   `ui.input is not a function` on the way past this mock, in every case, not only in a test that
 *   happens to look for it; and
 * - `confirm` returns a boolean or throws. An answer cannot be a string, so no case can smuggle a typed
 *   value through the yes/no seam, and an unreadable answer is expressed as a thrown named failure.
 *
 * Recognised answers: `'confirm'` (yes), `'decline'` (no, the default), a literal boolean, and
 * `{ throws: error }` for a surface that cannot render the question or cannot read the answer. A
 * dismissal needs no separate spelling: the real adapter reports one as a decline, which is a `false`.
 *
 * There are no free-form arguments: identity, ports, paths, confirmation and outcomes cannot be supplied
 * or overridden — the only inputs are which decision is answered and how.
 */
export function mockUi(answers = {}) {
  const prompts = [];
  // An unlabelled decision is a production regression, never a silent decline: fail loudly instead.
  const requireKind = kind => {
    if (typeof kind !== 'string' || kind === '') throw new Error('a decision prompt must carry a stable kind');
    return kind;
  };
  const ui = {
    confirm: async options => {
      const kind = requireKind(options.kind);
      prompts.push({ kind, prompt: options.prompt });
      const value = answers[kind] ?? 'decline';
      if (value && typeof value === 'object' && value.throws) throw value.throws;
      if (value === 'confirm') return true;
      if (value === 'decline') return false;
      if (typeof value === 'boolean') return value;
      throw new Error(`a yes/no decision answer must be 'confirm', 'decline', {throws} or a boolean; got ${JSON.stringify(value)}`);
    },
  };
  return { ui, prompts, ended: sessionId => ENDED_WORDING(sessionId) };
}

export function readinessProbe() {
  const state = { epoch: 0, open: true };
  return {
    state,
    close: () => { state.open = false; return ++state.epoch; },
    current: () => state.epoch,
    openNow: () => { state.open = true; return ++state.epoch; },
    closeAction: () => { state.open = false; return ++state.epoch; },
  };
}

/** A command context in the shape the fork accepts. Authority data still comes from the backend. */
export function commandContext(fixture, input) {
  return {
    cwd: input.cwd ?? fixture.home,
    mode: input.mode ?? 'tui',
    hasUI: input.hasUI ?? true,
    isProjectTrusted: () => input.trusted ?? true,
    isIdle: () => input.idle ?? true,
    sessionManager: {
      getSessionId: () => input.sessionId,
      getSessionFile: () => input.sessionFile,
      getSessionDir: () => input.sessionDir ?? fixture.sessions,
    },
    ui: input.ui,
    ...(input.waitForIdle === false ? {} : { waitForIdle: async () => { input.waitedIdle?.(); } }),
  };
}

/** Records what the workflow touched, so a proof can assert "zero worker requests, zero lifecycle calls". */
export function recorder() {
  const calls = { sends: [], lifecycle: [], probes: [] };
  return {
    calls,
    send: async (port, payload) => { calls.sends.push({ port, payload }); throw new Error('fixture board sends no worker message'); },
    lifecycle: name => { calls.lifecycle.push(name); },
  };
}
