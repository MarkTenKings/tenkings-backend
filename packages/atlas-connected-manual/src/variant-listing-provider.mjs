import { createHash } from 'node:crypto';
import { canonicalJson, normalizeVariantIdentity, compareVariantIdentity, compareVariantCardNumber,
  variantCandidateId, validateVariantCandidate, VARIANT_REVIEW_LIMITS } from '@tenkings/card-catalog-evidence';
import { buildEbaySoldCompsV2Query, parseEbaySoldCompsV2Candidate,
  EBAY_SOLD_COMPS_V2_ATLAS_MATCHING_POLICY, EBAY_SOLD_COMPS_V2_CLASSIFICATION_REVISION } from '@tenkings/ebay-sold-comps-v2';
import { inspectStaffInventoryResearchSale, inspectStaffInventoryResearchTitle } from '@tenkings/card-research-core/decisions';
import { isStaffInventoryResearchImageUrl } from '@tenkings/card-research-core/contract';
import { researchImageOptions, researchSaleEvidence } from '../../card-research-core/src/evidence.mjs';
import { boundedProviderOperation, readBoundedProviderBody } from '../../card-catalog-evidence/src/provider-media.mjs';

// The caller MUST durably journal fetchSource before dispatch. Seller photos
// never establish catalog authority or select the physical card's variant.
export const VARIANT_LISTING_REVISION = 'variant-listing-2026-10-10-v2';
export const VARIANT_LISTING_LIMITS = Object.freeze({ results: 40, sourceBytes: 1024 * 1024,
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
function productParts(identity) {
  const parts = identity.category === 'SPORTS' ? identity.setName.split(/\s+[—–]\s+/u) : [];
  return parts.length === 2 && parts.every(Boolean) ? { product: parts[0], insert: parts[1] }
    : { product: identity.setName, insert: null };
}
function engineInput(identity) {
  const { product, insert } = productParts(identity);
  return { matchingPolicy: EBAY_SOLD_COMPS_V2_ATLAS_MATCHING_POLICY, category: identity.category,
    year: identity.year, manufacturer: identity.manufacturer, productSet: product, insert,
    ...(identity.category === 'SPORTS' ? { playerName: identity.name } : { cardName: identity.name }),
    cardNumber: identity.cardNumber, parallel: null,
    variantIdentity: { language: languageNames[identity.language] ?? identity.language } };
}
/** One public identity => one request key. No physical photo, grade, approval,
 * generation or time bucket changes its billing identity. */
export function prepareVariantListingRequest(input) {
  const fields = ['category', 'name', 'year', 'setName', 'cardNumber', 'manufacturer', 'language'];
  check(input && Object.keys(input).every(k => fields.includes(k)), 'VARIANT_LISTING_IDENTITY');
  const normalized = normalizeVariantIdentity(Object.fromEntries(Object.entries(input).map(([k, v]) => [k, typeof v === 'string' ? normalize(v) : v])));
  const identity = normalizeVariantIdentity(Object.fromEntries(Object.entries(normalized).map(([k, v]) => [k,
    v === null || k === 'category' ? v : k === 'cardNumber' ? canonicalNumber(v) : v.toLowerCase()])));
  check(identity.name && identity.year && identity.setName && identity.cardNumber
    && (identity.category !== 'SPORTS' || identity.manufacturer), 'VARIANT_LISTING_IDENTITY_INCOMPLETE');
  const query = buildEbaySoldCompsV2Query(engineInput(identity));
  const url = new URL(endpoint);
  url.search = new URLSearchParams({ keyword: query, ebaySite: 'ebay.com', count: String(VARIANT_LISTING_LIMITS.results),
    page: '1', sold: 'true', includeCompleteListing: 'true', exactMatch: 'true', hydrateBoa: 'false' }).toString();
  const request = { schemaVersion: 'variant-listing-request/v1', revision: VARIANT_LISTING_REVISION,
    parserRevision: EBAY_SOLD_COMPS_V2_CLASSIFICATION_REVISION, identity, query, url: url.href };
  return { ...request, requestKey: `variant-listing-source:v1:${hash(canonicalJson(request))}` };
}
function validateRequest(request) {
  check(same(prepareVariantListingRequest(request?.identity), request), 'VARIANT_LISTING_REQUEST_CHANGED');
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
    && payload.items.length <= VARIANT_LISTING_LIMITS.results && payload.totalItems >= payload.items.length, 'VARIANT_LISTING_SOURCE_SHAPE');
  return payload;
}
function inspectIdentity(identity, candidate) {
  const { product, insert } = productParts(identity);
  const description = { category: identity.category === 'SPORTS' ? 'Sports cards' : 'Pokemon cards',
    name: identity.name, year: identity.year, set_name: product, manufacturer: identity.manufacturer,
    card_number: collector(identity.cardNumber), card_type: insert, variant: null };
  const normalizedCandidate = { title: collector(candidate.title) };
  const evidence = inspectStaffInventoryResearchTitle(description, normalizedCandidate);
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
function compatibleScrydexPhoto(candidate, listing, target) {
  if (candidate.source.provider !== 'scrydex' || candidate.parallel === null || candidate.authority !== 'provider_candidate') return false;
  const comparison = compareVariantIdentity(target, candidate.identity), observed = listingFacts(listing), expected = variantSignature(candidate.parallel);
  if (comparison.conflicts.length || !expected || compareVariantCardNumber(target.cardNumber, candidate.identity.cardNumber) !== 'match'
    || listing.identityEvidence.reason_codes.includes('collector_denominator_missing')
    || observed.language.length !== 1 || languageCodes[observed.language[0]] !== candidate.identity.language) return false;
  if (observed.serialDenominators.length || observed.autograph !== null || observed.memorabilia !== null || observed.promo !== null) return false;
  return ['finish', 'edition', 'stamp'].every(k => same([...expected[k]].sort(), [...observed[k]].sort()));
}
function catalogListingImage(image, source) {
  validateImageDescriptor(image);
  check(image.sourceResponseSha256 === source.sha256, 'VARIANT_LISTING_IMAGE_SOURCE');
  return { ...image, publication: null, provenance: { provider: listingProviderId,
    sourceUrl: source.url, sourceSha256: source.sha256, usage: 'provider_reference' }, visibleDiagnosticIds: [] };
}
/** Keep provider choice names intact; compatible listing photos remain a
 * separate provenance branch. Incomplete claims stay independent choices. */
export function composeVariantListingCandidates({ identity, candidates = [], evidence }) {
  const request = prepareVariantListingRequest(identity), target = normalizeVariantIdentity(identity);
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
    const matches = choices.filter(c => compatibleScrydexPhoto(c, listing, request.identity));
    // More than one compatible named choice is ambiguous; keep it independent.
    if (matches.length === 1 && matches[0].images.length < VARIANT_REVIEW_LIMITS.imagesPerCandidate
      && matches[0].source.references.length < 8) {
      const c = matches[0];
      if (!c.images.some(i => i.imageId === image.imageId)) c.images.push(image);
      const reference = { url: evidence.source.url, sha256: evidence.source.sha256 };
      if (!c.source.references.some(r => same(r, reference))) c.source.references.push(reference);
      c.warnings = [...new Set([...c.warnings.filter(v => v !== 'REFERENCE_IMAGE_MISSING'), ...listingWarnings])];
      continue;
    }
    const observed = listingFacts(listing), claimed = claimedParallel(observed), parallel = claimed && claimed.length <= 120 ? claimed : null;
    const c = { authority: 'provider_candidate', label: parallel ? `Listing: ${parallel}` : 'Listing photo — variant unconfirmed',
      identity: { ...target, language: observed.language.length === 1 ? languageCodes[observed.language[0]] ?? null : null },
      parallel, canonical: null, applicability: 'unknown', diagnostics: [], images: [image],
      source: { provider: listingProviderId, recordId: listing.listing.id, url: evidence.source.url, sha256: evidence.source.sha256,
        references: [{ url: evidence.source.url, sha256: evidence.source.sha256 }] },
      warnings: [...listingWarnings, 'APPLICABILITY_UNCONFIRMED', ...(!parallel ? ['FINISH_UNVERIFIED'] : []),
        ...(observed.language.length !== 1 ? ['LANGUAGE_UNCONFIRMED'] : []),
        ...(listing.identityEvidence.reason_codes.includes('collector_denominator_missing') ? ['DENOMINATOR_UNVERIFIED'] : [])] };
    choices.push({ ...c, candidateId: variantCandidateId(c) });
  }
  truncated ||= choices.length > VARIANT_REVIEW_LIMITS.candidates;
  return { candidates: choices.slice(0, VARIANT_REVIEW_LIMITS.candidates).map(validateVariantCandidate),
    problems: truncated ? ['PROVIDER_TRUNCATED'] : [], truncated };
}
/** Pure projection; raw source retains prices but this visual-discovery result
 * deliberately contains none. A seller's title is a claim, never publication. */
export function projectVariantListingSource(request, source) {
  const payload = validateSource(request, source), input = engineInput(request.identity), listings = [], excluded = [];
  const seen = new Map(), conflicts = new Set();
  for (const raw of payload.items) {
    const id = typeof raw?.itemId === 'string' && /^\d{6,20}$/.test(raw.itemId) ? raw.itemId : null;
    if (id && seen.has(id) && JSON.stringify(seen.get(id)) !== JSON.stringify(raw)) conflicts.add(id);
    if (id) seen.set(id, raw);
  }
  const processed = new Set();
  for (const raw of payload.items) {
    const id = typeof raw?.itemId === 'string' && /^\d{6,20}$/.test(raw.itemId) ? raw.itemId : null;
    if (id && processed.has(id)) continue;
    if (id) processed.add(id);
    const reject = reason => excluded.push({ listingId: id, reason });
    if (id && conflicts.has(id)) { reject('CONFLICTING_LISTING_EVIDENCE'); continue; }
    const candidate = parseEbaySoldCompsV2Candidate(raw, input);
    if (!candidate) { reject('INVALID_OR_UNANCHORED_LISTING'); continue; }
    if (researchSaleEvidence(raw).sale_evidence.status !== 'sold') { reject('SOLD_EVENT_UNVERIFIED'); continue; }
    if (!inspectStaffInventoryResearchSale(candidate).supported) { reject('UNSUPPORTED_SINGLE_CARD_LISTING'); continue; }
    const identityEvidence = inspectIdentity(request.identity, candidate);
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
      ...(payload.hasNextPage || payload.totalItems > payload.items.length ? ['SOURCE_TRUNCATED'] : [])] };
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
    && keys(image.listing, ['id', 'title', 'url']) && /^\d{6,20}$/.test(image.listing.id)
    && image.listing.url === `https://www.ebay.com/itm/${image.listing.id}`
    && typeof image.listing.title === 'string' && image.listing.title.length > 0 && image.listing.title.length <= 500
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
      validateRequest(request); check(apiKey !== null, 'VARIANT_LISTING_CREDENTIAL_MISSING');
      return boundedProviderOperation(signal, timeoutMs, async active => {
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
    async acquireImages({ request, source }, { signal } = {}) {
      requireCache();
      const result = projectVariantListingSource(request, source), byUrl = new Map(), byHash = new Set();
      let requests = 0, totalBytes = 0, images = 0;
      return boundedProviderOperation(signal, timeoutMs, async active => {
        for (const listing of result.listings) {
          if (images >= VARIANT_LISTING_LIMITS.images) break;
          const options = [...new Set([listing.imageOptions.full_resolution_url, listing.imageOptions.thumbnail_url].filter(Boolean))];
          for (const url of options) {
            active.throwIfAborted();
            if (!byUrl.has(url)) {
              let media = null;
              try {
                const saved = await cache.get(imageKey(url));
                if (saved && Date.parse(saved.expiresAt) > now() && Date.parse(saved.capturedAt) <= now()) media = verifyImage(saved, url);
                else if (requests < VARIANT_LISTING_LIMITS.imageRequests) {
                  requests++;
                  media = await boundedProviderOperation(active, Math.min(timeoutMs, VARIANT_LISTING_LIMITS.imageTimeoutMs), async imageSignal => {
                    const response = await fetchImpl(url, { method: 'GET', redirect: 'error', signal: imageSignal,
                      headers: { Accept: 'image/jpeg,image/png,image/webp' } });
                    check(response.ok && !response.redirected && (!response.url || response.url === url), 'VARIANT_LISTING_IMAGE_UNAVAILABLE');
                    const bytes = await readBoundedProviderBody(response, imageSignal, VARIANT_LISTING_LIMITS.imageBytes);
                    const metadata = await inspectImage(bytes), captured = now(); imageSignal.throwIfAborted();
                    check(validMetadata(metadata) && (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() === metadata.mimeType, 'VARIANT_LISTING_IMAGE_INVALID');
                    const entry = { schemaVersion: 'variant-provider-image/v1', url, body: bytes.toString('base64'), sha256: hash(bytes),
                      mimeType: metadata.mimeType, width: metadata.width, height: metadata.height,
                      capturedAt: new Date(captured).toISOString(), expiresAt: new Date(captured + VARIANT_LISTING_LIMITS.ttlMs).toISOString() };
                    const verified = verifyImage(entry, url);
                    check(byHash.has(entry.sha256) || totalBytes + bytes.length <= VARIANT_LISTING_LIMITS.totalImageBytes, 'VARIANT_LISTING_IMAGE_BUDGET');
                    imageSignal.throwIfAborted();
                    await cache.put(retainedImageKey(url, entry.sha256), entry); imageSignal.throwIfAborted();
                    await cache.put(imageKey(url), entry); return verified;
                  });
                }
              } catch { active.throwIfAborted(); }
              byUrl.set(url, media);
            }
            const media = byUrl.get(url); if (!media) continue;
            if (!byHash.has(media.sha256)) {
              if (totalBytes + media.bytes.length > VARIANT_LISTING_LIMITS.totalImageBytes) continue;
              byHash.add(media.sha256); totalBytes += media.bytes.length;
            }
            const image = { imageId: `listing-image:${hash(canonicalJson({ listing: listing.listing, sha256: media.sha256, sourceResponseSha256: source.sha256 }))}`,
              relationship: 'listing_photo', url, sha256: media.sha256, mimeType: media.mimeType, width: media.width, height: media.height,
              sourceResponseSha256: source.sha256, listing: listing.listing };
            validateImageDescriptor(image); active.throwIfAborted();
            await cache.put(referenceKey(image), { schemaVersion: 'variant-listing-reference/v1', image,
              sourceUrl: source.url, capturedAt: source.capturedAt, expiresAt: new Date(Date.parse(source.capturedAt) + VARIANT_LISTING_LIMITS.ttlMs).toISOString() });
            listing.image = image; images++; break;
          }
        }
        return { ...result, acquisition: { requests, images, uniqueImages: byHash.size, bytes: totalBytes },
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
