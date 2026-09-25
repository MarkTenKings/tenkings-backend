import { canonical, digest, requireThat } from '@atlas/manual-service/contract';
import { BATCH_POLICY, BATCH_STAGES, BATCH_RATE_LIMIT_RETRIES, batchAnalysisActionId, parseBatchInput } from './index.mjs';

function admission(card) {
  const key = digest(canonical([BATCH_POLICY, card.cardId, card.sourceHash]));
  const input = canonical({ policy: BATCH_POLICY, cardId: card.cardId, sourceHash: card.sourceHash, label: card.label,
    uploads: Object.fromEntries(['FRONT', 'BACK'].map(side => [side, card.sides[side].upload.uploadId])) });
  return { key, cardId: card.cardId, sourceHash: card.sourceHash, analysisActionId: batchAnalysisActionId(key), input, inputHash: digest(input) };
}

/** Called only inside the intake source-commit transaction, after its current
 * pair/owner/deletion checks and while its card lock is held. A lost response
 * or worker restart cannot separate the second prepared source from its job.
 * This admits machine preparation, never a human review or paid dispatch. */
export async function recordBatchPreparedPair({ tx, principal, card }) {
  requireThat(principal?.role === 'REVIEWER' && card?.ready && card.cardId && card.sourceHash, 409, 'BATCH_PHOTOS_CHANGED');
  const row = admission(card);
  // Source replay holds the intake card lock. Never wait for an existing batch
  // row here: its worker takes batch then intake locks in the opposite order.
  const [existing] = await tx.$queryRawUnsafe('SELECT key,actor_id,card_id,source_hash,analysis_action_id FROM atlas_manual_connected.batch_grading WHERE key=$1', row.key);
  if (existing) {
    requireThat(existing.actor_id === principal.id && existing.card_id === row.cardId && existing.source_hash === row.sourceHash,
      409, 'BATCH_ACCESS_CHANGED');
    return { key: row.key, analysisActionId: existing.analysis_action_id };
  }
  await tx.$executeRawUnsafe(`INSERT INTO atlas_manual_connected.batch_grading
    (key,card_id,source_hash,actor_id,access_version,analysis_action_id,input,input_hash)
    VALUES($1,$2::uuid,$3,$4::uuid,$5,$6::uuid,$7,$8) ON CONFLICT(key) DO NOTHING`,
  row.key, row.cardId, row.sourceHash, principal.id, principal.accessVersion, row.analysisActionId, row.input, row.inputHash);
  return { key: row.key, analysisActionId: row.analysisActionId };
}

// A terminal receipt can arrive after a network exception parked the job. Only
// a READY result for this exact action and unchanged manual draft is eligible;
// the ordinary analysis reader still verifies all immutable result artifacts.
const readyReceipt = `EXISTS(SELECT 1 FROM atlas_defect_analysis.run r
  JOIN atlas_defect_analysis.receipt p ON p.analysis_id=r.id AND p.kind='RESPONSE'
  WHERE r.card_id=j.card_id AND r.action_id=j.analysis_action_id AND r.actor_id=j.actor_id
    AND p.evidence::jsonb->>'state'='READY')`;
const rateLimitReceipt = `EXISTS(SELECT 1 FROM atlas_defect_analysis.run r
  JOIN atlas_defect_analysis.receipt p ON p.analysis_id=r.id AND p.kind='RESPONSE'
  WHERE r.card_id=j.card_id AND r.action_id=j.analysis_action_id AND r.actor_id=j.actor_id
    AND p.evidence::jsonb->>'state'='REFUSED' AND p.evidence::jsonb->>'httpStatus'='429'
    AND p.evidence::jsonb->>'code'='DEFECT_ANALYSIS_PROVIDER_HTTP_ERROR'
    AND p.evidence::jsonb->>'responseId' IS NULL
    AND NOT EXISTS(SELECT 1 FROM atlas_defect_analysis.provider_event e WHERE e.analysis_id=r.id AND e.kind='ACCEPTED'))`;
