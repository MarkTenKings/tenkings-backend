import { compCurationCard } from './staff-comp-curation-entry.mjs';
import { curationStaff } from './staff-comp-curation-client.mjs';

const uuid = value => /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value ?? '');
const fail = code => Object.assign(new Error(code), { code });
const check = (value, code = 'COMP_SEARCH_INVALID') => { if (!value) throw fail(code); };
const copy = value => JSON.parse(JSON.stringify(value));
const states = ['NOT_REQUESTED', 'QUEUED', 'SEARCHING', 'PENDING', 'UNKNOWN', 'FAILED', 'UNAVAILABLE', 'READY'];

/** Acquisition/status only. Shares the existing report-market request journal;
 * never invokes its public-selection endpoint. The host provides authenticated
 * JSON transport and a synchronous lifetime/selection fence. */
export function createStaffCompSearchClient({ staff, card, request, storage, isCurrent, canSearch = () => true, cryptoImpl = globalThis.crypto } = {}) {
  const actor = curationStaff(staff), binding = compCurationCard(card), identity = JSON.stringify({ actor, binding });
  check(typeof request === 'function' && typeof isCurrent === 'function' && typeof canSearch === 'function' && storage);
  const path = `/api/staff/manual-connected/cards/${binding.cardId}/presentation`, key = `atlas-report-market:${actor.id}:${binding.cardId}`;
  let ended = false, busy = false;
  function current() {
    check(!ended && isCurrent() === true && JSON.stringify({ actor: curationStaff(staff), binding: compCurationCard(card) }) === identity, 'COMP_ACCESS_ENDED');
  }
  function pending() {
    current(); let value;
    try { value = JSON.parse(storage.getItem(key) ?? 'null'); } catch { throw fail('COMP_SEARCH_STORAGE_UNAVAILABLE'); }
    if (value) {
      check(value.version === 1 && value.cardId === binding.cardId && value.staffId === actor.id && uuid(value.search?.requestId)
        && uuid(value.search?.approvalActionId) && Number.isSafeInteger(value.search.expectedRevision) && value.search.expectedRevision >= 0
        && (!value.previewId || uuid(value.previewId)) && (!value.search.afterPreviewId || uuid(value.search.afterPreviewId)), 'COMP_SEARCH_PENDING_INVALID');
      check(!value.selection, 'COMP_SEARCH_SELECTION_PENDING');
      check(value.search.approvalActionId === binding.approvalActionId, 'COMP_SEARCH_APPROVAL_CHANGED');
    }
    return value;
  }
  function retain(value) {
    current(); try { storage.setItem(key, JSON.stringify(value)); check(storage.getItem(key) === JSON.stringify(value)); }
    catch { throw fail('COMP_SEARCH_STORAGE_UNAVAILABLE'); }
  }
  function clear(value) {
    check(pending()?.search.requestId === value.search.requestId, 'COMP_SEARCH_PENDING_CHANGED');
    try { storage.removeItem(key); check(storage.getItem(key) === null); } catch { throw fail('COMP_SEARCH_STORAGE_UNAVAILABLE'); }
  }
  function status(value) {
    check(value && states.includes(value.state));
    if (value.state !== 'NOT_REQUESTED') check(value.approvalActionId === binding.approvalActionId && uuid(value.previewId), 'COMP_SEARCH_APPROVAL_CHANGED');
    if (value.state === 'READY') {
      const b = value.preview?.binding;
      check(b?.publicToken === binding.publicToken && b.approvalVersion === binding.publicVersion && b.publicHash === binding.publicHash
        && Array.isArray(value.preview.candidates), 'COMP_SEARCH_APPROVAL_CHANGED');
    }
    return { state: value.state, previewId: value.previewId ?? null, approvalActionId: binding.approvalActionId,
      refreshable: value.refreshable === true, retrySavedResponse: value.refreshAction === 'RETRY_SAVED_RESPONSE',
      stage: value.stage === 'READING_PHOTOS' ? 'READING_PHOTOS' : null,
      count: value.state === 'READY' ? value.preview.candidates.length : null };
  }
  async function get(signal) {
    current(); const value = await request(path, { method: 'GET', signal }); current();
    check(value?.approvalActionId === binding.approvalActionId && Number.isSafeInteger(value.revision) && value.revision >= 0, 'COMP_SEARCH_APPROVAL_CHANGED');
    const summary = status(value.marketSearch), saved = pending();
    if (saved && summary.previewId === (saved.previewId ?? saved.search.requestId)
      && ['READY', 'FAILED', 'UNAVAILABLE'].includes(summary.state) && summary.refreshable) clear(saved);
    return { ...summary, presentationRevision: value.revision, pending: pending() !== null };
  }
  async function exclusive(work) { current(); check(!busy, 'COMP_SEARCH_BUSY'); busy = true; try { return await work(); } finally { busy = false; } }
  async function send(saved, signal) {
    current(); check(canSearch() === true, 'COMP_SEARCH_SELECTION_PENDING');
    check(JSON.stringify(pending()) === JSON.stringify(saved), 'COMP_SEARCH_PENDING_CHANGED');
    let result;
    try { result = await request(`${path}/market/search`, { method: 'POST', body: copy(saved.search), signal }); current(); }
    catch (error) {
      // Only this exact pre-reservation refusal proves there was no new effect.
      if (error?.status === 409 && error.code === 'PRESENTATION_REVISION_STALE') { current(); clear(saved); }
      throw error;
    }
    if (result?.state === 'UNAVAILABLE' && result.reason === 'PROVIDER_NOT_CONFIGURED' && result.refreshable === false) {
      clear(saved); return { state: 'UNAVAILABLE', previewId: null, approvalActionId: binding.approvalActionId, refreshable: false, pending: false };
    }
    check(result?.previewId === (saved.previewId ?? saved.search.requestId)
      || result?.requestId === saved.search.requestId && uuid(result.previewId), 'COMP_SEARCH_UNCONFIRMED');
    // Server recovery may resume retained provider evidence under its original ID.
    if (result.previewId !== (saved.previewId ?? saved.search.requestId)) { saved = { ...saved, previewId: result.previewId }; retain(saved); }
    const summary = status(result);
    if (['READY', 'FAILED', 'UNAVAILABLE'].includes(summary.state) && summary.refreshable) clear(saved);
    return { ...summary, pending: pending() !== null };
  }
  return Object.freeze({
    read: ({ signal } = {}) => exclusive(() => get(signal)),
    start: ({ signal } = {}) => exclusive(async () => {
      check(canSearch() === true, 'COMP_SEARCH_SELECTION_PENDING');
      check(!pending(), 'COMP_SEARCH_RECONCILE_REQUIRED');
      const value = await get(signal); current(); check(canSearch() === true, 'COMP_SEARCH_SELECTION_PENDING');
      check(value.refreshable && !['QUEUED', 'SEARCHING', 'PENDING', 'UNKNOWN'].includes(value.state), 'COMP_SEARCH_RECONCILE_REQUIRED');
      const saved = { version: 1, cardId: binding.cardId, staffId: actor.id,
        search: { requestId: cryptoImpl.randomUUID(), approvalActionId: binding.approvalActionId, expectedRevision: value.presentationRevision } };
      retain(saved); return send(saved, signal);
    }),
    retry: ({ signal } = {}) => exclusive(() => { const saved = pending(); check(saved, 'COMP_SEARCH_NO_PENDING_REQUEST'); return send(saved, signal); }),
    pending: () => pending() !== null,
    close() { ended = true; },
  });
}
