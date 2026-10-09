import { type Run } from './launcher.js';
export interface MonitorLaunchOptions {
    root: string;
    sessionId: string;
    script: string;
    node?: string;
    platform?: string;
    env?: NodeJS.ProcessEnv;
    run?: Run;
    assertCurrent?(): void;
}
/** Pane ownership is separate from agent config. Pending records fence uncertain
 * mutations across reloads; neither errors nor absence of readiness cause retries. */
export declare function ensureMonitorPane(options: MonitorLaunchOptions): Promise<{
    outcome: string;
    pane?: string;
}>;
