import type { Run } from './launcher.js';
import type { CloseProvider } from './handoff.js';
interface ProcessIdentity {
    start: string;
    state: string;
}
export interface PaneCloseOptions {
    sessionId(): string;
    sessionFile(): string | undefined;
    env?: NodeJS.ProcessEnv;
    platform?: string;
    pid?: number;
    run?: Run;
    processIdentity?: (pid: number) => Promise<ProcessIdentity | undefined>;
    verifySession?: (file: string, id: string) => Promise<void>;
    verificationMs?: number;
}
/** Linux process start ticks distinguish a reused PID from the original worker. */
export declare function linuxProcessIdentity(pid: number): Promise<ProcessIdentity | undefined>;
/** Linux Herdr only. Identity-checked best effort; Herdr has no atomic compare-and-close API. */
export declare function createCloseProvider(options: PaneCloseOptions): CloseProvider | undefined;
export {};
