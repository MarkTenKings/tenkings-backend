// Internal request/response boundary shared by separately packaged proxy hosts.
import { MANUAL_TRANSPORT_LIMITS } from '../../../../packages/atlas-connected-manual/src/transport.mjs';
import { MANUAL_STREAM_HEADER, MANUAL_STREAM_PROTOCOL } from '@atlas/manual-service/response';
import { curationSame } from '../staff-comp-curation-client.mjs';
import { deny, privateHeaders } from './policy.mjs';

export const configured = value => { if (!value) deny(503, 'COMP_NOT_CONFIGURED'); };
export function origin(value, privateOrigin = false) {
  let url; try { url = new URL(value); } catch { configured(false); }
  configured(url.origin === value && (url.protocol === 'https:' || !privateOrigin && url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)));
  if (privateOrigin) configured(/^[a-z0-9-]+\.atlasgrading\.com$/.test(url.hostname));
  return value;
}
const copyHeaders = value => Object.fromEntries(Object.entries(value ?? {}).map(([key, entry]) => {
  configured(typeof entry === 'string' || entry === undefined); return [key, entry];
}));
export function requestPin(req, { raw = false } = {}) {
  const headers = req.headers, savedHeaders = copyHeaders(headers), method = req.method, url = req.url;
  const rawHeaders = req.rawHeaders, savedRawHeaders = rawHeaders === undefined ? undefined : [...rawHeaders];
  const body = raw ? req.rawBody : req.body;
  const bytes = raw ? Buffer.from(body) : Buffer.from(JSON.stringify(body ?? null));
  return { headers: savedHeaders, bytes, check() {
    configured(req.headers === headers && req.method === method && req.url === url && curationSame(copyHeaders(req.headers), savedHeaders)
      && req.rawHeaders === rawHeaders && curationSame(req.rawHeaders, savedRawHeaders));
    configured(raw ? req.rawBody === body && Buffer.isBuffer(req.rawBody) && req.rawBody.equals(bytes)
      : Buffer.from(JSON.stringify(req.body ?? null)).equals(bytes));
  } };
}
export function failure(res, error) {
  if (res.destroyed || res.writableEnded) return;
  privateHeaders(res);
  const status = [400, 401, 403, 404, 405, 409, 410, 413, 415, 429, 502, 503, 504].includes(error?.status) ? error.status : error?.code === 'COMP_ACCESS_ENDED' ? 401 : 503;
  const code = /^[A-Z][A-Z0-9_]{0,79}$/.test(error?.code ?? '') ? error.code : 'COMP_UNAVAILABLE';
  return res.status(status).json({ error: code }); // Never a confirmed rollback.
}
export function emptyGet(req) {
  const body = req.body;
  return (body == null || body === '' || Buffer.isBuffer(body) && !body.length
    || body && Object.getPrototypeOf(body) === Object.prototype && !Reflect.ownKeys(body).length)
    && [undefined, '0'].includes(req.headers['content-length']) && req.headers['transfer-encoding'] === undefined
    && (req.rawBody === undefined || Buffer.isBuffer(req.rawBody) && !req.rawBody.length) && !(req.readableLength > 0);
}
export function bufferResponse() {
  let status = 200, payload, ended = false, heartbeatBytes = 0;
  const headers = new Map();
  const capture = { get destroyed() { return false; }, get writableEnded() { return ended; },
    set statusCode(value) { status = value; }, setHeader(key, value) { headers.set(key.toLowerCase(), value); },
    status(value) { status = value; return this; },
    write(value) { configured(typeof value === 'string' && /^\s*$/.test(value)); heartbeatBytes += Buffer.byteLength(value); configured(heartbeatBytes <= 4096); },
    send(value) { configured(!ended); payload = Buffer.from(value); ended = true; return this; },
    end(value) { return this.send(value); }, json(value) { return this.send(JSON.stringify(value)); },
  };
  return { capture, result() {
    configured(ended && payload && payload.length <= MANUAL_TRANSPORT_LIMITS.jsonResponseBytes + 4096);
    let value = JSON.parse(payload.toString('utf8'));
    if (headers.has(MANUAL_STREAM_HEADER.toLowerCase())) {
      configured(headers.get(MANUAL_STREAM_HEADER.toLowerCase()) === MANUAL_STREAM_PROTOCOL && value.protocol === MANUAL_STREAM_PROTOCOL
        && Object.keys(value).sort().join(',') === 'body,protocol,status');
      status = value.status; value = value.body;
    }
    configured(Number.isInteger(status) && status >= 200 && status <= 599 && !(status >= 300 && status < 400));
    configured(Buffer.byteLength(JSON.stringify(value)) <= MANUAL_TRANSPORT_LIMITS.jsonResponseBytes);
    return { status, value };
  } };
}

