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
    // Once initialized, the saved workspace owns geometry and may contain human
    // corrections newer than the automatic intake proposal.
    if (saved.manual?.current) return [];
    const geometry = saved.earlyGeometry?.[side];
    if (geometry?.uploadId === upload.uploadId && (geometry.state === 'FAILED'
        || geometry.state === 'NEEDS_REVIEW' && geometry.machineUsable !== true)) return [{ key: `photo-${side}`, side,
      message: `${name(side)} card outline needs review. Use Edit ${name(side)} geometry below to place or correct the outline.` }];
    return [];
  });
}

export function geometryCorrectionAttention(geometry, preferredSide = null) {
  if (!geometry?.sides) return [];
  const orderedSides = sides.includes(preferredSide) ? [preferredSide, ...sides.filter(side => side !== preferredSide)] : sides;
  return orderedSides.flatMap(side => {
    const slot = geometry.sides[side];
    if (!slot || slot.confirmation && side !== preferredSide) return [];
    let kind, instruction;
    if (!slot.image) { kind = 'PHYSICAL'; instruction = 'The photo is unavailable. Return to photos to replace it.'; }
    else if (!slot.physical) { kind = 'PHYSICAL'; instruction = 'Place the four corners on the physical card edge.'; }
    else if (!slot.prepared) { kind = 'PHYSICAL'; instruction = 'Prepare this side using the saved physical edge.'; }
    else if (!slot.printed) { kind = 'PRINTED'; instruction = 'Place the printed border inside the card.'; }
    else if (slot.physical.proposal?.ambiguous) { kind = 'PHYSICAL'; instruction = 'Check the uncertain physical edge and correct it if needed, then confirm both sides.'; }
    else if (slot.printed.proposal?.ambiguous) { kind = 'PRINTED'; instruction = 'Check the uncertain printed border and correct it if needed, then confirm both sides.'; }
    else return [{ key: `geometry-${side}`, side, kind: 'PHYSICAL', reviewBoth: true, message: `${name(side)}: Review the physical edge and printed border, then confirm both sides.` }];
    return [{ key: `geometry-${side}`, side, kind, message: `${name(side)}: ${instruction}` }];
  });
}

export function analysisCorrectionAttention(astra) {
  if (!astra?.enabled) return [];
  const messages = {
    REFUSED: 'The saved ATLAS analysis could not be used. Check the analysis message and review the photos before continuing.',
    FAILED: 'ATLAS analysis did not finish. Review the saved analysis controls below to continue.',
    STALE: 'ATLAS findings belong to an earlier photo or outline. Review the current images and analysis below.',
  };
  const message = messages[astra.status] ?? (astra.status === 'UNKNOWN' && astra.collectionStopped
    ? 'The saved analysis result is unconfirmed. Check its status below before starting another request.' : null);
  return message ? [{ key: 'analysis', message }] : [];
}
