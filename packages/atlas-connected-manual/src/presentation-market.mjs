import { canonical, digest, requireThat } from '@atlas/manual-service/contract';
import { parsePublicManualReport } from '@atlas/report-view/manual-public-contract';
import { projectSelectedSoldReferences, projectSelectedSlabReferences } from '@atlas/report-view/sold-reference-projection';
import { inspectStaffInventoryResearchSale, inspectStaffInventoryResearchTitle } from '@tenkings/card-research-core/decisions';
import { EBAY_SOLD_COMPS_V2_CLASSIFICATION_REVISION, EBAY_SOLD_COMPS_V2_ENGINE_VERSION, EBAY_SOLD_COMPS_V2_SOURCE } from '@tenkings/ebay-sold-comps-v2';

import { publishedResearchQuery } from './research-market-query.mjs';

export const MARKET_UNAVAILABLE_REASONS = Object.freeze(['PROVIDER_NOT_CONFIGURED', 'PROVIDER_CONFIGURATION_ERROR', 'PROVIDER_QUOTA_REACHED', 'PROVIDER_REQUEST_LIMITED']);

const same = (a, b) => canonical(a) === canonical(b);
const fail = code => requireThat(false, 409, code);

// Leading zeroes are typography, while a provided collector denominator is
// identity. A numerator-only title is incomplete evidence, never a different
// printing merely because the seller omitted the denominator.
const collectorTypography = text => String(text).replace(/\b([A-Za-z]*)0+(\d+)\b/g, '$1$2');
function inspectIdentity(description, candidate) {
  const normalizedDescription = { ...description, card_number: description.card_number === null ? null : collectorTypography(description.card_number) };
  const normalizedCandidate = { ...candidate, title: collectorTypography(candidate.title) };
  const evidence = inspectStaffInventoryResearchTitle(normalizedDescription, normalizedCandidate);
  if (normalizedDescription.category === 'Pokemon cards' && normalizedDescription.card_number?.includes('/')
    && evidence.reason_codes.includes('card_number_conflict')) {
    const numerator = inspectStaffInventoryResearchTitle({ ...normalizedDescription, card_number: normalizedDescription.card_number.split('/')[0] }, normalizedCandidate);
    if (!numerator.reason_codes.includes('card_number_conflict')) {
      evidence.reason_codes = evidence.reason_codes.filter(code => code !== 'card_number_conflict');
      evidence.reason_codes.push('collector_denominator_missing');
      evidence.estimate_anchored = false;
    }
  }
  return evidence;
}

const queryText = value => String(value ?? '').normalize('NFC').replace(/[—–]/g, '-').replace(/\s+/g, ' ').trim();

/** Search using the approved identity and its recorded final award. The generic
 * graded term does not translate that award into another company's grade. */
