import { randomUUID } from 'node:crypto';
import { requireThat, uuid } from './contract.mjs';

const STAGES = ['VERIFY', 'PREPARE', 'ADMIT'];
const safeCode = error => /^[A-Z][A-Z0-9_]{0,100}$/.test(error?.code ?? '') ? error.code : 'INTAKE_PROCESSING_INTERRUPTED';
const OPERATIONAL_CODES = new Set(['PHOTO_STORAGE_UNAVAILABLE', 'PHOTO_STORAGE_TIMEOUT',
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET',
  'P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2028', 'P2034']);
const OPERATIONAL_SQLSTATES = new Set(['55P03', '40P01', '40001', '57014']);
const project = row => row && ({ uploadId: row.upload_id, cardId: row.card_id, ownerId: row.owner_id,
  accessVersion: row.access_version, stage: row.stage, claimId: row.claim_id, attempts: row.attempts, failures: row.failures });

/** Called inside the original evidence transaction after locking the intake
 * card. A stale process may retain immutable artifacts but cannot adopt them. */
export async function assertIngestionLease(tx, card, uploadId, lease) {
  if (!lease) return;
  uuid(lease.claimId);
  requireThat(lease.cardId === card.id && lease.uploadId === uploadId && lease.ownerId === card.owner_id,
    409, 'INTAKE_LEASE_LOST');
  const [row] = await tx.$queryRawUnsafe(`SELECT 1 FROM atlas_manual_intake.ingestion
    WHERE upload_id=$1::uuid AND claim_id=$2::uuid AND state='RUNNING' AND lease_until>clock_timestamp()
      AND access_version=$3 FOR SHARE`, uploadId, lease.claimId, lease.accessVersion);
  requireThat(row && [card.front_upload_id, card.back_upload_id].includes(uploadId), 409, 'INTAKE_LEASE_LOST');
}

/** Only compact queue transitions run here. The injected machine boundary
 * validates deployment control on every call; per-owner authority is checked
 * again before and during the actual intake service operations. */
