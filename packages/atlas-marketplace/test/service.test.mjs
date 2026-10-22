import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { openLocalStore } from '../src/store.mjs';
import { createMarketplacePilot, intentId } from '../src/service.mjs';
import { assertJournal } from '../src/ledger.mjs';
import { reconcileFinanceIntent } from '../src/payment.mjs';
import { actors, createLocalFixture, syntheticFulfillmentEvidence } from '../scripts/local-fixture.mjs';

test('durable local listing → unknown payment → restart → exact sale → protected delivery → transfer → bank payout', async () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-r2-e2e-')));
  let now = Date.parse('2026-10-22T22:00:00Z');
  const options = { filename: join(directory, 'owned.sqlite'), environment: 'SYNTHETIC_LOCAL', clock: () => now };
  let store = openLocalStore(options);
  let fixture = createLocalFixture({ store, clock: () => now, assets: false });
  let { service, provider } = fixture;
  try {
    await assert.rejects(() => service.publishListing(actors.seller, { requestId: 'demo_l1', cardId: 'demo_card', askingPriceCents: 12500 }), { code: 'HOLD_CONSENT_REQUIRED' });
    await service.recordConsent(actors.seller, { requestId: 'demo_consent', cardId: 'demo_card', choice: 'HOLD_AND_LIST', evidenceRef: 'demo_hold_consent' });
    const listing = await service.publishListing(actors.seller, { requestId: 'demo_l1', cardId: 'demo_card', askingPriceCents: 12500 });
    const [quote, competitorQuote] = await Promise.all([service.quote(actors.buyer, listing.id), service.quote(actors.alternateBuyer, listing.id)]);
    const reserveInput = { requestId: 'demo_r1', listingId: listing.id, listingVersion: listing.version, listingHash: listing.bindingHash, quoteId: quote.quoteId };
    const reservation = await service.reserve(actors.buyer, reserveInput);
    await assert.rejects(() => service.reserve(actors.alternateBuyer, { ...reserveInput, requestId: 'demo_r2', quoteId: competitorQuote.quoteId }), { code: 'CARD_RESERVED' });
    const paymentId = intentId('payment', reservation.id);
    provider.failNextCreateAfterCommit(paymentId);
    await assert.rejects(() => service.pay(actors.buyer, { reservationId: reservation.id }), { code: 'SYNTHETIC_RESPONSE_LOST' });
    assert.equal(store.read().intents[paymentId].status, 'UNKNOWN');
    assert.equal((await service.balance(actors.seller)).pendingCents, 0);
    now += 3600000; // Expired browser lease cannot release accepted/unknown payment.
    store.close();
    store = openLocalStore(options);
    fixture = createLocalFixture({ store, clock: () => now, assets: false });
    ({ service, provider } = fixture);
    provider.resolve(paymentId, { status: 'succeeded', processingFeeCents: 300 });
    const order = await service.reconcilePayment(actors.buyer, { reservationId: reservation.id });
    assert.equal(order.status, 'PAID');
    assert.equal(order.totalCents, 14700); assert.equal(order.sellerNetCents, 12000);
    assert.equal(store.read().syntheticProvider.calls[paymentId], 1);
    const journalBeforeReplay = store.read().journals.length;
    await service.reconcilePayment(actors.buyer, { reservationId: reservation.id });
    assert.equal(store.read().journals.length, journalBeforeReplay);
    assert.equal((await service.balance(actors.seller)).pendingCents, 12000);
    const fulfill = action => service.fulfill(actors.staff, { requestId: `demo_${action}`, orderId: order.orderId, action, evidence: syntheticFulfillmentEvidence(order, action) });
    await service.openCase(actors.buyer, { requestId: 'demo_early_case', caseId: 'demo_early_appeal', orderId: order.orderId, kind: 'APPEAL', evidenceRef: 'demo_early_evidence' });
    await assert.rejects(() => fulfill('PACK'), { code: 'FINANCE_HOLD' });
    await service.resolveCase(actors.staff, { requestId: 'demo_early_close', caseId: 'demo_early_appeal', orderId: order.orderId, outcome: 'APPEAL_REJECTED', evidence: { orderId: order.orderId, cardId: order.cardId, ref: 'demo_early_review' } });
    await assert.rejects(() => fulfill('RELEASE'), { code: 'PROTECTION_HOLD' });
    for (const action of ['PACK', 'DISPATCH', 'DELIVER', 'RELEASE']) await fulfill(action);
    const transferId = intentId('transfer', order.orderId);
    assert.equal((await service.balance(actors.seller)).availableCents, 0);
    provider.resolve(transferId, { status: 'succeeded' });
    await reconcileFinanceIntent({ store, provider, intentId: transferId });
    assert.equal((await service.balance(actors.seller)).availableCents, 12000);
    await service.openCase(actors.buyer, { requestId: 'demo_case_open', caseId: 'demo_appeal', orderId: order.orderId, kind: 'APPEAL', evidenceRef: 'demo_appeal_evidence' });
    assert.equal((await service.balance(actors.seller)).reservedCents, 12000);
    await assert.rejects(() => service.withdraw(actors.seller, { requestId: 'demo_w1', amountCents: 12000, externalAccountId: 'demo_bank' }), { code: 'SELLER_FUNDS_RESTRICTED' });
    await service.resolveCase(actors.staff, { requestId: 'demo_case_close', caseId: 'demo_appeal', orderId: order.orderId, outcome: 'APPEAL_REJECTED', evidence: { orderId: order.orderId, cardId: order.cardId, ref: 'demo_appeal_review' } });
    const withdrawal = await service.withdraw(actors.seller, { requestId: 'demo_w1', amountCents: 12000, externalAccountId: 'demo_bank' });
    assert.equal(withdrawal.status, 'PENDING');
    assert.equal((await service.balance(actors.seller)).withdrawingCents, 12000);
    await assert.rejects(() => service.withdraw(actors.seller, { requestId: 'demo_w2', amountCents: 1, externalAccountId: 'demo_bank' }), error => ['SELLER_BALANCE_INSUFFICIENT', 'PROVIDER_BALANCE_INSUFFICIENT'].includes(error.code));
    provider.resolve(withdrawal.id, { status: 'paid' });
    await service.reconcileWithdrawal(actors.seller, { intentId: withdrawal.id });
    const balance = (await service.balance(actors.seller));
    assert.deepEqual(balance, { pendingCents: 0, availableCents: 0, reservedCents: 0, withdrawingCents: 0, paidOutCents: 12000, recoveryDueCents: 0, currency: 'USD' });
    assert.equal(assertJournal(store.read().journals), true);
    assert.equal(store.read().orders[order.orderId].approvedCard.reportHash, listing.approvedCard.reportHash);
    assert.ok(store.read().events.every(event => event.environment === 'SYNTHETIC_LOCAL'));
    assert.equal(store.read().syntheticProvider.calls[withdrawal.id], 1);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('reviewed case refund dispatches once, reconciles lost response and closes only that exact obligation', async () => {
  const store = openLocalStore({ filename: ':memory:', environment: 'SYNTHETIC_LOCAL' });
  try {
    const { service, provider } = createLocalFixture({ store, assets: false });
    await service.recordConsent(actors.seller, { requestId: 'demo_consent', cardId: 'demo_card', choice: 'HOLD_AND_LIST', evidenceRef: 'demo_hold_consent' });
    const listing = await service.publishListing(actors.seller, { requestId: 'demo_listing', cardId: 'demo_card', askingPriceCents: 12500 });
    const quote = await service.quote(actors.buyer, listing.id);
    const reservation = await service.reserve(actors.buyer, { requestId: 'demo_reserve', listingId: listing.id, listingVersion: listing.version, listingHash: listing.bindingHash, quoteId: quote.quoteId });
    await service.pay(actors.buyer, { reservationId: reservation.id });
    provider.resolve(intentId('payment', reservation.id), { status: 'succeeded' });
    const order = await service.reconcilePayment(actors.buyer, { reservationId: reservation.id });
    const caseInput = { orderId: order.orderId, caseId: 'demo_case' };
    await service.openCase(actors.buyer, { ...caseInput, requestId: 'demo_open', kind: 'DISPUTE', evidenceRef: 'demo_case_evidence' });
    const review = { ...caseInput, amountCents: 14700, allocations: { sellerCents: 12000, feeCents: 500, taxCents: 1000, shippingCents: 1200 }, reviewRef: 'demo_refund_review' };
    const refundId = intentId('refund', caseInput);
    provider.failNextCreateAfterCommit(refundId);
    await assert.rejects(() => service.refundCase(actors.staff, review), { code: 'SYNTHETIC_RESPONSE_LOST' });
    await assert.rejects(() => service.refundCase(actors.staff, { ...review, amountCents: 1 }), { code: 'REFUND_OBLIGATION_REQUIRED' });
    provider.resolve(refundId, { status: 'succeeded' });
    await service.reconcileRefund(actors.staff, caseInput);
    const resolved = await service.resolveCase(actors.staff, { ...caseInput, requestId: 'demo_close', outcome: 'REFUND_REQUIRED', evidence: { orderId: order.orderId, cardId: order.cardId, ref: 'demo_resolution', refundIntentId: refundId } });
    assert.equal(resolved.status, 'CLOSED');
    assert.equal(store.read().syntheticProvider.calls[refundId], 1);
    assert.equal((await service.balance(actors.seller)).pendingCents, 0);
    assert.equal(assertJournal(store.read().journals), true);
  } finally { store.close(); }
});

test('default-off composition and actor boundaries cannot access another buyer or initiate effects', async () => {
  const off = createMarketplacePilot();
  assert.equal(off.status().enabled, false);
  await assert.rejects(() => off.localSnapshot(), { code: 'MARKETPLACE_DISABLED' });
  await assert.rejects(() => off.pay(actors.buyer, { reservationId: 'demo_r' }), { code: 'MARKETPLACE_DISABLED' });
  const store = openLocalStore({ filename: ':memory:', environment: 'SYNTHETIC_LOCAL' });
  try {
    const { service } = createLocalFixture({ store, assets: false });
    await assert.rejects(() => service.publishListing(actors.buyer, {}), { code: 'FORBIDDEN' });
    store.transaction(tx => { tx.state.reservations.demo_r = { buyerId: actors.alternateBuyer.id }; });
    await assert.rejects(() => service.pay(actors.buyer, { reservationId: 'demo_r' }), { code: 'RESERVATION_NOT_FOUND' });
    assert.equal(Object.keys(store.read().intents).length, 0);
  } finally { store.close(); }
});

test('signed provider notification completes a paid order without buyer return and replays without another sale',async()=>{
  const store=openLocalStore({filename:':memory:',environment:'SYNTHETIC_LOCAL'}), secret='whsec_owned_synthetic_service_fixture';
  try {
    const fixture=createLocalFixture({store,assets:false}),service=createMarketplacePilot({...fixture,store,enabled:true,environment:'SYNTHETIC_LOCAL',platformAccountId:'demo_platform',webhook:{secret}});
    await service.recordConsent(actors.seller,{requestId:'demo_consent',cardId:'demo_card',choice:'HOLD_AND_LIST',evidenceRef:'demo_hold_consent'});
    const listing=await service.publishListing(actors.seller,{requestId:'demo_listing',cardId:'demo_card',askingPriceCents:12500});
    const quote=await service.quote(actors.buyer,listing.id),reservation=await service.reserve(actors.buyer,{requestId:'demo_reservation',listingId:listing.id,listingVersion:listing.version,listingHash:listing.bindingHash,quoteId:quote.quoteId});
    await service.pay(actors.buyer,{reservationId:reservation.id});
    const id=intentId('payment',reservation.id),intent=store.read(state=>state.intents[id]);
    fixture.provider.resolve(id,{status:'succeeded'});
    const rawBody=Buffer.from(JSON.stringify({id:'evt_service_payment',object:'event',type:'payment_intent.succeeded',livemode:false,data:{object:{id:intent.objectId,object:'payment_intent',metadata:{atlas_marketplace_intent:id}}}}));
    const time=Math.floor(Date.now()/1000),signature=`t=${time},v1=${createHmac('sha256',secret).update(`${time}.`).update(rawBody).digest('hex')}`;
    await assert.rejects(()=>service.receiveProviderWebhook({rawBody,signature:'bad'}),{code:'INVALID_WEBHOOK_SIGNATURE'});
    assert.equal(Object.keys(store.read().orders).length,0);
    await service.receiveProviderWebhook({rawBody,signature});
    const state=store.read(),count=state.journals.length;
    assert.equal(state.orders[reservation.orderId].status,'PAID');assert.ok(state.fulfillment[reservation.orderId]);
    await service.receiveProviderWebhook({rawBody,signature});
    assert.equal(store.read().journals.length,count);assert.equal(Object.keys(store.read().orders).length,1);assert.equal(store.read().syntheticProvider.calls[id],1);
  } finally {store.close();}
});
