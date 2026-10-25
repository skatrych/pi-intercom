import { ConfigStore, type Config } from './config.js';
import type { WorkerConnection } from './connections.js';
/**
 * Coordinator adoption (ADR 0025): the board config's coordinator `sessionId` and `port` are the whole
 * authority, and this module is the only path that replaces them.
 *
 * A deterministic workflow, not a tool, command, CLI, or endpoint. Reachable only through
 * `Intercom.adoptCoordinator`, which the role-local `/intercom-adopt` command invokes with a supported Pi
 * command context. There are no identity, port, path, role, confirmation, or JSON parameters: every
 * authority value comes from this process's launch configuration, this runtime's actually bound endpoint,
 * the config read made inside the transaction, or an explicit yes answered in this session's own Pi UI.
 *
 * Exactly one human confirmation exists in this file, and only for replacing an existing board's
 * coordinator. First-board creation is ordinary runtime startup (see `Intercom.start`), never adoption,
 * and no branch here asks a second question, requests typed wording, or records an evidence artifact.
 * Git has no role anywhere: this module performs no Git call and reads no Git marker as authority. The
 * legacy `coordinator-claim.md` is ignored in every state — never read, classified, followed, recovered,
 * rewritten, or deleted.
 */
export declare const PROJECTS_HOME_ENV = "PI_INTERCOM_PROJECTS_HOME";
export declare const DEFAULT_PROJECTS_HOME = "workspaces/projects";
export declare const ORCHESTRATOR_ROLE = "orchestrator";
export declare const CONFIG_DIRECTORY = ".pi-intercom";
/** Ignored legacy artifact. Named once so "ignored" is verifiable; nothing here ever reads it. */
export declare const LEGACY_CLAIM_FILE = "coordinator-claim.md";
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
export type ExitCode = 0 | 1 | 2;
export type ResultCode = 'OK' | 'CURRENT' | 'AUTH' | 'MODE' | 'TRUST' | 'SESSION_CHANGED' | 'BUSY' | 'BOARD_COUNT' | 'BOARD_PATH' | 'NO_BOARD' | 'CONFIG' | 'IDENTITY' | 'SESSION_COLLISION' | 'PORT_COLLISION' | 'OLD_CONNECTED' | 'CONFIRMATION' | 'CANCELLED' | 'STALE_PREVIEW' | 'LOCKED' | 'LOCK_LEGACY' | 'LOCK_UNAVAILABLE' | 'PUBLISH' | 'NOT_AUTHORIZED' | 'PROMOTION_PENDING' | 'BACKEND' | 'HOST' | 'USAGE';
export interface Result {
    ok: boolean;
    code: ResultCode;
    exitCode: ExitCode;
    lines: string[];
}
export declare function succeed(code: ResultCode, lines: string[]): Result;
export declare function stop(code: ResultCode, lines: string[]): Result;
export interface CommandContext {
    cwd: string;
    mode: string;
    /** Captured native session only. There is no session-file, header, or session-store proof anywhere. */
    sessionManager: {
        getSessionId(): string;
    };
    hasUI: boolean;
    isProjectTrusted(): boolean;
    isIdle(): boolean;
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
/** Fault-injection and phase-barrier seam names for executable fixtures only. Never a request parameter. */
export type AdoptionPhase = 'after-preview' | 'before-question' | 'after-answer' | 'before-publish' | 'after-publish' | 'before-promotion';
export interface AdoptionOptions {
    /** Canonical launch role directory captured from this process at startup. Never request-supplied. */
    roleDirectory?: string;
    rolesDirectory?: string;
    projectsHome?: string;
    workerRole?: string;
    storeFor(root: string): ConfigStore;
    /** This runtime's native session id. Throws when the session or lifecycle was replaced. */
    sessionId(): string;
    busy(): boolean;
    /** The port this runtime's endpoint actually bound. Never a guessed or supplied port. */
    endpointPort(): number | undefined;
    /** Bounded loopback health identity. Read-only; never evidence of process termination. */
    probe(agent: {
        sessionId: string;
        port: number;
    }, options?: {
        timeoutMs?: number;
    }): Promise<WorkerConnection>;
    /** Load this running session's own responsibility. Write-free, no restart, no recover, no send. */
    promote(): Promise<string | undefined>;
    responsibilityLoaded(): boolean;
    phase?(phase: AdoptionPhase): Promise<void>;
}
/** The captured runtime identity: native session id plus the port its endpoint actually bound. */
export interface AdoptionIdentity {
    sessionId: string;
    port: number;
}
export type BootState = 'a' | 'b' | 'c' | 'd';
/** Absolute projects home from runtime configuration. Never a user-supplied board to overwrite. */
export declare function projectsHome(options: {
    projectsHome?: string;
    homeDirectory?: string;
}): string;
/**
 * Count `.pi-intercom` directories along cwd -> projects home inclusive, before discovery could choose
 * one. Directories are counted, not readable configs: an empty or malformed extra board still stops.
 * This is board isolation, not traceability, and it stays required at startup and in every command.
 */
export declare function countBoards(cwd: string, home: string): Promise<string[]>;
export declare class AdoptionWorkflow {
    private readonly options;
    private request?;
    constructor(options: AdoptionOptions);
    /** One request in flight. A second concurrent request never interleaves with a transaction. */
    run(context: CommandContext, verb: string, args?: string[]): Promise<Result>;
    /**
     * Read-only board count, boot state, captured identity and the configured pair, plus whether this
     * session's local responsibility is loaded. It never promotes, asks, writes, or repairs.
     */
    status(context: CommandContext): Promise<Result>;
    /** Read-only preview plus the single interactive replacement decision. */
    adopt(context: CommandContext): Promise<Result>;
    private report;
    private disposition;
    /** Role, mode, trust, session identity, idle host. Each is a separate named refusal. */
    private authorize;
    /** The launch role is read from captured process configuration, never from the request or a model. */
    private launchRole;
    private survey;
    /** Native session id from this runtime and the port its endpoint actually bound. Never a history search. */
    private identity;
    /** Snapshot actual ancestor directories, not a descendant tree scan. */
    private pathSnapshot;
    /** Synchronous final guard, also run on every platform rename retry. */
    private assertPaths;
    /** The session and lifecycle that were displayed must still be this runtime's own. */
    private assertCurrent;
    /**
     * Revalidate the whole immutable preview under the same all-writer lock: same ancestor board layout,
     * same raw config bytes, same captured identity. Only real drift invalidates a displayed answer; a Git
     * change, a legacy claim change, or any other repository state cannot reach this comparison at all.
     */
    private assertSnapshot;
    private canonical;
    private readOptional;
    private decide;
    /** The already-current pair needs no question and no write: only a write-free responsibility load. */
    private loadOnly;
    /**
     * Collisions and the old-endpoint probe all refuse before any dialog opens, in this order. Then the
     * human answers exactly once, on the native selection surface. Identity and target are backend-selected:
     * no parameter, argument, saved default, or model text can supply them. There is no preliminary
     * "continue?" question, no typed authority record, no exact-wording paste, no ended attestation to
     * transcribe, no renewal, and no saved answer. A yes authorizes the replacement only.
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
     * The only replacement. Under one crash-released all-writer transaction: re-probe, revalidate the exact
     * preview, publish the two-value change atomically, then load this running session's responsibility in
     * place. Any failure is phase-specific and is never reported as success, rolled back, or retried.
     */
    private transaction;
    /** Fresh identity at the last moment before this session claims local readiness. */
    private reverify;
    private phaseThen;
}
export declare function adoptionDecisionPrompt(input: {
    home: string;
    identity: AdoptionIdentity;
    board: {
        sessionId: string;
        port: number;
    };
    previewRaw: string;
    probe: WorkerConnection;
    config: Config;
}): string;
/**
 * A named refusal raised at the call site that knows which step failed. Codes are never inferred from
 * error prose: an unrelated internal error must not be reported to an operator as a specific safety
 * verdict such as a stale preview.
 */
export declare class AdoptionFailure extends Error {
    readonly code: ResultCode;
    constructor(code: ResultCode, message: string);
}
