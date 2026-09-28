// Browser-safe transport contract. A grant never changes approved evidence.
export const INSPECTION_STORAGE_ORIGIN = 'https://atlas-grading-private-20260910.nyc3.digitaloceanspaces.com';
export const INSPECTION_PREVIEW_POLICY = 'atlas-inspection-preview-v1';
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const check = value => { if (!value) throw new Error('INSPECTION_ACCESS_INVALID'); };
function readUrl(value) {
  check(typeof value === 'string' && value.length <= 8192);
  const url = new URL(value);
  check(url.origin === INSPECTION_STORAGE_ORIGIN && !url.username && !url.password && !url.hash);
  return url.href;
}
export function parseInspectionPreview(value, sourceSha256) {
  check(value && value.policyVersion === INSPECTION_PREVIEW_POLICY && value.sourceSha256 === sourceSha256
    && sha(sourceSha256) && sha(value.sha256) && value.mime === 'image/jpeg'
    && Number.isSafeInteger(value.byteCount) && value.byteCount > 0 && value.byteCount <= 1024 * 1024
    && Number.isSafeInteger(value.width) && Number.isSafeInteger(value.height)
    && value.width > 0 && value.height > 0 && Math.max(value.width, value.height) <= 768
    && Math.abs(value.width * 1858 - value.height * 1350) <= 1858);
  return { url: readUrl(value.url), sha256: value.sha256, byteCount: value.byteCount,
    mime: value.mime, width: value.width, height: value.height, sourceSha256, policyVersion: INSPECTION_PREVIEW_POLICY };
}
export function parseInspectionAccess(value, expected = {}) {
  check(value?.version === 'atlas-approved-image-access-v1' && /^ar_[A-Za-z0-9_-]{24}$/.test(value.publicToken)
    && Number.isSafeInteger(value.approvalVersion) && value.approvalVersion > 0 && value.approvalVersion <= 2147483647
    && sha(value.publicHash) && ['FRONT', 'BACK'].includes(value.side));
  for (const key of ['publicToken', 'approvalVersion', 'publicHash', 'side'])
    if (expected[key] !== undefined) check(value[key] === expected[key]);
  const image = value.image;
  check(image && sha(image.sha256) && image.mime === 'image/webp' && image.width === 1350 && image.height === 1858
    && Number.isSafeInteger(image.byteCount) && image.byteCount > 0 && image.byteCount <= 50 * 1024 * 1024);
  if (expected.sha256 !== undefined) check(image.sha256 === expected.sha256);
  if (expected.byteCount !== undefined) check(image.byteCount === expected.byteCount);
  return { version: value.version, publicToken: value.publicToken, approvalVersion: value.approvalVersion,
    publicHash: value.publicHash, side: value.side, image: { url: readUrl(image.url), sha256: image.sha256,
      byteCount: image.byteCount, mime: image.mime, width: image.width, height: image.height,
      ...(image.preview ? { preview: parseInspectionPreview(image.preview, image.sha256) } : {}) } };
}
