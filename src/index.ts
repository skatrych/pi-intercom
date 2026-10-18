import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Type, type TSchema } from 'typebox';
import { getAgentDir, SessionManager, SettingsManager, truncateHead, withFileMutationQueue, type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { ConfigStore } from './config.js';
import { Intercom, UNSUPPORTED_CANCELLATION } from './runtime.js';
import type { CommandContext, Result } from './adoption.js';
import { stop } from './adoption.js';
import { adoptionInteraction } from './adoption-ui.js';
import { launchers } from './launcher.js';
import { ensureMonitorPane } from './monitor-launcher.js';
import { createActivityTracker } from './activity.js';
import { createCloseProvider } from './pane-close.js';

const to = Type.Object({ to: Type.String({ minLength: 1, maxLength: 128 }) });
const tools: [string, string, TSchema][] = [
  ['create_worker', 'Coordinator only. Launch one anonymous worker in projectDirectory (default root). Optional role is a logical Pi role name: the worker is launched as `pi-role <role>` with the normal Intercom Pi arguments. Before creating a pane, Intercom requires `pi-role --print <role>` to exit 0 and does not use the printed path. Omit role to keep the existing Pi launch. Intercom does not change PI_CODING_AGENT_DIR or resolve a role directory. projectDirectory is not a branch or worktree. No assignment, configuration, or registration wait.', Type.Object({ projectDirectory: Type.Optional(Type.String()), role: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })) })],
  ['configure_worker', 'Coordinator only. Write explicit reported connection details and responsibility to config. Optional role is the logical Pi role, separate from name and description. Explicit role wins; a saved role is kept when role is omitted; a reported role fills only a worker that has none. Omitting role does not clear a saved role. Does not notify, reload, or start work. Use reload_worker separately.', Type.Object({ sessionId: Type.String(), port: Type.Integer({ minimum: 1, maximum: 65535 }), projectDirectory: Type.String(), name: Type.String({ minLength: 1, maxLength: 128 }), description: Type.String({ minLength: 1, maxLength: 4096 }), role: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })) })],
  ['reload_worker', 'Coordinator only. Ask worker to reread responsibility and synchronize names. NOT Pi extension reload, cancellation, restart, or work assignment.', to],
  ['send', 'Configured sessions only. Send an explicit work/progress/findings message by recipient name. Idle delivery starts a turn; busy delivery steers at supported boundaries. Receipt is not an agent reply. Progress questions do not cancel assignments.', Type.Object({ to: Type.String(), message: Type.String({ minLength: 1, maxLength: 48000 }) })],
  ['worker_status', 'Configured sessions only. Read paginated JSON worker observations and public reports from local files, optionally by worker name. Last-observed status is not live liveness or task completion; reports are self-reported, not approval. Local-only by default; probe:true performs bounded loopback identity checks for this page only, without worker prompts or Telegram dependency. Disconnected means endpoint unreachable, not process termination. Follow nextOffset for further pages; null report means no readable active report.', Type.Object({ name: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })), offset: Type.Optional(Type.Integer({ minimum: 0 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })), probe: Type.Optional(Type.Boolean()) })],
  ['list', 'Configured sessions only. Read current saved names, responsibilities, session IDs, roles and ports. No live probing. Output limited to 50 KiB/2000 lines; full data remains in config.json.', Type.Object({})],
  ['request_status', 'Coordinator only. Ask worker extension to send an independent sessionId/port/busy report without a model turn on worker. No synchronous status reply.', to],
  ['report_work', 'Configured, responsibility-loaded workers only. Store one public report (blocked, needs_decision, ready_for_review) and notify the coordinator; clear retires it. Summary required except clear (omit or empty). Never include private reasoning, credentials, raw tool payloads, or secrets. Receipt is not approval, verified completion, or permission for follow-up work.', Type.Object({ status: Type.String({ enum: ['blocked', 'needs_decision', 'ready_for_review', 'clear'] }), summary: Type.Optional(Type.String({ maxLength: 2000 })) })],
  ['stop_reminders', 'Coordinator only. Disable the orchestration reminders at their configured interval, until the next worker-directed call. Use when there is genuinely nothing to follow up on. Stops only reminders, not workers, close jobs or model work. Reminder state is session-local and clears on shutdown/reload.', Type.Object({})],
  ['report_status', 'Worker only (including anonymous). Send runtime sessionId/port/busy and, when known, the logical role to the coordinator. This is NOT registration and creates no config entry. A saved role the worker does not report is a mismatch: the coordinator is notified and does not relaunch.', Type.Object({})],
  ['stop_worker', UNSUPPORTED_CANCELLATION, to],
  ['close_worker', 'Coordinator only. Begin a background save-handoff-and-close job for a configured worker in Linux Herdr. Requests a public summary, saves it in config, waits for successful tool persistence and final turn settlement, then attempts one verified pane close. Returns job acceptance, not completion. Registration/session history are retained. Check worker_status/list for closeJob; failure/timeout/uncertainty never authorizes retry. Not graceful abort or an all-descendants termination guarantee; Windows/non-Herdr unsupported.', to],
  ['report_handoff', 'Configured worker only, in response to its pending close request. Submit the matching jobId and concise public resume handoff (current work, completed work, unfinished items, blockers, next step). Never include secrets, private reasoning or raw tool payloads. Saved receipt is not closure: finish the response and wait; the extension requires final turn settlement before pane closure.', Type.Object({ jobId: Type.String({ minLength: 1, maxLength: 128 }), summary: Type.String({ minLength: 1, maxLength: 4000 }) })],
  ['resume_worker', 'Coordinator only. Resume saved session/name/responsibility after the user explicitly confirms the old session was closed: set confirmClosed:true only for that confirmation, never infer it from disconnected status. A saved logical role is launched again through pi-role with the same Pi session; a worker without a role uses the normal Pi launch. Sessions stay in the normal Pi session store. A matching live health endpoint blocks launch. In-flight/uncertain attempts are fenced until worker status arrives; otherwise inspect process and reload coordinator before considering retry. No cross-process uniqueness guarantee, automatic assignment, replacement or removal.', Type.Object({ to: Type.String({ minLength: 1, maxLength: 128 }), confirmClosed: Type.Boolean() })],
  ['remove_worker', 'Coordinator only. Remove config entry only; never stop process or delete session files. A running worker must be explicitly closed before removal. Retain registration to resume it later; remove only to forget it. Pending or uncertain close jobs block removal.', to],
  ['set_multiplexer', 'Coordinator only. Set herdr (default, Windows/Linux) or none (separate visible Windows terminals; unsupported on Linux) for future launches. Never move/restart existing workers or fall back.', Type.Object({ multiplexer: Type.String({ enum: ['herdr', 'none'] }) })],
];

