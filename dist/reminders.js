import { createHash, randomUUID } from 'node:crypto';
/** Operator override for the coordinator reminder interval, in whole minutes. Read once per runtime start. */
export const REMINDER_MINUTES_ENV = 'PI_INTERCOM_REMINDER_MINUTES';
export const DEFAULT_REMINDER_MINUTES = 5;
export const MIN_REMINDER_MINUTES = 1;
/** floor(2147483647 / 60000): the largest whole-minute delay that stays inside Node's signed 32-bit timeout maximum. */
export const MAX_REMINDER_MINUTES = 35791;
export const DEFAULT_REMINDER_INTERVAL_MS = DEFAULT_REMINDER_MINUTES * 60 * 1000;
/**
 * Trimmed ASCII decimal whole minutes, leading zeros allowed, value 1-35791.
 * Anything else (missing, blank, sign, fraction, exponent, hex, suffix, NaN,
 * Infinity, unsafe or out-of-range) silently returns the default interval: no
 * throw, no clamp, no disable, and the raw value is never returned or echoed.
 */
export function reminderIntervalMs(raw) {
    const trimmed = raw?.trim() ?? '';
    if (!/^[0-9]+$/.test(trimmed))
        return DEFAULT_REMINDER_INTERVAL_MS;
    const minutes = Number(trimmed);
    if (!Number.isSafeInteger(minutes) || minutes < MIN_REMINDER_MINUTES || minutes > MAX_REMINDER_MINUTES)
        return DEFAULT_REMINDER_INTERVAL_MS;
    return minutes * 60 * 1000;
}
/** Production environment read. Callers snapshot the value at runtime start and never reread it while that runtime runs. */
export function readReminderMinutesEnv() { return process.env[REMINDER_MINUTES_ENV]; }
export const REMINDER_TEXT = 'Intercom reminder: Review outstanding delegated work and worker reports. If follow-up is needed, take the next appropriate action. Do not assume workers have finished or stopped.\n\nIf there is genuinely nothing to follow up on, call intercom_stop_reminders. Otherwise, reminders continue at the configured interval; a new worker call resets the timer.\n\nThis reminder does not authorize new work, retries, worker closure, or publication.';
/** The unselected built-in content. Its text is REMINDER_TEXT, byte-for-byte. */
export const BUILTIN_REMINDER_CONTENT = Object.freeze({
    text: REMINDER_TEXT,
    source: 'builtin',
    sha256: createHash('sha256').update(REMINDER_TEXT, 'utf8').digest('hex'),
});
/**
 * Orchestrator idle wake-ups (Swactory #68): a reminder is sent once after one full idle interval of
 * this authorized Orchestrator session — not after worker-directed operations. The custom message type
 * below is reminder-only; ordinary Intercom delivery never uses it.
 */
export const WAKEUP_CUSTOM_TYPE = 'intercom-orchestrator-wakeup';
/** One bounded observation of an unconfirmed attempt. No second attempt and no replay follow it. */
export const ATTEMPT_WARNING_MS = 30_000;
export const REMINDER_ATTEMPT_DIAGNOSTIC = 'Intercom orchestrator idle reminder: one submitted wake-up attempt has no confirmed processing. No automatic retry, replay or catch-up follows; resolve this explicitly or restart the process for a fresh schedule.';
/** The one fixed diagnostic for an admission window that never completed within its bound. */
export const REMINDER_ADMISSION_DIAGNOSTIC = 'Intercom orchestrator idle reminder: one expiry admission window did not complete within its bound (a slow or unresolved eligibility check). Nothing was submitted and no automatic retry or catch-up follows; if a window never completes, an explicit process restart is required to continue wake-ups.';
/** Truthful non-stopping stop-tool result. Wake-ups are never disabled by an agent or by absence of work. */
export const REMINDER_STOP_REASON = 'idle_wakeups_are_automatic';
/**
 * True when a persisted session entry is exactly this identified wake-up message. Correlation uses the
 * entry plus the containing run's settlement; identity, persistence, API return or display alone prove
 * no model consumption. Public-kind inspection only: never message bodies or provider payloads.
 */
