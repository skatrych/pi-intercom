import { randomUUID } from 'node:crypto';
export const HANDOFF_KINDS = ['close_prepare', 'close_identity', 'close_request', 'handoff_report', 'close_ready', 'close_commit'];
const states = ['requested', 'awaiting_handoff', 'awaiting_settlement', 'ready', 'closing', 'closed', 'failed', 'timed_out', 'interrupted', 'uncertain'];
const reasons = ['timeout', 'interrupted', 'delivery_failed', 'identity_failed', 'save_failed', 'worker_changed', 'worker_busy', 'commit_rejected', 'close_unverified', 'close_failed'];
export const pendingClose = (job) => !!job && ['requested', 'awaiting_handoff', 'awaiting_settlement', 'ready', 'closing'].includes(job.state);
export const fencedClose = (job) => pendingClose(job) || job?.state === 'uncertain';
function requireValue(ok) { if (!ok)
    throw new Error('PiIntercom: invalid handoff protocol/state'); }
const string = (value, max) => typeof value === 'string' && !!value.trim() && value.length <= max && !value.includes('\0');
const token = (value) => typeof value === 'string' && /^[a-zA-Z0-9-]{1,128}$/.test(value);
const timestamp = (value) => typeof value === 'string' && value.length <= 32 && Number.isFinite(Date.parse(value));
export function validateIdentity(value) {
    const v = value;
    requireValue(v && ['workspaceId', 'paneId', 'terminalId', 'sessionId', 'processStart'].every(k => string(v[k], 256)) && string(v.sessionFile, 4096) && Number.isSafeInteger(v.pid) && v.pid > 0);
}
export function validateHandoff(value) {
    const v = value;
    requireValue(v && v.version === 1 && token(v.jobId) && string(v.summary, 4000) && timestamp(v.updatedAt));
    requireValue(Object.keys(v).every(k => ['version', 'jobId', 'summary', 'updatedAt'].includes(k)));
}
export function validateCloseJob(value) {
    const v = value;
    requireValue(v && token(v.jobId) && states.includes(v.state) && timestamp(v.createdAt) && timestamp(v.updatedAt) && timestamp(v.deadlineAt) && (v.reason === undefined || reasons.includes(v.reason)));
    requireValue(Object.keys(v).every(k => ['jobId', 'state', 'createdAt', 'updatedAt', 'deadlineAt', 'reason'].includes(k)));
}
export function validateHandoffPayload(kind, p) {
    requireValue(token(p.jobId));
    const keys = {
        close_prepare: ['jobId', 'deadlineAt'], close_identity: ['jobId', 'instanceId', 'identity'],
        close_request: ['jobId', 'instanceId'], handoff_report: ['jobId', 'instanceId', 'summary'],
        close_ready: ['jobId', 'instanceId', 'readyNonce'], close_commit: ['jobId', 'instanceId', 'readyNonce'],
    };
    requireValue(!!keys[kind] && Object.keys(p).every(k => keys[kind].includes(k)));
    if (kind === 'close_prepare')
        requireValue(timestamp(p.deadlineAt));
    else
        requireValue(token(p.instanceId));
    if (kind === 'close_identity')
        validateIdentity(p.identity);
    if (kind === 'handoff_report')
        requireValue(string(p.summary, 4000));
    if (kind === 'close_ready' || kind === 'close_commit')
        requireValue(token(p.readyNonce));
}
/** Extension-owned asynchronous protocol. No host abort, shutdown, automatic retries or guessed pane targets. */
export class HandoffWorkflow {
    ctx;
    instanceId = randomUUID();
    jobs = new Map();
    worker;
    epoch = 0;
    disposed = false;
    timeout;
    constructor(ctx) {
        this.ctx = ctx;
        this.timeout = Number.isFinite(ctx.timeoutMs) ? Math.max(1, Math.min(120000, ctx.timeoutMs)) : 120000;
    }
    valid() { requireValue(!this.disposed); this.ctx.assertCurrent(); }
    background(work) { setImmediate(() => { if (!this.disposed)
        void work().catch(() => { }); }); }
    dispose() {
        this.disposed = true;
        for (const p of this.jobs.values()) {
            p.ended = true;
            clearTimeout(p.timer);
        }
        this.jobs.clear();
        if (this.worker)
            clearTimeout(this.worker.timer);
        this.worker = undefined;
    }
    async recover() {
        const { me, config } = await this.ctx.state();
        if (!me?.coordinator || !config.agents.some(a => pendingClose(a.closeJob)))
            return;
        await this.ctx.update(c => {
            for (const a of c.agents)
                if (pendingClose(a.closeJob)) {
                    a.closeJob = { ...a.closeJob, state: a.closeJob.state === 'closing' ? 'uncertain' : 'interrupted', reason: 'interrupted', updatedAt: new Date().toISOString() };
                }
        });
    }
    assertJob(p) {
        this.valid();
        requireValue(!p.ended && this.jobs.get(p.target.sessionId) === p && Date.now() < Date.parse(p.job.deadlineAt));
    }
    target(c, p) {
        this.assertJob(p);
        const a = c.agents.find(a => a.sessionId === p.target.sessionId && !a.coordinator);
        requireValue(a && a.closeJob?.jobId === p.job.jobId && pendingClose(a.closeJob) && a.port === p.target.port && a.projectDirectory === p.target.projectDirectory);
        return a;
    }
    async transition(p, state, reason) {
        await this.ctx.update(c => {
            const a = this.target(c, p);
            a.closeJob = { ...a.closeJob, state, updatedAt: new Date().toISOString(), ...(reason ? { reason } : {}) };
            p.job = { ...a.closeJob };
        }, () => this.assertJob(p));
    }
    async finish(p, state, reason) {
        if (p.ended)
            return;
        p.ended = true;
        clearTimeout(p.timer);
        // Keep the in-memory fence if persistence fails. Reload recovers durable intent.
        try {
            this.valid();
            await this.ctx.update(c => {
                const a = c.agents.find(a => a.sessionId === p.target.sessionId && !a.coordinator);
                requireValue(a?.closeJob?.jobId === p.job.jobId);
                a.closeJob = { ...a.closeJob, state, updatedAt: new Date().toISOString(), ...(reason ? { reason } : {}) };
            });
            this.jobs.delete(p.target.sessionId);
        }
        catch { /* Failure never authorizes pane closure or replay. */ }
    }
    async request(target) {
        this.valid();
        requireValue(this.ctx.provider);
        const existing = this.jobs.get(target.sessionId);
        if (existing) {
            await existing.initialized;
            return { ...existing.job };
        }
        requireValue(!fencedClose(target.closeJob) && this.jobs.size < 16);
        const now = Date.now();
        const job = { jobId: randomUUID(), state: 'requested', createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), deadlineAt: new Date(now + this.timeout).toISOString() };
        const p = { target: { ...target }, job, timer: undefined, processing: false, closing: false, ended: false };
        // Install the fence synchronously, before the first asynchronous config write.
        this.jobs.set(target.sessionId, p);
        try {
            p.initialized = this.ctx.update(c => {
                const a = c.agents.find(a => a.sessionId === target.sessionId && !a.coordinator);
                requireValue(a && !fencedClose(a.closeJob) && a.port === target.port && a.projectDirectory === target.projectDirectory && c.multiplexer === 'herdr');
                a.closeJob = { ...job };
            }, () => this.assertJob(p));
            await p.initialized;
        }
        catch (error) {
            this.jobs.delete(target.sessionId);
            throw error;
        }
        p.timer = setTimeout(() => { void this.finish(p, p.closing ? 'uncertain' : 'timed_out', 'timeout'); }, Math.max(0, Date.parse(job.deadlineAt) - Date.now()));
        this.background(async () => {
            try {
                this.assertJob(p);
                await this.ctx.send(target.sessionId, 'close_prepare', { jobId: job.jobId, deadlineAt: job.deadlineAt });
            }
            catch {
                await this.finish(p, 'failed', 'delivery_failed');
            }
        });
        return { ...job };
    }
    workerStarted() {
        this.epoch++;
        const w = this.worker;
        if (w && (w.saved || w.reporting)) {
            w.invalidated = true;
            w.readyNonce = undefined;
        }
    }
    workerSettled(successfulToolCallIds) {
        const w = this.worker;
        if (!w || !w.saved || w.reporting || w.invalidated || w.readyNonce || w.committed || this.ctx.busy() || w.epoch !== this.epoch || !w.toolCallId || !successfulToolCallIds.has(w.toolCallId))
            return;
        w.readyNonce = randomUUID();
        this.background(async () => {
            this.assertWorker(w);
            requireValue(!this.ctx.busy() && w.epoch === this.epoch && !w.invalidated);
            await this.ctx.send(w.coordinatorId, 'close_ready', { jobId: w.jobId, instanceId: this.instanceId, readyNonce: w.readyNonce });
        });
    }
    assertWorker(w) {
        this.valid();
        requireValue(this.worker === w && Date.now() < w.deadline);
    }
    get workerClosing() { return !!this.worker; }
    isClosing(sessionId) { return this.jobs.has(sessionId); }
    async report(jobId, summary, toolCallId) {
        requireValue(string(summary, 4000) && string(toolCallId, 256));
        const w = this.worker;
        requireValue(w && w.jobId === jobId && w.requested && !w.reporting && !w.saved && !w.invalidated);
        this.assertWorker(w);
        w.reporting = true;
        w.toolCallId = toolCallId;
        const reportEpoch = this.epoch;
        try {
            await this.ctx.send(w.coordinatorId, 'handoff_report', { jobId: w.jobId, instanceId: this.instanceId, summary });
            this.assertWorker(w);
            requireValue(!w.invalidated && this.epoch === reportEpoch);
            w.saved = true;
            w.epoch = reportEpoch;
            return { saved: true, closure: 'awaiting_turn_settlement' };
        }
        finally {
            w.reporting = false;
        }
    }
    async receive(kind, from, payload) {
        validateHandoffPayload(kind, payload);
        const { config, me } = await this.ctx.state();
        this.valid();
        const sender = config.agents.find(a => a.sessionId === from);
        const coordinatorMessage = ['close_prepare', 'close_request', 'close_commit'].includes(kind);
        requireValue(me && sender && (coordinatorMessage ? sender.coordinator && !me.coordinator : me.coordinator && !sender.coordinator));
        if (coordinatorMessage) {
            requireValue(this.ctx.provider && me.closeJob?.jobId === payload.jobId && pendingClose(me.closeJob));
            if (kind === 'close_prepare') {
                requireValue(!this.worker);
                const deadline = Date.parse(payload.deadlineAt);
                requireValue(deadline > Date.now() && deadline <= Date.now() + 120000);
                const w = { jobId: payload.jobId, coordinatorId: from, deadline, requested: false, saved: false, reporting: false, invalidated: false, epoch: this.epoch, committed: false, timer: undefined };
                this.worker = w;
                w.timer = setTimeout(() => { if (this.worker === w)
                    this.worker = undefined; }, deadline - Date.now());
                this.background(async () => {
                    try {
                        const identity = await this.ctx.provider.getIdentity();
                        validateIdentity(identity);
                        this.assertWorker(w);
                        requireValue(identity.sessionId === me.sessionId);
                        await this.ctx.send(from, 'close_identity', { jobId: w.jobId, instanceId: this.instanceId, identity });
                    }
                    catch {
                        if (this.worker === w) {
                            clearTimeout(w.timer);
                            this.worker = undefined;
                        }
                    }
                });
                return;
            }
            const w = this.worker;
            requireValue(w && w.jobId === payload.jobId && payload.instanceId === this.instanceId && from === w.coordinatorId);
            this.assertWorker(w);
            if (kind === 'close_request') {
                requireValue(!w.requested);
                w.requested = true;
                this.ctx.deliver(`Coordinator requests a handoff for owned-pane closure. Job ID: ${w.jobId}. Stop taking new assignments, summarize completed work, remaining work, validation and important files in intercom_report_handoff({jobId:"${w.jobId}",summary:...}) (public summary, max 4000 characters; no credentials or private reasoning), then finish this turn and wait. Do not exit, shut down, close a pane or start further work. Pane closure is asynchronous and is not proof all child processes terminated.`);
                return;
            }
            requireValue(w.saved && !w.reporting && !w.invalidated && !w.committed && !this.ctx.busy() && w.epoch === this.epoch && w.readyNonce === payload.readyNonce);
            w.committed = true;
            return;
        }
        const p = this.jobs.get(from);
        requireValue(p && p.job.jobId === payload.jobId);
        this.assertJob(p);
        if (kind === 'close_identity') {
            requireValue(!p.identity && !p.processing && p.job.state === 'requested');
            const identity = payload.identity;
            requireValue(identity.sessionId === from);
            p.identity = { ...identity };
            p.instanceId = payload.instanceId;
            p.processing = true;
            this.background(async () => {
                try {
                    await this.ctx.provider.inspect(p.identity, from, () => this.assertJob(p));
                    this.assertJob(p);
                    await this.transition(p, 'awaiting_handoff');
                    await this.ctx.send(from, 'close_request', { jobId: p.job.jobId, instanceId: p.instanceId });
                }
                catch {
                    await this.finish(p, 'failed', 'identity_failed');
                }
                finally {
                    p.processing = false;
                }
            });
            return;
        }
        requireValue(payload.instanceId === p.instanceId);
        if (kind === 'handoff_report') {
            requireValue(p.job.state === 'awaiting_handoff' || p.job.state === 'awaiting_settlement');
            try {
                await this.ctx.update(c => {
                    const a = this.target(c, p);
                    if (a.handoff?.jobId === p.job.jobId)
                        requireValue(a.handoff.summary === payload.summary);
                    else
                        a.handoff = { version: 1, jobId: p.job.jobId, summary: payload.summary, updatedAt: new Date().toISOString() };
                    a.closeJob = { ...a.closeJob, state: 'awaiting_settlement', updatedAt: new Date().toISOString() };
                }, () => this.assertJob(p));
                this.assertJob(p);
                p.job = { ...p.job, state: 'awaiting_settlement' };
            }
            catch (error) {
                await this.finish(p, 'failed', 'save_failed');
                throw error;
            }
            return;
        }
        requireValue(kind === 'close_ready' && p.job.state === 'awaiting_settlement' && !p.closing && !p.processing);
        p.processing = true;
        this.background(async () => {
            let failure = 'identity_failed';
            try {
                await this.transition(p, 'ready');
                await this.ctx.provider.inspect(p.identity, from, () => this.assertJob(p));
                this.assertJob(p);
                failure = 'save_failed';
                await this.transition(p, 'closing');
                this.assertJob(p);
                failure = 'close_failed';
                let commitAttempted = false;
                const result = await this.ctx.provider.close(p.identity, from, () => this.assertJob(p), async () => {
                    this.assertJob(p);
                    requireValue(!commitAttempted);
                    commitAttempted = true;
                    failure = 'commit_rejected';
                    await this.ctx.send(from, 'close_commit', { jobId: p.job.jobId, instanceId: p.instanceId, readyNonce: payload.readyNonce });
                    this.assertJob(p);
                    p.closing = true;
                    failure = 'close_failed';
                });
                this.assertJob(p);
                requireValue(p.closing);
                await this.finish(p, result.paneClosed && result.workerExited ? 'closed' : 'uncertain', result.paneClosed && result.workerExited ? undefined : 'close_unverified');
            }
            catch {
                await this.finish(p, p.closing ? 'uncertain' : 'failed', failure);
            }
        });
    }
}
//# sourceMappingURL=handoff.js.map