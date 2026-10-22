import { randomUUID } from 'node:crypto';
import { financeAssert as check, identifier, digest, copy } from './ledger.mjs';
import { reconcileFinanceIntent } from './payment.mjs';
import { reconcileAccount, recordFinanceException } from './reconciliation.mjs';

const ENVIRONMENTS = { SYNTHETIC_LOCAL: 'synthetic', PROVIDER_SANDBOX: 'stripe-sandbox', PRODUCTION: 'stripe-production' };
const codeFor = error => /^[A-Z0-9_]{1,100}$/.test(error?.code ?? '') ? error.code : 'PROVIDER_RECOVERY_ERROR';
function configuration(value) {
  const keys = ['environment','platformAccountId','connectedAccountIds','approvalRef','maxItems','concurrency','maxEvidenceAgeMs','maxDurationMs'];
  check(value && Object.keys(value).sort().join(',') === keys.sort().join(','), 'RECOVERY_CONFIG_REQUIRED');
  check(Object.hasOwn(ENVIRONMENTS, value.environment), 'RECOVERY_CONFIG_REQUIRED');
  identifier(value.platformAccountId); identifier(value.approvalRef);
  check(Array.isArray(value.connectedAccountIds) && value.connectedAccountIds.length > 0 && value.connectedAccountIds.length <= 32 && new Set(value.connectedAccountIds).size === value.connectedAccountIds.length, 'RECOVERY_ACCOUNT_SCOPE_REQUIRED');
  for (const id of value.connectedAccountIds) { identifier(id); check(id !== value.platformAccountId, 'RECOVERY_ACCOUNT_SCOPE_REQUIRED'); }
  for (const [key, min, max] of [['maxItems',1,500],['concurrency',1,8],['maxEvidenceAgeMs',1,300000],['maxDurationMs',1000,300000]]) check(Number.isSafeInteger(value[key]) && value[key] >= min && value[key] <= max, 'RECOVERY_BOUNDS_REQUIRED');
  check(value.concurrency <= value.maxItems, 'RECOVERY_BOUNDS_REQUIRED');
  return Object.freeze({ ...copy(value), connectedAccountIds: Object.freeze([...value.connectedAccountIds].sort()) });
}
function inScope(intent, config) {
  return intent.policy?.environment === ENVIRONMENTS[config.environment] && intent.platformAccountId === config.platformAccountId && config.connectedAccountIds.includes(intent.connectedAccountId) &&
    [config.platformAccountId, intent.connectedAccountId].includes(intent.accountId);
}
function needsSettlement(state, intent) {
  return intent.kind === 'PAYMENT' && (intent.confirmed && intent.status === 'SUCCEEDED' && state.orders?.[intent.orderId]?.paymentIntentId !== intent.id ||
    intent.terminalUnpaid === true && intent.status === 'CANCELED' && state.reservations?.[intent.order?.reservationId]?.status !== 'RELEASED');
}
function candidates(state, config) {
  return Object.values(state.intents ?? {}).filter(intent => inScope(intent, config) && intent.dispatchCount === 1 &&
    (['DISPATCHING','DISPATCHED','UNKNOWN','PENDING'].includes(intent.status) || intent.kind === 'TRANSFER' && intent.confirmed && !intent.available || needsSettlement(state, intent)))
    .sort((a,b) => (state.financeRecoveryAttempts?.[a.id] ?? 0) - (state.financeRecoveryAttempts?.[b.id] ?? 0) || a.id.localeCompare(b.id));
}

