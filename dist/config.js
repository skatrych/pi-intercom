import { mkdir, readFile, realpath, rename, unlink, open, link, stat, lstat } from 'node:fs/promises';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { AsyncLocalStorage } from 'node:async_hooks';
import { fencedClose, validateHandoff, validateCloseJob } from './handoff.js';
import { acquireConfigLock, CONFIG_LOCK_FILE, nativeLockProvider } from './native-lock.js';
/** Logical role names only. Same alphabet as pi-role, bounded for Intercom storage. Callers cannot pass a path or shell fragment. */
export const ROLE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
/** Names apply.sh refuses to install. They are not Pi roles. */
export const RESERVED_ROLES = new Set(['credentials', 'auth.json', 'sessions', 'history', 'cache']);
export function logicalRole(value) {
    return typeof value === 'string' && ROLE_NAME.test(value) && !RESERVED_ROLES.has(value);
}
/** Intercom metadata for the worker extension. It does not load the role. */
export const WORKER_ROLE_ENV = 'PI_INTERCOM_WORKER_ROLE';
/** Optional executable used instead of `pi-role` on PATH. Not a role-to-directory map. */
export const ROLE_LAUNCHER_ENV = 'PI_INTERCOM_ROLE_LAUNCHER';
export const DEFAULT_ROLE_LAUNCHER = 'pi-role';
export const DEFAULT_DESCRIPTION = 'Coordinate workers, delegate work, and manage shared configuration.';
export const key = (name) => name.toLowerCase();
/** Canonical-path comparison. Windows paths are case-insensitive, so a case-only difference is not an alias. */
export function sameCanonicalPath(left, right) {
    return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}
export function fail(message) { throw new Error(`PiIntercom: ${message}`); }
export function text(value, field, max = 4096) {
    if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0'))
        fail(`invalid ${field}`);
}
export function port(value) {
    if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 65535)
        fail('invalid port');
}
export function relativeDirectory(value) {
    text(value, 'projectDirectory');
    if (path.isAbsolute(value) || path.win32.isAbsolute(value) || value.split(/[\\/]/).includes('..'))
        fail('projectDirectory must be root-relative, without ..');
}
export function validateConfig(value) {
    const c = value;
    if (!c || c.version !== 1 || !['herdr', 'none'].includes(c.multiplexer) || !Array.isArray(c.agents))
        fail('invalid config schema/version');
    const names = new Set(), ids = new Set();
    for (const a of c.agents) {
        if (!a || typeof a.coordinator !== 'boolean')
            fail('invalid agent');
        text(a.sessionId, 'sessionId', 256);
        text(a.name, 'name', 128);
        text(a.description, 'description');
        if (a.role !== undefined) {
            if (a.coordinator)
                fail('role is worker-only');
            if (!logicalRole(a.role))
                fail('invalid role');
        }
        if (a.name !== a.name.trim() || /[\r\n\x00-\x1f]/.test(a.name))
            fail('invalid name');
        port(a.port);
        relativeDirectory(a.projectDirectory);
        if (a.handoff !== undefined) {
            if (a.coordinator)
                fail('handoff is worker-only');
            validateHandoff(a.handoff);
        }
        if (a.closeJob !== undefined) {
            if (a.coordinator)
                fail('closeJob is worker-only');
            validateCloseJob(a.closeJob);
        }
        if (a.dashboardPort !== undefined) {
            if (!a.coordinator)
                fail('dashboardPort is coordinator-only');
            port(a.dashboardPort);
        }
        if (names.has(key(a.name)) || ids.has(a.sessionId))
            fail('duplicate name or session ID');
        names.add(key(a.name));
        ids.add(a.sessionId);
        if (a.coordinator ? (a.name !== 'Coordinator' || a.projectDirectory !== '.') : key(a.name) === 'coordinator')
            fail('reserved Coordinator identity');
    }
    if (c.agents.filter(a => a.coordinator).length !== 1)
        fail('config requires exactly one coordinator');
    return c;
}
export const coordinator = (c) => c.agents.find(a => a.coordinator);
function boundedKey(name) {
    const clean = name.replace(/[\x00-\x1f\x7f-\x9f]/g, '');
    return JSON.stringify(clean.length > 64 ? `${clean.slice(0, 64)}…` : clean);
}
export const sha256 = (text) => createHash('sha256').update(text).digest('hex');
/**
 * ADR 0025 P2: `JSON.parse` owns JSON grammar and values. This lexical pass adds only the two refusals
 * that a value tree cannot express afterwards, and it is not a second parser:
 *
 * 1. **Ambiguous duplicate keys.** `JSON.parse` silently keeps the last value. A board config that says
 *    one thing twice has no defined meaning, so it is a configuration error rather than a last-one-wins
 *    parse — at any depth, including an escaped alias of an earlier name.
 * 2. **Numbers that cannot roundtrip.** A token that overflows the exact double set, or a negative zero,
 *    would be silently rewritten by re-serialization. Refusing is honest; converting is not.
 *
 * Object/array frames are tracked, full string tokens (including escapes) are skipped as units, and a
 * string followed by `:` is decoded with `JSON.parse` so escaped keys compare by their real name.
 */
