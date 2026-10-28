import { type Observer, type EventType, type EventMetadata } from './observability.js';
import { ConfigStore, type Agent, type Config } from './config.js';
import { listen, send, type Endpoint, type Envelope, type Kind } from './transport.js';
import { probeWorker } from './connections.js';
import { type CloseProvider } from './handoff.js';
import { type ReminderClock } from './reminders.js';
import { type ReminderFileSystem, type ReminderSubmission } from './reminder-content.js';
import { type AdoptionPhase, type CommandContext, type Result } from './adoption.js';
export declare const UNSUPPORTED_CANCELLATION = "Unsupported Pi host: stop_worker and legacy graceful-close control are disabled. Pi 0.84.4 extension abort does not cancel retry backoff/continuations; graceful shutdown cannot guarantee no queued work restarts. No cancellation or shutdown was performed. close_worker uses a separate supported-provider owned-pane closure contract, not graceful cancellation. See references/implementation-blocker.md. A verified supported host API is required for graceful cancellation (no version-only override).";
/** Named refusal for an effect whose current-config permission no longer holds (ADR 0025). */
export declare const COORDINATOR_NOT_AUTHORIZED = "COORDINATOR_NOT_AUTHORIZED";
export interface Host {
    sessionId(): string;
    cwd: string;
    busy(): boolean;
    /** reminder carries kind/hash/attempt metadata for reminder text only; ordinary delivery omits it. */
    deliver(text: string, busy: boolean, reminder?: ReminderSubmission): void;
    setName(name: string): Promise<void>;
    notify(text: string): void;
    /** Test seam. Production workers report `PI_INTERCOM_WORKER_ROLE` from the launch environment. */
    workerRole?: string;
    /** Test seam. Production reads `PI_ROLE_DIR` and uses only its basename. */
    roleDirectory?: string;
    /** Test seam. Production reads `PI_ROLES_DIR`, defaulting to `<home>/.pi/roles`. */
    rolesDirectory?: string;
}
export interface LaunchRequest {
    multiplexer: 'herdr' | 'none';
    cwd: string;
    /** Explicit absolute session root; must canonically equal `cwd`. Parent roots are never allowed. */
    workspaceRoot: string;
    sessionId?: string;
    /** Logical role. The launcher wraps Pi with `pi-role`; this is not a Pi home. */
    role?: string;
}
export interface RuntimeOptions {
    launch(request: LaunchRequest): Promise<unknown>;
    listen?: typeof listen;
    send?: typeof send;
    probe?: typeof probeWorker;
    store?: (root: string) => ConfigStore;
    observe?: (root: string, sessionId: string) => Observer;
    closeProvider?: CloseProvider;
    /** Test seam; production defaults to 120 seconds, values above that are capped. */
    closeTimeoutMs?: number;
    reminderClock?: ReminderClock;
    /** Explicit launcher-provided board root: the canonical session cwd or one of its ancestors. */
    workspaceRoot?: string;
    /** Test seam for the operator environment. Production reads process.env once per runtime start. */
    reminderMinutesEnv?: () => string | undefined;
    /** Test seam for the reminder text selector. Production reads PI_INTERCOM_REMINDER_FILE once per runtime start. */
    reminderFileEnv?: () => string | undefined;
    /** Test seam for reminder file access. Production uses node:fs with no-follow, regular-file and bounded reads. */
    reminderFiles?: ReminderFileSystem;
    /** Test seam for the adoption boundary. Production reads this process's configuration. */
    adoption?: Partial<AdoptionDeps>;
}
export interface AdoptionDeps {
    projectsHome: string;
    rolesDirectory: string;
    phase(phase: AdoptionPhase): Promise<void>;
    reportPhase(phase: 'admitted' | 'before-save' | 'after-save'): Promise<void>;
}
export declare class Intercom {
    readonly host: Host;
    readonly options: RuntimeOptions;
    store: ConfigStore;
    endpoint?: Endpoint;
    private active;
    private generation;
    private initialId;
    private configuredRoot?;
    private configuredFile?;
    responsibility?: Agent;
    private observer?;
    /** A no-board Orchestrator must not create a board directory through logging before bootstrap. */
    private observationEnabled;
    private closing?;
    private reportWrites;
    private pendingReports;
    private probeController;
    private resumeFences;
    /** Role names reported by workers, applied when that session is explicitly configured. Not an agent entry. */
    private registeredRoles;
    private roleResolved;
    private resolvedRole?;
    private handoff?;
    private reminders?;
    private reminderRevision;
    private reminderInvocation;
    /** Snapshot once per start (startServices consumes it); see PI_INTERCOM_REMINDER_MINUTES docs. */
    private reminderIntervalMsCache;
    /** Immutable reminder text snapshot for this runtime only; undefined disables reminders for it. */
    private reminderContent?;
    /**
     * Coordinator authority is the board config entry (ADR 0025): this runtime's native session id plus the
     * port its endpoint actually bound, matched against the single coordinator entry. There is no claim
     * file, evidence record, Git state, readiness generation, or authority epoch anywhere in this class.
     * A cached flag is never permission: `assertCoordinatorEffect` re-reads the board at each real effect
     * boundary, and `ConfigStore` independently repeats the exact-pair check at locked admission and at
     * every publication attempt. Ordinary worker traffic keeps its own recipient/target/job rules and never
     * acquires a coordinator-only gate.
     */
    private adoption?;
    /**
     * True only while a canonical Orchestrator startup is inside the boot-only port recovery window (P3).
     * The minimal bound health endpoint stays available; no responsibility load, handoff recovery, observer
     * maintenance, reminder, registration/status/config callback, tool, or send may overtake verified
     * publication plus an exact-pair responsibility load.
     */
    private bootHeld;
    /** At most one port change may use the captured boot snapshot of one startup. */
    private bootPortAttempted;
    /** The counted board layout captured at startup: P3 may not publish across a changed ancestor chain. */
    private startupHome?;
    private startupCwd?;
    private startupBoards;
    /** This runtime's captured authority pair: native session id and the port actually bound. Never an argument. */
    private caller;
    /**
     * The current-config permission that replaced every claim and epoch proof. It re-reads the board with
     * the one strict reader and requires this runtime's exact coordinator pair, a valid lifecycle, and a
     * bound root. Where an effect also needs the loaded role, it says so explicitly.
     */
    private assertCoordinatorEffect;
    /**
     * Permission for an effect that either role may own (a handoff send/delivery crosses both directions).
     * A coordinator needs its exact pair; a configured worker needs to still be the worker entry it was
     * admitted as. Neither may fall through anonymously, and neither gains the other's permission.
     */
    private assertEffectAllowed;
    /** The same permission for a synchronous seam. Same strict reader, same refusal, no cache. */
    private assertEffectAllowedSync;
    private assertCoordinatorEffectSync;
    /** Re-prove an admitted role after an await, so a former coordinator cannot fall through as worker traffic. */
    private assertRoleUnchanged;
    workerStarted(): void;
    workerSettled(successfulToolCallIds: ReadonlySet<string>): void;
    private captureObserver;
    recordObservation(event: EventType, metadata?: EventMetadata): void;
    private readonly launchRoleDirectory;
    private readonly launchRolesDirectory;
    private readonly launchWorkerRole;
    constructor(host: Host, options: RuntimeOptions);
    private id;
    private validity;
    start(): Promise<void>;
    /**
     * Resolves the optional reminder selector exactly once. A present-but-invalid selection emits the one fixed
     * diagnostic and yields no content; the diagnostic carries no path, value, contents or raw error.
     */
    private loadReminderSnapshot;
    private startServices;
    /**
     * The private boot-only verified-port publication (ADR 0025 P3). Reachable only from this captured
     * canonical Orchestrator startup that holds the initial strict config snapshot; never a tool, a status
     * path, a command repair, or an id-only exemption on `update`. At most one port change may use the
     * captured snapshot, and every refusal keeps the runtime held with no other coordinator effect.
     *
     * Returns 'recovered' or a human-readable held reason. It never retries a mutation automatically.
     */
    private recoverBootPort;
    /**
     * The captured boot endpoint must still be the runtime's current endpoint. Binding a replacement
     * listener and closing the old one during staging must refuse the publication, not publish a closed port.
     */
    private assertBoundEndpoint;
    /** Root/board/path validity independent of any caller guard, re-proved after each boot await. */
    private assertCoordinatorPaths;
    /**
     * The ancestor board chain counted at startup must be unchanged when P3 publishes: a second board
     * appearing (or the counted one disappearing) during a boot probe invalidates the captured snapshot.
     */
    private assertStartupBoardLayout;
    /** Final synchronous permission for an already-admitted coordinator effect (monitor pane operations). */
    assertCoordinatorFinal(requirements?: {
        responsibility?: boolean;
    }): void;
    close(): Promise<void>;
    /** Canonical launch role only: `<PI_ROLES_DIR or ~/.pi/roles>/orchestrator`, captured from this process. */
    private orchestratorLaunch;
    /**
     * A cheap, non-authorizing readiness view for UI surfaces such as the monitor. Permission is never
     * decided here: every real effect re-reads the board at its own boundary, and `ConfigStore` re-proves
     * the exact pair at locked admission and at every publication attempt.
     */
    coordinatorActionReady(): Promise<boolean>;
    responsibilityLoaded(): boolean;
    /**
     * In-place promotion. No `start`, `close`, `HandoffWorkflow.recover`, extension reload,
     * worker action, monitor or pane operation, log maintenance, report clearing, session replacement, or
     * job-state rewrite. It reads config and loads this session's responsibility from the new entry only.
     */
    promoteCoordinator(): Promise<void>;
    /**
     * The sole adoption entry point. The backend checks its own authorization independently of whether any
     * command was installed, discovered, or visible: role, session identity, and the command context are
     * re-verified inside the workflow, and a manually bypassed frontend still fails here.
     */
    adoptCoordinator(context: CommandContext, verb: string, args?: string[]): Promise<Result>;
    state(): Promise<{
        id: string;
        config: Config;
        me?: Agent;
    }>;
    /** Accept old configs, but retire the removed browser dashboard's discovery metadata. */
    retireDashboardMetadata(): Promise<void>;
    reload(): Promise<void>;
    transmit(to: string, kind: Kind, payload?: Record<string, unknown>, guard?: () => void): Promise<void>;
    report(): Promise<void>;
    /** Logical role for registration and status. Invalid metadata is omitted; it does not stop messaging. */
    private reportedRole;
    receive(message: Envelope): Promise<void>;
    private handleReceive;
    tool(operation: string, args: Record<string, unknown>, toolCallId?: string, reminderSignal?: AbortSignal): Promise<unknown>;
    private launchObserved;
}