export function createIntakeIngestionRepository({ boundary, leaseMs = 120000 }) {
  requireThat(typeof boundary?.machineTransaction === 'function' && Number.isInteger(leaseMs)
    && leaseMs >= 1000 && leaseMs <= 300000, 500, 'INTAKE_INGESTION_CONFIG_INVALID');
  const transaction = work => boundary.machineTransaction(null, work);
  return Object.freeze({
    async claim(stage, concurrency) {
      requireThat(STAGES.includes(stage) && Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 32);
      return transaction(async ({ tx }) => {
        // Serializes only the slot decision across processes, never native work.
        await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(721930,54)');
        await tx.$executeRawUnsafe(`UPDATE atlas_manual_intake.ingestion j SET state='SUPERSEDED',claim_id=NULL,lease_until=NULL,
          code='INTAKE_SIDE_STALE',updated_at=clock_timestamp()
          WHERE (j.state='QUEUED' OR j.state='RUNNING' AND j.lease_until<=clock_timestamp())
          AND (EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=j.card_id)
            OR NOT EXISTS(SELECT 1 FROM atlas_manual_intake.card c WHERE c.id=j.card_id AND j.upload_id IN(c.front_upload_id,c.back_upload_id)))`);
        const [count] = await tx.$queryRawUnsafe(`SELECT count(*)::int AS count FROM atlas_manual_intake.ingestion
          WHERE stage=$1 AND state='RUNNING' AND lease_until>clock_timestamp()`, stage);
        if (count.count >= concurrency) return null;
        const [row] = await tx.$queryRawUnsafe(`SELECT j.* FROM atlas_manual_intake.ingestion j
          JOIN atlas_manual_intake.card c ON c.id=j.card_id AND c.owner_id=j.owner_id
          WHERE j.stage=$1 AND j.upload_id IN(c.front_upload_id,c.back_upload_id)
            AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=j.card_id)
            AND (j.state='QUEUED' AND j.available_at<=clock_timestamp() OR j.state='RUNNING' AND j.lease_until<=clock_timestamp())
          ORDER BY (SELECT max(f.last_claimed_at) FROM atlas_manual_intake.ingestion f WHERE f.owner_id=j.owner_id) NULLS FIRST,
            j.available_at,j.upload_id LIMIT 1 FOR UPDATE OF j SKIP LOCKED`, stage);
        if (!row) return null;
        const [saved] = await tx.$queryRawUnsafe(`UPDATE atlas_manual_intake.ingestion SET state='RUNNING',claim_id=$2::uuid,
          lease_until=clock_timestamp()+$3*interval '1 millisecond',attempts=attempts+1,
          last_claimed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE upload_id=$1::uuid RETURNING *`, row.upload_id, randomUUID(), leaseMs);
        return project(saved);
      });
    },
    async renew(job) {
      return transaction(async ({ tx }) => {
        const changed = await tx.$executeRawUnsafe(`UPDATE atlas_manual_intake.ingestion j
          SET lease_until=clock_timestamp()+$3*interval '1 millisecond',updated_at=clock_timestamp()
          WHERE upload_id=$1::uuid AND claim_id=$2::uuid AND state='RUNNING' AND lease_until>clock_timestamp()
            AND EXISTS(SELECT 1 FROM atlas_manual_intake.card c WHERE c.id=j.card_id AND j.upload_id IN(c.front_upload_id,c.back_upload_id))
            AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=j.card_id)`, job.uploadId, job.claimId, leaseMs);
        return changed === 1;
      });
    },
    async finish(job, outcome) {
      requireThat(['CONTINUE', 'COMPLETE', 'WAIT', 'ATTENTION'].includes(outcome?.kind));
      const delay = outcome.retryAfterMs ?? 0;
      requireThat(Number.isInteger(delay) && delay >= 0 && delay <= 3600000);
      const code = outcome.code ?? null;
      requireThat(code === null || /^[A-Z][A-Z0-9_]{0,100}$/.test(code));
      return transaction(async ({ tx }) => {
        // Match the normal evidence lock order: intake card, then queue claim.
        const [card] = await tx.$queryRawUnsafe('SELECT * FROM atlas_manual_intake.card WHERE id=$1::uuid FOR SHARE', job.cardId);
        const [saved] = await tx.$queryRawUnsafe(`SELECT * FROM atlas_manual_intake.ingestion WHERE upload_id=$1::uuid
          AND claim_id=$2::uuid AND state='RUNNING' AND lease_until>clock_timestamp() FOR UPDATE`, job.uploadId, job.claimId);
        if (!saved) return false;
        const discarded = (await tx.$queryRawUnsafe('SELECT 1 FROM atlas_manual_intake.discarded_card WHERE card_id=$1::uuid', job.cardId)).length > 0;
        const current = !discarded && [card?.front_upload_id, card?.back_upload_id].includes(job.uploadId);
        const [upload] = await tx.$queryRawUnsafe('SELECT verification,source FROM atlas_manual_intake.upload WHERE id=$1::uuid', job.uploadId);
        requireThat(outcome.kind !== 'COMPLETE' || upload?.source, 409, 'INTAKE_PHOTO_NOT_PREPARED');
        const state = !current ? 'SUPERSEDED' : outcome.kind === 'COMPLETE' ? 'COMPLETE' : outcome.kind === 'ATTENTION' ? 'ATTENTION' : 'QUEUED';
        const stage = upload?.source ? 'ADMIT' : upload?.verification ? 'PREPARE' : 'VERIFY';
        await tx.$executeRawUnsafe(`UPDATE atlas_manual_intake.ingestion SET state=$3,stage=$4,claim_id=NULL,lease_until=NULL,
          available_at=clock_timestamp()+$5*interval '1 millisecond',code=$6,
          failures=CASE WHEN $7 THEN failures+1 WHEN $8 THEN 0 ELSE failures END,updated_at=clock_timestamp()
          WHERE upload_id=$1::uuid AND claim_id=$2::uuid`, job.uploadId, job.claimId, state, stage, delay,
        !current ? discarded ? 'INTAKE_CARD_DELETED' : 'INTAKE_SIDE_STALE' : code,
        outcome.failure === true, outcome.kind === 'CONTINUE' || outcome.kind === 'COMPLETE');
        return true;
      });
    },
  });
}

/** No in-memory owner list or browser wake is needed. VERIFY and PREPARE have
 * separate global slot limits, so slow native work cannot block object pickup. */
