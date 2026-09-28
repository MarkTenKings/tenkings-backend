import { randomUUID } from 'node:crypto';
import { requireThat, canonical, digest } from './contract.mjs';

const safeCode = error => /^[A-Z][A-Z0-9_]{0,100}$/.test(error?.code ?? '') ? error.code : 'MEMORY_PREPARATION_INTERRUPTED';
const project = row => row && ({ cardId: row.card_id, actionId: row.action_id, actorId: row.actor_id,
  accessVersion: row.access_version, claimId: row.claim_id, attempts: row.attempts, failures: row.failures });

export function createLearningPublicationRepository({ boundary, leaseMs = 120000 }) {
  requireThat(typeof boundary?.machineTransaction === 'function' && Number.isInteger(leaseMs)
    && leaseMs >= 1000 && leaseMs <= 300000, 500, 'MEMORY_WORKER_CONFIG_INVALID');
  const transaction = work => boundary.machineTransaction(null, work);
  return Object.freeze({
    async claim(concurrency = 2) {
      requireThat(Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 8);
      return transaction(async ({ tx }) => {
        const [slot] = await tx.$queryRawUnsafe('SELECT pg_try_advisory_xact_lock(721930,58) AS locked');
        if (!slot?.locked) return null; // Another scheduler owns this short turn; retry next tick.
        const [count] = await tx.$queryRawUnsafe(`SELECT count(*)::int AS count FROM atlas_manual.learning_publication_job
          WHERE state='RUNNING' AND lease_until>clock_timestamp()`);
        if (count.count >= concurrency) return null;
        const [row] = await tx.$queryRawUnsafe(`SELECT * FROM atlas_manual.learning_publication_job
          WHERE state='QUEUED' AND available_at<=clock_timestamp() OR state='RUNNING' AND lease_until<=clock_timestamp()
          ORDER BY available_at,card_id,action_id LIMIT 1 FOR UPDATE SKIP LOCKED`);
        if (!row) return null;
        const [saved] = await tx.$queryRawUnsafe(`UPDATE atlas_manual.learning_publication_job SET state='RUNNING',
          claim_id=$3::uuid,lease_until=clock_timestamp()+$4*interval '1 millisecond',attempts=attempts+1,
          updated_at=clock_timestamp() WHERE card_id=$1::uuid AND action_id=$2::uuid RETURNING *`,
        row.card_id, row.action_id, randomUUID(), leaseMs);
        return project(saved);
      });
    },
    async renew(job) {
      return transaction(async ({ tx }) => (await tx.$executeRawUnsafe(`UPDATE atlas_manual.learning_publication_job
        SET lease_until=clock_timestamp()+$4*interval '1 millisecond',updated_at=clock_timestamp()
        WHERE card_id=$1::uuid AND action_id=$2::uuid AND claim_id=$3::uuid AND state='RUNNING'
          AND lease_until>clock_timestamp()`, job.cardId, job.actionId, job.claimId, leaseMs)) === 1);
    },
    async finish(job, { state, code = null, feedback = null, retryAfterMs = 0 }) {
      requireThat(['QUEUED', 'PREPARED', 'HELD', 'SUPERSEDED'].includes(state)
        && Number.isInteger(retryAfterMs) && retryAfterMs >= 0 && retryAfterMs <= 3600000);
      requireThat(code === null || /^[A-Z][A-Z0-9_]{0,100}$/.test(code));
      if (feedback) requireThat(feedback.sha256 === digest(feedback.document)
        && canonical(JSON.parse(feedback.document), { maxBytes: 4194304 }) === feedback.document, 503, 'MEMORY_FEEDBACK_INVALID');
      return transaction(async ({ tx }) => (await tx.$executeRawUnsafe(`UPDATE atlas_manual.learning_publication_job
        SET state=$4,code=$5,feedback=COALESCE(feedback,$6),feedback_hash=COALESCE(feedback_hash,$7),
          claim_id=NULL,lease_until=NULL,available_at=clock_timestamp()+$8*interval '1 millisecond',
          failures=failures+CASE WHEN $4='QUEUED' THEN 1 ELSE 0 END,updated_at=clock_timestamp()
        WHERE card_id=$1::uuid AND action_id=$2::uuid AND claim_id=$3::uuid AND state='RUNNING'
          AND lease_until>clock_timestamp() AND ($4<>'PREPARED' OR EXISTS(SELECT 1 FROM atlas_manual.learning_publication p
            WHERE p.card_id=$1::uuid AND p.action_id=$2::uuid))`, job.cardId, job.actionId, job.claimId,
      state, code, feedback?.document ?? null, feedback?.sha256 ?? null, retryAfterMs)) === 1);
    },
  });
}

