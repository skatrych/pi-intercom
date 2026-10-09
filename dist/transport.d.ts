import type { ReportStatus } from './reports.js';
import { type HandoffKind } from './handoff.js';
export declare const BODY_LIMIT: number;
export declare const RECEIPT_TIMEOUT = 5000;
export type Kind = 'message' | 'report' | 'registration' | 'status' | 'request_status' | 'reload' | 'stop' | 'close' | HandoffKind;
export interface Envelope {
    version: 1;
    kind: Kind;
    from: string;
    to: string;
    payload: Record<string, unknown>;
    /** Optional diagnostics correlation only; never authentication or agent identity. */
    correlationId?: string;
}
export declare function reportPayload(payload: Record<string, unknown>): {
    status: ReportStatus;
    summary: string;
};
export declare function envelope(value: unknown): Envelope;
export interface Endpoint {
    port: number;
    close(): Promise<void>;
}
export declare function listen(preferred: number | undefined, accept: (message: Envelope) => Promise<void>, health?: () => {
    version: 1;
    sessionId: string;
}): Promise<Endpoint>;
export declare function send(destinationPort: number, message: Envelope, timeout?: number): Promise<void>;
