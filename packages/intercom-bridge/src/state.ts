/** Bridge-local continuity: intercom session ID -> CLI conversation ID. Outside the board config. */
import { access, mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fail } from './wire.js';

export interface BridgeState { version: 1; agent: string; sessionId: string; cliSessionId?: string }
export const defaultStateDir = () => process.env.PI_INTERCOM_BRIDGE_STATE ?? path.join(os.homedir(), '.pi-intercom-bridge');

/** Filesystem-safe form of a session/worker ID (state files, lock files, log names). */
export function sanitizeId(sessionId: string): string {
  const s = sessionId.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!s || s === '.' || s === '..' || s.length > 256) fail('invalid session ID for filesystem use');
  return s;
}

const stateFile = (dir: string, sessionId: string) => path.join(dir, `${sanitizeId(sessionId)}.json`);
const lockFile = (dir: string, sessionId: string) => path.join(dir, `${sanitizeId(sessionId)}.lock`);
/** Sidecar when first CLI ID publication failed; blocks fresh-chat under this identity until cleared. */
const continuityBlockedFile = (dir: string, sessionId: string) => path.join(dir, `${sanitizeId(sessionId)}.continuity-blocked`);

export async function loadState(dir: string, sessionId: string): Promise<BridgeState | undefined> {
  const target = stateFile(dir, sessionId);
  let raw: string;
  try { raw = await readFile(target, 'utf8'); }
  catch (e) {
    // First start of a brand-new session: no map yet. Corrupt/unreadable existing files fail closed below.
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    fail(`bridge state unreadable for ${sessionId}: ${(e as NodeJS.ErrnoException).code ?? String(e)}`);
  }
  let s: BridgeState;
  try { s = JSON.parse(raw); } catch { fail(`bridge state for ${sessionId} is not valid JSON`); }
  if (!s || s.version !== 1 || s.sessionId !== sessionId || typeof s.agent !== 'string') {
    fail(`bridge state for ${sessionId} is corrupt or incompatible (refusing silent remap)`);
  }
  if (s.cliSessionId !== undefined && (typeof s.cliSessionId !== 'string' || !s.cliSessionId.trim())) {
    fail(`bridge state for ${sessionId} has an invalid cliSessionId`);
  }
  return s;
}

export async function saveState(dir: string, state: BridgeState): Promise<void> {
  await mkdir(dir, { recursive: true });
  const target = stateFile(dir, state.sessionId), temp = `${target}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  await rename(temp, target);
}

/**
 * Durable fence after a failed first CLI conversation-ID publish. Distinct from the state JSON
 * temp path so a publication obstruction on `*.json.<pid>.tmp` cannot also block this marker.
 * Cleared only after a successful bind (or by explicit operator recovery / new identity).
 */
export async function markContinuityBlocked(dir: string, sessionId: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(continuityBlockedFile(dir, sessionId), `${new Date().toISOString()}\n`, { mode: 0o600 });
}

export async function clearContinuityBlocked(dir: string, sessionId: string): Promise<void> {
  await unlink(continuityBlockedFile(dir, sessionId)).catch(() => {});
}

/** Only genuine ENOENT is absence; any other I/O error (EACCES, EIO, ...) propagates (fail closed). */
export async function hasContinuityBlocked(dir: string, sessionId: string): Promise<boolean> {
  try { await access(continuityBlockedFile(dir, sessionId)); return true; }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw e;
  }
}

/**
 * Exclusive ownership of a bridge session identity for this process.
 * Concurrent starts with the same session ID must not both succeed.
 */
/** Release ownership; with `retain`, the lock file is kept (reason written via the open handle) as a fence. */
export type ReleaseOwnership = (retain?: string) => Promise<void>;

export async function acquireOwnership(dir: string, sessionId: string): Promise<ReleaseOwnership> {
  await mkdir(dir, { recursive: true });
  const target = lockFile(dir, sessionId);
  let handle: FileHandle;
  try {
    handle = await open(target, 'wx');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
      const held = await readFile(target, 'utf8').catch(() => '');
      if (held.includes('continuity-blocked')) {
        fail(`session ${sessionId}: continuity fence could not be published; lock retained to refuse fresh-chat continuation (restore a bound mapping and remove ${target}, or use a new identity)`);
      }
      fail(`session ${sessionId} is already owned by another bridge process`);
    }
    throw e;
  }
  await handle.writeFile(`${process.pid}\n`, 'utf8');
  let released = false;
  return async (retain?: string) => {
    if (released) return;
    released = true;
    if (retain) {
      // Writing through the already-open handle needs no new directory entry.
      await handle.truncate(0).then(() => handle.write(`continuity-blocked ${retain}\n`, 0)).catch(() => {});
      await handle.close().catch(() => {});
      return;
    }
    await handle.close().catch(() => {});
    await unlink(target).catch(() => {});
  };
}
