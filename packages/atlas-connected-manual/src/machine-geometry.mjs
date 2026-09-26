import { validatePhotoGeometryQuad } from '@atlas/manual-workspace/geometry-actions';

export const MACHINE_GEOMETRY_POLICY = 'atlas-machine-geometry-final-review-v1';
export const PRINTED_CANDIDATE_POLICY = 'atlas-supported-printed-candidate-v1';
const SIDES = ['FRONT', 'BACK'];
const EDGES = ['top', 'right', 'bottom', 'left'];

/** A complete measured candidate may be useful without being unambiguous.
 * An advisory, a partial outline or an invented rectangle is not a candidate.
 * Keep the native proposal/outcome intact; only the adoption decision differs. */
export function machineGeometryCandidate(proposal) {
  if (!proposal) return null;
  let quad = proposal.outcome === 'ACCEPTED' ? proposal.proposal : null;
  const provisional = !quad && proposal.mode === 'PRINTED_FRAME' && proposal.outcome === 'ABSTAIN'
    && proposal.authority === 'PROPOSER_ONLY' && proposal.ambiguity?.ambiguous === true
    && proposal.advisory?.code === 'AMBIGUOUS_PRINTED_FRAME'
    && proposal.diagnosticCandidate?.policy === PRINTED_CANDIDATE_POLICY
    && proposal.diagnosticCandidate.authority === 'PROPOSER_ONLY'
    && proposal.diagnosticCandidate.reason === 'AMBIGUOUS_SUPPORTED_TRANSITIONS'
    && EDGES.every(side => proposal.sideEvidence?.[side]?.medianContrastDeltaE >= 12
      && proposal.sideEvidence[side].supportFraction >= 0.55 && proposal.sideEvidence[side].sampleCount > 0
      && proposal.sideEvidence[side].candidateCount >= 1);
  if (provisional) quad = proposal.diagnosticCandidate.quad;
  if (!quad) return null;
  try {
    return { quad: validatePhotoGeometryQuad(quad), ambiguous: provisional || proposal.ambiguity?.ambiguous === true,
      provisional: Boolean(provisional) };
  } catch { return null; }
}

export function machineGeometryReview(geometry) {
  const sides = Object.fromEntries(SIDES.map(side => {
    const slot = geometry.sides[side];
    const unresolved = [!slot.physical && 'PHYSICAL_GEOMETRY_UNRESOLVED', !slot.prepared && 'PREPARED_FRAME_UNAVAILABLE',
      !slot.printed && 'PRINTED_GEOMETRY_UNRESOLVED'].filter(Boolean);
    return [side, { machineUsable: Boolean(slot.physical && slot.prepared),
      ambiguous: Boolean(slot.physical?.proposal?.ambiguous || slot.printed?.proposal?.ambiguous),
      confirmed: Boolean(slot.confirmation), unresolved }];
  }));
  return { policy: MACHINE_GEOMETRY_POLICY, requiresHumanConfirmation: true, sides };
}
