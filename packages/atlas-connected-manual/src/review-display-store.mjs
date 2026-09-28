import {publishedDisplayStore} from './published-display-store.mjs';
import { randomUUID } from 'node:crypto';
import { canonical, digest, object, uuid, requireThat } from '@atlas/manual-service/contract';

export const DISPLAY_JOB_POLICY = 'atlas-review-delivery-v1';
const parse = row => { if (!row) return null;
  requireThat(!row.result || digest(row.result) === row.result_hash, 503, 'DISPLAY_STORED_CONTENT_INVALID');
  return ({ ...row, photoSource: JSON.parse(row.photo_source),
  prepared: row.prepared ? JSON.parse(row.prepared) : null,
  result: row.result ? JSON.parse(row.result) : null }); };
function priorities(value){
  requireThat(Array.isArray(value)&&value.length<=16&&value.every(x=>/^[a-f0-9]{64}$/.test(x)),500,'DISPLAY_PRIORITY_INVALID');
  return [...new Set(value)];
}
const active = `c.owner_id=j.owner_id AND j.upload_id IN(c.front_upload_id,c.back_upload_id)
 AND u.source::jsonb=j.photo_source::jsonb AND atlas_manual_connected.display_owner_current(j.owner_id,j.access_version)
 AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=j.card_id)
 AND (j.prepared IS NULL OR EXISTS(SELECT 1 FROM atlas_manual.card m WHERE m.id=j.card_id
   AND m.content::jsonb->'source'->'prepared'->j.side=j.prepared::jsonb
   AND m.content::jsonb->'source'->'uploads'->>j.side=j.upload_id::text))`;
const joins = `JOIN atlas_manual_intake.card c ON c.id=j.card_id
 JOIN atlas_manual_intake.upload u ON u.id=j.upload_id AND u.card_id=c.id`;

/** Isolated display queue. It never edits source, manual drafts, findings,
 * approvals, model requests or the immutable prepared-image manifest. */
