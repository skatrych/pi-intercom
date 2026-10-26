import { lstat, readFile, realpath } from 'node:fs/promises';
import { lstatSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  ConfigStore, ConfigPreviewChanged, coordinator, fail, sameCanonicalPath, sha256,
  type Config, type ConfigDocument,
} from './config.js';
import { ConfigLockContention, ConfigLockUnavailable, LegacyConfigLock } from './native-lock.js';
import type { WorkerConnection } from './connections.js';

/**
 * Coordinator adoption (ADR 0025): the board config's coordinator `sessionId` and `port` are the whole
 * authority, and this module is the only path that replaces them.
 *
 * A deterministic workflow, not a tool, command, CLI, or endpoint. Reachable only through
 * `Intercom.adoptCoordinator`, which the role-local `/intercom-adopt` command invokes with a supported Pi
 * command context. There are no identity, port, path, role, confirmation, or JSON parameters: every
 * authority value comes from this process's launch configuration, this runtime's actually bound endpoint,
 * the config read made inside the transaction, or an explicit yes answered in this session's own Pi UI.
 *
 * Exactly one human confirmation exists in this file, and only for replacing an existing board's
 * coordinator. First-board creation is ordinary runtime startup (see `Intercom.start`), never adoption,
 * and no branch here asks a second question, requests typed wording, or records an evidence artifact.
 * Git has no role anywhere: this module performs no Git call and reads no Git marker as authority. The
 * legacy `coordinator-claim.md` is ignored in every state — never read, classified, followed, recovered,
 * rewritten, or deleted.
 */

export const PROJECTS_HOME_ENV = 'PI_INTERCOM_PROJECTS_HOME';
export const DEFAULT_PROJECTS_HOME = 'workspaces/projects';
export const ORCHESTRATOR_ROLE = 'orchestrator';
export const CONFIG_DIRECTORY = '.pi-intercom';
/** Ignored legacy artifact. Named once so "ignored" is verifiable; nothing here ever reads it. */
export const LEGACY_CLAIM_FILE = 'coordinator-claim.md';

/**
 * A selection surface that returned something which is neither an offered choice nor a dismissal is a
 * capture failure, never an answer. The adapter reports it instead of guessing, so an unreadable
 * decision can never be read as a yes — or as a no.
 */
export class AdoptionDecisionCaptureFailure extends Error {
  constructor(message: string) { super(message); this.name = 'AdoptionDecisionCaptureFailure'; }
}
/** The captured Pi UI cannot render a visible selection dialog. Fail closed; never open a text input. */
export class AdoptionHostUiUnavailable extends Error {
  constructor(message: string) { super(message); this.name = 'AdoptionHostUiUnavailable'; }
}

export const DISCONNECTED_WARNING = 'A disconnected or unknown endpoint probe is not evidence that a coordinator terminated.';

export type ExitCode = 0 | 1 | 2;
export type ResultCode =
  | 'OK' | 'CURRENT'
  | 'AUTH' | 'MODE' | 'TRUST' | 'SESSION_CHANGED' | 'BUSY'
  | 'BOARD_COUNT' | 'BOARD_PATH' | 'NO_BOARD'
  | 'CONFIG' | 'IDENTITY' | 'SESSION_COLLISION' | 'PORT_COLLISION'
  | 'OLD_CONNECTED' | 'CONFIRMATION' | 'CANCELLED' | 'STALE_PREVIEW'
  | 'LOCKED' | 'LOCK_LEGACY' | 'LOCK_UNAVAILABLE'
  | 'PUBLISH' | 'NOT_AUTHORIZED' | 'PROMOTION_PENDING'
  | 'BACKEND' | 'HOST' | 'USAGE';
export interface Result { ok: boolean; code: ResultCode; exitCode: ExitCode; lines: string[] }

/** Result contract: success 0, safety stop 1, unavailable backend/host/usage 2. */
const UNAVAILABLE: ResultCode[] = ['BACKEND', 'HOST', 'USAGE'];
export function succeed(code: ResultCode, lines: string[]): Result { return { ok: true, code, exitCode: 0, lines }; }
export function stop(code: ResultCode, lines: string[]): Result {
  return { ok: false, code, exitCode: UNAVAILABLE.includes(code) ? 2 : 1, lines };
}
/** Exactly one terminal summary line per result. Status lines are prefixed by the caller. */
function halt(code: ResultCode, evidence: string): Result { return stop(code, [`ADOPTION STOP ${code}: ${evidence}`]); }

// ---- inputs ---------------------------------------------------------------------------

