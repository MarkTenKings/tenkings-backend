import { randomUUID } from 'node:crypto';
import { canonical, digest, requireThat, uuid } from '@atlas/manual-service/contract';

export const VARIANT_BUSY_DISPATCH_INTERVAL_MS = 60000;
/** Calling without a job is the retained read-only priority observation.
 * A dispatch caller uses a current reference lease and one durable permission
 * per minute during sustained grading load. It owns no main grading slot;
 * actual separate provider capacity and the existing one-job worker remain. */
export function createVariantAdmission({ boundary }) {
  requireThat(typeof boundary?.machineTransaction === 'function', 503, 'VARIANT_ADMISSION_CONFIGURATION');
  return async ({ actionId = null, jobKey = null, claimId = null } = {}) => {
    if (actionId !== null) uuid(actionId);
    requireThat(jobKey===null&&claimId===null||/^[a-f0-9]{64}$/.test(jobKey)&&typeof claimId==='string',400,'VARIANT_ADMISSION_CONFIGURATION');
    if(claimId!==null)uuid(claimId);
    return boundary.machineTransaction(null, async ({ tx, principal }) => {
      requireThat(typeof principal?.mode === 'string', 503, 'VARIANT_ADMISSION_UNAVAILABLE');
      const [row] = await tx.$queryRawUnsafe(`SELECT
        EXISTS(SELECT 1 FROM atlas_manual_connected.batch_grading j
          WHERE (j.state IN ('QUEUED','RUNNING') OR j.analysis_reserved)
          AND atlas_manual_connected.display_owner_current(j.actor_id,j.access_version)
          AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=j.card_id)) AS batch_busy,
        EXISTS(SELECT 1 FROM atlas_manual_connected.identification i
          WHERE i.state='RUNNING'
          AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=i.card_id)) AS identification_busy,
        EXISTS(SELECT 1 FROM atlas_defect_analysis.run r
          WHERE ($1::uuid IS NULL OR r.action_id<>$1::uuid)
          AND (r.state='PREPARED' AND r.expires_at>clock_timestamp() OR r.state='DISPATCHED')
          AND NOT EXISTS(SELECT 1 FROM atlas_defect_analysis.request_refusal f WHERE f.card_id=r.card_id AND f.action_id=r.action_id)
          AND NOT EXISTS(SELECT 1 FROM atlas_defect_analysis.receipt p WHERE p.analysis_id=r.id AND p.kind='RESPONSE')
          AND (r.expires_at>clock_timestamp()
            OR EXISTS(SELECT 1 FROM atlas_defect_analysis.provider_event e WHERE e.analysis_id=r.id AND e.kind='ACCEPTED')
            OR (NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=r.card_id)
              AND NOT EXISTS(SELECT 1 FROM atlas_defect_analysis.run successor
                WHERE successor.card_id=r.card_id AND successor.replaces_analysis_id=r.id)))) AS analysis_busy`, actionId);
      requireThat(row && ['batch_busy','identification_busy','analysis_busy'].every(key => typeof row[key] === 'boolean'), 503, 'VARIANT_ADMISSION_UNAVAILABLE');
      const idle=!row.batch_busy&&!row.identification_busy&&!row.analysis_busy;
      if(jobKey===null)return idle;
      // One short lock makes the allowance global across workers/restarts.
      // Fixed current/previous minute keys use the composite cache index; no history scan,
      // provider reservation or polling record is necessary on refused calls.
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(721930,78)');
      const [job]=await tx.$queryRawUnsafe(`SELECT clock_timestamp() AS observed_at,
        floor(extract(epoch FROM clock_timestamp())/60)::bigint::text AS window,
        j.created_at<=clock_timestamp()-interval '60 seconds' AS aged, j.identity_hash,
        (SELECT c.content::jsonb->'identity' FROM atlas_manual.card c WHERE c.id=j.card_id) AS identity
        FROM atlas_manual_connected.variant_job j WHERE j.key=$1 AND j.claim_id=$2::uuid
          AND j.state='RUNNING' AND j.lease_until>clock_timestamp()
          AND atlas_manual_connected.display_owner_current(j.actor_id,j.access_version)
          AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=j.card_id)
          AND EXISTS(SELECT 1 FROM atlas_manual.card c WHERE c.id=j.card_id AND c.owner_id=j.actor_id
            AND c.content::jsonb->'source'->>'sourceHash'=j.source_hash
            AND (c.content::jsonb->>'identityRevision')::int=j.identity_revision)`,jobKey,claimId);
      if(!job||digest(canonical(job.identity))!==job.identity_hash)return false;
      requireThat(/^[0-9]+$/.test(job.window)&&typeof job.aged==='boolean'&&Number.isFinite(new Date(job.observed_at).getTime()),503,'VARIANT_ADMISSION_UNAVAILABLE');
      const key=window=>`variant-dispatch-admission:v1:${window}`;
      if(!idle){
        if(!job.aged)return false;
        const [recent]=await tx.$queryRawUnsafe(`SELECT EXISTS(SELECT 1 FROM atlas_manual_connected.variant_catalog_cache
          WHERE key=ANY($1::text[]) AND created_at>clock_timestamp()-interval '60 seconds') AS busy`,[key(job.window),key((BigInt(job.window)-1n).toString())]);
        requireThat(typeof recent?.busy==='boolean',503,'VARIANT_ADMISSION_UNAVAILABLE');if(recent.busy)return false;
      }
      const record=canonical({schemaVersion:'variant-dispatch-admission/v1',jobKey,claimId,permissionId:randomUUID(),observedAt:new Date(job.observed_at).toISOString()});
      await tx.$executeRawUnsafe(`INSERT INTO atlas_manual_connected.variant_catalog_cache(key,snapshot,snapshot_hash,expires_at)
        VALUES($1,$2,$3,'2000-01-01'::timestamptz)`,key(job.window),record,digest(record));
      return true;
    });
  };
}