// Launchers pass no --session-dir. Match child Pi's env > per-cwd settings >
// default lookup, resolving relative paths against the child's cwd, not ours.
// SettingsManager's public getter applies Pi's own path/tilde normalization.
export function resumeSessionDirectory(cwd: string, envSessionDir = process.env.PI_CODING_AGENT_SESSION_DIR, agentDir = getAgentDir()): string | undefined {
  const settings = envSessionDir
    ? SettingsManager.inMemory({ sessionDir: envSessionDir })
    : SettingsManager.create(cwd, path.resolve(cwd, agentDir));
  const sessionDir = settings.getSessionDir();
  return sessionDir ? path.resolve(cwd, sessionDir) : undefined;
}

// Participate in Pi's own per-file mutation queue as well as Intercom serialization. Only the outer
// queue is overridden: ConfigStore owns the order, and a nested acquisition would deadlock Pi's queue.
class PiConfigStore extends ConfigStore {
  protected override outerQueue<T>(run: () => Promise<T>): Promise<T> {
    return withFileMutationQueue(this.file, run);
  }
}

/**
 * Supported `pi.events` discovery channel for the role-local frontend. Versioned in the channel name.
 * The payload carries no identity, port, role, path, or confirmation: the offered closure is process-local
 * and is never serialized, so this bridge is neither an authorization token nor a security boundary.
 */
export const ADOPTION_CHANNEL = 'intercom:coordinator-adoption:v1';
export const ADOPTION_PROTOCOL = 1;
export interface AdoptionOffer { protocol: number; run(context: CommandContext, verb: string, args?: string[]): Promise<Result> }
export interface AdoptionDiscovery { offers: AdoptionOffer[] }

