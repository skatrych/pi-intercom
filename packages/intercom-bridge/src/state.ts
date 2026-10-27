/** Bridge-local continuity: intercom session ID -> CLI conversation ID. Outside the board config. */
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
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
 * Exclusive ownership of a bridge session identity for this process.
 * Concurrent starts with the same session ID must not both succeed.
 */
export async function acquireOwnership(dir: string, sessionId: string): Promise<() => Promise<void>> {
  await mkdir(dir, { recursive: true });
  const target = lockFile(dir, sessionId);
  let handle: FileHandle;
  try {
    handle = await open(target, 'wx');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
      fail(`session ${sessionId} is already owned by another bridge process`);
    }
    throw e;
  }
  await handle.writeFile(`${process.pid}\n`, 'utf8');
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await handle.close().catch(() => {});
    await unlink(target).catch(() => {});
  };
}
