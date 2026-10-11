import { createHash } from 'node:crypto';
import { canonicalJson, normalizeVariantIdentity, compareVariantCardNumber,
  validateVariantCandidate, VARIANT_REVIEW_LIMITS } from '@tenkings/card-catalog-evidence';
import { buildEbaySoldCompsV2Query, parseEbaySoldCompsV2Candidate,
  EBAY_SOLD_COMPS_V2_ATLAS_MATCHING_POLICY, EBAY_SOLD_COMPS_V2_CLASSIFICATION_REVISION } from '@tenkings/ebay-sold-comps-v2';
import { inspectStaffInventoryResearchSale, inspectStaffInventoryResearchTitle } from '@tenkings/card-research-core/decisions';
import { isStaffInventoryResearchImageUrl } from '@tenkings/card-research-core/contract';
import { researchImageOptions, researchSaleEvidence } from '../../card-research-core/src/evidence.mjs';
import { boundedProviderOperation, readBoundedProviderBody } from '../../card-catalog-evidence/src/provider-media.mjs';
import { validVariantReferenceListing } from '../../card-catalog-evidence/src/variant-review.mjs';

// The caller MUST durably journal fetchSource before dispatch. Seller photos
// never establish catalog authority or select the physical card's variant.
export const VARIANT_LISTING_REVISION = 'variant-listing-2026-10-10-v2';
export const VARIANT_GRADED_LISTING_REVISION = 'variant-listing-photo-pool-2026-10-11-v2';
const retainedGradedRevision = 'variant-listing-graded-label-2026-10-10-v1';
const gradedRequest = request => [VARIANT_GRADED_LISTING_REVISION, retainedGradedRevision].includes(request.revision);
const concisePokemonRequestRevision = 'variant-listing-pokemon-query-2026-10-10-v1';
export const VARIANT_LISTING_LIMITS = Object.freeze({ results: 40, responseResults: 60, sourceBytes: 1024 * 1024,
  imageBytes: 2 * 1024 * 1024, imagePixels: 16000000, imageRequests: 8, images: 8,
  totalImageBytes: 12 * 1024 * 1024, timeoutMs: 45000, imageTimeoutMs: 10000, ttlMs: 86400000 });
