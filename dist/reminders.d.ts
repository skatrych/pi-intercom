export declare const REMINDER_INTERVAL_MS: number;
export declare const REMINDER_TEXT = "Intercom reminder: Review outstanding delegated work and worker reports. If follow-up is needed, take the next appropriate action. Do not assume workers have finished or stopped.\n\nIf there is genuinely nothing to follow up on, call intercom_stop_reminders. Otherwise, reminders continue every five minutes; a new worker call resets the timer.\n\nThis reminder does not authorize new work, retries, worker closure, or publication.";
export interface ReminderClock {
    schedule(callback: () => void, milliseconds: number): () => void;
}
interface ReminderHost {
    captureGuard?(): () => void;
    isCoordinator(): Promise<boolean>;
    busy(): boolean;
    deliver(text: string): void;
}
/** Ephemeral reminder only: never worker actions, network retries or a backlog. */
export declare class CoordinatorReminders {
    private readonly host;
    private readonly timer;
    private generation;
    private tick;
    private checking;
    private disposed;
    private cancel?;
    private detachOwner?;
    constructor(host: ReminderHost, timer?: ReminderClock);
    arm(signal?: AbortSignal): void;
    stop(): void;
    dispose(): void;
    private current;
    private schedule;
}
export {};
