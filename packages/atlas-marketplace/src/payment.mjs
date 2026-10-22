import { financeAssert as check, copy } from './ledger.mjs';
import { claimDispatch, markFinanceUnknown, bindFinanceObject, reconcileFinance } from './finance.mjs';

// These are the only wrappers that perform provider I/O. The durable claim commits before create.
// After ANY create exception, even a validation-looking response, this intent is reconcile-only.
export async function executeFinanceIntent({ store, provider, intentId, enabled = false }) {
  check(enabled === true && provider && typeof provider.create === 'function', 'FINANCE_DISABLED');
  const prepared = store.read(state => copy(state.intents[intentId])); check(prepared, 'INTENT_NOT_FOUND');
  check(prepared.status === 'PREPARED', 'RECONCILIATION_REQUIRED');
  const account = ['TRANSFER', 'REVERSAL', 'PAYOUT'].includes(prepared.kind) ? await provider.getAccount(prepared.connectedAccountId) : null;
  const balance = prepared.kind === 'PAYOUT' ? await provider.getBalance(prepared.connectedAccountId) : null;
  const intent = store.transaction(tx => claimDispatch(tx, intentId, account, balance));
  try {
    const result = await provider.create(intent);
    check(result && typeof result.objectId === 'string', 'PROVIDER_RESULT_UNKNOWN');
    store.transaction(tx => bindFinanceObject(tx, intentId, result.objectId));
    return await reconcileFinanceIntent({ store, provider, intentId });
  } catch (error) {
    store.transaction(tx => markFinanceUnknown(tx, intentId));
    throw error;
  }
}
export async function reconcileFinanceIntent({ store, provider, intentId, objectId }) {
  const intent = store.read(state => copy(state.intents[intentId])); check(intent, 'INTENT_NOT_FOUND');
  const evidence = await provider.retrieve(intent, { objectId: objectId ?? intent.objectId });
  check(evidence, 'PROVIDER_RESULT_UNKNOWN');
  return store.transaction(tx => reconcileFinance(tx, { intentId, evidence }));
}
