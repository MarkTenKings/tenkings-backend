import { randomUUID } from 'node:crypto';
import { canonical, digest, object, requireThat, uuid } from '@atlas/manual-service/contract';
import { parseUploadPlan } from '@atlas/photo-core';
import { parseReportPresentation } from '@atlas/report-view/presentation-contract';

const integer = value => requireThat(Number.isSafeInteger(value) && value >= 0 && value < 2147483647);
const document = value => ({ text: canonical(value), hash: digest(canonical(value)) });
function stored(text, hash) { requireThat(typeof text === 'string' && digest(text) === hash, 503, 'PRESENTATION_CORRUPT'); return JSON.parse(text); }
function sources(row) {
  const value = row?.market_source ? stored(row.market_source, row.market_source_hash) : null;
  return value?.version === 'atlas-market-sources-v2' ? value : { version: 'atlas-market-sources-v2', soldReferences: value, dealerOffers: null };
}
export function presentationBinding(row) { return { publicToken: row.public_token, approvalVersion: row.version, publicHash: row.public_hash }; }
export function presentationRow(row, binding) {
  if (!row) return null;
  const value = parseReportPresentation(stored(row.presentation, row.presentation_hash), binding);
  requireThat(value.revision === row.revision, 503, 'PRESENTATION_CORRUPT'); return value;
}
export function presentationGrantSQL(role) {
  requireThat(typeof role === 'string' && /^[a-z][a-z0-9_]{0,62}$/.test(role));
  return `GRANT SELECT,INSERT ON atlas_manual.presentation,atlas_manual.presentation_upload,atlas_manual.presentation_market TO "${role}";\nGRANT UPDATE(state,result,result_hash) ON atlas_manual.presentation_market TO "${role}";`;
}
export function createPresentationRepository({ boundary, keyPrefix, maxOriginalBytes = 64 * 1024 * 1024 }) {
  requireThat(typeof keyPrefix === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_/-]{0,100}$/.test(keyPrefix) && !keyPrefix.includes('..') && !keyPrefix.endsWith('/'), 500, 'PRESENTATION_CONFIGURATION_INVALID');
  async function scope(tx, principal, cardId, actionId = null, write = false) {
    uuid(cardId); if (actionId) uuid(actionId);
    const [card] = await tx.$queryRawUnsafe(`SELECT * FROM atlas_manual.card WHERE id=$1::uuid FOR ${write ? 'UPDATE' : 'SHARE'}`, cardId);
    const approve = card && (card.owner_id === principal.id || card.approvers.includes(principal.id));
    requireThat(card && (approve || card.editors.includes(principal.id) || card.readers.includes(principal.id)), 404, 'MANUAL_CARD_NOT_FOUND');
    if (write) requireThat(approve && principal.role === 'REVIEWER', 403, 'MANUAL_CARD_ACCESS_DENIED');
    const [publication] = await tx.$queryRawUnsafe(`SELECT p.*,i.public_token FROM atlas_manual.publication p
      JOIN atlas_manual.public_report_identity i USING(card_id) WHERE p.card_id=$1::uuid ORDER BY p.version DESC LIMIT 1`, cardId);
    requireThat(publication?.state === 'PUBLISHED', 409, 'PRESENTATION_APPROVAL_REQUIRED');
    if (actionId) requireThat(publication.action_id === actionId, 409, 'PRESENTATION_APPROVAL_STALE');
    const [row] = await tx.$queryRawUnsafe('SELECT * FROM atlas_manual.presentation WHERE card_id=$1::uuid AND approval_action_id=$2::uuid ORDER BY revision DESC LIMIT 1', cardId, publication.action_id);
    return { publication, binding: presentationBinding(publication), previous: row, revision: row?.revision ?? 0 };
  }
  function view(state) { return { presentation: presentationRow(state.previous, state.binding), revision: state.revision, approvalActionId: state.publication.action_id }; }
  async function upload(tx, cardId, id) {
    uuid(id); const [row] = await tx.$queryRawUnsafe('SELECT * FROM atlas_manual.presentation_upload WHERE card_id=$1::uuid AND id=$2::uuid', cardId, id);
    requireThat(row, 404, 'PRESENTATION_UPLOAD_NOT_FOUND');
    const request = stored(row.request, row.request_hash), plan = parseUploadPlan(stored(row.plan, row.plan_hash));
    requireThat(plan.uploadId === row.id && plan.binding.cardId === cardId && plan.binding.pairId === row.approval_action_id && request.approvalActionId === row.approval_action_id, 503, 'PRESENTATION_CORRUPT');
    return { ...row, request, plan };
  }
  const repository = {
    status: (staff, cardId) => boundary.transaction(staff, async ({ tx, principal }) => view(await scope(tx, principal, cardId))),
    async plan(staff, cardId, input) {
      object(input, ['requestId','approvalActionId','expectedRevision','sha256','byteCount','alt']);
      uuid(input.requestId); uuid(input.approvalActionId); integer(input.expectedRevision);
      requireThat(/^[a-f0-9]{64}$/.test(input.sha256) && Number.isSafeInteger(input.byteCount) && input.byteCount > 0 && input.byteCount <= maxOriginalBytes
        && typeof input.alt === 'string' && input.alt.trim().length > 0 && input.alt.length <= 300 && !/[\x00-\x1f\x7f]/.test(input.alt));
      const request = document(input);
      return boundary.transaction(staff, async ({ tx, principal, refresh }) => {
        const state = await scope(tx, principal, cardId, input.approvalActionId, true);
        const [existing] = await tx.$queryRawUnsafe('SELECT * FROM atlas_manual.presentation_upload WHERE card_id=$1::uuid AND request_id=$2::uuid', cardId, input.requestId);
        if (existing) { requireThat(existing.actor_id === principal.id && existing.request_hash === request.hash, 409, 'PRESENTATION_REQUEST_CONFLICT'); return { uploadId: existing.id }; }
        requireThat(state.revision === input.expectedRevision, 409, 'PRESENTATION_REVISION_STALE');
        const id = randomUUID(), plan = document(parseUploadPlan({ schemaVersion: 1, uploadId: id,
          binding: { cardId, pairId: input.approvalActionId, side: 'FRONT', version: 1 },
          object: { key: `${keyPrefix}/originals/${cardId}/presentation/${id}`, versionId: null }, expected: { sha256: input.sha256, byteCount: input.byteCount } }));
        await scope(tx, (await refresh()).principal, cardId, input.approvalActionId, true);
        await tx.$executeRawUnsafe(`INSERT INTO atlas_manual.presentation_upload(id,card_id,approval_action_id,request_id,actor_id,request,request_hash,plan,plan_hash)
          VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7,$8,$9)`, id, cardId, input.approvalActionId, input.requestId, principal.id, request.text, request.hash, plan.text, plan.hash);
        return { uploadId: id };
      });
    },
    loadUpload: (staff, cardId, id) => boundary.transaction(staff, async ({ tx, principal }) => {
      const saved = await upload(tx, cardId, id), state = await scope(tx, principal, cardId, saved.approval_action_id, true);
      const [done] = await tx.$queryRawUnsafe('SELECT * FROM atlas_manual.presentation WHERE card_id=$1::uuid AND request_id=$2::uuid', cardId, saved.request.requestId);
      if (!done) requireThat(state.revision === saved.request.expectedRevision, 409, 'PRESENTATION_REVISION_STALE');
      return { upload: saved, done: done ? { presentation: presentationRow(done, state.binding), revision: done.revision, approvalActionId: saved.approval_action_id } : null };
    }),
    async commit(staff, cardId, input, photo = null, marketUpdate = null, dealerUpdate = null) {
      object(input, ['requestId','approvalActionId','expectedRevision']); uuid(input.requestId); uuid(input.approvalActionId); integer(input.expectedRevision);
      requireThat(!dealerUpdate || !marketUpdate && !photo, 400, 'PRESENTATION_REQUEST_INVALID');
      const request = document({ ...input, photo, ...(marketUpdate ? { marketUpdate } : {}), ...(dealerUpdate ? { dealerUpdate } : {}) });
      return boundary.transaction(staff, async ({ tx, principal, refresh }) => {
        const state = await scope(tx, principal, cardId, input.approvalActionId, true);
        const [existing] = await tx.$queryRawUnsafe('SELECT * FROM atlas_manual.presentation WHERE card_id=$1::uuid AND request_id=$2::uuid', cardId, input.requestId);
        if (existing) {
          requireThat(existing.actor_id === principal.id && existing.request_hash === request.hash, 409, 'PRESENTATION_REQUEST_CONFLICT');
          return { presentation: presentationRow(existing, state.binding), revision: existing.revision, approvalActionId: input.approvalActionId };
        }
        requireThat(state.revision === input.expectedRevision, 409, 'PRESENTATION_REVISION_STALE');
        const revision = state.revision + 1, previous = presentationRow(state.previous, state.binding);
        const { slabPhoto: ignored, ...retained } = previous ?? {};
        const selectedPhoto = marketUpdate || dealerUpdate ? previous?.slabPhoto : photo?.descriptor;
        const value = parseReportPresentation({ ...retained, version: 'atlas-report-presentation-v1', binding: state.binding, revision,
          updatedAt: new Date().toISOString(), dealerDirectory: { url: '/dealers?service=buy' },
          ...(selectedPhoto ? { slabPhoto: { ...selectedPhoto, url: `/api/reports/${state.binding.publicToken}/presentation/image?v=${state.binding.approvalVersion}&revision=${revision}` } } : {}),
          ...(marketUpdate ? { market: marketUpdate.market } : {}), ...(dealerUpdate ? { dealerOffers: dealerUpdate.dealerOffers } : {}) }, state.binding);
        const saved = document(value), media = (marketUpdate || dealerUpdate) && state.previous?.media ? { text: state.previous.media, hash: state.previous.media_hash } : photo ? document(photo.media) : null;
        const previousSources = sources(state.previous);
        const marketSource = dealerUpdate ? document({ ...previousSources, dealerOffers: dealerUpdate.source })
          : marketUpdate ? document(previousSources.dealerOffers ? { ...previousSources, soldReferences: marketUpdate.source } : marketUpdate.source)
          : state.previous?.market_source ? { text: state.previous.market_source, hash: state.previous.market_source_hash } : null;
        requireThat(!marketSource || Buffer.byteLength(marketSource.text) <= 32768, 413, 'PRESENTATION_SOURCE_TOO_LARGE');
        await scope(tx, (await refresh()).principal, cardId, input.approvalActionId, true);
        await tx.$executeRawUnsafe(`INSERT INTO atlas_manual.presentation(card_id,approval_action_id,revision,request_id,request_hash,actor_id,presentation,presentation_hash,media,media_hash,market_source,market_source_hash)
          VALUES($1::uuid,$2::uuid,$3,$4::uuid,$5,$6::uuid,$7,$8,$9,$10,$11,$12)`, cardId, input.approvalActionId, revision, input.requestId, request.hash, principal.id, saved.text, saved.hash, media?.text ?? null, media?.hash ?? null, marketSource?.text ?? null, marketSource?.hash ?? null);
        return { presentation: value, revision, approvalActionId: input.approvalActionId };
      });
    },
    async reserveMarket(staff, cardId, input, onCreated = null) {
      object(input, ['requestId','approvalActionId','expectedRevision']); uuid(input.requestId); uuid(input.approvalActionId); integer(input.expectedRevision);
      const request = document(input);
      return boundary.transaction(staff, async ({ tx, principal }) => {
        const state = await scope(tx, principal, cardId, input.approvalActionId, true);
        const [existing] = await tx.$queryRawUnsafe('SELECT * FROM atlas_manual.presentation_market WHERE card_id=$1::uuid AND request_id=$2::uuid', cardId, input.requestId);
        if (existing) { requireThat(existing.actor_id === principal.id && existing.request_hash === request.hash, 409, 'PRESENTATION_REQUEST_CONFLICT'); return { created: false, ...existing }; }
        requireThat(state.revision === input.expectedRevision, 409, 'PRESENTATION_REVISION_STALE');
        await tx.$executeRawUnsafe(`INSERT INTO atlas_manual.presentation_market(card_id,approval_action_id,request_id,actor_id,request,request_hash)
          VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6)`, cardId, input.approvalActionId, input.requestId, principal.id, request.text, request.hash);
        // Server-owned initialization shares this transaction; callback failure rolls back the reservation.
        if (onCreated) await onCreated(tx);
        return { created: true, state: 'STARTED', request: request.text, request_id: input.requestId, approval_action_id: input.approvalActionId };
      });
    },
    async market(staff, cardId, requestId) {
      uuid(requestId);
      return boundary.transaction(staff, async ({ tx, principal }) => {
        const state = await scope(tx, principal, cardId, null, true);
        const [row] = await tx.$queryRawUnsafe('SELECT * FROM atlas_manual.presentation_market WHERE card_id=$1::uuid AND request_id=$2::uuid', cardId, requestId);
        requireThat(row && row.actor_id === principal.id, 404, 'PRESENTATION_MARKET_NOT_FOUND');
        requireThat(row.approval_action_id === state.publication.action_id, 409, 'PRESENTATION_APPROVAL_STALE');
        return { ...row, input: stored(row.request, row.request_hash), saved: row.result ? stored(row.result, row.result_hash) : null };
      });
    },
    async finishMarket(staff, cardId, requestId, result) {
      requireThat(['READY','UNAVAILABLE','UNKNOWN'].includes(result?.state)); const saved = document(result);
      return boundary.transaction(staff, async ({ tx, principal }) => {
        const state = await scope(tx, principal, cardId, null, true);
        const [row] = await tx.$queryRawUnsafe('SELECT * FROM atlas_manual.presentation_market WHERE card_id=$1::uuid AND request_id=$2::uuid FOR UPDATE', cardId, requestId);
        requireThat(row && row.actor_id === principal.id && row.approval_action_id === state.publication.action_id, 409, 'PRESENTATION_APPROVAL_STALE');
        if (row.state !== 'STARTED') { requireThat(row.result_hash === saved.hash, 409, 'PRESENTATION_REQUEST_CONFLICT'); return; }
        await tx.$executeRawUnsafe("UPDATE atlas_manual.presentation_market SET state=$3,result=$4,result_hash=$5 WHERE card_id=$1::uuid AND request_id=$2::uuid AND state='STARTED'", cardId, requestId, result.state, saved.text, saved.hash);
      });
    },
    async marketCommitStatus(staff, cardId, input) {
      return boundary.transaction(staff, async ({ tx, principal }) => {
        const state = await scope(tx, principal, cardId, input.approvalActionId, true);
        const [row] = await tx.$queryRawUnsafe('SELECT * FROM atlas_manual.presentation WHERE card_id=$1::uuid AND request_id=$2::uuid', cardId, input.requestId);
        if (!row) return null;
        const source = sources(row).soldReferences;
        const presentation = presentationRow(row, state.binding);
        const expected = source && presentation.market ? document({ requestId: input.requestId, approvalActionId: input.approvalActionId,
          expectedRevision: input.expectedRevision, photo: null, marketUpdate: { market: presentation.market, source } }).hash : null;
        requireThat(row.actor_id === principal.id && row.approval_action_id === input.approvalActionId && row.revision === input.expectedRevision + 1
          && row.request_hash === expected
          && source?.version === 'atlas-selected-market-source-v1' && source.previewId === input.previewId
          && canonical(source.selectedIds) === canonical(input.selectedIds), 409, 'PRESENTATION_REQUEST_CONFLICT');
        return { presentation, revision: row.revision, approvalActionId: input.approvalActionId };
      });
    },
    async dealerOfferCommitStatus(staff, cardId, input) {
      return boundary.transaction(staff, async ({ tx, principal }) => {
        const state = await scope(tx, principal, cardId, input.approvalActionId, true);
        const [row] = await tx.$queryRawUnsafe('SELECT * FROM atlas_manual.presentation WHERE card_id=$1::uuid AND request_id=$2::uuid', cardId, input.requestId);
        if (!row) return null;
        const source = sources(row).dealerOffers, presentation = presentationRow(row, state.binding);
        const expected = source && presentation.dealerOffers ? document({ requestId: input.requestId, approvalActionId: input.approvalActionId,
          expectedRevision: input.expectedRevision, photo: null, dealerUpdate: { dealerOffers: presentation.dealerOffers, source } }).hash : null;
        requireThat(row.actor_id === principal.id && row.approval_action_id === input.approvalActionId && row.revision === input.expectedRevision + 1
          && row.request_hash === expected && source?.version === 'atlas-selected-dealer-offers-v1' && source.sourceHash === input.sourceHash
          && canonical(source.selectedIds) === canonical(input.selectedIds), 409, 'PRESENTATION_REQUEST_CONFLICT');
        return { presentation, revision: row.revision, approvalActionId: input.approvalActionId };
      });
    },
  };
  return Object.freeze(repository);
}
