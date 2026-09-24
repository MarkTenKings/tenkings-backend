import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDealerOffersClient } from '../lib/dealer-offers-client.mjs';
function fixture() {
  const values = new Map(), staffId = randomUUID(), cardId = randomUUID(), approvalActionId = randomUUID();
  const f = { calls: [], revision: 0, approvalActionId, values };
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const request = async (url, options) => {
    f.calls.push({ url, options });
    if (!options) return { revision: f.revision, approvalActionId: f.approvalActionId, offers: [], sourceHash: 'a'.repeat(64), selectedIds: [] };
    assert.ok(values.size); if (f.write) return f.write(options.body);
    return { revision: options.body.expectedRevision + 1, approvalActionId: options.body.approvalActionId, presentation: { dealerOffers: options.body.selectedIds.map(id => ({ id })) } };
  };
  f.options = { staffId, cardId, approvalActionId, storage, request, cryptoImpl: { randomUUID } };
  f.client = createDealerOffersClient(f.options); f.selection = { sourceHash: 'a'.repeat(64), expectedRevision: 0, selectedIds: ['offer-one'] }; return f;
}
test('offer client has no mount write and sends only report revision, configured source and selected ids', async () => {
  const f = fixture(); assert.equal(f.calls.length, 0); await f.client.read(); assert.equal(f.calls[0].options, undefined);
  await f.client.select(f.selection); const body = f.calls.at(-1).options.body;
  assert.deepEqual(Object.keys(body).sort(), ['approvalActionId','expectedRevision','requestId','selectedIds','sourceHash']); assert.equal(f.client.pending(), null);
});
test('unknown selection survives reload and replays exact request; no replacement or wrong response clears it', async () => {
  const f = fixture(); f.write = () => { throw new Error('lost reply'); }; await assert.rejects(f.client.select(f.selection));
  const saved = f.client.pending(); f.client = createDealerOffersClient(f.options);
  await assert.rejects(f.client.select({ ...f.selection, selectedIds: [] }), { code: 'DEALER_OFFER_SELECTION_PENDING' });
  f.write = body => ({ revision: body.expectedRevision + 1, approvalActionId: body.approvalActionId, presentation: { dealerOffers: [] } });
  await assert.rejects(f.client.resume(), { code: 'DEALER_OFFER_COMMIT_UNCONFIRMED' }); assert.deepEqual(f.client.pending(), saved);
  f.write = null; await f.client.resume(); assert.deepEqual(f.calls.at(-1).options.body, saved); assert.equal(f.client.pending(), null);
});
test('changed configured terms or stale revision ends only its refused selection; empty selection removes offers explicitly', async () => {
  for (const code of ['DEALER_OFFER_SOURCE_CHANGED','PRESENTATION_REVISION_STALE','PRESENTATION_APPROVAL_STALE']) {
    const f = fixture(); f.write = () => { throw Object.assign(new Error(), { status: 409, code }); };
    await assert.rejects(f.client.select(f.selection), { code: 'DEALER_OFFER_REVIEW_REQUIRED' }); assert.equal(f.client.pending(), null); assert.equal(f.calls.length, 1);
  }
  const f = fixture(); await f.client.select({ ...f.selection, selectedIds: [] }); assert.deepEqual(f.calls[0].options.body.selectedIds, []);
});
test('staff storage is isolated and a new approved report reconciles only after server confirms it', async () => {
  const f = fixture(); f.write = () => { throw new Error('lost reply'); }; await assert.rejects(f.client.select(f.selection));
  assert.equal(createDealerOffersClient({ ...f.options, staffId: randomUUID() }).pending(), null);
  const next = randomUUID(), client = createDealerOffersClient({ ...f.options, approvalActionId: next });
  await assert.rejects(client.reconcileSuperseded(), { code: 'DEALER_OFFER_APPROVAL_STALE' }); assert.ok(f.client.pending());
  f.approvalActionId = next; await client.reconcileSuperseded(); assert.equal(client.pending(), null);
});
