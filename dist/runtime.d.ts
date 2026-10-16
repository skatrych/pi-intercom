import { type Observer, type EventType, type EventMetadata } from './observability.js';
import { ConfigStore, type Agent, type Config } from './config.js';
import { listen, send, type Endpoint, type Envelope, type Kind } from './transport.js';
import { probeWorker } from './connections.js';
import { type CloseProvider } from './handoff.js';
import { type ReminderClock } from './reminders.js';
import { type AdoptionPhase, type CommandContext, type Result } from './adoption.js';
export declare const UNSUPPORTED_CANCELLATION = "Unsupported Pi host: stop_worker and legacy graceful-close control are disabled. Pi 0.84.4 extension abort does not cancel retry backoff/continuations; graceful shutdown cannot guarantee no queued work restarts. No cancellation or shutdown was performed. close_worker uses a separate supported-provider owned-pane closure contract, not graceful cancellation. See references/implementation-blocker.md. A verified supported host API is required for graceful cancellation (no version-only override).";
export declare const ADOPTION_NOT_READY = "ADOPTION_NOT_READY";
export interface Host {
    sessionId(): string;
    cwd: string;
    busy(): boolean;
    deliver(text: string, busy: boolean): void;
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
    /** Test seam for the ADR 0005 adoption boundary. Production reads this process's configuration. */
    adoption?: Partial<AdoptionDeps>;
}
export interface AdoptionDeps {
    projectsHome: string;
    rolesDirectory: string;
    listSessions(cwd: string, sessionDir?: string): Promise<{
        id: string;
        path: string;
    }[]>;
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
    private readonly callbackEpoch;
    private reminders?;
    private reminderRevision;
    private reminderInvocation;
    /**
     * ADR 0005 D3: coordinator action readiness. Enabled only for a canonical Orchestrator launch on the
     * projects-home board. It starts closed on unresolved evidence and opens only after committed active
     * evidence and a successful write-free promotion. It gates coordinator tools, boot coordinator side
     * effects, and this session's incoming registration/status/report/message/handoff effects, queued
     * report persistence, notification, and reminder delivery. It never gates ordinary worker-targeted
     * delivery, health, or read-only adoption status.
     */
    private authorityEnabled;
    private authorityReady;
    private authorityEpoch;
    private authorityDetail;
    private readyClaimBytes?;
    private adoption?;
    /** Closed when an adoption or declaration transaction invalidated an earlier callback epoch. */
    private actionEpoch;
    private assertActionReady;
    /** Close the local action epoch. Callers hold the returned value and fail once it changes. */
    private closeActionEpoch;
    private openActionEpoch;
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
    private startServices;
    private bootEvidenceReady;
    close(): Promise<void>;
    /**
     * ADR 0005 D3 preflight. Applies only to a canonical Orchestrator launch: the launch role is read from
     * this process's captured configuration, never from a request. Counts `.pi-intercom` directories along
     * cwd -> projects home before any write, then classifies and applies the claim gate. Returns a held
     * reason when no board may be written, and throws when the board layout itself is unsafe.
     */
    private preflight;
    /** Canonical launch role only: `<PI_ROLES_DIR or ~/.pi/roles>/orchestrator`, captured from this process. */
    private orchestratorLaunch;
    /** True once the claim gate permits coordinator action, or when the gate does not apply to this session. */
    coordinatorActionReady(): boolean;
    responsibilityLoaded(): boolean;
    /**
     * ADR 0005 D7: in-place promotion. No `start`, `close`, `HandoffWorkflow.recover`, extension reload,
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