/** The authority handle comes from the captured confirmation, never a current
 * browser session or a replacement reviewer. Access revocation holds the job;
 * session expiry does not lose it. Claims/retries survive process death. */
export function createLearningPublicationWorker({ repository, prepare, authorityFor, concurrency = 2,
  intervalMs = 2000, heartbeatMs = 30000, timers = globalThis, onError = () => {} }) {
  requireThat(repository && typeof prepare === 'function' && typeof authorityFor === 'function'
    && Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 8
    && Number.isInteger(intervalMs) && intervalMs >= 10 && intervalMs <= 60000
    && Number.isInteger(heartbeatMs) && heartbeatMs >= 10 && heartbeatMs <= 30000, 500, 'MEMORY_WORKER_CONFIG_INVALID');
  let stopped = true, closed = false, timer, cycling;
  const tasks = new Set(), controllers = new Set();
  const emit = error => { try { onError({ code: safeCode(error) }); } catch { /* diagnostics cannot disable recovery */ } };
  async function execute(job) {
    const controller = new AbortController(); controllers.add(controller);
    let renewing;
    const heartbeat = timers.setInterval(() => {
      if (renewing || controller.signal.aborted) return;
      renewing = repository.renew(job).then(ok => { if (!ok) controller.abort(); })
        .catch(error => controller.abort(error)).finally(() => { renewing = null; });
    }, heartbeatMs); heartbeat?.unref?.();
    try {
      const authority = await authorityFor(job); controller.signal.throwIfAborted();
      const result = await prepare(authority, job.cardId, job.actionId, { signal: controller.signal });
      controller.signal.throwIfAborted();
      await repository.finish(job, result.publication.status === 'SUPERSEDED'
        ? { state: 'SUPERSEDED', code: 'MEMORY_CONFIRMATION_SUPERSEDED' }
        : { state: 'PREPARED', feedback: result.feedback });
    } catch (error) {
      const code = safeCode(error);
      const revoked = [401, 403].includes(error?.status);
      const stale = /(?:_STALE|_DELETED|_NOT_FOUND)$/.test(code);
      const invalid = /(?:_INVALID|_MISMATCH|_REQUIRED|_UNSUPPORTED)$/.test(code);
      const transient = !revoked && !stale && !invalid && (controller.signal.aborted
        || [408, 429, 500, 502, 503, 504].includes(error?.status)
        || /^(?:P10|P20|ECONN|ETIMEDOUT|EAI_AGAIN|PHOTO_STORAGE_)/.test(code) || job.failures < 6);
      try { await repository.finish(job, { state: stale ? 'SUPERSEDED' : transient ? 'QUEUED' : 'HELD', code,
        retryAfterMs: transient ? Math.min(300000, 1000 * 2 ** Math.min(job.failures, 8)) : 0 }); }
      catch (saveError) { emit(saveError); }
    } finally { timers.clearInterval(heartbeat); await renewing; controllers.delete(controller); }
  }
  async function cycle() {
    if (stopped || cycling) return cycling;
    cycling = (async () => {
      for (let claimed = 0; !stopped && tasks.size < concurrency && claimed < concurrency; claimed++) {
        let job; try { job = await repository.claim(concurrency); } catch (error) { emit(error); break; }
        if (!job) break;
        if (stopped) { await repository.finish(job, { state: 'QUEUED', retryAfterMs: 1000 }); break; }
        const task = execute(job).catch(emit).finally(() => { tasks.delete(task); }); tasks.add(task);
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
      for (const controller of controllers) controller.abort(); await cycling; await Promise.allSettled([...tasks]); },
    status: () => ({ stopped, active: tasks.size }),
  });
}

export function learningGrantSQL(role) {
  requireThat(/^[a-z][a-z0-9_]{0,62}$/.test(role));
  // The serving role cannot activate, alter or withdraw a release.
  return `GRANT SELECT,INSERT ON atlas_manual.learning_publication TO "${role}";\nGRANT SELECT,UPDATE ON atlas_manual.learning_publication_job TO "${role}";\nGRANT SELECT ON atlas_manual.learning_release,atlas_manual.learning_release_member,atlas_manual.learning_control,atlas_manual.learning_withdrawal TO "${role}";`;
}
