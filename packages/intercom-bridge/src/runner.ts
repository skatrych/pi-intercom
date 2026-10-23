/** Runs one headless CLI turn as a child process and folds its NDJSON stdout through the adapter. */
import { spawn } from 'node:child_process';
import type { Adapter, TurnOptions, TurnResult } from './adapters.js';

export interface RunOptions {
  bin: string;
  timeoutMs: number;
  /** After a terminal result line, how long the CLI may linger before it is stopped (agy can stay alive). */
  lingerMs?: number;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}
const MAX_STDOUT = 16 * 1024 * 1024;
const isTerminal = (a: Adapter, line: any) => a.name === 'cursor' ? line?.type === 'result' : (line?.event === 'result' || (line?.event === undefined && typeof line?.status === 'string'));

export function runTurn(adapter: Adapter, turn: TurnOptions, options: RunOptions): Promise<TurnResult> {
  return new Promise(resolve => {
    const lines: unknown[] = [];
    let buffer = '', stderr = '', bytes = 0, settled = false, reason: string | undefined, terminalSeen = false;
    const child = spawn(options.bin, adapter.args(turn), { cwd: turn.cwd, env: options.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const stop = (why: string) => { if (reason === undefined) reason = why; if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); };
    const timer = setTimeout(() => stop(`turn timed out after ${options.timeoutMs} ms`), options.timeoutMs);
    let linger: NodeJS.Timeout | undefined;
    const onAbort = () => stop('turn aborted (bridge shutting down)');
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const take = (raw: string) => {
      const trimmed = raw.trim(); if (!trimmed) return;
      try {
        const parsed = JSON.parse(trimmed); lines.push(parsed);
        if (!terminalSeen && isTerminal(adapter, parsed)) { terminalSeen = true; linger = setTimeout(() => stop('cli lingered after result'), options.lingerMs ?? 2000); }
      } catch { /* Non-JSON stdout noise is ignored; only NDJSON events carry results. */ }
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      bytes += chunk.length; if (bytes > MAX_STDOUT) { stop('cli output exceeded 16 MiB'); return; }
      buffer += chunk; let i: number;
      while ((i = buffer.indexOf('\n')) >= 0) { take(buffer.slice(0, i)); buffer = buffer.slice(i + 1); }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { if (stderr.length < 4096) stderr += chunk; });
    const finish = (code: number | null, signal: NodeJS.Signals | null, spawnError?: Error) => {
      if (settled) return; settled = true;
      clearTimeout(timer); if (linger) clearTimeout(linger); options.signal?.removeEventListener('abort', onAbort);
      take(buffer);
      const result = adapter.parse(lines);
      if (spawnError) { resolve({ ok: false, text: '', error: `could not start ${options.bin}: ${spawnError.message}` }); return; }
      // A terminal result decides the outcome; stopping a lingering CLI afterwards is not a failure.
      if (terminalSeen) { resolve(result); return; }
      const detail = firstLine(stderr);
      const why = reason ?? `${options.bin} exited with ${signal ? `signal ${signal}` : `code ${code}`}`;
      resolve({ ...result, ok: false, error: detail ? `${why}: ${detail}` : (result.error && reason === undefined ? `${why}: ${result.error}` : why) });
    };
    child.on('error', e => finish(null, null, e));
    child.on('close', (code, signal) => finish(code, signal));
  });
}
/** First non-empty stderr line, bounded: enough to diagnose (e.g. "Authentication required") without dumping logs. */
function firstLine(s: string): string { return (s.split(/\r?\n/).find(l => l.trim()) ?? '').trim().slice(0, 300); }
