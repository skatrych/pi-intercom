import { type Stats } from 'node:fs';
/**
 * Generic optional reminder text selector. Absent: the built-in text, with no file access. Present: exactly
 * one absolute native-platform path to a small UTF-8 file, read once per Intercom runtime start.
 * The loader is content-agnostic: it knows no workflow, question, identifier or version.
 */
export declare const REMINDER_FILE_ENV = "PI_INTERCOM_REMINDER_FILE";
export declare const REMINDER_FILE_MAX_BYTES = 16384;
export declare const REMINDER_MAX_CODE_POINTS = 4000;
/** The only text emitted for an invalid selection. It never carries the path, raw value, contents or a raw error. */
export declare const REMINDER_CONFIGURATION_DIAGNOSTIC = "Intercom reminder configuration invalid; reminders unavailable until corrected and runtime reloaded.";
/** Immutable runtime snapshot. sha256 is the lowercase hex digest of the exact UTF-8 bytes of text. */
export interface ReminderContent {
    readonly text: string;
    readonly source: 'builtin' | 'file';
    readonly sha256: string;
}
/** Per-delivery metadata passed across the host boundary. Kinds, hashes and an attempt identifier only. */
export interface ReminderSubmission {
    readonly attemptId: string;
    readonly source: ReminderContent['source'];
    readonly sha256: string;
}
/** Fixed failure kinds. They are never logged with a path, value or content, and never reach the model. */
export type ReminderContentFailure = 'selector' | 'read' | 'size' | 'encoding' | 'content';
export type ReminderContentResult = {
    readonly ok: true;
    readonly content: ReminderContent;
} | {
    readonly ok: false;
    readonly failure: ReminderContentFailure;
};
/** Filesystem seam. Production uses node:fs; tests wrap it to prove exactly how often a file is touched. */
export interface ReminderFileHandle {
    stat(): Promise<Stats>;
    read(buffer: Buffer, offset: number, length: number, position: number | null): Promise<{
        bytesRead: number;
    }>;
    close(): Promise<void>;
}
export interface ReminderFileSystem {
    lstat(file: string): Promise<Stats>;
    open(file: string, flags: number): Promise<ReminderFileHandle>;
}
export declare const nodeReminderFileSystem: ReminderFileSystem;
export interface ReminderContentOptions {
    files?: ReminderFileSystem;
    /** Test seam for selector rules. Production uses the host platform. */
    platform?: NodeJS.Platform;
}
/** Production environment read. Callers take it once per runtime start. */
export declare function readReminderFileEnv(): string | undefined;
/**
 * Exactly one absolute path for the native platform. No trimming, `~`/variable expansion, globbing, URL
 * interpretation or CWD resolution. Spaces are literal. Empty, NUL, CR and LF are rejected.
 */
export declare function reminderFileSelectorValid(selector: string, platform?: NodeJS.Platform): boolean;
/**
 * Resolves the selector into an immutable snapshot. Never throws, logs or retries. An absent selector
 * returns the built-in content without touching the filesystem.
 */
export declare function loadReminderContent(selector: string | undefined, options?: ReminderContentOptions): Promise<ReminderContentResult>;