export interface CommandContext {
  cwd: string;
  mode: string;
  /** Captured native session only. There is no session-file, header, or session-store proof anywhere. */
  sessionManager: { getSessionId(): string };
  hasUI: boolean;
  isProjectTrusted(): boolean;
  isIdle(): boolean;
  /**
   * The one human surface this flow has: a selection-style dialog offering exactly two answers. There is
   * no text-input member, deliberately — issue #12 removed every typed gate, and a workflow that cannot
   * ask a yes/no on a selection surface stops instead of falling back to a text field.
   *
   * Every decision carries a stable `kind`, so an operator, a test, and the audit trail can tell which
   * question was answered, declined, or left unanswered. Prompt text is for humans and changes.
   */
  ui: {
    confirm(options: { kind: string; prompt: string }): Promise<boolean>;
  };
  waitForIdle?(): Promise<void>;
}
/** Fault-injection and phase-barrier seam names for executable fixtures only. Never a request parameter. */
export type AdoptionPhase = 'after-preview' | 'before-question' | 'after-answer' | 'before-publish' | 'after-publish' | 'before-promotion';
export interface AdoptionOptions {
  /** Canonical launch role directory captured from this process at startup. Never request-supplied. */
  roleDirectory?: string;
  rolesDirectory?: string;
  projectsHome?: string;
  workerRole?: string;
  storeFor(root: string): ConfigStore;
  /** This runtime's native session id. Throws when the session or lifecycle was replaced. */
  sessionId(): string;
  busy(): boolean;
  /** The port this runtime's endpoint actually bound. Never a guessed or supplied port. */
  endpointPort(): number | undefined;
  /** Bounded loopback health identity. Read-only; never evidence of process termination. */
  probe(agent: { sessionId: string; port: number }, options?: { timeoutMs?: number }): Promise<WorkerConnection>;
  /** Load this running session's own responsibility. Write-free, no restart, no recover, no send. */
  promote(): Promise<string | undefined>;
  responsibilityLoaded(): boolean;
  phase?(phase: AdoptionPhase): Promise<void>;
}
/** The captured runtime identity: native session id plus the port its endpoint actually bound. */
export interface AdoptionIdentity { sessionId: string; port: number }
export type BootState = 'a' | 'b' | 'c' | 'd';
interface Survey {
  home: string;
  cwd: string;
  boardRoot?: string;
  boards: string[];
  state: BootState;
  document?: ConfigDocument;
  identity: AdoptionIdentity;
  lines: string[];
  paths?: Map<string, string>;
}

/** Absolute projects home from runtime configuration. Never a user-supplied board to overwrite. */
export function projectsHome(options: { projectsHome?: string; homeDirectory?: string }): string {
  const configured = options.projectsHome ?? (options.homeDirectory ? path.join(options.homeDirectory, DEFAULT_PROJECTS_HOME) : undefined);
  if (!bounded(configured, 4096)) fail('the projects home is not configured');
  const absolute = path.resolve(configured);
  if (path.resolve(absolute) !== absolute) fail('projects home path is unsafe');
  return absolute;
}
function contains(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}
function bounded(value: unknown, max: number): value is string {
  return typeof value === 'string' && !!value.trim() && value.length <= max && !value.includes('\0');
}
/**
 * Count `.pi-intercom` directories along cwd -> projects home inclusive, before discovery could choose
 * one. Directories are counted, not readable configs: an empty or malformed extra board still stops.
 * This is board isolation, not traceability, and it stays required at startup and in every command.
 */
