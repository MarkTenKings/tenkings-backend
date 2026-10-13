const sides = ['FRONT', 'BACK'];
const name = side => side === 'FRONT' ? 'Front' : 'Back';

// Presentation only. Read the current saved projection, never a stale queue
// reason or URL parameter, and grant no edit/approval authority.
export function intakePhotoAttention(saved) {
  if (!saved?.card) return [];
  return sides.flatMap(side => {
    const slot = saved.card.sides?.[side], upload = slot?.upload;
    if (!upload?.source) return [{ key: `photo-${side}`, side,
      message: upload?.verification ? `${name(side)} photo needs preparation. Replace the photo, or resume its saved preparation below.`
        : `${name(side)} photo is needed. Choose or resume this side's original photo.` }];
    return [];
  });
}
