import { canonical, digest, immutable, object, requireThat, uuid, hash, validateDesign, deriveDesignContext, designKey, validateLesson } from './contract.mjs';

function access(row, principal, edit = true) {
  requireThat(row, 404, 'MANUAL_CARD_NOT_FOUND');
  const own = row.owner_id === principal.id, canEdit = own || row.editors.includes(principal.id);
  const canRead = canEdit || row.approvers.includes(principal.id) || row.readers.includes(principal.id);
  requireThat(canRead, 404, 'MANUAL_CARD_NOT_FOUND');
  if (edit) requireThat(principal.role === 'REVIEWER' && canEdit, 403, 'MANUAL_CARD_ACCESS_DENIED');
}
function card(row) {
  requireThat(digest(row.content) === row.content_hash, 503, 'MANUAL_STORED_CONTENT_INVALID');
  return { cardId: row.id, revision: row.revision, contentHash: row.content_hash, draft: JSON.parse(row.content) };
}
/** Shared current-card ACL check for a host's transaction composition. Auth
 * principal must come from the ordinary boundary, never request JSON. */
export async function authorizeManualCard(tx, principal, cardId, { edit = true, lock = false, expectedContentHash = null } = {}) {
  uuid(cardId); if (expectedContentHash !== null) hash(expectedContentHash);
  const [row] = await tx.$queryRawUnsafe(`SELECT * FROM atlas_manual.card WHERE id=$1::uuid${lock ? ' FOR UPDATE' : ''}`, cardId);
  access(row, principal, edit);
  if (expectedContentHash !== null) requireThat(row.content_hash === expectedContentHash, 409, 'MANUAL_DRAFT_STALE');
  return immutable(card(row));
}
function confirmed(row) {
  requireThat(row, 404, 'MEMORY_CONFIRMATION_NOT_FOUND');
  const request = JSON.parse(row.request), result = JSON.parse(row.result), saved = result.card;
  requireThat(request.action.type === 'CONFIRM_FINDINGS' && request.action.reviewed === true && request.actionId === row.action_id
    && digest(row.request) === row.request_hash && result.receipt.actorKind === 'HUMAN' && result.receipt.actorId === row.actor_id
    && result.receipt.actionId === row.action_id && saved.cardId === row.card_id && saved.revision === row.result_revision
    && digest(canonical(saved.draft)) === saved.contentHash, 503, 'MEMORY_CONFIRMATION_INVALID');
  hash(saved.draft.source?.sourceHash);
  return immutable({ actionId: row.action_id, actorId: row.actor_id, requestHash: row.request_hash, card: saved });
}
function publication(row) {
  if (!row) return null;
  requireThat(digest(row.document) === row.document_hash, 503, 'MEMORY_PUBLICATION_INVALID');
  return { status: 'PUBLISHED', cardId: row.card_id, actionId: row.action_id, generation: Number(row.revision),
    lessonCount: JSON.parse(row.document).lessons.length, publicationHash: row.document_hash };
}
function sameCurrentEvidence(current, confirmation) {
  const saved = confirmation.card;
  return current.draft.source?.sourceHash === saved.draft.source.sourceHash
    && current.draft.geometry?.sourceHash === saved.draft.geometry?.sourceHash
    && current.draft.defects?.sourceHash === saved.draft.defects?.sourceHash
    && (current.draft.assistance?.sourceHash ?? null) === (saved.draft.assistance?.sourceHash ?? null)
    && canonical(current.draft.identity) === canonical(saved.draft.identity);
}
function validateBundle(bundle, confirmation) {
  object(bundle, ['version', 'design', 'lessons']); validateDesign(bundle.design);
  requireThat(bundle.version === 'atlas-reviewed-lessons-v1' && Array.isArray(bundle.lessons) && bundle.lessons.length <= 200,
    503, 'MEMORY_PUBLICATION_INVALID');
  const ids = new Set(), findingIds = new Set();
  for (const lesson of bundle.lessons) {
    validateLesson(lesson);
    requireThat(!ids.has(lesson.id) && !findingIds.has(lesson.findingId) && canonical(lesson.design) === canonical(bundle.design)
      && lesson.source.cardId === confirmation.card.cardId && lesson.source.actionId === confirmation.actionId
      && lesson.source.actorId === confirmation.actorId && lesson.source.resultRevision === confirmation.card.revision
      && lesson.source.contentHash === confirmation.card.contentHash && lesson.source.nativeSourceHash === confirmation.card.draft.source.sourceHash,
      503, 'MEMORY_PUBLICATION_INVALID');
    ids.add(lesson.id); findingIds.add(lesson.findingId);
  }
}

