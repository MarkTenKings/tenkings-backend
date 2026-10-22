import { cents, clone, hash, requireValue, sumCents } from './contract.mjs';
import { demoId, requiredText } from './eligibility.mjs';

function actorRole(actor, roles) {
  demoId(actor?.id, 'local actor');
  requireValue(roles.includes(actor?.role), 'FORBIDDEN');
}
function receipt(tx, kind, requestId, input, action) {
  demoId(requestId, 'request');
  const key = `${kind}:${requestId}`, digest = hash(input), prior = tx.state.receipts[key];
  if (prior) { requireValue(prior.hash === digest, 'IDEMPOTENCY_CONFLICT'); return clone(prior.result); }
  const result = action();
  tx.state.receipts[key] = { hash: digest, result: clone(result) };
  return clone(result);
}
export function recordHoldChoice(tx, { requestId, cardId, choice, actor, evidenceRef }) {
  actorRole(actor, ['SELLER']); demoId(cardId); demoId(evidenceRef);
  requireValue(['HOLD_AND_LIST', 'SHIP_TO_ME'].includes(choice), 'INVALID_CONSENT');
  return receipt(tx, 'consent', requestId, { cardId, choice, actor, evidenceRef }, () => {
    requireValue(!Object.values(tx.state.listings).some(row => row.cardId === cardId && ['ACTIVE', 'RESERVED', 'SOLD'].includes(row.status)), 'CARD_COMMERCE_ACTIVE');
    const result = { cardId, sellerId: actor.id, choice, evidenceRef, at: tx.now };
    tx.state.consent[cardId] = result;
    tx.emit('HOLD_CHOICE_RECORDED', result);
    return result;
  });
}

