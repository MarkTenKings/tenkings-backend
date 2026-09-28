import { requireThat } from '@atlas/manual-service/contract';
import { inspectionPreviewMedia, inspectionPreviewGrant } from './inspection-preview.mjs';

const SIDES = ['FRONT', 'BACK'];

/** Request-local sharing only. The source reader verifies the immutable photo
 * artifact and reauthorizes after its read; current brackets the whole batch.
 * Each side verifies/signs one image at a time, bounding raster reads to two.
 */
export function createImageDescriptors({ current, readSource, readManifest, imageReadUrl, imageUrl }) {
  return async function imageDescriptors({ card, state, staff, imageScope = 'all' }) {
    requireThat(['all', 'inspection'].includes(imageScope), 400, 'MANUAL_IMAGE_SCOPE_INVALID');
    await current(staff, card);
    const sides = await Promise.all(SIDES.map(async side => {
      const [saved, source] = await Promise.all([
        readManifest(card, side), readSource(staff, card.cardId, card.draft.source.uploads[side]),
      ]);
      const slot = state.geometry.sides[side], images = {};
      async function descriptor(kind, image) {
        const content = image.raster.content;
        return imageReadUrl ? imageReadUrl({ kind, descriptor: image, photo: source.photo })
          : { url: imageUrl(card.cardId, side, kind, content.sha256), sha256: content.sha256,
            byteCount: content.byteCount, mime: content.mime };
      }
      if (imageScope === 'all') images.original = await descriptor('original', source.photo.workingFrame);
      if (slot.prepared && saved) {
        requireThat(saved.frameId === slot.prepared.frame.id, 503, 'MANUAL_IMAGE_BINDING_INVALID');
        for (const [kind, image] of Object.entries(saved.images))
          if (imageScope === 'all' || kind === 'inspection') images[kind] = await descriptor(kind, image);
        const preview = inspectionPreviewMedia(saved.inspectionPreview, saved.images.inspection, source.photo);
        if (preview && imageReadUrl) images.inspection = { ...images.inspection,
          preview: inspectionPreviewGrant(preview, await descriptor('preview', preview.descriptor)) };
      }
      return [side, images];
    }));
    // A replaced pair or revoked/expired session cannot receive the completed
    // batch, including when a different side finished its storage work earlier.
    await current(staff, card);
    return Object.fromEntries(sides);
  };
}
