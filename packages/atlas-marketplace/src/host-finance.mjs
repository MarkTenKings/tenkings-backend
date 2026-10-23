import { financeAssert as check, copy, digest, identifier } from './ledger.mjs';
import { canonicalJSON } from './contract.mjs';
import { createWebhookIngressWorker, webhookIngressHealth } from './ingress.mjs';
import { createFinanceRecoveryRunner } from './recovery.mjs';
import { assertRecoverySettlementCapability } from './recovery-settlement.mjs';
import { createFinanceScheduler, operationalCode, requireOperationalReady, boundedOperationalCall } from './finance-scheduler.mjs';
import { createFinanceAlertOutbox, recordOperationalAlert } from './finance-alerts.mjs';

const hosts = new WeakMap();
const environments = { SYNTHETIC_LOCAL: 'synthetic', PROVIDER_SANDBOX: 'stripe-sandbox', PRODUCTION: 'stripe-production' };
const exact = (value, keys) => check(value && Object.keys(value).sort().join(',') === keys.sort().join(','), 'HOST_FINANCE_CONFIG_REQUIRED');
const freeze = value => { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };
function configuration(value) {
  canonicalJSON(value);
  exact(value, ['environment','platformAccountId','connectedAccountIds','activationRef','operationsRef','qualificationRefs','recovery','schedule','alerts','finalizationBudgetMs', ...(value.ingress === undefined ? [] : ['ingress'])]);
  check(Object.hasOwn(environments, value.environment), 'HOST_FINANCE_CONFIG_REQUIRED');
  for (const key of ['platformAccountId','activationRef','operationsRef']) identifier(value[key]);
  if (value.environment === 'SYNTHETIC_LOCAL') check(value.qualificationRefs === null, 'HOST_FINANCE_QUALIFICATION_REQUIRED');
  else {
    exact(value.qualificationRefs, ['fingerprintRef','titlePolicyRef','marketplacePolicyRef','evidenceContractRef']);
    for (const ref of Object.values(value.qualificationRefs)) check(typeof ref === 'string' && ref.trim() === ref && ref.length > 0 && ref.length <= 500, 'HOST_FINANCE_QUALIFICATION_REQUIRED');
  }
  if (value.ingress !== undefined) {
    exact(value.ingress, ['enabled','maxItems','concurrency','maxAttempts','retryDelayMs','leaseMs','maxRoutingItems', ...(value.ingress.retainedConfigurationHashes === undefined ? [] : ['retainedConfigurationHashes'])]);
    const history = value.ingress.retainedConfigurationHashes ?? [];
    check(Array.isArray(history) && history.length <= 4 && new Set(history).size === history.length && history.every(item => /^[a-f0-9]{64}$/.test(item)), 'WEBHOOK_WORKER_HISTORY_REQUIRED');
    for (const [key,min,max] of [['maxItems',1,500],['concurrency',1,8],['maxAttempts',1,100],['retryDelayMs',1000,86400000],['leaseMs',1000,900000],['maxRoutingItems',1,500]]) check(Number.isSafeInteger(value.ingress[key]) && value.ingress[key] >= min && value.ingress[key] <= max, 'WEBHOOK_WORKER_BOUNDS_REQUIRED');
    check(value.ingress.enabled === true && value.ingress.leaseMs >= value.recovery.maxDurationMs + value.finalizationBudgetMs + 1000 && value.ingress.concurrency <= value.recovery.concurrency, 'HOST_FINANCE_INGRESS_CONFIG_REQUIRED');
  }
  exact(value.recovery, ['approvalRef','maxItems','concurrency','maxEvidenceAgeMs','maxDurationMs']);
  exact(value.schedule, ['intervalMs','pollIntervalMs','leaseMs']);
  exact(value.alerts, ['approvalRef','destinationRef','maxItems','leaseMs','staleIntentMs','staleReportMs']);
  for (const key of ['staleIntentMs','staleReportMs']) check(Number.isSafeInteger(value.alerts[key]) && value.alerts[key] >= 1000 && value.alerts[key] <= 604800000, 'HOST_FINANCE_ALERT_BOUNDS_REQUIRED');
  check(Number.isSafeInteger(value.finalizationBudgetMs) && value.finalizationBudgetMs >= 1 && value.finalizationBudgetMs <= 60000, 'HOST_FINANCE_FINALIZATION_BOUNDS_REQUIRED');
  check(value.schedule.leaseMs >= value.recovery.maxDurationMs + value.finalizationBudgetMs + 1000, 'HOST_FINANCE_LEASE_TOO_SHORT');
  return freeze({ ...copy(value), connectedAccountIds: [...value.connectedAccountIds].sort() });
}

