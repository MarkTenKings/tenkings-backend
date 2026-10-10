import { createHash } from 'node:crypto';
import { canonicalJson, CatalogContractError } from './index.mjs';

export const VARIANT_REVIEW_VERSION = 'atlas-variant-catalog/v1';
export const VARIANT_CATALOG_REVISION = 'variant-catalog-2026-10-09-v1';
export const VARIANT_REVIEW_LIMITS = Object.freeze({ candidates: 48, imagesPerCandidate: 4, diagnostics: 16, bytes: 768 * 1024 });
export const VARIANT_WARNING_CODES = Object.freeze(['LANGUAGE_UNCONFIRMED', 'DENOMINATOR_UNVERIFIED', 'FINISH_UNVERIFIED',
  'SET_NAME_REQUIRES_REVIEW', 'REFERENCE_IMAGE_MISSING', 'CARD_ART_ONLY', 'APPLICABILITY_UNCONFIRMED', 'SCOPE_UNCONFIRMED',
  'LISTING_CLAIMS_UNREVIEWED', 'REFERENCE_USAGE_NOT_REVIEWED']);
export const VARIANT_PROBLEM_CODES = Object.freeze(['IDENTITY_INCOMPLETE', 'CATALOG_NOT_CONFIGURED', 'CATALOG_UNAVAILABLE',
  'CATALOG_TRUNCATED', 'PROVIDER_UNAVAILABLE', 'PROVIDER_TRUNCATED', 'PROVIDER_NOT_SUPPORTED', 'NO_VARIANTS_FOUND',
  'LANGUAGE_UNCONFIRMED', 'NO_DIAGNOSTIC_PHOTOS', 'REFERENCE_PERMISSION_REQUIRED',
  'LISTING_SOURCE_OUTCOME_UNKNOWN', 'LISTING_SOURCE_UNAVAILABLE', 'LISTING_SOURCE_NOT_CONFIGURED']);
const HASH = /^[a-f0-9]{64}$/;
const fields = ['category', 'name', 'year', 'setName', 'cardNumber', 'manufacturer', 'language'];
const digest = value => createHash('sha256').update(canonicalJson(value)).digest('hex');
const clone = value => JSON.parse(canonicalJson(value));
const fail = (ok, path) => { if (!ok) throw new CatalogContractError('INVALID_VARIANT_REVIEW', path); };
const text = (v, max = 500) => typeof v === 'string' && v.length > 0 && v.length <= max && v === v.trim() && !/[\x00-\x1f\x7f]/u.test(v);
const nullable = (v, max) => v === null || text(v, max);
const norm = v => v.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase();
const keys = (v, expected) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join('|') === [...expected].sort().join('|');
const unique = a => new Set(a).size === a.length;
const list = (v, max) => Array.isArray(v) && v.length <= max;
const freeze = v => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
const url = v => { try { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password && !u.hash && text(v, 2048); } catch { return false; } };

/** Public product descriptors only. Physical IDs, photographs, notes and grades
 * are deliberately absent from the shared demand/cache identity. */
export function normalizeVariantIdentity(input) {
  fail(input && typeof input === 'object' && ['POKEMON', 'SPORTS'].includes(input.category), 'identity.category');
  const value = Object.fromEntries(fields.map(k => [k, input[k] === undefined || input[k] === '' ? null : input[k]]));
  for (const k of fields) fail(nullable(value[k], 240), `identity.${k}`);
  if (value.language !== null) {
    const languages = { english: 'en', french: 'fr', german: 'de', spanish: 'es', italian: 'it', portuguese: 'pt', japanese: 'ja', korean: 'ko', chinese: 'zh' };
    value.language = languages[norm(value.language)] ?? norm(value.language);
    fail(/^[a-z]{2}(?:-[a-z]{2,8})?$/.test(value.language), 'identity.language');
  }
  return freeze(value);
}

export function variantDemandKey(identity) {
  const v = normalizeVariantIdentity(identity);
  return `variant-demand:v1:${digest(Object.fromEntries(fields.map(k => [k, v[k] === null ? null : norm(v[k])])) )}`;
}

