import { mkdir, readFile, realpath, rename, unlink, open, link, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
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
const RENAME_DELAYS = [10, 20, 40, 80];
const RENAME_BUDGET_MS = 250;
export class ConfigStore {
    root;
    options;
    file;
    tail = Promise.resolve();
    constructor(root, options = {}) {
        this.root = root;
        this.options = options;
        this.file = path.join(root, '.pi-intercom', 'config.json');
    }
    async read() {
        // Missing, malformed and unreadable files propagate; never overwrite them.
        return validateConfig(JSON.parse(await readFile(this.file, 'utf8')));
    }
    static async discover(cwd) {
        let at = path.resolve(cwd);
        for (;;) {
            const store = new ConfigStore(at);
            try {
                await store.read();
                return store;
            }
            catch (error) {
                if (error.code !== 'ENOENT')
                    throw error;
            }
            const parent = path.dirname(at);
            if (parent === at)
                return undefined;
            at = parent;
        }
    }
    openTemporary(file) { return open(file, 'wx'); }
    async temporary(config) {
        validateConfig(config);
        await mkdir(path.dirname(this.file), { recursive: true });
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
            await unlink(temp).catch(() => { });
            throw error;
        }
    }
    async initialize(id, boundPort, assertValid = () => { }) {
        // Publish an already complete file using an atomic, no-replace hard link.
        // Losers only ever see complete JSON; unsupported filesystems fail explicitly.
        assertValid();
        const temp = await this.temporary({ version: 1, multiplexer: 'herdr', agents: [{ sessionId: id, name: 'Coordinator', coordinator: true, description: DEFAULT_DESCRIPTION, port: boundPort, projectDirectory: '.' }] });
        try {
            assertValid();
            try {
                await link(temp, this.file);
            }
            catch (e) {
                if (e.code !== 'EEXIST')
                    throw e;
                await this.read();
                await unlink(temp);
                return false;
            }
            await unlink(temp);
            return true;
        }
        catch (error) {
            await unlink(temp).catch(() => { });
            throw error;
        }
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
        const operation = this.tail.then(async () => {
            assertValid();
            const c = await this.read();
            assertValid();
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
                await unlink(temp).catch(() => { });
                throw error;
            }
            return c;
        });
        this.tail = operation.catch(() => { });
        return operation;
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