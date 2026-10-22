// Inactive trusted HTTP adapter. No runtime lookup, client construction, grants,
// generic ownership gateway, route registration, bootstrap or provider calls.
import { CustomerAuth } from './auth.mjs';
import { deny, privateHeaders } from './policy.mjs';
import { preferenceId, preferenceInput, preferenceWrite, preferenceSameInput, parsePreferenceResult } from '../collection-preferences-client.mjs';

const ROOT = '/api/customer/collection/';
const methods = ['readAccess', 'readPreferences', 'readCard', 'recoverRequest', 'setCollectionPreferences', 'setCardPreferences'];
const bindingKeys = ['mode', 'origin', 'deploymentId', 'releaseSha', 'configHash'];
const exact = (v, keys) => v && Object.getPrototypeOf(v) === Object.prototype && Reflect.ownKeys(v).length === keys.length
  && keys.every(k => Object.hasOwn(Object.getOwnPropertyDescriptor(v, k) ?? {}, 'value'));
const unavailable = () => deny(503, 'PREFERENCES_UNAVAILABLE');
const requireState = ok => { if (!ok) unavailable(); };
export function parseCollectionPreferenceRequest(req) {
  const { method, url, body } = req;
  if (typeof url !== 'string' || url.length > 220 || /[%?#\s\\]/.test(url) || !url.startsWith(ROOT)) deny(400, 'INVALID_PREFERENCE_REQUEST');
  const parts = url.slice(ROOT.length).split('/'); let action, expected, cardId;
  if (parts.length === 1 && parts[0] === 'preferences') { action = 'read_preferences'; expected = method === 'POST' ? 'set_collection_preferences' : action; }
  else if (parts.length === 3 && parts[0] === 'cards' && preferenceId(parts[1]) && parts[2] === 'preferences') { cardId = parts[1]; action = 'read_card'; expected = method === 'POST' ? 'set_card_preferences' : action; }
  else if (parts.length === 2 && parts[0] === 'preference-requests' && preferenceId(parts[1])) { action = 'recover_request'; expected = action; }
  else deny(404, 'NOT_FOUND');
  if (!['GET', 'POST'].includes(method) || action === 'recover_request' && method !== 'GET') deny(405, 'METHOD_NOT_ALLOWED');
  const writing = preferenceWrite(expected);
  let input;
  try {
    if (writing) { input = preferenceInput(expected, body); if (cardId && input.cardId !== cardId) deny(400, 'INVALID_PREFERENCE_REQUEST'); }
    else {
      if (![undefined, null, ''].includes(body) && !exact(body, [])) deny(400, 'INVALID_PREFERENCE_REQUEST');
      input = preferenceInput(action, cardId ? { cardId } : action === 'recover_request' ? { requestId: parts[1] } : {});
    }
  } catch { deny(400, 'INVALID_PREFERENCE_REQUEST'); }
  if (writing && Buffer.byteLength(JSON.stringify(input)) > 4096) deny(413, 'REQUEST_TOO_LARGE');
  return { action: expected, input, writing };
}

/** preferences must be the separately restricted qualified capability; readAccess
 * is LIVE SQL, not cookie decoding. A current response is never receipt proof.
 * Any failure after dispatch may follow commit: no definitive-refusal envelope. */
export function createCollectionPreferencesHandler(options) {
  if (options === undefined || options?.preferences == null) return null;
  requireState(exact(options, ['customerState', 'preferences']));
  const { customerState: state, preferences } = options;
  requireState(state?.auth instanceof CustomerAuth && state.config === state.auth.config && typeof state.assertRequest === 'function'
    && methods.every(k => typeof preferences[k] === 'function'));
  const auth = state.auth, config = state.config, guard = state.assertRequest;
  const authority = CustomerAuth.prototype.authority, digest = CustomerAuth.prototype.digest;
  const captured = Object.fromEntries(methods.map(k => [k, preferences[k]]));
  const configPin = () => JSON.stringify([bindingKeys.map(k => config[k]), config.binding, config.cookies, config.sessionKey, config.routerKey, config.deploymentHost]);
  const encoded = configPin();
  requireState(auth.authority === authority && auth.digest === digest && exact(config.binding, bindingKeys)
    && bindingKeys.every(k => typeof config[k] === 'string' && config.binding[k] === config[k])
    && exact(config.cookies, ['browser', 'session']) && config.cookies.browser !== config.cookies.session
    && Buffer.isBuffer(config.sessionKey) && config.sessionKey.length >= 32);
  const current = () => requireState(options.customerState === state && options.preferences === preferences && state.auth === auth
    && state.config === config && auth.config === config && auth.authority === authority && auth.digest === digest
    && state.assertRequest === guard && configPin() === encoded && methods.every(k => preferences[k] === captured[k]));
  const requestPin = req => JSON.stringify([req.method, req.url, Object.entries(req.headers ?? {}).sort(([a], [b]) => a.localeCompare(b)), req.socket?.remoteAddress]);
  return async function handler(req, res) {
    privateHeaders(res); let aborted = false;
    const abort = () => { aborted = true; }, close = () => { if (!res.writableEnded) abort(); };
    req.once?.('aborted', abort); res.once?.('close', close);
    try {
      current(); const route = parseCollectionPreferenceRequest(req), headers = req.headers ?? {};
      if (headers.authorization !== undefined) deny(403, 'CUSTOMER_COOKIE_REQUIRED');
      if (headers['content-encoding'] !== undefined || headers['transfer-encoding'] !== undefined) deny(400, 'INVALID_PREFERENCE_REQUEST');
      if (route.writing) {
        if (headers.origin !== config.origin || headers['sec-fetch-site'] && headers['sec-fetch-site'] !== 'same-origin'
          || !/^application\/json(?:;\s*charset=utf-8)?$/i.test(headers['content-type'] ?? '')) deny(403, 'ORIGIN_NOT_ALLOWED');
        if (headers['content-length'] !== undefined && (!/^(0|[1-9][0-9]*)$/.test(headers['content-length']) || Number(headers['content-length']) > 4096)) deny(413, 'REQUEST_TOO_LARGE');
      } else {
        if (headers.origin !== undefined && headers.origin !== config.origin || headers['sec-fetch-site'] && !['same-origin', 'none'].includes(headers['sec-fetch-site'])) deny(403, 'ORIGIN_NOT_ALLOWED');
        if (headers['content-length'] !== undefined && headers['content-length'] !== '0') deny(400, 'INVALID_PREFERENCE_REQUEST');
      }
      const admitted = guard.call(state, req);
      if (admitted && typeof admitted.then === 'function') { void Promise.resolve(admitted).catch(() => {}); unavailable(); }
      requireState(admitted === undefined);
      const original = requestPin(req), cookie = headers.cookie, csrf = route.writing ? headers['x-atlas-customer-csrf'] ?? '' : undefined;
      const active = () => { current(); requireState(!aborted && !req.aborted && requestPin(req) === original);
        const now = parseCollectionPreferenceRequest(req); requireState(now.action === route.action && preferenceSameInput(now.input, route.input)); authority.call(auth, cookie, csrf); };
      active();
      const access = async expected => { active(); const value = await captured.readAccess.call(preferences, cookie); active();
        return parsePreferenceResult(value, expected ?? value?.accountId, 'read_access', {}).accountId; };
      const accountId = await access(); let value;
      active();
      if (route.action === 'read_preferences') value = await captured.readPreferences.call(preferences, cookie);
      else if (route.action === 'read_card') value = await captured.readCard.call(preferences, cookie, route.input);
      else if (route.action === 'recover_request') value = await captured.recoverRequest.call(preferences, cookie, route.input);
      else value = await captured[route.action === 'set_collection_preferences' ? 'setCollectionPreferences' : 'setCardPreferences'].call(preferences, cookie, csrf, route.input);
      active(); const result = parsePreferenceResult(value, accountId, route.action, route.input);
      await access(accountId); active(); res.status(200).json(result);
    } catch (error) {
      const requestCodes = { INVALID_PREFERENCE_REQUEST: 400, REQUEST_TOO_LARGE: 413, NOT_FOUND: 404, METHOD_NOT_ALLOWED: 405,
        SIGN_IN_REQUIRED: 401, INVALID_COOKIE: 400, CSRF_REQUIRED: 403, CUSTOMER_COOKIE_REQUIRED: 403, ORIGIN_NOT_ALLOWED: 403 };
      const status = requestCodes[error?.code] ?? ([401, 403, 404, 409, 429].includes(error?.status) ? error.status : 503);
      // This sanitized status is NOT a terminal request outcome. A service may
      // have committed before final access/transport failed; retain uncertainty.
      res.status(status).json({ error: status === 401 || status === 403 ? 'PREFERENCES_ACCESS_ENDED' : status === 503 ? 'PREFERENCES_UNAVAILABLE'
        : requestCodes[error?.code] ? error.code : 'PREFERENCES_REQUEST_UNAVAILABLE' });
    } finally { req.removeListener?.('aborted', abort); res.removeListener?.('close', close); }
  };
}
