import { ConfigStore, type ScannedConfig } from './config.js';
import type { WorkerConnection } from './connections.js';
/**
 * ADR 0005 / issue #31 — the only coordinator-entry replacement path.
 *
 * A deterministic workflow, not a tool, command, CLI, or endpoint. Reachable only through
 * `Intercom.adoptCoordinator`, which the role-local `/intercom-adopt` command invokes with a supported
 * Pi command context. There are no identity, port, path, role, confirmation, or JSON parameters: every
 * authority value comes from this process's launch configuration, the persisted Pi session, this
 * runtime's bound endpoint, the config read made inside the transaction, or an answer typed by the
 * human into this session's own Pi UI.
 */
export declare const PROJECTS_HOME_ENV = "SWFACTORY_PROJECTS_HOME";
export declare const DEFAULT_PROJECTS_HOME = "workspaces/projects";
export declare const ORCHESTRATOR_ROLE = "orchestrator";
export declare const CLAIM_FILE = "coordinator-claim.md";
export declare const CONFIG_DIRECTORY = ".pi-intercom";
export declare const REBRIEF_SOURCE = "handoff.md (open assignments)";
export declare const ENDED_WORDING: (sessionId: string) => string;
export type ExitCode = 0 | 1 | 2;
export type ResultCode = 'OK' | 'DECLARED' | 'CLAIM_OK' | 'RECOVERED' | 'AUTH' | 'MODE' | 'TRUST' | 'SESSION_CHANGED' | 'BUSY' | 'BOARD_COUNT' | 'BOARD_PATH' | 'NO_BOARD' | 'CONFIG' | 'RECORD' | 'CLAIM_OTHER' | 'CLAIM_MISMATCH' | 'ADOPTION_REQUIRED' | 'SESSION_UNPERSISTED' | 'IDENTITY' | 'SESSION_COLLISION' | 'PORT_COLLISION' | 'OLD_CONNECTED' | 'CONFIRMATION' | 'CANCELLED' | 'STALE_PREVIEW' | 'LOCKED' | 'GIT' | 'PUBLISH' | 'RECOVERY_REQUIRED' | 'ADOPTION_NOT_READY' | 'PROMOTION_PENDING' | 'BACKEND' | 'HOST' | 'USAGE';
export interface Result {
    ok: boolean;
    code: ResultCode;
    exitCode: ExitCode;
    lines: string[];
}
export declare function succeed(code: ResultCode, lines: string[]): Result;
export declare function stop(code: ResultCode, lines: string[]): Result;
export interface ClaimAuthority {
    kind: 'first-coordinator declaration' | 'adoption';
    record: string;
    confirmedEndedAt: string | null;
    wording: string;
}
export interface ClaimPrevious {
    sessionId: string;
    port: number;
    claimDate: string | null;
}
export interface ClaimLeftEntry {
    name: string;
    sessionId: string;
    port: number;
    projectDirectory: string;
    role: string | null;
    entrySha256: string;
    closeJob: {
        jobId: string;
        state: string;
        sha256: string;
    } | null;
}
export interface ClaimRecord {
    schemaVersion: 1;
    transitionId: string;
    phase: 'prepared' | 'active';
    boardRoot: string;
    coordinator: {
        sessionId: string;
        port: number;
    };
    date: string;
    authority: ClaimAuthority;
    previous: ClaimPrevious | null;
    previousRecordCommit: string | null;
    configBeforeSha256: string;
    configAfterSha256: string;
    intentCommit: string | null;
    leftUnchanged: ClaimLeftEntry[];
    rebriefSource: string;
}
/** The single record renderer. Byte-deterministic, so committed and derived bytes are comparable. */
export declare function renderClaim(record: ClaimRecord): string;
/**
 * Read and re-render. Only canonical bytes count as evidence: a semantically similar record with
 * different formatting, an extra field, a duplicate key, or a broken envelope is a refusal, never
 * an approval and never "absent".
 */
export declare function parseClaim(raw: string): ClaimRecord;
/** AC6 evidence: every non-coordinator entry, in config order, with raw entry and closeJob hashes. */
export declare function leftUnchanged(scanned: ScannedConfig): ClaimLeftEntry[];
export interface CommandContext {
    cwd: string;
    mode: string;
    hasUI: boolean;
    isProjectTrusted(): boolean;
    isIdle(): boolean;
    sessionManager: {
        getSessionId(): string;
        getSessionFile(): string | undefined;
        getSessionDir(): string | undefined;
    };
    ui: {
        input(options: {
            prompt: string;
        }): Promise<string | undefined>;
        confirm(options: {
            prompt: string;
        }): Promise<boolean>;
    };
    waitForIdle?(): Promise<void>;
}
export type AdoptionPhase = 'prepared-committed' | 'published' | 'before-active-write' | 'active-committed' | 'promoted';
export interface AdoptionOptions {
    /** Canonical launch role directory captured from this process at startup. Never request-supplied. */
    roleDirectory?: string;
    rolesDirectory?: string;
    projectsHome?: string;
    storeFor(root: string): ConfigStore;
    sessionId(): string;
    busy(): boolean;
    endpointPort(): number | undefined;
    /** Bounded loopback health identity. Read-only; never evidence of process termination. */
    probe(agent: {
        sessionId: string;
        port: number;
    }, options?: {
        timeoutMs?: number;
    }): Promise<WorkerConnection>;
    /** Load this running session's own responsibility. Write-free, no restart, no recover, no send. */
    promote(): Promise<void>;
    responsibilityLoaded(): boolean;
    readiness: {
        close(detail?: string): number;
        current(): number;
        open(): void;
    };
    listSessions(cwd: string, sessionDir?: string): Promise<{
        id: string;
        path: string;
    }[]>;
    uuid?(): string;
    now?(): Date;
    /** Fault-injection and phase-barrier seam for executable fixtures only. Never a request parameter. */
    phase?(phase: AdoptionPhase): Promise<void>;
}
export type BootState = 'a' | 'b' | 'c' | 'd';
export interface ResolvedIdentity {
    sessionId: string;
    port: number;
    sessionFile: string;
}
/** Absolute projects home from runtime configuration. Never a user-supplied board to overwrite. */
export declare function projectsHome(options: {
    projectsHome?: string;
    homeDirectory?: string;
}): string;
/**
 * Count `.pi-intercom` directories along cwd -> projects home inclusive, before discovery could choose
 * one. Directories are counted, not readable configs: an empty or malformed extra board still stops.
 */
