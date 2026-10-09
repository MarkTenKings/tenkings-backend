import { randomUUID } from 'node:crypto';
import { canonical, digest, object, requireThat, uuid } from '@atlas/manual-service/contract';

const refreshRequestId = (actionId, previewId) => { const h=digest(`atlas-market-refresh-v1:${actionId}:${previewId}`); return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`; };
const table = 'atlas_manual_connected.market_job';
const live = `EXISTS(SELECT 1 FROM atlas_manual.publication p JOIN atlas_manual.approval a USING(card_id,action_id)
 JOIN atlas_manual.card c ON c.id=p.card_id WHERE p.card_id=j.card_id AND p.action_id=j.approval_action_id
 AND p.mode=j.mode AND a.source_hash=j.source_hash AND a.report_hash=j.report_hash
 AND (j.public_hash IS NULL OR p.public_hash=j.public_hash)
 AND (c.owner_id=j.actor_id OR j.actor_id=ANY(c.approvers))
 AND NOT EXISTS(SELECT 1 FROM atlas_manual.publication newer WHERE newer.card_id=p.card_id AND newer.version>p.version)
 AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=p.card_id))
 AND atlas_manual_connected.display_owner_current(j.actor_id,j.access_version)`;
const active = `j.request_id=$1::uuid AND j.claim_id=$2::uuid AND j.state IN('RUNNING','REQUESTED') AND j.lease_until>clock_timestamp() AND ${live}`;
const stored = row => {
  if (!row) return null;
  requireThat(!row.response || digest(row.response) === row.response_hash, 503, 'MARKET_RESPONSE_CORRUPT');
  return { ...row, response: row.response ? JSON.parse(row.response) : null };
};
export function marketJobStatus(row) {
  if (!row) return { state: 'NOT_REQUESTED', refreshable: true };
  const state = ['RUNNING','REQUESTED'].includes(row.state) ? 'SEARCHING' : row.state;
  return { state, previewId: row.request_id, approvalActionId: row.approval_action_id,
    updatedAt: new Date(row.updated_at ?? row.created_at).toISOString(), ...(row.code ? { reason: row.code } : {}),
    refreshable: !['QUEUED','SEARCHING','UNKNOWN'].includes(state),
    ...(state === 'FAILED' && row.response ? { refreshAction: 'RETRY_SAVED_RESPONSE' } : {}) };
}

/** Runs in the existing human-approval transaction, after publication intent.
 * No provider or storage effect; one deterministic intent per exact approval. */
export async function recordApprovalMarket({ tx, principal, cardId, actionId }) {
  requireThat(principal.actorKind !== 'MACHINE' && principal.canCertify, 403, 'MANUAL_CERTIFICATION_REQUIRED');
  return insert(tx, { cardId, actionId, requestId: actionId, actorId: principal.id,
    accessVersion: principal.accessVersion, mode: principal.mode, expectedRevision: 0, origin: 'APPROVAL' });
}
async function insert(tx, { cardId, actionId, requestId, actorId, accessVersion, mode, expectedRevision, origin }) {
  const input = { requestId, approvalActionId: actionId, expectedRevision }, request = canonical(input);
  const [approval] = await tx.$queryRawUnsafe(`SELECT a.source_hash,a.report_hash,p.mode FROM atlas_manual.approval a
    JOIN atlas_manual.publication p USING(card_id,action_id) WHERE a.card_id=$1::uuid AND a.action_id=$2::uuid`, cardId, actionId);
  requireThat(approval?.mode === mode && Number.isInteger(accessVersion), 409, 'MARKET_APPROVAL_REQUIRED');
  await tx.$executeRawUnsafe(`INSERT INTO atlas_manual.presentation_market(card_id,approval_action_id,request_id,actor_id,request,request_hash)
    VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6) ON CONFLICT DO NOTHING`, cardId, actionId, requestId, actorId, request, digest(request));
  await tx.$executeRawUnsafe(`INSERT INTO ${table}(request_id,card_id,approval_action_id,actor_id,access_version,mode,origin,source_hash,report_hash)
    VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
  requestId, cardId, actionId, actorId, accessVersion, mode, origin, approval.source_hash, approval.report_hash);
  const [job] = await tx.$queryRawUnsafe(`SELECT * FROM ${table} WHERE request_id=$1::uuid`, requestId);
  requireThat(job?.card_id === cardId && job.approval_action_id === actionId && job.source_hash === approval.source_hash
    && job.report_hash === approval.report_hash, 409, 'PRESENTATION_REQUEST_CONFLICT');
  return stored(job);
}

