import { createHash } from 'node:crypto';
export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const SIDES = ['FRONT', 'BACK'];
export const MAX_PHOTO_BYTES = 64 * 1024 * 1024;
export class CustomerIntakeError extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }
export const requireThat = (ok, status = 400, code = 'INVALID_INTAKE') => { if (!ok) throw new CustomerIntakeError(status, code); };
export const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
export const digest = value => createHash('sha256').update(value).digest('hex');
export function object(value, fields) { requireThat(value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key))); }
export function uuid(value) { requireThat(typeof value === 'string' && UUID.test(value)); return value; }
export function revision(value) { requireThat(Number.isSafeInteger(value) && value > 0 && value < 2147483647); return value; }
function string(value, maximum, required = false) { requireThat(typeof value === 'string' && value.length <= maximum && !/[\x00-\x1f\x7f]/.test(value) && (!required || value.trim().length > 0)); return value.trim(); }
export function createInput(value) {
  object(value, ['requestId', 'intakeMethod', 'kioskId']); uuid(value.requestId);
  requireThat(['MAIL_IN', 'DEALER_DROP_OFF'].includes(value.intakeMethod));
  if (value.intakeMethod === 'MAIL_IN') requireThat(value.kioskId === null); else uuid(value.kioskId);
  return structuredClone(value);
}
export function cardInput(value) {
  object(value, ['requestId', 'cardId', 'pairId', 'front', 'back']); ['requestId', 'cardId', 'pairId'].forEach(key => uuid(value[key]));
  const result = structuredClone(value);
  for (const side of ['front', 'back']) {
    const photo = result[side]; object(photo, ['uploadId', 'sha256', 'byteCount', 'fileName']); uuid(photo.uploadId);
    requireThat(typeof photo.sha256 === 'string' && /^[a-f0-9]{64}$/.test(photo.sha256) && Number.isSafeInteger(photo.byteCount) && photo.byteCount > 0 && photo.byteCount <= MAX_PHOTO_BYTES);
    photo.fileName = string(photo.fileName, 240);
  }
  requireThat(result.front.uploadId !== result.back.uploadId && result.front.sha256 !== result.back.sha256, 400, 'DISTINCT_CARD_SIDES_REQUIRED');
  return result;
}
export const IDENTITY_FIELDS = ['category', 'title', 'playerName', 'year', 'manufacturer', 'setName', 'cardNumber', 'parallel', 'insert'];
export function identityInput(value) {
  object(value, IDENTITY_FIELDS); requireThat(['SPORTS', 'POKEMON'].includes(value.category));
  return Object.fromEntries(IDENTITY_FIELDS.map(key => [key, string(value[key], 180, ['category', 'title'].includes(key))]));
}
export function ownedUpload(value) {
  requireThat(value && UUID.test(value.accountId) && UUID.test(value.draftId) && UUID.test(value.cardId) && UUID.test(value.pairId) && SIDES.includes(value.side), 503, 'INTAKE_STORED_CONTENT_INVALID');
  const plan = value.plan;
  requireThat(plan?.schemaVersion === 1 && UUID.test(plan.uploadId) && plan.binding?.cardId === value.cardId && plan.binding.pairId === value.pairId && plan.binding.side === value.side && plan.binding.version === 1
    && plan.object?.key === `atlas-customer/originals/${value.accountId}/${value.cardId}/${plan.uploadId}` && plan.object.versionId === null
    && /^[a-f0-9]{64}$/.test(plan.expected?.sha256 ?? '') && Number.isSafeInteger(plan.expected?.byteCount) && plan.expected.byteCount > 0 && plan.expected.byteCount <= MAX_PHOTO_BYTES,
  503, 'INTAKE_STORED_CONTENT_INVALID');
  return value;
}
