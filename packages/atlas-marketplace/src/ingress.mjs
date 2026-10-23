import { randomUUID } from 'node:crypto';
import { financeAssert as check, copy, digest, identifier } from './ledger.mjs';
import { verifyScopedRawWebhook, scopedWebhookBinding, reconcileRetainedFinanceWebhook } from './webhook.mjs';
import { operationalCode, requireOperationalReady, boundedOperationalCall } from './finance-scheduler.mjs';
import { recordFinanceException } from './reconciliation.mjs';

function scope(input) {
  identifier(input.platformAccountId);
  check(typeof input.expectedLivemode === 'boolean' && Array.isArray(input.allowedConnectedAccountIds) && input.allowedConnectedAccountIds.length <= 1000 && new Set(input.allowedConnectedAccountIds).size === input.allowedConnectedAccountIds.length, 'WEBHOOK_INGRESS_CONFIG_REQUIRED');
  for (const id of input.allowedConnectedAccountIds) { identifier(id); check(id !== input.platformAccountId, 'WEBHOOK_INGRESS_CONFIG_REQUIRED'); }
}
function envelope(event, accountId) {
  const object = event.data.object;
  check(typeof object.object === 'string' && object.object.length <= 100 && event.type.length <= 150, 'INVALID_WEBHOOK_EVENT');
  const value = { object: object.object };
  if (object.id !== undefined) value.id = identifier(object.id);
  else check(event.type === 'balance.available', 'INVALID_WEBHOOK_EVENT');
  if (object.metadata?.atlas_marketplace_intent !== undefined) value.metadata = { atlas_marketplace_intent: identifier(object.metadata.atlas_marketplace_intent) };
  for (const key of ['charge','payment_intent']) if (object[key] != null) value[key] = identifier(typeof object[key] === 'object' ? object[key].id : object[key]);
  return { id: event.id, object: 'event', type: event.type, account: accountId, livemode: event.livemode, data: { object: value } };
}

// No provider calls. ACK is safe only after this transaction has committed.
// Capacity covers all retained receipts; archiving is a separate approved action.
export async function retainFinanceWebhook({ enabled = false, store, rawBody, signature, endpoints, platformAccountId, allowedConnectedAccountIds, expectedLivemode, now = Date.now(), maxRetained, assertRuntimeReady }) {
  check(enabled === true, 'WEBHOOK_INGRESS_DISABLED');
  const input = { platformAccountId, allowedConnectedAccountIds, expectedLivemode }; scope(input);
  check(Number.isSafeInteger(maxRetained) && maxRetained >= 1 && maxRetained <= 100000 && typeof assertRuntimeReady === 'function', 'WEBHOOK_INGRESS_CONFIG_REQUIRED');
  const binding = scopedWebhookBinding({ endpoints }), verified = verifyScopedRawWebhook({ endpoints, platformAccountId, rawBody, signature, now, expectedLivemode });
  const accountId = verified.event.account ?? platformAccountId;
  check(accountId === platformAccountId || allowedConnectedAccountIds.includes(accountId), 'WEBHOOK_SCOPE_MISMATCH');
  const event = envelope(verified.event, accountId), ready = () => requireOperationalReady(assertRuntimeReady, { ...input, configurationHash: binding.configurationHash });
  ready();
  const result = await store.transaction(tx => {
    ready(); const inbox = tx.state.financeWebhookIngress ??= {}, old = Object.hasOwn(inbox,event.id) ? inbox[event.id] : null;
    if (old) {
      // Re-signing an identical delivery (including secret rotation) is a duplicate.
      // Changed bytes are never silently merged with the original verified event.
      if (old.rawHash !== verified.rawHash || old.accountId !== accountId || old.platformAccountId !== platformAccountId || old.expectedLivemode !== expectedLivemode) {
        old.status = 'QUARANTINED'; old.lastCode = 'WEBHOOK_DELIVERY_CONFLICT'; old.lease = null;
        old.conflictCount = Math.min(1000000, (old.conflictCount ?? 0) + 1);
        old.lastConflictHash = verified.rawHash;
        for (const affectedAccount of new Set([old.accountId,accountId])) recordFinanceException(tx, { exceptionId: `ingress-conflict:${event.id}:${affectedAccount}`, accountId: affectedAccount, orderId: null, code: old.lastCode, evidenceHash: verified.rawHash });
        return { conflict: true };
      }
      old.deliveryCount = Math.min(1000000, old.deliveryCount + 1); old.lastReceivedAt = tx.now;
      return { eventId: event.id, receiptId: event.id, status: 'DUPLICATE', receivedAt: old.receivedAt, deliveryCount: old.deliveryCount };
    }
    check(Object.keys(inbox).length < maxRetained, 'WEBHOOK_INGRESS_CAPACITY');
    inbox[event.id] = { receiptId: event.id, eventId: event.id, platformAccountId, accountId, expectedLivemode, type: event.type, objectId: event.data.object.id ?? null,
      envelope: event, envelopeHash: digest(event), rawHash: verified.rawHash, endpointId: verified.endpointId, configurationHash: binding.configurationHash,
      verifiedAt: now, receivedAt: tx.now, lastReceivedAt: tx.now, deliveryCount: 1, status: 'QUEUED', attempts: 0, nextAttemptAt: tx.now, lease: null, affectedPaymentIntentIds: [], lastCode: null };
    return { eventId: event.id, receiptId: event.id, status: 'QUEUED', receivedAt: tx.now, deliveryCount: 1 };
  });
  check(!result.conflict, 'WEBHOOK_DELIVERY_CONFLICT'); return result;
}

