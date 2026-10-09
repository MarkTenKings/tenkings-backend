import { canonical, digest, requireThat } from '@atlas/manual-service/contract';
import { parsePublicManualReport } from '@atlas/report-view/manual-public-contract';
import { projectSelectedSoldReferences } from '@atlas/report-view/sold-reference-projection';
import { inspectStaffInventoryResearchSale, inspectStaffInventoryResearchTitle } from '@tenkings/card-research-core/decisions';
import { buildEbaySoldCompsV2Query, EbaySoldCompsV2Error, EBAY_SOLD_COMPS_V2_ENGINE_VERSION, EBAY_SOLD_COMPS_V2_SOURCE } from '@tenkings/ebay-sold-comps-v2';

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

export function publishedMarketQuery({ packet, publicHash }) {
  requireThat(typeof publicHash === 'string' && /^[a-f0-9]{64}$/.test(publicHash)
    && digest(JSON.stringify(packet)) === publicHash, 409, 'MARKET_PUBLICATION_MISMATCH');
  const parsed = parsePublicManualReport(packet), identity = parsed.report.identity;
  // The existing engine's targetGrade adds a rounded PSA grade to the query.
  // ATLAS does not assert that conversion. Keep its exact award as context and
  // search identity across graders without targetGrade or a query override.
  const input = { matchingPolicy: 'ATLAS_IDENTITY_V1', category: parsed.report.cardProfile, year: identity.year, productSet: identity.productSet,
    ...(parsed.report.cardProfile === 'SPORTS' ? { playerName: identity.playerName, manufacturer: identity.manufacturer }
      : { cardName: identity.cardName }), parallel: identity.parallel, cardNumber: identity.cardNumber,
    ...('insert' in identity ? { insert: identity.insert } : {}) };
  return { binding: { publicToken: parsed.publicToken, approvalVersion: parsed.approvalVersion, publicHash },
    identityHash: digest(canonical(identity)), input, query: buildEbaySoldCompsV2Query(input), atlasGrade: parsed.report.finalGrade };
}

function preparePreview(context, result) {
  requireThat(result?.source === EBAY_SOLD_COMPS_V2_SOURCE && result.engineVersion === EBAY_SOLD_COMPS_V2_ENGINE_VERSION
    && result.query === context.query && Array.isArray(result.candidates) && result.candidates.length <= 60
    && result.candidates.every(value => value && typeof value.id === 'string')
    && new Set(result.candidates.map(value => value.id)).size === result.candidates.length
    && typeof result.retrievedAt === 'string' && Number.isFinite(Date.parse(result.retrievedAt)), 502, 'MARKET_PROVIDER_RESULT_INVALID');
  const candidates = [], excluded = { undisclosedOrUnsupported: 0, contradictory: 0 };
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
    retrievedAt: result.retrievedAt, candidates, excluded };
}

/** Server-side adapter only; constructing it never calls a provider. The caller
 * retains the returned preview/hash in trusted storage. select() must receive
 * that stored object, not a client-provided preview or self-declared hash.
 * The staff request supplies only its saved preview id and chosen candidate ids.
 * No endpoint, live credential, persistence or automatic pricing is enabled here.
 */
export function createPresentationMarket({ provider = null, now = () => new Date(), maxAgeMs = 24 * 60 * 60 * 1000 } = {}) {
  requireThat((provider === null || typeof provider === 'function') && Number.isSafeInteger(maxAgeMs)
    && maxAgeMs > 0 && maxAgeMs <= 7 * 24 * 60 * 60 * 1000, 500, 'MARKET_CONFIGURATION_INVALID');
  function fresh(preview) {
    const observed = Date.parse(preview.retrievedAt), time = now().getTime();
    requireThat(Number.isFinite(observed) && Number.isFinite(time) && observed <= time + 60000
      && time - observed <= maxAgeMs, 409, 'MARKET_PREVIEW_EXPIRED');
  }
  function project(source, result) {
    const preview = preparePreview(publishedMarketQuery(source), result); fresh(preview);
    return { state: 'READY', preview, sourceHash: digest(canonical(preview)) };
  }
  return Object.freeze({
    project,
    async preview(source) {
      const context = publishedMarketQuery(source);
      if (!provider) return { state: 'UNAVAILABLE', reason: 'PROVIDER_NOT_CONFIGURED' };
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
      requireThat(preview?.version === 'atlas-market-preview-v1' && /^[a-f0-9]{64}$/.test(sourceHash ?? '')
        && digest(canonical(preview)) === sourceHash, 409, 'MARKET_PREVIEW_MISMATCH');
      const context = publishedMarketQuery({ packet, publicHash });
      for (const key of ['binding', 'identityHash', 'input', 'query', 'atlasGrade']) {
        // Pre-upgrade saved previews have no matchingPolicy. Their signed
        // evidence remains selectable; no other identity field may differ.
        let expected = context[key];
        if (key === 'input' && preview.input && !Object.hasOwn(preview.input, 'matchingPolicy')) {
          expected = { ...expected }; delete expected.matchingPolicy;
        }
        if (!same(expected, preview[key])) fail('MARKET_PUBLICATION_MISMATCH');
      }
      requireThat(preview.source === EBAY_SOLD_COMPS_V2_SOURCE && preview.engineVersion === EBAY_SOLD_COMPS_V2_ENGINE_VERSION
        && Array.isArray(preview.candidates) && preview.candidates.length <= 60
        && Array.isArray(selectedIds) && selectedIds.length <= 60 && new Set(selectedIds).size === selectedIds.length,
      409, 'MARKET_SELECTION_INVALID');
      fresh(preview);
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