export function publishedMarketQuery({ packet, publicHash }, { savedQuery, savedInput } = {}) {
  requireThat(typeof publicHash === 'string' && /^[a-f0-9]{64}$/.test(publicHash)
    && digest(JSON.stringify(packet)) === publicHash, 409, 'MARKET_PUBLICATION_MISMATCH');
  const parsed = parsePublicManualReport(packet), identity = parsed.report.identity;
  const identityInput = { matchingPolicy: 'ATLAS_IDENTITY_V1', category: parsed.report.cardProfile, year: identity.year, productSet: identity.productSet,
    ...(parsed.report.cardProfile === 'SPORTS' ? { playerName: identity.playerName, manufacturer: identity.manufacturer }
      : { cardName: identity.cardName }), parallel: identity.parallel, cardNumber: identity.cardNumber,
    ...('insert' in identity ? { insert: identity.insert } : {}) };
  const cardNumber = queryText(identity.cardNumber).replace(/^(?:#\s*)+/, '');
  const setName = queryText(String(identity.productSet ?? '').replace(/[—–]/g, ' ').replace(/\s+-\s+/g, ' '));
  const currentQuery = [parsed.report.cardProfile === 'SPORTS' ? identity.manufacturer : 'Pokémon', identity.year,
    ...(parsed.report.cardProfile === 'POKEMON' ? [setName] : []), identity.playerName ?? identity.cardName,
    cardNumber ? `#${cardNumber}` : null, 'graded', parsed.report.finalGrade].map(queryText).filter(Boolean).join(' ');
  // Saved queries are immutable evidence bound by the job/preview to this exact
  // publication. Recovery and page continuation preserve that exact query.
  const query = savedQuery ?? currentQuery;
  requireThat(typeof query === 'string' && query.trim() === query && query.length > 0 && query.length <= 400
    && !/[\x00-\x1f\x7f]/.test(query), 409, 'MARKET_PUBLICATION_MISMATCH');
  let input = { ...identityInput, queryOverride: query };
  if (savedInput !== undefined) {
    if (!Object.hasOwn(savedInput ?? {}, 'matchingPolicy')) delete input.matchingPolicy;
    if (!Object.hasOwn(savedInput ?? {}, 'queryOverride')) delete input.queryOverride;
    requireThat(same(input, savedInput), 409, 'MARKET_PUBLICATION_MISMATCH');
    input = structuredClone(savedInput);
  }
  return { binding: { publicToken: parsed.publicToken, approvalVersion: parsed.approvalVersion, publicHash },
    identityHash: digest(canonical(identity)), input, query, atlasGrade: parsed.report.finalGrade };
}

export const marketPreviewHash = preview => digest(canonical(preview, {
  maxBytes: preview?.version === 'atlas-market-preview-v2' ? 16777216 : 262144,
}));

function prepareSlabPreview(context, result) {
  requireThat(result?.responsePolicy === 'ATLAS_SLAB_V1' && result.source === EBAY_SOLD_COMPS_V2_SOURCE
    && result.engineVersion === EBAY_SOLD_COMPS_V2_ENGINE_VERSION && result.query === context.query
    && typeof result.retrievedAt === 'string' && Number.isFinite(Date.parse(result.retrievedAt))
    && Array.isArray(result.items) && new Set(result.items.map(item => item.id)).size === result.items.length
    && result.imageMatch?.policy === 'atlas-market-slab-label-v1' && Array.isArray(result.imageMatch.readings)
    && new Set(result.imageMatch.readings.map(reading => reading.rowId)).size === result.imageMatch.readings.length
    && result.imageMatch.readings.every(reading => result.items.some(item => item.id === reading.rowId)),
  502, 'MARKET_PROVIDER_RESULT_INVALID');
  const counts = { returned: result.items.length, missingImage: 0, unreadGrade: 0, differentIdentity: 0, outsideGrade: 0, raw: 0, graded: 0, recommended: 0, shown: 0 };
  const labelProcessing = { state: 'COMPLETE', completed: 0, failed: 0, unknown: 0, unavailable: 0, reasons: [] };
  const readings = result.items.map(item => {
    const reading = result.imageMatch.readings.find(value => value.rowId === item.id)
      ?? { rowId: item.id, imageUrl: item.imageUrl, sha256: null, numericGrade: null, gradingCompany: null, labelText: null,
        identityMatch: 'UNCERTAIN', evidenceKind: 'UNCERTAIN', reason: 'Photograph has not been read.' };
    if (!item.imageUrl) counts.missingImage++;
    const outcome = reading.outcome ?? (!item.imageUrl ? 'UNAVAILABLE' : reading.labelText || Number.isFinite(reading.numericGrade) || reading.evidenceKind === 'RAW' ? 'COMPLETE' : 'FAILED');
    requireThat(['COMPLETE','FAILED','UNKNOWN','UNAVAILABLE'].includes(outcome), 502, 'MARKET_PROVIDER_RESULT_INVALID');
    labelProcessing[{ COMPLETE: 'completed', FAILED: 'failed', UNKNOWN: 'unknown', UNAVAILABLE: 'unavailable' }[outcome]]++;
    if (reading.failureCode && !labelProcessing.reasons.includes(reading.failureCode)) labelProcessing.reasons.push(reading.failureCode);
    const evidenceKind = reading.evidenceKind ?? (Number.isFinite(reading.numericGrade) ? 'SLABBED' : 'UNCERTAIN');
    if (evidenceKind === 'RAW') counts.raw++;
    if (evidenceKind === 'SLABBED') counts.graded++;
    if (!Number.isFinite(reading.numericGrade)) counts.unreadGrade++;
    if (reading.identityMatch === 'DIFFERENT') counts.differentIdentity++;
    const nearbyGrade = Number.isFinite(reading.numericGrade) && Math.abs(reading.numericGrade - context.atlasGrade) <= 1;
    if (Number.isFinite(reading.numericGrade) && !nearbyGrade) counts.outsideGrade++;
    const recommended = reading.identityMatch === 'MATCH' && nearbyGrade;
    if (recommended) counts.recommended++;
    return { ...reading, evidenceKind, nearbyGrade, recommended };
  });
  if (labelProcessing.failed || labelProcessing.unknown) labelProcessing.state = 'PARTIAL';
  const evidence = { ...result, imageMatch: { ...result.imageMatch, readings } };
  const sales = projectSelectedSlabReferences(evidence, result.items.map(item => item.id), context.atlasGrade)?.sales ?? [];
  const candidates = sales.map(sale => {
    const reading = readings.find(value => value.rowId === sale.id), item = result.items.find(value => value.id === sale.id);
    const sourceItem = { id: sale.id, title: sale.title, listingUrl: sale.listingUrl, imageUrl: sale.imageUrl, soldDate: sale.soldAt,
      providerItemId: item.providerItemId ?? null, sourceIndex: item.sourceIndex ?? null,
      reportedPrice: sale.reportedPrice, soldPriceCents: sale.priceMinor, currency: sale.currency,
      priceBasis: sale.priceBasis === 'sold' ? 'EXACT' : sale.priceBasis === 'accepted_offer_unknown' ? 'UPPER_BOUND' : 'UNKNOWN' };
    const slabReading = { rowId: reading.rowId, sha256: reading.sha256 ?? null, imageUrl: sale.imageUrl,
      gradingCompany: reading.gradingCompany ?? null, numericGrade: reading.numericGrade ?? null,
      identityMatch: reading.identityMatch, evidenceKind: reading.evidenceKind, reason: reading.reason ?? null };
    return { sale, match: reading.identityMatch, matchReason: reading.reason ?? 'Photograph has not been read.',
      nearbyGrade: reading.nearbyGrade, recommended: reading.recommended, requiresReview: true, sourceItem, slabReading };
  });
  counts.shown = candidates.length;
  return { version: 'atlas-market-preview-v2', ...context, source: result.source, engineVersion: result.engineVersion,
    responsePolicy: result.responsePolicy, retrievedAt: result.retrievedAt, candidates, counts, labelProcessing,
    ...(result.pagination ? { pagination: structuredClone(result.pagination) } : {}),
    acquisitionDiagnostics: structuredClone(result.acquisitionDiagnostics), imageMatchCounts: structuredClone(result.imageMatch.counts ?? {}) };
}

function preparePreview(context, result) {
  requireThat(result?.source === EBAY_SOLD_COMPS_V2_SOURCE && result.engineVersion === EBAY_SOLD_COMPS_V2_ENGINE_VERSION
    && result.query === context.query && Array.isArray(result.candidates) && result.candidates.length <= 60
    && result.candidates.every(value => value && typeof value.id === 'string')
    && new Set(result.candidates.map(value => value.id)).size === result.candidates.length
    && typeof result.retrievedAt === 'string' && Number.isFinite(Date.parse(result.retrievedAt)), 502, 'MARKET_PROVIDER_RESULT_INVALID');
  const hasClassification = Object.hasOwn(result, 'classificationRevision') || Object.hasOwn(result, 'classificationExcluded');
  const classificationExcluded = hasClassification ? result.classificationExcluded : [];
  requireThat(!hasClassification || result.classificationRevision === EBAY_SOLD_COMPS_V2_CLASSIFICATION_REVISION
    && Array.isArray(classificationExcluded) && classificationExcluded.length + result.candidates.length <= 60
    && classificationExcluded.every(value => value && Object.keys(value).sort().join(',') === 'id,reason'
      && typeof value.id === 'string' && /^ebay:\d{6,20}$/.test(value.id)
      && value.reason === 'UNANCHORED_MULTI_CARD_LISTING')
    && new Set([...result.candidates, ...classificationExcluded].map(value => value.id)).size === result.candidates.length + classificationExcluded.length,
  502, 'MARKET_PROVIDER_RESULT_INVALID');
  const candidates = [], excluded = { undisclosedOrUnsupported: classificationExcluded.length, contradictory: 0 };
  const description = { category: context.input.category === 'SPORTS' ? 'Sports cards' : 'Pokemon cards',
    name: context.input.playerName ?? context.input.cardName, year: context.input.year,
    manufacturer: context.input.manufacturer ?? null, set_name: [context.input.productSet, context.input.insert].filter(Boolean).join(' '),
    card_number: context.input.cardNumber ?? null, variant: context.input.parallel ?? null, card_type: null };
  for (const candidate of result.candidates) {
    const titleEvidence = inspectIdentity(description, candidate);
    const saleEvidence = inspectStaffInventoryResearchSale(candidate);
    const contradictory = titleEvidence.reason_codes.some(code => ['sport_conflict', 'product_title_conflict', 'variant_title_conflict',
      'release_year_conflict', 'card_number_conflict'].includes(code));
    if (contradictory || candidate.parallelMatch === 'CONTRADICTORY' || candidate.variantEvidence?.status === 'CONTRADICTORY') { excluded.contradictory++; continue; }
    if (!saleEvidence.supported) { excluded.undisclosedOrUnsupported++; continue; }
    const identityEvidence = { status: titleEvidence.estimate_anchored ? 'MATCH' : 'UNKNOWN', reasonCodes: titleEvidence.reason_codes };
    let sale;
    try { sale = projectSelectedSoldReferences({ ...result, candidates: [{ ...candidate, identityEvidence }] }, [candidate.id]).sales[0]; }
    catch { excluded.undisclosedOrUnsupported++; continue; }
    if (!['MATCH', 'UNKNOWN'].includes(candidate.parallelMatch) || !Number.isFinite(candidate.matchScore)
      || typeof candidate.matchReason !== 'string' || candidate.matchReason.length > 2000) {
      excluded.undisclosedOrUnsupported++; continue;
    }
    const match = candidate.parallelMatch === 'MATCH' && identityEvidence.status === 'MATCH' ? 'MATCH' : 'UNKNOWN';
    candidates.push({ sale, match, matchScore: candidate.matchScore,
      matchReason: candidate.matchReason, identityEvidence, ...(candidate.variantEvidence ? { variantEvidence: candidate.variantEvidence } : {}), requiresReview: true });
  }
  return { version: 'atlas-market-preview-v1', ...context, source: result.source, engineVersion: result.engineVersion,
    retrievedAt: result.retrievedAt, candidates, excluded,
    ...(hasClassification ? { classificationRevision: result.classificationRevision, classificationExcluded: structuredClone(classificationExcluded) } : {}) };
}

/** Server-side adapter only; constructing it never calls a provider. The caller
 * retains the returned preview/hash in trusted storage. select() must receive
 * that stored object, not a client-provided preview or self-declared hash.
 * The staff request supplies only its saved preview id and chosen candidate ids.
 * No endpoint, live credential, persistence or automatic pricing is enabled here.
 */
// Explicit research projects its separately journaled result. This helper has
// no provider capability and is never an automatic-market fallback.
export function projectResearchMarketPreview(source, result) {
  const context = publishedResearchQuery(source, { savedQuery: result?.query });
  const preview = preparePreview(context, result);
  return { state: 'READY', preview, sourceHash: marketPreviewHash(preview) };
}

export function createPresentationMarket() {
  return Object.freeze({
    project(source, result) {
      requireThat(result?.responsePolicy === 'ATLAS_SLAB_V1', 502, 'MARKET_PROVIDER_POLICY_INVALID');
      const context = publishedMarketQuery(source, { savedQuery: result.query });
      const preview = prepareSlabPreview(context, result);
      return { state: 'READY', preview, sourceHash: marketPreviewHash(preview) };
    },
    select({ packet, publicHash, preview, sourceHash, selectedIds }) {
      requireThat(['atlas-market-preview-v1', 'atlas-market-preview-v2'].includes(preview?.version) && /^[a-f0-9]{64}$/.test(sourceHash ?? '')
        && marketPreviewHash(preview) === sourceHash, 409, 'MARKET_PREVIEW_MISMATCH');
      const context = (preview.version === 'atlas-market-preview-v1' ? publishedResearchQuery : publishedMarketQuery)({ packet, publicHash }, { savedQuery: preview.query, savedInput: preview.input });
      for (const key of ['binding', 'identityHash', 'input', 'query', 'atlasGrade']) {
        if (!same(context[key], preview[key])) fail('MARKET_PUBLICATION_MISMATCH');
      }
      if (preview.version === 'atlas-market-preview-v2') {
        requireThat(preview.responsePolicy === 'ATLAS_SLAB_V1' && preview.source === EBAY_SOLD_COMPS_V2_SOURCE
          && preview.engineVersion === EBAY_SOLD_COMPS_V2_ENGINE_VERSION && Array.isArray(preview.candidates)
          && Array.isArray(selectedIds)
          && new Set(selectedIds).size === selectedIds.length, 409, 'MARKET_SELECTION_INVALID');
        return projectSelectedSlabReferences({ responsePolicy: preview.responsePolicy, retrievedAt: preview.retrievedAt,
          items: preview.candidates.map(value => value.sourceItem),
          imageMatch: { readings: preview.candidates.map(value => ({ ...value.slabReading, labelText: value.sale.labelText })) } }, selectedIds, context.atlasGrade);
      }
      requireThat(preview.source === EBAY_SOLD_COMPS_V2_SOURCE && preview.engineVersion === EBAY_SOLD_COMPS_V2_ENGINE_VERSION
        && Array.isArray(preview.candidates) && preview.candidates.length <= 60
        && Array.isArray(selectedIds) && selectedIds.length <= 60 && new Set(selectedIds).size === selectedIds.length,
      409, 'MARKET_SELECTION_INVALID');
      // Reproject the saved allowlisted sale evidence; selecting unknown ids,
      // contradictory or excluded rows cannot introduce a fallback candidate.
      const result = { source: preview.source, engineVersion: preview.engineVersion, retrievedAt: preview.retrievedAt,
        candidates: preview.candidates.map(value => ({ id: value.sale.id, title: value.sale.title, listingUrl: value.sale.listingUrl,
          source: preview.source, raw: value.sale.raw === true, grader: value.sale.grader, numericGrade: value.sale.raw ? null : Number(value.sale.grade),
          ...(Object.hasOwn(value.sale, 'raw') ? { gradeEvidence: { status: value.sale.raw ? 'RAW' : 'GRADED', designation: value.sale.designation } } : {}),
          presentationMetadata: value.sale,
          soldPriceCents: value.sale.priceMinor, soldDate: value.sale.soldAt?.slice(0, 10) ?? null, parallelMatch: value.match })) };
      return projectSelectedSoldReferences(result, selectedIds);
    },
  });
}