export async function countBoards(cwd: string, home: string): Promise<string[]> {
  const boards: string[] = [];
  let at = cwd;
  for (;;) {
    try {
      const info = await lstat(path.join(at, CONFIG_DIRECTORY));
      if (info.isSymbolicLink() || !info.isDirectory()) failAt('BOARD_PATH', `unsafe board directory at ${path.join(at, CONFIG_DIRECTORY)}; a human may remove a confirmed empty, unintended stray directory and retry, and populated or malformed board data needs separate inspection, never recursive deletion`);
      boards.push(at);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (at === home || !contains(home, at)) break;
    const parent = path.dirname(at);
    if (parent === at) break;
    at = parent;
  }
  return boards;
}

// ---- workflow -------------------------------------------------------------------------

export class AdoptionWorkflow {
  private request?: Promise<Result>;
  constructor(private readonly options: AdoptionOptions) {}

  /** One request in flight. A second concurrent request never interleaves with a transaction. */
  async run(context: CommandContext, verb: string, args: string[] = []): Promise<Result> {
    if (args.length) return halt('USAGE', 'adoption accepts no arguments: identity, ports, paths and confirmations are never command arguments');
    if (verb !== 'status' && verb !== 'adopt') return halt('USAGE', `unknown verb ${verb}; only status and the interactive workflow exist`);
    if (this.request) return halt('BUSY', 'another adoption request is in flight; no concurrent transaction is attempted');
    const current = (verb === 'status' ? this.status(context) : this.adopt(context))
      .catch(error => halt(codeFor(error), reason(error)))
      .finally(() => { if (this.request === current) this.request = undefined; });
    this.request = current;
    return current;
  }

  /**
   * Read-only board count, boot state, captured identity and the configured pair, plus whether this
   * session's local responsibility is loaded. It never promotes, asks, writes, or repairs.
   */
  async status(context: CommandContext): Promise<Result> {
    const refused = await this.authorize(context, { idle: false });
    if (refused) return refused;
    const surveyed = await this.survey(context);
    if ('stop' in surveyed) return surveyed.stop;
    return succeed('OK', this.report(surveyed));
  }
  /** Read-only preview plus the single interactive replacement decision. */
  async adopt(context: CommandContext): Promise<Result> {
    const refused = await this.authorize(context, { idle: true });
    if (refused) return refused;
    const surveyed = await this.survey(context);
    if ('stop' in surveyed) return surveyed.stop;
    const decided = await this.decide(context, surveyed);
    return { ...decided, lines: [...this.report(surveyed).filter(line => !line.startsWith('STATUS OK:')), ...decided.lines] };
  }

  private report(surveyed: Survey): string[] {
    const lines = [...surveyed.lines];
    if (surveyed.document) {
      const board = coordinator(surveyed.document.config);
      lines.push(`COORDINATOR: ${board.sessionId}/${board.port} — the configured board entry is the whole coordinator authority`);
      lines.push(`CONFIG: ${surveyed.document.raw.length} bytes, SHA256 ${sha256(surveyed.document.raw)} — strict read, duplicate keys refused`);
    }
    lines.push(`RESPONSIBILITY: ${this.options.responsibilityLoaded() ? 'loaded for this session' : 'not loaded'}`);
    lines.push(`LEGACY ${LEGACY_CLAIM_FILE}: ignored in every state; nothing was read, classified, or changed`);
    lines.push(`STATUS OK: ${surveyed.state} — ${this.disposition(surveyed)}`);
    return lines;
  }
  private disposition(surveyed: Survey): string {
    if (surveyed.state === 'a') return 'no board: startup at the projects home creates it without adoption; this command only restarts nothing, so restart Pi for ordinary first-board initialization';
    if (surveyed.state === 'c') return 'stop: this session is a registered worker and is never promoted, removed, or rebound';
    if (surveyed.state === 'd') return 'adoption required: one native yes/no replaces the configured coordinator pair';
    const board = surveyed.document && coordinator(surveyed.document.config);
    if (board && board.port !== surveyed.identity.port) return 'same session id with a different port: startup recovery only; this command never repairs a port';
    return this.options.responsibilityLoaded() ? 'this session is the configured coordinator pair; load-only, no question and no write' : 'this session is the configured coordinator pair; responsibility loads without a question or write';
  }

  /** Role, mode, trust, session identity, idle host. Each is a separate named refusal. */
  private async authorize(context: CommandContext, requirements: { idle: boolean }): Promise<Result | undefined> {
    const launch = this.launchRole();
    if (!launch.authorized) return halt('AUTH', `${launch.detail}; this workflow is available only to the canonical Orchestrator launch role`);
    if (context.mode !== 'tui') return halt('MODE', `a human decision requires the interactive Pi UI, not mode ${context.mode}`);
    if (!context.hasUI || !context.ui?.confirm) return halt('MODE', 'no selection-capable Pi UI is available to capture a human decision');
    if (!context.isProjectTrusted()) return halt('TRUST', 'project trust is required before honoring shared board configuration');
    if (context.sessionManager.getSessionId() !== this.options.sessionId()) return halt('SESSION_CHANGED', 'the command context session is not this runtime session');
    if (requirements.idle) {
      try { await context.waitForIdle?.(); } catch { return halt('BUSY', 'waiting for the host to settle failed; no takeover was attempted'); }
      if (!context.isIdle() || this.options.busy()) return halt('BUSY', 'this Pi host is still busy; adoption waits instead of steering');
    }
    return undefined;
  }
  /** The launch role is read from captured process configuration, never from the request or a model. */
  private launchRole(): { authorized: boolean; detail: string } {
    const configured = this.options.roleDirectory, roles = this.options.rolesDirectory;
    if (!bounded(configured, 4096) || !bounded(roles, 4096)) return { authorized: false, detail: 'no canonical role launch directory is recorded for this process' };
    const canonical = path.resolve(roles, ORCHESTRATOR_ROLE);
    if (this.options.workerRole && this.options.workerRole !== ORCHESTRATOR_ROLE) return { authorized: false, detail: 'contradictory worker-role launch metadata' };
    try {
      if (realpathSync(roles) !== path.resolve(roles) || realpathSync(configured) !== path.resolve(configured) || !lstatSync(configured).isDirectory() || lstatSync(configured).isSymbolicLink()) return { authorized: false, detail: 'unsafe canonical launch-role path' };
    } catch { return { authorized: false, detail: 'launch-role directory is unavailable' }; }
    if (path.resolve(configured) !== canonical) return { authorized: false, detail: `this process was launched as role ${path.basename(path.resolve(configured)) || 'unknown'}` };
    return { authorized: true, detail: 'authorized' };
  }

  // ---- read-only survey --------------------------------------------------------------

  private async survey(context: CommandContext): Promise<Survey | { stop: Result }> {
    let home: string;
    try { home = projectsHome({ projectsHome: this.options.projectsHome ?? process.env[PROJECTS_HOME_ENV], homeDirectory: homedir() }); }
    catch { return { stop: halt('BOARD_PATH', 'the projects home is not resolvable from this process configuration') }; }
    const cwd = await this.canonical(context.cwd), canonicalHome = await this.canonical(home);
    if (cwd === undefined || canonicalHome === undefined) return { stop: halt('BOARD_PATH', 'cwd or projects home cannot be canonicalised; nothing was read') };
    if (!contains(canonicalHome, cwd)) return { stop: halt('BOARD_PATH', `cwd ${cwd} is outside projects home ${canonicalHome}; no board is read or written`) };
    if (!sameCanonicalPath(context.cwd, cwd) || !sameCanonicalPath(home, canonicalHome)) return { stop: halt('BOARD_PATH', 'cwd or projects home is a symlink/alias; use its canonical path') };
    const boards = await countBoards(cwd, canonicalHome);
    const identity = this.identity();
    if ('stop' in identity) return identity;
    const surveyed: Survey = {
      home: canonicalHome, cwd, boards, state: 'a', identity,
      lines: [`IDENTITY: session ${identity.sessionId} port ${identity.port} — captured from this native session and verified at this runtime's bound endpoint`],
    };
    if (boards.length === 0) {
      surveyed.lines.unshift(`BOARD COUNT NONE: no board between ${cwd} and ${canonicalHome} — state (a)`);
      surveyed.lines.push('BOOT STATE: a — no board found; first-board initialization is ordinary runtime startup at the projects home, with no command, question, or claim');
      if (cwd !== canonicalHome) {
        return { stop: halt('NO_BOARD', `no board exists between ${cwd} and ${canonicalHome}; a private board is never created in a child directory; the first board is created only by startup at the projects home ${canonicalHome}`) };
      }
      return { stop: halt('NO_BOARD', `no board exists at ${canonicalHome}; this command never creates one, because first-board initialization already happened (or will happen) at startup. Restart Pi to initialize the board, or inspect the board path if startup reported a failure`) };
    }
    if (boards.length > 1) {
      const named = boards.map(board => path.join(board, CONFIG_DIRECTORY));
      return { stop: halt('BOARD_COUNT', `a second board at ${named[1]} is a creation-time failure, not a cleanup item; the expected root is ${path.join(canonicalHome, CONFIG_DIRECTORY)} and the boards found are ${displayPaths(named)}; a human may remove a confirmed empty, unintended stray directory and retry, and populated or malformed board data needs separate inspection, never recursive deletion`) };
    }
    // Exactly one board that is not the projects home stops here, for `status` as well as for the
    // workflow: a lone child board is a wrong board for this command, not a licence to keep looking.
    if (boards[0] !== canonicalHome) {
      return { stop: halt('BOARD_COUNT', `the only board is at ${path.join(boards[0], CONFIG_DIRECTORY)}, not the projects home ${path.join(canonicalHome, CONFIG_DIRECTORY)}; stop with no writes rather than treat a child project's board as this one; a human may remove a confirmed empty, unintended stray directory and retry`) };
    }
    let document: ConfigDocument;
    try { document = await coded('CONFIG', () => this.options.storeFor(boards[0]).readDocument()); }
    catch (error) { return { stop: halt('CONFIG', `the board config is unreadable or invalid: ${reason(error)}; a malformed board is never repaired or normalized implicitly`) }; }
    surveyed.boardRoot = boards[0];
    surveyed.document = document;
    const board = coordinator(document.config);
    const own = document.config.agents.find(agent => agent.sessionId === identity.sessionId);
    surveyed.lines.unshift(`BOARD COUNT PASS: exactly one — ${path.join(canonicalHome, CONFIG_DIRECTORY)} (projects home); acceptable`);
    surveyed.state = own?.coordinator ? 'b' : own ? 'c' : 'd';
    surveyed.lines.push(`BOOT STATE: ${surveyed.state} — ${bootDescription(surveyed.state, board, own)}`);
    try { surveyed.paths = await this.pathSnapshot(surveyed); }
    catch (error) { return { stop: halt('BOARD_PATH', reason(error)) }; }
    return surveyed;
  }
  /**
   * The adopting endpoint must verify this native session before any question and again under the lock
   * before any write. A refusal after the config was already replaced is not an admissible outcome.
   */
  private async assertOwnEndpoint(identity: AdoptionIdentity): Promise<void> {
    const own = await this.options.probe({ sessionId: identity.sessionId, port: identity.port }, { timeoutMs: 2000 });
    if (own.state !== 'connected') {
      failAt('IDENTITY', `this endpoint port ${identity.port} did not verify session ${identity.sessionId} (${own.reason}); a port is never guessed or supplied, and the board was not changed. Restart Pi and retry`);
    }
  }
  /** Native session id from this runtime and the port its endpoint actually bound. Never a history search. */
  private identity(): AdoptionIdentity | { stop: Result } {
    const port = this.options.endpointPort();
    const sessionId = this.options.sessionId();
    if (port === undefined) return { stop: halt('IDENTITY', 'this runtime has no bound endpoint; a port is never guessed') };
    if (!bounded(sessionId, 256)) return { stop: halt('SESSION_CHANGED', 'this runtime session identity is unavailable') };
    return { sessionId, port };
  }
  /** Snapshot actual ancestor directories, not a descendant tree scan. */
  private async pathSnapshot(surveyed: Survey): Promise<Map<string, string>> {
    const paths = new Map<string, string>();
    let at = surveyed.cwd;
    for (;;) {
      const info = await lstat(at);
      if (!info.isDirectory() || info.isSymbolicLink() || !sameCanonicalPath(await realpath(at), at)) failAt('BOARD_PATH', `unsafe directory ${at}`);
      paths.set(at, `${info.dev}:${info.ino}`);
      const board = path.join(at, CONFIG_DIRECTORY);
      try {
        const info = await lstat(board);
        if (!info.isDirectory() || info.isSymbolicLink()) failAt('BOARD_PATH', `unsafe board ${board}; a confirmed empty, unintended stray may be removed by a human, and populated or malformed data needs separate inspection`);
        paths.set(board, `${info.dev}:${info.ino}`);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (at === surveyed.home) break;
      at = path.dirname(at);
    }
    const configFile = path.join(surveyed.home, CONFIG_DIRECTORY, 'config.json');
    try { if (!(await lstat(configFile)).isFile()) failAt('BOARD_PATH', `unsafe file ${configFile}`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    // The guard is inspected only for path safety here. A legacy directory lock is left for the store's
    // named upgrade refusal, so the operator sees the precise remediation instead of a generic path error.
    const guard = path.join(surveyed.home, CONFIG_DIRECTORY, 'config.lock');
    try {
      const info = await lstat(guard);
      if (info.isSymbolicLink()) failAt('BOARD_PATH', `unsafe file ${guard}`);
      if (!info.isFile() && !info.isDirectory()) failAt('BOARD_PATH', `unsafe file ${guard}`);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return paths;
  }
  /** Synchronous final guard, also run on every platform rename retry. */
  private assertPaths(surveyed: Survey): void {
    try {
      for (const [file, identity] of surveyed.paths ?? []) {
        const info = lstatSync(file);
        if (!info.isDirectory() || info.isSymbolicLink() || !sameCanonicalPath(realpathSync(file), file) || `${info.dev}:${info.ino}` !== identity) failAt('STALE_PREVIEW', `directory identity changed: ${file}`);
      }
      let at = surveyed.cwd;
      for (;;) {
        const board = path.join(at, CONFIG_DIRECTORY);
        try {
          const info = lstatSync(board);
          if (!info.isDirectory() || info.isSymbolicLink() || (!surveyed.paths?.has(board) && !!surveyed.document)) failAt('STALE_PREVIEW', `board directory appeared or changed: ${board}`);
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        if (at === surveyed.home) break;
        at = path.dirname(at);
      }
      for (const file of [path.join(surveyed.home, CONFIG_DIRECTORY, 'config.json')]) {
        try { if (!lstatSync(file).isFile()) failAt('STALE_PREVIEW', `unsafe file ${file}`); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
    } catch (error) { if (error instanceof AdoptionFailure) throw error; failAt('STALE_PREVIEW', `board paths changed: ${reason(error)}`); }
  }
  /** The session and lifecycle that were displayed must still be this runtime's own. */
  private assertCurrent(context: CommandContext): void {
    if (context.sessionManager.getSessionId() !== this.options.sessionId()) failAt('SESSION_CHANGED', 'the session was replaced during the decision');
  }
  /**
   * Revalidate the whole immutable preview under the same all-writer lock: same ancestor board layout,
   * same raw config bytes, same captured identity. Only real drift invalidates a displayed answer; a Git
   * change, a legacy claim change, or any other repository state cannot reach this comparison at all.
   */
  private async assertSnapshot(context: CommandContext, surveyed: Survey): Promise<void> {
    this.assertCurrent(context);
    this.assertPaths(surveyed);
    const boards = await countBoards(surveyed.cwd, surveyed.home);
    if (JSON.stringify(boards) !== JSON.stringify(surveyed.boards)) failAt('STALE_PREVIEW', 'the ancestor board layout changed while the decision was open');
    const raw = await this.readOptional(path.join(surveyed.home, CONFIG_DIRECTORY, 'config.json'));
    if (raw !== surveyed.document?.raw) failAt('STALE_PREVIEW', 'config bytes changed while the decision was open; a new preview and a new decision are required');
    const identity = this.identity();
    if ('stop' in identity) failAt(identity.stop.code, reasonOf(identity.stop));
    if (identity.sessionId !== surveyed.identity.sessionId || identity.port !== surveyed.identity.port) failAt('SESSION_CHANGED', 'this runtime session or bound endpoint changed during the decision');
    await this.assertOwnEndpoint(identity);
    this.assertCurrent(context);
    this.assertPaths(surveyed);
  }
  private async canonical(target: string): Promise<string | undefined> {
    try { return await realpath(target); } catch { return undefined; }
  }
  private async readOptional(file: string): Promise<string | undefined> {
    try { return await readFile(file, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  }

  // ---- decisions ---------------------------------------------------------------------

  private async decide(context: CommandContext, surveyed: Survey): Promise<Result> {
    if (surveyed.state === 'a') return halt('NO_BOARD', 'no board exists; this command never creates one, because first-board initialization is ordinary runtime startup at the projects home. Restart Pi');
    const board = coordinator(surveyed.document!.config);
    if (surveyed.state === 'c') {
      const worker = surveyed.document!.config.agents.find(agent => agent.sessionId === surveyed.identity.sessionId);
      return halt('SESSION_COLLISION', `session ${surveyed.identity.sessionId} is already registered as worker ${worker?.name ?? 'unknown'}; adoption requires a genuinely fresh session id, and no promotion, removal or rebind is offered`);
    }
    const collision = surveyed.document!.config.agents.find(agent => agent.sessionId === surveyed.identity.sessionId);
    if (collision !== undefined && collision.coordinator && collision.port === surveyed.identity.port) {
      // Already this exact pair: config already authorizes it. No question, no declaration, no write.
      return this.loadOnly(surveyed, board);
    }
    if (collision !== undefined) {
      const pair = (entry: { sessionId: string; port: number }) => `${entry.sessionId}/${entry.port}`;
      return halt(collision.coordinator ? 'IDENTITY' : 'SESSION_COLLISION', collision.coordinator
        ? `the board names ${pair(collision)} as coordinator, but this runtime verifies ${pair(surveyed.identity)}; a command never repairs a port, because only the guarded startup recovery may publish a fallback port. Restart this session on a non-conflicting port, or free the saved port and restart`
        : `session ${surveyed.identity.sessionId} is already registered as ${collision.name}; a registered worker is never promoted, removed, or rebound by adoption`);
    }
    const portCollision = surveyed.document!.config.agents.find(agent => agent.port === surveyed.identity.port);
    if (portCollision !== undefined) {
      return halt('PORT_COLLISION', `port ${surveyed.identity.port} is already used by the configured entry ${portCollision.name} (${portCollision.sessionId}); a port is never guessed and a collision is refused before any write, including against the current coordinator entry. Binding a port is not authority to remove or rebind that entry: restart this session on a free port, or use a fresh session id`);
    }
    const refused = await this.humanAdoptionDecision(context, surveyed, board);
    if ('stop' in refused) return refused.stop;
    return this.transaction(context, surveyed, board);
  }
  /** The already-current pair needs no question and no write: only a write-free responsibility load. */
  private async loadOnly(surveyed: Survey, board: { sessionId: string; port: number }): Promise<Result> {
    if (this.options.responsibilityLoaded()) {
      return succeed('CURRENT', [`ALREADY CURRENT: coordinator ${board.sessionId}/${board.port} is this session; responsibility is already loaded; no question was asked and nothing was written`]);
    }
    const failure = await this.phaseThen('before-promotion', () => this.options.promote());
    if (failure !== undefined) return halt('PROMOTION_PENDING', `${failure}; no config write and no question is permitted to complete a load-only attempt`);
    const current = await this.options.storeFor(surveyed.home).read();
    const now = coordinator(current);
    if (now.sessionId !== surveyed.identity.sessionId || now.port !== surveyed.identity.port) return halt('NOT_AUTHORIZED', `the board no longer names this session pair (${now.sessionId}/${now.port}); responsibility was not adopted from a different entry`);
    return succeed('CURRENT', [`ALREADY CURRENT: coordinator ${board.sessionId}/${board.port} is this session; responsibility loaded in place with no worker action, no reload, and no config write`]);
  }

  // ---- the single human decision ------------------------------------------------------

  /**
   * Collisions and the old-endpoint probe all refuse before any dialog opens, in this order. Then the
   * human answers exactly once, on the native selection surface. Identity and target are backend-selected:
   * no parameter, argument, saved default, or model text can supply them. There is no preliminary
   * "continue?" question, no typed authority record, no exact-wording paste, no ended attestation to
   * transcribe, no renewal, and no saved answer. A yes authorizes the replacement only.
   */
  private async humanAdoptionDecision(context: CommandContext, surveyed: Survey, board: { sessionId: string; port: number }): Promise<{ confirmed: true } | { stop: Result }> {
    const identity = surveyed.identity;
    // Own identity first: an unverifiable adopting endpoint refuses before the question and before any
    // old-endpoint probe, so a yes can never lead to a replacement that cannot be promoted.
    try { await this.assertOwnEndpoint(identity); }
    catch (error) { return { stop: halt(codeFor(error), reason(error)) }; }
    if (this.options.busy()) return { stop: halt('BUSY', 'this Pi host became busy while verifying the adopting endpoint; nothing was asked or written') };
    const probe = await this.options.probe({ sessionId: board.sessionId, port: board.port });
    if (probe.state === 'connected') {
      return { stop: halt('OLD_CONNECTED', `configured coordinator ${board.sessionId} port ${board.port} still verifies at its endpoint; adoption stops and no config was written`) };
    }
    this.assertCurrent(context);
    await this.phaseThen('before-question', async () => undefined);
    const confirmed = await this.confirmGate(context, {
      kind: 'adoptCoordinator',
      prompt: adoptionDecisionPrompt({ home: surveyed.home, identity, board, previewRaw: surveyed.document!.raw, probe, config: surveyed.document!.config }),
    }, 'adoption decision');
    if ('stop' in confirmed) return { stop: confirmed.stop };
    if (!confirmed.value) {
      return { stop: halt('CANCELLED', `adoption at ${surveyed.home}: configured coordinator ${board.sessionId}/${board.port} stays authoritative, this session is ${identity.sessionId}/${identity.port}; declined, nothing was written, no coordinator action is authorized, and a fresh invocation is required for a new decision`) };
    }
    this.assertCurrent(context);
    return { confirmed: true };
  }
  /**
   * One yes/no decision, with one named failure mapping for every step. A refusal from the surface
   * itself is never silently read as "No": an unavailable selection surface is a named `HOST` stop, and
   * an answer that is neither offered choice nor a dismissal is a named `CONFIRMATION` stop. Declining
   * is a decision; an unreadable one is not, and neither is ever a yes.
   */
  private async confirmGate(context: CommandContext, options: { kind: string; prompt: string }, step: string): Promise<{ value: boolean } | { stop: Result }> {
    try {
      return { value: await context.ui.confirm(options) === true };
    } catch (error) {
      if (error instanceof AdoptionDecisionCaptureFailure) {
        return { stop: halt('CONFIRMATION', `${step}: the decision could not be read from this session's Pi UI (${reason(error)}). Nothing was written, and an unreadable answer is treated as neither a yes nor a No; invoke again for a fresh decision.`) };
      }
      if (error instanceof AdoptionHostUiUnavailable) return { stop: halt('HOST', `${step} cannot be displayed by this Pi UI: ${reason(error)}; no text input was opened in its place.`) };
      throw error;
    }
  }

  // ---- the transaction -----------------------------------------------------------------

  /**
   * The only replacement. Under one crash-released all-writer transaction: re-probe, revalidate the exact
   * preview, publish the two-value change atomically, then load this running session's responsibility in
   * place. Any failure is phase-specific and is never reported as success, rolled back, or retried.
   */
  private async transaction(context: CommandContext, surveyed: Survey, board: { sessionId: string; port: number }): Promise<Result> {
    const identity = surveyed.identity, home = surveyed.home, preview = surveyed.document!;
    const previewRawSha256 = sha256(preview.raw);
    const store = this.options.storeFor(home);
    const expected = expectedReplacement(preview.config, identity);
    try {
      const published = await store.transaction<{ stop: Result } | { after: string }>(async () => {
        await this.assertSnapshot(context, surveyed);
        const reentered = await this.options.probe({ sessionId: board.sessionId, port: board.port });
        if (reentered.state === 'connected') return { stop: halt('OLD_CONNECTED', `configured coordinator ${board.sessionId} port ${board.port} verified connected inside the transaction; nothing was written`) };
        // The probe yields: recheck the exact preview, identity and paths after that await.
        await this.assertSnapshot(context, surveyed);
        await this.phaseThen('after-answer', async () => undefined);
        await this.phaseThen('before-publish', async () => undefined);
        // Final pre-write identity proof, after every await and immediately before the replacement.
        await this.assertOwnEndpoint(identity);
        await this.assertSnapshot(context, surveyed);
        const result = await coded('PUBLISH', () => store.replaceCoordinatorEntry({
          sessionId: identity.sessionId,
          port: identity.port,
          previewRawSha256,
          assertPreview: config => {
            const current = coordinator(config);
            if (current.sessionId !== board.sessionId || current.port !== board.port) failAt('STALE_PREVIEW', 'the coordinator entry changed after the preview; a new preview and a new human decision are required');
            if (config.agents.length !== preview.config.agents.length) failAt('STALE_PREVIEW', 'the roster changed after the preview; an old preview is never merged into a new roster');
            if (config.agents.some(agent => agent.sessionId === identity.sessionId)) failAt('SESSION_COLLISION', 'the adopting session became a configured entry during the preview');
            if (config.agents.some(agent => agent.port === identity.port && agent.sessionId !== identity.sessionId)) failAt('PORT_COLLISION', 'the adopting port became a configured entry during the preview');
            this.assertCurrent(context);
          },
          assertValid: () => { this.assertCurrent(context); this.assertPaths(surveyed); },
        }));
        if (sha256(result.after) !== sha256(expected)) {
          return { stop: halt('PUBLISH', 'the published config does not match the reviewed two-value replacement; the transaction stops and no local promotion is claimed') };
        }
        await this.phaseThen('after-publish', async () => undefined);
        return { after: result.after };
      });
      if ('stop' in published) return published.stop;
      const reverified = await this.reverify(context, identity);
      if (reverified !== undefined) return reverified;
      const failure = await this.phaseThen('before-promotion', () => this.options.promote());
      if (failure !== undefined) {
        return halt('PROMOTION_PENDING', `config replaced: coordinator ${board.sessionId}/${board.port} → ${identity.sessionId}/${identity.port}, but local responsibility did not load: ${failure}; this is replacement success with local promotion pending. A matching invocation loads only, with zero questions and zero config writes; no rollback and no automatic retry is performed`);
      }
      const current = await store.read();
      const now = coordinator(current);
      if (now.sessionId !== identity.sessionId || now.port !== identity.port) {
        return halt('NOT_AUTHORIZED', `the board now names ${now.sessionId}/${now.port}, not this session ${identity.sessionId}/${identity.port}; the replacement is not reported as complete and no further coordinator effect is authorized from this invocation`);
      }
      return succeed('OK', [`ADOPTION OK: coordinator ${board.sessionId}/${board.port} → ${identity.sessionId}/${identity.port}; only those two parsed values changed; every other parsed value, roster order and close job was preserved; no worker was contacted, nothing was reloaded, and no model turn started`]);
    } catch (error) {
      // A failed publication is never reported as adoption success, and a partial/interrupted transaction
      // is never rolled back or replayed. A later invocation reads the current board: the old pair needs a
      // fresh decision, a matching pair loads only, and a different pair needs a new preview.
      return halt(codeFor(error), `adoption stopped: ${reason(error)}; the current board remains authoritative and no automatic retry is performed`);
    }
  }
  /** Fresh identity at the last moment before this session claims local readiness. */
  private async reverify(context: CommandContext, identity: AdoptionIdentity): Promise<Result | undefined> {
    try { this.assertCurrent(context); } catch { return halt('SESSION_CHANGED', 'session, endpoint or lifecycle changed during the transaction'); }
    const own = await this.options.probe({ sessionId: identity.sessionId, port: identity.port }, { timeoutMs: 2000 });
    if (own.state !== 'connected') return halt('IDENTITY', `this endpoint no longer verifies session ${identity.sessionId} port ${identity.port}; the published replacement stands, but local readiness is not claimed. Restart Pi and invoke again: a matching pair loads only`);
    return undefined;
  }
  private async phaseThen<T>(phase: AdoptionPhase, run: () => Promise<T>): Promise<T> {
    await this.options.phase?.(phase);
    return run();
  }
}

/** The exact expected document: only the coordinator `sessionId` and `port` differ from the preview. */
function expectedReplacement(config: Config, identity: AdoptionIdentity): string {
  const copy = JSON.parse(JSON.stringify(config)) as Config;
  const entry = copy.agents.find(agent => agent.coordinator);
  if (!entry) fail('config has no coordinator entry');
  entry.sessionId = identity.sessionId;
  entry.port = identity.port;
  return `${JSON.stringify(copy, null, 2)}\n`;
}

// ---- visible question text ---------------------------------------------------------------

export function adoptionDecisionPrompt(input: {
  home: string; identity: AdoptionIdentity; board: { sessionId: string; port: number };
  previewRaw: string; probe: WorkerConnection; config: Config;
}): string {
  const { home, identity, board, previewRaw, probe, config } = input;
  const pair = (entry: { sessionId: string; port: number }) => `${entry.sessionId} (port ${entry.port})`;
  const workers = config.agents.filter(agent => !agent.coordinator);
  const fenced = workers.filter(agent => agent.closeJob && ['requested', 'awaiting_handoff', 'awaiting_settlement', 'ready', 'closing', 'uncertain'].includes(agent.closeJob.state));
  return [
    `Adopt this board: replace coordinator ${pair(board)} with this session ${pair(identity)}?`,
    '',
    `Board root (canonical projects home): ${home}`,
    `This session, captured from the native Pi session and verified at this runtime's bound endpoint: ${identity.sessionId} (port ${identity.port})`,
    `Configured board coordinator entry: ${pair(board)}`,
    '',
    'By answering yes you authorize exactly one change: the coordinator entry\'s sessionId and port become the pair above.',
    'Every other parsed value is preserved, including coordinator name and description, all worker entries, jobs, close jobs, handoffs, history and array order. Formatting may normalize; nothing else is rewritten.',
    `Left unchanged: ${workers.map(agent => agent.name).join(', ') || 'no workers'}.`,
    fenced.length ? `Close jobs reported and left fenced: ${fenced.map(agent => `${agent.name}/${agent.closeJob!.state}`).join(', ')}.` : 'No close job is changed.',
    'No worker is sent anything, and nothing is resumed, removed, interrupted, reloaded, or restarted. No model turn starts.',
    '',
    `Old endpoint probe: ${probe.state}${probe.reason ? ` (${probe.reason})` : ''} — ${DISCONNECTED_WARNING}`,
    'Your yes authorizes this replacement only. It is not evidence that the previous coordinator terminated, and it authorizes nothing else.',
    `Current config bytes SHA256: ${sha256(previewRaw)} — any change to them, even formatting only, invalidates this answer.`,
    '',
    'No text answer is requested, and nothing is written until you answer yes.',
    'No is preselected and is the safe answer: it writes nothing and authorizes no action. Esc or a dismissal declines the same way. A new decision requires a fresh invocation.',
  ].join('\n');
}

function bootDescription(state: BootState, board: { sessionId: string; port: number }, own: { name: string; coordinator: boolean } | undefined): string {
  if (state === 'b') return 'own sessionId is the coordinator entry; a matching pair loads without a question or write';
  if (state === 'c') return `own sessionId is worker entry ${own?.name ?? 'unknown'}; a registered worker is never promoted`;
  return `own sessionId is absent, so this session is an anonymous worker while the board names ${board.sessionId}/${board.port}`;
}

/** Escape control characters and quoting so a reported path cannot be misread as a different path. */
function escapePath(value: string): string {
  return value.replace(/[\x00-\x1f\x7f-\x9f"\\]/g, character => `\\x${(character.codePointAt(0) ?? 0).toString(16).padStart(2, '0')}`);
}
function displayPaths(paths: string[]): string {
  const shown = paths.slice(0, 12).map(escapePath);
  return shown.join(', ') + (paths.length > shown.length ? `, and ${paths.length - shown.length} more` : '');
}

function codeFor(error: unknown): ResultCode {
  if (error instanceof AdoptionFailure) return error.code;
  if (error instanceof ConfigLockContention) return 'LOCKED';
  if (error instanceof LegacyConfigLock) return 'LOCK_LEGACY';
  if (error instanceof ConfigLockUnavailable) return 'LOCK_UNAVAILABLE';
  if (error instanceof ConfigPreviewChanged) return 'STALE_PREVIEW';
  // An unclassified internal error is an unavailable surface, never a named safety outcome. Reporting an
  // unexpected failure as STALE_PREVIEW would tell an operator something specific that is not true.
  return 'HOST';
}
/**
 * Compose an inner refusal into an outer one. An `AdoptionFailure` is a safety verdict the workflow wrote
 * itself, with named paths and a bounded path list: shortening it would hide exactly the blocker an
 * operator needs, so only its control characters are neutralised. Free-form text from an unexpected error
 * stays capped, because it has no such bound.
 */
function reason(error: unknown): string {
  const message = String(error).replace(/^PiIntercom:\s*/, '').replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
  // Known safety refusals are the full operator instruction (path + offline-upgrade steps). Only
  // unbounded foreign error prose is capped.
  if (error instanceof AdoptionFailure || error instanceof LegacyConfigLock
    || error instanceof ConfigLockContention || error instanceof ConfigLockUnavailable) return message;
  return message.length > 240 ? `${message.slice(0, 240)}…` : message;
}
/**
 * A named refusal raised at the call site that knows which step failed. Codes are never inferred from
 * error prose: an unrelated internal error must not be reported to an operator as a specific safety
 * verdict such as a stale preview.
 */
export class AdoptionFailure extends Error {
  constructor(readonly code: ResultCode, message: string) { super(message); this.name = 'AdoptionFailure'; }
}
function failAt(code: ResultCode, message: string): never { throw new AdoptionFailure(code, message); }
/** Run a step whose failure has one meaning, so its code comes from here rather than from wording. */
async function coded<T>(code: ResultCode, run: () => Promise<T>): Promise<T> {
  try { return await run(); }
  catch (error) {
    if (error instanceof AdoptionFailure || error instanceof ConfigPreviewChanged
      || error instanceof ConfigLockContention || error instanceof LegacyConfigLock || error instanceof ConfigLockUnavailable) throw error;
    throw new AdoptionFailure(code, reason(error));
  }
}
function reasonOf(result: Result): string {
  return result.lines[result.lines.length - 1] ?? 'refused';
}