// Server composition only. No scheduler is registered and no provider create,
// confirmation, onboarding, adjustment or exception-resolution port is retained.
export function createFinanceRecoveryRunner({ enabled = false, store, provider, config: suppliedConfig, assertRuntimeReady } = {}) {
  if (enabled !== true) return Object.freeze({ run: async () => { check(false, 'FINANCE_RECOVERY_DISABLED'); } });
  const config = configuration(suppliedConfig), configHash = digest(config);
  check(typeof store?.read === 'function' && typeof store?.transaction === 'function' && typeof assertRuntimeReady === 'function', 'RECOVERY_RUNTIME_REQUIRED');
  for (const key of ['getIdentity','retrieve','discover','getAccountSnapshot','listBalanceTransactions']) check(typeof provider?.[key] === 'function', 'RECOVERY_PROVIDER_REQUIRED');
  const scope = digest({ environment: config.environment, platformAccountId: config.platformAccountId });
  const readProvider = Object.freeze({
    async getIdentity() {
      const identity = await provider.getIdentity();
      check(identity?.provider === (config.environment === 'SYNTHETIC_LOCAL' ? 'synthetic' : 'stripe') && identity.environment === config.environment &&
        identity.platformAccountId === config.platformAccountId && identity.livemode === (config.environment === 'PRODUCTION') &&
        Array.isArray(identity.allowedConnectedAccountIds) && digest([...identity.allowedConnectedAccountIds].sort()) === digest(config.connectedAccountIds), 'RECOVERY_PROVIDER_SCOPE_MISMATCH');
      return identity;
    },
    retrieve: (...args) => provider.retrieve(...args),
    discover: (...args) => provider.discover(...args),
    getAccountSnapshot: (...args) => provider.getAccountSnapshot(...args),
    listBalanceTransactions: (...args) => provider.listBalanceTransactions(...args)
  });
  return Object.freeze({
    async run({ runId, signal } = {}) {
      identifier(runId);
      check(!signal || typeof signal.aborted === 'boolean', 'RECOVERY_SIGNAL_INVALID');
      // Approval references are bindings, never authority inferred from a string.
      const ready = assertRuntimeReady(copy(config));
      if (ready && typeof ready.then === 'function') Promise.resolve(ready).catch(() => {});
      check(ready === true, 'RECOVERY_RUNTIME_UNQUALIFIED');
      const token = randomUUID();
      const start = await store.transaction(tx => {
        const runs = tx.state.financeRecoveryRuns ??= {}, leases = tx.state.financeRecoveryLeases ??= {};
        let lease = leases[scope];
        if (lease && lease.expiresAt <= tx.now) {
          const previous = runs[lease.runId];
          if (previous?.status === 'RUNNING') Object.assign(previous, { status: 'INTERRUPTED', code: 'RECOVERY_LEASE_EXPIRED', completedAt: tx.now });
          delete leases[scope]; lease = null;
        }
        const old = runs[runId];
        if (old) { check(old.configHash === configHash, 'RECOVERY_RUN_CONFLICT'); return { claimed: false, receipt: copy(old) }; }
        if (lease) return { claimed: false, receipt: { runId, status: 'BUSY', activeRunId: lease.runId, retryAfter: lease.expiresAt } };
        const selected = candidates(tx.state, config).slice(0, config.maxItems);
        const attempts = tx.state.financeRecoveryAttempts ??= {};
        for (const intent of selected) attempts[intent.id] = tx.now;
        const expiresAt = tx.now + config.maxDurationMs;
        check(Number.isSafeInteger(expiresAt), 'RECOVERY_CLOCK_INVALID');
        leases[scope] = { runId, token, expiresAt };
        const receipt = { runId, configHash, environment: config.environment, platformAccountId: config.platformAccountId, status: 'RUNNING', startedAt: tx.now, deadline: expiresAt,
          selectedIntentIds: selected.map(intent => intent.id), results: [], accountReports: [], affectedPaymentIntentIds: [], pendingIntentCount: candidates(tx.state, config).length };
        runs[runId] = receipt;
        return { claimed: true, receipt: copy(receipt) };
      });
      if (!start.claimed) return start.receipt;
      const owns = tx => tx.state.financeRecoveryLeases?.[scope]?.token === token && tx.state.financeRecoveryRuns[runId]?.status === 'RUNNING';
      const canStart = async () => !signal?.aborted && await store.transaction(tx => owns(tx) && tx.now < start.receipt.deadline);
      const append = async (key, value) => store.transaction(tx => {
        if (!owns(tx)) return false;
        const run = tx.state.financeRecoveryRuns[runId]; run[key].push(copy(value));
        if (key === 'results' && value.affectedPaymentIntentId && !run.affectedPaymentIntentIds.includes(value.affectedPaymentIntentId)) run.affectedPaymentIntentIds.push(value.affectedPaymentIntentId);
        return true;
      });
      let cursor = 0, interrupted = false, fatalCode = null;
      try {
        if (!await canStart()) interrupted = true;
        else {
          await readProvider.getIdentity();
          const work = async () => {
            while (cursor < start.receipt.selectedIntentIds.length) {
              if (!await canStart()) { interrupted = true; return; }
              const index = cursor++; if (index >= start.receipt.selectedIntentIds.length) return;
              const id = start.receipt.selectedIntentIds[index];
              const intent = await store.read(state => state.intents[id]);
              try {
                check(intent && inScope(intent, config) && intent.dispatchCount === 1 && intent.status !== 'PREPARED', 'RECOVERY_ORIGINAL_SCOPE_MISMATCH');
                let objectId = intent.objectId;
                if (!objectId) {
                  const found = await readProvider.discover(intent);
                  check(found?.complete === true, 'PROVIDER_DISCOVERY_INCOMPLETE'); objectId = found.objectId;
                }
                check(typeof objectId === 'string' && objectId.length > 0, 'PROVIDER_RESULT_UNKNOWN');
                const result = await reconcileFinanceIntent({ store, provider: readProvider, intentId: id, objectId });
                const affected = result.kind === 'PAYMENT' && (result.confirmed && result.status === 'SUCCEEDED' || result.terminalUnpaid && result.status === 'CANCELED');
                await append('results', { intentId: id, kind: result.kind, objectId: result.objectId, status: result.status, ...(affected ? { affectedPaymentIntentId: id } : {}) });
              } catch (error) {
                const code = codeFor(error);
                await store.transaction(tx => {
                  if (owns(tx) && intent && inScope(intent, config)) recordFinanceException(tx, { exceptionId: `recovery:${id}:${code}`, accountId: intent.accountId, orderId: intent.orderId, code, evidenceHash: digest({ intentId: id, code }) });
                });
                await append('results', { intentId: id, status: 'REVIEW_REQUIRED', code });
              }
            }
          };
          // All admitted operations finish before reporting interruption; there
          // is no detached promise that can mutate the ledger after return.
          const workers = await Promise.allSettled(Array.from({ length: config.concurrency }, work));
          for (const result of workers) if (result.status === 'rejected') fatalCode ??= codeFor(result.reason);
          if (!fatalCode) for (const accountId of [config.platformAccountId, ...config.connectedAccountIds]) {
            if (!await canStart()) { interrupted = true; break; }
            const reportId = `recovery:${digest({ runId, configHash, accountId })}`;
            const report = await reconcileAccount({ store, provider: readProvider, accountId, platformAccountId: config.platformAccountId, reportId, maxEvidenceAgeMs: config.maxEvidenceAgeMs, enabled: true });
            await append('accountReports', { accountId, reportId, status: report.status, ...(report.code ? { code: report.code } : {}), ...(Number.isSafeInteger(report.differenceCents) ? { differenceCents: report.differenceCents } : {}) });
          }
        }
      } catch (error) { fatalCode = codeFor(error); }
      return store.transaction(tx => {
        const receipt = tx.state.financeRecoveryRuns[runId];
        if (!owns(tx)) return copy(receipt);
        const incomplete = receipt.results.length !== receipt.selectedIntentIds.length || receipt.accountReports.length !== config.connectedAccountIds.length + 1;
        const review = receipt.results.some(result => result.status === 'REVIEW_REQUIRED') || receipt.accountReports.some(report => report.status !== 'RECONCILED');
        receipt.status = fatalCode ? 'ERROR' : interrupted || incomplete || signal?.aborted ? 'INTERRUPTED' : review ? 'REVIEW_REQUIRED' : 'COMPLETED';
        if (fatalCode) receipt.code = fatalCode;
        else if (receipt.status === 'INTERRUPTED') receipt.code = signal?.aborted ? 'RECOVERY_ABORTED' : 'RECOVERY_DEADLINE_REACHED';
        receipt.completedAt = tx.now; receipt.pendingIntentCount = candidates(tx.state, config).length;
        receipt.affectedPaymentIntentIds.sort();
        delete tx.state.financeRecoveryLeases[scope];
        return copy(receipt);
      });
    }
  });
}
