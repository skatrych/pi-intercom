import path from 'node:path';
import { homedir } from 'node:os';
import { realpath } from 'node:fs/promises';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { LocalObserver, LOG_LIMITS, observationError } from './observability.js';
import { ConfigStore, WORKER_ROLE_ENV, coordinator, directory, fail, logicalRole, named, requireCoordinator, text, validateConfig } from './config.js';
import { listen, send, reportPayload } from './transport.js';
import { ReportPublicationRefused, saveWorkerReport } from './reports.js';
import { readObservationSnapshot } from './snapshot.js';
import { workerStatusPage } from './worker-status.js';
import { probeWorker, probeWorkers } from './connections.js';
import { HandoffWorkflow, HANDOFF_KINDS, fencedClose } from './handoff.js';
import { CoordinatorReminders, DEFAULT_REMINDER_INTERVAL_MS, readReminderMinutesEnv, reminderIntervalMs } from './reminders.js';
import { AdoptionFailure, AdoptionWorkflow, ORCHESTRATOR_ROLE, PROJECTS_HOME_ENV, bootClaimEvidence, committedActiveClaimMatches, countBoards, projectsHome, stop } from './adoption.js';
export const UNSUPPORTED_CANCELLATION = 'Unsupported Pi host: stop_worker and legacy graceful-close control are disabled. Pi 0.84.4 extension abort does not cancel retry backoff/continuations; graceful shutdown cannot guarantee no queued work restarts. No cancellation or shutdown was performed. close_worker uses a separate supported-provider owned-pane closure contract, not graceful cancellation. See references/implementation-blocker.md. A verified supported host API is required for graceful cancellation (no version-only override).';
export const ADOPTION_NOT_READY = 'ADOPTION_NOT_READY';
function requestedRole(role) {
    if (role === undefined)
        return undefined;
    if (!logicalRole(role))
        fail('invalid role');
    return role;
}
/** Explicit argument, then the saved worker role, then a same-process registration report. */
function chooseWorkerRole(config, sessionId, explicit, reported) {
    if (explicit !== undefined && !logicalRole(explicit))
        fail('invalid role');
    const existing = config.agents.find(agent => agent.sessionId === sessionId && !agent.coordinator);
    if (typeof explicit === 'string')
        return { role: explicit };
    if (existing?.role) {
        if (reported && reported !== existing.role)
            return { roleNote: `reported role ${reported} differs from persisted role ${existing.role}; persisted role kept` };
        return {};
    }
    if (!reported)
        return {};
    if (!logicalRole(reported))
        fail('invalid role');
    return { role: reported };
}
/** Last path segment only. Does not resolve, stat, or interpret the directory. */
function roleBasename(dir) {
    if (!dir)
        return undefined;
    const base = path.posix.basename(dir);
    return base && base !== '.' && base !== '/' ? base : undefined;
}
export class Intercom {
    host;
    options;
    store;
    endpoint;
    active = false;
    generation = 0;
    initialId = '';
    responsibility;
    observer;
    /** A no-board Orchestrator must not create a board directory through logging before bootstrap. */
    observationEnabled = true;
    closing;
    reportWrites = Promise.resolve();
    pendingReports = 0;
    probeController = new AbortController();
    resumeFences = new Map();
    /** Role names reported by workers, applied when that session is explicitly configured. Not an agent entry. */
    registeredRoles = new Map();
    roleResolved = false;
    resolvedRole;
    handoff;
    callbackEpoch = new AsyncLocalStorage();
    reminders;
    reminderRevision = 0;
    reminderInvocation = 0;
    /** Snapshot once per start (startServices consumes it); see PI_INTERCOM_REMINDER_MINUTES docs. */
    reminderIntervalMsCache = DEFAULT_REMINDER_INTERVAL_MS;
    /**
     * Coordinator action readiness. Enabled only for a canonical Orchestrator launch on the
     * projects-home board. It starts closed on unresolved evidence and opens only after committed active
     * evidence and a successful write-free promotion. It gates coordinator tools, boot coordinator side
     * effects, and this session's incoming registration/status/report/message/handoff effects, queued
     * report persistence, notification, and reminder delivery. It never gates ordinary worker-targeted
     * delivery, health, or read-only adoption status.
     */
    authorityEnabled = false;
    authorityReady = false;
    authorityEpoch = 0;
    authorityDetail = 'not applicable';
    readyClaimBytes;
    adoption;
    /** Closed when an adoption or declaration transaction invalidated an earlier callback epoch. */
    actionEpoch() { return this.authorityEpoch; }
    /** Cheap preparation check, never external-evidence approval. An old epoch cannot revive. */
    assertActionEpoch(epoch) {
        if (epoch !== undefined && epoch !== this.authorityEpoch)
            fail(`${ADOPTION_NOT_READY}: the action-readiness epoch changed; this callback stops without further effects`);
        if (this.authorityEnabled && !this.authorityReady)
            fail(`${ADOPTION_NOT_READY}: ${this.authorityDetail}; coordinator action readiness is closed`);
    }
    /** Fresh runtime-local portion of authority; ConfigStore supplies Git in the same locked span. */
    assertActionAuthority(epoch) {
        this.assertActionEpoch(epoch);
        if (!this.authorityEnabled)
            return;
        if (this.authorityReady) {
            try {
                if (realpathSync(this.store.root) !== this.store.root || !lstatSync(path.join(this.store.root, '.pi-intercom')).isDirectory()
                    || !lstatSync(path.join(this.store.root, 'coordinator-claim.md')).isFile() || !lstatSync(this.store.file).isFile())
                    throw Error('unsafe authority path');
                const raw = readFileSync(path.join(this.store.root, 'coordinator-claim.md'), 'utf8');
                const config = validateConfig(JSON.parse(readFileSync(this.store.file, 'utf8')));
                const board = coordinator(config);
                if (raw === this.readyClaimBytes && board.sessionId === this.initialId && board.port === this.endpoint?.port && this.responsibility?.coordinator)
                    return raw;
            }
            catch { /* Changed or unavailable evidence closes authority, never approves it. */ }
            this.closeActionEpoch('committed claim/board pair or local responsibility changed; explicitly reconcile before acting');
        }
        fail(`${ADOPTION_NOT_READY}: ${this.authorityDetail}; no successful receipt, report persistence, registration change, reminder, or model turn is claimed for it`);
    }
    assertActionReady(epoch) {
        const raw = this.assertActionAuthority(epoch);
        if (raw !== undefined && !committedActiveClaimMatches(this.store.root, raw)) {
            this.closeActionEpoch('committed evidence changed or became unavailable; explicitly reconcile before acting');
            fail(`${ADOPTION_NOT_READY}: ${this.authorityDetail}`);
        }
    }
    /** Existing synchronous store guard only: no proof delegation or asynchronous failure catch. */
    configGuard(lifecycle, epoch = this.actionEpoch(), caller) {
        return phase => {
            lifecycle();
            this.assertActionEpoch(epoch);
            if (phase === 'authority-refused') {
                if (this.authorityEnabled)
                    this.closeActionEpoch('ordinary config authority admission/publication refused; explicitly reconcile before acting');
                return;
            }
            caller?.();
            if (phase === 'authority')
                this.assertActionAuthority(epoch);
        };
    }
    /** Close the local action epoch. Callers hold the returned value and fail once it changes. */
    closeActionEpoch(detail = 'a coordinator transaction is in progress') {
        this.authorityReady = false;
        this.reminders?.stop();
        this.authorityDetail = detail;
        return ++this.authorityEpoch;
    }
    openActionEpoch() {
        if (this.authorityReady) {
            this.assertActionReady();
            return;
        }
        this.readyClaimBytes = readFileSync(path.join(this.store.root, 'coordinator-claim.md'), 'utf8');
        this.authorityReady = true;
        this.assertActionReady(); // close again if committed evidence changed across the promotion awaits
        this.observationEnabled = true;
        this.authorityDetail = 'coordinator action evidence is committed and this session is promoted';
        ++this.authorityEpoch;
    }
    workerStarted() { this.handoff?.workerStarted(); }
    workerSettled(successfulToolCallIds) { this.handoff?.workerSettled(successfulToolCallIds); }
    captureObserver() {
        const observer = this.observer;
        return (event, metadata = {}) => {
            try {
                if (this.observationEnabled)
                    observer?.record(event, metadata);
            }
            catch { /* Logging cannot affect communication. */ }
        };
    }
    recordObservation(event, metadata = {}) { this.captureObserver()(event, metadata); }
    launchRoleDirectory;
    launchRolesDirectory;
    launchWorkerRole;
    constructor(host, options) {
        this.host = host;
        this.options = options;
        this.launchRoleDirectory = host.roleDirectory ?? process.env.PI_ROLE_DIR;
        this.launchRolesDirectory = options.adoption?.rolesDirectory ?? host.rolesDirectory ?? process.env.PI_ROLES_DIR ?? path.join(homedir(), '.pi', 'roles');
        this.launchWorkerRole = host.workerRole ?? process.env.PI_INTERCOM_WORKER_ROLE;
    }
    id() {
        const id = this.host.sessionId();
        if (!this.active || id !== this.initialId)
            fail('session is inactive or replaced');
        return id;
    }
    validity() {
        const generation = this.generation;
        this.id();
        return () => {
            this.id();
            if (generation !== this.generation)
                fail('runtime lifecycle replaced');
        };
    }
    async start() {
        if (this.closing)
            await this.closing;
        if (this.active)
            fail('runtime already active');
        this.initialId = this.host.sessionId();
        this.active = true;
        this.probeController = new AbortController();
        this.resumeFences.clear();
        this.registeredRoles.clear();
        this.roleResolved = false;
        this.resolvedRole = undefined;
        this.authorityEnabled = false;
        this.authorityReady = false;
        this.authorityDetail = 'not applicable';
        this.readyClaimBytes = undefined;
        this.bootEvidenceReady = false;
        this.observationEnabled = !this.orchestratorLaunch();
        const generation = ++this.generation, assertValid = this.validity();
        // Snapshot the reminder interval once for this runtime. A child tool cannot
        // change this process environment, and Pi /reload restarts this runtime.
        this.reminderIntervalMsCache = reminderIntervalMs((this.options.reminderMinutesEnv ?? readReminderMinutesEnv)());
        let record = this.captureObserver();
        try {
            // Count the actual ancestor chain before discovery reads any config or observer creates state.
            let countedRoot, countedBoard = false;
            if (this.orchestratorLaunch()) {
                const home = projectsHome({ projectsHome: this.options.adoption?.projectsHome ?? process.env[PROJECTS_HOME_ENV], homeDirectory: homedir() });
                const cwd = await realpath(this.host.cwd), root = await realpath(home);
                const relative = path.relative(root, cwd);
                if (cwd !== path.resolve(this.host.cwd) || root !== path.resolve(home) || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
                    fail('unsafe Orchestrator projects-home/cwd path');
                const boards = await countBoards(cwd, root);
                if (boards.length > 1 || (boards.length === 1 && boards[0] !== root))
                    fail('BOARD_COUNT: second or wrong board; stop, never cleanup');
                this.authorityEnabled = true;
                countedRoot = root;
                countedBoard = boards.length === 1;
            }
            // Never discover above the already-counted projects home or fall back to an unrelated board.
            const discovered = countedRoot ? (countedBoard ? new ConfigStore(countedRoot) : undefined) : await ConfigStore.discover(this.host.cwd);
            assertValid();
            this.store = this.options.store?.(discovered?.root ?? countedRoot ?? this.host.cwd) ?? discovered ?? new ConfigStore(countedRoot ?? this.host.cwd);
            this.observationEnabled = !countedRoot || countedBoard;
            try {
                this.observer = this.options.observe ? this.options.observe(this.store.root, this.initialId) : new LocalObserver(this.store.root, this.initialId);
            }
            catch { /* Logging is optional on failure. */ }
            record = this.captureObserver();
            record('runtime.starting');
            const previous = discovered ? await this.store.read() : undefined;
            assertValid();
            const own = previous?.agents.find(a => a.sessionId === this.id());
            const endpoint = await (this.options.listen ?? listen)(own?.port, m => { assertValid(); return this.receive(m); }, () => {
                assertValid();
                return { version: 1, sessionId: this.initialId };
            });
            try {
                assertValid();
            }
            catch (error) {
                await endpoint.close();
                throw error;
            }
            this.endpoint = endpoint;
            // An Orchestrator launch counts the board and can hold here, before any board write or
            // coordinator side effect. Binding a health endpoint is not an authority grant, and a held session
            // still answers read-only `/intercom-adopt status`.
            const held = await this.preflight(previous, assertValid);
            this.startServices(assertValid);
            if (held !== undefined) {
                record('runtime.ready', { port: endpoint.port, role: 'anonymous', outcome: 'ready' });
                this.host.notify(`Intercom Orchestrator held at 127.0.0.1:${endpoint.port}; ${held} Enter /intercom-adopt status.`);
                return;
            }
            if (!previous) {
                const initialized = await this.store.initialize(this.id(), this.endpoint.port, assertValid);
                if (initialized)
                    record('config.changed', { operation: 'initialize', outcome: 'written' });
            }
            const config = await this.store.read();
            assertValid();
            const me = config.agents.find(a => a.sessionId === this.id());
            if (me?.coordinator) {
                // Responsibility load is write-free and always runs, so an unresolved-claim coordinator still has
                // its identity. Recovery, observer maintenance and the port refresh are config writes and stay
                // behind coordinator action readiness.
                try {
                    await this.reload();
                }
                catch (e) {
                    assertValid();
                    this.host.notify(`Name/responsibility synchronization failed: ${String(e)}`);
                }
                assertValid();
                if (this.authorityEnabled && this.bootEvidenceReady && this.responsibilityLoaded())
                    this.openActionEpoch();
                if (this.authorityEnabled && !this.authorityReady) {
                    record('host.submission', { outcome: 'blocked', errorCode: 'operation_failed' });
                    this.host.notify(`Intercom Coordinator endpoint at 127.0.0.1:${this.endpoint.port}; ${this.authorityDetail}; coordinator tools, close recovery, observer maintenance and the port refresh are fenced until /intercom-adopt resolves it.`);
                }
                else {
                    await this.handoff.recover();
                    assertValid();
                    try {
                        this.observer?.maintain?.();
                    }
                    catch { /* No cleanup failure affects readiness. */ }
                    await this.store.update(this.id(), c => { requireCoordinator(c, this.id()).port = this.endpoint.port; }, this.configGuard(assertValid));
                    assertValid();
                    record('config.changed', { operation: 'port_update', outcome: 'written', port: this.endpoint.port });
                    this.host.notify(`Intercom Coordinator ready at 127.0.0.1:${this.endpoint.port}; waiting for user input.`);
                }
            }
            else {
                if (me) {
                    try {
                        await this.reload();
                    }
                    catch (e) {
                        assertValid();
                        this.host.notify(`Name/responsibility synchronization failed: ${String(e)}`);
                    }
                }
                assertValid();
                const role = me?.coordinator ? undefined : this.reportedRole();
                try {
                    if (me)
                        await this.report();
                    else {
                        const projectDirectory = await directory(this.store.root, this.host.cwd);
                        assertValid();
                        await this.transmit(coordinator(config).name, 'registration', { port: this.endpoint.port, projectDirectory, ...(role ? { role } : {}) });
                    }
                }
                catch (e) {
                    assertValid();
                    this.host.notify(`Coordinator unreachable/registration failed; worker remains reachable: ${String(e)}. No retry. Anonymous registration repeat is an unresolved contract; use explicit Pi /reload to restart this extension, not report_status.`);
                }
                assertValid();
                this.host.notify(`Intercom worker ready at 127.0.0.1:${this.endpoint.port}; waiting for explicit work.`);
            }
            record('runtime.ready', { port: this.endpoint.port, role: me?.coordinator ? 'coordinator' : me ? 'worker' : 'anonymous', busy: this.host.busy(), outcome: 'ready' });
        }
        catch (e) {
            if (generation === this.generation) {
                record('runtime.failed', { errorCode: observationError(e), outcome: 'failed' });
                await this.close();
            }
            throw e;
        }
    }
    startServices(assertValid) {
        this.reminders = new CoordinatorReminders({
            // Timer preparation checks only its captured epoch; deliver below owns the fresh final proof.
            captureGuard: () => { const epoch = this.actionEpoch(); return () => { assertValid(); this.assertActionEpoch(epoch); }; },
            isCoordinator: async () => { const fresh = await this.state(); assertValid(); return fresh.me?.coordinator === true; },
            busy: () => this.host.busy(),
            deliver: message => { assertValid(); this.assertActionReady(); this.host.deliver(message, false); },
        }, this.options.reminderClock, this.reminderIntervalMsCache);
        this.handoff = new HandoffWorkflow({
            state: async () => { const state = await this.state(); if (state.me?.coordinator)
                this.assertActionReady(this.callbackEpoch.getStore()); return state; },
            assertCurrent: () => { assertValid(); this.assertActionReady(this.callbackEpoch.getStore()); },
            update: async (mutate, guard) => {
                const epoch = this.callbackEpoch.getStore() ?? this.actionEpoch();
                await this.store.update(this.initialId, mutate, this.configGuard(assertValid, epoch, guard));
            },
            send: async (sessionId, kind, payload) => {
                const epoch = this.callbackEpoch.getStore() ?? this.actionEpoch();
                const state = await this.state();
                assertValid();
                this.assertActionReady(epoch);
                const target = state.config.agents.find(a => a.sessionId === sessionId);
                if (!target)
                    fail('handoff recipient no longer configured');
                await (this.options.send ?? send)(target.port, { version: 1, kind, from: state.id, to: sessionId, payload, correlationId: randomUUID() });
                assertValid();
            },
            deliver: message => { assertValid(); this.assertActionReady(this.callbackEpoch.getStore()); this.host.deliver(message, this.host.busy()); },
            busy: () => this.host.busy(), provider: this.options.closeProvider, timeoutMs: this.options.closeTimeoutMs,
        });
    }
    bootEvidenceReady = false;
    async close() {
        if (this.closing)
            return this.closing;
        this.recordObservation('runtime.closed');
        const observer = this.observer;
        this.observer = undefined;
        this.active = false;
        this.generation++;
        this.probeController.abort();
        this.handoff?.dispose();
        this.handoff = undefined;
        this.reminderRevision = ++this.reminderInvocation;
        this.reminders?.dispose();
        this.reminders = undefined;
        const endpoint = this.endpoint;
        this.endpoint = undefined;
        this.responsibility = undefined;
        const closing = (async () => {
            try {
                if (endpoint)
                    await endpoint.close();
            }
            finally {
                if (observer) {
                    let timer;
                    try {
                        // Only shutdown waits, and only for this bounded deadline. Already-issued I/O cannot be cancelled.
                        await Promise.race([
                            Promise.resolve().then(() => observer.close()).catch(() => { }),
                            new Promise(resolve => { timer = setTimeout(resolve, LOG_LIMITS.closeTimeoutMs); }),
                        ]);
                    }
                    finally {
                        if (timer)
                            clearTimeout(timer);
                    }
                }
            }
        })();
        this.closing = closing;
        try {
            await closing;
        }
        finally {
            if (this.closing === closing)
                this.closing = undefined;
        }
    }
    /**
     * Orchestrator preflight. Applies only to a canonical Orchestrator launch: the launch role is read from
     * this process's captured configuration, never from a request. Counts `.pi-intercom` directories along
     * cwd -> projects home before any write, then classifies and applies the claim gate. Returns a held
     * reason when no board may be written, and throws when the board layout itself is unsafe.
     */
    async preflight(previous, assertValid) {
        if (!this.orchestratorLaunch())
            return undefined;
        const home = projectsHome({ projectsHome: this.options.adoption?.projectsHome ?? process.env[PROJECTS_HOME_ENV], homeDirectory: homedir() });
        const cwd = await realpath(this.host.cwd), canonicalHome = await realpath(home);
        const relative = path.relative(canonicalHome, cwd);
        if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
            throw new Error(`PiIntercom: cwd ${cwd} is outside projects home ${canonicalHome}; an Orchestrator session reads or writes no board`);
        }
        const boards = await countBoards(cwd, canonicalHome);
        if (boards.length > 1) {
            throw new Error(`PiIntercom: a second board at ${boards[1]} is a creation-time failure, not a cleanup item; nothing was read or written`);
        }
        if (boards.length === 1 && boards[0] !== canonicalHome) {
            throw new Error(`PiIntercom: the only board is at ${boards[0]}, not the projects home ${canonicalHome}; stop`);
        }
        this.authorityEnabled = true;
        if (boards.length === 0) {
            assertValid();
            return cwd === canonicalHome
                ? 'no board exists at the projects home; first-board initialization happens only as an explicit /intercom-adopt decision'
                : `no board exists between ${cwd} and ${canonicalHome}; a private board is never created in a child directory`;
        }
        const own = previous?.agents.find(agent => agent.sessionId === this.id());
        const board = previous ? previous.agents.find(agent => agent.coordinator) : undefined;
        if (board && own?.sessionId === board.sessionId) {
            const evidence = await bootClaimEvidence({ home: canonicalHome, identity: { sessionId: this.id(), port: this.endpoint.port } });
            this.bootEvidenceReady = evidence.ready;
            if (evidence.ready)
                return undefined;
            this.closeActionEpoch(evidence.detail);
            return undefined;
        }
        if (own && !own.coordinator)
            this.authorityEnabled = false; // ordinary worker-targeted delivery remains unchanged
        this.closeActionEpoch(own && !own.coordinator
            ? `this session is registered as worker ${own.name}: a registered worker is never promoted, and adoption needs a fresh session id`
            : 'this session is an anonymous worker on this board: adoption is required, and no declaration or coordinator action is permitted without it');
        return undefined;
    }
    /** Canonical launch role only: `<PI_ROLES_DIR or ~/.pi/roles>/orchestrator`, captured from this process. */
    orchestratorLaunch() {
        const configured = this.launchRoleDirectory;
        if (!configured || !configured.trim() || (this.launchWorkerRole && this.launchWorkerRole !== ORCHESTRATOR_ROLE))
            return false;
        return path.resolve(configured) === path.resolve(this.launchRolesDirectory, ORCHESTRATOR_ROLE);
    }
    /** True once the claim gate permits coordinator action, or when the gate does not apply to this session. */
    coordinatorActionReady() { return !this.authorityEnabled || this.authorityReady; }
    responsibilityLoaded() { return this.responsibility !== undefined; }
    /**
     * In-place promotion. No `start`, `close`, `HandoffWorkflow.recover`, extension reload,
     * worker action, monitor or pane operation, log maintenance, report clearing, session replacement, or
     * job-state rewrite. It reads config and loads this session's responsibility from the new entry only.
     */
    async promoteCoordinator() {
        const record = this.captureObserver(), assertValid = this.validity();
        const { me } = await this.state();
        assertValid();
        if (!me?.coordinator)
            fail('promotion requires this session to be the coordinator entry on this board');
        this.responsibility = { ...me };
        this.authorityEnabled = true;
        assertValid();
        record('config.reloaded', { role: 'coordinator', outcome: 'written' });
        this.host.notify(`Intercom responsibility loaded for ${me.name} as Coordinator; promotion is in place, with no extension reload, worker action, or work turn started.`);
    }
    /**
     * The sole adoption entry point. The backend checks its own authorization independently of whether any
     * command was installed, discovered, or visible: role, session identity, and the command context are
     * re-verified inside the workflow, and a manually bypassed frontend still fails here.
     */
    async adoptCoordinator(context, verb, args = []) {
        if (!this.orchestratorLaunch())
            return stop('AUTH', ['this Pi process was not launched as the canonical Orchestrator role; no adoption backend is offered']);
        if (context.cwd !== this.host.cwd)
            return stop('SESSION_CHANGED', ['command cwd is not this runtime launch cwd']);
        const workflow = this.adoption ??= new AdoptionWorkflow({
            roleDirectory: this.launchRoleDirectory,
            rolesDirectory: this.launchRolesDirectory,
            workerRole: this.launchWorkerRole,
            ...(this.options.adoption?.projectsHome ? { projectsHome: this.options.adoption.projectsHome } : {}),
            storeFor: root => this.options.store?.(root) ?? new ConfigStore(root),
            sessionId: () => { try {
                return this.id();
            }
            catch {
                throw new AdoptionFailure('SESSION_CHANGED', 'runtime lifecycle/session was replaced');
            } },
            busy: () => this.host.busy(),
            endpointPort: () => this.endpoint?.port,
            probe: (agent, options) => (this.options.probe ?? probeWorker)(agent, { signal: this.probeController.signal, ...options }),
            promote: () => this.promoteCoordinator(),
            responsibilityLoaded: () => this.responsibilityLoaded(),
            // The workflow owns epoch transitions: it closes before preparing intent and opens only after
            // committed active evidence plus a successful write-free promotion. A read-only `status` never
            // closes it, so a resolved coordinator cannot lose readiness by looking at its own board.
            readiness: {
                close: detail => this.closeActionEpoch(detail),
                current: () => this.actionEpoch(),
                ready: () => this.coordinatorActionReady(),
                // Readiness is a claim about verified state, not a flag to raise: it opens only once this session
                // actually holds the coordinator responsibility the committed evidence names. A failed promotion
                // therefore leaves it closed, and PROMOTION_PENDING stays not-ready.
                open: () => {
                    if (!this.responsibilityLoaded())
                        fail(`${ADOPTION_NOT_READY}: promotion is incomplete, so coordinator action readiness stays closed`);
                    this.openActionEpoch();
                    return this.authorityEpoch;
                },
            },
            listSessions: this.options.adoption?.listSessions ?? (async () => { throw new Error('no Pi session store is wired'); }),
            ...(this.options.adoption?.phase ? { phase: this.options.adoption.phase } : {}),
        });
        return workflow.run(context, verb, args);
    }
    async state() {
        const assertValid = this.validity();
        const id = this.id(), config = await this.store.read();
        assertValid();
        return { id, config, me: config.agents.find(a => a.sessionId === id) };
    }
    /** Accept old configs, but retire the removed browser dashboard's discovery metadata. */
    async retireDashboardMetadata() {
        const record = this.captureObserver(), assertValid = this.validity(), epoch = this.actionEpoch();
        const { id, config } = await this.state();
        assertValid();
        this.assertActionReady(epoch);
        if (requireCoordinator(config, id).dashboardPort === undefined)
            return;
        await this.store.update(id, c => { delete requireCoordinator(c, id).dashboardPort; }, this.configGuard(assertValid, epoch));
        record('config.changed', { outcome: 'written' });
    }
    async reload() {
        const record = this.captureObserver();
        const assertValid = this.validity();
        const { me } = await this.state();
        assertValid();
        if (!me)
            fail('worker not configured; configure_worker must run before reload_worker');
        this.responsibility = { ...me };
        // Coordinator is a routing identity, not ownership of the user's Pi/tab title.
        if (!me.coordinator)
            await this.host.setName(me.name);
        assertValid();
        record('config.reloaded', { role: me.coordinator ? 'coordinator' : 'worker' });
        this.host.notify(`Intercom responsibility loaded for ${me.name}; no work turn started.`);
    }
    async transmit(to, kind, payload = {}, guard = () => { }) {
        const record = this.captureObserver();
        const assertValid = this.validity(), epoch = this.actionEpoch();
        const { id, config, me } = await this.state();
        assertValid();
        guard();
        if (me?.coordinator)
            this.assertActionEpoch(epoch);
        const target = named(config, to), correlationId = randomUUID();
        if (['message', 'reload'].includes(kind) && (this.handoff?.isClosing(target.sessionId) || fencedClose(target.closeJob)))
            fail('worker close is active or uncertain; new Intercom work is fenced');
        const metadata = { peerSessionId: target.sessionId, peerName: target.name, correlationId, kind };
        record('transport.send', { ...metadata, outcome: 'attempted' });
        try {
            assertValid();
            if (me?.coordinator)
                this.assertActionReady(epoch);
            await (this.options.send ?? send)(target.port, { version: 1, from: id, to: target.sessionId, kind, payload, correlationId });
            record('transport.receipt', { ...metadata, outcome: 'http_receipt' });
        }
        catch (error) {
            record('transport.failed', { ...metadata, outcome: 'failed', errorCode: observationError(error) });
            throw error;
        }
    }
    async report() {
        const assertValid = this.validity();
        const { config, me } = await this.state();
        assertValid();
        if (me?.coordinator)
            fail('report_status is worker-only');
        if (!this.endpoint)
            fail('endpoint unavailable');
        const role = this.reportedRole();
        await this.transmit(coordinator(config).name, 'status', { port: this.endpoint.port, busy: this.host.busy(), ...(role ? { role } : {}) });
    }
    /** Logical role for registration and status. Invalid metadata is omitted; it does not stop messaging. */
    reportedRole() {
        if (this.roleResolved)
            return this.resolvedRole;
        this.roleResolved = true;
        const explicit = this.host.workerRole !== undefined && this.host.workerRole !== '' ? this.host.workerRole : process.env[WORKER_ROLE_ENV];
        const directory = this.host.roleDirectory !== undefined ? this.host.roleDirectory : process.env.PI_ROLE_DIR;
        const candidate = explicit !== undefined && explicit !== '' ? explicit : roleBasename(directory);
        if (!candidate)
            return undefined;
        if (!logicalRole(candidate)) {
            this.host.notify('Invalid worker role; omitted from registration and status. Messaging continues.');
            return undefined;
        }
        this.resolvedRole = candidate;
        return candidate;
    }
    async receive(message) {
        const record = this.captureObserver();
        const metadata = { peerSessionId: message.from, correlationId: message.correlationId, kind: message.kind };
        record('transport.received', metadata);
        try {
            await this.handleReceive(message);
        }
        catch (error) {
            record('transport.rejected', { ...metadata, outcome: 'handler_failed', errorCode: observationError(error) });
            throw error;
        }
    }
    async handleReceive(message) {
        const record = this.captureObserver();
        const assertValid = this.validity();
        // An incoming callback binds the epoch it was admitted in. A callback that crosses a closed
        // readiness epoch stops at its next side effect, with no buffered or replayed delivery later.
        const epoch = this.actionEpoch();
        const assertCurrent = () => { assertValid(); this.assertActionEpoch(epoch); };
        const assertReady = () => { assertValid(); this.assertActionReady(epoch); };
        const receivedFence = message.kind === 'status' ? this.resumeFences.get(message.from) : undefined;
        const eligibleAnnouncement = receivedFence?.submitted ? receivedFence : undefined;
        const { id, config, me } = await this.state();
        assertValid();
        assertReady();
        if (message.to !== id)
            fail('recipient session ID mismatch (stale endpoint)');
        const sender = config.agents.find(a => a.sessionId === message.from);
        const busy = this.host.busy();
        const metadata = { peerSessionId: message.from, peerName: sender?.name, correlationId: message.correlationId, kind: message.kind, busy };
        const notify = (purpose, content) => {
            record('host.submission', { ...metadata, outcome: 'attempted' });
            try {
                assertReady();
                this.host.deliver(`[Intercom ${purpose} from ${sender?.name ?? 'unconfigured worker'} (${message.from})]\n${content}`, busy);
                // A synchronous return is not Pi queue acceptance or model completion.
                record('host.submission', { ...metadata, outcome: 'returned' });
            }
            catch (error) {
                record('host.submission', { ...metadata, outcome: 'failed', errorCode: observationError(error) });
                throw error;
            }
        };
        if (HANDOFF_KINDS.includes(message.kind)) {
            if (!this.handoff || !me || (!me.coordinator && !this.responsibility))
                fail('handoff requires a configured, responsibility-loaded worker');
            assertCurrent();
            await this.callbackEpoch.run(epoch, () => this.handoff.receive(message.kind, message.from, message.payload));
            return;
        }
        if (message.kind === 'registration' || message.kind === 'status') {
            requireCoordinator(config, id);
            if (sender?.coordinator)
                fail('coordinator cannot report as worker');
            if (message.kind === 'registration') {
                const projectDirectory = await directory(this.store.root, message.payload.projectDirectory);
                assertCurrent();
                // No agent entry or placeholder. A reported role is remembered only until explicit configure stores it.
                if (message.payload.role !== undefined) {
                    if (!logicalRole(message.payload.role))
                        fail('invalid role');
                    assertReady();
                    this.registeredRoles.set(message.from, message.payload.role);
                }
                const reportedRole = typeof message.payload.role === 'string' ? message.payload.role : undefined;
                record('registration.received', { ...metadata, port: message.payload.port, ...(reportedRole ? { piRole: reportedRole } : {}) });
                notify('registration', JSON.stringify({ sessionId: message.from, port: message.payload.port, projectDirectory, ...(reportedRole ? { role: reportedRole } : {}) }) + '\nThis is connection information, not a work assignment. Configure explicitly, then reload separately.');
            }
            else {
                if (sender) {
                    assertCurrent();
                    await this.store.update(id, c => {
                        const entry = c.agents.find(a => a.sessionId === message.from && !a.coordinator);
                        if (entry)
                            entry.port = message.payload.port;
                    }, this.configGuard(assertValid, epoch));
                }
                assertCurrent();
                const fence = sender && this.resumeFences.get(sender.sessionId);
                if (fence && fence === eligibleAnnouncement) {
                    assertReady();
                    fence.announced = true;
                    if (!fence.inFlight)
                        this.resumeFences.delete(sender.sessionId);
                }
                if (message.payload.role !== undefined && !logicalRole(message.payload.role))
                    fail('invalid role');
                const reportedRole = typeof message.payload.role === 'string' ? message.payload.role : undefined;
                const expected = sender && !sender.coordinator ? sender.role : undefined;
                const roleMismatch = !!expected && reportedRole !== expected;
                const roleNote = roleMismatch
                    ? `reported role ${reportedRole ?? 'none'} differs from saved role ${expected}; saved role kept, no relaunch`
                    : undefined;
                if (roleNote)
                    this.host.notify(`Worker ${sender.name}: ${roleNote}`);
                record('status.received', { ...metadata, busy: message.payload.busy, port: message.payload.port, ...(reportedRole ? { piRole: reportedRole } : {}) });
                if (sender)
                    record('config.changed', { operation: 'port_update', peerSessionId: message.from, port: message.payload.port, outcome: 'written' });
                notify('status', JSON.stringify({ sessionId: message.from, port: message.payload.port, busy: message.payload.busy, configured: !!sender, ...(reportedRole ? { role: reportedRole } : {}), ...(roleNote ? { roleNote } : {}) }));
            }
            return;
        }
        if (message.kind === 'report') {
            requireCoordinator(config, id);
            if (!sender || sender.coordinator)
                fail('work reports require a configured worker sender');
            const payload = reportPayload(message.payload);
            if (this.pendingReports >= 64)
                fail('report queue full; no report stored');
            // Admission is refused before anything is stored, cleared, or acknowledged: no successful receipt
            // for unsaved evidence, and no accept-and-buffer.
            assertCurrent();
            if (this.options.adoption?.reportPhase)
                await this.options.adoption.reportPhase('admitted');
            assertCurrent();
            this.pendingReports++;
            const pending = this.reportWrites.then(async () => {
                assertCurrent();
                const fresh = await this.state();
                requireCoordinator(fresh.config, id);
                assertCurrent();
                if (!fresh.config.agents.some(agent => agent.sessionId === message.from && !agent.coordinator))
                    fail('reporting worker is no longer configured');
                if (this.options.adoption?.reportPhase)
                    await this.options.adoption.reportPhase('before-save');
                assertCurrent();
                await saveWorkerReport(this.store.root, { version: 1, sessionId: message.from, ...payload, updatedAt: new Date().toISOString() }, phase => {
                    try {
                        if (phase === 'publish')
                            assertReady();
                        else
                            assertCurrent();
                    }
                    catch {
                        throw new ReportPublicationRefused(`${ADOPTION_NOT_READY}: report publication refused before persistence; no report stored or cleared`);
                    }
                });
                try {
                    if (this.options.adoption?.reportPhase)
                        await this.options.adoption.reportPhase('after-save');
                    notify('worker report', `Report: ${payload.status}\n${payload.summary}\nThis is a worker-authored public report, not approval or verified completion. Evaluate it before deciding any next step. Clearing retires the report only; it does not resume or complete work.`);
                }
                catch (error) {
                    // Saved bytes are never rolled back or cleared, and a blocked notification is never reported as
                    // a delivery, an unsaved report, or an approval. It stays visible through stored-report reads.
                    if (String(error).includes(ADOPTION_NOT_READY)) {
                        record('host.submission', { ...metadata, outcome: 'blocked' });
                        fail('Report stored; coordinator notification blocked/not submitted; inspect stored report before any resend');
                    }
                    fail('Report stored, but coordinator notification failed or became uncertain; do not blindly resend');
                }
            });
            this.reportWrites = pending.catch(() => { }).finally(() => { this.pendingReports--; });
            await pending;
            return;
        }
        if (message.kind === 'message') {
            if (!sender || !me)
                fail('agent messaging requires configured sender and recipient; anonymous permissions TODO');
            if (!this.responsibility)
                fail('worker must load responsibility before receiving work');
            if (this.handoff?.workerClosing || fencedClose(me.closeJob))
                fail('worker close is active or uncertain; new Intercom work is fenced');
            notify('agent message', message.payload.message);
            return;
        }
        if (!sender?.coordinator)
            fail('control requires current coordinator sender session ID');
        if (me?.coordinator)
            fail('worker control cannot target coordinator');
        if (message.kind === 'stop' || message.kind === 'close')
            fail(UNSUPPORTED_CANCELLATION);
        if (message.kind === 'reload') {
            if (this.handoff?.workerClosing || fencedClose(me?.closeJob))
                fail('worker close is active or uncertain; reload is fenced');
            await this.reload();
            return;
        }
        if (message.kind === 'request_status') {
            // Independent one-way report, never a synchronous status in the HTTP response.
            setImmediate(() => {
                try {
                    assertValid();
                }
                catch {
                    return;
                } // Closed/replaced requests cannot report for a new lifecycle.
                void this.report().catch(e => {
                    try {
                        assertValid();
                    }
                    catch {
                        return;
                    }
                    this.host.notify(`Status report failed: ${String(e)}`);
                });
            });
            return;
        }
        fail('unsupported control');
    }
    async tool(operation, args, toolCallId, reminderSignal) {
        // Reserve invocation order before state/directory awaits, but only VALID
        // reminder actions advance the accepted revision. Invalid/nonworker calls
        // must not supersede a pending stop or suppress an older valid preflight.
        const invocation = ++this.reminderInvocation;
        const armReminder = () => {
            if (invocation >= this.reminderRevision && !reminderSignal?.aborted) {
                this.reminderRevision = invocation;
                this.reminders?.arm(reminderSignal);
            }
        };
        const record = this.captureObserver();
        const lifecycle = this.validity(), epoch = this.actionEpoch();
        const { id, config, me } = await this.state();
        const assertCurrent = () => { lifecycle(); if (me?.coordinator)
            this.assertActionEpoch(epoch); };
        const assertValid = () => { lifecycle(); if (me?.coordinator)
            this.assertActionReady(epoch); };
        // Admission is also list's final proof: no await or callback intervenes before its result.
        assertValid();
        if (operation === 'worker_status') {
            if (!me)
                fail('worker_status requires a configured session');
            const snapshot = await readObservationSnapshot(this.store.root);
            assertValid();
            if (args.probe !== undefined && typeof args.probe !== 'boolean')
                fail('probe must be a boolean');
            const pageOptions = { name: args.name, offset: args.offset, limit: args.limit };
            const page = workerStatusPage(snapshot, pageOptions);
            if (!args.probe)
                return page;
            const ids = new Set(page.workers.map(worker => worker.sessionId));
            snapshot.connections = await probeWorkers(snapshot.config?.agents.filter(agent => !agent.coordinator && ids.has(agent.sessionId)) ?? [], { signal: this.probeController.signal });
            assertValid();
            return workerStatusPage(snapshot, pageOptions);
        }
        if (operation === 'list') {
            if (!me)
                fail('anonymous intercom_list permissions unresolved (TODO); no coordinator privileges');
            return { ...config, agents: config.agents.map(({ dashboardPort: _retired, ...agent }) => agent) };
        }
        if (operation === 'report_handoff') {
            if (!me || me.coordinator || !this.responsibility || !this.handoff)
                fail('report_handoff requires a configured, responsibility-loaded worker');
            return this.handoff.report(args.jobId, args.summary, toolCallId);
        }
        if (operation === 'report_status') {
            await this.report();
            return { accepted: true };
        }
        if (operation === 'report_work') {
            if (!me || me.coordinator || !this.responsibility)
                fail('report_work requires a configured, responsibility-loaded worker');
            const payload = reportPayload(args);
            await this.transmit(coordinator(config).name, 'report', payload);
            return { accepted: true, coordinatorEvaluation: 'not awaited' };
        }
        if (operation === 'send') {
            if (!me || !this.responsibility)
                fail('anonymous/unloaded worker cannot send agent messages (permissions TODO)');
            const recipient = named(config, args.to);
            text(args.message, 'message', 48000);
            if (this.handoff?.workerClosing || fencedClose(me.closeJob) || this.handoff?.isClosing(recipient.sessionId) || fencedClose(recipient.closeJob))
                fail('worker close is active or uncertain; new Intercom work is fenced');
            if (me.coordinator && !recipient.coordinator)
                armReminder();
            await this.transmit(args.to, 'message', { message: args.message }, assertCurrent);
            return { accepted: true, completion: 'not awaited' };
        }
        requireCoordinator(config, id);
        if (operation === 'stop_reminders') {
            const current = invocation >= this.reminderRevision;
            if (current) {
                this.reminderRevision = invocation;
                this.reminders?.stop();
            }
            return { stopped: current };
        }
        if (operation === 'stop_worker')
            fail(UNSUPPORTED_CANCELLATION);
        if (operation === 'configure_worker') {
            const assertConfigurable = () => {
                assertValid();
                if (this.handoff?.isClosing(args.sessionId) || this.resumeFences.has(args.sessionId))
                    fail('worker lifecycle operation is in flight; configuration is fenced');
            };
            assertConfigurable();
            // Validate the candidate without writing, so invalid input never arms a
            // reminder; persistence failures after valid initiation still do.
            const relative = await directory(this.store.root, args.projectDirectory);
            assertConfigurable();
            const candidate = { sessionId: args.sessionId, name: args.name, description: args.description,
                port: args.port, projectDirectory: relative, coordinator: false };
            if (candidate.sessionId === id)
                fail('cannot configure coordinator as worker');
            const previous = config.agents.find(a => a.sessionId === candidate.sessionId);
            if (fencedClose(previous?.closeJob))
                fail('worker close is active or uncertain; configuration is fenced');
            validateConfig({ ...config, agents: [...config.agents.filter(a => a.sessionId !== candidate.sessionId), candidate] });
            const choice = chooseWorkerRole(config, candidate.sessionId, args.role, this.registeredRoles.get(candidate.sessionId));
            const values = { ...args };
            delete values.role;
            if (choice.role)
                values.role = choice.role;
            armReminder();
            await this.store.configure(id, values, this.configGuard(lifecycle, epoch, () => { if (this.handoff?.isClosing(args.sessionId) || this.resumeFences.has(args.sessionId))
                fail('worker lifecycle operation is in flight; configuration is fenced'); }));
            record('config.changed', { operation: 'configure_worker', peerSessionId: args.sessionId, peerName: args.name, outcome: 'written', ...(choice.role ? { piRole: choice.role } : {}) });
            const saved = (await this.store.read()).agents.find(agent => agent.sessionId === candidate.sessionId);
            assertValid();
            return { written: true, reloaded: false, ...(saved?.role ? { role: saved.role } : {}), ...(choice.roleNote ? { roleNote: choice.roleNote } : {}) };
        }
        if (operation === 'set_multiplexer') {
            await this.store.update(id, c => { c.multiplexer = args.multiplexer; }, this.configGuard(lifecycle, epoch));
            record('config.changed', { operation: 'set_multiplexer', outcome: 'written' });
            return { written: true };
        }
        if (operation === 'create_worker') {
            const relative = await directory(this.store.root, args.projectDirectory ?? '.');
            assertCurrent();
            const role = requestedRole(args.role);
            armReminder();
            const launched = await this.launchObserved({ multiplexer: config.multiplexer, cwd: path.resolve(this.store.root, relative), ...(role ? { role } : {}) }, assertValid);
            // The role is not durable until configure_worker saves it. Echo it so a restarted coordinator can pass it explicitly.
            return role && launched && typeof launched === 'object' ? { ...launched, role } : launched;
        }
        const target = named(config, args.to);
        if (target.coordinator)
            fail('operation requires a worker target');
        if (operation === 'close_worker') {
            if (!this.options.closeProvider || !this.handoff || config.multiplexer !== 'herdr')
                fail('Owned-pane close requires supported Linux Herdr provider; no closure attempted');
            if (this.resumeFences.has(target.sessionId))
                fail('resume is in flight; close is fenced');
            if (fencedClose(target.closeJob) && !this.handoff.isClosing(target.sessionId))
                fail('worker close is active or uncertain; close is fenced');
            armReminder();
            return { job: await this.callbackEpoch.run(epoch, () => this.handoff.request(target)), completion: 'not awaited', contract: 'best-effort owned-pane closure; not all-child-process termination' };
        }
        if (['reload_worker', 'resume_worker', 'remove_worker'].includes(operation) && (this.handoff?.isClosing(target.sessionId) || fencedClose(target.closeJob)))
            fail('worker close is active or uncertain; operation is fenced');
        if (operation === 'reload_worker' || operation === 'request_status') {
            armReminder();
            await this.transmit(target.name, operation === 'reload_worker' ? 'reload' : 'request_status', {}, assertCurrent);
            return { accepted: true, completion: 'not awaited' };
        }
        if (operation === 'resume_worker') {
            if (args.confirmClosed !== true)
                fail('Resume requires explicit user confirmation that the previous worker session is closed (confirmClosed:true). Disconnected alone is not proof of closure.');
            if (this.resumeFences.has(target.sessionId))
                fail('Resume already in flight or awaiting worker status; outcome may be uncertain. Inspect the worker before any retry; no automatic relaunch.');
            const fence = { inFlight: true, submitted: false, announced: false };
            this.resumeFences.set(target.sessionId, fence);
            armReminder();
            let completed = false;
            try {
                const connection = await (this.options.probe ?? probeWorker)(target, { signal: this.probeController.signal });
                assertCurrent();
                if (connection.state === 'connected')
                    fail('Worker endpoint is still connected; refusing to resume the same session twice.');
                const relative = await directory(this.store.root, target.projectDirectory);
                assertCurrent();
                const cwd = path.resolve(this.store.root, relative);
                const fresh = await this.state();
                assertCurrent();
                requireCoordinator(fresh.config, id);
                const current = fresh.config.agents.find(agent => agent.sessionId === target.sessionId && !agent.coordinator);
                if (!current || current.port !== target.port || current.projectDirectory !== target.projectDirectory || current.role !== target.role)
                    fail('Worker configuration changed during resume check; no launch submitted.');
                if (this.handoff?.isClosing(target.sessionId) || fencedClose(current.closeJob))
                    fail('worker close is active or uncertain; resume is fenced');
                if (current.role !== undefined && !logicalRole(current.role))
                    fail('invalid role');
                const result = await this.launchObserved({ multiplexer: fresh.config.multiplexer, cwd, sessionId: current.sessionId, ...(current.role ? { role: current.role } : {}) }, () => { assertValid(); fence.submitted = true; });
                completed = true;
                return result;
            }
            finally {
                fence.inFlight = false;
                if ((!fence.submitted || (completed && fence.announced)) && this.resumeFences.get(target.sessionId) === fence)
                    this.resumeFences.delete(target.sessionId);
            }
        }
        if (operation === 'remove_worker') {
            // No live process claim: the caller must explicitly ensure closure first.
            await this.store.update(id, c => {
                const current = c.agents.find(a => a.sessionId === target.sessionId);
                if (this.handoff?.isClosing(target.sessionId) || this.resumeFences.has(target.sessionId) || fencedClose(current?.closeJob))
                    fail('worker lifecycle operation is active or uncertain; removal is fenced');
                c.agents = c.agents.filter(a => a.sessionId !== target.sessionId);
            }, this.configGuard(lifecycle, epoch));
            record('config.changed', { operation: 'remove_worker', peerSessionId: target.sessionId, peerName: target.name, outcome: 'removed' });
            return { removed: true, processStopped: false, sessionDeleted: false };
        }
        fail(`unknown operation ${operation}`);
    }
    async launchObserved(request, assertDispatch) {
        const record = this.captureObserver();
        const metadata = {
            operation: request.sessionId ? 'resume_worker' : 'create_worker', peerSessionId: request.sessionId,
            ...(request.role && logicalRole(request.role) ? { piRole: request.role } : {}),
        };
        record('launch.result', { ...metadata, outcome: 'attempted' });
        try {
            // The original operation's epoch, not a newly captured one. Observation may be reentrant.
            // This dispatch admits one existing composite adapter operation, not cancellable subcommands.
            assertDispatch();
            const result = await this.options.launch(request);
            record('launch.result', { ...metadata, outcome: 'returned' });
            return result;
        }
        catch (error) {
            record('launch.result', { ...metadata, outcome: 'failed', errorCode: observationError(error) });
            throw error;
        }
    }
}
//# sourceMappingURL=runtime.js.map