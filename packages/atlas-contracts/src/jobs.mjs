import { hash, requireThat as check, validate, id } from './strict.mjs';
import { providerAttemptSchema } from './contracts.mjs';
import { appendAuditEvent as audit } from './workflow.mjs';

const MAX_LEASE_MS = 60000;
function job(db, cardId) { const c = db.cards[cardId]; check(c, 'CARD_NOT_FOUND'); return c; }
export function verifyLease(card, lease, now) {
  check(card.lease && lease && card.lease.owner === lease.owner && card.lease.fence === lease.fence && card.lease.expiresAtMs > now && card.lease.revision === card.revision && card.lease.runManifestHash === card.runManifestHash, 'LEASE_FENCED');
}
export function claimLease(store, cardId, owner, expectedManifestHash, now, durationMs = 30000, mode = 'WORK') {
  validate(id, owner);
  return store.transaction(db => {
    const c = job(db, cardId);
    check(['WORK', 'RECONCILE_ONLY'].includes(mode), 'LEASE_MODE');
    if (mode === 'WORK') check(!db.paused && now < db.caps.deadlineMs, 'ADMISSION_PAUSED');
    else check(Object.values(db.attempts).some(a => a.cardId === cardId && ['RESERVED', 'DISPATCHED', 'UNKNOWN_PENDING_RECONCILIATION'].includes(a.status)), 'NO_PENDING_RECONCILIATION');
    check(c.runManifestHash === expectedManifestHash, 'MANIFEST_DRIFT');
    check(!c.lease || c.lease.expiresAtMs <= now, 'LEASE_BUSY');
    check(Number.isSafeInteger(durationMs) && durationMs > 0 && durationMs <= MAX_LEASE_MS, 'LEASE_BOUNDS');
    c.leaseCounter += 1;
    c.lease = { owner, fence: c.leaseCounter, revision: c.revision, runManifestHash: c.runManifestHash, expiresAtMs: now + durationMs, mode };
    for (const a of Object.values(db.attempts).filter(a => a.cardId === cardId && a.status === 'DISPATCHED')) {
      a.status = 'UNKNOWN_PENDING_RECONCILIATION';
      audit(c, 'ATTEMPT_UNKNOWN', a.attemptId, owner, now, { priorLeaseFence: a.leaseFence, reservationRetained: a.reservedMicroUsd });
    }
    audit(c, 'LEASE_CLAIMED', `lease_${c.leaseCounter}`, owner, now, c.lease);
    return c.lease;
  });
}
export function renewLease(store, cardId, lease, now, durationMs = 30000) {
  return store.transaction(db => {
    const c = job(db, cardId); verifyLease(c, lease, now);
    check((c.lease.mode === 'RECONCILE_ONLY' || !db.paused && now < db.caps.deadlineMs) && Number.isSafeInteger(durationMs) && durationMs > 0 && durationMs <= MAX_LEASE_MS, 'LEASE_BOUNDS');
    c.lease.expiresAtMs = now + durationMs;
    audit(c, 'LEASE_RENEWED', `renew_${c.lease.fence}_${now}`, lease.owner, now, c.lease);
    return c.lease;
  });
}
export function reserveAttempt(store, cardId, lease, request, now) {
  validate(id, request.operationId); validate(id, request.attemptId);
  check(['ASTRA', 'SAM', 'COMPS', 'RENDER'].includes(request.provider), 'PROVIDER_FORBIDDEN');
  check(Number.isSafeInteger(request.reserveMicroUsd) && request.reserveMicroUsd > 0, 'RESERVATION_INVALID');
  return store.transaction(db => {
    const c = job(db, cardId); verifyLease(c, lease, now);
    check(c.lease.mode === 'WORK', 'RECONCILIATION_ONLY');
    const key = `${c.runId}:${request.attemptId}`;
    const inputHash = hash({ cardId, revision: c.revision, runManifestHash: c.runManifestHash, operationId: request.operationId, provider: request.provider, input: request.input, reserveMicroUsd: request.reserveMicroUsd });
    if (db.attempts[key]) {
      const previous = db.attempts[key]; check(previous.inputHash === inputHash, 'ATTEMPT_CONFLICT');
      if (previous.status === 'RESERVED') {
        check(previous.revision === c.revision && previous.runManifestHash === c.runManifestHash, 'STALE_REVISION');
        previous.leaseFence = lease.fence;
      }
      return previous;
    }
    check(!db.paused && now < db.caps.deadlineMs, 'ADMISSION_PAUSED');
    const attempts = Object.values(db.attempts).filter(a => a.cardId === cardId && a.operationId === request.operationId);
    check(attempts.every(a => a.inputHash === inputHash), 'OPERATION_INPUT_CONFLICT');
    check(Object.values(db.attempts).filter(a => a.cardId === cardId).length < db.caps.maxProviderAttempts, 'CARD_ATTEMPT_CAP');
    const stageStartedAtMs = attempts[0]?.stageStartedAtMs ?? now;
    const deadlineMs = Math.min(db.caps.deadlineMs, c.createdAtMs + db.caps.maxCardDurationMs, stageStartedAtMs + db.caps.maxStageDurationMs);
    check(now < deadlineMs, 'STAGE_OR_CARD_DEADLINE');
    check(attempts.length < db.caps.maxAttempts && attempts.length < 3, 'RETRY_CAP');
    check(!attempts.some(a => ['RESERVED', 'DISPATCHED', 'UNKNOWN_PENDING_RECONCILIATION', 'SUCCEEDED', 'DEAD_LETTER'].includes(a.status)), 'OPERATION_NOT_RETRYABLE');
    check(attempts.every(a => a.retryAtMs <= now), 'RETRY_NOT_DUE');
    check(c.spentMicroUsd + c.reservedMicroUsd + request.reserveMicroUsd <= db.caps.cardMicroUsd && db.spentMicroUsd + db.reservedMicroUsd + request.reserveMicroUsd <= db.caps.batchMicroUsd, 'BUDGET_CAP');
    const body = { attemptId: request.attemptId, operationId: request.operationId, provider: request.provider, inputHash, runManifestHash: c.runManifestHash, revision: c.revision, leaseFence: lease.fence, status: 'RESERVED', reservedMicroUsd: request.reserveMicroUsd, actualMicroUsd: null, requestId: null, retryAtMs: null, outputHash: null };
    validate(providerAttemptSchema, body);
    const attempt = { ...body, cardId, runId: c.runId, attemptOrdinal: attempts.length + 1, stageStartedAtMs, deadlineMs, result: null, settleHash: null };
    db.attempts[key] = attempt;
    c.reservedMicroUsd += request.reserveMicroUsd; db.reservedMicroUsd += request.reserveMicroUsd;
    audit(c, 'ATTEMPT_RESERVED', request.attemptId, lease.owner, now, body);
    return attempt;
  });
}
export function dispatchAttempt(store, cardId, lease, attemptId, now) {
  return store.transaction(db => {
    const c = job(db, cardId); verifyLease(c, lease, now);
    check(c.lease.mode === 'WORK', 'RECONCILIATION_ONLY');
    check(!db.paused && now < db.caps.deadlineMs, 'ADMISSION_PAUSED');
    const a = db.attempts[`${c.runId}:${attemptId}`];
    check(a && a.status === 'RESERVED' && a.revision === c.revision && a.leaseFence === lease.fence && a.runManifestHash === c.runManifestHash && now < a.deadlineMs, 'DISPATCH_NOT_ALLOWED');
    a.status = 'DISPATCHED';
    audit(c, 'ATTEMPT_DISPATCHED', attemptId, lease.owner, now, { inputHash: a.inputHash });
    // Must commit before any outbound request. Replaying DISPATCHED never sends
    // again; a crash before/after the network boundary is conservatively unknown.
    return a;
  });
}
export function markUnknown(store, cardId, lease, attemptId, now) {
  return store.transaction(db => {
    const c = job(db, cardId); verifyLease(c, lease, now);
    const a = db.attempts[`${c.runId}:${attemptId}`];
    check(a && ['DISPATCHED', 'UNKNOWN_PENDING_RECONCILIATION'].includes(a.status), 'UNKNOWN_STATE');
    a.status = 'UNKNOWN_PENDING_RECONCILIATION';
    audit(c, 'ATTEMPT_UNKNOWN', attemptId, lease.owner, now, { reservationRetained: a.reservedMicroUsd });
    return a;
  });
}
export function settleAttempt(store, cardId, lease, attemptId, outcome, now, failpoint = null) {
  return store.transaction(db => {
    const c = job(db, cardId); verifyLease(c, lease, now);
    const a = db.attempts[`${c.runId}:${attemptId}`]; check(a, 'ATTEMPT_UNKNOWN_ID');
    const settleHash = hash(outcome);
    if (a.settleHash) { check(a.settleHash === settleHash, 'SETTLEMENT_CONFLICT'); return a; }
    check(['DISPATCHED', 'UNKNOWN_PENDING_RECONCILIATION'].includes(a.status) || a.status === 'RESERVED' && c.lease.mode === 'RECONCILE_ONLY' && outcome.status === 'TERMINAL_FAILURE' && outcome.actualMicroUsd === 0 && outcome.reconciled === true, 'SETTLEMENT_STATE');
    const stale = a.revision !== c.revision || a.runManifestHash !== c.runManifestHash;
    check(Number.isSafeInteger(outcome.actualMicroUsd) && outcome.actualMicroUsd >= 0, 'USAGE_RECONCILIATION_REQUIRED');
    check(['SUCCEEDED', 'RETRYABLE_FAILURE', 'TERMINAL_FAILURE'].includes(outcome.status), 'OUTCOME_INVALID');
    validate(id, outcome.requestId);
    if (a.status === 'UNKNOWN_PENDING_RECONCILIATION') check(outcome.reconciled === true, 'RECONCILIATION_REQUIRED');
    if (outcome.status === 'RETRYABLE_FAILURE') check(Number.isSafeInteger(outcome.retryAfterMs) && outcome.retryAfterMs >= 0, 'RETRY_AFTER_INVALID');
    a.actualMicroUsd = outcome.actualMicroUsd; a.requestId = outcome.requestId; a.settleHash = settleHash;
    a.result = structuredClone(outcome.output ?? null); a.outputHash = hash(a.result);
    c.reservedMicroUsd -= a.reservedMicroUsd; db.reservedMicroUsd -= a.reservedMicroUsd;
    c.spentMicroUsd += a.actualMicroUsd; db.spentMicroUsd += a.actualMicroUsd;
    check(Number.isSafeInteger(c.spentMicroUsd) && Number.isSafeInteger(db.spentMicroUsd), 'COST_OVERFLOW');
    const exceeded = a.actualMicroUsd > a.reservedMicroUsd || c.spentMicroUsd + c.reservedMicroUsd > db.caps.cardMicroUsd || db.spentMicroUsd + db.reservedMicroUsd > db.caps.batchMicroUsd;
    // Real charges must never vanish because they exceeded a reservation.
    if (exceeded) db.paused = 'COST_RESERVATION_BREACH';
    const terminal = outcome.status === 'TERMINAL_FAILURE' || exceeded || stale || now >= a.deadlineMs || a.attemptOrdinal >= Math.min(3, db.caps.maxAttempts);
    a.status = outcome.status === 'SUCCEEDED' && !exceeded && !stale && now < a.deadlineMs ? 'SUCCEEDED' : terminal ? 'DEAD_LETTER' : 'RETRY_WAIT';
    if (a.status === 'RETRY_WAIT') {
      // Deterministic bounded jitter for offline repeatability; live scheduler
      // must honor Retry-After without holding a Vercel request open.
      const jitter = parseInt(a.inputHash.slice(-4), 16) % 251;
      a.retryAtMs = now + Math.max(outcome.retryAfterMs, 1000 * 2 ** (a.attemptOrdinal - 1) + jitter);
      if (a.retryAtMs >= a.deadlineMs) a.status = 'DEAD_LETTER';
    }
    const outboxId = `attempt_${c.runId}_${attemptId}`;
    db.outbox[outboxId] = { outboxId, cardId, revision: c.revision, revisionHash: hash({ runManifestHash: c.runManifestHash, revision: c.revision }), type: a.status === 'SUCCEEDED' ? 'STEP_RESULT_READY' : a.status === 'DEAD_LETTER' ? 'DEAD_LETTER_REVIEW' : 'RETRY_DUE', status: 'PENDING', deliveries: 0, outputHash: a.outputHash };
    audit(c, a.status === 'DEAD_LETTER' ? 'DEAD_LETTERED' : a.status === 'RETRY_WAIT' ? 'RETRY_SCHEDULED' : 'ATTEMPT_SETTLED', attemptId, lease.owner, now, { outcomeHash: settleHash, outboxId, actualMicroUsd: a.actualMicroUsd });
    return a;
  }, failpoint);
}
export function acknowledgeOutbox(store, outboxId, consumer, expectedPayloadHash, now) {
  validate(id, consumer);
  return store.transaction(db => {
    const message = db.outbox[outboxId]; check(message, 'OUTBOX_NOT_FOUND');
    const { status, deliveries, ...payload } = message;
    check(hash(payload) === expectedPayloadHash, 'OUTBOX_PAYLOAD_CHANGED');
    if (status === 'ACKED') return message;
    message.status = 'ACKED'; message.deliveries += 1;
    audit(db.cards[message.cardId], 'OUTBOX_ACKED', outboxId, consumer, now, { expectedPayloadHash });
    return message;
  });
}