export function isWakeupEntry(entry, attemptId) {
    if (!entry || typeof entry !== 'object')
        return false;
    const shaped = entry;
    return shaped.type === 'custom_message' && shaped.customType === WAKEUP_CUSTOM_TYPE && shaped.details?.attemptId === attemptId;
}
const clock = {
    schedule(callback, milliseconds) {
        const timer = setTimeout(callback, milliseconds);
        timer.unref();
        return () => clearTimeout(timer);
    },
};
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
export class CoordinatorIdleReminders {
    host;
    timer;
    intervalMs;
    content;
    timerEpoch = 0;
    cancel;
    disposed = false;
    /** Suspended: no scheduling and no admission. Authorization transitions re-arm; authority loss suspends. */
    suspended = true;
    /** Serial admission window: one proof/attempt at a time. */
    checking = false;
    tooOld = false;
    attempt;
    /**
     * intervalMs comes from reminderIntervalMs(); the scheduler never revalidates operator input.
     * content is the immutable snapshot the runtime loaded at start; it is never reread here.
     */
    constructor(host, timer = clock, intervalMs = DEFAULT_REMINDER_INTERVAL_MS, content = BUILTIN_REMINDER_CONTENT) {
        this.host = host;
        this.timer = timer;
        this.intervalMs = intervalMs;
        this.content = content;
    }
    /** Authorization open or fresh startup: begin one full idle observation of a fresh X, with no worker call. */
    arm() {
        if (this.disposed)
            return;
        this.suspended = false;
        if (this.attempt) {
            // An fenced attempt never dissolves across authorization transitions: its bounded uncertainty
            // observation re-observes from the reopen without a retry, release or second timer.
            if (!this.attempt.warned)
                this.schedule(ATTEMPT_WARNING_MS, () => this.warnCheck());
            else
                this.schedule(this.intervalMs, () => this.pollIdle());
            return;
        }
        this.scheduleIdleObservation();
    }
    /**
     * Authority/root/session loss: cancel this loop's timer. An outstanding attempt keeps its single
     * bounded uncertainty observation across the transition — one handle, no release and no retry.
     */
    suspend() {
        if (this.attempt) {
            this.suspended = true;
            return;
        }
        this.stopTimer();
        this.suspended = true;
    }
    dispose() {
        this.stopTimer();
        this.disposed = true;
    }
    /** Any agent run invalidates the future deadline, regardless of its trigger: human, worker, or reminder. */
    activityStarted() {
        if (this.disposed || this.suspended || this.attempt || this.checking)
            return;
        // Conservative idle observation with the same handle: no permanent disarm, and earlier busy time is
        // never counted as idle.
        this.schedule(this.intervalMs, () => this.pollIdle());
    }
    /**
     * A run settled: start one fresh full X from now. A run longer than X produces no queued and no
     * immediate catch-up reminder; only the settle event re-arms.
     */
    activitySettled() {
        if (this.disposed || this.suspended || this.attempt || this.checking)
            return;
        this.schedule(this.intervalMs, () => this.due());
    }
    /**
     * Correlated completion: the owned wake-up message entered an agent run and that containing run
     * settled. Clears the single slot and starts the next full interval; no deadline of the past returns.
     */
    attemptResolved() {
        if (!this.attempt)
            return;
        this.attempt = undefined;
        if (this.disposed || this.suspended || this.checking)
            return;
        this.schedule(this.intervalMs, () => this.due());
    }
    /** Idle observation with the same handle; a pre-armed busy host waits for observed idle. */
    scheduleIdleObservation() {
        if (!this.slotFree()) {
            this.schedule(this.intervalMs, () => this.pollIdle());
            return;
        }
        if (this.host.busy())
            this.schedule(this.intervalMs, () => this.pollIdle());
        else
            this.schedule(this.intervalMs, () => this.due());
    }
    /** One serial slot: an admission check or an outstanding attempt, never both. */
    slotFree() { return !this.attempt && !this.checking; }
    /** Timer fires at a due deadline: ONE host idle sample for this expiry decision. */
    due() {
        if (this.disposed)
            return;
        // A busy change (an invalidation event gap) means the observed deadline is stale: no send, nothing
        // queued, and a fresh observation replaces it.
        if (this.host.busy()) {
            this.schedule(this.intervalMs, () => this.pollIdle());
            return;
        }
        if (!this.slotFree()) {
            this.schedule(this.intervalMs, () => this.pollIdle());
            return;
        }
        void this.admit();
    }
    /** Timer fires after busy time: one idle sample here establishes fresh X; nothing was queued meanwhile. */
    pollIdle() {
        if (this.disposed)
            return;
        if (this.host.busy()) {
            this.schedule(this.intervalMs, () => this.pollIdle());
            return;
        }
        if (!this.slotFree()) {
            this.schedule(this.intervalMs, () => this.pollIdle());
            return;
        }
        this.schedule(this.intervalMs, () => this.due());
    }
    /**
     * The one expiry attempt. The host idle sample already admitted this window; the only remaining
     * conditions are the independent eligibility proof and the runtime/authority guards. Host idle,
     * activity and a changed deadline are deliberately not rechecked for the admitted attempt.
     */
    async admit() {
        const guard = this.host.captureGuard?.();
        if (guard) {
            try {
                guard?.();
            }
            catch {
                this.recover();
                return;
            }
        }
        this.checking = true;
        this.tooOld = false;
        let drained = false;
        let unresolved = true;
        // Bounded admission window: a proof that outlives one additional interval is suppressed as too old
        // and drained before anything else. This is an age bound, not another idle test.
        this.schedule(this.intervalMs, () => {
            if (this.checking) {
                // The bound is reached while the proof still runs: unpublishable and unobservable fencing is
                // wrong, so emit the one fixed sanitized diagnostic even if the read never resolves.
                this.tooOld = true;
                try {
                    this.host.warn(REMINDER_ADMISSION_DIAGNOSTIC);
                }
                catch { /* A warning failure cannot affect scheduling. */ }
            }
            else
                this.recover();
        });
        try {
            try {
                guard?.();
            }
            catch {
                drained = true;
                return;
            }
            const eligible = await this.host.eligible();
            unresolved = false;
            if (this.disposed)
                return;
            if (this.tooOld) {
                drained = true;
                return;
            } // drained: no submission, no immediate replay.
            try {
                guard?.();
            }
            catch {
                drained = true;
                return;
            }
            if (!eligible) {
                this.suspend();
                return;
            }
            try {
                guard?.();
            }
            catch {
                drained = true;
                return;
            }
            if (this.tooOld) {
                drained = true;
                return;
            }
            const submission = { attemptId: randomUUID(), source: this.content.source, sha256: this.content.sha256 };
            // Latch the single attempt before everything below; the warning covers every unresolved path.
            this.attempt = { attemptId: submission.attemptId, warned: false };
            this.checking = false;
            this.schedule(ATTEMPT_WARNING_MS, () => this.warnCheck());
            try {
                guard?.();
            }
            catch {
                return;
            }
            try {
                this.host.deliver(this.content.text, submission);
            }
            catch { /* Submission outcome unknown: correlation decides; no blind immediate replay. */ }
        }
        catch {
            // Unknown eligibility read/resolver outcome: no submission was promised; keep observing.
        }
        finally {
            const wasChecking = this.checking;
            this.checking = false;
            // A drained, unresolved or fenced proof must never leave the loop stalled or the slot stuck.
            if (wasChecking && (drained || unresolved || this.tooOld) && !this.attempt)
                this.recover();
        }
    }
    /** The one bounded uncertainty warning, then fenced observation. No retry, resubmission or cancel API. */
    warnCheck() {
        if (this.attempt && !this.attempt.warned) {
            this.attempt.warned = true;
            try {
                this.host.warn(REMINDER_ATTEMPT_DIAGNOSTIC);
            }
            catch { /* A warning failure cannot affect scheduling. */ }
        }
        // While suspended the fence stays with the diagnostic; resumed observation waits for reauthorization.
        if (this.attempt && !this.suspended)
            this.schedule(this.intervalMs, () => this.pollIdle());
    }
    /** Resume the idle observation loop after a drained or failed window. Same handle, no parallel checks. */
    recover() {
        if (this.disposed || this.suspended || this.attempt || this.checking)
            return;
        this.schedule(this.intervalMs, () => this.pollIdle());
    }
    stopTimer() {
        this.timerEpoch++;
        this.cancel?.();
        this.cancel = undefined;
    }
    /** Exactly one pending timer exists at a time; stale callbacks are fenced by the epoch marker. */
    schedule(delay, action) {
        this.stopTimer();
        const epoch = ++this.timerEpoch;
        this.cancel = this.timer.schedule(() => {
            if (this.disposed || this.timerEpoch !== epoch)
                return;
            this.cancel = undefined;
            action();
        }, delay);
    }
}
//# sourceMappingURL=reminders.js.map