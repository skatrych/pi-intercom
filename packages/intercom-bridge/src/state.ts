/** Bridge-local continuity: intercom session ID -> CLI conversation ID. Outside the board config. */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export interface BridgeState { version: 1; agent: string; sessionId: string; cliSessionId?: string }
export const defaultStateDir = () => process.env.PI_INTERCOM_BRIDGE_STATE ?? path.join(os.homedir(), '.pi-intercom-bridge');
const file = (dir: string, sessionId: string) => path.join(dir, `${sessionId.replace(/[^a-zA-Z0-9._-]/g, '_')}.json`);

export async function loadState(dir: string, sessionId: string): Promise<BridgeState | undefined> {
  try {
    const s = JSON.parse(await readFile(file(dir, sessionId), 'utf8')) as BridgeState;
    return s?.version === 1 && s.sessionId === sessionId ? s : undefined;
  } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw e; }
}
export async function saveState(dir: string, state: BridgeState): Promise<void> {
  await mkdir(dir, { recursive: true });
  const target = file(dir, state.sessionId), temp = `${target}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  await rename(temp, target);
}
