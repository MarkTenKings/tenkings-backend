import { requireThat } from '@atlas/manual-service/contract';
import { rethrowPreviewControlFailure } from './inspection-preview.mjs';

/** Reads an already saved cutout. Image preparation and paid dispatch are never
 * reachable from card/thumbnail reads. Current upload authorization belongs to
 * the caller and the image store; a reused job keeps its original media frame. */
export function createCleanPhotoDescriptor({ reportImages, imageReadUrl, imageUrl, onError=()=>{} }) {
  return async ({ cardId, uploadId, side, photo }) => {
    if (!reportImages) return null;
    try {
    const job = await reportImages.photo({ cardId, uploadId, side });
    if (job?.state !== 'READY') return null;
    const media = job.result?.media, descriptor = media?.descriptor;
    requireThat(job.bound_original_sha256 === photo.original.content.sha256
      && descriptor?.purpose === 'reveal' && descriptor.raster.content.sha256 === job.result.output.sha256,
    503, 'REPORT_IMAGE_BINDING_INVALID');
    const content = descriptor.raster.content;
    const grant = imageReadUrl
      ? await imageReadUrl({ kind:'clean', descriptor, photo:{ original:media.original, workingFrame:media.frame, decodePlan:media.decodePlan } })
      : { url:imageUrl(cardId,side,'clean',content.sha256), sha256:content.sha256, byteCount:content.byteCount, mime:content.mime };
    return { ...grant, ...descriptor.raster.dimensions, generative:media.frame.schemaVersion !== 4, alignment:'grading-image' };
    } catch(error) {
      rethrowPreviewControlFailure(error);
      try { onError({code:error?.code??'REPORT_IMAGE_UNAVAILABLE'}); } catch {}
      return null;
    }
  };
}
