import { type ObservationSnapshot } from './snapshot.js';
export declare function workerObservation(snapshot: ObservationSnapshot, sessionId: string, now?: number): {
    observedStatus: string;
    lastActivity: string;
    observedAt: string | null;
    observationAgeSeconds: number | null;
    stale: boolean | null;
    evidence: string;
};
/** Bounded JSON data for agents/any presentation layer. No Telegram, UI, probing or model calls. */
export declare function workerStatusPage(snapshot: ObservationSnapshot, options?: {
    name?: string;
    offset?: number;
    limit?: number;
}, now?: number): {
    version: number;
    source: string;
    generatedAt: string;
    statusMeaning: string;
    truncated: boolean;
    errors: string[];
    totalInSnapshot: number;
    offset: number;
    nextOffset: number | null;
    workers: {
        [key: string]: unknown;
        sessionId: string;
    }[];
};
