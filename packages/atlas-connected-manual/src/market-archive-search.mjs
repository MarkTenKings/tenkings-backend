// Explicit post-grade search authority. No grading/publication/presentation
// writer is supplied here. Construction is cold and the capability is branded.
import { canonical, digest, requireThat, uuid } from '@atlas/manual-service/contract';
import { createManualFinishing } from './finishing.mjs';

export const ARCHIVE_MARKET_ORIGIN = 'ARCHIVE_SEARCH_V1';
const VERSION = 'atlas-market-archive-search-authority-v1';
const capabilities = new WeakMap();
const refuse = ok => requireThat(ok, 500, 'MARKET_ARCHIVE_CONFIGURATION_INVALID');
const same = (a, b) => canonical(a) === canonical(b);
const fields = row => ({ cardId: row.card_id, approvalActionId: row.action_id, mode: row.mode,
  sourceRevision: row.source_revision, sourceHash: row.source_hash, reportHash: row.report_hash,
  publicToken: row.public_token, publicVersion: row.version, publicHash: row.public_hash, manifestHash: row.manifest_hash });

// Referenced only by an explicitly installed capability. Legacy stores never
// reference the proposal's new columns. The DB trigger fixes this exact binding
// at admission; this predicate rechecks current authority at each lease/effect.
export const archiveMarketLiveSQL = `j.origin='ARCHIVE_SEARCH_V1'
 AND j.archive_authority_hash=encode(sha256(convert_to(j.archive_authority,'UTF8')),'hex')
 AND j.archive_authority::jsonb->>'version'='atlas-market-archive-search-authority-v1'
 AND EXISTS(SELECT 1 FROM atlas_manual.publication p JOIN atlas_manual.approval a USING(card_id,action_id)
 JOIN atlas_manual.public_report_identity r USING(card_id) JOIN atlas_manual.card c ON c.id=p.card_id
 JOIN atlas_manual_intake.card i ON i.id=c.id
 JOIN atlas_manual.presentation_market m ON m.card_id=j.card_id AND m.request_id=j.request_id
 WHERE p.card_id=j.card_id AND p.action_id=j.approval_action_id AND p.state='PUBLISHED' AND p.mode=j.mode
 AND a.source_hash=j.source_hash AND a.report_hash=j.report_hash
 AND (j.public_hash IS NULL OR p.public_hash=j.public_hash)
 AND j.archive_authority::jsonb=jsonb_build_object('version','atlas-market-archive-search-authority-v1',
 'requestId',j.request_id::text,'cardId',j.card_id::text,'approvalActionId',j.approval_action_id::text,
 'actorId',j.actor_id::text,'accessVersion',j.access_version,'mode',j.mode,'sourceRevision',a.source_revision,
 'sourceHash',a.source_hash,'reportHash',a.report_hash,'publicToken',r.public_token,'publicVersion',p.version,
 'publicHash',p.public_hash,'manifestHash',p.manifest_hash,'requestHash',m.request_hash)
 AND m.actor_id=j.actor_id AND m.approval_action_id=j.approval_action_id
 AND m.request_hash=encode(sha256(convert_to(m.request,'UTF8')),'hex')
 AND (c.owner_id=j.actor_id OR j.actor_id=ANY(c.approvers) OR j.actor_id=ANY(c.editors) OR j.actor_id=ANY(c.readers))
 AND NOT EXISTS(SELECT 1 FROM atlas_manual.publication newer WHERE newer.card_id=p.card_id AND newer.version>p.version)
 AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=i.id OR (d.owner_id=i.owner_id AND d.create_request_id=i.create_request_id)))
 AND atlas_manual_connected.display_owner_current(j.actor_id,j.access_version)`;