export function assertFulfillmentPolicy(policy) {
  requireValue(policy?.environment === 'SYNTHETIC_LOCAL', 'FULFILLMENT_POLICY_REQUIRED');
  for (const key of ['id', 'version', 'approvalRef', 'packingProtocolRef', 'coverageTermsRef', 'returnsTermsRef', 'appealsTermsRef', 'transferTermsRef']) requiredText(policy[key], key);
  for (const key of ['missingScanAfterMs', 'returnWindowMs']) requireValue(Number.isSafeInteger(policy[key]) && policy[key] >= 0, 'FULFILLMENT_POLICY_REQUIRED');
  return policy;
}
export function ensureFulfillmentState(tx, orderId, suppliedPolicy) {
  const order = tx.state.orders[orderId], payment = tx.state.intents[order?.paymentIntentId];
  requireValue(payment?.kind === 'PAYMENT' && payment.status === 'SUCCEEDED' && payment.confirmed === true && payment.orderId === orderId && payment.bindingHash === order.bindingHash, 'PAID_ORDER_REQUIRED');
  const policy = assertFulfillmentPolicy(order.policy?.fulfillmentPolicy);
  requireValue(policy.id === order.policy.id && policy.version === order.policyVersion && policy.version === order.policy.version, 'FULFILLMENT_POLICY_MISMATCH');
  requireValue(!suppliedPolicy || hash(suppliedPolicy) === hash(policy), 'FULFILLMENT_POLICY_MISMATCH');
  const state = tx.state.fulfillment[orderId] ??= { orderId, cardId: order.cardId, status: 'AWAITING_PACKING', cases: [], policy: clone(policy), history: [] };
  requireValue(hash(state.policy) === hash(policy), 'POLICY_CHANGED');
  return state;
}
export function recordFulfillment(tx, { requestId, orderId, action, actor, evidence, policy }) {
  actorRole(actor, ['STAFF']); demoId(orderId);
  assertFulfillmentPolicy(policy);
  requireValue(evidence?.environment === 'SYNTHETIC_LOCAL', 'PHYSICAL_EVIDENCE_REQUIRED');
  return receipt(tx, 'fulfillment', requestId, { orderId, action, actor, evidence, policy }, () => {
    const order = tx.state.orders[orderId];
    const state = ensureFulfillmentState(tx, orderId, policy);
    requireValue(evidence.orderId === orderId && evidence.cardId === order.cardId, 'FULFILLMENT_BINDING_MISMATCH');
    demoId(evidence.ref, 'physical evidence');
    const open = state.cases.some(item => item.status !== 'CLOSED');
    if (action === 'PACK') {
      requireValue(state.status === 'AWAITING_PACKING' && !open, 'FULFILLMENT_TRANSITION');
      for (const field of ['intakeFrontRef', 'intakeBackRef', 'holderConditionRef', 'packingPhotoRef', 'fittedInsertRef', 'firstSealRef', 'secondSealRef', 'cleanLabelAreaRef', 'resaleInstructionsRef', 'replacementKitRef']) demoId(evidence[field], field);
      state.status = 'PACKED';
    } else if (action === 'DISPATCH') {
      requireValue(state.status === 'PACKED' && !open, 'FULFILLMENT_TRANSITION');
      for (const field of ['carrierRef', 'trackingRef', 'coverageRef', 'dispatchReceiptRef']) demoId(evidence[field], field);
      state.status = 'DISPATCHED'; state.dispatchedAt = tx.now;
    } else if (action === 'DELIVER') {
      requireValue(state.status === 'DISPATCHED', 'FULFILLMENT_TRANSITION');
      demoId(evidence.deliveryProofRef);
      state.status = 'DELIVERED'; state.deliveredAt = tx.now;
      state.releaseNotBefore = tx.now + policy.returnWindowMs;
      requireValue(Number.isSafeInteger(state.releaseNotBefore), 'TIME_OVERFLOW');
    } else if (action === 'RELEASE') {
      requireValue(state.status === 'DELIVERED' && !open && tx.now >= state.releaseNotBefore, 'PROTECTION_HOLD');
      demoId(evidence.releaseReviewRef);
      state.status = 'RELEASED'; state.releasedAt = tx.now;
      state.releaseEvidence = { approved: true, orderId, cardId: order.cardId, bindingHash: order.bindingHash, evidenceRef: evidence.ref, policyVersion: order.policyVersion, releasedAt: tx.now };
    } else requireValue(false, 'UNKNOWN_FULFILLMENT_ACTION');
    state.history.push({ action, actorId: actor.id, at: tx.now, evidence: clone(evidence) });
    tx.state.fulfillment[orderId] = state;
    tx.emit(`FULFILLMENT_${action}`, { orderId, cardId: order.cardId, evidenceRef: evidence.ref, actorId: actor.id });
    return state;
  });
}

export function openProtectionCase(tx, { requestId, caseId, orderId, kind, actor, evidenceRef }) {
  actorRole(actor, ['BUYER', 'SELLER', 'STAFF']); demoId(caseId); demoId(evidenceRef);
  return receipt(tx, 'case-open', requestId, { caseId, orderId, kind, actor, evidenceRef }, () => {
    const order = tx.state.orders[orderId];
    requireValue(order, 'ORDER_UNAVAILABLE');
    requireValue(actor.role === 'STAFF' || actor.id === order.buyerId || actor.id === order.sellerId, 'FORBIDDEN');
    const state = ensureFulfillmentState(tx, orderId);
    requireValue(['RETURN', 'MISSING_SCAN', 'APPEAL', 'DISPUTE'].includes(kind), 'INVALID_CASE');
    if (kind === 'MISSING_SCAN') requireValue(state.status === 'DISPATCHED' && tx.now >= state.dispatchedAt + state.policy.missingScanAfterMs, 'INVESTIGATION_NOT_DUE');
    if (kind === 'RETURN') requireValue(state.deliveredAt !== undefined && tx.now <= state.releaseNotBefore, 'RETURN_WINDOW_CLOSED');
    requireValue(!state.cases.some(item => item.id === caseId), 'CASE_ID_CONFLICT');
    const item = { id: caseId, kind, status: 'OPEN', openedAt: tx.now, actorId: actor.id, evidenceRef, history: [] };
    state.cases.push(item);
    tx.emit('PROTECTION_CASE_OPENED', { orderId, caseId, kind, evidenceRef });
    return item;
  });
}

