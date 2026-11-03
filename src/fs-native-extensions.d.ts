/**
 * Exact-pinned types for the ADR 0025 P1 lock provider. Only the synchronous nonwaiting exclusive
 * surface used by `src/native-lock.ts` is declared; the provider's waiters and other extensions are
 * deliberately outside this project's surface.
 */
declare module 'fs-native-extensions' {
  export function tryLock(fd: number, offset?: number, length?: number, opts?: { shared?: boolean }): boolean;
  export function unlock(fd: number, offset?: number, length?: number): void;
}
