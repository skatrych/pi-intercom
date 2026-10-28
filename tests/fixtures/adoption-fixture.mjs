// Test-only fixture kit for coordinator adoption (ADR 0025). NOT a supported operation and NOT shipped:
// nothing in src/ imports it. It builds a temporary projects-home directory with hand-written
// `.pi-intercom/config.json` shapes, an ephemeral loopback endpoint standing in for "this runtime's bound
// endpoint", and a mock Pi UI.
//
// Deliberately absent: Git. There is no repository, no session store, no claim file and no evidence
// record, because the reviewed design gives every one of them zero influence. A test that needs a
// hostile Git/claim environment creates it as an unrelated side effect, not as fixture infrastructure.

import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// Dynamic import needs a URL, not an absolute path: Windows drive letters are not URL schemes.
const dist = async name => import(pathToFileURL(path.join(ROOT, 'dist', name)).href);

export const IDS = { gone: 'gone-coordinator', fresh: 'fresh-orchestrator', workerOne: 'worker-one', workerTwo: 'worker-two', other: 'another-session' };
/** A role tree of the shape `pi-role` uses, so the canonical launch-role check has something real. */
export const ROLES = { directory: 'roles', orchestrator: 'orchestrator', developer: 'developer' };

const PENDING_JOB = { jobId: 'job-pending-1', state: 'awaiting_handoff', createdAt: '2026-10-16T09:00:00.000Z', updatedAt: '2026-10-16T09:00:01.000Z', deadlineAt: '2026-10-16T09:02:01.000Z' };
const UNCERTAIN_JOB = { jobId: 'job-uncertain-2', state: 'uncertain', createdAt: '2026-10-16T09:00:00.000Z', updatedAt: '2026-10-16T09:00:02.000Z', deadlineAt: '2026-10-16T09:02:02.000Z' };
export const CLOSE_JOBS = { pending: PENDING_JOB, uncertain: UNCERTAIN_JOB };

/** Hand-written shapes. None is produced by a supported writer, and several are deliberately irregular. */
export const configs = {
  /** Two workers, one pending close job; every collection an ordinary board carries. */
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
          "projectDirectory": "app",
          "role": "developer",
          "handoff": { "version": 1, "jobId": "job-done-3", "summary": "Completed earlier scope.", "updatedAt": "2026-10-16T08:00:00.000Z" }
        },
        {
          "sessionId": "${IDS.workerTwo}",
          "name": "Reviewer",
          "coordinator": false,
          "description": "Review assigned work.",
          "port": ${ports.workerTwo},
          "projectDirectory": "app/web",
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
  /** An unknown top-level field and unknown entry fields, in ordinary formatting. */
  unknownField: ports => `{
      "version": 1,
      "multiplexer": "herdr",
      "writtenBy": "a newer tool",
      "futureRoot": { "nested": [1, 2.5, true, null], "kept": "verbatim" },
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
          "unknownEntry": 7,
          "jobs": [{ "id": "j1", "extra": "kept" }, { "id": "j2" }]
        }
      ]
    }
    `.replace(/^ {4}/gm, ''),
  /** Escaped keys and a literal own `__proto__` member. */
  escaped: ports => `{
      "version": 1,
      "multiplexer": "herdr",
      "agents": [
        {"sessionId": "${IDS.gone}", "name": "Coordinator", "coordinator": true,
         "description": "Coordinate \\u00e9 workers.", "port": ${ports.coordinator}, "projectDirectory": ".",
         "__proto__": { "polluted": false }, "line\\u0020break": "escaped key"},
        {"sessionId": "${IDS.workerOne}", "name": "Builder", "coordinator": false, "description": "Build assigned work.",
         "port": ${ports.workerOne}, "projectDirectory": "app", "note": "\\ud83d\\ude80 kept"}
      ]
    }
    `.replace(/^ {4}/gm, ''),
  /** Ambiguous duplicate keys: refused by the strict reader, never last-one-wins. */
  duplicateKeys: ports => `{
      "version": 1,
      "version": 1,
      "multiplexer": "herdr",
      "agents": [
        {"sessionId": "${IDS.gone}", "name": "Coordinator", "coordinator": true, "description": "Coordinate workers.", "port": ${ports.coordinator}, "projectDirectory": "."}
      ]
    }
    `.replace(/^ {4}/gm, ''),
  duplicateNested: ports => configs.full(ports).replace('"name": "Reviewer"', '"name": "Reviewer", "name": "Reviewer"'),
  duplicateEscaped: ports => configs.single(ports).replace('"description": "Coordinate workers."', '"description": "Coordinate workers.", "descript\\u0069on": "again"'),
  badVersion: ports => configs.full(ports).replace('"version": 1,', '"version": 2,'),
  badSchema: ports => configs.full(ports).replace('"multiplexer": "herdr"', '"multiplexer": "screen"'),
  traversal: ports => configs.full(ports).replace('"projectDirectory": "app/web"', '"projectDirectory": "../escape"'),
};

