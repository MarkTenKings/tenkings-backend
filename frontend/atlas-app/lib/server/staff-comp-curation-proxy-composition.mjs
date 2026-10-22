// Inactive composition only. No route/listener/env/client/grant registration.
// Existing transport signs/verifies exact private alias bytes, not an actor.
import { createManualServiceProxy, createPrivateManualRequestVerifier, createPrivateManualNonceStore,
  MANUAL_TRANSPORT_LIMITS } from '../../../../packages/atlas-connected-manual/src/transport.mjs';
import { MANUAL_STREAM_HEADER, MANUAL_STREAM_PROTOCOL } from '@atlas/manual-service/response';
import { curationStaff, curationSame, curationDecisionInput, parseCurationResponse } from '../staff-comp-curation-client.mjs';
import { compTransportRoute } from '../staff-comp-curation-transport-contract.mjs';
import { createStaffCompCurationNativeComposition } from './staff-comp-curation-native-composition.mjs';
import { assertWrite, deny, privateHeaders } from './policy.mjs';

const configured = value => { if (!value) deny(503, 'COMP_NOT_CONFIGURED'); };
function origin(value, privateOrigin = false) {
  let url; try { url = new URL(value); } catch { configured(false); }
  configured(url.origin === value && (url.protocol === 'https:' || !privateOrigin && url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)));
  if (privateOrigin) configured(/^[a-z0-9-]+\.atlasgrading\.com$/.test(url.hostname));
  return value;
}
const copyHeaders = value => Object.fromEntries(Object.entries(value ?? {}).map(([key, entry]) => {
  configured(typeof entry === 'string' || entry === undefined); return [key, entry];
}));
function requestPin(req, { raw = false } = {}) {
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
function failure(res, error) {
  if (res.destroyed || res.writableEnded) return;
  privateHeaders(res);
  const status = [400, 401, 403, 404, 405, 409, 410, 413, 415, 429, 502, 503, 504].includes(error?.status) ? error.status : error?.code === 'COMP_ACCESS_ENDED' ? 401 : 503;
  const code = /^[A-Z][A-Z0-9_]{0,79}$/.test(error?.code ?? '') ? error.code : 'COMP_UNAVAILABLE';
  return res.status(status).json({ error: code }); // Never a confirmed rollback.
}
function emptyGet(req) {
  const body = req.body;
  return (body == null || body === '' || Buffer.isBuffer(body) && !body.length
    || body && Object.getPrototypeOf(body) === Object.prototype && !Reflect.ownKeys(body).length)
    && [undefined, '0'].includes(req.headers['content-length']) && req.headers['transfer-encoding'] === undefined
    && (req.rawBody === undefined || Buffer.isBuffer(req.rawBody) && !req.rawBody.length) && !(req.readableLength > 0);
}
function bufferResponse() {
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

/** Frontend host owns existing cookie auth/CSRF/router admission. Private
 * output, including POST heartbeats, stays local until final live auth passes.
 * Private alias is not usable until a separate dispatcher explicitly mounts it. */
export function createStaffCompCurationProxyComposition(options = {}) {
  if (options.enabled !== true) return null;
  const keys = ['enabled', 'auth', 'assertRequest', 'origin', 'privateOrigin', 'key', 'staffKeys', 'fetchImpl'];
  const { auth, assertRequest, key, staffKeys, fetchImpl } = options, authenticate = auth?.authenticate;
  const publicOrigin = origin(options.origin), privateOrigin = origin(options.privateOrigin, true);
  configured(Buffer.isBuffer(key) && key.length === 32 && Array.isArray(staffKeys) && staffKeys.length === 3
    && staffKeys.every(value => Buffer.isBuffer(value) && value.length === 32 && !key.equals(value)) && publicOrigin !== privateOrigin);
  const keyCopy = Buffer.from(key), staffCopies = staffKeys.map(value => Buffer.from(value)); let closed = false;
  const current = () => {
    configured(!closed && options.enabled === true && Reflect.ownKeys(options).every(k => keys.includes(k))
      && options.auth === auth && auth.authenticate === authenticate && typeof authenticate === 'function'
      && options.assertRequest === assertRequest && typeof assertRequest === 'function' && options.origin === publicOrigin
      && options.privateOrigin === privateOrigin && options.key === key && key.equals(keyCopy)
      && options.staffKeys === staffKeys && staffKeys.length === 3 && staffKeys.every((value, i) => Buffer.isBuffer(value) && value.equals(staffCopies[i]))
      && options.fetchImpl === fetchImpl && typeof fetchImpl === 'function');
  };
  current();
  const proxy = createManualServiceProxy({ origin: privateOrigin, key: keyCopy, timeoutMs: 20000, fetchImpl: async (...args) => {
    current(); const response = await Reflect.apply(fetchImpl, options, args);
    try { current(); return response; } catch (error) { try { void response?.body?.cancel().catch(() => {}); } catch {} throw error; }
  } });
  return Object.freeze({ close() { closed = true; }, async handler(req, res) {
    const path = typeof req.url === 'string' && req.url.startsWith('/admin/') ? req.url.slice(6) : req.url;
    const route = compTransportRoute(path); if (!route) return false;
    privateHeaders(res);
    try {
      const pin = requestPin(req);
      const admitted = () => {
        current(); pin.check();
        const result = Reflect.apply(assertRequest, options, [req]);
        if (result && typeof result.then === 'function') { void Promise.resolve(result).catch(() => {}); configured(false); }
        configured(result === undefined); current(); pin.check();
      };
      admitted(); if (req.method !== route.method) deny(405, 'METHOD_NOT_ALLOWED');
      let input = route.input, csrf;
      if (route.kind === 'decide') {
        assertWrite(req, publicOrigin); csrf = req.headers['x-atlas-csrf'];
        if (typeof csrf !== 'string' || !csrf || csrf.length > 512) deny(403, 'CSRF_REQUIRED');
        const length = req.headers['content-length'];
        if (req.headers['transfer-encoding'] !== undefined || length !== undefined && (!/^\d{1,4}$/.test(length) || Number(length) > 4096)
          || Buffer.byteLength(JSON.stringify(req.body)) > 4096) deny(400, 'COMP_REQUEST_INVALID');
        input = curationDecisionInput(req.body);
      } else if (!emptyGet(req)) deny(400, 'COMP_REQUEST_INVALID');
      const cookie = req.headers.cookie ?? ''; if (typeof cookie !== 'string' || cookie.length > 8192) deny(401, 'SIGN_IN_REQUIRED');
      const actor = curationStaff(await Reflect.apply(authenticate, auth, [cookie, csrf])); admitted();
      const buffered = bufferResponse();
      buffered.capture.once = res.once?.bind(res); buffered.capture.removeListener = res.removeListener?.bind(res);
      await proxy({ method: req.method, url: route.privatePath, headers: pin.headers, body: route.kind === 'decide' ? input : undefined,
        once: req.once?.bind(req), removeListener: req.removeListener?.bind(req) }, buffered.capture);
      admitted(); const result = buffered.result();
      const after = curationStaff(await Reflect.apply(authenticate, auth, [cookie, csrf])); admitted();
      if (!curationSame(actor, after)) deny(401, 'SIGN_IN_REQUIRED');
      if (result.status === 200) parseCurationResponse(result.value, { staff: actor, cardId: route.cardId, input, action: route.kind });
      else configured(result.value && Object.keys(result.value).length === 1 && /^[A-Z][A-Z0-9_]{0,79}$/.test(result.value.error));
      return res.status(result.status).json(result.value);
    } catch (error) { failure(res, error); }
    return true;
  } });
}

/** Native host must supply exact bounded rawBody before calling this unmounted
 * adapter. Nothing listens/reads env/opens clients here. Original request is
 * verified and unchanged through asynchronous nonce admission before mapping. */
export function createStaffCompCurationPrivateAdapter(options = {}) {
  if (options.enabled !== true) return null;
  const { native, key } = options, publicOrigin = origin(options.origin);
  configured(native && Buffer.isBuffer(key) && key.length === 32);
  const nonceStore = options.nonceStore ?? createPrivateManualNonceStore(), consume = nonceStore.consume, keyCopy = Buffer.from(key);
  const nativeKeys = ['environment', 'auth', 'boundary', 'approved', 'artifacts', 'validateAccess'];
  const nativePins = Object.fromEntries(nativeKeys.map(name => [name, native[name]]));
  const nonceInput = options.nonceStore; let closed = false;
  const current = () => configured(!closed && options.enabled === true && options.native === native && options.key === key && key.equals(keyCopy)
    && options.origin === publicOrigin && options.nonceStore === nonceInput && nonceStore.consume === consume
    && Reflect.ownKeys(options).every(name => ['enabled', 'native', 'key', 'origin', 'nonceStore'].includes(name))
    && Reflect.ownKeys(native).every(name => nativeKeys.includes(name)) && nativeKeys.every(name => native[name] === nativePins[name]));
  current(); const verify = createPrivateManualRequestVerifier({ key: keyCopy, origin: publicOrigin, nonceStore });
  const admitted = new WeakMap();
  const composition = createStaffCompCurationNativeComposition({ enabled: true, ...nativePins, origin: publicOrigin, assertRequest(req) {
    current(); const witness = admitted.get(req); configured(witness); witness();
  } });
  return Object.freeze({ close() { closed = true; composition.close(); }, async handler(req, res) {
    const route = compTransportRoute(req.url, { privateAlias: true }); if (!route) return false;
    privateHeaders(res); let mapped;
    try {
      current(); if (req.method !== route.method) deny(405, 'METHOD_NOT_ALLOWED');
      if (!Buffer.isBuffer(req.rawBody) || req.rawBody.length > 4096 || req.headers?.['transfer-encoding'] !== undefined) deny(400, 'COMP_REQUEST_INVALID');
      const length = req.headers['content-length'];
      if (length !== undefined && (!/^\d{1,4}$/.test(length) || Number(length) !== req.rawBody.length)) deny(400, 'COMP_REQUEST_INVALID');
      const pin = requestPin(req, { raw: true });
      const signed = { method: req.method, url: req.url, headers: pin.headers, rawBody: Buffer.from(pin.bytes),
        ...(req.rawHeaders ? { rawHeaders: [...req.rawHeaders] } : {}) };
      configured(await verify(signed) === true); current(); pin.check();
      mapped = { method: signed.method, url: route.path, headers: { ...signed.headers }, rawBody: Buffer.from(signed.rawBody),
        body: route.kind === 'decide' ? JSON.parse(signed.rawBody.toString('utf8')) : '' };
      const mappedPin = requestPin(mapped), mappedRaw = Buffer.from(mapped.rawBody);
      admitted.set(mapped, () => { current(); pin.check(); mappedPin.check(); configured(mapped.rawBody.equals(mappedRaw)); });
      await composition.handler(mapped, res);
    } catch (error) { failure(res, error); }
    finally { if (mapped) admitted.delete(mapped); }
    return true;
  } });
}