export function recordRefundObligation(tx, { orderId, caseId, actor, amountCents, allocations, reviewRef }) {
  actorRole(actor, ['STAFF']); demoId(reviewRef);
  const state = ensureFulfillmentState(tx, orderId), item = state.cases.find(row => row.id === caseId);
  requireValue(item?.status === 'OPEN', 'CASE_UNAVAILABLE');
  cents(amountCents); requireValue(amountCents > 0, 'REFUND_OBLIGATION_REQUIRED');
  const keys = ['sellerCents', 'feeCents', 'taxCents', 'shippingCents'];
  requireValue(allocations && Object.keys(allocations).sort().join() === keys.sort().join(), 'REFUND_OBLIGATION_REQUIRED');
  requireValue(sumCents(...keys.map(key => cents(allocations[key]))) === amountCents, 'REFUND_OBLIGATION_REQUIRED');
  const obligation = { orderId, caseId, amountCents, allocations: clone(allocations), reviewRef, policyVersion: state.policy.version, policyHash: hash(state.policy) };
  obligation.hash = hash(obligation);
  requireValue(!item.refundObligation || hash(item.refundObligation) === hash(obligation), 'REFUND_OBLIGATION_CONFLICT');
  if (!item.refundObligation) {
    item.refundObligation = obligation;
    tx.emit('PROTECTION_REFUND_REVIEWED', { orderId, caseId, obligationHash: obligation.hash, reviewRef, actorId: actor.id });
  }
  return clone(item.refundObligation);
}

export function resolveProtectionCase(tx, { requestId, orderId, caseId, actor, outcome, evidence }) {
  actorRole(actor, ['STAFF']);
  return receipt(tx, 'case-resolve', requestId, { orderId, caseId, actor, outcome, evidence }, () => {
    const state = tx.state.fulfillment[orderId], item = state?.cases.find(row => row.id === caseId);
    requireValue(item?.status === 'OPEN', 'CASE_UNAVAILABLE');
    requireValue(evidence?.orderId === orderId && evidence.cardId === state.cardId, 'FULFILLMENT_BINDING_MISMATCH');
    demoId(evidence.ref);
    requireValue(['NO_REFUND_DUE', 'REFUND_REQUIRED', 'APPEAL_UPHELD', 'APPEAL_REJECTED'].includes(outcome), 'INVALID_RESOLUTION');
    if (item.kind === 'RETURN') {
      for (const field of ['receivedParcelRef', 'inspectionFrontRef', 'inspectionBackRef', 'holderInspectionRef']) demoId(evidence[field], field);
    }
    // A refund decision is never proof that money returned. Keep the hold until
    // the exact finance intent is reconciled and an explicit review closes it.
    if (outcome === 'REFUND_REQUIRED') {
      const intent = tx.state.intents[evidence.refundIntentId], obligation = item.refundObligation;
      requireValue(obligation && intent?.kind === 'REFUND' && intent.status === 'SUCCEEDED' && intent.confirmed === true && intent.orderId === orderId && intent.bindingHash === tx.state.orders[orderId].bindingHash && intent.amountCents === obligation.amountCents && hash(intent.allocations) === hash(obligation.allocations) && intent.policyEvidence?.caseId === caseId && intent.policyEvidence.obligationHash === obligation.hash && intent.policyEvidence.evidenceRef === obligation.reviewRef && intent.policyEvidence.policyVersion === obligation.policyVersion, 'REFUND_RECONCILIATION_REQUIRED');
    } else requireValue(!item.refundObligation, 'REFUND_RECONCILIATION_REQUIRED');
    item.status = 'CLOSED'; item.outcome = outcome;
    item.history.push({ actorId: actor.id, evidence: clone(evidence), at: tx.now });
    tx.emit('PROTECTION_CASE_RESOLVED', { orderId, caseId, outcome, evidenceRef: evidence.ref });
    return item;
  });
}
