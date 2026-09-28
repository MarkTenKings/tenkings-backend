import { requireThat } from '@atlas/manual-service/contract';
import { parseDerivative } from '@atlas/photo-core';

// Preview is optional transport metadata, never an analysis or approval input.
export function inspectionPreviewMedia(preview, inspection, photo) {
  if (!preview) return null;
  requireThat(preview.policyVersion === 'atlas-inspection-preview-v1'
    && preview.sourceSha256 === inspection.raster.content.sha256, 503, 'MANUAL_PREVIEW_BINDING_INVALID');
  const descriptor = parseDerivative(preview.descriptor, photo.workingFrame ?? photo.frame, photo.original, photo.decodePlan);
  const { content, dimensions } = descriptor.raster;
  requireThat(descriptor.purpose === 'preview' && content.mime === 'image/jpeg' && content.byteCount <= 1024 * 1024
    && Math.max(dimensions.width, dimensions.height) <= 768
    && Math.abs(dimensions.width * 1858 - dimensions.height * 1350) <= 1858, 503, 'MANUAL_PREVIEW_BINDING_INVALID');
  return { policyVersion: preview.policyVersion, sourceSha256: preview.sourceSha256, descriptor };
}

export function inspectionPreviewGrant(saved, grant) {
  const { content, dimensions } = saved.descriptor.raster;
  requireThat(grant.sha256 === content.sha256 && grant.byteCount === content.byteCount && grant.mime === content.mime,
    503, 'MANUAL_PREVIEW_BINDING_INVALID');
  return { ...grant, ...dimensions, sourceSha256: saved.sourceSha256, policyVersion: saved.policyVersion };
}
