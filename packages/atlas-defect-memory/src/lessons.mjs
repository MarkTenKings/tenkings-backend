import { parseDefectWorkspace } from '../../atlas-manual-workspace/src/defect-actions.mjs';
import { parseSpeedsterTraceRleV1 } from '@atlas/grading-core/trace-codec';
import { canonical, digest, immutable, requireThat, deriveDesignContext, validateLesson, SIDES, DEFECT_TYPES } from './contract.mjs';

/** The exact checked canonical mask determines the visual window. Holes and
 * disconnected pixels remain in the separately retained trace artifact. */
export function reviewedCropTransform(input, frame, padding = 16) {
  const trace = parseSpeedsterTraceRleV1(input);
  requireThat(Number.isSafeInteger(padding) && padding >= 0 && padding <= 128, 400, 'MEMORY_CROP_INVALID');
  let offset = 0, minX = trace.width, minY = trace.height, maxX = -1, maxY = -1;
  for (let index = 0; index < trace.runs.length; index++) {
    const count = trace.runs[index];
    if (index % 2 === 1 && count) {
      const firstY = Math.floor(offset / trace.width), lastY = Math.floor((offset + count - 1) / trace.width);
      minY = Math.min(minY, firstY); maxY = Math.max(maxY, lastY);
      minX = Math.min(minX, firstY === lastY ? offset % trace.width : 0);
      maxX = Math.max(maxX, firstY === lastY ? (offset + count - 1) % trace.width : trace.width - 1);
    }
    offset += count;
  }
  const x = Math.max(0, minX - padding), y = Math.max(0, minY - padding);
  const right = Math.min(trace.width, maxX + 1 + padding), bottom = Math.min(trace.height, maxY + 1 + padding);
  return immutable({ version: 'atlas-reviewed-crop-v1', coordinateSpace: 'RECTIFIED_CARD_PIXELS', imageSha256: frame.rectifiedImageSha256,
    x, y, width: right - x, height: bottom - y, sourceWidth: trace.width, sourceHeight: trace.height });
}

/** Called only with the immutable committed confirmation snapshot, never the
 * live editing draft. createExemplar is a trusted host effect outside SQL. */
