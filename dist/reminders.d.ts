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
export interface ReminderClock {
    schedule(callback: () => void, milliseconds: number): () => void;
}
interface ReminderHost {
    isCoordinator(): Promise<boolean>;
    busy(): boolean;
    deliver(text: string): void;
}
/** Ephemeral reminder only: never worker actions, network retries or a backlog. */
export declare class CoordinatorReminders {
    private readonly host;
    private readonly timer;
    private readonly intervalMs;
    private generation;
    private tick;
    private checking;
    private disposed;
    private cancel?;
    private detachOwner?;
    /** intervalMs comes from reminderIntervalMs(); the scheduler never revalidates operator input. */
    constructor(host: ReminderHost, timer?: ReminderClock, intervalMs?: number);
    arm(signal?: AbortSignal): void;
    stop(): void;
    dispose(): void;
    private current;
    private schedule;
}
export {};
