import { randomUUID } from 'node:crypto';
import { canonical, digest, requireThat, uuid } from '@atlas/manual-service/contract';
import { LABEL_REFRESH_REASON, labelRefreshRequestId, labelRefreshRequestHash, labelReplacementIntent } from './label-replacement-intent.mjs';

const S = 'atlas_manual_connected';
const stored = (text, hash) => { requireThat(typeof text === 'string' && digest(text) === hash, 503, 'LABEL_STORED_CONTENT_INVALID'); return JSON.parse(text); };
const reviewer = p => requireThat(p.role === 'REVIEWER', 403, 'LABEL_ACCESS_DENIED');
export const LABEL_LAYOUT_FAILURE_CODES = Object.freeze(['NAME_OVERFLOW','METADATA_OVERFLOW','UNSUPPORTED_GLYPH','EMPTY_GLYPH_OUTLINE','CERTIFICATE_OVERFLOW']);
export const labelFailureHash = r => digest(canonical({ itemId:r.id,cardId:r.card_id,actionId:r.action_id,approvalVersion:r.approval_version,
  sourceRevision:r.source_revision,sourceHash:r.source_hash,reportHash:r.report_hash,publicHash:r.public_hash,
  snapshotHash:r.snapshot_hash,code:r.code,attempts:r.attempts,rendererProfileHash:r.renderer_profile_hash,materialProfileId:r.material_profile_id,jigHash:r.jig_hash }));
const itemView = r => ({ itemId: r.id, cardId: r.card_id, approvalActionId: r.action_id, approvalVersion: r.approval_version,
  state: r.current === false ? 'SUPERSEDED' : r.state,
  layoutRetryItemId: r.current !== false ? r.layout_retry_item_id ?? null : null,
  supersededReason: r.current === false ? 'APPROVAL_CHANGED' : r.state === 'SUPERSEDED' && r.layout_retry_item_id ? 'LAYOUT_RETRIED' : null, purpose: r.purpose, originalItemId: r.original_item_id, sheetId: r.sheet_id, slot: r.slot,
  labelHash: r.artwork_hash, materialProfileId: r.material_profile_id, code: r.code,
  failureHash: r.state === 'NEEDS_LAYOUT' && r.current !== false ? labelFailureHash(r) : null,
  automaticLayoutRecoveryEligible: r.current !== false && r.automatic_layout_recovery_eligible === true,
  snapshot: r.snapshot ? stored(r.snapshot, r.snapshot_hash) : null,
  previewHref: r.artwork_hash ? `/api/staff/manual-connected/labels/${r.id}/artwork?mode=preview` : null });
const exportView = r => ({ exportId: r.id, kind: r.kind, sheetId: r.sheet_id, itemId: r.item_id, state: r.state,
  sheetRevision: r.sheet_revision, retryCount: r.retry_requests?.length ?? 0, exportProfileId: r.profile_id, manifestHash: r.manifest_hash,
  sha256: r.sha256, byteCount: r.byte_count, contentType: r.content_type, mapping: r.mapping ? JSON.parse(r.mapping) : null, code: r.code });
const sheetView = r => ({ sheetId: r.id, number: Number(r.number), state: r.state, revision: r.revision, capacity: 50,
  materialProfileId: r.material_profile_id, jigHash: r.jig_hash, manifestHash: r.manifest_hash });
const eventView = r => ({ eventId: r.id, exportId: r.export_id, exportSha256: r.export_sha256, manifestHash: r.manifest_hash,
  successfulSlots: r.successful_slots, failedSlots: r.failed_slots, recordedAt: new Date(r.created_at).toISOString() });
const successorProjection = `(SELECT successor.id FROM ${S}.label_item successor WHERE successor.original_item_id=i.id AND successor.purpose='LAYOUT_RETRY') AS layout_retry_item_id`;
const summaryColumns = 'id,actor_id,card_id,action_id,approval_version,state,purpose,original_item_id,sheet_id,slot,artwork_hash,material_profile_id,code,snapshot,snapshot_hash,source_revision,source_hash,report_hash,public_hash,renderer_profile_hash,jig_hash,attempts'.split(',').map(c=>'i.'+c).join(',')
  + `,${successorProjection},(SELECT latest.action_id=i.action_id FROM atlas_manual.publication latest WHERE latest.card_id=i.card_id ORDER BY latest.version DESC LIMIT 1) AS current`;
// Used verbatim for worker discovery and the read-only UI projection. Rendering
// and the successor transaction still reauthorize and validate immutable source.
const layoutRecoveryPredicate = (profile, codes) => `(${profile}::text IS NOT NULL AND i.state='NEEDS_LAYOUT' AND i.purpose IN ('ORIGINAL','LAYOUT_RETRY')
  AND i.renderer_profile_hash IS DISTINCT FROM ${profile} AND i.code=ANY(${codes}::text[]) AND i.snapshot IS NOT NULL
  AND i.snapshot::jsonb->>'cardProfile' IN ('SPORTS','POKEMON')
  AND i.print_svg IS NULL AND i.preview_svg IS NULL AND i.artwork_hash IS NULL AND i.sheet_id IS NULL AND i.slot IS NULL
  AND i.previous_assignment IS NULL AND i.claim_id IS NULL AND i.lease_until IS NULL
  AND EXISTS(SELECT 1 FROM atlas_manual_intake.card c JOIN atlas_manual.card approved ON approved.id=c.id
    WHERE c.id=i.card_id AND (approved.owner_id=i.actor_id OR i.actor_id=ANY(approved.approvers))
    AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d
      WHERE d.card_id=c.id OR (d.owner_id=c.owner_id AND d.create_request_id=c.create_request_id)))
  AND EXISTS(SELECT 1 FROM atlas_manual.publication p JOIN atlas_manual.approval a USING(card_id,action_id)
    WHERE p.card_id=i.card_id AND p.action_id=i.action_id AND p.state='PUBLISHED' AND p.mode='PRODUCTION'
    AND p.version=i.approval_version AND p.public_hash=i.public_hash AND a.source_revision=i.source_revision
    AND a.source_hash=i.source_hash AND a.report_hash=i.report_hash)
  AND NOT EXISTS(SELECT 1 FROM ${S}.label_export e WHERE e.item_id=i.id)
  AND NOT EXISTS(SELECT 1 FROM ${S}.label_item successor WHERE successor.original_item_id=i.id AND successor.purpose='LAYOUT_RETRY')
  AND NOT EXISTS(SELECT 1 FROM atlas_manual.publication p WHERE p.card_id=i.card_id AND p.version>i.approval_version)
  AND (i.purpose='ORIGINAL' OR (WITH RECURSIVE ancestry AS (
    SELECT i.id,i.original_item_id,i.purpose,ARRAY[i.id] AS path,1 AS depth,false AS cycle
    UNION ALL SELECT p.id,p.original_item_id,p.purpose,a.path||p.id,a.depth+1,p.id=ANY(a.path)
    FROM ancestry a JOIN ${S}.label_item p ON p.id=a.original_item_id WHERE a.purpose='LAYOUT_RETRY' AND NOT a.cycle AND a.depth<17)
    SELECT COALESCE(bool_or(purpose='ORIGINAL') AND NOT bool_or(cycle) AND max(depth)<=16,false) FROM ancestry)))`;

