import { canonical, digest, requireThat } from '@atlas/manual-service/contract';
import { isScrydexMetadataUrl, compareVariantCardNumber } from '@tenkings/card-catalog-evidence';
import { parsePublicManualReport } from '@atlas/report-view/manual-public-contract';
import { projectSelectedSoldReferences, projectSelectedSlabReferences } from '@atlas/report-view/sold-reference-projection';
import { inspectStaffInventoryResearchSale, inspectStaffInventoryResearchTitle } from '@tenkings/card-research-core/decisions';
import { buildEbaySoldCompsV2Query, EbaySoldCompsV2Error, EBAY_SOLD_COMPS_V2_CLASSIFICATION_REVISION, EBAY_SOLD_COMPS_V2_ENGINE_VERSION, EBAY_SOLD_COMPS_V2_SOURCE } from '@tenkings/ebay-sold-comps-v2';

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

const queryText = value => String(value ?? '').normalize('NFC').replace(/[—–]/g, ' ').replace(/\s+/g, ' ').trim();
const queryNorm = value => queryText(value).toLowerCase();
function approvedMarketQuery(input, grade, fullSetName = input.productSet) {
  const parts = [], append = value => {
    const part = queryText(value);
    if (part && !(` ${parts.join(' ').toLowerCase()} `).includes(` ${part.toLowerCase()} `)) parts.push(part);
  };
  append(input.year);
  if (input.category === 'SPORTS' && !queryNorm(fullSetName).includes(queryNorm(input.manufacturer))) append(input.manufacturer);
  let product = queryText(fullSetName);
  if (product.toLowerCase().startsWith(`${queryText(input.year).toLowerCase()} `)) product = product.slice(queryText(input.year).length).trim();
  append(product); append(input.playerName ?? input.cardName); append(input.insert);
  let printing = queryText(input.parallel).replace(/\bEnglish\b/ig, '').replace(/\bCosmos?\b/ig, 'Cosmo')
    .replace(/\b(?:Holofoil|Holographic)\b/ig, 'Holo').replace(/\b(?:Base|Standard|Regular|None)(?: Card)?\b/ig, '').trim();
  const insert = queryText(input.insert);
  if (insert && printing.toLowerCase().startsWith(`${insert.toLowerCase()} `)) printing = printing.slice(insert.length).trim();
  append(printing);
  append(collectorTypography(input.cardNumber ?? '').replace(/#/g, ''));
  const suffix = `grade ${grade}`, prefix = parts.join(' '), max = 400 - suffix.length - 1;
  return `${prefix.length <= max ? prefix : prefix.slice(0, max + 1).replace(/\s+\S*$/, '').trim()} ${suffix}`;
}
function validatedQueryContext(source, context) {
  if (context == null) return null;
  const identity = source.packet.report.identity, expansion = context.expansion, card = context.card;
  requireThat(context.version === 'atlas-market-query-context-v1' && context.provider === 'scrydex'
    && source.packet.report.cardProfile === 'POKEMON' && context.publicHash === source.publicHash
    && context.identityHash === digest(canonical(identity)) && isScrydexMetadataUrl(context.sourceUrl)
    && /^[a-f0-9]{64}$/.test(context.sourceSha256 ?? '') && typeof expansion?.id === 'string'
    && [expansion.name, expansion.series, card?.id, card?.name, card?.number, card?.year, context.fullSetName]
      .every(value => typeof value === 'string' && value.trim() && value.length <= 240 && !/[\x00-\x1f\x7f]/.test(value))
    && queryNorm(card.name) === queryNorm(identity.cardName) && card.year === identity.year
    && compareVariantCardNumber(card.number, identity.cardNumber) === 'match'
    && context.fullSetName === queryText(`${expansion.series} ${expansion.name}`)
    && [expansion.name, context.fullSetName].map(queryNorm).includes(queryNorm(identity.productSet)),
  409, 'MARKET_QUERY_CONTEXT_INVALID');
  return structuredClone(context);
}

/** Reads only the already retained manufacturer metadata. No fetch, credential
 * or cache TTL can purchase another catalog lookup while preparing a search. */
export function createRetainedMarketQueryResolver({ cache, readCatalog }) {
  requireThat(typeof cache?.getRetained === 'function' && typeof readCatalog === 'function', 500, 'MARKET_CONFIGURATION_INVALID');
  return async ({ source, staff, job }) => {
    if (source.packet.report.cardProfile !== 'POKEMON') return null;
    const snapshot = await readCatalog(staff, job.card_id), candidates = snapshot?.candidates ?? [];
    const references = new Map(candidates.filter(candidate => candidate.source?.provider === 'scrydex')
      .map(candidate => [`${candidate.source.url}:${candidate.source.sha256}`, candidate.source]));
    const matches = [];
    for (const reference of references.values()) {
      if (!isScrydexMetadataUrl(reference.url) || !/^[a-f0-9]{64}$/.test(reference.sha256 ?? '')) continue;
      const saved = await cache.getRetained(`variant-scrydex-evidence:v1:${digest(reference.url)}:${reference.sha256}`);
      if (!saved) continue;
      requireThat(saved.schemaVersion === 'scrydex-source/v1' && saved.url === reference.url && saved.sha256 === reference.sha256
        && typeof saved.body === 'string' && Buffer.byteLength(saved.body) <= 1048576 && digest(saved.body) === reference.sha256,
      503, 'MARKET_QUERY_SOURCE_INVALID');
      const data = JSON.parse(saved.body);
      requireThat(Array.isArray(data.data) && data.data.length <= 7, 503, 'MARKET_QUERY_SOURCE_INVALID');
      for (const card of data.data) {
        const expansion = card.expansion;
        if (!expansion?.series || expansion.is_online_only !== false) continue;
        const number = card.printed_number ?? (/^\d+$/.test(card.number) && Number.isSafeInteger(expansion.printed_total)
          ? `${card.number}/${expansion.printed_total}` : card.number);
        const context = { version: 'atlas-market-query-context-v1', provider: 'scrydex', publicHash: source.publicHash,
          identityHash: digest(canonical(source.packet.report.identity)), sourceUrl: reference.url, sourceSha256: reference.sha256,
          card: { id: card.id, name: card.name, number, year: expansion.release_date?.slice(0, 4) },
          expansion: { id: expansion.id, name: expansion.name, series: expansion.series }, fullSetName: queryText(`${expansion.series} ${expansion.name}`) };
        try { matches.push(validatedQueryContext(source, context)); } catch (error) { if (error.code !== 'MARKET_QUERY_CONTEXT_INVALID') throw error; }
      }
    }
    // Conflicting retained expansion names do not authorize a guessed query.
    return new Set(matches.map(value => value.fullSetName)).size === 1 ? matches[0] : null;
  };
}

/** The one query/input context for fresh lookup, saved response projection,
 * stored preview selection and local reclassification. Only the current exact-grade
 * query or the historical generated query can bind to this publication. */
export function publishedMarketQuery({ packet, publicHash }, { savedQuery, savedInput, queryContext = null, queryStyle = null } = {}) {
  requireThat(typeof publicHash === 'string' && /^[a-f0-9]{64}$/.test(publicHash)
    && digest(JSON.stringify(packet)) === publicHash, 409, 'MARKET_PUBLICATION_MISMATCH');
  const parsed = parsePublicManualReport(packet), identity = parsed.report.identity;
  // The existing engine's targetGrade adds a rounded PSA grade to the query.
  // ATLAS does not assert that conversion. Keep its exact award as context and
  // search identity across graders without targetGrade.
  const identityInput = { matchingPolicy: 'ATLAS_IDENTITY_V1', category: parsed.report.cardProfile, year: identity.year, productSet: identity.productSet,
    ...(parsed.report.cardProfile === 'SPORTS' ? { playerName: identity.playerName, manufacturer: identity.manufacturer }
      : { cardName: identity.cardName }), parallel: identity.parallel, cardNumber: identity.cardNumber,
    ...('insert' in identity ? { insert: identity.insert } : {}) };
  const resolved = validatedQueryContext({ packet, publicHash }, queryContext);
  const currentQuery = approvedMarketQuery(identityInput, parsed.report.finalGrade, resolved?.fullSetName ?? identity.productSet),
    legacyQuery = buildEbaySoldCompsV2Query(identityInput);
  const query = savedQuery === undefined ? queryStyle === 'legacy' ? legacyQuery : currentQuery : savedQuery;
  requireThat(typeof query === 'string' && [currentQuery, legacyQuery].includes(query), 409, 'MARKET_PUBLICATION_MISMATCH');
  let input = { ...identityInput, queryOverride: query };
  if (savedInput !== undefined) {
    // Older signed previews lack an override and sometimes matchingPolicy.
    // Preserve their exact input shape; no other identity drift is accepted.
    const expected = { ...identityInput };
    if (savedInput && !Object.hasOwn(savedInput, 'matchingPolicy')) delete expected.matchingPolicy;
    if (savedInput && Object.hasOwn(savedInput, 'queryOverride')) expected.queryOverride = query;
    requireThat(same(expected, savedInput) && buildEbaySoldCompsV2Query(expected) === query, 409, 'MARKET_PUBLICATION_MISMATCH');
    input = expected;
  }
  return { binding: { publicToken: parsed.publicToken, approvalVersion: parsed.approvalVersion, publicHash },
    identityHash: digest(canonical(identity)), input, query: buildEbaySoldCompsV2Query(input), atlasGrade: parsed.report.finalGrade,
    ...(resolved ? { marketQueryContext: resolved } : {}) };
}

export const marketPreviewHash = preview => digest(canonical(preview, {
  maxBytes: preview?.version === 'atlas-market-preview-v2' ? 2097152 : 262144,
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
  const counts = { returned: result.items.length, missingImage: 0, unreadGrade: 0, differentIdentity: 0, outsideGrade: 0, shown: 0 };
  const labelProcessing = { state: 'COMPLETE', completed: 0, failed: 0, unknown: 0, unavailable: 0, reasons: [] };
  const eligible = [];
  for (const item of result.items) {
    const reading = result.imageMatch.readings.find(value => value.rowId === item.id);
    if (!item.imageUrl) counts.missingImage++;
    const outcome = reading?.outcome ?? (!item.imageUrl ? 'UNAVAILABLE' : reading ? 'COMPLETE' : 'FAILED');
    requireThat(['COMPLETE','FAILED','UNKNOWN','UNAVAILABLE'].includes(outcome), 502, 'MARKET_PROVIDER_RESULT_INVALID');
    labelProcessing[{ COMPLETE: 'completed', FAILED: 'failed', UNKNOWN: 'unknown', UNAVAILABLE: 'unavailable' }[outcome]]++;
    if (['FAILED','UNKNOWN'].includes(outcome)) {
      const code = reading?.failureCode ?? 'MARKET_LABEL_READING_MISSING';
      requireThat(/^(MARKET_LABEL_(OUTCOME_UNKNOWN|RESPONSE_INVALID|RESPONSE_INCOMPLETE|RESPONSE_REJECTED|READING_INVALID|READING_MISSING)|MARKET_PHOTO_UNAVAILABLE)$/.test(code), 502, 'MARKET_PROVIDER_RESULT_INVALID');
      if (!labelProcessing.reasons.includes(code)) labelProcessing.reasons.push(code);
      counts.unreadGrade++; continue;
    }
    if (reading?.identityMatch === 'DIFFERENT') { counts.differentIdentity++; continue; }
    if (!reading || !Number.isFinite(reading.numericGrade) || !['MATCH', 'UNCERTAIN'].includes(reading.identityMatch)) { counts.unreadGrade++; continue; }
    if (Math.abs(reading.numericGrade - context.atlasGrade) > 1) { counts.outsideGrade++; continue; }
    eligible.push(item.id);
  }
  if (labelProcessing.failed || labelProcessing.unknown) {
    labelProcessing.state = labelProcessing.completed ? 'PARTIAL' : 'FAILED';
    requireThat(labelProcessing.state !== 'FAILED', 502,
      labelProcessing.unknown ? 'MARKET_LABEL_OUTCOME_UNKNOWN' : labelProcessing.reasons[0]);
  }
  const sales = projectSelectedSlabReferences(result, eligible, context.atlasGrade)?.sales ?? [];
  const candidates = sales.map(sale => {
    const reading = result.imageMatch.readings.find(value => value.rowId === sale.id);
    // The exact unfiltered item and complete OCR reading already have durable
    // receipts. Selection needs only the allowlisted display facts; a provider's
    // unusually long title cannot make a photographed comp unprojectable.
    const sourceItem = { id: sale.id, listingUrl: sale.listingUrl, imageUrl: sale.imageUrl, soldDate: sale.soldAt,
      reportedPrice: sale.reportedPrice, soldPriceCents: sale.priceMinor, currency: sale.currency,
      priceBasis: sale.priceBasis === 'sold' ? 'EXACT' : sale.priceBasis === 'accepted_offer_unknown' ? 'UPPER_BOUND' : 'UNKNOWN' };
    const slabReading = { rowId: reading.rowId, sha256: reading.sha256, imageUrl: sale.imageUrl,
      gradingCompany: reading.gradingCompany, numericGrade: reading.numericGrade, identityMatch: reading.identityMatch };
    return { sale, match: reading.identityMatch === 'MATCH' ? 'MATCH' : 'UNKNOWN', requiresReview: true, sourceItem, slabReading };
  });
  counts.shown = candidates.length;
  return { version: 'atlas-market-preview-v2', ...context, source: result.source, engineVersion: result.engineVersion,
    responsePolicy: result.responsePolicy, retrievedAt: result.retrievedAt, candidates, counts, labelProcessing,
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
export function createPresentationMarket({ provider = null } = {}) {
  requireThat(provider === null || typeof provider === 'function', 500, 'MARKET_CONFIGURATION_INVALID');
  function project(source, result) {
    const context = publishedMarketQuery(source, { savedQuery: result?.query, queryContext: result?.marketQueryContext });
    const preview = result?.responsePolicy === 'ATLAS_SLAB_V1' ? prepareSlabPreview(context, result) : preparePreview(context, result);
    return { state: 'READY', preview, sourceHash: marketPreviewHash(preview) };
  }
  return Object.freeze({
    project,
    async preview(source) {
      const context = publishedMarketQuery(source);
      if (!provider) return { state: 'UNAVAILABLE', reason: 'PROVIDER_NOT_CONFIGURED' };
      requireThat(provider.requiresSlabLabels !== true, 503, 'MARKET_DURABLE_LABEL_WORKER_REQUIRED');
      let result;
      try { result = await provider(structuredClone(context.input)); }
      // A timeout/transport failure may follow a billed dispatch. It is not
      // proof of an unstarted lookup and must retain the caller's exact intent.
      catch (error) {
        // A typed authentication/quota/rate refusal proves the request did not
        // produce sales. Transport failures and server failures stay unknown.
        if (error instanceof EbaySoldCompsV2Error) {
          if (error.code === 'SOLDCOMPS_CREDENTIAL_MISSING') return { state: 'UNAVAILABLE', reason: 'PROVIDER_NOT_CONFIGURED' };
          if (error.statusCode === 401 && error.code === 'SOLDCOMPS_CONFIGURATION_ERROR') return { state: 'UNAVAILABLE', reason: 'PROVIDER_CONFIGURATION_ERROR' };
          if ([403, 429].includes(error.statusCode) && error.code === 'SOLDCOMPS_QUOTA_REACHED') return { state: 'UNAVAILABLE', reason: 'PROVIDER_QUOTA_REACHED' };
          if (error.statusCode === 429 && error.code === 'SOLDCOMPS_TEMPORARY_UNAVAILABLE') return { state: 'UNAVAILABLE', reason: 'PROVIDER_REQUEST_LIMITED' };
        }
        return { state: 'UNKNOWN', reason: 'PROVIDER_OUTCOME_UNKNOWN' };
      }
      return project(source, result);
    },
    select({ packet, publicHash, preview, sourceHash, selectedIds }) {
      requireThat(['atlas-market-preview-v1', 'atlas-market-preview-v2'].includes(preview?.version) && /^[a-f0-9]{64}$/.test(sourceHash ?? '')
        && marketPreviewHash(preview) === sourceHash, 409, 'MARKET_PREVIEW_MISMATCH');
      const context = publishedMarketQuery({ packet, publicHash }, { savedQuery: preview.query, savedInput: preview.input, queryContext: preview.marketQueryContext });
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
