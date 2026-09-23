import { createHash, randomUUID } from 'node:crypto';

export const BATCH_POLICY = 'atlas-astra-batch-v1';
export const BATCH_STAGES = Object.freeze(['PREPARE', 'ANALYZE', 'REPORT']);
export function batchError(code, status = 409) { return Object.assign(new Error(code), { code, status }); }
export function assertBatch(ok, code = 'BATCH_INPUT_INVALID', status = 400) { if (!ok) throw batchError(code, status); }
export function batchHash(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export function batchActionId(key, purpose) {
  const hex = batchHash([BATCH_POLICY, key, purpose]);
  // Existing ATLAS action contracts admit a version-4-shaped UUID. This is a
  // stable internal idempotency key, never an authentication credential.
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
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
 * Work runs outside transactions. Every lease/commit reauthenticates the real
 * staff session and rechecks the selected photo pair. No human action is called.
 */
export function createBatchWorker({ repository, prepare, concurrency = 2, heartbeatMs = 30000,
  clock = () => Date.now(), timers = globalThis, onError = () => {} }) {
  assertBatch(repository && typeof prepare?.run === 'function' && Number.isInteger(concurrency)
    && concurrency >= 1 && concurrency <= 8, 'BATCH_CONFIG_INVALID', 500);
  assertBatch(Number.isInteger(heartbeatMs) && heartbeatMs >= 10 && heartbeatMs <= 30000, 'BATCH_CONFIG_INVALID', 500);
  const owners = new Map(); let stopped = false, active = 0, draining = false;
  async function execute(staff, job) {
    const controller = new AbortController(); let renewing = false;
    const timer = timers.setInterval(() => {
      if (renewing || controller.signal.aborted) return; renewing = true;
      repository.renew(staff, job).then(ok => { if (!ok) controller.abort(batchError('BATCH_LEASE_LOST')); })
        .catch(error => controller.abort(error)).finally(() => { renewing = false; });
    }, heartbeatMs);
    timer?.unref?.();
    try {
      const outcome = await prepare.run(staff, job, { signal: controller.signal });
      if (controller.signal.aborted) throw controller.signal.reason;
      assertBatch(outcome && ['CONTINUE', 'WAIT', 'REVIEW', 'ATTENTION'].includes(outcome.kind), 'BATCH_OUTCOME_INVALID', 500);
      assertBatch(outcome.kind !== 'CONTINUE' || job.stage !== 'REPORT', 'BATCH_OUTCOME_INVALID', 500);
      assertBatch(outcome.kind !== 'REVIEW' || job.stage === 'REPORT', 'BATCH_OUTCOME_INVALID', 500);
      if (outcome.kind === 'REVIEW') assertBatch(outcome.evidence?.reportHash && outcome.evidence?.manualRevision
        && outcome.evidence?.sourceHash === job.sourceHash && outcome.evidence?.authority === 'MACHINE_PROPOSAL', 'BATCH_REPORT_BINDING_INVALID', 409);
      await repository.finish(staff, job, outcome);
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) owners.delete(staff.id);
      try { await repository.finish(staff, job, { kind: 'ATTENTION', code: /^[A-Z][A-Z0-9_]{0,100}$/.test(error?.code ?? '') ? error.code : 'BATCH_STAGE_INTERRUPTED' }); }
      catch (saveError) { onError(saveError); }
    } finally { timers.clearInterval(timer); }
  }
  async function drain() {
    if (draining || stopped) return; draining = true;
    try {
      while (!stopped && active < concurrency) {
        let job = null, owner = null;
        for (const [id, staff] of owners) {
          try { job = await repository.claim(staff, randomUUID(), concurrency); }
          catch (error) { if (error?.status === 401 || error?.status === 403) owners.delete(id); onError(error); continue; }
          if (job) { owner = staff; owners.delete(id); owners.set(id, staff); break; }
        }
        if (!job) break;
        active++;
        void execute(owner, job).finally(() => { active--; if (!stopped) void drain(); });
      }
    } finally { draining = false; }
  }
  const poll = timers.setInterval(() => { if (owners.size) void drain(); }, 2000); poll?.unref?.();
  return Object.freeze({
    wake(staff) { if (stopped) return false; assertBatch(staff?.id, 'SIGN_IN_REQUIRED', 401); owners.set(staff.id, staff); void drain(); return true; },
    async tick(staff) { if (staff) owners.set(staff.id, staff); await drain(); },
    stop() { stopped = true; owners.clear(); timers.clearInterval(poll); },
    status: () => ({ active, stopped, authenticatedOwners: owners.size, observedAt: clock() }),
  });
}

export function createBatchGrading({ repository, worker, review }) {
  return Object.freeze({
    async enqueue(staff, input) { const result = await repository.enqueue(staff, parseBatchInput(input)); worker.wake(staff); return result; },
    async list(staff) { const result = await repository.list(staff); worker.wake(staff); return result; },
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