export function webhookIngressHealth(state, { platformAccountId, expectedLivemode }, now) {
  const rows = Object.values(state.financeWebhookIngress ?? {}).filter(row => row.platformAccountId === platformAccountId && row.expectedLivemode === expectedLivemode);
  const queued = rows.filter(row => ['QUEUED','RETRY_REQUIRED','PROCESSING'].includes(row.status));
  return { retained: rows.length, pending: queued.length, oldestPendingAgeMs: queued.length ? Math.max(0, now - Math.min(...queued.map(row => row.receivedAt))) : 0,
    reviewRequired: rows.filter(row => ['REVIEW_REQUIRED','QUARANTINED','EXHAUSTED'].includes(row.status)).length, processing: rows.filter(row => row.status === 'PROCESSING').length };
}

export function createWebhookIngressWorker({ enabled = false, store, provider, config: input, assertRuntimeReady, settlePayments, resolveDisputePolicy } = {}) {
  if (!enabled) return Object.freeze({ async run() { check(false, 'WEBHOOK_INGRESS_DISABLED'); } });
  scope(input); const config = copy(input); identifier(config.configurationHash);
  config.retainedConfigurationHashes ??= [];
  check(Array.isArray(config.retainedConfigurationHashes) && config.retainedConfigurationHashes.length <= 4 && new Set(config.retainedConfigurationHashes).size === config.retainedConfigurationHashes.length && config.retainedConfigurationHashes.every(value => /^[a-f0-9]{64}$/.test(value)), 'WEBHOOK_WORKER_HISTORY_REQUIRED');
  check(typeof settlePayments === 'function' && typeof assertRuntimeReady === 'function', 'WEBHOOK_WORKER_PORT_REQUIRED');
  for (const [key,min,max] of [['maxItems',1,500],['concurrency',1,8],['maxAttempts',1,100],['retryDelayMs',1000,86400000],['leaseMs',1000,900000],['maxRoutingItems',1,500]]) check(Number.isSafeInteger(config[key]) && config[key] >= min && config[key] <= max, 'WEBHOOK_WORKER_BOUNDS_REQUIRED');
  const methods = Object.fromEntries(['retrieve','listRelatedObjects','retrieveDispute','getAccount'].map(key => [key,provider?.[key]])), inFlight = new Set();
  const ready = () => { check(Object.entries(methods).every(([key,fn]) => provider[key] === fn), 'WEBHOOK_WORKER_PORT_CHANGED'); requireOperationalReady(assertRuntimeReady, config); };
  async function run({ runId, signal: parentSignal } = {}) {
    identifier(runId); ready();
    const controller = new AbortController(), deadline = Date.now() + config.leaseMs - 1;
    const signal = parentSignal ? AbortSignal.any([parentSignal,controller.signal]) : controller.signal;
    const timer = setTimeout(() => controller.abort(), config.leaseMs - 1);
    const readProvider = Object.fromEntries(Object.entries(methods).filter(([,fn])=>typeof fn === 'function').map(([key,fn]) => [key,(...args) => { ready(); return boundedOperationalCall(() => {
      check(inFlight.size < config.concurrency, 'WEBHOOK_WORKER_PROVIDER_CAPACITY');
      const operation = Promise.resolve().then(()=>fn.apply(provider,args)); inFlight.add(operation); operation.then(()=>inFlight.delete(operation),()=>inFlight.delete(operation)); return operation;
    }, {signal,timeoutMs:Math.max(0,deadline-Date.now()),code:'WEBHOOK_WORKER_INTERRUPTED'}); }]));
    readProvider.acceptsAccount = id => config.allowedConnectedAccountIds.includes(id);
    try { const results = [], affected = new Set();
    const selected = await store.read(state => Object.values(state.financeWebhookIngress ?? {}).filter(row => row.platformAccountId === config.platformAccountId && row.expectedLivemode === config.expectedLivemode && ['QUEUED','RETRY_REQUIRED','PROCESSING'].includes(row.status)).sort((a,b) => a.nextAttemptAt - b.nextAttemptAt || a.eventId.localeCompare(b.eventId)).map(row => row.receiptId));
    let cursor = 0, attempted = 0;
    async function consume() {
      while (!signal?.aborted && cursor < selected.length && attempted < config.maxItems) {
        const receiptId = selected[cursor++], token = randomUUID(); attempted++;
        const claim = await store.transaction(tx => {
          ready(); if (signal?.aborted) return null;
          const row = tx.state.financeWebhookIngress[receiptId];
          if (!['QUEUED','RETRY_REQUIRED','PROCESSING'].includes(row.status) || row.nextAttemptAt > tx.now || row.lease?.expiresAt > tx.now) return null;
          if (![config.configurationHash,...config.retainedConfigurationHashes].includes(row.configurationHash) || ![config.platformAccountId,...config.allowedConnectedAccountIds].includes(row.accountId)) { row.status = 'REVIEW_REQUIRED'; row.lease = null; row.lastCode = 'WEBHOOK_RECEIPT_BINDING_MISMATCH'; return { held: true, receiptId, status: row.status, code: row.lastCode }; }
          if (row.attempts >= config.maxAttempts) { row.status = 'EXHAUSTED'; row.lease = null; row.lastCode = 'WEBHOOK_RETRY_EXHAUSTED'; return { held: true, receiptId, status: row.status, code: row.lastCode }; }
          row.status = 'PROCESSING'; row.attempts++; row.lease = { token, runId, expiresAt: tx.now + config.leaseMs }; return copy(row);
        });
        if (!claim) { attempted--; continue; }
        if (claim.held) { const {held,...result} = claim; results.push(result); continue; }
        const guard = tx => { ready(); const row = tx.state.financeWebhookIngress[receiptId]; check(!signal?.aborted && row?.status === 'PROCESSING' && row.lease?.token === token && row.lease.expiresAt > tx.now, 'WEBHOOK_WORKER_INTERRUPTED'); };
        const guardedStore = { read: async fn => { ready(); check(!signal?.aborted, 'WEBHOOK_WORKER_INTERRUPTED'); return store.read(fn); }, transaction: fn => store.transaction(tx => { guard(tx); return fn(tx); }) };
        try {
          const result = await reconcileRetainedFinanceWebhook({ store: guardedStore, provider: readProvider, receiptId, ...config, resolveDisputePolicy });
          const ids = await guardedStore.read(state => [...new Set([result.intentId,result.affectedPaymentIntentId].filter(Boolean))].filter(id => {
            const item = state.intents?.[id]; return item?.kind === 'PAYMENT' && item.dispatchCount === 1 && (item.status === 'SUCCEEDED' && item.confirmed || item.status === 'CANCELED' && item.terminalUnpaid);
          }));
          for (const id of ids) affected.add(id);
          await store.transaction(tx => { guard(tx); tx.state.financeWebhookIngress[receiptId].affectedPaymentIntentIds = ids; });
          if (ids.length) { ready(); check(!signal?.aborted, 'WEBHOOK_WORKER_INTERRUPTED'); await settlePayments({ intentIds: ids }); }
          await store.transaction(tx => { guard(tx); Object.assign(tx.state.financeWebhookIngress[receiptId], { status: result.status === 'REVIEW_REQUIRED' ? 'REVIEW_REQUIRED' : 'DONE', lease: null, completedAt: tx.now, lastCode: result.code ?? null }); });
          results.push({ receiptId, status: result.status === 'REVIEW_REQUIRED' ? 'REVIEW_REQUIRED' : 'DONE' });
        } catch (error) {
          const code = operationalCode(error);
          await store.transaction(tx => { const row = tx.state.financeWebhookIngress[receiptId]; if (row.lease?.token === token) Object.assign(row, { status: row.attempts >= config.maxAttempts ? 'EXHAUSTED' : 'RETRY_REQUIRED', lease: null, nextAttemptAt: tx.now + config.retryDelayMs, lastCode: code }); });
          results.push({ receiptId, status: 'RETRY_REQUIRED', code });
        }
      }
    }
    await Promise.all(Array.from({ length: config.concurrency }, consume));
    return { runId, status: signal?.aborted ? 'INTERRUPTED' : results.some(row => row.status !== 'DONE') ? 'REVIEW_REQUIRED' : 'COMPLETE', attempted, results, affectedPaymentIntentIds: [...affected] };
    } finally { clearTimeout(timer); }
  }
  return Object.freeze({ run });
}