/** Numeric zero padding aliases are safe only within the same prefix and
 * denominator. RC1 never aliases 1; an unknown denominator never proves a match. */
export function compareVariantCardNumber(a, b) {
  if (a === null || b === null) return 'unknown';
  const parse = v => norm(v).replace(/^#/, '').split('/').map(p => p.replace(/^([a-z]*)(0+)(\d+)$/i, '$1$3'));
  const x = parse(a), y = parse(b);
  if (x[0] !== y[0]) return 'conflict';
  if (x.length > 2 || y.length > 2) return norm(a) === norm(b) ? 'match' : 'conflict';
  return x[1] && y[1] ? x[1] === y[1] ? 'match' : 'conflict' : x.length === y.length ? 'match' : 'unknown';
}

export function compareVariantIdentity(expected, observed) {
  const a = normalizeVariantIdentity(expected), b = normalizeVariantIdentity(observed), conflicts = [], unknown = [];
  for (const k of fields) {
    if (a[k] === null || b[k] === null) { unknown.push(k); continue; }
    const result = k === 'cardNumber' ? compareVariantCardNumber(a[k], b[k]) : norm(a[k]) === norm(b[k]) ? 'match' : 'conflict';
    if (result === 'conflict') conflicts.push(k);
    if (result === 'unknown') unknown.push(k);
  }
  return freeze({ conflicts, unknown });
}

function validatePin(p) {
  fail(keys(p, ['publicationId', 'setId', 'revision', 'manifestSha256']) && text(p.publicationId, 256) && text(p.setId, 256)
    && Number.isSafeInteger(p.revision) && p.revision > 0 && HASH.test(p.manifestSha256), 'publication');
}

/** Accept only documented public provider image origins or private catalog
 * images addressed through an authenticated publication+image route. */
export function isVariantProviderImageUrl(value, provider) {
  if (!url(value)) return false;
  const u = new URL(value);
  if (u.search || u.port) return false;
  return provider === 'ebay_sold_comps_v2' && /^(?:[a-z0-9-]+\.)*(?:ebayimg|ebaystatic)\.com$/.test(u.hostname)
    && !/%(?:2e|2f|5c)/i.test(u.pathname) && !u.pathname.includes('..') && !u.pathname.includes('\\')
    || provider === 'tcgdex' && u.hostname === 'assets.tcgdex.net'
    && /^\/[a-z]{2}(?:-[a-z]{2,8})?\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/(?:high|low)\.(?:webp|png|jpg)$/.test(u.pathname)
    || provider === 'scrydex' && u.hostname === 'images.scrydex.com'
      && /^\/(?:pokemon|cards)\/[A-Za-z0-9._/-]+$/.test(u.pathname) && !u.pathname.includes('..');
}

/** Eligibility for advisory comparison, never catalog authority or physical
 * confirmation. A provider-specific gallery is useful only after acquisition
 * has pinned its actual bytes. Generic artwork is never eligible. */
export function isVariantPhotoComparable(candidate, image) {
  try {
    const c = validateVariantCandidate(candidate), i = c.images.find(i => i.imageId === image?.imageId);
    if (!i || canonicalJson(i) !== canonicalJson(image) || !HASH.test(i.sha256)
      || !['exact', 'representative'].includes(i.relationship)) return false;
    return c.authority === 'reviewed_catalog' && c.applicability === 'supported' && i.provenance.usage === 'reviewed_catalog' && i.visibleDiagnosticIds.length > 0
      || c.authority === 'provider_candidate' && c.source.provider === 'scrydex' && i.relationship === 'exact'
        && i.provenance.usage === 'provider_reference';
  } catch { return false; }
}

export function variantCandidateId(candidate) {
  return `variant-choice:v1:${digest(candidate.canonical === null
    ? { provider: candidate.source.provider, recordId: candidate.source.recordId, sha256: candidate.source.sha256, identity: candidate.identity, parallel: candidate.parallel }
    : candidate.canonical)}`;
}

/** Encode only dimensions present in the chosen evidence. This writes no
 * identity: callers still require an explicit, current human selection. */
export function variantSelectionParallel(input) {
  const candidate = validateVariantCandidate(input);
  fail(text(candidate.parallel, 120), 'candidate.finish.unresolved');
  const names = { en: 'English', fr: 'French', de: 'German', es: 'Spanish', it: 'Italian', pt: 'Portuguese', ja: 'Japanese', ko: 'Korean', zh: 'Chinese', 'zh-tw': 'Traditional Chinese', 'zh-cn': 'Simplified Chinese' };
  const language = candidate.identity.language === null ? null : names[candidate.identity.language] ?? candidate.identity.language;
  const value = language && !norm(candidate.parallel).includes(norm(language)) ? `${language} ${candidate.parallel}` : candidate.parallel;
  fail(text(value, 120), 'candidate.parallel.length');
  return value;
}

export function validateVariantCandidate(input) {
  const c = clone(input);
  fail(keys(c, ['candidateId', 'authority', 'label', 'identity', 'parallel', 'canonical', 'applicability', 'diagnostics', 'images', 'source', 'warnings']), 'candidate.fields');
  fail(['reviewed_catalog', 'provider_candidate'].includes(c.authority) && text(c.label, 240) && nullable(c.parallel, 120), 'candidate.identity');
  fail(keys(c.identity, fields), 'candidate.identity.fields'); normalizeVariantIdentity(c.identity);
  fail(['supported', 'unknown'].includes(c.applicability), 'candidate.applicability');
  fail(keys(c.source, ['provider', 'recordId', 'url', 'sha256', 'references']) && text(c.source.provider, 80) && text(c.source.recordId, 256)
    && (c.source.url === null || url(c.source.url)) && HASH.test(c.source.sha256), 'candidate.source');
  fail(list(c.source.references, 8) && c.source.references.every(r => keys(r, ['url', 'sha256']) && (r.url === null || url(r.url)) && HASH.test(r.sha256))
    && unique(c.source.references.map(r => canonicalJson(r))), 'candidate.source.references');
  if (c.authority === 'reviewed_catalog') {
    fail(keys(c.canonical, ['publication', 'cardId', 'printingId']), 'candidate.canonical'); validatePin(c.canonical.publication);
    fail(text(c.canonical.cardId, 256) && /^setops-printing:v1:[a-f0-9]{64}$/.test(c.canonical.printingId)
      && c.source.provider === 'setops' && c.source.sha256 === c.canonical.publication.manifestSha256, 'candidate.canonical.binding');
  } else fail(c.canonical === null && c.applicability === 'unknown', 'candidate.provider.authority');
  fail(c.candidateId === variantCandidateId(c), 'candidate.candidateId');
  fail(list(c.warnings, 16) && unique(c.warnings) && c.warnings.every(v => VARIANT_WARNING_CODES.includes(v)), 'candidate.warnings');
  fail(list(c.diagnostics, VARIANT_REVIEW_LIMITS.diagnostics) && unique(c.diagnostics.map(d => d.id))
    && c.diagnostics.every(d => keys(d, ['id', 'description']) && text(d.id, 240) && text(d.description, 500)), 'candidate.diagnostics');
  fail(list(c.images, VARIANT_REVIEW_LIMITS.imagesPerCandidate) && unique(c.images.map(i => i.imageId)), 'candidate.images');
  for (const i of c.images) {
    const listingPhoto = i.relationship === 'listing_photo';
    fail(keys(i, ['imageId', 'relationship', 'url', 'sha256', 'mimeType', 'width', 'height', 'publication', 'provenance', 'visibleDiagnosticIds',
      ...(listingPhoto ? ['sourceResponseSha256', 'listing'] : [])]), 'image.fields');
    fail(text(i.imageId, 256) && ['exact', 'representative', 'card_art_only', 'listing_photo'].includes(i.relationship), 'image.relationship');
    fail(keys(i.provenance, ['provider', 'sourceUrl', 'sourceSha256', 'usage']) && text(i.provenance.provider, 80)
      && (i.provenance.sourceUrl === null || url(i.provenance.sourceUrl)) && HASH.test(i.provenance.sourceSha256)
      && ['reviewed_catalog', 'provider_reference', 'permission_required'].includes(i.provenance.usage), 'image.provenance');
    fail(list(i.visibleDiagnosticIds, 16) && unique(i.visibleDiagnosticIds) && i.visibleDiagnosticIds.every(id => c.diagnostics.some(d => d.id === id)), 'image.diagnostics');
    if (listingPhoto) {
      // This is the only permitted cross-provider image attachment. Scrydex
      // owns the choice name; the seller still owns an unreviewed photo claim.
      fail(c.authority === 'provider_candidate' && c.applicability === 'unknown' && c.canonical === null
        && ['scrydex', 'ebay_sold_comps_v2'].includes(c.source.provider)
        && i.publication === null && i.visibleDiagnosticIds.length === 0
        && i.provenance.provider === 'ebay_sold_comps_v2' && i.provenance.usage === 'provider_reference'
        && HASH.test(i.sourceResponseSha256) && i.sourceResponseSha256 === i.provenance.sourceSha256
        && c.source.references.some(r => r.sha256 === i.sourceResponseSha256 && r.url === i.provenance.sourceUrl)
        && isVariantProviderImageUrl(i.url, 'ebay_sold_comps_v2')
        && HASH.test(i.sha256) && ['image/jpeg', 'image/png', 'image/webp'].includes(i.mimeType)
        && Number.isSafeInteger(i.width) && i.width > 0 && i.width <= 8000
        && Number.isSafeInteger(i.height) && i.height > 0 && i.height <= 8000 && i.width * i.height <= 16000000
        && keys(i.listing, ['id', 'title', 'url']) && /^\d{6,20}$/.test(i.listing.id)
        && text(i.listing.title, 500) && i.listing.url === `https://www.ebay.com/itm/${i.listing.id}`
        && i.imageId === `listing-image:${digest({ listing: i.listing, sha256: i.sha256, sourceResponseSha256: i.sourceResponseSha256 })}`
        && c.warnings.includes('LISTING_CLAIMS_UNREVIEWED') && c.warnings.includes('REFERENCE_USAGE_NOT_REVIEWED'), 'image.listing.binding');
      if (c.source.provider === 'ebay_sold_comps_v2') fail(c.source.sha256 === i.sourceResponseSha256
        && c.source.url === i.provenance.sourceUrl && c.source.recordId === i.listing.id, 'image.listing.source');
      let sourceUrl; try { sourceUrl = new URL(i.provenance.sourceUrl); } catch {}
      fail(sourceUrl?.origin === 'https://api.sold-comps.com' && sourceUrl.pathname === '/v1/scrape'
        && !sourceUrl.username && !sourceUrl.password && !sourceUrl.hash, 'image.listing.provider');
    } else if (i.publication !== null) {
      validatePin(i.publication);
      fail(c.authority === 'reviewed_catalog' && c.applicability === 'supported' && i.url === null && HASH.test(i.sha256)
        && canonicalJson(i.publication) === canonicalJson(c.canonical.publication)
        && i.provenance.provider === 'setops' && i.provenance.usage === 'reviewed_catalog'
        && ['image/jpeg', 'image/png', 'image/webp'].includes(i.mimeType)
        && Number.isSafeInteger(i.width) && i.width > 0 && Number.isSafeInteger(i.height) && i.height > 0
        && i.width * i.height <= 100000000, 'image.catalog.binding');
    } else {
      const unacquired = i.sha256 === null && i.mimeType === null && i.width === null && i.height === null;
      const acquired = i.provenance.provider === 'scrydex' && HASH.test(i.sha256)
        && ['image/jpeg', 'image/png', 'image/webp'].includes(i.mimeType)
        && Number.isSafeInteger(i.width) && i.width > 0 && Number.isSafeInteger(i.height) && i.height > 0 && i.width * i.height <= 52000000;
      fail(c.authority === 'provider_candidate' && i.provenance.provider === c.source.provider && i.provenance.sourceSha256 === c.source.sha256
        && i.provenance.usage !== 'reviewed_catalog' && (unacquired || acquired)
        && (i.url === null || isVariantProviderImageUrl(i.url, i.provenance.provider)), 'image.provider.binding');
      // The single TCGdex artwork image is not a diagnostic finish photo.
      fail(i.provenance.provider !== 'tcgdex' || i.relationship === 'card_art_only' && i.visibleDiagnosticIds.length === 0, 'image.provider.finish');
      if (i.relationship !== 'card_art_only') fail(i.provenance.provider === 'scrydex' && i.relationship === 'exact'
        && /^scrydex:variant-image:v1:[a-f0-9]{64}$/.test(i.imageId) && /:variant:/.test(c.source.recordId)
        && c.source.url?.startsWith('https://api.scrydex.com/pokemon/v1/cards?'), 'image.provider.variant');
      if (!acquired) fail(i.visibleDiagnosticIds.length === 0, 'image.provider.unacquired');
      if (i.provenance.usage === 'permission_required') fail(i.url === null, 'image.permission');
    }
  }
  return freeze(c);
}

export function variantSnapshotHash(value) {
  const { capturedAt: _time, snapshotHash: _hash, ...evidence } = value;
  return digest(evidence);
}

export function createVariantReviewSnapshot({ identity, candidates = [], problems = [], capturedAt, truncated = false }) {
  const seen = new Map();
  for (const c of candidates) {
    const candidate = validateVariantCandidate(c), old = seen.get(candidate.candidateId);
    fail(!old || canonicalJson(old) === canonicalJson(candidate), 'candidate.duplicate.conflict');
    seen.set(candidate.candidateId, candidate);
  }
  const ordered = [...seen.values()].sort((a, b) => (a.authority === b.authority ? 0 : a.authority === 'reviewed_catalog' ? -1 : 1)
    || a.candidateId.localeCompare(b.candidateId));
  truncated ||= ordered.length > VARIANT_REVIEW_LIMITS.candidates;
  const selected = ordered.slice(0, VARIANT_REVIEW_LIMITS.candidates);
  if (truncated) problems = [...problems, 'PROVIDER_TRUNCATED'];
  if (!selected.length) problems = [...problems, 'NO_VARIANTS_FOUND'];
  if (!selected.some(c => c.images.some(i => isVariantPhotoComparable(c, i)))) problems = [...problems, 'NO_DIAGNOSTIC_PHOTOS'];
  if (normalizeVariantIdentity(identity).language === null) problems = [...problems, 'LANGUAGE_UNCONFIRMED'];
  const result = { schemaVersion: VARIANT_REVIEW_VERSION, demandKey: variantDemandKey(identity), capturedAt,
    coverage: { metadata: truncated ? 'truncated' : selected.length ? 'partial' : 'unknown',
      applicability: selected.some(c => c.applicability === 'supported') ? 'partial' : 'unknown',
      images: selected.some(c => c.images.some(i => i.relationship !== 'card_art_only')) ? 'partial' : 'unknown' },
    candidates: selected, problems: [...new Set(problems)].sort() };
  return validateVariantReviewSnapshot({ ...result, snapshotHash: variantSnapshotHash(result) });
}

export function validateVariantReviewSnapshot(input) {
  const s = clone(input);
  fail(keys(s, ['schemaVersion', 'demandKey', 'snapshotHash', 'capturedAt', 'coverage', 'candidates', 'problems'])
    && s.schemaVersion === VARIANT_REVIEW_VERSION && /^variant-demand:v1:[a-f0-9]{64}$/.test(s.demandKey), 'snapshot.fields');
  fail(typeof s.capturedAt === 'string' && Number.isFinite(Date.parse(s.capturedAt)) && new Date(s.capturedAt).toISOString() === s.capturedAt, 'snapshot.capturedAt');
  fail(keys(s.coverage, ['metadata', 'applicability', 'images']) && Object.values(s.coverage).every(v => ['partial', 'unknown', 'truncated'].includes(v)), 'snapshot.coverage');
  fail(list(s.problems, 16) && unique(s.problems) && s.problems.every(v => VARIANT_PROBLEM_CODES.includes(v)), 'snapshot.problems');
  fail(list(s.candidates, VARIANT_REVIEW_LIMITS.candidates) && unique(s.candidates.map(c => c.candidateId)), 'snapshot.candidates');
  s.candidates.forEach(validateVariantCandidate);
  fail(Buffer.byteLength(canonicalJson(s)) <= VARIANT_REVIEW_LIMITS.bytes && s.snapshotHash === variantSnapshotHash(s), 'snapshot.hash');
  return freeze(s);
}

/** This projector is server composition, not a serialized authority verifier.
 * Call only with the existing authenticated/current publication reader result. */
export function variantChoicesFromPublishedLookup(result) {
  fail(result?.authority === 'host_authorized_setops_publication' && result.publication && result.absenceEstablishesExclusion === false
    && result.identityDecision === 'consumer_review_required' && list(result.candidates, 100), 'lookup.authority');
  const { publicationId, setId, revision, manifestSha256 } = result.publication;
  const publication = { publicationId, setId, revision, manifestSha256 }; validatePin(publication);
  return freeze(result.candidates.filter(c => c.recordedApplicability !== 'excluded').map(c => {
    const supported = c.applicability === 'supported', images = supported ? c.images.slice(0, 4) : [];
    const candidate = { authority: 'reviewed_catalog', label: c.printing.label,
      identity: normalizeVariantIdentity({ category: result.set.category, name: c.card.name, year: result.set.year,
        setName: result.set.label, cardNumber: c.card.number, manufacturer: result.set.manufacturer ?? result.set.publisher,
        language: c.printing.language === 'not_applicable' ? null : c.printing.language }),
      parallel: [...['edition', 'format', 'channel'].map(k => c.printing[k]).filter(v => v !== null && v !== 'not_applicable' && !norm(c.printing.label).includes(norm(v))), c.printing.label].join(' '),
      canonical: { publication, cardId: c.card.cardId, printingId: c.printing.printingId },
      applicability: supported ? 'supported' : 'unknown',
      diagnostics: c.printing.diagnostics.slice(0, 16).map(d => ({ id: d.id, description: d.description })),
      images: images.map(i => ({ imageId: i.imageId, relationship: i.relationship === 'depicts_candidate_identity' ? 'exact' : 'representative',
        url: null, sha256: i.sha256, mimeType: i.mimeType, width: i.width, height: i.height, publication,
        provenance: { provider: 'setops', sourceUrl: result.sources.find(s => i.sourceIds.includes(s.sourceId))?.sourceUrl ?? null,
          sourceSha256: result.sources.find(s => i.sourceIds.includes(s.sourceId))?.sha256 ?? manifestSha256, usage: 'reviewed_catalog' },
        visibleDiagnosticIds: i.visibleDiagnosticIds.filter(id => c.printing.diagnostics.slice(0, 16).some(d => d.id === id)) })),
      source: { provider: 'setops', recordId: c.printing.printingId, url: null, sha256: manifestSha256,
        references: [...new Map(result.sources.filter(s => c.printing.sourceIds.includes(s.sourceId) || c.applicabilitySourceIds.includes(s.sourceId))
          .map(s => { const r = { url: s.sourceUrl, sha256: s.sha256 }; return [canonicalJson(r), r]; })).values()].slice(0, 8) },
      warnings: [...(!supported ? ['APPLICABILITY_UNCONFIRMED'] : []), ...(c.unresolvedScopeFields.length ? ['SCOPE_UNCONFIRMED'] : []), ...(!images.length ? ['REFERENCE_IMAGE_MISSING'] : [])] };
    return validateVariantCandidate({ candidateId: variantCandidateId(candidate), ...candidate });
  }));
}
