import { canonical, digest, requireThat, uuid } from '@atlas/manual-service/contract';

export async function recordEarlyGeometryIntent({ tx, principal, cardId, uploadId }) {
  await tx.$executeRawUnsafe(`INSERT INTO atlas_manual_connected.early_geometry_intent(upload_id,card_id,actor_id,access_version)
    VALUES($1::uuid,$2::uuid,$3::uuid,$4) ON CONFLICT(upload_id) DO UPDATE SET access_version=EXCLUDED.access_version
    WHERE early_geometry_intent.actor_id=EXCLUDED.actor_id AND early_geometry_intent.access_version<>EXCLUDED.access_version`,
  uploadId, cardId, principal.id, principal.accessVersion);
}

export function parseGeometryJob(row) {
  if (!row) return null;
  requireThat(typeof row.input === 'string' && digest(row.input) === row.key, 503, 'GEOMETRY_STORED_CONTENT_INVALID');
  const input = JSON.parse(row.input);
  requireThat(input.cardId === row.card_id && input.uploadId === row.upload_id && input.side === row.side
    && digest(canonical(input.engine)) === row.engine_hash, 503, 'GEOMETRY_STORED_CONTENT_INVALID');
  return { key: row.key, input, state: row.state, attempts: row.attempts,
    claimId: row.claim_id, result: row.result ? JSON.parse(row.result) : null, error: row.error };
}

/** Authenticated scheduling and readback are separate from the narrowly scoped
 * durable worker claim/finish functions. Neither capability writes a draft. */
export function createEarlyGeometryStore({ boundary, intakeRepository, receiptClient }) {
  const workerQuery = async (...args) => {
    requireThat(typeof receiptClient?.$transaction === 'function', 503, 'GEOMETRY_WORKER_UNAVAILABLE');
    return receiptClient.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '1500ms'");
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '3000ms'");
      return tx.$queryRawUnsafe(...args);
    }, { maxWait: 3000, timeout: 5000 });
  };
  async function authorized(staff, cardId, work, edit = false) {
    return boundary.transaction(staff, async ({ tx, principal }) => {
      const card = await intakeRepository.authorizeInTransaction(tx, principal, cardId, { edit, lock: edit ? 'UPDATE' : '' });
      return work(tx, principal, card);
    });
  }
  return Object.freeze({
    async intent(staff, cardId, uploadId) {
      return authorized(staff, cardId, async (tx, principal, card) => {
        requireThat(Object.values(card.sides).some(side => side.upload?.uploadId === uploadId && side.upload.source), 409, 'GEOMETRY_PHOTO_CHANGED');
        await recordEarlyGeometryIntent({ tx, principal, cardId, uploadId });
      }, true);
    },
    async ensure(staff, input, { retry = false } = {}) {
      const text = canonical(input, { maxBytes: 32768 }), key = digest(text);
      return authorized(staff, input.cardId, async (tx, principal, card) => {
        const upload = card.sides[input.side]?.upload;
        requireThat(upload?.uploadId === input.uploadId && canonical(upload.source) === canonical(input.photoSource), 409, 'GEOMETRY_PHOTO_CHANGED');
        await recordEarlyGeometryIntent({ tx, principal, cardId: input.cardId, uploadId: input.uploadId });
        const rows = await tx.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.early_geometry WHERE key=$1 FOR UPDATE', key);
        if (!rows.length) {
          const [count] = await tx.$queryRawUnsafe("SELECT count(*)::int AS count FROM atlas_manual_connected.early_geometry WHERE actor_id=$1::uuid AND state IN ('QUEUED','RUNNING')", principal.id);
          requireThat(count.count < 32, 429, 'GEOMETRY_QUEUE_FULL');
          await tx.$executeRawUnsafe(`INSERT INTO atlas_manual_connected.early_geometry(key,card_id,upload_id,side,actor_id,access_version,engine_hash,input)
            VALUES($1,$2::uuid,$3::uuid,$4,$5::uuid,$6,$7,$8) ON CONFLICT DO NOTHING`,
          key, input.cardId, input.uploadId, input.side, principal.id, principal.accessVersion, digest(canonical(input.engine)), text);
        } else if (retry || rows[0].access_version !== principal.accessVersion) {
          requireThat(retry || rows[0].actor_id === principal.id, 409, 'GEOMETRY_RETRY_STALE');
          if (retry) requireThat(['FAILED','NEEDS_REVIEW'].includes(rows[0].state), 409, 'GEOMETRY_RETRY_STALE');
          await tx.$executeRawUnsafe(`UPDATE atlas_manual_connected.early_geometry SET state='QUEUED',result=NULL,error=NULL,claim_id=NULL,lease_until=NULL,
            access_version=$2,attempts=0,updated_at=clock_timestamp() WHERE key=$1`, key, principal.accessVersion);
        }
        return parseGeometryJob((await tx.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.early_geometry WHERE key=$1', key))[0]);
      }, true);
    },
    async read(staff, cardId, key) {
      return authorized(staff, cardId, async tx => parseGeometryJob((await tx.$queryRawUnsafe(
        'SELECT * FROM atlas_manual_connected.early_geometry WHERE card_id=$1::uuid AND key=$2', cardId, key))[0]));
    },
    async claim(engineHash, claimId) {
      uuid(claimId); requireThat(receiptClient, 503, 'GEOMETRY_WORKER_UNAVAILABLE');
      return parseGeometryJob((await workerQuery('SELECT * FROM atlas_manual_connected.claim_early_geometry($1,$2::uuid)', engineHash, claimId))[0]);
    },
    async pending(engineHash, cursor = null) {
      requireThat(receiptClient, 503, 'GEOMETRY_WORKER_UNAVAILABLE');
      return workerQuery('SELECT * FROM atlas_manual_connected.pending_early_geometry($1,$2::timestamptz,$3::uuid)',
        engineHash, cursor?.createdAt ?? null, cursor?.uploadId ?? null);
    },
    async stage(input) {
      const [row] = await workerQuery('SELECT atlas_manual_connected.queue_early_geometry($1) AS queued', canonical(input, { maxBytes: 32768 }));
      return row?.queued === true;
    },
    async finish(job, state, result = null, error = null) {
      const [row] = await workerQuery('SELECT atlas_manual_connected.finish_early_geometry($1,$2::uuid,$3,$4,$5) AS committed',
        job.key, job.claimId, state, result ? canonical(result, { maxBytes: 32768 }) : null, error);
      return row?.committed === true;
    },
  });
}

export function earlyGeometryGrantSQL(role) {
  requireThat(/^[a-z][a-z0-9_]{0,62}$/.test(role));
  return `GRANT SELECT,INSERT ON atlas_manual_connected.early_geometry TO "${role}";
GRANT SELECT,INSERT ON atlas_manual_connected.early_geometry_intent TO "${role}";
GRANT UPDATE(access_version) ON atlas_manual_connected.early_geometry_intent TO "${role}";
GRANT UPDATE(state,result,error,claim_id,lease_until,access_version,attempts,updated_at) ON atlas_manual_connected.early_geometry TO "${role}";
GRANT EXECUTE ON FUNCTION atlas_manual_connected.pending_early_geometry(text,timestamptz,uuid),atlas_manual_connected.queue_early_geometry(text),atlas_manual_connected.claim_early_geometry(text,uuid),atlas_manual_connected.finish_early_geometry(text,uuid,text,text,text) TO "${role}";`;
}
