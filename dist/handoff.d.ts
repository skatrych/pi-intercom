import type { Agent, Config } from './config.js';
export interface WorkerPaneIdentity {
    workspaceId: string;
    paneId: string;
    terminalId: string;
    sessionId: string;
    sessionFile: string;
    pid: number;
    processStart: string;
}
export interface CloseProvider {
    getIdentity(): Promise<WorkerPaneIdentity>;
    inspect(identity: WorkerPaneIdentity, expectedSessionId: string, assertCurrent: () => void): Promise<void>;
    close(identity: WorkerPaneIdentity, expectedSessionId: string, assertCurrent: () => void, beforeSubmit: () => Promise<void>): Promise<{
        paneClosed: boolean;
        workerExited: boolean;
    }>;
}
export type CloseReason = 'timeout' | 'interrupted' | 'delivery_failed' | 'identity_failed' | 'save_failed' | 'worker_changed' | 'worker_busy' | 'commit_rejected' | 'close_unverified' | 'close_failed';
export type CloseState = 'requested' | 'awaiting_handoff' | 'awaiting_settlement' | 'ready' | 'closing' | 'closed' | 'failed' | 'timed_out' | 'interrupted' | 'uncertain';
export interface Handoff {
    version: 1;
    summary: string;
    updatedAt: string;
    jobId: string;
}
export interface CloseJob {
    jobId: string;
    state: CloseState;
    createdAt: string;
    updatedAt: string;
    deadlineAt: string;
    reason?: CloseReason;
}
export type HandoffKind = 'close_prepare' | 'close_identity' | 'close_request' | 'handoff_report' | 'close_ready' | 'close_commit';
export declare const HANDOFF_KINDS: readonly string[];
export declare const pendingClose: (job?: CloseJob) => boolean;
export declare const fencedClose: (job?: CloseJob) => boolean;
export declare function validateIdentity(value: unknown): asserts value is WorkerPaneIdentity;
export declare function validateHandoff(value: unknown): asserts value is Handoff;
export declare function validateCloseJob(value: unknown): asserts value is CloseJob;
export declare function validateHandoffPayload(kind: string, p: Record<string, unknown>): void;
interface Context {
    state(): Promise<{
        id: string;
        config: Config;
        me?: Agent;
    }>;
    assertCurrent(): void;
    update(mutate: (config: Config) => void, guard?: () => void): Promise<void>;
    send(sessionId: string, kind: HandoffKind, payload: Record<string, unknown>): Promise<void>;
    deliver(message: string): void;
    busy(): boolean;
    provider?: CloseProvider;
    timeoutMs?: number;
}
/** Extension-owned asynchronous protocol. No host abort, shutdown, automatic retries or guessed pane targets. */
export declare class HandoffWorkflow {
    private readonly ctx;
    private readonly instanceId;
    private jobs;
    private worker?;
    private epoch;
    private disposed;
    private readonly timeout;
    constructor(ctx: Context);
    private valid;
    private background;
    dispose(): void;
    recover(): Promise<void>;
    private assertJob;
    private target;
    private transition;
    private finish;
    request(target: Agent): Promise<CloseJob>;
    workerStarted(): void;
    workerSettled(successfulToolCallIds: ReadonlySet<string>): void;
    private assertWorker;
    get workerClosing(): boolean;
    isClosing(sessionId: string): boolean;
    report(jobId: unknown, summary: unknown, toolCallId?: string): Promise<{
        saved: true;
        closure: 'awaiting_turn_settlement';
    }>;
    receive(kind: HandoffKind, from: string, payload: Record<string, unknown>): Promise<void>;
}
export {};