const endpoint = 'https://api.sold-comps.com/v1/scrape';
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = code => Object.assign(new Error(code), { code });
const check = (ok, code = 'VARIANT_LISTING_INVALID') => { if (!ok) throw fail(code); };
const HASH = /^[a-f0-9]{64}$/;
const keys = (v, fields) => v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).sort().join('|') === [...fields].sort().join('|');
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const date = v => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const normalize = v => v.normalize('NFC').trim().replace(/\s+/gu, ' ');
const canonicalNumber = v => v.toLowerCase().replace(/^#\s*/, '').split('/').map(p => p.trim().replace(/^([a-z]*)0+(\d+)$/, '$1$2')).join('/');
const collector = text => String(text).replace(/\b([A-Za-z]*)0+(\d+)\b/g, '$1$2');
const languageNames = { en: 'english', ja: 'japanese', fr: 'french', de: 'german', es: 'spanish', it: 'italian',
  pt: 'portuguese', ko: 'korean', zh: 'chinese' };
function explicitMultipleQuantity(title, identity) {
  const collectorParts = new Set(canonicalNumber(identity.cardNumber).split('/'));
  const quantity = /(?:^|[\s(,])([x×]\s*(?:[2-9]\d*|1\d+)|(?:[2-9]\d*|1\d+)\s*[x×])(?=$|[\s),.!])/gi;
  // A printed X2 or 2X identifier remains an identity token, not a quantity.
  return [...title.matchAll(quantity)].some(match => !collectorParts.has(match[1].toLowerCase().replace(/\s+/g, '')));
}
function productParts(identity) {
  const parts = identity.category === 'SPORTS' ? identity.setName.split(/\s+[—–]\s+/u) : [];
  return parts.length === 2 && parts.every(Boolean) ? { product: parts[0], insert: parts[1] }
    : { product: identity.setName, insert: null };
}
// Checklist subset names remain in the saved label. Search only the finish
// suffix when the manufacturer uses one of these explicit base-row prefixes.
function listingSearchLabel(identity, label) {
  if (identity.category === 'POKEMON') return label.replace(/\bholofoil\b|\bholographic\b/gi, 'Holo').replace(/\bstamp(?:ed)?\b/gi, '').trim();
  if (/^(?:rated rookies?|rookies?|base(?: cards?(?: [ivx]+)?)?)$/i.test(label)) return label;
  const suffix = label.replace(/^(?:rated rookies?|rookies?|base(?: cards?(?: [ivx]+)?)?)\s*[-–—:]?\s+/i, '').trim();
  return suffix || label;
}
function engineInput(identity, printing = null) {
  const { product, insert } = productParts(identity);
  return { matchingPolicy: EBAY_SOLD_COMPS_V2_ATLAS_MATCHING_POLICY, category: identity.category,
    year: identity.year, manufacturer: identity.manufacturer, productSet: product, insert,
    ...(identity.category === 'SPORTS' ? { playerName: identity.name } : { cardName: identity.name }),
    cardNumber: identity.cardNumber, parallel: printing ? listingSearchLabel(identity, printing.name) : null,
    variantIdentity: { language: languageNames[printing?.language ?? identity.language] ?? printing?.language ?? identity.language } };
}
/** Ordinary copies share one permanent request. Only an explicit reference
 * refresh may create another search generation for a still-missing printing. */
function prepareListingRequest(input, printing = null, legacy = false, graded = false, generation = null, photoPool = false) {
  check(generation === null || graded && typeof generation === 'string'
    && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(generation), 'VARIANT_LISTING_REFRESH_GENERATION');
  const fields = ['category', 'name', 'year', 'setName', 'cardNumber', 'manufacturer', 'language'];
  check(input && Object.keys(input).every(k => fields.includes(k)), 'VARIANT_LISTING_IDENTITY');
  const normalized = normalizeVariantIdentity(Object.fromEntries(Object.entries(input).map(([k, v]) => [k, typeof v === 'string' ? normalize(v) : v])));
  const identity = normalizeVariantIdentity(Object.fromEntries(Object.entries(normalized).map(([k, v]) => [k,
    v === null || k === 'category' ? v : k === 'cardNumber' ? canonicalNumber(v) : v.toLowerCase()])));
  check(identity.name && identity.year && identity.setName && identity.cardNumber
    && (identity.category !== 'SPORTS' || identity.manufacturer), 'VARIANT_LISTING_IDENTITY_INCOMPLETE');
  if (printing !== null) {
    check(keys(printing, ['name', 'language']) && typeof printing.name === 'string'
      && printing.name.trim().length > 0 && printing.name.length <= 120 && !/[\x00-\x1f\x7f]/.test(printing.name), 'VARIANT_LISTING_PRINTING');
    printing = { name: normalize(printing.name).toLowerCase(), language: normalizeVariantIdentity({ category: identity.category, language: printing.language }).language };
    check(!identity.language || !printing.language || identity.language === printing.language, 'VARIANT_LISTING_PRINTING_LANGUAGE');
  }
  // Marketplace titles often omit the series prefix and punctuation used in
  // official set names. Search with the card's strong public anchors; projection
  // still checks the full saved set/year/number identity before using a photo.
  const concisePokemon = !legacy && identity.category === 'POKEMON' && printing;
  const searchPrinting = graded && /^(?:normal|base|base cards?)$/i.test(printing?.name ?? '') ? null : printing;
  const query = [concisePokemon
    ? ['pokemon', identity.name, identity.cardNumber, searchPrinting ? listingSearchLabel(identity, searchPrinting.name) : null].filter(Boolean).join(' ')
    : buildEbaySoldCompsV2Query(engineInput(identity, searchPrinting)), printing?.language && printing.language !== 'en' ? languageNames[printing.language] ?? printing.language : null,
    graded ? photoPool ? 'graded' : '(PSA,CGC,BGS,SGC)' : null].filter(Boolean).join(' ');
  const url = new URL(endpoint);
  url.search = new URLSearchParams({ keyword: query, ebaySite: 'ebay.com', count: String(photoPool ? 240 : VARIANT_LISTING_LIMITS.results),
    page: '1', sold: 'true', includeCompleteListing: 'true', exactMatch: 'true', hydrateBoa: 'false' }).toString();
  const request = { schemaVersion: 'variant-listing-request/v1', revision: graded ? photoPool ? VARIANT_GRADED_LISTING_REVISION : retainedGradedRevision : concisePokemon ? concisePokemonRequestRevision : VARIANT_LISTING_REVISION,
    parserRevision: EBAY_SOLD_COMPS_V2_CLASSIFICATION_REVISION, identity, ...(printing ? { printing } : {}),
    ...(generation !== null ? { generation } : {}), query, url: url.href };
  return { ...request, requestKey: `variant-listing-source:v1:${hash(canonicalJson(request))}` };
}
export function prepareVariantListingRequest(input, printing = null, { graded = false, generation = null } = {}) {
  check(typeof graded === 'boolean', 'VARIANT_LISTING_REQUEST_CHANGED');
  return prepareListingRequest(input, printing, false, graded, generation, graded);
}
/** Reconstruct an existing paid journal identity for read-only reuse. Never send it. */
export function prepareRetainedVariantListingRequest(input, printing = null) {
  return prepareListingRequest(input, printing, false, true);
}
function validateRequest(request) {
  // Retained paid responses remain readable under their original request key.
  check([VARIANT_LISTING_REVISION, concisePokemonRequestRevision, retainedGradedRevision, VARIANT_GRADED_LISTING_REVISION].includes(request?.revision)
    && same(prepareListingRequest(request?.identity, request?.printing ?? null, request.revision === VARIANT_LISTING_REVISION,
      gradedRequest(request), request.generation ?? null, request.revision === VARIANT_GRADED_LISTING_REVISION), request), 'VARIANT_LISTING_REQUEST_CHANGED');
  return request;
}
function validateSource(request, source) {
  validateRequest(request);
  check(keys(source, ['schemaVersion', 'requestKey', 'url', 'httpStatus', 'contentType', 'bodyText', 'sha256', 'capturedAt'])
    && source.schemaVersion === 'variant-listing-response/v1' && source.requestKey === request.requestKey && source.url === request.url
    && Number.isInteger(source.httpStatus) && source.httpStatus >= 100 && source.httpStatus <= 599
    && typeof source.contentType === 'string' && source.contentType.length <= 200
    && typeof source.bodyText === 'string' && Buffer.byteLength(source.bodyText) <= VARIANT_LISTING_LIMITS.sourceBytes
    && HASH.test(source.sha256) && hash(source.bodyText) === source.sha256 && date(source.capturedAt), 'VARIANT_LISTING_SOURCE_CHANGED');
  if (source.httpStatus !== 200) throw fail(source.httpStatus === 401 ? 'VARIANT_LISTING_CONFIGURATION'
    : [403, 429].includes(source.httpStatus) ? 'VARIANT_LISTING_LIMITED' : 'VARIANT_LISTING_HTTP_FAILURE');
  check(/^application\/json(?:\s*;|$)/i.test(source.contentType), 'VARIANT_LISTING_SOURCE_TYPE');
  let payload; try { payload = JSON.parse(source.bodyText); } catch { throw fail('VARIANT_LISTING_SOURCE_JSON'); }
  check(payload && payload.keyword === request.query && payload.page === 1 && Number.isSafeInteger(payload.totalItems)
    && payload.totalItems >= 0 && typeof payload.hasNextPage === 'boolean' && Array.isArray(payload.items)
    && (gradedRequest(request) || payload.items.length <= VARIANT_LISTING_LIMITS.responseResults)
    && payload.totalItems >= payload.items.length, 'VARIANT_LISTING_SOURCE_SHAPE');
  return payload;
}
function referenceListing(raw) {
  const clean = (value, length) => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, length) || null : null;
  let url = null;
  try {
    const link = new URL(raw.url);
    if (link.protocol === 'https:' && !link.username && !link.password && !link.port
      && (link.hostname === 'ebay.com' || link.hostname.endsWith('.ebay.com')) && link.pathname.startsWith('/itm/')) {
      link.hash = ''; url = link.href.length <= 2048 ? link.href : null;
    }
  } catch {}
  return { id: clean(raw.itemId, 200), title: clean(raw.title, 2000), url };
}
/** Label review receives every returned row, regardless of seller metadata.
 * Retained raw bytes, image bytes and literal slab labels own the evidence. */
