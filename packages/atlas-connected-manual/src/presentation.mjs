import sharp from 'sharp';
import { digest, requireThat } from '@atlas/manual-service/contract';
import { descriptorSha256, parseDerivative } from '@atlas/photo-core';
import { verification } from '@atlas/manual-intake/contract';

// One real photo, retained byte-for-byte. The public copy is an explicitly
// separate, orientation-correct SDR display derivative; it is not grade evidence.
export async function preparePresentationPhoto({ upload, storage, processPhoto, keyPrefix, signal }) {
  let original;
  try { original = await storage.readOriginal({ uploadPlan: upload.plan, signal }); }
  catch (error) { if (error?.code === 'PHOTO_OBJECT_NOT_FOUND') requireThat(false, 409, 'PRESENTATION_UPLOAD_ABSENT'); throw error; }
  const verified = verification({ object: original.object, sha256: original.sha256, byteCount: original.byteCount, contentType: original.contentType }, upload.plan);
  const photo = await processPhoto({ uploadPlan: upload.plan, verification: verified, bytes: original.bytes, signal });
  const frame = photo.workingFrame, source = { frame, original: photo.original, decodePlan: photo.decodePlan };
  const working = await storage.readDecodedFrame({ ...source, signal });
  signal?.throwIfAborted();
  const settings = { format: 'webp', quality: 90, maximumDimension: 2400, withoutEnlargement: true };
  const { data: bytes, info } = await sharp(working.bytes, { limitInputPixels: 52_000_000 }).resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: settings.quality }).toBuffer({ resolveWithObject: true });
  signal?.throwIfAborted();
  const sha256 = digest(bytes), dimensions = { width: info.width, height: info.height };
  requireThat(bytes.length > 0 && bytes.length <= 12 * 1024 * 1024, 413, 'PRESENTATION_PHOTO_TOO_LARGE');
  const scaleX = dimensions.width / frame.raster.dimensions.width, scaleY = dimensions.height / frame.raster.dimensions.height;
  const proposed = parseDerivative({ schemaVersion: 1, kind: 'derivative', id: `presentation-${upload.id}-${sha256}`, purpose: 'preview',
    originalDescriptorSha256: frame.originalDescriptorSha256, frameDescriptorSha256: descriptorSha256(frame),
    raster: { content: { mime: 'image/webp', sha256, byteCount: bytes.length }, dimensions,
      object: { key: `${keyPrefix}/derived/${upload.plan.binding.cardId}/${upload.id}/presentation-${sha256}.webp`, versionId: null } },
    frameToDerivative: [scaleX, 0, (scaleX - 1) / 2, 0, scaleY, (scaleY - 1) / 2, 0, 0, 1],
    encoder: { name: 'sharp-webp', version: sharp.versions.sharp, settingsSha256: descriptorSha256(settings) } }, frame, photo.original, photo.decodePlan);
  const descriptor = await storage.writeDerivative({ ...source, descriptor: proposed, bytes, signal });
  return { descriptor: { sha256, byteCount: bytes.length, contentType: 'image/webp', ...dimensions, alt: upload.request.alt.trim() },
    media: { ...source, descriptor } };
}

export function createPresentationService({ repository, storage, processPhoto, keyPrefix, run = work => work(), timeoutMs = 120000 }) {
  return Object.freeze({
    status: (staff, cardId) => repository.status(staff, cardId),
    plan: (staff, cardId, input) => repository.plan(staff, cardId, input),
    async sign(staff, cardId, uploadId) {
      const { upload, done } = await repository.loadUpload(staff, cardId, uploadId);
      if (done) return { state: 'COMPLETE', ...done };
      const result = await storage.createOriginalUpload({ uploadPlan: upload.plan, expiresIn: 300, signal: AbortSignal.timeout(15000) });
      await repository.loadUpload(staff, cardId, uploadId);
      return { state: 'UPLOAD', ...result };
    },
    complete: (staff, cardId, uploadId) => run(async () => {
      const { upload, done } = await repository.loadUpload(staff, cardId, uploadId);
      if (done) return done;
      const photo = await preparePresentationPhoto({ upload, storage, processPhoto, keyPrefix, signal: AbortSignal.timeout(timeoutMs) });
      return repository.commit(staff, cardId, { requestId: upload.request.requestId, approvalActionId: upload.request.approvalActionId,
        expectedRevision: upload.request.expectedRevision }, photo);
    }),
    remove: (staff, cardId, input) => repository.commit(staff, cardId, input),
  });
}
