import { createStaffCompSearchClient } from './staff-comp-search-client.mjs';

/** Polls saved status only; no timer can start or retry a search. */
export function createStaffCompSearchController({ onChange = () => {}, onReady = () => {}, onAccessLost = () => {}, ...options } = {}) {
  const client = createStaffCompSearchClient(options);
  let closed = false, active = null, readyId = null, view = { phase: 'IDLE', status: null, pending: false, error: null };
  const emit = patch => { if (!closed) { view = { ...view, ...patch }; onChange({ ...view }); } };
  function close() { if (closed) return; closed = true; active?.abort(); client.close(); }
  async function run(kind, work) {
    if (closed || active) return null;
    const abort = new AbortController(); active = abort; emit({ phase: kind, error: null });
    try {
      const status = await work({ signal: abort.signal });
      if (closed || options.isCurrent() !== true) return null;
      emit({ phase: 'READY', status, pending: status.pending, error: null });
      if (status.state === 'READY' && status.previewId !== readyId) {
        readyId = status.previewId; onReady({ previewId: status.previewId, approvalActionId: status.approvalActionId });
      }
      return status;
    } catch (error) {
      if (closed) return null;
      if (error?.code === 'COMP_ACCESS_ENDED' || error?.status === 401 || error?.status === 403) { close(); onAccessLost(); return null; }
      let pending = true;
      try { pending = client.pending(); } catch {}
      emit({ phase: 'UNAVAILABLE', pending, error: error?.code === 'COMP_SEARCH_SELECTION_PENDING' ? 'SELECTION_PENDING'
        : error?.code === 'COMP_SEARCH_APPROVAL_CHANGED' ? 'APPROVAL_CHANGED' : pending ? 'OUTCOME_UNCONFIRMED' : 'READ_UNAVAILABLE' });
      return null;
    } finally { if (active === abort) active = null; }
  }
  return Object.freeze({ read: () => run('READING', client.read), start: () => run('STARTING', client.start), retry: () => run('STARTING', client.retry), close,
    snapshot: () => ({ ...view }) });
}
