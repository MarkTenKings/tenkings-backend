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
    IDLE: 'Ask Astra for possible defects, then review its suggestions beside your findings.',
    RUNNING: 'Astra is looking for possible defects. You can keep inspecting and editing.',
    UNKNOWN: 'The analysis result is not confirmed. Check its status while continuing manual review.',
    REFUSED: 'Astra could not analyze these images. Manual inspection and tracing remain available.',
    FAILED: 'The analysis did not finish. You can try again or continue manual review.',
    READY: astra.proposals?.length ? 'Astra suggestions are unreviewed. Accept, correct or reject each one you review.'
      : 'Astra returned no suggestions. Inspect both sides before confirming your findings.',
    STALE: 'These suggestions belong to an earlier image or card outline. Run a new analysis to use current evidence.',
  }[status];
  return { enabled: true, status, message, mayRequest: !['RUNNING', 'UNKNOWN'].includes(status) };
}

export function reviewedMemoryState(memory) {
  if (!memory?.enabled) return null;
  const status = ['UNSAVED', 'PENDING', 'SAVED', 'FAILED', 'UNKNOWN'].includes(memory.status) ? memory.status : 'UNKNOWN';
  return { status, mayRecover: ['PENDING', 'FAILED', 'UNKNOWN'].includes(status), message: {
    UNSAVED: 'Confirm findings also saves your reviewed outcomes as examples for future Astra analysis. Final report approval stays separate.',
    PENDING: 'Reviewed examples are pending. They will be available to later analysis after saving is confirmed.',
    SAVED: memory.exampleCount === 0 ? 'Reviewed outcome saved. There were no defect examples to add.'
      : 'Reviewed examples saved and available to future relevant Astra analysis.',
    FAILED: 'Reviewed examples are not yet saved. Retry saving the same reviewed outcomes.',
    UNKNOWN: 'The save status of your reviewed examples is not confirmed. Check the saved outcome.',
  }[status] };
}
