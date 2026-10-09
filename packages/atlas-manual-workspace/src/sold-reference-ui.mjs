// Presentation only. These groups preserve the source's company, condition and
// identity evidence; they neither convert grades nor calculate a card value.
const word = value => typeof value === 'string' && value.trim() ? value.trim() : null;
const designationLabel = value => ({ STANDARD: 'Standard', BLACK_LABEL: 'Black Label', PRISTINE: 'Pristine', PERFECT: 'Perfect' })[value] ?? word(value) ?? '';
export function saleGradeLabel(sale) {
  if (sale.raw === true) return `Ungraded${word(sale.rawCondition) ? ` · ${sale.rawCondition}` : ' · Condition unspecified'}`;
  return [word(sale.grader) ?? 'Grader unspecified', word(String(sale.grade ?? '')) ?? 'Grade unspecified', sale.designation == null && ['BGS', 'CGC'].includes(sale.grader) ? 'Label unspecified' : designationLabel(sale.designation)].filter(Boolean).join(' ');
}
export function saleIdentityLabel(sale) {
  return [word(sale.language) ?? 'Language unspecified', word(sale.printing) ?? 'Printing unspecified', word(sale.variant) ?? 'Variant unspecified'].join(' · ');
}
export function saleGroupKey(sale) {
  return JSON.stringify([sale.raw === true, sale.raw ? null : word(sale.grader), sale.raw ? null : String(sale.grade ?? ''),
    sale.raw ? word(sale.rawCondition) : sale.designation ?? null, word(sale.language), word(sale.printing), word(sale.variant), sale.identityStatus ?? 'UNKNOWN']);
}
export function groupSoldReferences(candidates) {
  const map = new Map();
  for (const candidate of candidates ?? []) {
    const sale = candidate.sale ?? candidate, key = saleGroupKey(sale);
    if (!map.has(key)) map.set(key, { key, label: saleGradeLabel(sale), identityLabel: saleIdentityLabel(sale),
      needsReview: sale.identityStatus !== 'MATCH', sale, candidates: [] });
    map.get(key).candidates.push(candidate);
  }
  const rank = sale => sale.grader === 'PSA' ? 0 : sale.grader === 'BGS' && sale.designation === 'BLACK_LABEL' ? 1
    : sale.grader === 'CGC' && sale.designation === 'PRISTINE' ? 2 : sale.grader === 'BGS' ? 3 : sale.grader === 'CGC' ? 4 : sale.grader === 'SGC' ? 5 : 6;
  return [...map.values()].sort((a, b) => Number(b.sale.raw === true) - Number(a.sale.raw === true)
    || Number(b.sale.grade ?? 0) - Number(a.sale.grade ?? 0) || rank(a.sale) - rank(b.sale)
    || a.label.localeCompare(b.label) || a.identityLabel.localeCompare(b.identityLabel)).map(group => ({ ...group,
      candidates: group.candidates.slice().sort((a, b) => (Date.parse((b.sale ?? b).soldAt) || 0) - (Date.parse((a.sale ?? a).soldAt) || 0)) }));
}
export function saleAmountLabel(sale) {
  if (sale.priceBasis === 'accepted_offer_unknown') return 'Accepted offer · Amount undisclosed';
  if (sale.priceBasis !== 'sold' || !Number.isSafeInteger(sale.priceMinor) || sale.priceMinor < 0 || !/^[A-Z]{3}$/.test(sale.currency ?? '')) return 'Sold amount unavailable';
  const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: sale.currency });
  return formatter.format(sale.priceMinor / 10 ** formatter.resolvedOptions().maximumFractionDigits);
}
export function saleDateLabel(value) {
  return value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(value)) : 'Date unavailable';
}
export function marketSearchMessage(value) {
  const reason = ({ PROVIDER_QUOTA_REACHED: 'The sold-sales provider quota is exhausted. Ask an administrator to check the account.',
    PROVIDER_REQUEST_LIMITED: 'The provider has limited requests. The saved search will show its next available state here.',
    PROVIDER_CONFIGURATION_ERROR: 'The sold-sales provider credential needs attention from an administrator.',
    PROVIDER_NOT_CONFIGURED: 'The sold-sales provider is not configured.',
    PROVIDER_OUTCOME_UNKNOWN: 'The provider outcome is not confirmed. Check the saved search; another lookup will not be purchased.' })[value?.reason];
  if (reason) return reason;
  return ({ NOT_REQUESTED: 'No saved search for this approval yet.', QUEUED: 'Sold comps queued · Results will appear automatically.',
    SEARCHING: 'Searching sold listings · Results will appear automatically.', UNKNOWN: 'The provider outcome is not confirmed. Check the saved search before another lookup.',
    FAILED: 'The saved search needs attention. Your approved grade is unchanged.', UNAVAILABLE: 'Sold-card search is currently unavailable.' })[value?.state] ?? '';
}