const recoverableReceipt = `(j.state='NEEDS_ATTENTION' AND j.stage='ANALYZE'
  AND j.code NOT IN ('BATCH_HUMAN_WORK_PRESENT','BATCH_MANUAL_DRAFT_CHANGED','BATCH_PHOTOS_CHANGED','BATCH_ACCESS_CHANGED','INTAKE_CARD_DELETED')
  AND (${readyReceipt} OR (j.analysis_attempt<${BATCH_RATE_LIMIT_RETRIES} AND ${rateLimitReceipt}))
  AND EXISTS(SELECT 1 FROM atlas_manual.card m WHERE m.id=j.card_id AND m.owner_id=j.actor_id
    AND m.content_hash=j.evidence::jsonb->>'manualContentHash'
    AND m.revision::text=j.evidence::jsonb->>'manualRevision')
  AND NOT EXISTS(SELECT 1 FROM atlas_manual_connected.batch_review v WHERE v.job_key=j.key))`;
const due = `((j.state='QUEUED' AND j.available_at<=clock_timestamp())
  OR (j.state='RUNNING' AND j.lease_until<=clock_timestamp()) OR ${recoverableReceipt})`;

function project(row) {
  if (!row) return null;
  requireThat(row.input_hash === digest(row.input), 503, 'BATCH_STORED_CONTENT_INVALID');
  const input = JSON.parse(row.input);
  const attempt = row.analysis_attempt ?? 0, evidence = row.evidence ? JSON.parse(row.evidence) : {};
  requireThat(input.cardId === row.card_id && input.sourceHash === row.source_hash && input.policy === BATCH_POLICY
    && digest(canonical([BATCH_POLICY, row.card_id, row.source_hash])) === row.key
    && row.analysis_action_id === batchAnalysisActionId(row.key, attempt)
    && (attempt === 0 || Array.isArray(evidence.analysisActions) && evidence.analysisActions.length === attempt
      && evidence.analysisActions.every((id, index) => id === batchAnalysisActionId(row.key, index))), 503, 'BATCH_STORED_CONTENT_INVALID');
  return { key: row.key, cardId: row.card_id, sourceHash: row.source_hash, label: input.label,
    uploads: input.uploads, stage: row.stage, state: row.state, revision: row.revision, claimId: row.claim_id,
    evidence, code: row.code, attempts: row.attempts, analysisAttempt: attempt,
    analysisActionId: row.analysis_action_id, createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString() };
}
const safeRow = row => {
  const { claimId, ...result } = project(row);
  result.canResumeProcessing = false;
  // Approval is read from the existing exact human authority, never asserted
  // by the worker. A changed manual draft must not show an old proposed score.
  if (row.photos_changed === true) return { ...result, state: 'SUPERSEDED', code: 'BATCH_PHOTOS_CHANGED', evidence: {} };
  if (row.current_approval === true) return { ...result, state: 'APPROVED', evidence: {} };
  if (row.access_changed === true && accessResumeAvailable(row))
    return { ...result, state: 'NEEDS_ATTENTION', code: 'BATCH_ACCESS_CHANGED', evidence: {}, canResumeProcessing: canResume(row) };
  if (row.manual_changed === true && row.review_started === true && result.state === 'REVIEW')
    return { ...result, resumeAvailable: true, evidence: { name: result.evidence.name }, code: 'BATCH_REVIEW_IN_PROGRESS' };
  if (row.manual_changed === true && result.state === 'REVIEW') return { ...result, state: 'NEEDS_ATTENTION', code: 'BATCH_MANUAL_DRAFT_CHANGED', evidence: {} };
  return { ...result, canResumeProcessing: canResume(row) };
};
// A fresh authenticated session may explicitly resume its own saved work, but
// cannot take a still-live claim. REVIEW must retain its report and any partial
// human-review receipts rather than sending those findings through the worker.
const accessResumeAvailable = row => ['QUEUED', 'NEEDS_ATTENTION', 'REVIEW'].includes(row.state)
  || (row.state === 'RUNNING' && row.lease_active === false);
const canResume = row => Boolean(!row.current_approval && !row.photos_changed
  && (row.state === 'NEEDS_ATTENTION' || (row.access_changed && accessResumeAvailable(row)))
  && (row.state === 'REVIEW' || (!row.review_started
    && row.code !== 'BATCH_HUMAN_WORK_PRESENT'
    && (row.stage === 'PREPARE' || !row.manual_changed))));

/** All calls run through the existing ordinary staff boundary. No worker DB
 * credential can borrow a human review, publication or certification action. */
