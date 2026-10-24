// Browser-safe transport contract. A grant never changes approved evidence.
export const INSPECTION_STORAGE_ORIGIN = 'https://atlas-grading-private-20260910.nyc3.digitaloceanspaces.com';
export const INSPECTION_PREVIEW_POLICY = 'atlas-inspection-preview-v1';
export const INSPECTION_ALPHA_PREVIEW_POLICY = 'atlas-inspection-alpha-preview-v1';
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const check = value => { if (!value) throw new Error('INSPECTION_ACCESS_INVALID'); };
function readUrl(value) {
  check(typeof value === 'string' && value.length <= 8192);
  const url = new URL(value);
  check(url.origin === INSPECTION_STORAGE_ORIGIN && !url.username && !url.password && !url.hash);
  return url.href;
}
function parsePreview(value, sourceSha256, policyVersion, mime) {
  check(value && value.policyVersion === policyVersion && value.sourceSha256 === sourceSha256
    && sha(sourceSha256) && sha(value.sha256) && value.mime === mime
    && Number.isSafeInteger(value.byteCount) && value.byteCount > 0 && value.byteCount <= 1024 * 1024
    && Number.isSafeInteger(value.width) && Number.isSafeInteger(value.height)
    && value.width > 0 && value.height > 0 && Math.max(value.width, value.height) <= 768
    && Math.abs(value.width * 1858 - value.height * 1350) <= 1858);
  return { url: readUrl(value.url), sha256: value.sha256, byteCount: value.byteCount,
    mime: value.mime, width: value.width, height: value.height, sourceSha256, policyVersion };
}
export function parseInspectionPreview(value, sourceSha256) {
  return parsePreview(value, sourceSha256, INSPECTION_PREVIEW_POLICY, 'image/jpeg');
}
export function parseInspectionAlphaPreview(value, sourceSha256) {
  return parsePreview(value, sourceSha256, INSPECTION_ALPHA_PREVIEW_POLICY, 'image/webp');
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
  if (image.alphaPreviewPending !== undefined) check(typeof image.alphaPreviewPending === 'boolean'
    && !(image.alphaPreviewPending && image.alphaPreview));
  return { version: value.version, publicToken: value.publicToken, approvalVersion: value.approvalVersion,
    publicHash: value.publicHash, side: value.side, image: { url: readUrl(image.url), sha256: image.sha256,
      byteCount: image.byteCount, mime: image.mime, width: image.width, height: image.height,
      ...(image.preview ? { preview: parseInspectionPreview(image.preview, image.sha256) } : {}),
      ...(image.alphaPreviewPending !== undefined ? { alphaPreviewPending: image.alphaPreviewPending } : {}),
      ...(image.alphaPreview ? { alphaPreview: parseInspectionAlphaPreview(image.alphaPreview, image.sha256) } : {}) } };
}

// Full-resolution Photoroom presentation is separate from canonical inspection
// media. Only a short-lived grant crosses the public service bridge.
export function parseReportImageAccess(value, expected = {}) {
  check(value?.version === 'atlas-approved-report-image-access-v1' && value.execution === 'PHOTOROOM_PLUS_API'
    && /^ar_[A-Za-z0-9_-]{24}$/.test(value.publicToken)
    && Number.isSafeInteger(value.approvalVersion) && value.approvalVersion > 0 && value.approvalVersion <= 2147483647
    && sha(value.publicHash) && ['FRONT', 'BACK'].includes(value.side));
  for (const key of ['publicToken', 'approvalVersion', 'publicHash', 'side'])
    if (expected[key] !== undefined) check(value[key] === expected[key]);
  const image = value.image;
  check(image && sha(image.sha256) && image.mime === 'image/png'
    && Number.isSafeInteger(image.width) && image.width >= 2 && image.width <= 5000
    && Number.isSafeInteger(image.height) && image.height >= 2 && image.height <= 5000
    && image.width * image.height <= 25_000_000
    && Number.isSafeInteger(image.byteCount) && image.byteCount > 0 && image.byteCount <= 101 * 1024 * 1024);
  for (const key of ['sha256', 'byteCount', 'width', 'height'])
    if (expected[key] !== undefined) check(image[key] === expected[key]);
  return { version: value.version, execution: value.execution, publicToken: value.publicToken,
    approvalVersion: value.approvalVersion, publicHash: value.publicHash, side: value.side,
    image: { url: readUrl(image.url), sha256: image.sha256, byteCount: image.byteCount,
      mime: image.mime, width: image.width, height: image.height } };
}