function assertLexicalSafety(raw, source) {
    const frames = [];
    const space = (value, from) => {
        let at = from;
        while (at < value.length && (value[at] === ' ' || value[at] === '\t' || value[at] === '\r' || value[at] === '\n'))
            at++;
        return at;
    };
    let at = 0;
    for (;;) {
        at = space(raw, at);
        if (at >= raw.length)
            break;
        const character = raw[at];
        if (character === '{' || character === '[') {
            frames.push({ object: character === '{', keys: new Set() });
            at++;
            continue;
        }
        if (character === '}' || character === ']') {
            if (!frames.pop())
                fail(`${source} is malformed JSON`);
            at++;
            continue;
        }
        if (character === ',' || character === ':') {
            at++;
            continue;
        }
        if (character === '"') {
            const start = at;
            at++;
            for (;;) {
                if (at >= raw.length)
                    fail(`${source} is malformed JSON`);
                const inner = raw[at];
                if (inner === '\\') {
                    at += 2;
                    continue;
                }
                if (inner === '"') {
                    at++;
                    break;
                }
                at++;
            }
            const end = at;
            const frame = frames[frames.length - 1];
            if (frame?.object && raw[space(raw, end)] === ':') {
                const decoded = JSON.parse(raw.slice(start, end));
                if (typeof decoded !== 'string')
                    fail(`${source} is malformed JSON`);
                if (frame.keys.has(decoded))
                    fail(`${source} has duplicate key ${boundedKey(decoded)}`);
                frame.keys.add(decoded);
            }
            continue;
        }
        const start = at;
        while (at < raw.length && !',}] \t\r\n"'.includes(raw[at]))
            at++;
        const token = raw.slice(start, at);
        if (token === 'true' || token === 'false' || token === 'null')
            continue;
        const value = Number(token);
        if (!Number.isFinite(value) || Object.is(value, -0) || (/^-?\d+$/.test(token) && !Number.isSafeInteger(value))) {
            fail(`${source} has the number ${boundedKey(token)}, which cannot roundtrip without changing value`);
        }
    }
    if (frames.length)
        fail(`${source} is malformed JSON`);
}
/**
 * Every value that survives a parse/serialize roundtrip, and nothing else. `undefined`, functions,
 * symbols, BigInts, non-plain objects, NaN, Infinity and negative zero would be dropped or rewritten by
 * `JSON.stringify`, so a config carrying one is refused instead of quietly losing data.
 */
