import { requireValue } from './contract.mjs';

const capabilities = new WeakMap();
function ready(record) {
  const result = record.assertRuntimeReady(record.binding);
  if (result && typeof result.then === 'function') {
    void Promise.resolve(result).catch(() => {});
    requireValue(false, 'RECOVERY_SETTLEMENT_UNAVAILABLE');
  }
  requireValue(result === true && record.store.read === record.read && record.store.transaction === record.transaction, 'RECOVERY_SETTLEMENT_UNAVAILABLE');
}

// Server composition only: no request, persisted JSON or STAFF-shaped object can
// reconstruct this capability. References bind an independently checked approval;
// their presence does not establish authority. It can settle only retained facts.
export function createRecoverySettlementCapability({ enabled = false, store, environment, platformAccountId, approvalRef, assertRuntimeReady } = {}) {
  requireValue(enabled === true, 'RECOVERY_SETTLEMENT_DISABLED');
  requireValue(store && typeof store.read === 'function' && typeof store.transaction === 'function', 'RECOVERY_SETTLEMENT_STORE_REQUIRED');
  requireValue(['SYNTHETIC_LOCAL', 'PROVIDER_SANDBOX', 'PRODUCTION'].includes(environment) && typeof platformAccountId === 'string' && (environment === 'SYNTHETIC_LOCAL' ? /^demo_[A-Za-z0-9_-]+$/ : /^acct_[A-Za-z0-9]+$/).test(platformAccountId), 'RECOVERY_SETTLEMENT_SCOPE_REQUIRED');
  requireValue(typeof approvalRef === 'string' && approvalRef.trim() === approvalRef && approvalRef.length > 0 && approvalRef.length <= 500 && typeof assertRuntimeReady === 'function', 'RECOVERY_SETTLEMENT_APPROVAL_REQUIRED');
  const binding = Object.freeze({ environment, platformAccountId, approvalRef, operation: 'SETTLE_RECONCILED_ORIGINAL_PAYMENTS' });
  const record = { store, read: store.read, transaction: store.transaction, binding, assertRuntimeReady };
  ready(record);
  const capability = Object.freeze({});
  capabilities.set(capability, record);
  return capability;
}

export function assertRecoverySettlementCapability(capability, { store, environment, platformAccountId }) {
  const record = capabilities.get(capability);
  requireValue(record && record.store === store && record.binding.environment === environment && record.binding.platformAccountId === platformAccountId, 'RECOVERY_SETTLEMENT_UNAVAILABLE');
  ready(record);
}
