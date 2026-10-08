import { canonical, digest, requireThat } from '@atlas/manual-service/contract';
import { adoptDefectProposals, createDefectWorkspace, parseDefectWorkspace, defectBase } from '@atlas/manual-workspace/defect-actions';
import { calculateAtlasReview, ATLAS_RULE_VERSION } from '@atlas/grading-core/atlas-policy';
import { measureSpeedsterCenteringBorders } from '@atlas/grading-core/scoring';
import { calculateAtlasFinalGrade, explainAtlasManualReport } from '@atlas/grading-core/manual-report';

const SIDES = ['FRONT', 'BACK'];
export const proposalFindingId = id => `astra-${digest(id).slice(0, 32)}`;

/** Opening corrections adopts evidence, never a human decision. The immutable
 * original report and model observations remain alongside the working draft. */
export function beginFinalReview({ card, geometry, defects, packet }) {
  const { report, reportHash, batchKey, proposals, resumeBase } = packet;
  // Only the trusted batch adapter can supply a base verified against the
  // original review's complete receipt chain. The browser supplies no base.
  const currentBase = resumeBase ?? { revision: report?.manualRevision, contentHash: report?.manualContentHash };
  requireThat(!card.draft.finalReview && report?.authority === 'MACHINE_PROPOSAL' && report.certification === null
    && report.cardId === card.cardId && report.sourceHash === card.draft.source.sourceHash
    && currentBase.revision === card.revision && currentBase.contentHash === card.contentHash
    && (!resumeBase || Number.isSafeInteger(resumeBase.completedSteps)
      && resumeBase.completedSteps >= 0 && resumeBase.completedSteps < 5
      && report.manualRevision + resumeBase.completedSteps === card.revision)
    && digest(JSON.stringify(report)) === reportHash && Array.isArray(proposals), 409, 'BATCH_REVIEW_STALE');
  for (const side of SIDES) requireThat(canonical(defects.sides[side].frame) === canonical(report.geometry[side].frame),
    409, 'BATCH_REVIEW_BINDING_CHANGED');
  if (resumeBase) {
    // Reopen the same immutable proposals for a fresh, explicit review.
    // Prior inspection receipts remain saved, but cannot confirm
    // this review. Keep monotonically increasing local evidence revisions.
    const empty = createDefectWorkspace({ cardId: defects.cardId, profile: defects.profile,
      sides: Object.fromEntries(SIDES.map(side => [side, { frame: defects.sides[side].frame, cornerShape: defects.sides[side].cornerShape }])) });
    defects = parseDefectWorkspace({ ...empty, draftRevision: defects.draftRevision + 1,
      sides: Object.fromEntries(SIDES.map(side => [side, { ...empty.sides[side],
        findingRevision: defects.sides[side].findingRevision + 1, reviewRevision: defects.sides[side].reviewRevision + 1 }])) });
  }
  for (const side of SIDES) {
    defects = adoptDefectProposals(defects, { side, base: defectBase(defects, side),
      source: { method: 'DETECTOR', version: 'astra-machine-proposal-v1', id: report.analysisId },
      findings: report.findings.filter(finding => finding.side === side) });
    defects = defects.state;
  }
  return { defects, finalReview: { version: 'atlas-final-review-v1', batchKey, reportHash, report,
    proposals, originalGeometry: geometry, originalBases: Object.fromEntries(SIDES.map(side => [side, defectBase(defects, side)])) } };
}

export function importedProposalIds(finalReview) {
  return finalReview ? finalReview.proposals.filter(proposal => finalReview.report.findings.some(finding => finding.id === proposalFindingId(proposal.id))).map(proposal => proposal.id) : [];
}

/** This runs only inside the explicit human Confirm findings command. */
export function finalReviewDecisions({ finalReview, defects, assistance, principal }) {
  const reviews = [...(assistance?.reviews ?? [])];
  for (const proposal of finalReview.proposals) {
    const id = proposalFindingId(proposal.id), original = finalReview.report.findings.find(value => value.id === id);
    const previousIndex = reviews.findIndex(review => review.analysisId === finalReview.report.analysisId && review.proposalId === proposal.id);
    if (!original && previousIndex !== -1) continue;
    const finding = defects.sides[proposal.side].findings.find(value => value.id === id);
    // Findings without raster pixels remain ordinary visible proposals and
    // need a deliberate correction/rejection; they cannot disappear here.
    requireThat(finding, 409, 'MANUAL_ASTRA_REVIEW_REQUIRED');
    requireThat(original, 409, 'MANUAL_ASTRA_REVIEW_REQUIRED');
    // Both traces passed the exact-raster parser at their artifact boundaries.
    // Their validated digests bind every pixel without the compact document
    // serializer's size limit rejecting a legitimate complex trace.
    const changed = finding.defectType !== original.defectType
      || (finding.finalTrace ?? finding.detectorMask).sha256 !== (original.finalTrace ?? original.detectorMask).sha256
      || canonical(defects.sides[proposal.side].frame) !== canonical(finalReview.report.geometry[proposal.side].frame);
    if (previousIndex !== -1) reviews.splice(previousIndex, 1);
    reviews.push({ analysisId: finalReview.report.analysisId, proposalId: proposal.id, side: proposal.side,
      action: finding.reviewResult === 'REMOVED' ? 'REJECT' : changed ? 'TRACE_SAVE' : 'ACCEPT', findingId: id, base: defectBase(defects, proposal.side), proposal,
      reviewerId: principal.id, reviewedAt: new Date().toISOString() });
  }
  return { version: 'atlas-defect-assistance-v1', reviews };
}