export function assertMarketArchiveSearchCapability(capability, dependencies = null) {
  const owned = capabilities.get(capability); refuse(owned);
  if (dependencies) refuse(Object.keys(dependencies).every(key => ['boundary', 'artifacts', 'validateAccess'].includes(key) && owned[key] === dependencies[key]));
  owned.current(); return capability;
}
export function createMarketArchiveSearchCapability({ boundary, artifacts, validateAccess }) {
  const transaction = boundary?.transaction, machineTransaction = boundary?.machineTransaction, read = artifacts?.read;
  refuse(typeof transaction === 'function' && typeof machineTransaction === 'function' && typeof read === 'function' && typeof validateAccess === 'function');
  const current = () => refuse(boundary.transaction === transaction && boundary.machineTransaction === machineTransaction && artifacts.read === read);
  async function human(context, card, expected) {
    current(); refuse(typeof context?.refresh === 'function');
    const access = actor => {
      requireThat(actor?.id === expected.id && actor.accessVersion === expected.accessVersion, 401, 'SIGN_IN_REQUIRED');
      requireThat(actor.role === 'REVIEWER' && actor.actorKind !== 'MACHINE', 403, 'MANUAL_CARD_ACCESS_DENIED');
      requireThat(actor.mode === expected.mode, 409, 'MARKET_ARCHIVE_APPROVAL_STALE');
      requireThat(card && (card.owner_id === actor.id || ['approvers','editors','readers'].some(key => card[key]?.includes(actor.id))), 404, 'MANUAL_CARD_NOT_FOUND');
    };
    let actor = (await context.refresh()).principal; access(actor);
    await validateAccess({ tx: context.tx, principal: actor, cardId: card.id });
    const [active] = await context.tx.$queryRawUnsafe(`/* market-archive:active */ SELECT i.id FROM atlas_manual_intake.card i
      WHERE i.id=$1::uuid AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d
        WHERE d.card_id=i.id OR (d.owner_id=i.owner_id AND d.create_request_id=i.create_request_id)) FOR SHARE OF i`, card.id);
    requireThat(active?.id === card.id, 410, 'INTAKE_CARD_DELETED');
    actor = (await context.refresh()).principal; current(); access(actor); return actor;
  }
  const publicationSQL = `/* market-archive:publication */ SELECT p.*,r.public_token,r.report_number,
    a.actor_id,a.source_revision,a.source_hash,a.report_hash,a.report,a.approved_at,j.result
    FROM atlas_manual.publication p JOIN atlas_manual.public_report_identity r USING(card_id)
    JOIN atlas_manual.approval a USING(card_id,action_id) JOIN atlas_manual.action j USING(card_id,action_id)
    WHERE p.card_id=$1::uuid ORDER BY p.version DESC LIMIT 1`;
  async function scope(context, cardId, approvalActionId = null, write = false) {
    uuid(cardId); if (approvalActionId) uuid(approvalActionId); current();
    const expected = { id: context.principal.id, accessVersion: context.principal.accessVersion, mode: context.principal.mode };
    requireThat(Number.isInteger(expected.accessVersion) && expected.accessVersion > 0, 401, 'SIGN_IN_REQUIRED');
    const [card] = await context.tx.$queryRawUnsafe(`/* market-archive:card */ SELECT * FROM atlas_manual.card WHERE id=$1::uuid FOR ${write ? 'UPDATE' : 'SHARE'}`, cardId);
    const actor = await human(context, card, expected);
    const [publication] = await context.tx.$queryRawUnsafe(publicationSQL, cardId);
    requireThat(publication?.card_id === cardId && publication.state === 'PUBLISHED' && publication.mode === actor.mode
      && (!approvalActionId || publication.action_id === approvalActionId), 409, 'MARKET_ARCHIVE_APPROVAL_STALE');
    await human(context, card, expected);
    return { card, actor, publication, binding: fields(publication) };
  }
  function authority(state, input) {
    return { version: VERSION, requestId: input.requestId, ...state.binding, actorId: state.actor.id,
      accessVersion: state.actor.accessVersion, requestHash: digest(canonical(input)) };
  }
  function verifyJob(job, state = null) {
    current(); requireThat(job?.origin === ARCHIVE_MARKET_ORIGIN && typeof job.archive_authority === 'string'
      && digest(job.archive_authority) === job.archive_authority_hash, 409, 'MARKET_ARCHIVE_AUTHORITY_INVALID');
    const value = JSON.parse(job.archive_authority);
    requireThat(value.version === VERSION && value.requestId === job.request_id && value.cardId === job.card_id
      && value.approvalActionId === job.approval_action_id && value.actorId === job.actor_id && value.accessVersion === job.access_version
      && value.mode === job.mode && value.sourceHash === job.source_hash && value.reportHash === job.report_hash
      && (job.public_hash === null || job.public_hash === value.publicHash), 409, 'MARKET_ARCHIVE_AUTHORITY_INVALID');
    if (state) requireThat(state.actor.id === value.actorId && state.actor.accessVersion === value.accessVersion
      && Object.entries(state.binding).every(([key, item]) => value[key] === item), 409, 'MARKET_ARCHIVE_APPROVAL_STALE');
    return value;
  }
  const humanRepository = Object.freeze({ load(staff, cardId, actionId) {
    current(); return transaction.call(boundary, staff, async context => (await scope(context, cardId, actionId)).publication);
  } });
  const workerRepository = Object.freeze({ async load(job, cardId, actionId) {
    verifyJob(job); requireThat(job.card_id === cardId && job.approval_action_id === actionId, 409, 'MARKET_ARCHIVE_AUTHORITY_INVALID');
    return machineTransaction.call(boundary, null, async ({ tx, principal }) => {
      const [live] = await tx.$queryRawUnsafe(`/* market-archive:worker */ SELECT j.* FROM atlas_manual_connected.market_job j
        WHERE j.request_id=$1::uuid AND j.claim_id=$2::uuid AND j.mode=$3 AND j.state IN('RUNNING','REQUESTED')
        AND j.lease_until>clock_timestamp() AND ${archiveMarketLiveSQL}`, job.request_id, job.claim_id, principal.mode);
      requireThat(live && live.archive_authority === job.archive_authority && live.archive_authority_hash === job.archive_authority_hash,
        409, 'MARKET_ARCHIVE_ACCESS_ENDED');
      const [publication] = await tx.$queryRawUnsafe(publicationSQL, cardId), pinned = verifyJob(live);
      requireThat(publication?.state === 'PUBLISHED' && Object.entries(fields(publication)).every(([key, value]) => pinned[key] === value),
        409, 'MARKET_ARCHIVE_APPROVAL_STALE');
      current(); return publication;
    });
  } });
  const boundArtifacts = Object.freeze({ async read(...args) { current(); const value = await read.apply(artifacts, args); current(); return value; } });
  const approved = createManualFinishing({ repository: humanRepository, artifacts: boundArtifacts });
  const worker = createManualFinishing({ repository: workerRepository, artifacts: boundArtifacts });
  const repository = Object.freeze({
    async market(staff, cardId, requestId) {
      uuid(requestId); current(); return transaction.call(boundary, staff, async context => {
        const before = await scope(context, cardId);
        const [row] = await context.tx.$queryRawUnsafe('/* market-archive:market */ SELECT * FROM atlas_manual.presentation_market WHERE card_id=$1::uuid AND request_id=$2::uuid', cardId, requestId);
        requireThat(row && row.approval_action_id === before.publication.action_id, 404, 'PRESENTATION_MARKET_NOT_FOUND');
        requireThat(digest(row.request) === row.request_hash && (!row.result || digest(row.result) === row.result_hash), 503, 'PRESENTATION_CORRUPT');
        const after = await scope(context, cardId, before.publication.action_id);
        requireThat(same(before.binding, after.binding) && before.actor.id === after.actor.id, 409, 'MARKET_ARCHIVE_APPROVAL_STALE');
        return { ...row, input: JSON.parse(row.request), saved: row.result ? JSON.parse(row.result) : null,
          archiveReadBinding: { ...before.binding, actorId: before.actor.id, accessVersion: before.actor.accessVersion } };
      });
    },
    async latestMarket(staff, cardId) {
      current(); return transaction.call(boundary, staff, async context => {
        const state = await scope(context, cardId);
        const [row] = await context.tx.$queryRawUnsafe('/* market-archive:latest */ SELECT request_id FROM atlas_manual.presentation_market WHERE card_id=$1::uuid AND approval_action_id=$2::uuid ORDER BY created_at DESC,request_id DESC LIMIT 1', cardId, state.publication.action_id);
        await human(context, state.card, state.actor); return row?.request_id ?? null;
      });
    },
  });
  const capability = Object.freeze({ version: VERSION, scope, authority, verifyJob, approved, repository,
    loadJobPacket: job => worker.loadPacket(job, job.card_id, job.approval_action_id) });
  capabilities.set(capability, { boundary, artifacts, validateAccess, current }); return capability;
}
