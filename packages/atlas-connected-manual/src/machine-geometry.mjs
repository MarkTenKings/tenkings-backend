import { validatePhotoGeometryQuad } from '@atlas/manual-workspace/geometry-actions';

export const MACHINE_GEOMETRY_POLICY = 'atlas-machine-geometry-final-review-v1';
const SIDES = ['FRONT', 'BACK'];
/** Only a complete visual proposal can be adopted. Uncertainty is visible,
 * never a reason to substitute a native diagnostic candidate. */
export function machineGeometryCandidate(proposal) {
  if (proposal?.outcome !== 'ACCEPTED' || !proposal.proposal) return null;
  try { return { quad: validatePhotoGeometryQuad(proposal.proposal), ambiguous: proposal.ambiguity?.ambiguous === true, provisional: false }; }
  catch { return null; }
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
