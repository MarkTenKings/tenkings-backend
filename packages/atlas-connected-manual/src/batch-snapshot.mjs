import { requireThat } from '@atlas/manual-service/contract';

const SIDES = ['FRONT', 'BACK'];

/** Internal machine view, composed from existing authenticated repositories.
 * No UI geometry projection, photo artifact or workflow hydration is needed
 * merely to prove that this job still owns the selected verified pair. */
export function createMachineBatchSnapshot({ intakeRepository, workflow, details, identification }) {
  async function pair(staff, job) {
    const { card, principal } = await intakeRepository.read(staff, job.cardId, { edit: true });
    // This is the principal returned by the authenticated boundary, never the
    // caller's actorKind flag. Human and forged machine handles cannot use it.
    requireThat(principal.actorKind === 'MACHINE' && principal.canCertify === false, 403, 'MANUAL_MACHINE_AUTH_REQUIRED');
    requireThat(card.ready && card.sourceHash === job.sourceHash
      && SIDES.every(side => card.sides[side].upload?.uploadId === job.uploads[side]), 409, 'BATCH_PHOTOS_CHANGED');
    return card;
  }
  return async function snapshot(staff, job, { pairOnly = false } = {}) {
    const card = await pair(staff, job);
    if (pairOnly) return { card };
    let manualCard = null;
    try { manualCard = await workflow.service.read(staff, job.cardId); }
    catch (error) { if (error?.code !== 'MANUAL_CARD_NOT_FOUND' || job.stage !== 'PREPARE') throw error; }
    if (manualCard) {
      requireThat(manualCard.draft.source?.sourceHash === job.sourceHash
        && SIDES.every(side => manualCard.draft.source.uploads?.[side] === job.uploads[side]), 409, 'BATCH_PHOTOS_CHANGED');
      if (job.stage !== 'PREPARE') requireThat(manualCard.revision === job.evidence.manualRevision
        && manualCard.contentHash === job.evidence.manualContentHash, 409, 'BATCH_MANUAL_DRAFT_CHANGED');
    }
    let saved = {}, identificationState = null;
    if (job.stage === 'PREPARE' && !manualCard) {
      [saved, identificationState] = await Promise.all([details.read(staff, job.cardId), identification.status(staff, job.cardId)]);
    }
    // Preserve open()'s source/revision fence across all intervening reads.
    const latest = await pair(staff, job);
    requireThat(latest.revision === card.revision && latest.sourceHash === card.sourceHash, 409, 'MANUAL_PHOTOS_CHANGED');
    return { card, ...saved, manualCard, manual: manualCard ? { revision: manualCard.revision, current: true } : null,
      identification: identificationState };
  };
}