function assertRoundtrippable(value, source, depth = 0) {
    if (depth > 64)
        fail(`${source} nests too deeply to serialize safely`);
    if (value === null || typeof value === 'boolean' || typeof value === 'string')
        return;
    if (typeof value === 'number') {
        if (!Number.isFinite(value) || Object.is(value, -0) || (Number.isInteger(value) && !Number.isSafeInteger(value)))
            fail(`${source} has a number that cannot roundtrip without changing value`);
        return;
    }
    if (typeof value !== 'object')
        fail(`${source} has a ${typeof value} value, which JSON cannot represent`);
    if (Array.isArray(value)) {
        for (const item of value)
            assertRoundtrippable(item, source, depth + 1);
        return;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
        fail(`${source} has a non-plain object value`);
    for (const item of Object.values(value))
        assertRoundtrippable(item, source, depth + 1);
}
/**
 * The one config reader for every decision and permission check. Grammar belongs to `JSON.parse`;
 * ambiguity and unsafe numbers are refused here, so a sync current-config check and an async admission
 * read can never disagree about what the same bytes mean.
 */
export function parseConfig(raw, source = 'config') {
    if (typeof raw !== 'string')
        fail(`${source} is missing`);
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        fail(`${source} is malformed JSON`);
    }
    assertLexicalSafety(raw, source);
    return { raw, config: validateConfig(parsed) };
}
/**
 * The one config writer: validate the whole parsed object, serialize it, and prove the output re-reads
 * as exactly the intended value tree. Formatting may normalize; no other parsed value may change, and a
 * value that would not survive is refused before anything is staged.
 */
export function serializeConfig(config, source = 'config') {
    validateConfig(config);
    assertRoundtrippable(config, source);
    const serialized = `${JSON.stringify(config, null, 2)}\n`;
    const reread = parseConfig(serialized, source);
    if (!isDeepStrictEqual(reread.config, config))
        fail(`${source} did not roundtrip without loss; nothing was written`);
    return serialized;
}
/** A deep, prototype-free copy of parsed JSON, used so a mutation can never touch a frozen preview. */
function clone(config) {
    return JSON.parse(JSON.stringify(config));
}
export class ConfigPreviewChanged extends Error {
}
export function named(c, name) {
    text(name, 'to', 128);
    return c.agents.find(a => key(a.name) === key(name)) ?? fail(`unknown recipient ${name}`);
}
/** Locate the coordinator entry by session id. NOT sufficient publication authority: see `requireCoordinatorPair`. */
export function requireCoordinator(c, id) {
    const a = c.agents.find(a => a.sessionId === id);
    return a?.coordinator ? a : fail('coordinator permission required');
}
/**
 * The current-config permission (ADR 0025). The board's coordinator `sessionId` and `port` are the whole
 * authority, so an entry that matches only the id is not authorized: the actually bound endpoint must
 * match too. Binding a port is never itself authority to change this entry.
 */
