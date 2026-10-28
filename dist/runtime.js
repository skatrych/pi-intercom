import path from 'node:path';
import { homedir } from 'node:os';
import { lstatSync, realpathSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { LocalObserver, LOG_LIMITS, observationError } from './observability.js';
import { ConfigStore, WORKER_ROLE_ENV, coordinator, directory, fail, logicalRole, named, requireCoordinator, requireCoordinatorPair, sameCanonicalPath, text, validateConfig } from './config.js';
import { listen, send, reportPayload } from './transport.js';
import { ReportPublicationRefused, saveWorkerReport } from './reports.js';
import { readObservationSnapshot } from './snapshot.js';
import { workerStatusPage } from './worker-status.js';
import { probeWorker, probeWorkers } from './connections.js';
import { HandoffWorkflow, HANDOFF_KINDS, fencedClose } from './handoff.js';
import { CoordinatorReminders, DEFAULT_REMINDER_INTERVAL_MS, readReminderMinutesEnv, reminderIntervalMs } from './reminders.js';
import { loadReminderContent, readReminderFileEnv, REMINDER_CONFIGURATION_DIAGNOSTIC } from './reminder-content.js';
import { AdoptionFailure, AdoptionWorkflow, ORCHESTRATOR_ROLE, PROJECTS_HOME_ENV, countBoards, projectsHome, stop } from './adoption.js';
export const UNSUPPORTED_CANCELLATION = 'Unsupported Pi host: stop_worker and legacy graceful-close control are disabled. Pi 0.84.4 extension abort does not cancel retry backoff/continuations; graceful shutdown cannot guarantee no queued work restarts. No cancellation or shutdown was performed. close_worker uses a separate supported-provider owned-pane closure contract, not graceful cancellation. See references/implementation-blocker.md. A verified supported host API is required for graceful cancellation (no version-only override).';
/** Named refusal for an effect whose current-config permission no longer holds (ADR 0025). */
export const COORDINATOR_NOT_AUTHORIZED = 'COORDINATOR_NOT_AUTHORIZED';
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
    configuredRoot;
    configuredFile;
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
    reminders;
    reminderRevision = 0;
    reminderInvocation = 0;
    /** Snapshot once per start (startServices consumes it); see PI_INTERCOM_REMINDER_MINUTES docs. */
    reminderIntervalMsCache = DEFAULT_REMINDER_INTERVAL_MS;
    /** Immutable reminder text snapshot for this runtime only; undefined disables reminders for it. */
    reminderContent;
    /**
     * Coordinator authority is the board config entry (ADR 0025): this runtime's native session id plus the
     * port its endpoint actually bound, matched against the single coordinator entry. There is no claim
     * file, evidence record, Git state, readiness generation, or authority epoch anywhere in this class.
     * A cached flag is never permission: `assertCoordinatorEffect` re-reads the board at each real effect
     * boundary, and `ConfigStore` independently repeats the exact-pair check at locked admission and at
     * every publication attempt. Ordinary worker traffic keeps its own recipient/target/job rules and never
     * acquires a coordinator-only gate.
     */
    adoption;
    /**
     * True only while a canonical Orchestrator startup is inside the boot-only port recovery window (P3).
     * The minimal bound health endpoint stays available; no responsibility load, handoff recovery, observer
     * maintenance, reminder, registration/status/config callback, tool, or send may overtake verified
     * publication plus an exact-pair responsibility load.
     */
    bootHeld = false;
    /** At most one port change may use the captured boot snapshot of one startup. */
    bootPortAttempted = false;
    /** The counted board layout captured at startup: P3 may not publish across a changed ancestor chain. */
    startupHome;
    startupCwd;
    startupBoards = [];
    /** This runtime's captured authority pair: native session id and the port actually bound. Never an argument. */
    caller() {
        const sessionId = this.id();
        if (this.endpoint === undefined)
            fail('this runtime has no bound endpoint; a port is never guessed');
        return { sessionId, port: this.endpoint.port };
    }
    /**
     * The current-config permission that replaced every claim and epoch proof. It re-reads the board with
     * the one strict reader and requires this runtime's exact coordinator pair, a valid lifecycle, and a
     * bound root. Where an effect also needs the loaded role, it says so explicitly.
     */
    async assertCoordinatorEffect(assertValid, requirements = {}) {
        return this.assertEffectAllowed(assertValid, { ...requirements, coordinator: true });
    }
    /**
     * Permission for an effect that either role may own (a handoff send/delivery crosses both directions).
     * A coordinator needs its exact pair; a configured worker needs to still be the worker entry it was
     * admitted as. Neither may fall through anonymously, and neither gains the other's permission.
     */
    async assertEffectAllowed(assertValid, requirements = {}) {
        assertValid();
        const caller = this.caller();
        const config = await this.store.read();
        assertValid();
        const entry = config.agents.find(agent => agent.sessionId === caller.sessionId);
        if (!entry)
            fail(`${COORDINATOR_NOT_AUTHORIZED}: this session is no longer a configured entry; no effect may use a stale role`);
        if (entry.coordinator)
            requireCoordinatorPair(config, caller);
        else if (requirements.coordinator)
            fail(`${COORDINATOR_NOT_AUTHORIZED}: coordinator permission required`);
        if (this.bootHeld)
            fail(`${COORDINATOR_NOT_AUTHORIZED}: the boot port boundary is not verified; no coordinator effect may overtake it`);
        if (requirements.responsibility && !this.responsibility)
            fail(`${COORDINATOR_NOT_AUTHORIZED}: responsibility is not loaded`);
        return config;
    }
    /** The same permission for a synchronous seam. Same strict reader, same refusal, no cache. */
    assertEffectAllowedSync(requirements = {}) {
        const caller = this.caller();
        const config = this.store.readDocumentSync().config;
        const entry = config.agents.find(agent => agent.sessionId === caller.sessionId);
        if (!entry)
            fail(`${COORDINATOR_NOT_AUTHORIZED}: this session is no longer a configured entry`);
        if (entry.coordinator)
            requireCoordinatorPair(config, caller);
        else if (requirements.coordinator)
            fail(`${COORDINATOR_NOT_AUTHORIZED}: coordinator permission required`);
        if (this.bootHeld)
            fail(`${COORDINATOR_NOT_AUTHORIZED}: the boot port boundary is not verified`);
        if (requirements.responsibility && !this.responsibility)
            fail(`${COORDINATOR_NOT_AUTHORIZED}: responsibility is not loaded`);
    }
    assertCoordinatorEffectSync(requirements = {}) {
        this.assertEffectAllowedSync({ ...requirements, coordinator: true });
    }
    /** Re-prove an admitted role after an await, so a former coordinator cannot fall through as worker traffic. */
    async assertRoleUnchanged(admitted, assertValid) {
        if (admitted.coordinator) {
            await this.assertCoordinatorEffect(assertValid);
            return;
        }
        if (!admitted.configured)
            return; // an anonymous session stays anonymous: it acquires no new permission either way
        const config = await this.store.read();
        assertValid();
        if (!config.agents.some(agent => agent.sessionId === this.initialId && !agent.coordinator)) {
            fail(`${COORDINATOR_NOT_AUTHORIZED}: this session is no longer the configured worker it was admitted as`);
        }
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
        if (this.configuredRoot !== undefined && (this.store.root !== this.configuredRoot || this.store.file !== this.configuredFile)) {
            // Upstream's boundary pin refuses the operation. It is checked here, before any store guard runs:
            // a store whose validated root changed can neither write safely now nor be trusted by a later
            // coordinator effect, because every effect re-reads the board through this same store.
            fail('config store boundary changed');
        }
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
        this.configuredRoot = undefined;
        this.configuredFile = undefined;
        this.probeController = new AbortController();
        this.resumeFences.clear();
        this.registeredRoles.clear();
        this.roleResolved = false;
        this.resolvedRole = undefined;
        this.bootHeld = false;
        this.bootPortAttempted = false;
        this.responsibility = undefined;
        // The reminder text snapshot belongs to this runtime lifecycle only; a replacement loads its own.
        this.reminderContent = undefined;
        this.observationEnabled = !this.orchestratorLaunch();
        const generation = ++this.generation, assertValid = this.validity();
        // Snapshot the reminder interval once for this runtime. A child tool cannot
        // change this process environment, and Pi /reload restarts this runtime.
        // Snapshot the reminder interval once for this runtime; startServices consumes it.
        this.reminderIntervalMsCache = reminderIntervalMs((this.options.reminderMinutesEnv ?? readReminderMinutesEnv)());
        let record = this.captureObserver();
        try {
            // Count the actual ancestor chain before discovery reads any config or observer creates state.
            let countedRoot, countedBoard = false;
            if (this.orchestratorLaunch()) {
                const home = projectsHome({ projectsHome: this.options.adoption?.projectsHome ?? process.env[PROJECTS_HOME_ENV], homeDirectory: homedir() });
                const cwd = await realpath(this.host.cwd), root = await realpath(home);
                const relative = path.relative(root, cwd);
                // Compare the canonical result with the original input: a canonical path may differ only in case on
                // Windows, while a symlink/alias still differs and is refused.
                if (!sameCanonicalPath(cwd, this.host.cwd) || !sameCanonicalPath(root, home) || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
                    fail('unsafe Orchestrator projects-home/cwd path');
                const boards = await countBoards(cwd, root);
                this.startupHome = root;
                this.startupCwd = cwd;
                this.startupBoards = [...boards];
                // Board isolation, not traceability: an empty or malformed extra board still stops, and every
                // refusal names the offending path, the expected root, and the one human-safe remediation.
                if (boards.length > 1)
                    fail(`BOARD_COUNT: a second board at ${path.join(boards[1], '.pi-intercom')} is a creation-time failure, not a cleanup item; the expected root is ${path.join(root, '.pi-intercom')} and the boards found are ${boards.join(', ')}; a human may remove a confirmed empty, unintended stray directory and retry, and populated or malformed board data needs separate inspection, never recursive deletion`);
                if (boards.length === 1 && boards[0] !== root)
                    fail(`BOARD_COUNT: the only board is at ${path.join(boards[0], '.pi-intercom')}, not the projects home ${path.join(root, '.pi-intercom')}; stop, and never discover above the projects home`);
                countedRoot = root;
                countedBoard = boards.length === 1;
            }
            // An explicit --intercom-root is admitted only when it canonically equals the session cwd or one
            // of its ancestors (ConfigStore.workspace), which is how a subfolder worker reaches the board roster.
            // Fork Orchestrator launches carry no such flag, so the counted projects-home board below is the
            // only way a session binds an ancestor board, and it is still pinned and revalidated by the checks
            // underneath exactly like a session-local root.
            const discovered = this.options.workspaceRoot !== undefined
                ? await ConfigStore.workspace(this.host.cwd, this.options.workspaceRoot)
                : countedRoot
                    // Never discover above the already-counted projects home or fall back to an unrelated board.
                    ? (countedBoard ? new ConfigStore(countedRoot) : undefined)
                    : await ConfigStore.discover(this.host.cwd);
            assertValid();
            const root = discovered?.root ?? await realpath(countedRoot ?? this.host.cwd);
            assertValid();
            this.store = this.options.store?.(root) ?? discovered ?? new ConfigStore(root);
            if (this.store.root !== root || this.store.file !== path.join(root, '.pi-intercom', 'config.json'))
                fail('config store must retain validated session root');
            this.configuredRoot = root;
            this.configuredFile = this.store.file;
            await this.store.validateRoot(root);
            assertValid();
            this.observationEnabled = !countedRoot || countedBoard;
            // Absence means a missing config (ENOENT), never a parse, permission or path failure: an existing
            // empty root metadata directory is allowed, and initialization can fill it in.
            let previousDocument;
            if (discovered !== undefined) {
                try {
                    previousDocument = await this.store.readDocument();
                }
                catch (error) {
                    if (error.code !== 'ENOENT')
                        throw error;
                }
            }
            const previous = previousDocument?.config;
            assertValid();
            // Construction is inert: a LocalObserver writes only when it records, and every record is gated by
            // observationEnabled, which stays closed across the boot boundary below.
            try {
                this.observer = this.options.observe ? this.options.observe(this.store.root, this.initialId) : new LocalObserver(this.store.root, this.initialId);
            }
            catch { /* Logging is optional on failure. */ }
            record = this.captureObserver();
            // Reminder text is loaded once for this runtime before any reminder can exist; failure disables only reminders.
            // The load happens before the endpoint binds, so a lifecycle/endpoint failure across it can never
            // leave a half-started runtime, and the snapshot belongs to exactly this start.
            this.reminderContent = await this.loadReminderSnapshot(assertValid);
            assertValid();
            const own = previous?.agents.find(a => a.sessionId === this.initialId);
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
            // Up to here only a health endpoint was bound: no board write, no service, no responsibility load,
            // and no coordinator effect. Binding a port is never an authority grant, and a held session still
            // answers read-only `/intercom-adopt status`.
            const board = previous ? coordinator(previous) : undefined;
            const bootPending = board !== undefined && board.sessionId === this.initialId && board.port !== endpoint.port && previousDocument !== undefined;
            // Coordinator-startup observer records are held back until responsibility is loaded (ADR 0025 P3).
            const deferredRecords = [];
            if (previousDocument === undefined) {
                // ---- first board: ordinary runtime startup, zero questions, zero claims --------------------
                // A canonical Orchestrator launch creates the first board only at the projects home: a child
                // directory never receives a private board, and the empty root metadata directory it may have is
                // an allowed absence. Any other session preserves upstream behavior at its own resolved root.
                // First-board creation is allowed only at the canonical projects-home cwd itself, including when
                // an empty metadata directory already exists there. A child cwd is always held, never initialized.
                if (countedRoot !== undefined && !sameCanonicalPath(await realpath(this.host.cwd), countedRoot)) {
                    record('runtime.ready', { port: endpoint.port, role: 'anonymous', outcome: 'ready' });
                    this.host.notify(`Intercom Orchestrator held at 127.0.0.1:${endpoint.port}; no board exists between ${this.host.cwd} and ${countedRoot}, and a private board is never created in a child directory. Enter /intercom-adopt status.`);
                    return;
                }
                const caller = this.caller();
                const initialized = await this.store.initialize(caller, assertValid);
                assertValid();
                const winner = await this.store.read();
                assertValid();
                const won = coordinator(winner);
                this.observationEnabled = true;
                if (initialized)
                    deferredRecords.push({ event: 'config.changed', metadata: { operation: 'initialize', outcome: 'written' } });
                if (won.sessionId !== caller.sessionId || won.port !== caller.port) {
                    // A competing initializer won the no-replace publication. Its board is read normally, and it
                    // grants this runtime nothing: no replacement, no question, and no coordinator effect.
                    record('runtime.ready', { port: endpoint.port, role: 'anonymous', outcome: 'ready' });
                    this.host.notify(`Intercom Orchestrator held at 127.0.0.1:${endpoint.port}; another initializer created the board as ${won.sessionId}/${won.port}, which does not name this runtime pair ${caller.sessionId}/${caller.port}, so no authority is claimed and no replacement is attempted at startup. Enter /intercom-adopt status.`);
                    return;
                }
            }
            const config = await this.store.read();
            assertValid();
            const me = config.agents.find(a => a.sessionId === this.initialId);
            if (me?.coordinator) {
                // ---- boot boundary (ADR 0025 P3) ---------------------------------------------------------
                // A configured coordinator whose saved port fell back publishes the verified port here, and only
                // here, before responsibility load, handoff recovery, observer maintenance, reminders, config
                // callbacks, tools, or sends. A same-port startup performs no redundant port write.
                if (me.port !== this.endpoint.port) {
                    const outcome = await this.recoverBootPort(previousDocument, assertValid);
                    if (outcome !== 'recovered') {
                        record('runtime.ready', { port: endpoint.port, role: 'anonymous', outcome: 'ready' });
                        this.host.notify(`Intercom Coordinator held at 127.0.0.1:${endpoint.port}; ${outcome}. Only the read-only health endpoint and /intercom-adopt status are available; no other coordinator effect ran and nothing was repaired or retried. Restart this session on a non-conflicting port.`);
                        return;
                    }
                    deferredRecords.push({ event: 'config.changed', metadata: { operation: 'port_update', outcome: 'written', port: this.endpoint.port } });
                }
                // Verified exact pair: responsibility loads in place, write-free, with no worker action, reload,
                // job recovery, report clearing, or model turn.
                try {
                    await this.reload();
                }
                catch (e) {
                    assertValid();
                    this.host.notify(`Name/responsibility synchronization failed: ${String(e)}`);
                }
                assertValid();
                try {
                    await this.assertCoordinatorEffect(assertValid, { responsibility: true });
                }
                catch (error) {
                    assertValid();
                    record('host.submission', { outcome: 'blocked', errorCode: 'operation_failed' });
                    this.host.notify(`Intercom Coordinator endpoint at 127.0.0.1:${this.endpoint.port}; ${String(error)}; coordinator tools, close recovery and observer maintenance stay refused until the board names this exact pair.`);
                    return;
                }
                // Only now, with the exact pair and loaded responsibility, may the observer see coordinator events.
                this.observationEnabled = true;
                record('runtime.starting');
                for (const deferred of deferredRecords)
                    record(deferred.event, deferred.metadata);
                this.startServices(assertValid);
                await this.handoff.recover();
                assertValid();
                // Recovery awaits: re-prove the exact pair and loaded role before maintenance and the ready notice.
                try {
                    await this.assertCoordinatorEffect(assertValid, { responsibility: true });
                }
                catch (error) {
                    assertValid();
                    record('host.submission', { outcome: 'blocked', errorCode: 'operation_failed' });
                    this.host.notify(`Intercom Coordinator held at 127.0.0.1:${this.endpoint.port}; the board stopped naming this exact pair during boot recovery (${String(error)}); observer maintenance and the ready notice were not run. Restart with the current board entry.`);
                    return;
                }
                try {
                    this.observer?.maintain?.();
                }
                catch { /* No cleanup failure affects readiness. */ }
                this.assertCoordinatorEffectSync({ responsibility: true });
                this.host.notify(`Intercom Coordinator ready at 127.0.0.1:${this.endpoint.port}; waiting for user input.`);
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
                if (!bootPending)
                    record('runtime.starting');
                for (const deferred of deferredRecords)
                    record(deferred.event, deferred.metadata);
                this.startServices(assertValid);
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
    /**
     * Resolves the optional reminder selector exactly once. A present-but-invalid selection emits the one fixed
     * diagnostic and yields no content; the diagnostic carries no path, value, contents or raw error.
     */
    async loadReminderSnapshot(assertValid) {
        const loaded = await loadReminderContent((this.options.reminderFileEnv ?? readReminderFileEnv)(), { files: this.options.reminderFiles });
        assertValid();
        if (loaded.ok)
            return loaded.content;
        this.host.notify(REMINDER_CONFIGURATION_DIAGNOSTIC);
        return undefined;
    }
    startServices(assertValid) {
        const content = this.reminderContent;
        // Reminders exist only with valid content: an unavailable selection never arms or delivers any text.
        // Authority stays the current-config exact-pair proof (ADR 0025) on every boundary that can effect.
        this.reminders = content ? new CoordinatorReminders({
            // Timer preparation only checks the captured lifecycle; delivery owns the fresh current-config proof.
            captureGuard: () => () => assertValid(),
            isCoordinator: async () => {
                if (this.bootHeld || !this.endpoint || !this.responsibility?.coordinator)
                    return false;
                const fresh = await this.state();
                assertValid();
                if (!fresh.me?.coordinator)
                    return false;
                const board = coordinator(fresh.config);
                return board.sessionId === this.initialId && board.port === this.endpoint?.port;
            },
            busy: () => this.host.busy(),
            // The fresh final proof is owned here, synchronously immediately before the host submission, so no
            // await can reopen the gap between permission and effect.
            deliver: (message, submission) => { assertValid(); this.assertCoordinatorEffectSync({ responsibility: true }); this.host.deliver(message, false, submission); },
        }, this.options.reminderClock, this.reminderIntervalMsCache, content) : undefined;
        this.handoff = new HandoffWorkflow({
            state: async () => this.state(),
            // Provider inspection/closure guards call this final callback: retain role-appropriate current
            // config permission alongside lifecycle/job/target guards, so a revoked pair blocks the pane effect.
            assertCurrent: () => { assertValid(); this.assertEffectAllowedSync({ responsibility: true }); },
            update: async (mutate, guard) => {
                // The store re-proves the exact pair at locked admission and at every publication attempt; this
                // guard keeps the caller's own target/lifecycle predicates in front of each mutation.
                await this.store.update(this.caller(), mutate, () => { assertValid(); guard?.(); });
            },
            send: async (sessionId, kind, payload) => {
                const state = await this.state();
                assertValid();
                const target = state.config.agents.find(a => a.sessionId === sessionId);
                if (!target)
                    fail('handoff recipient no longer configured');
                // Handoff traffic runs in both directions, so each side proves its own current role synchronously
                // immediately before the send, with no await between the proof and the effect.
                this.assertEffectAllowedSync({ responsibility: true });
                await (this.options.send ?? send)(target.port, { version: 1, kind, from: state.id, to: sessionId, payload, correlationId: randomUUID() });
                assertValid();
            },
            deliver: message => { assertValid(); this.assertEffectAllowedSync({ responsibility: true }); this.host.deliver(message, this.host.busy()); },
            busy: () => this.host.busy(), provider: this.options.closeProvider, timeoutMs: this.options.closeTimeoutMs,
        });
    }
    /**
     * The private boot-only verified-port publication (ADR 0025 P3). Reachable only from this captured
     * canonical Orchestrator startup that holds the initial strict config snapshot; never a tool, a status
     * path, a command repair, or an id-only exemption on `update`. At most one port change may use the
     * captured snapshot, and every refusal keeps the runtime held with no other coordinator effect.
     *
     * Returns 'recovered' or a human-readable held reason. It never retries a mutation automatically.
     */
    async recoverBootPort(initial, assertValid) {
        const saved = coordinator(initial.config);
        const endpoint = this.endpoint;
        // Freeze the numeric port and the wrapper identity separately before any boot await. The wrapper's
        // `port` property is mutable and must never be used as its own snapshot.
        const bootPort = endpoint.port;
        const pair = `saved ${saved.sessionId}/${saved.port}, actual ${this.initialId}/${bootPort}`;
        if (!this.orchestratorLaunch()) {
            this.bootHeld = false;
            return `this session is not the canonical Orchestrator launch, so no boot port recovery is permitted for ${pair} on the board at ${this.store.file}`;
        }
        if (this.bootPortAttempted)
            return `this startup already used its one boot port publication for ${pair}; restart Pi to begin a fresh boot`;
        this.bootPortAttempted = true;
        this.bootHeld = true;
        // No observer write, service side effect, or coordinator effect may overtake the boundary.
        this.observationEnabled = false;
        const probe = this.options.probe ?? probeWorker;
        const verifyOwnEndpoint = async () => {
            assertValid();
            const own = await probe({ sessionId: this.initialId, port: bootPort }, { timeoutMs: 2000 });
            assertValid();
            if (own.state !== 'connected')
                fail(`${COORDINATOR_NOT_AUTHORIZED}: this bound endpoint did not verify session ${this.initialId} (${own.reason}); a port is never guessed and the boot publication stops`);
        };
        try {
            // Verify this own endpoint before lock acquisition, then again after every await inside the store.
            await verifyOwnEndpoint();
            await this.store.publishCoordinatorPort({
                sessionId: this.initialId,
                expectedRaw: initial.raw,
                savedPort: saved.port,
                newPort: bootPort,
                recheck: async () => {
                    this.assertBoundEndpoint(endpoint, bootPort);
                    await verifyOwnEndpoint();
                    // A bounded observation of the saved pair, never a liveness fence against a later reconnect: a
                    // matching live identity refuses; disconnected/unknown proceeds under the accepted P3 risk.
                    const old = await probe({ sessionId: saved.sessionId, port: saved.port }, { timeoutMs: 2000 });
                    assertValid();
                    if (old.state === 'connected')
                        fail(`${COORDINATOR_NOT_AUTHORIZED}: the saved pair ${saved.sessionId}/${saved.port} still answers at its endpoint, so the boot publication refuses rather than rebinding a live coordinator`);
                    await this.store.validateRoot(this.store.root);
                    assertValid();
                },
                assertValid: () => { assertValid(); this.assertBoundEndpoint(endpoint, bootPort); this.assertCoordinatorPaths(); },
            });
            const published = this.store.readDocumentSync();
            // Post-publication verification uses the runtime's current endpoint, never only the captured one.
            requireCoordinatorPair(published.config, this.caller());
            this.bootHeld = false;
            // Observation stays closed until responsibility is loaded after the guarded publication.
            return 'recovered';
        }
        catch (error) {
            assertValid();
            this.bootHeld = false;
            this.observationEnabled = false;
            return `the guarded boot port recovery for ${pair} on the board at ${this.store.file} stopped: ${String(error)}`;
        }
    }
    /**
     * The captured boot endpoint must still be the runtime's current endpoint. Binding a replacement
     * listener and closing the old one during staging must refuse the publication, not publish a closed port.
     */
    assertBoundEndpoint(expected, capturedPort) {
        // Compare the immutable numeric snapshot, not a property read back from the mutable wrapper: a
        // retained Endpoint object can be rebound with Object.assign while still being the same object.
        if (this.endpoint !== expected || this.endpoint?.port !== capturedPort) {
            fail(`${COORDINATOR_NOT_AUTHORIZED}: this runtime's bound endpoint changed during boot publication (captured ${capturedPort}, current ${this.endpoint?.port ?? 'none'}); the saved port is not published from a closed or replaced endpoint`);
        }
    }
    /** Root/board/path validity independent of any caller guard, re-proved after each boot await. */
    assertCoordinatorPaths() {
        if (this.configuredRoot !== undefined && (this.store.root !== this.configuredRoot || this.store.file !== this.configuredFile))
            fail('config store boundary changed');
        if (realpathSync(this.store.root) !== this.store.root)
            fail('config store root is aliased');
        this.assertStartupBoardLayout();
    }
    /**
     * The ancestor board chain counted at startup must be unchanged when P3 publishes: a second board
     * appearing (or the counted one disappearing) during a boot probe invalidates the captured snapshot.
     */
    assertStartupBoardLayout() {
        if (this.startupHome === undefined || this.startupCwd === undefined)
            return;
        const seen = [];
        let at = this.startupCwd;
        for (;;) {
            const board = path.join(at, '.pi-intercom');
            try {
                const info = lstatSync(board);
                if (!info.isDirectory() || info.isSymbolicLink())
                    fail(`BOARD_COUNT: unsafe board directory at ${board}; the boot port publication stops`);
                seen.push(at);
            }
            catch (error) {
                if (error.code !== 'ENOENT')
                    throw error;
            }
            if (at === this.startupHome)
                break;
            const parent = path.dirname(at);
            if (parent === at)
                break;
            at = parent;
        }
        if (seen.join('\n') !== this.startupBoards.join('\n')) {
            fail(`BOARD_COUNT: the ancestor board layout changed during boot (was ${this.startupBoards.join(', ') || 'none'}, now ${seen.join(', ') || 'none'}); the boot port publication stops`);
        }
    }
    /** Final synchronous permission for an already-admitted coordinator effect (monitor pane operations). */
    assertCoordinatorFinal(requirements = {}) { this.assertCoordinatorEffectSync(requirements); }
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
    /** Canonical launch role only: `<PI_ROLES_DIR or ~/.pi/roles>/orchestrator`, captured from this process. */
    orchestratorLaunch() {
        const configured = this.launchRoleDirectory;
        if (!configured || !configured.trim() || (this.launchWorkerRole && this.launchWorkerRole !== ORCHESTRATOR_ROLE))
            return false;
        return path.resolve(configured) === path.resolve(this.launchRolesDirectory, ORCHESTRATOR_ROLE);
    }
    /**
     * A cheap, non-authorizing readiness view for UI surfaces such as the monitor. Permission is never
     * decided here: every real effect re-reads the board at its own boundary, and `ConfigStore` re-proves
     * the exact pair at locked admission and at every publication attempt.
     */
    async coordinatorActionReady() {
        if (!this.active || this.endpoint === undefined || this.bootHeld || this.responsibility?.coordinator !== true)
            return false;
        try {
            const board = coordinator(await this.store.read());
            return board.sessionId === this.initialId && board.port === this.endpoint.port;
        }
        catch {
            return false;
        }
    }
    responsibilityLoaded() { return this.responsibility !== undefined; }
    /**
     * In-place promotion. No `start`, `close`, `HandoffWorkflow.recover`, extension reload,
     * worker action, monitor or pane operation, log maintenance, report clearing, session replacement, or
     * job-state rewrite. It reads config and loads this session's responsibility from the new entry only.
     */
    async promoteCoordinator() {
        const record = this.captureObserver(), assertValid = this.validity();
        await this.assertCoordinatorEffect(assertValid);
        const { me } = await this.state();
        assertValid();
        // The board, not the caller, decides: only the current exact coordinator pair may be loaded here.
        requireCoordinatorPair(await this.store.read(), this.caller());
        if (!me?.coordinator)
            fail('promotion requires this session to be the coordinator entry on this board');
        this.responsibility = { ...me };
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
            promote: async () => { try {
                await this.promoteCoordinator();
                return undefined;
            }
            catch (error) {
                return String(error);
            } },
            responsibilityLoaded: () => this.responsibilityLoaded(),
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
        const record = this.captureObserver(), assertValid = this.validity();
        await this.assertCoordinatorEffect(assertValid, { responsibility: true });
        const { id, config } = await this.state();
        assertValid();
        if (requireCoordinator(config, id).dashboardPort === undefined)
            return;
        await this.store.update(this.caller(), c => { delete requireCoordinator(c, id).dashboardPort; }, () => assertValid());
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
        const assertValid = this.validity();
        const { id, config, me } = await this.state();
        const admitted = { coordinator: me?.coordinator === true, configured: me !== undefined };
        assertValid();
        guard();
        const target = named(config, to), correlationId = randomUUID();
        if (['message', 'reload'].includes(kind) && (this.handoff?.isClosing(target.sessionId) || fencedClose(target.closeJob)))
            fail('worker close is active or uncertain; new Intercom work is fenced');
        const metadata = { peerSessionId: target.sessionId, peerName: target.name, correlationId, kind };
        record('transport.send', { ...metadata, outcome: 'attempted' });
        try {
            // Re-prove the admitted role after the awaits and immediately before the dispatch: a coordinator
            // replaced meanwhile cannot keep sending, and cannot fall through as ordinary worker traffic either.
            assertValid();
            await this.assertRoleUnchanged(admitted, assertValid);
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
        // An incoming callback binds the role it was admitted in. A callback that crosses a config
        // replacement stops at its next side effect, with no buffered or replayed delivery later.
        const receivedFence = message.kind === 'status' ? this.resumeFences.get(message.from) : undefined;
        const eligibleAnnouncement = receivedFence?.submitted ? receivedFence : undefined;
        const { id, config, me } = await this.state();
        const admitted = { coordinator: me?.coordinator === true, configured: me !== undefined };
        assertValid();
        if (message.to !== id)
            fail('recipient session ID mismatch (stale endpoint)');
        const sender = config.agents.find(a => a.sessionId === message.from);
        const busy = this.host.busy();
        const metadata = { peerSessionId: message.from, peerName: sender?.name, correlationId: message.correlationId, kind: message.kind, busy };
        const assertAdmitted = () => { assertValid(); if (admitted.coordinator)
            this.assertCoordinatorEffectSync(); };
        const notify = async (purpose, content) => {
            record('host.submission', { ...metadata, outcome: 'attempted' });
            try {
                // Fresh current-config proof immediately before the host submission, never from a cached role.
                await this.assertRoleUnchanged(admitted, assertValid);
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
            assertValid();
            await this.handoff.receive(message.kind, message.from, message.payload);
            return;
        }
        if (message.kind === 'registration' || message.kind === 'status') {
            requireCoordinatorPair(config, this.caller());
            if (sender?.coordinator)
                fail('coordinator cannot report as worker');
            if (message.kind === 'registration') {
                const projectDirectory = await directory(this.store.root, message.payload.projectDirectory);
                assertAdmitted();
                // No agent entry or placeholder. A reported role is remembered only until explicit configure stores it.
                if (message.payload.role !== undefined) {
                    if (!logicalRole(message.payload.role))
                        fail('invalid role');
                    await this.assertCoordinatorEffect(assertValid);
                    this.registeredRoles.set(message.from, message.payload.role);
                }
                const reportedRole = typeof message.payload.role === 'string' ? message.payload.role : undefined;
                record('registration.received', { ...metadata, port: message.payload.port, ...(reportedRole ? { piRole: reportedRole } : {}) });
                await notify('registration', JSON.stringify({ sessionId: message.from, port: message.payload.port, projectDirectory, ...(reportedRole ? { role: reportedRole } : {}) }) + '\nThis is connection information, not a work assignment. Configure explicitly, then reload separately.');
            }
            else {
                if (sender) {
                    assertAdmitted();
                    await this.store.update(this.caller(), c => {
                        const entry = c.agents.find(a => a.sessionId === message.from && !a.coordinator);
                        if (entry)
                            entry.port = message.payload.port;
                    }, () => assertValid());
                }
                assertAdmitted();
                const fence = sender && this.resumeFences.get(sender.sessionId);
                if (fence && fence === eligibleAnnouncement) {
                    await this.assertCoordinatorEffect(assertValid);
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
                await notify('status', JSON.stringify({ sessionId: message.from, port: message.payload.port, busy: message.payload.busy, configured: !!sender, ...(reportedRole ? { role: reportedRole } : {}), ...(roleNote ? { roleNote } : {}) }));
            }
            return;
        }
        if (message.kind === 'report') {
            requireCoordinatorPair(config, this.caller());
            if (!sender || sender.coordinator)
                fail('work reports require a configured worker sender');
            const payload = reportPayload(message.payload);
            if (this.pendingReports >= 64)
                fail('report queue full; no report stored');
            // Admission is refused before anything is stored, cleared, or acknowledged: no successful receipt
            // for unsaved evidence, and no accept-and-buffer.
            assertAdmitted();
            if (this.options.adoption?.reportPhase)
                await this.options.adoption.reportPhase('admitted');
            assertAdmitted();
            this.pendingReports++;
            const pending = this.reportWrites.then(async () => {
                assertValid();
                // Fresh state and exact pair before persistence: a queued report from a worker still needs the
                // current coordinator to admit it, and this read is the same serialized boundary as before.
                const fresh = await this.state();
                assertValid();
                requireCoordinatorPair(fresh.config, this.caller());
                if (!fresh.config.agents.some(agent => agent.sessionId === message.from && !agent.coordinator))
                    fail('reporting worker is no longer configured');
                if (this.options.adoption?.reportPhase)
                    await this.options.adoption.reportPhase('before-save');
                assertAdmitted();
                await saveWorkerReport(this.store.root, { version: 1, sessionId: message.from, ...payload, updatedAt: new Date().toISOString() }, phase => {
                    try {
                        if (phase === 'publish')
                            assertAdmitted();
                        else
                            assertValid();
                    }
                    catch {
                        throw new ReportPublicationRefused(`${COORDINATOR_NOT_AUTHORIZED}: report publication refused before persistence; no report stored or cleared`);
                    }
                });
                try {
                    if (this.options.adoption?.reportPhase)
                        await this.options.adoption.reportPhase('after-save');
                    await notify('worker report', `Report: ${payload.status}\n${payload.summary}\nThis is a worker-authored public report, not approval or verified completion. Evaluate it before deciding any next step. Clearing retires the report only; it does not resume or complete work.`);
                }
                catch (error) {
                    // Saved bytes are never rolled back or cleared, and a blocked notification is never reported as
                    // a delivery, an unsaved report, or an approval. It stays visible through stored-report reads.
                    if (String(error).includes(COORDINATOR_NOT_AUTHORIZED)) {
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
            await notify('agent message', message.payload.message);
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
            // The sender must still be the current coordinator entry when the reload actually happens.
            const now = await this.store.read();
            assertValid();
            const currentSender = now.agents.find(agent => agent.sessionId === message.from);
            if (!currentSender?.coordinator)
                fail('control sender is no longer the configured coordinator');
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
        const lifecycle = this.validity();
        const { id, config, me } = await this.state();
        const admitted = { coordinator: me?.coordinator === true, configured: me !== undefined };
        // Each boundary re-reads the board with the one strict reader: a cached role is never permission, and
        // an admitted coordinator that has become unconfigured cannot fall through as worker traffic.
        const assertCurrent = () => { lifecycle(); if (admitted.coordinator)
            this.assertCoordinatorEffectSync(); };
        const assertValid = assertCurrent;
        // Admission is also list's final proof: no await or callback intervenes before its result.
        if (admitted.coordinator)
            await this.assertCoordinatorEffect(lifecycle);
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
        requireCoordinatorPair(config, this.caller());
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
            await this.store.configure(this.caller(), values, () => {
                assertValid();
                if (this.handoff?.isClosing(args.sessionId) || this.resumeFences.has(args.sessionId))
                    fail('worker lifecycle operation is in flight; configuration is fenced');
            });
            record('config.changed', { operation: 'configure_worker', peerSessionId: args.sessionId, peerName: args.name, outcome: 'written', ...(choice.role ? { piRole: choice.role } : {}) });
            const saved = (await this.store.read()).agents.find(agent => agent.sessionId === candidate.sessionId);
            assertValid();
            return { written: true, reloaded: false, ...(saved?.role ? { role: saved.role } : {}), ...(choice.roleNote ? { roleNote: choice.roleNote } : {}) };
        }
        if (operation === 'set_multiplexer') {
            await this.store.update(this.caller(), c => { c.multiplexer = args.multiplexer; }, () => assertValid());
            record('config.changed', { operation: 'set_multiplexer', outcome: 'written' });
            return { written: true };
        }
        if (operation === 'create_worker') {
            const relative = await directory(this.store.root, args.projectDirectory ?? '.');
            assertCurrent();
            const role = requestedRole(args.role);
            armReminder();
            const launched = await this.launchObserved({ multiplexer: config.multiplexer, cwd: path.resolve(this.store.root, relative), workspaceRoot: this.store.root, ...(role ? { role } : {}) }, assertValid);
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
            return { job: await this.handoff.request(target), completion: 'not awaited', contract: 'best-effort owned-pane closure; not all-child-process termination' };
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
            const relative = await directory(this.store.root, target.projectDirectory);
            assertValid();
            const cwd = path.resolve(this.store.root, relative);
            // Directory validation is read-only; recheck admission after that await.
            if (this.resumeFences.has(target.sessionId))
                fail('Resume already in flight or awaiting worker status; outcome may be uncertain. Inspect the worker before any retry; no automatic relaunch.');
            if (this.handoff?.isClosing(target.sessionId))
                fail('worker close is active or uncertain; resume is fenced');
            const fence = { inFlight: true, submitted: false, announced: false };
            this.resumeFences.set(target.sessionId, fence);
            armReminder();
            let completed = false;
            try {
                const connection = await (this.options.probe ?? probeWorker)(target, { signal: this.probeController.signal });
                assertCurrent();
                if (connection.state === 'connected')
                    fail('Worker endpoint is still connected; refusing to resume the same session twice.');
                const fresh = await this.state();
                assertCurrent();
                requireCoordinatorPair(fresh.config, this.caller());
                const current = fresh.config.agents.find(agent => agent.sessionId === target.sessionId && !agent.coordinator);
                if (!current || current.port !== target.port || current.projectDirectory !== target.projectDirectory || current.role !== target.role)
                    fail('Worker configuration changed during resume check; no launch submitted.');
                if (this.handoff?.isClosing(target.sessionId) || fencedClose(current.closeJob))
                    fail('worker close is active or uncertain; resume is fenced');
                if (current.role !== undefined && !logicalRole(current.role))
                    fail('invalid role');
                const result = await this.launchObserved({ multiplexer: fresh.config.multiplexer, cwd, workspaceRoot: this.store.root, sessionId: current.sessionId, ...(current.role ? { role: current.role } : {}) }, () => { assertValid(); fence.submitted = true; });
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
            await this.store.update(this.caller(), c => {
                const current = c.agents.find(a => a.sessionId === target.sessionId);
                if (this.handoff?.isClosing(target.sessionId) || this.resumeFences.has(target.sessionId) || fencedClose(current?.closeJob))
                    fail('worker lifecycle operation is active or uncertain; removal is fenced');
                c.agents = c.agents.filter(a => a.sessionId !== target.sessionId);
            }, () => assertValid());
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
            // The original dispatch is one admitted composite adapter operation. Observation may be reentrant.
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