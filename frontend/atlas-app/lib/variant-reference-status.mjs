/** Display only explicit source scope when the saved choices span releases. */
export function variantSourceReleaseDetails(candidates = []) {
  const releases = candidates.flatMap(candidate => {
    const release = candidate.source?.release;
    if (!release || !['manufacturer', 'year', 'setName'].every(key => typeof release[key] === 'string' && release[key].trim())
      || !Array.isArray(release.sports) || !release.sports.length || !release.sports.every(sport => typeof sport === 'string' && sport.trim())) return [];
    const sports = [...new Set(release.sports)].sort();
    return [{ candidateId: candidate.candidateId, key: JSON.stringify([release.manufacturer, sports, release.year, release.setName]),
      text: `${release.manufacturer} · ${release.setName} · ${sports.join(', ')} · ${release.year}` }];
  });
  if (new Set(releases.map(release => release.key)).size < 2) return new Map();
  return new Map(releases.map(release => [release.candidateId, release.text]));
}

/** Read-only notices for retained reference outcomes. No requests or decisions. */
export function variantReferenceNotices(status) {
  const catalog = status?.result?.catalog;
  if (!catalog) return [];
  const problems = new Set(catalog.problems ?? []), notices = [];
  const add = (code, text) => { if (problems.has(code)) notices.push({ code, text }); };
  add('CHECKLIST_SCOPE_NOT_RETAINED', 'No retained checklist covers this manufacturer, product and year scope yet. This does not establish that the card or variant is absent.');
  add('CHECKLIST_CARD_NOT_FOUND', 'The retained checklist scope has no matching athlete and printed card number for this request. Its coverage may be incomplete.');
  add('CHECKLIST_SCOPE_AMBIGUOUS', 'The saved checklist matches more than one product or sport. Review the source details before choosing a printing.');
  add('CHECKLIST_SEASON_AMBIGUOUS', 'More than one retained season fits the abbreviated year. Verify the full season on your card.');
  add('IDENTITY_INCOMPLETE', 'Some saved identity details needed for reference matching are missing.');
  add('PROVIDER_NOT_SUPPORTED', 'A reference source could not resolve this identity scope. Keep it for review if the physical card does not resolve it.');
  if (['PROVIDER_UNAVAILABLE', 'CATALOG_UNAVAILABLE'].some(code => problems.has(code))) {
    notices.push({ code: 'REFERENCE_SOURCE_UNAVAILABLE', text: 'A catalog source could not be read. Available saved references remain visible; this is not a completed no-match result.' });
  }
  add('LISTING_SOURCE_NOT_CONFIGURED', 'Listing reference search is unavailable in this configuration. Saved catalog choices remain available.');
  add('LISTING_SOURCE_UNAVAILABLE', 'A listing source could not be read or processed. Any saved photographs remain available.');
  add('LISTING_SOURCE_OUTCOME_UNKNOWN', 'A listing request has an unknown saved outcome. This does not establish that no listings exist.');
  add('LISTING_NO_RESULTS', 'A saved listing search returned no listings. Other searches or retained photographs may still provide references.');
  add('LISTING_IMAGES_INCOMPLETE', 'Some returned listings have no saved usable photograph. This is different from a search returning no listings.');
  if (['PROVIDER_TRUNCATED', 'CATALOG_TRUNCATED'].some(code => problems.has(code))) {
    notices.push({ code: 'REFERENCE_RESULTS_PARTIAL', text: 'The reference result is partial. Additional choices may be absent from this saved result.' });
  }
  const labels = status.result.referenceLabels;
  const readings = labels?.version === 'atlas-slab-label-associations/v1'
    && labels.catalogHash === catalog.snapshotHash && Array.isArray(labels.readings) ? labels.readings : [];
  const candidates = new Set((catalog.candidates ?? []).map(candidate => candidate.candidateId));
  const seen = new Set(); let awaiting = 0, unreadable = 0, unassociated = 0;
  for (const image of catalog.referencePhotos ?? []) {
    if (seen.has(image.sha256)) continue;
    seen.add(image.sha256);
    const reading = readings.find(value => value.sha256 === image.sha256 && value.imageId === image.imageId);
    if (!reading) awaiting++;
    else if (!reading.labelText) unreadable++;
    else if (!reading.candidateId || !candidates.has(reading.candidateId)) unassociated++;
  }
  const count = (value, singular, plural) => `${value} ${value === 1 ? singular : plural}`;
  if (awaiting) notices.push({ code: 'REFERENCE_READING_NOT_SAVED', text: `${count(awaiting, 'saved reference photograph has', 'saved reference photographs have')} no saved reading for this catalog yet.` });
  if (unreadable) notices.push({ code: 'REFERENCE_TEXT_UNREADABLE', text: `${count(unreadable, 'saved photograph was', 'saved photographs were')} checked without readable card or slab-label text. The photographs remain available for comparison.` });
  if (unassociated) notices.push({ code: 'REFERENCE_TEXT_UNASSOCIATED', text: `${count(unassociated, 'saved photograph has', 'saved photographs have')} readable text but no unique assigned catalog printing. Compare the retained text and photograph with your card.` });
  return notices;
}
