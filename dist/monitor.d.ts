#!/usr/bin/env node
import { type Component } from 'pi-intercom-tui';
import { readObservationSnapshot } from './snapshot.js';
import { probeWorkers } from './connections.js';
export declare function parseMonitorRoot(args: string[]): string;
export interface MonitorOptions {
    read?: typeof readObservationSnapshot;
    /** Injected readers do not probe unless explicitly supplied. */
    probe?: typeof probeWorkers;
    rows: () => number;
    requestRender: () => void;
    onQuit: () => void;
    intervalMs?: number;
    color?: boolean;
    now?: () => number;
    /** Returns a cancellation function; injected by deterministic tests. */
    schedule?: (callback: () => void, delayMs: number) => () => void;
}
/** Read-only snapshots and bounded health checks. Closing never awaits pending IO. */
export declare function createMonitor(root: string, options: MonitorOptions): Component & {
    start(): void;
    close(): void;
};
/** CLI-only setup: importing this module never touches raw mode or project files. */
export declare function runMonitor(args?: string[]): void;
