// Web-only composition: no native service, writer, database or credential imports.
import { createManualServiceProxy } from '../../../../packages/atlas-connected-manual/src/transport.mjs';
import { curationStaff, curationSame, curationDecisionInput, parseCurationResponse } from '../staff-comp-curation-client.mjs';
import { compTransportRoute } from '../staff-comp-curation-transport-contract.mjs';
import { assertWrite, deny, privateHeaders } from './policy.mjs';
import { configured, origin, requestPin, failure, emptyGet, bufferResponse } from './staff-comp-curation-transport-boundary.mjs';

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

