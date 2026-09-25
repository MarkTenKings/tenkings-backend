const base = '/api/staff/manual-intake/cards';
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const unique = values => [...new Set(values.filter(uuid))];
const fail = code => { throw Object.assign(new Error(code), { code }); };
export const discardKey = staffId => `atlas-workspace-discard:v1:${staffId}`;
export const discardEvent = 'atlas-workspace-discard';
export const hasPendingDiscard = (storage, staffId) => Boolean(storage?.getItem(discardKey(staffId)));
export function announceDiscard(staffId, confirmed = null) {
  if (typeof window !== 'undefined' && typeof CustomEvent === 'function') window.dispatchEvent(new CustomEvent(discardEvent, { detail: { staffId, confirmed } }));
}
export function discardedIdsFromEvent(event) {
  if (event.detail?.confirmed) return event.detail.confirmed;
  if (event.type !== 'storage' || event.newValue !== null || !event.oldValue) return null;
  try {
    const value = JSON.parse(event.oldValue);
    if (!value.requests?.length || value.requests.some(entry => !entry.receipt)) return null;
    return { createRequestIds: unique(value.requests.flatMap(entry => entry.receipt.createRequestIds)),
      cardIds: unique(value.requests.flatMap(entry => entry.receipt.cardIds)) };
  } catch { return null; }
}
export function clearDiscardedCommands(storage, staffId, cardIds) {
  const deleted = new Set(cardIds);
  for (const id of deleted) for (const key of [`atlas-connected-command:${staffId}:${id}`,
    `atlas-manual-pending:v1:/admin:${staffId}:${id}`, `atlas-manual-pending:v1:${staffId}:${id}`, `atlas-defect-analysis:v1:${staffId}:${id}`]) storage.removeItem(key);
  const key = `atlas-batch-enqueue:${staffId}`, saved = storage.getItem(key);
  if (saved) {
    // Never rewrite a multi-card idempotent request into a different request.
    let body; try { body = JSON.parse(saved); } catch { return; }
    if (body.cards?.length && body.cards.every(card => deleted.has(card.cardId)) && storage.getItem(key) === saved) storage.removeItem(key);
  }
}
function checkedStatus(value) {
  for (const name of ['createRequestIds', 'cardIds']) if (!Array.isArray(value?.[name]) || value[name].some(id => !uuid(id))
    || new Set(value[name]).size !== value[name].length) fail('INTAKE_DISCARD_REPLY_INVALID');
  return value;
}
function checkedReceipt(value, body) {
  const receipt = checkedStatus(value?.receipt);
  if (receipt.requestId !== body.requestId || receipt.scope !== body.scope || !Number.isFinite(Date.parse(receipt.discardedAt))
    || !body.createRequestIds.every(id => receipt.createRequestIds.includes(id))
    || !body.cardIds.every(id => receipt.cardIds.includes(id))) fail('INTAKE_DISCARD_REPLY_INVALID');
  return receipt;
}

/** A retained request is the recovery authority. Two IndexedDB stores cannot
 * commit together, so keep the acknowledged receipt until both retirements
 * and exact card-command cleanup finish. No original is removed on timeout. */
