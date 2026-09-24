const fail = code => Object.assign(new Error(code), { code });
const check = (value, code) => { if (!value) throw fail(code); };
const uuid = value => /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value ?? '');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function createDealerOffersClient({ staffId, cardId, approvalActionId, storage, request, cryptoImpl = globalThis.crypto }) {
  check(uuid(staffId) && uuid(cardId) && uuid(approvalActionId) && storage && typeof request === 'function', 'DEALER_OFFER_CLIENT_INVALID');
  const key = `atlas-report-offers:${staffId}:${cardId}`, path = `/api/staff/manual-connected/cards/${cardId}/presentation/dealer-offers`;
  let running = false;
  function pending() {
    let value; try { value = JSON.parse(storage.getItem(key) ?? 'null'); } catch { throw fail('DEALER_OFFER_PENDING_INVALID'); }
    if (value) check(uuid(value.requestId) && uuid(value.approvalActionId) && Number.isSafeInteger(value.expectedRevision) && value.expectedRevision >= 0
      && /^[a-f0-9]{64}$/.test(value.sourceHash ?? '') && Array.isArray(value.selectedIds) && value.selectedIds.length <= 40
      && value.selectedIds.every(id => typeof id === 'string') && new Set(value.selectedIds).size === value.selectedIds.length, 'DEALER_OFFER_PENDING_INVALID');
    return value;
  }
  const clear = value => { if (pending()?.requestId === value.requestId) storage.removeItem(key); };
  async function read() {
    const value = await request(path);
    check(value.approvalActionId === approvalActionId && Number.isSafeInteger(value.revision) && Array.isArray(value.offers), 'DEALER_OFFER_APPROVAL_STALE');
    return value;
  }
  async function exclusive(work) { check(!running, 'DEALER_OFFER_BUSY'); running = true; try { return await work(); } finally { running = false; } }
  async function commit(value) {
    check(value && value.approvalActionId === approvalActionId, 'DEALER_OFFER_APPROVAL_STALE');
    let result;
    try { result = await request(path, { method: 'POST', body: value }); }
    catch (error) {
      if (error?.status === 409 && ['DEALER_OFFER_SOURCE_CHANGED', 'PRESENTATION_REVISION_STALE', 'PRESENTATION_APPROVAL_STALE'].includes(error.code)) {
        clear(value); throw fail('DEALER_OFFER_REVIEW_REQUIRED');
      }
      throw error;
    }
    check(result?.approvalActionId === value.approvalActionId && result.revision === value.expectedRevision + 1
      && same(result.presentation?.dealerOffers?.map(offer => offer.id), value.selectedIds), 'DEALER_OFFER_COMMIT_UNCONFIRMED');
    clear(value); return result;
  }
  return Object.freeze({ pending, read,
    select: input => exclusive(async () => {
      check(!pending(), 'DEALER_OFFER_SELECTION_PENDING');
      const value = { requestId: cryptoImpl.randomUUID(), approvalActionId, expectedRevision: input.expectedRevision,
        sourceHash: input.sourceHash, selectedIds: [...input.selectedIds] };
      storage.setItem(key, JSON.stringify(value)); return commit(pending());
    }),
    resume: () => exclusive(() => commit(pending())),
    reconcileSuperseded: () => exclusive(async () => { await read(); const saved = pending();
      check(saved && saved.approvalActionId !== approvalActionId, 'DEALER_OFFER_REQUEST_CURRENT'); clear(saved); }),
  });
}
