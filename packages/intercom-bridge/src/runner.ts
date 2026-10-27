/** Runs one headless CLI turn as a child process and folds its NDJSON stdout through the adapter. */
import { spawn } from 'node:child_process';
import type { Adapter, TurnOptions, TurnResult } from './adapters.js';

export interface RunOptions {
  bin: string;
  timeoutMs: number;
  /** After a terminal result line, how long the CLI may linger before it is stopped (agy can stay alive). */
  lingerMs?: number;
  /**
   * After SIGTERM (timeout/linger/abort/output-limit), how long to wait for the child to exit before
   * settling the turn as blocked/uncertain. No SIGKILL — Intercom cancellation stays soft.
   */
  settleMs?: number;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}
const MAX_STDOUT = 16 * 1024 * 1024;
const DEFAULT_SETTLE_MS = 2000;
const isTerminal = (a: Adapter, line: any) => a.name === 'cursor' ? line?.type === 'result' : (line?.event === 'result' || (line?.event === undefined && typeof line?.status === 'string'));

export function runTurn(adapter: Adapter, turn: TurnOptions, options: RunOptions): Promise<TurnResult> {
  return new Promise(resolve => {
    const lines: unknown[] = [];
    let buffer = '', stderr = '', bytes = 0, settled = false, reason: string | undefined, terminalSeen = false;
    const child = spawn(options.bin, adapter.args(turn), { cwd: turn.cwd, env: options.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let settleTimer: NodeJS.Timeout | undefined;
    const settleBound = options.settleMs ?? DEFAULT_SETTLE_MS;
    const detach = () => {
      try { child.stdout.destroy(); child.stderr.destroy(); child.unref(); } catch { /* ignore */ }
    };
    const stop = (why: string) => {
      if (reason === undefined) reason = why;
      if (child.exitCode === null && child.signalCode === null) {
        try { child.kill('SIGTERM'); } catch { /* already gone */ }
      }
      // Bound observation: if the child ignores SIGTERM (or inherited pipes keep it open), still settle.
      if (!settleTimer && !settled) {
        settleTimer = setTimeout(() => finish(child.exitCode, child.signalCode, undefined, true), settleBound);
      }
    };
    const timer = setTimeout(() => stop(`turn timed out after ${options.timeoutMs} ms`), options.timeoutMs);
    let linger: NodeJS.Timeout | undefined;
    const onAbort = () => stop('turn aborted (bridge shutting down)');
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
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
    // Stderr is retained only for local diagnosis capacity; it is never copied into board-facing errors.
    child.stderr.on('data', (chunk: string) => { if (stderr.length < 4096) stderr += chunk; });
    const finish = (code: number | null, signal: NodeJS.Signals | null, spawnError?: Error, forcedSettle = false) => {
      if (settled) return; settled = true;
      clearTimeout(timer); if (linger) clearTimeout(linger); if (settleTimer) clearTimeout(settleTimer);
      options.signal?.removeEventListener('abort', onAbort);
      take(buffer);
      if (forcedSettle) detach();
      let result: TurnResult;
      try { result = adapter.parse(lines); }
      catch (e) {
        resolve({ ok: false, text: '', error: `malformed CLI output (${e instanceof Error ? e.message : String(e)})` });
        return;
      }
      if (spawnError) { resolve({ ok: false, text: '', error: `could not start ${options.bin}: ${spawnError.message}` }); return; }

      const cleanExit = code === 0 && signal === null && !forcedSettle;
      // Accept parsed success only for a clean unaided exit, or the deliberate post-result linger stop.
      // Timeout, output-limit, shutdown abort, nonzero exit, and unexpected signals stay blocked.
      if (terminalSeen && result.ok) {
        if (reason === undefined && cleanExit) { resolve(result); return; }
        if (reason === 'cli lingered after result') { resolve(result); return; }
      }

      void stderr; // retained above for possible future local logging; never forwarded to the board
      const publicWhy = forcedSettle && reason
        ? `${reason}; process did not exit within ${settleBound} ms after SIGTERM (outcome uncertain)`
        : (reason ?? (terminalSeen && result.ok
          ? `${options.bin} emitted success but exited with ${signal ? `signal ${signal}` : `code ${code}`}`
          : `${options.bin} exited with ${signal ? `signal ${signal}` : `code ${code}`}`));
      const structured = (!reason && !(terminalSeen && result.ok) && result.error) ? `${publicWhy}: ${result.error}` : publicWhy;
      resolve({ ...result, ok: false, error: structured });
    };
    child.on('error', e => finish(null, null, e));
    child.on('close', (code, signal) => finish(code, signal));
  });
}