function projectGradedListingSource(request, source, payload) {
  return { schemaVersion: 'variant-listing-evidence/v1', revision: VARIANT_LISTING_REVISION, requestKey: request.requestKey,
    identity: request.identity, query: request.query, source: { url: source.url, sha256: source.sha256, capturedAt: source.capturedAt },
    authority: 'provider_candidate', coverage: 'partial', requiresReview: true,
    listings: payload.items.map((value, sourceIndex) => {
      const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
      return { sourceIndex, listing: referenceListing(raw), imageOptions: researchImageOptions(raw, true).image_options, image: null };
    }), excluded: [], warnings: ['LISTING_CLAIMS_UNREVIEWED', 'REFERENCE_USAGE_NOT_REVIEWED',
      ...(payload.hasNextPage || payload.totalItems > payload.items.length ? ['SOURCE_TRUNCATED'] : [])] };
}
// Paid listing acquisition follows the worker lease/cancellation signal. A
// short application timer must not turn an accepted request into UNKNOWN.
const listingOperation = (request, signal, timeoutMs, work) => gradedRequest(request)
  ? work(signal ?? new AbortController().signal) : boundedProviderOperation(signal, timeoutMs, work);
function inspectIdentity(identity, candidate, setAliases = []) {
  const { product, insert } = productParts(identity);
  const description = { category: identity.category === 'SPORTS' ? 'Sports cards' : 'Pokemon cards',
    name: identity.name, year: identity.year, set_name: product, manufacturer: identity.manufacturer,
    card_number: collector(identity.cardNumber), card_type: insert, variant: null };
  const normalizedCandidate = { title: collector(candidate.title) };
  let evidence = inspectStaffInventoryResearchTitle(description, normalizedCandidate);
  // The metadata provider admitted these exact expansion aliases for this
  // saved identity. Seller titles often use only that shorter expansion name.
  // Retain all other name/year/number/variant checks and the original paid key.
  if (!evidence.product_anchored) for (const setName of setAliases) {
    const aliasEvidence = inspectStaffInventoryResearchTitle({ ...description, set_name: setName }, normalizedCandidate);
    if (aliasEvidence.research_anchored && aliasEvidence.product_anchored && aliasEvidence.number_anchored) {
      evidence = { ...aliasEvidence, estimate_anchored: false,
        reason_codes: [...aliasEvidence.reason_codes, 'provider_set_alias'] }; break;
    }
  }
  // A printed denominator can be absent; it cannot be contradicted. Keep the
  // missing denominator explicit and never turn a prefix (RC1) into plain 1.
  if (identity.category === 'POKEMON' && description.card_number.includes('/') && !evidence.number_anchored) {
    const numerator = inspectStaffInventoryResearchTitle({ ...description, card_number: description.card_number.split('/')[0] }, normalizedCandidate);
    if (!numerator.reason_codes.includes('card_number_conflict') && numerator.number_anchored) {
      evidence.number_anchored = true; evidence.estimate_anchored = false;
      evidence.reason_codes = evidence.reason_codes.filter(code => code !== 'card_number_conflict' && code !== 'card_number_missing');
      evidence.reason_codes.push('collector_denominator_missing');
      evidence.research_anchored = numerator.research_anchored;
    }
  }
  if (insert) {
    const norm = v => v.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!` ${norm(candidate.title)} `.includes(` ${norm(insert)} `)) evidence.reason_codes.push('insert_anchor_missing');
  }
  return { ...evidence, status: 'UNREVIEWED', physicalVariantConfirmed: false };
}
function claimedParallel(observed) {
  const parts = [...observed.edition, ...observed.finish, ...observed.stamp,
    ...observed.parallelSignals, ...observed.serialDenominators.map(n => `/${n}`)];
  if (observed.autograph === true) parts.push('autograph');
  if (observed.memorabilia === true) parts.push('memorabilia');
  if (observed.promo === true) parts.push('promo');
  return [...new Set(parts)].join(' · ') || null;
}
const listingProviderId = 'ebay_sold_comps_v2';
const listingWarnings = ['LISTING_CLAIMS_UNREVIEWED', 'REFERENCE_USAGE_NOT_REVIEWED'];
const languageCodes = Object.fromEntries(Object.entries(languageNames).map(([code, name]) => [name, code]));
const claimText = v => normalize(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
function explicitStamps(title) {
  const text = claimText(title), result = [];
  for (const [phrase, stamp] of [['pokemon together', 'pokemon together'], ['snowflake', 'snowflake'], ['pokemon center', 'pokemon center']])
    if (` ${text} `.includes(` ${phrase} `)) result.push(stamp);
  return result;
}
function listingFacts(listing) {
  const observed = listing.variantEvidence.observed;
  return { ...observed, stamp: [...new Set([...observed.stamp, ...explicitStamps(listing.listing.title)])] };
}
// Closed map: an unknown catalog label remains available without an attached
// seller photo. In particular, Normal never aliases Non-Holo.
function variantSignature(label) {
  let remaining = claimText(label).replace(/\b(?:holofoil|holographic)\b/g, 'holo').replace(/\bcosmo\b/g, 'cosmos');
  const result = { finish: [], edition: [], stamp: [] };
  for (const [field, phrases] of [['finish', ['non holo', 'reverse holo', 'cracked ice holo', 'cosmos holo', 'cosmic holo', 'galaxy holo', 'poke ball', 'master ball', 'holo']],
    ['edition', ['first edition', '1st edition', 'unlimited', 'shadowless']],
    ['stamp', ['pokemon together', 'pokemon center', 'snowflake', 'gamestop', 'prerelease', 'staff', 'league']]]) {
    for (const phrase of phrases) if (` ${remaining} `.includes(` ${phrase} `)) {
      result[field].push(phrase === '1st edition' ? 'first edition' : phrase);
      remaining = ` ${remaining} `.replace(` ${phrase} `, ' ').trim();
    }
  }
  remaining = remaining.replace(/\bstamp(?:ed)?\b/g, '').trim();
  return !remaining && Object.values(result).some(v => v.length) ? result : null;
}
/** A named search supplies context, never proof of a seller's variant claim.
 * Missing language is allowed for display; explicit conflicts remain excluded. */
function compatibleNamedPhoto(candidate, listing, request, choices) {
  if (!['scrydex', 'manufacturer_checklist'].includes(candidate.source.provider)
    || candidate.authority !== 'provider_candidate' || !candidate.parallel
    || claimText(candidate.label) !== claimText(request.printing.name)
    || candidate.identity.language !== request.printing.language) return false;
  const target = request.identity, observed = listingFacts(listing), expected = variantSignature(candidate.parallel);
  if (compareVariantCardNumber(target.cardNumber, candidate.identity.cardNumber) === 'conflict'
    || observed.language.length && (!request.printing.language || observed.language.some(v => languageCodes[v] !== request.printing.language))) return false;
  if (expected) {
    if (observed.serialDenominators.length || observed.autograph !== null || observed.memorabilia !== null || observed.promo !== null && expected.stamp.length === 0) return false;
    return ['finish', 'edition', 'stamp'].every(k => same([...expected[k]].sort(), [...observed[k]].sort()));
  }
  // Sports subset/finish words can appear in a different order in the title.
  // A Blue Hyper photo cannot attach to Blue or the base subset row.
  if (target.category === 'SPORTS') {
    // A partial checklist may name an insert without listing its parallels.
    // An explicit extra finish still conflicts with that unqualified row,
    // even when no more-specific choice exists in our retained catalog.
    if (listing.variantEvidence.reasonCodes.includes('PARALLEL_EXTRA_FEATURE')) return false;
    const words = label => claimText(listingSearchLabel(target,label)).split(' ').map(w=>w.replace(/^(rookie|refractor|prizm)s$/, '$1'));
    const titleWords = new Set(claimText(listing.listing.title).split(' ').map(w=>w.replace(/^(rookie|refractor|prizm)s$/, '$1')));
    const wanted = words(candidate.parallel), has = label => words(label).every(w=>titleWords.has(w));
    if (!has(candidate.parallel)) return false;
    const base = /^(?:rated rookies?|rookies?|base(?: cards?(?: [ivx]+)?)?)$/i.test(candidate.parallel);
    return !choices.some(other => other.candidateId !== candidate.candidateId && other.source.provider === 'manufacturer_checklist'
      && other.parallel && has(other.parallel) && (base || words(other.parallel).length > wanted.length
        && wanted.every(w=>words(other.parallel).includes(w))));
  }
  // Provider Normal stays literal; it never becomes Non-Holo by inference.
  return ` ${claimText(listing.listing.title)} `.includes(` ${claimText(candidate.parallel)} `);
}

function catalogListingImage(image, source) {
  validateImageDescriptor(image);
  check(image.sourceResponseSha256 === source.sha256, 'VARIANT_LISTING_IMAGE_SOURCE');
  return { ...image, publication: null, provenance: { provider: listingProviderId,
    sourceUrl: source.url, sourceSha256: source.sha256, usage: 'provider_reference' }, visibleDiagnosticIds: [] };
}
/** Attach seller evidence to an existing named printing only. The listing
 * transport still reads legacy requests, but cannot manufacture new choices. */
export function composeVariantListingCandidates({ identity, candidates = [], evidence, printing = null }) {
  check(printing !== null, 'VARIANT_LISTING_PRINTING_REQUIRED');
  const request = prepareVariantListingRequest(identity, printing);
  check(evidence?.schemaVersion === 'variant-listing-evidence/v1' && evidence.revision === VARIANT_LISTING_REVISION
    && evidence.requestKey === request.requestKey && same(evidence.identity, request.identity) && evidence.query === request.query
    && evidence.source?.url === request.url && HASH.test(evidence.source.sha256) && date(evidence.source.capturedAt)
    && evidence.authority === 'provider_candidate' && evidence.requiresReview === true && evidence.coverage === 'partial'
    && Array.isArray(evidence.listings) && evidence.listings.length <= VARIANT_LISTING_LIMITS.results, 'VARIANT_LISTING_EVIDENCE');
  const choices = candidates.map(c => structuredClone(validateVariantCandidate(c)));
  let truncated = evidence.warnings.includes('SOURCE_TRUNCATED');
  for (const listing of evidence.listings) {
    if (!listing.image) continue;
    check(same(listing.listing, listing.image.listing) && listing.identityEvidence.status === 'UNREVIEWED'
      && listing.identityEvidence.physicalVariantConfirmed === false, 'VARIANT_LISTING_EVIDENCE');
    const image = catalogListingImage(listing.image, evidence.source);
    const matches = choices.filter(c => compatibleNamedPhoto(c, listing, request, choices));
    // Multiple compatible catalog choices are ambiguous; do not attach the photo.
    if (matches.length === 1 && matches[0].images.length < VARIANT_REVIEW_LIMITS.imagesPerCandidate
      && matches[0].source.references.length < 8) {
      const c = matches[0];
      if (!c.images.some(i => i.imageId === image.imageId)) c.images.push(image);
      const reference = { url: evidence.source.url, sha256: evidence.source.sha256 };
      if (!c.source.references.some(r => same(r, reference))) c.source.references.push(reference);
      c.warnings = [...new Set([...c.warnings.filter(v => v !== 'REFERENCE_IMAGE_MISSING'), ...listingWarnings])];
      continue;
    }

  }
  truncated ||= choices.length > VARIANT_REVIEW_LIMITS.candidates;
  return { candidates: choices.slice(0, VARIANT_REVIEW_LIMITS.candidates).map(validateVariantCandidate),
    problems: truncated ? ['PROVIDER_TRUNCATED'] : [], truncated };
}
/** Pure projection; raw source retains prices but this visual-discovery result
 * deliberately contains none. A seller's title is a claim, never publication. */
export function projectVariantListingSource(request, source, { catalogCandidates = [] } = {}) {
  const payload = validateSource(request, source);
  if (gradedRequest(request)) return projectGradedListingSource(request, source, payload);
  const input = engineInput(request.identity, request.printing), listings = [], excluded = [];
  check(Array.isArray(catalogCandidates) && catalogCandidates.length <= VARIANT_REVIEW_LIMITS.candidates);
  const setAliases = request.identity.category === 'POKEMON' && request.printing
    ? [...new Set(catalogCandidates.map(validateVariantCandidate).filter(c => c.source.provider === 'scrydex'
      && c.authority === 'provider_candidate' && !c.warnings.includes('SET_NAME_REQUIRES_REVIEW')
      && c.identity.category === 'POKEMON' && c.identity.year === request.identity.year
      && claimText(c.identity.name ?? '') === claimText(request.identity.name)
      && compareVariantCardNumber(c.identity.cardNumber, request.identity.cardNumber) === 'match'
      && claimText(c.label) === claimText(request.printing.name) && c.identity.language === request.printing.language)
      .map(c => c.identity.setName).filter(Boolean))] : [];
  const seen = new Map(), conflicts = new Set();
  // The provider can return its default 60-row page despite count=40. Retain
  // exact bytes, detect duplicate conflicts across that page, and project only
  // the requested first 40 rows. This does not change the paid request key.
  for (const raw of payload.items) {
    const id = typeof raw?.itemId === 'string' && /^\d{6,20}$/.test(raw.itemId) ? raw.itemId : null;
    if (id && seen.has(id) && JSON.stringify(seen.get(id)) !== JSON.stringify(raw)) conflicts.add(id);
    if (id) seen.set(id, raw);
  }
  const processed = new Set();
  for (const raw of payload.items.slice(0, VARIANT_LISTING_LIMITS.results)) {
    const id = typeof raw?.itemId === 'string' && /^\d{6,20}$/.test(raw.itemId) ? raw.itemId : null;
    if (id && processed.has(id)) continue;
    if (id) processed.add(id);
    const reject = reason => excluded.push({ listingId: id, reason });
    if (id && conflicts.has(id)) { reject('CONFLICTING_LISTING_EVIDENCE'); continue; }
    const candidate = parseEbaySoldCompsV2Candidate(raw, input);
    if (!candidate) { reject('INVALID_OR_UNANCHORED_LISTING'); continue; }
    if (explicitMultipleQuantity(candidate.title, request.identity)) { reject('UNSUPPORTED_SINGLE_CARD_LISTING'); continue; }
    if (researchSaleEvidence(raw).sale_evidence.status !== 'sold') { reject('SOLD_EVENT_UNVERIFIED'); continue; }
    if (!inspectStaffInventoryResearchSale(candidate).supported) { reject('UNSUPPORTED_SINGLE_CARD_LISTING'); continue; }
    const identityEvidence = inspectIdentity(request.identity, candidate, setAliases);
    if (!identityEvidence.research_anchored || !identityEvidence.number_anchored
      || identityEvidence.reason_codes.includes('insert_anchor_missing') || candidate.variantEvidence?.status === 'CONTRADICTORY') {
      reject('IDENTITY_CONFLICT_OR_MISSING_ANCHOR'); continue;
    }
    const facts = candidate.variantEvidence.observed;
    if (facts.language.length > 1 || facts.serialDenominators.length > 1
      || facts.edition.includes('first edition') && facts.edition.includes('unlimited')
      || facts.finish.includes('non holo') && facts.finish.length > 1
      || /\b(?:custom|proxy|replica|reprint|digital|stock photo|possibly|maybe)\b|\?/i.test(candidate.title)) {
      reject('AMBIGUOUS_OR_UNSUPPORTED_LISTING_CLAIM'); continue;
    }
    const imageOptions = researchImageOptions(raw, true).image_options;
    listings.push({ listing: { id: candidate.productId, title: candidate.title, url: candidate.listingUrl },
      soldAt: candidate.soldDate, identityEvidence, variantEvidence: candidate.variantEvidence,
      claimedParallel: claimedParallel(candidate.variantEvidence.observed), imageOptions, image: null });
  }
  return { schemaVersion: 'variant-listing-evidence/v1', revision: VARIANT_LISTING_REVISION, requestKey: request.requestKey,
    identity: request.identity, query: request.query, source: { url: source.url, sha256: source.sha256, capturedAt: source.capturedAt },
    authority: 'provider_candidate', coverage: 'partial', requiresReview: true, listings, excluded,
    warnings: ['LISTING_CLAIMS_UNREVIEWED', 'REFERENCE_USAGE_NOT_REVIEWED', ...(request.identity.language === null ? ['LANGUAGE_UNCONFIRMED'] : []),
      ...(payload.hasNextPage || payload.totalItems > payload.items.length || payload.items.length > VARIANT_LISTING_LIMITS.results ? ['SOURCE_TRUNCATED'] : [])] };
}
const imageKey = url => `variant-listing-image:v1:${hash(url)}`;
const retainedImageKey = (url, sha256) => `variant-listing-image-evidence:v1:${hash(url)}:${sha256}`;
const referenceKey = image => `variant-listing-reference:v1:${hash(canonicalJson(image))}`;
function validMetadata(v) {
  return ['image/jpeg', 'image/png', 'image/webp'].includes(v?.mimeType) && Number.isSafeInteger(v.width)
    && Number.isSafeInteger(v.height) && v.width > 0 && v.height > 0 && v.width <= 8000 && v.height <= 8000
    && v.width * v.height <= VARIANT_LISTING_LIMITS.imagePixels;
}
function verifyImage(entry, url) {
  check(keys(entry, ['schemaVersion', 'url', 'body', 'sha256', 'mimeType', 'width', 'height', 'capturedAt', 'expiresAt'])
    && entry.schemaVersion === 'variant-provider-image/v1' && entry.url === url && validMetadata(entry)
    && date(entry.capturedAt) && date(entry.expiresAt) && Date.parse(entry.expiresAt) - Date.parse(entry.capturedAt) === VARIANT_LISTING_LIMITS.ttlMs
    && typeof entry.body === 'string' && entry.body.length <= Math.ceil(VARIANT_LISTING_LIMITS.imageBytes / 3) * 4
    && HASH.test(entry.sha256), 'VARIANT_LISTING_IMAGE_CACHE_INVALID');
  const bytes = Buffer.from(entry.body, 'base64');
  check(bytes.length > 0 && bytes.length <= VARIANT_LISTING_LIMITS.imageBytes && bytes.toString('base64') === entry.body
    && hash(bytes) === entry.sha256, 'VARIANT_LISTING_IMAGE_CACHE_INVALID');
  return { bytes, sha256: entry.sha256, mimeType: entry.mimeType, width: entry.width, height: entry.height };
}
function validateImageDescriptor(image) {
  check(keys(image, ['imageId', 'relationship', 'url', 'sha256', 'mimeType', 'width', 'height', 'sourceResponseSha256', 'listing'])
    && image.relationship === 'listing_photo' && isStaffInventoryResearchImageUrl(image.url)
    && HASH.test(image.sha256) && HASH.test(image.sourceResponseSha256) && validMetadata(image)
    && validVariantReferenceListing(image.listing)
    && image.imageId === `listing-image:${hash(canonicalJson({ listing: image.listing, sha256: image.sha256, sourceResponseSha256: image.sourceResponseSha256 }))}`,
  'VARIANT_LISTING_IMAGE_DESCRIPTOR');
}
async function decodeImage(bytes) {
  const sharp = (await import('sharp')).default, decoder = sharp(bytes, { limitInputPixels: VARIANT_LISTING_LIMITS.imagePixels, failOn: 'warning' });
  const info = await decoder.metadata();
  check((!info.pages || info.pages === 1) && ['jpeg', 'png', 'webp'].includes(info.format), 'VARIANT_LISTING_IMAGE_INVALID');
  await decoder.clone().raw().toBuffer();
  return { mimeType: `image/${info.format}`, width: info.width, height: info.height };
}

/** Serving uses exact retained bytes only; it cannot initiate an image fetch. */
export async function readSavedListingPhoto(url, sha256, { cache } = {}) {
  check(cache?.getRetained && isStaffInventoryResearchImageUrl(url) && HASH.test(sha256), 'VARIANT_LISTING_IMAGE_URL');
  const media = verifyImage(await cache.getRetained(retainedImageKey(url, sha256)), url);
  check(media.sha256 === sha256, 'VARIANT_LISTING_REFERENCE_CHANGED');
  return media;
}

/** Shared permanent public-image read for reference and market slab evidence. */
export async function readRetainedListingPhoto(url, { cache, fetchImpl = globalThis.fetch, inspectImage = decodeImage,
  now = () => Date.now(), signal, timeoutMs = VARIANT_LISTING_LIMITS.imageTimeoutMs, beforeFetch = () => {}, admitBytes = () => {} } = {}) {
  check(cache?.getRetained && cache?.put && isStaffInventoryResearchImageUrl(url), 'VARIANT_LISTING_IMAGE_URL');
  const saved = await cache.getRetained(imageKey(url));
  if (saved && Date.parse(saved.capturedAt) <= now()) return verifyImage(saved, url);
  beforeFetch();
  return boundedProviderOperation(signal, timeoutMs, async active => {
    const response = await fetchImpl(url, { method: 'GET', redirect: 'error', signal: active,
      headers: { Accept: 'image/jpeg,image/png,image/webp' } });
    check(response.ok && !response.redirected && (!response.url || response.url === url), 'VARIANT_LISTING_IMAGE_UNAVAILABLE');
    const bytes = await readBoundedProviderBody(response, active, VARIANT_LISTING_LIMITS.imageBytes);
    const metadata = await inspectImage(bytes), captured = now(); active.throwIfAborted();
    check(validMetadata(metadata) && (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() === metadata.mimeType, 'VARIANT_LISTING_IMAGE_INVALID');
    const entry = { schemaVersion: 'variant-provider-image/v1', url, body: bytes.toString('base64'), sha256: hash(bytes),
      mimeType: metadata.mimeType, width: metadata.width, height: metadata.height,
      capturedAt: new Date(captured).toISOString(), expiresAt: new Date(captured + VARIANT_LISTING_LIMITS.ttlMs).toISOString() };
    const verified = verifyImage(entry, url); admitBytes(bytes, entry.sha256); active.throwIfAborted();
    await cache.put(retainedImageKey(url, entry.sha256), entry); active.throwIfAborted();
    await cache.put(imageKey(url), entry); return verified;
  });
}

/** apiKey is optional for cold/read-only serving. Only fetchSource needs it.
 * An ambiguous dispatched GET must be reconciled by the caller, never retried
 * automatically here. Listing image requests are public bounded CDN reads. */
export function createVariantListingProvider({ apiKey = null, cache = null, fetchImpl = globalThis.fetch,
  inspectImage = decodeImage, now = () => Date.now(), timeoutMs = VARIANT_LISTING_LIMITS.timeoutMs } = {}) {
  check(apiKey === null || typeof apiKey === 'string' && apiKey.trim() === apiKey && apiKey.length > 0 && apiKey.length <= 4096, 'VARIANT_LISTING_CONFIGURATION');
  check(typeof fetchImpl === 'function' && typeof inspectImage === 'function' && typeof now === 'function'
    && Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= VARIANT_LISTING_LIMITS.timeoutMs, 'VARIANT_LISTING_CONFIGURATION');
  const requireCache = () => check(cache?.get && cache?.getRetained && cache?.put, 'VARIANT_LISTING_CACHE_REQUIRED');
  return Object.freeze({
    async fetchSource(request, { signal } = {}) {
      validateRequest(request); check(request.revision === VARIANT_GRADED_LISTING_REVISION, 'VARIANT_LISTING_RETIRED_REQUEST');
      check(apiKey !== null, 'VARIANT_LISTING_CREDENTIAL_MISSING');
      return listingOperation(request, signal, timeoutMs, async active => {
        active.throwIfAborted();
        const response = await fetchImpl(request.url, { method: 'GET', redirect: 'error', signal: active,
          headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } });
        check(!response.redirected && (!response.url || response.url === request.url), 'VARIANT_LISTING_SOURCE_REDIRECT');
        const bytes = await readBoundedProviderBody(response, active, VARIANT_LISTING_LIMITS.sourceBytes), bodyText = bytes.toString('utf8');
        const contentType = response.headers.get('content-type') ?? '';
        check(Buffer.from(bodyText).equals(bytes) && !bodyText.includes(apiKey) && !contentType.includes(apiKey), 'VARIANT_LISTING_SOURCE_UNSAFE');
        active.throwIfAborted();
        // Retain even a bounded HTTP failure for the journal's exact outcome.
        return { schemaVersion: 'variant-listing-response/v1', requestKey: request.requestKey, url: request.url,
          httpStatus: response.status, contentType, bodyText, sha256: hash(bytes), capturedAt: new Date(now()).toISOString() };
      });
    },
    async acquireImages({ request, source, catalogCandidates = [] }, { signal, imageLimit, retainedOnly = false } = {}) {
      requireCache();
      check(typeof retainedOnly === 'boolean', 'VARIANT_LISTING_READ_ONLY');
      const allPhotos = gradedRequest(request);
      imageLimit ??= allPhotos ? Infinity : VARIANT_LISTING_LIMITS.images;
      check(imageLimit === Infinity && allPhotos || Number.isInteger(imageLimit) && imageLimit > 0
        && (allPhotos || imageLimit <= VARIANT_LISTING_LIMITS.images), 'VARIANT_LISTING_IMAGE_BUDGET');
      const result = projectVariantListingSource(request, source, { catalogCandidates }), byUrl = new Map(), byHash = new Set();
      let requests = 0, totalBytes = 0, images = 0;
      return listingOperation(request, signal, timeoutMs, async active => {
        for (const listing of result.listings) {
          if (images >= imageLimit) break;
          const options = [...new Set([listing.imageOptions.full_resolution_url, listing.imageOptions.thumbnail_url].filter(Boolean))];
          for (const url of options) {
            active.throwIfAborted();
            if (!byUrl.has(url)) {
              let media = null;
              try {
                if (retainedOnly) {
                  // Historical discovery can recover saved bytes, never buy
                  // another download or decode from an old raw result page.
                  const saved = await cache.getRetained(imageKey(url));
                  if (saved && Date.parse(saved.capturedAt) <= now()) media = verifyImage(saved, url);
                } else media = await readRetainedListingPhoto(url, { cache, fetchImpl, inspectImage, now, signal: active,
                  timeoutMs: Math.min(timeoutMs, VARIANT_LISTING_LIMITS.imageTimeoutMs),
                  beforeFetch: () => { check(allPhotos || requests < VARIANT_LISTING_LIMITS.imageRequests, 'VARIANT_LISTING_IMAGE_BUDGET'); requests++; },
                  admitBytes: (bytes, sha256) => check(allPhotos || byHash.has(sha256) || totalBytes + bytes.length <= VARIANT_LISTING_LIMITS.totalImageBytes, 'VARIANT_LISTING_IMAGE_BUDGET') });
              } catch { active.throwIfAborted(); }
              // The image reader has already retained the exact bytes. Keep
              // only descriptors here so a full result page does not retain
              // every decoded/downloaded image in worker memory.
              byUrl.set(url, media ? { sha256: media.sha256, mimeType: media.mimeType,
                width: media.width, height: media.height, byteLength: media.bytes.length } : null);
            }
            const media = byUrl.get(url); if (!media) continue;
            // Already-read bytes still belong in this catalog. The Codex
            // reuses their literal reading and can revisit its association.
            if (gradedRequest(request) && byHash.has(media.sha256)) continue;
            if (!byHash.has(media.sha256)) {
              if (!allPhotos && totalBytes + media.byteLength > VARIANT_LISTING_LIMITS.totalImageBytes) continue;
              byHash.add(media.sha256); totalBytes += media.byteLength;
            }
            const image = { imageId: `listing-image:${hash(canonicalJson({ listing: listing.listing, sha256: media.sha256, sourceResponseSha256: source.sha256 }))}`,
              relationship: 'listing_photo', url, sha256: media.sha256, mimeType: media.mimeType, width: media.width, height: media.height,
              sourceResponseSha256: source.sha256, listing: listing.listing };
            validateImageDescriptor(image); active.throwIfAborted();
            if (!retainedOnly) await cache.put(referenceKey(image), { schemaVersion: 'variant-listing-reference/v1', image,
              sourceUrl: source.url, capturedAt: source.capturedAt, expiresAt: new Date(Date.parse(source.capturedAt) + VARIANT_LISTING_LIMITS.ttlMs).toISOString() });
            listing.image = image; images++; break;
          }
        }
        return { ...result, ...(gradedRequest(request) ? {
          referencePhotos: result.listings.filter(v => v.image).map(v => catalogListingImage(v.image, result.source)),
        } : {}), acquisition: { requests, images, uniqueImages: byHash.size, bytes: totalBytes },
          warnings: [...result.warnings, ...(result.listings.some(v => !v.image) ? ['LISTING_IMAGES_INCOMPLETE'] : [])] };
      });
    },
    async readImage(image, { signal } = {}) {
      requireCache();
      const sourceUrl = image?.provenance?.sourceUrl;
      if (image?.provenance) {
        check(keys(image, ['imageId', 'relationship', 'url', 'sha256', 'mimeType', 'width', 'height', 'sourceResponseSha256', 'listing',
          'publication', 'provenance', 'visibleDiagnosticIds']) && image.publication === null && same(image.visibleDiagnosticIds, [])
          && keys(image.provenance, ['provider', 'sourceUrl', 'sourceSha256', 'usage'])
          && image.provenance.provider === listingProviderId && image.provenance.usage === 'provider_reference'
          && image.provenance.sourceSha256 === image.sourceResponseSha256, 'VARIANT_LISTING_IMAGE_DESCRIPTOR');
        const { publication, provenance, visibleDiagnosticIds, ...descriptor } = image; image = descriptor;
      }
      validateImageDescriptor(image); signal?.throwIfAborted();
      const reference = await cache.getRetained(referenceKey(image));
      check(reference?.schemaVersion === 'variant-listing-reference/v1' && same(reference.image, image)
        && (sourceUrl === undefined || sourceUrl === reference.sourceUrl), 'VARIANT_LISTING_REFERENCE_UNAVAILABLE');
      const entry = await cache.getRetained(retainedImageKey(image.url, image.sha256));
      const media = verifyImage(entry, image.url); signal?.throwIfAborted();
      check(['sha256', 'mimeType', 'width', 'height'].every(k => media[k] === image[k]), 'VARIANT_LISTING_REFERENCE_CHANGED');
      return media;
    },
  });
}
