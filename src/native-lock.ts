/**
 * ADR 0025 P1: crash-released all-writer serialization for the board config.
 *
 * One exact-pinned native provider (`fs-native-extensions@1.5.2`) supplies the real OS primitive on
 * every supported platform: Linux `fcntl(F_OFD_SETLK)`, macOS nonblocking whole-file `flock`, and
 * Windows `LockFileEx(EXCLUSIVE_LOCK | FAIL_IMMEDIATELY)`. Kernel ownership, not file existence,
 * decides availability, so an orderly close or process death releases the lock without any stale-lock
 * cleanup, and the permanent regular guard file is never unlinked, renamed or replaced.
 *
 * This is cooperating-local-process serialization on supported local filesystems. It is not a
 * distributed fence, not hostile-same-user protection, and not a cancellation mechanism: a live or
 * stalled holder legitimately blocks. Acquisition never waits, never steals, and never falls back to a
 * weaker protocol; contention and provider failure are separate named refusals.
 */
import { constants, fstatSync, lstatSync, type Stats } from 'node:fs';
import { open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';

/** The permanent guard file name inside `.pi-intercom`. It is never deleted by a writer. */
export const CONFIG_LOCK_FILE = 'config.lock';
/** Exact dependency pin required by the reviewed design. Nothing else may satisfy this provider. */
export const LOCK_PROVIDER = 'fs-native-extensions@1.5.2';

/** A native exclusive lock exists and blocks this writer. No holder identity is ever inferred or claimed. */
export class ConfigLockContention extends Error {
  readonly name = 'ConfigLockContention';
  constructor(readonly path: string) {
    super(`PiIntercom: the config transaction lock at ${path} is held by another process; nothing was written, nothing was removed, and no holder is claimed. Ensure the other writer finished, then invoke again for a fresh attempt.`);
  }
}
/** The pre-ADR-0025 mkdir lock is still present. It is never converted or removed by a writer. */
export class LegacyConfigLock extends Error {
  readonly name = 'LegacyConfigLock';
  constructor(readonly path: string) {
    super(`PiIntercom: ${path} is the obsolete directory lock written by a pre-0025 version. Stop every process sharing this board, complete the reviewed offline upgrade of all of them, and remove only that established lock directory during that maintenance. Nothing was converted or removed now.`);
  }
}
/** The native provider or the syscall itself is unavailable: storage is unavailable, and there is no fallback. */
export class ConfigLockUnavailable extends Error {
  readonly name = 'ConfigLockUnavailable';
  constructor(detail: string) { super(`PiIntercom: the ${LOCK_PROVIDER} config lock is unavailable (${detail}); no weaker fallback is attempted and nothing was written.`); }
}

/** The only provider surface this adapter uses: exclusive whole-file lock, nonwaiting. */
export interface NativeLockProvider {
  tryLock(fd: number): boolean;
  unlock(fd: number): void;
}

let cachedProvider: NativeLockProvider | undefined;
let cachedFailure: string | undefined;

/**
 * Lazily load the pinned provider. Loading happens only when a writer actually needs the lock, so
 * read-only diagnostics stay usable on a host where the addon cannot load. The failure is remembered:
 * no writer retries a load, and no writer proceeds without the lock.
 */
export async function nativeLockProvider(): Promise<NativeLockProvider> {
  if (cachedProvider) return cachedProvider;
  if (cachedFailure !== undefined) throw new ConfigLockUnavailable(cachedFailure);
  try {
    const module = await import('fs-native-extensions');
    const value = (module as { default?: unknown }).default ?? module;
    const candidate = value as Partial<{ tryLock(fd: number, offset?: number, length?: number, opts?: { shared?: boolean }): unknown; unlock(fd: number, offset?: number, length?: number): unknown }>;
    if (typeof candidate.tryLock !== 'function' || typeof candidate.unlock !== 'function') throw new Error('the loaded module exposes no tryLock/unlock');
    cachedProvider = Object.freeze({
      // offset 0 / length 0 is the whole file, which is the only form macOS supports.
      tryLock: (fd: number) => candidate.tryLock!(fd, 0, 0, { shared: false }) === true,
      unlock: (fd: number) => { candidate.unlock!(fd, 0, 0); },
    });
    return cachedProvider;
  } catch (error) {
    cachedFailure = error instanceof Error ? error.message : String(error);
    throw new ConfigLockUnavailable(cachedFailure);
  }
}

export interface GuardIdentity { dev: number; ino: number }
const same = (left: GuardIdentity, right: GuardIdentity): boolean => left.dev === right.dev && left.ino === right.ino;

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
export async function acquireConfigLock(guard: string, provider: () => Promise<NativeLockProvider> = nativeLockProvider, createHandle: (guard: string) => Promise<FileHandle> = defaultHandle): Promise<HeldConfigLock> {
  let existing: Stats | undefined;
  try { existing = lstatSync(guard); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new ConfigLockUnavailable(`the guard path cannot be inspected: ${(error as Error).message}`); }
  if (existing !== undefined && existing.isDirectory()) throw new LegacyConfigLock(guard);
  if (existing !== undefined && (!existing.isFile() || existing.isSymbolicLink())) throw new ConfigLockUnavailable(`the guard path ${guard} is not a regular file`);
  if (existing === undefined) {
    // Nontruncating create, mode 0600. A concurrent creator is harmless: this file is permanent and is
    // never replaced, so whoever creates it, everybody locks the same inode.
    try { const created = await open(guard, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600); await created.close(); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new ConfigLockUnavailable(`the guard file cannot be created: ${(error as Error).message}`); }
  }
  const handle = await createHandle(guard);
  let pinned: GuardIdentity;
  try {
    pinned = identityOf(guard, handle);
    const acquired = await provider();
    if (!acquired.tryLock(handle.fd)) throw new ConfigLockContention(guard);
    // The locked inode must be the one the path names, before and after acquisition.
    if (!same(pinned, identityOf(guard, handle))) {
      try { acquired.unlock(handle.fd); } catch { /* the handle closes below */ }
      throw new ConfigLockUnavailable(`the guard file ${guard} changed identity while it was being locked`);
    }
  } catch (error) {
    // Nothing is left half-held: this call owns the handle until the lock is transferred.
    await handle.close().catch(() => {});
    throw error;
  }
  const acquiredProvider = await provider();
  let released = false;
  return {
    assertHeld: () => {
      if (released) throw new ConfigLockUnavailable('the config transaction lock handle was already released');
      identityOf(guard, handle, pinned);
    },
    release: async () => {
      if (released) return undefined;
      released = true;
      let failure: Error | undefined;
      try { acquiredProvider.unlock(handle.fd); } catch (error) { failure = error instanceof Error ? error : new Error(String(error)); }
      // Close even when unlock failed: the kernel releases the lock with the last reference.
      try { await handle.close(); } catch (error) { failure ??= error instanceof Error ? error : new Error(String(error)); }
      return failure;
    },
  };
}

async function defaultHandle(guard: string): Promise<FileHandle> {
  // Read/write without truncating: locking never modifies the guard's (empty) contents.
  return open(guard, constants.O_RDWR, 0o600);
}

/** Compare the open handle against the path, and optionally against a previously pinned identity. */
function identityOf(guard: string, handle: FileHandle, pinned?: GuardIdentity): GuardIdentity {
  let pathIdentity: Stats, handleIdentity: Stats;
  try { pathIdentity = lstatSync(guard); }
  catch (error) { throw new ConfigLockUnavailable(`the guard file ${guard} is no longer reachable: ${(error as Error).message}`); }
  try { handleIdentity = fstatSync(handle.fd); }
  catch (error) { throw new ConfigLockUnavailable(`the held guard handle is no longer valid: ${(error as Error).message}`); }
  if (!pathIdentity.isFile() || pathIdentity.isSymbolicLink()) throw new ConfigLockUnavailable(`the guard file ${guard} is no longer a regular file`);
  if (!same(pathIdentity, handleIdentity)) throw new ConfigLockUnavailable(`the guard file ${guard} was replaced outside this transaction`);
  if (pinned !== undefined && !same(pinned, handleIdentity)) throw new ConfigLockUnavailable(`the guard file ${guard} changed identity during this transaction`);
  return { dev: handleIdentity.dev, ino: handleIdentity.ino };
}