// No fallback: an unrecognised shape silently becomes a valid board and the case proves nothing.
export const configText = (style, ports) => {
  const shape = configs[style];
  if (!shape) throw new Error(`unknown config shape ${style}`);
  return shape(ports);
};

/** Ephemeral loopback ports only. Never an existing or live port. */
export async function bindEndpoint(sessionId, transport) {
  return transport.listen(0, async () => { throw new Error('fixture endpoint accepts no messages'); }, () => ({ version: 1, sessionId }));
}

export async function createFixture(options = {}) {
  const { ConfigStore, sha256, validateConfig } = await dist('config.js');
  // os.tmpdir() can contain an 8.3 alias on Windows (or a symlink on Unix). The positive fixture uses
  // the same canonical home as the production safety gates; an explicit home stays untouched.
  const home = options.home ?? await realpath(await mkdtemp(path.join(tmpdir(), 'intercom-adopt-')));
  const outside = await mkdtemp(path.join(tmpdir(), 'intercom-adopt-outside-'));
  const endpoints = [];
  await mkdir(path.join(home, 'app', 'web'), { recursive: true });
  await mkdir(path.join(home, 'roles', ROLES.orchestrator), { recursive: true });
  await mkdir(path.join(home, 'roles', ROLES.developer), { recursive: true });
  await writeFile(path.join(home, 'AGENTS.md'), '# Fixture projects home\n');

  const configPath = () => path.join(home, '.pi-intercom/config.json');
  const board = {
    write: async text => {
      await mkdir(path.join(home, '.pi-intercom'), { recursive: true });
      await writeFile(configPath(), text);
    },
    read: async () => readFile(configPath(), 'utf8'),
    readOrUndefined: async () => { try { return await board.read(); } catch { return undefined; } },
    parsed: async () => JSON.parse(await board.read()),
    invalid: async () => {
      try { validateConfig(JSON.parse(await board.read())); return undefined; }
      catch (error) { return String(error); }
    },
  };
  const extra = {
    /** Another `.pi-intercom` directory: board isolation, not a cleanup item. */
    boardAt: async relative => {
      const directory = path.join(home, relative);
      await mkdir(path.join(directory, '.pi-intercom'), { recursive: true });
      return directory;
    },
    boardOutside: async () => {
      await mkdir(path.join(outside, '.pi-intercom'), { recursive: true });
      await writeFile(path.join(outside, '.pi-intercom/config.json'), configText('single', { coordinator: 41001, workerOne: 41002, workerTwo: 41003 }));
      return outside;
    },
    link: async (target, linkName) => symlink(target, linkName, process.platform === 'win32' ? 'junction' : 'dir'),
  };
  /** Unrelated board-adjacent state that a replacement must never touch. */
  const seeded = async () => {
    const logDirectory = path.join(home, '.pi-intercom/logs'), reportDirectory = path.join(home, '.pi-intercom/reports');
    await mkdir(logDirectory, { recursive: true });
    await mkdir(reportDirectory, { recursive: true });
    await writeFile(path.join(logDirectory, 'writer-11111111-1111-4111-8111-111111111111.jsonl'), '{"version":1,"event":"runtime.ready"}\n');
    await writeFile(path.join(reportDirectory, 'a'.repeat(64) + '.json'), '{"version":1,"status":"blocked","summary":"seed"}\n');
    await writeFile(path.join(home, '.pi-intercom/keep.txt'), 'do not touch\n');
    await writeFile(path.join(home, 'coordinator-claim.md'), '# legacy claim that must be ignored\n');
    const read = async directory => Object.fromEntries(await Promise.all((await readdir(directory)).sort().map(async name => [name, await readFile(path.join(directory, name), 'utf8')])));
    return {
      logDirectory, reportDirectory,
      snapshot: async () => ({
        logs: await read(logDirectory),
        reports: await read(reportDirectory),
        keep: await readFile(path.join(home, '.pi-intercom/keep.txt'), 'utf8'),
        claim: await readFile(path.join(home, 'coordinator-claim.md'), 'utf8'),
      }),
    };
  };
  return {
    home, outside, ConfigStore, ConfigStoreFor: (root, storeOptions) => new ConfigStore(root, storeOptions),
    configPath, sha256, board, extra, seeded,
    ports: () => ({ coordinator: 41001, workerOne: 41002, workerTwo: 41003 }),
    dispose: async () => {
      for (const endpoint of endpoints) await endpoint.close().catch(() => {});
      await rm(home, { recursive: true, force: true }).catch(() => {});
      await rm(outside, { recursive: true, force: true }).catch(() => {});
    },
    track: endpoint => { endpoints.push(endpoint); return endpoint; },
  };
}

