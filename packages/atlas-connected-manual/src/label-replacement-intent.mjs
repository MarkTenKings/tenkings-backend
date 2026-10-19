import { canonical, digest, requireThat, uuid } from '@atlas/manual-service/contract';

export const LABEL_REFRESH_REASON = 'Refresh approved label layout';
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const targetFor = item => ({ rendererProfileHash: item.renderer_profile_hash,
  materialProfileId: item.material_profile_id, jigHash: item.jig_hash });
const validTarget = target => validHash(target?.rendererProfileHash) && validHash(target?.jigHash)
  && typeof target.materialProfileId === 'string' && target.materialProfileId.length > 0 && target.materialProfileId.length <= 200;

export function labelRefreshRequestId(itemId, expectedLabelHash, target) {
  uuid(itemId); requireThat(validHash(expectedLabelHash) && validTarget(target), 400, 'LABEL_REFRESH_TARGET_INVALID');
  const key = digest(canonical({ operation: 'label-layout-refresh-request/v1', itemId, expectedLabelHash, target }));
  return `${key.slice(0,8)}-${key.slice(8,12)}-4${key.slice(13,16)}-${((parseInt(key[16],16)&3)|8).toString(16)}${key.slice(17,20)}-${key.slice(20,32)}`;
}

export function labelRefreshRequestHash(itemId, input, target) {
  return digest(canonical({ operation: 'label-layout-refresh/v1', itemId, requestId: input.requestId,
    expectedLabelHash: input.expectedLabelHash, reason: LABEL_REFRESH_REASON, target }));
}

// The immutable request hash commits to the operation and the complete target.
// A reason or a partially populated attempt profile is never a mode discriminator:
// ordinary reprints may already have attempted-profile fields after a crash.
export function labelReplacementIntent(item, original) {
  requireThat(item.purpose === 'REPRINT' && item.original_item_id === original.id && original.state === 'READY'
    && typeof original.snapshot === 'string' && digest(original.snapshot) === original.snapshot_hash
    && typeof original.print_svg === 'string' && digest(original.print_svg) === original.artwork_hash
    && ['actor_id','card_id','action_id','approval_version','source_revision','source_hash','report_hash','public_hash']
      .every(key => item[key] === original[key]), 409, 'LABEL_REPRINT_SOURCE_INVALID');
  const input = { requestId: item.request_id, expectedLabelHash: original.artwork_hash };
  const copyHash = digest(canonical({ itemId: original.id, ...input, reason: item.reason }));
  if (item.request_hash === copyHash) return { kind: 'COPY' };
  const target = targetFor(item);
  requireThat(validTarget(target) && item.reason === LABEL_REFRESH_REASON
    && ['ORIGINAL','LAYOUT_RETRY'].includes(original.purpose)
    && original.renderer_profile_hash !== target.rendererProfileHash
    && item.request_id === labelRefreshRequestId(original.id, original.artwork_hash, target)
    && item.request_hash === labelRefreshRequestHash(original.id, input, target), 409, 'LABEL_REPLACEMENT_INTENT_INVALID');
  return { kind: 'REFRESH', target };
}

export function assertLabelRefreshSnapshot(original, packet) {
  requireThat(typeof original.snapshot === 'string' && digest(original.snapshot) === original.snapshot_hash, 409, 'LABEL_REPRINT_SOURCE_INVALID');
  const saved = JSON.parse(original.snapshot), report = packet.report;
  requireThat(canonical(saved.identity) === canonical(report.identity)
    && saved.grade === report.finalGrade && saved.finalGrade === report.finalGrade
    && saved.cardProfile === report.cardProfile && saved.reportNumber === packet.reportNumber
    && saved.approvalVersion === packet.approvalVersion
    && saved.reportHref === `https://atlasgrading.com/reports/${packet.publicToken}?v=${packet.approvalVersion}`,
  409, 'LABEL_REFRESH_SOURCE_CHANGED');
}
