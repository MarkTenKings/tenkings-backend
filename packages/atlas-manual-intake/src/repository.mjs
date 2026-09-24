import { randomUUID } from 'node:crypto';
import { descriptorSha256, parseUploadPlan } from '@atlas/photo-core';
import { canonical, createInput, document, hash, immutable, integer, planInput, requireOwner, requireThat,
  storedDocument, uuid, verification } from './contract.mjs';

function uploadView(row) {
  if (!row) return null;
  const plan = parseUploadPlan(storedDocument(row.plan, row.plan_hash));
  requireThat(plan.uploadId === row.id && plan.binding.cardId === row.card_id && plan.binding.side === row.side
    && plan.binding.version === row.version, 503, 'INTAKE_STORED_CONTENT_INVALID');
  const verified = row.verification === null ? null : verification(storedDocument(row.verification, row.verification_hash), plan);
  return { uploadId: row.id, requestId: row.request_id, side: row.side, version: row.version, plan,
    verification: verified, source: row.source === null ? null : storedDocument(row.source, row.source_hash) };
}
const cardRow = async (tx, cardId, lock = '') => (await tx.$queryRawUnsafe(
  `SELECT * FROM atlas_manual_intake.card WHERE id=$1::uuid${lock ? ` FOR ${lock}` : ''}`, cardId))[0];
const uploadRow = async (tx, cardId, uploadId) => (await tx.$queryRawUnsafe(
  'SELECT * FROM atlas_manual_intake.upload WHERE card_id=$1::uuid AND id=$2::uuid', cardId, uploadId))[0];
async function view(tx, row) {
  const uploads = await tx.$queryRawUnsafe('SELECT * FROM atlas_manual_intake.upload WHERE card_id=$1::uuid AND id=ANY($2::uuid[])',
    row.id, [row.front_upload_id, row.back_upload_id].filter(Boolean));
  const sides = Object.fromEntries(['FRONT', 'BACK'].map(side => {
    const slot = side.toLowerCase(), upload = uploadView(uploads.find(item => item.id === row[`${slot}_upload_id`]));
    requireThat(row[`${slot}_version`] === (upload?.version ?? 0) && (!upload || upload.plan.binding.pairId === row.pair_id),
      503, 'INTAKE_STORED_CONTENT_INVALID');
    return [side, { version: row[`${slot}_version`], upload }];
  }));
  const ready = Boolean(sides.FRONT.upload?.source && sides.BACK.upload?.source);
  const sourceHash = ready ? descriptorSha256({ cardId: row.id, pairId: row.pair_id,
    front: sides.FRONT.upload, back: sides.BACK.upload }) : null;
  return immutable({ cardId: row.id, pairId: row.pair_id, label: row.label, revision: row.revision,
    createdAt: new Date(row.created_at).toISOString(), sides, ready, sourceHash });
}

/** Only compact metadata enters PostgreSQL. CPU, signing, reads and writes are
 * deliberately absent from transaction callbacks. All mutation locks one card.
 * The ordinary existing staff boundary authenticates and rechecks expiry.
 */
