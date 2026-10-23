import { validateInstantPayoutQuote } from './payout-instant.mjs';
import { assertShippingPricingReceipt, allocateShippingRefund } from './shipping-pricing.mjs';
import { financeAssert as check, integerCents as cents, safeSum, digest, copy, identifier, postJournal, posting as line, accountBalance, recordProviderTransaction, cashLedgerHash } from './ledger.mjs';

const TERMINAL_FAILURE = new Set(['FAILED', 'CANCELED']);
const allocationKeys = ['sellerCents', 'feeCents', 'taxCents', 'shippingCents'];
const policyRefs = ['approvalRef', 'authorityRef', 'feeTermsRef', 'refundTermsRef', 'transferTermsRef', 'payoutTermsRef', 'returnsTermsRef', 'reserveTermsRef', 'disputeTermsRef'];
function state(tx) {
  check(Number.isSafeInteger(tx.now) && tx.now >= 0, 'INVALID_CLOCK');
  tx.state.intents ??= {}; tx.state.journals ??= []; tx.state.financeOrders ??= {};
  tx.state.financeObjects ??= {}; tx.state.financeDisputes ??= {}; tx.state.financeObservations ??= {};
  return tx.state;
}
function policyCheck(policy) {
  check(policy && ['synthetic', 'stripe-sandbox', 'stripe-production'].includes(policy.environment), 'FINANCE_POLICY_REQUIRED');
  identifier(policy.version);
  for (const key of policyRefs) identifier(policy[key]);
  check(Number.isSafeInteger(policy.maxEvidenceAgeMs) && policy.maxEvidenceAgeMs > 0 && policy.maxEvidenceAgeMs <= 300000, 'INVALID_EVIDENCE_WINDOW');
  return copy(policy);
}
function fresh(tx, evidence, policy) {
  check(evidence && Number.isSafeInteger(evidence.observedAt) && evidence.observedAt <= tx.now && tx.now - evidence.observedAt <= policy.maxEvidenceAgeMs, 'STALE_PROVIDER_EVIDENCE');
}
function restrictedByException(tx, intent) {
  return Object.values(state(tx).financeExceptions ?? {}).some(item => item.status === 'OPEN' && (!item.orderId || item.orderId === intent.orderId) && [intent.accountId, intent.platformAccountId, intent.connectedAccountId].includes(item.accountId));
}
function accountCheck(tx, account, intent, { payout = false } = {}) {
  fresh(tx, account, intent.policy);
  check(account.accountId === intent.connectedAccountId && account.livemode === (intent.policy.environment === 'stripe-production') && account.requirementsSatisfied === true && account.transfersActive === true, 'ACCOUNT_INELIGIBLE');
  if (payout) check(account.payoutsEnabled === true && account.manualPayouts === true && account.verifiedExternalAccountIds?.includes(intent.externalAccountId), 'PAYOUT_ACCOUNT_INELIGIBLE');
}
function requireAccountReconciliation(tx, intent, balanceEvidence) {
  if (intent.policy.environment === 'synthetic') return;
  for (const accountId of [intent.platformAccountId, intent.connectedAccountId]) {
    const book = `${accountId === intent.platformAccountId ? 'platform' : 'connected'}:${accountId}`;
    const reports = Object.values(state(tx).financeReconciliationReports ?? {}).filter(report => report.accountId === accountId && report.platformAccountId === intent.platformAccountId).sort((a, b) => (b.sequence ?? 0) - (a.sequence ?? 0));
    const report = reports[0];
    check(report?.status === 'RECONCILED' && report.provider === 'stripe' && report.livemode === (intent.policy.environment === 'stripe-production'), 'ACCOUNT_RECONCILIATION_REQUIRED');
    fresh(tx, report, intent.policy);
    check(report.cashLedgerHash === cashLedgerHash(tx.state, book) && report.ledgerCashCents === accountBalance(tx.state, book, 'provider_cash') && (accountId === intent.platformAccountId || report.providerAvailableCents === balanceEvidence.availableCents), 'ACCOUNT_RECONCILIATION_CHANGED');
  }
}
function allocations(value, amount) {
  check(value && Object.keys(value).sort().join(',') === [...allocationKeys].sort().join(','), 'INVALID_ALLOCATION');
  for (const key of allocationKeys) cents(value[key]);
  check(safeSum(...allocationKeys.map(key => value[key])) === amount, 'ALLOCATION_MISMATCH');
  return copy(value);
}
function getIntent(tx, id, kind) {
  const intent = state(tx).intents[identifier(id)];
  check(intent && (!kind || intent.kind === kind), 'INTENT_NOT_FOUND');
  return intent;
}
function getOrder(tx, orderId) { const order = state(tx).financeOrders[identifier(orderId)]; check(order, 'FINANCE_ORDER_NOT_FOUND'); return order; }
function existing(tx, id, request) {
  const old = state(tx).intents[identifier(id)];
  if (!old) return null;
  check(old.requestHash === digest(request), 'INTENT_CONFLICT');
  return copy(old);
}
function save(tx, request, fields) {
  const intent = { id: request.intentId, intentId: request.intentId, ...copy(fields), requestHash: digest(request), status: 'PREPARED', objectId: null, confirmed: false, terminalUnpaid: false, createdAt: tx.now, dispatchCount: 0 };
  state(tx).intents[intent.id] = intent;
  tx.emit?.('FINANCE_INTENT_PREPARED', { intentId: intent.id, kind: intent.kind, orderId: intent.orderId ?? null });
  return copy(intent);
}
function baseFrom(payment) {
  return { orderId: payment.orderId, order: copy(payment.order), sellerId: payment.sellerId, connectedAccountId: payment.connectedAccountId, platformAccountId: payment.platformAccountId, currency: 'USD', bindingHash: payment.bindingHash, policy: copy(payment.policy) };
}
function pbook(intent) { return `platform:${intent.platformAccountId}`; }
function cbook(intent) { return `connected:${intent.connectedAccountId}`; }
function account(name, orderId) { return `${name}:${orderId}`; }
function liability(tx, intent, bucket) { return -accountBalance(tx.state, cbook(intent), account(bucket, intent.orderId)); }
function journal(tx, intent, key, evidence, lines) {
  const filtered = lines.filter(item => item.cents !== 0);
  if (!filtered.length) return;
  postJournal(tx, { id: `${intent.id}:${key}`, kind: key, intentId: intent.id, evidenceHash: digest(evidence), lines: filtered });
}
function ensureUniqueScope(tx, kind, field, value) {
  check(!Object.values(state(tx).intents).some(intent => intent.kind === kind && intent[field] === value), 'FINANCIAL_ACTION_EXISTS');
}
export function preparePayment(tx, input) {
  const prior = existing(tx, input.intentId, input); if (prior) return prior;
  const { order, platformAccountId, connectedAccountId } = input;
  check(order && order.currency === 'USD', 'INVALID_ORDER');
  for (const key of ['orderId', 'reservationId', 'listingId', 'cardId', 'sellerId', 'buyerId', 'policyVersion', 'bindingHash']) identifier(order[key]);
  for (const key of ['totalCents', 'itemCents', 'feeCents', 'sellerNetCents', 'taxCents', 'shippingCents']) cents(order[key]);
  cents(order.totalCents, { positive: true });
  check(safeSum(order.sellerNetCents, order.feeCents) === order.itemCents && safeSum(order.itemCents, order.taxCents, order.shippingCents) === order.totalCents, 'ORDER_TOTAL_MISMATCH');
  identifier(platformAccountId); identifier(connectedAccountId); check(platformAccountId !== connectedAccountId, 'INVALID_ACCOUNT_SCOPE');
  const policy = policyCheck(input.policy); check(order.policyVersion === policy.version, 'POLICY_VERSION_MISMATCH');
  if(order.shippingPricing!==undefined)assertShippingPricingReceipt(order.shippingPricing,{shippingCents:order.shippingCents,environment:policy.environment==='synthetic'?'SYNTHETIC_LOCAL':policy.environment==='stripe-production'?'PRODUCTION':'PROVIDER_SANDBOX',now:tx.now});
  ensureUniqueScope(tx, 'PAYMENT', 'orderId', order.orderId);
  check(!state(tx).financeOrders[order.orderId], 'FINANCIAL_ORDER_EXISTS');
  const allocation = allocations({ sellerCents: order.sellerNetCents, feeCents: order.feeCents, taxCents: order.taxCents, shippingCents: order.shippingCents }, order.totalCents);
  state(tx).financeOrders[order.orderId] = { order: copy(order), paymentIntentId: input.intentId, sellerId: order.sellerId, connectedAccountId, confirmed: false, blocked: false, transferIntentId: null };
  return save(tx, input, { kind: 'PAYMENT', order: copy(order), orderId: order.orderId, sellerId: order.sellerId, platformAccountId, connectedAccountId, accountId: platformAccountId, amountCents: order.totalCents, allocations: allocation, currency: 'USD', bindingHash: order.bindingHash, policy });
}
export function prepareTransfer(tx, input) {
  const prior = existing(tx, input.intentId, input); if (prior) return prior;
  const payment = getIntent(tx, input.paymentIntentId, 'PAYMENT');
  check(payment.confirmed && payment.status === 'SUCCEEDED', 'PAYMENT_UNCONFIRMED');
  const order = getOrder(tx, payment.orderId);
  check(!order.blocked && !restrictedByException(tx, payment), 'ORDER_FUNDS_RESTRICTED');
  ensureUniqueScope(tx, 'TRANSFER', 'orderId', payment.orderId);
  const release = input.releaseEvidence;
  check(release?.approved === true && release.orderId === payment.orderId && release.bindingHash === payment.bindingHash && release.policyVersion === payment.policy.version && Number.isSafeInteger(release.releasedAt) && release.releasedAt <= tx.now, 'RELEASE_EVIDENCE_REQUIRED'); identifier(release.evidenceRef);
  accountCheck(tx, input.accountEvidence, payment);
  check(!Object.values(state(tx).intents).some(i => i.orderId === payment.orderId && i.kind === 'REFUND' && !['SUCCEEDED', ...TERMINAL_FAILURE].includes(i.status)), 'REFUND_UNRESOLVED');
  const amountCents = -accountBalance(tx.state, pbook(payment), account('seller_payable', payment.orderId)); cents(amountCents, { positive: true });
  const result = save(tx, input, { ...baseFrom(payment), kind: 'TRANSFER', accountId: payment.platformAccountId, parentObjectId: payment.chargeId, amountCents, releaseEvidence: copy(release) });
  order.transferIntentId = input.intentId;
  return result;
}
function reservedRefunds(tx, payment) {
  return Object.values(state(tx).intents).filter(intent => intent.kind === 'REFUND' && intent.orderId === payment.orderId && !TERMINAL_FAILURE.has(intent.status));
}
export function prepareRefund(tx, input) {
  const prior = existing(tx, input.intentId, input); if (prior) return prior;
  const payment = getIntent(tx, input.paymentIntentId, 'PAYMENT'); check(payment.confirmed, 'PAYMENT_UNCONFIRMED');
  check(!Object.values(state(tx).financeDisputes).some(dispute => dispute.orderId === payment.orderId && dispute.status !== 'won'), 'DISPUTED_PAYMENT_REFUND_REQUIRES_REVIEW');
  cents(input.amountCents, { positive: true }); const allocation = allocations(input.allocations, input.amountCents);
  const terms = input.policyEvidence;
  check(terms?.approved === true && terms.orderId === payment.orderId && terms.policyVersion === payment.policy.version, 'REFUND_AUTHORITY_REQUIRED'); identifier(terms.evidenceRef);
  const previous = reservedRefunds(tx, payment);
  check(safeSum(input.amountCents, ...previous.map(i => i.amountCents)) <= payment.amountCents, 'EXCESS_REFUND');
  for (const key of allocationKeys) check(safeSum(allocation[key], ...previous.map(i => i.allocations[key])) <= payment.allocations[key], 'EXCESS_REFUND_ALLOCATION');
  const shippingRefundAttribution = payment.order.shippingPricing === undefined ? null : allocateShippingRefund(payment.order.shippingPricing, allocation.shippingCents, previous.map(i => i.shippingRefundAttribution));
  const order = getOrder(tx, payment.orderId);
  const transfer = order.transferIntentId ? getIntent(tx, order.transferIntentId, 'TRANSFER') : null;
  check(!transfer || transfer.confirmed, 'TRANSFER_UNRESOLVED');
  order.blocked = true;
  return save(tx, input, { ...baseFrom(payment), kind: 'REFUND', accountId: payment.platformAccountId, parentObjectId: payment.chargeId, amountCents: input.amountCents, allocations: allocation, recoverSeller: Boolean(transfer), policyEvidence: copy(terms), ...(shippingRefundAttribution?{shippingRefundAttribution}:{}) });
}
export function prepareReversal(tx, input) {
  const prior = existing(tx, input.intentId, input); if (prior) return prior;
  const transfer = getIntent(tx, input.transferIntentId, 'TRANSFER'); check(transfer.confirmed, 'TRANSFER_UNCONFIRMED');
  cents(input.amountCents, { positive: true }); accountCheck(tx, input.accountEvidence, transfer);
  const reservations = Object.values(state(tx).intents).filter(i => i.kind === 'REVERSAL' && i.parentObjectId === transfer.objectId && !TERMINAL_FAILURE.has(i.status));
  check(safeSum(input.amountCents, ...reservations.map(i => i.amountCents)) <= transfer.amountCents, 'EXCESS_REVERSAL');
  const receivable = accountBalance(tx.state, pbook(transfer), account('seller_recovery', transfer.orderId));
  const outstanding = reservations.filter(i => !i.confirmed).map(i => i.amountCents);
  check(safeSum(input.amountCents, ...outstanding) <= receivable, 'REVERSAL_WITHOUT_RECOVERY');
  check(safeSum(input.amountCents, ...outstanding) <= safeSum(liability(tx, transfer, 'seller_available'), liability(tx, transfer, 'seller_pending')), 'REVERSAL_FUNDS_UNAVAILABLE');
  getOrder(tx, transfer.orderId).blocked = true;
  return save(tx, input, { ...baseFrom(transfer), kind: 'REVERSAL', accountId: transfer.platformAccountId, parentObjectId: transfer.objectId, amountCents: input.amountCents });
}
export function preparePayout(tx, input) {
  const prior = existing(tx, input.intentId, input); if (prior) return prior;
  identifier(input.sellerId); identifier(input.connectedAccountId); identifier(input.externalAccountId); cents(input.amountCents, { positive: true });
  check(Array.isArray(input.allocationOrderIds) && input.allocationOrderIds.length > 0 && new Set(input.allocationOrderIds).size === input.allocationOrderIds.length, 'INVALID_PAYOUT_ALLOCATIONS');
  const orders = input.allocationOrderIds.map(id => getOrder(tx, id));
  const payments = orders.map(order => getIntent(tx, order.paymentIntentId, 'PAYMENT'));
  const base = payments[0];
  check(!payments.some(payment => restrictedByException(tx, payment)), 'SELLER_FUNDS_RESTRICTED');
  check(payments.every(payment => payment.sellerId === input.sellerId && payment.connectedAccountId === input.connectedAccountId && digest(payment.policy) === digest(base.policy)), 'PAYOUT_SCOPE_MISMATCH');
  check(!Object.values(state(tx).financeOrders).some(order => order.sellerId === input.sellerId && order.blocked), 'SELLER_FUNDS_RESTRICTED');
  check(input.method === undefined || ['standard','instant'].includes(input.method), 'UNSUPPORTED_PAYOUT_METHOD');
  const instantQuote = input.method === 'instant' ? validateInstantPayoutQuote(tx, { quoteId: input.quoteId, sellerId: input.sellerId, connectedAccountId: input.connectedAccountId, externalAccountId: input.externalAccountId, amountCents: input.amountCents, policy: input.instantPolicy, eligibilityEvidence: input.instantEvidence, intentId: input.intentId }) : null;
  if (instantQuote) check(input.instantPolicy.environment === base.policy.environment && input.instantPolicy.platformAccountId === base.platformAccountId, 'INSTANT_PAYOUT_POLICY_REQUIRED');
  const fields = { ...baseFrom(base), orderId: null, order: null, kind: 'PAYOUT', accountId: input.connectedAccountId, externalAccountId: input.externalAccountId, amountCents: input.amountCents, bindingHash: digest({ sellerId: input.sellerId, connectedAccountId: input.connectedAccountId, externalAccountId: input.externalAccountId, amountCents: input.amountCents, allocationOrderIds: input.allocationOrderIds }) };
  if (instantQuote) Object.assign(fields, { method: 'instant', instantPolicy: copy(input.instantPolicy), instantQuote, totalDebitCents: instantQuote.totalDebitCents, bindingHash: digest({ allocationBinding: fields.bindingHash, method: 'instant', quoteHash: instantQuote.quoteHash, policyHash: instantQuote.policyHash }) });
  accountCheck(tx, input.accountEvidence, fields, { payout: true });
  fresh(tx, input.balanceEvidence, base.policy);
  const balance = input.balanceEvidence;
  check(balance.accountId === input.connectedAccountId && balance.livemode === (base.policy.environment === 'stripe-production') && balance.currency === 'USD', 'BALANCE_SCOPE_MISMATCH'); cents(balance.availableCents);
  requireAccountReconciliation(tx, fields, balance);
  const inFlight = Object.values(state(tx).intents).filter(i => i.kind === 'PAYOUT' && i.accountId === input.connectedAccountId && !['SUCCEEDED', 'VOIDED', ...TERMINAL_FAILURE].includes(i.status));
  check(safeSum(fields.totalDebitCents ?? input.amountCents, ...inFlight.map(i => i.totalDebitCents ?? i.amountCents)) <= balance.availableCents, 'PROVIDER_BALANCE_INSUFFICIENT');
  let remaining = input.amountCents; const allocation = [];
  for (const payment of payments) {
    const available = liability(tx, payment, 'seller_available'); cents(available);
    const amountCents = Math.min(remaining, available);
    if (amountCents) allocation.push({ orderId: payment.orderId, amountCents });
    remaining -= amountCents;
  }
  check(remaining === 0, 'SELLER_BALANCE_INSUFFICIENT');
  if (instantQuote) {
    let feeRemaining = instantQuote.sellerFeeCents;
    for (const payment of payments) {
      const a = allocation.find(row => row.orderId === payment.orderId);
      const feeCents = Math.min(feeRemaining, liability(tx, payment, 'seller_available') - (a?.amountCents ?? 0));
      if (feeCents) { if (a) a.feeCents = feeCents; else allocation.push({ orderId: payment.orderId, amountCents: 0, feeCents }); feeRemaining -= feeCents; }
    }
    check(feeRemaining === 0, 'SELLER_BALANCE_INSUFFICIENT');
    tx.state.financePayoutQuotes[input.quoteId].consumedBy = input.intentId;
  }
  const result = save(tx, input, { ...fields, payoutAllocations: allocation });
  journal(tx, result, 'PAYOUT_RESERVED', input, allocation.flatMap(a => [line(cbook(result), account('seller_available', a.orderId), safeSum(a.amountCents,a.feeCents ?? 0)), line(cbook(result), account('seller_withdrawing', a.orderId), -safeSum(a.amountCents,a.feeCents ?? 0))]));
  return result;
}
export function claimDispatch(tx, intentId, accountEvidence = null, balanceEvidence = null, instantEvidence = null) {
  const intent = getIntent(tx, intentId);
  check(intent.status === 'PREPARED' && intent.dispatchCount === 0, 'RECONCILIATION_REQUIRED');
  if (['TRANSFER', 'REVERSAL', 'PAYOUT'].includes(intent.kind)) accountCheck(tx, accountEvidence, intent, { payout: intent.kind === 'PAYOUT' });
  if (intent.kind === 'PAYOUT') {
    fresh(tx, balanceEvidence, intent.policy);
    check(balanceEvidence.accountId === intent.accountId && balanceEvidence.livemode === (intent.policy.environment === 'stripe-production') && balanceEvidence.currency === 'USD', 'BALANCE_SCOPE_MISMATCH');
    cents(balanceEvidence.availableCents);
    check(balanceEvidence.availableCents >= (intent.totalDebitCents ?? intent.amountCents), 'PROVIDER_BALANCE_INSUFFICIENT');
    requireAccountReconciliation(tx, intent, balanceEvidence);
    if (intent.method === 'instant') {
      validateInstantPayoutQuote(tx, { quoteId: intent.instantQuote.quoteId, sellerId: intent.sellerId, connectedAccountId: intent.connectedAccountId, externalAccountId: intent.externalAccountId, amountCents: intent.amountCents, policy: intent.instantPolicy, eligibilityEvidence: instantEvidence, intentId: intent.id });
    }
  }
  if (['TRANSFER', 'PAYOUT'].includes(intent.kind)) {
    check(!restrictedByException(tx, intent), 'SELLER_FUNDS_RESTRICTED');
    check(!Object.values(state(tx).financeOrders).some(order => order.sellerId === intent.sellerId && order.blocked), 'SELLER_FUNDS_RESTRICTED');
  }
  intent.status = 'DISPATCHING'; intent.dispatchCount = 1; intent.dispatchedAt = tx.now;
  intent.idempotencyKey = `atlas-marketplace:${digest({ intentId: intent.id, requestHash: intent.requestHash })}`;
  tx.emit?.('FINANCE_DISPATCH_CLAIMED', { intentId, kind: intent.kind });
  return copy(intent);
}
export function voidPreparedPayment(tx, { intentId }) {
  const intent = getIntent(tx, intentId, 'PAYMENT');
  check(intent.dispatchCount === 0 && intent.objectId === null && !intent.confirmed && !intent.terminalUnpaid && !intent.dispatchedAt && !intent.reconciledAt && !intent.idempotencyKey && !intent.evidenceHash && !intent.chargeId && !Object.values(state(tx).financeBalanceTransactions ?? {}).some(row => row.owner === intentId) && !state(tx).financeObservations[intentId] && !Object.values(state(tx).financeObjects).includes(intentId) && !state(tx).financeOrders[intent.orderId]?.confirmed && !state(tx).journals.some(row => row.intentId === intentId), 'PAYMENT_LOCAL_VOID_REFUSED');
  if (intent.status === 'VOIDED') { check(intent.locallyVoided === true && Number.isSafeInteger(intent.voidedAt) && intent.voidedAt <= tx.now, 'PAYMENT_LOCAL_VOID_REFUSED'); return copy(intent); }
  check(intent.status === 'PREPARED', 'PAYMENT_LOCAL_VOID_REFUSED');
  intent.status = 'VOIDED'; intent.locallyVoided = true; intent.voidedAt = tx.now;
  return copy(intent);
}
export function voidPreparedPayout(tx, { intentId }) {
  const intent = getIntent(tx, intentId, 'PAYOUT');
  check(intent.dispatchCount === 0 && intent.objectId === null && !intent.confirmed && !intent.cashDebited && !intent.returned && !intent.dispatchedAt && !intent.reconciledAt && !intent.idempotencyKey && !intent.evidenceHash && !intent.chargeId && !Object.values(state(tx).financeBalanceTransactions ?? {}).some(row => row.owner === intentId) && !state(tx).financeObservations[intentId] && !Object.values(state(tx).financeObjects).includes(intentId), 'PAYOUT_LOCAL_VOID_REFUSED');
  const expected = intent.payoutAllocations.flatMap(a => [line(cbook(intent), account('seller_available', a.orderId), safeSum(a.amountCents,a.feeCents ?? 0)), line(cbook(intent), account('seller_withdrawing', a.orderId), -safeSum(a.amountCents,a.feeCents ?? 0))]);
  const entries = state(tx).journals.filter(row => row.intentId === intentId), reserved = entries.find(row => row.id === `${intentId}:PAYOUT_RESERVED`);
  check(reserved?.kind === 'PAYOUT_RESERVED' && digest(reserved.lines) === digest(expected), 'PAYOUT_LOCAL_VOID_REFUSED');
  if (intent.status === 'VOIDED') {
    const correction = entries.find(row => row.id === `${intentId}:PAYOUT_RESERVATION_VOIDED`);
    check(intent.locallyVoided === true && Number.isSafeInteger(intent.voidedAt) && intent.voidedAt <= tx.now && entries.length === 2 && correction?.kind === 'PAYOUT_RESERVATION_VOIDED' && digest(correction.lines) === digest(expected.map(row => ({...row,cents:-row.cents}))), 'PAYOUT_LOCAL_VOID_REFUSED');
    return copy(intent);
  }
  check(intent.status === 'PREPARED' && entries.length === 1, 'PAYOUT_LOCAL_VOID_REFUSED');
  for (const a of intent.payoutAllocations) check(-accountBalance(tx.state,cbook(intent),account('seller_withdrawing',a.orderId)) >= safeSum(a.amountCents,a.feeCents ?? 0), 'PAYOUT_LOCAL_VOID_REFUSED');
  journal(tx,intent,'PAYOUT_RESERVATION_VOIDED',{reservationHash:reserved.hash,reason:'NEVER_DISPATCHED'},expected.map(row => ({...row,cents:-row.cents})));
  intent.status = 'VOIDED'; intent.locallyVoided = true; intent.voidedAt = tx.now;
  return copy(intent);
}
export function markFinanceUnknown(tx, intentId) {
  const intent = getIntent(tx, intentId);
  if (intent.status === 'DISPATCHING') intent.status = 'UNKNOWN';
  return copy(intent);
}
function balanceTransaction(evidence, expectedAmount, expectedSource, { connected = false } = {}) {
  const value = connected ? evidence.connectedBalanceTransaction : evidence.balanceTransaction;
  check(value && typeof value.id === 'string' && value.currency === 'USD' && value.source === expectedSource && value.amountCents === expectedAmount && Number.isSafeInteger(value.netCents), 'BALANCE_TRANSACTION_MISMATCH');
  identifier(value.id); cents(value.feeCents);
  check(safeSum(value.amountCents, -value.feeCents) === value.netCents && ['pending', 'available'].includes(value.status) && Number.isSafeInteger(value.availableOn), 'BALANCE_TRANSACTION_MISMATCH');
  return value;
}
function evidenceCheck(tx, intent, evidence) {
  fresh(tx, evidence, intent.policy);
  check(evidence.provider === (intent.policy.environment === 'synthetic' ? 'synthetic' : 'stripe') && evidence.livemode === (intent.policy.environment === 'stripe-production') && evidence.accountId === intent.accountId && evidence.kind === intent.kind && evidence.intentId === intent.id && evidence.orderId === intent.orderId && evidence.bindingHash === intent.bindingHash && evidence.currency === 'USD' && evidence.amountCents === intent.amountCents, 'PROVIDER_EVIDENCE_MISMATCH');
  identifier(evidence.objectId);
  check(intent.dispatchCount === 1 && (!intent.objectId || intent.objectId === evidence.objectId), 'UNBOUND_PROVIDER_OBJECT');
  if (intent.parentObjectId) check(intent.parentObjectId === evidence.parentObjectId, 'PROVIDER_PARENT_MISMATCH');
  if (intent.kind === 'TRANSFER') check(evidence.destinationAccountId === intent.connectedAccountId, 'PROVIDER_DESTINATION_MISMATCH');
  if (intent.kind === 'PAYOUT') check(evidence.externalAccountId === intent.externalAccountId && (evidence.method ?? 'standard') === (intent.method ?? 'standard') && (evidence.type ?? 'bank_account') === 'bank_account', 'PROVIDER_DESTINATION_MISMATCH');
  for (const key of ['balanceTransaction', 'connectedBalanceTransaction', 'failureBalanceTransaction']) {
    const previous = state(tx).financeObservations[intent.id]?.[key];
    const next = evidence[key];
    if (previous && next) check(previous.id === next.id && previous.source === next.source && previous.amountCents === next.amountCents && previous.feeCents === next.feeCents && previous.netCents === next.netCents && previous.currency === next.currency, 'BALANCE_TRANSACTION_CHANGED');
  }
  const objectKey = `${intent.accountId}:${evidence.objectId}`;
  check(!state(tx).financeObjects[objectKey] || state(tx).financeObjects[objectKey] === intent.id, 'PROVIDER_OBJECT_REUSED');
  if (intent.reconciledAt) check(evidence.observedAt >= intent.reconciledAt, 'OLDER_RECONCILIATION');
  state(tx).financeObjects[objectKey] = intent.id;
  intent.objectId = evidence.objectId;
}
function remember(tx, intent, evidence, key = 'balanceTransaction', connected = false) {
  const transaction = evidence[key]; if (!transaction) return;
  recordProviderTransaction(tx, { accountId: connected ? intent.connectedAccountId : intent.accountId, transaction, owner: intent.id, observedAt: evidence.observedAt, livemode: evidence.livemode });
}
function postPayment(tx, intent, evidence) {
  identifier(evidence.chargeId);
  check(evidence.amountReceivedCents === intent.amountCents && evidence.chargeCapturedCents === intent.amountCents && evidence.chargePaid === true && evidence.chargeCurrency === 'USD' && evidence.chargeAmountCents === intent.amountCents, 'CHARGE_MISMATCH');
  const bt = balanceTransaction(evidence, intent.amountCents, evidence.chargeId);
  check(bt.netCents >= 0, 'INVALID_PROCESSING_FEE');
  remember(tx, intent, evidence);
  if (intent.confirmed) { check(intent.chargeId === evidence.chargeId, 'CHARGE_MISMATCH'); return; }
  const a = intent.allocations;
  journal(tx, intent, 'PAYMENT_SETTLED', evidence, [line(pbook(intent), 'provider_cash', bt.netCents), line(pbook(intent), 'processing_expense', bt.feeCents), line(pbook(intent), account('seller_payable', intent.orderId), -a.sellerCents), line(pbook(intent), 'fee_revenue', -a.feeCents), line(pbook(intent), 'tax_payable', -a.taxCents), ...shippingAllocationLines(intent,-1)]);
  intent.chargeId = evidence.chargeId;
  getOrder(tx, intent.orderId).confirmed = true;
}
function postTransfer(tx, intent, evidence) {
  const bt = balanceTransaction(evidence, -intent.amountCents, intent.objectId);
  check(bt.feeCents === 0, 'UNSUPPORTED_TRANSFER_FEE');
  identifier(evidence.destinationPaymentId);
  const connected = balanceTransaction(evidence, intent.amountCents, evidence.destinationPaymentId, { connected: true });
  check(connected.feeCents === 0, 'UNSUPPORTED_TRANSFER_FEE');
  remember(tx, intent, evidence); remember(tx, intent, evidence, 'connectedBalanceTransaction', true);
  if (!intent.confirmed) journal(tx, intent, 'TRANSFER_SETTLED', evidence, [line(pbook(intent), account('seller_payable', intent.orderId), intent.amountCents), line(pbook(intent), 'provider_cash', -intent.amountCents), line(cbook(intent), 'provider_cash', intent.amountCents), line(cbook(intent), account('seller_pending', intent.orderId), -intent.amountCents)]);
  if (!intent.available && connected.status === 'available' && connected.availableOn <= tx.now) {
    const remaining = liability(tx, intent, 'seller_pending'); cents(remaining);
    journal(tx, intent, 'TRANSFER_AVAILABLE', evidence, [line(cbook(intent), account('seller_pending', intent.orderId), remaining), line(cbook(intent), account('seller_available', intent.orderId), -remaining)]);
    intent.available = true;
  }
}
function maybeUnblock(tx, intent) {
  const order = getOrder(tx, intent.orderId);
  const pending = Object.values(state(tx).intents).some(i => i.orderId === intent.orderId && ['REFUND', 'REVERSAL'].includes(i.kind) && ![ 'SUCCEEDED', ...TERMINAL_FAILURE].includes(i.status));
  const disputed = Object.values(state(tx).financeDisputes).some(d => d.orderId === intent.orderId && d.status !== 'won');
  const held = Object.values(state(tx).financeHolds ?? {}).some(h => h.orderId === intent.orderId && h.active);
  if (!pending && !disputed && !held && !restrictedByException(tx, intent) && accountBalance(tx.state, pbook(intent), account('seller_recovery', intent.orderId)) === 0) order.blocked = false;
}
function refundDebit(tx, intent, evidence) {
  const bt = balanceTransaction(evidence, -intent.amountCents, intent.objectId);
  remember(tx, intent, evidence);
  if (!intent.cashDebited) {
    journal(tx, intent, 'REFUND_DEBITED', evidence, [line(pbook(intent), `refund_clearing:${intent.id}`, intent.amountCents), line(pbook(intent), 'processing_expense', bt.feeCents), line(pbook(intent), 'provider_cash', bt.netCents)]);
    intent.cashDebited = true;
  }
}
function shippingAllocationLines(intent, sign) {
  const receipt=intent.order.shippingPricing,shippingCents=intent.allocations.shippingCents;
  if(receipt===undefined)return [line(pbook(intent),'shipping_payable',sign*shippingCents)];
  assertShippingPricingReceipt(receipt,{shippingCents:intent.order.shippingCents});
  const allocation=intent.kind==='REFUND'?intent.shippingRefundAttribution:{carrierCents:receipt.quotedCarrierCostCents,handlingCents:receipt.handlingCents};
  check(allocation&&safeSum(allocation.carrierCents,allocation.handlingCents)===shippingCents,'SHIPPING_REFUND_ALLOCATION_INVALID');
  cents(allocation.carrierCents);cents(allocation.handlingCents);
  check(allocation.carrierCents<=receipt.quotedCarrierCostCents&&allocation.handlingCents<=receipt.handlingCents,'SHIPPING_REFUND_ALLOCATION_INVALID');
  return [line(pbook(intent),account('shipping_carrier_deferred',intent.orderId),sign*allocation.carrierCents),line(pbook(intent),account('shipping_handling_deferred',intent.orderId),sign*allocation.handlingCents)];
}
function refundAllocationLines(intent, sign = 1) {
  const a = intent.allocations;
  return [line(pbook(intent), intent.recoverSeller ? account('seller_recovery', intent.orderId) : account('seller_payable', intent.orderId), sign * a.sellerCents), line(pbook(intent), 'fee_revenue', sign * a.feeCents), line(pbook(intent), 'tax_payable', sign * a.taxCents), ...shippingAllocationLines(intent,sign)];
}
function postRefund(tx, intent, evidence) {
  refundDebit(tx, intent, evidence);
  journal(tx, intent, 'REFUND_SETTLED', evidence, [...refundAllocationLines(intent), line(pbook(intent), `refund_clearing:${intent.id}`, -intent.amountCents)]);
}
function failRefund(tx, intent, evidence) {
  if (!evidence.balanceTransaction) {
    check(!intent.cashDebited && !intent.confirmed && evidence.failureConfirmed === true && !evidence.failureBalanceTransaction, 'FAILURE_UNCONFIRMED');
    return;
  }
  refundDebit(tx, intent, evidence);
  const returned = balanceTransaction({ balanceTransaction: evidence.failureBalanceTransaction }, intent.amountCents, intent.objectId);
  check(returned.feeCents === 0 && returned.id !== evidence.balanceTransaction.id && returned.status === 'available' && returned.availableOn <= tx.now, 'REFUND_RETURN_UNCONFIRMED');
  remember(tx, intent, evidence, 'failureBalanceTransaction');
  if (!intent.returned) {
    if (intent.confirmed && intent.recoverSeller) check(accountBalance(tx.state, pbook(intent), account('seller_recovery', intent.orderId)) >= intent.allocations.sellerCents, 'REFUND_RECOVERY_REQUIRES_REVIEW');
    journal(tx, intent, 'REFUND_RETURNED', evidence, [line(pbook(intent), 'provider_cash', intent.amountCents), ...(intent.confirmed ? refundAllocationLines(intent, -1) : [line(pbook(intent), `refund_clearing:${intent.id}`, -intent.amountCents)])]);
    intent.returned = true;
  }
}
function postReversal(tx, intent, evidence) {
  // Stripe's reversal balance transaction names the parent transfer as source.
  // evidenceCheck already binds that exact parent; the adapter retrieves this
  // transaction by the original reversal's balance_transaction reference.
  const platformSource = intent.policy.environment === 'synthetic' ? intent.objectId : intent.parentObjectId;
  const bt = balanceTransaction(evidence, intent.amountCents, platformSource); check(bt.feeCents === 0, 'UNSUPPORTED_REVERSAL_FEE');
  identifier(evidence.destinationPaymentRefundId);
  const connected = balanceTransaction(evidence, -intent.amountCents, evidence.destinationPaymentRefundId, { connected: true });
  check(connected.feeCents === 0, 'UNSUPPORTED_REVERSAL_FEE');
  remember(tx, intent, evidence); remember(tx, intent, evidence, 'connectedBalanceTransaction', true);
  const available = liability(tx, intent, 'seller_available'); const pending = liability(tx, intent, 'seller_pending');
  check(safeSum(available, pending) >= intent.amountCents, 'REVERSAL_FUNDS_UNAVAILABLE');
  const fromAvailable = Math.min(available, intent.amountCents);
  journal(tx, intent, 'REVERSAL_SETTLED', evidence, [line(pbook(intent), 'provider_cash', intent.amountCents), line(pbook(intent), account('seller_recovery', intent.orderId), -intent.amountCents), line(cbook(intent), account('seller_available', intent.orderId), fromAvailable), line(cbook(intent), account('seller_pending', intent.orderId), intent.amountCents - fromAvailable), line(cbook(intent), 'provider_cash', -intent.amountCents)]);
}
function payoutDebit(tx, intent, evidence) {
  const bt = balanceTransaction(evidence, -intent.amountCents, intent.objectId);
  const sellerFee = intent.instantQuote?.sellerFeeCents ?? 0, providerFee = intent.instantQuote?.providerFeeCents ?? 0;
  check(bt.feeCents === sellerFee, 'UNSUPPORTED_PAYOUT_FEE');
  if (intent.method === 'instant') {
    const fee = evidence.applicationFee;
    if (sellerFee) {
      check(fee && fee.accountId === intent.connectedAccountId && fee.platformAccountId === intent.platformAccountId && fee.livemode === evidence.livemode && fee.applicationId === intent.instantPolicy.applicationId && fee.payoutId === intent.objectId && fee.amountCents === sellerFee && fee.refundedCents === 0 && fee.currency === 'USD', 'INSTANT_PAYOUT_FEE_MISMATCH');
      const feeBt = balanceTransaction({ balanceTransaction: fee.balanceTransaction }, sellerFee, fee.objectId); check(feeBt.feeCents === 0, 'INSTANT_PAYOUT_FEE_MISMATCH');
      check(Array.isArray(bt.feeDetails) && bt.feeDetails.length === 1 && bt.feeDetails[0].type === 'application_fee' && bt.feeDetails[0].applicationId === fee.applicationId && bt.feeDetails[0].amountCents === sellerFee && bt.feeDetails[0].currency === 'USD', 'INSTANT_PAYOUT_FEE_MISMATCH');
      recordProviderTransaction(tx, { accountId: intent.platformAccountId, transaction: feeBt, owner: intent.id, observedAt: evidence.observedAt, livemode: evidence.livemode });
    } else check(fee === null, 'INSTANT_PAYOUT_FEE_MISMATCH');
  }
  remember(tx, intent, evidence);
  if (!intent.cashDebited) {
    journal(tx, intent, 'PAYOUT_DEBITED', evidence, [line(cbook(intent), `payout_clearing:${intent.id}`, intent.amountCents), line(cbook(intent), 'provider_cash', -safeSum(intent.amountCents,sellerFee)), ...intent.payoutAllocations.filter(a => a.feeCents).map(a => line(cbook(intent), account('seller_withdrawing', a.orderId), a.feeCents)), line(pbook(intent), 'provider_cash', sellerFee), line(pbook(intent), 'instant_fee_revenue', -sellerFee), line(pbook(intent), 'instant_provider_fee_expense', providerFee), line(pbook(intent), 'instant_provider_fee_payable', -providerFee)]);
    intent.cashDebited = true;
  }
}
function postPayout(tx, intent, evidence) {
  payoutDebit(tx, intent, evidence);
  if (!intent.confirmed) journal(tx, intent, 'PAYOUT_PAID', evidence, [...intent.payoutAllocations.map(a => line(cbook(intent), account('seller_withdrawing', a.orderId), a.amountCents)), line(cbook(intent), `payout_clearing:${intent.id}`, -intent.amountCents)]);
}
function failPayout(tx, intent, evidence) {
  // Failed/canceled payout is not free money: verify both debit and returned-funds transactions.
  payoutDebit(tx, intent, evidence);
  const returned = balanceTransaction({ balanceTransaction: evidence.failureBalanceTransaction }, intent.amountCents, intent.objectId);
  check(returned.status === 'available' && returned.availableOn <= tx.now && returned.feeCents === 0 && returned.id !== evidence.balanceTransaction.id, 'PAYOUT_RETURN_UNCONFIRMED');
  remember(tx, intent, evidence, 'failureBalanceTransaction');
  if (!intent.returned) {
    journal(tx, intent, 'PAYOUT_RETURNED', evidence, [line(cbook(intent), 'provider_cash', intent.amountCents), ...(intent.confirmed ? [] : [line(cbook(intent), `payout_clearing:${intent.id}`, -intent.amountCents)]), ...intent.payoutAllocations.flatMap(a => [...(intent.confirmed ? [] : [line(cbook(intent), account('seller_withdrawing', a.orderId), a.amountCents)]), line(cbook(intent), account('seller_available', a.orderId), -a.amountCents)])]);
    intent.returned = true;
  }
}
export function reconcileFinance(tx, { intentId, evidence }) {
  const intent = getIntent(tx, intentId); evidenceCheck(tx, intent, evidence);
  const previousStatus = intent.status;
  const success = intent.kind === 'PAYOUT' ? evidence.status === 'paid' : evidence.status === 'succeeded';
  if (TERMINAL_FAILURE.has(previousStatus)) {
    check(!success, 'TERMINAL_PROVIDER_CONTRADICTION');
    return copy(intent);
  }
  if (success) {
    if (intent.kind === 'TRANSFER') postTransfer(tx, intent, evidence);
    else if (intent.kind === 'PAYMENT') postPayment(tx, intent, evidence);
    else if (intent.kind === 'PAYOUT') postPayout(tx, intent, evidence);
    else if (!intent.confirmed) ({ PAYMENT: postPayment, REFUND: postRefund, REVERSAL: postReversal, PAYOUT: postPayout })[intent.kind](tx, intent, evidence);
    intent.status = 'SUCCEEDED'; intent.confirmed = true;
  } else if (intent.kind === 'PAYMENT' && evidence.status === 'canceled') {
    check(!intent.confirmed, 'TERMINAL_PROVIDER_CONTRADICTION');
    check(evidence.amountReceivedCents === 0 && evidence.chargePaid === false && evidence.chargeCapturedCents === 0, 'UNPAID_CANCELLATION_UNPROVEN');
    intent.status = 'CANCELED'; intent.terminalUnpaid = true;
  } else if (intent.kind === 'PAYOUT' && ['failed', 'canceled'].includes(evidence.status)) {
    failPayout(tx, intent, evidence); intent.status = evidence.status.toUpperCase();
  } else if (intent.kind === 'REFUND' && ['failed', 'canceled'].includes(evidence.status)) {
    failRefund(tx, intent, evidence); intent.status = evidence.status.toUpperCase();
  } else if (intent.kind === 'REVERSAL' && ['failed', 'canceled'].includes(evidence.status)) {
    check(!intent.confirmed, 'TERMINAL_PROVIDER_CONTRADICTION');
    check(evidence.failureConfirmed === true && evidence.balanceTransaction == null, 'FAILURE_UNCONFIRMED'); intent.status = evidence.status.toUpperCase();
  } else {
    check(['pending', 'processing', 'requires_payment_method', 'requires_confirmation', 'requires_action', 'requires_capture', 'in_transit'].includes(evidence.status), 'UNSUPPORTED_PROVIDER_STATUS');
    check(!intent.confirmed, 'TERMINAL_PROVIDER_CONTRADICTION');
    if (intent.kind === 'PAYOUT' && evidence.balanceTransaction) payoutDebit(tx, intent, evidence);
    if (intent.kind === 'REFUND' && evidence.balanceTransaction) refundDebit(tx, intent, evidence);
    intent.status = 'PENDING';
  }
  intent.reconciledAt = evidence.observedAt; intent.evidenceHash = digest(evidence);
  state(tx).financeObservations[intent.id] = copy(evidence);
  if (['REFUND', 'REVERSAL'].includes(intent.kind)) maybeUnblock(tx, intent);
  if (intent.kind === 'REFUND' && TERMINAL_FAILURE.has(intent.status) && intent.order.sellerNetCents > 0) recordHold(tx, { orderId: intent.orderId, holdId: `refund-failed:${intent.id}`, reason: 'REFUND_OBLIGATION_UNPAID', evidenceRef: intent.evidenceHash, amountCents: Math.max(1, Math.min(intent.amountCents, intent.order.sellerNetCents)) });
  tx.emit?.('FINANCE_RECONCILED', { intentId, kind: intent.kind, status: intent.status, objectId: intent.objectId });
  return copy(intent);
}
export function sellerBalance(stateValue, sellerId) {
  identifier(sellerId);
  const sellerRestricted = Object.values(stateValue.financeOrders ?? {}).some(order => order.sellerId === sellerId && (order.blocked || Object.values(stateValue.financeExceptions ?? {}).some(item => item.status === 'OPEN' && (!item.orderId || item.orderId === order.order.orderId) && [order.connectedAccountId, stateValue.intents[order.paymentIntentId].platformAccountId].includes(item.accountId))));
  const values = { pendingCents: 0, availableCents: 0, reservedCents: 0, withdrawingCents: 0, paidOutCents: 0, recoveryDueCents: 0, currency: 'USD' };
  for (const order of Object.values(stateValue.financeOrders ?? {}).filter(order => order.sellerId === sellerId)) {
    const payment = stateValue.intents[order.paymentIntentId];
    const p = pbook(payment), c = cbook(payment), id = order.order.orderId;
    const pending = safeSum(-accountBalance(stateValue, p, account('seller_payable', id)), -accountBalance(stateValue, c, account('seller_pending', id)));
    const available = -accountBalance(stateValue, c, account('seller_available', id));
    values.pendingCents = safeSum(values.pendingCents, pending);
    values[sellerRestricted ? 'reservedCents' : 'availableCents'] = safeSum(values[sellerRestricted ? 'reservedCents' : 'availableCents'], available);
    values.withdrawingCents = safeSum(values.withdrawingCents, -accountBalance(stateValue, c, account('seller_withdrawing', id)));
    values.recoveryDueCents = safeSum(values.recoveryDueCents, accountBalance(stateValue, p, account('seller_recovery', id)));
  }
  for (const intent of Object.values(stateValue.intents ?? {})) if (intent.kind === 'PAYOUT' && intent.sellerId === sellerId && intent.confirmed && !intent.returned) values.paidOutCents = safeSum(values.paidOutCents, intent.amountCents);
  return values;
}

