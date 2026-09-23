import { canonical, digest, requireThat } from '@atlas/manual-service/contract';
import { BATCH_POLICY, BATCH_STAGES, batchActionId, parseBatchInput } from './index.mjs';

function project(row) {
  if (!row) return null;
  requireThat(row.input_hash === digest(row.input), 503, 'BATCH_STORED_CONTENT_INVALID');
  const input = JSON.parse(row.input);
  requireThat(input.cardId === row.card_id && input.sourceHash === row.source_hash && input.policy === BATCH_POLICY
    && digest(canonical([BATCH_POLICY, row.card_id, row.source_hash])) === row.key
    && row.analysis_action_id === batchActionId(row.key, 'ANALYZE'), 503, 'BATCH_STORED_CONTENT_INVALID');
  return { key: row.key, cardId: row.card_id, sourceHash: row.source_hash, label: input.label,
    uploads: input.uploads, stage: row.stage, state: row.state, revision: row.revision, claimId: row.claim_id,
    evidence: row.evidence ? JSON.parse(row.evidence) : {}, code: row.code, attempts: row.attempts,
    analysisActionId: batchActionId(row.key, 'ANALYZE'), createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString() };
}
const safeRow = row => {
  const { claimId, ...result } = project(row);
  // Approval is read from the existing exact human authority, never asserted
  // by the worker. A changed manual draft must not show an old proposed score.
  if (row.photos_changed === true) return { ...result, state: 'SUPERSEDED', code: 'BATCH_PHOTOS_CHANGED', evidence: {} };
  if (row.current_approval === true) return { ...result, state: 'APPROVED', evidence: {} };
  if (row.manual_changed === true && row.review_started === true && result.state === 'REVIEW')
    return { ...result, resumeAvailable: true, evidence: { name: result.evidence.name }, code: 'BATCH_REVIEW_IN_PROGRESS' };
  if (row.manual_changed === true && result.state === 'REVIEW') return { ...result, state: 'NEEDS_ATTENTION', code: 'BATCH_MANUAL_DRAFT_CHANGED', evidence: {} };
  return result;
};

/** All calls run through the existing ordinary staff boundary. No worker DB
 * credential can borrow a human review, publication or certification action. */
