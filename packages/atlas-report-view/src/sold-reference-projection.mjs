import { reportPresentationSchema } from './presentation-contract.mjs';

// New ATLAS comps use the photographed label. Listing text, links and amounts
// are display metadata; incomplete metadata does not remove a photographed comp.
export function projectSelectedSlabReferences(result, selectedIds, atlasGrade) {
  const invalid = () => { throw new Error('SOLD_REFERENCE_SELECTION_INVALID'); };
  if (result?.responsePolicy !== 'ATLAS_SLAB_V1' || !Array.isArray(result.items)
    || !Array.isArray(result.imageMatch?.readings) || !Array.isArray(selectedIds)
    || new Set(selectedIds).size !== selectedIds.length
    || !Number.isFinite(atlasGrade)) invalid();
  if (!selectedIds.length) return null;
  const schema = reportPresentationSchema.shape.market.unwrap();
  const field = schema.shape.sales.element;
  const optionalUrl = (value, key) => field.shape[key].safeParse(value).success ? value : null;
  const sales = selectedIds.map(id => {
    const items = result.items.filter(item => item.id === id), readings = result.imageMatch.readings.filter(reading => reading.rowId === id);
    if (items.length !== 1 || readings.length !== 1) invalid();
    const item = items[0], reading = readings[0];
    if (!['MATCH', 'UNCERTAIN', 'DIFFERENT'].includes(reading.identityMatch)) invalid();
    const evidenceKind = reading.evidenceKind ?? (Number.isFinite(reading.numericGrade) ? 'SLABBED' : 'UNCERTAIN');
    if (!['RAW', 'SLABBED', 'UNCERTAIN'].includes(evidenceKind)) invalid();
    const raw = evidenceKind === 'RAW';
    const company = raw ? null : String(reading.gradingCompany ?? '').trim().slice(0, 180) || null;
    const grade = !raw && Number.isFinite(reading.numericGrade) ? String(reading.numericGrade) : null;
    const literalLabel = typeof reading.labelText === 'string' ? reading.labelText : '';
    const title = String(item.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 500)
      || literalLabel.replace(/\s+/g, ' ').trim().slice(0, 500) || 'Sold card listing';
    const priceMinor = item.priceBasis === 'EXACT' && Number.isSafeInteger(item.soldPriceCents)
      && item.soldPriceCents >= 0 ? item.soldPriceCents : null;
    const time = item.soldDate == null ? NaN : Date.parse(item.soldDate);
    return { id, title, listingUrl: optionalUrl(item.listingUrl, 'listingUrl'),
      grader: company, grade, raw, rawCondition: raw ? 'Condition not verified' : null, designation: null, evidenceKind,
      matchReason: typeof reading.reason === 'string' ? reading.reason.slice(0, 2000) : null,
      soldAt: Number.isFinite(time) ? new Date(time).toISOString() : null,
      priceMinor, currency: /^[A-Z]{3}$/.test(item.currency ?? '') ? item.currency : null,
      priceBasis: priceMinor !== null ? 'sold' : item.priceBasis === 'UPPER_BOUND' ? 'accepted_offer_unknown' : 'unknown',
      reportedPrice: item.reportedPrice == null ? null : String(item.reportedPrice).slice(0, 500),
      imageUrl: optionalUrl(reading.imageUrl ?? item.imageUrl ?? null, 'imageUrl'),
      labelText: literalLabel.slice(0, 6000), identityStatus: reading.identityMatch === 'UNCERTAIN' ? 'UNKNOWN' : reading.identityMatch };
  }).sort((a, b) => (Date.parse(b.soldAt) || 0) - (Date.parse(a.soldAt) || 0)
    || Math.abs(Number(a.grade) - atlasGrade) - Math.abs(Number(b.grade) - atlasGrade));
  return schema.parse({ observedAt: result.retrievedAt, sales });
}

/** Projects an explicitly selected set from the existing SoldComps engine.
 * The v2.3.0 engine only supplies soldPriceCents for disclosed USD sales with
 * bestOfferAccepted=false. Its null price has several meanings, so neither a
 * currency nor an accepted-offer amount/status may be inferred from that null.
 * This adapter performs no lookup, selection, persistence or valuation.
 */
