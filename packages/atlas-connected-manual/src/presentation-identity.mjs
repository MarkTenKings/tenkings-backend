import { canonical, digest } from '@atlas/manual-service/contract';
import { approvedPublicationSource } from './publication-repository.mjs';
import { gradingIdentity } from './details.mjs';

/** Read-only enrichment from the exact intake details used by this approval.
 * Historical reports with unavailable or subsequently divergent details simply
 * retain their original identity. Never consult an unapproved current draft.
 */
export function approvedIdentityDetails(row, packet, publication) {
  try {
    if (!row || row.card_id !== publication.card_id || row.action_id !== publication.action_id
      || row.report_hash !== packet.reportHash || digest(row.details_content) !== row.details_content_hash) return null;
    const { approval, draft } = approvedPublicationSource(row), details = JSON.parse(row.details_content);
    if (!Number.isSafeInteger(draft.source?.detailsRevision) || row.details_revision !== draft.source.detailsRevision
      || !/^[a-f0-9]{64}$/.test(draft.source?.sourceHash ?? '') || details.sourceHash !== draft.source.sourceHash
      || canonical(approval.identity) !== canonical(packet.report.identity)
      || canonical(gradingIdentity(details)) !== canonical(packet.report.identity)
      || details.profile !== packet.report.cardProfile) return null;
    const fields = details.fields;
    const entries = [['category', fields.category], ['manufacturer', fields.manufacturer], ['variant', fields.variant], ['cardType', fields.card_type]]
      .filter(([, value]) => typeof value === 'string' && value.trim().length > 0);
    return entries.length ? Object.fromEntries(entries) : null;
  } catch { return null; }
}

export async function readApprovedIdentityDetails({ client, publication, packet }) {
  try {
    const rows = await client.$transaction(tx => tx.$queryRawUnsafe(`SELECT a.*,j.result,
      d.revision AS details_revision,d.content AS details_content,d.content_hash AS details_content_hash
      FROM atlas_manual.approval a JOIN atlas_manual.action j USING(card_id,action_id)
      JOIN atlas_manual_connected.details d ON d.card_id=a.card_id
      WHERE a.card_id=$1::uuid AND a.action_id=$2::uuid`, publication.card_id, publication.action_id), { maxWait: 1500, timeout: 3000 });
    return rows.length === 1 ? approvedIdentityDetails(rows[0], packet, publication) : null;
  } catch { return null; }
}