// Observation only; never creates a reversal or debits an external bank. A dispute can arrive after payout.
export function reconcileDispute(tx, { paymentIntentId, evidence, policyEvidence }) {
  const payment = getIntent(tx, paymentIntentId, 'PAYMENT'); check(payment.confirmed, 'PAYMENT_UNCONFIRMED');
  fresh(tx, evidence, payment.policy);
  check(evidence.provider === (payment.policy.environment === 'synthetic' ? 'synthetic' : 'stripe') && evidence.livemode === (payment.policy.environment === 'stripe-production') && evidence.accountId === payment.platformAccountId && evidence.chargeId === payment.chargeId && evidence.currency === 'USD' && ['needs_response', 'under_review', 'lost', 'won'].includes(evidence.status), 'DISPUTE_EVIDENCE_MISMATCH');
  identifier(evidence.objectId); cents(evidence.amountCents, { positive: true }); check(evidence.amountCents <= payment.amountCents, 'EXCESS_DISPUTE');
  check(policyEvidence?.approved === true && policyEvidence.orderId === payment.orderId && policyEvidence.policyVersion === payment.policy.version, 'DISPUTE_POLICY_REQUIRED'); identifier(policyEvidence.evidenceRef);
  const sellerRecoveryCents = cents(policyEvidence.sellerRecoveryCents); check(sellerRecoveryCents <= evidence.amountCents, 'EXCESS_SELLER_RECOVERY');
  const prior = state(tx).financeDisputes[evidence.objectId];
  check(!Object.entries(state(tx).financeDisputes).some(([id, value]) => id !== evidence.objectId && value.orderId === payment.orderId), 'MULTIPLE_DISPUTES_REQUIRE_REVIEW');
  const refundedSeller = safeSum(...reservedRefunds(tx, payment).map(refund => refund.allocations.sellerCents));
  check(safeSum(sellerRecoveryCents, refundedSeller) <= payment.allocations.sellerCents, 'EXCESS_SELLER_RECOVERY');
  if (prior) check(prior.orderId === payment.orderId && prior.amountCents === evidence.amountCents && prior.sellerRecoveryCents === sellerRecoveryCents && evidence.observedAt >= prior.observedAt && !(prior.status === 'won' && evidence.status !== 'won'), 'DISPUTE_CONFLICT');
  const bt = balanceTransaction(evidence, -evidence.amountCents, evidence.objectId);
  remember(tx, { ...payment, id: `dispute:${evidence.objectId}` }, evidence);
  const debitHash = digest({ id: bt.id, source: bt.source, amountCents: bt.amountCents, feeCents: bt.feeCents, netCents: bt.netCents, currency: bt.currency });
  if (prior) check(prior.debitHash === debitHash, 'DISPUTE_DEBIT_CHANGED');
  if (!prior) {
    journal(tx, { ...payment, id: `dispute:${evidence.objectId}` }, 'DISPUTE_DEBITED', evidence, [line(pbook(payment), account('seller_recovery', payment.orderId), sellerRecoveryCents), line(pbook(payment), 'dispute_expense', safeSum(evidence.amountCents, -sellerRecoveryCents, bt.feeCents)), line(pbook(payment), 'provider_cash', bt.netCents)]);
  }
  if (evidence.status === 'won' && prior?.status !== 'won') {
    const returned = balanceTransaction({ balanceTransaction: evidence.reinstatementBalanceTransaction }, evidence.amountCents, evidence.objectId);
    check(returned.feeCents === 0, 'UNSUPPORTED_DISPUTE_RETURN_FEE');
    remember(tx, { ...payment, id: `dispute:${evidence.objectId}` }, evidence, 'reinstatementBalanceTransaction');
    // Recovery already collected requires a separately approved refund to the seller; never silently re-transfer.
    const outstanding = accountBalance(tx.state, pbook(payment), account('seller_recovery', payment.orderId));
    check(outstanding >= sellerRecoveryCents, 'DISPUTE_RECOVERY_REQUIRES_REVIEW');
    journal(tx, { ...payment, id: `dispute:${evidence.objectId}` }, 'DISPUTE_REINSTATED', evidence, [line(pbook(payment), 'provider_cash', returned.netCents), line(pbook(payment), account('seller_recovery', payment.orderId), -sellerRecoveryCents), line(pbook(payment), 'dispute_expense', -(evidence.amountCents - sellerRecoveryCents))]);
  }
  state(tx).financeDisputes[evidence.objectId] = { orderId: payment.orderId, amountCents: evidence.amountCents, sellerRecoveryCents, status: evidence.status, observedAt: evidence.observedAt, debitHash, evidenceHash: digest(evidence) };
  getOrder(tx, payment.orderId).blocked = evidence.status !== 'won';
  if (evidence.status === 'won') maybeUnblock(tx, payment);
  return copy(state(tx).financeDisputes[evidence.objectId]);
}

