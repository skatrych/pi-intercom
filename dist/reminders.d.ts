import type { ReminderContent, ReminderSubmission } from './reminder-content.js';
/** Operator override for the coordinator reminder interval, in whole minutes. Read once per runtime start. */
export declare const REMINDER_MINUTES_ENV = "PI_INTERCOM_REMINDER_MINUTES";
export declare const DEFAULT_REMINDER_MINUTES = 5;
export declare const MIN_REMINDER_MINUTES = 1;
/** floor(2147483647 / 60000): the largest whole-minute delay that stays inside Node's signed 32-bit timeout maximum. */
export declare const MAX_REMINDER_MINUTES = 35791;
export declare const DEFAULT_REMINDER_INTERVAL_MS: number;
/**
 * Trimmed ASCII decimal whole minutes, leading zeros allowed, value 1-35791.
 * Anything else (missing, blank, sign, fraction, exponent, hex, suffix, NaN,
 * Infinity, unsafe or out-of-range) silently returns the default interval: no
 * throw, no clamp, no disable, and the raw value is never returned or echoed.
 */
export declare function reminderIntervalMs(raw: string | undefined): number;
/** Production environment read. Callers snapshot the value at runtime start and never reread it while that runtime runs. */
export declare function readReminderMinutesEnv(): string | undefined;
export declare const REMINDER_TEXT = "Intercom reminder: Review outstanding delegated work and worker reports. If follow-up is needed, take the next appropriate action. Do not assume workers have finished or stopped.\n\nIf there is genuinely nothing to follow up on, call intercom_stop_reminders. Otherwise, reminders continue at the configured interval; a new worker call resets the timer.\n\nThis reminder does not authorize new work, retries, worker closure, or publication.";
/** The unselected built-in content. Its text is REMINDER_TEXT, byte-for-byte. */
export declare const BUILTIN_REMINDER_CONTENT: ReminderContent;
/**
 * Orchestrator idle wake-ups (Swactory #68): a reminder is sent once after one full idle interval of
 * this authorized Orchestrator session — not after worker-directed operations. The custom message type
 * below is reminder-only; ordinary Intercom delivery never uses it.
 */
export declare const WAKEUP_CUSTOM_TYPE = "intercom-orchestrator-wakeup";
/** One bounded observation of an unconfirmed attempt. No second attempt and no replay follow it. */
export declare const ATTEMPT_WARNING_MS = 30000;
export declare const REMINDER_ATTEMPT_DIAGNOSTIC = "Intercom orchestrator idle reminder: one submitted wake-up attempt has no confirmed processing. No automatic retry, replay or catch-up follows; resolve this explicitly or restart the process for a fresh schedule.";
/** The one fixed diagnostic for an admission window that never completed within its bound. */
export declare const REMINDER_ADMISSION_DIAGNOSTIC = "Intercom orchestrator idle reminder: one expiry admission window did not complete within its bound (a slow or unresolved eligibility check). Nothing was submitted and no automatic retry or catch-up follows; if a window never completes, an explicit process restart is required to continue wake-ups.";
/** Truthful non-stopping stop-tool result. Wake-ups are never disabled by an agent or by absence of work. */
export declare const REMINDER_STOP_REASON = "idle_wakeups_are_automatic";
/**
 * True when a persisted session entry is exactly this identified wake-up message. Correlation uses the
 * entry plus the containing run's settlement; identity, persistence, API return or display alone prove
 * no model consumption. Public-kind inspection only: never message bodies or provider payloads.
 */
