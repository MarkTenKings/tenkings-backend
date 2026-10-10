import { canonical, digest, requireThat } from '@atlas/manual-service/contract';
import { variantBinding } from './variant-job-store.mjs';

export const VARIANT_SOURCE_PHOTO_POLICY = Object.freeze({ version: 'atlas-variant-photo-input-v1', maxDimension: 2048,
  maxInputPixels: 52_000_000, maxOutputBytes: 4 * 1024 * 1024, quality: 92, chromaSubsampling: '4:4:4' });

/** This image decode runs only in the separately constrained variant process.
 * The original card photographs and grading derivatives are never rewritten. */
export function createVariantSourcePhotoReader({ boundary, intake, workflow, storage, transform = null }) {
  const convert = transform ?? (async bytes => {
    const sharp = (await import('sharp')).default;
    return sharp(bytes, { limitInputPixels: VARIANT_SOURCE_PHOTO_POLICY.maxInputPixels, failOn: 'warning' })
      .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer();
  });
  return async (job, { signal } = {}) => {
    const staff = boundary.machineOwner({ ownerId: job.actor_id, accessVersion: job.access_version });
    const card = await workflow.service.read(staff, job.card_id), binding = variantBinding(card);
    requireThat(binding.sourceHash === job.input.sourceHash && binding.identityHash === job.input.identityHash
      && binding.identityRevision === job.input.identityRevision, 409, 'VARIANT_SOURCE_STALE');
    const pair = await intake.verifiedPair(staff, job.card_id);
    requireThat(pair.sourceHash === binding.sourceHash, 409, 'VARIANT_SOURCE_STALE');
    const result = { sourceHash: binding.sourceHash, policy: VARIANT_SOURCE_PHOTO_POLICY };
    for (const side of ['FRONT', 'BACK']) {
      signal?.throwIfAborted();
      const photo = pair.sides[side].photo;
      const found = await storage.readDecodedFrame({ frame: photo.workingFrame, original: photo.original, decodePlan: photo.decodePlan, signal });
      const bytes = await convert(found.bytes);
      signal?.throwIfAborted();
      requireThat(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= VARIANT_SOURCE_PHOTO_POLICY.maxOutputBytes, 413, 'VARIANT_IMAGES_TOO_LARGE');
      result[side] = { bytes, sha256: digest(bytes), mimeType: 'image/jpeg', originalSha256: photo.original.content.sha256,
        frameSha256: photo.workingFrame.raster.content.sha256 };
    }
    requireThat((await intake.verifiedPair(staff, job.card_id)).sourceHash === binding.sourceHash
      && canonical(variantBinding(await workflow.service.read(staff, job.card_id))) === canonical(binding), 409, 'VARIANT_SOURCE_STALE');
    return result;
  };
}
