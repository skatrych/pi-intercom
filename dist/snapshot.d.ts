import { type Config } from './config.js';
import { type WorkerReport } from './reports.js';
import type { WorkerConnection } from './connections.js';
import { type Handoff, type CloseJob } from './handoff.js';
import { type Observation } from './observability.js';
export interface ObservationSnapshot {
    version: 1;
    generatedAt: string;
    staleAfterMs: number;
    config: Pick<Config, 'multiplexer' | 'agents'> | null;
    events: Observation[];
    reports?: WorkerReport[];
    /** Ephemeral explicit health checks; never persisted or inferred from activity logs. */
    connections?: WorkerConnection[];
    truncated: boolean;
    errors: string[];
}
/** Public saved context only; reject malformed/private protocol metadata. */
export declare function publicCloseMetadata(agent: {
    handoff?: unknown;
    closeJob?: unknown;
}): {
    handoff?: Handoff;
    closeJob?: CloseJob;
};
/** Bounded, sanitized local evidence, independent of any UI or HTTP server. */
export declare function readObservationSnapshot(root: string): Promise<ObservationSnapshot>;
