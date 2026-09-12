import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { MANUAL_STREAM_HEADER, MANUAL_STREAM_PROTOCOL } from '@atlas/manual-service/response';

export const MANUAL_TRANSPORT_LIMITS = Object.freeze({ requestBytes: 2 * 1024 * 1024,
  jsonResponseBytes: 2 * 1024 * 1024, imageResponseBytes: 4 * 1024 * 1024, timeoutMs: 210000 });
const VERSION = 'atlas-manual-private-v1';
const PREFIX = 'x-atlas-manual-';
const BOUND_HEADERS = ['cookie', 'x-atlas-csrf', 'origin', 'content-type', `${PREFIX}version`,
  `${PREFIX}timestamp`, `${PREFIX}nonce`, `${PREFIX}signature`];
const PUBLIC_BASE = 'https://manual-route.invalid';
const sha256 = value => createHash('sha256').update(value).digest('hex');

export class ManualTransportError extends Error {
  constructor(status, code) { super(code); this.name = 'ManualTransportError'; this.status = status; this.code = code; }
}
function requireTransport(ok, status, code) { if (!ok) throw new ManualTransportError(status, code); }
function secret(key) {
  requireTransport(typeof key === 'string' || Buffer.isBuffer(key), 500, 'MANUAL_TRANSPORT_CONFIG_INVALID');
  const bytes = Buffer.from(key);
  requireTransport(bytes.length >= 32 && bytes.length <= 512, 500, 'MANUAL_TRANSPORT_CONFIG_INVALID');
  return bytes;
}
function canonicalOrigin(value, { privateOrigin = false } = {}) {
  let url;
  try { url = new URL(value); } catch { throw new ManualTransportError(500, 'MANUAL_TRANSPORT_CONFIG_INVALID'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  requireTransport(!url.username && !url.password && url.pathname === '/' && !url.search && !url.hash
    && (url.protocol === 'https:' || !privateOrigin && url.protocol === 'http:' && local),
  500, 'MANUAL_TRANSPORT_CONFIG_INVALID');
  return url.origin;
}
function header(req, name, max = 2048) {
  const value = req.headers?.[name] ?? '';
  requireTransport(typeof value === 'string' && value.length <= max && !/[\r\n\0]/.test(value),
    400, 'MANUAL_TRANSPORT_HEADER_INVALID');
  return value;
}

/** Only the new card surfaces are transportable. Keep the exact path/query in
 * the signature; encoded path separators, dot normalization and absolute URLs
 * are never interpreted as an alternate route by the private host. */
export function isManualServicePath(value) {
  if (typeof value !== 'string' || value.length > 4096 || !value.startsWith('/') || value.startsWith('//')
    || /[\\\s\0#]/.test(value)) return false;
  let url;
  try { url = new URL(value, PUBLIC_BASE); } catch { return false; }
  return url.origin === PUBLIC_BASE && url.pathname + url.search === value && !url.pathname.includes('%')
    && /^\/api\/staff\/(?:manual|manual-intake|manual-connected)\/cards(?:\/[A-Za-z0-9-]+)*$/.test(url.pathname);
}
function requestParts(req, bytes, timestamp, nonce) {
  requireTransport(isManualServicePath(req.url), 404, 'NOT_FOUND');
  requireTransport(req.method === 'GET' || req.method === 'POST', 405, 'MANUAL_METHOD_NOT_ALLOWED');
  return [VERSION, req.method, req.url, sha256(bytes), sha256(header(req, 'cookie', 16384)),
    sha256(header(req, 'x-atlas-csrf', 512)), header(req, 'origin'), header(req, 'content-type', 256), timestamp, nonce];
}
function signature(key, parts) { return createHmac('sha256', key).update(JSON.stringify(parts)).digest('hex'); }
function assertRequestShape(req, bytes, origin) {
  requireTransport(bytes.length <= MANUAL_TRANSPORT_LIMITS.requestBytes, 413, 'REQUEST_TOO_LARGE');
  if (req.method === 'GET') requireTransport(bytes.length === 0, 400, 'MANUAL_REQUEST_INVALID');
  else {
    requireTransport(/^application\/json(?:\s*;|$)/i.test(header(req, 'content-type', 256)), 415, 'MANUAL_JSON_REQUIRED');
    requireTransport(header(req, 'origin') && (!origin || header(req, 'origin') === origin)
      && header(req, 'x-atlas-csrf', 512), 403, 'CSRF_REQUIRED');
  }
}

/** Atomic consume is required: shared hosts should inject a shared implementation
 * exposing consume(nonce, expiresAtMilliseconds), returning true only on a new
 * atomic claim. This bounded default is for a
 * single process. At capacity it refuses admission instead of dropping live
 * nonces. Expiry spans the entire timestamp acceptance window. */
export function createPrivateManualNonceStore({ capacity = 10000, now = Date.now } = {}) {
  requireTransport(Number.isInteger(capacity) && capacity > 0 && typeof now === 'function', 500, 'MANUAL_TRANSPORT_CONFIG_INVALID');
  const nonces = new Map();
  return Object.freeze({ consume(nonce, expiresAt) {
    const current = now();
    for (const [key, expiry] of nonces) if (expiry < current) nonces.delete(key);
    if (nonces.has(nonce)) return false;
    requireTransport(nonces.size < capacity, 503, 'MANUAL_REPLAY_STORE_FULL');
    nonces.set(nonce, expiresAt); return true;
  } });
}

/** Validate the host configuration before a listener is started and retain a
 * private copy of the signing key. Each request still consumes a fresh nonce. */
export function createPrivateManualRequestVerifier({ key, origin, nonceStore = createPrivateManualNonceStore(),
  now = Date.now, maxSkewMs = 60000 }) {
  const config = { key: secret(key), origin: canonicalOrigin(origin), nonceStore, now, maxSkewMs };
  requireTransport(typeof nonceStore?.consume === 'function' && typeof now === 'function'
    && Number.isInteger(maxSkewMs) && maxSkewMs > 0 && maxSkewMs <= 120000, 500, 'MANUAL_TRANSPORT_CONFIG_INVALID');
  return req => assertPrivateManualRequest(req, config);
}

/** Verify once, before JSON parsing or invoking the connected handler. No staff
 * principal is accepted here. The handler must still use DurableStaffBoundary.
 * req.rawBody must be the exact bounded bytes received on the private socket. */
export async function assertPrivateManualRequest(req, { key, origin, nonceStore, now = Date.now, maxSkewMs = 60000 }) {
  const signingKey = secret(key), admittedOrigin = canonicalOrigin(origin);
  requireTransport(typeof nonceStore?.consume === 'function' && typeof now === 'function'
    && Number.isInteger(maxSkewMs) && maxSkewMs > 0 && maxSkewMs <= 120000, 500, 'MANUAL_TRANSPORT_CONFIG_INVALID');
  requireTransport(Buffer.isBuffer(req.rawBody), 400, 'MANUAL_RAW_BODY_REQUIRED');
  if (Array.isArray(req.rawHeaders)) {
    const seen = new Set();
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i].toLowerCase();
      if (!BOUND_HEADERS.includes(name)) continue;
      requireTransport(!seen.has(name), 400, 'MANUAL_TRANSPORT_HEADER_INVALID'); seen.add(name);
    }
  }
  const timestamp = header(req, `${PREFIX}timestamp`, 16), nonce = header(req, `${PREFIX}nonce`, 64);
  const provided = header(req, `${PREFIX}signature`, 64);
  requireTransport(header(req, `${PREFIX}version`) === VERSION && /^\d{13}$/.test(timestamp)
    && /^[a-f0-9]{48}$/.test(nonce) && /^[a-f0-9]{64}$/.test(provided), 401, 'MANUAL_PRIVATE_SIGNATURE_REQUIRED');
  const parts = requestParts(req, req.rawBody, timestamp, nonce);
  assertRequestShape(req, req.rawBody, admittedOrigin);
  requireTransport(timingSafeEqual(Buffer.from(signature(signingKey, parts), 'hex'), Buffer.from(provided, 'hex')),
    401, 'MANUAL_PRIVATE_SIGNATURE_INVALID');
  const current = now(), sent = Number(timestamp);
  requireTransport(Number.isFinite(current) && Math.abs(current - sent) <= maxSkewMs, 401, 'MANUAL_PRIVATE_REQUEST_EXPIRED');
  requireTransport(await nonceStore.consume(nonce, sent + maxSkewMs) === true, 409, 'MANUAL_PRIVATE_REQUEST_REPLAYED');
  return true;
}

function requestBytes(req) {
  if (req.method === 'GET') {
    requireTransport(req.body === undefined || req.body === null || Buffer.isBuffer(req.body) && req.body.length === 0,
      400, 'MANUAL_REQUEST_INVALID');
    return Buffer.alloc(0);
  }
  let bytes;
  try {
    bytes = Buffer.isBuffer(req.body) ? Buffer.from(req.body)
      : typeof req.body === 'string' ? Buffer.from(req.body) : Buffer.from(JSON.stringify(req.body ?? {}));
  } catch { throw new ManualTransportError(400, 'MANUAL_JSON_INVALID'); }
  requireTransport(bytes.length <= MANUAL_TRANSPORT_LIMITS.requestBytes, 413, 'REQUEST_TOO_LARGE');
  try { JSON.parse(bytes.toString('utf8')); } catch { throw new ManualTransportError(400, 'MANUAL_JSON_INVALID'); }
  return bytes;
}
export function manualResponsePolicy(path, contentType) {
  if (/^application\/json(?:\s*;|$)/i.test(contentType)) return {
    limit: MANUAL_TRANSPORT_LIMITS.jsonResponseBytes, overflow: 'MANUAL_SERVICE_RESPONSE_TOO_LARGE' };
  requireTransport(/\/(?:images|preview-image)\//.test(path)
    && /^image\/(?:png|jpeg|webp)$/.test(contentType), 502, 'MANUAL_SERVICE_RESPONSE_INVALID');
  return { limit: MANUAL_TRANSPORT_LIMITS.imageResponseBytes, overflow: 'MANUAL_IMAGE_DIRECT_REQUIRED' };
}
async function responseBytes(response, policy, signal) {
  const size = response.headers.get('content-length');
  if (size !== null) requireTransport(/^\d+$/.test(size) && Number(size) <= policy.limit,
    policy.overflow === 'MANUAL_IMAGE_DIRECT_REQUIRED' ? 413 : 502, policy.overflow);
  requireTransport(response.body?.getReader, 502, 'MANUAL_SERVICE_RESPONSE_INVALID');
  const reader = response.body.getReader(), chunks = []; let length = 0;
  const abort = () => { reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    for (;;) {
      requireTransport(!signal.aborted, 503, 'MANUAL_SERVICE_UNAVAILABLE');
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      requireTransport(length <= policy.limit, policy.overflow === 'MANUAL_IMAGE_DIRECT_REQUIRED' ? 413 : 502, policy.overflow);
      chunks.push(Buffer.from(value));
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { signal.removeEventListener('abort', abort); reader.releaseLock(); }
  return Buffer.concat(chunks, length);
}
export function manualPrivateHeaders(res) {
  res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
}
export function sendManualTransportError(res, error) {
  if (res.destroyed || res.writableEnded) return;
  manualPrivateHeaders(res);
  const known = error instanceof ManualTransportError;
  res.status(known ? error.status : 503).json({ error: known ? error.code : 'MANUAL_SERVICE_UNAVAILABLE' });
}

/** Vercel-side adapter. TLS is mandatory; credentials are sent only to this
 * fixed origin. Redirects, client-supplied signing headers and actor claims are
 * never forwarded. A timeout is an uncertain result: callers retain their exact
 * action/upload request IDs and reconcile through the durable service. */
export function createManualServiceProxy({ origin, key, fetchImpl = globalThis.fetch,
  timeoutMs = MANUAL_TRANSPORT_LIMITS.timeoutMs, heartbeatMs = 15000 }) {
  const privateOrigin = canonicalOrigin(origin, { privateOrigin: true }), signingKey = secret(key);
  requireTransport(typeof fetchImpl === 'function' && Number.isInteger(timeoutMs) && timeoutMs > 0
    && timeoutMs <= MANUAL_TRANSPORT_LIMITS.timeoutMs
    && Number.isInteger(heartbeatMs) && heartbeatMs > 0 && heartbeatMs <= 15000, 500, 'MANUAL_TRANSPORT_CONFIG_INVALID');
  return async (req, res) => {
    if (!isManualServicePath(req.url)) return false;
    const controller = new AbortController(); let timer, heartbeat, streamed = false, closed = false, rejectDisconnected;
    const stopHeartbeat = () => { clearInterval(heartbeat); heartbeat = undefined; };
    const disconnected = () => {
      closed = true; stopHeartbeat(); controller.abort();
      rejectDisconnected?.(new ManualTransportError(503, 'MANUAL_SERVICE_UNAVAILABLE'));
    };
    const finish = (status, contentType, bytes) => {
      stopHeartbeat();
      if (closed || res.destroyed || res.writableEnded) return;
      if (streamed) {
        let body;
        try { body = JSON.parse(bytes.toString('utf8')); }
        catch { throw new ManualTransportError(502, 'MANUAL_SERVICE_RESPONSE_INVALID'); }
        requireTransport(body && typeof body === 'object' && !Array.isArray(body), 502, 'MANUAL_SERVICE_RESPONSE_INVALID');
        res.end(JSON.stringify({ protocol: MANUAL_STREAM_PROTOCOL, status, body }));
      } else {
        manualPrivateHeaders(res); res.setHeader('Content-Type', contentType);
        if (contentType.startsWith('image/')) res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        res.status(status).send(bytes);
      }
    };
    try {
      const bytes = requestBytes(req);
      assertRequestShape(req, bytes);
      const timestamp = String(Date.now()), nonce = randomBytes(24).toString('hex');
      const parts = requestParts(req, bytes, timestamp, nonce);
      const headers = { [`${PREFIX}version`]: VERSION, [`${PREFIX}timestamp`]: timestamp,
        [`${PREFIX}nonce`]: nonce, [`${PREFIX}signature`]: signature(signingKey, parts) };
      for (const name of ['cookie', 'x-atlas-csrf', 'origin', 'content-type']) {
        const value = header(req, name, name === 'cookie' ? 16384 : 2048); if (value) headers[name] = value;
      }
      req.once?.('aborted', disconnected); res.once?.('close', disconnected);
      const disconnectedResult = new Promise((_, reject) => { rejectDisconnected = reject; });
      // The Vercel wrapper has already checked ingress, ordinary staff auth and
      // CSRF. Delay the first heartbeat so fast responses retain their ordinary
      // HTTP status. It never proves dispatch, completion or human approval.
      if (req.method === 'POST') {
        heartbeat = setInterval(() => {
          if (closed || res.destroyed || res.writableEnded) { disconnected(); return; }
          try {
            if (!streamed) {
              res.statusCode = 200;
              manualPrivateHeaders(res);
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.setHeader(MANUAL_STREAM_HEADER, MANUAL_STREAM_PROTOCOL);
              res.setHeader('Cache-Control', 'private, no-store, max-age=0, no-transform');
              res.setHeader('X-Accel-Buffering', 'no');
              streamed = true;
            }
            res.write('\n'); res.flush?.();
          } catch { disconnected(); }
        }, heartbeatMs);
        heartbeat.unref?.();
      }
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => { reject(new ManualTransportError(504, 'MANUAL_SERVICE_TIMEOUT')); controller.abort(); }, timeoutMs);
      });
      const work = async () => {
        const response = await fetchImpl(privateOrigin + req.url, { method: req.method, headers,
          ...(req.method === 'POST' ? { body: bytes } : {}), redirect: 'manual', signal: controller.signal });
        requireTransport(!response.redirected && response.status >= 200 && response.status < 600
          && !(response.status >= 300 && response.status < 400), 502, 'MANUAL_SERVICE_REDIRECT_REFUSED');
        const contentType = response.headers.get('content-type') ?? '';
        const responseBody = await responseBytes(response, manualResponsePolicy(req.url, contentType), controller.signal);
        return { status: response.status, contentType, bytes: responseBody };
      };
      const result = await Promise.race([work(), timeout, disconnectedResult]);
      finish(result.status, result.contentType, result.bytes);
    } catch (error) {
      controller.abort();
      if (streamed) finish(error instanceof ManualTransportError ? error.status : 503,
        'application/json', Buffer.from(JSON.stringify({ error: error instanceof ManualTransportError ? error.code : 'MANUAL_SERVICE_UNAVAILABLE' })));
      else if (!closed) sendManualTransportError(res, error);
    }
    finally {
      clearTimeout(timer); stopHeartbeat(); req.removeListener?.('aborted', disconnected); res.removeListener?.('close', disconnected);
    }
    return true;
  };
}
