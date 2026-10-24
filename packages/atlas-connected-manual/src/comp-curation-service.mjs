// Unregistered, private proposal. No provider/job/listing/report writer is
// accepted by this constructor. The only mutation is a new curation receipt.
import { canonical, digest, requireThat, uuid } from '@atlas/manual-service/contract';
import { marketPreviewHash, publishedMarketQuery } from './presentation-market.mjs';
import { publishedResearchQuery } from './research-market-query.mjs';
import { compCurationInput, compCurationReadInput, compCurationPolicy, compEvidenceSelectionPolicy, evaluateCompCuration, parseSavedCompSource } from './comp-curation-contract.mjs';
import { assertCompCurationArchiveCapability } from './comp-curation-archive.mjs';

const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const document = (value, maxBytes) => { const text = canonical(value, { maxBytes }); return { text, hash: digest(text) }; };
function stored(text, expectedHash) {
  requireThat(typeof text === 'string' && digest(text) === expectedHash, 503, 'COMP_CURATION_CORRUPT');
  try { return JSON.parse(text); } catch { requireThat(false, 503, 'COMP_CURATION_CORRUPT'); }
}
function binding(row) {
  return { cardId: row.card_id, approvalActionId: row.action_id, sourceRevision: row.source_revision, sourceHash: row.source_hash,
    reportHash: row.report_hash, publicToken: row.public_token, publicVersion: row.version, publicHash: row.public_hash, mode: row.mode };
}
const same = (a, b) => canonical(a) === canonical(b);
function receipt(row) {
  if (!row) return null;
  const value = stored(row.receipt, row.receipt_hash), facts = stored(row.selected_facts, row.selected_facts_hash);
  requireThat(value.schema === 'atlas-comp-curation-receipt-v1' && value.status === 'LOCAL_PROPOSAL'
    && value.visibility === 'PRIVATE_INTERNAL' && value.actorId === row.actor_id && value.requestId === row.request_id
    && value.revision === row.revision && value.selectedFactsHash === row.selected_facts_hash && same(value.selected, facts)
    && same(value.binding, stored(row.binding, row.binding_hash))
    && same(value.source, row.source === null ? null : stored(row.source, row.source_hash)), 503, 'COMP_CURATION_CORRUPT');
  return value;
}
export function compCurationGrantSQL(role) {
  requireThat(typeof role === 'string' && /^[a-z][a-z0-9_]{0,62}$/.test(role) && role !== 'public' && !role.startsWith('pg_'));
  // Existing manual role/read grants and boundary remain separate prerequisites.
  return `GRANT SELECT,INSERT ON atlas_manual.comp_curation TO "${role}";`;
}
export function createCompCurationService({ boundary, approved, artifacts, validateAccess, policy = null, selectionPolicy = null, archiveCapability = null,
  designationReviewsEnabled = false }) {
  requireThat(typeof boundary?.transaction === 'function' && typeof approved?.loadPacket === 'function'
    && typeof artifacts?.read === 'function' && typeof validateAccess === 'function', 500, 'COMP_CURATION_CONFIGURATION_INVALID');
  requireThat(policy === null || selectionPolicy === null, 500, 'COMP_CURATION_CONFIGURATION_INVALID');
  // Explicit opt-in only: SQL011 alone rejects evidence-only SELECTED receipts.
  // Its additive guard replacement must be qualified before runtime activation.
  const configuredPolicy = compCurationPolicy(policy) ?? compEvidenceSelectionPolicy(selectionPolicy);
  requireThat(typeof designationReviewsEnabled === 'boolean' && (!designationReviewsEnabled
    || policy === null && configuredPolicy?.policy.version === 'atlas-comp-evidence-selection-policy-v1'), 500, 'COMP_CURATION_CONFIGURATION_INVALID');
  if (archiveCapability !== null) {
    requireThat(policy === null, 500, 'COMP_CURATION_CONFIGURATION_INVALID');
    assertCompCurationArchiveCapability(archiveCapability, { boundary, artifacts, validateAccess });
  }
  const approvedReader = archiveCapability ?? approved;
  async function authorize(context, card, expectedActor) {
    if (archiveCapability !== null) return archiveCapability.authorize(context, card, expectedActor);
    const current = await context.refresh();
    requireThat(current.principal.id === expectedActor, 401, 'SIGN_IN_REQUIRED');
    requireThat(card && (card.owner_id === current.principal.id || card.approvers.includes(current.principal.id)), 404, 'MANUAL_CARD_NOT_FOUND');
    requireThat(current.principal.role === 'REVIEWER', 403, 'MANUAL_CARD_ACCESS_DENIED');
    return current;
  }
  async function scope(context, cardId, input, write) {
    const { tx, principal } = context;
    const [card] = await tx.$queryRawUnsafe(`/* curation:card */ SELECT * FROM atlas_manual.card WHERE id=$1::uuid FOR ${write ? 'UPDATE' : 'SHARE'}`, cardId);
    // Card/intake locks can wait beyond a session deadline. Never reuse the
    // principal from the beginning of the transaction after either lock.
    let current = await authorize(context, card, principal.id);
    await validateAccess({ tx, principal: current.principal, cardId });
    current = await authorize(context, card, principal.id);
    const [published] = await tx.$queryRawUnsafe(`/* curation:publication */ SELECT p.*,a.source_revision,a.source_hash,a.report_hash,i.public_token
      FROM atlas_manual.publication p JOIN atlas_manual.approval a USING(card_id,action_id)
      JOIN atlas_manual.public_report_identity i USING(card_id)
      WHERE p.card_id=$1::uuid ORDER BY p.version DESC LIMIT 1`, cardId);
    requireThat(published?.state === 'PUBLISHED' && published.action_id === input.approvalActionId && published.mode === current.principal.mode,
      409, 'COMP_APPROVAL_STALE');
    const [previous] = await tx.$queryRawUnsafe(`/* curation:latest */ SELECT * FROM atlas_manual.comp_curation
      WHERE card_id=$1::uuid AND approval_action_id=$2::uuid ORDER BY revision DESC LIMIT 1`, cardId, input.approvalActionId);
    let source = null, artifact = null;
    if (input.previewId !== null) {
      const [row] = await tx.$queryRawUnsafe('/* curation:market */ SELECT * FROM atlas_manual.presentation_market WHERE card_id=$1::uuid AND request_id=$2::uuid', cardId, input.previewId);
      requireThat(row?.state === 'READY' && row.approval_action_id === input.approvalActionId, 409, 'COMP_SAVED_SOURCE_UNAVAILABLE');
      const request = stored(row.request, row.request_hash), result = stored(row.result, row.result_hash);
      requireThat(request.requestId === input.previewId && request.approvalActionId === input.approvalActionId
        && result.state === 'READY' && result.ref?.kind === 'MARKET_PREVIEW' && hash(result.artifactHash) && hash(result.sourceHash), 503, 'COMP_SAVED_SOURCE_CORRUPT');
      source = { previewId: input.previewId, requestHash: row.request_hash, resultHash: row.result_hash,
        artifactHash: result.artifactHash, previewHash: result.sourceHash };
      artifact = result.ref;
    }
    return { card, actorId: current.principal.id, binding: binding(published), previous, revision: previous?.revision ?? 0, source, artifact };
  }
  const sameSnapshot = (before, after) => requireThat(before.actorId === after.actorId && same(before.binding, after.binding)
    && same(before.source, after.source), 409, 'COMP_SOURCE_CHANGED');
  async function evidence(staff, snapshot) {
    const b = snapshot.binding, loaded = await approvedReader.loadPacket(staff, b.cardId, b.approvalActionId);
    requireThat(loaded?.row && same(binding(loaded.row), b) && loaded.row.state === 'PUBLISHED'
      && loaded.publicHash === b.publicHash && digest(JSON.stringify(loaded.packet)) === b.publicHash
      && loaded.packet.publicToken === b.publicToken && loaded.packet.approvalVersion === b.publicVersion
      && loaded.packet.reportHash === b.reportHash && loaded.packet.mode === b.mode, 409, 'COMP_APPROVAL_SOURCE_MISMATCH');
    if (!snapshot.source) return null;
    const preview = await artifacts.read(snapshot.artifact, { cardId: b.cardId, kind: 'MARKET_PREVIEW', sourceHash: snapshot.source.artifactHash });
    requireThat(digest(JSON.stringify(preview)) === snapshot.source.artifactHash && marketPreviewHash(preview) === snapshot.source.previewHash,
      503, 'COMP_SAVED_SOURCE_CORRUPT');
    requireThat(['atlas-market-preview-v1', 'atlas-market-preview-v2'].includes(preview?.version), 503, 'COMP_SAVED_SOURCE_CORRUPT');
    const expected = preview.version === 'atlas-market-preview-v2' ? publishedMarketQuery(loaded, { savedQuery: preview.query, savedInput: preview.input })
      : publishedResearchQuery(loaded, { savedQuery: preview.query, savedInput: preview.input });
    requireThat(['binding', 'identityHash', 'input', 'query', 'atlasGrade'].every(key => same(preview[key], expected[key])), 409, 'COMP_APPROVAL_SOURCE_MISMATCH');
    return { schema: 'atlas-saved-comp-source-v1', cardId: b.cardId, approvalActionId: b.approvalActionId,
      previewId: snapshot.source.previewId, sourceHash: snapshot.source.previewHash, preview };
  }
  async function replay(context, state, input, request) {
    const [row] = await context.tx.$queryRawUnsafe('/* curation:replay */ SELECT * FROM atlas_manual.comp_curation WHERE card_id=$1::uuid AND request_id=$2::uuid', state.binding.cardId, input.requestId);
    if (!row) return null;
    requireThat(row.actor_id === state.actorId && row.request_hash === request.hash && row.request === request.text, 409, 'COMP_REQUEST_CONFLICT');
    const value = receipt(row);
    requireThat(same(value.binding, state.binding) && same(value.source, state.source), 409, 'COMP_SOURCE_CHANGED');
    await authorize(context, state.card, state.actorId); // Mandatory even for a replay with no insertion.
    return value;
  }
  return Object.freeze({
    async read(staff, cardId, value) {
      uuid(cardId); const input = compCurationReadInput(value);
      const before = await boundary.transaction(staff, context => scope(context, cardId, input, false));
      const source = await evidence(staff, before);
      return boundary.transaction(staff, async context => {
        const after = await scope(context, cardId, input, false); sameSnapshot(before, after);
        const { now } = await authorize(context, after.card, after.actorId);
        const preview = source && configuredPolicy ? parseSavedCompSource(source, { cardId, approvalActionId: input.approvalActionId,
          report: { publicToken: after.binding.publicToken, version: after.binding.publicVersion, publicHash: after.binding.publicHash } },
        { asOf: now.toISOString(), recencyDays: configuredPolicy.policy.recencyDays,
          evidenceOnly: configuredPolicy.policy.version === 'atlas-comp-evidence-selection-policy-v1', designationReviewsEnabled }) : null;
        return { schema: 'atlas-comp-curation-state-v1', status: 'LOCAL_PROPOSAL', visibility: 'PRIVATE_INTERNAL', binding: after.binding,
          revision: after.revision, selection: receipt(after.previous), source: after.source, policy: configuredPolicy?.policy ?? null,
          policyHash: configuredPolicy?.hash ?? null, availability: source ? configuredPolicy ? 'READY' : 'POLICY_REQUIRED' : 'NO_SAVED_POOL', preview };
      });
    },
    async decide(staff, cardId, value) {
      uuid(cardId); const input = compCurationInput(value, { designationReviewsEnabled }), request = document(input, 4096);
      const before = await boundary.transaction(staff, async context => {
        const state = await scope(context, cardId, input, true), existing = await replay(context, state, input, request);
        if (existing) return { replay: existing };
        requireThat(state.revision === input.expectedSelectionRevision, 409, 'COMP_SELECTION_REVISION_STALE');
        return state;
      });
      if (before.replay) return before.replay;
      const saved = await evidence(staff, before);
      return boundary.transaction(staff, async context => {
        const after = await scope(context, cardId, input, true), existing = await replay(context, after, input, request);
        if (existing) return existing;
        sameSnapshot(before, after);
        requireThat(after.revision === input.expectedSelectionRevision, 409, 'COMP_SELECTION_REVISION_STALE');
        requireThat(after.source?.previewHash === input.expectedPreviewHash || after.source === null && input.expectedPreviewHash === null,
          409, 'COMP_SOURCE_CHANGED');
        if (input.expectedPolicyHash !== null) requireThat(configuredPolicy?.hash === input.expectedPolicyHash, 409, 'COMP_POLICY_CHANGED');
        const { now } = await authorize(context, after.card, after.actorId), asOf = now.toISOString();
        const decision = evaluateCompCuration(saved, after.binding, configuredPolicy, asOf, input, { designationReviewsEnabled, actorId: after.actorId });
        const selected = document(decision.selected, 32768), bound = document(after.binding, 2048), source = after.source ? document(after.source, 8192) : null;
        const result = { schema: 'atlas-comp-curation-receipt-v1', status: 'LOCAL_PROPOSAL', visibility: 'PRIVATE_INTERNAL',
          requestId: input.requestId, revision: after.revision + 1, actorId: after.actorId, binding: after.binding, source: after.source,
          sourceStatus: after.source ? 'SAVED_POOL' : 'NO_SAVED_POOL', outcome: input.outcome, selected: decision.selected,
          selectedFactsHash: selected.hash, asOf, policy: configuredPolicy?.policy ?? null, policyHash: configuredPolicy?.hash ?? null,
          guidance: decision.guidance, reportSnapshotUnaffected: true };
        const savedResult = document(result, 65536);
        await authorize(context, after.card, after.actorId);
        await context.tx.$executeRawUnsafe(`/* curation:insert */ INSERT INTO atlas_manual.comp_curation
          (card_id,approval_action_id,revision,request_id,actor_id,request,request_hash,binding,binding_hash,source,source_hash,selected_facts,selected_facts_hash,receipt,receipt_hash)
          VALUES($1::uuid,$2::uuid,$3,$4::uuid,$5::uuid,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        cardId, input.approvalActionId, result.revision, input.requestId, after.actorId, request.text, request.hash, bound.text, bound.hash,
        source?.text ?? null, source?.hash ?? null, selected.text, selected.hash, savedResult.text, savedResult.hash);
        return result;
      });
    },
  });
}
