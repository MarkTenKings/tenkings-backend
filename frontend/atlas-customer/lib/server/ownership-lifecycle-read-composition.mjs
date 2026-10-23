// Inert, unregistered server composition. No environment lookup, client creation,
// connection, provider, writer, proof preparation or runtime import.
import { CustomerAuth } from './auth.mjs';
import { deny, privateHeaders } from './policy.mjs';
import { createOwnershipClaimsHandler } from './ownership-claims-http.mjs';
import { createCardOwnershipLifecycleReadService } from '../../../../packages/atlas-connected-manual/src/card-ownership-lifecycle-read-service.mjs';

const KEYS = ['mode', 'origin', 'deploymentId', 'releaseSha', 'configHash'];
const PATHS = new Set(['/api/customer/ownership/claims', '/api/customer/ownership/claim', '/api/customer/ownership/history']);
const unavailable = () => deny(503, 'OWNERSHIP_HISTORY_COMPOSITION_UNAVAILABLE');
const need = ok => { if (!ok) unavailable(); };
const binding = config => Object.fromEntries(KEYS.map(key => [key, config?.[key]]));
const sameFields = (value, expected) => value && Object.getPrototypeOf(value) === Object.prototype
  && Reflect.ownKeys(value).length === expected.length && expected.every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, 'value'));

/** Explicit server-only construction; returns one private GET handler, not a
 * generic reader/writer or mutable capability object. The client must be NEW
 * and separately restricted; its actual role is checked on EVERY read by the
 * qualified service. This factory does not establish or grant that role.
 *
 * customerState is the already constructed trusted CustomerAuth/request
 * boundary. This module never calls runtime(), bootstrap or auth providers.
 * uiConfig is deliberately absent: list/current/history need no proof policy
 * preparation settings. Configuration/target/recovery and all mutations are
 * outside this narrowly composed handler.
 */
export function createOwnershipLifecycleReadComposition(options) {
  need(sameFields(options, ['customerState', 'readerClient']));
  const { customerState: state, readerClient: client } = options;
  need(state && state.auth instanceof CustomerAuth && state.config === state.auth.config
    && typeof state.assertRequest === 'function' && typeof client?.$transaction === 'function'
    && client !== state.auth.database && client !== state.auth.database?.client);
  const auth = state.auth, config = state.config, assertRequest = state.assertRequest, transaction = client.$transaction;
  const authority = CustomerAuth.prototype.authority;
  const encoded = JSON.stringify(binding(config));
  need(sameFields(config?.binding, KEYS) && JSON.stringify(binding(config.binding)) === encoded
    && sameFields(config?.cookies, ['browser', 'session']) && Object.values(config.cookies).every(name => typeof name === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(name))
    && config.cookies.browser !== config.cookies.session && auth.authority === authority);
  const cookieNames = JSON.stringify([config.cookies.browser, config.cookies.session]);
  function current() {
    need(state.auth === auth && state.config === config && auth.config === config && state.assertRequest === assertRequest
      && auth.authority === authority && client.$transaction === transaction
      && JSON.stringify(binding(config)) === encoded && sameFields(config.binding, KEYS) && JSON.stringify(binding(config.binding)) === encoded
      && sameFields(config.cookies, ['browser', 'session']) && JSON.stringify([config.cookies.browser, config.cookies.session]) === cookieNames);
  }
  const reader = createCardOwnershipLifecycleReadService({ customerAuth: auth, client, uiConfig: null });
  const methods = ['readAccess', 'listClaims', 'readClaim', 'listHistory'];
  const capabilities = Object.freeze(Object.fromEntries(methods.map(method => [method, async (...args) => {
    current(); const value = await reader[method](...args); current(); return value;
  }])));
  const handler = createOwnershipClaimsHandler(Object.freeze({ auth, config, ownershipClaims: capabilities,
    assertRequest(req) {
      current();
      // The existing CustomerAuth ingress guard is synchronous and returns void.
      // A Promise/predicate is not a completed admission check in this adapter.
      const result = Reflect.apply(assertRequest, state, [req]);
      if (result && typeof result.then === 'function') { void Promise.resolve(result).catch(() => {}); unavailable(); }
      need(result === undefined);
    } }));
  return Object.freeze({ async handler(req, res) {
    privateHeaders(res);
    try {
      current();
      if (req.method !== 'GET') deny(405, 'METHOD_NOT_ALLOWED');
      if (typeof req.url !== 'string' || !PATHS.has(req.url.split('?')[0])) deny(404, 'NOT_FOUND');
    } catch (error) {
      const status = [404, 405].includes(error?.status) ? error.status : 503;
      return res.status(status).json({ error: status === 404 ? 'NOT_FOUND' : status === 405 ? 'METHOD_NOT_ALLOWED' : 'OWNERSHIP_CLAIMS_UNAVAILABLE' });
    }
    return handler(req, res);
  } });
}
