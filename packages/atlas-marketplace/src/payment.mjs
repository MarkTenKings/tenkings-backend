import { financeAssert as check, copy } from './ledger.mjs';
import { isAsyncFunction } from 'node:util/types';
import { requireOperationalReady } from './finance-scheduler.mjs';
import { claimDispatch, markFinanceUnknown, bindFinanceObject, reconcileFinance } from './finance.mjs';

// These are the only wrappers that perform provider I/O. The durable claim commits before create.
// After ANY create exception, even a validation-looking response, this intent is reconcile-only.
export async function executeFinanceIntent({ store, provider, intentId, enabled = false, assertDispatchReady, assertInstantPayoutReady, assertPaymentReady }) {
  check(enabled === true && provider && typeof provider.create === 'function', 'FINANCE_DISABLED');
  check(assertDispatchReady === undefined || (typeof assertDispatchReady === 'function' && !isAsyncFunction(assertDispatchReady)), 'FINANCE_DISPATCH_UNQUALIFIED');
  const prepared = await store.read(state => copy(state.intents[intentId])); check(prepared, 'INTENT_NOT_FOUND');
  check(prepared.status === 'PREPARED', 'RECONCILIATION_REQUIRED');
  const instantReady = () => { if (prepared.method === 'instant') { check(typeof assertInstantPayoutReady === 'function', 'INSTANT_PAYOUT_UNQUALIFIED'); requireOperationalReady(assertInstantPayoutReady, { policyHash: prepared.instantQuote.policyHash, environment: prepared.instantPolicy.environment, platformAccountId: prepared.platformAccountId }); } };
  instantReady();
  const instant = prepared.method === 'instant' ? await provider.getInstantPayoutEligibility(prepared.connectedAccountId, { externalAccountId: prepared.externalAccountId }) : null;
  const account = ['TRANSFER', 'REVERSAL', 'PAYOUT'].includes(prepared.kind) ? await provider.getAccount(prepared.connectedAccountId) : null;
  const balance = prepared.kind === 'PAYOUT' ? await provider.getBalance(prepared.connectedAccountId) : null;
  const intent = await store.transaction(tx => {
    // Recheck current authority after awaited reads, atomically with the durable
    // dispatch claim. Recovery GETs deliberately do not invoke a create gate.
    if (assertDispatchReady !== undefined) {
      const result = assertDispatchReady(tx, tx.state.intents[intentId]);
      if (result && typeof result.then === 'function') void Promise.resolve(result).catch(() => {});
      check(result === true, 'FINANCE_DISPATCH_UNQUALIFIED');
    }
    instantReady();
    if(prepared.kind==='PAYMENT'&&assertPaymentReady){const result=assertPaymentReady(tx,tx.state.intents[intentId]);if(result&&typeof result.then==='function')void Promise.resolve(result).catch(()=>{});check(result===true,'PAYMENT_CHECKOUT_UNAVAILABLE');}
    return claimDispatch(tx, intentId, account, balance, instant);
  });
  try {
    const result = await provider.create(intent);
    check(result && typeof result.objectId === 'string', 'PROVIDER_RESULT_UNKNOWN');
    await store.transaction(tx => bindFinanceObject(tx, intentId, result.objectId));
    return await reconcileFinanceIntent({ store, provider, intentId });
  } catch (error) {
    await store.transaction(tx => markFinanceUnknown(tx, intentId));
    throw error;
  }
}
export async function reconcileFinanceIntent({ store, provider, intentId, objectId }) {
  const intent = await store.read(state => copy(state.intents[intentId])); check(intent, 'INTENT_NOT_FOUND');
  const evidence = await provider.retrieve(intent, { objectId: objectId ?? intent.objectId });
  check(evidence, 'PROVIDER_RESULT_UNKNOWN');
  return store.transaction(tx => reconcileFinance(tx, { intentId, evidence }));
}

// The caller must authenticate buyerId. This response is a transient, private capability:
// no logging, database persistence, analytics, caching or third-party redirects.
export async function getPaymentCollection({ store, provider, intentId, buyerId, reservationId, enabled = false }) {
  check(enabled === true && typeof provider?.getPaymentCollection === 'function', 'PAYMENT_COLLECTION_DISABLED');
  const intent = await store.read(state => copy(state.intents[intentId]));
  check(intent?.kind === 'PAYMENT' && intent.order.buyerId === buyerId && intent.order.reservationId === reservationId, 'PAYMENT_COLLECTION_SCOPE_MISMATCH');
  check(intent.dispatchCount === 1 && intent.objectId && !intent.confirmed && !intent.terminalUnpaid && ['PENDING', 'UNKNOWN', 'DISPATCHING'].includes(intent.status), 'PAYMENT_NOT_COLLECTIBLE');
  const collection = await provider.getPaymentCollection(intent);
  return { ...collection, intentId: intent.id, reservationId: intent.order.reservationId };
}
