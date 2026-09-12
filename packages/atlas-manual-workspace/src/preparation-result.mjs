import { applyGeometryEdit, applyPreparedFrame, geometryBase } from './geometry-actions.mjs';

/** Host calls only after it has durably stored/verified all required outputs.
 * A changed mat/shape can reuse warp pixels but cannot adopt the old proposal.
 * This pure action returns invalidations for the host's atomic card save. */
export function adoptGeometryPreparation(workspace, result) {
  const side = workspace.sides[result.side];
  const applied = applyPreparedFrame(workspace, { side: result.side, base: result.base, frame: result.frame });
  const settingsCurrent = side.settingsRevision === result.settingsRevision
    && side.matColor === result.matColor && side.cornerShape === result.cornerShape;
  if (!settingsCurrent || result.proposal?.outcome !== 'ACCEPTED') return { ...applied, proposalApplied: false };
  const edited = applyGeometryEdit(applied.state, { side: result.side, kind: 'PRINTED', base: geometryBase(applied.state, result.side, 'PRINTED'),
    quad: result.proposal.proposal, actor: 'ENGINE', proposal: { id: result.id, ambiguous: Boolean(result.proposal.ambiguity?.ambiguous) } });
  return { ...edited, invalidated: applied.invalidated, proposalApplied: true };
}
