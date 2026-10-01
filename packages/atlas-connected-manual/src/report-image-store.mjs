import { randomUUID } from 'node:crypto';
import { canonical, digest, requireThat } from '@atlas/manual-service/contract';
import { reportImageJobKey, reportImageRecipeHash } from './report-image-provider.mjs';

const live = `p.state='PUBLISHED' AND p.manifest_hash=b.manifest_hash AND p.mode=j.mode
 AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=b.card_id)`;
const authorized = `EXISTS(SELECT 1 FROM atlas_manual_connected.report_image_binding b
 JOIN atlas_manual.publication p ON p.card_id=b.card_id AND p.action_id=b.action_id WHERE b.job_key=j.key AND ${live})`;
const parsed = row => {
  if (!row) return null;
  requireThat(digest(row.recipe) === row.recipe_hash && digest(row.source_media) === row.source_media_hash
    && (!row.result || digest(row.result) === row.result_hash), 503, 'REPORT_IMAGE_STORED_CONTENT_INVALID');
  return { ...row, recipe: JSON.parse(row.recipe), sourceMedia: JSON.parse(row.source_media), result: row.result ? JSON.parse(row.result) : null };
};

/** Existing deployment-authenticated machine boundary, short transactions only.
 * No photo, draft, finding, approval or publication row is updated. */
