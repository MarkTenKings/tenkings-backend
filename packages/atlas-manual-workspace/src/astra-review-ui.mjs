// Presentation only. The host validates the immutable analysis and authenticates
// every review action; this module never promotes a proposal into a finding.
const stable = value => value && typeof value === 'object'
  ? Array.isArray(value) ? `[${value.map(stable).join(',')}]`
    : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
  : JSON.stringify(value);

export function proposalFrameMatches(workspace, astra, side) {
  const original = astra?.base?.[side], slot = workspace?.sides?.[side];
  return Boolean(original && slot && original.cardId === workspace.cardId && original.side === side
    && original.profile === workspace.profile && original.cornerShape === slot.cornerShape
    && stable(original.frame) === stable(slot.frame));
}

export function validProposalContour(proposal) {
  const points = proposal?.canonicalContour;
  return Array.isArray(points) && points.length >= 3 && points.length <= 4096
    && points.every(point => point && Number.isFinite(point.x) && Number.isFinite(point.y)
      && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1);
}

export function astraReviewState(workspace, astra) {
  if (!astra?.enabled) return { enabled: false, status: 'DISABLED', message: '', mayRequest: false };
  const known = ['IDLE', 'RUNNING', 'UNKNOWN', 'REFUSED', 'FAILED', 'READY', 'STALE'];
  let status = known.includes(astra.status) ? astra.status : 'UNKNOWN';
  if (status === 'READY' && !['FRONT', 'BACK'].every(side => proposalFrameMatches(workspace, astra, side))) status = 'STALE';
  const message = {
    IDLE: astra.requestAvailable === false ? 'ATLAS is unavailable for a new analysis. Saved findings and manual review remain available.'
      : 'Let ATLAS inspect both sides first, then review and correct its findings.',
    RUNNING: astra.backgroundAccepted ? 'ATLAS has accepted the card for analysis. Findings will appear here when ready; this can take several minutes.'
      : 'Sending the card to ATLAS for its initial inspection…',
    UNKNOWN: astra.backgroundAccepted ? astra.collectionStopped
      ? 'ATLAS accepted this analysis, but no result was collected before automatic checking stopped. Its completion and charges are unconfirmed. You can check the saved status.'
      : 'ATLAS accepted this analysis, but its latest status could not be confirmed. Checking the saved request again.'
      : astra.replacement && astra.requestAvailable !== false ? 'The earlier analysis returned no result. You can explicitly start a new analysis using the saved photos.'
        : 'No analysis result has been received. Check the saved request status.',
    REFUSED: astra.followLatest ? 'This request was not sent. Check the current saved analysis to continue.'
      : 'ATLAS could not analyze these images. Manual inspection and tracing remain available.',
    FAILED: 'The analysis did not finish. You can try again or continue manual review.',
    READY: astra.proposals?.length ? 'Review both sides and correct or reject suggestions as needed. Confirm findings accepts the remaining displayed suggestions together.'
      : 'ATLAS returned no suggestions. Inspect both sides before confirming your findings.',
    STALE: 'These suggestions belong to an earlier image or card outline. Run a new analysis to use current evidence.',
  }[status];
  return { enabled: true, status, message, mayRequest: astra.requestAvailable !== false && !['RUNNING', 'UNKNOWN'].includes(status) && !astra.followLatest };
}

/** The server offers the immutable scope; the browser never invents an acceptance roster. */
export function collectiveProposalReview(workspace, astra) {
  const current = astraReviewState(workspace, astra).status === 'READY';
  const proposals = current && Array.isArray(astra?.proposals) ? astra.proposals : [];
  const unresolved = proposals.filter(proposal => proposal.reviewStatus === 'UNREVIEWED');
  const rejectedCount = proposals.filter(proposal => proposal.reviewStatus === 'REJECTED').length;
  const scope = astra?.proposalReview;
  const ids = unresolved.map(proposal => proposal.id).sort();
  const offered = unresolved.length > 0 && scope?.analysisId === astra?.analysisId && /^[a-f0-9]{64}$/.test(scope?.resultHash ?? '')
    && Array.isArray(scope.proposalIds) && scope.proposalIds.length === ids.length
    && new Set(ids).size === ids.length && scope.proposalIds.every((id, index) => id === ids[index])
    && unresolved.every(validProposalContour);
  return { unresolvedCount: unresolved.length, rejectedCount, ready: !unresolved.length || Boolean(offered),
    proposalReview: offered ? { analysisId: scope.analysisId, resultHash: scope.resultHash, proposalIds: [...scope.proposalIds] } : null };
}

export function reviewedMemoryState(memory) {
  if (!memory?.enabled) return null;
  if (memory.preparationStatus) {
    const stage = memory.preparationStatus, held = stage === 'HELD';
    const needsReviewer = ['MANUAL_MACHINE_ACCESS_REVOKED', 'MEMORY_HISTORICAL_AUTHORITY_REQUIRED', 'MANUAL_CARD_ACCESS_DENIED'].includes(memory.code);
    return { status: held ? 'FAILED' : stage === 'PREPARED' ? 'SAVED' : 'PENDING',
      mayRecover: ['QUEUED', 'RUNNING'].includes(stage), message:
        memory.activationStatus === 'ACTIVE' ? `Feedback saved · ${memory.exampleCount ?? 0} active lessons available to relevant analysis.`
        : stage === 'PREPARED' ? 'Feedback saved · Examples prepared for evaluation. They are not active in grading yet.'
        : held ? needsReviewer
          ? 'Feedback saved · Example preparation is held. An authorized reviewer must review and confirm findings again.'
          : 'Feedback saved · Example preparation is held. An operator must inspect the stored evidence before preparation can resume.'
        : stage === 'SUPERSEDED' ? 'This feedback remains in history. Newer reviewed evidence supersedes its examples.'
        : memory.feedbackStatus === 'SAVED' ? 'Feedback saved · Preparing examples in the background.'
        : 'Confirm findings saves your feedback. Final report approval remains separate.' };
  }
  const status = ['UNSAVED', 'PENDING', 'SAVED', 'FAILED', 'UNKNOWN'].includes(memory.status) ? memory.status : 'UNKNOWN';
  const retained = status === 'SAVED' && Number.isSafeInteger(memory.retainedObservationCount) && memory.retainedObservationCount > 0
    ? ` ${memory.retainedObservationCount} original-frame observation${memory.retainedObservationCount === 1 ? ' remains' : 's remain'} retained and ${memory.retainedObservationCount === 1 ? 'was' : 'were'} not added as current-frame lessons.` : '';
  return { status, mayRecover: ['PENDING', 'FAILED', 'UNKNOWN'].includes(status), message: {
    UNSAVED: 'Confirm findings also saves your reviewed outcomes for example preparation and evaluation. Final report approval stays separate.',
    PENDING: 'Reviewed examples are pending. Saving, evaluation and activation are separate steps.',
    SAVED: memory.exampleCount === 0 ? 'Reviewed outcome saved. There were no defect examples to add.'
      : 'Reviewed examples saved. Evaluation and activation are separate steps.',
    FAILED: 'Reviewed examples are not yet saved. Retry saving the same reviewed outcomes.',
    UNKNOWN: 'The save status of your reviewed examples is not confirmed. Check the saved outcome.',
  }[status] + retained };
}
