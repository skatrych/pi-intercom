#!/usr/bin/env node
/**
 * pi-intercom-bridge run   --agent cursor|agy [options]   foreground worker (Ctrl+C / SIGTERM to exit)
 * pi-intercom-bridge spawn --agent cursor|agy [options]   detached worker; prints {sessionId,pid,log} JSON
 */
import { spawn } from 'node:child_process';
import { mkdirSync, openSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { adapter } from './adapters.js';
import { Bridge } from './bridge.js';
import { defaultStateDir } from './state.js';

const USAGE = `Usage: pi-intercom-bridge <run|spawn> --agent <cursor|agy> [--root <board root>] [--cwd <project dir>]
  [--session <id>] [--bin <cli path>] [--model <name>] [--auto-approve] [--turn-timeout <seconds>] [--state-dir <dir>]`;

export function parse(argv: string[]) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    agent: { type: 'string' }, root: { type: 'string' }, cwd: { type: 'string' }, session: { type: 'string' },
    bin: { type: 'string' }, model: { type: 'string' }, 'auto-approve': { type: 'boolean' },
    'turn-timeout': { type: 'string' }, 'state-dir': { type: 'string' }, help: { type: 'boolean', short: 'h' },
  } });
  const command = positionals[0];
  if (values.help || !command || !['run', 'spawn'].includes(command) || !values.agent) throw new Error(USAGE);
  const timeout = values['turn-timeout'] === undefined ? undefined : Number(values['turn-timeout']);
  if (timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0)) throw new Error('--turn-timeout must be a positive number of seconds');
  return { command, values, timeoutMs: timeout && timeout * 1000 };
}

async function main(argv: string[]) {
  const { command, values, timeoutMs } = parse(argv);
  const agent = adapter(values.agent!);
  const root = path.resolve(values.root ?? process.cwd());
  const stateDir = path.resolve(values['state-dir'] ?? defaultStateDir());
  if (command === 'spawn') {
    const sessionId = values.session ?? `${agent.name}-bridge-${randomUUID()}`;
    mkdirSync(stateDir, { recursive: true });
    const log = path.join(stateDir, `${sessionId}.log`);
    const fd = openSync(log, 'a');
    const rest = argv.slice(1).filter((a, i, all) => a !== '--session' && all[i - 1] !== '--session' && !a.startsWith('--session='));
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'run', ...rest, '--session', sessionId, '--root', root, '--state-dir', stateDir],
      { detached: true, stdio: ['ignore', 'pipe', fd], windowsHide: true });
    // Report only a worker that actually started: wait for its start line, or surface an early exit.
    const started = await new Promise<{ port: number } | Error>(resolve => {
      let out = '';
      const timer = setTimeout(() => resolve(new Error('worker did not report startup within 15 s')), 15_000);
      child.stdout!.setEncoding('utf8');
      child.stdout!.on('data', (chunk: string) => {
        out += chunk; const line = out.split('\n')[0];
        if (out.includes('\n')) { clearTimeout(timer); try { resolve(JSON.parse(line)); } catch { resolve(new Error(`unexpected worker output: ${line.slice(0, 200)}`)); } }
      });
      child.once('exit', code => { clearTimeout(timer); resolve(new Error(`worker exited during startup (code ${code})`)); });
    });
    child.stdout!.destroy(); child.unref();
    if (started instanceof Error) {
      const tail = readFileSync(log, 'utf8').trim().split('\n').slice(-3).join('\n');
      throw new Error(`${started.message}; see ${log}${tail ? `\n${tail}` : ''}`);
    }
    process.stdout.write(JSON.stringify({ sessionId, pid: child.pid, port: started.port, log }) + '\n');
    return;
  }
  const bridge = new Bridge({ adapter: agent, root, cwd: values.cwd && path.resolve(values.cwd), sessionId: values.session, bin: values.bin,
    model: values.model, autoApprove: values['auto-approve'], turnTimeoutMs: timeoutMs, stateDir });
  let exiting = false;
  const exit = async (why: string, code: number) => {
    if (exiting) return; exiting = true;
    process.stderr.write(`${new Date().toISOString()} exiting: ${why}\n`);
    await bridge.close().catch(() => {});
    process.exit(code);
  };
  process.on('SIGINT', () => void exit('SIGINT', 0));
  process.on('SIGTERM', () => void exit('SIGTERM', 0));
  process.on('uncaughtException', e => void exit(`uncaught ${String(e)}`, 1));
  await bridge.start();
  process.stdout.write(JSON.stringify({ sessionId: bridge.sessionId, port: bridge.port }) + '\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch(e => { process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`); process.exit(2); });
}
