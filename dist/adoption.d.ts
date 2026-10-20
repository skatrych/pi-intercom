import { ConfigStore, type ScannedConfig } from './config.js';
import type { WorkerConnection } from './connections.js';
/**
 * Coordinator adoption: the only coordinator-entry replacement path.
 *
 * A deterministic workflow, not a tool, command, CLI, or endpoint. Reachable only through
 * `Intercom.adoptCoordinator`, which the role-local `/intercom-adopt` command invokes with a supported
 * Pi command context. There are no identity, port, path, role, confirmation, or JSON parameters: every
 * authority value comes from this process's launch configuration, the persisted Pi session, this
 * runtime's bound endpoint, the config read made inside the transaction, or an explicit yes answered
 * in this session's own Pi UI. Nothing is ever typed: no text answer is requested anywhere in this
 * flow, and no generated evidence claims otherwise.
 */
export declare const PROJECTS_HOME_ENV = "PI_INTERCOM_PROJECTS_HOME";
export declare const DEFAULT_PROJECTS_HOME = "workspaces/projects";
export declare const ORCHESTRATOR_ROLE = "orchestrator";
export declare const CLAIM_FILE = "coordinator-claim.md";
export declare const CONFIG_DIRECTORY = ".pi-intercom";
export declare const REBRIEF_SOURCE = "handoff.md (open assignments)";
/**
 * The canonical ended-coordinator attestation. Issue #12 keeps it as a claim-schema invariant: it is the
 * stored form of the attestation a yes accepts, never a transcription of typed text. `parseClaim` still
 * requires it verbatim for `kind: 'adoption'`, so historical records and new ones validate identically.
 */
export declare const ENDED_WORDING: (sessionId: string) => string;
/**
 * A selection surface that returned something which is neither an offered choice nor a dismissal is a
 * capture failure, never an answer. The adapter reports it instead of guessing, so an unreadable
 * decision can never be read as a yes — or as a no.
 */
