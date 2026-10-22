import { CustomerAuth } from './auth.mjs';
import { BoundaryError, deny, privateHeaders, UUID } from './policy.mjs';
import { parseOwnerCollectionPage } from '../collection-contract.mjs';

const PATH = '/api/customer/collection';
export function parseOwnershipCollectionQuery(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length > 180 || !rawUrl.startsWith(PATH)
    || rawUrl.split('?')[0] !== PATH || /[%#\s\\]/.test(rawUrl)) deny(400, 'INVALID_OWNERSHIP_REQUEST');
  const [path, query, extra] = rawUrl.split('?');
  if (path !== PATH || extra !== undefined || query === '') deny(400, 'INVALID_OWNERSHIP_REQUEST');
  const params = new URLSearchParams(query);
  if ([...params.keys()].some(key => !['limit', 'afterCardId'].includes(key) || params.getAll(key).length !== 1)
    || query !== undefined && params.toString() !== query) deny(400, 'INVALID_OWNERSHIP_REQUEST');
  const limit = params.get('limit'), afterCardId = params.get('afterCardId');
  if (limit !== null && !/^(?:[1-9]|[1-4][0-9]|50)$/.test(limit)
    || afterCardId !== null && !UUID.test(afterCardId)) deny(400, 'INVALID_OWNERSHIP_REQUEST');
  return { afterCardId, limit: limit === null ? 25 : Number(limit) };
}

/** GET-only HTTP adapter. The server injects the separately restricted reader;
 * this module never opens a DB connection or accepts the combined writer. */
export function createOwnershipReadHandler(resolveState) {
  return async (req, res) => {
    privateHeaders(res);
    let aborted = false;
    const abort = () => { aborted = true; }, close = () => { if (!res.writableEnded) abort(); };
    req.once?.('aborted', abort); res.once?.('close', close);
    try {
      const state = typeof resolveState === 'function' ? await resolveState() : resolveState;
      if ((req.url ?? '').split('?')[0] !== PATH) deny(404, 'NOT_FOUND');
      if (req.method !== 'GET') deny(405, 'METHOD_NOT_ALLOWED');
      // Next's body parser represents an empty GET as '' (or {} for JSON).
      const emptyBody = req.body === undefined || req.body === null || req.body === ''
        || req.body && Object.getPrototypeOf(req.body) === Object.prototype && Reflect.ownKeys(req.body).length === 0;
      if (!emptyBody || req.headers?.['transfer-encoding'] !== undefined || req.headers?.['content-encoding'] !== undefined
        || req.headers?.['content-length'] !== undefined && req.headers['content-length'] !== '0'
        || req.rawBody !== undefined && (!Buffer.isBuffer(req.rawBody) || req.rawBody.length !== 0)
        || req.readableLength > 0) deny(400, 'INVALID_OWNERSHIP_REQUEST');
      if (req.headers?.authorization !== undefined) deny(403, 'CUSTOMER_COOKIE_REQUIRED');
      if (req.headers?.['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) deny(403, 'ORIGIN_NOT_ALLOWED');
      const input = parseOwnershipCollectionQuery(req.url), cookie = req.headers?.cookie;
      const auth = state?.auth, config = state?.config, guard = state?.assertRequest;
      const authority = CustomerAuth.prototype.authority, digest = CustomerAuth.prototype.digest;
      const need = ok => { if (!ok) deny(503, 'COLLECTION_UNAVAILABLE'); };
      need(auth instanceof CustomerAuth && config && auth.config === config && typeof guard === 'function'
        && auth.authority === authority && auth.digest === digest);
      const bindingKeys = ['mode', 'origin', 'deploymentId', 'releaseSha', 'configHash'];
      need(config.binding && bindingKeys.every(k => typeof config[k] === 'string' && config.binding[k] === config[k])
        && config.cookies && config.cookies.browser !== config.cookies.session
        && ['browser', 'session'].every(k => typeof config.cookies[k] === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(config.cookies[k]))
        && Buffer.isBuffer(config.sessionKey) && config.sessionKey.length >= 32);
      const configPin = () => JSON.stringify([bindingKeys.map(k => config[k]), config.binding, config.cookies,
        config.sessionKey, config.routerKey, config.deploymentHost]);
      const encoded = configPin();
      const requestPin = () => JSON.stringify([req.method, req.url, Object.entries(req.headers ?? {}).sort(([a],[b]) => a.localeCompare(b)),
        req.body, req.rawBody, req.socket?.remoteAddress]);
      const original = requestPin();
      const current = () => need(!aborted && !req.aborted && state.auth === auth && state.config === config && auth.config === config
        && state.assertRequest === guard && auth.authority === authority && auth.digest === digest
        && configPin() === encoded && requestPin() === original);
      current();
      const admitted = Reflect.apply(guard, state, [req]);
      if (admitted && typeof admitted.then === 'function') { void Promise.resolve(admitted).catch(() => {}); deny(503, 'COLLECTION_UNAVAILABLE'); }
      need(admitted === undefined); current();
      if (req.headers?.origin !== undefined && req.headers.origin !== config.origin) deny(403, 'ORIGIN_NOT_ALLOWED');
      authority.call(auth, cookie); // Cookie proof only; unchanged SQL reauthenticates live access.
      const reader = state.ownershipRead, read = reader?.read;
      need(typeof read === 'function');
      const value = await Reflect.apply(read, reader, [cookie, 'read_collection', input]);
      // Do not re-admit ingress or restart its signed time window. Preserve
      // the originally admitted request and captured capabilities instead.
      current(); need(state.ownershipRead === reader && reader.read === read);
      authority.call(auth, cookie);
      const page = parseOwnerCollectionPage(value, value?.accountId, input);
      current(); need(state.ownershipRead === reader && reader.read === read);
      res.status(200).json(page);
    } catch (error) {
      const allowed = new Map([
        ['SIGN_IN_REQUIRED', 401], ['CUSTOMER_ACCESS_NOT_ENABLED', 403], ['ORIGIN_NOT_ALLOWED', 403], ['CUSTOMER_COOKIE_REQUIRED', 403], ['HOST_NOT_ALLOWED', 403],
        ['INVALID_COOKIE', 400], ['INVALID_OWNERSHIP_REQUEST', 400], ['NOT_FOUND', 404], ['METHOD_NOT_ALLOWED', 405],
      ]);
      const status = allowed.get(error?.code);
      res.status(status ?? (error instanceof BoundaryError && error.status === 401 ? 401 : 503))
        .json({ error: status ? error.code : error instanceof BoundaryError && error.status === 401 ? 'SIGN_IN_REQUIRED' : 'COLLECTION_UNAVAILABLE' });
    } finally { req.removeListener?.('aborted', abort); res.removeListener?.('close', close); }
  };
}
