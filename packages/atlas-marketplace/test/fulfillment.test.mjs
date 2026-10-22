import test from 'node:test';
import assert from 'node:assert/strict';
import { openLocalStore } from '../src/store.mjs';
import { recordHoldChoice, recordFulfillment, openProtectionCase, resolveProtectionCase, recordRefundObligation } from '../src/fulfillment.mjs';

const policy = { environment: 'SYNTHETIC_LOCAL', id: 'demo_policy', version: 'fixture-v1', approvalRef: 'demo_approval', packingProtocolRef: 'demo_packing', coverageTermsRef: 'demo_coverage', returnsTermsRef: 'demo_returns', appealsTermsRef: 'demo_appeals', transferTermsRef: 'demo_transfer', returnWindowMs: 1000, missingScanAfterMs: 100 };
const paidOrder = () => ({ orderId: 'demo_order', cardId: 'demo_card', sellerId: 'demo_seller', buyerId: 'demo_buyer', paymentIntentId: 'demo_payment', bindingHash: 'hash', policyVersion: policy.version, policy: { id: policy.id, version: policy.version, fulfillmentPolicy: policy } });
const paidIntent = () => ({ kind: 'PAYMENT', status: 'SUCCEEDED', confirmed: true, orderId: 'demo_order', bindingHash: 'hash' });
const actor = { id: 'demo_staff', role: 'STAFF' };
function evidence(action) {
  const value = { environment: 'SYNTHETIC_LOCAL', orderId: 'demo_order', cardId: 'demo_card', ref: `demo_${action}` };
  for (const field of ['intakeFrontRef', 'intakeBackRef', 'holderConditionRef', 'packingPhotoRef', 'fittedInsertRef', 'firstSealRef', 'secondSealRef', 'cleanLabelAreaRef', 'resaleInstructionsRef', 'replacementKitRef', 'carrierRef', 'trackingRef', 'coverageRef', 'dispatchReceiptRef', 'deliveryProofRef', 'releaseReviewRef', 'receivedParcelRef', 'inspectionFrontRef', 'inspectionBackRef', 'holderInspectionRef']) value[field] = `demo_${field}`;
  return value;
}
test('consent, packing, scan investigation, inspected return and release obey actual recorded milestones', () => {
  let now = 1000;
  const store = openLocalStore({ filename: ':memory:', environment: 'SYNTHETIC_LOCAL', clock: () => now });
  const transact = fn => store.transaction(fn);
  try {
    transact(tx => recordHoldChoice(tx, { requestId: 'demo_ship', cardId: 'demo_card', choice: 'SHIP_TO_ME', actor: { id: 'demo_seller', role: 'SELLER' }, evidenceRef: 'demo_ship_choice' }));
    assert.equal(store.read().consent.demo_card.choice, 'SHIP_TO_ME');
    const run = (action, overrides = {}) => transact(tx => recordFulfillment(tx, { requestId: `demo_${action}`, orderId: 'demo_order', action, actor, evidence: evidence(action), policy, ...overrides }));
    assert.throws(() => run('PACK'), { code: 'PAID_ORDER_REQUIRED' });
    transact(tx => { tx.state.orders.demo_order = paidOrder(); tx.state.intents.demo_payment = paidIntent(); });
    assert.throws(() => run('PACK'), { code: 'FINANCE_HOLD' });
    transact(tx => { (tx.state.financeOrders ??= {}).demo_order = { confirmed: true, blocked: false }; });
    assert.throws(() => run('DISPATCH'), { code: 'FULFILLMENT_TRANSITION' });
    assert.throws(() => run('PACK', { evidence: { ...evidence('PACK'), secondSealRef: null } }), { code: 'SYNTHETIC_ID_REQUIRED' });
    assert.throws(() => run('PACK', { policy: { ...policy, returnWindowMs: 0 } }), { code: 'FULFILLMENT_POLICY_MISMATCH' });
    run('PACK'); run('DISPATCH');
    const missing = tx => openProtectionCase(tx, { requestId: 'demo_case_request', caseId: 'demo_case', orderId: 'demo_order', kind: 'MISSING_SCAN', actor, evidenceRef: 'demo_scan_check' });
    assert.throws(() => transact(missing), { code: 'INVESTIGATION_NOT_DUE' });
    now += 100; transact(missing); run('DELIVER'); now += 1000;
    assert.throws(() => run('RELEASE'), { code: 'PROTECTION_HOLD' });
    transact(tx => resolveProtectionCase(tx, { requestId: 'demo_resolve', orderId: 'demo_order', caseId: 'demo_case', actor, outcome: 'NO_REFUND_DUE', evidence: evidence('resolved') }));
    const released = run('RELEASE');
    assert.equal(released.status, 'RELEASED');
    assert.deepEqual(run('RELEASE'), released);
    assert.throws(() => run('RELEASE', { evidence: evidence('changed') }), { code: 'IDEMPOTENCY_CONFLICT' });
    // Dispute/appeal remains available after payout/release; delivery isn't final immunity.
    transact(tx => openProtectionCase(tx, { requestId: 'demo_late_dispute', caseId: 'demo_dispute', orderId: 'demo_order', kind: 'DISPUTE', actor, evidenceRef: 'demo_dispute_notice' }));
    assert.equal(store.read().fulfillment.demo_order.cases[1].status, 'OPEN');
  } finally { store.close(); }
});

