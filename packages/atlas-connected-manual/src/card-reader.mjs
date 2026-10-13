import { requireThat } from '@atlas/manual-service/contract';

const SIDES = ['FRONT', 'BACK'];

/** Background preparation needs current card facts, not display URLs. Only an
 * explicit internal false skips preview reads; authorization and source fences
 * are identical to the normal interactive read. */
export function createConnectedCardReader({ intake, details, workflow, identification, earlyGeometry, imageReadUrl, readGradingPhoto, gradingPhotoStatus }) {
  return async function open(staff, cardId, { includePreviews = true } = {}) {
    const [{ card }, saved] = await Promise.all([intake.read(staff, cardId), details.read(staff, cardId)]);
    let manual = null;
    try { manual = await workflow.service.read(staff, cardId); }
    catch (error) { if (error?.code !== 'MANUAL_CARD_NOT_FOUND') throw error; }
    const previews = {}, gradingImages = {};
    if (includePreviews !== false) await Promise.all(SIDES.map(async side => {
      if (!card.sides[side].upload?.source) return;
      const uploadId=card.sides[side].upload.uploadId;
      const status = gradingPhotoStatus ? await gradingPhotoStatus({cardId,uploadId,side}) : {state:'UNAVAILABLE',code:'GRADING_IMAGE_NOT_CONFIGURED'};
      gradingImages[side] = { uploadId, ...status };
      if(status.state!=='READY' || !imageReadUrl)return;
      const source = await intake.readSource(staff, cardId, uploadId);
      const {photo}=await readGradingPhoto({cardId,uploadId,side,photo:source.photo});
      previews[side] = await imageReadUrl({ kind: 'original', descriptor: photo.workingFrame, photo,
        photoSource: card.sides[side].upload.source, contextOnly: true });
    }));
    const identificationState = await identification.status(staff, cardId);
    const geometryState = await earlyGeometry.status(staff, cardId);
    const currentCard = (await intake.read(staff, cardId)).card;
    requireThat(currentCard.revision === card.revision && currentCard.sourceHash === card.sourceHash, 409, 'MANUAL_PHOTOS_CHANGED');
    return { card, ...saved, previews, gradingImages,
      manual: manual ? { revision: manual.revision, current: manual.draft.source?.sourceHash === card.sourceHash } : null,
      identification: identificationState, earlyGeometry: geometryState };
  };
}
