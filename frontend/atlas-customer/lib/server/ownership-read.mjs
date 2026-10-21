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
    try {
      const state = typeof resolveState === 'function' ? await resolveState() : resolveState;
      if (typeof state?.assertRequest !== 'function' || typeof state.auth?.authority !== 'function') deny(503, 'COLLECTION_UNAVAILABLE');
      state.assertRequest(req);
      if ((req.url ?? '').split('?')[0] !== PATH) deny(404, 'NOT_FOUND');
      if (req.method !== 'GET') deny(405, 'METHOD_NOT_ALLOWED');
      // Next's body parser represents an empty GET as '' (or {} for JSON).
      // Accept only that empty representation and reject payload framing.
      const emptyBody = req.body === undefined || req.body === null || req.body === ''
        || req.body && Object.getPrototypeOf(req.body) === Object.prototype && Object.keys(req.body).length === 0;
      if (!emptyBody || req.headers?.['transfer-encoding'] !== undefined
        || req.headers?.['content-length'] !== undefined && req.headers['content-length'] !== '0') deny(400, 'INVALID_OWNERSHIP_REQUEST');
      if (req.headers?.['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) deny(403, 'ORIGIN_NOT_ALLOWED');
      const input = parseOwnershipCollectionQuery(req.url), cookie = req.headers?.cookie;
      state.auth.authority(cookie); // Existing CustomerAuth; SQL reauthenticates.
      if (typeof state.ownershipRead?.read !== 'function') deny(503, 'COLLECTION_UNAVAILABLE');
      const value = await state.ownershipRead.read(cookie, 'read_collection', input);
      // Only the server reader supplies the account identity. The browser is
      // independently required to match this identity to its current session.
      const page = parseOwnerCollectionPage(value, value?.accountId, input);
      res.status(200).json(page);
    } catch (error) {
      const allowed = new Map([
        ['SIGN_IN_REQUIRED', 401], ['CUSTOMER_ACCESS_NOT_ENABLED', 403], ['ORIGIN_NOT_ALLOWED', 403],
        ['INVALID_COOKIE', 400], ['INVALID_OWNERSHIP_REQUEST', 400], ['NOT_FOUND', 404], ['METHOD_NOT_ALLOWED', 405],
      ]);
      const status = allowed.get(error.code);
      // Configuration/role/response faults never look like an empty collection
      // and internal exception text never crosses the customer boundary.
      res.status(status ?? (error instanceof BoundaryError && error.status === 401 ? 401 : 503))
        .json({ error: status ? error.code : error instanceof BoundaryError && error.status === 401 ? 'SIGN_IN_REQUIRED' : 'COLLECTION_UNAVAILABLE' });
    }
  };
}