test('returns require exact inspection and a confirmed refund, never a staff assertion of money movement', () => {
  const store = openLocalStore({ filename: ':memory:', environment: 'SYNTHETIC_LOCAL', clock: () => 2000 });
  try {
    store.transaction(tx => { tx.state.orders.demo_order = paidOrder(); tx.state.intents.demo_payment = paidIntent(); tx.state.fulfillment.demo_order = { cardId: 'demo_card', deliveredAt: 1000, releaseNotBefore: 3000, cases: [], policy }; });
    store.transaction(tx => openProtectionCase(tx, { requestId: 'demo_return', caseId: 'demo_case', orderId: 'demo_order', kind: 'RETURN', actor: { id: 'demo_buyer', role: 'BUYER' }, evidenceRef: 'demo_return_photos' }));
    const resolve = evidence => store.transaction(tx => resolveProtectionCase(tx, { requestId: 'demo_resolve', orderId: 'demo_order', caseId: 'demo_case', actor, outcome: 'REFUND_REQUIRED', evidence }));
    assert.throws(() => resolve(evidence('return')), { code: 'REFUND_RECONCILIATION_REQUIRED' });
    const allocations = { sellerCents: 100, feeCents: 0, taxCents: 0, shippingCents: 0 };
    const obligation = store.transaction(tx => recordRefundObligation(tx, { orderId: 'demo_order', caseId: 'demo_case', actor, amountCents: 100, allocations, reviewRef: 'demo_refund_review' }));
    store.transaction(tx => { tx.state.intents.demo_refund = { kind: 'REFUND', status: 'SUCCEEDED', confirmed: true, orderId: 'demo_order', bindingHash: 'hash', amountCents: 1, allocations, policyEvidence: { caseId: 'demo_unrelated_case', obligationHash: obligation.hash, evidenceRef: obligation.reviewRef, policyVersion: policy.version } }; });
    assert.throws(() => resolve({ ...evidence('return'), refundIntentId: 'demo_refund' }), { code: 'REFUND_RECONCILIATION_REQUIRED' });
    store.transaction(tx => { tx.state.intents.demo_refund.amountCents = 100; tx.state.intents.demo_refund.policyEvidence.caseId = 'demo_case'; });
    assert.throws(() => resolve({ ...evidence('return'), inspectionBackRef: null, refundIntentId: 'demo_refund' }), { code: 'SYNTHETIC_ID_REQUIRED' });
    assert.equal(resolve({ ...evidence('return'), refundIntentId: 'demo_refund' }).status, 'CLOSED');
  } finally { store.close(); }
});
