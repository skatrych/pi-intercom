export const REMINDER_INTERVAL_MS = 5 * 60 * 1000;
export const REMINDER_TEXT = 'Intercom reminder: Review outstanding delegated work and worker reports. If follow-up is needed, take the next appropriate action. Do not assume workers have finished or stopped.\n\nIf there is genuinely nothing to follow up on, call intercom_stop_reminders. Otherwise, reminders continue every five minutes; a new worker call resets the timer.\n\nThis reminder does not authorize new work, retries, worker closure, or publication.';
const clock = {
    schedule(callback, milliseconds) {
        const timer = setTimeout(callback, milliseconds);
        timer.unref();
        return () => clearTimeout(timer);
    },
};
/** Ephemeral reminder only: never worker actions, network retries or a backlog. */
export class CoordinatorReminders {
    host;
    timer;
    generation = 0;
    tick = 0;
    checking = false;
    disposed = false;
    cancel;
    detachOwner;
    constructor(host, timer = clock) {
        this.host = host;
        this.timer = timer;
    }
    arm(signal) {
        if (this.disposed || signal?.aborted)
            return;
        this.stop();
        const generation = this.generation;
        if (signal) {
            const abort = () => { if (this.generation === generation)
                this.stop(); };
            signal.addEventListener('abort', abort, { once: true });
            this.detachOwner = () => signal.removeEventListener('abort', abort);
        }
        this.schedule(generation);
    }
    stop() {
        this.generation++;
        this.tick++;
        this.cancel?.();
        this.cancel = undefined;
        this.detachOwner?.();
        this.detachOwner = undefined;
    }
    dispose() { this.stop(); this.disposed = true; }
    current(generation, tick) {
        return !this.disposed && this.generation === generation && this.tick === tick;
    }
    schedule(generation) {
        const assertReady = this.host.captureGuard?.();
        this.cancel = this.timer.schedule(() => {
            if (this.disposed || generation !== this.generation)
                return;
            this.cancel = undefined;
            const tick = ++this.tick;
            this.schedule(generation);
            // A slow role read never creates concurrent reads or a queued reminder.
            // Advancing tick also invalidates any read from the preceding interval.
            if (this.checking)
                return;
            this.checking = true;
            void (async () => {
                try {
                    try {
                        assertReady?.();
                    }
                    catch {
                        if (this.current(generation, tick))
                            this.stop();
                        return;
                    }
                    const coordinator = await this.host.isCoordinator();
                    if (!this.current(generation, tick))
                        return;
                    try {
                        assertReady?.();
                    }
                    catch {
                        if (this.current(generation, tick))
                            this.stop();
                        return;
                    }
                    if (!coordinator) {
                        this.stop();
                        return;
                    }
                    if (!this.host.busy())
                        this.host.deliver(REMINDER_TEXT);
                }
                catch { /* Unknown role/read/delivery outcome: no blind immediate replay. */ }
                finally {
                    this.checking = false;
                }
            })();
        }, REMINDER_INTERVAL_MS);
    }
}
//# sourceMappingURL=reminders.js.map