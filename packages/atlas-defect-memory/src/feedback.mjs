import { canonical, digest, immutable, requireThat, SIDES, validateFrame } from './contract.mjs';

/** Candidate labels, never training or serving activation. Store the exact
 * confirmed evidence and the original proposal independently. An inspection
 * with no surviving finding is an explicit clean label; an absent review is not. */
export function buildReviewedFeedback({ confirmation, hydrated, bundle, analysisEvidence = null, cleanImages = {} }) {
  const { card } = confirmation, defects = hydrated.defects, geometry = hydrated.geometry;
  requireThat(defects?.confirmation?.actor === 'HUMAN', 409, 'MEMORY_CONFIRMATION_REQUIRED');
  const source = { cardId: card.cardId, actionId: confirmation.actionId, actorId: confirmation.actorId,
    requestHash: confirmation.requestHash, revision: card.revision, contentHash: card.contentHash,
    sourceHash: card.draft.source.sourceHash, geometryHash: card.draft.geometry.sourceHash,
    defectsHash: card.draft.defects.sourceHash, analysisId: hydrated.finalReview?.report?.analysisId ?? null,
    originalMachineReportHash: hydrated.finalReview?.reportHash ?? null,
    artifacts: { source: card.draft.source, geometry: card.draft.geometry, defects: card.draft.defects,
      assistance: card.draft.assistance ?? null, finalReview: card.draft.finalReview ?? null },
    analysisEvidence, specimenId: null, specimenGroupingStatus: 'INDEPENDENT_GROUPING_REQUIRED',
    captureConditions: Object.fromEntries(SIDES.map(side => [side, { matColor: geometry?.sides?.[side]?.matColor ?? null }])) };
  const examples = bundle.lessons.map(lesson => ({ kind: 'DEFECT', role: 'DEFECT_PROPOSER',
    label: lesson.disposition, side: lesson.side, lessonId: lesson.id, frame: lesson.source.frame,
    findingId: lesson.findingId, defectType: lesson.defectType, previousDefectType: lesson.previousDefectType,
    traceSha256: lesson.exemplar.trace.sha256, cropTransform: lesson.exemplar.cropTransform,
    proposalReview: lesson.proposalReview,
    measurement: defects.sides[lesson.side].findings.find(f => f.id === lesson.findingId)?.measurement ?? null,
    originalTraceSha256: defects.sides[lesson.side].findings.find(f => f.id === lesson.findingId)?.detectorMask?.sha256 ?? null,
    reviewerReason: null }));
  for (const side of SIDES) {
    const slot = defects.sides[side]; validateFrame(slot.frame);
    requireThat(slot.inspection?.inspected === true && slot.inspection.imageSha256 === slot.frame.inspectionImageSha256
      && !slot.pending, 409, 'MEMORY_INSPECTION_REQUIRED');
    if (!slot.findings.some(finding => finding.reviewResult !== 'REMOVED')) {
      examples.push({ kind: 'CLEAN_SIDE', role: 'DEFECT_PROPOSER', label: 'INSPECTED_NO_DEFECT', side,
        frame: slot.frame, inspection: slot.inspection, image: cleanImages[side] ?? null, coordinateSpace: 'INSPECTION_PIXELS',
        interpretation: 'NO_VISIBLE_DEFECT_CONFIRMED_IN_THIS_CAPTURE' });
    }
    const final = geometry?.sides?.[side], original = hydrated.finalReview?.originalGeometry?.sides?.[side] ?? null;
    // Older isolated fixtures and historical snapshots may lack geometry. Do
    // not manufacture either a baseline proposal or a human geometry decision.
    if (final?.confirmation?.actor === 'HUMAN' && final.physical && final.prepared) {
      const geometryEvidence = value => value ? { image: value.image, physical: value.physical,
        printed: value.printed ?? null, prepared: value.prepared, cornerShape: value.cornerShape } : null;
      const before = geometryEvidence(original), after = geometryEvidence(final);
      const unchanged = original && canonical(original.physical?.quad ?? null) === canonical(final.physical.quad)
        && canonical(original.printed?.quad ?? null) === canonical(final.printed?.quad ?? null)
        && canonical(original.image) === canonical(final.image);
      examples.push({ kind: 'GEOMETRY', role: 'GEOMETRY_REVIEWER', side, frame: slot.frame,
        label: original ? unchanged ? 'ACCEPTED' : 'CORRECTED' : 'CONFIRMED_WITHOUT_RETAINED_PROPOSAL',
        original: before, confirmed: after, confirmation: final.confirmation,
        originalSha256: slot.frame.originalSha256, reason: null });
    }
  }
  const value = { version: 'atlas-reviewed-feedback-v1', activation: 'CANDIDATE_ONLY', design: bundle.design,
    source, examples, retainedObservations: bundle.retainedObservations ?? [],
    reviews: hydrated.assistance?.reviews ?? [],
    limitations: ['Human review is a label, not independent expert truth.',
      'Clean labels describe visible evidence in the confirmed capture, not physical absence of hidden damage.'] };
  const document = canonical(value, { maxBytes: 4194304 });
  return immutable({ document, sha256: digest(document), exampleCount: examples.length });
}
