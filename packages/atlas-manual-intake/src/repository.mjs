import { randomUUID } from 'node:crypto';
import { descriptorSha256, parseUploadPlan } from '@atlas/photo-core';
import { canonical, createInput, discardSelection, document, hash, immutable, integer, planInput, requireOwner, requireThat,
  storedDocument, uuid, verification } from './contract.mjs';
import { assertIngestionLease } from './ingestion.mjs';

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
const ownerLock = (tx, ownerId) => tx.$executeRawUnsafe(
  "SELECT pg_advisory_xact_lock(hashtextextended('atlas-intake-discard:'||$1::text,0))", ownerId);
async function assertNotDiscarded(tx, row) {
  const found = await tx.$queryRawUnsafe('SELECT 1 FROM atlas_manual_intake.discarded_card WHERE owner_id=$1::uuid AND create_request_id=$2::uuid',
    row.owner_id, row.create_request_id);
  requireThat(!found.length, 410, 'INTAKE_CARD_DELETED');
}
const uploadRow = async (tx, cardId, uploadId) => (await tx.$queryRawUnsafe(
  'SELECT * FROM atlas_manual_intake.upload WHERE card_id=$1::uuid AND id=$2::uuid', cardId, uploadId))[0];
async function cardView(tx, row, includeIngestionStatus) {
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
  let ingestion;
  if (includeIngestionStatus) {
    const jobs = await tx.$queryRawUnsafe(`SELECT upload_id,stage,state,code,attempts,updated_at
      FROM atlas_manual_intake.ingestion WHERE card_id=$1::uuid AND upload_id=ANY($2::uuid[])`,
    row.id, [row.front_upload_id,row.back_upload_id].filter(Boolean));
    ingestion = Object.fromEntries(['FRONT','BACK'].map(side => {
      const job = jobs.find(value => value.upload_id === sides[side].upload?.uploadId);
      return [side, job ? { stage: job.stage, state: job.state, code: job.code, attempts: job.attempts,
        updatedAt: new Date(job.updated_at).toISOString() } : null];
    }));
  }
  return immutable({ cardId: row.id, createRequestId: row.create_request_id, pairId: row.pair_id, label: row.label, revision: row.revision,
    createdAt: new Date(row.created_at).toISOString(), sides, ready, sourceHash, ...(ingestion ? { ingestion } : {}) });
}

/** Only compact metadata enters PostgreSQL. CPU, signing, reads and writes are
 * deliberately absent from transaction callbacks. All mutation locks one card.
 * The ordinary existing staff boundary authenticates and rechecks expiry.
 */
