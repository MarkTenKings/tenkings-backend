// Display helpers only. Identity, sale evidence and offers come from the server;
// none of these functions calculates a grade or creates a market valuation.
const nonempty = value => typeof value === 'string' && value.trim().length > 0;

export function reportIdentityRows(report, details) {
  const identity = report?.identity ?? {};
  const pairs = [
    ['Name', identity.playerName ?? identity.cardName],
    ['Category', details?.category || ({ SPORTS: 'Sports cards', POKEMON: 'Pokémon' })[report?.cardProfile]],
    ['Year', identity.year], ['Manufacturer', identity.manufacturer || details?.manufacturer],
    ['Set', identity.productSet], ['Card number', identity.cardNumber],
    ['Parallel', identity.parallel], ['Insert', identity.insert],
    ['Variant', details?.variant], ['Card type', details?.cardType],
    ['Layout', ({ POKEMON: 'Pokémon', TRAINER: 'Trainer', ENERGY: 'Energy' })[identity.layoutType]],
  ];
  return pairs.filter(([, value]) => nonempty(value));
}

export function safePresentationLink(value, { localOnly = false } = {}) {
  if (typeof value !== 'string' || !value || value.length > 2048 || /[\s\\\u0000-\u001f\u007f]/u.test(value)) return null;
  if (/^\/(?!\/)/.test(value)) return value;
  if (localOnly) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? value : null;
  } catch { return null; }
}

export function validSlabPhoto(photo) {
  return Boolean(photo && safePresentationLink(photo.url, { localOnly: true })
    && Number.isSafeInteger(photo.width) && photo.width > 0 && photo.width <= 20000
    && Number.isSafeInteger(photo.height) && photo.height > 0 && photo.height <= 20000
    && nonempty(photo.alt));
}

export function photoTilt(event, rect) {
  if (event.pointerType !== 'mouse' || !rect || rect.width <= 0 || rect.height <= 0) return null;
  const clamp = value => Math.min(1, Math.max(-1, value));
  return { x: -clamp((event.clientY - rect.top) / rect.height * 2 - 1) * 4,
    y: clamp((event.clientX - rect.left) / rect.width * 2 - 1) * 4 };
}

export function saleReferenceRows(sales) {
  return Array.isArray(sales) ? sales.filter(sale => sale && nonempty(sale.id) && nonempty(sale.title)
    && nonempty(sale.grader) && nonempty(sale.grade) && safePresentationLink(sale.listingUrl)
    && (sale.soldAt === null || Number.isFinite(Date.parse(sale.soldAt))) && /^[A-Z]{3}$/.test(sale.currency ?? '')
    && (sale.priceBasis === 'accepted_offer_unknown' || sale.priceBasis === 'sold' && Number.isSafeInteger(sale.priceMinor) && sale.priceMinor >= 0))
    .slice().sort((a, b) => (Date.parse(b.soldAt) || 0) - (Date.parse(a.soldAt) || 0)) : [];
}

export function boundReportPresentation(presentation, publication) {
  const token = publication?.publicToken ?? /^\/reports\/(ar_[A-Za-z0-9_-]{24})(?:\?|$)/.exec(publication?.url ?? '')?.[1];
  return /^ar_[A-Za-z0-9_-]{24}$/.test(token ?? '') && presentation?.version === 'atlas-report-presentation-v1' && presentation.binding?.publicToken === token
    && presentation.binding?.approvalVersion === publication?.version && presentation.binding?.publicHash === publication?.reportHash
    && /^[a-f0-9]{64}$/.test(publication?.reportHash ?? '') ? presentation : null;
}

export function moneyLabel(minor, currency) {
  if (!Number.isSafeInteger(minor) || minor < 0 || !/^[A-Z]{3}$/.test(currency ?? '')) return null;
  try {
    const digits = new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, currencyDisplay: 'code' }).format(minor / 10 ** digits);
  } catch { return null; }
}

export function evidenceDate(value) {
  if (!Number.isFinite(Date.parse(value))) return null;
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(value));
}
