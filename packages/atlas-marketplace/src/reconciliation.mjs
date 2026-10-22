import { financeAssert as check, identifier, digest, copy, safeSum, accountBalance, postJournal, posting, recordProviderTransaction, cashLedgerHash } from './ledger.mjs';
import { recordHold, releaseHold, reconcileDispute } from './finance.mjs';
import { reconcileFinanceIntent } from './payment.mjs';

export function recordFinanceException(tx, { exceptionId, accountId, orderId = null, code, evidenceHash, details = null }) {
  identifier(exceptionId); identifier(accountId); identifier(code);
  check(/^[a-f0-9]{64}$/.test(evidenceHash), 'INVALID_EVIDENCE_HASH');
  const exceptions = tx.state.financeExceptions ??= {}, old = exceptions[exceptionId];
  if (old) {
    check(old.accountId === accountId && old.orderId === orderId && old.code === code, 'FINANCE_EXCEPTION_CONFLICT');
    if (old.status === 'OPEN') { old.latestEvidenceHash = evidenceHash; old.latestDetails = copy(details); old.lastObservedAt = tx.now; return copy(old); }
  }
  const generation = old ? safeSum(old.generation ?? 1, 1) : 1;
  const orders = Object.values(tx.state.financeOrders ?? {}).filter(order => (!orderId || order.order.orderId === orderId) && (order.connectedAccountId === accountId || tx.state.intents[order.paymentIntentId].platformAccountId === accountId));
  const holdIds = [];
  for (const order of orders) {
    if (order.order.sellerNetCents > 0) {
      const holdId = `exception:${digest({ exceptionId, orderId: order.order.orderId, generation })}`;
      recordHold(tx, { orderId: order.order.orderId, holdId, reason: code, evidenceRef: evidenceHash, amountCents: order.order.sellerNetCents }); holdIds.push(holdId);
    } else order.blocked = true;
  }
  exceptions[exceptionId] = { exceptionId, generation, history: old ? [...(old.history ?? []), { generation: old.generation ?? 1, evidenceHash: old.evidenceHash, recordedAt: old.recordedAt, resolvedAt: old.resolvedAt, reviewHash: old.reviewHash }] : [], accountId, orderId, code, evidenceHash, details: copy(details), holdIds, status: 'OPEN', recordedAt: tx.now };
  tx.emit?.('FINANCE_EXCEPTION_OPENED', { exceptionId, accountId, orderId, code });
  return copy(exceptions[exceptionId]);
}
export function resolveFinanceException(tx, { exceptionId, reviewEvidence }) {
  const item = tx.state.financeExceptions?.[identifier(exceptionId)]; check(item, 'FINANCE_EXCEPTION_NOT_FOUND');
  check(reviewEvidence?.approved === true && reviewEvidence.exceptionId === exceptionId, 'FINANCE_EXCEPTION_REVIEW_REQUIRED');
  identifier(reviewEvidence.reviewerId); identifier(reviewEvidence.evidenceRef); identifier(reviewEvidence.policyVersion);
  if (item.status === 'RESOLVED') { check(item.reviewHash === digest(reviewEvidence), 'FINANCE_EXCEPTION_CONFLICT'); return copy(item); }
  item.status = 'RESOLVED'; item.reviewHash = digest(reviewEvidence); item.resolvedAt = tx.now;
  for (const holdId of item.holdIds) releaseHold(tx, { holdId, evidenceRef: reviewEvidence.evidenceRef });
  return copy(item);
}
function evidenceScope(tx, evidence, { accountId, maxEvidenceAgeMs, expectedLivemode = false }) {
  check(evidence && ['stripe', 'synthetic'].includes(evidence.provider) && evidence.accountId === accountId && typeof expectedLivemode === 'boolean' && evidence.livemode === expectedLivemode && (!expectedLivemode || evidence.provider === 'stripe') && evidence.currency === 'USD', 'ACCOUNT_RECONCILIATION_SCOPE_MISMATCH');
  check(Number.isSafeInteger(maxEvidenceAgeMs) && maxEvidenceAgeMs > 0 && maxEvidenceAgeMs <= 300000 && Number.isSafeInteger(evidence.observedAt) && evidence.observedAt <= tx.now && tx.now - evidence.observedAt <= maxEvidenceAgeMs, 'STALE_PROVIDER_EVIDENCE');
}
function binding(state, accountId, platformAccountId) {
  identifier(accountId); identifier(platformAccountId);
  check(accountId === platformAccountId || Object.values(state.financeOrders ?? {}).some(order => order.connectedAccountId === accountId && state.intents[order.paymentIntentId].platformAccountId === platformAccountId), 'ACCOUNT_RECONCILIATION_SCOPE_MISMATCH');
  return `${accountId === platformAccountId ? 'platform' : 'connected'}:${accountId}`;
}
// Opening and external cash belong to suspense/equity, never a seller earnings account.
// The trusted caller must obtain evidence through the provider and a separate staff review.
export function recordAccountAdjustment(tx, input) {
  const { adjustmentId, accountId, platformAccountId, kind, evidence, approval, maxEvidenceAgeMs, expectedLivemode = false } = input;
  identifier(adjustmentId); const book = binding(tx.state, accountId, platformAccountId);
  check(['OPENING', 'EXTERNAL'].includes(kind), 'INVALID_ACCOUNT_ADJUSTMENT');
  evidenceScope(tx, evidence, input);
  check(approval?.approved === true && approval.accountId === accountId && approval.kind === kind, 'ACCOUNT_ADJUSTMENT_REVIEW_REQUIRED');
  check(!expectedLivemode || approval.livemode === true, 'ACCOUNT_ADJUSTMENT_REVIEW_REQUIRED');
  identifier(approval.reviewerId); identifier(approval.evidenceRef); identifier(approval.policyVersion);
  const adjustments = tx.state.financeAdjustments ??= {}, old = adjustments[adjustmentId];
  if (old) { check(old.inputHash === digest(input), 'ACCOUNT_ADJUSTMENT_CONFLICT'); return copy(old); }
  const openings = tx.state.financeOpenings ??= {};
  let amountCents, counterAccount;
  if (kind === 'OPENING') {
    check(!openings[accountId] && !(tx.state.journals ?? []).some(entry => entry.lines.some(line => line.book === book && line.account === 'provider_cash')), 'OPENING_ALREADY_ESTABLISHED');
    check(approval.quiescent === true && Number.isSafeInteger(evidence.cutoffMs) && evidence.cutoffMs >= 0 && evidence.cutoffMs % 1000 === 0 && evidence.cutoffMs <= evidence.observedAt && evidence.observedAt - evidence.cutoffMs < 1000, 'OPENING_CUTOFF_UNPROVEN');
    check(Array.isArray(evidence.unsupported) && evidence.unsupported.length === 0 && Number.isSafeInteger(evidence.availableCents) && Number.isSafeInteger(evidence.pendingCents) && evidence.totalCents === safeSum(evidence.availableCents, evidence.pendingCents), 'OPENING_BALANCE_UNPROVEN');
    amountCents = evidence.totalCents; counterAccount = 'opening_equity';
    openings[accountId] = { adjustmentId, book, accountId, platformAccountId, amountCents, provider: evidence.provider, livemode: expectedLivemode, cutoffMs: evidence.cutoffMs, evidenceHash: digest(evidence), approvalHash: digest(approval) };
  } else {
    check(openings[accountId]?.platformAccountId === platformAccountId && openings[accountId].livemode === expectedLivemode && openings[accountId].provider === evidence.provider, 'OPENING_REQUIRED');
    const transaction = evidence.transaction;
    check(transaction && Number.isSafeInteger(transaction.createdAt) && transaction.createdAt >= openings[accountId].cutoffMs, 'EXTERNAL_TRANSACTION_UNPROVEN');
    recordProviderTransaction(tx, { accountId, transaction, owner: `adjustment:${adjustmentId}`, observedAt: evidence.observedAt, livemode: expectedLivemode });
    amountCents = transaction.netCents; counterAccount = 'external_suspense';
  }
  if (amountCents !== 0) postJournal(tx, { id: `adjustment:${adjustmentId}`, intentId: `adjustment:${adjustmentId}`, kind: `ACCOUNT_${kind}`, evidenceHash: digest(evidence), lines: [posting(book, 'provider_cash', amountCents), posting(book, counterAccount, -amountCents)] });
  adjustments[adjustmentId] = { adjustmentId, accountId, kind, amountCents, inputHash: digest(input), evidenceHash: digest(evidence), approvalHash: digest(approval), recordedAt: tx.now };
  return copy(adjustments[adjustmentId]);
}
export function recordAccountReport(tx, { reportId, accountId, platformAccountId, before, after, inventory, maxEvidenceAgeMs, expectedLivemode = false }) {
  identifier(reportId); const book = binding(tx.state, accountId, platformAccountId);
  for (const evidence of [before, after, inventory]) { evidenceScope(tx, evidence, { accountId, maxEvidenceAgeMs, expectedLivemode }); check(evidence.provider === before.provider, 'ACCOUNT_RECONCILIATION_SCOPE_MISMATCH'); }
  const opening = tx.state.financeOpenings?.[accountId], exceptions = [];
  const issue = (code, details = null) => exceptions.push({ code, details });
  if (!opening) issue('OPENING_REQUIRED');
  else check(opening.livemode === expectedLivemode && opening.provider === before.provider, 'ACCOUNT_RECONCILIATION_SCOPE_MISMATCH');
  if (!inventory.complete) issue('TRANSACTION_INVENTORY_INCOMPLETE');
  if (opening && inventory.fromMs !== opening.cutoffMs) issue('TRANSACTION_WINDOW_MISMATCH');
  if (!Number.isSafeInteger(inventory.toMs) || inventory.toMs <= after.observedAt || !Array.isArray(inventory.transactions)) issue('TRANSACTION_WINDOW_MISMATCH');
  const balanceShape = value => ({ availableCents: value.availableCents, pendingCents: value.pendingCents, totalCents: value.totalCents, unsupported: value.unsupported });
  for (const evidence of [before, after]) {
    check(Number.isSafeInteger(evidence.availableCents) && Number.isSafeInteger(evidence.pendingCents) && evidence.totalCents === safeSum(evidence.availableCents, evidence.pendingCents) && Array.isArray(evidence.unsupported), 'INVALID_PROVIDER_BALANCE');
    if (evidence.unsupported.length) issue('UNSUPPORTED_BALANCE_COMPONENTS', evidence.unsupported);
  }
  if (digest(balanceShape(before)) !== digest(balanceShape(after))) issue('BALANCE_CHANGED_DURING_RECONCILIATION');
  const known = Object.values(tx.state.financeBalanceTransactions ?? {}).filter(value => value.accountId === accountId && value.livemode === expectedLivemode), seen = new Set();
  let observedNet = 0;
  for (const value of inventory.transactions ?? []) {
    identifier(value.id); check(!seen.has(value.id), 'DUPLICATE_PROVIDER_TRANSACTION'); seen.add(value.id);
    check(value.currency === 'USD' && Number.isSafeInteger(value.netCents) && Number.isSafeInteger(value.createdAt) && value.createdAt >= inventory.fromMs && value.createdAt < inventory.toMs, 'TRANSACTION_WINDOW_MISMATCH');
    observedNet = safeSum(observedNet, value.netCents);
    const expected = known.find(row => row.id === value.id);
    if (!expected) issue('UNACCOUNTED_PROVIDER_TRANSACTION', { transactionId: value.id, source: value.source, netCents: value.netCents });
    else if (['source', 'currency', 'amountCents', 'feeCents', 'netCents'].some(key => expected[key] !== value[key])) issue('PROVIDER_TRANSACTION_CHANGED', { transactionId: value.id });
  }
  for (const value of known) if (!seen.has(value.id)) issue('ACCOUNTED_TRANSACTION_MISSING', { transactionId: value.id });
  const ledgerCashCents = accountBalance(tx.state, book, 'provider_cash');
  const differenceCents = safeSum(after.totalCents, -ledgerCashCents);
  if (differenceCents !== 0) issue('PROVIDER_LEDGER_DIFFERENCE', { differenceCents });
  if (opening && safeSum(opening.amountCents, observedNet) !== after.totalCents) issue('OPENING_ROLLFORWARD_DIFFERENCE');
  const pendingIntents = Object.values(tx.state.intents ?? {}).filter(intent => (intent.accountId === accountId || intent.connectedAccountId === accountId) && ['DISPATCHING', 'UNKNOWN', 'PENDING'].includes(intent.status)).map(intent => ({ intentId: intent.id, kind: intent.kind, status: intent.status }));
  for (const intent of pendingIntents) if (intent.status !== 'PENDING') issue('UNRESOLVED_FINANCIAL_INTENT', intent);
  for (const item of Object.values(tx.state.financeExceptions ?? {})) if (item.accountId === accountId && item.status === 'OPEN') issue('OPEN_OPERATIONAL_EXCEPTION', { exceptionId: item.exceptionId, code: item.code });
  const sequence = safeSum(Object.values(tx.state.financeReconciliationReports ?? {}).reduce((maximum, report) => Math.max(maximum, report.sequence ?? 0), 0), 1);
  const result = { reportId, sequence, provider: after.provider, observedAt: after.observedAt, cashLedgerHash: cashLedgerHash(tx.state, book), accountId, platformAccountId, livemode: expectedLivemode, currency: 'USD', status: exceptions.length ? 'EXCEPTIONS' : 'RECONCILED', ledgerCashCents, providerAvailableCents: after.availableCents, providerPendingCents: after.pendingCents, providerTotalCents: after.totalCents, differenceCents, transactionCount: seen.size, pendingIntents, exceptions, evidenceHash: digest({ before, after, inventory }), recordedAt: tx.now };
  const reports = tx.state.financeReconciliationReports ??= {};
  if (reports[reportId]) check(digest(reports[reportId]) === digest(result), 'RECONCILIATION_REPORT_CONFLICT'); else reports[reportId] = result;
  if (exceptions.length) recordFinanceException(tx, { exceptionId: `reconciliation:${reportId}`, accountId, code: 'ACCOUNT_RECONCILIATION_REVIEW', evidenceHash: result.evidenceHash, details: exceptions });
  return copy(result);
}
export async function reconcileAccount({ store, provider, accountId, platformAccountId, reportId, maxEvidenceAgeMs, enabled = false }) {
  check(enabled === true && provider?.getAccountSnapshot && provider?.listBalanceTransactions, 'ACCOUNT_RECONCILIATION_DISABLED');
  identifier(reportId); identifier(accountId); identifier(platformAccountId);
  const opening = await store.read(state => state.financeOpenings?.[accountId]);
  try {
    const identity = provider.getIdentity ? await provider.getIdentity() : { livemode: false, platformAccountId };
    check(identity.platformAccountId === platformAccountId && typeof identity.livemode === 'boolean', 'ACCOUNT_RECONCILIATION_SCOPE_MISMATCH');
    const expectedLivemode = identity.livemode;
    const before = await provider.getAccountSnapshot(accountId);
    const inventory = await provider.listBalanceTransactions({ accountId, fromMs: opening?.cutoffMs ?? 0, toMs: Math.floor(before.observedAt / 1000) * 1000 + 1000 });
    const after = await provider.getAccountSnapshot(accountId);
    return await store.transaction(tx => recordAccountReport(tx, { reportId, accountId, platformAccountId, before, after, inventory, maxEvidenceAgeMs, expectedLivemode }));
  } catch (error) {
    const code = /^[A-Z0-9_]{1,100}$/.test(error.code ?? '') ? error.code : 'PROVIDER_RECONCILIATION_ERROR';
    return store.transaction(tx => {
      recordFinanceException(tx, { exceptionId: `reconciliation-unavailable:${reportId}`, accountId, code, evidenceHash: digest({ accountId, platformAccountId, reportId, code }) });
      const result = { reportId, accountId, platformAccountId, status: 'UNAVAILABLE', code, recordedAt: tx.now };
      (tx.state.financeReconciliationFailures ??= {})[reportId] = result;
      return copy(result);
    });
  }
}
// No POST, even for unknown original IDs. Discovery is metadata-bound and must be complete.
export async function reconcilePendingFinance({ store, provider, intentIds, limit = 100, enabled = false }) {
  check(enabled === true && Number.isSafeInteger(limit) && limit > 0 && limit <= 500, 'FINANCE_RECOVERY_DISABLED');
  const intents = await store.read(state => Object.values(state.intents ?? {}).filter(intent => (intentIds ? intentIds.includes(intent.id) && intent.dispatchCount === 1 : ['DISPATCHING', 'UNKNOWN', 'PENDING'].includes(intent.status) || intent.kind === 'TRANSFER' && intent.confirmed && !intent.available)).slice(0, limit));
  const results = [];
  for (const intent of intents) {
    try {
      let objectId = intent.objectId;
      if (!objectId && provider.discover) { const found = await provider.discover(intent); check(found?.complete === true, 'PROVIDER_DISCOVERY_INCOMPLETE'); objectId = found.objectId; }
      check(objectId || intent.policy.environment === 'synthetic', 'PROVIDER_RESULT_UNKNOWN');
      const result = await reconcileFinanceIntent({ store, provider, intentId: intent.id, ...(objectId ? { objectId } : {}) });
      results.push({ intentId: intent.id, status: result.status });
    } catch (error) {
      const code = /^[A-Z0-9_]{1,100}$/.test(error.code ?? '') ? error.code : 'PROVIDER_RECONCILIATION_ERROR';
      await store.transaction(tx => recordFinanceException(tx, { exceptionId: `recovery:${intent.id}:${code}`, accountId: intent.accountId, orderId: intent.orderId, code, evidenceHash: digest({ intentId: intent.id, code }) }));
      results.push({ intentId: intent.id, status: 'REVIEW_REQUIRED', code });
    }
  }
  return results;
}
export async function reconcileProviderDispute({ store, provider, paymentIntentId, objectId, resolveDisputePolicy }) {
  const payment = await store.read(state => state.intents[paymentIntentId]); check(payment?.kind === 'PAYMENT', 'PAYMENT_UNCONFIRMED');
  const evidence = await provider.retrieveDispute(payment, { objectId });
  const policyEvidence = typeof resolveDisputePolicy === 'function' ? await resolveDisputePolicy({ payment: copy(payment), evidence: copy(evidence) }) : null;
  if (!policyEvidence || !evidence.balanceTransaction || !['needs_response', 'under_review', 'lost', 'won'].includes(evidence.status)) {
    await store.transaction(tx => recordFinanceException(tx, { exceptionId: `dispute-review:${objectId}`, accountId: payment.accountId, orderId: payment.orderId, code: 'DISPUTE_REVIEW_REQUIRED', evidenceHash: digest(evidence), details: { objectId, status: evidence.status, amountCents: evidence.amountCents } }));
    return { status: 'REVIEW_REQUIRED', objectId };
  }
  return store.transaction(tx => reconcileDispute(tx, { paymentIntentId, evidence, policyEvidence }));
}
