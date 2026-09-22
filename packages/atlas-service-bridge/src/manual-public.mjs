import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { canonical, keys, requireBridge, SHA, UUID } from './protocol.mjs';
import { boundedBytes } from './transport.mjs';

export const MANUAL_PUBLIC_ORIGIN = 'https://private.atlasgrading.com';
export const MANUAL_PUBLIC_PATH = '/api/internal/atlas/manual-public';
export const MANUAL_PUBLIC_TTL_MS = 30000;
export const MANUAL_PUBLIC_MAX_JSON = 16 * 1024 * 1024 + 4096;
const purpose = 'atlas-approved-manual-public-read-v1';
function key(value) { requireBridge(Buffer.isBuffer(value) && value.length === 32, 'MANUAL_PUBLIC_CONFIGURATION_INVALID'); return value; }
function selector(value) {
  keys(value, ['kind', 'token', 'version', 'side', 'findingId']);
  requireBridge(['REPORT','IMAGE','TRACE'].includes(value.kind) && /^ar_[A-Za-z0-9_-]{24}$/.test(value.token)
    && (value.kind === 'REPORT' && value.version === null || Number.isSafeInteger(value.version) && value.version > 0 && value.version <= 2147483647)
    && (value.kind === 'IMAGE' ? ['FRONT','BACK'].includes(value.side) : value.side === null)
    && (value.kind === 'TRACE' ? typeof value.findingId === 'string' && value.findingId.length > 0 && value.findingId.length <= 180 : value.findingId === null),
  'MANUAL_PUBLIC_REQUEST_INVALID');
}
export function signManualPublicRequest(config, request, now = Date.now()) {
  requireBridge(config.manualOrigin === MANUAL_PUBLIC_ORIGIN, 'MANUAL_PUBLIC_CONFIGURATION_INVALID');
  selector(request);
  const claims = { purpose, method: 'POST', path: MANUAL_PUBLIC_PATH, audience: MANUAL_PUBLIC_ORIGIN,
    deploymentId: config.deploymentId, releaseSha: config.releaseSha, configHash: config.configHash,
    request, issuedAt: now, expiresAt: now + MANUAL_PUBLIC_TTL_MS, nonce: randomUUID() };
  const body = canonical(claims), signature = createHmac('sha256', key(config.manualKey)).update(body).digest('hex');
  verifyManualPublicRequest({ key: config.manualKey }, body, signature, now);
  return { body, signature };
}
export function verifyManualPublicRequest(config, body, signature, now = Date.now()) {
  requireBridge(typeof body === 'string' && Buffer.byteLength(body) <= 4096 && typeof signature === 'string' && SHA.test(signature), 'MANUAL_PUBLIC_AUTH_REQUIRED');
  requireBridge(timingSafeEqual(createHmac('sha256', key(config.key)).update(body).digest(), Buffer.from(signature, 'hex')), 'MANUAL_PUBLIC_AUTH_REQUIRED');
  const c = JSON.parse(body);
  keys(c, ['purpose','method','path','audience','deploymentId','releaseSha','configHash','request','issuedAt','expiresAt','nonce']);
  requireBridge(canonical(c) === body && c.purpose === purpose && c.method === 'POST' && c.path === MANUAL_PUBLIC_PATH && c.audience === MANUAL_PUBLIC_ORIGIN
    && typeof c.deploymentId === 'string' && /^[a-z0-9-]+\.vercel\.app$/.test(c.deploymentId)
    && typeof c.releaseSha === 'string' && /^[a-f0-9]{40}$/.test(c.releaseSha) && typeof c.configHash === 'string' && SHA.test(c.configHash)
    && Number.isSafeInteger(c.issuedAt) && Number.isSafeInteger(c.expiresAt) && c.issuedAt <= now && c.expiresAt > now
    && c.expiresAt - c.issuedAt === MANUAL_PUBLIC_TTL_MS && typeof c.nonce === 'string' && UUID.test(c.nonce), 'MANUAL_PUBLIC_AUTH_REQUIRED');
  selector(c.request); return c;
}
export function manualPublicClient(config, fetchImpl = fetch) {
  requireBridge(config.manualOrigin === MANUAL_PUBLIC_ORIGIN, 'MANUAL_PUBLIC_CONFIGURATION_INVALID'); key(config.manualKey);
  return Object.freeze({ async read(request) {
    const signed = signManualPublicRequest(config, request);
    const response = await fetchImpl(`${MANUAL_PUBLIC_ORIGIN}${MANUAL_PUBLIC_PATH}`, { method: 'POST', redirect: 'error',
      headers: { 'content-type':'application/json', 'x-atlas-manual-public-signature': signed.signature }, body: signed.body, signal: AbortSignal.timeout(25000) });
    if (response.status === 404) return null;
    requireBridge(response.status === 200, 'MANUAL_PUBLIC_UNAVAILABLE');
    const expected = request.kind === 'IMAGE' ? 'image/webp' : 'application/json';
    requireBridge(response.headers.get('content-type')?.split(';')[0] === expected, 'MANUAL_PUBLIC_UNAVAILABLE');
    const bytes = await boundedBytes(response, request.kind === 'IMAGE' ? 50 * 1024 * 1024 : MANUAL_PUBLIC_MAX_JSON);
    return request.kind === 'IMAGE' ? bytes : JSON.parse(bytes.toString('utf8'));
  } });
}