export declare class AdoptionDecisionCaptureFailure extends Error {
    constructor(message: string);
}
/** The captured Pi UI cannot render a visible selection dialog. Fail closed; never open a text input. */
export declare class AdoptionHostUiUnavailable extends Error {
    constructor(message: string);
}
export declare const DISCONNECTED_WARNING = "A disconnected or unknown endpoint probe is not evidence that a coordinator terminated.";
/** Generated first-declaration evidence (issue #9): never a typed reference, never an adoption wording. */
export interface DeclarationEvidence {
    record: string;
    wording: string;
}
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
    /**
     * The one human surface this flow has: a selection-style dialog offering exactly two answers. There is
     * no text-input member, deliberately — issue #12 removed every typed gate, and a workflow that cannot
     * ask a yes/no on a selection surface stops instead of falling back to a text field.
     *
     * Every decision carries a stable `kind`, so an operator, a test, and the audit trail can tell which
     * question was answered, declined, or left unanswered. Prompt text is for humans and changes.
     */
    ui: {
        confirm(options: {
            kind: string;
            prompt: string;
        }): Promise<boolean>;
    };
    waitForIdle?(): Promise<void>;
}
export type AdoptionPhase = 'before-intent' | 'prepared-committed' | 'published' | 'before-active-write' | 'active-written' | 'active-committed' | 'before-promotion' | 'promoted';
export interface AdoptionOptions {
    /** Canonical launch role directory captured from this process at startup. Never request-supplied. */
    roleDirectory?: string;
    rolesDirectory?: string;
    projectsHome?: string;
    workerRole?: string;
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
        ready(): boolean;
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
interface Survey {
    home: string;
    cwd: string;
    boardRoot?: string;
    boards: string[];
    state: BootState;
    scanned?: ScannedConfig;
    identity: ResolvedIdentity;
    claimPath: string;
    /** Worktree bytes, kept for classification only: they never supply authority, identity or hashes. */
    worktreeRaw?: string;
    claimRaw?: string;
    claim?: ClaimRecord;
    claimCommit?: string;
    lines: string[];
    head?: string;
    paths?: Map<string, string>;
}
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
    private matchingActive;
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
    /**
     * Read git history only, never the worktree file: dirty bytes never supply authority, previous
     * identity, confirmation, timestamps, roster or hashes.
     */
    private latestClaimCommit;
    private verifyActiveAnchor;
    /** Snapshot actual ancestor directories, not a descendant tree scan. */
    private pathSnapshot;
    /** Synchronous final guard also runs on every platform rename retry. */
    private assertPaths;
    /** Revalidate the full immutable preview under the same all-writer lock, before intent or finalization. */
    private assertSnapshot;
    private canonical;
    private decide;
    /** State (a): only an explicitly confirmed first board at the projects home, never in a child cwd. */
    private bootstrap;
    /** State (b) with no record: write-and-continue, but only after the declaration is committed. */
    private declare;
    /**
     * AC3 collisions, AC4 old-endpoint probe, then the human answers exactly once. Identity and the target
     * are backend-selected: no parameter, argument, saved default, or model text can supply them.
     *
     * Issue #12: this is one decision, not three. The former preliminary "continue?" question, the typed
     * authorising record, and the typed exact-ended sentence are gone, because a second question is a
     * second decision and the human ruled that a single contextual yes is the confirmation. Everything
     * that question used to ask is now stated before the answer instead: the attestation that the named
     * coordinator has ended, the disconnected/unknown warning, and the exact replacement being authorized.
     * Nothing else moved: collisions, the old-endpoint probe, and every later gate still refuse here, in
     * this order, before any dialog opens.
     */
    private humanAdoptionDecision;
    /**
     * One yes/no decision, with one named failure mapping for every step. A refusal from the surface
     * itself is never silently read as "No": an unavailable selection surface is a named `HOST` stop, and
     * an answer that is neither offered choice nor a dismissal is a named `CONFIRMATION` stop. Declining
     * is a decision; an unreadable one is not, and neither is ever a yes.
     */
    private confirmGate;
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
    private openReady;
    private promote;
    /**
     * Write outside any repository mutation, then commit this one path. An existing record with different
     * bytes is preserved unless it is recognized committed evidence, and never overwritten silently.
     */
    private writeCommit;
    /**
     * Refuse unsafe layout, a non-repository home, a non-empty index, or unrelated worktree changes.
     * A first declaration may proceed with unrelated untracked content outside the protected board
     * surface (issue #9); every other gate, and every staged, tracked, or unresolved condition, is
     * refused by both policies.
     */
    private assertGitSafe;
    /** Verified repository state or a failure: no incomplete query ever becomes an empty/clean result. */
    private complete;
    /** Paths git reports as changed, NUL-separated and category-accurate. */
    private blockers;
    /**
     * `git status --porcelain=v1 -z` entries are `<XY><space><path>`, NUL terminated, with a rename or
     * copy entry followed by its source path as the next token. With `-z` git never quotes, so spaces,
     * newlines, and non-ASCII names stay single entries instead of being split into invented filenames.
     */
    private statusEntries;
    /** NUL-delimited path list from a path-oriented query. */
    private pathList;
    /**
     * Bounded, no-follow inspection of the protected board namespace, used only by the first-declaration
     * policy. Git status never reports ignored content, so the filesystem is the only evidence here. An
     * unknown, unsafe, or un-listable entry is a named refusal: a partial inspection never approves it.
     */
    private inspectBoardNamespace;
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
/** Ordinary legacy writers may bypass the claim gate only when neither current bytes nor reachable
 * claim history exists. A missing worktree file cannot erase prepared/active (or deletion) history. */
export declare function claimEvidenceEstablished(home: string): Promise<boolean>;
/** Synchronous final-effect adapter; the whole proof is fresh on every invocation. */
export declare function committedActiveClaimMatches(home: string, raw: string): boolean;
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
/** The one generated-evidence template (ADR 0009-A, issue #12). Bounded: the full board root stays in the claim, the authority record carries its labelled SHA256. */
export declare function declarationEvidence(boardRoot: string, identity: ResolvedIdentity): DeclarationEvidence;
/**
 * The adoption counterpart (issue #12). `record` is an implementation-generated account of the single
 * captured yes: it names the decision, both identity pairs, and the exact transition it authorized, and
 * it says plainly that it was generated rather than typed or copied from an external ticket.
 *
 * `wording` is the canonical `ENDED_WORDING(target)` unchanged. That is deliberate: the schema binds an
 * adoption claim to that exact sentence, and the sentence is the stored form of the attestation the yes
 * accepts — "this human confirmed the named coordinator ended" — not a transcription of anything typed.
 * Historical claims that already carry it therefore keep validating with no schema change.
 */
export declare function adoptionEvidence(input: {
    boardRoot: string;
    identity: ResolvedIdentity;
    target: {
        sessionId: string;
        port: number;
    };
    transitionId: string;
    configSha256: string;
}): {
    record: string;
    wording: string;
};
export declare function boardInitializePrompt(home: string, identity: ResolvedIdentity): string;
export declare function firstDeclarationPrompt(home: string, identity: ResolvedIdentity, scanned?: ScannedConfig): string;
export declare function adoptionDecisionPrompt(input: {
    surveyed: Survey;
    target: {
        sessionId: string;
        port: number;
    };
    source: string;
    probe: WorkerConnection;
    board: {
        sessionId: string;
        port: number;
    };
    transitionId: string;
    previewHash: string;
    unchanged: ClaimLeftEntry[];
    fenced: ClaimLeftEntry[];
    renewed: boolean;
}): string;
export declare function finalizationPrompt(input: {
    home: string;
    identity: ResolvedIdentity;
    intent: ClaimRecord;
    evidence: string;
}): string;
/**
 * The protected board surface, relative to the canonical projects-home Git root: exactly the root claim
 * file and the board/config namespace, including a foreign directory that obstructs them. Segment-aware:
 * `.pi-intercom-backup/` and `coordinator-claim.md.bak` are unrelated, `.pi-intercom/config.json` and
 * `coordinator-claim.md/foreign` are protected.
 */
export declare function protectedSurface(relative: string): boolean;
/**
 * A named refusal raised at the call site that knows which step failed. Codes are never inferred from
 * error prose: an unrelated internal error must not be reported to an operator as a specific safety
 * verdict such as a stale preview.
 */
export declare class AdoptionFailure extends Error {
    readonly code: ResultCode;
    constructor(code: ResultCode, message: string);
}
export {};
/**
 * `git status --porcelain=v1` line parsing used to live here. Issue #9 replaced it with the NUL-separated,
 * category-accurate `statusEntries`/`blockers` readers: a line-oriented parse can split a path containing
 * a newline into invented filenames and reports a staged-and-modified path as one category only.
 */