export function bindFinanceObject(tx, intentId, objectId) {
  const intent = getIntent(tx, intentId); identifier(objectId);
  check(intent.dispatchCount === 1 && (!intent.objectId || intent.objectId === objectId), 'UNBOUND_PROVIDER_OBJECT');
  intent.objectId = objectId;
  return copy(intent);
}
export function recordHold(tx, input) {
  const order = getOrder(tx, input.orderId); identifier(input.holdId); identifier(input.reason); identifier(input.evidenceRef); cents(input.amountCents, { positive: true });
  check(input.amountCents <= order.order.sellerNetCents, 'EXCESS_HOLD');
  const holds = state(tx).financeHolds ??= {};
  if (holds[input.holdId]) { check(digest(holds[input.holdId].request) === digest(input), 'HOLD_CONFLICT'); return copy(holds[input.holdId]); }
  holds[input.holdId] = { request: copy(input), orderId: input.orderId, active: true, recordedAt: tx.now };
  order.blocked = true;
  tx.emit?.('FINANCE_HOLD_RECORDED', { orderId: input.orderId, holdId: input.holdId, reason: input.reason });
  return copy(holds[input.holdId]);
}
export function releaseHold(tx, { holdId, evidenceRef }) {
  identifier(holdId); identifier(evidenceRef);
  const hold = state(tx).financeHolds?.[holdId]; check(hold, 'HOLD_NOT_FOUND');
  if (!hold.active) { check(hold.releaseEvidenceRef === evidenceRef, 'HOLD_CONFLICT'); return copy(hold); }
  hold.active = false; hold.releaseEvidenceRef = evidenceRef; hold.releasedAt = tx.now;
  const order = getOrder(tx, hold.orderId); maybeUnblock(tx, getIntent(tx, order.paymentIntentId, 'PAYMENT'));
  return copy(hold);
}
export const recordDispute = reconcileDispute;
