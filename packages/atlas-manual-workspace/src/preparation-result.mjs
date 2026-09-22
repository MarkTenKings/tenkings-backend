import { applyGeometryEdit, applyPreparedFrame, geometryBase, GeometryActionError } from './geometry-actions.mjs';

const invalidAutomaticQuad = error => error instanceof GeometryActionError && error.code === 'ATLAS_GEOMETRY_QUAD_INVALID';

/** Automatic line intersections can fall outside the source image. They are
 * proposals only: leave manual outlining available instead of clamping them or
 * aborting the paired workspace. Stale bases and other failures still throw. */
export function adoptPhysicalGeometryProposal(workspace, result) {
  if (result.proposal?.outcome !== 'ACCEPTED') return { state: workspace, proposalApplied: false };
  try {
    return { ...applyGeometryEdit(workspace, { side: result.side, kind: 'PHYSICAL', base: result.base,
      quad: result.proposal.proposal, actor: 'ENGINE',
      proposal: { id: result.id, ambiguous: Boolean(result.proposal.ambiguity?.ambiguous) } }), proposalApplied: true };
  } catch (error) {
    if (!invalidAutomaticQuad(error)) throw error;
    return { state: workspace, proposalApplied: false };
  }
}

/** Host calls only after it has durably stored/verified all required outputs.
 * A changed mat/shape can reuse warp pixels but cannot adopt the old proposal.
 * This pure action returns invalidations for the host's atomic card save. */
export function adoptGeometryPreparation(workspace, result) {
  const side = workspace.sides[result.side];
  const applied = applyPreparedFrame(workspace, { side: result.side, base: result.base, frame: result.frame });
  const settingsCurrent = side.settingsRevision === result.settingsRevision
    && side.matColor === result.matColor && side.cornerShape === result.cornerShape;
  if (!settingsCurrent || result.proposal?.outcome !== 'ACCEPTED') return { ...applied, proposalApplied: false };
  try {
    const edited = applyGeometryEdit(applied.state, { side: result.side, kind: 'PRINTED', base: geometryBase(applied.state, result.side, 'PRINTED'),
      quad: result.proposal.proposal, actor: 'ENGINE', proposal: { id: result.id, ambiguous: Boolean(result.proposal.ambiguity?.ambiguous) } });
    return { ...edited, invalidated: applied.invalidated, proposalApplied: true };
  } catch (error) {
    if (!invalidAutomaticQuad(error)) throw error;
    return { ...applied, proposalApplied: false };
  }
}
