// Closed display projection, never proof of ownership. The server's separate
// owner reader establishes current title; the public packet supplies evidence.
export const COLLECTION_DISPLAY_LIMITS = Object.freeze({ metadataBytes: 16384, packetBytes: 8 * 1024 * 1024, imageBytes: 2 * 1024 * 1024, timeoutMs: 25000, concurrent: 2 });
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
export const displayError = (code = 'COLLECTION_DISPLAY_UNAVAILABLE', status = 503) => Object.assign(new Error(code), { code, status });
export const displayCheck = (ok, code, status) => { if (!ok) throw displayError(code, status); };
const fields = (v, names) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === names.length && names.every(k => Object.hasOwn(v, k));
const rev = v => Number.isSafeInteger(v) && v > 0 && v < 2147483647;
export function parseDisplayBinding(v) {
  displayCheck(fields(v, ['accountId', 'cardId', 'ownershipRevision', 'approvalActionId', 'certificateNumber', 'report'])
    && [v.accountId, v.cardId, v.approvalActionId].every(x => typeof x === 'string' && UUID.test(x)) && rev(v.ownershipRevision)
    && /^ATLAS-[A-F0-9]{12}$/.test(v.certificateNumber) && fields(v.report, ['publicToken', 'version', 'publicHash'])
    && /^ar_[A-Za-z0-9_-]{24}$/.test(v.report.publicToken) && rev(v.report.version) && SHA.test(v.report.publicHash));
  return { accountId: v.accountId, cardId: v.cardId, ownershipRevision: v.ownershipRevision, approvalActionId: v.approvalActionId,
    certificateNumber: v.certificateNumber, report: { publicToken: v.report.publicToken, version: v.report.version, publicHash: v.report.publicHash } };
}
export function collectionDisplayBinding(card, accountId) {
  displayCheck(card?.schema === 'atlas-owner-collection-card-v1' && card.ownership?.status === 'VERIFIED'
    && card.ownership.ownerAccountId === accountId, 'COLLECTION_DISPLAY_ACCESS_ENDED', 403);
  return parseDisplayBinding({ accountId, cardId: card.cardId, ownershipRevision: card.ownership.revision,
    approvalActionId: card.approvedCard?.approvalActionId, certificateNumber: card.approvedCard?.certificateNumber, report: card.approvedCard?.report });
}
export const displayBindingKey = v => JSON.stringify(parseDisplayBinding(v));
export function assertDisplayBinding(actual, expected) {
  displayCheck(displayBindingKey(actual) === displayBindingKey(expected), 'COLLECTION_DISPLAY_ACCESS_ENDED', 403);
}
export function displayPath(cardId) { displayCheck(UUID.test(cardId)); return `/account/api/customer/collection/cards/${cardId}/display`; }
export function displayFrontPath(binding) {
  const b = parseDisplayBinding(binding);
  // Account identity never comes from this query. Only an expected immutable
  // owner/report version is supplied; the cookie is authenticated independently.
  return `${displayPath(b.cardId)}/front?ownershipRevision=${b.ownershipRevision}&approvalActionId=${b.approvalActionId}&version=${b.report.version}&publicHash=${b.report.publicHash}`;
}
export function parseCollectionDisplay(v, expected) {
  displayCheck(fields(v, ['schema', 'binding', 'title', 'finalGrade', 'front']) && v.schema === 'atlas-collection-display-v1');
  const binding = parseDisplayBinding(v.binding); assertDisplayBinding(binding, expected);
  displayCheck(typeof v.title === 'string' && v.title.trim() === v.title && v.title.length > 0 && v.title.length <= 500 && !/[\u0000-\u001f\u007f]/.test(v.title)
    && Number.isFinite(v.finalGrade) && v.finalGrade >= 0 && v.finalGrade <= 10 && Number.isInteger(v.finalGrade * 2));
  const f = v.front;
  displayCheck(fields(f, ['status', 'provenance', 'sha256', 'byteCount', 'width', 'height', 'contentType', 'path'])
    && ['AVAILABLE', 'EXCEEDS_DISPLAY_LIMIT'].includes(f.status) && f.provenance === 'APPROVED_GRADING_PHOTOGRAPH'
    && SHA.test(f.sha256) && Number.isSafeInteger(f.byteCount) && f.byteCount > 0 && f.byteCount <= 50 * 1024 * 1024
    && f.width === 1350 && f.height === 1858 && f.contentType === 'image/webp'
    && (f.byteCount <= COLLECTION_DISPLAY_LIMITS.imageBytes ? f.status === 'AVAILABLE' && f.path === displayFrontPath(binding)
      : f.status === 'EXCEEDS_DISPLAY_LIMIT' && f.path === null));
  return { schema: v.schema, binding, title: v.title, finalGrade: v.finalGrade, front: { ...f } };
}
export function collectionDisplayLabel(v) { return { cardId: v.binding.cardId, approvalActionId: v.binding.approvalActionId, report: { ...v.binding.report }, title: v.title, finalGrade: v.finalGrade }; }

/** Header dimensions are checked in addition to the approved byte hash. This
 * is not a decoder: the mounted image must also decode at the exact dimensions.
 * Animated or malformed WebP containers are never admitted. */
export function verifyDisplayWebp(bytes, descriptor) {
  displayCheck(bytes instanceof Uint8Array && bytes.byteLength === descriptor.byteCount && bytes.byteLength <= COLLECTION_DISPLAY_LIMITS.imageBytes && bytes.byteLength >= 20);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), text = (i,n) => String.fromCharCode(...bytes.subarray(i,i+n));
  displayCheck(text(0,4) === 'RIFF' && text(8,4) === 'WEBP' && dv.getUint32(4,true) + 8 === bytes.length);
  let width, height, picture = false, offset = 12;
  const u24 = i => bytes[i] + bytes[i+1]*256 + bytes[i+2]*65536;
  while (offset < bytes.length) {
    displayCheck(offset + 8 <= bytes.length);
    const kind = text(offset,4), size = dv.getUint32(offset+4,true), p = offset+8, end = p+size;
    displayCheck(end <= bytes.length && !['ANIM','ANMF'].includes(kind));
    if (kind === 'VP8X') { displayCheck(size === 10 && !(bytes[p] & 2) && width === undefined); width = 1+u24(p+4); height = 1+u24(p+7); }
    if (kind === 'VP8 ' || kind === 'VP8L') {
      displayCheck(!picture); picture = true; let w,h;
      if (kind === 'VP8 ') { displayCheck(size >= 10 && text(p+3,3) === '\x9d\x01\x2a'); w = dv.getUint16(p+6,true)&0x3fff; h = dv.getUint16(p+8,true)&0x3fff; }
      else { displayCheck(size >= 5 && bytes[p] === 0x2f); const bits = dv.getUint32(p+1,true); w = 1+(bits&0x3fff); h = 1+((bits>>>14)&0x3fff); }
      displayCheck(width === undefined || width === w && height === h); width = w; height = h;
    }
    offset = end + (size%2);
  }
  displayCheck(offset === bytes.length && picture && width === descriptor.width && height === descriptor.height && width*height <= 52000000);
}