export function createIntakeRepository({ boundary, keyPrefix, maxOriginalBytes, sourceCommitted = null, pairCommitted = null, includeIngestionStatus = false }) {
  requireThat(typeof boundary?.transaction === 'function' && typeof keyPrefix === 'string'
    && /^[a-zA-Z0-9][a-zA-Z0-9_/-]{0,100}$/.test(keyPrefix) && !keyPrefix.includes('..') && !keyPrefix.endsWith('/'), 500, 'INTAKE_CONFIG_INVALID');
  integer(maxOriginalBytes, 1);
  const view = (tx, row) => cardView(tx, row, includeIngestionStatus);
  const mutate = async (staff, cardId, work) => boundary.transaction(staff, async ({ tx, principal, refresh }) => {
    const row = await cardRow(tx, uuid(cardId), 'UPDATE'); principal = (await refresh()).principal;
    requireOwner(row, principal, true); await assertNotDiscarded(tx, row); return work(tx, row, principal);
  });
  async function discardTransaction(staff, work) {
    for (let attempt = 0; ; attempt++) {
      try { return await boundary.transaction(staff, work); }
      catch (error) {
        const code = error?.meta?.code ?? error?.code;
        if (code !== '55P03') throw error;
        // Never queue an exclusive intake lock behind cross-domain readers.
        // Retrying an aborted, effect-free transaction keeps the snapshot atomic.
        requireThat(attempt < 4, 409, 'INTAKE_DISCARD_BUSY');
        await new Promise(resolve => setTimeout(resolve, 20 * 2 ** attempt));
      }
    }
  }
  return Object.freeze({
    async authorizeInTransaction(tx, principal, cardId, { edit = false, lock = '' } = {}) {
      uuid(cardId); requireThat(['', 'SHARE', 'UPDATE'].includes(lock));
      const row = await cardRow(tx, cardId, lock || 'SHARE'); requireOwner(row, principal, edit); await assertNotDiscarded(tx, row);
      return view(tx, row);
    },
    // Connected manual reads already check their own ACL. This hook fences the
    // shared intake identity without changing legacy/non-intake repositories.
    async assertActiveInTransaction(tx, cardId) {
      const row = await cardRow(tx, uuid(cardId), 'SHARE');
      requireThat(row, 404, 'INTAKE_CARD_NOT_FOUND'); await assertNotDiscarded(tx, row);
    },
    async discard(staff, input) {
      const request = document(discardSelection(input, true));
      return discardTransaction(staff, async ({ tx, principal, refresh }) => {
        requireThat(principal.role === 'REVIEWER', 403, 'INTAKE_CARD_ACCESS_DENIED');
        await ownerLock(tx, principal.id); principal = (await refresh()).principal;
        const [prior] = await tx.$queryRawUnsafe('SELECT * FROM atlas_manual_intake.discard_request WHERE owner_id=$1::uuid AND request_id=$2::uuid',
          principal.id, request.value.requestId);
        if (prior) {
          requireThat(prior.request_hash === request.hash, 409, 'INTAKE_REQUEST_ID_CONFLICT');
          return { receipt: storedDocument(prior.receipt, prior.receipt_hash) };
        }
        // Only these intake row locks are acquired. Other domains lock their
        // own card first, then intake; taking their locks here would invert it.
        const rows = await tx.$queryRawUnsafe(`SELECT * FROM atlas_manual_intake.card
          WHERE owner_id=$1::uuid AND ($2::boolean OR id=ANY($3::uuid[]) OR create_request_id=ANY($4::uuid[]))
          ORDER BY id FOR UPDATE NOWAIT`, principal.id, request.value.scope === 'ALL', request.value.cardIds, request.value.createRequestIds);
        requireThat(request.value.cardIds.every(id => rows.some(row => row.id === id)), 404, 'INTAKE_CARD_NOT_FOUND');
        const cardIds = rows.map(row => row.id).sort();
        // Published/customer custody is a different disposition, not a test
        // workspace discard. Never release a live physical station implicitly.
        if (cardIds.length) {
          const [blocked] = await tx.$queryRawUnsafe(`SELECT
            EXISTS(SELECT 1 FROM atlas_manual.publication WHERE card_id=ANY($1::uuid[])) OR
            EXISTS(SELECT 1 FROM atlas_dealer.manual_card_link WHERE manual_card_id=ANY($1::uuid[])) OR
            EXISTS(SELECT 1 FROM atlas_manual_connected.station_arm a JOIN atlas_manual_connected.station_active s ON s.intent_id=a.intent_id
              WHERE a.card_id=ANY($1::uuid[])) AS blocked`, cardIds);
          requireThat(!blocked.blocked, 409, 'INTAKE_CARD_HAS_COMMITTED_OBLIGATIONS');
        }
        const byCreateId = new Map(rows.map(row => [row.create_request_id, row.id]));
        const createRequestIds = [...new Set([...request.value.createRequestIds, ...byCreateId.keys()])].sort();
        const [clock] = await tx.$queryRawUnsafe('SELECT clock_timestamp() AS now');
        const receipt = document({ requestId: request.value.requestId, scope: request.value.scope,
          createRequestIds, cardIds, discardedAt: new Date(clock.now).toISOString() });
        await tx.$executeRawUnsafe(`INSERT INTO atlas_manual_intake.discard_request(owner_id,request_id,request,request_hash,receipt,receipt_hash)
          VALUES($1::uuid,$2::uuid,$3,$4,$5,$6)`, principal.id, request.value.requestId, request.text, request.hash, receipt.text, receipt.hash);
        // The receipt and every tombstone commit together; a lost response can
        // only replay this exact snapshot, never sweep later-created cards.
        await tx.$executeRawUnsafe(`INSERT INTO atlas_manual_intake.discarded_card(owner_id,create_request_id,card_id,request_id)
          SELECT $1::uuid,x.create_id::uuid,x.card_id::uuid,$2::uuid
          FROM jsonb_to_recordset($3::jsonb) AS x(create_id text,card_id text)
          ON CONFLICT(owner_id,create_request_id) DO NOTHING`, principal.id, request.value.requestId,
        JSON.stringify(createRequestIds.map(id => ({ create_id: id, card_id: byCreateId.get(id) ?? null }))));
        return { receipt: receipt.value };
      });
    },
    async discardStatus(staff, input) {
      const selection = discardSelection(input);
      return boundary.transaction(staff, async ({ tx, principal }) => {
        const rows = await tx.$queryRawUnsafe(`SELECT create_request_id,card_id FROM atlas_manual_intake.discarded_card
          WHERE owner_id=$1::uuid AND (create_request_id=ANY($2::uuid[]) OR card_id=ANY($3::uuid[]))`,
        principal.id, selection.createRequestIds, selection.cardIds);
        return { createRequestIds: rows.map(row => row.create_request_id).filter(id => selection.createRequestIds.includes(id)).sort(),
          cardIds: rows.map(row => row.card_id).filter(id => selection.cardIds.includes(id)).sort() };
      });
    },
    async create(staff, input) {
      const request = document(createInput(input)), cardId = randomUUID(), pairId = randomUUID();
      return boundary.transaction(staff, async ({ tx, principal }) => {
        requireThat(principal.role === 'REVIEWER', 403, 'INTAKE_CARD_ACCESS_DENIED');
        await ownerLock(tx, principal.id);
        await assertNotDiscarded(tx, { owner_id: principal.id, create_request_id: request.value.requestId });
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
        const rows = await tx.$queryRawUnsafe(`SELECT * FROM atlas_manual_intake.card c WHERE owner_id=$1::uuid
          AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.owner_id=c.owner_id AND d.create_request_id=c.create_request_id)
          AND ($2::uuid IS NULL OR (created_at,id)<(SELECT created_at,id FROM atlas_manual_intake.card WHERE id=$2::uuid))
          ORDER BY created_at DESC,id DESC LIMIT $3`, principal.id, cursor, limit + 1);
        const page = rows.slice(0, limit), cards = [];
        for (const row of page) cards.push(await view(tx, row));
        return { cards, nextCursor: rows.length > limit ? page.at(-1).id : null };
      });
    },
    async processingList(staff, { limit = 100 } = {}) {
      integer(limit, 1); requireThat(limit <= 100 && includeIngestionStatus, 503, 'INTAKE_INGESTION_UNAVAILABLE');
      return boundary.transaction(staff, async ({ tx, principal }) => {
        const rows = await tx.$queryRawUnsafe(`SELECT c.id,c.create_request_id,c.label,
          f.verification IS NOT NULL AS front_verified,f.source IS NOT NULL AS front_prepared,
          b.verification IS NOT NULL AS back_verified,b.source IS NOT NULL AS back_prepared,
          jf.stage AS front_stage,jf.state AS front_state,jf.code AS front_code,
          jb.stage AS back_stage,jb.state AS back_state,jb.code AS back_code
          FROM atlas_manual_intake.card c
          LEFT JOIN atlas_manual_intake.upload f ON f.id=c.front_upload_id
          LEFT JOIN atlas_manual_intake.upload b ON b.id=c.back_upload_id
          LEFT JOIN atlas_manual_intake.ingestion jf ON jf.upload_id=f.id
          LEFT JOIN atlas_manual_intake.ingestion jb ON jb.upload_id=b.id
          WHERE c.owner_id=$1::uuid AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=c.id)
          ORDER BY c.created_at DESC,c.id DESC LIMIT $2`, principal.id, limit);
        return { cards: rows.map(row => ({ cardId: row.id, createRequestId: row.create_request_id, label: row.label,
          ready: row.front_prepared && row.back_prepared,
          sides: Object.fromEntries(['FRONT','BACK'].map(side => { const key = side.toLowerCase();
            return [side, { verified: row[`${key}_verified`], prepared: row[`${key}_prepared`] }]; })),
          ingestion: Object.fromEntries(['FRONT','BACK'].map(side => { const key = side.toLowerCase();
            return [side, row[`${key}_state`] ? { stage: row[`${key}_stage`], state: row[`${key}_state`], code: row[`${key}_code`] } : null]; })) })) };
      });
    },
    async read(staff, cardId, { edit = false } = {}) {
      uuid(cardId);
      return boundary.transaction(staff, async ({ tx, principal }) => {
        const row = await cardRow(tx, cardId, 'SHARE'); requireOwner(row, principal, edit); await assertNotDiscarded(tx, row);
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
    async upload(staff, cardId, uploadId, { edit = false, current = false, lease = null } = {}) {
      uuid(cardId); uuid(uploadId);
      return boundary.transaction(staff, async ({ tx, principal }) => {
        const row = await cardRow(tx, cardId, 'SHARE'); requireOwner(row, principal, edit); await assertNotDiscarded(tx, row);
        await assertIngestionLease(tx, row, uploadId, lease);
        const upload = uploadView(await uploadRow(tx, cardId, uploadId)); requireThat(upload, 404, 'INTAKE_UPLOAD_NOT_FOUND');
        if (current) requireThat(row[`${upload.side.toLowerCase()}_upload_id`] === uploadId, 409, 'INTAKE_SIDE_STALE');
        return { card: await view(tx, row), upload, principal };
      });
    },
    async recordVerification(staff, cardId, uploadId, observed, { lease = null } = {}) {
      uuid(uploadId); const observedSnapshot = structuredClone(observed);
      return mutate(staff, cardId, async (tx, row) => {
        await assertIngestionLease(tx, row, uploadId, lease);
        const saved = await uploadRow(tx, cardId, uploadId), upload = uploadView(saved); requireThat(upload, 404, 'INTAKE_UPLOAD_NOT_FOUND');
        const next = document(verification(observedSnapshot, upload.plan));
        if (upload.verification) requireThat(saved.verification_hash === next.hash, 409, 'INTAKE_UPLOAD_CONFLICT');
        else {
          await tx.$executeRawUnsafe('UPDATE atlas_manual_intake.upload SET verification=$1,verification_hash=$2 WHERE card_id=$3::uuid AND id=$4::uuid',
            next.text, next.hash, cardId, uploadId);
          if (row[`${upload.side.toLowerCase()}_upload_id`] === uploadId) await tx.$executeRawUnsafe(
            'UPDATE atlas_manual_intake.card SET revision=revision+1,updated_at=clock_timestamp() WHERE id=$1::uuid', cardId);
        }
        await assertIngestionLease(tx, row, uploadId, lease);
        return { card: await view(tx, await cardRow(tx, cardId)), upload: uploadView(await uploadRow(tx, cardId, uploadId)) };
      });
    },
    async recordSource(staff, cardId, uploadId, { verificationHash, source }, { lease = null } = {}) {
      uuid(uploadId); hash(verificationHash); const next = document(source);
      return mutate(staff, cardId, async (tx, row, principal) => {
        await assertIngestionLease(tx, row, uploadId, lease);
        const saved = await uploadRow(tx, cardId, uploadId), upload = uploadView(saved); requireThat(upload, 404, 'INTAKE_UPLOAD_NOT_FOUND');
        requireThat(saved.verification_hash === verificationHash, 409, 'INTAKE_UPLOAD_CONFLICT');
        if (upload.source) requireThat(saved.source_hash === next.hash, 409, 'INTAKE_SOURCE_CONFLICT');
        else {
          await tx.$executeRawUnsafe('UPDATE atlas_manual_intake.upload SET source=$1,source_hash=$2 WHERE card_id=$3::uuid AND id=$4::uuid',
            next.text, next.hash, cardId, uploadId);
          if (row[`${upload.side.toLowerCase()}_upload_id`] === uploadId) await tx.$executeRawUnsafe(
            'UPDATE atlas_manual_intake.card SET revision=revision+1,updated_at=clock_timestamp() WHERE id=$1::uuid', cardId);
        }
        // A normal saved-photo retry can finish after the worker has already
        // stopped with ATTENTION. Resolve only that current, unclaimed intent
        // in the same transaction as source and admission hooks. Active workers
        // retain their lease and historical/replaced uploads retain their state.
        if (includeIngestionStatus && !lease && row[`${upload.side.toLowerCase()}_upload_id`] === uploadId) {
          await tx.$executeRawUnsafe(`UPDATE atlas_manual_intake.ingestion
            SET state='COMPLETE',stage='ADMIT',code=NULL,failures=0,updated_at=clock_timestamp()
            WHERE upload_id=$1::uuid AND card_id=$2::uuid AND owner_id=$3::uuid AND access_version=$4
              AND state='ATTENTION' AND claim_id IS NULL AND lease_until IS NULL`,
          uploadId, cardId, principal.id, principal.accessVersion);
        }
        const card = await view(tx, await cardRow(tx, cardId));
        if (sourceCommitted) await sourceCommitted({ tx, principal, cardId, uploadId, card });
        if (card.ready && pairCommitted) await pairCommitted({ tx, principal, card });
        await assertIngestionLease(tx, row, uploadId, lease);
        return { card, upload: uploadView(await uploadRow(tx, cardId, uploadId)) };
      });
    },
    /** Trusted manual-service commit hook, inside that SAME authenticated tx.
     * SHARE conflicts with photo selection/completion UPDATE through commit.
     * No external work is permitted here. Existing manual auth refresh fences
     * expiry after the wait. Holding two unrelated card locks is unnecessary.
     */
    async assertCurrentPair(tx, principal, { cardId, sourceHash }) {
      uuid(cardId); hash(sourceHash);
      const row = await cardRow(tx, cardId, 'SHARE'); requireOwner(row, principal, true); await assertNotDiscarded(tx, row);
      const card = await view(tx, row);
      requireThat(card.ready && card.sourceHash === sourceHash, 409, 'INTAKE_PAIR_STALE'); return card;
    },
  });
}

/** Apply only to the separate restricted manual-serving role after review. */
export function intakeGrantSQL(role) {
  requireThat(/^[a-z][a-z0-9_]{0,62}$/.test(role));
  return `GRANT USAGE ON SCHEMA atlas_manual_intake TO "${role}";
GRANT SELECT, INSERT ON atlas_manual_intake.card,atlas_manual_intake.upload,atlas_manual_intake.discard_request,atlas_manual_intake.discarded_card TO "${role}";
GRANT USAGE ON SCHEMA atlas_dealer,atlas_manual_connected TO "${role}";
GRANT SELECT ON atlas_manual.publication,atlas_dealer.manual_card_link,atlas_manual_connected.station_arm,atlas_manual_connected.station_active TO "${role}";
GRANT UPDATE (revision,front_version,back_version,front_upload_id,back_upload_id,updated_at) ON atlas_manual_intake.card TO "${role}";
GRANT UPDATE (verification,verification_hash,source,source_hash) ON atlas_manual_intake.upload TO "${role}";`;
}

/** Additive queue grants kept separate for old-schema upgrade rehearsals. */
export function ingestionGrantSQL(role) {
  requireThat(/^[a-z][a-z0-9_]{0,62}$/.test(role));
  return `GRANT SELECT ON atlas_manual_intake.ingestion TO "${role}";
GRANT UPDATE(stage,state,claim_id,lease_until,attempts,failures,available_at,last_claimed_at,code,updated_at)
ON atlas_manual_intake.ingestion TO "${role}";`;
}