/**
 * A controllable mock of the one surface the adoption workflow may ask a question on: a yes/no decision.
 * Answers are keyed by a stable decision `kind`, never by call order, and every call records the full
 * prompt *string* the workflow constructed.
 *
 * There is **no `input` member at all**: a workflow that asked for typed text would fail here. `confirm`
 * returns a boolean or throws, so no answer can smuggle a typed value through the yes/no seam.
 *
 * Recognised answers: `'confirm'` (yes), `'decline'` (no, the default), a literal boolean, and
 * `{ throws: error }` for a surface that cannot render the question or read the answer. `onAsk` runs
 * after the prompt is recorded and before the answer is returned, which is how a test mutates the world
 * while a question is open.
 */
export function mockUi(answers = {}) {
  const prompts = [];
  const requireKind = kind => {
    if (typeof kind !== 'string' || kind === '') throw new Error('a decision prompt must carry a stable kind');
    return kind;
  };
  const ui = {
    confirm: async options => {
      const kind = requireKind(options.kind);
      prompts.push({ kind, prompt: options.prompt });
      await answers.onAsk?.(kind, options.prompt);
      const value = answers[kind] ?? 'decline';
      if (value && typeof value === 'object' && value.throws) throw value.throws;
      if (value === 'confirm') return true;
      if (value === 'decline') return false;
      if (typeof value === 'boolean') return value;
      throw new Error(`a yes/no decision answer must be 'confirm', 'decline', {throws} or a boolean; got ${JSON.stringify(value)}`);
    },
  };
  return { ui, prompts };
}

/** A command context in the shape the fork accepts. Authority data still comes from the backend. */
export function commandContext(fixture, input) {
  return {
    cwd: input.cwd ?? fixture.home,
    mode: input.mode ?? 'tui',
    hasUI: input.hasUI ?? true,
    isProjectTrusted: () => input.trusted ?? true,
    isIdle: () => input.idle ?? true,
    sessionManager: { getSessionId: () => input.sessionId },
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
