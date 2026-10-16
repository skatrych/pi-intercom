import { type Handoff, type CloseJob } from './handoff.js';
export interface Agent {
    sessionId: string;
    name: string;
    coordinator: boolean;
    description: string;
    port: number;
    /** Legacy browser dashboard field, accepted for migration only; removed at coordinator startup. */
    dashboardPort?: number;
    projectDirectory: string;
    /** Logical Pi role name. Absent when the worker uses the normal Pi launch. */
    role?: string;
    handoff?: Handoff;
    closeJob?: CloseJob;
}
export interface Config {
    version: 1;
    multiplexer: 'herdr' | 'none';
    agents: Agent[];
}
/** Logical role names only. Same alphabet as pi-role, bounded for Intercom storage. Callers cannot pass a path or shell fragment. */
export declare const ROLE_NAME: RegExp;
/** Names apply.sh refuses to install. They are not Pi roles. */
export declare const RESERVED_ROLES: Set<string>;
export declare function logicalRole(value: unknown): value is string;
/** Intercom metadata for the worker extension. It does not load the role. */
export declare const WORKER_ROLE_ENV = "PI_INTERCOM_WORKER_ROLE";
/** Optional executable used instead of `pi-role` on PATH. Not a role-to-directory map. */
export declare const ROLE_LAUNCHER_ENV = "PI_INTERCOM_ROLE_LAUNCHER";
export declare const DEFAULT_ROLE_LAUNCHER = "pi-role";
export declare const DEFAULT_DESCRIPTION = "Coordinate workers, delegate work, and manage shared configuration.";
export declare const key: (name: string) => string;
export declare function fail(message: string): never;
export declare function text(value: unknown, field: string, max?: number): asserts value is string;
export declare function port(value: unknown): asserts value is number;
export declare function relativeDirectory(value: unknown): asserts value is string;
export declare function validateConfig(value: unknown): Config;
export declare const coordinator: (c: Config) => Agent;
/** Byte range in a raw document. Half-open: [start, end). */
export interface JsonSpan {
    start: number;
    end: number;
}
interface Node {
    span: JsonSpan;
    value: unknown;
    members?: Map<string, Node>;
    items?: Node[];
}
/**
 * Strict JSON reader with byte spans and duplicate-key rejection.
 * Duplicate keys are ambiguous, so the lossless patch could not choose a token; they are a
 * configuration error rather than a last-value-wins parse. Spans are the only authorised way to
 * locate the two coordinator value tokens: no regular expression or string search is used.
 */
export declare class JsonDocument {
    private readonly text;
    private readonly source;
    private at;
    constructor(text: string, source?: string);
    parse(): Node;
    private skip;
    private expect;
    private value;
    private object;
    private array;
    private literal;
    private number;
    private string;
}
export declare const rawSpan: (text: string, span: JsonSpan) => string;
export declare const sha256: (text: string) => string;
export interface ConfigEntrySpans {
    sessionId: string;
    span: JsonSpan;
    closeJobSpan?: JsonSpan;
}
export interface ScannedConfig {
    raw: string;
    config: Config;
    entries: ConfigEntrySpans[];
}
/** Parse, locate every agent entry's raw byte span, and apply the full schema validator. */
export declare function scanConfig(raw: string): ScannedConfig;
export interface CoordinatorPatch {
    before: string;
    after: string;
    spans: JsonSpan[];
}
/**
 * Replace exactly the coordinator's `sessionId` and `port` value tokens, leaving every other byte of
 * the document untouched, including formatting, unknown tolerated fields and entry order. This is the
 * only permitted coordinator-entry replacement. A full re-stringify would prove semantic equality only
 * and is deliberately not used.
 */
export declare function patchCoordinatorEntry(raw: string, sessionId: string, newPort: number): CoordinatorPatch;
/** Diagnostics only; the lock token itself is never exposed. */
export interface LockOwner {
    pid: number;
    sessionId: string;
    acquiredAt: string;
}
export declare class StaleConfigLock extends Error {
    readonly owner: LockOwner | 'unreadable';
    constructor(owner: LockOwner | 'unreadable');
}
export declare class ConfigPreviewChanged extends Error {
}
export declare function named(c: Config, name: string): Agent;
export declare function requireCoordinator(c: Config, id: string): Agent;
export declare function directory(root: string, requested: string): Promise<string>;
export interface ConfigStoreOptions {
    /** Publication seams for deterministic platform/race tests. */
    platform?: NodeJS.Platform;
    rename?: (from: string, to: string) => Promise<void>;
    delay?: (milliseconds: number) => Promise<void>;
    now?: () => number;
    /** Diagnostic identity written into the transaction lock. Never an authorization value. */
    lockOwner?: () => {
        sessionId: string;
    };
}
export declare class ConfigStore {
    readonly root: string;
    private readonly options;
    readonly file: string;
    constructor(root: string, options?: ConfigStoreOptions);
    /** Strict read: duplicate keys, trailing content and malformed JSON all propagate. */
    read(): Promise<Config>;
    /**
     * The raw bytes and entry spans needed by the lossless replacement and by claim evidence. Strict means
     * validated: the document must parse under the span scanner *and* satisfy the board schema. Reading a
     * board without validating it would let an unusable config reach an adoption decision, so an issue is
     * an error rather than a warning.
     */
    readStrict(): Promise<ScannedConfig>;
    get lockDirectory(): string;
    /**
     * One exclusive transaction for every config publication. Fixed acquisition order is this outer queue
     * (Pi's per-file mutation queue in the installed store) -> the process-local per-file queue -> the board
     * filesystem lock; never acquire them in a nested or reversed order. Re-entrant for one store instance
     * so a whole adoption (intent commit, replacement, active commit) is one transaction; a nested call
     * never re-enters any queue. The process-local queue waits; the filesystem lock never waits, steals an
     * old lock, or retries: cross-process contention fails closed so a human establishes the owner's state
     * first. Release removes only this call's own token. Process-local only: like Pi's own queue, that Map
     * is not an interprocess lock, which is exactly why the filesystem lock follows it.
     */
    transaction<T>(run: () => Promise<T>): Promise<T>;
    /** Override point for an outer per-file queue. Do not override `transaction` or `exclusive` instead. */
    protected outerQueue<T>(run: () => Promise<T>): Promise<T>;
    protected exclusive<T>(run: () => Promise<T>): Promise<T>;
    private lockOwner;
    private assertSafePaths;
    private publicationGuard;
    private acquireLock;
    static discover(cwd: string): Promise<ConfigStore | undefined>;
    protected openTemporary(file: string): Promise<import("fs/promises").FileHandle>;
    private temporary;
    initialize(id: string, boundPort: number, assertValid?: () => void): Promise<boolean>;
    private publish;
    update(id: string, mutate: (config: Config) => void | Promise<void>, assertValid?: () => void): Promise<Config>;
    /**
     * The single coordinator-entry replacement. It re-reads the raw document under the lock, verifies it
     * against the caller's frozen preview, applies the lossless two-token patch and publishes it. There
     * is no general edit surface here and no identity or confirmation decision: the adoption workflow
     * owns those, and `configure_worker` never reaches this path.
     */
    replaceCoordinatorEntry(input: {
        sessionId: string;
        port: number;
        previewRawSha256: string;
        assertPreview: (config: Config) => void;
        assertValid: () => void;
    }): Promise<{
        before: string;
        after: string;
    }>;
    /** Same synced, closed, exclusive temporary discipline as ordinary writes, from raw bytes. */
    private writeTemporaryText;
    configure(id: string, values: Omit<Agent, 'coordinator'>, assertValid?: () => void): Promise<Config>;
}
export {};
