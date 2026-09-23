import { canonical, digest, object, requireThat, uuid } from '@atlas/manual-service/contract';
import { parsePublicManualReport } from '@atlas/report-view/manual-public-contract';
import { createManualFinishingPlan } from '@atlas/finishing/manual';
import { approvedPublicationSource } from './publication-repository.mjs';

// Read-only adapter for current manual approvals. The existing authenticated
// publication repository owns current card access; artifact storage owns exact
// immutable content/lineage verification. No legacy StaffSpecimen substitution.
export function createManualFinishing({ repository, artifacts, timeoutMs = 20000 }) {
  requireThat(repository?.load && artifacts?.read && Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 20000,
    500, 'MANUAL_FINISHING_CONFIGURATION_INVALID');
  async function loadPacket(staff, cardId, actionId) {
    uuid(cardId); uuid(actionId);
    const signal = AbortSignal.timeout(timeoutMs), row = await repository.load(staff, cardId, actionId);
    requireThat(row.card_id === cardId && row.action_id === actionId && row.state === 'PUBLISHED', 409, 'MANUAL_FINISHING_PUBLICATION_REQUIRED');
    const { approval } = approvedPublicationSource(row);
    requireThat(digest(row.manifest) === row.manifest_hash, 503, 'MANUAL_FINISHING_SOURCE_INVALID');
    const manifest = JSON.parse(row.manifest);
    object(manifest, ['version', 'packet', 'media', 'publicHash']);
    requireThat(manifest.version === 'atlas-manual-publication-manifest-v1' && manifest.publicHash === row.public_hash
      && manifest.packet?.ref?.sha256 === row.public_hash && manifest.packet.sourceHash === row.public_hash,
    503, 'MANUAL_FINISHING_SOURCE_INVALID');
    const raw = await artifacts.read(manifest.packet.ref, { cardId, kind: 'PUBLIC_REPORT', sourceHash: manifest.packet.sourceHash }, { signal });
    requireThat(digest(JSON.stringify(raw)) === row.public_hash, 503, 'MANUAL_FINISHING_SOURCE_INVALID');
    const packet = parsePublicManualReport(raw), report = packet.report;
    requireThat(packet.publicToken === row.public_token && packet.reportNumber === row.report_number && packet.approvalVersion === row.version
      && packet.reportHash === row.report_hash && packet.mode === row.mode
      && packet.approvedAt === new Date(row.approved_at).toISOString() && digest(JSON.stringify(packet)) === row.public_hash
      && approval.version === 'atlas-manual-report-snapshot-v2'
      && ['identity', 'grade', 'finalGrade', 'finalGradePolicy', 'ruleVersion'].every(key => canonical(approval[key]) === canonical(report[key])),
    503, 'MANUAL_FINISHING_APPROVAL_MISMATCH');
    signal.throwIfAborted();
    // Access may be revoked while storage is in flight. Reauthenticate without
    // holding a DB transaction open across object storage.
    const after = await repository.load(staff, cardId, actionId);
    requireThat(['card_id', 'action_id', 'state', 'version', 'mode', 'manifest_hash', 'public_hash', 'source_hash', 'report_hash']
      .every(key => row[key] === after[key]), 409, 'MANUAL_FINISHING_PUBLICATION_CHANGED');
    signal.throwIfAborted();
    // This source is private service composition only. HTTP callers receive
    // load()'s allowlisted plan, never the approval/storage repository row.
    return { packet, publicHash: row.public_hash, row };
  }
  return Object.freeze({ loadPacket, async load(staff, cardId, actionId) {
    const { packet, publicHash, row } = await loadPacket(staff, cardId, actionId);
    return createManualFinishingPlan({ cardId, approvalActionId: actionId, sourceRevision: row.source_revision,
      sourceHash: row.source_hash, packet, publicHash });
  } });
}