export async function buildReviewedLessons({ confirmation, hydrate, createExemplar, proposalTrace = null, staff }) {
  requireThat(typeof hydrate === 'function' && typeof createExemplar === 'function', 503, 'MEMORY_PUBLICATION_UNAVAILABLE');
  const card = immutable(structuredClone(confirmation.card));
  const hydrated = await hydrate(card), defects = parseDefectWorkspace(hydrated.defects);
  requireThat(defects.cardId === card.cardId && defects.confirmation?.actor === 'HUMAN', 409, 'MEMORY_CONFIRMATION_REQUIRED');
  const design = deriveDesignContext(defects.profile, card.draft.identity), lessons = [];
  const reviews = hydrated.assistance?.reviews ?? [];
  requireThat(Array.isArray(reviews) && reviews.length <= 200, 503, 'MEMORY_REVIEW_INVALID');
  const unique = new Set();
  for (const review of reviews) {
    const key = `${review.analysisId}:${review.proposalId}`;
    requireThat(!unique.has(key) && SIDES.includes(review.side) && ['ACCEPT', 'REJECT', 'TRACE_SAVE'].includes(review.action), 503, 'MEMORY_REVIEW_INVALID');
    unique.add(key);
  }
  const proposalReview = review => review ? { analysisId: review.analysisId, proposalId: review.proposalId, reviewerId: review.reviewerId,
    reviewedAt: review.reviewedAt, action: review.action, proposalDefectType: review.proposal.defectType,
    proposalSha256: digest(canonical(review.proposal)) } : null;
  async function append(side, slot, finding, trace, disposition, previousDefectType, review) {
    const source = { cardId: card.cardId, actionId: confirmation.actionId, actorId: confirmation.actorId,
      resultRevision: card.revision, contentHash: card.contentHash, nativeSourceHash: card.draft.source.sourceHash, frame: slot.frame };
    const cropTransform = reviewedCropTransform(trace, slot.frame);
    const exemplar = await createExemplar({ card, side, finding, trace, frame: slot.frame, cropTransform, source, staff });
    requireThat(canonical(exemplar.cropTransform) === canonical(cropTransform) && exemplar.trace.sha256 === trace.sha256,
      503, 'MEMORY_EXEMPLAR_INVALID');
    const body = { findingId: finding.id, side, disposition, defectType: finding.defectType, previousDefectType, design, source, exemplar,
      proposalReview: proposalReview(review) };
    const lesson = { id: digest(canonical(body)), ...body }; validateLesson(lesson); lessons.push(lesson);
  }
  for (const side of SIDES) {
    const slot = defects.sides[side];
    requireThat(!slot.pending && slot.inspection?.inspected === true && slot.inspection.imageSha256 === slot.frame.inspectionImageSha256,
      409, 'MEMORY_INSPECTION_REQUIRED');
    for (const finding of slot.findings) {
      requireThat(finding.reviewResult !== 'UNREVIEWED', 409, 'MEMORY_CONFIRMATION_REQUIRED');
      // An engine-only suppression is not a human negative example. Confirm
      // findings deliberately reviews the surviving list; removal lessons need
      // the separately preserved human edit identity as well.
      if (finding.reviewResult === 'REMOVED' && !slot.humanEditedIds.includes(finding.id)) continue;
      const trace = parseSpeedsterTraceRleV1(finding.finalTrace ?? finding.detectorMask);
      const review = reviews.find(entry => entry.side === side && entry.findingId === finding.id && entry.action !== 'REJECT'
        && canonical(entry.base.frame) === canonical(slot.frame));
      let correctedProposal = false;
      if (review?.action === 'ACCEPT') {
        requireThat(typeof proposalTrace === 'function', 503, 'MEMORY_PROPOSAL_TRACE_UNAVAILABLE');
        const proposedTrace = parseSpeedsterTraceRleV1(await proposalTrace({ proposal: review.proposal, side, frame: slot.frame, review }));
        correctedProposal = proposedTrace.sha256 !== trace.sha256 || review.proposal.defectType !== finding.defectType;
      }
      const disposition = finding.reviewResult === 'REMOVED' ? 'REJECTED'
        : finding.reviewResult === 'TYPE_CORRECTED' || review?.action === 'TRACE_SAVE' || correctedProposal ? 'CORRECTED'
          : review ? 'ACCEPTED' : finding.origin === 'SMART_MARK' ? 'ADDED'
            : slot.humanEditedIds.includes(finding.id) ? 'CORRECTED' : 'ACCEPTED';
      const detected = review?.proposal.defectType ?? finding.detectedDefectType
        ?? finding.findingProvenance?.contributors?.find(c => c.proposalId === finding.findingProvenance.primaryProposalId)?.defectType;
      const previousDefectType = DEFECT_TYPES.includes(detected) && detected !== finding.defectType ? detected : null;
      await append(side, slot, finding, trace, disposition, previousDefectType, review);
    }
    for (const review of reviews.filter(entry => entry.side === side && entry.action === 'REJECT'
      && canonical(entry.base.frame) === canonical(slot.frame))) {
      requireThat(typeof proposalTrace === 'function', 503, 'MEMORY_PROPOSAL_TRACE_UNAVAILABLE');
      const trace = parseSpeedsterTraceRleV1(await proposalTrace({ proposal: review.proposal, side, frame: slot.frame, review }));
      const finding = { id: `astra-rejected:${review.analysisId}:${review.proposalId}`, side, defectType: review.proposal.defectType };
      await append(side, slot, finding, trace, 'REJECTED', null, review);
    }
  }
  requireThat(lessons.length <= 200, 413, 'MEMORY_LESSON_LIMIT');
  return immutable({ version: 'atlas-reviewed-lessons-v1', design, lessons });
}
