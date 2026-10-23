// Optional web-only composition. No database, native writer, environment write,
// connection or request is created on import/construction.
import { createStaffCompCurationProxyComposition } from './staff-comp-curation-frontend-proxy.mjs';
import { configured, failure } from './staff-comp-curation-transport-boundary.mjs';

// These recognize reserved families, not valid requests. In particular a bad
// query must not let the private alias fall through to the generic manual proxy.
function rawPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return null;
  const path = value.split('?', 1)[0];
  return path.startsWith('/admin/') ? path.slice(6) : path;
}
export function isStaffCompCurationPublicPath(value) {
  const path = rawPath(value);
  return path !== null && /^\/api\/staff\/comp-curation(?:\/|$)/.test(path);
}
export function isStaffCompCurationPrivateAlias(value) {
  const path = rawPath(value);
  return path !== null && /^\/api\/staff\/manual-connected\/cards\/[^/?]+\/comp-curation(?:\/|$)/.test(path);
}

const fields = ['mode', 'origin', 'basePath', 'application', 'deploymentId', 'releaseSha', 'configHash', 'databaseUrl'];
function configPin(config) {
  const values = fields.map(name => config?.[name]), cookies = config?.cookies;
  const cookieValues = cookies && Object.entries(cookies);
  const keys = ['sessionKey', 'phoneKey', 'routerKey'].map(name => [name, config?.[name], Buffer.isBuffer(config?.[name]) ? Buffer.from(config[name]) : null]);
  return () => fields.every((name, i) => config?.[name] === values[i]) && config?.cookies === cookies
    && JSON.stringify(cookies && Object.entries(cookies)) === JSON.stringify(cookieValues)
    && keys.every(([name, key, bytes]) => config?.[name] === key && (bytes === null || Buffer.isBuffer(key) && key.equals(bytes)));
}

/** Advisory configuredForDisplay is deliberately not an authentication or
 * readiness assertion. Every handler request uses the existing signed ingress,
 * live staff session/CSRF and buffered proxy's final live authentication.
 */
export function createStaffCompCurationFrontendRuntime(options = {}) {
  try {
    const { env } = options;
    if (env?.ATLAS_STAFF_COMP_CURATION !== '1' || env.ATLAS_MANUAL_ENABLED !== 'true') return null;
    const { auth, staffConfig, assertRequest } = options, fetchImpl = options.fetchImpl ?? globalThis.fetch;
    const authenticate = auth?.authenticate, authConfig = auth?.config;
    if (!staffConfig || typeof authenticate !== 'function' || typeof assertRequest !== 'function' || typeof fetchImpl !== 'function'
      || staffConfig.basePath !== '/admin' || staffConfig.application !== 'atlas-staff') return null;
    const publicOrigin = new URL(staffConfig.origin), privateOrigin = new URL(env.ATLAS_MANUAL_SERVICE_ORIGIN);
    if (publicOrigin.protocol !== 'https:' || publicOrigin.origin !== staffConfig.origin
      || privateOrigin.protocol !== 'https:' || privateOrigin.origin !== env.ATLAS_MANUAL_SERVICE_ORIGIN
      || !/^[a-z0-9-]+\.atlasgrading\.com$/.test(privateOrigin.hostname) || privateOrigin.origin === publicOrigin.origin) return null;
    const encodedKey = env.ATLAS_MANUAL_SERVICE_KEY;
    if (typeof encodedKey !== 'string') return null;
    const key = Buffer.from(encodedKey, 'base64'), staffKeys = [staffConfig.sessionKey, staffConfig.phoneKey, staffConfig.routerKey];
    if (key.length !== 32 || key.toString('base64') !== encodedKey
      || staffKeys.some(other => !Buffer.isBuffer(other) || other.length !== 32 || key.equals(other))) return null;
    const configCurrent = configPin(staffConfig), authConfigCurrent = configPin(authConfig), suppliedFetch = options.fetchImpl;
    let closed = false;
    const current = () => !closed && options.env === env && env.ATLAS_STAFF_COMP_CURATION === '1'
      && env.ATLAS_MANUAL_ENABLED === 'true' && env.ATLAS_MANUAL_SERVICE_ORIGIN === privateOrigin.origin
      && env.ATLAS_MANUAL_SERVICE_KEY === encodedKey && options.auth === auth && auth.authenticate === authenticate
      && auth.config === authConfig && authConfigCurrent() && options.staffConfig === staffConfig && configCurrent()
      && options.assertRequest === assertRequest && options.fetchImpl === suppliedFetch
      && (suppliedFetch !== undefined && suppliedFetch !== null || globalThis.fetch === fetchImpl);
    const check = () => configured(current());
    const proxy = createStaffCompCurationProxyComposition({ enabled: true, origin: publicOrigin.origin,
      privateOrigin: privateOrigin.origin, key, staffKeys,
      auth: { async authenticate(...args) {
        check(); const value = await Reflect.apply(authenticate, auth, args); check(); return value;
      } },
      assertRequest(req) {
        check(); const result = Reflect.apply(assertRequest, options, [req]);
        if (result && typeof result.then === 'function') { void Promise.resolve(result).catch(() => {}); configured(false); }
        configured(result === undefined); check();
      },
      async fetchImpl(...args) {
        check(); const response = await Reflect.apply(fetchImpl, options, args);
        try { check(); return response; } catch (error) { try { void response?.body?.cancel().catch(() => {}); } catch {} throw error; }
      },
    });
    return Object.freeze({
      get configuredForDisplay() { try { return current(); } catch { return false; } },
      close() { closed = true; proxy.close(); },
      async handler(req, res) {
        if (!isStaffCompCurationPublicPath(req.url)) return false;
        try { check(); return await proxy.handler(req, res); } catch (error) { failure(res, error); return true; }
      },
    });
  } catch { return null; }
}
