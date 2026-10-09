export type ConnectionReason = 'verified' | 'identity_mismatch' | 'unsupported_version' | 'refused' | 'timeout' | 'legacy' | 'malformed' | 'oversize' | 'http_error' | 'network_error' | 'aborted' | 'not_checked' | 'stale' | 'invalid_input';
export interface WorkerConnection {
    sessionId: string;
    state: 'connected' | 'disconnected' | 'unknown';
    checkedAt: string | null;
    reason: ConnectionReason;
}
export interface ConnectionAgent {
    sessionId: string;
    port: number;
}
export interface ProbeOptions {
    signal?: AbortSignal;
    timeoutMs?: number;
}
export interface BatchProbeOptions extends ProbeOptions {
    budgetMs?: number;
    concurrency?: number;
}
/** Read-only best-effort endpoint identity, never evidence of process termination. */
export declare function probeWorker(agent: ConnectionAgent, options?: ProbeOptions): Promise<WorkerConnection>;
/** One bounded concurrent pass; cancellation/budget exhaustion never implies disconnection. */
export declare function probeWorkers(agents: readonly ConnectionAgent[], options?: BatchProbeOptions): Promise<WorkerConnection[]>;
/** Health expires: an old failure must not indefinitely demote a configured worker. */
export declare function currentConnection(sessionId: string, connections?: readonly WorkerConnection[], now?: number): WorkerConnection;
/** Stable disconnected-last copy; does not mutate configuration or observations. */
export declare function sortWorkersByConnection<T extends {
    sessionId: string;
}>(workers: readonly T[], connections?: readonly WorkerConnection[], now?: number): T[];
