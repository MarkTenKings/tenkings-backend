import { designationDecisionRows } from './staff-comp-designation-review.mjs';
import { createStaffCompCurationClient, curationDecisionInput, curationReadInput, curationStaff, curationSame, curationError,
  parseCurationState, parseCurationReceipt } from './staff-comp-curation-client.mjs';

const copy = value => JSON.parse(JSON.stringify(value));
/** Per-mounted-account controller. Its owner must synchronously dispose on
 * account object/access/config change, logout, pagehide and unmount. No storage
 * persistence or automatic retry; losing this in-memory context cannot prove
 * an unresolved save failed. No grade, report, listing or asking-price writer. */
export function createStaffCompCurationController({ staff, cardId, input, request, onChange = () => {}, onAccessLost = () => {} } = {}) {
  const actor = curationStaff(staff), readInput = curationReadInput(input), client = createStaffCompCurationClient({ request });
  const expected = { cardId, approvalActionId: readInput.approvalActionId, previewId: readInput.previewId, mode: actor.mode };
  let ended = false, generation = 0, active = null, pending = null;
  let view = { phase: typeof request === 'function' ? 'IDLE' : 'DISABLED', state: null, receipt: null, pending: null, error: null };
  const emit = patch => { if (!ended) { view = { ...view, ...patch }; onChange(copy(view)); } };
  const dispose = () => {
    if (ended) return; ended = true; generation++; active?.abort(); active = null; pending = null;
    view = { phase: 'ENDED', state: null, receipt: null, pending: null, error: null }; onChange(copy(view));
  };
  function ready() {
    if (ended) throw curationError('COMP_ACCESS_ENDED');
    if (typeof request !== 'function') throw curationError('COMP_NOT_CONFIGURED');
    if (active) throw curationError('COMP_BUSY');
  }
  function matches(receipt, record) {
    const p = record.input;
    return receipt.requestId === p.requestId && receipt.actorId === actor.id && receipt.revision === p.expectedSelectionRevision + 1
      && receipt.outcome === p.outcome && curationSame(receipt.binding, record.binding) && curationSame(receipt.source, record.source)
      && receipt.policyHash === record.policyHash && curationSame(receipt.policy, record.policy)
      && curationSame(receipt.selected.map(c => c.id).sort(), p.selectedIds)
      && (p.outcome !== 'SELECTED' || curationSame(receipt.selected, p.designationReviews ? designationDecisionRows(record.reviewState, p, actor.id, receipt.asOf) : record.selected));
  }
  async function run(kind, work) {
    ready(); const controller = new AbortController(), turn = ++generation; active = controller;
    emit({ phase: kind, error: null });
    try {
      const result = await work(controller.signal);
      if (ended || turn !== generation) return null;
      return result;
    } catch (error) {
      if (ended || turn !== generation) return null;
      if (error.code === 'COMP_ACCESS_ENDED') { dispose(); onAccessLost(); return null; }
      // A read failure removes potentially stale private evidence, but keeps
      // the exact uncertain request. It never creates a new revision/request.
      emit({ phase: pending ? 'UNRESOLVED' : 'UNAVAILABLE', state: null, receipt: null,
        error: pending ? 'COMP_OUTCOME_UNKNOWN' : 'COMP_UNAVAILABLE' }); return null;
    } finally { if (turn === generation) active = null; }
  }
  async function load() {
    if (pending) throw curationError('COMP_RECONCILE_REQUIRED');
    return run('LOADING', async signal => {
      const state = parseCurationState(await client.read({ staff: actor, cardId, input: readInput, signal }), expected);
      if (!ended) emit({ phase: 'READY', state, receipt: null }); return state;
    });
  }
  async function send(record) {
    return run('SAVING', async signal => {
      const receipt = parseCurationReceipt(await client.decide({ staff: actor, cardId, input: record.input, signal }), expected);
      if (!matches(receipt, record)) throw curationError('COMP_OUTCOME_UNKNOWN');
      if (!ended) { pending = null; emit({ phase: 'CONFIRMED', state: null, receipt, pending: null }); } return receipt;
    });
  }
  async function decide({ requestId, outcome, selectedIds = [], reviewedIds = [], designationReviews } = {}) {
    ready(); if (pending) throw curationError('COMP_RECONCILE_REQUIRED');
    const state = view.state; if (!state || view.phase !== 'READY') throw curationError('COMP_READ_REQUIRED');
    const decision = curationDecisionInput({ requestId, approvalActionId: readInput.approvalActionId, expectedSelectionRevision: state.revision,
      previewId: readInput.previewId, expectedPreviewHash: state.source?.previewHash ?? null,
      outcome, selectedIds, reviewedIds, expectedPolicyHash: state.policyHash, ...(designationReviews === undefined ? {} : { designationReviews }) });
    const selected = outcome === 'SELECTED' ? designationDecisionRows(state, decision, actor.id) : [];
    pending = { input: decision, binding: state.binding, source: state.source, policy: state.policy, policyHash: state.policyHash, selected,
      ...(decision.designationReviews ? { reviewState: copy(state) } : {}) };
    // Only the request ID is needed for display; private pending evidence stays
    // in memory and is destroyed on access loss. It is never placed in a URL.
    emit({ pending: { requestId, outcome }, receipt: null }); return send(pending);
  }
  async function reconcile() {
    ready(); if (!pending) throw curationError('COMP_NO_PENDING_REQUEST'); const record = pending;
    return run('RECONCILING', async signal => {
      const state = parseCurationState(await client.read({ staff: actor, cardId, input: readInput, signal }), expected);
      if (state.selection && matches(state.selection, record)) {
        if (!ended) { pending = null; emit({ phase: 'CONFIRMED', state, receipt: state.selection, pending: null }); }
      } else if (!ended) emit({ phase: 'UNRESOLVED', state: null, receipt: null, error: 'COMP_OUTCOME_UNKNOWN' });
      return state;
    });
  }
  // Deliberate retry only, with the original immutable input. Existing service
  // replay can retrieve an older exact receipt; GET cannot. A stale source/ACL
  // refusal still leaves uncertainty, and no changed payload is admitted.
  async function retry() { ready(); if (!pending) throw curationError('COMP_NO_PENDING_REQUEST'); return send(pending); }
  return Object.freeze({ snapshot: () => copy(view), load, decide, reconcile, retry, dispose,
    assertScope(currentStaff) {
      try { if (currentStaff !== staff || !curationSame(curationStaff(currentStaff), actor)) dispose(); }
      catch { dispose(); }
      return !ended;
    } });
}