export function createIntakeIngestionWorker({ repository, intake, authorityFor, verificationConcurrency = 4,
  preparationConcurrency = 2, admissionConcurrency = 2, intervalMs = 2000, heartbeatMs = 30000,
  timers = globalThis, random = Math.random, onError = () => {} }) {
  const limits = { VERIFY: verificationConcurrency, PREPARE: preparationConcurrency, ADMIT: admissionConcurrency };
  requireThat(repository && intake && typeof authorityFor === 'function' && Object.values(limits).every(n => Number.isInteger(n) && n >= 1 && n <= 32)
    && Number.isInteger(intervalMs) && intervalMs >= 10 && intervalMs <= 60000
    && Number.isInteger(heartbeatMs) && heartbeatMs >= 10 && heartbeatMs <= 30000, 500, 'INTAKE_INGESTION_CONFIG_INVALID');
  const tasks = new Set(), controllers = new Set(), active = { VERIFY: 0, PREPARE: 0, ADMIT: 0 };
  let stopped = true, closed = false, timer = null, cycling = null;
  const emit = error => { try { onError({ code: safeCode(error) }); } catch { /* diagnostics cannot stop recovery */ } };
  async function execute(job) {
    const controller = new AbortController(); controllers.add(controller);
    let renewal = null;
    const heartbeat = timers.setInterval(() => {
      if (renewal || controller.signal.aborted) return;
      renewal = repository.renew(job).then(ok => { if (!ok) controller.abort(Object.assign(new Error('INTAKE_LEASE_LOST'), { code: 'INTAKE_LEASE_LOST' })); })
        .catch(error => controller.abort(error)).finally(() => { renewal = null; });
    }, heartbeatMs); heartbeat?.unref?.();
    try {
      const staff = await authorityFor(job), options = { signal: controller.signal, lease: job };
      controller.signal.throwIfAborted();
      if (job.stage === 'VERIFY') await intake.complete(staff, job.cardId, job.uploadId, options);
      else await intake.prepare(staff, job.cardId, job.uploadId, options);
      controller.signal.throwIfAborted();
      await repository.finish(job, { kind: job.stage === 'VERIFY' ? 'CONTINUE' : 'COMPLETE' });
    } catch (error) {
      const code = safeCode(error), interrupted = controller.signal.aborted;
      const absent = code === 'INTAKE_UPLOAD_ABSENT';
      const capacity = ['MANUAL_PROCESSING_BUSY', 'PHOTO_STORAGE_BUSY'].includes(code);
      const permanent = [401, 403].includes(error?.status)
        || /(?:_UNSUPPORTED|_INVALID|_MISMATCH|_CONFLICT|_ACCESS_DENIED|_DELETED|_STALE|_NOT_FOUND|_LIMIT)$/.test(code);
      // A confirmed outage may last days. Its durable identity and bounded
      // backoff survive worker restarts; only unclassified interruption is capped.
      const operational = !permanent && (OPERATIONAL_CODES.has(code)
        || code === 'P2010' && OPERATIONAL_SQLSTATES.has(error?.meta?.code)
        || [408, 429, 500, 502, 503, 504].includes(error?.status));
      const retry = absent || capacity || interrupted || operational
        || code === 'INTAKE_PROCESSING_INTERRUPTED' && job.failures < 6;
      const base = capacity || interrupted ? 1000 : Math.min(60000, 1000 * 2 ** Math.min(absent ? job.attempts : job.failures, 6));
      const retryAfterMs = Math.round(base * (0.8 + random() * 0.4));
      try { await repository.finish(job, { kind: retry ? 'WAIT' : 'ATTENTION', code,
        retryAfterMs: retry ? retryAfterMs : 0, failure: retry && !absent && !capacity && !interrupted }); }
      catch (saveError) { emit(saveError); }
    } finally { timers.clearInterval(heartbeat); await renewal; controllers.delete(controller); }
  }
  async function cycle() {
    if (stopped || cycling) return cycling;
    cycling = (async () => {
      for (const stage of STAGES) {
        while (!stopped && active[stage] < limits[stage]) {
          let job;
          try { job = await repository.claim(stage, limits[stage]); } catch (error) { emit(error); break; }
          if (!job) break;
          if (stopped) { await repository.finish(job, { kind: 'WAIT', retryAfterMs: 1000 }); break; }
          active[stage]++;
          const task = execute(job).catch(emit).finally(() => {
            tasks.delete(task); active[stage]--; if (!stopped) void cycle();
          });
          tasks.add(task);
        }
      }
    })().finally(() => { cycling = null; });
    return cycling;
  }
  return Object.freeze({
    start() { if (closed || !stopped) return false; stopped = false;
      timer = timers.setInterval(() => { void cycle(); }, intervalMs); timer?.unref?.(); void cycle(); return true; },
    wake() { if (stopped) return false; void cycle(); return true; },
    tick: cycle,
    async stop() { closed = true; stopped = true; timers.clearInterval(timer);
      for (const controller of controllers) controller.abort(Object.assign(new Error('INTAKE_WORKER_STOPPED'), { code: 'INTAKE_WORKER_STOPPED' }));
      await cycling; await Promise.allSettled([...tasks]); },
    status: () => ({ stopped, active: { ...active } }),
  });
}