export function createReportImageStore({ boundary, client }) {
  const machine = work => boundary.machineTransaction(null, work);
  const read = work => client.$transaction(work, { maxWait: 3000, timeout: 5000 });
  return Object.freeze({
    candidates(limit = 8, after = '') {
      requireThat(Number.isInteger(limit) && limit > 0 && limit <= 32, 500, 'REPORT_IMAGE_CONFIG_INVALID');
      return machine(({ tx, principal }) => tx.$queryRawUnsafe(`SELECT p.* FROM atlas_manual.publication p
        WHERE p.state='PUBLISHED' AND p.mode=$1 AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=p.card_id)
        AND EXISTS(SELECT 1 FROM (VALUES('FRONT'),('BACK')) s(side) WHERE NOT EXISTS(
          SELECT 1 FROM atlas_manual_connected.report_image_binding b WHERE b.card_id=p.card_id AND b.action_id=p.action_id AND b.side=s.side))
        AND p.card_id::text||':'||p.action_id::text>$3 ORDER BY p.card_id,p.action_id LIMIT $2`, principal.mode, limit, after));
    },
    async enqueue(publication, side, sourceMedia, recipe, ready = null) {
      const sourceHash = sourceMedia.descriptor.raster.content.sha256, key = reportImageJobKey(sourceHash, recipe);
      const recipeText = canonical(recipe), sourceText = canonical(sourceMedia, { maxBytes: 32768 });
      const resultText = ready ? canonical(ready, { maxBytes: 65536 }) : null;
      requireThat(['FRONT', 'BACK'].includes(side), 500, 'REPORT_IMAGE_BINDING_INVALID');
      return machine(async ({ tx, principal }) => {
        await tx.$queryRawUnsafe('SELECT id FROM atlas_manual_intake.card WHERE id=$1::uuid FOR SHARE', publication.card_id);
        const [current] = await tx.$queryRawUnsafe(`SELECT p.card_id FROM atlas_manual.publication p WHERE p.card_id=$1::uuid AND p.action_id=$2::uuid
          AND p.state='PUBLISHED' AND p.manifest_hash=$3 AND p.mode=$4
          AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=p.card_id)`,
        publication.card_id, publication.action_id, publication.manifest_hash, principal.mode);
        requireThat(current, 409, 'REPORT_IMAGE_PUBLICATION_CHANGED');
        const [prior] = await tx.$queryRawUnsafe(`SELECT job_key FROM atlas_manual_connected.report_image_binding
          WHERE card_id=$1::uuid AND action_id=$2::uuid AND side=$3`, publication.card_id, publication.action_id, side);
        if (prior) { requireThat(!ready || prior.job_key === key, 409, 'REPORT_IMAGE_SEED_BINDING_EXISTS'); return prior.job_key; }
        await tx.$executeRawUnsafe(`INSERT INTO atlas_manual_connected.report_image_job
          (key,source_hash,recipe_hash,recipe,mode,source_card_id,source_media,source_media_hash,state,result,result_hash,audit)
          VALUES($1,$2,$3,$4,$5,$6::uuid,$7,$8,$9,$10,$11,$12::jsonb) ON CONFLICT DO NOTHING`,
        key, sourceHash, reportImageRecipeHash(recipe), recipeText, principal.mode, publication.card_id, sourceText, digest(sourceText),
        ready ? 'READY' : 'QUEUED', resultText, resultText ? digest(resultText) : null, JSON.stringify(ready ? [{ event: 'SEEDED', receipt: ready.receipt }] : []));
        const [job] = await tx.$queryRawUnsafe('SELECT key,mode,source_hash,recipe_hash FROM atlas_manual_connected.report_image_job WHERE key=$1', key);
        requireThat(job?.mode === principal.mode && job.source_hash === sourceHash && job.recipe_hash === reportImageRecipeHash(recipe), 409, 'REPORT_IMAGE_CACHE_CONFLICT');
        await tx.$executeRawUnsafe(`INSERT INTO atlas_manual_connected.report_image_binding(card_id,action_id,side,manifest_hash,job_key)
          VALUES($1::uuid,$2::uuid,$3,$4,$5) ON CONFLICT DO NOTHING`, publication.card_id, publication.action_id, side, publication.manifest_hash, key);
        const [bound] = await tx.$queryRawUnsafe(`SELECT job_key FROM atlas_manual_connected.report_image_binding
          WHERE card_id=$1::uuid AND action_id=$2::uuid AND side=$3`, publication.card_id, publication.action_id, side);
        requireThat(!ready || bound.job_key === key, 409, 'REPORT_IMAGE_SEED_BINDING_EXISTS');
        return bound.job_key;
      });
    },
    claim(concurrency = 2, recipeHash = null) {
      requireThat(Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 8
        && (recipeHash === null || /^[a-f0-9]{64}$/.test(recipeHash)), 500, 'REPORT_IMAGE_CONFIG_INVALID');
      return machine(async ({ tx, principal }) => {
        const [lock] = await tx.$queryRawUnsafe('SELECT pg_try_advisory_xact_lock(721930,64) AS locked');
        if (!lock.locked) return null;
        // A process may die after a paid POST. Never infer that it was rejected.
        await tx.$executeRawUnsafe(`UPDATE atlas_manual_connected.report_image_job SET state=CASE WHEN state='REQUESTED' THEN 'UNKNOWN'
          WHEN attempts>=6 THEN 'FAILED' ELSE 'QUEUED' END,code=CASE WHEN state='REQUESTED' THEN 'REPORT_IMAGE_RESPONSE_UNKNOWN' ELSE 'REPORT_IMAGE_LEASE_EXPIRED' END,
          claim_id=NULL,lease_until=NULL,available_at=clock_timestamp()+interval '30 seconds',updated_at=clock_timestamp()
          WHERE state IN('RUNNING','REQUESTED') AND lease_until<=clock_timestamp()`);
        const [count] = await tx.$queryRawUnsafe(`SELECT count(*)::int n FROM atlas_manual_connected.report_image_job
          WHERE state IN('RUNNING','REQUESTED') AND lease_until>clock_timestamp()`);
        if (count.n >= concurrency) return null;
        const [job] = await tx.$queryRawUnsafe(`SELECT j.* FROM atlas_manual_connected.report_image_job j
          WHERE j.state='QUEUED' AND j.attempts<6 AND j.available_at<=clock_timestamp() AND j.mode=$1
          AND ($2::text IS NULL OR j.recipe_hash=$2) AND ${authorized}
          ORDER BY j.available_at,j.key LIMIT 1 FOR UPDATE OF j SKIP LOCKED`, principal.mode, recipeHash);
        if (!job) return null;
        return parsed((await tx.$queryRawUnsafe(`UPDATE atlas_manual_connected.report_image_job SET state='RUNNING',claim_id=$2::uuid,
          lease_until=clock_timestamp()+interval '300 seconds',attempts=attempts+1,updated_at=clock_timestamp() WHERE key=$1 RETURNING *`, job.key, randomUUID()))[0]);
      });
    },
    renew(job) {
      return machine(async ({ tx }) => (await tx.$executeRawUnsafe(`UPDATE atlas_manual_connected.report_image_job j SET
        lease_until=clock_timestamp()+interval '300 seconds',updated_at=clock_timestamp() WHERE key=$1 AND claim_id=$2::uuid
        AND state IN('RUNNING','REQUESTED') AND lease_until>clock_timestamp() AND ${authorized}`, job.key, job.claim_id)) === 1);
    },
    async dispatch(job) {
      return machine(async ({ tx }) => (await tx.$executeRawUnsafe(`UPDATE atlas_manual_connected.report_image_job j SET state='REQUESTED',
        audit=audit||jsonb_build_array(jsonb_build_object('event','REQUESTED','requestId',$2::text,'at',clock_timestamp())),updated_at=clock_timestamp()
        WHERE key=$1 AND claim_id=$2::uuid AND state='RUNNING' AND lease_until>clock_timestamp() AND ${authorized}`, job.key, job.claim_id)) === 1);
    },
    recordReceipt(job, receipt) {
      const value = canonical(receipt, { maxBytes: 8192 });
      // Accepted paid evidence survives retirement/lease loss. This can only
      // append to an actually dispatched request; it cannot publish output,
      // acquire authority or reopen/reissue a terminal job.
      return machine(async ({ tx, principal }) => (await tx.$executeRawUnsafe(`UPDATE atlas_manual_connected.report_image_job SET
        audit=audit||jsonb_build_array(jsonb_build_object('event','RESPONSE','requestId',$2::text,'receipt',$3::jsonb)),updated_at=clock_timestamp()
        WHERE key=$1 AND mode=$4 AND audit @> jsonb_build_array(jsonb_build_object('event','REQUESTED','requestId',$2::text))
        AND NOT audit @> jsonb_build_array(jsonb_build_object('event','RESPONSE','requestId',$2::text))`,
      job.key, job.claim_id, value, principal.mode)) === 1);
    },
    finish(job, { result = null, code = null, disposition = 'FAILED', receipt = null } = {}) {
      const resultText = result ? canonical(result, { maxBytes: 65536 }) : null;
      const state = result ? 'READY' : disposition === 'RETRY' && job.attempts < 6 ? 'QUEUED' : disposition === 'UNKNOWN' ? 'UNKNOWN' : 'FAILED';
      requireThat(result || /^[A-Z][A-Z0-9_]{0,100}$/.test(code ?? ''), 500, 'REPORT_IMAGE_RESULT_INVALID');
      return machine(async ({ tx }) => (await tx.$executeRawUnsafe(`UPDATE atlas_manual_connected.report_image_job j SET state=$3,
        result=$4,result_hash=$5,code=$6,claim_id=NULL,lease_until=NULL,available_at=clock_timestamp()+$7*interval '1 millisecond',
        audit=audit||$8::jsonb,updated_at=clock_timestamp() WHERE key=$1 AND claim_id=$2::uuid
        AND state IN('RUNNING','REQUESTED') AND lease_until>clock_timestamp() AND ${authorized}`, job.key, job.claim_id,
      state, resultText, resultText ? digest(resultText) : null, code, state === 'QUEUED' ? Math.min(60000, 2000 * 2 ** job.attempts) : 0,
      JSON.stringify([{ event: state, requestId: job.claim_id, receipt: receipt ?? result?.receipt ?? null, code }]))) === 1);
    },
    ready(publication, side) {
      return read(async tx => parsed((await tx.$queryRawUnsafe(`SELECT j.* FROM atlas_manual_connected.report_image_binding b
        JOIN atlas_manual_connected.report_image_job j ON j.key=b.job_key JOIN atlas_manual.publication p ON p.card_id=b.card_id AND p.action_id=b.action_id
        WHERE b.card_id=$1::uuid AND b.action_id=$2::uuid AND b.manifest_hash=$3 AND b.side=$4 AND j.state='READY' AND ${live}`,
      publication.card_id, publication.action_id, publication.manifest_hash, side))[0]));
    },
    readyMany(publication) {
      // Optional SSR enrichment gets one short lookup for both sides. Limit
      // database execution as well as pool acquisition so a cold/locked cache
      // cannot hold report requests or consume connections for seconds.
      return client.$transaction(async tx => {
        await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '350ms'");
        const rows = await tx.$queryRawUnsafe(`SELECT b.side,j.* FROM atlas_manual_connected.report_image_binding b
          JOIN atlas_manual_connected.report_image_job j ON j.key=b.job_key JOIN atlas_manual.publication p ON p.card_id=b.card_id AND p.action_id=b.action_id
          WHERE b.card_id=$1::uuid AND b.action_id=$2::uuid AND b.manifest_hash=$3 AND j.state='READY' AND ${live}`,
        publication.card_id, publication.action_id, publication.manifest_hash);
        return rows.map(parsed);
      }, { maxWait: 150, timeout: 500 });
    },
  });
}

export function reportImageGrantSQL(role) {
  requireThat(/^[a-z][a-z0-9_]{0,62}$/.test(role));
  return `GRANT SELECT,INSERT ON atlas_manual_connected.report_image_job,atlas_manual_connected.report_image_binding TO "${role}";
GRANT UPDATE(state,attempts,claim_id,lease_until,result,result_hash,code,available_at,updated_at,audit) ON atlas_manual_connected.report_image_job TO "${role}";
GRANT SELECT ON atlas_manual.publication TO "${role}";`;
}
