import { type ObservationSnapshot } from './snapshot.js';
/** Presentation only. All user-controlled text is sanitized before trusted ANSI styling. */
export declare function renderMonitor(snapshot: ObservationSnapshot | undefined, width: number, height: number, now?: number, color?: boolean, options?: {
    selectedIndex?: number;
    details?: boolean;
}): string[];