export declare function countBoards(cwd: string, home: string): Promise<string[]>;
interface GitResult {
    code: number;
    stdout: string;
    stderr: string;
}
/** argv only, never a shell string. No global configuration, hook bypass, staging sweep or cleanup. */
export declare function runGit(args: string[], cwd: string): Promise<GitResult>;
export declare class AdoptionWorkflow {
    private readonly options;
    private readonly git;
    private request?;
    constructor(options: AdoptionOptions, git?: (args: string[], cwd: string) => Promise<GitResult>);
    /** One request in flight. A second concurrent request never interleaves with a transaction. */
    run(context: CommandContext, verb: string, args?: string[]): Promise<Result>;
    /** Read-only board count, boot state, identity evidence and claim state. Never mutates. */
    status(context: CommandContext): Promise<Result>;
    /** Deterministic status plus the interactive declaration, adoption, or reconciliation decision. */
    adopt(context: CommandContext): Promise<Result>;
    private report;
    private disposition;
    /** Role, mode, trust, session identity, idle host. Each is a separate named refusal. */
    private authorize;
    /** The launch role is read from captured process configuration, never from the request or a model. */
    private launchRole;
    private survey;
    /** AC3: session identity from the persisted Pi session and the per-cwd store, port from this endpoint. */
    private resolveIdentity;
    /** AC2: absent, uncommitted, malformed, or foreign evidence. None of them is approval. */
    private readClaim;
    /** The latest claim-changing commit whose bytes match, or undefined when the worktree bytes are dirty. */
    private committedClaim;
    /**
     * Read git history only, never the worktree file: dirty bytes never supply authority, previous
     * identity, confirmation, timestamps, roster or hashes.
     */
    private latestClaimCommit;
    private canonical;
    private decide;
    /** State (a): only an explicitly confirmed first board at the projects home, never in a child cwd. */
    private bootstrap;
    /** State (b) with no record: write-and-continue, but only after the declaration is committed. */
    private declare;
    /**
     * AC3 collisions, AC4 old-endpoint probe, then the human answers, in that order. Identity and the
     * ended confirmation are typed into this session's own Pi UI: no parameter, argument, saved default,
     * or model text can supply them, and no decline produces a write.
     */
    private humanAdoptionDecision;
    /** AC4: the authority reference and the exact ended wording, or a named refusal. */
    private askAuthority;
    /**
     * AC1–AC6. Inside one all-writer transaction, in this order: re-probe, prepare and commit the intent
     * record, replace exactly the two coordinator tokens, publish atomically, then write and commit the
     * active record and promote this running session. Any failure is phase-specific, keeps action
     * readiness closed, and is never reported as success or retried automatically.
     */
    private transaction;
    /** Fresh identity evidence at the last moment before the active record is written. */
    private reverify;
    private previousClaimDate;
    private readCommitRecord;
    /**
     * Recognized before any generic dirty-record refusal: verified committed prepared intent, plus a
     * worktree record that is either exactly those committed bytes or exactly the derived active bytes.
     * Finalizes evidence only. Never replaces, never restores, never normalizes, never reads authority,
     * previous identity, confirmation, timestamps, roster or hashes from uncommitted bytes.
     */
    private reconcile;
    private promote;
    /**
     * Write outside any repository mutation, then commit this one path. An existing record with different
     * bytes is preserved unless it is recognized committed evidence, and never overwritten silently.
     */
    private writeCommit;
    /** Refuse unsafe layout, a non-repository home, a non-empty index, or unrelated worktree changes. */
    private assertGitSafe;
    private trackedPaths;
    private dirtyPaths;
    private unresolvedOperation;
    /** `git commit --only <claim>` with argv, then verify HEAD, its changed-path set, and the bytes. */
    private commitClaim;
    /** Cheap local invariants. Pi's queue and the board lock are owned by ConfigStore's transaction. */
    private assertCurrent;
    /** A fixture barrier delays at a named phase boundary and never changes an outcome. */
    private phase;
    private readOptional;
    private gitText;
}
/**
 * Boot-time AC2 read (no UI, no writes): the committed active record must name this exact board and this
 * exact coordinator pair. Anything else leaves coordinator action readiness closed. An absent, malformed,
 * uncommitted, prepared, or foreign record is never treated as approval, and never as a first declaration
 * for an anonymous session.
 */
export declare function bootClaimEvidence(input: {
    home: string;
    identity: {
        sessionId: string;
        port: number;
    };
    git?: (args: string[], cwd: string) => Promise<GitResult>;
}): Promise<{
    ready: boolean;
    detail: string;
}>;
export {};
