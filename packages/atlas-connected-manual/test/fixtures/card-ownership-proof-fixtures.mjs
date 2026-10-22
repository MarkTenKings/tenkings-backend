import { createHash } from 'node:crypto';
import { ownershipProofPlanHash } from '../../src/card-ownership-proof-contract.mjs';
export const hash = b => createHash('sha256').update(b).digest('hex');
export const ids = Object.freeze(Object.fromEntries(['bundleId', 'objectId', 'accountId', 'cardId', 'approvalActionId'].map((k, i) => [k, `10000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`])));
export const now = Date.parse('2026-10-22T02:00:00.000Z');
export function plan(bytes = Buffer.from('synthetic private proof'), overrides = {}) {
  const value = { schema: 'atlas-ownership-proof-object-plan-v2', ...ids, approvalReportHash: 'a'.repeat(64), policyHash: 'b'.repeat(64),
    policyRevision: 1, uploadPolicyRevision: 1, bundleRevision: 1, objectRevision: 1, declaredType: 'image/png',
    byteCount: bytes.length, sha256: hash(bytes), key: `atlas-ownership-proof/v2/${ids.bundleId}/${ids.objectId}`,
    expiresAt: new Date(now + 300_000).toISOString(), ...overrides };
  return { ...value, planHash: ownershipProofPlanHash(value) };
}
export function validation(p) {
  return { recipe: 'atlas-ownership-original-photo-v1', decoderVersion: p.declaredType === 'image/heic'
    ? 'libheif-1.23.2/libde265-1.1.1' : 'sharp-0.33.5/libvips-8.15.3', mime: p.declaredType,
  width: 12, height: 10, pixels: 120, originalSha256: p.sha256, originalByteCount: p.byteCount };
}
export function found(p, bytes) {
  return { object: { key: p.key, versionId: 'version-1', etag: '"etag-1"' }, sha256: p.sha256,
    byteCount: p.byteCount, contentType: 'application/octet-stream', bytes: Buffer.from(bytes) };
}
