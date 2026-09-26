import { createHash, randomUUID } from 'node:crypto';
import { safeTransactionDiagnostic } from '@atlas/manual-service/contract';

export const BATCH_POLICY = 'atlas-astra-batch-v1';
export const BATCH_STAGES = Object.freeze(['PREPARE', 'ANALYZE', 'REPORT']);
export const BATCH_RATE_LIMIT_RETRIES = 3;
export function batchError(code, status = 409) { return Object.assign(new Error(code), { code, status }); }
export function assertBatch(ok, code = 'BATCH_INPUT_INVALID', status = 400) { if (!ok) throw batchError(code, status); }
export function batchHash(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export function batchActionId(key, purpose) {
  const hex = batchHash([BATCH_POLICY, key, purpose]);
  // Existing ATLAS action contracts admit a version-4-shaped UUID. This is a
  // stable internal idempotency key, never an authentication credential.
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export function batchAnalysisActionId(key, attempt = 0) {
  assertBatch(Number.isInteger(attempt) && attempt >= 0 && attempt <= BATCH_RATE_LIMIT_RETRIES, 'BATCH_STORED_CONTENT_INVALID', 503);
  return batchActionId(key, attempt ? `ANALYZE_RETRY_${attempt}` : 'ANALYZE');
}
export function parseBatchInput(value) {
  const uuid = id => typeof id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id);
  assertBatch(value && Object.keys(value).sort().join(',') === 'actionId,cards' && uuid(value.actionId));
  assertBatch(Array.isArray(value.cards) && value.cards.length > 0 && value.cards.length <= 50);
  const seen = new Set();
  const cards = value.cards.map(card => {
    assertBatch(card && Object.keys(card).sort().join(',') === 'cardId,sourceHash' && uuid(card.cardId)
      && typeof card.sourceHash === 'string' && /^[a-f0-9]{64}$/.test(card.sourceHash) && !seen.has(card.cardId));
    seen.add(card.cardId); return { cardId: card.cardId, sourceHash: card.sourceHash };
  });
  return { actionId: value.actionId, cards };
}

/** Each stage resumes its exact durable action. The injected preparation adapter
 * owns paid-request reconciliation; a queue claim is never provider permission.
 * Work runs outside transactions. Durable discovery issues opaque machine
 * handles whose owner authority is checked at every lease/commit. Browser wakes
 * remain a latency hint, never a prerequisite. No human action is called.
 */
export function createBatchWorker({ repository, prepare, concurrency = 20, analysisConcurrency = concurrency, heartbeatMs = 30000,
  clock = () => Date.now(), timers = globalThis, onError = () => {}, autoStart = true }) {
  assertBatch(repository && typeof prepare?.run === 'function' && Number.isInteger(concurrency)
    && concurrency >= 1 && concurrency <= 128 && Number.isInteger(analysisConcurrency)
    && analysisConcurrency >= 1 && analysisConcurrency <= 128, 'BATCH_CONFIG_INVALID', 500);
  assertBatch(Number.isInteger(heartbeatMs) && heartbeatMs >= 10 && heartbeatMs <= 30000, 'BATCH_CONFIG_INVALID', 500);
  assertBatch(typeof autoStart === 'boolean', 'BATCH_CONFIG_INVALID', 500);
  const owners = new Map(), stopWaiters = new Set(), dispatchAdmission = new AbortController();
  let stopped = false, started = false, active = 0, draining = false, poll = null;
  function settled() {
    if (draining || active) return;
    for (const resolve of stopWaiters) resolve(); stopWaiters.clear();
  }
  async function execute(staff, job) {
    const controller = new AbortController(); let renewal = null;
    const timer = timers.setInterval(() => {
      if (renewal || controller.signal.aborted) return;
      renewal = repository.renew(staff, job).then(ok => { if (!ok) controller.abort(batchError('BATCH_LEASE_LOST')); })
        .catch(error => controller.abort(error)).finally(() => { renewal = null; });
    }, heartbeatMs);
    timer?.unref?.();
    try {
      // Admission cancellation fences new provider effects; it must not abort
      // an already dispatched response or its immutable receipt persistence.
      const outcome = await prepare.run(staff, job, { signal: controller.signal,
        dispatchSignal: AbortSignal.any([controller.signal, dispatchAdmission.signal]) });
      if (controller.signal.aborted) throw controller.signal.reason;
      assertBatch(outcome && ['CONTINUE', 'WAIT', 'REVIEW', 'ATTENTION', 'RETRY_ANALYSIS'].includes(outcome.kind), 'BATCH_OUTCOME_INVALID', 500);
      assertBatch(outcome.kind !== 'RETRY_ANALYSIS' || job.stage === 'ANALYZE', 'BATCH_OUTCOME_INVALID', 500);
      assertBatch(outcome.kind !== 'CONTINUE' || job.stage !== 'REPORT', 'BATCH_OUTCOME_INVALID', 500);
      assertBatch(outcome.kind !== 'REVIEW' || job.stage === 'REPORT', 'BATCH_OUTCOME_INVALID', 500);
      if (outcome.kind === 'REVIEW') assertBatch(outcome.evidence?.reportHash && outcome.evidence?.manualRevision
        && outcome.evidence?.sourceHash === job.sourceHash && outcome.evidence?.authority === 'MACHINE_PROPOSAL', 'BATCH_REPORT_BINDING_INVALID', 409);
      await repository.finish(staff, job, outcome);
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) owners.delete(staff.id);
      // This precise native-capacity refusal occurs before the limited work
      // starts. Retain the same durable job/action; do not ask a reviewer to
      // resolve ordinary contention with an upload or another measurement.
      // Operational retries retain the exact job/action at every stage. Their
      // durable counters survive restarts and cap backoff; they do not admit a
      // replacement model request. ANALYZE first reconciles its saved action.
      const storageRetryCount = job.evidence?.storageRetryCount === undefined ? 0 : job.evidence.storageRetryCount;
      const transportRetryCount = job.evidence?.transportRetryCount === undefined ? 0 : job.evidence.transportRetryCount;
      const validCount = value => Number.isSafeInteger(value) && value >= 0 && value <= 1000000;
      const backoff = value => Math.min(60000, 3000 * 2 ** Math.min(5, value));
      const canRetry = !controller.signal.aborted && ![401, 403].includes(error?.status);
      // Prisma wraps SQLSTATE for raw queries. Only lock/deadlock/serialization
      // and statement-budget failures are transient, not arbitrary SQL errors.
      const sqlContention = ['40001','40P01','55P03','57014'].includes(
        error?.code === 'P2010' ? error?.meta?.code : error?.code);
      const retryStorage = error?.code === 'PHOTO_STORAGE_UNAVAILABLE'
        && !dispatchAdmission.signal.aborted && error?.name !== 'AbortError'
        && validCount(storageRetryCount);
      const outcome=canRetry && retryStorage
        ?{kind:'WAIT',retryAfterMs:backoff(storageRetryCount),evidence:{storageRetryCount:Math.min(1000000,storageRetryCount+1)}}
        :canRetry && (dispatchAdmission.signal.aborted || ['MANUAL_PROCESSING_BUSY','GEOMETRY_QUEUE_FULL','BATCH_STOPPED'].includes(error?.code))
          ?{kind:'WAIT',retryAfterMs:3000}
        :canRetry && validCount(transportRetryCount) && error?.name !== 'AbortError' && (sqlContention || ['ECONNRESET','ECONNREFUSED','ETIMEDOUT','EAI_AGAIN',
          'UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET','P1001','P1002','P1017','P2024','P2028','P2034',
          'GEOMETRY_PROCESSING_PENDING', 'BATCH_REPORT_UNAVAILABLE', 'BATCH_REPORT_TIMEOUT',
          'BATCH_REPORT_FAILED'].includes(error?.code))
          ?{kind:'WAIT',retryAfterMs:backoff(transportRetryCount),
            evidence:{transportRetryCount:Math.min(1000000,transportRetryCount+1)}}
        :{kind:'ATTENTION',code:/^[A-Z][A-Z0-9_]{0,100}$/.test(error?.code??'')?error.code:'BATCH_STAGE_INTERRUPTED'};
      // A retained job must not be the only record of a stage failure. Expose
      // diagnostic structure without copying arbitrary exception messages,
      // signed storage URLs, provider bodies or credentials into worker logs.
      const code = outcome.code ?? (/^[A-Z][A-Z0-9_]{0,100}$/.test(error?.code ?? '') ? error.code : 'BATCH_STAGE_RETRY');
      const location = String(error?.stack ?? '').match(/(?:^|\n)\s+at [^\n]*?(packages\/atlas-[a-z-]+\/(?:src|scripts)\/[a-zA-Z0-9_./-]+\.mjs:\d+:\d+)\)?(?:\n|$)/)?.[1];
      const diagnostic = Object.assign(new Error(code), { code, stage: job.stage,
        ...safeTransactionDiagnostic(error),
        errorType: ['Error', 'TypeError', 'RangeError', 'SyntaxError', 'AbortError'].includes(error?.name) ? error.name : 'Error',
        ...(location ? { location } : {}) });
      try { onError(diagnostic); } catch { /* Diagnostics cannot strand a lease. */ }
      try { await repository.finish(staff, job, outcome); }
      catch (saveError) { onError(saveError); }
    } finally { timers.clearInterval(timer); await renewal; }
  }
  async function drain() {
    if (draining || stopped || !started) return; draining = true;
    try {
      if (typeof repository.discoverOwners === 'function') {
        const discovered = await repository.discoverOwners();
        if (stopped) return;
        // Replace expired browser handles with newly scoped machine authority.
        // Order comes from persisted last-service time, not process lifetime.
        owners.clear();
        for (const staff of discovered) owners.set(staff.id, staff);
      }
      while (!stopped && active < concurrency) {
        let job = null, owner = null;
        for (const [id, staff] of owners) {
          try { job = await repository.claim(staff, randomUUID(), concurrency, analysisConcurrency); }
          catch (error) { if (error?.status === 401 || error?.status === 403) owners.delete(id); onError(error); continue; }
          // A claim can commit while SIGTERM is waiting on the database. Return
          // that exact lease to the queue without starting another CPU/provider
          // stage; shutdown must never create a fresh paid dispatch.
          if (stopped) {
            if (job) try { await repository.finish(staff, job, { kind: 'WAIT', retryAfterMs: 1000 }); }
            catch (error) { onError(error); }
            return;
          }
          if (job) { owner = staff; owners.delete(id); owners.set(id, staff); break; }
        }
        if (!job) break;
        active++;
        void execute(owner, job).finally(() => { active--; settled(); if (!stopped) void drain(); });
      }
    } catch (error) { onError(error); }
    finally { draining = false; settled(); }
  }
  function start() {
    if (started || stopped) return false;
    started = true;
    poll = timers.setInterval(() => { if (owners.size || repository.discoverOwners) void drain(); }, 2000); poll?.unref?.();
    queueMicrotask(() => { void drain(); });
    return true;
  }
  if (autoStart) start();
  return Object.freeze({
    start,
    wake(staff) { if (stopped) return false; assertBatch(staff?.id, 'SIGN_IN_REQUIRED', 401); owners.set(staff.id, staff); void drain(); return true; },
    async tick(staff) { if (stopped) return; if (staff) owners.set(staff.id, staff); await drain(); },
    stop() {
      stopped = true; owners.clear(); timers.clearInterval(poll);
      dispatchAdmission.abort(batchError('BATCH_STOPPED'));
      return new Promise(resolve => { stopWaiters.add(resolve); settled(); });
    },
    status: () => ({ active, stopped, started, authenticatedOwners: owners.size, observedAt: clock() }),
  });
}

export function createBatchGrading({ repository, worker, review, intakeStatus = null }) {
  return Object.freeze({
    async enqueue(staff, input) { const result = await repository.enqueue(staff, parseBatchInput(input)); worker.wake(staff); return result; },
    async list(staff) {
      const [result, intakeCards] = await Promise.all([repository.list(staff), intakeStatus?.(staff)]);
      worker.wake(staff); return intakeCards ? { ...result, intakeCards } : result;
    },
    async resume(staff, input) {
      assertBatch(input && Object.keys(input).sort().join(',') === 'expectedRevision,key' && /^[a-f0-9]{64}$/.test(input.key)
        && Number.isSafeInteger(input.expectedRevision) && input.expectedRevision >= 1);
      const result = await repository.resume(staff, input); worker.wake(staff); return result;
    },
    worker,
    detail: (staff, key) => review.detail(staff, key),
    approve: (staff, key, input) => review.approve(staff, key, input),
  });
}
