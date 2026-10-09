import { reportPresentationSchema } from './presentation-contract.mjs';

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
