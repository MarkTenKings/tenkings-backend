import { digest, requireThat } from '@atlas/manual-service/contract';
import { parseReportPresentation } from '@atlas/report-view/presentation-contract';

const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const TOKEN = /^ar_[A-Za-z0-9_-]{24}$/;
const matches = (pattern, value) => typeof value === 'string' && pattern.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;

/** Read-only archive projection. The caller authenticates card access and must
 * select labelItem with actor_id = the authenticated principal (the retained
 * artwork endpoint has that narrower scope). This function performs no storage
 * reads, rendering, provider dispatch or new publication.
 *
 * The report image endpoint verifies immutable approved bytes on every read.
 * Those rectified grading photographs are NOT the full-resolution intake
 * originals, a finished-holder photograph, or evidence of physical slabbing.
 */
export function archiveApprovedMedia({ cardId, approvalActionId, publicToken, approvalVersion,
  publicationState, publicHash, reportHash, sourceRevision, sourceHash,
  labelItem = null, presentation = null }) {
  if (publicationState !== 'PUBLISHED') return {};
  requireThat(matches(UUID, cardId) && matches(UUID, approvalActionId)
    && matches(TOKEN, publicToken) && positive(approvalVersion) && positive(sourceRevision)
    && [publicHash, reportHash, sourceHash].every(value => matches(HASH, value)),
  503, 'ARCHIVE_MEDIA_BINDING_INVALID');

  const media = Object.fromEntries(['FRONT', 'BACK'].map(side => [side, {
    url: `/api/reports/${publicToken}/images/${side}?v=${approvalVersion}`,
    provenance: 'APPROVED_GRADING_PHOTOGRAPH',
  }]));

  // Optional presentation corruption or old bindings cannot substitute another
  // card's image, and cannot hide the independently approved Front/Back pair.
  if (presentation?.card_id === cardId && presentation.approval_action_id === approvalActionId
    && positive(presentation.revision) && typeof presentation.presentation === 'string'
    && Buffer.byteLength(presentation.presentation) <= 2 * 1024 * 1024
    && matches(HASH, presentation.presentation_hash)
    && digest(presentation.presentation) === presentation.presentation_hash) {
    try {
      const value = parseReportPresentation(JSON.parse(presentation.presentation), { publicToken, approvalVersion, publicHash });
      const photo = value.slabPhoto;
      if (value.revision === presentation.revision && photo?.contentType === 'image/webp') {
        media.SLAB = { url: photo.url, provenance: 'ACTUAL_SLAB_PHOTOGRAPH', sha256: photo.sha256,
          byteCount: photo.byteCount, contentType: photo.contentType, width: photo.width, height: photo.height,
          alt: photo.alt, presentationRevision: value.revision };
      }
    } catch { /* Omit unverified ancillary presentation; no fallback fabrication. */ }
  }

  const label = labelItem;
  if (label?.state === 'READY' && label.current !== false && matches(UUID, label.id)
    && label.card_id === cardId && label.action_id === approvalActionId
    && label.approval_version === approvalVersion && label.source_revision === sourceRevision
    && label.source_hash === sourceHash && label.report_hash === reportHash && label.public_hash === publicHash
    && matches(HASH, label.artwork_hash) && matches(HASH, label.renderer_profile_hash)
    && typeof label.material_profile_id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(label.material_profile_id)) {
    media.LABEL = { url: `/admin/api/staff/manual-connected/labels/${label.id}/artwork?mode=preview`,
      provenance: 'REPORT_BOUND_LABEL_ARTWORK', itemId: label.id, artworkHash: label.artwork_hash,
      rendererProfileHash: label.renderer_profile_hash, materialProfileId: label.material_profile_id };
    // artworkHash binds retained print_svg, not the different preview bytes.
    // READY records rendering, not a separate human artwork approval or print.
  }
  return media;
}
