// The approved inspection contract uses a 40 px presentation margin around the
// canonical card (preparation_core.py and inspection-viewport.mjs). Exclude only
// that margin in an illustrative slab; the saved image and report stay intact.
export const INSPECTION_SLAB_FRAME = Object.freeze({ version: 'atlas-inspection-card-v1',
  width: 1350, height: 1858, x: 40, y: 40, cardWidth: 1270, cardHeight: 1778 });

// These fields come from the verified approved-media loader, not image decode
// or a color-based edge guess. Unknown images retain their complete viewport.
export function slabPhotoFrame(photo) {
  if (!/^[a-f0-9]{64}$/.test(photo?.sourceSha256 ?? '')
    || !Number.isSafeInteger(photo?.width) || !Number.isSafeInteger(photo?.height)) return null;
  const { width, height, representation } = photo;
  const frame = INSPECTION_SLAB_FRAME;
  const full = representation === 'full' && width === frame.width && height === frame.height;
  const preview = representation === 'preview' && width > 0 && height > 0 && Math.max(width, height) <= 768
    && Math.abs(width * frame.height - height * frame.width) <= frame.height;
  return full || preview ? frame.version : null;
}

export const INSPECTION_SLAB_IMAGE_STYLE = Object.freeze({
  left: `${-INSPECTION_SLAB_FRAME.x / INSPECTION_SLAB_FRAME.cardWidth * 100}%`,
  top: `${-INSPECTION_SLAB_FRAME.y / INSPECTION_SLAB_FRAME.cardHeight * 100}%`,
  width: `${INSPECTION_SLAB_FRAME.width / INSPECTION_SLAB_FRAME.cardWidth * 100}%`,
  height: `${INSPECTION_SLAB_FRAME.height / INSPECTION_SLAB_FRAME.cardHeight * 100}%`,
});
