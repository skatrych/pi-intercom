/**
 * A non-pi worker on a pi-intercom board. It speaks the unchanged V1 wire protocol: registers like an
 * anonymous Pi worker, loads its responsibility on `reload`, turns each agent `message` into one
 * headless CLI turn, and returns the result as a `report` (coordinator) or `message` (peer).
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { type Adapter } from './adapters.js';
import { coordinatorOf, entryOf, projectDirectory, readBoard, type Agent } from './board.js';
import { runTurn } from './runner.js';
import { loadState, saveState, type BridgeState } from './state.js';
import { clip, fail, listen, MESSAGE_LIMIT, send, SUMMARY_LIMIT, type Endpoint, type Envelope, type Kind, type ReportStatus } from './wire.js';

export interface BridgeOptions {
  adapter: Adapter;
  /** Board root holding .pi-intercom/config.json. */
  root: string;
  /** Project directory for the CLI; root or a descendant. Defaults to root. */
  cwd?: string;
  /** Reuse an earlier bridge identity (resume). Defaults to a new `<agent>-bridge-<uuid>`. */
  sessionId?: string;
  bin?: string;
  model?: string;
  autoApprove?: boolean;
  turnTimeoutMs?: number;
  stateDir: string;
  port?: number;
  maxQueue?: number;
  env?: NodeJS.ProcessEnv;
  log?: (line: string) => void;
  /** Test seam. */
  send?: typeof send;
}
interface Work { from: string; message: string; correlationId?: string }

export class Bridge {
  readonly sessionId: string;
  private endpoint?: Endpoint;
  private me?: Agent;
  private responsibilityKey?: string;
  private contextSentFor?: string;
  private state!: BridgeState;
  private queue: Work[] = [];
  private running = false;
  private pump: Promise<void> = Promise.resolve();
  private readonly abort = new AbortController();
  private closed = false;
  private readonly log: (line: string) => void;

  constructor(readonly options: BridgeOptions) {
    this.sessionId = options.sessionId ?? `${options.adapter.name}-bridge-${randomUUID()}`;
    if (this.sessionId.length > 256 || !this.sessionId.trim()) fail('invalid session ID');
    this.log = options.log ?? (line => process.stderr.write(`${new Date().toISOString()} ${line}\n`));
  }
  get port(): number { if (!this.endpoint) fail('bridge not started'); return this.endpoint.port; }
  get busy(): boolean { return this.running || this.queue.length > 0; }
  get cliSessionId(): string | undefined { return this.state?.cliSessionId; }

  async start(): Promise<void> {
    const root = path.resolve(this.options.root);
    const board = await readBoard(root);
    const relative = await projectDirectory(root, this.options.cwd ?? root);
    const saved = await loadState(this.options.stateDir, this.sessionId);
    if (saved && saved.agent !== this.options.adapter.name) fail(`session ${this.sessionId} belongs to agent ${saved.agent}, not ${this.options.adapter.name}`);
    this.state = saved ?? { version: 1, agent: this.options.adapter.name, sessionId: this.sessionId };
    await saveState(this.options.stateDir, this.state);
    const known = entryOf(board, this.sessionId);
    this.endpoint = await listen(this.options.port ?? known?.port, m => this.receive(m), () => ({ version: 1, sessionId: this.sessionId }));
    this.log(`bridge ${this.sessionId} (${this.options.adapter.name}) listening on 127.0.0.1:${this.endpoint.port}`);
    try {
      if (known) { this.load(known); await this.transmit(coordinatorOf(board), 'status', { port: this.endpoint.port, busy: this.busy }); }
      else await this.transmit(coordinatorOf(board), 'registration', { port: this.endpoint.port, projectDirectory: relative });
      this.log(known ? `resumed as configured worker ${known.name}; status sent` : 'registration sent; waiting for configure + reload');
    } catch (e) {
      // Same contract as a Pi worker: the endpoint stays reachable, no automatic retry.
      this.log(`coordinator unreachable/registration failed; endpoint stays open, no retry: ${String(e)}`);
    }
  }

  private load(entry: Agent): void {
    this.me = entry;
    this.responsibilityKey = `${entry.name}\n${entry.description}`;
  }

  private async transmit(to: Agent, kind: Kind, payload: Record<string, unknown>): Promise<void> {
    await (this.options.send ?? send)(to.port, { version: 1, kind, from: this.sessionId, to: to.sessionId, payload, correlationId: randomUUID() });
  }

