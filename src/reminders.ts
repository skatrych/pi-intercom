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
export function reminderIntervalMs(raw: string | undefined): number {
  const trimmed = raw?.trim() ?? '';
  if (!/^[0-9]+$/.test(trimmed)) return DEFAULT_REMINDER_INTERVAL_MS;
  const minutes = Number(trimmed);
  if (!Number.isSafeInteger(minutes) || minutes < MIN_REMINDER_MINUTES || minutes > MAX_REMINDER_MINUTES) return DEFAULT_REMINDER_INTERVAL_MS;
  return minutes * 60 * 1000;
}

/** Production environment read. Callers snapshot the value at runtime start and never reread it while that runtime runs. */
export function readReminderMinutesEnv(): string | undefined { return process.env[REMINDER_MINUTES_ENV]; }

export const REMINDER_TEXT = 'Intercom reminder: Review outstanding delegated work and worker reports. If follow-up is needed, take the next appropriate action. Do not assume workers have finished or stopped.\n\nIf there is genuinely nothing to follow up on, call intercom_stop_reminders. Otherwise, reminders continue at the configured interval; a new worker call resets the timer.\n\nThis reminder does not authorize new work, retries, worker closure, or publication.';

export interface ReminderClock {
  schedule(callback: () => void, milliseconds: number): () => void;
}
const clock: ReminderClock = {
  schedule(callback, milliseconds) {
    const timer = setTimeout(callback, milliseconds);
    timer.unref();
    return () => clearTimeout(timer);
  },
};
interface ReminderHost {
  isCoordinator(): Promise<boolean>;
  busy(): boolean;
  deliver(text: string): void;
}
/** Ephemeral reminder only: never worker actions, network retries or a backlog. */
export class CoordinatorReminders {
  private generation = 0;
  private tick = 0;
  private checking = false;
  private disposed = false;
  private cancel?: () => void;
  private detachOwner?: () => void;
  /** intervalMs comes from reminderIntervalMs(); the scheduler never revalidates operator input. */
  constructor(private readonly host: ReminderHost, private readonly timer: ReminderClock = clock, private readonly intervalMs: number = DEFAULT_REMINDER_INTERVAL_MS) {}
  arm(signal?: AbortSignal): void {
    if (this.disposed || signal?.aborted) return;
    this.stop();
    const generation = this.generation;
    if (signal) {
      const abort = () => { if (this.generation === generation) this.stop(); };
      signal.addEventListener('abort', abort, { once: true });
      this.detachOwner = () => signal.removeEventListener('abort', abort);
    }
    this.schedule(generation);
  }
  stop(): void {
    this.generation++; this.tick++;
    this.cancel?.(); this.cancel = undefined;
    this.detachOwner?.(); this.detachOwner = undefined;
  }
  dispose(): void { this.stop(); this.disposed = true; }
  private current(generation: number, tick: number): boolean {
    return !this.disposed && this.generation === generation && this.tick === tick;
  }
  private schedule(generation: number): void {
    this.cancel = this.timer.schedule(() => {
      if (this.disposed || generation !== this.generation) return;
      this.cancel = undefined;
      const tick = ++this.tick;
      this.schedule(generation);
      // A slow role read never creates concurrent reads or a queued reminder.
      // Advancing tick also invalidates any read from the preceding interval.
      if (this.checking) return;
      this.checking = true;
      void (async () => {
        try {
          const coordinator = await this.host.isCoordinator();
          if (!this.current(generation, tick)) return;
          if (!coordinator) { this.stop(); return; }
          if (!this.host.busy()) this.host.deliver(REMINDER_TEXT);
        } catch { /* Unknown role/read/delivery outcome: no blind immediate replay. */ }
        finally { this.checking = false; }
      })();
    }, this.intervalMs);
  }
}
