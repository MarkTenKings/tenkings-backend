import { financeAssert as check, integerCents as cents, digest, copy, safeSum, identifier } from './ledger.mjs';

export const SYNTHETIC_FINANCE_POLICY = Object.freeze({ version: 'synthetic-policy-v1', environment: 'synthetic', approvalRef: 'fixture-only-not-owner-approval', authorityRef: 'fixture-authority', feeTermsRef: 'fixture-fees', refundTermsRef: 'fixture-refunds', transferTermsRef: 'fixture-release', payoutTermsRef: 'fixture-payouts', returnsTermsRef: 'fixture-returns', reserveTermsRef: 'fixture-reserves', disputeTermsRef: 'fixture-disputes', maxEvidenceAgeMs: 60000 });
export function syntheticAccount(accountId, observedAt, externalAccountId = 'ba_synthetic') {
  return { accountId, livemode: false, observedAt, transfersActive: true, payoutsEnabled: true, manualPayouts: true, requirementsSatisfied: true, verifiedExternalAccountIds: [externalAccountId] };
}
function syntheticState(tx) { return tx.state.syntheticProvider ??= { environment: 'SYNTHETIC_LOCAL', accounts: {}, objects: {}, intentObjects: {}, calls: {}, faults: {} }; }
function transaction(id, amountCents, source, at, status = 'available', feeCents = 0) {
  return { id, source, currency: 'USD', amountCents, feeCents, netCents: safeSum(amountCents, -feeCents), status, availableOn: at };
}
// An explicitly synthetic, durable simulator. No network or Stripe credentials exist here.
export function createSyntheticProvider({ store, clock = Date.now, enabled = false } = {}) {
  check(enabled === true && store, 'SYNTHETIC_PROVIDER_DISABLED');
  return {
    configureAccount({ accountId, availableCents = 0, ...overrides }) {
      identifier(accountId); cents(availableCents);
      return store.transaction(tx => {
        const state = syntheticState(tx); const prior = state.accounts[accountId];
        state.accounts[accountId] = { ...syntheticAccount(accountId, tx.now), ...prior, ...copy(overrides), accountId, availableCents: prior?.availableCents ?? availableCents, livemode: false };
        return state.accounts[accountId];
      });
    },
    async getAccount(accountId) {
      const account = store.read(state => state.syntheticProvider?.accounts[accountId]); check(account, 'SYNTHETIC_ACCOUNT_MISSING');
      const { availableCents, ...evidence } = account; return { ...evidence, observedAt: clock() };
    },
    async getBalance(accountId) {
      const account = store.read(state => state.syntheticProvider?.accounts[accountId]); check(account, 'SYNTHETIC_ACCOUNT_MISSING');
      return { accountId, currency: 'USD', availableCents: account.availableCents, observedAt: clock(), livemode: false };
    },
    failNextCreateAfterCommit(intentId) {
      return store.transaction(tx => { syntheticState(tx).faults[intentId] = true; return true; });
    },
    async create(intent) {
      check(intent.policy.environment === 'synthetic' && intent.status === 'DISPATCHING', 'SYNTHETIC_INTENT_REQUIRED');
      const result = store.transaction(tx => {
        const state = syntheticState(tx); check(state.accounts[intent.accountId], 'SYNTHETIC_ACCOUNT_MISSING');
        state.calls[intent.id] = safeSum(state.calls[intent.id] ?? 0, 1);
        const oldId = state.intentObjects[intent.id];
        if (oldId) { check(state.objects[oldId].requestHash === intent.requestHash, 'SYNTHETIC_IDEMPOTENCY_CONFLICT'); return { objectId: oldId, fault: false }; }
        const objectId = `${({ PAYMENT: 'pi', TRANSFER: 'tr', REFUND: 're', REVERSAL: 'trr', PAYOUT: 'po' })[intent.kind]}_synthetic_${digest(intent.id).slice(0, 20)}`;
        const evidence = { provider: 'synthetic', accountId: intent.accountId, livemode: false, kind: intent.kind, objectId, intentId: intent.id, orderId: intent.orderId, bindingHash: intent.bindingHash, currency: 'USD', amountCents: intent.amountCents, status: 'pending', observedAt: tx.now, parentObjectId: intent.parentObjectId ?? null, destinationAccountId: intent.kind === 'TRANSFER' ? intent.connectedAccountId : null, externalAccountId: intent.externalAccountId ?? null };
        state.objects[objectId] = { requestHash: intent.requestHash, intent: copy(intent), evidence, applied: false, returned: false };
        state.intentObjects[intent.id] = objectId;
        const fault = state.faults[intent.id] === true; delete state.faults[intent.id];
        return { objectId, fault };
      });
      if (result.fault) { const error = new Error('Synthetic response lost after provider committed'); error.code = 'SYNTHETIC_RESPONSE_LOST'; throw error; }
      return { objectId: result.objectId };
    },
    async retrieve(intent, { objectId } = {}) {
      const evidence = store.read(state => {
        const provider = state.syntheticProvider; const id = objectId ?? provider?.intentObjects[intent.id];
        return provider?.objects[id]?.evidence ?? null;
      });
      return evidence ? { ...evidence, observedAt: clock() } : null;
    },
    resolve(intentId, { status, settlement = 'available', processingFeeCents = 0 } = {}) {
      cents(processingFeeCents);
      return store.transaction(tx => {
        const state = syntheticState(tx); const object = state.objects[state.intentObjects[intentId]]; check(object, 'SYNTHETIC_OBJECT_MISSING');
        const intent = object.intent, e = object.evidence, at = tx.now;
        e.status = status; e.observedAt = at;
        const change = (accountId, amount) => { const account = state.accounts[accountId]; check(account, 'SYNTHETIC_ACCOUNT_MISSING'); account.availableCents = safeSum(account.availableCents, amount); check(account.availableCents >= 0, 'SYNTHETIC_INSUFFICIENT_FUNDS'); };
        if (status === 'succeeded' && intent.kind === 'PAYMENT') {
          e.chargeId = `ch_${e.objectId}`; e.chargePaid = true; e.chargeCapturedCents = intent.amountCents; e.chargeAmountCents = intent.amountCents; e.chargeCurrency = 'USD'; e.amountReceivedCents = intent.amountCents;
          e.balanceTransaction = transaction(`txn_${e.objectId}`, intent.amountCents, e.chargeId, at, settlement, processingFeeCents);
          if (!object.applied) change(intent.platformAccountId, e.balanceTransaction.netCents);
          object.applied = true;
        } else if (status === 'canceled' && intent.kind === 'PAYMENT') {
          check(!object.applied, 'SYNTHETIC_TERMINAL_CONTRADICTION');
          e.amountReceivedCents = 0; e.chargePaid = false; e.chargeCapturedCents = 0;
        } else if (status === 'succeeded' && intent.kind === 'TRANSFER') {
          e.destinationPaymentId = `py_${e.objectId}`;
          e.balanceTransaction = transaction(`txn_${e.objectId}`, -intent.amountCents, e.objectId, at);
          e.connectedBalanceTransaction = transaction(`txn_connected_${e.objectId}`, intent.amountCents, e.destinationPaymentId, at, settlement);
          if (!object.applied) { change(intent.platformAccountId, -intent.amountCents); change(intent.connectedAccountId, intent.amountCents); }
          object.applied = true;
        } else if (status === 'succeeded' && intent.kind === 'REFUND') {
          e.balanceTransaction = transaction(`txn_${e.objectId}`, -intent.amountCents, e.objectId, at);
          if (!object.applied) change(intent.platformAccountId, -intent.amountCents);
          object.applied = true;
        } else if (status === 'succeeded' && intent.kind === 'REVERSAL') {
          e.destinationPaymentRefundId = `pyr_${e.objectId}`;
          e.balanceTransaction = transaction(`txn_${e.objectId}`, intent.amountCents, e.objectId, at);
          e.connectedBalanceTransaction = transaction(`txn_connected_${e.objectId}`, -intent.amountCents, e.destinationPaymentRefundId, at);
          if (!object.applied) { change(intent.connectedAccountId, -intent.amountCents); change(intent.platformAccountId, intent.amountCents); }
          object.applied = true;
        } else if (intent.kind === 'PAYOUT' && ['pending', 'in_transit', 'paid', 'failed', 'canceled'].includes(status)) {
          e.balanceTransaction = transaction(`txn_${e.objectId}`, -intent.amountCents, e.objectId, at);
          if (!object.applied) change(intent.connectedAccountId, -intent.amountCents);
          object.applied = true;
          if (['failed', 'canceled'].includes(status)) {
            e.failureBalanceTransaction = transaction(`txn_return_${e.objectId}`, intent.amountCents, e.objectId, at);
            if (!object.returned) change(intent.connectedAccountId, intent.amountCents);
            object.returned = true;
          }
        } else if (['REFUND', 'REVERSAL'].includes(intent.kind) && ['failed', 'canceled'].includes(status)) {
          check(!object.applied, 'SYNTHETIC_TERMINAL_CONTRADICTION'); e.failureConfirmed = true;
        }
        return copy(e);
      });
    },
  };
}