export function createLabelRepository({ boundary, validateAccess = null, validateAccessMany = null }) {
  requireThat(boundary?.transaction, 500, 'LABEL_CONFIGURATION_INVALID');
  const discovery = { ITEM: null, EXPORT: null, LAYOUT_RECOVERY: null };
  const lock = (tx, id) => tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(721941,hashtext($1))', id);
  async function access(tx, principal, cardId) {
    reviewer(principal);
    const [card] = await tx.$queryRawUnsafe(`SELECT owner_id,approvers FROM atlas_manual.card WHERE id=$1::uuid FOR SHARE`, cardId);
    requireThat(card && (card.owner_id === principal.id || card.approvers.includes(principal.id)), 404, 'MANUAL_CARD_NOT_FOUND');
    requireThat(!(await tx.$queryRawUnsafe('SELECT 1 FROM atlas_manual_intake.discarded_card WHERE card_id=$1::uuid', cardId)).length, 404, 'MANUAL_CARD_NOT_FOUND');
    if (validateAccess) await validateAccess({ tx, principal, cardId });
  }
  async function source(tx, principal, cardId, actionId, latest = true) {
    await access(tx, principal, cardId);
    const [row] = await tx.$queryRawUnsafe(`SELECT p.*,a.source_revision,a.source_hash,a.report_hash,
      (SELECT action_id FROM atlas_manual.publication newest WHERE newest.card_id=p.card_id ORDER BY version DESC LIMIT 1) AS latest_action_id FROM atlas_manual.publication p
      JOIN atlas_manual.approval a USING(card_id,action_id) WHERE p.card_id=$1::uuid AND p.action_id=$2::uuid`, cardId, actionId);
    requireThat(row?.state === 'PUBLISHED' && row.mode === 'PRODUCTION', 409, 'LABEL_PUBLISHED_PRODUCTION_REQUIRED');
    if (latest) {
      requireThat(row.latest_action_id === actionId, 409, 'LABEL_SOURCE_SUPERSEDED');
    }
    return row;
  }
  function matches(item, row) {
    requireThat(item.card_id === row.card_id && item.action_id === row.action_id && item.approval_version === row.version
      && item.source_revision === row.source_revision && item.source_hash === row.source_hash && item.report_hash === row.report_hash
      && item.public_hash === row.public_hash, 409, 'LABEL_SOURCE_CHANGED');
  }
  async function scopedItem(tx, principal, id, latest = true) {
    const [item] = await tx.$queryRawUnsafe(`SELECT i.*,${successorProjection} FROM ${S}.label_item i WHERE id=$1::uuid AND actor_id=$2::uuid`, uuid(id), principal.id);
    requireThat(item, 404, 'LABEL_ITEM_NOT_FOUND'); const published = await source(tx, principal, item.card_id, item.action_id, latest); matches(item, published);
    if (item.snapshot) stored(item.snapshot, item.snapshot_hash);
    item.current = published.latest_action_id === item.action_id; return item;
  }
  async function assertRefreshUnprinted(tx, original) {
    requireThat(!(await tx.$queryRawUnsafe(`SELECT 1 FROM ${S}.label_print_event p JOIN ${S}.label_export e ON e.id=p.export_id
      WHERE (e.kind='SHEET' AND e.sheet_id=$1::uuid AND $2::integer=ANY(p.successful_slots))
        OR (e.kind='SINGLE' AND e.item_id=$3::uuid AND 1=ANY(p.successful_slots)) LIMIT 1`, original.sheet_id, original.slot, original.id)).length,
    409, 'LABEL_REFRESH_ALREADY_PRINTED');
  }
  async function accessible(tx, principal, suppliedIds, strict = true) {
    reviewer(principal); const ids = [...new Set(suppliedIds)];
    if (!ids.length) return new Set();
    const cards = await tx.$queryRawUnsafe('SELECT id,owner_id,approvers FROM atlas_manual.card WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE', ids);
    const discarded = new Set((await tx.$queryRawUnsafe('SELECT card_id FROM atlas_manual_intake.discarded_card WHERE card_id=ANY($1::uuid[])', ids)).map(r => r.card_id));
    const allowed = cards.filter(c => (c.owner_id === principal.id || c.approvers.includes(principal.id)) && !discarded.has(c.id)).map(c => c.id);
    if (strict) requireThat(allowed.length === ids.length, 404, 'MANUAL_CARD_NOT_FOUND');
    if (validateAccessMany && allowed.length) await validateAccessMany({ tx, principal, cardIds: allowed });
    else if (validateAccess) for (const cardId of allowed) await validateAccess({ tx, principal, cardId });
    return new Set(allowed);
  }
  async function members(tx, principal, sheetId, latest = false, artwork = false) {
    const rows = await tx.$queryRawUnsafe(`SELECT ${artwork ? `i.*,${successorProjection}` : summaryColumns} FROM ${S}.label_item i WHERE sheet_id=$1::uuid ORDER BY slot`, sheetId);
    requireThat(rows.every(item => item.actor_id === principal.id), 404, 'LABEL_SHEET_NOT_FOUND');
    await accessible(tx, principal, rows.map(i => i.card_id));
    const publications = await tx.$queryRawUnsafe(`SELECT p.*,a.source_revision,a.source_hash,a.report_hash,
      (SELECT action_id FROM atlas_manual.publication newest WHERE newest.card_id=p.card_id ORDER BY version DESC LIMIT 1) AS latest_action_id
      FROM atlas_manual.publication p JOIN atlas_manual.approval a USING(card_id,action_id)
      WHERE p.card_id=ANY($1::uuid[]) AND p.action_id=ANY($2::uuid[])`, rows.map(i => i.card_id), rows.map(i => i.action_id));
    for (const item of rows) {
      const published = publications.find(p => p.card_id === item.card_id && p.action_id === item.action_id);
      requireThat(published?.state === 'PUBLISHED' && published.mode === 'PRODUCTION', 409, 'LABEL_PUBLISHED_PRODUCTION_REQUIRED');
      matches(item, published); item.current = published.latest_action_id === item.action_id;
      if (latest) requireThat(item.current, 409, 'LABEL_SOURCE_SUPERSEDED');
    }
    return rows;
  }
  async function scopedSheet(tx, principal, id, latest = false, artwork = false) {
    reviewer(principal);
    const [sheet] = await tx.$queryRawUnsafe(`SELECT * FROM ${S}.label_sheet WHERE id=$1::uuid AND actor_id=$2::uuid`, uuid(id), principal.id);
    requireThat(sheet, 404, 'LABEL_SHEET_NOT_FOUND'); return { sheet, items: await members(tx, principal, id, latest, artwork) };
  }
  async function scopedExport(tx, principal, id, latest = true) {
    const [row] = await tx.$queryRawUnsafe(`SELECT * FROM ${S}.label_export WHERE id=$1::uuid AND actor_id=$2::uuid`, uuid(id), principal.id);
    requireThat(row, 404, 'LABEL_EXPORT_NOT_FOUND');
    const items = row.kind === 'SHEET' ? (await scopedSheet(tx, principal, row.sheet_id, latest, true)).items : [await scopedItem(tx, principal, row.item_id, latest)];
    const manifest = stored(row.manifest, row.manifest_hash);
    requireThat(manifest.items.length === items.length && manifest.items.every((entry, i) => entry.itemId === items[i].id
      && entry.artworkHash === items[i].artwork_hash && entry.slot === (row.kind === 'SHEET' ? items[i].slot : 1)), 503, 'LABEL_EXPORT_BINDING_INVALID');
    if (latest) requireThat(items.every(item => item.state === 'READY'), 409, 'LABEL_SOURCE_SUPERSEDED');
    return { row, items, manifest };
  }
  const manifestFor = (items, extra) => ({ version: 'atlas-label-export-manifest-v1', ...extra,
    items: items.map(i => ({ itemId: i.id, cardId: i.card_id, approvalActionId: i.action_id, approvalVersion: i.approval_version,
      sourceHash: i.source_hash, reportHash: i.report_hash, publicHash: i.public_hash, artworkHash: i.artwork_hash,
      rendererProfileHash: i.renderer_profile_hash, materialProfileId: i.material_profile_id, slot: i.slot ?? 1 })) });
  const api = {
    async publicationCommitted({ tx, principal, cardId, actionId }) {
      // Called only inside the successful PUBLISHED transaction. No raster work.
      if (principal.mode !== 'PRODUCTION') return null;
      const row = await source(tx, principal, cardId, actionId, false);
      // Completing delivery of an older approved report must not fail because a
      // newer approval exists; only the latest approval gets new label work.
      if (row.latest_action_id !== actionId) return null;
      const scopes = await tx.$queryRawUnsafe(`SELECT DISTINCT actor_id FROM ${S}.label_item WHERE card_id=$1::uuid AND state<>'SUPERSEDED'`, cardId);
      // A later approval may be published by a different authorized reviewer.
      // Lock every affected sheet pool in the same order before releasing slots.
      for (const actorId of [...new Set([principal.id, ...scopes.map(s => s.actor_id)])].sort()) await lock(tx, actorId);
      const older = await tx.$queryRawUnsafe(`SELECT i.id,i.sheet_id,s.state AS sheet_state FROM ${S}.label_item i LEFT JOIN ${S}.label_sheet s ON s.id=i.sheet_id
        WHERE i.card_id=$1::uuid AND i.action_id<>$2::uuid AND i.state<>'SUPERSEDED' FOR UPDATE OF i`, cardId, actionId);
      for (const item of older) {
        if (item.sheet_id && item.sheet_state === 'OPEN') {
          await tx.$executeRawUnsafe(`UPDATE ${S}.label_item SET state='SUPERSEDED',previous_assignment=jsonb_build_object('sheetId',sheet_id,'slot',slot),sheet_id=NULL,slot=NULL,claim_id=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE id=$1::uuid`, item.id);
          await tx.$executeRawUnsafe(`UPDATE ${S}.label_sheet SET revision=revision+1 WHERE id=$1::uuid`, item.sheet_id);
        } else await tx.$executeRawUnsafe(`UPDATE ${S}.label_item SET state='SUPERSEDED',claim_id=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE id=$1::uuid`, item.id);
      }
      const [item] = await tx.$queryRawUnsafe(`INSERT INTO ${S}.label_item(id,actor_id,access_version,card_id,action_id,approval_version,source_revision,source_hash,report_hash,public_hash,purpose)
       VALUES($1::uuid,$2::uuid,$3,$4::uuid,$5::uuid,$6,$7,$8,$9,$10,'ORIGINAL') ON CONFLICT(card_id,action_id) WHERE purpose='ORIGINAL' DO NOTHING RETURNING id`,
      randomUUID(), principal.id, principal.accessVersion, cardId, actionId, row.version, row.source_revision, row.source_hash, row.report_hash, row.public_hash);
      return item?.id ?? null;
    },
    async list(staff, { cursor = 0, rendererProfileHash = null } = {}) {
      requireThat(Number.isSafeInteger(cursor) && cursor >= 0, 400, 'LABEL_CURSOR_INVALID');
      requireThat(rendererProfileHash === null || /^[a-f0-9]{64}$/.test(rendererProfileHash), 500, 'LABEL_CONFIGURATION_INVALID');
      return boundary.transaction(staff, async ({ tx, principal }) => {
        reviewer(principal);
        const sheets = await tx.$queryRawUnsafe(`SELECT * FROM ${S}.label_sheet WHERE actor_id=$1::uuid ORDER BY number DESC LIMIT 21 OFFSET $2`, principal.id, cursor);
        const summaries = [];
        for (const sheet of sheets.slice(0, 20)) {
          try {
            const items = await members(tx, principal, sheet.id);
            const exports = await tx.$queryRawUnsafe(`SELECT * FROM ${S}.label_export WHERE sheet_id=$1::uuid ORDER BY created_at`, sheet.id);
            summaries.push({ ...sheetView(sheet), occupied: items.length, containsSuperseded: items.some(i => i.state === 'SUPERSEDED' || i.current === false), exports: exports.map(exportView) });
          } catch (error) { if (![403,404].includes(error.status)) throw error; }
        }
        const rows = await tx.$queryRawUnsafe(`SELECT ${summaryColumns},${layoutRecoveryPredicate('$3','$4')} AS automatic_layout_recovery_eligible
          FROM ${S}.label_item i WHERE actor_id=$1::uuid ORDER BY created_at DESC,id LIMIT 201 OFFSET $2`,
        principal.id, cursor * 10, rendererProfileHash, [...LABEL_LAYOUT_FAILURE_CODES]);
        const visible = rows.slice(0,200), allowed = await accessible(tx, principal, visible.map(i => i.card_id), false);
        const items = visible.filter(i => allowed.has(i.card_id)).map(itemView);
        const single = await tx.$queryRawUnsafe(`SELECT * FROM ${S}.label_export WHERE actor_id=$1::uuid AND item_id=ANY($2::uuid[])`, principal.id, items.map(i => i.itemId));
        for (const item of items) item.exports = single.filter(e => e.item_id === item.itemId).map(exportView);
        return { version: 'atlas-label-sheets-v1', sheets: summaries, items, pending: items.filter(i => ['PENDING_RENDER','NEEDS_LAYOUT'].includes(i.state)),
          hasMore: sheets.length > 20 || rows.length > 200, nextCursor: sheets.length > 20 || rows.length > 200 ? cursor + 20 : null };
      });
    },
    sheet(staff, id) { return boundary.transaction(staff, async ({ tx, principal }) => {
      const { sheet, items } = await scopedSheet(tx, principal, id);
      const exports = await tx.$queryRawUnsafe(`SELECT * FROM ${S}.label_export WHERE sheet_id=$1::uuid ORDER BY created_at`, id);
      const events = await tx.$queryRawUnsafe(`SELECT p.* FROM ${S}.label_print_event p JOIN ${S}.label_export e ON e.id=p.export_id WHERE e.sheet_id=$1::uuid ORDER BY p.created_at DESC LIMIT 100`, id);
      return { ...sheetView(sheet), occupied: items.length, containsSuperseded: items.some(i => i.state === 'SUPERSEDED' || i.current === false), items: items.map(itemView), exports: exports.map(exportView), printEvents: events.map(eventView) };
    }); },
    item(staff, id, latest = true) { return boundary.transaction(staff, async ({ tx, principal }) => scopedItem(tx, principal, id, latest)); },
    async pendingCandidates(limit = 4, { rendererProfileHash = null } = {}) {
      requireThat(Number.isInteger(limit) && limit > 0 && limit <= 16);
      requireThat(rendererProfileHash === null || /^[a-f0-9]{64}$/.test(rendererProfileHash), 500, 'LABEL_CONFIGURATION_INVALID');
      return boundary.machineTransaction(null, async ({ tx }) => {
        const discover = async kind => {
          const table = kind === 'ITEM' ? 'label_item' : 'label_export', state = kind === 'ITEM' ? 'PENDING_RENDER' : 'PREPARING';
          const query = cursor => tx.$queryRawUnsafe(`SELECT id,actor_id,access_version,created_at::text AS cursor_time FROM ${S}.${table}
            WHERE state=$1 AND (lease_until IS NULL OR lease_until<clock_timestamp())
            ${kind === 'ITEM' ? `AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=${S}.${table}.card_id)` : ''}
            AND ($2::timestamptz IS NULL OR (created_at,id)>($2::timestamptz,$3::uuid)) ORDER BY created_at,id LIMIT $4`,
          state, cursor?.time ?? null, cursor?.id ?? null, limit);
          let rows = await query(discovery[kind]);
          if (!rows.length && discovery[kind]) rows = await query(null);
          const last = rows.at(-1); discovery[kind] = last ? { time: last.cursor_time, id: last.id } : null;
          return rows.map(({ cursor_time, ...row }) => ({ ...row, kind }));
        };
        // Fair bounded discovery advances even when an owner's authorization is
        // revoked or a source changed before claim. No unauthorized row changes.
        const candidates = [...await discover('ITEM'), ...await discover('EXPORT')];
        if (rendererProfileHash) {
          // One old layout per pass, after ordinary work. The cursor advances even
          // when access was revoked; no browser gesture or storage read is needed.
          const query = cursor => tx.$queryRawUnsafe(`SELECT i.id,i.actor_id,i.access_version,i.created_at::text AS cursor_time FROM ${S}.label_item i
            WHERE ${layoutRecoveryPredicate('$1','$2')}
            AND ($3::timestamptz IS NULL OR (i.created_at,i.id)>($3::timestamptz,$4::uuid)) ORDER BY i.created_at,i.id LIMIT 1`,
          rendererProfileHash, [...LABEL_LAYOUT_FAILURE_CODES], cursor?.time ?? null, cursor?.id ?? null);
          let rows = await query(discovery.LAYOUT_RECOVERY);
          if (!rows.length && discovery.LAYOUT_RECOVERY) rows = await query(null);
          const last = rows.at(-1); discovery.LAYOUT_RECOVERY = last ? { time: last.cursor_time, id: last.id } : null;
          candidates.push(...rows.map(({ cursor_time, ...row }) => ({ ...row, kind: 'LAYOUT_RECOVERY' })));
        }
        return candidates;
      });
    },
    claimItem(staff, id, attemptedProfile = null) { return boundary.transaction(staff, async ({ tx, principal }) => {
      await lock(tx, principal.id); const item = await scopedItem(tx, principal, id);
      if (item.state !== 'PENDING_RENDER' || (item.lease_until && new Date(item.lease_until) > new Date())) return null;
      if (item.purpose === 'REPRINT') labelReplacementIntent(item, await scopedItem(tx, principal, item.original_item_id));
      if (item.attempts >= 5) { await tx.$executeRawUnsafe(`UPDATE ${S}.label_item SET state='NEEDS_LAYOUT',code='LABEL_RENDER_FAILED',claim_id=NULL,lease_until=NULL,updated_at=clock_timestamp(),
        renderer_profile_hash=COALESCE(renderer_profile_hash,$2),jig_hash=COALESCE(jig_hash,$3) WHERE id=$1::uuid`,
      id, attemptedProfile?.rendererProfileHash ?? null, attemptedProfile?.jigHash ?? null); return null; }
      // Record the attempted recipe before storage/rendering, including a process
      // crash. A successor's target remains immutable across deployments.
      const [claimed] = await tx.$queryRawUnsafe(`UPDATE ${S}.label_item SET claim_id=$2::uuid,lease_until=clock_timestamp()+interval '2 minutes',attempts=attempts+1,updated_at=clock_timestamp(),
        renderer_profile_hash=CASE WHEN purpose IN ('LAYOUT_RETRY','REPRINT') THEN renderer_profile_hash ELSE COALESCE($3,renderer_profile_hash) END,
        jig_hash=CASE WHEN purpose IN ('LAYOUT_RETRY','REPRINT') THEN jig_hash ELSE COALESCE($4,jig_hash) END WHERE id=$1::uuid RETURNING *`,
      id, randomUUID(), attemptedProfile?.rendererProfileHash ?? null, attemptedProfile?.jigHash ?? null);
      return claimed;
    }); },
    finishItem(staff, claimed, result) { return boundary.transaction(staff, async ({ tx, principal }) => {
      await lock(tx, principal.id); const item = await scopedItem(tx, principal, claimed.id); matches(item, result.row);
      if (item.state !== 'PENDING_RENDER') return itemView(item);
      requireThat(item.claim_id === claimed.claim_id, 409, 'LABEL_CLAIM_CHANGED');
      if (item.purpose === 'LAYOUT_RETRY') requireThat(result.rendererProfileHash === item.renderer_profile_hash
        && result.materialProfileId === item.material_profile_id && result.jigHash === item.jig_hash, 409, 'LABEL_RENDERER_CHANGED');
      if (item.purpose === 'REPRINT') {
        const original = await scopedItem(tx, principal, item.original_item_id), intent = labelReplacementIntent(item, original);
        if (intent.kind === 'REFRESH') {
          requireThat(result.rendererProfileHash === intent.target.rendererProfileHash
            && result.materialProfileId === intent.target.materialProfileId && result.jigHash === intent.target.jigHash, 409, 'LABEL_RENDERER_CHANGED');
          await assertRefreshUnprinted(tx, original);
        }
        else requireThat(result.state === 'READY' && canonical(result.snapshot) === original.snapshot
          && result.printSvg === original.print_svg && result.previewSvg === original.preview_svg && result.artworkHash === original.artwork_hash
          && result.rendererProfileHash === original.renderer_profile_hash && result.materialProfileId === original.material_profile_id
          && result.jigHash === original.jig_hash, 409, 'LABEL_REPRINT_SOURCE_INVALID');
      }
      if (result.state !== 'READY') {
        const [updated] = await tx.$queryRawUnsafe(`UPDATE ${S}.label_item SET state='NEEDS_LAYOUT',code=$2,snapshot=$3,snapshot_hash=$4,renderer_profile_hash=$5,material_profile_id=$6,jig_hash=$7,claim_id=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE id=$1::uuid RETURNING *`, item.id, result.code ?? 'LABEL_NEEDS_LAYOUT', canonical(result.snapshot), digest(canonical(result.snapshot)), result.rendererProfileHash, result.materialProfileId, result.jigHash);
        return itemView(updated);
      }
      const poolHash = digest(canonical({ renderer: result.rendererProfileHash, material: result.materialProfileId, jig: result.jigHash }));
      let [sheet] = await tx.$queryRawUnsafe(`SELECT * FROM ${S}.label_sheet WHERE actor_id=$1::uuid AND pool_hash=$2 AND state='OPEN' FOR UPDATE`, principal.id, poolHash);
      if (!sheet) [sheet] = await tx.$queryRawUnsafe(`INSERT INTO ${S}.label_sheet(id,actor_id,access_version,pool_hash,material_profile_id,renderer_profile_hash,jig_hash)
        VALUES($1::uuid,$2::uuid,$3,$4,$5,$6,$7) RETURNING *`, randomUUID(), principal.id, principal.accessVersion, poolHash, result.materialProfileId, result.rendererProfileHash, result.jigHash);
      const used = await tx.$queryRawUnsafe(`SELECT slot FROM ${S}.label_item WHERE sheet_id=$1::uuid`, sheet.id);
      const slot = Array.from({ length: 50 }, (_, i) => i + 1).find(n => !used.some(i => i.slot === n)); requireThat(slot, 409, 'LABEL_SHEET_FULL');
      const snapshot = canonical(result.snapshot, { maxBytes: 32768 });
      requireThat(result.artworkHash === digest(result.printSvg) && Buffer.byteLength(result.printSvg) <= 1048576 && Buffer.byteLength(result.previewSvg) <= 1048576, 503, 'LABEL_ARTWORK_INVALID');
      const [updated] = await tx.$queryRawUnsafe(`UPDATE ${S}.label_item SET state='READY',snapshot=$2,snapshot_hash=$3,print_svg=$4,preview_svg=$5,artwork_hash=$6,renderer_profile_hash=$7,material_profile_id=$8,jig_hash=$9,
        sheet_id=$10::uuid,slot=$11,claim_id=NULL,lease_until=NULL,code=NULL,updated_at=clock_timestamp() WHERE id=$1::uuid RETURNING *`,
      item.id, snapshot, digest(snapshot), result.printSvg, result.previewSvg, result.artworkHash, result.rendererProfileHash, result.materialProfileId, result.jigHash, sheet.id, slot);
      if (used.length === 49) {
        const items = await members(tx, principal, sheet.id, true);
        const manifest = canonical(manifestFor(items, { sheetId: sheet.id, sheetRevision: sheet.revision + 1, jigHash: sheet.jig_hash, materialProfileId: sheet.material_profile_id }));
        await tx.$executeRawUnsafe(`UPDATE ${S}.label_sheet SET state='SEALED',revision=revision+1,manifest=$2,manifest_hash=$3,sealed_at=clock_timestamp() WHERE id=$1::uuid`, sheet.id, manifest, digest(manifest));
      } else await tx.$executeRawUnsafe(`UPDATE ${S}.label_sheet SET revision=revision+1 WHERE id=$1::uuid`, sheet.id);
      return itemView(updated);
    }); },
    failItem(staff, claimed, attemptedProfile = null) { return boundary.transaction(staff, async ({ tx, principal }) => {
      await lock(tx, principal.id);
      await tx.$executeRawUnsafe(`UPDATE ${S}.label_item SET state=CASE WHEN attempts>=5 THEN 'NEEDS_LAYOUT' ELSE state END,code='LABEL_RENDER_FAILED',claim_id=NULL,lease_until=NULL,updated_at=clock_timestamp(),
        renderer_profile_hash=COALESCE(renderer_profile_hash,$4),material_profile_id=COALESCE(material_profile_id,$5),jig_hash=COALESCE(jig_hash,$6)
        WHERE id=$1::uuid AND actor_id=$2::uuid AND claim_id=$3::uuid AND state='PENDING_RENDER'`, claimed.id, principal.id, claimed.claim_id,
      attemptedProfile?.rendererProfileHash ?? null, attemptedProfile?.materialProfileId ?? null, attemptedProfile?.jigHash ?? null);
    }); },
    prepareExport(staff, { kind, id, input }) { return boundary.transaction(staff, async ({ tx, principal }) => {
      reviewer(principal); await lock(tx, principal.id); const requestHash = digest(canonical({ kind, id, ...input }));
      const [prior] = await tx.$queryRawUnsafe(`SELECT * FROM ${S}.label_export WHERE actor_id=$1::uuid AND (request_id=$2::uuid OR retry_requests @> $3::jsonb)`, principal.id, input.requestId, JSON.stringify([{ requestId: input.requestId }]));
      if (prior) { const priorHash = prior.request_id === input.requestId ? prior.request_hash : prior.retry_requests.find(r => r.requestId === input.requestId)?.requestHash; requireThat(priorHash === requestHash, 409, 'LABEL_REQUEST_CONFLICT'); await scopedExport(tx, principal, prior.id, false); return exportView(prior); }
      let sheet = null, items;
      if (kind === 'SHEET') {
        ({ sheet, items } = await scopedSheet(tx, principal, id, true));
        requireThat(sheet.revision === input.expectedSheetRevision, 409, 'LABEL_REVISION_CHANGED');
        requireThat(items.length > 0 && items.every(i => i.state === 'READY'), 409, 'LABEL_SHEET_NOT_READY');
        if (sheet.state === 'OPEN') {
          const manifest = canonical(manifestFor(items, { sheetId: id, sheetRevision: sheet.revision + 1, jigHash: sheet.jig_hash, materialProfileId: sheet.material_profile_id }));
          [sheet] = await tx.$queryRawUnsafe(`UPDATE ${S}.label_sheet SET state='SEALED',revision=revision+1,manifest=$2,manifest_hash=$3,sealed_at=clock_timestamp() WHERE id=$1::uuid RETURNING *`, id, manifest, digest(manifest));
        }
      } else {
        items = [await scopedItem(tx, principal, id)]; requireThat(items[0].state === 'READY' && items[0].artwork_hash === input.expectedLabelHash, 409, 'LABEL_SOURCE_CHANGED');
      }
      const [existing] = await tx.$queryRawUnsafe(`SELECT * FROM ${S}.label_export WHERE ${kind === 'SHEET' ? 'sheet_id' : 'item_id'}=$1::uuid AND profile_id=$2`, id, input.exportProfileId);
      if (existing) {
        requireThat(existing.state === 'FAILED', 409, 'LABEL_REQUEST_CONFLICT');
        requireThat(existing.retry_requests.length < 16, 409, 'LABEL_EXPORT_RETRY_LIMIT');
        const retry = { requestId: input.requestId, requestHash, attemptBase: existing.attempts };
        const [resumed] = await tx.$queryRawUnsafe(`UPDATE ${S}.label_export SET state='PREPARING',attempt_base=attempts,retry_requests=retry_requests||$2::jsonb,code=NULL,claim_id=NULL,lease_until=NULL WHERE id=$1::uuid RETURNING *`, existing.id, JSON.stringify([retry]));
        return exportView(resumed);
      }
      const manifest = kind === 'SHEET' ? sheet.manifest : canonical(manifestFor([{ ...items[0], slot: 1 }], { itemId: id, jigHash: items[0].jig_hash, materialProfileId: items[0].material_profile_id }));
      const [row] = await tx.$queryRawUnsafe(`INSERT INTO ${S}.label_export(id,actor_id,access_version,kind,sheet_id,item_id,sheet_revision,profile_id,request_id,request_hash,manifest,manifest_hash)
        VALUES($1::uuid,$2::uuid,$3,$4,$5::uuid,$6::uuid,$7,$8,$9::uuid,$10,$11,$12) RETURNING *`, randomUUID(), principal.id, principal.accessVersion, kind,
      kind === 'SHEET' ? id : null, kind === 'SINGLE' ? id : null, sheet?.revision ?? null, input.exportProfileId, input.requestId, requestHash, manifest, digest(manifest)); return exportView(row);
    }); },
    export(staff, id, { latest = true } = {}) { return boundary.transaction(staff, async ({ tx, principal }) => {
      const result = await scopedExport(tx, principal, id, latest); return { ...result, view: exportView(result.row) };
    }); },
    claimExport(staff, id) { return boundary.transaction(staff, async ({ tx, principal }) => {
      await lock(tx, principal.id); const result = await scopedExport(tx, principal, id);
      if (result.row.state !== 'PREPARING' || (result.row.lease_until && new Date(result.row.lease_until) > new Date())) return null;
      if (result.row.attempts >= result.row.attempt_base + 3) { await tx.$executeRawUnsafe(`UPDATE ${S}.label_export SET state='FAILED',code='LABEL_EXPORT_FAILED',claim_id=NULL,lease_until=NULL WHERE id=$1::uuid`, id); return null; }
      const [row] = await tx.$queryRawUnsafe(`UPDATE ${S}.label_export SET claim_id=$2::uuid,lease_until=clock_timestamp()+interval '15 minutes',attempts=attempts+1 WHERE id=$1::uuid RETURNING *`, id, randomUUID());
      return { ...result, row };
    }); },
    finishExport(staff, claimed, output) { return boundary.transaction(staff, async ({ tx, principal }) => {
      await lock(tx, principal.id); const { row } = await scopedExport(tx, principal, claimed.row.id);
      if (row.state === 'READY') return exportView(row);
      requireThat(row.state === 'PREPARING' && row.claim_id === claimed.row.claim_id, 409, 'LABEL_CLAIM_CHANGED');
      const [saved] = await tx.$queryRawUnsafe(`UPDATE ${S}.label_export SET state='READY',object_ref=$2,sha256=$3,byte_count=$4,mapping=$5,content_type='image/png',claim_id=NULL,lease_until=NULL,code=NULL,ready_at=clock_timestamp() WHERE id=$1::uuid RETURNING *`,
      row.id, canonical(output.object), output.sha256, output.byteCount, canonical(output.mapping)); return exportView(saved);
    }); },
    failExport(staff, claimed) { return boundary.transaction(staff, async ({ tx, principal }) => {
      await lock(tx, principal.id);
      await tx.$executeRawUnsafe(`UPDATE ${S}.label_export SET state=CASE WHEN attempts>=attempt_base+3 THEN 'FAILED' ELSE state END,code='LABEL_EXPORT_FAILED',claim_id=NULL,lease_until=NULL
        WHERE id=$1::uuid AND actor_id=$2::uuid AND claim_id=$3::uuid AND state='PREPARING'`, claimed.row.id, principal.id, claimed.row.claim_id);
    }); },
    confirmPrint(staff, input) { return boundary.transaction(staff, async ({ tx, principal }) => {
      reviewer(principal); await lock(tx, principal.id); const requestHash = digest(canonical(input));
      const { row, manifest } = await scopedExport(tx, principal, input.exportId);
      requireThat(row.state === 'READY' && row.sha256 === input.exportSha256 && row.manifest_hash === input.manifestHash, 409, 'LABEL_EXPORT_NOT_READY');
      const [prior] = await tx.$queryRawUnsafe(`SELECT * FROM ${S}.label_print_event WHERE actor_id=$1::uuid AND request_id=$2::uuid`, principal.id, input.requestId);
      if (prior) { requireThat(prior.request_hash === requestHash, 409, 'LABEL_REQUEST_CONFLICT'); return eventView(prior); }
      const slots = manifest.items.map(i => i.slot), all = [...input.successfulSlots, ...(input.failedSlots ?? [])];
      requireThat(input.successfulSlots.length > 0 && new Set(all).size === all.length && all.every(s => Number.isInteger(s) && slots.includes(s)), 400, 'LABEL_PRINT_SLOTS_INVALID');
      const [event] = await tx.$queryRawUnsafe(`INSERT INTO ${S}.label_print_event(id,actor_id,request_id,request_hash,export_id,export_sha256,manifest_hash,successful_slots,failed_slots)
        VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5::uuid,$6,$7,$8::integer[],$9::integer[]) RETURNING *`, randomUUID(), principal.id, input.requestId, requestHash, row.id, row.sha256, row.manifest_hash, input.successfulSlots, input.failedSlots ?? []); return eventView(event);
    }); },
    retryLayout(staff, id, input, target, { automatic = false } = {}) { return boundary.transaction(staff, async ({ tx, principal }) => {
      reviewer(principal); await lock(tx, principal.id); const original = await scopedItem(tx, principal, id);
      const requestHash = digest(canonical({ operation:'layout-retry/v1', itemId:id, ...input }));
      const [prior] = await tx.$queryRawUnsafe(`SELECT * FROM ${S}.label_item WHERE actor_id=$1::uuid AND request_id=$2::uuid`, principal.id, input.requestId);
      // A lost response must recover the accepted generation even after it renders
      // or a newer renderer is deployed. Authority and source were rechecked above.
      if (prior) { requireThat(prior.request_hash === requestHash, 409, 'LABEL_REQUEST_CONFLICT'); return itemView(prior); }
      const [successor] = await tx.$queryRawUnsafe(`SELECT id FROM ${S}.label_item WHERE original_item_id=$1::uuid AND purpose='LAYOUT_RETRY'`, id);
      requireThat(!successor, 409, 'LABEL_LAYOUT_ALREADY_RETRIED');
      requireThat(original.state === 'NEEDS_LAYOUT' && ['ORIGINAL','LAYOUT_RETRY'].includes(original.purpose)
        && !original.print_svg && !original.preview_svg && !original.artwork_hash && !original.sheet_id && !original.slot
        && !original.previous_assignment && !original.claim_id && !original.lease_until, 409, 'LABEL_LAYOUT_RETRY_UNAVAILABLE');
      requireThat(!(await tx.$queryRawUnsafe(`SELECT 1 FROM ${S}.label_export WHERE item_id=$1::uuid LIMIT 1`, id)).length, 409, 'LABEL_LAYOUT_RETRY_UNAVAILABLE');
      if (automatic) requireThat((await tx.$queryRawUnsafe(`SELECT i.id FROM ${S}.label_item i
        WHERE i.id=$1::uuid AND ${layoutRecoveryPredicate('$2','$3')}`, id, target.rendererProfileHash, [...LABEL_LAYOUT_FAILURE_CODES])).length === 1,
      409, 'LABEL_LAYOUT_RETRY_UNAVAILABLE');
      requireThat(labelFailureHash(original) === input.expectedFailureHash, 409, 'LABEL_FAILURE_CHANGED');
      requireThat(target.rendererProfileHash === input.expectedRendererProfileHash, 409, 'LABEL_RENDERER_CHANGED');
      const [chain] = await tx.$queryRawUnsafe(`WITH RECURSIVE ancestry AS (
        SELECT id,original_item_id,purpose,ARRAY[id] AS path,1 AS depth,false AS cycle FROM ${S}.label_item WHERE id=$1::uuid
        UNION ALL SELECT p.id,p.original_item_id,p.purpose,a.path||p.id,a.depth+1,p.id=ANY(a.path)
        FROM ancestry a JOIN ${S}.label_item p ON p.id=a.original_item_id WHERE a.purpose='LAYOUT_RETRY' AND NOT a.cycle AND a.depth<17)
        SELECT max(depth)::int AS depth,bool_or(purpose='ORIGINAL') AS rooted,bool_or(cycle) AS cycle FROM ancestry`,id);
      requireThat(chain?.rooted && !chain.cycle && chain.depth<=16,409,'LABEL_LAYOUT_RETRY_LIMIT');
      const [saved] = await tx.$queryRawUnsafe(`INSERT INTO ${S}.label_item(id,actor_id,access_version,card_id,action_id,approval_version,source_revision,source_hash,report_hash,public_hash,
        purpose,original_item_id,request_id,request_hash,reason,renderer_profile_hash,material_profile_id,jig_hash)
        VALUES($1::uuid,$2::uuid,$3,$4::uuid,$5::uuid,$6,$7,$8,$9,$10,'LAYOUT_RETRY',$11::uuid,$12::uuid,$13,'Retry failed layout',$14,$15,$16) RETURNING *`,
      randomUUID(),principal.id,principal.accessVersion,original.card_id,original.action_id,original.approval_version,original.source_revision,original.source_hash,original.report_hash,original.public_hash,
      original.id,input.requestId,requestHash,target.rendererProfileHash,target.materialProfileId,target.jigHash);
      await tx.$executeRawUnsafe(`UPDATE ${S}.label_item SET state='SUPERSEDED',updated_at=clock_timestamp() WHERE id=$1::uuid`,original.id);
      return itemView(saved);
    }); },
    reprint(staff, id, input) { return boundary.transaction(staff, async ({ tx, principal }) => {
      reviewer(principal); await lock(tx, principal.id); const original = await scopedItem(tx, principal, id);
      requireThat(original.state === 'READY' && original.artwork_hash === input.expectedLabelHash, 409, 'LABEL_SOURCE_CHANGED');
      const requestHash = digest(canonical({ itemId: id, ...input }));
      const [prior] = await tx.$queryRawUnsafe(`SELECT * FROM ${S}.label_item WHERE actor_id=$1::uuid AND request_id=$2::uuid`, principal.id, input.requestId);
      if (prior) { requireThat(prior.request_hash === requestHash, 409, 'LABEL_REQUEST_CONFLICT'); return itemView(prior); }
      const [saved] = await tx.$queryRawUnsafe(`INSERT INTO ${S}.label_item(id,actor_id,access_version,card_id,action_id,approval_version,source_revision,source_hash,report_hash,public_hash,purpose,original_item_id,request_id,request_hash,reason)
        VALUES($1::uuid,$2::uuid,$3,$4::uuid,$5::uuid,$6,$7,$8,$9,$10,'REPRINT',$11::uuid,$12::uuid,$13,$14) RETURNING *`, randomUUID(), principal.id, principal.accessVersion,
      original.card_id, original.action_id, original.approval_version, original.source_revision, original.source_hash, original.report_hash, original.public_hash, original.id, input.requestId, requestHash, input.reason); return itemView(saved);
    }); },
    // Explicit internal operation only. Saved originals, sheet positions, exports
    // and print/NFC history remain untouched; normal reprint() still copies bytes.
    refreshLayout(staff, id, input, target) { return boundary.transaction(staff, async ({ tx, principal }) => {
      reviewer(principal); await lock(tx, principal.id); const original = await scopedItem(tx, principal, id);
      requireThat(original.state === 'READY' && ['ORIGINAL','LAYOUT_RETRY'].includes(original.purpose)
        && original.artwork_hash === input.expectedLabelHash && digest(original.print_svg) === original.artwork_hash,
      409, 'LABEL_REFRESH_SOURCE_CHANGED');
      const [prior] = await tx.$queryRawUnsafe(`SELECT * FROM ${S}.label_item WHERE actor_id=$1::uuid AND request_id=$2::uuid`, principal.id, input.requestId);
      if (prior) {
        const intent = labelReplacementIntent(prior, original);
        requireThat(intent.kind === 'REFRESH' && input.expectedRendererProfileHash === intent.target.rendererProfileHash
          && prior.request_hash === labelRefreshRequestHash(id, input, intent.target), 409, 'LABEL_REQUEST_CONFLICT');
        return itemView(prior);
      }
      requireThat(input.expectedRendererProfileHash === target.rendererProfileHash
        && original.renderer_profile_hash !== target.rendererProfileHash
        && original.material_profile_id === target.materialProfileId && original.jig_hash === target.jigHash, 409, 'LABEL_RENDERER_CHANGED');
      requireThat(input.requestId === labelRefreshRequestId(id, input.expectedLabelHash, target), 409, 'LABEL_REQUEST_CONFLICT');
      const requestHash = labelRefreshRequestHash(id, input, target);
      await assertRefreshUnprinted(tx, original);
      const [saved] = await tx.$queryRawUnsafe(`INSERT INTO ${S}.label_item(id,actor_id,access_version,card_id,action_id,approval_version,source_revision,source_hash,report_hash,public_hash,
        purpose,original_item_id,request_id,request_hash,reason,renderer_profile_hash,material_profile_id,jig_hash)
        VALUES($1::uuid,$2::uuid,$3,$4::uuid,$5::uuid,$6,$7,$8,$9,$10,'REPRINT',$11::uuid,$12::uuid,$13,$14,$15,$16,$17) RETURNING *`,
      randomUUID(),principal.id,principal.accessVersion,original.card_id,original.action_id,original.approval_version,original.source_revision,original.source_hash,original.report_hash,original.public_hash,
      original.id,input.requestId,requestHash,LABEL_REFRESH_REASON,target.rendererProfileHash,target.materialProfileId,target.jigHash);
      return itemView(saved);
    }); },
    async reconciliation(staff, { apply = false, cardIds = [], expectedPlanHash = null } = {}) {
      requireThat(Array.isArray(cardIds) && cardIds.length <= 200); cardIds.forEach(uuid);
      return boundary.transaction(staff, async ({ tx, principal }) => {
        reviewer(principal); const candidates = await tx.$queryRawUnsafe(`SELECT p.card_id,p.action_id,p.version,p.public_hash FROM atlas_manual.publication p JOIN atlas_manual.card c ON c.id=p.card_id
          WHERE p.state='PUBLISHED' AND p.mode='PRODUCTION' AND (c.owner_id=$1::uuid OR $1::uuid=ANY(c.approvers))
          AND NOT EXISTS(SELECT 1 FROM atlas_manual.publication newer WHERE newer.card_id=p.card_id AND newer.version>p.version)
          AND NOT EXISTS(SELECT 1 FROM ${S}.label_item i WHERE i.card_id=p.card_id AND i.action_id=p.action_id AND i.purpose='ORIGINAL')
          AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=p.card_id)
          AND ($2::uuid[]='{}'::uuid[] OR p.card_id=ANY($2::uuid[])) ORDER BY p.published_at LIMIT 201`, principal.id, cardIds);
        requireThat(!apply || (cardIds.length > 0 && candidates.length <= 200), 400, 'LABEL_RECONCILIATION_SCOPE_REQUIRED');
        const planHash = digest(canonical({ actorId: principal.id, cardIds: [...cardIds].sort(), candidates }));
        if (apply && candidates.length) requireThat(expectedPlanHash === planHash, 409, 'LABEL_RECONCILIATION_PLAN_CHANGED');
        for (const item of candidates.slice(0,200)) { await source(tx, principal, item.card_id, item.action_id); if (apply) await api.publicationCommitted({ tx, principal, cardId: item.card_id, actionId: item.action_id }); }
        return { applied: apply, planHash, candidates: candidates.slice(0,200).map(i => ({ cardId: i.card_id, approvalActionId: i.action_id })), hasMore: candidates.length > 200 };
      });
    },
  };
  return Object.freeze(api);
}
export function labelGrantSQL(role) {
  requireThat(/^[a-z][a-z0-9_]{0,62}$/.test(role), 500, 'LABEL_ROLE_INVALID');
  return `GRANT SELECT,INSERT ON atlas_manual_connected.label_item,atlas_manual_connected.label_sheet,atlas_manual_connected.label_export,atlas_manual_connected.label_print_event TO "${role}";\n`
    + `GRANT USAGE ON SEQUENCE atlas_manual_connected.label_sheet_number_seq TO "${role}";\n`
    + `GRANT UPDATE(state,snapshot,snapshot_hash,print_svg,preview_svg,artwork_hash,renderer_profile_hash,material_profile_id,jig_hash,sheet_id,slot,previous_assignment,claim_id,lease_until,attempts,code,updated_at) ON atlas_manual_connected.label_item TO "${role}";\n`
    + `GRANT UPDATE(state,revision,manifest,manifest_hash,sealed_at) ON atlas_manual_connected.label_sheet TO "${role}";\n`
    + `GRANT UPDATE(state,object_ref,sha256,byte_count,mapping,content_type,claim_id,lease_until,attempts,attempt_base,retry_requests,code,ready_at) ON atlas_manual_connected.label_export TO "${role}";`;
}
