/**
 * Per-CLI adapters: how to invoke one headless turn and how to read its NDJSON output.
 * Flags are taken from the vendors' CLI references (see docs/issues/34-*.md).
 */
export interface TurnOptions {
  prompt: string;
  cwd: string;
  /** CLI conversation to continue; undefined starts a new one. */
  resume?: string;
  model?: string;
  /** Auto-approve tool/shell use (cursor --force, agy --dangerously-skip-permissions). Off by default. */
  autoApprove?: boolean;
}
export interface TurnResult {
  ok: boolean;
  text: string;
  /** CLI conversation ID observed in the output, used for the next turn's resume. */
  cliSessionId?: string;
  error?: string;
}
export interface Adapter {
  readonly name: 'cursor' | 'agy';
  readonly defaultBin: string;
  /** Unverified adapters are implemented from docs only, without a real authenticated run. */
  readonly verified: 'flags+unauthenticated-failure' | 'docs-only';
  args(turn: TurnOptions): string[];
  /** Fold one parsed stdout line into the running state. */
  parse(lines: unknown[]): TurnResult;
}

const obj = (v: unknown): Record<string, any> | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/** Cursor Agent CLI: `cursor-agent -p --output-format stream-json [--resume <chatId>] <prompt>`. */
export const cursor: Adapter = {
  name: 'cursor',
  defaultBin: 'cursor-agent',
  verified: 'flags+unauthenticated-failure',
  args(t) {
    return ['--print', '--output-format', 'stream-json', '--trust', '--workspace', t.cwd,
      ...(t.resume ? ['--resume', t.resume] : []),
      ...(t.model ? ['--model', t.model] : []),
      ...(t.autoApprove ? ['--force'] : []),
      // End of options: a prompt beginning with "-" must not be read as a flag.
      '--', t.prompt];
  },
  parse(lines) {
    let cliSessionId: string | undefined, final: Record<string, any> | undefined;
    const assistant: string[] = [];
    for (const line of lines) {
      const e = obj(line); if (!e) continue;
      cliSessionId = str(e.session_id) ?? cliSessionId;
      if (e.type === 'assistant') {
        const content = obj(e.message)?.content;
        if (content != null && !Array.isArray(content)) throw new Error('assistant message.content is not an array');
        for (const part of content ?? []) { if (part?.type === 'text' && typeof part.text === 'string') assistant.push(part.text); }
      }
      if (e.type === 'result') final = e;
    }
    if (!final) return { ok: false, text: assistant.join(''), cliSessionId, error: 'no result event in cursor-agent output' };
    const ok = final.subtype === 'success' && final.is_error !== true;
    const text = typeof final.result === 'string' ? final.result : assistant.join('');
    return { ok, text, cliSessionId, ...(ok ? {} : { error: str(final.error) ?? `cursor-agent result ${String(final.subtype)}` }) };
  },
};

/** Google Antigravity CLI: `agy -p <prompt> --output-format stream-json [--conversation <id>]`. */
export const agy: Adapter = {
  name: 'agy',
  defaultBin: 'agy',
  verified: 'flags+unauthenticated-failure',
  args(t) {
    // agy has no workspace flag; the bridge runs it with cwd = project directory.
    return ['--output-format', 'stream-json',
      ...(t.resume ? ['--conversation', t.resume] : []),
      ...(t.model ? ['--model', t.model] : []),
      ...(t.autoApprove ? ['--dangerously-skip-permissions'] : []),
      // `-p` takes the prompt as its value; `--print=<prompt>` keeps a leading "-" from being read as a flag.
      `--print=${t.prompt}`];
  },
  parse(lines) {
    let cliSessionId: string | undefined, final: Record<string, any> | undefined;
    const deltas: string[] = [];
    for (const line of lines) {
      const e = obj(line); if (!e) continue;
      if (e.event === 'init') cliSessionId = str(e.conversation_id) ?? cliSessionId;
      const step = obj(e.step_update);
      if (step) {
        cliSessionId = str(step.conversation_id) ?? cliSessionId;
        if (step.step_type === 'agent_response' && typeof step.text_delta === 'string') deltas.push(step.text_delta);
      }
      if (e.event === 'result' && obj(e.result)) final = e.result;
      // `--output-format json` shape (also seen on early auth failure): one object with status.
      if (e.event === undefined && typeof e.status === 'string') final = e;
    }
    if (!final) return { ok: false, text: deltas.join(''), cliSessionId, error: 'no result event in agy output' };
    cliSessionId = str(final.conversation_id) ?? cliSessionId;
    const ok = final.status === 'SUCCESS';
    const text = typeof final.response === 'string' ? final.response : deltas.join('');
    return { ok, text, cliSessionId, ...(ok ? {} : { error: str(final.error) ?? `agy status ${String(final.status)}` }) };
  },
};

export const ADAPTERS: Record<string, Adapter> = { cursor, agy };
export function adapter(name: string): Adapter {
  const a = ADAPTERS[name];
  if (!a) throw new Error(`PiIntercomBridge: unknown agent "${name}" (expected ${Object.keys(ADAPTERS).join(' or ')})`);
  return a;
}
