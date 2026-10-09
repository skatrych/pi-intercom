/** Public event categories only: never accept content, arguments, or results. */
export type ActivityPhase = 'working' | 'thinking' | 'responding' | 'tool' | 'idle';
export type ActivityDetail = 'processing' | 'thinking' | 'responding' | 'reading_files' | 'editing_files' | 'running_command' | 'using_tool' | 'multiple_tools' | 'settled';
/** Stores only opaque active tool IDs, public categories, and the last emitted state. */
export declare function createActivityTracker(record: (phase: ActivityPhase, detail: ActivityDetail) => void): {
    start(): void;
    settled(): void;
    message(type: string): void;
    toolStart(id: string, name: string): void;
    toolEnd(id: string): void;
    reset(): void;
};
