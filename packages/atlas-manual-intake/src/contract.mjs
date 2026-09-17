import { canonical, digest, immutable, object, requireThat, uuid } from '@atlas/manual-service/contract';
import { completeUpload, descriptorSha256, parseDecodedFrame, parseUploadPlan } from '@atlas/photo-core';
export { canonical, digest, immutable, object, requireThat, uuid };
export function integer(value, minimum = 0) { requireThat(Number.isSafeInteger(value) && value >= minimum && value < 2147483647); return value; }
export function hash(value) { requireThat(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)); return value; }
export function createInput(value) {
  object(value, ['requestId', 'label']); uuid(value.requestId);
  requireThat(typeof value.label === 'string' && value.label.length <= 120 && !/[\x00-\x1f\x7f]/.test(value.label));
  return immutable({ requestId: value.requestId, label: value.label.trim() });
}
export function planInput(value) {
  object(value, ['requestId', 'side', 'expectedVersion', 'sha256', 'byteCount']); uuid(value.requestId);
  requireThat(['FRONT', 'BACK'].includes(value.side)); integer(value.expectedVersion); hash(value.sha256); integer(value.byteCount, 1);
  return immutable(structuredClone(value));
}
export const document = value => { const text = canonical(value); return { text, hash: digest(text), value: JSON.parse(text) }; };
export function storedDocument(text, expectedHash) {
  requireThat(typeof text === 'string' && digest(text) === expectedHash, 503, 'INTAKE_STORED_CONTENT_INVALID');
  return JSON.parse(text);
}
export function verification(value, planValue) {
  const plan = parseUploadPlan(planValue);
  object(value, ['object', 'sha256', 'byteCount', 'contentType']); object(value.object, ['key', 'versionId']);
  requireThat(value.object.key === plan.object.key && (value.object.versionId === null || typeof value.object.versionId === 'string'
    && value.object.versionId.length > 0 && value.object.versionId.length <= 512 && !/[\x00-\x1f\x7f]/.test(value.object.versionId))
    && value.sha256 === plan.expected.sha256 && value.byteCount === plan.expected.byteCount
    && value.contentType === 'application/octet-stream', 409, 'INTAKE_UPLOAD_CONFLICT');
  return immutable(structuredClone(value));
}
export function processedPhoto(value, plan, verified) {
  object(value, ['original', 'decodePlan', 'decodedFrame', 'workingFrame']);
  completeUpload(plan, value.original);
  requireThat(canonical(value.original.object) === canonical(verified.object), 409, 'INTAKE_UPLOAD_CONFLICT');
  parseDecodedFrame(value.decodedFrame, value.original, value.decodePlan);
  parseDecodedFrame(value.workingFrame, value.original, value.decodePlan);
  requireThat(value.workingFrame.treatment.colorSpace === 'sRGB' && value.workingFrame.treatment.bitDepth === 8
    && value.workingFrame.treatment.channels === 3, 409, 'INTAKE_WORKING_FRAME_INVALID');
  requireThat(value.workingFrame.schemaVersion === 2 && value.workingFrame.raster.object.key !== value.decodedFrame.raster.object.key
    && canonical(value.workingFrame.workingImage.sourceRaster) === canonical({ content: value.decodedFrame.raster.content,
      dimensions: value.decodedFrame.raster.dimensions })
    && canonical(value.workingFrame.workingImage.sourceTreatment) === canonical(value.decodedFrame.treatment),
  409, 'INTAKE_WORKING_FRAME_INVALID');
  return immutable(structuredClone(value));
}
export function photoSourceHash(upload) {
  return descriptorSha256({ plan: upload.plan, verification: upload.verification });
}
export function requireOwner(row, principal, edit = false) {
  requireThat(row && row.owner_id === principal.id, 404, 'INTAKE_CARD_NOT_FOUND');
  if (edit) requireThat(principal.role === 'REVIEWER', 403, 'INTAKE_CARD_ACCESS_DENIED');
}
