import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLocalStore } from '../src/store.mjs';
import { createMarketplacePilot, intentId } from '../src/service.mjs';
import { reconcileFinanceIntent } from '../src/payment.mjs';
import { createRecoverySettlementCapability, assertRecoverySettlementCapability } from '../src/recovery-settlement.mjs';
import { actors, createLocalFixture } from '../scripts/local-fixture.mjs';

const environment = 'SYNTHETIC_LOCAL', platformAccountId = 'demo_platform';
function bind(store, assertRuntimeReady = () => true) {
  return createRecoverySettlementCapability({ enabled: true, store, environment, platformAccountId, approvalRef: 'demo_recovery_approval', assertRuntimeReady });
}
function compose(store, capability, fixture = createLocalFixture({ store, assets: false })) {
  return { ...fixture, service: createMarketplacePilot({ ...fixture, enabled: true, store, environment, platformAccountId, recoverySettlementCapability: capability }) };
}
async function reserved(service) {
  await service.recordConsent(actors.seller, { requestId: 'demo_consent', cardId: 'demo_card', choice: 'HOLD_AND_LIST', evidenceRef: 'demo_hold_consent' });
  const listing = await service.publishListing(actors.seller, { requestId: 'demo_listing', cardId: 'demo_card', askingPriceCents: 12500 });
  const quote = await service.quote(actors.buyer, listing.id);
  return service.reserve(actors.buyer, { requestId: 'demo_reserve', listingId: listing.id, listingVersion: listing.version, listingHash: listing.bindingHash, quoteId: quote.quoteId });
}

test('recovery settlement requires a genuine independently qualified capability and exact store scope', () => {
  assert.throws(() => createRecoverySettlementCapability(), { code: 'RECOVERY_SETTLEMENT_DISABLED' });
  const store = { read() {}, transaction() {} }, scope = { store, environment, platformAccountId };
  assert.throws(() => bind(store, async () => true), { code: 'RECOVERY_SETTLEMENT_UNAVAILABLE' });
  let approved = true;
  const capability = bind(store, () => approved);
  for (const forged of [{}, structuredClone(capability), actors.staff]) assert.throws(() => assertRecoverySettlementCapability(forged, scope), { code: 'RECOVERY_SETTLEMENT_UNAVAILABLE' });
  assert.throws(() => assertRecoverySettlementCapability(capability, { ...scope, store: { ...store } }), { code: 'RECOVERY_SETTLEMENT_UNAVAILABLE' });
  assert.throws(() => assertRecoverySettlementCapability(capability, { ...scope, platformAccountId: 'demo_foreign' }), { code: 'RECOVERY_SETTLEMENT_UNAVAILABLE' });
  approved = false;
  assert.throws(() => assertRecoverySettlementCapability(capability, scope), { code: 'RECOVERY_SETTLEMENT_UNAVAILABLE' });
  approved = true; store.transaction = () => {};
  assert.throws(() => assertRecoverySettlementCapability(capability, scope), { code: 'RECOVERY_SETTLEMENT_UNAVAILABLE' });
});

