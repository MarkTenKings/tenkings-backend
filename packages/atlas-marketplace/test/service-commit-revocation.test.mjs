import test from 'node:test';
import assert from 'node:assert/strict';
import { financeFixture } from './finance-fixtures.mjs';
import { FIXTURE_NOW } from './listing-fixtures.mjs';
import { createMarketplacePilot } from '../src/service.mjs';
import { createAuthorityContext } from '../src/authority-context.mjs';
import { createPilotCommercialTerms } from '../src/pilot-commercial-terms.mjs';
import { ensureFulfillmentState } from '../src/fulfillment.mjs';
import { preparePayment } from '../src/finance.mjs';
import { executeFinanceIntent, reconcileFinanceIntent } from '../src/payment.mjs';
import { hash } from '../src/contract.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const staff = { id: '11111111-1111-4111-8111-111111111111', role: 'STAFF' };
const buyer = { id: '22222222-2222-4222-8222-222222222222', role: 'BUYER' };

async function fixture(t) {
  let now = FIXTURE_NOW;
  const f = financeFixture({ clock: () => now }); t.after(() => f.store.close());
  const environment = 'PROVIDER_SANDBOX', control = { ready: true, waitingKind: null, creates: 0 };
  const context = createAuthorityContext({ environment, evidenceOrigin: 'https://fixture.invalid', evidencePathPrefixes: ['/approved/'], qualificationRefs: Object.fromEntries(['fingerprintRef','titlePolicyRef','marketplacePolicyRef','evidenceContractRef'].map(key => [key, 'MOCK_CONTRACT_NO_REAL_AUTHORITY'])) });
  const financePolicy = { ...f.policy, environment: 'stripe-sandbox' };
  const fulfillmentPolicy = { id: 'policy_one', version: f.policy.version, environment, approvalRef: 'MOCK_FULFILLMENT', packingProtocolRef: 'mock_packing', coverageTermsRef: 'mock_coverage', returnsTermsRef: 'mock_returns', appealsTermsRef: 'mock_appeals', transferTermsRef: 'mock_transfer', missingScanAfterMs: 1000, returnWindowMs: 86400000 };
  fulfillmentPolicy.commercialTerms = createPilotCommercialTerms({ id: 'commercial_one', version: 'fixture_v1', environment, approvalRef: 'MOCK_OWNER_POLICY_ONLY', effectiveAt: new Date(now-1000).toISOString(), expiresAt: new Date(now+864000000).toISOString(), feeScheduleId: 'fee_one', feeScheduleVersion: 'fixture_v1', feeScheduleApprovalRef: 'MOCK_FEE_POLICY_ONLY', termsRefs: { feeTermsRef: 'mock_fee', returnsTermsRef: fulfillmentPolicy.returnsTermsRef, transferTermsRef: fulfillmentPolicy.transferTermsRef, payoutTermsRef: 'mock_payout' } }, context);
  const listingPolicy = { id: fulfillmentPolicy.id, version: fulfillmentPolicy.version, environment, fulfillmentPolicy };
  const order = { ...f.order, sellerId: '33333333-3333-4333-8333-333333333333', buyerId: buyer.id };
  // Local simulator supplies injected sandbox-shaped evidence only. There is
  // no actual Stripe, physical event, identity, tax or production qualification.
  const provider = { ...f.provider,
    create: async intent => { control.creates++; return f.provider.create({ ...intent, policy: { ...intent.policy, environment: 'synthetic' } }); },
    retrieve: async (...args) => { const evidence = await f.provider.retrieve(...args); return evidence ? { ...evidence, provider: 'stripe' } : null; }
  };
  f.store.transaction(tx => preparePayment(tx, { intentId: 'payment_one', order, platformAccountId: 'acct_platform', connectedAccountId: 'acct_seller', policy: financePolicy }));
  await executeFinanceIntent({ store: f.store, provider, intentId: 'payment_one', enabled: true });
  provider.resolve('payment_one', { status: 'succeeded' });
  await reconcileFinanceIntent({ store: f.store, provider, intentId: 'payment_one' });
  f.store.transaction(tx => {
    tx.state.orders[order.orderId] = { ...order, policy: listingPolicy, paymentIntentId: 'payment_one', connectedAccountId: 'acct_seller' };
    return ensureFulfillmentState({ ...tx, context }, order.orderId);
  });
  const options = { enabled: true, environment, context, store: f.store, provider, platformAccountId: 'acct_platform', listingPolicy, financePolicy, fulfillmentPolicy,
    assertRuntimeReady: () => control.ready,
    validateEvidence: async ({ kind }) => { if (control.waitingKind === kind) { control.waitingKind = null; control.entered.resolve(); await control.resume.promise; } return true; }
  };
  options.runtimeApproval = { approved: true, binding: { environment, platformAccountId: options.platformAccountId, listingPolicyHash: hash(listingPolicy), financePolicyHash: hash(financePolicy), fulfillmentPolicyHash: hash(fulfillmentPolicy), qualificationRefs: context.qualificationRefs } };
  const service = createMarketplacePilot(options);
  const evidence = action => ({ environment, orderId: order.orderId, cardId: order.cardId, ref: `mock_${action}`, intakeFrontRef: 'mock_front', intakeBackRef: 'mock_back', holderConditionRef: 'mock_holder', packingPhotoRef: 'mock_pack', fittedInsertRef: 'mock_fit', firstSealRef: 'mock_seal_one', secondSealRef: 'mock_seal_two', cleanLabelAreaRef: 'mock_label', resaleInstructionsRef: 'mock_instructions', replacementKitRef: 'mock_kit', carrierRef: 'mock_carrier', trackingRef: 'mock_tracking', coverageRef: 'mock_coverage', dispatchReceiptRef: 'mock_dispatch', deliveryProofRef: 'mock_delivery', deliveredAt: now, releaseReviewRef: 'mock_release' });
  const fulfillInput = action => ({ requestId: `request_${action}`, orderId: order.orderId, action, evidence: evidence(action) });
  const fulfill = action => service.fulfill(staff, fulfillInput(action));
  async function delivered() { for (const action of ['PACK','DISPATCH','DELIVER']) await fulfill(action); }
  async function approvedReturn() {
    await delivered();
    await service.openCase(buyer, { requestId: 'request_return', caseId: 'case_return', orderId: order.orderId, kind: 'RETURN', returnReason: 'SEVERE_DAMAGE', evidenceRef: 'mock_buyer_proof' });
    await service.reviewReturn(staff, { requestId: 'request_review', orderId: order.orderId, caseId: 'case_return', decision: 'APPROVE', reviewRef: 'mock_staff_review' });
  }
  const resolution = { requestId: 'request_resolve', orderId: order.orderId, caseId: 'case_return', outcome: 'NO_REFUND_DUE', evidence: { orderId: order.orderId, cardId: order.cardId, ref: 'mock_resolution', receivedParcelRef: 'mock_received', inspectionFrontRef: 'mock_return_front', inspectionBackRef: 'mock_return_back', holderInspectionRef: 'mock_return_holder' } };
  async function revokeDuring(kind, work) {
    control.waitingKind = kind; control.entered = deferred(); control.resume = deferred();
    const before = f.store.read(), creates = control.creates;
    const refused = assert.rejects(work(), { code: 'RUNTIME_QUALIFICATION_REQUIRED' });
    await control.entered.promise; assert.equal(service.status().enabled, true);
    control.ready = false; control.resume.resolve(); await refused;
    assert.deepEqual(f.store.read(), before); assert.equal(control.creates, creates);
  }
  return { ...f, provider, service, control, order, fulfill, fulfillInput, delivered, approvedReturn, resolution, revokeDuring, advance: milliseconds => { now += milliseconds; } };
}

