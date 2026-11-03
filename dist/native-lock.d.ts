import type { FileHandle } from 'node:fs/promises';
/** The permanent guard file name inside `.pi-intercom`. It is never deleted by a writer. */
export declare const CONFIG_LOCK_FILE = "config.lock";
/** Exact dependency pin required by the reviewed design. Nothing else may satisfy this provider. */
export declare const LOCK_PROVIDER = "fs-native-extensions@1.5.2";
/** A native exclusive lock exists and blocks this writer. No holder identity is ever inferred or claimed. */
export declare class ConfigLockContention extends Error {
    readonly path: string;
    readonly name = "ConfigLockContention";
    constructor(path: string);
}
/** The pre-ADR-0025 mkdir lock is still present. It is never converted or removed by a writer. */
export declare class LegacyConfigLock extends Error {
    readonly path: string;
    readonly name = "LegacyConfigLock";
    constructor(path: string);
}
/** The native provider or the syscall itself is unavailable: storage is unavailable, and there is no fallback. */
export declare class ConfigLockUnavailable extends Error {
    readonly name = "ConfigLockUnavailable";
    constructor(detail: string);
}
/** The only provider surface this adapter uses: exclusive whole-file lock, nonwaiting. */
export interface NativeLockProvider {
    tryLock(fd: number): boolean;
    unlock(fd: number): void;
}
/**
 * Lazily load the pinned provider. Loading happens only when a writer actually needs the lock, so
 * read-only diagnostics stay usable on a host where the addon cannot load. The failure is remembered:
 * no writer retries a load, and no writer proceeds without the lock.
 */
export declare function nativeLockProvider(): Promise<NativeLockProvider>;
export interface GuardIdentity {
    dev: number;
    ino: number;
}
/** A held lock transaction. `assertHeld` runs at admission, publication and every platform retry. */
export interface HeldConfigLock {
    assertHeld(): void;
    release(): Promise<Error | undefined>;
}
/**
 * Open the permanent guard file and take the native exclusive lock. Every partial failure closes the
 * handle this call opened; cleanup transfers to the caller only once the lock is held. The descriptor is
 * never exported, duplicated, or passed to a child, and the guard is never unlinked or recreated.
 */
export declare function acquireConfigLock(guard: string, provider?: () => Promise<NativeLockProvider>, createHandle?: (guard: string) => Promise<FileHandle>): Promise<HeldConfigLock>;
