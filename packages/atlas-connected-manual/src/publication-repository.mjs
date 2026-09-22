import { randomBytes } from 'node:crypto';
import { canonical, digest, requireThat, uuid } from '@atlas/manual-service/contract';

export function publicationGrantSQL(role) {
  requireThat(typeof role === 'string' && /^[a-z][a-z0-9_]{0,62}$/.test(role), 500, 'MANUAL_PUBLICATION_ROLE_INVALID');
  return `GRANT SELECT,INSERT ON atlas_manual.public_report_identity,atlas_manual.publication TO "${role}";\n`
    + `GRANT UPDATE(state,manifest,manifest_hash,public_hash,published_at) ON atlas_manual.publication TO "${role}";\n`
    + `GRANT EXECUTE ON FUNCTION atlas_manual.read_publication(text,integer,text,text,text) TO "${role}";`;
}

const rowSQL = `SELECT p.*,i.public_token,i.report_number,a.actor_id,a.source_revision,a.source_hash,a.report_hash,a.report,a.approved_at,j.result
 FROM atlas_manual.publication p JOIN atlas_manual.public_report_identity i USING(card_id)
 JOIN atlas_manual.approval a USING(card_id,action_id) JOIN atlas_manual.action j USING(card_id,action_id)`;
function access(row, principal, write = false) {
  requireThat(row, 404, 'MANUAL_CARD_NOT_FOUND');
  const approve = row.owner_id === principal.id || row.approvers.includes(principal.id);
  requireThat(approve || row.editors.includes(principal.id) || row.readers.includes(principal.id), 404, 'MANUAL_CARD_NOT_FOUND');
  // Resuming publication is delivery of an already certified immutable report,
  // not a new certification. It still requires current card approval access.
  if (write) requireThat(approve && principal.role === 'REVIEWER', 403, 'MANUAL_CARD_ACCESS_DENIED');
}
export function publicationStatus(row) {
  if (!row) return null;
  const path = `/reports/${row.public_token}?v=${row.version}`;
  return { state: row.state, actionId: row.action_id, reportNumber: row.report_number, version: row.version,
    approvedAt: new Date(row.approved_at).toISOString(), reportHash: row.report_hash,
    ...(row.state === 'PUBLISHED' ? { path, href: `${row.mode === 'PRODUCTION' ? 'https://atlasgrading.com' : 'http://127.0.0.1:4319'}${path}`, publicHash: row.public_hash } : {}),
    retryable: row.state === 'PENDING' };
}
export function approvedPublicationSource(row) {
  requireThat(row && digest(row.report) === row.report_hash, 503, 'MANUAL_PUBLICATION_CORRUPT');
  const approval = JSON.parse(row.report), result = JSON.parse(row.result), draft = result.card?.draft;
  requireThat(draft && digest(canonical(draft)) === row.source_hash && result.card.contentHash === row.source_hash
    && result.card.cardId === row.card_id && result.receipt.actionId === row.action_id
    && result.receipt.actorId === row.actor_id && result.receipt.approval.reportHash === row.report_hash
    && result.receipt.approval.sourceHash === row.source_hash && result.receipt.approval.sourceRevision === row.source_revision,
  503, 'MANUAL_PUBLICATION_CORRUPT');
  return { approval, draft };
}
export function createPublicationRepository({ boundary }) {
  async function card(tx, principal, cardId, write) {
    const [row] = await tx.$queryRawUnsafe('SELECT * FROM atlas_manual.card WHERE id=$1::uuid FOR SHARE', cardId);
    access(row, principal, write);
  }
  return Object.freeze({
    async approvalCommitted({ tx, principal, cardId, actionId }) {
      // Caller holds the manual card FOR UPDATE; version assignment is serialized.
      await tx.$executeRawUnsafe(`INSERT INTO atlas_manual.public_report_identity(card_id,public_token,report_number)
        VALUES($1::uuid,$2,$3) ON CONFLICT(card_id) DO NOTHING`, cardId, `ar_${randomBytes(18).toString('base64url')}`, `ATLAS-${randomBytes(6).toString('hex').toUpperCase()}`);
      await tx.$executeRawUnsafe(`INSERT INTO atlas_manual.publication(card_id,action_id,version,mode)
        SELECT $1::uuid,$2::uuid,COALESCE(MAX(version),0)+1,$3 FROM atlas_manual.publication WHERE card_id=$1::uuid`, cardId, actionId, principal.mode);
    },
    async status(staff, cardId, actionId = null) {
      uuid(cardId); if (actionId) uuid(actionId);
      return boundary.transaction(staff, async ({ tx, principal }) => {
        await card(tx, principal, cardId, false);
        const [row] = await tx.$queryRawUnsafe(`${rowSQL} WHERE p.card_id=$1::uuid ${actionId ? 'AND p.action_id=$2::uuid' : 'ORDER BY p.version DESC LIMIT 1'}`, cardId, ...(actionId ? [actionId] : []));
        return publicationStatus(row);
      });
    },
    async load(staff, cardId, actionId) {
      uuid(cardId); uuid(actionId);
      return boundary.transaction(staff, async ({ tx, principal }) => {
        await card(tx, principal, cardId, true);
        const [row] = await tx.$queryRawUnsafe(`${rowSQL} WHERE p.card_id=$1::uuid AND p.action_id=$2::uuid`, cardId, actionId);
        requireThat(row, 404, 'MANUAL_PUBLICATION_NOT_FOUND'); approvedPublicationSource(row); return row;
      });
    },
    async complete(staff, before, manifest) {
      const document = canonical(manifest), hash = digest(document);
      return boundary.transaction(staff, async ({ tx, principal, refresh }) => {
        await card(tx, principal, before.card_id, true);
        const [row] = await tx.$queryRawUnsafe(`${rowSQL} WHERE p.card_id=$1::uuid AND p.action_id=$2::uuid FOR UPDATE OF p`, before.card_id, before.action_id);
        requireThat(row && row.report_hash === before.report_hash && row.source_hash === before.source_hash, 409, 'MANUAL_PUBLICATION_CHANGED');
        if (row.state === 'PUBLISHED') {
          requireThat(row.manifest_hash === hash, 409, 'MANUAL_PUBLICATION_CONFLICT'); return publicationStatus(row);
        }
        requireThat(row.state === 'PENDING' && manifest.packet.ref.sha256 === manifest.publicHash, 409, 'MANUAL_PUBLICATION_INVALID');
        const updated = await tx.$executeRawUnsafe(`UPDATE atlas_manual.publication SET state='PUBLISHED',manifest=$1,manifest_hash=$2,public_hash=$3,published_at=clock_timestamp()
          WHERE card_id=$4::uuid AND action_id=$5::uuid AND state='PENDING'`, document, hash, manifest.publicHash, before.card_id, before.action_id);
        requireThat(updated === 1, 409, 'MANUAL_PUBLICATION_CHANGED');
        const current = await refresh(); await card(tx, current.principal, before.card_id, true);
        return publicationStatus({ ...row, state: 'PUBLISHED', public_hash: manifest.publicHash });
      });
    },
  });
}
