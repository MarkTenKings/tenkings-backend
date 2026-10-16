// A transport optimization only: each action and its durable receipt stay separate.
export const actionWorkspaceVersion = 'atlas-manual-action-workspace-v1';
export const hasActionWorkspace = type => ['DEFECT_EDIT', 'TRACE_SAVE', 'MEASURE_SIDE', 'INSPECT_SIDE', 'CONFIRM_FINDINGS'].includes(type);

export function isCommittedAction(result, command, { cardId, staffId }) {
  const receipt = result?.receipt, card = result?.card;
  return card?.cardId === cardId && typeof card.contentHash === 'string' && card.contentHash.length > 0
    && receipt?.actionId === command.actionId && receipt.actorId === staffId && receipt.actorKind === 'HUMAN'
    && receipt.expectedRevision === command.expectedRevision && receipt.revision === command.expectedRevision + 1
    && card.revision === receipt.revision;
}

export function committedWorkspace(result, command, current, { cardId, staffId, imageScope }) {
  const envelope = result?.workspace, next = envelope?.view, receipt = result?.receipt;
  if (!hasActionWorkspace(command.action.type) || envelope?.version !== actionWorkspaceVersion
    || envelope.imageScope !== imageScope || receipt?.actionId !== command.actionId || receipt.actorId !== staffId
    || receipt.expectedRevision !== command.expectedRevision || receipt.revision !== command.expectedRevision + 1
    || next?.card?.cardId !== cardId || next.card.revision !== receipt.revision
    || typeof next.card.contentHash !== 'string' || next.card.contentHash !== result.card?.contentHash
    || JSON.stringify(next.card) !== JSON.stringify(result.card)
    || current?.card.revision !== command.expectedRevision
    || !next.identity || !Object.hasOwn(next, 'approval')
    || next.geometry?.cardId !== cardId || next.defects?.cardId !== cardId
    || !['FRONT', 'BACK'].every(side => next.geometry.sides?.[side] && next.defects.sides?.[side] && next.images?.[side])
    || next.card.draft?.finalReview && !next.finalReview || next.card.draft?.assistance && !next.assistance
    || Object.keys(current).some(key => !Object.hasOwn(next, key))) return null;
  // This is a complete server-hydrated snapshot, never a merge with prior geometry,
  // findings or image grants. Unknown/older contracts take the normal full read.
  return next;
}
