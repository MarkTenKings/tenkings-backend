import { randomUUID } from 'node:crypto';
import { financeAssert as check, copy, digest, identifier } from './ledger.mjs';
import { operationalCode, requireOperationalReady, boundedOperationalCall } from './finance-scheduler.mjs';

// Only a small closed envelope leaves the process. No provider payload, body,
// signature, secret, customer identity, exception detail or error message is sent.
export function recordOperationalAlert(tx, { scope, topic, code, reference, evidenceHash }) {
  for (const value of [scope, topic, code, reference]) identifier(value);
  check(/^[a-f0-9]{64}$/.test(evidenceHash), 'FINANCE_ALERT_EVIDENCE_REQUIRED');
  const alertId = `alert:${digest({ scope, topic })}`, alerts = tx.state.financeOperationalAlerts ??= {};
  const old = alerts[alertId];
  if (old && old.status !== 'RESOLVED') {
    if (old.latestEvidenceHash !== evidenceHash || (old.latestReference ?? old.reference) !== reference || old.code !== code) old.version = (old.version ?? 1) + 1;
    old.lastObservedAt = tx.now; old.latestEvidenceHash = evidenceHash; old.latestReference = reference; old.code = code;
    return copy(old);
  }
  const generation = (old?.generation ?? (old ? 1 : 0)) + 1;
  const deliveryKey = generation === 1 ? alertId : `${alertId}:generation:${generation}`;
  const history = old?.history ?? [];
  if (old) history.push({ action: 'RECURRED', at: tx.now, generation, evidenceHash });
  const alert = { alertId, scope, topic, code, reference, evidenceHash, latestEvidenceHash: evidenceHash, firstObservedAt: old?.firstObservedAt ?? tx.now, lastObservedAt: tx.now, status: 'OPEN', generation, version: (old?.version ?? 0) + 1, deliveryKey, history };
  alerts[alertId] = alert;
  // A recurrence has its own delivery identity. Prior UNKNOWN deliveries are
  // retained for lookup; resolving an incident never resets their dispatch.
  (tx.state.financeAlertOutbox ??= {})[deliveryKey] = { alertId, deliveryKey, generation, scope, status: 'PENDING', dispatchCount: 0, lookupCount: 0, lastAttemptAt: 0, claim: null,
    envelope: { alertId, code, reference, evidenceHash, firstObservedAt: tx.now } };
  return copy(alert);
}

// Alert review is separate from financial exception/hold resolution. It never
// changes ledger entries, provider intents, an unknown delivery or sale authority.
export function reviewOperationalAlert(tx, { actor, requestId, alertId, expectedVersion, action, reviewRef, evidenceHash }) {
  check(actor?.role === 'STAFF', 'FORBIDDEN');
  for (const value of [actor.id, requestId, alertId, reviewRef]) identifier(value);
  check(['ACKNOWLEDGE','RESOLVE'].includes(action) && Number.isSafeInteger(expectedVersion) && expectedVersion >= 1 && /^[a-f0-9]{64}$/.test(evidenceHash), 'FINANCE_INCIDENT_REVIEW_INVALID');
  const requestHash = digest({ actorId: actor.id, alertId, expectedVersion, action, reviewRef, evidenceHash });
  const receipts = tx.state.financeIncidentReviews ??= {}, key = digest({ actorId: actor.id, requestId });
  if (receipts[key]) { check(receipts[key].requestHash === requestHash, 'IDEMPOTENCY_CONFLICT'); return copy(receipts[key].result); }
  const row = tx.state.financeOperationalAlerts?.[alertId];
  check(row && (row.version ?? 1) === expectedVersion && row.latestEvidenceHash === evidenceHash, 'FINANCE_INCIDENT_CHANGED');
  check(action === 'ACKNOWLEDGE' ? row.status === 'OPEN' : ['OPEN','ACKNOWLEDGED'].includes(row.status), 'FINANCE_INCIDENT_TRANSITION_REFUSED');
  row.version = expectedVersion + 1; row.generation ??= 1;
  row.status = action === 'ACKNOWLEDGE' ? 'ACKNOWLEDGED' : 'RESOLVED';
  (row.history ??= []).push({ action, at: tx.now, actorId: actor.id, reviewRef, evidenceHash, generation: row.generation });
  const result = { alertId, status: row.status, version: row.version, generation: row.generation };
  receipts[key] = { requestHash, result: copy(result), at: tx.now };
  tx.emit('FINANCE_INCIDENT_REVIEWED', { ...result, actorId: actor.id, reviewRef });
  return result;
}