export function requireCoordinatorPair(c, caller) {
    text(caller.sessionId, 'sessionId', 256);
    port(caller.port);
    const a = requireCoordinator(c, caller.sessionId);
    if (a.port !== caller.port)
        fail('coordinator endpoint pair does not match the board; restart this session or adopt with a fresh session');
    return a;
}
/** Same exact-pair authority shape used for the two narrow operations that change only identity fields. */
export function requireCoordinatorEntry(c, sessionId, expectedPort) {
    text(sessionId, 'sessionId', 256);
    port(expectedPort);
    const a = requireCoordinator(c, sessionId);
    if (a.port !== expectedPort)
        fail('coordinator entry no longer has the expected port');
    return a;
}
export async function directory(root, requested) {
    text(requested, 'projectDirectory');
    const base = await realpath(root), target = await realpath(path.resolve(root, requested));
    const rel = path.relative(base, target);
    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel))
        fail('project directory must be coordinator root or descendant (including symlinks)');
    if (!(await stat(target)).isDirectory())
        fail('projectDirectory is not a directory');
    return rel.split(path.sep).join('/') || '.';
}
/** Process-local per-file serialization shared by every store instance for the same path. */
const processQueues = new Map();
const insideTransaction = new AsyncLocalStorage();
const RENAME_DELAYS = [10, 20, 40, 80];
const RENAME_BUDGET_MS = 250;
export class ConfigStore {
    root;
    options;
    file;
    canonicalRoot;
    constructor(root, options = {}) {
        this.root = root;
        this.options = options;
        this.file = path.join(root, '.pi-intercom', 'config.json');
    }
    async assertLocalPaths() {
        const root = await realpath(this.root);
        if (this.canonicalRoot === undefined)
            this.canonicalRoot = root;
        else if (root !== this.canonicalRoot)
            fail('config root canonical location changed');
        // Reject existing escaping links/junctions before following them for any
        // config access. These path checks are best effort, not TOCTOU protection.
        for (const [location, isDirectory] of [[path.dirname(this.file), true], [this.file, false]]) {
            try {
                await lstat(location);
            }
            catch (error) {
                if (error.code === 'ENOENT')
                    continue;
                throw error;
            }
            let resolved;
            try {
                resolved = await realpath(location);
            }
            catch {
                fail('local config path cannot be resolved safely');
            }
            const relative = path.relative(root, resolved);
            if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
                fail('local config path escapes session root');
            const metadata = await stat(resolved);
            if (isDirectory ? !metadata.isDirectory() : !metadata.isFile())
                fail('invalid local config path type');
        }
    }
    async validateRoot(expectedCanonicalRoot) {
        await this.assertLocalPaths();
        if (this.canonicalRoot !== expectedCanonicalRoot)
            fail('config root canonical location changed');
    }
    /** Ordinary read: the same strict reader as adoption and boot recovery. */
    async read() {
        // Missing, malformed and unreadable local files propagate; no fallback.
        return (await this.readDocument()).config;
    }
    /** Raw bytes plus the validated value tree. The raw bytes bind a displayed preview against staleness. */
    async readDocument() {
        await this.assertLocalPaths();
        return parseConfig(await readFile(this.file, 'utf8'));
    }
    /** Synchronous current-config read for final-effect guards that cannot await. Same reader, same refusals. */
    readDocumentSync() {
        return parseConfig(readFileSync(this.file, 'utf8'));
    }
    /** The permanent, never-deleted guard file that carries the native all-writer lock (P1). */
    get lockFile() { return path.join(path.dirname(this.file), CONFIG_LOCK_FILE); }
    /**
     * One exclusive transaction for every config publication. Fixed acquisition order is this outer queue
     * (Pi's per-file mutation queue in the installed store) -> the process-local per-file queue -> the
     * native kernel lock; never acquire them in a nested or reversed order. Re-entrant inside one async
     * chain, so an adoption transaction can call other publication methods without re-acquiring anything:
     * a nested call never enters a second queue and never takes a second lock. The process-local queue
     * waits; the kernel lock never waits, steals, or retries, so cross-process contention fails closed and
     * a crashed holder releases it without cleanup. Release is this transaction's own handle only.
     */
    async transaction(run) { return this.exclusive(run); }
    /** Override point for an outer per-file queue. Do not override `transaction` or `exclusive` instead. */
    outerQueue(run) { return run(); }
    async exclusive(run) {
        // Async-local, not instance, nesting: an adoption transaction may call other publication methods,
        // while two concurrent independent writes on the same instance must still serialize.
        const held = insideTransaction.getStore();
        if (held?.has(this.file)) {
            held.get(this.file)();
            return run();
        }
        return this.outerQueue(async () => {
            const queueKey = this.file;
            const previous = processQueues.get(queueKey) ?? Promise.resolve();
            const operation = previous.then(async () => {
                await this.prepareTransaction();
                const lock = await acquireConfigLock(this.lockFile, this.options.lockProvider ?? nativeLockProvider);
                const locks = new Map(held);
                locks.set(this.file, lock.assertHeld);
                let outcome;
                try {
                    outcome = { ok: true, value: await insideTransaction.run(locks, run) };
                }
                catch (error) {
                    outcome = { ok: false, error };
                }
                // Preserve the original publication outcome: a release failure only becomes the reported error
                // when the transaction itself succeeded. The handle is always closed.
                const releaseFailure = await lock.release();
                if (!outcome.ok)
                    throw outcome.error;
                if (releaseFailure)
                    throw releaseFailure;
                return outcome.value;
            });
            const settled = operation.then(() => undefined, () => undefined);
            processQueues.set(queueKey, settled);
            void settled.then(() => { if (processQueues.get(queueKey) === settled)
                processQueues.delete(queueKey); });
            return operation;
        });
    }
    /**
     * Path validity and the metadata directory, established before the guard file can exist. A missing
     * directory is created here (mode 0700) and nowhere else, so a writer never follows an escaping link
     * and never creates board state in an unvalidated location.
     */
    async prepareTransaction() {
        await this.assertLocalPaths();
        this.assertSafePaths();
        await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
        this.assertSafePaths();
    }
    assertSafePaths() {
        if (realpathSync(this.root) !== path.resolve(this.root))
            fail('unsafe config root alias');
        for (const directory of [this.root, path.dirname(this.file)]) {
            try {
                const info = lstatSync(directory);
                if (!info.isDirectory() || info.isSymbolicLink())
                    fail('unsafe config directory');
            }
            catch (error) {
                if (error.code !== 'ENOENT')
                    throw error;
            }
        }
        try {
            if (!lstatSync(this.file).isFile())
                fail('unsafe config file');
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
        }
    }
    /**
     * Every publication path passes here first. The held-handle/guard identity check is independent of any
     * caller guard, so a caller cannot publish without the transaction lock it never sees.
     */
    publicationGuard(assertValid) {
        const guard = insideTransaction.getStore()?.get(this.file);
        if (!guard)
            fail('config publication requires its exclusive transaction');
        guard();
        this.assertSafePaths();
        assertValid();
    }
    static async discover(cwd) {
        const store = new ConfigStore(await realpath(cwd));
        try {
            await store.read();
            return store;
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
            return undefined;
        }
    }
    static async workspace(cwd, workspaceRoot) {
        text(workspaceRoot, 'workspaceRoot');
        if (!path.isAbsolute(workspaceRoot))
            fail('workspaceRoot must be absolute');
        const root = await realpath(workspaceRoot);
        if (!(await stat(root)).isDirectory())
            fail('workspaceRoot is not a directory');
        const current = await realpath(cwd);
        // Same root-or-descendant relation `directory()` enforces, read in the other direction: the board
        // root may be the session cwd or one of its ancestors. Every other relation (the cwd is above the
        // root, a sibling, or on another volume) stays fail-closed.
        const relative = path.relative(root, current);
        if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
            fail('workspaceRoot must be the session working directory or one of its ancestors; unrelated configs are forbidden');
        const store = new ConfigStore(root);
        await store.read(); // Explicit worker mode must never create a replacement coordinator.
        return store;
    }
    openTemporary(file) { return open(file, 'wx'); }
    async cleanupTemporary(temp) {
        // A moved root may leave an unpublished temp behind. Never follow a
        // replacement parent outside the pinned root just to clean up. This guard
        // is independent of lifecycle/deadline expiry so ordinary failures clean up.
        await this.assertLocalPaths();
        const resolved = await realpath(temp);
        const relative = path.relative(this.canonicalRoot, resolved);
        if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
            fail('temporary config path escapes session root');
        await unlink(temp);
    }
    /**
     * Synced, closed, exclusively created temporary holding one complete serialized document. The bytes are
     * produced by `serializeConfig`, so a staged temp is already proven to roundtrip.
     */
    async writeTemporaryText(content, assertValid) {
        assertValid();
        await this.assertLocalPaths();
        await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
        await this.assertLocalPaths();
        const temp = `${this.file}.${randomUUID()}.tmp`;
        const handle = await this.openTemporary(temp);
        try {
            assertValid();
            await handle.writeFile(content, 'utf8');
            await handle.sync();
            await handle.close();
            return temp;
        }
        catch (error) {
            // Cleanup goes through the containment guard: a redirected metadata path must not let this call
            // unlink a file outside the root, even one that carries this call's own temp name.
            await handle.close().catch(() => { });
            await this.cleanupTemporary(temp).catch(() => { });
            throw error;
        }
    }
    /**
     * Publish an already synced/closed temp by atomic replace, with the bounded Windows
     * reader-denies-rename retry. Only publication of this same temp repeats: the mutation, the probes and
     * any other OS action never run again here. Every attempt re-proves the lock and the caller's guard.
     */
    async publish(temp, assertFinal) {
        const replace = this.options.rename ?? rename;
        const now = this.options.now ?? (() => performance.now());
        const delay = this.options.delay ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
        const started = now();
        let originalError;
        for (let attempt = 0;; attempt++) {
            const expired = attempt > 0 && now() - started >= RENAME_BUDGET_MS;
            await this.assertLocalPaths();
            this.publicationGuard(assertFinal);
            if (expired)
                throw originalError;
            try {
                await replace(temp, this.file);
                return;
            }
            catch (error) {
                // A rename that returned an error is a definite pre-publication failure: the current config
                // remains authoritative and this call's owned temp is the only state to clean up. Publication
                // uncertainty (a submitted replace whose local outcome cannot be read back) is reported by the
                // caller, which reads the current bytes instead of assuming rollback or replay.
                if ((this.options.platform ?? process.platform) !== 'win32' || error.code !== 'EPERM')
                    throw error;
                originalError ??= error;
                const backoff = RENAME_DELAYS[attempt];
                if (backoff === undefined || now() - started + backoff >= RENAME_BUDGET_MS)
                    throw originalError;
                await delay(backoff);
            }
        }
    }
    /**
     * First-board creation only (ADR 0025): publish an already complete file with an atomic, no-replace
     * hard link, so a competing initializer is never overwritten and losers always see complete JSON.
     * Returns false when another initializer won; the caller then reads that winner normally.
     */
    async initialize(caller, assertValid = () => { }) {
        return this.exclusive(async () => {
            assertValid();
            validateConfig(initialBoard(caller));
            const temp = await this.writeTemporaryText(serializeConfig(initialBoard(caller)), assertValid);
            try {
                await this.assertLocalPaths();
                this.publicationGuard(assertValid);
                try {
                    await link(temp, this.file);
                }
                catch (error) {
                    if (error.code !== 'EEXIST')
                        throw error;
                    // Somebody else won. Read their config; this call grants nothing and replaces nothing.
                    await this.read();
                    await this.cleanupTemporary(temp);
                    return false;
                }
                await this.cleanupTemporary(temp);
                return true;
            }
            catch (error) {
                await this.cleanupTemporary(temp).catch(() => { });
                throw error;
            }
        });
    }
    /**
     * The ordinary writer. `caller` is this runtime's captured native pair and must match the board's
     * coordinator at locked admission, after the mutation await, and again at every publication attempt, so
     * a queued write from a replaced coordinator cannot overwrite a completed replacement.
     */
    async update(caller, mutate, assertValid = () => { }) {
        return this.exclusive(async () => {
            assertValid();
            // A missing, malformed or unreadable board is an error here, never an implicit initialization.
            const admitted = await this.readDocument();
            assertValid();
            requireCoordinatorPair(admitted.config, caller);
            const expectedRaw = admitted.raw;
            const config = admitted.config;
            await mutate(config);
            assertValid();
            const serialized = serializeConfig(config);
            const temp = await this.writeTemporaryText(serialized, assertValid);
            try {
                await this.publish(temp, () => {
                    assertValid();
                    // Independent final proof, after the staging awaits and on every platform retry: the board must
                    // still be the exact bytes this transaction admitted and must still name this caller pair.
                    const current = this.readDocumentSync();
                    requireCoordinatorPair(current.config, caller);
                    if (current.raw !== expectedRaw)
                        fail('config changed after admission; the queued write is refused and nothing was published');
                });
            }
            catch (error) {
                await this.cleanupTemporary(temp).catch(() => { });
                throw error;
            }
            return config;
        });
    }
    /**
     * The single adoption replacement. It re-reads the document under the lock, verifies it against the
     * caller's frozen preview hash, changes exactly the coordinator's `sessionId` and `port`, and publishes.
     * There is no general edit surface here and no identity or confirmation decision: the adoption workflow
     * owns those, and `configure_worker` never reaches this path.
     */
    async replaceCoordinatorEntry(input) {
        return this.exclusive(async () => {
            input.assertValid();
            const preview = await this.readDocument();
            input.assertValid();
            if (sha256(preview.raw) !== input.previewRawSha256)
                throw new ConfigPreviewChanged('config changed after the preview; a new preview and human decision are required');
            input.assertPreview(preview.config);
            if (preview.config.agents.some(agent => agent.sessionId === input.sessionId))
                fail('adopting session is already a configured entry');
            if (preview.config.agents.some(agent => agent.port === input.port))
                fail('adopting port is already used by a configured entry');
            const replacement = clone(preview.config);
            const board = coordinator(preview.config);
            const entry = requireCoordinatorEntry(replacement, board.sessionId, board.port);
            entry.sessionId = input.sessionId;
            entry.port = input.port;
            const after = serializeConfig(replacement);
            const temp = await this.writeTemporaryText(after, input.assertValid);
            try {
                await this.publish(temp, () => {
                    input.assertValid();
                    if (sha256(this.readDocumentSync().raw) !== input.previewRawSha256)
                        throw new ConfigPreviewChanged('config changed before publication');
                });
            }
            catch (error) {
                await this.cleanupTemporary(temp).catch(() => { });
                throw error;
            }
            return { before: preview.raw, after };
        });
    }
    /**
     * ADR 0025 P3: the private boot-only port publication, reachable solely from the captured Orchestrator
     * startup that holds the initial raw snapshot. It changes the coordinator `port` and nothing else, and
     * re-proves the captured state after every await and before every rename attempt. It is not a tool, a
     * status repair, or an id-only escape hatch on `update`.
     */
    async publishCoordinatorPort(input) {
        return this.exclusive(async () => {
            input.assertValid();
            text(input.expectedRaw, 'expectedRaw');
            const capturedSha256 = sha256(input.expectedRaw);
            const initial = await this.readDocument();
            input.assertValid();
            if (sha256(initial.raw) !== capturedSha256)
                fail('the board changed after startup; the boot port publication stops without repair');
            requireCoordinatorEntry(initial.config, input.sessionId, input.savedPort);
            if (initial.config.agents.some(agent => agent.sessionId !== input.sessionId && agent.port === input.newPort))
                fail('the fallback port is already used by another configured entry');
            // Runtime-owned observations (own endpoint identity, the saved-old pair probe, lifecycle and root)
            // are bounded reads, never liveness fences against a later reconnect.
            await input.recheck();
            input.assertValid();
            this.publicationGuard(input.assertValid);
            const current = await this.readDocument();
            if (current.raw !== initial.raw)
                fail('the board changed during the boot probes; the boot port publication stops without repair');
            requireCoordinatorEntry(current.config, input.sessionId, input.savedPort);
            if (current.config.agents.some(agent => agent.sessionId !== input.sessionId && agent.port === input.newPort))
                fail('the fallback port became used by another configured entry');
            const replacement = clone(current.config);
            requireCoordinatorEntry(replacement, input.sessionId, input.savedPort).port = input.newPort;
            const after = serializeConfig(replacement);
            const temp = await this.writeTemporaryText(after, input.assertValid);
            try {
                await this.publish(temp, () => {
                    input.assertValid();
                    const now = this.readDocumentSync();
                    requireCoordinatorEntry(now.config, input.sessionId, input.savedPort);
                    if (now.raw !== current.raw)
                        fail('the board changed before the boot port publication');
                });
            }
            catch (error) {
                await this.cleanupTemporary(temp).catch(() => { });
                throw error;
            }
            return { before: current.raw, after };
        });
    }
    async configure(caller, values, assertValid = () => { }) {
        return this.update(caller, async (c) => {
            if (values.sessionId === coordinator(c).sessionId)
                fail('cannot configure coordinator as worker');
            const projectDirectory = await directory(this.root, values.projectDirectory);
            const a = { sessionId: values.sessionId, name: values.name, description: values.description, port: values.port, projectDirectory, coordinator: false };
            if (values.role !== undefined) {
                if (!logicalRole(values.role))
                    fail('invalid role');
                a.role = values.role;
            }
            const index = c.agents.findIndex(old => old.sessionId === a.sessionId);
            if (index < 0)
                c.agents.push(a);
            else {
                const old = c.agents[index];
                if (fencedClose(old.closeJob))
                    fail('worker close is active or uncertain; configuration is fenced');
                if (old.handoff)
                    a.handoff = old.handoff;
                if (old.closeJob)
                    a.closeJob = old.closeJob;
                if (a.role === undefined && old.role)
                    a.role = old.role;
                c.agents[index] = a;
            }
        }, assertValid);
    }
}
function initialBoard(caller) {
    return {
        version: 1,
        multiplexer: 'herdr',
        agents: [{ sessionId: caller.sessionId, name: 'Coordinator', coordinator: true, description: DEFAULT_DESCRIPTION, port: caller.port, projectDirectory: '.' }],
    };
}
//# sourceMappingURL=config.js.map