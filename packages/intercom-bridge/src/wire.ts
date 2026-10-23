/**
 * Minimal, self-contained copy of the pi-intercom V1 wire contract (README "Config and wire
 * contracts"). Kept dependency-free so the bridge can be split out of this repository; the
 * conformance test checks every envelope the bridge emits against the extension's own validator.
 */
import http from 'node:http';

export const BODY_LIMIT = 64 * 1024;
export const RECEIPT_TIMEOUT = 5000;
export const MESSAGE_LIMIT = 48000;
export const SUMMARY_LIMIT = 2000;
export const KINDS = ['message', 'report', 'registration', 'status', 'request_status', 'reload', 'stop', 'close',
  'close_prepare', 'close_identity', 'close_request', 'handoff_report', 'close_ready', 'close_commit'] as const;
export type Kind = typeof KINDS[number];
export type ReportStatus = 'blocked' | 'needs_decision' | 'ready_for_review' | 'clear';
export interface Envelope {
  version: 1;
  kind: Kind;
  from: string;
  to: string;
  payload: Record<string, unknown>;
  correlationId?: string;
}

export function fail(message: string): never { throw new Error(`PiIntercomBridge: ${message}`); }
function text(value: unknown, field: string, max: number): void {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`invalid ${field}`);
}

/** Structural validation of an incoming envelope; kind-specific semantics are enforced by the bridge. */
export function envelope(value: unknown): Envelope {
  const m = value as Envelope;
  if (!m || typeof m !== 'object' || m.version !== 1 || !(KINDS as readonly string[]).includes(m.kind)) fail('invalid wire schema/version/kind');
  text(m.from, 'sender sessionId', 256); text(m.to, 'recipient sessionId', 256);
  if (m.correlationId !== undefined && (typeof m.correlationId !== 'string' || !/^[a-zA-Z0-9-]{1,128}$/.test(m.correlationId))) fail('invalid correlation ID');
  if (!m.payload || Array.isArray(m.payload) || typeof m.payload !== 'object') fail('invalid payload');
  if (m.kind === 'message') text(m.payload.message, 'message', MESSAGE_LIMIT);
  return m;
}

/** Truncate to a wire limit, marking the cut so the reader knows text is missing. */
export function clip(value: string, max: number, note = '\n[truncated by intercom-bridge]'): string {
  return value.length <= max ? value : value.slice(0, Math.max(0, max - note.length)) + note;
}

export interface Endpoint { port: number; close(): Promise<void> }
export type Health = () => { version: 1; sessionId: string };

/** Loopback-only receiver: POST /intercom (202 on acceptance) and GET /intercom/health. */
export async function listen(preferred: number | undefined, accept: (message: Envelope) => Promise<void>, health: Health): Promise<Endpoint> {
  const server = http.createServer(async (req, res) => {
    const reply = (status: number, data: unknown) => { if (!res.destroyed) { res.writeHead(status, { 'content-type': 'application/json', connection: 'close' }); res.end(JSON.stringify(data)); } };
    if (req.method === 'GET' && req.url === '/intercom/health') { reply(200, health()); req.resume(); return; }
    if (req.method !== 'POST' || req.url !== '/intercom') { reply(404, { error: 'POST /intercom required' }); req.resume(); return; }
    let bytes = 0;
    const chunks: Buffer[] = [];
    try {
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > BODY_LIMIT) { reply(413, { error: 'body exceeds 64 KiB' }); return; }
        chunks.push(Buffer.from(chunk));
      }
      await accept(envelope(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
      reply(202, { accepted: true });
    } catch (error) { reply(400, { error: String(error) }); }
  });
  server.requestTimeout = RECEIPT_TIMEOUT;
  server.headersTimeout = RECEIPT_TIMEOUT;
  server.setTimeout(RECEIPT_TIMEOUT, socket => socket.destroy());
  const bind = (p: number) => new Promise<void>((resolve, reject) => {
    const error = (e: Error) => { server.off('listening', ready); reject(e); };
    const ready = () => { server.off('error', error); resolve(); };
    server.once('error', error); server.once('listening', ready); server.listen(p, '127.0.0.1');
  });
  try { await bind(preferred ?? 0); }
  catch (e) { if (preferred && (e as NodeJS.ErrnoException).code === 'EADDRINUSE') await bind(0); else throw e; }
  const address = server.address();
  if (!address || typeof address === 'string') fail('listener has no port');
  return { port: address.port, close: () => new Promise((resolve, reject) => { server.close(e => e ? reject(e) : resolve()); server.closeAllConnections(); }) };
}

/** One attempt, 5 s receipt deadline, no retries (same delivery semantics as the extension). */
export async function send(destinationPort: number, message: Envelope, timeout = RECEIPT_TIMEOUT): Promise<void> {
  const body = JSON.stringify(message);
  if (Buffer.byteLength(body) > BODY_LIMIT) fail('message exceeds 64 KiB');
  await new Promise<void>((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: destinationPort, path: '/intercom', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, res => {
      let result = '';
      res.on('data', chunk => { result += chunk; if (result.length > BODY_LIMIT) req.destroy(new Error('oversized acknowledgment')); });
      res.on('error', reject);
      res.on('end', () => {
        try {
          if (res.statusCode !== 202 || JSON.parse(result).accepted !== true) fail(`receipt rejected (${res.statusCode}): ${result.slice(0, 500)}`);
          resolve();
        } catch (e) { reject(e); }
      });
    });
    const timer = setTimeout(() => req.destroy(new Error('PiIntercomBridge: receipt timeout; outcome unknown; no automatic retry')), timeout);
    req.on('close', () => clearTimeout(timer)); req.on('error', reject); req.end(body);
  });
}
