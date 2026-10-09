export type ReportStatus = 'blocked' | 'needs_decision' | 'ready_for_review' | 'clear';
export interface WorkerReport {
    version: 1;
    sessionId: string;
    status: ReportStatus;
    summary: string;
    updatedAt: string;
}
/** Persist only the explicitly authored public report; clear is an atomic tombstone. */
export declare function saveWorkerReport(root: string, report: WorkerReport, assertCurrent?: () => void): Promise<void>;
/** Read at most 256 configured IDs; no directory scan, repair, transport, or host access. */
export declare function readWorkerReports(root: string, sessionIds: readonly string[]): Promise<WorkerReport[]>;
