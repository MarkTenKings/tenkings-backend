import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

export const STATION_ORIGIN = 'https://atlasgrading.com';
export const STATION_PORT = 47664;
export const STATION_TOKEN_HEADER = 'x-atlas-station-token';
const secret = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43,192}$/.test(value);
const fail = (code, status = 400) => Object.assign(new Error(code), { code, status });
const check = (value, code, status) => { if (!value) throw fail(code, status); };
const exact = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const sameSecret = (a, b) => secret(a) && secret(b) && Buffer.byteLength(a) === Buffer.byteLength(b)
  && timingSafeEqual(Buffer.from(a), Buffer.from(b));

async function jsonBody(req) {
  check(/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? ''), 'STATION_JSON_REQUIRED', 415);
  check(!req.headers['content-encoding'] && Number(req.headers['content-length'] ?? 0) <= 131072, 'STATION_BODY_TOO_LARGE', 413);
  let size = 0; const chunks = [], iterator = req[Symbol.asyncIterator](), deadline = Date.now() + 5000;
  while (true) {
    let timer;
    const next = await Promise.race([iterator.next(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(fail('STATION_BODY_TIMEOUT', 408)), Math.max(1, deadline - Date.now()));
    })]).finally(() => clearTimeout(timer));
    if (next.done) break;
    size += next.value.length; check(size <= 131072, 'STATION_BODY_TOO_LARGE', 413); chunks.push(next.value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail('STATION_JSON_INVALID'); }
}

/** Fixed first-party loopback boundary. The controller is trusted local code;
 * no browser callback, URL, APDU, device path or executable path is accepted.
 * Constructing this server does not bind a port or touch a device.
 */
export function createStationHttpServer({ controller, pairing, now = Date.now }) {
  check(controller && ['status','enrollmentProof','enroll','prepare','operation','acknowledge'].every(key => typeof controller[key] === 'function'), 'STATION_CONTROLLER_INVALID', 500);
  check(secret(pairing?.code) && secret(pairing?.credential) && !sameSecret(pairing.code, pairing.credential)
    && Number.isSafeInteger(pairing.expiresAt) && pairing.expiresAt > now() && pairing.expiresAt - now() <= 120000,
  'STATION_PAIRING_CONFIGURATION_INVALID', 500);
  let consumed = false, failures = 0, active = 0;
  const routes = new Map([
    ['/v1/status', ['GET', 'status']], ['/v1/enrollment-proof', ['POST', 'enrollmentProof']],
    ['/v1/enroll', ['POST', 'enroll']], ['/v1/prepare', ['POST', 'prepare']], ['/v1/operation', ['POST', 'operation']], ['/v1/acknowledge', ['POST', 'acknowledge']],
  ]);
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    let admitted = false;
    const send = (status, value) => { const body = JSON.stringify(value); res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }); res.end(body); };
    try {
      check(req.socket.remoteAddress === '127.0.0.1' && req.headers.host === `127.0.0.1:${STATION_PORT}`
        && req.headers.origin === STATION_ORIGIN && !req.headers.authorization && !req.headers.cookie,
      'STATION_ORIGIN_REFUSED', 403);
      check(typeof req.url === 'string' && !/[?#\\\x00-\x20\x7f]/.test(req.url), 'STATION_PATH_REFUSED');
      const route = routes.get(req.url), pair = req.url === '/v1/pair'; check(route || pair, 'STATION_NOT_FOUND', 404);
      res.setHeader('Access-Control-Allow-Origin', STATION_ORIGIN); res.setHeader('Vary', 'Origin');
      if (req.method === 'OPTIONS') {
        const requested = req.headers['access-control-request-method'], names = String(req.headers['access-control-request-headers'] ?? '').toLowerCase().split(',').map(name => name.trim()).filter(Boolean);
        check(requested === (pair ? 'POST' : route[0]) && names.every(name => ['content-type', STATION_TOKEN_HEADER].includes(name)), 'STATION_PREFLIGHT_REFUSED', 403);
        res.setHeader('Access-Control-Allow-Methods', pair ? 'POST' : route[0]);
        res.setHeader('Access-Control-Allow-Headers', `content-type, ${STATION_TOKEN_HEADER}`);
        res.setHeader('Access-Control-Allow-Private-Network', 'true'); res.writeHead(204); res.end(); return;
      }
      check(req.method === (pair ? 'POST' : route[0]), 'STATION_METHOD_REFUSED', 405);
      check(active < 4, 'STATION_BUSY', 503); active++; admitted = true;
      if (pair) {
        const body = await jsonBody(req); check(exact(body, ['pairingCode']), 'STATION_PAIRING_INVALID');
        check(!consumed && failures < 5 && pairing.expiresAt > now(), 'STATION_PAIRING_EXPIRED', 401);
        if (!sameSecret(body.pairingCode, pairing.code)) { failures++; throw fail('STATION_PAIRING_INVALID', 401); }
        consumed = true;
        send(200, { ok: true, result: { version: 'atlas-finishing-station-browser-v1', credential: pairing.credential, ...(await controller.status()) } }); return;
      }
      check(sameSecret(req.headers[STATION_TOKEN_HEADER], pairing.credential), 'STATION_PAIRING_REQUIRED', 401);
      if (req.method === 'GET') check(!req.headers['transfer-encoding'] && Number(req.headers['content-length'] ?? 0) === 0, 'STATION_BODY_REFUSED');
      const result = await controller[route[1]](req.method === 'POST' ? await jsonBody(req) : undefined);
      send(200, { ok: true, result });
    } catch (error) {
      res.setHeader('Connection', 'close'); res.once('finish', () => req.destroy());
      const status = Number.isInteger(error.status) ? error.status : 409;
      send(status, { ok: false, error: { code: /^[A-Z0-9_]{1,100}$/.test(error.code ?? error.message ?? '') ? error.code ?? error.message : 'STATION_REQUEST_REFUSED' } });
    } finally { if (admitted) active--; }
  });
  server.requestTimeout = 10000; server.headersTimeout = 6000; server.keepAliveTimeout = 1000; server.maxHeadersCount = 30;
  return server;
}
