import { canonical, digest, requireThat } from '@atlas/manual-service/contract';
import { defectBase, parseDefectWorkspace } from '@atlas/manual-workspace/defect-actions';
import { encodeSpeedsterTraceRleV1 } from '@atlas/grading-core/trace-codec';
import { encodeSpeedsterTraceBitmapWireV1 } from '@atlas/grading-core/trace-bitmap-wire';
import { rasterizeSpeedsterCanonicalContour,
  buildSpeedsterTraceProvenanceRevision } from '@atlas/grading-core/trace-editor';

const FULL_CROP = { version: 'speedster-canonical-crop-affine-v1', crop: { x: 0, y: 0, width: 1269, height: 1777 } };
export function proposalTrace({ proposal, cornerShape }) {
  requireThat(!proposal.measurementHold && proposal.canonicalContour.every(p => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1),
    409, 'MANUAL_PROPOSAL_RETRACE_REQUIRED');
  return rasterizeSpeedsterCanonicalContour(proposal.canonicalContour);
}
export function proposalRle({ proposal, review }) {
  return encodeSpeedsterTraceRleV1(proposalTrace({ proposal, cornerShape: review.base.cornerShape }));
}
export function proposalEdit(proposal, side, cornerShape) {
  return editFromBitmap(proposal, side, proposalTrace({ proposal, cornerShape }));
}
/** Preserve the full model trace. Material intersection happens once in the
 * checked measurement pass, independently of visible/raw trace evidence. */
export function measurableProposalEdit(proposal, side, cornerShape) {
  const bitmap = proposalTrace({ proposal, cornerShape });
  return bitmap.some(pixel => pixel !== 0) ? editFromBitmap(proposal, side, bitmap) : null;
}
function editFromBitmap(proposal, side, bitmap) {
  const rle = encodeSpeedsterTraceRleV1(bitmap);
  const sourceViewId = `${side}:inspection`;
  const traceProvenance = buildSpeedsterTraceProvenanceRevision({ sourceViewId, cropTransform: FULL_CROP,
    highlighterStrokes: [], finalTraceSha256: rle.sha256 });
  return { id: `astra-${digest(proposal.id).slice(0, 32)}`, defectType: proposal.defectType, sourceViewId,
    traceWire: encodeSpeedsterTraceBitmapWireV1(bitmap, rle.sha256), traceProvenance };
}
export function checkProposalReview(defects, action, resolved, assistance) {
  requireThat(['ACCEPT', 'REJECT', 'TRACE_SAVE'].includes(action.action), 400, 'MANUAL_PROPOSAL_ACTION_INVALID');
  requireThat(action.action !== 'ACCEPT' || !resolved.proposal.measurementHold, 409, 'MANUAL_PROPOSAL_RETRACE_REQUIRED');
  const base = defectBase(defects, action.side), captured = resolved.base;
  requireThat(canonical(base) === canonical(action.base) && captured.cardId === base.cardId
    && captured.side === base.side && captured.profile === base.profile && captured.cornerShape === base.cornerShape
    && canonical(captured.frame) === canonical(base.frame), 409, 'MANUAL_PROPOSAL_STALE');
  requireThat(resolved.proposal.id === action.proposalId && resolved.proposal.side === action.side,
    409, 'MANUAL_PROPOSAL_STALE');
  requireThat(!defects.sides[action.side].pending, 409, 'MANUAL_DEFECT_PENDING');
  requireThat(!(assistance?.reviews ?? []).some(r => r.analysisId === action.analysisId && r.proposalId === action.proposalId),
    409, 'MANUAL_PROPOSAL_ALREADY_REVIEWED');
  requireThat((assistance?.reviews.length ?? 0) < 200, 413, 'MANUAL_PROPOSAL_REVIEW_LIMIT');
}
export function invalidateDefectConfirmation(defects) {
  return parseDefectWorkspace({ ...defects, draftRevision: defects.draftRevision + 1, confirmation: null });
}
