export function reportInspectionPreview(descriptor, expectedHash) {
  const value = descriptor?.preview;
  if (descriptor?.sha256 !== expectedHash || !value || value.sourceSha256 !== expectedHash
    || value.policyVersion !== 'atlas-inspection-preview-v1' || value.mime !== 'image/jpeg'
    || !/^[a-f0-9]{64}$/.test(value.sha256) || typeof value.url !== 'string'
    || !Number.isSafeInteger(value.byteCount) || value.byteCount < 1 || value.byteCount > 1024 * 1024
    || !Number.isSafeInteger(value.width) || !Number.isSafeInteger(value.height)
    || value.width < 1 || value.height < 1 || Math.max(value.width, value.height) > 768
    || Math.abs(value.width * 1858 - value.height * 1350) > 1858) return null;
  return value;
}

export function inspectionLoadingText(progress, previewReady) {
  const lead = previewReady ? 'Preview · loading full detail' : 'Loading full detail';
  if (progress?.phase === 'VERIFYING') return 'Checking full-detail photograph…';
  return progress?.totalBytes > 0
    ? `${lead}… ${Math.min(100, Math.round(100 * progress.loadedBytes / progress.totalBytes))}%`
    : `${lead}…`;
}