export function createWorkspaceDiscarder({ staffId, request, batchJournal, intakeJournal, storage = globalThis.localStorage,
  locks = globalThis.navigator?.locks, cryptoImpl = globalThis.crypto, pause = async () => {}, resume = () => {} }) {
  const key = discardKey(staffId);
  const read = () => { const value = storage.getItem(key); return value ? JSON.parse(value) : null; };
  const save = value => { storage.setItem(key, JSON.stringify(value)); announceDiscard(staffId); };
  async function snapshot() {
    const batch = await (batchJournal.getMetadata?.() ?? batchJournal.get());
    const pending = await intakeJournal.list({ metadataOnly: true });
    return { batch, pending, createRequestIds: unique([...(batch?.items ?? []).map(item => item.createId),
      ...pending.filter(item => item.value.kind === 'create').map(item => item.value.input.requestId)]),
    cardIds: unique([...(batch?.items ?? []).map(item => item.cardId), ...pending.map(item => item.value.cardId)]) };
  }
  async function retire(value, draftId = null) {
    await intakeJournal.retire(value);
    await batchJournal.retire({ ...value, draftId });
    clearDiscardedCommands(storage, staffId, value.cardIds);
    announceDiscard(staffId, value);
  }
  async function complete(intent) {
    await pause();
    if (!intent.requests) {
      const saved = await snapshot();
      const selectedCards = new Set(intent.cardIds), selectedCreates = new Set(intent.createRequestIds);
      const items = (saved.batch?.items ?? []).filter(item => intent.scope === 'ALL' || selectedCards.has(item.cardId) || selectedCreates.has(item.createId));
      const creates = unique([...intent.createRequestIds, ...(intent.scope === 'ALL' ? saved.createRequestIds : items.map(item => item.createId))]);
      const cards = unique([...intent.cardIds, ...(intent.scope === 'ALL' ? saved.cardIds : items.map(item => item.cardId))]);
      const count = Math.max(1, Math.ceil(creates.length / 100), Math.ceil(cards.length / 100));
      intent = { ...intent, draftId: intent.scope === 'ALL' ? saved.batch?.draft?.id ?? null : null,
        requests: Array.from({ length: count }, (_, index) => ({ body: { requestId: index ? cryptoImpl.randomUUID() : intent.requestId,
          scope: index ? 'SELECTED' : intent.scope, createRequestIds: creates.slice(index * 100, index * 100 + 100), cardIds: cards.slice(index * 100, index * 100 + 100) } })) };
      save(intent);
    }
    for (const entry of intent.requests) {
      if (entry.receipt) continue;
      let response;
      try { response = await request(`${base}/discard`, { method: 'POST', body: entry.body }); }
      catch (failure) {
        // These are atomic pre-effect refusals. An acknowledged earlier chunk
        // still needs its retained recovery record; never erase that progress.
        if (!intent.requests.some(value => value.receipt) && ((failure?.status === 409 && failure.code === 'INTAKE_CARD_HAS_COMMITTED_OBLIGATIONS')
          || (failure?.status === 404 && failure.code === 'INTAKE_CARD_NOT_FOUND'))) {
          storage.removeItem(key); announceDiscard(staffId); resume();
        }
        throw failure;
      }
      entry.receipt = checkedReceipt(response, entry.body);
      save(intent);
    }
    const value = { createRequestIds: unique(intent.requests.flatMap(entry => entry.receipt.createRequestIds)),
      cardIds: unique(intent.requests.flatMap(entry => entry.receipt.cardIds)) };
    await retire(value, intent.draftId);
    storage.removeItem(key); announceDiscard(staffId, value); resume(); return value;
  }
  async function exclusive(work) {
    if (!locks) fail('BATCH_IMPORT_BUSY');
    return locks.request(`atlas-workspace-discard:${staffId}`, { ifAvailable: true }, lock => {
      if (!lock) fail('INTAKE_DISCARD_BUSY'); return work();
    });
  }
  return Object.freeze({
    pending: () => Boolean(read()),
    discard: ({ scope = 'ALL', createRequestIds = [], cardIds = [] } = {}) => exclusive(async () => {
      let intent = read();
      if (!intent) {
        if (!['ALL', 'SELECTED'].includes(scope) || createRequestIds.some(id => !uuid(id)) || cardIds.some(id => !uuid(id))
          || (scope === 'SELECTED' && !createRequestIds.length && !cardIds.length)) fail('INTAKE_DISCARD_INVALID');
        intent = { version: 1, requestId: cryptoImpl.randomUUID(), scope, createRequestIds: unique(createRequestIds), cardIds: unique(cardIds) };
        save(intent);
      }
      return complete(intent);
    }),
    recover: () => exclusive(async () => { const intent = read(); return intent ? complete(intent) : null; }),
    reconcile: async () => {
      if (read()) return exclusive(async () => { const intent=read();return intent?complete(intent):null; });
      // A status-only request must not stop local capture or hold the deletion
      // lock while offline. Confirmed-ID journal fences protect concurrent puts.
        const saved = await snapshot(), value = { createRequestIds: [], cardIds: [] };
        for (let offset = 0; offset < Math.max(saved.createRequestIds.length, saved.cardIds.length); offset += 100) {
          const body = { createRequestIds: saved.createRequestIds.slice(offset, offset + 100), cardIds: saved.cardIds.slice(offset, offset + 100) };
          const result = checkedStatus(await request(`${base}/discard-status`, { method: 'POST', body }));
          if (!result.createRequestIds.every(id => body.createRequestIds.includes(id)) || !result.cardIds.every(id => body.cardIds.includes(id))) fail('INTAKE_DISCARD_REPLY_INVALID');
          value.createRequestIds.push(...result.createRequestIds); value.cardIds.push(...result.cardIds);
        }
        if (value.createRequestIds.length || value.cardIds.length) await retire(value);
        return value;
    },
  });
}