export function createIntakeRepository({ boundary, keyPrefix, maxOriginalBytes, sourceCommitted = null }) {
  requireThat(typeof boundary?.transaction === 'function' && typeof keyPrefix === 'string'
    && /^[a-zA-Z0-9][a-zA-Z0-9_/-]{0,100}$/.test(keyPrefix) && !keyPrefix.includes('..') && !keyPrefix.endsWith('/'), 500, 'INTAKE_CONFIG_INVALID');
  integer(maxOriginalBytes, 1);
  const mutate = async (staff, cardId, work) => boundary.transaction(staff, async ({ tx, principal, refresh }) => {
    const row = await cardRow(tx, uuid(cardId), 'UPDATE'); principal = (await refresh()).principal;
    requireOwner(row, principal, true); return work(tx, row, principal);
  });
  return Object.freeze({
    async authorizeInTransaction(tx, principal, cardId, { edit = false, lock = '' } = {}) {
      uuid(cardId); requireThat(['', 'SHARE', 'UPDATE'].includes(lock));
      const row = await cardRow(tx, cardId, lock); requireOwner(row, principal, edit);
      return view(tx, row);
    },
    async create(staff, input) {
      const request = document(createInput(input)), cardId = randomUUID(), pairId = randomUUID();
      return boundary.transaction(staff, async ({ tx, principal }) => {
        requireThat(principal.role === 'REVIEWER', 403, 'INTAKE_CARD_ACCESS_DENIED');
        await tx.$executeRawUnsafe(`INSERT INTO atlas_manual_intake.card(id,pair_id,owner_id,create_request_id,create_request_hash,label)
          VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6) ON CONFLICT(owner_id,create_request_id) DO NOTHING`,
        cardId, pairId, principal.id, request.value.requestId, request.hash, request.value.label);
        const row = (await tx.$queryRawUnsafe('SELECT * FROM atlas_manual_intake.card WHERE owner_id=$1::uuid AND create_request_id=$2::uuid',
          principal.id, request.value.requestId))[0];
        requireThat(row && row.create_request_hash === request.hash, 409, 'INTAKE_REQUEST_ID_CONFLICT');
        return { card: await view(tx, row) };
      });
    },
    async list(staff, { limit = 30, cursor = null } = {}) {
      integer(limit, 1); requireThat(limit <= 100);
      if (cursor !== null) uuid(cursor);
      return boundary.transaction(staff, async ({ tx, principal }) => {
        if (cursor) requireOwner(await cardRow(tx, cursor), principal);
        // Pagination is an operational read bound, never an intake allowance.
        const rows = await tx.$queryRawUnsafe(`SELECT * FROM atlas_manual_intake.card WHERE owner_id=$1::uuid
          AND ($2::uuid IS NULL OR (created_at,id)<(SELECT created_at,id FROM atlas_manual_intake.card WHERE id=$2::uuid))
          ORDER BY created_at DESC,id DESC LIMIT $3`, principal.id, cursor, limit + 1);
        const page = rows.slice(0, limit), cards = [];
        for (const row of page) cards.push(await view(tx, row));
        return { cards, nextCursor: rows.length > limit ? page.at(-1).id : null };
      });
    },
    async read(staff, cardId, { edit = false } = {}) {
      uuid(cardId);
      return boundary.transaction(staff, async ({ tx, principal }) => {
        const row = await cardRow(tx, cardId); requireOwner(row, principal, edit);
        return { card: await view(tx, row), principal };
      });
    },
    async plan(staff, cardId, input) {
      const request = document(planInput(input)); requireThat(request.value.byteCount <= maxOriginalBytes, 413, 'INTAKE_PHOTO_TOO_LARGE');
      return mutate(staff, cardId, async (tx, row, principal) => {
        const previous = (await tx.$queryRawUnsafe('SELECT * FROM atlas_manual_intake.upload WHERE card_id=$1::uuid AND request_id=$2::uuid',
          cardId, request.value.requestId))[0];
        if (previous) {
          requireThat(previous.actor_id === principal.id && previous.request_hash === request.hash, 409, 'INTAKE_REQUEST_ID_CONFLICT');
          return { card: await view(tx, row), upload: uploadView(previous) };
        }
        const { side, expectedVersion, sha256, byteCount } = request.value, slot = side.toLowerCase();
        requireThat(row[`${slot}_version`] === expectedVersion, 409, 'INTAKE_SIDE_STALE');
        const version = integer(expectedVersion + 1, 1), uploadId = randomUUID();
        const plan = document(parseUploadPlan({ schemaVersion: 1, uploadId,
          binding: { cardId, pairId: row.pair_id, side, version },
          object: { key: `${keyPrefix}/originals/${cardId}/${side}/${version}/${uploadId}`, versionId: null }, expected: { sha256, byteCount } }));
        await tx.$executeRawUnsafe(`INSERT INTO atlas_manual_intake.upload(id,card_id,request_id,actor_id,request,request_hash,side,version,plan,plan_hash)
          VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10)`,
        uploadId, cardId, request.value.requestId, principal.id, request.text, request.hash, side, version, plan.text, plan.hash);
        await tx.$executeRawUnsafe(`UPDATE atlas_manual_intake.card SET ${slot}_version=$1,${slot}_upload_id=$2::uuid,
          revision=revision+1,updated_at=clock_timestamp() WHERE id=$3::uuid`, version, uploadId, cardId);
        return { card: await view(tx, await cardRow(tx, cardId)), upload: uploadView(await uploadRow(tx, cardId, uploadId)) };
      });
    },
    async upload(staff, cardId, uploadId, { edit = false, current = false } = {}) {
      uuid(cardId); uuid(uploadId);
      return boundary.transaction(staff, async ({ tx, principal }) => {
        const row = await cardRow(tx, cardId); requireOwner(row, principal, edit);
        const upload = uploadView(await uploadRow(tx, cardId, uploadId)); requireThat(upload, 404, 'INTAKE_UPLOAD_NOT_FOUND');
        if (current) requireThat(row[`${upload.side.toLowerCase()}_upload_id`] === uploadId, 409, 'INTAKE_SIDE_STALE');
        return { card: await view(tx, row), upload, principal };
      });
    },
    async recordVerification(staff, cardId, uploadId, observed) {
      uuid(uploadId); const observedSnapshot = structuredClone(observed);
      return mutate(staff, cardId, async (tx, row) => {
        const saved = await uploadRow(tx, cardId, uploadId), upload = uploadView(saved); requireThat(upload, 404, 'INTAKE_UPLOAD_NOT_FOUND');
        const next = document(verification(observedSnapshot, upload.plan));
        if (upload.verification) requireThat(saved.verification_hash === next.hash, 409, 'INTAKE_UPLOAD_CONFLICT');
        else {
          await tx.$executeRawUnsafe('UPDATE atlas_manual_intake.upload SET verification=$1,verification_hash=$2 WHERE card_id=$3::uuid AND id=$4::uuid',
            next.text, next.hash, cardId, uploadId);
          if (row[`${upload.side.toLowerCase()}_upload_id`] === uploadId) await tx.$executeRawUnsafe(
            'UPDATE atlas_manual_intake.card SET revision=revision+1,updated_at=clock_timestamp() WHERE id=$1::uuid', cardId);
        }
        return { card: await view(tx, await cardRow(tx, cardId)), upload: uploadView(await uploadRow(tx, cardId, uploadId)) };
      });
    },
    async recordSource(staff, cardId, uploadId, { verificationHash, source }) {
      uuid(uploadId); hash(verificationHash); const next = document(source);
      return mutate(staff, cardId, async (tx, row, principal) => {
        const saved = await uploadRow(tx, cardId, uploadId), upload = uploadView(saved); requireThat(upload, 404, 'INTAKE_UPLOAD_NOT_FOUND');
        requireThat(saved.verification_hash === verificationHash, 409, 'INTAKE_UPLOAD_CONFLICT');
        if (upload.source) requireThat(saved.source_hash === next.hash, 409, 'INTAKE_SOURCE_CONFLICT');
        else {
          await tx.$executeRawUnsafe('UPDATE atlas_manual_intake.upload SET source=$1,source_hash=$2 WHERE card_id=$3::uuid AND id=$4::uuid',
            next.text, next.hash, cardId, uploadId);
          if (row[`${upload.side.toLowerCase()}_upload_id`] === uploadId) await tx.$executeRawUnsafe(
            'UPDATE atlas_manual_intake.card SET revision=revision+1,updated_at=clock_timestamp() WHERE id=$1::uuid', cardId);
        }
        if (sourceCommitted) await sourceCommitted({ tx, principal, cardId, uploadId });
        return { card: await view(tx, await cardRow(tx, cardId)), upload: uploadView(await uploadRow(tx, cardId, uploadId)) };
      });
    },
    /** Trusted manual-service commit hook, inside that SAME authenticated tx.
     * SHARE conflicts with photo selection/completion UPDATE through commit.
     * No external work is permitted here. Existing manual auth refresh fences
     * expiry after the wait. Holding two unrelated card locks is unnecessary.
     */
    async assertCurrentPair(tx, principal, { cardId, sourceHash }) {
      uuid(cardId); hash(sourceHash);
      const row = await cardRow(tx, cardId, 'SHARE'); requireOwner(row, principal, true);
      const card = await view(tx, row);
      requireThat(card.ready && card.sourceHash === sourceHash, 409, 'INTAKE_PAIR_STALE'); return card;
    },
  });
}

/** Apply only to the separate restricted manual-serving role after review. */
export function intakeGrantSQL(role) {
  requireThat(/^[a-z][a-z0-9_]{0,62}$/.test(role));
  return `GRANT USAGE ON SCHEMA atlas_manual_intake TO "${role}";
GRANT SELECT, INSERT ON atlas_manual_intake.card,atlas_manual_intake.upload TO "${role}";
GRANT UPDATE (revision,front_version,back_version,front_upload_id,back_upload_id,updated_at) ON atlas_manual_intake.card TO "${role}";
GRANT UPDATE (verification,verification_hash,source,source_hash) ON atlas_manual_intake.upload TO "${role}";`;
}
