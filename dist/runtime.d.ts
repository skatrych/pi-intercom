import { type Observer, type EventType, type EventMetadata } from './observability.js';
import { ConfigStore, type Agent, type Config } from './config.js';
import { listen, send, type Endpoint, type Envelope, type Kind } from './transport.js';
import { probeWorker } from './connections.js';
import { type CloseProvider } from './handoff.js';
export declare const UNSUPPORTED_CANCELLATION = "Unsupported Pi host: stop_worker and legacy graceful-close control are disabled. Pi 0.84.4 extension abort does not cancel retry backoff/continuations; graceful shutdown cannot guarantee no queued work restarts. No cancellation or shutdown was performed. close_worker uses a separate supported-provider owned-pane closure contract, not graceful cancellation. See references/implementation-blocker.md. A verified supported host API is required for graceful cancellation (no version-only override).";
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
    workerStarted(): void;
    workerSettled(successfulToolCallIds: ReadonlySet<string>): void;
    private captureObserver;
    recordObservation(event: EventType, metadata?: EventMetadata): void;
    constructor(host: Host, options: RuntimeOptions);
    private id;
    private validity;
    start(): Promise<void>;
    close(): Promise<void>;
    state(): Promise<{
        id: string;
        config: Config;
        me?: Agent;
    }>;
    /** Accept old configs, but retire the removed browser dashboard's discovery metadata. */
    retireDashboardMetadata(): Promise<void>;
    reload(): Promise<void>;
    transmit(to: string, kind: Kind, payload?: Record<string, unknown>): Promise<void>;
    report(): Promise<void>;
    /** Logical role for registration and status. Invalid metadata is omitted; it does not stop messaging. */
    private reportedRole;
    receive(message: Envelope): Promise<void>;
    private handleReceive;
    tool(operation: string, args: Record<string, unknown>, toolCallId?: string): Promise<unknown>;
    private launchObserved;
}
