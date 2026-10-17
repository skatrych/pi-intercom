import { spawn, spawnSync } from 'node:child_process';
import { lstat, open, readFile, realpath, rename, stat, unlink } from 'node:fs/promises';
import { lstatSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { ConfigStore, ConfigPreviewChanged, StaleConfigLock, coordinator, fail, patchCoordinatorEntry, rawSpan, sha256, } from './config.js';
/**
 * Coordinator adoption: the only coordinator-entry replacement path.
 *
 * A deterministic workflow, not a tool, command, CLI, or endpoint. Reachable only through
 * `Intercom.adoptCoordinator`, which the role-local `/intercom-adopt` command invokes with a supported
 * Pi command context. There are no identity, port, path, role, confirmation, or JSON parameters: every
 * authority value comes from this process's launch configuration, the persisted Pi session, this
 * runtime's bound endpoint, the config read made inside the transaction, or an answer typed by the
 * human into this session's own Pi UI.
 */
export const PROJECTS_HOME_ENV = 'PI_INTERCOM_PROJECTS_HOME';
export const DEFAULT_PROJECTS_HOME = 'workspaces/projects';
export const ORCHESTRATOR_ROLE = 'orchestrator';
export const CLAIM_FILE = 'coordinator-claim.md';
export const CONFIG_DIRECTORY = '.pi-intercom';
export const REBRIEF_SOURCE = 'handoff.md (open assignments)';
export const ENDED_WORDING = (sessionId) => `I confirm coordinator ${sessionId} ended`;
/** Result contract: success 0, safety stop 1, unavailable backend/host/usage 2. */
const UNAVAILABLE = ['BACKEND', 'HOST', 'USAGE'];
export function succeed(code, lines) { return { ok: true, code, exitCode: 0, lines }; }
export function stop(code, lines) {
    return { ok: false, code, exitCode: UNAVAILABLE.includes(code) ? 2 : 1, lines };
}
/** Exactly one terminal summary line per result. Status lines are prefixed by the caller. */
function halt(code, evidence) { return stop(code, [`ADOPTION STOP ${code}: ${evidence}`]); }
const CLAIM_KEYS = ['schemaVersion', 'transitionId', 'phase', 'boardRoot', 'coordinator', 'date', 'authority',
    'previous', 'previousRecordCommit', 'configBeforeSha256', 'configAfterSha256', 'intentCommit', 'leftUnchanged', 'rebriefSource'];
const AUTHORITY_KEYS = ['kind', 'record', 'confirmedEndedAt', 'wording'];
const COORDINATOR_KEYS = ['sessionId', 'port'];
const PREVIOUS_KEYS = ['sessionId', 'port', 'claimDate'];
const LEFT_KEYS = ['name', 'sessionId', 'port', 'projectDirectory', 'role', 'entrySha256', 'closeJob'];
const CLOSE_JOB_KEYS = ['jobId', 'state', 'sha256'];
const DATE = /^\d{4}-\d\d-\d\d$/, STAMP = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/, SHA = /^[0-9a-f]{64}$/, COMMIT = /^[0-9a-f]{40}$/, UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEADING = '# Coordinator claim\n\n```json\n', FOOTER = '\n```\n';
/** The single record renderer. Byte-deterministic, so committed and derived bytes are comparable. */
export function renderClaim(record) {
    const ordered = {};
    for (const name of CLAIM_KEYS)
        ordered[name] = name === 'leftUnchanged'
            ? record.leftUnchanged.map(entry => entry.closeJob === null ? { ...entry, closeJob: null } : { ...entry })
            : record[name];
    return `${HEADING}${JSON.stringify(ordered, null, 2)}${FOOTER}`;
}
function fieldOrder(value, expected) {
    const actual = value && typeof value === 'object' ? Object.keys(value) : [];
    return actual.length === expected.length && expected.every((name, at) => actual[at] === name);
}
function bounded(value, max) {
    return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f-\x9f]/.test(value);
}
function integer(value) { return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 65535; }
/**
 * Read and re-render. Only canonical bytes count as evidence: a semantically similar record with
 * different formatting, an extra field, a duplicate key, or a broken envelope is a refusal, never
 * an approval and never "absent".
 */
export function parseClaim(raw) {
    if (!raw.startsWith(HEADING) || !raw.endsWith(FOOTER))
        fail('claim record envelope is malformed');
    const value = JSON.parse(raw.slice(HEADING.length, raw.length - FOOTER.length));
    if (!value || typeof value !== 'object' || !fieldOrder(value, CLAIM_KEYS))
        fail('claim record fields are not exact');
    if (value.schemaVersion !== 1 || !(typeof value.transitionId === 'string' && UUID.test(value.transitionId)) || !['prepared', 'active'].includes(value.phase))
        fail('claim record identity is invalid');
    if (!bounded(value.boardRoot, 4096) || !path.isAbsolute(value.boardRoot) || path.resolve(value.boardRoot) !== value.boardRoot)
        fail('claim record boardRoot is invalid');
    const pair = value.coordinator;
    if (!fieldOrder(pair, COORDINATOR_KEYS) || !bounded(pair?.sessionId, 256) || !integer(pair?.port))
        fail('claim record coordinator is invalid');
    if (!(typeof value.date === 'string' && DATE.test(value.date)) || !Number.isFinite(Date.parse(`${value.date}T00:00:00Z`)))
        fail('claim record date is invalid');
    const authority = value.authority;
    const authorityKind = authority?.kind;
    if (!fieldOrder(authority, AUTHORITY_KEYS) || (authorityKind !== 'first-coordinator declaration' && authorityKind !== 'adoption')
        || !bounded(authority.record, 2000) || !bounded(authority.wording, 2000))
        fail('claim record authority is invalid');
    if (authorityKind === 'first-coordinator declaration' ? authority.confirmedEndedAt !== null
        : !(typeof authority.confirmedEndedAt === 'string' && STAMP.test(authority.confirmedEndedAt) && Number.isFinite(Date.parse(authority.confirmedEndedAt))))
        fail('claim record authority evidence is invalid');
    const previous = value.previous;
    if (authorityKind === 'adoption' ? !fieldOrder(previous, PREVIOUS_KEYS) || !bounded(previous?.sessionId, 256) || !integer(previous?.port)
        || !(previous?.claimDate === null || (typeof previous.claimDate === 'string' && DATE.test(previous.claimDate)))
        : previous !== null)
        fail('claim record previous identity is invalid');
    for (const name of ['previousRecordCommit', 'intentCommit']) {
        if (value[name] !== null && !(typeof value[name] === 'string' && COMMIT.test(value[name])))
            fail(`claim record ${name} is invalid`);
    }
    for (const name of ['configBeforeSha256', 'configAfterSha256']) {
        if (!(typeof value[name] === 'string' && SHA.test(value[name])))
            fail(`claim record ${name} is invalid`);
    }
    if (!Array.isArray(value.leftUnchanged) || !bounded(value.rebriefSource, 256))
        fail('claim record roster is invalid');
    for (const entry of value.leftUnchanged) {
        if (!fieldOrder(entry, LEFT_KEYS) || !bounded(entry.name, 128) || !bounded(entry.sessionId, 256) || !integer(entry.port) || !bounded(entry.projectDirectory, 4096)
            || !(entry.role === null || bounded(entry.role, 64)) || !(typeof entry.entrySha256 === 'string' && SHA.test(entry.entrySha256)))
            fail('claim record roster entry is invalid');
        if (entry.closeJob !== null && (!fieldOrder(entry.closeJob, CLOSE_JOB_KEYS) || !bounded(entry.closeJob.jobId, 128) || !bounded(entry.closeJob.state, 32)
            || !(typeof entry.closeJob.sha256 === 'string' && SHA.test(entry.closeJob.sha256))))
            fail('claim record closeJob evidence is invalid');
    }
    if (authorityKind === 'adoption' && (authority.wording !== ENDED_WORDING(previous.sessionId) || value.coordinator.sessionId === previous.sessionId || value.coordinator.port === previous.port || value.configBeforeSha256 === value.configAfterSha256))
        fail('claim adoption authority/transition is inconsistent');
    if (value.phase === 'prepared' && (authorityKind !== 'adoption' || value.intentCommit !== null))
        fail('prepared claim must be adoption intent without intentCommit');
    if (authorityKind === 'first-coordinator declaration' && (value.phase !== 'active' || value.intentCommit !== null || value.previousRecordCommit !== null || value.configBeforeSha256 !== value.configAfterSha256))
        fail('first declaration must be active without replacement');
    if (value.rebriefSource !== REBRIEF_SOURCE || new Set(value.leftUnchanged.map(entry => entry.sessionId)).size !== value.leftUnchanged.length)
        fail('claim roster/source is inconsistent');
    if (renderClaim(value) !== raw)
        fail('claim record is not canonical');
    return value;
}
/** AC6 evidence: every non-coordinator entry, in config order, with raw entry and closeJob hashes. */
export function leftUnchanged(scanned) {
    const result = [];
    scanned.entries.forEach((entry, index) => {
        const agent = scanned.config.agents[index];
        if (!agent || agent.coordinator)
            return;
        result.push({
            name: agent.name, sessionId: agent.sessionId, port: agent.port, projectDirectory: agent.projectDirectory,
            role: agent.role ?? null,
            entrySha256: sha256(rawSpan(scanned.raw, entry.span)),
            closeJob: agent.closeJob && entry.closeJobSpan
                ? { jobId: agent.closeJob.jobId, state: agent.closeJob.state, sha256: sha256(rawSpan(scanned.raw, entry.closeJobSpan)) }
                : null,
        });
    });
    return result;
}
const roster = (entries) => entries.map(entry => entry.name).join(', ') || 'none';
/** Absolute projects home from runtime configuration. Never a user-supplied board to overwrite. */
export function projectsHome(options) {
    const configured = options.projectsHome ?? (options.homeDirectory ? path.join(options.homeDirectory, DEFAULT_PROJECTS_HOME) : undefined);
    if (!bounded(configured, 4096))
        fail('the projects home is not configured');
    const absolute = path.resolve(configured);
    if (path.resolve(absolute) !== absolute)
        fail('projects home path is unsafe');
    return absolute;
}
function contains(root, target) {
    const relative = path.relative(root, target);
    return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}
