import { requireThat } from '@atlas/manual-service/contract';

const SIDES = ['FRONT', 'BACK'];

/** Background preparation needs current card facts, not display URLs. Only an
 * explicit internal false skips preview reads; authorization and source fences
 * are identical to the normal interactive read. */
export function createConnectedCardReader({ intake, details, workflow, identification, earlyGeometry, imageReadUrl }) {
  return async function open(staff, cardId, { includePreviews = true } = {}) {
    const [{ card }, saved] = await Promise.all([intake.read(staff, cardId), details.read(staff, cardId)]);
    let manual = null;
    try { manual = await workflow.service.read(staff, cardId); }
    catch (error) { if (error?.code !== 'MANUAL_CARD_NOT_FOUND') throw error; }
    const previews = {};
    if (includePreviews !== false && imageReadUrl) await Promise.all(SIDES.map(async side => {
      if (!card.sides[side].upload?.source) return;
      const { photo } = await intake.readSource(staff, cardId, card.sides[side].upload.uploadId);
      previews[side] = await imageReadUrl({ kind: 'original', descriptor: photo.workingFrame, photo,
        photoSource: card.sides[side].upload.source, contextOnly: true });
    }));
    const identificationState = await identification.status(staff, cardId);
    const geometryState = await earlyGeometry.status(staff, cardId);
    const currentCard = (await intake.read(staff, cardId)).card;
    requireThat(currentCard.revision === card.revision && currentCard.sourceHash === card.sourceHash, 409, 'MANUAL_PHOTOS_CHANGED');
    return { card, ...saved, previews,
      manual: manual ? { revision: manual.revision, current: manual.draft.source?.sourceHash === card.sourceHash } : null,
      identification: identificationState, earlyGeometry: geometryState };
  };
}
