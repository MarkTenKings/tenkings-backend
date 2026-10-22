// Unregistered adapter. No runtime, credentials, SQL, grants or storage client.
import { deny, privateHeaders, UUID } from './policy.mjs';
import { claimLifecycleInput, parseClaimConfiguration, parseClaimLifecycle, parseClaimTarget } from '../ownership-claim-submission-client.mjs';

const PREFIX = '/api/customer/ownership/';
const READS = { claim: ['read_claim', 'claimId'], bundle: ['read_bundle', 'bundleId'], request: ['recover_request', 'requestId'] };
const WRITES = { reserve: 'reserve_bundle', submit: 'submit_claim', withdraw: 'withdraw_claim', replace: 'replace_evidence' };
const HASH = /^[a-f0-9]{64}$/;
const plain = v => v && Object.getPrototypeOf(v) === Object.prototype;
const closed = (v, keys) => plain(v) && Reflect.ownKeys(v).length === keys.length
  && keys.every(k => Object.hasOwn(Object.getOwnPropertyDescriptor(v, k) ?? {}, 'value'));
const invalid = () => deny(400, 'INVALID_OWNERSHIP_REQUEST');
const unavailable = () => deny(503, 'OWNERSHIP_CLAIMS_UNAVAILABLE');

export function parseOwnershipClaimRoute(method, rawUrl, body) {
  if (typeof rawUrl !== 'string' || rawUrl.length > 240 || /[%#\s\\]/.test(rawUrl)) invalid();
  const [path, query, extra] = rawUrl.split('?');
  if (!path.startsWith(PREFIX) || path.slice(PREFIX.length).includes('/')) deny(404, 'NOT_FOUND');
  const name = path.slice(PREFIX.length);
  const verb = ['target', 'configuration', ...Object.keys(READS)].includes(name) ? 'GET'
    : Object.hasOwn(WRITES, name) || ['sign', 'complete'].includes(name) ? 'POST' : null;
  if (!verb) deny(404, 'NOT_FOUND');
  if (method !== verb) deny(405, 'METHOD_NOT_ALLOWED');
  if (extra !== undefined || query === '' || (verb === 'POST' && query !== undefined)) invalid();
  if (verb === 'GET') {
    const params = new URLSearchParams(query);
    if (query !== undefined && params.toString() !== query) invalid();
    const key = name === 'target' ? 'certificateNumber' : READS[name]?.[1];
    if (key ? [...params.keys()].length !== 1 || params.getAll(key).length !== 1 : params.size !== 0) invalid();
    const input = key ? { [key]: params.get(key) } : {};
    if (name === 'target' ? !/^ATLAS-[A-F0-9]{12}$/.test(input.certificateNumber ?? '') : key && !UUID.test(input[key] ?? '')) invalid();
    return { name, input, action: READS[name]?.[0], writing: false };
  }
  if (!plain(body)) invalid();
  if (Buffer.byteLength(JSON.stringify(body)) > 8192) deny(413, 'REQUEST_TOO_LARGE');
  if (Object.hasOwn(WRITES, name)) {
    try { return { name, input: claimLifecycleInput(WRITES[name], body), action: WRITES[name], writing: true }; } catch { invalid(); }
  }
  if (!closed(body, ['bundleId', 'objectId']) || !UUID.test(body.bundleId ?? '') || !UUID.test(body.objectId ?? '')) invalid();
  return { name, input: { ...body }, writing: true };
}

function proofResponse(value, route, boundary) {
  const common = ['schema', 'accountId', 'bundleId', 'objectId', 'byteCount', 'sha256'];
  const fields = route.name === 'sign' ? [...common, 'planHash', 'method', 'url', 'headers', 'expiresIn'] : [...common, 'state', 'declaredType'];
  if (!closed(value, fields) || !UUID.test(value.accountId ?? '') || value.bundleId !== route.input.bundleId
    || value.objectId !== route.input.objectId || !HASH.test(value.sha256 ?? '') || !Number.isSafeInteger(value.byteCount)
    || value.byteCount < 1 || value.byteCount > 20971520) unavailable();
  if (route.name === 'complete') {
    if (value.schema !== 'atlas-ownership-proof-retained-v2' || value.state !== 'RETAINED' || !['image/jpeg', 'image/png', 'image/heic'].includes(value.declaredType)) unavailable();
  } else {
    const headers = ['content-type', 'if-none-match', 'x-amz-checksum-sha256', 'x-amz-meta-atlas-kind', 'x-amz-meta-atlas-binding-sha256'];
    let url; try { url = new URL(value.url); } catch { unavailable(); }
    if (value.schema !== 'atlas-ownership-proof-put-v2' || value.method !== 'PUT' || !HASH.test(value.planHash ?? '')
      || !Number.isSafeInteger(value.expiresIn) || value.expiresIn < 1 || value.expiresIn > 300
      || !boundary || url.protocol !== 'https:' || url.origin !== boundary.origin || url.username || url.password || url.hash
      || url.pathname !== `${boundary.pathPrefix}atlas-ownership-proof/v2/${value.bundleId}/${value.objectId}`
      || !closed(value.headers, headers) || value.headers['content-type'] !== 'application/octet-stream'
      || value.headers['if-none-match'] !== '*' || value.headers['x-amz-meta-atlas-kind'] !== 'ownership-proof-v2'
      || value.headers['x-amz-meta-atlas-binding-sha256'] !== value.planHash
      || value.headers['x-amz-checksum-sha256'] !== Buffer.from(value.sha256, 'hex').toString('base64')) unavailable();
  }
  return structuredClone(value);
}

/** Customer-only capabilities are injected by a future trusted composition.
 * readAccess(cookie) is a separately restricted LIVE SQL session reader, not
 * cookie parsing, bootstrap, a browser account or a cached policy snapshot.
 * resolveTarget/configuration must be live account-bound readers; the old v1
 * workflow reader is NOT a v2 lifecycle resolver. No history/queue is exposed.
 * SQL/services retain live authorization and policy authority. Cookie parsing
 * alone neither identifies the account nor enables ownership operations.
 */
export function createOwnershipClaimsHandler(resolveState) {
  return async (req, res) => {
    privateHeaders(res);
    const controller = new AbortController(), abort = () => controller.abort();
    const closedEarly = () => { if (!res.writableEnded) abort(); };
    req.once?.('aborted', abort); res.once?.('close', closedEarly);
    try {
      if (req.aborted) unavailable();
      const state = typeof resolveState === 'function' ? await resolveState() : resolveState;
      if (typeof state?.assertRequest !== 'function' || typeof state.auth?.authority !== 'function' || typeof state.config?.origin !== 'string') unavailable();
      state.assertRequest(req);
      const headers = req.headers ?? {};
      if (headers.authorization !== undefined) deny(403, 'CUSTOMER_COOKIE_REQUIRED');
      const route = parseOwnershipClaimRoute(req.method, req.url, req.body);
      if (route.writing) {
        if (headers.origin !== state.config.origin || !/^application\/json(?:;\s*charset=utf-8)?$/i.test(headers['content-type'] ?? '')
          || headers['sec-fetch-site'] && headers['sec-fetch-site'] !== 'same-origin') deny(403, 'ORIGIN_NOT_ALLOWED');
        if (headers['content-encoding'] !== undefined || headers['transfer-encoding'] !== undefined) invalid();
        if (headers['content-length'] !== undefined && (!/^(0|[1-9][0-9]*)$/.test(headers['content-length']) || Number(headers['content-length']) > 8192)) deny(413, 'REQUEST_TOO_LARGE');
      } else {
        const empty = req.body === undefined || req.body === null || req.body === '' || closed(req.body, []);
        if (!empty || headers['transfer-encoding'] !== undefined || headers['content-length'] !== undefined && headers['content-length'] !== '0') invalid();
        if (headers['sec-fetch-site'] && !['same-origin', 'none'].includes(headers['sec-fetch-site'])
          || headers.origin !== undefined && headers.origin !== state.config.origin) deny(403, 'ORIGIN_NOT_ALLOWED');
      }
      const cookie = headers.cookie, csrf = route.writing ? headers['x-atlas-customer-csrf'] ?? '' : undefined;
      state.auth.authority(cookie, csrf);
      const capabilities = state.ownershipClaims;
      if (typeof capabilities?.readAccess !== 'function') unavailable();
      const readAccess = capabilities.readAccess.bind(capabilities);
      const access = async () => {
        const value = await readAccess(cookie);
        if (!closed(value, ['schema', 'accountId']) || value.schema !== 'atlas-ownership-customer-access-v1' || !UUID.test(value.accountId ?? '')) unavailable();
        return value.accountId;
      };
      const accountId = await access();
      let value;
      if (route.name === 'configuration') {
        if (typeof capabilities?.configuration !== 'function') unavailable();
        value = await capabilities.configuration(cookie);
        value = parseClaimConfiguration(value, accountId);
      } else if (route.name === 'target') {
        if (typeof capabilities?.resolveTarget !== 'function') unavailable();
        value = await capabilities.resolveTarget(cookie, route.input);
        value = parseClaimTarget(value, accountId, route.input.certificateNumber);
      } else if (route.action) {
        if (typeof capabilities?.lifecycle?.call !== 'function') unavailable();
        value = await capabilities.lifecycle.call(cookie, csrf, route.action, route.input);
        value = parseClaimLifecycle(value, accountId, route.action, route.input);
      } else {
        if (typeof capabilities?.proof?.[route.name] !== 'function') unavailable();
        value = await capabilities.proof[route.name](cookie, csrf, route.input, { signal: controller.signal });
        value = proofResponse(value, route, capabilities.uploadBoundary);
      }
      if (value.accountId !== accountId || await access() !== accountId) unavailable();
      res.status(200).json(value);
    } catch (error) {
      // A status/code is not an account-bound rollback witness. Never emit the
      // optional CONFIRMED_REFUSAL schema or infer a failed write did not commit.
      const codes = { SIGN_IN_REQUIRED: 401, CSRF_REQUIRED: 403, CUSTOMER_COOKIE_REQUIRED: 403, ORIGIN_NOT_ALLOWED: 403,
        INVALID_COOKIE: 400, INVALID_OWNERSHIP_REQUEST: 400, REQUEST_TOO_LARGE: 413, NOT_FOUND: 404, METHOD_NOT_ALLOWED: 405 };
      let status = codes[error?.code], code = status ? error.code : 'OWNERSHIP_CLAIMS_UNAVAILABLE';
      if (!status && [401, 403, 404, 409, 429].includes(error?.status)) {
        status = error.status; code = status === 401 ? 'SIGN_IN_REQUIRED' : status === 403 ? 'OWNERSHIP_ACCESS_ENDED'
          : status === 404 ? 'OWNERSHIP_NOT_FOUND' : status === 409 ? 'OWNERSHIP_CONFLICT' : 'OWNERSHIP_LIMIT_REACHED';
      }
      res.status(status ?? 503).json({ error: code });
    } finally { req.removeListener?.('aborted', abort); res.removeListener?.('close', closedEarly); }
  };
}