// Claim before send. A lost response can only use lookup for that original key;
// even NOT_FOUND cannot prove a send never happened and does not re-arm it.
export function createFinanceAlertOutbox({ enabled = false, store, scope, config, assertRuntimeReady, sender } = {}) {
  if (!enabled) return Object.freeze({ async flush() { check(false, 'FINANCE_ALERTS_DISABLED'); } });
  identifier(scope); identifier(config?.approvalRef); identifier(config?.destinationRef);
  check(Number.isSafeInteger(config.maxItems) && config.maxItems >= 1 && config.maxItems <= 100 && Number.isSafeInteger(config.leaseMs) && config.leaseMs >= 1000 && config.leaseMs <= 300000, 'FINANCE_ALERT_BOUNDS_REQUIRED');
  check(typeof assertRuntimeReady === 'function' && typeof store?.transaction === 'function', 'FINANCE_ALERT_RUNTIME_REQUIRED');
  config = Object.freeze(copy(config));
  if (sender) for (const name of ['assertReady','send','lookup']) check(typeof sender[name] === 'function', 'FINANCE_ALERT_SENDER_UNQUALIFIED');
  const senderPorts = sender ? Object.fromEntries(['assertReady','send','lookup'].map(name => [name, sender[name]])) : null;
  const binding = Object.freeze({ scope, approvalRef: config.approvalRef, destinationRef: config.destinationRef, operation: 'FINANCE_OPERATIONAL_ALERTS' });
  const transportSlots = new Set();
  function ready() {
    requireOperationalReady(assertRuntimeReady, binding);
    if (sender) {
      check(Object.entries(senderPorts).every(([name, fn]) => sender[name] === fn), 'FINANCE_ALERT_SENDER_CHANGED');
      requireOperationalReady(senderPorts.assertReady.bind(sender), binding);
    }
  }
  return Object.freeze({
    status: () => ({ inFlightCount: transportSlots.size }),
    async flush({ signal, deadline = null } = {}) {
      ready(); if (!sender) return { status: 'SENDER_NOT_CONFIGURED', results: [] };
      const ids = await store.read(state => Object.entries(state.financeAlertOutbox ?? {}).filter(([,row]) => row.scope === scope && row.status !== 'DELIVERED').sort(([ak,a],[bk,b]) => a.lastAttemptAt - b.lastAttemptAt || ak.localeCompare(bk)).slice(0, config.maxItems).map(([key]) => key));
      const results = []; let busy = false;
      for (const alertId of ids) {
        if (signal?.aborted || deadline !== null && Date.now() >= deadline) break; ready(); const token = randomUUID();
        if (transportSlots.size >= 1) { busy = true; break; }
        transportSlots.add(token); let work;
        try { work = await store.transaction(tx => {
          ready(); const row = tx.state.financeAlertOutbox[alertId];
          const bindingHash = digest(binding);
          check(!row.bindingHash || row.bindingHash === bindingHash, 'FINANCE_ALERT_DESTINATION_CHANGED');
          if (row.status === 'DELIVERED' || row.claim?.expiresAt > tx.now) return null;
          if (row.claim) { row.status = 'UNKNOWN'; row.claim = null; }
          const action = row.dispatchCount === 0 ? 'send' : 'lookup';
          row.bindingHash = bindingHash;
          if (action === 'send') row.dispatchCount++; else row.lookupCount++;
          row.status = action === 'send' ? 'SENDING' : 'LOOKING_UP'; row.lastAttemptAt = tx.now;
          row.claim = { token, expiresAt: tx.now + config.leaseMs };
          const a = tx.state.financeOperationalAlerts[row.alertId];
          return { action, alert: copy(row.envelope ?? { alertId: row.alertId, code: a.code, reference: a.reference, evidenceHash: a.evidenceHash, firstObservedAt: a.firstObservedAt }) };
        }); } catch (error) { transportSlots.delete(token); throw error; }
        if (!work) { transportSlots.delete(token); continue; }
        let outcome, started = false;
        try {
          ready(); const timeoutMs = Math.min(config.leaseMs, deadline === null ? config.leaseMs : Math.max(0, deadline - Date.now()));
          const value = await boundedOperationalCall(signal => {
            started = true;
            const operation = Promise.resolve().then(() => senderPorts[work.action].call(sender, { idempotencyKey: alertId, signal, ...(work.action === 'send' ? { alert: copy(work.alert) } : {}) }));
            operation.then(() => transportSlots.delete(token), () => transportSlots.delete(token));
            return operation;
          }, { signal, timeoutMs, code: 'FINANCE_ALERT_DELIVERY_INTERRUPTED' });
          if (value?.status === 'DELIVERED') { identifier(value.receiptId); outcome = { status: 'DELIVERED', receiptId: value.receiptId }; }
          else outcome = { status: 'UNKNOWN', code: 'FINANCE_ALERT_DELIVERY_UNKNOWN' };
        } catch (error) { outcome = { status: 'UNKNOWN', code: operationalCode(error) }; }
        finally { if (!started) transportSlots.delete(token); }
        const result = await store.transaction(tx => {
          const row = tx.state.financeAlertOutbox[alertId];
          if (row.claim?.token === token) { Object.assign(row, outcome); row.claim = null; if (outcome.status === 'DELIVERED') row.deliveredAt = tx.now; }
          return { alertId, status: row.status, ...(row.code ? { code: row.code } : {}) };
        });
        results.push(result);
      }
      return { status: signal?.aborted || deadline !== null && Date.now() >= deadline ? 'INTERRUPTED' : busy || results.some(row => row.status !== 'DELIVERED') ? 'REVIEW_REQUIRED' : 'COMPLETED', results };
    }
  });
}