export function createBatchRepository({ boundary, intakeRepository }) {
  let discoveryCursor = null;
  async function source(tx, principal, row, lock = '') {
    const card = await intakeRepository.authorizeInTransaction(tx, principal, row.card_id, { edit: true, lock });
    requireThat(card.ready && card.sourceHash === row.source_hash, 409, 'BATCH_PHOTOS_CHANGED');
    requireThat(row.actor_id === principal.id && row.access_version === principal.accessVersion, 403, 'BATCH_ACCESS_CHANGED');
    return card;
  }
  async function owned(tx, principal, key, lock = '') {
    const [row] = await tx.$queryRawUnsafe(`SELECT *,lease_until>clock_timestamp() AS lease_active FROM atlas_manual_connected.batch_grading WHERE key=$1${lock ? ' FOR UPDATE' : ''}`, key);
    requireThat(row && row.actor_id === principal.id, 404, 'BATCH_NOT_FOUND'); return row;
  }
  async function releaseDiscarded(tx, row, claimId) {
    const [card] = await tx.$queryRawUnsafe('SELECT id FROM atlas_manual_intake.card WHERE id=$1::uuid FOR SHARE', row.card_id);
    const deleted = card && (await tx.$queryRawUnsafe('SELECT 1 FROM atlas_manual_intake.discarded_card WHERE card_id=$1::uuid', row.card_id)).length;
    if (!deleted) return false;
    await tx.$executeRawUnsafe(`UPDATE atlas_manual_connected.batch_grading SET state='NEEDS_ATTENTION',code='INTAKE_CARD_DELETED',
      claim_id=NULL,lease_until=NULL,revision=revision+1,updated_at=clock_timestamp()
      WHERE key=$1 AND state='RUNNING' AND claim_id=$2::uuid`, row.key, claimId);
    return true;
  }
  return Object.freeze({
    ...(boundary.machineTransaction && boundary.machineOwner ? {
      async discoverOwners() {
        const owners = await boundary.machineTransaction(null, async ({ tx }) => tx.$queryRawUnsafe(`
          WITH pending AS (SELECT DISTINCT j.actor_id,j.access_version FROM atlas_manual_connected.batch_grading j
            WHERE ${due} AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=j.card_id)),
          owners AS (SELECT all_jobs.actor_id,all_jobs.access_version,MAX(all_jobs.updated_at) AS last_served
            FROM atlas_manual_connected.batch_grading all_jobs JOIN pending p
              ON p.actor_id=all_jobs.actor_id AND p.access_version=all_jobs.access_version
            GROUP BY all_jobs.actor_id,all_jobs.access_version)
          SELECT * FROM owners WHERE $1::timestamptz IS NULL OR (last_served,actor_id,access_version)>($1::timestamptz,$2::uuid,$3::integer)
          ORDER BY last_served,actor_id,access_version LIMIT 128`, discoveryCursor?.lastServed ?? null,
        discoveryCursor?.actorId ?? null, discoveryCursor?.accessVersion ?? null));
        discoveryCursor = owners.length === 128 ? { lastServed: new Date(owners.at(-1).last_served).toISOString(),
          actorId: owners.at(-1).actor_id, accessVersion: owners.at(-1).access_version } : null;
        const handles = [];
        for (const owner of owners) {
          try { handles.push(await boundary.machineOwner({ ownerId: owner.actor_id, accessVersion: owner.access_version })); }
          catch (error) { if (![401,403].includes(error?.status)) throw error; }
        }
        return handles;
      },
    } : {}),
    async readReview(staff, key) {
      requireThat(/^[a-f0-9]{64}$/.test(key));
      return boundary.transaction(staff, async ({ tx, principal }) => {
        const row = await owned(tx, principal, key); await source(tx, principal, row);
        const [review] = await tx.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.batch_review WHERE job_key=$1', key);
        if(review)requireThat(review.actor_id===principal.id && digest(review.input)===review.input_hash,409,'BATCH_REVIEW_BINDING_CHANGED');
        return { job: project(row), review: review ? JSON.parse(review.input) : null, canCertify: principal.canCertify };
      });
    },
    async beginReview(staff, key, input) {
      const text=canonical(input,{maxBytes:4096}), inputHash=digest(text);
      return boundary.transaction(staff, async ({ tx, principal }) => {
        const row=await owned(tx,principal,key,'UPDATE');await source(tx,principal,row,'SHARE');
        requireThat(principal.canCertify,403,'MANUAL_CERTIFICATION_REQUIRED');
        const [existing]=await tx.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.batch_review WHERE job_key=$1',key);
        if(existing){requireThat(existing.actor_id===principal.id && existing.input_hash===inputHash && digest(existing.input)===inputHash,409,'BATCH_REVIEW_BINDING_CHANGED');return JSON.parse(existing.input);}
        requireThat(principal.canCertify,403,'MANUAL_CERTIFICATION_REQUIRED');
        const job=project(row);
        requireThat(job.state==='REVIEW' && job.evidence.reportHash===input.reportHash,409,'BATCH_REVIEW_STALE');
        const [manual]=await tx.$queryRawUnsafe('SELECT revision,content_hash FROM atlas_manual.card WHERE id=$1::uuid FOR SHARE',job.cardId);
        requireThat(manual?.revision===job.evidence.manualRevision && manual.content_hash===job.evidence.manualContentHash,409,'BATCH_REVIEW_STALE');
        await tx.$executeRawUnsafe('INSERT INTO atlas_manual_connected.batch_review(job_key,actor_id,input,input_hash) VALUES($1,$2::uuid,$3,$4)',key,principal.id,text,inputHash);
        return JSON.parse(text);
      });
    },
    async enqueue(staff, input) {
      input = parseBatchInput(input);
      const requestHash = digest(canonical(input));
      return boundary.transaction(staff, async ({ tx, principal }) => {
        requireThat(principal.role === 'REVIEWER', 403, 'BATCH_ACCESS_DENIED');
        const [prior] = await tx.$queryRawUnsafe('SELECT request_hash FROM atlas_manual_connected.batch_request WHERE actor_id=$1::uuid AND action_id=$2::uuid', principal.id, input.actionId);
        requireThat(!prior || prior.request_hash === requestHash, 409, 'BATCH_ACTION_CONFLICT');
        const rows = [];
        // Stable lock order avoids overlapping batches acquiring card locks in
        // opposite order. All selected pairs must remain current at commit.
        for (const entry of [...input.cards].sort((a, b) => a.cardId.localeCompare(b.cardId))) {
          const card = await intakeRepository.authorizeInTransaction(tx, principal, entry.cardId, { edit: true, lock: 'SHARE' });
          requireThat(card.ready && card.sourceHash === entry.sourceHash, 409, 'BATCH_PHOTOS_CHANGED');
          rows.push(admission(card));
        }
        await tx.$executeRawUnsafe(`INSERT INTO atlas_manual_connected.batch_request(actor_id,action_id,request_hash)
          VALUES($1::uuid,$2::uuid,$3) ON CONFLICT DO NOTHING`, principal.id, input.actionId, requestHash);
        const [receipt] = await tx.$queryRawUnsafe('SELECT request_hash FROM atlas_manual_connected.batch_request WHERE actor_id=$1::uuid AND action_id=$2::uuid', principal.id, input.actionId);
        requireThat(receipt?.request_hash === requestHash, 409, 'BATCH_ACTION_CONFLICT');
        await tx.$executeRawUnsafe(`INSERT INTO atlas_manual_connected.batch_grading(key,card_id,source_hash,actor_id,access_version,analysis_action_id,input,input_hash)
          SELECT x.key,x."cardId"::uuid,x."sourceHash",$1::uuid,$2,x."analysisActionId"::uuid,x.input,x."inputHash"
          FROM jsonb_to_recordset($3::jsonb) AS x(key text,"cardId" text,"sourceHash" text,"analysisActionId" text,input text,"inputHash" text)
          ON CONFLICT(key) DO NOTHING`, principal.id, principal.accessVersion, JSON.stringify(rows));
        const saved = await tx.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.batch_grading WHERE actor_id=$1::uuid AND key=ANY($2::text[]) ORDER BY created_at,key', principal.id, rows.map(row => row.key));
        requireThat(saved.length === rows.length, 409, 'BATCH_ACCESS_CHANGED');
        return { jobs: saved.map(safeRow) };
      });
    },
    async list(staff) {
      return boundary.transaction(staff, async ({ tx, principal }) => {
        const rows = await tx.$queryRawUnsafe(`SELECT * FROM (SELECT j.*,
          (j.access_version<>$2) AS access_changed,(j.lease_until>clock_timestamp()) AS lease_active,
          EXISTS(SELECT 1 FROM atlas_manual.approval a WHERE a.card_id=m.id AND a.source_hash=m.content_hash
            AND m.content::jsonb->'source'->>'sourceHash'=j.source_hash) AS current_approval,
          (m.content_hash IS NOT NULL AND m.content_hash IS DISTINCT FROM j.evidence::jsonb->>'manualContentHash') AS manual_changed,
          EXISTS(SELECT 1 FROM atlas_manual_connected.batch_review r WHERE r.job_key=j.key AND r.actor_id=j.actor_id) AS review_started,
          (c.front_upload_id::text IS DISTINCT FROM j.input::jsonb->'uploads'->>'FRONT'
            OR c.back_upload_id::text IS DISTINCT FROM j.input::jsonb->'uploads'->>'BACK') AS photos_changed
          FROM atlas_manual_connected.batch_grading j
          JOIN atlas_manual_intake.card c ON c.id=j.card_id AND c.owner_id=j.actor_id
          LEFT JOIN atlas_manual.card m ON m.id=j.card_id
          WHERE j.actor_id=$1::uuid
          AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=j.card_id)) visible
          ORDER BY current_approval,
            CASE WHEN access_changed AND (state IN ('QUEUED','NEEDS_ATTENTION','REVIEW') OR (state='RUNNING' AND NOT lease_active)) THEN 1
              ELSE CASE state WHEN 'REVIEW' THEN 0 WHEN 'NEEDS_ATTENTION' THEN 1 WHEN 'RUNNING' THEN 2 WHEN 'QUEUED' THEN 3 ELSE 4 END END,
            CASE WHEN current_approval THEN created_at END DESC,created_at,key LIMIT 250`, principal.id, principal.accessVersion);
        return { jobs: rows.map(safeRow) };
      });
    },
    async claim(staff, claimId, concurrency, analysisConcurrency = concurrency) {
      requireThat(Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 128
        && Number.isInteger(analysisConcurrency) && analysisConcurrency >= 1 && analysisConcurrency <= 128, 500, 'BATCH_CONFIG_INVALID');
      return boundary.transaction(staff, async ({ tx, principal }) => {
        requireThat(principal.role === 'REVIEWER', 403, 'BATCH_ACCESS_DENIED');
        // A process-local pool cannot cap multiple service instances. This
        // short database lock owns the actual shared execution-slot decision.
        await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(721930,45)');
        // A deleted worker may have crashed before its next heartbeat. Retire
        // only its expired local lease; the following receipt-based accounting
        // still protects every dispatched/uncertain provider reservation.
        await tx.$executeRawUnsafe(`UPDATE atlas_manual_connected.batch_grading j
          SET state='NEEDS_ATTENTION',code='INTAKE_CARD_DELETED',claim_id=NULL,lease_until=NULL,
            revision=revision+1,updated_at=clock_timestamp()
          WHERE j.state='RUNNING' AND j.lease_until<=clock_timestamp()
            AND EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=j.card_id)`);
        // Provider background work outlives ordinary worker leases. Its slot
        // remains reserved across WAIT, crashes and uncertain dispatch until
        // the existing immutable provider journal proves completion/refusal.
        await tx.$executeRawUnsafe(`UPDATE atlas_manual_connected.batch_grading j SET analysis_reserved=false
          WHERE j.analysis_reserved AND (
            EXISTS(SELECT 1 FROM atlas_defect_analysis.run r JOIN atlas_defect_analysis.receipt p ON p.analysis_id=r.id AND p.kind='RESPONSE'
              WHERE r.card_id=j.card_id AND r.action_id=j.analysis_action_id)
            OR EXISTS(SELECT 1 FROM atlas_defect_analysis.request_refusal r WHERE r.card_id=j.card_id AND r.action_id=j.analysis_action_id)
            OR (j.state IN ('NEEDS_ATTENTION','SUPERSEDED') AND NOT EXISTS(SELECT 1 FROM atlas_defect_analysis.run r
              WHERE r.card_id=j.card_id AND r.action_id=j.analysis_action_id AND r.state='DISPATCHED'))) `);
        const [reserved] = await tx.$queryRawUnsafe('SELECT count(*)::int AS count FROM atlas_manual_connected.batch_grading WHERE analysis_reserved');
        const [count] = await tx.$queryRawUnsafe("SELECT count(*)::int AS count FROM atlas_manual_connected.batch_grading WHERE state='RUNNING' AND lease_until>clock_timestamp()");
        if (count.count >= concurrency) return null;
        const rows = await tx.$queryRawUnsafe(`SELECT j.*,${readyReceipt} AS analysis_ready FROM atlas_manual_connected.batch_grading j
          WHERE NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=j.card_id)
          AND actor_id=$1::uuid AND access_version=$2 AND ${due}
          AND (stage<>'ANALYZE' OR analysis_reserved OR ${readyReceipt} OR $3::boolean)
          ORDER BY available_at,created_at,key LIMIT 1 FOR UPDATE SKIP LOCKED`, principal.id, principal.accessVersion, reserved.count < analysisConcurrency);
        if (!rows.length) return null;
        const row = rows[0];
        try { await source(tx, principal, row, 'SHARE'); }
        catch (error) {
          if (error?.code === 'INTAKE_CARD_DELETED') return null;
          if (!['BATCH_PHOTOS_CHANGED', 'BATCH_ACCESS_CHANGED'].includes(error?.code)) throw error;
          await tx.$executeRawUnsafe("UPDATE atlas_manual_connected.batch_grading SET state='SUPERSEDED',claim_id=NULL,lease_until=NULL,code=$2,revision=revision+1,updated_at=clock_timestamp() WHERE key=$1", row.key, error.code);
          return null;
        }
        const [saved] = await tx.$queryRawUnsafe(`UPDATE atlas_manual_connected.batch_grading SET state='RUNNING',claim_id=$2::uuid,
          lease_until=clock_timestamp()+interval '2 minutes',analysis_reserved=(analysis_reserved OR (stage='ANALYZE' AND NOT $3::boolean)),
          attempts=attempts+1,revision=revision+1,code=NULL,updated_at=clock_timestamp() WHERE key=$1 RETURNING *`, row.key, claimId, row.analysis_ready);
        return project(saved);
      });
    },
    async renew(staff, job) {
      return boundary.transaction(staff, async ({ tx, principal }) => {
        const row = await owned(tx, principal, job.key, 'UPDATE');
        if (await releaseDiscarded(tx, row, job.claimId)) return false;
        await source(tx, principal, row, 'SHARE');
        const count = await tx.$executeRawUnsafe(`UPDATE atlas_manual_connected.batch_grading SET lease_until=clock_timestamp()+interval '2 minutes'
          WHERE key=$1 AND state='RUNNING' AND claim_id=$2::uuid AND lease_until>clock_timestamp()`, job.key, job.claimId);
        return count === 1;
      });
    },
    async finish(staff, job, outcome) {
      return boundary.transaction(staff, async ({ tx, principal }) => {
        const row = await owned(tx, principal, job.key, 'UPDATE');
        if (await releaseDiscarded(tx, row, job.claimId)) return false;
        await source(tx, principal, row, 'SHARE');
        const old = project(row);
        let state = ({ CONTINUE: 'QUEUED', WAIT: 'QUEUED', REVIEW: 'REVIEW', ATTENTION: 'NEEDS_ATTENTION', RETRY_ANALYSIS: 'QUEUED' })[outcome.kind];
        requireThat(state && old.stage === job.stage, 409, 'BATCH_STAGE_STALE');
        if (row.state !== 'RUNNING' || row.claim_id !== job.claimId || row.lease_active !== true) return false;
        const stage = outcome.kind === 'CONTINUE' ? BATCH_STAGES[BATCH_STAGES.indexOf(old.stage) + 1] : old.stage;
        requireThat(stage, 409, 'BATCH_STAGE_STALE');
        let analysisAttempt = old.analysisAttempt, analysisActionId = old.analysisActionId;
        const nextEvidence = { ...old.evidence, ...(outcome.evidence ?? {}) };
        if (outcome.kind === 'RETRY_ANALYSIS') {
          requireThat(stage === 'ANALYZE' && analysisAttempt < BATCH_RATE_LIMIT_RETRIES, 409, 'BATCH_RATE_LIMIT_RETRY_EXHAUSTED');
          const [refusal] = await tx.$queryRawUnsafe(`SELECT ${rateLimitReceipt} AS eligible
            FROM atlas_manual_connected.batch_grading j WHERE j.key=$1`, job.key);
          requireThat(refusal?.eligible, 409, 'BATCH_RATE_LIMIT_RETRY_UNPROVEN');
          nextEvidence.analysisActions = [...(old.evidence.analysisActions ?? []), old.analysisActionId];
          analysisActionId = batchAnalysisActionId(job.key, ++analysisAttempt);
        }
        const evidence = canonical(nextEvidence, { maxBytes: 65536 });
        const delay = outcome.kind === 'RETRY_ANALYSIS' ? Math.min(60000, 30000 * 2 ** (analysisAttempt - 1))
          : outcome.kind === 'WAIT' ? Math.max(2000, Math.min(60000, outcome.retryAfterMs ?? 3000)) : 0;
        const changed = await tx.$executeRawUnsafe(`UPDATE atlas_manual_connected.batch_grading SET state=$3,stage=$4,evidence=$5,code=$6,
          claim_id=NULL,lease_until=NULL,analysis_reserved=CASE WHEN stage='ANALYZE' AND ($4='REPORT' OR analysis_action_id<>$8::uuid) THEN false ELSE analysis_reserved END,
          analysis_action_id=$8::uuid,analysis_attempt=$9,
          revision=revision+1,available_at=clock_timestamp()+$7::integer*interval '1 millisecond',updated_at=clock_timestamp()
          WHERE key=$1 AND state='RUNNING' AND claim_id=$2::uuid AND lease_until>clock_timestamp()`, job.key, job.claimId, state, stage, evidence, outcome.code ?? null, delay, analysisActionId, analysisAttempt);
        return changed === 1;
      });
    },
    async resume(staff, { key, expectedRevision }) {
      return boundary.transaction(staff, async ({ tx, principal }) => {
        const row = await owned(tx, principal, key, 'UPDATE'); await source(tx, principal, { ...row, access_version: principal.accessVersion }, 'SHARE');
        const accessChanged = row.access_version !== principal.accessVersion && accessResumeAvailable(row);
        requireThat(row.revision === expectedRevision && (row.state === 'NEEDS_ATTENTION' || accessChanged), 409, 'BATCH_RESUME_STALE');
        const [manual] = await tx.$queryRawUnsafe(`SELECT m.content_hash,
          EXISTS(SELECT 1 FROM atlas_manual.approval a WHERE a.card_id=m.id AND a.source_hash=m.content_hash) AS current_approval
          FROM atlas_manual.card m WHERE m.id=$1::uuid FOR SHARE`, row.card_id);
        requireThat(!manual?.current_approval, 409, 'BATCH_ALREADY_APPROVED');
        const [review] = await tx.$queryRawUnsafe('SELECT job_key FROM atlas_manual_connected.batch_review WHERE job_key=$1', key);
        const evidence = row.evidence ? JSON.parse(row.evidence) : {};
        requireThat(canResume({ ...row, access_changed: accessChanged, review_started: Boolean(review),
          manual_changed: Boolean(manual?.content_hash && manual.content_hash !== evidence.manualContentHash) }),
        409, 'BATCH_CONTINUE_MANUAL_REVIEW');
        const [saved] = await tx.$queryRawUnsafe(`UPDATE atlas_manual_connected.batch_grading SET state=$3,code=NULL,
          claim_id=NULL,lease_until=NULL,access_version=$2,revision=revision+1,available_at=clock_timestamp(),updated_at=clock_timestamp()
          WHERE key=$1 RETURNING *`, key, principal.accessVersion, row.state === 'REVIEW' ? 'REVIEW' : 'QUEUED');
        return { job: safeRow(saved) };
      });
    },
  });
}

export function batchGrantSQL(role) {
  requireThat(/^[a-z][a-z0-9_]{0,62}$/.test(role));
  return `GRANT SELECT,INSERT ON atlas_manual_connected.batch_request,atlas_manual_connected.batch_grading,atlas_manual_connected.batch_review TO "${role}";\nGRANT UPDATE(state,stage,evidence,code,claim_id,lease_until,revision,available_at,updated_at,attempts,access_version,analysis_reserved,analysis_action_id,analysis_attempt) ON atlas_manual_connected.batch_grading TO "${role}";\nGRANT USAGE ON SCHEMA atlas_defect_analysis TO "${role}";\nGRANT SELECT ON atlas_defect_analysis.run,atlas_defect_analysis.receipt,atlas_defect_analysis.request_refusal,atlas_defect_analysis.provider_event TO "${role}";`;
}
