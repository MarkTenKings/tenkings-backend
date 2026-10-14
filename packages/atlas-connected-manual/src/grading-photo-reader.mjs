import { digest, requireThat } from '@atlas/manual-service/contract';
import { parseDecodedFrame } from '@atlas/photo-core';
import { reportImageRejection } from './report-image-retry.mjs';

/** Reading the saved grading image never constructs an image provider, starts
 * discovery or exposes a queue mutation. Both serving and isolated review use
 * the same immutable image and source checks. */
export function createGradingPhotoReader({ photo: readPhoto, storage }) {
  requireThat(typeof readPhoto === 'function' && typeof storage?.readDecodedFrame === 'function', 503, 'GRADING_IMAGE_NOT_CONFIGURED');
  return Object.freeze({
    async photoStatus({ cardId, uploadId, side }) {
      const job = await readPhoto(cardId, uploadId, side);
      if (!job) return { state: 'WAITING', code: null };
      requireThat(['QUEUED', 'RUNNING', 'REQUESTED', 'READY', 'FAILED', 'UNKNOWN'].includes(job.state), 503, 'REPORT_IMAGE_STORED_CONTENT_INVALID');
      if (job.state === 'READY' && job.result?.media?.frame?.schemaVersion !== 3)
        return { state: 'FAILED', code: 'GRADING_IMAGE_FRAME_INVALID' };
      const rejection = reportImageRejection(job);
      return { state: job.state, code: /^[A-Z][A-Z0-9_]{0,100}$/.test(job.code ?? '') ? job.code : null,
        ...(rejection ? { rejection } : {}) };
    },
    async isPhotoPrepared({ cardId, uploadId, side }) {
      const job = await readPhoto(cardId, uploadId, side);
      return job?.state === 'READY' && job.result?.media?.frame?.schemaVersion === 3;
    },
    async readGradingPhoto({ cardId, uploadId, side, photo, signal }) {
      const job = await readPhoto(cardId, uploadId, side);
      requireThat(job?.state === 'READY', 409, 'GRADING_IMAGE_PENDING');
      const frame = job.result?.media?.frame;
      requireThat(frame?.schemaVersion === 3 && job.bound_original_sha256 === photo.original.content.sha256
        && frame.generation?.sourceFrame?.raster?.content?.sha256 === (photo.workingFrame.generation?.sourceFrame ?? photo.workingFrame).raster.content.sha256,
      409, 'GRADING_IMAGE_SOURCE_MISMATCH');
      parseDecodedFrame(frame, photo.original, photo.decodePlan);
      const found = await storage.readDecodedFrame({ frame, original: photo.original, decodePlan: photo.decodePlan, signal });
      requireThat(digest(found.bytes) === job.result.output.sha256, 503, 'REPORT_IMAGE_OUTPUT_INVALID');
      requireThat((await readPhoto(cardId, uploadId, side))?.key === job.key, 409, 'REPORT_IMAGE_SOURCE_CHANGED');
      return { photo: { ...photo, workingFrame: frame }, bytes: found.bytes };
    },
  });
}

/** Restricted workers receive only EXECUTE on this projection. They cannot
 * read the image queue wholesale, enqueue an edit or mutate a saved result. */
export function createStoredGradingPhotoReader({ boundary, storage }) {
  return createGradingPhotoReader({ storage, photo: (cardId, uploadId, side) => boundary.machineTransaction(null, async ({ tx, principal }) => {
    requireThat(['FRONT', 'BACK'].includes(side), 404, 'REPORT_IMAGE_NOT_FOUND');
    const [row] = await tx.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.read_grading_photo($1::uuid,$2::uuid,$3,$4)',
      cardId, uploadId, side, principal.mode);
    if (!row) return null;
    requireThat(!row.result || digest(row.result) === row.result_hash, 503, 'REPORT_IMAGE_STORED_CONTENT_INVALID');
    const result = row.result ? JSON.parse(row.result) : null;
    requireThat(!result || result.sourceSha256 === row.source_hash && result.recipeHash === row.recipe_hash,
      503, 'REPORT_IMAGE_BINDING_INVALID');
    return { ...row, result };
  }) });
}
