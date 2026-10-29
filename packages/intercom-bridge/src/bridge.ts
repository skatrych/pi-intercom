/**
 * A non-pi worker on a pi-intercom board. It speaks the unchanged V1 wire protocol: registers like an
 * anonymous Pi worker, loads its responsibility on `reload`, turns each agent `message` into one
 * headless CLI turn, and returns the result as a `report` (coordinator) or `message` (peer).
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { type Adapter } from './adapters.js';
import { coordinatorOf, entryOf, fencedClose, projectDirectory, readBoard, type Agent } from './board.js';
import { runTurn } from './runner.js';
import { acquireOwnership, clearContinuityBlocked, hasContinuityBlocked, loadState, markContinuityBlocked, saveState, type BridgeState, type ReleaseOwnership } from './state.js';
import { clip, fail, fitEnvelope, listen, MESSAGE_LIMIT, send, SUMMARY_LIMIT, type Endpoint, type Envelope, type Kind, type ReportStatus } from './wire.js';

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
  /** Bound child settlement after SIGTERM; see runner. */
  settleMs?: number;
  /** After a terminal CLI result, how long to wait before linger SIGTERM; see runner. */
  lingerMs?: number;
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
  private releaseOwnership?: ReleaseOwnership;
  /** CLI child that ignored SIGTERM past settleMs; blocks next turn and ownership release until exit. */
  private unresolvedChild?: Promise<void>;
  /** First CLI ID publication failed under this identity; fence fresh-chat until bind or new identity. */
  private continuityBlocked = false;
  /** The durable continuity-blocked marker could not be written; close must not release ownership as if it had. */
  private markerUnpublished = false;
  private readonly log: (line: string) => void;

  constructor(readonly options: BridgeOptions) {
    this.sessionId = options.sessionId ?? `${options.adapter.name}-bridge-${randomUUID()}`;
    if (this.sessionId.length > 256 || !this.sessionId.trim()) fail('invalid session ID');
    this.log = options.log ?? (line => process.stderr.write(`${new Date().toISOString()} ${line}\n`));
  }
  get port(): number { if (!this.endpoint) fail('bridge not started'); return this.endpoint.port; }
  get busy(): boolean { return this.running || this.queue.length > 0 || !!this.unresolvedChild; }
  get cliSessionId(): string | undefined { return this.state?.cliSessionId; }

  async start(): Promise<void> {
    const root = path.resolve(this.options.root);
    const board = await readBoard(root);
    const relative = await projectDirectory(root, this.options.cwd ?? root);
    this.releaseOwnership = await acquireOwnership(this.options.stateDir, this.sessionId);
    try {
      const saved = await loadState(this.options.stateDir, this.sessionId);
      if (saved && saved.agent !== this.options.adapter.name) fail(`session ${this.sessionId} belongs to agent ${saved.agent}, not ${this.options.adapter.name}`);
      const known = entryOf(board, this.sessionId);
      // First use (not yet on the board) may create a mapping on ENOENT. An established configured
      // identity with missing state is not first use — refuse silent remap / new conversation.
      if (!saved && known) {
        fail(`bridge state missing for configured worker ${this.sessionId}; refusing silent remap (restore state or use a new identity)`);
      }
      // Prior failed first-ID publication: do not resume as a fresh chat under the same identity (B2).
      // Genuine first-use ENOENT has no marker. Recovery: bind a cliSessionId mapping and clear the
      // marker, or choose a new worker identity.
      const blockedMarker = await hasContinuityBlocked(this.options.stateDir, this.sessionId);
      if (blockedMarker && !saved?.cliSessionId) {
        fail(`continuity bind previously failed for ${this.sessionId}; refusing fresh-chat continuation (restore a bound mapping and clear the continuity-blocked marker, or use a new identity)`);
      }
      this.continuityBlocked = blockedMarker && !saved?.cliSessionId;
      this.state = saved ?? { version: 1, agent: this.options.adapter.name, sessionId: this.sessionId };
      await saveState(this.options.stateDir, this.state);
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
    } catch (e) {
      await this.releaseOwnership().catch(() => {});
      this.releaseOwnership = undefined;
      await this.endpoint?.close().catch(() => {});
      this.endpoint = undefined;
      throw e;
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
      if (fencedClose(me.closeJob)) fail('worker close is active or uncertain; new Intercom work is fenced');
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
      if (fencedClose(me.closeJob)) fail('worker close is active or uncertain; reload is fenced');
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
    // Re-authorize against the live board before any deferred spawn (revocation / close fence).
    let board;
    try { board = await readBoard(this.options.root); }
    catch (e) {
      await this.deliver(work, false, `${this.options.adapter.name} turn failed: board unreadable before spawn: ${String(e)}`)
        .catch(err => this.log(`result delivery failed; no retry: ${String(err)}`));
      return;
    }
    const me = entryOf(board, this.sessionId);
    const sender = entryOf(board, work.from);
    if (!me) {
      this.log('turn aborted before spawn: worker is no longer configured on the board');
      await this.deliver(work, false, `${this.options.adapter.name} turn failed: worker is no longer configured on the board`)
        .catch(e => this.log(`result delivery failed; no retry: ${String(e)}`));
      return;
    }
    if (fencedClose(me.closeJob)) {
      this.log('turn aborted before spawn: worker close is active or uncertain; execution is fenced');
      await this.deliver(work, false, `${this.options.adapter.name} turn failed: worker close is active or uncertain; execution is fenced`)
        .catch(e => this.log(`result delivery failed; no retry: ${String(e)}`));
      return;
    }
    if (!sender) {
      this.log('turn aborted before spawn: instruction sender is no longer configured');
      await this.deliver(work, false, `${this.options.adapter.name} turn failed: instruction sender is no longer configured`)
        .catch(e => this.log(`result delivery failed; no retry: ${String(e)}`));
      return;
    }
    // Same-process / durable fence after failed first-ID publication (B2).
    const markerBlocked = !this.continuityBlocked && !this.state.cliSessionId &&
      await hasContinuityBlocked(this.options.stateDir, this.sessionId).catch(e => {
        this.log(`continuity-blocked marker unreadable; failing closed: ${String(e)}`); return true;
      });
    if (this.continuityBlocked || markerBlocked) {
      this.continuityBlocked = true;
      this.log('turn aborted before spawn: continuity bind previously failed; refusing fresh-chat continuation');
      await this.deliver(work, false, `${this.options.adapter.name} turn failed: continuity bind previously failed; refusing fresh-chat continuation under this identity`)
        .catch(e => this.log(`result delivery failed; no retry: ${String(e)}`));
      return;
    }
    this.load(me);
    const prompt = this.prompt(work, sender);
    let result = await runTurn(this.options.adapter, {
      prompt, cwd: me.projectDirectory ? path.resolve(this.options.root, me.projectDirectory) : path.resolve(this.options.cwd ?? this.options.root),
      resume: this.state.cliSessionId, model: this.options.model, autoApprove: this.options.autoApprove,
    }, {
      bin: this.options.bin ?? this.options.adapter.defaultBin,
      timeoutMs: this.options.turnTimeoutMs ?? 30 * 60_000,
      settleMs: this.options.settleMs,
      lingerMs: this.options.lingerMs,
      env: this.options.env,
      signal: this.abort.signal,
    });

    // Unresolved child (ignored SIGTERM): report below, but do not overlap another turn or release ownership.
    const unresolved = result.unresolved;
    if (unresolved) this.unresolvedChild = unresolved;

    // Continuity: bind on first success; refuse missing ID and ID drift (fail closed).
    if (result.ok) {
      if (!result.cliSessionId || !result.cliSessionId.trim()) {
        result = { ok: false, text: result.text, error: 'CLI returned success without a conversation ID; refusing to report ready without continuity' };
      } else if (this.state.cliSessionId && result.cliSessionId !== this.state.cliSessionId) {
        result = {
          ok: false, text: result.text, cliSessionId: this.state.cliSessionId,
          error: `CLI conversation ID drifted (expected ${this.state.cliSessionId}, got ${result.cliSessionId}); refusing silent remap`,
        };
      } else if (!this.state.cliSessionId) {
        // Persistence must succeed before continuity is established; in-memory-only ID is not restart-safe.
        try {
          const next = { ...this.state, cliSessionId: result.cliSessionId };
          await saveState(this.options.stateDir, next);
          this.state = next;
          this.continuityBlocked = false;
          this.markerUnpublished = false;
          await clearContinuityBlocked(this.options.stateDir, this.sessionId);
        } catch (e) {
          // Fence this identity against silent fresh-chat continuation (in-process and across restart).
          this.continuityBlocked = true;
          await markContinuityBlocked(this.options.stateDir, this.sessionId).catch(err => {
            this.markerUnpublished = true;
            this.log(`continuity-blocked marker write failed: ${String(err)}`);
          });
          result = {
            ok: false, text: result.text, cliSessionId: result.cliSessionId,
            error: `failed to persist CLI conversation ID; refusing to establish restart continuity (${e instanceof Error ? e.message : String(e)})`,
          };
        }
      }
    }
    if (result.ok) this.contextSentFor = this.responsibilityKey;
    this.log(`turn ${result.ok ? 'succeeded' : 'failed'} (${result.text.length} chars${result.cliSessionId ? `, cli session ${result.cliSessionId}` : ''})${result.error ? `: ${result.error}` : ''}`);
    await this.deliver(work, result.ok, result.ok ? result.text : `${this.options.adapter.name} turn failed: ${result.error ?? 'unknown error'}${result.text ? `\n\nPartial output:\n${result.text}` : ''}`)
      .catch(e => this.log(`result delivery failed; no retry: ${String(e)}`));
    // Honor one-CLI-turn-at-a-time: wait out an unsettled child before the pump dequeues another turn.
    if (unresolved) {
      this.log('waiting for unsettled CLI child to exit before next turn or ownership release');
      await unresolved;
      if (this.unresolvedChild === unresolved) this.unresolvedChild = undefined;
    }
  }

  /**
   * Coordinator gets a stored `report` (plus an optional full-text `message` when it exceeds a report);
   * peers get a `message`. The mandatory report is always attempted first so an oversized/failed
   * full-text notification cannot suppress it.
   */
  private async deliver(work: Work, ok: boolean, body: string): Promise<void> {
    const board = await readBoard(this.options.root);
    const to = entryOf(board, work.from);
    if (!to) fail(`instruction sender ${work.from} is no longer configured`);
    const text = body.trim() || `${this.options.adapter.name} turn finished without text output`;
    if (!to.coordinator) {
      const built = fitEnvelope(
        message => ({ version: 1, kind: 'message', from: this.sessionId, to: to.sessionId, payload: { message }, correlationId: randomUUID() }),
        clip(`[${this.options.adapter.name} result: ${ok ? 'success' : 'error'}]\n${text}`, MESSAGE_LIMIT),
      );
      await (this.options.send ?? send)(to.port, built);
      return;
    }
    const status: ReportStatus = ok ? 'ready_for_review' : 'blocked';
    const needsFull = text.length > SUMMARY_LIMIT;
    // Mandatory report first.
    await this.transmit(to, 'report', {
      status,
      summary: needsFull ? clip(text, SUMMARY_LIMIT, '\n[full result sent as a separate message]') : text,
    });
    if (needsFull) {
      try {
        const built = fitEnvelope(
          message => ({ version: 1, kind: 'message', from: this.sessionId, to: to.sessionId, payload: { message }, correlationId: randomUUID() }),
          clip(`[${this.options.adapter.name} full result: ${ok ? 'success' : 'error'}]\n${text}`, MESSAGE_LIMIT),
        );
        await (this.options.send ?? send)(to.port, built);
      } catch (e) {
        this.log(`full-result message skipped after report: ${String(e)}`);
      }
    }
  }

  /** Graceful exit: abort a running CLI turn (reported as blocked), then close the endpoint. Config entry is kept. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const dropped = this.queue.length; this.queue = [];
    this.abort.abort();
    await this.pump.catch(() => {});
    // Keep exclusive ownership until any detached unsettled child actually exits (no SIGKILL).
    if (this.unresolvedChild) {
      this.log('close waiting for unsettled CLI child before releasing ownership');
      await this.unresolvedChild.catch(() => {});
      this.unresolvedChild = undefined;
    }
    if (dropped) this.log(`dropped ${dropped} queued instruction(s) on shutdown`);
    await this.endpoint?.close();
    // B2: if the durable marker never landed, retry once; if it still fails, keep the ownership lock
    // as the fence instead of releasing it as though continuity protection had been published.
    let retain: string | undefined;
    if (this.markerUnpublished) {
      await markContinuityBlocked(this.options.stateDir, this.sessionId).then(() => { this.markerUnpublished = false; }, e => {
        retain = 'marker publish failed after first-ID bind failure';
        this.log(`continuity-blocked marker still unpublishable; retaining ownership lock as fence: ${String(e)}`);
      });
    }
    await this.releaseOwnership?.(retain).catch(() => {});
    this.releaseOwnership = undefined;
    this.log('bridge closed');
  }
}
