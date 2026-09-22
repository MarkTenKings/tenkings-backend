import { createManualServiceProxy, isManualServicePath } from '@atlas/connected-manual/transport';
import { STAFF_BASE_PATH } from '../routes.mjs';
import { assertWrite, deny } from './policy.mjs';

/** Vercel staff pages retain ordinary gateway/session/CSRF authority. Native
 * decoding, durable source adoption and paid effects run on private Linux. */
export function createFrontendManualRuntime({ env, auth, staffConfig, assertRequest, fetchImpl }) {
  if (env.ATLAS_MANUAL_ENABLED !== 'true') return null;
  if (typeof auth?.authenticate !== 'function' || typeof assertRequest !== 'function' || !staffConfig)
    deny(503, 'MANUAL_CONFIGURATION_INVALID');
  let origin, uploadOrigin, publicOrigin;
  try {
    origin = new URL(env.ATLAS_MANUAL_SERVICE_ORIGIN);
    uploadOrigin = new URL(env.ATLAS_MANUAL_UPLOAD_ORIGIN);
    publicOrigin = new URL(staffConfig.origin);
  } catch { deny(503, 'MANUAL_CONFIGURATION_INVALID'); }
  if (origin.origin !== env.ATLAS_MANUAL_SERVICE_ORIGIN || origin.protocol !== 'https:'
    || !/^[a-z0-9-]+\.atlasgrading\.com$/.test(origin.hostname)
    || uploadOrigin.origin !== env.ATLAS_MANUAL_UPLOAD_ORIGIN || uploadOrigin.protocol !== 'https:'
    || publicOrigin.origin !== staffConfig.origin || publicOrigin.protocol !== 'https:'
    || origin.origin === publicOrigin.origin) deny(503, 'MANUAL_CONFIGURATION_INVALID');
  if (typeof env.ATLAS_MANUAL_SERVICE_KEY !== 'string') deny(503, 'MANUAL_CONFIGURATION_INVALID');
  const key = Buffer.from(env.ATLAS_MANUAL_SERVICE_KEY, 'base64');
  const staffKeys = [staffConfig.sessionKey, staffConfig.phoneKey, staffConfig.routerKey];
  if (key.length !== 32 || key.toString('base64') !== env.ATLAS_MANUAL_SERVICE_KEY
    || staffKeys.some(other => !Buffer.isBuffer(other) || other.length !== 32 || key.equals(other)))
    deny(503, 'MANUAL_CONFIGURATION_INVALID');
  const proxy = createManualServiceProxy({ origin: origin.origin, key, timeoutMs: 210000, fetchImpl });
  return { uploadOrigin: uploadOrigin.origin, async handler(req, res) {
    // Next normally strips basePath; admitted gateway/minimal-server requests
    // may retain it. Verify the original ingress proof before forwarding one
    // exact normalized path. Unrelated fallback routes retain their own URL.
    const path = typeof req.url === 'string' && req.url.startsWith(`${STAFF_BASE_PATH}/`)
      ? req.url.slice(STAFF_BASE_PATH.length) : req.url;
    if (!isManualServicePath(path)) return false;
    await assertRequest(req);
    if (req.method !== 'GET' && req.method !== 'POST') deny(405, 'METHOD_NOT_ALLOWED');
    let body = req.body;
    if (req.method === 'POST') {
      assertWrite(req, staffConfig.origin);
      const csrf = req.headers['x-atlas-csrf'];
      if (typeof csrf !== 'string' || !csrf || csrf.length > 512) deny(403, 'CSRF_REQUIRED');
    } else {
      // Next can represent an absent GET body as {} or ''. Admit only that parser
      // representation after excluding declared, raw and unread body bytes.
      const empty = body == null || body === '' || Buffer.isBuffer(body) && body.length === 0
        || body && Object.getPrototypeOf(body) === Object.prototype && Reflect.ownKeys(body).length === 0;
      if (!empty || ![undefined, '0'].includes(req.headers['content-length'])
        || req.headers['transfer-encoding'] !== undefined
        || req.rawBody !== undefined && (!Buffer.isBuffer(req.rawBody) || req.rawBody.length !== 0)
        || req.readableLength > 0) deny(400, 'MANUAL_REQUEST_INVALID');
      body = undefined;
    }
    await auth.authenticate(req.headers.cookie ?? '', req.method === 'POST' ? req.headers['x-atlas-csrf'] : undefined);
    return proxy({ method: req.method, url: path, headers: req.headers, body,
      once: req.once?.bind(req), removeListener: req.removeListener?.bind(req) }, res);
  } };
}
