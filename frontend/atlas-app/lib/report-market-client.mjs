const fail = code => Object.assign(new Error(code), { code });
const check = (value, code = 'MARKET_CLIENT_INVALID') => { if (!value) throw fail(code); };
const uuid = value => /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value ?? '');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Only request ids and selection ids are retained in the browser. Search
// evidence and its integrity hash stay in the server's approved-card scope.
export function createReportMarketClient({ cardId, staffId, approvalActionId, request, storage, cryptoImpl = globalThis.crypto }) {
  check(uuid(cardId) && uuid(staffId) && uuid(approvalActionId) && storage && typeof request === 'function');
  const key = `atlas-report-market:${staffId}:${cardId}`, path = `/api/staff/manual-connected/cards/${cardId}/presentation`;
  let running = false, sawReady = false;
  const post = (url, body) => request(url, { method: 'POST', body });
  function pending() {
    let saved; try { saved = JSON.parse(storage.getItem(key) ?? 'null'); } catch { throw fail('MARKET_PENDING_INVALID'); }
    if (saved) check(saved.version === 1 && saved.cardId === cardId && saved.staffId === staffId
      && uuid(saved.search?.requestId) && uuid(saved.search?.approvalActionId)
      && Number.isSafeInteger(saved.search?.expectedRevision) && saved.search.expectedRevision >= 0
      && (!saved.selection || (uuid(saved.selection.requestId) && saved.selection.previewId === saved.search.requestId
        && Array.isArray(saved.selection.selectedIds) && saved.selection.selectedIds.length > 0)), 'MARKET_PENDING_INVALID');
    return saved;
  }
  function save(value) { storage.setItem(key, JSON.stringify(value)); }
  function clear(saved) { if (pending()?.search.requestId === saved.search.requestId) storage.removeItem(key); }
  async function current() {
    const status = await request(path);
    check(status.approvalActionId === approvalActionId && Number.isSafeInteger(status.revision) && status.revision >= 0, 'MARKET_APPROVAL_STALE');
    return status;
  }
  async function exclusive(work) { check(!running, 'MARKET_CLIENT_BUSY'); running = true; try { return await work(); } finally { running = false; } }
  async function commit(saved) {
    check(saved?.selection, 'MARKET_SELECTION_MISSING');
    check(saved.selection.approvalActionId === approvalActionId, 'MARKET_APPROVAL_STALE');
    let result;
    try { result = await post(`${path}/market/select`, saved.selection); }
    catch (error) {
      // The service checks an exact committed receipt before these terminal
      // refusals. They prove this request cannot change the current report;
      // ordinary network/unknown outcomes always keep their exact intent.
      if (error?.status === 409 && ['MARKET_PREVIEW_EXPIRED', 'PRESENTATION_REVISION_STALE', 'PRESENTATION_APPROVAL_STALE'].includes(error.code)) {
        clear(saved); sawReady = false; throw fail('MARKET_SELECTION_REVIEW_REQUIRED');
      }
      throw error;
    }
    check(result?.approvalActionId === saved.selection.approvalActionId && result.revision > saved.selection.expectedRevision
      && result.presentation?.market && same(result.presentation.market.sales.map(sale => sale.id).sort(), [...saved.selection.selectedIds].sort()), 'MARKET_COMMIT_UNCONFIRMED');
    clear(saved); sawReady = false; return result;
  }
  return Object.freeze({
    pending, read: current,
    preview: () => exclusive(async () => {
      let saved = pending(); check(!saved?.selection, 'MARKET_SELECTION_PENDING');
      check(!saved || saved.search.approvalActionId === approvalActionId, 'MARKET_APPROVAL_STALE');
      if (!saved || sawReady) {
        const status = await current();
        saved = { version: 1, cardId, staffId, search: { requestId: cryptoImpl.randomUUID(), approvalActionId, expectedRevision: status.revision } };
        save(saved); sawReady = false;
      }
      const result = await post(`${path}/market/search`, saved.search);
      if (result?.state === 'UNAVAILABLE') { clear(saved); return result; }
      check(result?.previewId === saved.search.requestId, 'MARKET_PREVIEW_MISMATCH');
      if (result.state === 'PENDING' || result.state === 'UNKNOWN') throw fail(`MARKET_SEARCH_${result.state}`);
      check(result.state === 'READY' && result.preview?.binding?.approvalVersion > 0, 'MARKET_PREVIEW_INVALID');
      sawReady = true; return result;
    }),
    select: input => exclusive(async () => {
      let saved = pending(); check(saved && saved.search.requestId === input.previewId, 'MARKET_PREVIEW_MISMATCH');
      check(Array.isArray(input.selectedIds) && input.selectedIds.length > 0 && input.selectedIds.length <= 60
        && new Set(input.selectedIds).size === input.selectedIds.length && input.selectedIds.every(id => typeof id === 'string'), 'MARKET_SELECTION_INVALID');
      if (saved.selection) check(same(saved.selection.selectedIds, input.selectedIds), 'MARKET_SELECTION_PENDING');
      else {
        const status = await current();
        saved = { ...saved, selection: { requestId: cryptoImpl.randomUUID(), approvalActionId,
          expectedRevision: status.revision, previewId: input.previewId, selectedIds: [...input.selectedIds] } };
        save(saved);
      }
      return commit(saved);
    }),
    resumeSelection: () => exclusive(() => commit(pending())),
    reconcileSuperseded: () => exclusive(async () => {
      const saved = pending(), status = await current();
      check(saved && saved.search.approvalActionId !== status.approvalActionId, 'MARKET_REQUEST_CURRENT');
      clear(saved); sawReady = false; return status;
    }),
  });
}
