/** Read-only view of the shared board config. The bridge never writes it (coordinator-only). */
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fail } from './wire.js';

export interface Agent { sessionId: string; name: string; coordinator: boolean; description: string; port: number; projectDirectory?: string; role?: string }
export interface Config { version: 1; multiplexer: string; agents: Agent[] }

export const configFile = (root: string) => path.join(root, '.pi-intercom', 'config.json');

export async function readBoard(root: string): Promise<Config> {
  let raw: string;
  try { raw = await readFile(configFile(root), 'utf8'); }
  catch (e) { fail(`board config unreadable at ${configFile(root)}: ${(e as NodeJS.ErrnoException).code ?? String(e)}`); }
  let value: Config;
  try { value = JSON.parse(raw); } catch { fail('board config is not valid JSON'); }
  if (!value || value.version !== 1 || !Array.isArray(value.agents)) fail('unsupported board config version/shape');
  for (const a of value.agents) {
    if (!a || typeof a.sessionId !== 'string' || typeof a.name !== 'string' || typeof a.coordinator !== 'boolean' || !Number.isInteger(a.port)) fail('invalid board agent entry');
  }
  if (value.agents.filter(a => a.coordinator).length !== 1) fail('board config must have exactly one coordinator');
  return value;
}
export const coordinatorOf = (c: Config): Agent => c.agents.find(a => a.coordinator)!;
export const entryOf = (c: Config, sessionId: string): Agent | undefined => c.agents.find(a => a.sessionId === sessionId);

/** Root-relative project directory, rejecting anything outside the board root (including symlinks). */
export async function projectDirectory(root: string, cwd: string): Promise<string> {
  const base = await realpath(root), target = await realpath(path.resolve(root, cwd));
  const rel = path.relative(base, target);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) fail('project directory must be the board root or a descendant of it');
  if (!(await stat(target)).isDirectory()) fail('project directory is not a directory');
  return rel.split(path.sep).join('/') || '.';
}