/** Narrow, non-throwing view of a foreign payload: only a known shape can receive an offer. */
export function adoptionDiscovery(value: unknown): AdoptionDiscovery | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const offers = (value as { offers?: unknown }).offers;
  return Array.isArray(offers) ? { offers: offers as AdoptionOffer[] } : undefined;
}
/**
 * All answers and authority data come from the backend's own captured Pi context. A caller supplies only
 * a supported command-only control (`waitForIdle`), never a dialog implementation, identity, or decision.
 */
function adoptionContext(captured: ExtensionContext, waitForIdle?: () => Promise<void>): CommandContext {
  return {
    cwd: captured.cwd,
    mode: captured.mode,
    hasUI: captured.hasUI,
    isProjectTrusted: () => captured.isProjectTrusted(),
    isIdle: () => captured.isIdle(),
    sessionManager: {
      getSessionId: () => captured.sessionManager.getSessionId(),
      getSessionFile: () => captured.sessionManager.getSessionFile(),
      getSessionDir: () => captured.sessionManager.getSessionDir(),
    },
    ui: {
      // Issue #9: no adoption question is ever handed to the host's `input(title, placeholder)`, whose
      // installed dialog renders the placeholder nowhere. `adoptionInteraction` renders the complete
      // prompt as durable visible text with raw-preserving answer capture in one Pi-owned screen, and a
      // host without a custom surface fails closed as `HOST` instead of asking an invisible question.
      input: options => adoptionInteraction(captured.ui).input(options),
      confirm: options => adoptionInteraction(captured.ui).confirm(options),
    },
    ...(waitForIdle ? { waitForIdle } : {}),
  };
}
function stopResult(code: Parameters<typeof stop>[0], line: string): Result { return stop(code, [line]); }
export default function intercomExtension(pi: ExtensionAPI): void {
  let runtime: Intercom | undefined;
  let context: ExtensionContext | undefined;
  let unsubscribeAdoption: (() => void) | undefined;
  let generation = 0;
  let activityOutcome: 'started' | 'settled' | 'snapshot' = 'snapshot';
  const activity = createActivityTracker((phase, detail) => {
    runtime?.recordObservation('host.activity', { busy: phase !== 'idle', phase, detail, outcome: activityOutcome });
  });
  const launcher = launchers({
    extension: fileURLToPath(import.meta.url),
    sessionExists: async (cwd, id) => (await SessionManager.list(cwd, resumeSessionDirectory(cwd))).some(s => s.id === id),
  });
  let monitorTask: { runtime: Intercom; generation: number; dirty: boolean; promise: Promise<void> } | undefined;
  async function ensureCoordinatorMonitor(current: Intercom, ctx: ExtensionContext, started: number): Promise<void> {
    const isCurrent = () => started === generation && runtime === current;
    if (!isCurrent() || !current.coordinatorActionReady()) return;
    if (monitorTask?.runtime === current && monitorTask.generation === started) {
      monitorTask.dirty = true;
      return monitorTask.promise;
    }
    const check = async () => {
      try {
        const { config, me, id } = await current.state();
        if (!isCurrent() || !current.coordinatorActionReady() || !me?.coordinator || !config.agents.some(agent => !agent.coordinator)) return;
        const monitor = await ensureMonitorPane({
          root: current.store.root, sessionId: id,
          script: fileURLToPath(new URL('../dist/monitor.js', import.meta.url)),
          assertCurrent: () => { if (!isCurrent() || !current.coordinatorActionReady()) throw new Error('Coordinator session changed or adoption not ready'); },
        });
        if (isCurrent()) ctx.ui.notify(`Intercom status monitor: ${monitor.outcome}${monitor.pane ? ` (${monitor.pane})` : ''}`, 'info');
      } catch (error) {
        if (isCurrent()) ctx.ui.notify(String(error), 'warning');
      }
    };
    const task = { runtime: current, generation: started, dirty: false, promise: Promise.resolve() };
    monitorTask = task;
    task.promise = (async () => {
      do { task.dirty = false; await check(); } while (task.dirty && isCurrent());
    })();
    try { await task.promise; } finally { if (monitorTask === task) monitorTask = undefined; }
  }
  pi.on('session_start', async (_event, ctx) => {
    const started = ++generation;
    unsubscribeAdoption?.(); unsubscribeAdoption = undefined;
    activity.reset();
    const oldRuntime = runtime;
    runtime = undefined;
    await oldRuntime?.close();
    if (started !== generation) return;
    context = ctx;
    if (!['win32', 'linux'].includes(process.platform) || ctx.mode !== 'tui') throw new Error('PiIntercom requires Windows or Linux interactive Pi. No resources started.');
    if (!ctx.isProjectTrusted()) throw new Error('PiIntercom requires project trust before honoring shared project configuration.');
    runtime = new Intercom({
      cwd: ctx.cwd,
      sessionId: () => context!.sessionManager.getSessionId(),
      busy: () => !context!.isIdle(),
      // Always supply the supported busy mode: the arrival snapshot can become
      // stale before Pi checks it. Pi still starts a normal turn when idle.
      deliver: content => pi.sendUserMessage(content, { deliverAs: 'steer' }),
      setName: async name => { if (pi.getSessionName() !== name) pi.setSessionName(name); await launcher.syncName(name); },
      notify: text => ctx.ui.notify(text, 'info'),
    }, {
      launch: launcher.launch, store: root => new PiConfigStore(root),
      adoption: {
        // The actual session directory, including `--session-dir`, never a guessed default and never the
        // most-recent session file. Pi's own list is the machine source for the sessionId.
        listSessions: async (cwd, sessionDir) => (await SessionManager.list(cwd, sessionDir ?? resumeSessionDirectory(cwd)))
          .map(session => ({ id: session.id, path: session.path })),
      },
      closeProvider: createCloseProvider({
        sessionId: () => context!.sessionManager.getSessionId(),
        sessionFile: () => context!.sessionManager.getSessionFile(),
      }),
    });
    const current = runtime;
    try { await current.start(); }
    catch (e) { if (runtime === current) runtime = undefined; ctx.ui.notify(String(e), 'error'); return; }
    if (started !== generation) { await current.close(); return; }
    // Offer the backend for every started session, including one held before a board write or an
    // anonymous session: adoption and read-only status are exactly what those sessions need. The offer
    // closure reads the current runtime at emit time and re-checks this generation at invoke time.
    offerAdoptionBackend();
    if (!current.coordinatorActionReady()) return; // held authority does not run boot cleanup/monitor checks
    try {
      if ((await current.state()).me?.coordinator) {
        try { await current.retireDashboardMetadata(); }
        catch (error) {
          if (started !== generation) return;
          ctx.ui.notify(`Legacy dashboard metadata cleanup failed; messaging remains available: ${String(error)}`, 'warning');
        }
        if (started !== generation) return;
        await ensureCoordinatorMonitor(current, ctx, started);
      }
    } catch (error) {
      if (started !== generation) return;
      ctx.ui.notify(String(error), 'warning');
    }
  });
  pi.on('session_shutdown', async () => {
    generation++;
    activity.reset();
    unsubscribeAdoption?.();
    unsubscribeAdoption = undefined;
    const oldRuntime = runtime;
    runtime = undefined; context = undefined;
    await oldRuntime?.close();
  });
  /**
   * Offer the deterministic backend to a role-local frontend through Pi's own event bus. The handler is
   * synchronous, so a frontend sees its offer count before any act. It never runs anything during
   * discovery, and an offered closure re-checks its captured generation and session when invoked.
   * Offering is not permission: the backend independently authorizes every invocation. Re-registered on
   * each session start and removed on shutdown, so a stale service can never be offered.
   */
  function offerAdoptionBackend(): void {
    unsubscribeAdoption?.();
    unsubscribeAdoption = pi.events.on(ADOPTION_CHANNEL, value => {
    const discovery = adoptionDiscovery(value);
    if (!discovery) return;
    const started = generation, offered = runtime, captured = context;
    discovery.offers.push({
      protocol: ADOPTION_PROTOCOL,
      run: async (rawContext, verb, args) => {
        const caller = rawContext as { cwd?: string; sessionManager?: { getSessionId?(): string }; waitForIdle?(): Promise<void> };
        if (!offered || !captured || started !== generation || runtime !== offered)
          return stopResult('SESSION_CHANGED', 'the runtime or session that offered this service is gone; no act was attempted');
        if (!caller || typeof caller !== 'object' || typeof caller.sessionManager?.getSessionId !== 'function')
          return stopResult('USAGE', 'a supported Pi command context is required; identity and confirmation are never serialized parameters');
        if (caller.sessionManager !== captured.sessionManager || caller.cwd !== captured.cwd || caller.sessionManager.getSessionId() !== captured.sessionManager.getSessionId())
          return stopResult('SESSION_CHANGED', 'the command context session is not this runtime session; no act was attempted');
        const waitForIdle = typeof caller.waitForIdle === 'function' ? () => caller.waitForIdle!() : undefined;
        return offered.adoptCoordinator(adoptionContext(captured, waitForIdle), verb, args ?? []);
      },
    });
  });
  }
  offerAdoptionBackend();
  pi.on('input', (_event, ctx) => {
    context = ctx;
    runtime?.workerStarted(); // New owner input invalidates a pending close-readiness epoch.
  });
  pi.on('agent_start', async (_event, ctx) => {
    context = ctx;
    runtime?.workerStarted();
    activityOutcome = 'started';
    try { activity.start(); } finally { activityOutcome = 'snapshot'; }
  });
  pi.on('agent_settled', async (_event, ctx) => {
    context = ctx;
    activityOutcome = 'settled';
    try { activity.settled(); } finally { activityOutcome = 'snapshot'; }
    // Settlement is notification-only and follows tool-result persistence. Inspect
    // only entry kinds and successful tool call IDs, never message/reasoning bodies.
    const successful = new Set<string>();
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === 'message' && entry.message.role === 'toolResult' && !entry.message.isError) {
        successful.add(entry.message.toolCallId);
      }
    }
    runtime?.workerSettled(successful);
  });
  pi.on('message_update', (event, ctx) => {
    context = ctx;
    // Inspect the event discriminator only. Never access reasoning/text payloads.
    activity.message(event.assistantMessageEvent.type);
  });
  pi.on('tool_execution_start', (event, ctx) => {
    context = ctx;
    activity.toolStart(event.toolCallId, event.toolName);
  });
  pi.on('tool_execution_end', (event, ctx) => {
    context = ctx;
    activity.toolEnd(event.toolCallId);
  });
  pi.on('before_agent_start', async (event, ctx) => {
    context = ctx;
    if (!runtime) return;
    const state = await runtime.state().catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    });
    const me = state?.me;
    const loaded = runtime.responsibility;
    return { systemPrompt: event.systemPrompt + '\n\nPiIntercom: communicates; Pi decides orchestration. Responsibility is not a work assignment. Do not implement unrelated work from findings. After assigned work, report as instructed and wait; do not autonomously exit. Progress questions require reporting and continuing unless explicitly redirected. stop_worker remains disabled due to the host cancellation blocker. close_worker is a separate Linux Herdr background handoff-and-pane-close workflow: do not self-exit, remove registration, force kill or infer completion from job acceptance.\n' + (!state ? 'No board is initialized: coordinator action is held. An ordinary non-coordinating turn may persist this Pi session; the human then uses /intercom-adopt status for the explicit projects-home bootstrap decision. Do not create a private board or edit claim/config state.' : me && loaded ? `Identity: ${loaded.name} (${me.sessionId}). Responsibility: ${loaded.description}.` : 'Anonymous/unloaded worker: wait for coordinator configuration and separate reload; do not treat registration as authorization to work.') };
  });
  for (const [operation, description, parameters] of tools) {
    pi.registerTool({
      name: `intercom_${operation}`, label: `Intercom ${operation}`, description, parameters,
      async execute(_id, args, signal, _update, ctx) {
        signal?.throwIfAborted(); context = ctx;
        if (!runtime) throw new Error('PiIntercom not initialized; inspect startup error.');
        const current = runtime, started = generation;
        const result = await current.tool(operation, args as Record<string, unknown>, _id, signal);
        if (operation === 'configure_worker') await ensureCoordinatorMonitor(current, ctx, started);
        const output = truncateHead(JSON.stringify(result, null, 2));
        return { content: [{ type: 'text', text: output.content + (output.truncated ? `\n[Truncated; full shared configuration: ${current.store.file}]` : '') }], details: {} };
      },
    });
  }
}