/** One append-only publication table in the existing manual database. The
 * existing immutable action is the durable outbox; no best-effort enqueue can
 * lose an already confirmed review. Never call a provider/storage effect here. */
export function createDefectMemoryRepository({ boundary, validateSource = null }) {
  const rowFor = async (tx, cardId, lock = false) => (await tx.$queryRawUnsafe(
    `SELECT * FROM atlas_manual.card WHERE id=$1::uuid${lock ? ' FOR UPDATE' : ''}`, cardId))[0];
  const actionFor = async (tx, cardId, actionId = null) => (await tx.$queryRawUnsafe(`SELECT * FROM atlas_manual.action
    WHERE card_id=$1::uuid AND request::jsonb #>> '{action,type}'='CONFIRM_FINDINGS'
    ${actionId ? 'AND action_id=$2::uuid' : ''} ORDER BY result_revision DESC LIMIT 1`, ...[cardId, ...(actionId ? [actionId] : [])]))[0];
  const publicationFor = async (tx, cardId, actionId) => (await tx.$queryRawUnsafe(
    'SELECT * FROM atlas_manual.defect_memory_publication WHERE card_id=$1::uuid AND action_id=$2::uuid', cardId, actionId))[0];
  const evidenceCurrent = async (tx, row, confirmation) => {
    if (!sameCurrentEvidence(card(row), confirmation)) return false;
    const uploads = confirmation.card.draft.source.uploads;
    if (!uploads) return true; // Owned isolated manual fixtures have no intake.
    const [intake] = await tx.$queryRawUnsafe('SELECT front_upload_id,back_upload_id FROM atlas_manual_intake.card WHERE id=$1::uuid', row.id);
    return Boolean(intake && intake.front_upload_id === uploads.FRONT && intake.back_upload_id === uploads.BACK);
  };
  return Object.freeze({
    async loadTarget(staff, cardId) {
      uuid(cardId);
      return boundary.transaction(staff, async ({ tx, principal }) => {
        const row = await rowFor(tx, cardId); access(row, principal);
        const saved = card(row); if (validateSource) await validateSource({ tx, principal, cardId, draft: saved.draft });
        return immutable(saved);
      });
    },
    async status(staff, cardId, actionId = null) {
      uuid(cardId); if (actionId) uuid(actionId);
      return boundary.transaction(staff, async ({ tx, principal }) => {
        const row = await rowFor(tx, cardId); access(row, principal, false);
        const latest = await actionFor(tx, cardId);
        if (!latest) return { status: 'NO_CONFIRMED_FINDINGS', cardId, actionId: null };
        if (actionId && actionId !== latest.action_id) {
          requireThat(await actionFor(tx, cardId, actionId), 404, 'MEMORY_CONFIRMATION_NOT_FOUND');
          return { status: 'SUPERSEDED', cardId, actionId, latestActionId: latest.action_id };
        }
        if (!await evidenceCurrent(tx, row, confirmed(latest))) return { status: 'SUPERSEDED', cardId, actionId: latest.action_id };
        const saved = publication(await publicationFor(tx, cardId, latest.action_id));
        if (saved) return saved;
        return { status: 'PENDING', cardId, actionId: latest.action_id };
      });
    },
    async loadConfirmation(staff, cardId, actionId) {
      uuid(cardId); uuid(actionId);
      return boundary.transaction(staff, async ({ tx, principal }) => {
        const row = await rowFor(tx, cardId); access(row, principal);
        const action = await actionFor(tx, cardId, actionId), confirmation = confirmed(action);
        requireThat(action.actor_id === principal.id, 403, 'MEMORY_CONFIRMER_REQUIRED');
        const latest = await actionFor(tx, cardId);
        if (latest.action_id !== actionId) return { status: 'SUPERSEDED', cardId, actionId, latestActionId: latest.action_id };
        if (!await evidenceCurrent(tx, row, confirmation)) return { status: 'SUPERSEDED', cardId, actionId };
        const saved = publication(await publicationFor(tx, cardId, actionId)); if (saved) return saved;
        if (validateSource) await validateSource({ tx, principal, cardId, draft: confirmation.card.draft });
        return { status: 'PENDING', confirmation };
      });
    },
    async publish(staff, input, candidate) {
      // Capture caller-owned data before any awaited lock/authentication.
      const confirmation = immutable(JSON.parse(canonical(input, { maxBytes: 524288 })));
      const bundleText = canonical(candidate, { maxBytes: 1048576 }), bundle = JSON.parse(bundleText);
      validateBundle(bundle, confirmation);
      const { cardId } = confirmation.card; uuid(cardId); uuid(confirmation.actionId);
      return boundary.transaction(staff, async ({ tx, principal, refresh }) => {
        const row = await rowFor(tx, cardId, true); ({ principal } = await refresh()); access(row, principal);
        const sourceAction = await actionFor(tx, cardId, confirmation.actionId), actual = confirmed(sourceAction);
        requireThat(actual.actorId === principal.id, 403, 'MEMORY_CONFIRMER_REQUIRED');
        requireThat(canonical(actual, { maxBytes: 524288 }) === canonical(confirmation, { maxBytes: 524288 }), 409, 'MEMORY_CONFIRMATION_STALE');
        const base = JSON.parse(sourceAction.request).action.base;
        requireThat(canonical(bundle.design) === canonical(deriveDesignContext(base.FRONT.profile, actual.card.draft.identity))
          && bundle.lessons.every(lesson => canonical(lesson.source.frame) === canonical(base[lesson.side].frame)), 409, 'MEMORY_CONFIRMATION_STALE');
        const latest = await actionFor(tx, cardId);
        if (latest.action_id !== confirmation.actionId) return { status: 'SUPERSEDED', cardId, actionId: confirmation.actionId, latestActionId: latest.action_id };
        if (!await evidenceCurrent(tx, row, actual)) return { status: 'SUPERSEDED', cardId, actionId: confirmation.actionId };
        const prior = publication(await publicationFor(tx, cardId, confirmation.actionId)); if (prior) return prior;
        if (validateSource) await validateSource({ tx, principal, cardId, draft: actual.card.draft });
        // The short publication lock assigns a global committed generation.
        // It never covers card editing, reads, crop generation or model calls.
        await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(719400621)::text AS locked');
        ({ principal } = await refresh()); access(row, principal);
        const inserted = await tx.$queryRawUnsafe(`INSERT INTO atlas_manual.defect_memory_publication
          (revision,card_id,action_id,actor_id,result_revision,content_hash,source_hash,design_key,document,document_hash)
          SELECT COALESCE(MAX(revision),0)+1,$1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9 FROM atlas_manual.defect_memory_publication
          RETURNING *`, cardId, confirmation.actionId, principal.id, actual.card.revision, actual.card.contentHash,
        actual.card.draft.source.sourceHash, designKey(bundle.design), bundleText, digest(bundleText));
        return publication(inserted[0]);
      });
    },
    async readRelevant(staff, { cardId, expectedContentHash, design, originalSha256, side = null, limit = 12 }) {
      uuid(cardId); hash(expectedContentHash); validateDesign(design);
      requireThat(Array.isArray(originalSha256) && originalSha256.length === 2, 400, 'MEMORY_TARGET_REQUIRED'); originalSha256.forEach(hash);
      requireThat((side === null || ['FRONT', 'BACK'].includes(side)) && Number.isSafeInteger(limit) && limit > 0 && limit <= 32, 400, 'MEMORY_RETRIEVAL_INVALID');
      const { cardNumber: _number, ...family } = design;
      return boundary.transaction(staff, async ({ tx, principal }) => {
        const row = await rowFor(tx, cardId); access(row, principal);
        requireThat(row.content_hash === expectedContentHash, 409, 'MEMORY_TARGET_STALE');
        const target = card(row); if (validateSource) await validateSource({ tx, principal, cardId, draft: target.draft });
        // One statement snapshot binds the publication generation, latest
        // confirmation set (including pending supersession), and candidate list.
        const [snapshot] = await tx.$queryRawUnsafe(`WITH latest_action AS MATERIALIZED (
          SELECT DISTINCT ON (card_id) card_id,action_id,result_revision,request,result FROM atlas_manual.action
          WHERE request::jsonb #>> '{action,type}'='CONFIRM_FINDINGS' ORDER BY card_id,result_revision DESC
        ), latest AS MATERIALIZED (
          SELECT l.*,c.content_hash AS current_hash,c.content::jsonb AS current_draft,i.revision AS intake_revision,
            i.front_upload_id,i.back_upload_id FROM latest_action l JOIN atlas_manual.card c ON c.id=l.card_id
            LEFT JOIN atlas_manual_intake.card i ON i.id=l.card_id
        ), relevant AS (
          SELECT l.*,p.document,p.document_hash,p.revision AS publication_revision FROM latest l
          LEFT JOIN atlas_manual.defect_memory_publication p ON p.card_id=l.card_id AND p.action_id=l.action_id
          WHERE l.card_id<>$1::uuid AND atlas_manual.defect_memory_design(l.result::jsonb #> '{card,draft,identity}',
            l.request::jsonb #>> '{action,base,FRONT,profile}')=$2::jsonb
            AND (p.document IS NOT NULL OR (
              l.current_draft #>> '{source,sourceHash}'=l.result::jsonb #>> '{card,draft,source,sourceHash}'
              AND l.current_draft #>> '{geometry,sourceHash}'=l.result::jsonb #>> '{card,draft,geometry,sourceHash}'
              AND l.current_draft #>> '{defects,sourceHash}'=l.result::jsonb #>> '{card,draft,defects,sourceHash}'
              AND (l.current_draft #>> '{assistance,sourceHash}') IS NOT DISTINCT FROM (l.result::jsonb #>> '{card,draft,assistance,sourceHash}')
              AND l.current_draft->'identity'=l.result::jsonb #> '{card,draft,identity}'
              AND (l.intake_revision IS NULL OR (l.front_upload_id::text=l.result::jsonb #>> '{card,draft,source,uploads,FRONT}'
                AND l.back_upload_id::text=l.result::jsonb #>> '{card,draft,source,uploads,BACK}'))))
        ), recent AS (
          SELECT * FROM relevant WHERE document IS NOT NULL ORDER BY publication_revision DESC LIMIT 256
        ), selected AS (
          SELECT lesson,publication_revision FROM recent CROSS JOIN LATERAL jsonb_array_elements(document::jsonb->'lessons') lesson
          WHERE ($3::text IS NULL OR lesson->>'side'=$3) AND NOT (lesson #>> '{source,frame,originalSha256}'=ANY($4::text[]))
            AND (lesson->>'disposition'<>'REJECTED' OR ($5::text IS NOT NULL AND lesson #>> '{design,cardNumber}'=$5))
          ORDER BY COALESCE(lesson #>> '{design,cardNumber}'=$5,false) DESC,publication_revision DESC,lesson->>'id' COLLATE "C"
          LIMIT $6
        ) SELECT COALESCE((SELECT MAX(revision) FROM atlas_manual.defect_memory_publication),0)::integer AS generation,
          encode(sha256(convert_to(COALESCE((SELECT string_agg(card_id::text||':'||action_id::text||':'||result_revision::text||':'||current_hash||':'||COALESCE(intake_revision,0)::text,',' ORDER BY card_id) FROM latest),''),'UTF8')),'hex') AS confirmation_hash,
          (SELECT count(*)::integer FROM relevant WHERE document IS NULL) AS pending,
          COALESCE((SELECT jsonb_agg(jsonb_build_object('lesson',lesson,'generation',publication_revision)
            ORDER BY COALESCE(lesson #>> '{design,cardNumber}'=$5,false) DESC,publication_revision DESC,lesson->>'id' COLLATE "C") FROM selected),'[]'::jsonb) AS selected`,
        cardId, JSON.stringify(family), side, originalSha256, design.cardNumber, limit);
        const lessons = [];
        for (const entry of snapshot.selected) {
            const lesson = entry.lesson;
            validateLesson(lesson);
            if (designKey(lesson.design) !== designKey(design) || side && lesson.side !== side || originalSha256.includes(lesson.source.frame.originalSha256)) continue;
            // Negative examples can encode printed design features. Restrict
            // these to a known exact card number within the matching family.
            if (lesson.disposition === 'REJECTED' && (!design.cardNumber || lesson.design.cardNumber !== design.cardNumber)) continue;
            lessons.push({ lesson, generation: Number(entry.generation), exact: design.cardNumber !== null && lesson.design.cardNumber === design.cardNumber });
        }
        lessons.sort((a, b) => Number(b.exact) - Number(a.exact) || b.generation - a.generation || a.lesson.id.localeCompare(b.lesson.id));
        return immutable({ generation: snapshot.generation, revision: `m1:${snapshot.generation}:${snapshot.confirmation_hash}`,
          pendingPublications: snapshot.pending, lessons: lessons.slice(0, limit).map(item => item.lesson) });
      });
    },
  });
}

export function defectMemoryGrantSQL(role) {
  requireThat(/^[a-z][a-z0-9_]{0,62}$/.test(role));
  return `GRANT SELECT,INSERT ON atlas_manual.defect_memory_publication TO "${role}";\nGRANT EXECUTE ON FUNCTION atlas_manual.defect_memory_design(jsonb,text) TO "${role}";`;
}
