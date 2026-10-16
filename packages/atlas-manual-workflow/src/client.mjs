import { readManualResponse } from '@atlas/manual-service/response';
import { committedWorkspace, hasActionWorkspace, isCommittedAction } from './action-workspace.mjs';

/** Browser coordinator. Pending compact commands are scoped to staff + card.
 * A missing response retries/reconciles the SAME action ID and exact payload;
 * it never treats an unobserved save as success or invents a second action.
 */
export function createManualClient({ cardId, staffId, csrf, storage, basePath = '', timeoutMs = 45000, fetchImpl = fetch, onView = () => {}, onStatus = () => {}, imageScope = () => 'all' }) {
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>240000)throw new Error('Invalid request deadline');
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+$/.test(basePath) && basePath !== '') throw new Error('Invalid staff mount');
  const path = `${basePath}/api/staff/manual/cards/${cardId}`, key = `atlas-manual-pending:v1:${basePath ? `${basePath}:` : ''}${staffId}:${cardId}`;
  let view = null, active = false, refreshNeeded = false, committedFloor = null, epoch = 0, readSequence = 0, appliedRead = 0;
  const status = value => { try { onStatus(value); } catch { /* Observers cannot change durable save outcomes. */ } };
  const pending = () => { const value = storage.getItem(key); return value ? JSON.parse(value) : null; };
  // Another recovery client may finish this command and start a later one
  // while an earlier reply/view is still in flight. Clear only the exact
  // completed or definitely refused request, never just this card's slot.
  function clearPending(command) {
    if (storage.getItem(key) === JSON.stringify(command)) storage.removeItem(key);
  }
  async function request(url, body, workspaceScope = null) {
    const response = await fetchImpl(url, { credentials: 'same-origin', cache: 'no-store',
      ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-atlas-csrf': csrf,
        ...(workspaceScope ? { 'x-atlas-workspace': workspaceScope } : {}) }, body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs) });
    return readManualResponse(response);
  }
  function requireCommit(result, command) {
    if (!isCommittedAction(result, command, { cardId, staffId })) throw new Error('Save receipt could not be confirmed');
    return result;
  }
  async function readView(stateOnly = false, minimumRevision = 0) {
    const started = epoch, sequence = ++readSequence;
    const next = await request(`${path}/view${stateOnly ? '?scope=state' : imageScope() === 'inspection' ? '?images=inspection' : ''}`);
    if (started !== epoch || sequence < appliedRead) {
      if (view) return view;
      throw Object.assign(new Error('Workspace read superseded'), { code: 'MANUAL_DRAFT_STALE', status: 409 });
    }
    if (next.card.revision < minimumRevision || committedFloor && (next.card.revision < committedFloor.revision
      || next.card.revision === committedFloor.revision && next.card.contentHash !== committedFloor.contentHash)
      || view && (next.card.revision < view.card.revision || next.card.revision === view.card.revision
      && next.card.contentHash !== view.card.contentHash)) {
      throw Object.assign(new Error('Workspace read is stale'), { code: 'MANUAL_DRAFT_STALE', status: 409 });
    }
    view = next; appliedRead = sequence;
    if (!stateOnly) onView(view);
    return view;
  }
  async function load() {
    if (active) throw new Error('A save is already in progress');
    return readView();
  }
  async function finish(command, refresh = 'view', result = null) {
    // The POST/receipt has proved this action committed. A later failed read
    // must never replay it or invite another save with a new action ID.
    epoch++; refreshNeeded = true;
    if (!committedFloor || result.card.revision > committedFloor.revision)
      committedFloor = { revision: result.card.revision, contentHash: result.card.contentHash };
    // Intermediate geometry commands need authoritative bases for the next
    // save, not another set of photograph grants and ancillary report reads.
    // Never publish this partial state to the UI or merge old image metadata
    // into it. The sequence owner loads the full view at its boundary.
    try {
      clearPending(command);
      const next = refresh === 'view' ? committedWorkspace(result, command, view, { cardId, staffId, imageScope: imageScope() }) : null;
      if (next) { view = next; onView(view); }
      else await readView(refresh === 'state', command.expectedRevision + 1);
      refreshNeeded = false; status('Saved'); return view;
    } catch (error) {
      status('Saved; refreshing…');
      throw Object.assign(new Error('The edit is saved. Refresh the saved review before continuing.'), {
        code: 'MANUAL_SAVED_REFRESH_REQUIRED', status: error.status, committed: true, cause: error,
        committedRevision: result.card.revision, committedHash: result.card.contentHash,
      });
    }
  }
  async function reconcile(command) {
    const found = await request(`${path}/actions/${command.actionId}`);
    if (found.state === 'COMMITTED') {
      requireCommit(found.result, command);
      // A retained receipt proves the save, not freshness of a prior view.
      return finish(command, 'view', { ...found.result, workspace: undefined });
    }
    if (found.state !== 'NOT_FOUND') throw new Error('Save outcome unknown');
    const result = requireCommit(await request(`${path}/actions`, command), command);
    return finish(command, 'view', result);
  }
  async function send(command, refresh = 'view') {
    // Keep reconciliation bound to the bytes journaled before dispatch even
    // if the caller later mutates its action object.
    command = JSON.parse(JSON.stringify(command));
    // Initial view loading and trace calculation both await before reaching
    // this point. Another client may have journaled an uncertain action meanwhile.
    if (pending()) throw new Error('Resolve the pending save first');
    storage.setItem(key, JSON.stringify(command)); epoch++; status('Saving…');
    let result;
    try { result = requireCommit(await request(`${path}/actions`, command, refresh === 'view' && hasActionWorkspace(command.action.type) ? imageScope() : null), command); }
    catch (error) {
      if ([400, 401, 403, 404, 409, 413, 422].includes(error.status)) {
        clearPending(command); await readView().catch(() => {}); status('Change needs review'); throw error;
      }
      try { return await reconcile(command); }
      catch (recoveryError) {
        if (recoveryError.committed) throw recoveryError;
        status('Save not confirmed — retry the pending save'); throw error;
      }
    }
    return finish(command, refresh, result);
  }
  async function exclusive(work) {
    if (active) throw new Error('A save is already in progress');
    active = true; try { return await work(); } finally { active = false; }
  }
  return Object.freeze({
    load, current: () => view, hasPending: () => Boolean(pending()), needsRefresh: () => refreshNeeded,
    recover: () => exclusive(async () => {
      const command = pending();
      if (!command) {
        const current = await readView(); refreshNeeded = false; status('Saved'); return current;
      }
      await readView();
      status('Checking pending save…');
      try { return await reconcile(command); }
      catch (error) {
        if (error.committed) throw error;
        if ([400, 401, 403, 404, 409, 413, 422].includes(error.status)) {
          clearPending(command);
          // A refused old command is settled. Resume the authoritative card
          // instead of turning a stale browser journal into an extra review gate.
          // A denied/missing card or failed view read must still surface.
          const current = await readView();
          if (![401, 403, 404].includes(error.status)) { status('Saved'); return current; }
        }
        status('Last edit not confirmed — check its saved status'); throw error;
      }
    }),
    execute: (action, { refresh = 'view' } = {}) => exclusive(async () => {
      if (!['view', 'state'].includes(refresh)) throw new Error('Invalid save refresh');
      if (refreshNeeded) throw new Error('Refresh the saved review before continuing');
      if (pending()) throw new Error('Resolve the pending save first');
      if (!view) await readView();
      return send({ actionId: crypto.randomUUID(), expectedRevision: view.card.revision, action }, refresh);
    }),
    editDefect: input => exclusive(async () => {
      if (refreshNeeded) throw new Error('Refresh the saved review before continuing');
      if (pending()) throw new Error('Resolve the pending save first');
      if (!view) await readView();
      const expectedRevision = view.card.revision;
      const action = input.action.type === 'TRACE_SAVE'
        ? await request(`${path}/trace`, { side: input.side, base: input.base, findingId: input.action.findingId, trace: input.action.trace })
        : { type: 'DEFECT_EDIT', side: input.side, base: input.base, edit: input.action };
      return send({ actionId: crypto.randomUUID(), expectedRevision, action });
    }),
    reviewProposal: input => exclusive(async () => {
      if (refreshNeeded) throw new Error('Refresh the saved review before continuing');
      if (pending()) throw new Error('Resolve the pending save first');
      if (!view) await readView();
      const expectedRevision = view.card.revision;
      const fields = { side: input.side, base: input.base, analysisId: input.analysisId, proposalId: input.proposalId };
      const action = input.action === 'TRACE_SAVE'
        ? await request(`${path}/proposal-trace`, { ...fields, trace: input.trace })
        : { type: 'ASTRA_PROPOSAL_REVIEW', ...fields, action: input.action };
      return send({ actionId: crypto.randomUUID(), expectedRevision, action });
    }),
    previewReport: () => request(`${path}/report-preview`),
  });
}
