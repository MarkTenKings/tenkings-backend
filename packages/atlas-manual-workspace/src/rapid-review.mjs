import { geometryBase, geometryStatus } from './geometry-actions.mjs';
import { defectBase, defectStatus } from './defect-actions.mjs';
import { collectiveProposalReview } from './astra-review-ui.mjs';
const sides = ['FRONT', 'BACK'];
export function rapidReviewStatus(view) {
  const geometry = geometryStatus(view.geometry);
  const unresolved = (view.finalReview?.report.unmeasurableProposals ?? []).filter(proposal =>
    !view.assistance?.reviews?.some(review => review.analysisId === view.finalReview.report.analysisId && review.proposalId === proposal.id));
  const proposals = view.defects ? collectiveProposalReview(view.defects, view.astra) : null;
  return { geometry: geometry.canConfirmBoth, findings: Boolean(geometry.confirmed && view.defects && defectStatus(view.defects).settled && proposals?.ready && !unresolved.length), unresolved: unresolved.length };
}
// Only an explicit Approve gesture calls this function. Navigation never does.
// Every sequential save uses the returned current revision, including recovery.
export async function approveRapidStage(stage, view, execute) {
  const status = rapidReviewStatus(view);
  if (stage === 'geometry') {
    if (!status.geometry) throw { code: 'ATLAS_GEOMETRY_HUMAN_REVIEW_REQUIRED' };
    if (geometryStatus(view.geometry).confirmed) return view;
    return execute({ type: 'CONFIRM_GEOMETRY', base: Object.fromEntries(sides.map(side => [side, geometryBase(view.geometry, side, 'REVIEW')])), reviewed: true });
  }
  if (stage !== 'findings' || !status.findings) throw { code: 'ATLAS_DEFECT_CONFIRMATION_REQUIRED' };
  const current = await inspectBothDefectSides(view, execute);
  if (!rapidReviewStatus(current).findings) throw { code: 'ATLAS_DEFECT_CONFIRMATION_REQUIRED' };
  if (defectStatus(current.defects).confirmed) return current;
  const { proposalReview } = collectiveProposalReview(current.defects, current.astra);
  return execute({ type: 'CONFIRM_FINDINGS', base: Object.fromEntries(sides.map(side => [side, defectBase(current.defects, side)])), reviewed: true, ...(proposalReview ? { proposalReview } : {}) });
}

/** One explicit human attestation, two durable side records, current bases throughout. */
export async function inspectBothDefectSides(view, execute) {
  let current = view;
  if (!current.defects || !defectStatus(current.defects).settled) throw {code:'ATLAS_DEFECT_MEASUREMENT_PENDING'};
  for (const side of sides) {
    if (!defectStatus(current.defects).sides[side].inspected)
      current = await execute({type:'INSPECT_SIDE',side,base:defectBase(current.defects,side),inspected:true});
  }
  return current;
}