export function projectSelectedSoldReferences(result, selectedIds) {
  const invalid = () => { throw new Error('SOLD_REFERENCE_SELECTION_INVALID'); };
  if (!result || result.source !== 'EBAY_SOLD' || result.engineVersion !== 'ebay-sold-comps-v2.3.0'
    || !Array.isArray(result.candidates) || !Array.isArray(selectedIds) || selectedIds.length > 60
    || new Set(selectedIds).size !== selectedIds.length) invalid();
  if (!selectedIds.length) return null;
  const sales = selectedIds.map(id => {
    const matches = result.candidates.filter(candidate => candidate.id === id);
    if (matches.length !== 1) invalid();
    const value = matches[0];
    const raw = value.raw === true && value.gradeEvidence?.status === 'RAW';
    const graded = value.raw === false && ['PSA','BGS','SGC','CGC'].includes(value.grader)
      && Number.isFinite(value.numericGrade) && value.numericGrade >= 1 && value.numericGrade <= 10
      && (!value.gradeEvidence || value.gradeEvidence.status === 'GRADED');
    const designation = value.gradeEvidence?.designation;
    const validDesignation = designation == null || designation === 'STANDARD'
      || value.numericGrade === 10 && (designation === 'BLACK_LABEL' && value.grader === 'BGS'
        || designation === 'PRISTINE' && ['BGS', 'CGC'].includes(value.grader)
        || designation === 'PERFECT' && value.grader === 'CGC');
    if (value.source !== 'EBAY_SOLD' || !(raw || graded)
      || !validDesignation || raw && designation != null
      || !Number.isSafeInteger(value.soldPriceCents) || value.soldPriceCents <= 0 || value.soldPriceCents > 2147483647
      || value.parallelMatch === 'CONTRADICTORY' || value.variantEvidence?.status === 'CONTRADICTORY') invalid();
    // The existing engine returns a day, not a time-of-sale. UTC midnight is
    // its date encoding; the report shows the source calendar day only.
    let soldAt = null;
    if (value.soldDate !== null) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value.soldDate)) invalid();
      const date = new Date(`${value.soldDate}T00:00:00.000Z`);
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value.soldDate) invalid();
      soldAt = date.toISOString();
    }
    const observed = value.variantEvidence?.observed;
    const label = values => Array.isArray(values) && values.length ? [...new Set(values)].join(' · ').slice(0, 180) : null;
    return { id: value.id, title: value.title, listingUrl: value.listingUrl, grader: raw ? null : value.grader,
      grade: raw ? null : String(value.numericGrade), soldAt, priceMinor: value.soldPriceCents, currency: 'USD', priceBasis: 'sold',
      ...(value.gradeEvidence ? { raw, rawCondition: raw ? 'Condition not verified' : null,
        designation: raw ? null : value.gradeEvidence.designation ?? null } : {}),
      ...(observed ? { language: label(observed.language), printing: label([...(observed.edition ?? []), ...(observed.stamp ?? [])]),
        variant: label([...(observed.finish ?? []), ...(observed.parallelSignals ?? []), ...(observed.serialDenominators ?? []).map(n => `/${n}`)]),
        identityStatus: value.variantEvidence.status === 'MATCH' && value.identityEvidence?.status === 'MATCH' ? 'MATCH' : 'UNKNOWN' } : {}),
      ...(value.presentationMetadata ? Object.fromEntries(['raw', 'rawCondition', 'designation', 'language', 'printing', 'variant', 'identityStatus']
        .filter(key => Object.hasOwn(value.presentationMetadata, key)).map(key => [key, value.presentationMetadata[key]])) : {}) };
  }).sort((a, b) => (Date.parse(b.soldAt) || 0) - (Date.parse(a.soldAt) || 0));
  return reportPresentationSchema.shape.market.unwrap().parse({ observedAt: result.retrievedAt, sales });
}
