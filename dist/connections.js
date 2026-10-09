import http from 'node:http';
import { setMaxListeners } from 'node:events';
const MAX_BODY = 1024;
const MAX_AGE = 30000;
const MAX_WORKERS = 256;
function bounded(value, fallback, maximum) {
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.min(maximum, Math.floor(value))) : fallback;
}
function unknown(sessionId, reason = 'not_checked', checkedAt = null) {
    return { sessionId, state: 'unknown', checkedAt, reason };
}
/** Read-only best-effort endpoint identity, never evidence of process termination. */
export function probeWorker(agent, options = {}) {
    if (options.signal?.aborted)
        return Promise.resolve(unknown(agent.sessionId, 'aborted'));
    if (typeof agent.sessionId !== 'string' || !agent.sessionId.trim() || agent.sessionId.length > 256 || !Number.isInteger(agent.port) || agent.port < 1 || agent.port > 65535) {
        return Promise.resolve(unknown(agent.sessionId, 'invalid_input'));
    }
    const timeout = bounded(options.timeoutMs, 750, 4000);
    return new Promise(resolve => {
        let settled = false;
        let request;
        let response;
        let timer;
        const finish = (state, reason) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            options.signal?.removeEventListener('abort', abort);
            response?.destroy();
            request?.destroy();
            resolve(options.signal?.aborted
                ? unknown(agent.sessionId, 'aborted', new Date().toISOString())
                : { sessionId: agent.sessionId, state, reason, checkedAt: new Date().toISOString() });
        };
        const abort = () => finish('unknown', 'aborted');
        const error = (error) => {
            if (error.code === 'ECONNREFUSED')
                finish('disconnected', 'refused');
            else if (error.code === 'ETIMEDOUT')
                finish('disconnected', 'timeout');
            else
                finish('unknown', 'network_error');
        };
        options.signal?.addEventListener('abort', abort, { once: true });
        // Wall-clock deadline covers connect, headers AND the entire body, including
        // slow-drip responses. Native HTTP ignores proxy env; no redirects/retries.
        timer = setTimeout(() => finish('disconnected', 'timeout'), timeout);
        try {
            request = http.get({ hostname: '127.0.0.1', port: agent.port, path: '/intercom/health', agent: false, maxHeaderSize: 4096 }, res => {
                response = res;
                res.on('error', error);
                if (settled) {
                    res.destroy();
                    return;
                }
                if (res.statusCode !== 200) {
                    finish('unknown', res.statusCode === 404 ? 'legacy' : 'http_error');
                    return;
                }
                let bytes = 0;
                const chunks = [];
                res.on('data', (chunk) => {
                    bytes += chunk.length;
                    if (bytes > MAX_BODY) {
                        finish('unknown', 'oversize');
                        return;
                    }
                    chunks.push(chunk);
                });
                res.on('aborted', () => finish('unknown', 'network_error'));
                res.on('end', () => {
                    if (settled)
                        return;
                    let body;
                    try {
                        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                    }
                    catch {
                        finish('unknown', 'malformed');
                        return;
                    }
                    if (!body || typeof body !== 'object' || Array.isArray(body) ||
                        typeof body.version !== 'number' ||
                        typeof body.sessionId !== 'string' ||
                        !body.sessionId.trim() || body.sessionId.length > 256) {
                        finish('unknown', 'malformed');
                        return;
                    }
                    const identity = body;
                    if (identity.version !== 1)
                        finish('unknown', 'unsupported_version');
                    else if (identity.sessionId !== agent.sessionId)
                        finish('disconnected', 'identity_mismatch');
                    else
                        finish('connected', 'verified');
                });
            });
            request.on('error', error);
        }
        catch {
            finish('unknown', 'network_error');
        }
    });
}
/** One bounded concurrent pass; cancellation/budget exhaustion never implies disconnection. */
export async function probeWorkers(agents, options = {}) {
    const boundedAgents = agents.slice(0, MAX_WORKERS);
    const results = boundedAgents.map(agent => unknown(agent.sessionId));
    const controller = new AbortController();
    setMaxListeners(17, controller.signal);
    const abort = () => controller.abort();
    const budget = bounded(options.budgetMs, 4000, 4000);
    const concurrency = bounded(options.concurrency, 16, 16);
    if (options.signal?.aborted)
        return boundedAgents.map(agent => unknown(agent.sessionId, 'aborted'));
    options.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, budget);
    let next = 0;
    try {
        await Promise.all(Array.from({ length: Math.min(concurrency, boundedAgents.length) }, async () => {
            while (!controller.signal.aborted && next < boundedAgents.length) {
                const index = next++;
                results[index] = await probeWorker(boundedAgents[index], { signal: controller.signal, timeoutMs: options.timeoutMs });
            }
        }));
        return results;
    }
    finally {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', abort);
        controller.abort();
    }
}
/** Health expires: an old failure must not indefinitely demote a configured worker. */
export function currentConnection(sessionId, connections, now = Date.now()) {
    const connection = connections?.find(item => item.sessionId === sessionId);
    if (!connection)
        return unknown(sessionId);
    if (connection.checkedAt === null)
        return unknown(sessionId, connection.state === 'unknown' ? connection.reason : 'not_checked');
    const checked = Date.parse(connection.checkedAt);
    if (!Number.isFinite(checked) || !Number.isFinite(now) || checked > now || now - checked > MAX_AGE)
        return unknown(sessionId, 'stale', connection.checkedAt);
    return { ...connection };
}
/** Stable disconnected-last copy; does not mutate configuration or observations. */
export function sortWorkersByConnection(workers, connections, now = Date.now()) {
    const current = [], disconnected = [];
    for (const worker of workers) {
        (currentConnection(worker.sessionId, connections, now).state === 'disconnected' ? disconnected : current).push(worker);
    }
    return [...current, ...disconnected];
}
//# sourceMappingURL=connections.js.map