export function createMarketJobStore({ boundary, validateAccess = null, leaseMs = 180000 }) {
  requireThat(typeof boundary.machineTransaction === 'function' && Number.isInteger(leaseMs) && leaseMs >= 1000 && leaseMs <= 300000, 500, 'MARKET_WORKER_CONFIG_INVALID');
  const machine = work => boundary.machineTransaction(null, work);
  async function scope(tx, principal, cardId, actionId = null, write = false) {
    uuid(cardId); if (actionId) uuid(actionId);
    const [card] = await tx.$queryRawUnsafe(`SELECT * FROM atlas_manual.card WHERE id=$1::uuid FOR ${write ? 'UPDATE' : 'SHARE'}`, cardId);
    const approve = card && (card.owner_id === principal.id || card.approvers.includes(principal.id));
    requireThat(card && (approve || card.editors.includes(principal.id) || card.readers.includes(principal.id)), 404, 'MANUAL_CARD_NOT_FOUND');
    if (write) requireThat(approve && principal.role === 'REVIEWER' && principal.actorKind !== 'MACHINE', 403, 'MANUAL_CARD_ACCESS_DENIED');
    if (validateAccess) await validateAccess({ tx, principal, cardId });
    const [publication] = await tx.$queryRawUnsafe('SELECT * FROM atlas_manual.publication WHERE card_id=$1::uuid ORDER BY version DESC LIMIT 1', cardId);
    requireThat(publication && (!actionId || publication.action_id === actionId), 409, 'PRESENTATION_APPROVAL_STALE');
    return publication;
  }
  async function backfillPlan(tx, mode, refreshLegacyApprovalIds = []) {
    requireThat(Array.isArray(refreshLegacyApprovalIds) && new Set(refreshLegacyApprovalIds).size===refreshLegacyApprovalIds.length);
    refreshLegacyApprovalIds.forEach(uuid);
    const rows = await tx.$queryRawUnsafe(`SELECT p.card_id,p.action_id,p.state,p.public_hash,a.actor_id,a.source_hash,a.report_hash,
      atlas_manual_connected.display_owner_version(a.actor_id) access_version,
      (SELECT COALESCE(MAX(revision),0)::int FROM atlas_manual.presentation s WHERE s.card_id=p.card_id AND s.approval_action_id=p.action_id) revision,
      (SELECT jsonb_build_object('previewId',m.request_id,'state',m.state) FROM atlas_manual.presentation_market m WHERE m.card_id=p.card_id AND m.approval_action_id=p.action_id ORDER BY m.created_at DESC,m.request_id DESC LIMIT 1) saved_request,
      EXISTS(SELECT 1 FROM ${table} j WHERE j.card_id=p.card_id AND j.approval_action_id=p.action_id) has_job,
      EXISTS(SELECT 1 FROM atlas_manual.presentation_market m WHERE m.card_id=p.card_id AND m.approval_action_id=p.action_id AND m.state IN('STARTED','UNKNOWN')) legacy_uncertain
      FROM atlas_manual.publication p JOIN atlas_manual.approval a USING(card_id,action_id) JOIN atlas_manual.card c ON c.id=p.card_id
      WHERE p.mode=$1 AND (c.owner_id=a.actor_id OR a.actor_id=ANY(c.approvers))
      AND NOT EXISTS(SELECT 1 FROM atlas_manual.publication newer WHERE newer.card_id=p.card_id AND newer.version>p.version)
      AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=p.card_id)
      ORDER BY p.card_id,p.action_id`, mode);
    const entries = rows.map(row => ({ cardId: row.card_id, approvalActionId: row.action_id, sourceHash: row.source_hash,
      reportHash: row.report_hash, publicHash: row.public_hash, actorId: row.actor_id, accessVersion: row.access_version,
      expectedRevision: row.revision, savedSearch: row.saved_request,
      requestId: row.saved_request ? refreshRequestId(row.action_id,row.saved_request.previewId) : row.action_id,
      disposition: !row.access_version ? 'ACCESS_REVOKED' : row.has_job ? 'RETAIN_SAVED_SEARCH' : row.legacy_uncertain ? 'RECONCILE_UNKNOWN'
        : row.saved_request ? refreshLegacyApprovalIds.includes(row.action_id) ? 'REFRESH_LEGACY_SEARCH' : 'RETAIN_SAVED_SEARCH' : 'QUEUE_MISSING' }));
    const plan = { version: 'atlas-market-backfill-v1', mode, refreshLegacyApprovalIds: [...refreshLegacyApprovalIds].sort(), entries };
    return { ...plan, planHash: digest(canonical(plan, { maxBytes: 1048576 })) };
  }
  return Object.freeze({
    // Server-only maintenance. First return the exact read-only impact; applying
    // the reviewed hash cannot purchase searches or replace existing previews.
    backfillPlan({ refreshLegacyApprovalIds = [] } = {}) { return machine(({ tx, principal }) => backfillPlan(tx, principal.mode, refreshLegacyApprovalIds)); },
    backfill(expectedPlanHash, { refreshLegacyApprovalIds = [] } = {}) {
      requireThat(/^[a-f0-9]{64}$/.test(expectedPlanHash ?? ''), 400, 'MARKET_BACKFILL_PLAN_REQUIRED');
      return machine(async ({ tx, principal }) => {
        await tx.$queryRawUnsafe(`SELECT c.id FROM atlas_manual.card c WHERE EXISTS(SELECT 1 FROM atlas_manual.publication p WHERE p.card_id=c.id AND p.mode=$1) ORDER BY c.id FOR UPDATE`, principal.mode);
        const plan = await backfillPlan(tx, principal.mode, refreshLegacyApprovalIds);
        requireThat(plan.planHash === expectedPlanHash, 409, 'MARKET_BACKFILL_PLAN_CHANGED');
        const queued = [];
        for (const entry of plan.entries.filter(value => ['QUEUE_MISSING','REFRESH_LEGACY_SEARCH'].includes(value.disposition))) {
          const job = await insert(tx, { cardId: entry.cardId, actionId: entry.approvalActionId, requestId: entry.requestId,
            actorId: entry.actorId, accessVersion: entry.accessVersion, mode: principal.mode, expectedRevision: entry.expectedRevision, origin: 'BACKFILL' });
          queued.push(marketJobStatus(job));
        }
        return { planHash: plan.planHash, queued };
      });
    },
    async reserve(staff, cardId, input) {
      object(input, ['requestId','approvalActionId','expectedRevision']); uuid(input.requestId); uuid(input.approvalActionId);
      requireThat(Number.isSafeInteger(input.expectedRevision) && input.expectedRevision >= 0 && input.expectedRevision < 2147483647);
      return boundary.transaction(staff, async ({ tx, principal }) => {
        const publication = await scope(tx, principal, cardId, input.approvalActionId, true);
        const [recovery] = await tx.$queryRawUnsafe(`SELECT * FROM ${table} WHERE card_id=$1::uuid AND approval_action_id=$2::uuid
          AND audit @> jsonb_build_array(jsonb_build_object('event','RECOVERY','requestId',$3::text))`,cardId,input.approvalActionId,input.requestId);
        if(recovery){
          const receipt=recovery.audit.find(value=>value.event==='RECOVERY'&&value.requestId===input.requestId);
          requireThat(receipt.actorId===principal.id&&receipt.requestHash===digest(canonical(input)),409,'PRESENTATION_REQUEST_CONFLICT');
          return stored(recovery);
        }
        const [prior] = await tx.$queryRawUnsafe(`SELECT j.*,m.actor_id request_actor,m.request_hash FROM ${table} j JOIN atlas_manual.presentation_market m USING(card_id,request_id)
          WHERE j.request_id=$1::uuid`, input.requestId);
        if (prior) { requireThat(prior.card_id === cardId && prior.request_actor === principal.id && prior.request_hash === digest(canonical(input)), 409, 'PRESENTATION_REQUEST_CONFLICT'); return stored(prior); }
        const [existingRequest] = await tx.$queryRawUnsafe('SELECT request_id FROM atlas_manual.presentation_market WHERE card_id=$1::uuid AND request_id=$2::uuid', cardId, input.requestId);
        requireThat(!existingRequest, 409, 'PRESENTATION_REQUEST_CONFLICT');
        const [busy] = await tx.$queryRawUnsafe(`SELECT state FROM ${table} WHERE card_id=$1::uuid AND approval_action_id=$2::uuid
          AND state IN('QUEUED','RUNNING','REQUESTED','UNKNOWN') LIMIT 1`, cardId, input.approvalActionId);
        requireThat(!busy, 409, busy?.state === 'UNKNOWN' ? 'MARKET_OUTCOME_RECONCILIATION_REQUIRED' : 'MARKET_SEARCH_IN_PROGRESS');
        const [legacyUncertain] = await tx.$queryRawUnsafe(`SELECT m.state FROM atlas_manual.presentation_market m WHERE m.card_id=$1::uuid AND m.approval_action_id=$2::uuid
          AND m.state IN('STARTED','UNKNOWN') AND NOT EXISTS(SELECT 1 FROM ${table} j WHERE j.card_id=m.card_id AND j.request_id=m.request_id) LIMIT 1`, cardId, input.approvalActionId);
        requireThat(!legacyUncertain, 409, 'MARKET_OUTCOME_RECONCILIATION_REQUIRED');
        const [revision] = await tx.$queryRawUnsafe('SELECT COALESCE(MAX(revision),0)::int revision FROM atlas_manual.presentation WHERE card_id=$1::uuid AND approval_action_id=$2::uuid', cardId, input.approvalActionId);
        requireThat(revision.revision === input.expectedRevision, 409, 'PRESENTATION_REVISION_STALE');
        const [recoverable]=await tx.$queryRawUnsafe(`SELECT * FROM ${table} WHERE card_id=$1::uuid AND approval_action_id=$2::uuid
          ORDER BY created_at DESC,request_id DESC LIMIT 1`,cardId,input.approvalActionId);
        if(recoverable?.state==='FAILED'&&recoverable.response){
          return stored((await tx.$queryRawUnsafe(`UPDATE ${table} SET state='QUEUED',attempts=0,recoveries=recoveries+1,code='MARKET_RESPONSE_RECOVERED',
            available_at=clock_timestamp(),updated_at=clock_timestamp(),audit=audit||jsonb_build_array(jsonb_build_object('event','RECOVERY','requestId',$2::text,'requestHash',$3::text,'actorId',$4::text,'at',clock_timestamp()))
            WHERE request_id=$1::uuid RETURNING *`,recoverable.request_id,input.requestId,digest(canonical(input)),principal.id))[0]);
        }
        return insert(tx, { cardId, actionId: publication.action_id, requestId: input.requestId, actorId: principal.id,
          accessVersion: principal.accessVersion, mode: principal.mode, expectedRevision: input.expectedRevision, origin: 'REFRESH' });
      });
    },
    latest(staff, cardId) {
      return boundary.transaction(staff, async ({ tx, principal }) => {
        const publication = await scope(tx, principal, cardId);
        return stored((await tx.$queryRawUnsafe(`SELECT * FROM ${table} WHERE card_id=$1::uuid AND approval_action_id=$2::uuid ORDER BY created_at DESC,request_id DESC LIMIT 1`, cardId, publication.action_id))[0]);
      });
    },
    claim(concurrency = 2) {
      requireThat(Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 16, 500, 'MARKET_WORKER_CONFIG_INVALID');
      return machine(async ({ tx, principal }) => {
        const [lock] = await tx.$queryRawUnsafe('SELECT pg_try_advisory_xact_lock(721930,76) AS locked'); if (!lock.locked) return null;
        await tx.$executeRawUnsafe(`UPDATE ${table} SET state=CASE WHEN state='REQUESTED' AND response IS NULL THEN 'UNKNOWN' WHEN attempts>=6 THEN 'FAILED' ELSE 'QUEUED' END,
          code=CASE WHEN state='REQUESTED' AND response IS NULL THEN 'PROVIDER_OUTCOME_UNKNOWN' ELSE 'MARKET_LEASE_EXPIRED' END,
          claim_id=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE mode=$1 AND state IN('RUNNING','REQUESTED') AND lease_until<=clock_timestamp()`, principal.mode);
        // A late response is evidence, never authority for another dispatch.
        await tx.$executeRawUnsafe(`UPDATE ${table} SET state=CASE WHEN attempts>=6 THEN 'FAILED' ELSE 'QUEUED' END,code='MARKET_RESPONSE_RECOVERED',updated_at=clock_timestamp()
          WHERE mode=$1 AND state='UNKNOWN' AND response IS NOT NULL`, principal.mode);
        await tx.$executeRawUnsafe(`UPDATE ${table} j SET state='FAILED',code='MARKET_APPROVAL_NO_LONGER_ACTIVE',updated_at=clock_timestamp()
          WHERE j.mode=$1 AND j.state='QUEUED' AND NOT (${live})`, principal.mode);
        const [count] = await tx.$queryRawUnsafe(`SELECT count(*)::int n FROM ${table} WHERE mode=$1 AND state IN('RUNNING','REQUESTED') AND lease_until>clock_timestamp()`, principal.mode);
        if (count.n >= concurrency) return null;
        const [row] = await tx.$queryRawUnsafe(`SELECT j.* FROM ${table} j WHERE j.mode=$1 AND j.state='QUEUED' AND j.attempts<6
          AND j.available_at<=clock_timestamp() AND ${live} ORDER BY j.available_at,j.created_at,j.request_id LIMIT 1 FOR UPDATE OF j SKIP LOCKED`, principal.mode);
        if (!row) return null;
        return stored((await tx.$queryRawUnsafe(`UPDATE ${table} SET state='RUNNING',claim_id=$2::uuid,
          lease_until=clock_timestamp()+$3*interval '1 millisecond',attempts=attempts+1,updated_at=clock_timestamp() WHERE request_id=$1::uuid RETURNING *`, row.request_id, randomUUID(), leaseMs))[0]);
      });
    },
    renew(job) { return machine(async ({ tx }) => (await tx.$executeRawUnsafe(`UPDATE ${table} j SET lease_until=clock_timestamp()+$3*interval '1 millisecond',updated_at=clock_timestamp() WHERE ${active}`, job.request_id, job.claim_id, leaseMs)) === 1); },
    bind(job, source) {
      requireThat(source?.row?.source_hash === job.source_hash && source.row.report_hash === job.report_hash
        && source.row.card_id === job.card_id && source.row.action_id === job.approval_action_id && source.row.mode === job.mode
        && source.row.state === 'PUBLISHED' && source.publicHash === source.row.public_hash, 409, 'MARKET_APPROVAL_MISMATCH');
      return machine(async ({ tx }) => (await tx.$executeRawUnsafe(`UPDATE ${table} j SET public_hash=$3,updated_at=clock_timestamp()
        WHERE ${active} AND (public_hash IS NULL OR public_hash=$3)`, job.request_id, job.claim_id, source.publicHash)) === 1);
    },
    dispatch(job) { return machine(async ({ tx }) => (await tx.$executeRawUnsafe(`UPDATE ${table} j SET state='REQUESTED',dispatch_id=$2::uuid,audit=audit||jsonb_build_array(jsonb_build_object('event','DISPATCH','dispatchId',$2::text,'at',clock_timestamp())),updated_at=clock_timestamp()
      WHERE ${active} AND state='RUNNING' AND public_hash IS NOT NULL AND response IS NULL`, job.request_id, job.claim_id)) === 1); },
    recordResponse(job, response) {
      const value = canonical(response, { maxBytes: 524288 });
      // A late paid response survives retirement and lease loss. Only its exact
      // persisted dispatch can append it; immutable evidence cannot be replaced.
      return machine(async ({ tx, principal }) => (await tx.$executeRawUnsafe(`UPDATE ${table} SET response=$3,response_hash=$4,audit=audit||jsonb_build_array(jsonb_build_object('event','RESPONSE','dispatchId',$2::text,'responseHash',$4::text,'at',clock_timestamp())),updated_at=clock_timestamp()
        WHERE request_id=$1::uuid AND dispatch_id=$2::uuid AND mode=$5 AND response IS NULL`, job.request_id, job.claim_id, value, digest(value), principal.mode)) === 1);
    },
    finish(job, { result = null, code = null, disposition = 'FAILED' } = {}) {
      requireThat(result?.state === 'READY' || /^[A-Z][A-Z0-9_]{0,100}$/.test(code ?? ''), 500, 'MARKET_RESULT_INVALID');
      return machine(async ({ tx }) => {
        const [row] = await tx.$queryRawUnsafe(`SELECT j.* FROM ${table} j WHERE ${active} FOR UPDATE OF j`, job.request_id, job.claim_id);
        if (!row) return false;
        const state = result ? 'READY' : disposition === 'RETRY' && row.attempts < 6 ? 'QUEUED' : ['UNKNOWN','UNAVAILABLE'].includes(disposition) ? disposition : 'FAILED';
        if (result) {
          requireThat(row.response && row.public_hash, 409, 'MARKET_RESPONSE_REQUIRED');
          const value = canonical(result);
          const changed = await tx.$executeRawUnsafe(`UPDATE atlas_manual.presentation_market SET state='READY',result=$3,result_hash=$4 WHERE card_id=$1::uuid AND request_id=$2::uuid AND state='STARTED'`, row.card_id, row.request_id, value, digest(value));
          requireThat(changed === 1, 409, 'MARKET_RESULT_CONFLICT');
        }
        return (await tx.$executeRawUnsafe(`UPDATE ${table} SET state=$3,code=$4,claim_id=NULL,lease_until=NULL,
          available_at=clock_timestamp()+$5*interval '1 millisecond',audit=audit||jsonb_build_array(jsonb_build_object('event',$3::text,'code',$4::text,'claimId',$2::text,'at',clock_timestamp())),updated_at=clock_timestamp() WHERE request_id=$1::uuid AND claim_id=$2::uuid`,
        row.request_id, row.claim_id, state, code, state === 'QUEUED' ? Math.min(60000, 2000 * 2 ** row.attempts) : 0)) === 1;
      });
    },
  });
}
export function marketJobGrantSQL(role) {
  requireThat(/^[a-z][a-z0-9_]{0,62}$/.test(role));
  return `GRANT USAGE ON SCHEMA atlas_manual_connected TO "${role}";
GRANT SELECT,INSERT ON ${table} TO "${role}";
GRANT UPDATE(state,attempts,recoveries,claim_id,lease_until,dispatch_id,public_hash,response,response_hash,code,available_at,updated_at,audit) ON ${table} TO "${role}";
GRANT EXECUTE ON FUNCTION atlas_manual_connected.display_owner_current(uuid,integer),atlas_manual_connected.display_owner_version(uuid) TO "${role}";`;
}
