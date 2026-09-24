import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// A transport admission signature is never customer authentication. Private
// handlers revalidate the forwarded session and exact deployment in PostgreSQL.
const PREFIX = '/internal/customer-service/v1/';
const OPERATIONS = new Set(['intake-sign', 'intake-complete', 'commerce-checkout', 'commerce-quote', 'commerce-pay', 'commerce-reconcile', 'dealer-locations']);
const REQUEST_LIMIT = 131072, RESPONSE_LIMIT = 2 * 1024 * 1024;
export class CustomerServiceError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
function check(ok, status = 503, code = 'CUSTOMER_SERVICE_UNAVAILABLE') { if (!ok) throw new CustomerServiceError(status, code); }
function validKey(key) { check(Buffer.isBuffer(key) && key.length === 32, 503, 'CUSTOMER_SERVICE_CONFIGURATION_REQUIRED'); return key; }
function signature(key, path, timestamp, nonce, bytes) {
  return createHmac('sha256', key).update(`atlas-customer-service-v1\nPOST\n${path}\n${timestamp}\n${nonce}\n${createHash('sha256').update(bytes).digest('hex')}`).digest('hex');
}
function validEnvelope(value, operation) {
  check(value && Object.getPrototypeOf(value) === Object.prototype && value.input && Object.getPrototypeOf(value.input) === Object.prototype, 400, 'INVALID_REQUEST');
  const fields = operation === 'dealer-locations' ? ['input'] : ['input', 'authority'];
  check(Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key)), 400, 'INVALID_REQUEST');
  if (operation !== 'dealer-locations') {
    const a = value.authority;
    check(a && Object.keys(a).length === 3 && ['binding', 'sessionHash', 'browserHash'].every(key => Object.hasOwn(a, key))
      && /^[a-f0-9]{64}$/.test(a.sessionHash) && /^[a-f0-9]{64}$/.test(a.browserHash) && a.binding && typeof a.binding === 'object' && !Array.isArray(a.binding), 401, 'SIGN_IN_REQUIRED');
  }
  return value;
}
async function readResponse(response) {
  const reader = response.body?.getReader(); check(reader);
  let length = 0; const parts = [];
  try {
    for (;;) { const next = await reader.read(); if (next.done) break; length += next.value.length; check(length <= RESPONSE_LIMIT); parts.push(Buffer.from(next.value)); }
    return JSON.parse(Buffer.concat(parts, length).toString('utf8'));
  } catch (error) { if (error instanceof CustomerServiceError) throw error; throw new CustomerServiceError(503, 'CUSTOMER_SERVICE_UNAVAILABLE'); }
  finally { await reader.cancel().catch(() => {}); }
}
export function createCustomerServiceClient({ url, key, fetchImpl = fetch, allowLoopbackForTests = false, now = Date.now }) {
  let base; try { base = new URL(url); } catch { check(false, 503, 'CUSTOMER_SERVICE_CONFIGURATION_REQUIRED'); }
  check(base.origin === url && !base.username && !base.password && (base.protocol === 'https:'
    || allowLoopbackForTests && base.protocol === 'http:' && base.hostname === '127.0.0.1'), 503, 'CUSTOMER_SERVICE_CONFIGURATION_REQUIRED');
  key = Buffer.from(validKey(key));
  return Object.freeze({ async call(operation, envelope) {
    check(OPERATIONS.has(operation), 400, 'INVALID_REQUEST'); validEnvelope(envelope, operation);
    const bytes = Buffer.from(JSON.stringify(envelope)); check(bytes.length <= REQUEST_LIMIT, 413, 'REQUEST_TOO_LARGE');
    const path = PREFIX + operation, timestamp = String(now()), nonce = randomBytes(24).toString('hex');
    let response;
    // Leave the customer API time to return an explicit recovery response before
    // the hosting function and public external-rewrite deadlines expire.
    try { response = await fetchImpl(base.origin + path, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(95000),
      headers: { 'Content-Type': 'application/json', 'X-Atlas-Customer-Time': timestamp, 'X-Atlas-Customer-Nonce': nonce,
        'X-Atlas-Customer-Signature': signature(key, path, timestamp, nonce, bytes) }, body: bytes }); }
    catch { throw new CustomerServiceError(503, 'CUSTOMER_SERVICE_UNAVAILABLE'); }
    const result = await readResponse(response);
    if (!response.ok) throw new CustomerServiceError(response.status >= 400 && response.status <= 599 ? response.status : 503,
      /^[A-Z][A-Z0-9_]{2,90}$/.test(result?.error) ? result.error : 'CUSTOMER_SERVICE_UNAVAILABLE');
    check(result && typeof result === 'object' && !Array.isArray(result)); return result;
  } });
}

