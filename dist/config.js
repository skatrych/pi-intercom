import { mkdir, readFile, realpath, rename, unlink, open, link, stat, lstat, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { fencedClose, validateHandoff, validateCloseJob } from './handoff.js';
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
const MAX_JSON_DEPTH = 16;
const MAX_SPAN_NODES = 4096;
/**
 * Strict JSON reader with byte spans and duplicate-key rejection.
 * Duplicate keys are ambiguous, so the lossless patch could not choose a token; they are a
 * configuration error rather than a last-value-wins parse. Spans are the only authorised way to
 * locate the two coordinator value tokens: no regular expression or string search is used.
 */
export class JsonDocument {
    text;
    source;
    at = 0;
    nodes = 0;
    constructor(text, source = 'document') {
        this.text = text;
        this.source = source;
    }
    parse() {
        const node = this.value(0);
        this.skip();
        if (this.at !== this.text.length)
            fail(`${this.source} has trailing content`);
        return node;
    }
    skip() {
        while (this.at < this.text.length && (this.text[this.at] === ' ' || this.text[this.at] === '\t' || this.text[this.at] === '\r' || this.text[this.at] === '\n'))
            this.at++;
    }
    expect(character) {
        if (this.text[this.at] !== character)
            fail(`${this.source} is malformed JSON`);
        this.at++;
    }
    value(depth) {
        if (depth > MAX_JSON_DEPTH || ++this.nodes > MAX_SPAN_NODES)
            fail(`${this.source} exceeds the supported JSON shape`);
        this.skip();
        const start = this.at, character = this.text[this.at];
        let node;
        if (character === '{')
            node = this.object(depth);
        else if (character === '[')
            node = this.array(depth);
        else if (character === '"')
            node = { span: { start, end: this.at }, value: this.string() };
        else if (character === 't' || character === 'f' || character === 'n')
            node = this.literal();
        else
            node = { span: { start, end: this.at }, value: this.number() };
        node.span.end = this.at;
        return node;
    }
    object(depth) {
        this.expect('{');
        const members = new Map();
        this.skip();
        if (this.text[this.at] === '}') {
            this.at++;
            return { span: { start: 0, end: 0 }, value: {}, members };
        }
        for (;;) {
            this.skip();
            const keyNode = { span: { start: this.at, end: 0 }, value: this.string() };
            const name = keyNode.value;
            if (members.has(name))
                fail(`${this.source} has duplicate key ${boundedKey(name)}`);
            this.skip();
            this.expect(':');
            members.set(name, this.value(depth + 1));
            this.skip();
            const next = this.text[this.at];
            this.at++;
            if (next === ',')
                continue;
            if (next === '}')
                break;
            fail(`${this.source} is malformed JSON`);
        }
        return { span: { start: 0, end: 0 }, value: {}, members };
    }
    array(depth) {
        this.expect('[');
        const items = [];
        this.skip();
        if (this.text[this.at] === ']') {
            this.at++;
            return { span: { start: 0, end: 0 }, value: items, items };
        }
        for (;;) {
            items.push(this.value(depth + 1));
            this.skip();
            const next = this.text[this.at];
            this.at++;
            if (next === ',')
                continue;
            if (next === ']')
                break;
            fail(`${this.source} is malformed JSON`);
        }
        return { span: { start: 0, end: 0 }, value: items, items };
    }
    literal() {
        for (const [token, value] of [['true', true], ['false', false], ['null', null]]) {
            if (this.text.startsWith(token, this.at)) {
                this.at += token.length;
                return { span: { start: 0, end: 0 }, value };
            }
        }
        fail(`${this.source} is malformed JSON`);
    }
    number() {
        const start = this.at;
        if (this.text[this.at] === '-')
            this.at++;
        const digits = this.at;
        while (this.at < this.text.length && this.text[this.at] >= '0' && this.text[this.at] <= '9')
            this.at++;
        if (this.at === digits)
            fail(`${this.source} is malformed JSON`);
        if (this.text[this.at] === '.') {
            this.at++;
            const fraction = this.at;
            while (this.at < this.text.length && this.text[this.at] >= '0' && this.text[this.at] <= '9')
                this.at++;
            if (this.at === fraction)
                fail(`${this.source} is malformed JSON`);
        }
        if (this.text[this.at] === 'e' || this.text[this.at] === 'E') {
            this.at++;
            if (this.text[this.at] === '+' || this.text[this.at] === '-')
                this.at++;
            const exponent = this.at;
            while (this.at < this.text.length && this.text[this.at] >= '0' && this.text[this.at] <= '9')
                this.at++;
            if (this.at === exponent)
                fail(`${this.source} is malformed JSON`);
        }
        const value = Number(this.text.slice(start, this.at));
        if (!Number.isFinite(value))
            fail(`${this.source} has a non-finite number`);
        return value;
    }
    string() {
        this.expect('"');
        let result = '';
        for (;;) {
            if (this.at >= this.text.length)
                fail(`${this.source} has an unterminated string`);
            const character = this.text[this.at];
            if (character === '"') {
                this.at++;
                return result;
            }
            if (character === '\\') {
                this.at++;
                const escape = this.text[this.at];
                const simple = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
                if (escape !== undefined && simple[escape] !== undefined) {
                    result += simple[escape];
                    this.at++;
                    continue;
                }
                if (escape === 'u') {
                    const hex = this.text.slice(this.at + 1, this.at + 5);
                    if (!/^[0-9a-fA-F]{4}$/.test(hex))
                        fail(`${this.source} has an invalid escape`);
                    result += String.fromCharCode(parseInt(hex, 16));
                    this.at += 5;
                    continue;
                }
                fail(`${this.source} has an invalid escape`);
            }
            if (character < ' ')
                fail(`${this.source} has a control character in a string`);
            result += character;
            this.at++;
        }
    }
}
function boundedKey(name) {
    const clean = name.replace(/[\x00-\x1f\x7f-\x9f]/g, '');
    return JSON.stringify(clean.length > 64 ? `${clean.slice(0, 64)}…` : clean);
}
function materialize(node) {
    if (node.members) {
        const value = {};
        for (const [name, child] of node.members)
            value[name] = materialize(child);
        return value;
    }
    if (node.items)
        return node.items.map(materialize);
    return node.value;
}
export const rawSpan = (text, span) => text.slice(span.start, span.end);
export const sha256 = (text) => createHash('sha256').update(text).digest('hex');
function scanConfigDocument(raw) {
    const root = new JsonDocument(raw).parse();
    return { root, config: validateConfig(materialize(root)) };
}
/** Parse, locate every agent entry's raw byte span, and apply the full schema validator. */
export function scanConfig(raw) {
    const { root, config } = scanConfigDocument(raw);
    const items = root.members?.get('agents')?.items ?? [];
    const entries = items.map(node => {
        const members = node.members ?? new Map();
        const closeJob = members.get('closeJob');
        return {
            sessionId: String(members.get('sessionId')?.value ?? ''),
            span: node.span,
            ...(closeJob ? { closeJobSpan: closeJob.span } : {}),
        };
    });
    return { raw, config, entries };
}
/**
 * Replace exactly the coordinator's `sessionId` and `port` value tokens, leaving every other byte of
 * the document untouched, including formatting, unknown tolerated fields and entry order. This is the
 * only permitted coordinator-entry replacement. A full re-stringify would prove semantic equality only
 * and is deliberately not used.
 */
export function patchCoordinatorEntry(raw, sessionId, newPort) {
    text(sessionId, 'sessionId', 256);
    port(newPort);
    const scanned = scanConfigDocument(raw);
    const entry = scanned.root.members?.get('agents')?.items?.find(node => node.members?.get('coordinator')?.value === true);
    if (!entry)
        fail('config has no coordinator entry');
    const spans = {};
    for (const name of ['sessionId', 'port'])
        spans[name] = entry.members?.get(name)?.span;
    const idSpan = spans.sessionId, portSpan = spans.port;
    if (!idSpan || !portSpan || idSpan.end <= idSpan.start || portSpan.end <= portSpan.start || idSpan.start === portSpan.start)
        fail('coordinator identity tokens are ambiguous');
    const [first, second] = idSpan.start <= portSpan.start ? [idSpan, portSpan] : [portSpan, idSpan];
    const firstText = first === idSpan ? JSON.stringify(sessionId) : String(newPort);
    const secondText = second === idSpan ? JSON.stringify(sessionId) : String(newPort);
    const after = raw.slice(0, first.start) + firstText + raw.slice(first.end, second.start) + secondText + raw.slice(second.end);
    const next = scanConfig(after).config;
    const target = coordinator(next);
    if (target.sessionId !== sessionId || target.port !== newPort)
        fail('coordinator patch did not apply exactly');
    if (after.slice(0, first.start) !== raw.slice(0, first.start) || after.slice(first.end, second.start) !== raw.slice(first.end, second.start) || after.slice(second.end) !== raw.slice(second.end))
        fail('coordinator patch changed bytes outside the identity tokens');
    if (next.agents.length !== scanned.config.agents.length)
        fail('coordinator patch changed the roster');
    return { before: raw, after, spans: [idSpan, portSpan] };
}
export class StaleConfigLock extends Error {
    owner;
    constructor(owner) {
        super('PiIntercom: config transaction lock is held by another process');
        this.owner = owner;
    }
}
export function named(c, name) {
    text(name, 'to', 128);
    return c.agents.find(a => key(a.name) === key(name)) ?? fail(`unknown recipient ${name}`);
}
export function requireCoordinator(c, id) {
    const a = c.agents.find(a => a.sessionId === id);
    return a?.coordinator ? a : fail('coordinator permission required');
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
const LOCK_DIRECTORY = 'config.lock';
const LOCK_OWNER_FILE = 'owner.json';
/** Process-local per-file serialization shared by every store instance for the same path. */
const processQueues = new Map();
/** Marks the async chain that already holds this store's transaction, so nested publications reuse it. */
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
        for (const [location, directory] of [[path.dirname(this.file), true], [this.file, false]]) {
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
            if (directory ? !metadata.isDirectory() : !metadata.isFile())
                fail('invalid local config path type');
        }
    }
    async validateRoot(expectedCanonicalRoot) {
        await this.assertLocalPaths();
        if (this.canonicalRoot !== expectedCanonicalRoot)
            fail('config root canonical location changed');
    }
    /** Strict read: duplicate keys, trailing content and malformed JSON all propagate. */
    async read() {
        // Missing, malformed and unreadable local files propagate; no fallback.
        await this.assertLocalPaths();
        return (await this.readStrict()).config;
    }
    /** The raw bytes and entry spans needed by the lossless replacement and by claim evidence. */
    async readStrict() {
        return scanConfig(await readFile(this.file, 'utf8'));
    }
    get lockDirectory() { return path.join(path.dirname(this.file), LOCK_DIRECTORY); }
    /**
     * One exclusive transaction for every config publication. Fixed acquisition order is this outer queue
     * (Pi's per-file mutation queue in the installed store) -> the process-local per-file queue -> the board
     * filesystem lock; never acquire them in a nested or reversed order. Re-entrant for one store instance
     * so a whole adoption (intent commit, replacement, active commit) is one transaction; a nested call
     * never re-enters any queue. The process-local queue waits; the filesystem lock never waits, steals an
     * old lock, or retries: cross-process contention fails closed so a human establishes the owner's state
     * first. Release removes only this call's own token. Process-local only: like Pi's own queue, that Map
     * is not an interprocess lock, which is exactly why the filesystem lock follows it.
     */
    async transaction(run) { return this.exclusive(run); }
    /** Override point for an outer per-file queue. Do not override `transaction` or `exclusive` instead. */
    outerQueue(run) { return run(); }
    async exclusive(run) {
        // Async-local, not instance, nesting: an adoption transaction may call other publication methods,
        // while two concurrent independent writes on the same instance must still serialize.
        if (insideTransaction.getStore() === true)
            return run();
        return this.outerQueue(async () => {
            const key = this.file;
            const previous = processQueues.get(key) ?? Promise.resolve();
            const operation = previous.then(async () => {
                const release = await this.acquireLock();
                try {
                    return await insideTransaction.run(true, run);
                }
                // Releasing is cleanup, so it never replaces the originating write/sync/close error. A lock this
                // process no longer owns is still never removed: release() verifies its own token first.
                finally {
                    await release().catch(() => { });
                }
            });
            const settled = operation.then(() => undefined, () => undefined);
            processQueues.set(key, settled);
            void settled.then(() => { if (processQueues.get(key) === settled)
                processQueues.delete(key); });
            return operation;
        });
    }
    async lockOwner() {
        try {
            const value = JSON.parse(await readFile(path.join(this.lockDirectory, LOCK_OWNER_FILE), 'utf8'));
            if (typeof value?.pid !== 'number' || typeof value.sessionId !== 'string' || typeof value.acquiredAt !== 'string')
                return 'unreadable';
            return value;
        }
        catch {
            return 'unreadable';
        }
    }
    async acquireLock() {
        // Validate the session root before creating anything under it: a dangling or escaping metadata link
        // is a path-safety refusal, not a missing directory that justifies a write.
        await this.assertLocalPaths();
        await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
        const directory = this.lockDirectory, token = randomUUID();
        try {
            await mkdir(directory, { mode: 0o700 });
        }
        catch (error) {
            const code = error.code;
            if (code === 'EEXIST')
                throw new StaleConfigLock(await this.lockOwner());
            throw error;
        }
        const ownerFile = path.join(directory, LOCK_OWNER_FILE);
        const owned = async () => {
            try {
                return JSON.parse(await readFile(ownerFile, 'utf8')).token === token;
            }
            catch {
                return false;
            }
        };
        const written = await open(ownerFile, 'wx');
        try {
            await written.writeFile(JSON.stringify({
                token, pid: process.pid,
                sessionId: this.options.lockOwner?.().sessionId ?? '',
                acquiredAt: new Date().toISOString(),
            }) + '\n');
            await written.sync();
        }
        finally {
            await written.close().catch(() => { });
        }
        if (!await owned()) {
            await unlink(ownerFile).catch(() => { });
            await rmdir(directory).catch(() => { });
            fail('config transaction lock ownership is uncertain; no publication');
        }
        let released = false;
        return async () => {
            if (released)
                return;
            released = true;
            if (!await owned())
                fail('config transaction lock was taken over; refusing to release');
            await unlink(ownerFile);
            await rmdir(directory).catch(() => { });
        };
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
        if (path.relative(root, current) !== '')
            fail('workspaceRoot must equal the session working directory; parent configs are forbidden');
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
    async temporary(config) {
        validateConfig(config);
        await this.assertLocalPaths();
        await mkdir(path.dirname(this.file), { recursive: true });
        await this.assertLocalPaths();
        const temp = `${this.file}.${randomUUID()}.tmp`;
        const handle = await this.openTemporary(temp);
        try {
            await handle.writeFile(JSON.stringify(config, null, 2) + '\n');
            await handle.sync();
            await handle.close();
            return temp;
        }
        catch (error) {
            // Cleanup failures must not replace the original write/sync/close error.
            await handle.close().catch(() => { });
            await this.cleanupTemporary(temp).catch(() => { });
            throw error;
        }
    }
    async initialize(id, boundPort, assertValid = () => { }) {
        return this.exclusive(async () => {
            // Publish an already complete file using an atomic, no-replace hard link.
            // Losers only ever see complete JSON; unsupported filesystems fail explicitly.
            assertValid();
            const temp = await this.temporary({ version: 1, multiplexer: 'herdr', agents: [{ sessionId: id, name: 'Coordinator', coordinator: true, description: DEFAULT_DESCRIPTION, port: boundPort, projectDirectory: '.' }] });
            try {
                await this.assertLocalPaths();
                assertValid();
                try {
                    await link(temp, this.file);
                }
                catch (e) {
                    if (e.code !== 'EEXIST')
                        throw e;
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
    async publish(temp, assertValid) {
        const replace = this.options.rename ?? rename;
        const now = this.options.now ?? (() => performance.now());
        const delay = this.options.delay ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
        const started = now();
        let originalError;
        for (let attempt = 0;; attempt++) {
            // Windows readers can briefly deny replace-rename. Retry only publication
            // of this already synced/closed temp, never the mutation or any OS action
            // outside config persistence. The elapsed budget bounds retry initiation,
            // not the duration of an already-submitted OS rename.
            await this.assertLocalPaths();
            assertValid();
            if (attempt > 0 && now() - started >= RENAME_BUDGET_MS)
                throw originalError;
            try {
                await replace(temp, this.file);
                return;
            }
            catch (error) {
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
    async update(id, mutate, assertValid = () => { }) {
        return this.exclusive(async () => {
            assertValid();
            const c = await this.read();
            assertValid();
            // Authority is re-checked after the lock is held, so a former coordinator's queued update is
            // refused once a completed adoption replaced the entry.
            requireCoordinator(c, id);
            await mutate(c);
            assertValid();
            validateConfig(c);
            const temp = await this.temporary(c);
            try {
                // Every publication attempt checks the lifecycle/deadline guard; an
                // already submitted OS rename still cannot be undone.
                await this.publish(temp, assertValid);
            }
            catch (error) {
                await this.cleanupTemporary(temp).catch(() => { });
                throw error;
            }
            return c;
        });
    }
    /**
     * The single coordinator-entry replacement. It re-reads the raw document under the lock, verifies it
     * against the caller's frozen preview, applies the lossless two-token patch and publishes it. There
     * is no general edit surface here and no identity or confirmation decision: the adoption workflow
     * owns those, and `configure_worker` never reaches this path.
     */
    async replaceCoordinatorEntry(input) {
        return this.exclusive(async () => {
            input.assertValid();
            const scanned = await this.readStrict();
            input.assertValid();
            if (sha256(scanned.raw) !== input.previewRawSha256)
                fail('config changed after the preview; a new preview and human decision are required');
            input.assertPreview(scanned.config);
            if (scanned.config.agents.some(agent => agent.sessionId === input.sessionId))
                fail('adopting session is already a configured entry');
            const patch = patchCoordinatorEntry(scanned.raw, input.sessionId, input.port);
            const temp = await this.writeTemporaryText(patch.after, input.assertValid);
            try {
                await this.publish(temp, input.assertValid);
            }
            catch (error) {
                await unlink(temp).catch(() => { });
                throw error;
            }
            return { before: patch.before, after: patch.after };
        });
    }
    /** Same synced, closed, exclusive temporary discipline as ordinary writes, from raw bytes. */
    async writeTemporaryText(content, assertValid) {
        assertValid();
        await mkdir(path.dirname(this.file), { recursive: true });
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
            await handle.close().catch(() => { });
            await unlink(temp).catch(() => { });
            throw error;
        }
    }
    async configure(id, values, assertValid = () => { }) {
        return this.update(id, async (c) => {
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
//# sourceMappingURL=config.js.map