async function isDirectory(target) {
    try {
        return (await stat(target)).isDirectory();
    }
    catch {
        return false;
    }
}
/**
 * Count `.pi-intercom` directories along cwd -> projects home inclusive, before discovery could choose
 * one. Directories are counted, not readable configs: an empty or malformed extra board still stops.
 */
export async function countBoards(cwd, home) {
    const boards = [];
    let at = cwd;
    for (;;) {
        try {
            const info = await lstat(path.join(at, CONFIG_DIRECTORY));
            if (info.isSymbolicLink() || !info.isDirectory())
                failAt('BOARD_PATH', `unsafe board directory at ${at}`);
            boards.push(at);
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
        }
        if (at === home || !contains(home, at))
            break;
        const parent = path.dirname(at);
        if (parent === at)
            break;
        at = parent;
    }
    return boards;
}
/** argv only, never a shell string. No global configuration, hook bypass, staging sweep or cleanup. */
export async function runGit(args, cwd) {
    return new Promise((resolve, reject) => {
        const child = spawn('git', args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '', stderr = '';
        child.stdout.on('data', chunk => { if (stdout.length < 262144)
            stdout += String(chunk); });
        child.stderr.on('data', chunk => { if (stderr.length < 8192)
            stderr += String(chunk); });
        child.once('error', reject);
        child.once('close', code => resolve({ code: code ?? -1, stdout, stderr }));
    });
}
// ---- workflow -------------------------------------------------------------------------
export class AdoptionWorkflow {
    options;
    git;
    request;
    constructor(options, git = runGit) {
        this.options = options;
        this.git = git;
    }
    /** One request in flight. A second concurrent request never interleaves with a transaction. */
    async run(context, verb, args = []) {
        if (args.length)
            return halt('USAGE', 'adoption accepts no arguments: identity, ports, paths and confirmations are never command arguments');
        if (verb !== 'status' && verb !== 'adopt')
            return halt('USAGE', `unknown verb ${verb}; only status and the interactive workflow exist`);
        if (this.request)
            return halt('BUSY', 'another adoption request is in flight; no concurrent transaction is attempted');
        const current = (verb === 'status' ? this.status(context) : this.adopt(context))
            .catch(error => halt(codeFor(error), reason(error)))
            .finally(() => { if (this.request === current)
            this.request = undefined; });
        this.request = current;
        return current;
    }
    /** Read-only board count, boot state, identity evidence and claim state. Never mutates. */
    async status(context) {
        const refused = await this.authorize(context, { idle: false });
        if (refused)
            return refused;
        const surveyed = await this.survey(context);
        if ('stop' in surveyed)
            return surveyed.stop;
        const lines = this.report(surveyed);
        if (this.matchingActive(surveyed) && (!this.options.responsibilityLoaded() || !this.options.readiness.ready())) {
            return stop('PROMOTION_PENDING', [...lines.filter(line => !line.startsWith('STATUS OK:')),
                'ADOPTION STOP PROMOTION_PENDING: committed active evidence matches, but local promotion/action readiness is incomplete; explicitly invoke /intercom-adopt for write-free promotion retry; no replacement or record commit']);
        }
        return succeed('OK', lines);
    }
    /** Deterministic status plus the interactive declaration, adoption, or reconciliation decision. */
    async adopt(context) {
        const refused = await this.authorize(context, { idle: true });
        if (refused)
            return refused;
        const surveyed = await this.survey(context);
        if ('stop' in surveyed)
            return surveyed.stop;
        const decided = await this.decide(context, surveyed);
        return { ...decided, lines: [...this.report(surveyed).filter(line => !line.startsWith('STATUS OK:')), ...decided.lines] };
    }
    report(surveyed) {
        const lines = [...surveyed.lines];
        const claim = surveyed.claim;
        if (!claim)
            lines.push('CLAIM ABSENT: declaration required before coordinator actions');
        else if (claim.phase === 'prepared')
            lines.push(`CLAIM PREPARED: transition ${claim.transitionId}; record ${claim.coordinator.sessionId}/${claim.coordinator.port} — reconciliation required; no authority to act`);
        else if (claim.coordinator.sessionId === surveyed.identity.sessionId && claim.coordinator.port === surveyed.identity.port
            && surveyed.scanned && coordinator(surveyed.scanned.config).sessionId === claim.coordinator.sessionId && coordinator(surveyed.scanned.config).port === claim.coordinator.port) {
            lines.push(`CLAIM MATCH: session ${claim.coordinator.sessionId} port ${claim.coordinator.port} — committed active record matches board`);
        }
        else {
            lines.push(`CLAIM OTHER: record ${claim.coordinator.sessionId}; this session ${surveyed.identity.sessionId}; board ${surveyed.scanned ? coordinator(surveyed.scanned.config).sessionId : 'unknown'} — stop until human decides`);
        }
        lines.push(`STATUS OK: ${surveyed.state} — ${this.disposition(surveyed)}`);
        return lines;
    }
    matchingActive(surveyed) {
        const claim = surveyed.claim, board = surveyed.scanned && coordinator(surveyed.scanned.config);
        return claim?.phase === 'active' && claim.coordinator.sessionId === surveyed.identity.sessionId && claim.coordinator.port === surveyed.identity.port
            && board?.sessionId === claim.coordinator.sessionId && board.port === claim.coordinator.port;
    }
    disposition(surveyed) {
        if (surveyed.state === 'a')
            return 'bootstrap decision required';
        if (surveyed.state === 'c')
            return 'stop: this session is a registered worker and needs a fresh session id';
        if (surveyed.state === 'd')
            return 'adoption required';
        if (!surveyed.claim)
            return 'declaration required';
        if (surveyed.claim.phase !== 'active')
            return 'reconciliation required';
        if (!this.matchingActive(surveyed))
            return 'stop: claim/board pair mismatch';
        return this.options.responsibilityLoaded() && this.options.readiness.ready() ? 'proceed' : 'promotion pending; action not ready';
    }
    /** Role, mode, trust, session identity, idle host. Each is a separate named refusal. */
    async authorize(context, requirements) {
        const launch = this.launchRole();
        if (!launch.authorized)
            return halt('AUTH', `${launch.detail}; this workflow is available only to the canonical Orchestrator launch role`);
        if (context.mode !== 'tui')
            return halt('MODE', `a human decision requires the interactive Pi UI, not mode ${context.mode}`);
        if (!context.hasUI || !context.ui?.input || !context.ui?.confirm)
            return halt('MODE', 'no dialog-capable Pi UI is available to capture a human decision');
        if (!context.isProjectTrusted())
            return halt('TRUST', 'project trust is required before honoring shared board configuration');
        if (context.sessionManager.getSessionId() !== this.options.sessionId())
            return halt('SESSION_CHANGED', 'the command context session is not this runtime session');
        if (requirements.idle) {
            try {
                await context.waitForIdle?.();
            }
            catch {
                return halt('BUSY', 'waiting for the host to settle failed; no takeover was attempted');
            }
            if (!context.isIdle() || this.options.busy())
                return halt('BUSY', 'this Pi host is still busy; adoption waits instead of steering');
        }
        return undefined;
    }
    /** The launch role is read from captured process configuration, never from the request or a model. */
    launchRole() {
        const configured = this.options.roleDirectory, roles = this.options.rolesDirectory;
        if (!bounded(configured, 4096) || !bounded(roles, 4096))
            return { authorized: false, detail: 'no canonical role launch directory is recorded for this process' };
        const canonical = path.resolve(roles, ORCHESTRATOR_ROLE);
        if (this.options.workerRole && this.options.workerRole !== ORCHESTRATOR_ROLE)
            return { authorized: false, detail: 'contradictory worker-role launch metadata' };
        try {
            if (realpathSync(roles) !== path.resolve(roles) || realpathSync(configured) !== path.resolve(configured) || !lstatSync(configured).isDirectory() || lstatSync(configured).isSymbolicLink())
                return { authorized: false, detail: 'unsafe canonical launch-role path' };
        }
        catch {
            return { authorized: false, detail: 'launch-role directory is unavailable' };
        }
        if (path.resolve(configured) !== canonical)
            return { authorized: false, detail: `this process was launched as role ${path.basename(path.resolve(configured)) || 'unknown'}` };
        return { authorized: true, detail: 'authorized' };
    }
    // ---- read-only survey ------------------------------------------------------------
    async survey(context) {
        let home;
        try {
            home = projectsHome({ projectsHome: this.options.projectsHome ?? process.env[PROJECTS_HOME_ENV], homeDirectory: homedir() });
        }
        catch {
            return { stop: halt('BOARD_PATH', 'the projects home is not resolvable from this process configuration') };
        }
        const cwd = await this.canonical(context.cwd), canonicalHome = await this.canonical(home);
        if (cwd === undefined || canonicalHome === undefined)
            return { stop: halt('BOARD_PATH', 'cwd or projects home cannot be canonicalised; nothing was read') };
        if (!contains(canonicalHome, cwd))
            return { stop: halt('BOARD_PATH', `cwd ${cwd} is outside projects home ${canonicalHome}; no board is read or written`) };
        if (path.resolve(context.cwd) !== cwd || path.resolve(home) !== canonicalHome)
            return { stop: halt('BOARD_PATH', 'cwd or projects home is a symlink/alias; use its canonical path') };
        const boards = await countBoards(cwd, canonicalHome);
        const identity = await this.resolveIdentity(context);
        if ('stop' in identity)
            return identity;
        const surveyed = {
            home: canonicalHome, cwd, boards, state: 'a', identity,
            claimPath: path.join(canonicalHome, CLAIM_FILE),
            lines: [`IDENTITY: session ${identity.sessionId} from persisted Pi session ${identity.sessionFile}; port ${identity.port} from this runtime ready endpoint — verified`],
        };
        if (boards.length === 0) {
            surveyed.lines.unshift(`BOARD COUNT NONE: no board between ${cwd} and ${canonicalHome} — state (a)`);
            surveyed.lines.push('BOOT STATE: a — no board found (ConfigStore.discover; Runtime.start initialization branch); bootstrap requires an explicit human decision');
            if (cwd !== canonicalHome) {
                return { stop: halt('NO_BOARD', `no board between ${cwd} and ${canonicalHome}; a private board is never created in a child directory; the first-board decision is allowed only at the projects home`) };
            }
            const existingClaim = await this.readClaim(surveyed);
            if (existingClaim)
                return { stop: existingClaim };
            if (surveyed.claim || surveyed.worktreeRaw)
                return { stop: halt('CLAIM_MISMATCH', 'claim evidence exists but there is no board; this is not a first declaration') };
            surveyed.head = (await this.gitText(['rev-parse', 'HEAD'], canonicalHome, { tolerate: true }))?.trim();
            surveyed.paths = await this.pathSnapshot(surveyed);
            return surveyed;
        }
        if (boards.length > 1)
            return { stop: halt('BOARD_COUNT', `a second board at ${boards[1]} is a creation-time failure, not a cleanup item; nothing was read or written`) };
        // Exactly one board that is not the projects home stops here, for `status` as well as for the
        // workflow: a lone child board is a wrong board for this command, not a licence to keep looking. The
        // approved table lists this case among the stop outcomes with zero writes.
        if (boards[0] !== canonicalHome) {
            return { stop: halt('BOARD_COUNT', `the only board is at ${boards[0]}, not the projects home ${canonicalHome}; stop with no writes rather than treat a child project's board as this one`) };
        }
        let scanned;
        try {
            scanned = await coded('CONFIG', () => this.options.storeFor(boards[0]).readStrict());
        }
        catch (error) {
            return { stop: halt('CONFIG', `the board config is unreadable or invalid: ${reason(error)}; a malformed board is never repaired implicitly`) };
        }
        surveyed.boardRoot = boards[0];
        surveyed.scanned = scanned;
        const board = coordinator(scanned.config);
        const own = scanned.config.agents.find(agent => agent.sessionId === identity.sessionId);
        surveyed.lines.unshift(`BOARD COUNT PASS: exactly one — ${canonicalHome}/${CONFIG_DIRECTORY} (projects home); acceptable`);
        surveyed.state = board.sessionId === identity.sessionId ? 'b' : own && !own.coordinator ? 'c' : own ? 'b' : 'd';
        surveyed.lines.push(`BOOT STATE: ${surveyed.state} — ${bootDescription(surveyed.state, board, own)}`);
        const refused = await this.readClaim(surveyed);
        if (refused !== undefined)
            return { stop: refused };
        surveyed.head = (await this.gitText(['rev-parse', 'HEAD'], canonicalHome, { tolerate: true }))?.trim();
        try {
            surveyed.paths = await this.pathSnapshot(surveyed);
        }
        catch (error) {
            return { stop: halt('BOARD_PATH', reason(error)) };
        }
        return surveyed;
    }
    /** AC3: session identity from the persisted Pi session and the per-cwd store, port from this endpoint. */
    async resolveIdentity(context) {
        const port = this.options.endpointPort();
        const sessionId = this.options.sessionId();
        if (port === undefined)
            return { stop: halt('IDENTITY', 'this runtime has no bound endpoint; a port is never guessed') };
        if (!bounded(sessionId, 256))
            return { stop: halt('SESSION_CHANGED', 'this runtime session identity is unavailable') };
        const sessionFile = context.sessionManager.getSessionFile();
        if (sessionFile === undefined || !bounded(sessionFile, 4096)) {
            return { stop: halt('SESSION_UNPERSISTED', 'this Pi session has no persisted session file; take an ordinary non-coordinating turn first, then invoke again') };
        }
        let header;
        try {
            header = JSON.parse((await readFile(sessionFile, 'utf8')).split('\n', 1)[0] ?? '');
        }
        catch {
            return { stop: halt('SESSION_UNPERSISTED', `persisted Pi session ${sessionFile} has no readable session header`) };
        }
        if (header.type !== 'session' || header.id !== sessionId || header.cwd !== context.cwd) {
            return { stop: halt('IDENTITY', `persisted Pi session ${sessionFile} does not name session ${sessionId}`) };
        }
        const sessionDir = context.sessionManager.getSessionDir();
        let listed;
        try {
            listed = await this.options.listSessions(context.cwd, sessionDir);
        }
        catch (error) {
            return { stop: halt('IDENTITY', `the Pi session store ${sessionDir ?? '(default)'} is unreadable: ${reason(error)}`) };
        }
        if (!listed.some(session => session.id === sessionId && path.resolve(session.path) === path.resolve(sessionFile))) {
            return { stop: halt('IDENTITY', `session ${sessionId} is not listed for cwd ${context.cwd} in ${sessionDir ?? 'the default session directory'}; no latest-session guess is used`) };
        }
        const health = await this.options.probe({ sessionId, port }, { timeoutMs: 2000 });
        if (health.state !== 'connected') {
            return { stop: halt('IDENTITY', `endpoint port ${port} did not verify session ${sessionId} (${health.reason}); a port is never guessed or supplied`) };
        }
        return { sessionId, port, sessionFile };
    }
    /** AC2: absent, uncommitted, malformed, or foreign evidence. None of them is approval. */
    async readClaim(surveyed) {
        // Worktree bytes are read only so they can be reported. They are never authority: an uncommitted
        // record approves nothing, and a damaged worktree file must not hide a verified committed transition,
        // because that combination is precisely the interrupted-writer state this workflow must recognize
        // before any generic dirty-record refusal.
        let raw;
        try {
            raw = await readFile(surveyed.claimPath, 'utf8');
        }
        catch (error) {
            if (error.code !== 'ENOENT') {
                return halt('RECORD', `${CLAIM_FILE} is present but unreadable: ${reason(error)}`);
            }
        }
        let record;
        // Committed evidence has precedence over the worktree file. A worktree that differs from its commit is
        // not a refusal: it is exactly the interrupted-writer state reconciliation exists to classify, so
        // refusing it here would make the approved recovery branch unreachable.
        surveyed.worktreeRaw = raw;
        const commit = await this.latestClaimCommit(surveyed.home);
        if (commit === undefined) {
            // Nothing committed: the worktree is all there is, so it is refused on its own terms.
            if (raw === undefined)
                return undefined;
            try {
                parseClaim(raw);
            }
            catch (error) {
                return halt('RECORD', `${CLAIM_FILE} is malformed: ${reason(error)}; a malformed record is neither absence nor approval`);
            }
            return halt('RECORD', `${CLAIM_FILE} has no committed version; an uncommitted record is not evidence and not approval`);
        }
        const committed = await this.gitText(['show', `${commit}:${CLAIM_FILE}`], surveyed.home, { tolerate: true });
        if (committed === undefined)
            return halt('RECORD', `${CLAIM_FILE} commit ${commit} cannot be read; nothing is inferred from an unreadable commit`);
        try {
            record = parseClaim(committed);
        }
        catch (error) {
            return halt('RECORD', `committed ${CLAIM_FILE} at ${commit.slice(0, 8)} is malformed: ${reason(error)}`);
        }
        surveyed.claimRaw = committed;
        surveyed.claim = record;
        surveyed.claimCommit = commit;
        if (record.phase === 'active' && raw !== committed)
            return halt('RECORD', 'active claim bytes differ from the latest committed evidence; dirty evidence never approves coordinator action');
        if (record.phase === 'active') {
            const invalid = await this.verifyActiveAnchor(surveyed.home, record, commit);
            if (invalid)
                return halt('RECORD', invalid);
        }
        if (record.boardRoot !== surveyed.home)
            return halt('CLAIM_MISMATCH', `record boardRoot ${record.boardRoot} is not this board root ${surveyed.home}`);
        // A record/board pair mismatch is deliberately not refused here. Which of the committed before-hash or
        // after-hash the board matches is what decides whether this is a prepared transition to advance, an
        // adoption already completed, or an ambiguous state for a human.
    }
    /**
     * Read git history only, never the worktree file: dirty bytes never supply authority, previous
     * identity, confirmation, timestamps, roster or hashes.
     */
    async latestClaimCommit(home) {
        const log = await this.gitText(['log', '--format=%H', '-n', '1', '--', CLAIM_FILE], home, { tolerate: true });
        const commit = log?.trim();
        return commit && COMMIT.test(commit) ? commit : undefined;
    }
    async verifyActiveAnchor(home, record, commit) {
        try {
            await verifyEvidenceAsync(activeIntentProof(record, renderClaim(record), commit), args => this.git(args, home));
            return undefined;
        }
        catch {
            return 'active bytes are not derived from reachable committed prepared intent';
        }
    }
    /** Snapshot actual ancestor directories, not a descendant tree scan. */
    async pathSnapshot(surveyed) {
        const paths = new Map();
        let at = surveyed.cwd;
        for (;;) {
            const info = await lstat(at);
            if (!info.isDirectory() || info.isSymbolicLink() || await realpath(at) !== at)
                failAt('BOARD_PATH', `unsafe directory ${at}`);
            paths.set(at, `${info.dev}:${info.ino}`);
            const board = path.join(at, CONFIG_DIRECTORY);
            try {
                const info = await lstat(board);
                if (!info.isDirectory() || info.isSymbolicLink())
                    failAt('BOARD_PATH', `unsafe board ${board}`);
                paths.set(board, `${info.dev}:${info.ino}`);
            }
            catch (error) {
                if (error.code !== 'ENOENT')
                    throw error;
            }
            if (at === surveyed.home)
                break;
            at = path.dirname(at);
        }
        for (const file of [surveyed.claimPath, path.join(surveyed.home, CONFIG_DIRECTORY, 'config.json')]) {
            try {
                if (!(await lstat(file)).isFile())
                    failAt('BOARD_PATH', `unsafe file ${file}`);
            }
            catch (error) {
                if (error.code !== 'ENOENT')
                    throw error;
            }
        }
        return paths;
    }
    /** Synchronous final guard also runs on every platform rename retry. */
    assertPaths(surveyed) {
        try {
            for (const [file, identity] of surveyed.paths ?? []) {
                const info = lstatSync(file);
                if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(file) !== file || `${info.dev}:${info.ino}` !== identity)
                    failAt('STALE_PREVIEW', `directory identity changed: ${file}`);
            }
            let at = surveyed.cwd;
            for (;;) {
                const board = path.join(at, CONFIG_DIRECTORY);
                try {
                    const info = lstatSync(board);
                    if (!info.isDirectory() || info.isSymbolicLink() || (!surveyed.paths?.has(board) && (surveyed.scanned || at !== surveyed.home)))
                        failAt('STALE_PREVIEW', `board directory appeared or changed: ${board}`);
                }
                catch (error) {
                    if (error.code !== 'ENOENT')
                        throw error;
                }
                if (at === surveyed.home)
                    break;
                at = path.dirname(at);
            }
            for (const file of [surveyed.claimPath, path.join(surveyed.home, CONFIG_DIRECTORY, 'config.json')]) {
                try {
                    if (!lstatSync(file).isFile())
                        failAt('STALE_PREVIEW', `unsafe file ${file}`);
                }
                catch (error) {
                    if (error.code !== 'ENOENT')
                        throw error;
                }
            }
        }
        catch (error) {
            if (error instanceof AdoptionFailure)
                throw error;
            failAt('STALE_PREVIEW', `board paths changed: ${reason(error)}`);
        }
    }
    /** Revalidate the full immutable preview under the same all-writer lock, before intent or finalization. */
    async assertSnapshot(context, surveyed, epoch) {
        this.assertCurrent(context, epoch);
        this.assertPaths(surveyed);
        const boards = await countBoards(surveyed.cwd, surveyed.home);
        const raw = await this.readOptional(path.join(surveyed.home, CONFIG_DIRECTORY, 'config.json'));
        const expectedBoards = surveyed.boards;
        const bootstrapLockDirectory = !surveyed.scanned && raw === undefined && boards.length === 1 && boards[0] === surveyed.home;
        if (!bootstrapLockDirectory && JSON.stringify(boards) !== JSON.stringify(expectedBoards))
            failAt('STALE_PREVIEW', 'ancestor board count changed while the decision was open');
        if (raw !== surveyed.scanned?.raw)
            failAt('STALE_PREVIEW', 'config bytes/roster changed while the decision was open');
        if (await this.readOptional(surveyed.claimPath) !== surveyed.worktreeRaw)
            failAt(surveyed.claim?.phase === 'prepared' ? 'RECOVERY_REQUIRED' : 'STALE_PREVIEW', 'claim worktree bytes changed while the decision was open');
        const head = (await this.gitText(['rev-parse', 'HEAD'], surveyed.home, { tolerate: true }))?.trim();
        if (head !== surveyed.head || await this.latestClaimCommit(surveyed.home) !== surveyed.claimCommit)
            failAt('STALE_PREVIEW', 'HEAD/claim-commit anchor changed during the decision');
        const own = await this.resolveIdentity(context);
        if ('stop' in own)
            failAt(own.stop.code, reasonOf(own.stop));
        if (own.port !== surveyed.identity.port || own.sessionId !== surveyed.identity.sessionId || own.sessionFile !== surveyed.identity.sessionFile)
            failAt('SESSION_CHANGED', 'identity changed during the decision');
        this.assertCurrent(context, epoch);
        this.assertPaths(surveyed);
    }
    async canonical(target) {
        try {
            return await realpath(target);
        }
        catch {
            return undefined;
        }
    }
    // ---- decisions -------------------------------------------------------------------
    async decide(context, surveyed) {
        const claim = surveyed.claim;
        if (surveyed.state === 'a')
            return this.bootstrap(context, surveyed);
        if (surveyed.state === 'c') {
            const worker = surveyed.scanned?.config.agents.find(agent => agent.sessionId === surveyed.identity.sessionId);
            return halt('SESSION_COLLISION', `this session is registered as worker ${worker?.name ?? 'unknown'}; adoption requires a genuinely fresh session id, and no promotion, removal or rebind is offered`);
        }
        if (surveyed.state === 'd' && !claim) {
            const refused = await this.humanAdoptionDecision(context, surveyed);
            if ('stop' in refused)
                return refused.stop;
            return this.transaction(context, surveyed, coordinator(surveyed.scanned.config), refused.authority);
        }
        if (!claim) {
            if (surveyed.state !== 'b')
                return halt('CLAIM_OTHER', 'no claim record exists for this board state; a declaration is never inferred for it');
            const authority = await this.askAuthority(context, 'first-coordinator declaration', surveyed.home);
            if ('stop' in authority)
                return authority.stop;
            return this.declare(context, surveyed, authority);
        }
        const self = claim.coordinator.sessionId === surveyed.identity.sessionId && claim.coordinator.port === surveyed.identity.port;
        if (claim.phase === 'active') {
            if (!self && surveyed.state === 'd') {
                const decision = await this.humanAdoptionDecision(context, surveyed);
                if ('stop' in decision)
                    return decision.stop;
                return this.transaction(context, surveyed, coordinator(surveyed.scanned.config), decision.authority);
            }
            if (!self) {
                // All three pairs, with ports. A record that disagrees only on port would otherwise print the
                // same session id three times, which tells an operator nothing actionable.
                const entry = surveyed.scanned ? coordinator(surveyed.scanned.config) : undefined;
                const pair = (sessionId, port) => `${sessionId}/${port}`;
                return halt('CLAIM_OTHER', `record ${pair(claim.coordinator.sessionId, claim.coordinator.port)}; this session ${pair(surveyed.identity.sessionId, surveyed.identity.port)}; board ${entry ? pair(entry.sessionId, entry.port) : 'unknown'} — report both; wait for human decision`);
            }
            const board = coordinator(surveyed.scanned.config);
            if (board.sessionId !== claim.coordinator.sessionId || board.port !== claim.coordinator.port)
                return halt('CLAIM_MISMATCH', `active record ${claim.coordinator.sessionId}/${claim.coordinator.port} disagrees with board ${board.sessionId}/${board.port}; action remains fenced`);
            const epoch = this.options.readiness.current();
            await this.assertSnapshot(context, surveyed, epoch);
            if (!this.options.responsibilityLoaded()) {
                const failure = await this.promote();
                if (failure !== undefined)
                    return halt('PROMOTION_PENDING', `${failure}; committed active evidence exists, so an explicit write-free promotion retry is the only permitted step`);
            }
            await this.openReady(context, surveyed.identity, surveyed.home);
            return succeed('CLAIM_OK', [`CLAIM OK: session ${claim.coordinator.sessionId} port ${claim.coordinator.port} — continue`]);
        }
        return this.reconcile(context, surveyed);
    }
    /** State (a): only an explicitly confirmed first board at the projects home, never in a child cwd. */
    async bootstrap(context, surveyed) {
        const home = surveyed.home, identity = surveyed.identity;
        const confirmed = await context.ui.confirm({
            kind: 'boardInitialize',
            prompt: `Initialize the first Intercom board at projects home ${home}? Nothing is written until this is confirmed, and a child directory never receives a private board.`,
        });
        if (!confirmed)
            return halt('CANCELLED', `first-board initialization at ${home} was declined; nothing was written`);
        const authority = await this.askAuthority(context, 'first-coordinator declaration', home);
        if ('stop' in authority)
            return authority.stop;
        const store = this.options.storeFor(home);
        const epoch = this.options.readiness.close();
        try {
            const initialGit = await this.assertGitSafe(home, context, epoch);
            if (initialGit)
                return initialGit;
            const prepared = await store.transaction(async () => {
                await this.assertSnapshot(context, surveyed, epoch);
                const safe = await this.assertGitSafe(home, context, epoch);
                if (safe)
                    return { stop: safe };
                const initialized = await coded('PUBLISH', () => store.initialize(identity.sessionId, identity.port, () => this.assertCurrent(context, epoch)));
                if (!initialized)
                    return { stop: halt('BOARD_PATH', `a board already exists at ${home}; invoke again for a fresh preview instead of initializing twice`) };
                surveyed.scanned = await store.readStrict();
                const commit = await coded('GIT', () => this.writeCommit(home, renderClaim(declaration(surveyed, authority, this.options)), context, epoch));
                if (commit === undefined)
                    return { stop: halt('GIT', 'the first-coordinator declaration produced no verified commit; the board exists, so invoke again rather than initializing twice') };
                return { commit };
            });
            if ('stop' in prepared)
                return prepared.stop;
            const failure = await this.promote();
            if (failure !== undefined)
                return halt('PROMOTION_PENDING', `the board was initialized and declared, but local responsibility did not load: ${failure}`);
            await this.openReady(context, identity, home);
            return succeed('DECLARED', declared(identity, prepared.commit));
        }
        catch (error) {
            return halt(codeFor(error), `first-board initialization stopped: ${reason(error)}; no retry is performed`);
        }
    }
    /** State (b) with no record: write-and-continue, but only after the declaration is committed. */
    async declare(context, surveyed, authority) {
        const identity = surveyed.identity, home = surveyed.home;
        const store = this.options.storeFor(home);
        const epoch = this.options.readiness.close();
        try {
            const commit = await store.transaction(async () => {
                await this.assertSnapshot(context, surveyed, epoch);
                return coded('GIT', () => this.writeCommit(home, renderClaim(declaration(surveyed, authority, this.options)), context, epoch));
            });
            if (commit === undefined)
                return halt('GIT', 'the first-coordinator declaration produced no verified commit');
            const failure = await this.promote();
            if (failure !== undefined)
                return halt('PROMOTION_PENDING', `the declaration was committed but local responsibility did not load: ${failure}`);
            await this.openReady(context, identity, home);
            return succeed('DECLARED', declared(identity, commit));
        }
        catch (error) {
            return halt(codeFor(error), `declaration stopped: ${reason(error)}; no retry is performed`);
        }
    }
    // ---- AC3/AC4 human decision ---------------------------------------------------------
    /**
     * AC3 collisions, AC4 old-endpoint probe, then the human answers, in that order. Identity and the
     * ended confirmation are typed into this session's own Pi UI: no parameter, argument, saved default,
     * or model text can supply them, and no decline produces a write.
     */
    async humanAdoptionDecision(context, surveyed, previousSessionId, priorTransitionId) {
        const identity = surveyed.identity, board = coordinator(surveyed.scanned.config);
        const collision = surveyed.scanned.config.agents.find(agent => agent.sessionId === identity.sessionId);
        if (collision !== undefined) {
            return { stop: halt('SESSION_COLLISION', `session ${identity.sessionId} is already registered as ${collision.name}; a registered worker is never promoted, removed or rebound by adoption`) };
        }
        const portCollision = surveyed.scanned.config.agents.find(agent => agent.port === identity.port);
        if (portCollision !== undefined) {
            return { stop: halt('PORT_COLLISION', `port ${identity.port} is already used by ${portCollision.name}; a port is never guessed and a collision is refused before any write, including against the current coordinator entry`) };
        }
        const probe = await this.options.probe({ sessionId: board.sessionId, port: board.port });
        if (probe.state === 'connected') {
            return { stop: halt('OLD_CONNECTED', `configured coordinator ${board.sessionId} port ${board.port} still verifies at its endpoint; adoption stops and no record or config was written`) };
        }
        const transitionId = priorTransitionId ?? (this.options.uuid?.() ?? randomUUID()).toLowerCase();
        const previewHash = sha256(surveyed.scanned.raw);
        if (previousSessionId === undefined) {
            const code = surveyed.claim ? 'CLAIM_OTHER' : 'ADOPTION_REQUIRED';
            const record = surveyed.claim ? `record ${surveyed.claim.coordinator.sessionId}/${surveyed.claim.coordinator.port}; ` : 'claim absent; ';
            const proceed = await context.ui.confirm({ kind: 'adoptionDecision',
                prompt: `ADOPTION STOP ${code}: ${record}this session ${identity.sessionId}/${identity.port}; board ${board.sessionId}/${board.port} at ${surveyed.home}. No coordinator action is authorized. Continue to a NEW human adoption decision? Old endpoint ${probe.state}; disconnected and unknown are not evidence of termination.` });
            if (!proceed)
                return { stop: halt(code, `${record}this session ${identity.sessionId}/${identity.port}; board ${board.sessionId}/${board.port} — report both; wait for human decision`) };
        }
        const authority = await this.askAuthority(context, 'adoption', surveyed.home, previousSessionId ?? board.sessionId, `Board ${surveyed.home}: ${board.sessionId}/${board.port} → ${identity.sessionId}/${identity.port}. Old probe ${probe.state} (${probe.reason}); disconnected and unknown are NOT evidence of termination.`);
        if ('stop' in authority)
            return authority;
        const unchanged = leftUnchanged(surveyed.scanned);
        const fenced = unchanged.filter(entry => entry.closeJob !== null && FENCED_STATES.includes(entry.closeJob.state));
        const confirmed = await context.ui.confirm({
            kind: 'adoptTransition',
            prompt: `Transition ${transitionId}; config SHA256 ${previewHash}. Adopt the board at ${surveyed.home}: coordinator ${board.sessionId} port ${board.port} -> ${identity.sessionId} port ${identity.port}. `
                + `Old endpoint probe: ${probe.state} (${probe.reason}) — disconnected and unknown are not evidence of termination. `
                + `Left unchanged: ${roster(unchanged)}${fenced.length ? `; close jobs reported and left fenced: ${fenced.map(entry => `${entry.name}/${entry.closeJob.state}`).join(', ')}` : ''}. `
                + `No worker is sent anything, and nothing is resumed, removed, interrupted, reloaded or restarted. Confirm this exact transition.`,
        });
        if (!confirmed)
            return { stop: halt('CANCELLED', 'the exact transition was declined; no evidence, replacement or action is authorized') };
        return { authority: Object.freeze({ ...authority, decision: Object.freeze({ transitionId, boardRoot: surveyed.home,
                    configSha256: previewHash, previous: Object.freeze({ sessionId: board.sessionId, port: board.port }), coordinator: Object.freeze({ sessionId: identity.sessionId, port: identity.port }) }) }) };
    }
    /** AC4: the authority reference and the exact ended wording, or a named refusal. */
    async askAuthority(context, kind, home, oldSessionId = '', preview = '') {
        const record = await context.ui.input({
            kind: 'authorityRecord',
            prompt: kind === 'adoption'
                ? `${preview}\nAuthorising record for adopting the board at ${home}: a required reference to the human decision that authorised it.`
                : `Authorising record for declaring the first coordinator of ${home}: a required reference to the human decision that authorised it.`,
        });
        if (record === undefined)
            return { stop: halt('CANCELLED', 'the authority prompt was cancelled; nothing was written') };
        if (!bounded(record.trim(), 2000))
            return { stop: halt('CONFIRMATION', 'an authorising record is required; an empty answer cannot produce a claim') };
        const captured = (this.options.now?.() ?? new Date()).toISOString();
        if (kind === 'first-coordinator declaration')
            return { record: record.trim(), wording: record.trim(), confirmedEndedAt: captured };
        const wording = await context.ui.input({ kind: 'endedWording', placeholder: ENDED_WORDING(oldSessionId), prompt: `Type exactly: ${ENDED_WORDING(oldSessionId)}` });
        if (wording === undefined)
            return { stop: halt('CANCELLED', 'the ended-confirmation prompt was cancelled; nothing was written') };
        if (wording !== ENDED_WORDING(oldSessionId)) {
            return { stop: halt('CONFIRMATION', 'the required wording was not typed exactly; disconnected and unknown are not evidence of termination, and an approximation cannot confirm it') };
        }
        return { record: record.trim(), wording, confirmedEndedAt: (this.options.now?.() ?? new Date()).toISOString() };
    }
    // ---- the transaction -----------------------------------------------------------------
    /**
     * AC1–AC6. Inside one all-writer transaction, in this order: re-probe, prepare and commit the intent
     * record, replace exactly the two coordinator tokens, publish atomically, then write and commit the
     * active record and promote this running session. Any failure is phase-specific, keeps action
     * readiness closed, and is never reported as success or retried automatically.
     */
    async transaction(context, surveyed, board, authority, renewed) {
        const identity = surveyed.identity, home = surveyed.home, scanned = surveyed.scanned;
        const decision = authority.decision;
        if (!decision || decision.boardRoot !== home || decision.configSha256 !== sha256(scanned.raw)
            || decision.previous.sessionId !== board.sessionId || decision.previous.port !== board.port || decision.coordinator.sessionId !== identity.sessionId || decision.coordinator.port !== identity.port
            || (renewed && decision.transitionId !== renewed.transitionId))
            return halt('CONFIRMATION', 'the human decision is absent or not bound to this exact transition preview');
        const store = this.options.storeFor(home);
        const epoch = this.options.readiness.close();
        const unchanged = leftUnchanged(scanned);
        const previewHash = sha256(scanned.raw);
        try {
            const published = await store.transaction(async () => {
                await this.assertSnapshot(context, surveyed, epoch);
                const reentered = await this.options.probe({ sessionId: board.sessionId, port: board.port });
                if (reentered.state === 'connected')
                    return { stop: halt('OLD_CONNECTED', `configured coordinator ${board.sessionId} port ${board.port} verified connected inside the transaction; nothing was written`) };
                // Probes yield: recheck the exact ancestor-chain preview before any intent write.
                await this.assertSnapshot(context, surveyed, epoch);
                await this.phase('before-intent');
                const now = this.options.now?.() ?? new Date();
                const expected = patchCoordinatorEntry(scanned.raw, identity.sessionId, identity.port).after;
                const intent = {
                    schemaVersion: 1,
                    transitionId: decision.transitionId,
                    phase: 'prepared',
                    boardRoot: home,
                    coordinator: { sessionId: identity.sessionId, port: identity.port },
                    date: renewed?.date ?? now.toISOString().slice(0, 10),
                    authority: { kind: 'adoption', record: authority.record, confirmedEndedAt: authority.confirmedEndedAt, wording: authority.wording },
                    previous: { sessionId: board.sessionId, port: board.port, claimDate: await this.previousClaimDate(home, board) },
                    previousRecordCommit: surveyed.claimCommit ?? renewed?.previousRecordCommit ?? null,
                    configBeforeSha256: previewHash,
                    configAfterSha256: sha256(expected),
                    intentCommit: null,
                    leftUnchanged: unchanged,
                    rebriefSource: REBRIEF_SOURCE,
                };
                const prepared = await coded('GIT', () => this.writeCommit(home, renderClaim(intent), context, epoch));
                if (prepared === undefined) {
                    return { stop: halt('GIT', 'the prepared intent commit was not verifiable; the board is unchanged, no replacement happened, and the generated record is preserved in the worktree for inspection') };
                }
                await this.phase('prepared-committed');
                const result = await coded('PUBLISH', () => store.replaceCoordinatorEntry({
                    sessionId: identity.sessionId,
                    port: identity.port,
                    previewRawSha256: previewHash,
                    assertPreview: config => {
                        const current = coordinator(config);
                        if (current.sessionId !== board.sessionId || current.port !== board.port)
                            failAt('STALE_PREVIEW', 'the coordinator entry changed after the preview; a new preview and a new human decision are required');
                        if (config.agents.length !== scanned.config.agents.length)
                            failAt('STALE_PREVIEW', 'the roster changed after the preview; an old preview is never merged into a new roster');
                        if (config.agents.some(agent => agent.sessionId === identity.sessionId))
                            failAt('SESSION_COLLISION', 'the adopting session became a configured entry during the preview');
                        this.assertCurrent(context, epoch);
                    },
                    assertValid: () => { this.assertCurrent(context, epoch); this.assertPaths(surveyed); },
                }));
                if (sha256(result.after) !== intent.configAfterSha256) {
                    return { stop: halt('PUBLISH', 'the published config does not match the committed expected hash; the transaction stops and no active evidence was written') };
                }
                await this.phase('published');
                const reverified = await this.reverify(context, identity, epoch);
                if (reverified !== undefined)
                    return { stop: reverified };
                const active = { ...intent, phase: 'active', intentCommit: prepared };
                await this.phase('before-active-write');
                const activeCommit = await coded('GIT', () => this.writeCommit(home, renderClaim(active), context, epoch));
                await this.phase('active-committed');
                if (activeCommit === undefined) {
                    return { stop: halt('GIT', `the config was replaced and intent ${prepared} is committed, but the active evidence commit failed: fix the commit blocker and enter the same command, which recognizes this anchored prepared intent before any generic dirty refusal; no coordinator action, automatic retry, or rollback is performed`) };
                }
                return { prepared, activeCommit };
            });
            if ('stop' in published)
                return published.stop;
            const failure = await this.promote();
            await this.phase('promoted');
            if (failure !== undefined) {
                return halt('PROMOTION_PENDING', `active evidence ${published.activeCommit} is committed but local responsibility did not load: ${failure}; only an explicit write-free promotion retry is permitted, never another replacement`);
            }
            await this.openReady(context, identity, home);
            return succeed('OK', [`ADOPTION OK: ${board.sessionId} port ${board.port} → ${identity.sessionId} port ${identity.port}; transition ${(await this.readCommitRecord(home, published.prepared))?.transitionId ?? 'unknown'}; intent ${published.prepared}; active ${published.activeCommit}; left unchanged: ${roster(unchanged)}`]);
        }
        catch (error) {
            return halt(codeFor(error), `adoption stopped: ${reason(error)}; the action-readiness fence stays closed and no automatic retry is performed`);
        }
    }
    /** Fresh identity evidence at the last moment before the active record is written. */
    async reverify(context, identity, epoch) {
        try {
            this.assertCurrent(context, epoch);
        }
        catch {
            return halt('SESSION_CHANGED', 'session, trust, endpoint or action epoch changed during the transaction');
        }
        const own = await this.options.probe({ sessionId: identity.sessionId, port: identity.port }, { timeoutMs: 2000 });
        if (own.state !== 'connected')
            return halt('IDENTITY', `this endpoint no longer verifies session ${identity.sessionId} port ${identity.port}`);
        return undefined;
    }
    async previousClaimDate(home, board) {
        const commit = await this.latestClaimCommit(home);
        if (commit === undefined)
            return null;
        const bytes = await this.gitText(['show', `${commit}:${CLAIM_FILE}`], home, { tolerate: true });
        if (bytes === undefined)
            return null;
        try {
            const record = parseClaim(bytes);
            return record.coordinator.sessionId === board.sessionId && record.coordinator.port === board.port ? record.date : null;
        }
        catch {
            return null;
        }
    }
    async readCommitRecord(home, commit) {
        const bytes = await this.gitText(['show', `${commit}:${CLAIM_FILE}`], home, { tolerate: true });
        if (bytes === undefined)
            return undefined;
        try {
            return parseClaim(bytes);
        }
        catch {
            return undefined;
        }
    }
    // ---- supported clean and dirty reconciliation (templates §2.3) -----------------------
    /**
     * Recognized before any generic dirty-record refusal: verified committed prepared intent, plus a
     * worktree record that is either exactly those committed bytes or exactly the derived active bytes.
     * Finalizes evidence only. Never replaces, never restores, never normalizes, never reads authority,
     * previous identity, confirmation, timestamps, roster or hashes from uncommitted bytes.
     */
    async reconcile(context, surveyed) {
        const intent = surveyed.claim, intentCommit = surveyed.claimCommit, home = surveyed.home, identity = surveyed.identity;
        if (intent.coordinator.sessionId !== identity.sessionId || intent.coordinator.port !== identity.port) {
            return halt('RECOVERY_REQUIRED', `prepared transition ${intent.transitionId} names adopting session ${intent.coordinator.sessionId}; this session is ${identity.sessionId}; nothing is completed on behalf of another session`);
        }
        if (intent.previous === null)
            return halt('RECOVERY_REQUIRED', `prepared transition ${intent.transitionId} has no recorded previous identity; a prepared record is never reinterpreted as a first declaration`);
        const board = surveyed.scanned ? coordinator(surveyed.scanned.config) : undefined;
        if (board === undefined)
            return halt('NO_BOARD', 'the board disappeared during reconciliation; nothing is written');
        // A staged claim file is someone else's staged content and never this finalization's bytes.
        const staged = await this.trackedPaths(['diff', '--cached', '--name-only'], home);
        if (staged.length)
            return halt('RECOVERY_REQUIRED', `the real index contains staged paths (${staged.join(', ')}); no finalization is permitted`);
        if ((await this.dirtyPaths(home)).some(entry => entry.file !== CLAIM_FILE) || await this.unresolvedOperation(home))
            return halt('RECOVERY_REQUIRED', 'unrelated dirt or unresolved git operation blocks finalization; evidence is preserved');
        if (surveyed.worktreeRaw === undefined) {
            return halt('RECOVERY_REQUIRED', `${CLAIM_FILE} is absent from the worktree while ${intent.transitionId} is committed; restore it from commit ${intentCommit.slice(0, 8)} deliberately, not by this workflow`);
        }
        const worktree = surveyed.worktreeRaw;
        const clean = worktree === renderClaim(intent);
        const derived = renderClaim({ ...intent, phase: 'active', intentCommit });
        if (!clean && worktree !== derived) {
            return halt('RECOVERY_REQUIRED', `worktree ${CLAIM_FILE} is neither the committed prepared record nor exactly derived active bytes; no rewrite, normalization, commit or replacement is performed`);
        }
        if (JSON.stringify(leftUnchanged(surveyed.scanned)) !== JSON.stringify(intent.leftUnchanged))
            return halt('RECOVERY_REQUIRED', 'untouched roster evidence does not match the committed intent');
        if (intent.previousRecordCommit && (await this.git(['merge-base', '--is-ancestor', intent.previousRecordCommit, intentCommit], home)).code !== 0)
            return halt('RECOVERY_REQUIRED', 'prior claim commit is missing or unreachable');
        const hash = sha256(surveyed.scanned.raw);
        const matchesAfter = hash === intent.configAfterSha256;
        const matchesBefore = hash === intent.configBeforeSha256;
        if (!matchesAfter && !matchesBefore) {
            return halt('RECOVERY_REQUIRED', `the board matches neither the committed before-hash ${intent.configBeforeSha256} nor the after-hash ${intent.configAfterSha256}; report the transition, both identity pairs and all hashes to the human`);
        }
        if (!clean && !matchesAfter) {
            return halt('RECOVERY_REQUIRED', 'exactly derived active bytes are reconcilable only where the replacement already happened; the board does not show that, so nothing is touched');
        }
        if (clean && matchesBefore) {
            if (board.sessionId !== intent.previous.sessionId || board.port !== intent.previous.port || sha256(patchCoordinatorEntry(surveyed.scanned.raw, identity.sessionId, identity.port).after) !== intent.configAfterSha256)
                return halt('RECOVERY_REQUIRED', 'prepared-before identity or expected replacement hash is inconsistent');
            // Prepared + exact old config: the decision is recorded, the takeover is not. A new human
            // decision and a refreshed authority/timestamp commit precede completion, same transition id.
            const decided = await this.humanAdoptionDecision(context, surveyed, intent.previous.sessionId, intent.transitionId);
            if ('stop' in decided)
                return decided.stop;
            return this.transaction(context, surveyed, board, decided.authority, intent);
        }
        if (board.sessionId !== identity.sessionId || board.port !== identity.port)
            return halt('RECOVERY_REQUIRED', 'expected-after config does not name the recorded adopting pair');
        const confirmed = await context.ui.confirm({
            kind: 'finalizeTransition',
            prompt: `Finalize recorded transition ${intent.transitionId} without replacement: ${intent.previous.sessionId} port ${intent.previous.port} -> ${intent.coordinator.sessionId} port ${intent.coordinator.port}, which is already the board entry. `
                + `Evidence is ${clean ? 'clean committed prepared intent' : 'exactly derived active bytes already in the worktree'}. Commit that active evidence and promote this running session?`,
        });
        if (!confirmed)
            return halt('CANCELLED', 'finalization was declined; the existing evidence is preserved unchanged');
        const store = this.options.storeFor(home);
        const epoch = this.options.readiness.close();
        try {
            const activeCommit = await store.transaction(async () => {
                await this.assertSnapshot(context, surveyed, epoch);
                const unsafe = await this.assertGitSafe(home, context, epoch);
                if (unsafe !== undefined)
                    failAt(unsafe.code, reasonOf(unsafe));
                if (clean)
                    return coded('GIT', () => this.writeCommit(home, derived, context, epoch, { expectedDirty: false }));
                // Those bytes are already correct and workflow-derived: commit them as-is, never rewrite them.
                return coded('GIT', () => this.commitClaim(home, CLAIM_FILE, derived, context, epoch));
            });
            if (activeCommit === undefined) {
                return halt('GIT', 'the active evidence commit remains refused: fix the external commit blocker and enter the same command again; no replacement, repair write, hook bypass or automatic retry is performed');
            }
            const failure = await this.promote();
            if (failure !== undefined)
                return halt('PROMOTION_PENDING', `active evidence ${activeCommit} is committed but local responsibility did not load: ${failure}; explicit write-free promotion retry only`);
            await this.openReady(context, identity, home);
            return succeed('RECOVERED', [`ADOPTION RECOVERED: transition ${intent.transitionId}; intent ${intentCommit}; active ${activeCommit}; session ${intent.coordinator.sessionId} port ${intent.coordinator.port} — evidence finalized and promoted; no replacement`]);
        }
        catch (error) {
            return halt(codeFor(error), `finalization stopped: ${reason(error)}; the action-readiness fence stays closed and no retry is performed`);
        }
    }
    // ---- records, git, promotion ---------------------------------------------------------
    async openReady(context, identity, home) {
        const epoch = this.options.readiness.current();
        this.assertCurrent(context, epoch);
        const evidence = await bootClaimEvidence({ home, identity, git: this.git });
        const own = await this.options.probe(identity);
        this.assertCurrent(context, epoch);
        if (!evidence.ready || own.state !== 'connected' || !this.options.responsibilityLoaded()) {
            this.options.readiness.close('active evidence/identity changed before readiness');
            failAt('RECOVERY_REQUIRED', `readiness did not open: ${evidence.detail}; own endpoint ${own.state}; responsibility must be loaded`);
        }
        this.options.readiness.open();
    }
    async promote() {
        try {
            await this.phase('before-promotion');
            await this.options.promote();
            if (!this.options.responsibilityLoaded())
                return 'responsibility did not load';
            return undefined;
        }
        catch (error) {
            return reason(error);
        }
    }
    /**
     * Write outside any repository mutation, then commit this one path. An existing record with different
     * bytes is preserved unless it is recognized committed evidence, and never overwritten silently.
     */
    async writeCommit(home, content, context, epoch, settings = {}) {
        const target = path.join(home, CLAIM_FILE);
        const existing = await this.readOptional(target);
        if (existing !== undefined && existing !== content && !settings.expectedDirty) {
            const commit = await this.latestClaimCommit(home);
            const committed = commit === undefined ? undefined : await this.gitText(['show', `${commit}:${CLAIM_FILE}`], home, { tolerate: true });
            if (committed !== existing)
                failAt('RECORD', `${CLAIM_FILE} already exists with different bytes and is not recognized committed evidence; it is preserved untouched and nothing is written`);
        }
        const refused = await this.assertGitSafe(home, context, epoch);
        if (refused !== undefined)
            failAt(refused.code, reasonOf(refused));
        const temporary = `${target}.${this.options.uuid?.() ?? randomUUID()}.tmp`;
        const handle = await open(temporary, 'wx', 0o600);
        try {
            await handle.writeFile(content, 'utf8');
            await handle.sync();
            await handle.close();
            this.assertCurrent(context, epoch);
            await rename(temporary, target);
        }
        catch (error) {
            await handle.close().catch(() => { });
            await unlink(temporary).catch(() => { });
            throw error;
        }
        if (parseClaim(content).phase === 'active')
            await this.phase('active-written');
        return this.commitClaim(home, CLAIM_FILE, content, context, epoch);
    }
    /** Refuse unsafe layout, a non-repository home, a non-empty index, or unrelated worktree changes. */
    async assertGitSafe(home, context, epoch) {
        this.assertCurrent(context, epoch);
        try {
            const info = await lstat(path.join(home, CLAIM_FILE));
            if (!info.isFile())
                return halt('BOARD_PATH', 'claim path is not a regular file');
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                return halt('BOARD_PATH', 'claim path cannot be checked safely');
        }
        const canonical = await this.canonical(home);
        if (canonical !== home)
            return halt('BOARD_PATH', `projects home ${home} is not canonical (${String(canonical)}); no record is written`);
        const toplevel = await this.gitText(['rev-parse', '--show-toplevel'], home, { tolerate: true });
        if (toplevel === undefined || (await this.canonical(toplevel.trim())) !== home) {
            return halt('GIT', `projects home ${home} is not a git repository root; ${CLAIM_FILE} cannot be committed evidence`);
        }
        // Every staged path is refused, the claim file included. Staging this one path is permitted only as
        // the step immediately before its own path-scoped commit; a claim file already staged by someone else
        // is someone else's content, and this workflow never commits it.
        const staged = await this.trackedPaths(['diff', '--cached', '--name-only'], home);
        if (staged.length)
            return halt('GIT', `the git index already holds staged paths (${staged.join(', ')}); this workflow never commits another path's staged content`);
        const unresolved = await this.unresolvedOperation(home);
        if (unresolved !== undefined)
            return halt('GIT', `an unresolved git operation is in progress (${unresolved}); nothing is written`);
        // Refuse unrelated pending work, including untracked files. Tooling/session directories are
        // gitignored by the projects-home contract, not an excuse to sweep or ignore unrelated changes.
        const unrelated = (await this.dirtyPaths(home)).filter(entry => entry.file !== CLAIM_FILE);
        if (unrelated.length)
            return halt('GIT', `tracked files outside the claim record are modified (${unrelated.map(entry => entry.file).join(', ')}); this workflow never commits them`);
        return undefined;
    }
    async trackedPaths(args, home) {
        const output = await this.gitText(args, home);
        return output === undefined ? [] : output.split('\n').filter(Boolean);
    }
    /** Paths git reports as changed; no failed git query counts as an empty result. */
    async dirtyPaths(home) {
        const output = await this.gitText(['-c', 'core.quotepath=false', 'status', '--porcelain=v1', '--untracked-files=all'], home);
        return output === undefined ? [] : statusPaths(output);
    }
    async unresolvedOperation(home) {
        const directory = (await this.gitText(['rev-parse', '--absolute-git-dir'], home, { tolerate: true }))?.trim();
        if (directory === undefined)
            return 'missing git directory';
        for (const marker of ['MERGE_HEAD', 'REBASE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'BISECT_LOG']) {
            try {
                await readFile(path.join(directory, marker));
                return marker;
            }
            catch { /* absent */ }
        }
        for (const nested of ['rebase-merge', 'rebase-apply']) {
            if (await isDirectory(path.join(directory, nested)))
                return nested;
        }
        return undefined;
    }
    /** `git commit --only <claim>` with argv, then verify HEAD, its changed-path set, and the bytes. */
    async commitClaim(home, claimedPath, content, context, epoch) {
        this.assertCurrent(context, epoch);
        // Re-check immediately before committing: the window between the caller's decision and the commit
        // is exactly where another writer or a human edit could otherwise be swept in.
        const refused = await this.assertGitSafe(home, context, epoch);
        if (refused !== undefined)
            failAt(refused.code, reasonOf(refused));
        // `commit --only` refuses a pathspec git does not know yet, and a first declaration creates this file.
        // Staging only this one path, after the empty-index gate above, is therefore required, and
        // `--only` still commits nothing else: the verification below refuses any sweep.
        const previousHead = (await this.gitText(['rev-parse', 'HEAD'], home))?.trim();
        const known = await this.git(['ls-files', '--error-unmatch', '--', claimedPath], home);
        if (known.code !== 0) {
            // Intent-to-add makes a new path known without staging generated content. A rejected hook leaves
            // an empty real index, so explicit recovery cannot be blocked by our own staged bytes.
            const added = await this.git(['add', '--intent-to-add', '--', claimedPath], home);
            if (added.code !== 0)
                failAt('GIT', 'could not mark the new claim path intent-to-add');
        }
        const configured = await this.git(['config', 'user.email'], home);
        const identity = configured.code === 0 && configured.stdout.trim() !== '' ? [] : ['-c', 'user.name=Pi Intercom', '-c', 'user.email=pi-intercom@localhost'];
        const committed = await this.git([...identity, 'commit', '--only', claimedPath, '-m', 'chore(coordinator-claim): coordinator evidence'], home);
        if (committed.code !== 0) {
            // Generated bytes stay in the worktree for this workflow to recognize later. Never restored, never
            // swept, never committed with another path, and no hook is bypassed or disabled.
            failAt('GIT', `git commit --only ${claimedPath} failed (exit ${committed.code}); the generated record is preserved in the worktree for explicit reconciliation`);
        }
        const head = (await this.gitText(['rev-parse', 'HEAD'], home))?.trim();
        if (head === undefined || !COMMIT.test(head))
            failAt('GIT', 'the resulting commit could not be read');
        if ((await this.gitText(['rev-parse', `${head}^`], home))?.trim() !== previousHead)
            failAt('GIT', 'HEAD advanced outside the single claim commit');
        const afterHook = await this.assertGitSafe(home, context, epoch);
        if (afterHook)
            failAt(afterHook.code, reasonOf(afterHook));
        const changed = await this.trackedPaths(['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'], home);
        if (changed.length !== 1 || changed[0] !== claimedPath)
            fail(`commit ${head} changed unexpected paths (${changed.join(', ')}); the evidence is refused`);
        if ((await this.gitText(['show', `${head}:${claimedPath}`], home)) !== content || await this.readOptional(path.join(home, claimedPath)) !== content || await this.latestClaimCommit(home) !== head)
            failAt('GIT', `commit/worktree ${head} does not contain the exact generated record bytes; evidence is refused`);
        const record = parseClaim(content), config = await this.options.storeFor(home).readStrict();
        if (sha256(config.raw) !== (record.phase === 'prepared' ? record.configBeforeSha256 : record.configAfterSha256))
            failAt('STALE_PREVIEW', 'config changed during record commit; no further publication or promotion');
        this.assertCurrent(context, epoch);
        return head;
    }
    /** Cheap local invariants. Pi's queue and the board lock are owned by ConfigStore's transaction. */
    assertCurrent(context, epoch) {
        if (this.options.readiness.current() !== epoch)
            failAt('SESSION_CHANGED', 'the action-readiness epoch changed; this transaction stops without further effects');
        if (!context.isIdle() || this.options.busy())
            failAt('BUSY', 'host became busy during the decision; no action is replayed');
        if (!this.launchRole().authorized)
            failAt('AUTH', 'launch role is no longer authorized');
        if (this.options.endpointPort() === undefined)
            failAt('SESSION_CHANGED', 'this runtime endpoint is gone');
        if (!context.isProjectTrusted())
            failAt('TRUST', 'project trust was lost during the transaction');
        if (context.sessionManager.getSessionId() !== this.options.sessionId())
            failAt('SESSION_CHANGED', 'the command context session is no longer this runtime session');
    }
    /** A fixture barrier delays at a named phase boundary and never changes an outcome. */
    async phase(name) {
        await this.options.phase?.(name);
    }
    async readOptional(file) {
        try {
            return await readFile(file, 'utf8');
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return undefined;
            throw error;
        }
    }
    async gitText(args, cwd, settings = {}) {
        const result = await this.git(args, cwd);
        if (result.code !== 0) {
            if (settings.tolerate)
                return undefined;
            failAt('GIT', `git ${args[0]} failed (exit ${result.code}); no assumption replaces verified repository state`);
        }
        return result.stdout;
    }
}
/** Repository-local context reported by Git's `rev-parse --local-env-vars`, plus discovery,
 * namespace and configuration overrides. Trace/pager/SSH/prompt/unknown variables do not create a
 * repository context. Keep this explicit: a broad GIT_* rule would break ordinary non-repo users. */
const GIT_CONTEXT_ENV = new Set([
    'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT',
    'GIT_OBJECT_DIRECTORY', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_IMPLICIT_WORK_TREE', 'GIT_GRAFT_FILE',
    'GIT_INDEX_FILE', 'GIT_NO_REPLACE_OBJECTS', 'GIT_REPLACE_REF_BASE', 'GIT_PREFIX', 'GIT_SHALLOW_FILE',
    'GIT_COMMON_DIR', 'GIT_NAMESPACE', 'GIT_CEILING_DIRECTORIES', 'GIT_DISCOVERY_ACROSS_FILESYSTEM',
    'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM',
]);
/** Ordinary legacy writers may bypass the claim gate only when neither current bytes nor reachable
 * claim history exists. A missing worktree file cannot erase prepared/active (or deletion) history. */
export async function claimEvidenceEstablished(home) {
    try {
        await lstat(path.join(home, CLAIM_FILE));
        return true;
    }
    catch (error) {
        if (error.code !== 'ENOENT')
            throw error;
    }
    // Git discovers ancestor .git directories/files AND bare repositories. Missing/damaged individual
    // bare markers are uncertainty too. Configured Git context (including config injection, alternate
    // object/common directories and discovery overrides) also requires the actual query. No cached
    // 'never adopted' bit: every absence is rediscovered, and deletion history is never bypassed.
    let repositoryPossible = Object.keys(process.env).some(key => {
        const name = process.platform === 'win32' ? key.toUpperCase() : key;
        return GIT_CONTEXT_ENV.has(name) || /^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(name);
    });
    for (let at = home; !repositoryPossible; at = path.dirname(at)) {
        for (const marker of ['.git', 'HEAD', 'objects', 'refs', 'packed-refs', 'commondir']) {
            try {
                lstatSync(path.join(at, marker));
                repositoryPossible = true;
                break;
            }
            catch (error) {
                if (error.code !== 'ENOENT') {
                    repositoryPossible = true;
                    break;
                }
            }
        }
        if (path.dirname(at) === at)
            break;
    }
    if (!repositoryPossible)
        return false;
    const log = await runGit(latestClaimArgs(), home);
    if (log.code !== 0)
        fail('ADOPTION_NOT_READY: claim history cannot be verified');
    return log.stdout.trim() !== '';
}
const latestClaimArgs = () => ['log', '--format=%H', '-n', '1', '--', CLAIM_FILE];
function evidenceText(result) {
    if (result.code !== 0)
        throw Error('claim evidence unavailable');
    return result.stdout;
}
function* activeIntentProof(record, raw, commit) {
    if (record.phase !== 'active')
        throw Error('claim is not active');
    if (record.authority.kind === 'first-coordinator declaration')
        return;
    if (!record.intentCommit)
        throw Error('active adoption lacks prepared intent');
    const intent = parseClaim(evidenceText(yield ['show', `${record.intentCommit}:${CLAIM_FILE}`]));
    evidenceText(yield ['merge-base', '--is-ancestor', record.intentCommit, commit]);
    if (intent.phase !== 'prepared' || renderClaim({ ...intent, phase: 'active', intentCommit: record.intentCommit }) !== raw)
        throw Error('active bytes do not derive from prepared intent');
}
function* activeEvidenceProof(home, raw) {
    const record = parseClaim(raw);
    if (record.boardRoot !== home || record.phase !== 'active')
        throw Error('claim board/phase mismatch');
    const commit = evidenceText(yield latestClaimArgs()).trim();
    if (!COMMIT.test(commit) || evidenceText(yield ['show', `${commit}:${CLAIM_FILE}`]) !== raw)
        throw Error('claim differs from latest committed evidence');
    yield* activeIntentProof(record, raw, commit);
    return { record, commit };
}
async function verifyEvidenceAsync(proof, git) {
    let step = proof.next();
    while (!step.done)
        step = proof.next(await git(step.value));
    return step.value;
}
/** Synchronous final-effect adapter; the whole proof is fresh on every invocation. */
export function committedActiveClaimMatches(home, raw) {
    try {
        const proof = activeEvidenceProof(home, raw);
        let step = proof.next();
        while (!step.done) {
            const result = spawnSync('git', step.value, { cwd: home, encoding: 'utf8', timeout: 2000, maxBuffer: 262144, windowsHide: true });
            if (result.error)
                return false;
            step = proof.next({ code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr });
        }
        return true;
    }
    catch {
        return false;
    }
}
const FENCED_STATES = ['requested', 'awaiting_handoff', 'awaiting_settlement', 'ready', 'closing', 'uncertain'];
/**
 * Boot-time AC2 read (no UI, no writes): the committed active record must name this exact board and this
 * exact coordinator pair. Anything else leaves coordinator action readiness closed. An absent, malformed,
 * uncommitted, prepared, or foreign record is never treated as approval, and never as a first declaration
 * for an anonymous session.
 */
export async function bootClaimEvidence(input) {
    const git = input.git ?? runGit;
    let raw;
    try {
        if (await realpath(input.home) !== input.home || !(await lstat(input.home)).isDirectory())
            return { ready: false, detail: 'unsafe board home' };
        const directory = await lstat(path.join(input.home, CONFIG_DIRECTORY));
        if (!directory.isDirectory() || directory.isSymbolicLink())
            return { ready: false, detail: 'unsafe board directory' };
        for (const file of [path.join(input.home, CLAIM_FILE), path.join(input.home, CONFIG_DIRECTORY, 'config.json')]) {
            if (!(await lstat(file)).isFile())
                return { ready: false, detail: 'unsafe claim/config path' };
        }
        const scanned = await new ConfigStore(input.home).readStrict(), board = coordinator(scanned.config);
        if (board.sessionId !== input.identity.sessionId || board.port !== input.identity.port)
            return { ready: false, detail: 'claim identity differs from current coordinator entry' };
        raw = await readFile(path.join(input.home, CLAIM_FILE), 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return { ready: false, detail: `${CLAIM_FILE} is absent: a first-coordinator declaration must be committed before any coordinator action` };
        return { ready: false, detail: `${CLAIM_FILE} is unreadable: ${reason(error)}` };
    }
    try {
        const { record, commit } = await verifyEvidenceAsync(activeEvidenceProof(input.home, raw), args => git(args, input.home));
        if (record.coordinator.sessionId !== input.identity.sessionId || record.coordinator.port !== input.identity.port)
            return { ready: false, detail: `${CLAIM_FILE} coordinator pair differs from this session` };
        return { ready: true, detail: `${CLAIM_FILE} active evidence matches this board and session (commit ${commit})` };
    }
    catch (error) {
        return { ready: false, detail: `${CLAIM_FILE} is not verified committed active evidence: ${reason(error)}` };
    }
}
function declaration(surveyed, authority, options) {
    const hash = sha256(surveyed.scanned.raw);
    return {
        schemaVersion: 1,
        transitionId: (options.uuid?.() ?? randomUUID()).toLowerCase(),
        phase: 'active',
        boardRoot: surveyed.home,
        coordinator: { sessionId: surveyed.identity.sessionId, port: surveyed.identity.port },
        date: (options.now?.() ?? new Date()).toISOString().slice(0, 10),
        authority: { kind: 'first-coordinator declaration', record: authority.record, confirmedEndedAt: null, wording: authority.record },
        previous: null,
        previousRecordCommit: null,
        configBeforeSha256: hash,
        configAfterSha256: hash,
        intentCommit: null,
        leftUnchanged: leftUnchanged(surveyed.scanned),
        rebriefSource: REBRIEF_SOURCE,
    };
}
function declared(identity, commit) {
    return [`CLAIM DECLARED: session ${identity.sessionId} port ${identity.port} — ${CLAIM_FILE} committed ${commit}; first-coordinator evidence; write-and-continue`];
}
function bootDescription(state, board, own) {
    if (state === 'a')
        return 'no board found between cwd and the projects home (ConfigStore.discover; Runtime.start initialization branch)';
    if (state === 'b')
        return 'own sessionId is the coordinator entry (requireCoordinator; Runtime.start coordinator branch)';
    if (state === 'c')
        return `own sessionId is worker entry ${own?.name ?? 'unknown'} (validateConfig unique ids and the reserved Coordinator name; requireCoordinator rejects a worker)`;
    return `own sessionId is absent, so this session is an anonymous worker while the board names ${board.name} (${board.sessionId}) (Runtime.start anonymous registration branch)`;
}
function codeFor(error) {
    if (error instanceof AdoptionFailure)
        return error.code;
    if (error instanceof StaleConfigLock)
        return 'LOCKED';
    if (error instanceof ConfigPreviewChanged)
        return 'STALE_PREVIEW';
    // An unclassified internal error is an unavailable surface, never a named safety outcome. Reporting an
    // unexpected failure as STALE_PREVIEW would tell an operator something specific that is not true.
    return 'HOST';
}
function reason(error) {
    const message = String(error).replace(/^PiIntercom:\s*/, '').replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
    return message.length > 240 ? `${message.slice(0, 240)}…` : message;
}
/**
 * A named refusal raised at the call site that knows which step failed. Codes are never inferred from
 * error prose: an unrelated internal error must not be reported to an operator as a specific safety
 * verdict such as a stale preview.
 */
export class AdoptionFailure extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'AdoptionFailure';
    }
}
function failAt(code, message) { throw new AdoptionFailure(code, message); }
/** Run a step whose failure has one meaning, so its code comes from here rather than from wording. */
async function coded(code, run) {
    try {
        return await run();
    }
    catch (error) {
        if (error instanceof AdoptionFailure || error instanceof StaleConfigLock || error instanceof ConfigPreviewChanged)
            throw error;
        throw new AdoptionFailure(code, reason(error));
    }
}
function reasonOf(result) {
    return result.lines[result.lines.length - 1] ?? 'refused';
}
/**
 * `git status --porcelain=v1` lines are `<XY><space><path>`. Both tracked and untracked unrelated
 * work blocks the path-scoped transaction; tooling-owned ignored state is absent from this output.
 */
function statusPaths(output) {
    return output.split('\n').filter(Boolean).map(line => ({
        untracked: line.startsWith('??'),
        file: /^[ MARCUD?!]{2} /.test(line) ? line.slice(3) : line,
    })).filter(entry => entry.file !== '');
}
//# sourceMappingURL=adoption.js.map