export function createReviewDisplayStore({ boundary, client, intakeRepository }) {
  const machine = fn => boundary.machineTransaction(null, fn);
  const read = fn => client.$transaction(fn, { maxWait: 3000, timeout: 5000 });
  return Object.freeze({
    async discover(limit = 8, {priorityPhotoHashes=[]} = {}) {
      const hints=priorities(priorityPhotoHashes);
      requireThat(Number.isInteger(limit) && limit >= 1 && limit <= 32, 500, 'DISPLAY_CONFIG_INVALID');
      return machine(async ({ tx, principal }) => {
        // Durable discovery is independent of browser reads and post-commit
        // callbacks. A source committed before a crash is found next tick.
        const candidates = await tx.$queryRawUnsafe(`WITH candidates AS (
          SELECT c.id card_id,u.id upload_id,u.side,c.owner_id,atlas_manual_connected.display_owner_version(c.owner_id) access_version,u.source photo_source,
            u.source::jsonb->'ref'->>'sha256' photo_hash,v.variant,NULL::text prepared,u.created_at
          FROM atlas_manual_intake.card c JOIN atlas_manual_intake.upload u ON u.card_id=c.id AND u.id IN(c.front_upload_id,c.back_upload_id)
          CROSS JOIN (VALUES('context'),('full')) v(variant)
          WHERE u.source IS NOT NULL AND atlas_manual_connected.display_owner_version(c.owner_id) IS NOT NULL AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=c.id)
          UNION ALL
          SELECT c.id,u.id,u.side,c.owner_id,atlas_manual_connected.display_owner_version(c.owner_id) access_version,u.source,u.source::jsonb->'ref'->>'sha256',
            'inspection:'||(m.content::jsonb->'source'->'prepared'->u.side->'ref'->>'sha256'),
            (m.content::jsonb->'source'->'prepared'->u.side)::text,u.created_at
          FROM atlas_manual_intake.card c JOIN atlas_manual_intake.upload u ON u.card_id=c.id AND u.id IN(c.front_upload_id,c.back_upload_id)
          JOIN atlas_manual.card m ON m.id=c.id AND m.content::jsonb->'source'->'uploads'->>u.side=u.id::text
          WHERE u.source IS NOT NULL AND atlas_manual_connected.display_owner_version(c.owner_id) IS NOT NULL AND m.content::jsonb->'source'->'prepared'->u.side->'ref'->>'sha256' IS NOT NULL
            AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=c.id)
        ) SELECT q.* FROM candidates q WHERE NOT EXISTS(SELECT 1 FROM atlas_manual_connected.review_display j
          WHERE j.photo_hash=q.photo_hash AND j.variant=q.variant AND j.policy=$1 AND (j.access_version=q.access_version OR j.state='READY'))
          ORDER BY (q.photo_hash=ANY($3::text[])) DESC,(q.variant='full'),q.created_at DESC,q.upload_id,q.variant LIMIT $2`, DISPLAY_JOB_POLICY, limit,hints);
        for (const q of candidates) await tx.$executeRawUnsafe(`INSERT INTO atlas_manual_connected.review_display
          (photo_hash,variant,policy,card_id,upload_id,side,owner_id,access_version,photo_source,prepared)
          VALUES($1,$2,$3,$4::uuid,$5::uuid,$6,$7::uuid,$8,$9,$10) ON CONFLICT DO NOTHING`,
        q.photo_hash,q.variant,DISPLAY_JOB_POLICY,q.card_id,q.upload_id,q.side,q.owner_id,q.access_version,q.photo_source,q.prepared);
        return candidates.length+await publishedDisplayStore.discover(tx,limit,principal.mode);
      });
    },
    async read(photoSource, variant) {
      const hash = photoSource?.ref?.sha256;
      requireThat(/^[a-f0-9]{64}$/.test(hash) && /^(context|full|inspection:[a-f0-9]{64})$/.test(variant), 503, 'DISPLAY_BINDING_INVALID');
      return read(async tx => parse((await tx.$queryRawUnsafe(`SELECT * FROM atlas_manual_connected.review_display
        WHERE photo_hash=$1 AND variant=$2 AND policy=$3 ORDER BY (state='READY') DESC,access_version DESC,recovery DESC LIMIT 1`, hash,variant,DISPLAY_JOB_POLICY))[0]));
    },
    async inspection(sourceImageSha256,frameHash) {
      requireThat(/^[a-f0-9]{64}$/.test(sourceImageSha256), 503, 'DISPLAY_BINDING_INVALID');
      return read(async tx => parse((await tx.$queryRawUnsafe(`SELECT * FROM atlas_manual_connected.review_display
        WHERE source_image_hash=$1 AND variant LIKE 'inspection:%' AND policy=$2 AND state='READY'
          AND result::jsonb->'descriptor'->>'frameDescriptorSha256'=$3 LIMIT 1`, sourceImageSha256,DISPLAY_JOB_POLICY,frameHash))[0])??await publishedDisplayStore.inspection(tx,sourceImageSha256,frameHash));
    },
    async retry(staff,cardId,input) {
      object(input,['side','photoSourceHash','jobId','actionId']);uuid(cardId);uuid(input.jobId);uuid(input.actionId);
      requireThat(['FRONT','BACK'].includes(input.side)&&/^[a-f0-9]{64}$/.test(input.photoSourceHash),400,'DISPLAY_RETRY_INVALID');
      requireThat(intakeRepository,503,'DISPLAY_RETRY_UNAVAILABLE');
      return boundary.transaction(staff,async ({tx,principal})=>{
        await intakeRepository.authorizeInTransaction(tx,principal,cardId,{edit:false,lock:'SHARE'});
        const [job]=await tx.$queryRawUnsafe(`SELECT j.* FROM atlas_manual_connected.review_display j ${joins}
          WHERE j.id=$1::uuid AND j.card_id=$2::uuid AND j.side=$3 AND j.photo_hash=$4
            AND j.owner_id=$5::uuid AND j.access_version=$6 AND ${active} FOR UPDATE OF j`,
        input.jobId,cardId,input.side,input.photoSourceHash,principal.id,principal.accessVersion);
        requireThat(job,409,'DISPLAY_SOURCE_CHANGED');
        const [prior]=await tx.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.review_display WHERE retry_action=$1::uuid',input.actionId);
        if(prior){requireThat(prior.retry_of===job.id,409,'DISPLAY_RETRY_CONFLICT');return {state:prior.state,jobId:prior.id};}
        requireThat(job.state==='FAILED'&&job.recovery<3,409,'DISPLAY_RETRY_NOT_ALLOWED');
        const [child]=await tx.$queryRawUnsafe('SELECT id FROM atlas_manual_connected.review_display WHERE retry_of=$1::uuid',job.id);
        requireThat(!child,409,'DISPLAY_RETRY_CONFLICT');
        const [queued]=await tx.$queryRawUnsafe(`INSERT INTO atlas_manual_connected.review_display
          (photo_hash,variant,policy,card_id,upload_id,side,owner_id,access_version,photo_source,prepared,recovery,retry_of,retry_action)
          VALUES($1,$2,$3,$4::uuid,$5::uuid,$6,$7::uuid,$8,$9,$10,$11,$12::uuid,$13::uuid) RETURNING id`,
        job.photo_hash,job.variant,job.policy,job.card_id,job.upload_id,job.side,job.owner_id,job.access_version,
        job.photo_source,job.prepared,job.recovery+1,job.id,input.actionId);
        return {state:'QUEUED',jobId:queued.id};
      });
    },
    async claim(concurrency = 2, {priorityPhotoHashes=[],lane='context'} = {}) {
      const hints=priorities(priorityPhotoHashes);
      requireThat(['context','selected','oldest'].includes(lane),500,'DISPLAY_PRIORITY_INVALID');
      requireThat(Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 4, 500, 'DISPLAY_CONFIG_INVALID');
      return machine(async ({ tx, principal }) => {
        const [lock]=await tx.$queryRawUnsafe('SELECT pg_try_advisory_xact_lock(721930,60) AS locked');
        if(!lock.locked)return null;
        await tx.$executeRawUnsafe(`UPDATE atlas_manual_connected.review_display SET state='FAILED',code='DISPLAY_ATTEMPTS_EXHAUSTED',
          claim_id=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE state='RUNNING' AND lease_until<=clock_timestamp() AND attempts>=6`);
        await tx.$executeRawUnsafe(`UPDATE atlas_manual_connected.published_review_display SET state='QUEUED',code='DISPLAY_LEASE_EXPIRED',
          claim_id=NULL,lease_until=NULL,updated_at=clock_timestamp(),
          available_at=clock_timestamp()+LEAST(60::double precision,power(2::double precision,LEAST(attempts,6)))*interval '1 second'
          WHERE state='RUNNING' AND lease_until<=clock_timestamp()`);
        const [count] = await tx.$queryRawUnsafe(`SELECT count(*)::int n FROM (
          SELECT id FROM atlas_manual_connected.review_display WHERE state='RUNNING' AND lease_until>clock_timestamp()
          UNION ALL SELECT id FROM atlas_manual_connected.published_review_display WHERE state='RUNNING' AND lease_until>clock_timestamp()) running`);
        if (count.n >= concurrency) return null;
        const [job] = await tx.$queryRawUnsafe(`SELECT j.* FROM atlas_manual_connected.review_display j ${joins}
          WHERE j.policy=$1 AND ${active} AND (j.state='QUEUED' AND j.available_at<=clock_timestamp()
            OR j.state='RUNNING' AND j.lease_until<=clock_timestamp())
          ORDER BY CASE WHEN $3='selected' THEN CASE WHEN j.photo_hash=ANY($2::text[]) THEN 0 ELSE 1 END
            WHEN $3='context' THEN CASE WHEN j.variant='full' THEN 1 ELSE 0 END ELSE 0 END,
            CASE WHEN $3='selected' AND j.photo_hash=ANY($2::text[]) THEN (j.variant='full')::int ELSE 0 END,
            j.available_at,j.upload_id LIMIT 1 FOR UPDATE OF j SKIP LOCKED`, DISPLAY_JOB_POLICY,hints,lane);
        // One in four lifecycle turns serves oldest work across both queues.
        // The selected turn may pass old background work, but cannot borrow its
        // authority or bypass capacity. Context turns remain independently due.
        const selected=lane==='selected'&&job&&hints.includes(job.photo_hash);
        const published=selected?null:await publishedDisplayStore.claim(tx,principal.mode,job?.available_at??null);
        if(published||!job)return published;
        return parse((await tx.$queryRawUnsafe(`UPDATE atlas_manual_connected.review_display SET state='RUNNING',claim_id=$2::uuid,
          lease_until=clock_timestamp()+interval '120 seconds',attempts=attempts+1,updated_at=clock_timestamp()
          WHERE id=$1::uuid RETURNING *`,job.id,randomUUID()))[0]);
      });
    },
    async renew(job) {
      if(job.publication)return machine(({tx})=>publishedDisplayStore.renew(tx,job));
      return machine(async ({ tx }) => (await tx.$executeRawUnsafe(`UPDATE atlas_manual_connected.review_display j
        SET lease_until=clock_timestamp()+interval '120 seconds',updated_at=clock_timestamp()
        WHERE j.id=$1::uuid AND j.claim_id=$2::uuid AND j.state='RUNNING'
          AND j.lease_until>clock_timestamp() AND EXISTS(SELECT 1 FROM atlas_manual_intake.card c
            JOIN atlas_manual_intake.upload u ON u.id=j.upload_id AND u.card_id=c.id
            WHERE c.id=j.card_id AND ${active})`,
      job.id,job.claim_id)) === 1);
    },
    async finish(job, { result = null, sourceImageSha256 = null, code = null, retry = false } = {}) {
      requireThat(result || /^[A-Z][A-Z0-9_]{0,100}$/.test(code), 500, 'DISPLAY_RESULT_INVALID');
      const text = result ? canonical(result, { maxBytes: 32768 }) : null;
      if(job.publication)return machine(({tx})=>publishedDisplayStore.finish(tx,job,{text,sourceImageSha256,code,retry}));
      return machine(async ({ tx }) => {
        // Same lock order as photo adoption: current intake before queue row.
        await tx.$queryRawUnsafe('SELECT id FROM atlas_manual_intake.card WHERE id=$1::uuid FOR SHARE',job.card_id);
        const [current] = await tx.$queryRawUnsafe(`SELECT j.* FROM atlas_manual_connected.review_display j ${joins}
          WHERE j.id=$1::uuid AND j.claim_id=$2::uuid AND j.state='RUNNING'
            AND j.lease_until>clock_timestamp() AND ${active} FOR UPDATE OF j`,job.id,job.claim_id);
        if (!current) {
          await tx.$executeRawUnsafe(`UPDATE atlas_manual_connected.review_display j SET state='SUPERSEDED',code='DISPLAY_SOURCE_CHANGED',
            claim_id=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE id=$1::uuid
            AND claim_id=$2::uuid AND state='RUNNING' AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.card c
              JOIN atlas_manual_intake.upload u ON u.id=j.upload_id AND u.card_id=c.id WHERE c.id=j.card_id AND ${active})`,job.id,job.claim_id);
          return false;
        }
        await tx.$executeRawUnsafe(`UPDATE atlas_manual_connected.review_display SET state=$3,result=$4,result_hash=$5,
          source_image_hash=$6,code=$7,claim_id=NULL,lease_until=NULL,
          available_at=clock_timestamp()+$8*interval '1 millisecond',updated_at=clock_timestamp()
          WHERE id=$1::uuid AND claim_id=$2::uuid`,job.id,job.claim_id,
        result?'READY':retry?'QUEUED':'FAILED',text,text?digest(text):null,sourceImageSha256,code,
        retry?Math.min(60000,1000*2**Math.min(job.attempts,6)):0);
        return true;
      });
    },
  });
}

export function reviewDisplayGrantSQL(role) {
  requireThat(/^[a-z][a-z0-9_]{0,62}$/.test(role));
  return `GRANT SELECT,INSERT ON atlas_manual_connected.review_display,atlas_manual_connected.published_review_display TO "${role}";
GRANT UPDATE(state,attempts,claim_id,lease_until,result,result_hash,source_image_hash,code,available_at,updated_at) ON atlas_manual_connected.review_display,atlas_manual_connected.published_review_display TO "${role}";
GRANT SELECT ON atlas_manual.publication TO "${role}";
GRANT EXECUTE ON FUNCTION atlas_manual_connected.display_owner_version(uuid),atlas_manual_connected.display_owner_current(uuid,integer) TO "${role}";`;
}