// The default nonce store is for one private serving process. A multi-process
// deployment must inject an atomic shared claimNonce implementation.
export function createCustomerServiceHandler({ key, directoryKey = null, handlers, claimNonce, now = Date.now }) {
  key = Buffer.from(validKey(key)); if (directoryKey) directoryKey = Buffer.from(validKey(directoryKey));
  check(!directoryKey || !key.equals(directoryKey), 503, 'CUSTOMER_SERVICE_CONFIGURATION_REQUIRED');
  check(handlers && typeof handlers === 'object', 503, 'CUSTOMER_SERVICE_CONFIGURATION_REQUIRED');
  const nonces = new Map();
  claimNonce ??= async (nonce, expires) => {
    for (const [value, expiry] of nonces) if (expiry < now()) nonces.delete(value);
    if (nonces.has(nonce) || nonces.size >= 10000) return false; nonces.set(nonce, expires); return true;
  };
  return async (req, res) => {
    if (!req.url?.startsWith(PREFIX)) return false;
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Content-Type', 'application/json; charset=utf-8');
    try {
      const operation = req.url.slice(PREFIX.length);
      check(OPERATIONS.has(operation), 404, 'NOT_FOUND'); check(req.method === 'POST', 405, 'METHOD_NOT_ALLOWED');
      check(/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? ''), 400, 'INVALID_REQUEST');
      const timestamp = req.headers['x-atlas-customer-time'], nonce = req.headers['x-atlas-customer-nonce'], supplied = req.headers['x-atlas-customer-signature'];
      check(typeof timestamp === 'string' && /^\d{13}$/.test(timestamp) && Math.abs(now() - Number(timestamp)) <= 60000
        && typeof nonce === 'string' && /^[a-f0-9]{48}$/.test(nonce) && typeof supplied === 'string' && /^[a-f0-9]{64}$/.test(supplied), 401, 'CUSTOMER_SERVICE_SIGNATURE_REQUIRED');
      const declared = req.headers['content-length'];
      check(declared === undefined || /^\d+$/.test(declared) && Number(declared) <= REQUEST_LIMIT, 413, 'REQUEST_TOO_LARGE');
      const chunks = []; let length = 0;
      for await (const chunk of req) { length += chunk.length; check(length <= REQUEST_LIMIT, 413, 'REQUEST_TOO_LARGE'); chunks.push(chunk); }
      const bytes = Buffer.concat(chunks, length), provided = Buffer.from(supplied, 'hex');
      const signedByService = timingSafeEqual(provided, Buffer.from(signature(key, req.url, timestamp, nonce, bytes), 'hex'));
      const signedByDirectory = directoryKey && operation === 'dealer-locations' && timingSafeEqual(provided, Buffer.from(signature(directoryKey, req.url, timestamp, nonce, bytes), 'hex'));
      check(signedByService || signedByDirectory, 401, 'CUSTOMER_SERVICE_SIGNATURE_REQUIRED');
      check(await claimNonce(nonce, Number(timestamp) + 60000), 409, 'CUSTOMER_SERVICE_REPLAY');
      let envelope; try { envelope = JSON.parse(bytes.toString('utf8')); } catch { check(false, 400, 'INVALID_REQUEST'); }
      validEnvelope(envelope, operation); check(typeof handlers[operation] === 'function', 503, 'CUSTOMER_SERVICE_NOT_ENABLED');
      const result = Buffer.from(JSON.stringify(await handlers[operation](envelope))); check(result.length <= RESPONSE_LIMIT);
      res.statusCode = 200; res.end(result);
    } catch (error) {
      if (res.headersSent) { res.destroy(); return true; }
      const known = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 && /^[A-Z][A-Z0-9_]{2,90}$/.test(error?.code ?? '');
      res.statusCode = known ? error.status : 503;
      if (!req.complete) res.setHeader('Connection', 'close');
      res.end(JSON.stringify({ error: known ? error.code : 'CUSTOMER_SERVICE_UNAVAILABLE' }));
    }
    return true;
  };
}