export function createBatchRepository({ boundary, intakeRepository }) {
  async function source(tx, principal, row, lock = '') {
    const card = await intakeRepository.authorizeInTransaction(tx, principal, row.card_id, { edit: true, lock });
    requireThat(card.ready && card.sourceHash === row.source_hash, 409, 'BATCH_PHOTOS_CHANGED');
    requireThat(row.actor_id === principal.id && row.access_version === principal.accessVersion, 403, 'BATCH_ACCESS_CHANGED');
    return card;
  }
  async function owned(tx, principal, key, lock = '') {
    const [row] = await tx.$queryRawUnsafe(`SELECT * FROM atlas_manual_connected.batch_grading WHERE key=$1${lock ? ' FOR UPDATE' : ''}`, key);
    requireThat(row && row.actor_id === principal.id, 404, 'BATCH_NOT_FOUND'); return row;
  }
  return Object.freeze({
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
          const key = digest(canonical([BATCH_POLICY, card.cardId, card.sourceHash]));
          const value = canonical({ policy: BATCH_POLICY, cardId: card.cardId, sourceHash: card.sourceHash, label: card.label,
            uploads: Object.fromEntries(['FRONT', 'BACK'].map(side => [side, card.sides[side].upload.uploadId])) });
          rows.push({ key, cardId: card.cardId, sourceHash: card.sourceHash, analysisActionId: batchActionId(key, 'ANALYZE'), input: value, inputHash: digest(value) });
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
          EXISTS(SELECT 1 FROM atlas_manual.approval a WHERE a.card_id=m.id AND a.source_hash=m.content_hash
            AND m.content::jsonb->'source'->>'sourceHash'=j.source_hash) AS current_approval,
          (m.content_hash IS NOT NULL AND m.content_hash IS DISTINCT FROM j.evidence::jsonb->>'manualContentHash') AS manual_changed,
          EXISTS(SELECT 1 FROM atlas_manual_connected.batch_review r WHERE r.job_key=j.key AND r.actor_id=j.actor_id) AS review_started,
          (c.front_upload_id::text IS DISTINCT FROM j.input::jsonb->'uploads'->>'FRONT'
            OR c.back_upload_id::text IS DISTINCT FROM j.input::jsonb->'uploads'->>'BACK') AS photos_changed
          FROM atlas_manual_connected.batch_grading j
          JOIN atlas_manual_intake.card c ON c.id=j.card_id AND c.owner_id=j.actor_id
          LEFT JOIN atlas_manual.card m ON m.id=j.card_id
          WHERE j.actor_id=$1::uuid) visible
          ORDER BY current_approval,
            CASE state WHEN 'REVIEW' THEN 0 WHEN 'NEEDS_ATTENTION' THEN 1 WHEN 'RUNNING' THEN 2 WHEN 'QUEUED' THEN 3 ELSE 4 END,
            CASE WHEN current_approval THEN created_at END DESC,created_at,key LIMIT 250`, principal.id);
        return { jobs: rows.map(safeRow) };
      });
    },
    async claim(staff, claimId, concurrency) {
      return boundary.transaction(staff, async ({ tx, principal }) => {
        requireThat(principal.role === 'REVIEWER', 403, 'BATCH_ACCESS_DENIED');
        // A process-local pool cannot cap multiple service instances. This
        // short database lock owns the actual shared execution-slot decision.
        await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(721930,45)');
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
        const rows = await tx.$queryRawUnsafe(`SELECT * FROM atlas_manual_connected.batch_grading
          WHERE actor_id=$1::uuid AND access_version=$2 AND ((state='QUEUED' AND available_at<=clock_timestamp())
          OR (state='RUNNING' AND lease_until<=clock_timestamp()))
          AND (stage<>'ANALYZE' OR analysis_reserved OR $3::boolean) ORDER BY created_at,key LIMIT 1 FOR UPDATE SKIP LOCKED`, principal.id, principal.accessVersion, reserved.count < concurrency);
        if (!rows.length) return null;
        const row = rows[0];
        try { await source(tx, principal, row, 'SHARE'); }
        catch (error) {
          if (!['BATCH_PHOTOS_CHANGED', 'BATCH_ACCESS_CHANGED'].includes(error?.code)) throw error;
          await tx.$executeRawUnsafe("UPDATE atlas_manual_connected.batch_grading SET state='SUPERSEDED',claim_id=NULL,lease_until=NULL,code=$2,revision=revision+1,updated_at=clock_timestamp() WHERE key=$1", row.key, error.code);
          return null;
        }
        const [saved] = await tx.$queryRawUnsafe(`UPDATE atlas_manual_connected.batch_grading SET state='RUNNING',claim_id=$2::uuid,
          lease_until=clock_timestamp()+interval '2 minutes',analysis_reserved=(analysis_reserved OR stage='ANALYZE'),
          attempts=attempts+1,revision=revision+1,code=NULL,updated_at=clock_timestamp() WHERE key=$1 RETURNING *`, row.key, claimId);
        return project(saved);
      });
    },
    async renew(staff, job) {
      return boundary.transaction(staff, async ({ tx, principal }) => {
        const row = await owned(tx, principal, job.key, 'UPDATE'); await source(tx, principal, row, 'SHARE');
        const count = await tx.$executeRawUnsafe(`UPDATE atlas_manual_connected.batch_grading SET lease_until=clock_timestamp()+interval '2 minutes'
          WHERE key=$1 AND state='RUNNING' AND claim_id=$2::uuid AND lease_until>clock_timestamp()`, job.key, job.claimId);
        return count === 1;
      });
    },
    async finish(staff, job, outcome) {
      return boundary.transaction(staff, async ({ tx, principal }) => {
        const row = await owned(tx, principal, job.key, 'UPDATE');
        await source(tx, principal, row, 'SHARE');
        const old = project(row);
        let state = ({ CONTINUE: 'QUEUED', WAIT: 'QUEUED', REVIEW: 'REVIEW', ATTENTION: 'NEEDS_ATTENTION' })[outcome.kind];
        requireThat(state && old.stage === job.stage, 409, 'BATCH_STAGE_STALE');
        const stage = outcome.kind === 'CONTINUE' ? BATCH_STAGES[BATCH_STAGES.indexOf(old.stage) + 1] : old.stage;
        requireThat(stage, 409, 'BATCH_STAGE_STALE');
        const evidence = canonical({ ...old.evidence, ...(outcome.evidence ?? {}) }, { maxBytes: 65536 });
        const delay = outcome.kind === 'WAIT' ? Math.max(2000, Math.min(60000, outcome.retryAfterMs ?? 3000)) : 0;
        const changed = await tx.$executeRawUnsafe(`UPDATE atlas_manual_connected.batch_grading SET state=$3,stage=$4,evidence=$5,code=$6,
          claim_id=NULL,lease_until=NULL,analysis_reserved=CASE WHEN stage='ANALYZE' AND $4='REPORT' THEN false ELSE analysis_reserved END,
          revision=revision+1,available_at=clock_timestamp()+$7::integer*interval '1 millisecond',updated_at=clock_timestamp()
          WHERE key=$1 AND state='RUNNING' AND claim_id=$2::uuid AND lease_until>clock_timestamp()`, job.key, job.claimId, state, stage, evidence, outcome.code ?? null, delay);
        return changed === 1;
      });
    },
    async resume(staff, { key, expectedRevision }) {
      return boundary.transaction(staff, async ({ tx, principal }) => {
        const row = await owned(tx, principal, key, 'UPDATE'); await source(tx, principal, { ...row, access_version: principal.accessVersion }, 'SHARE');
        requireThat(row.revision === expectedRevision && row.state === 'NEEDS_ATTENTION', 409, 'BATCH_RESUME_STALE');
        const [saved] = await tx.$queryRawUnsafe(`UPDATE atlas_manual_connected.batch_grading SET state='QUEUED',code=NULL,
          access_version=$2,revision=revision+1,available_at=clock_timestamp(),updated_at=clock_timestamp() WHERE key=$1 RETURNING *`, key, principal.accessVersion);
        return { job: safeRow(saved) };
      });
    },
  });
}

export function batchGrantSQL(role) {
  requireThat(/^[a-z][a-z0-9_]{0,62}$/.test(role));
  return `GRANT SELECT,INSERT ON atlas_manual_connected.batch_request,atlas_manual_connected.batch_grading,atlas_manual_connected.batch_review TO "${role}";\nGRANT UPDATE(state,stage,evidence,code,claim_id,lease_until,revision,available_at,updated_at,attempts,access_version,analysis_reserved) ON atlas_manual_connected.batch_grading TO "${role}";\nGRANT USAGE ON SCHEMA atlas_defect_analysis TO "${role}";\nGRANT SELECT ON atlas_defect_analysis.run,atlas_defect_analysis.receipt,atlas_defect_analysis.request_refusal TO "${role}";`;
}