  async receive(m: Envelope): Promise<void> {
    if (this.closed) fail('bridge is closing');
    if (m.to !== this.sessionId) fail('recipient session ID mismatch (stale endpoint)');
    const board = await readBoard(this.options.root);
    const sender = entryOf(board, m.from), me = entryOf(board, this.sessionId);
    if (m.kind === 'registration' || m.kind === 'status' || m.kind === 'report') fail('worker endpoint does not accept coordinator-bound kinds');
    if (m.kind.startsWith('close_') || m.kind === 'handoff_report') fail('background handoff is not supported by intercom-bridge workers');
    if (m.kind === 'message') {
      if (!sender || !me) fail('agent messaging requires configured sender and recipient');
      if (!this.responsibilityKey) fail('worker must load responsibility before receiving work');
      if (this.queue.length >= (this.options.maxQueue ?? 8)) fail('instruction queue full; not accepted');
      this.queue.push({ from: m.from, message: m.payload.message as string, correlationId: m.correlationId });
      this.log(`accepted instruction from ${sender.name} (${(m.payload.message as string).length} chars); queue ${this.queue.length}`);
      this.kick();
      return;
    }
    if (!sender?.coordinator) fail('control requires current coordinator sender session ID');
    if (m.kind === 'stop' || m.kind === 'close') fail('stop/close are disabled in this protocol version; stop the bridge process instead');
    if (m.kind === 'reload') {
      if (!me) fail('reload requires a configured worker entry');
      this.load(me); this.log(`responsibility loaded as ${me.name}`); return;
    }
    if (m.kind === 'request_status') {
      setImmediate(() => { void this.transmit(coordinatorOf(board), 'status', { port: this.port, busy: this.busy }).catch(e => this.log(`status report failed: ${String(e)}`)); });
      return;
    }
    fail('unsupported control');
  }

  private kick(): void {
    if (this.running) return;
    this.running = true;
    this.pump = (async () => {
      try { while (this.queue.length && !this.closed) await this.turn(this.queue.shift()!); }
      finally { this.running = false; }
    })();
  }

  private prompt(work: Work, sender: Agent | undefined): string {
    const head = `[Intercom agent message from ${sender?.name ?? 'unknown'} (${work.from})]\n${work.message}`;
    const needsContext = !this.state.cliSessionId || this.contextSentFor !== this.responsibilityKey;
    if (!needsContext || !this.me) return head;
    return `${head}\n\n---\nIntercom context: you are worker "${this.me.name}" on a pi-intercom board, run headless by intercom-bridge. ` +
      `Responsibility: ${this.me.description}\nYour final answer is returned to the sender automatically as your report; you have no intercom tools.`;
  }

  private async turn(work: Work): Promise<void> {
    const before = await readBoard(this.options.root).catch(() => undefined);
    const sender = before && entryOf(before, work.from);
    const prompt = this.prompt(work, sender);
    const result = await runTurn(this.options.adapter, {
      prompt, cwd: this.me?.projectDirectory ? path.resolve(this.options.root, this.me.projectDirectory) : path.resolve(this.options.cwd ?? this.options.root),
      resume: this.state.cliSessionId, model: this.options.model, autoApprove: this.options.autoApprove,
    }, { bin: this.options.bin ?? this.options.adapter.defaultBin, timeoutMs: this.options.turnTimeoutMs ?? 30 * 60_000, env: this.options.env, signal: this.abort.signal });
    if (result.ok) this.contextSentFor = this.responsibilityKey;
    if (result.cliSessionId && result.cliSessionId !== this.state.cliSessionId) {
      this.state = { ...this.state, cliSessionId: result.cliSessionId };
      await saveState(this.options.stateDir, this.state).catch(e => this.log(`state save failed: ${String(e)}`));
    }
    this.log(`turn ${result.ok ? 'succeeded' : 'failed'} (${result.text.length} chars${result.cliSessionId ? `, cli session ${result.cliSessionId}` : ''})${result.error ? `: ${result.error}` : ''}`);
    await this.deliver(work, result.ok, result.ok ? result.text : `${this.options.adapter.name} turn failed: ${result.error ?? 'unknown error'}${result.text ? `\n\nPartial output:\n${result.text}` : ''}`)
      .catch(e => this.log(`result delivery failed; no retry: ${String(e)}`));
  }

  /** Coordinator gets a stored `report` (plus a full-text `message` first when it exceeds a report); peers get a `message`. */
  private async deliver(work: Work, ok: boolean, body: string): Promise<void> {
    const board = await readBoard(this.options.root);
    const to = entryOf(board, work.from);
    if (!to) fail(`instruction sender ${work.from} is no longer configured`);
    const text = body.trim() || `${this.options.adapter.name} turn finished without text output`;
    if (!to.coordinator) { await this.transmit(to, 'message', { message: clip(`[${this.options.adapter.name} result: ${ok ? 'success' : 'error'}]\n${text}`, MESSAGE_LIMIT) }); return; }
    const status: ReportStatus = ok ? 'ready_for_review' : 'blocked';
    if (text.length > SUMMARY_LIMIT) {
      await this.transmit(to, 'message', { message: clip(`[${this.options.adapter.name} full result: ${ok ? 'success' : 'error'}]\n${text}`, MESSAGE_LIMIT) });
      await this.transmit(to, 'report', { status, summary: clip(text, SUMMARY_LIMIT, '\n[full result sent as a separate message]') });
    } else await this.transmit(to, 'report', { status, summary: text });
  }

  /** Graceful exit: abort a running CLI turn (reported as blocked), then close the endpoint. Config entry is kept. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const dropped = this.queue.length; this.queue = [];
    this.abort.abort();
    await this.pump.catch(() => {});
    if (dropped) this.log(`dropped ${dropped} queued instruction(s) on shutdown`);
    await this.endpoint?.close();
    this.log('bridge closed');
  }
}