export function assertHostedFinanceBinding(host, expected) {
  const record = hosts.get(host);
  check(record && ['store','provider','service','settlementCapability','environment','platformAccountId'].every(key => record[key] === expected[key]), 'HOST_FINANCE_BINDING_MISMATCH');
  record.ready(); return true;
}

// Server composition only. No HTTP handler, listener, timer, provider action,
// alert delivery, opening adjustment or financial create starts on construction.
export function createHostedFinance({ enabled = false, store, provider, service, settlementCapability, config: suppliedConfig, assertRuntimeReady, alertSender, timers } = {}) {
  if (enabled !== true) return Object.freeze({ binding: null, start() { check(false, 'HOST_FINANCE_DISABLED'); }, async stop() {}, async runOnce() { check(false, 'HOST_FINANCE_DISABLED'); }, async receiveProviderWebhook() { check(false, 'HOST_FINANCE_DISABLED'); }, async snapshot() { return { enabled: false }; } });
  const config = configuration(suppliedConfig), configHash = digest(config);
  const { environment, platformAccountId } = config, scope = digest({ environment, platformAccountId });
  check(typeof assertRuntimeReady === 'function' && typeof service?.receiveProviderWebhook === 'function' && typeof service?.settleRecoveredPayments === 'function' && typeof service?.getHostedWebhookBinding === 'function', 'HOST_FINANCE_PORTS_REQUIRED');
  const read = store?.read, transaction = store?.transaction, receive = service.receiveProviderWebhook, retain = service.retainProviderWebhook, settle = service.settleRecoveredPayments;
  if (config.ingress) check(typeof retain === 'function', 'HOST_FINANCE_PORTS_REQUIRED');
  const providerMethods = Object.fromEntries(['getIdentity','retrieve','discover','getAccountSnapshot','listBalanceTransactions', ...(config.ingress ? ['getAccount','listRelatedObjects','retrieveDispute'] : [])].map(name => [name, provider?.[name]]));
  const getWebhookBinding = service.getHostedWebhookBinding, webhookBinding = freeze(copy(service.getHostedWebhookBinding()));
  check(webhookBinding.environment === environment && webhookBinding.platformAccountId === platformAccountId && webhookBinding.endpoints.some(row => row.scope === 'PLATFORM') && webhookBinding.endpoints.some(row => row.scope === 'CONNECTED'), 'HOST_FINANCE_WEBHOOK_SCOPE_REQUIRED');
  if (config.ingress) check(webhookBinding.ingress?.enabled === true && digest([...webhookBinding.ingress.allowedConnectedAccountIds].sort()) === digest(config.connectedAccountIds), 'HOST_FINANCE_INGRESS_SCOPE_REQUIRED');
  const acceptsAccount = provider.acceptsAccount;
  const binding = freeze({ environment, platformAccountId, connectedAccountIds: copy(config.connectedAccountIds), configHash, activationRef: config.activationRef, operationsRef: config.operationsRef, qualificationRefs: copy(config.qualificationRefs), webhookBinding });
  function ready() {
    check(store?.read === read && store?.transaction === transaction && service.receiveProviderWebhook === receive && (!config.ingress || service.retainProviderWebhook === retain && provider.acceptsAccount === acceptsAccount) && service.settleRecoveredPayments === settle && service.getHostedWebhookBinding === getWebhookBinding && Object.entries(providerMethods).every(([name, fn]) => provider[name] === fn), 'HOST_FINANCE_PORT_CHANGED');
    check(digest(service.getHostedWebhookBinding()) === digest(webhookBinding), 'HOST_FINANCE_WEBHOOK_CHANGED');
    requireOperationalReady(assertRuntimeReady, { ...config, webhookBinding });
    assertRecoverySettlementCapability(settlementCapability, { store, environment, platformAccountId });
  }
  const recoveryFor = provider => createFinanceRecoveryRunner({ enabled: true, store, provider, config: { environment, platformAccountId, connectedAccountIds: config.connectedAccountIds, ...config.recovery }, assertRuntimeReady: () => { ready(); return true; } });
  recoveryFor(provider); // Validate the read-only port and bounds without I/O.
  const outbox = createFinanceAlertOutbox({ enabled: true, store, scope, config: config.alerts, sender: alertSender, assertRuntimeReady: () => { ready(); return true; } });
  const accounts = new Set([platformAccountId, ...config.connectedAccountIds]);
  // A timeout discards a read result, but its underlying transport can still be
  // alive. Retain its slot until actual completion across subsequent runs.
  const providerInFlight = new Set();
  async function alert(topic, code, reference, evidence) {
    return store.transaction(tx => { ready(); return recordOperationalAlert(tx, { scope, topic, code, reference, evidenceHash: digest(evidence) }); });
  }
  async function collectAlerts() {
    return store.transaction(tx => {
      ready(); const issues = [];
      const add = (topic, code, reference, evidence) => issues.push({ scope, topic, code, reference, evidenceHash: digest(evidence) });
      for (const row of Object.values(tx.state.financeExceptions ?? {})) if (accounts.has(row.accountId) && row.status === 'OPEN') add(`exception:${digest({ account: row.accountId, code: row.code, order: row.orderId })}`, row.code, row.exceptionId, { generation: row.generation, hash: row.latestEvidenceHash ?? row.evidenceHash });
      for (const row of Object.values(tx.state.financeWebhookIngress ?? {})) if (accounts.has(row.accountId) && ['REVIEW_REQUIRED','QUARANTINED','EXHAUSTED'].includes(row.status)) add(`ingress:${row.eventId}`, row.lastCode ?? 'WEBHOOK_INGRESS_REVIEW_REQUIRED', row.eventId, { status: row.status, rawHash: row.rawHash });
      for (const row of Object.values(tx.state.financeWebhooks ?? {})) if (accounts.has(row.accountId) && ['RECEIVED','RETRY_REQUIRED','REVIEW_REQUIRED'].includes(row.status)) add(`webhook:${row.eventId}`, 'WEBHOOK_REVIEW_REQUIRED', row.eventId, { status: row.status, rawHash: row.rawHash });
      for (const row of Object.values(tx.state.intents ?? {})) if (row.platformAccountId === platformAccountId && row.policy?.environment === environments[environment] && config.connectedAccountIds.includes(row.connectedAccountId) && row.dispatchCount === 1 && ['DISPATCHING','DISPATCHED','UNKNOWN','PENDING'].includes(row.status) && tx.now - row.dispatchedAt >= config.alerts.staleIntentMs) add(`intent:${row.id}`, 'STALE_FINANCIAL_INTENT', row.id, { status: row.status, objectId: row.objectId });
      const reports = Object.values(tx.state.financeReconciliationReports ?? {}).filter(row => row.platformAccountId === platformAccountId && row.livemode === (environment === 'PRODUCTION'));
      for (const accountId of accounts) {
        const row = reports.filter(item => item.accountId === accountId).sort((a,b) => b.sequence - a.sequence)[0];
        if (!row || row.status !== 'RECONCILED' || tx.now - row.observedAt > config.alerts.staleReportMs) add(`account:${accountId}`, 'ACCOUNT_RECONCILIATION_REQUIRED', accountId, row ? { reportId: row.reportId, status: row.status, evidenceHash: row.evidenceHash } : { status: 'MISSING' });
      }
      // Old persistent issues cannot starve newly observed issues in a bounded pass.
      issues.sort((a,b) => (tx.state.financeOperationalAlerts?.[`alert:${digest({ scope, topic: a.topic })}`]?.lastObservedAt ?? 0) - (tx.state.financeOperationalAlerts?.[`alert:${digest({ scope, topic: b.topic })}`]?.lastObservedAt ?? 0) || a.topic.localeCompare(b.topic));
      for (const issue of issues.slice(0, config.alerts.maxItems)) recordOperationalAlert(tx, issue);
      return { observed: Math.min(issues.length, config.alerts.maxItems), remaining: Math.max(0, issues.length - config.alerts.maxItems) };
    });
  }
  async function runOnce({ runId, signal: parentSignal } = {}) {
    ready(); identifier(runId);
    const controller = new AbortController(), signal = controller.signal;
    const recoveryDeadline = Date.now() + config.recovery.maxDurationMs, deadline = recoveryDeadline + config.finalizationBudgetMs;
    const abort = () => controller.abort(); parentSignal?.addEventListener('abort', abort, { once: true });
    if (parentSignal?.aborted) controller.abort();
    const timer = setTimeout(abort, Math.max(1, deadline - Date.now()));
    const recoveryController = new AbortController(), abortRecovery = () => recoveryController.abort();
    signal.addEventListener('abort', abortRecovery, { once: true });
    if (signal.aborted) recoveryController.abort();
    const recoveryTimer = setTimeout(abortRecovery, config.recovery.maxDurationMs);
    const admitted = () => !signal.aborted && Date.now() < deadline;
    try {
    const boundedProvider = Object.fromEntries(Object.entries(providerMethods).filter(([,fn]) => typeof fn === 'function').map(([name, fn]) => [name, (...args) => {
      ready(); return boundedOperationalCall(() => {
        check(providerInFlight.size < config.recovery.concurrency, 'HOST_FINANCE_PROVIDER_CAPACITY');
        const operation = Promise.resolve().then(() => fn.apply(provider, args)); providerInFlight.add(operation);
        operation.then(() => providerInFlight.delete(operation), () => providerInFlight.delete(operation));
        return operation;
      }, { signal: recoveryController.signal, timeoutMs: Math.max(0, recoveryDeadline - Date.now()), code: 'HOST_FINANCE_RECOVERY_DEADLINE' });
    }]));
    boundedProvider.acceptsAccount = id => config.connectedAccountIds.includes(id);
    const ingressReceipt = config.ingress ? await createWebhookIngressWorker({ enabled: true, store, provider: boundedProvider, config: { ...config.ingress, platformAccountId, allowedConnectedAccountIds: config.connectedAccountIds, expectedLivemode: environment === 'PRODUCTION', configurationHash: webhookBinding.configurationHash }, assertRuntimeReady: () => { ready(); return true; }, settlePayments: input => { ready(); check(!recoveryController.signal.aborted, 'HOST_FINANCE_RECOVERY_DEADLINE'); return service.settleRecoveredPayments(settlementCapability, input); } }).run({ runId: `${runId}:ingress`, signal: recoveryController.signal }) : null;
    const receipt = await recoveryFor(boundedProvider).run({ runId, signal: recoveryController.signal });
    clearTimeout(recoveryTimer);
    const settledIntentIds = [], settlementErrors = [];
    const ids = await store.read(state => [...new Set(receipt.affectedPaymentIntentIds ?? [])].filter(id => {
      const item = state.intents?.[id];
      return item?.kind === 'PAYMENT' && item.platformAccountId === platformAccountId && item.policy?.environment === environments[environment] && config.connectedAccountIds.includes(item.connectedAccountId) && item.dispatchCount === 1 && (item.status === 'SUCCEEDED' && item.confirmed === true || item.status === 'CANCELED' && item.terminalUnpaid === true);
    }));
    for (let index = 0; index < ids.length && admitted(); index += 100) {
      const intentIds = ids.slice(index, index + 100);
      try { ready(); await service.settleRecoveredPayments(settlementCapability, { intentIds }); settledIntentIds.push(...intentIds); }
      catch (error) { const code = operationalCode(error); settlementErrors.push({ code, intentIds }); if (admitted()) await alert(`settlement:${digest(intentIds)}`, code, runId, { intentIds, code }); }
    }
    if (admitted() && ['ERROR','INTERRUPTED','REVIEW_REQUIRED'].includes(receipt.status)) await alert('recovery', receipt.code ?? 'FINANCE_RECOVERY_REVIEW_REQUIRED', runId, { status: receipt.status, results: receipt.results, accountReports: receipt.accountReports });
    const alertScan = admitted() ? await collectAlerts() : { observed: 0, remaining: null };
    const delivery = admitted() ? await outbox.flush({ signal, deadline }) : { status: 'INTERRUPTED' };
    const result = { runId, ingress: ingressReceipt, status: !admitted() ? 'INTERRUPTED' : settlementErrors.length || delivery.status === 'REVIEW_REQUIRED' || ingressReceipt?.status === 'REVIEW_REQUIRED' ? 'REVIEW_REQUIRED' : receipt.status, recoveryStatus: receipt.status, settledIntentIds, settlementErrors, alertScan, deliveryStatus: delivery.status };
    await store.transaction(tx => { (tx.state.financeHostedRuns ??= {})[runId] = { ...copy(result), scope, configHash, completedAt: tx.now }; });
    return result;
    } finally { clearTimeout(timer); clearTimeout(recoveryTimer); signal.removeEventListener('abort', abortRecovery); parentSignal?.removeEventListener('abort', abort); }
  }
  const scheduler = createFinanceScheduler({ enabled: true, store, scope, configHash, config: config.schedule, run: runOnce, assertRuntimeReady: () => { ready(); return true; }, ...(timers ? { timers } : {}) });
  ready();
  const host = Object.freeze({
    binding,
    async receiveProviderWebhook(input) {
      ready();
      // Fast ACK path does no provider, settlement or alert transport work.
      if (config.ingress) return service.retainProviderWebhook(input);
      try {
        const receipt = await service.receiveProviderWebhook(input);
        await collectAlerts();
        return receipt;
      } catch (error) {
        const code = operationalCode(error);
        // Invalid ingress never reaches the database, even for alerting. The
        // independently qualified ingress monitor owns unauthenticated traffic.
        if (['INVALID_WEBHOOK_SIGNATURE','EXPIRED_WEBHOOK_SIGNATURE','RAW_WEBHOOK_BYTES_REQUIRED','INVALID_WEBHOOK_JSON','INVALID_WEBHOOK_EVENT','INVALID_WEBHOOK_CLOCK','WEBHOOK_ENDPOINT_SCOPE_MISMATCH','WEBHOOK_ENDPOINT_CONFIG_REQUIRED'].includes(code)) throw error;
        try { await alert(`webhook-error:${code}`, code, 'webhook-ingress', { code }); } catch { /* original refusal is still returned */ }
        throw error;
      }
    },
    runOnce,
    start: () => { ready(); return scheduler.start(); },
    stop: () => scheduler.stop(),
    async snapshot() {
      ready(); return store.read(state => {
        const alerts = Object.values(state.financeOperationalAlerts ?? {}).filter(row => row.scope === scope);
        const deliveryRows = Object.values(state.financeAlertOutbox ?? {}).filter(row => row.scope === scope);
        return { enabled: true, ingress: webhookIngressHealth(state, { platformAccountId, expectedLivemode: environment === 'PRODUCTION' }, Date.now()), binding: copy(binding), scheduler: scheduler.status(), schedule: copy(state.financeSchedules?.[scope] ?? null), providerInFlightCount: providerInFlight.size, alertTransportInFlightCount: outbox.status().inFlightCount,
          alertCount: alerts.length, pendingDeliveries: deliveryRows.filter(row => row.status !== 'DELIVERED').length,
          alerts: alerts.sort((a,b) => b.lastObservedAt - a.lastObservedAt).slice(0, config.alerts.maxItems).map(row => ({ alertId: row.alertId, code: row.code, reference: row.reference, status: row.status, firstObservedAt: row.firstObservedAt, lastObservedAt: row.lastObservedAt, deliveryStatus: state.financeAlertOutbox[row.deliveryKey ?? row.alertId]?.status ?? 'MISSING' })) };
      });
    }
  });
  hosts.set(host, { store, provider, service, settlementCapability, environment, platformAccountId, ready });
  return host;
}