export declare function isWakeupEntry(entry: unknown, attemptId: string): boolean;
export interface ReminderClock {
    schedule(callback: () => void, milliseconds: number): () => void;
}
export interface IdleReminderHost {
    /** Captured runtime/authority generation. A thrown closure stops the attempt without further effects. */
    captureGuard?(): () => void;
    /** Full eligibility proof, awaited after the one idle sample and re-guarded before submission. */
    eligible(): Promise<boolean>;
    /** The single host idle sample for an expiry, arm or idle-observation decision. */
    busy(): boolean;
    /** Reminder-only submission. The outcome is unknown by definition; correlation decides processing. */
    deliver(content: string, submission: ReminderSubmission): void;
    /** The one bounded uncertainty warning for an attempt that stays unconfirmed. */
    warn(message: string): void;
}
/**
 * One idle-sampled wake-up loop per eligible session. Concretely:
 * - `arm()` (fresh startup or an authorization transition) starts one full idle observation without
 *   needing any worker call. A busy host waits for observed idle; busy time never counts as idle.
 * - Every agent run, regardless of its trigger, invalidates the future deadline; a settled run starts
 *   the next full interval. `agent_end` or tool end alone is not evidence of idle.
 * - At a due deadline the host idle state is sampled exactly once. Busy means skip: nothing is sent,
 *   nothing is queued, and observation restarts one full interval later. No backlog, no storm.
 * - After an idle sample the attempt is admitted: the eligibility proof is awaited and re-guarded, but
 *   host idle/activity and the possibly invalidated deadline are never rechecked for that admitted
 *   attempt. Activity after the sample updates future scheduling only; Pi may defer or steer the
 *   submitted message while busy. Idle suppression is therefore best effort.
 * - Exactly one attempt slot exists. Delivery outcome is unknown by definition; an unconfirmed attempt
 *   is warned about once with the same timer handle, then fenced until correlated completion or an
 *   explicit operator reconciliation. No blind retry, no catch-up queue, no transcript replay.
 */
export declare class CoordinatorIdleReminders {
    private readonly host;
    private readonly timer;
    private readonly intervalMs;
    private readonly content;
    private timerEpoch;
    private cancel?;
    private disposed;
    /** Suspended: no new idle observation/admission. Owned diagnostic bounds survive authority loss. */
    private suspended;
    /** Serial admission window: one proof/attempt at a time. */
    private checking;
    private tooOld;
    private attempt?;
    /**
     * intervalMs comes from reminderIntervalMs(); the scheduler never revalidates operator input.
     * content is the immutable snapshot the runtime loaded at start; it is never reread here.
     */
    constructor(host: IdleReminderHost, timer?: ReminderClock, intervalMs?: number, content?: ReminderContent);
    /** Authorization open or fresh startup: begin one full idle observation of a fresh X, with no worker call. */
    arm(): void;
    /**
     * Authority/root/session loss: cancel idle observation only. An admission or submitted attempt keeps
     * its original bounded diagnostic across the transition — one handle, no release and no retry.
     */
    suspend(): void;
    dispose(): void;
    /** Any agent run invalidates the future deadline, regardless of its trigger: human, worker, or reminder. */
    activityStarted(): void;
    /**
     * A run settled: start one fresh full X from now. A run longer than X produces no queued and no
     * immediate catch-up reminder; only the settle event re-arms.
     */
    activitySettled(): void;
    /**
     * Correlated completion: the owned wake-up message entered an agent run and that containing run
     * settled. Clears the single slot and starts the next full interval; no deadline of the past returns.
     */
    attemptResolved(): void;
    /** Idle observation with the same handle; a pre-armed busy host waits for observed idle. */
    private scheduleIdleObservation;
    /** One serial slot: an admission check or an outstanding attempt, never both. */
    private slotFree;
    /** Timer fires at a due deadline: ONE host idle sample for this expiry decision. */
    private due;
    /** Timer fires after busy time: one idle sample here establishes fresh X; nothing was queued meanwhile. */
    private pollIdle;
    /**
     * The one expiry attempt. The host idle sample already admitted this window; the only remaining
     * conditions are the independent eligibility proof and the runtime/authority guards. Host idle,
     * activity and a changed deadline are deliberately not rechecked for the admitted attempt.
     */
    private admit;
    /** The one bounded uncertainty warning, then fenced observation. No retry, resubmission or cancel API. */
    private warnCheck;
    /** Resume the idle observation loop after a drained or failed window. Same handle, no parallel checks. */
    private recover;
    private stopTimer;
    /** Exactly one pending timer exists at a time; stale callbacks are fenced by the epoch marker. */
    private schedule;
}
