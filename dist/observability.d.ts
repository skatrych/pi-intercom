import type { ActivityPhase, ActivityDetail } from './activity.js';
export declare const LOG_DIRECTORY = ".pi-intercom/logs";
export declare const LOG_FILE_PATTERN: RegExp;
export declare const LOG_LIMITS: {
    readonly fileBytes: number;
    readonly filesPerInstance: 3;
    readonly queueEntries: 256;
    readonly entryBytes: 4096;
    readonly retentionMs: number;
    readonly directoryBytes: number;
    readonly scanEntries: 4096;
    readonly closeTimeoutMs: 250;
};
export declare const EVENT_TYPES: readonly ["runtime.starting", "runtime.ready", "runtime.closed", "runtime.failed", "config.changed", "config.reloaded", "transport.send", "transport.receipt", "transport.failed", "transport.received", "transport.rejected", "registration.received", "status.received", "launch.result", "host.submission", "host.activity", "host.ui_prompt"];
export type EventType = typeof EVENT_TYPES[number];
declare const OUTCOMES: readonly ["attempted", "returned", "failed", "http_receipt", "handler_failed", "started", "settled", "snapshot", "ended", "written", "removed", "ready"];
declare const ERROR_CODES: readonly ["operation_failed", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EADDRINUSE", "EACCES", "EPERM", "ENOENT", "ENOSPC"];
declare const KINDS: readonly ["message", "report", "registration", "status", "request_status", "reload", "stop", "close", "close_prepare", "close_identity", "close_request", "handoff_report", "close_ready", "close_commit"];
declare const OPERATIONS: readonly ["configure_worker", "set_multiplexer", "remove_worker", "create_worker", "resume_worker", "port_update", "initialize"];
export interface EventMetadata {
    peerSessionId?: string;
    peerName?: string;
    correlationId?: string;
    kind?: typeof KINDS[number];
    busy?: boolean;
    phase?: ActivityPhase;
    detail?: ActivityDetail;
    port?: number;
    role?: 'coordinator' | 'worker' | 'anonymous';
    /** Logical Pi role name. Distinct from the coordinator/worker/anonymous runtime role. */
    piRole?: string;
    outcome?: typeof OUTCOMES[number];
    errorCode?: typeof ERROR_CODES[number];
    operation?: typeof OPERATIONS[number];
}
export interface Observation extends EventMetadata {
    version: 1;
    timestamp: string;
    /** Log-file writer identity only: never a transport or agent identity. */
    writerId: string;
    sessionId: string;
    event: EventType;
}
export interface Observer {
    record(event: EventType, metadata?: EventMetadata): void;
    close(): Promise<void>;
    maintain?(): void;
}
/** Project only explicitly allowed metadata, including when reading untrusted on-disk logs. */
export declare function sanitizeObservation(value: unknown): Observation | undefined;
/** Never inspect error.message/stack, response bodies, paths, or arbitrary error codes. */
export declare function observationError(error: unknown): EventMetadata['errorCode'];
export declare class LocalObserver implements Observer {
    readonly sessionId: string;
    private readonly limits;
    readonly writerId: `${string}-${string}-${string}-${string}-${string}`;
    readonly directory: string;
    readonly file: string;
    private queue;
    private pending?;
    private initialized;
    private bytes;
    private closed;
    private disabled;
    private maintenance;
    private timer?;
    dropped: number;
    constructor(root: string, sessionId: string, limits?: {
        fileBytes?: number;
        queueEntries?: number;
    });
    record(event: EventType, metadata?: EventMetadata): void;
    private schedule;
    /** Runtime calls only on the coordinator. No process probes or activity inference. */
    maintain(): void;
    protected append(file: string, line: string): Promise<void>;
    private prune;
    private drain;
    close(): Promise<void>;
}
export {};
