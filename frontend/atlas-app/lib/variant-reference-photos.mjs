/** Saved photographs remain inspectable even when no catalog printing matched.
 * This view never changes an association or uses a seller title as identity. */
export function unmatchedVariantReferences(result) {
  const catalog = result?.catalog;
  if (!Array.isArray(catalog?.referencePhotos)) return [];
  const labels = result.referenceLabels;
  const readings = labels?.version === 'atlas-slab-label-associations/v1'
    && labels.catalogHash === catalog.snapshotHash && Array.isArray(labels.readings) ? labels.readings : [];
  const candidates = new Set((catalog.candidates ?? []).map(candidate => candidate.candidateId));
  const seen = new Set();
  return catalog.referencePhotos.flatMap(image => {
    if (seen.has(image.sha256)) return [];
    seen.add(image.sha256);
    const reading = readings.find(value => value.sha256 === image.sha256 && value.imageId === image.imageId);
    if (reading?.candidateId && candidates.has(reading.candidateId) && reading.labelText && reading.gradingCompany) return [];
    return [{ ...image, associationStatus: 'UNASSIGNED', labelReading: {
      company: reading?.gradingCompany ?? null, text: reading?.labelText ?? null,
      reason: reading?.reason ?? 'No saved label association is available for this photograph.',
    } }];
  });
}
