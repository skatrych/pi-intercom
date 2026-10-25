import { type Handoff, type CloseJob } from './handoff.js';
import { type NativeLockProvider } from './native-lock.js';
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
/**
 * The complete runtime identity a config writer must carry (ADR 0025). It is captured from the running
 * process — the native session id and the port its endpoint actually bound — never from a message, tool
 * argument, or session-history search.
 */
export interface ConfigCaller {
    sessionId: string;
    port: number;
}
export declare const sha256: (text: string) => string;
/** Raw bytes plus the fully validated value tree. There is no span, entry-hash, or byte-patch layer. */
export interface ConfigDocument {
    raw: string;
    config: Config;
}
/**
 * The one config reader for every decision and permission check. Grammar belongs to `JSON.parse`;
 * ambiguity and unsafe numbers are refused here, so a sync current-config check and an async admission
 * read can never disagree about what the same bytes mean.
 */
export declare function parseConfig(raw: string, source?: string): ConfigDocument;
/**
 * The one config writer: validate the whole parsed object, serialize it, and prove the output re-reads
 * as exactly the intended value tree. Formatting may normalize; no other parsed value may change, and a
 * value that would not survive is refused before anything is staged.
 */
export declare function serializeConfig(config: Config, source?: string): string;
export declare class ConfigPreviewChanged extends Error {
}
export declare function named(c: Config, name: string): Agent;
/** Locate the coordinator entry by session id. NOT sufficient publication authority: see `requireCoordinatorPair`. */
export declare function requireCoordinator(c: Config, id: string): Agent;
/**
 * The current-config permission (ADR 0025). The board's coordinator `sessionId` and `port` are the whole
 * authority, so an entry that matches only the id is not authorized: the actually bound endpoint must
 * match too. Binding a port is never itself authority to change this entry.
 */
export declare function requireCoordinatorPair(c: Config, caller: ConfigCaller): Agent;
/** Same exact-pair authority shape used for the two narrow operations that change only identity fields. */
export declare function requireCoordinatorEntry(c: Config, sessionId: string, expectedPort: number): Agent;
export declare function directory(root: string, requested: string): Promise<string>;
export interface ConfigStoreOptions {
    /** Publication seams for deterministic platform/race tests. */
    platform?: NodeJS.Platform;
    rename?: (from: string, to: string) => Promise<void>;
    delay?: (milliseconds: number) => Promise<void>;
    now?: () => number;
    /** Test seam for the native provider only. Production always loads the exact-pinned addon. */
    lockProvider?: () => Promise<NativeLockProvider>;
}
export declare class ConfigStore {
    readonly root: string;
    private readonly options;
    readonly file: string;
    private canonicalRoot?;
    constructor(root: string, options?: ConfigStoreOptions);
    private assertLocalPaths;
    validateRoot(expectedCanonicalRoot: string): Promise<void>;
    /** Ordinary read: the same strict reader as adoption and boot recovery. */
    read(): Promise<Config>;
    /** Raw bytes plus the validated value tree. The raw bytes bind a displayed preview against staleness. */
    readDocument(): Promise<ConfigDocument>;
    /** Synchronous current-config read for final-effect guards that cannot await. Same reader, same refusals. */
    readDocumentSync(): ConfigDocument;
    /** The permanent, never-deleted guard file that carries the native all-writer lock (P1). */
    get lockFile(): string;
    /**
     * One exclusive transaction for every config publication. Fixed acquisition order is this outer queue
     * (Pi's per-file mutation queue in the installed store) -> the process-local per-file queue -> the
     * native kernel lock; never acquire them in a nested or reversed order. Re-entrant inside one async
     * chain, so an adoption transaction can call other publication methods without re-acquiring anything:
     * a nested call never enters a second queue and never takes a second lock. The process-local queue
     * waits; the kernel lock never waits, steals, or retries, so cross-process contention fails closed and
     * a crashed holder releases it without cleanup. Release is this transaction's own handle only.
     */
    transaction<T>(run: () => Promise<T>): Promise<T>;
    /** Override point for an outer per-file queue. Do not override `transaction` or `exclusive` instead. */
    protected outerQueue<T>(run: () => Promise<T>): Promise<T>;
    protected exclusive<T>(run: () => Promise<T>): Promise<T>;
    /**
     * Path validity and the metadata directory, established before the guard file can exist. A missing
     * directory is created here (mode 0700) and nowhere else, so a writer never follows an escaping link
     * and never creates board state in an unvalidated location.
     */
    private prepareTransaction;
    private assertSafePaths;
    /**
     * Every publication path passes here first. The held-handle/guard identity check is independent of any
     * caller guard, so a caller cannot publish without the transaction lock it never sees.
     */
    private publicationGuard;
    static discover(cwd: string): Promise<ConfigStore | undefined>;
    static workspace(cwd: string, workspaceRoot: string): Promise<ConfigStore>;
    protected openTemporary(file: string): Promise<import("fs/promises").FileHandle>;
    private cleanupTemporary;
    /**
     * Synced, closed, exclusively created temporary holding one complete serialized document. The bytes are
     * produced by `serializeConfig`, so a staged temp is already proven to roundtrip.
     */
    private writeTemporaryText;
    /**
     * Publish an already synced/closed temp by atomic replace, with the bounded Windows
     * reader-denies-rename retry. Only publication of this same temp repeats: the mutation, the probes and
     * any other OS action never run again here. Every attempt re-proves the lock and the caller's guard.
     */
    private publish;
    /**
     * First-board creation only (ADR 0025): publish an already complete file with an atomic, no-replace
     * hard link, so a competing initializer is never overwritten and losers always see complete JSON.
     * Returns false when another initializer won; the caller then reads that winner normally.
     */
    initialize(caller: ConfigCaller, assertValid?: () => void): Promise<boolean>;
    /**
     * The ordinary writer. `caller` is this runtime's captured native pair and must match the board's
     * coordinator at locked admission, after the mutation await, and again at every publication attempt, so
     * a queued write from a replaced coordinator cannot overwrite a completed replacement.
     */
    update(caller: ConfigCaller, mutate: (config: Config) => void | Promise<void>, assertValid?: () => void): Promise<Config>;
    /**
     * The single adoption replacement. It re-reads the document under the lock, verifies it against the
     * caller's frozen preview hash, changes exactly the coordinator's `sessionId` and `port`, and publishes.
     * There is no general edit surface here and no identity or confirmation decision: the adoption workflow
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
    /**
     * ADR 0025 P3: the private boot-only port publication, reachable solely from the captured Orchestrator
     * startup that holds the initial raw snapshot. It changes the coordinator `port` and nothing else, and
     * re-proves the captured state after every await and before every rename attempt. It is not a tool, a
     * status repair, or an id-only escape hatch on `update`.
     */
    publishCoordinatorPort(input: {
        sessionId: string;
        expectedRaw: string;
        savedPort: number;
        newPort: number;
        recheck: () => Promise<void>;
        assertValid: () => void;
    }): Promise<{
        before: string;
        after: string;
    }>;
    configure(caller: ConfigCaller, values: Omit<Agent, 'coordinator'>, assertValid?: () => void): Promise<Config>;
}