test('lost original payment recovers after restart and settles once without staff impersonation or another provider create', async () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-r2-worker-settle-'))), options = { filename: join(directory, 'owned.sqlite'), environment };
  let store = openLocalStore(options);
  try {
    const oldCapability = bind(store);
    let { service, provider } = compose(store, oldCapability);
    const reservation = await reserved(service), id = intentId('payment', reservation.id);
    provider.failNextCreateAfterCommit(id);
    await assert.rejects(() => service.pay(actors.buyer, { reservationId: reservation.id }), { code: 'SYNTHETIC_RESPONSE_LOST' });
    await assert.rejects(() => service.settleRecoveredPayments(oldCapability, { intentIds: [id] }), { code: 'RECOVERY_PAYMENT_NOT_SETTLEABLE' });
    store.close(); store = openLocalStore(options);
    const capability = bind(store); ({ service, provider } = compose(store, capability));
    provider.resolve(id, { status: 'succeeded', processingFeeCents: 300 });
    await reconcileFinanceIntent({ store, provider, intentId: id });
    const before = store.read();
    assert.equal(Object.keys(before.orders).length, 0);
    await assert.rejects(() => service.settleRecoveredPayments(oldCapability, { intentIds: [id] }), { code: 'RECOVERY_SETTLEMENT_UNAVAILABLE' });
    const first = await service.settleRecoveredPayments(capability, { intentIds: [id] });
    const repeated = await service.settleRecoveredPayments(capability, { intentIds: [id] });
    assert.deepEqual(repeated, first);
    const after = store.read();
    assert.equal(after.orders[reservation.orderId].status, 'PAID');
    assert.equal(Object.keys(after.orders).length, 1);
    assert.equal(after.fulfillment[reservation.orderId].status, 'AWAITING_PACKING');
    assert.equal(after.journals.length, before.journals.length);
    assert.equal(after.syntheticProvider.calls[id], 1);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('pending originals remain held, canceled originals release once, and request-shaped authority cannot settle', async () => {
  const store = openLocalStore({ filename: ':memory:', environment });
  try {
    const capability = bind(store), { service, provider } = compose(store, capability), reservation = await reserved(service), id = intentId('payment', reservation.id);
    await service.pay(actors.buyer, { reservationId: reservation.id });
    await assert.rejects(() => service.settleRecoveredPayments(actors.staff, { intentIds: [id] }), { code: 'RECOVERY_SETTLEMENT_UNAVAILABLE' });
    await assert.rejects(() => service.settleRecoveredPayments(capability, { intentIds: [id] }), { code: 'RECOVERY_PAYMENT_NOT_SETTLEABLE' });
    assert.equal(store.read().reservations[reservation.id].status, 'PAYMENT_PENDING');
    provider.resolve(id, { status: 'canceled' });
    await reconcileFinanceIntent({ store, provider, intentId: id });
    await assert.rejects(() => service.settleRecoveredPayments(capability, { intentIds: [id, id] }), { code: 'INVALID_REQUEST' });
    await assert.rejects(() => service.settleRecoveredPayments(capability, { intentIds: Array.from({ length: 101 }, (_, i) => `demo_${i}`) }), { code: 'INVALID_REQUEST' });
    await service.settleRecoveredPayments(capability, { intentIds: [id] });
    await service.settleRecoveredPayments(capability, { intentIds: [id] });
    const after = store.read();
    assert.equal(after.reservations[reservation.id].status, 'RELEASED');
    assert.equal(Object.keys(after.orders).length, 0);
    assert.equal(after.journals.length, 0);
    assert.equal(after.syntheticProvider.calls[id], 1);
  } finally { store.close(); }
});

test('worker readiness is checked again inside the settlement commit and revocation rolls back', async () => {
  const underlying = openLocalStore({ filename: ':memory:', environment });
  let approved = true, revokeOnCommit = false;
  const store = { read: (...args) => underlying.read(...args), transaction: fn => underlying.transaction(tx => { if (revokeOnCommit) approved = false; return fn(tx); }) };
  try {
    const capability = bind(store, () => approved), { service, provider } = compose(store, capability), reservation = await reserved(service), id = intentId('payment', reservation.id);
    await service.pay(actors.buyer, { reservationId: reservation.id });
    provider.resolve(id, { status: 'succeeded' });
    await reconcileFinanceIntent({ store, provider, intentId: id });
    revokeOnCommit = true;
    await assert.rejects(() => service.settleRecoveredPayments(capability, { intentIds: [id] }), { code: 'RECOVERY_SETTLEMENT_UNAVAILABLE' });
    assert.equal(Object.keys(store.read().orders).length, 0);
    approved = true; revokeOnCommit = false;
    await service.settleRecoveredPayments(capability, { intentIds: [id] });
    assert.equal(store.read().orders[reservation.orderId].status, 'PAID');
    const unconfigured = compose(store, undefined).service;
    await assert.rejects(() => unconfigured.settleRecoveredPayments(capability, { intentIds: [id] }), { code: 'RECOVERY_SETTLEMENT_UNAVAILABLE' });
  } finally { underlying.close(); }
});