for (const action of ['PACK','DISPATCH','RELEASE']) test(`runtime revocation during fulfillment evidence validation cannot commit ${action}`, async t => {
  const f = await fixture(t);
  if (action === 'DISPATCH') await f.fulfill('PACK');
  if (action === 'RELEASE') { await f.delivered(); f.advance(86400000); }
  const input = f.fulfillInput(action), creates = f.control.creates;
  await f.revokeDuring('FULFILLMENT', () => f.service.fulfill(staff, input));
  f.control.ready = true;
  const result = await f.service.fulfill(staff, input);
  assert.equal(result.status, { PACK: 'PACKED', DISPATCH: 'DISPATCHED', RELEASE: 'RELEASED' }[action]);
  assert.equal(f.control.creates, creates + (action === 'RELEASE' ? 1 : 0));
  const events = f.store.read(state => state.events.filter(row => row.type === `FULFILLMENT_${action}`).length);
  await f.service.fulfill(staff, input);
  assert.equal(f.store.read(state => state.events.filter(row => row.type === `FULFILLMENT_${action}`).length), events); assert.equal(f.control.creates, creates + (action === 'RELEASE' ? 1 : 0));
});

test('runtime revocation during case-resolution validation preserves the approved return and its financial hold', async t => {
  const f = await fixture(t); await f.approvedReturn();
  assert.equal(f.store.read(state => state.financeHolds.case_return.active), true);
  await f.revokeDuring('CASE_RESOLUTION', () => f.service.resolveCase(staff, f.resolution));
  f.control.ready = true;
  const result = await f.service.resolveCase(staff, f.resolution);
  assert.equal(result.status, 'CLOSED'); assert.equal(f.store.read(state => state.financeHolds.case_return.active), false);
  const events = f.store.read().events.length; await f.service.resolveCase(staff, f.resolution); assert.equal(f.store.read().events.length, events);
});

test('runtime revocation during refund review creates no obligation, intent or provider effect; requalified original settles once', async t => {
  const f = await fixture(t); await f.approvedReturn();
  const input = { orderId: f.order.orderId, caseId: 'case_return', amountCents: 500, allocations: { sellerCents: 500, feeCents: 0, taxCents: 0, shippingCents: 0 }, reviewRef: 'mock_refund_review' };
  await f.revokeDuring('REFUND_REVIEW', () => f.service.refundCase(staff, input));
  f.control.ready = true;
  const creates = f.control.creates, refund = await f.service.refundCase(staff, input);
  assert.equal(refund.status, 'PENDING'); assert.equal(refund.dispatchCount, 1);
  await f.service.refundCase(staff, input); assert.equal(f.control.creates, creates + 1);
  f.provider.resolve(refund.id, { status: 'succeeded' }); await f.service.reconcileRefund(staff, input);
  const resolved = await f.service.resolveCase(staff, { ...f.resolution, outcome: 'REFUND_REQUIRED', evidence: { ...f.resolution.evidence, refundIntentId: refund.id } });
  assert.equal(resolved.status, 'CLOSED'); assert.equal(f.store.read(state => state.financeHolds.case_return.active), false);
  assert.equal(f.control.creates, creates + 1); assert.equal(f.store.read(state => state.intents[refund.id].dispatchCount), 1);
});