/** A pure current score. Pending preparation/measurement hides the old score;
 * neither this read nor its report shape creates inspection or approval. */
export function finalReviewPreview(card, state) {
  if (!state.finalReview) return null;
  const ready = SIDES.every(side => {
    const slot = state.geometry.sides[side], defects = state.defects?.sides[side], frame = slot.prepared?.frame;
    return slot.physical && frame && defects && !defects.pending
      && canonical(defects.frame) === canonical({ imageVersion: slot.image.version, originalSha256: slot.image.originalSha256,
        preparationVersion: frame.version, frameId: frame.id, inspectionImageSha256: frame.inspection.sha256,
        rectifiedImageSha256: frame.rectified.sha256 });
  });
  if (!ready) return { state: 'PENDING', sourceRevision: card.revision, sourceHash: card.contentHash };
  const unresolvedGeometry = SIDES.filter(side => !state.geometry.sides[side].printed)
    .map(side => ({ side, code: state.geometry.sides[side].printedAbsence ? 'BORDERLESS_CENTERING_UNSUPPORTED' : 'PRINTED_GEOMETRY_UNRESOLVED' }));
  const capture = unresolvedGeometry.length ? null : Object.fromEntries(SIDES.map(side => [side.toLowerCase(), {
    centeringBorders: measureSpeedsterCenteringBorders(state.geometry.sides[side].printed.quad),
  }]));
  const findings = SIDES.flatMap(side => state.defects.sides[side].findings);
  const calculated = capture ? calculateAtlasReview(capture, findings) : { grade: null, defects: findings };
  const geometryReview = { policy: 'atlas-final-human-geometry-review-v1', requiresHumanConfirmation: true,
    sides: Object.fromEntries(SIDES.map(side => {
      const slot = state.geometry.sides[side];
      return [side, { machineUsable: Boolean(slot.physical && slot.prepared),
        physicalActor: slot.physical.actor, printedActor: slot.printed?.actor ?? null,
        ambiguous: Boolean(slot.physical.proposal?.ambiguous || slot.printed?.proposal?.ambiguous),
        confirmed: Boolean(slot.confirmation), unresolved: unresolvedGeometry.filter(value => value.side === side).map(value => value.code) }];
    })) };
  const unresolvedObservations = (state.finalReview.report.unmeasurableProposals ?? []).filter(proposal =>
    !(state.assistance?.reviews ?? []).some(review => review.analysisId === state.finalReview.report.analysisId
      && review.proposalId === proposal.id && review.action === 'REJECT'));
  const report = { ...state.finalReview.report, version: 'atlas-review-provisional-report-v1', authority: 'HUMAN_REVIEW_DRAFT',
    originalMachineReportHash: state.finalReview.reportHash, manualRevision: card.revision, manualContentHash: card.contentHash,
    identity: state.identity, ruleVersion: ATLAS_RULE_VERSION,
    grade: calculated.grade, proposedGrade: calculated.grade ? calculateAtlasFinalGrade(calculated.grade.overall.rawGrade) : null,
    calculationState: calculated.grade ? 'COMPLETE' : 'GEOMETRY_UNRESOLVED', unresolvedGeometry, geometryReview,
    // Original receipts and warnings remain bound to the immutable machine
    // report; they must not impersonate measurements of a corrected frame.
    originalMachineEvidence: { geometryReview: state.finalReview.report.geometryReview ?? null,
      limitations: state.finalReview.report.limitations ?? [], measurementReceipts: state.finalReview.report.measurementReceipts ?? [] },
    measurementReceipts: SIDES.flatMap(side => state.defects.sides[side].measurement
      ? [{ side, ...state.defects.sides[side].measurement }] : []),
    analysisLimitations: state.finalReview.report.analysisLimitations ?? [],
    limitations: [...(state.finalReview.report.analysisLimitations ?? []), ...(unresolvedGeometry.length ? ['Centering geometry is unresolved; the overall grade is unavailable.'] : []),
      ...(SIDES.some(side => geometryReview.sides[side].ambiguous && !geometryReview.sides[side].confirmed)
        ? ['Competing proposed outlines remain for final human geometry review.'] : []),
      ...(unresolvedObservations.length ? ['Original observations without measurable pixels remain for explicit human review.'] : [])],
    unmeasurableProposals: unresolvedObservations,
    findings: calculated.defects, findingCounts: { total: calculated.defects.length,
      included: calculated.defects.filter(finding => finding.reviewResult !== 'REMOVED').length,
      removed: calculated.defects.filter(finding => finding.reviewResult === 'REMOVED').length,
      unreviewed: calculated.defects.filter(finding => finding.reviewResult === 'UNREVIEWED').length },
    geometry: Object.fromEntries(SIDES.map(side => [side, {
      frame: state.defects.sides[side].frame, centeringQuad: state.geometry.sides[side].printed?.quad ?? null,
    }])) };
  const reportHash = digest(JSON.stringify(report));
  return { state: 'READY', sourceRevision: card.revision, sourceHash: card.contentHash, report, reportHash,
    explanation: calculated.grade ? explainAtlasManualReport({ ...report, version: 'atlas-manual-draft-report-v2', finalGrade: report.proposedGrade }) : null };
}
