import { canonical, digest, requireThat } from '@atlas/manual-service/contract';
import { parsePublicManualReport } from '@atlas/report-view/manual-public-contract';
import { projectSelectedSoldReferences } from '@atlas/report-view/sold-reference-projection';
import { buildEbaySoldCompsV2Query, EbaySoldCompsV2Error, EBAY_SOLD_COMPS_V2_ENGINE_VERSION, EBAY_SOLD_COMPS_V2_SOURCE } from '@tenkings/ebay-sold-comps-v2';

export const MARKET_UNAVAILABLE_REASONS = Object.freeze(['PROVIDER_NOT_CONFIGURED', 'PROVIDER_CONFIGURATION_ERROR', 'PROVIDER_QUOTA_REACHED', 'PROVIDER_REQUEST_LIMITED']);

const same = (a, b) => canonical(a) === canonical(b);
const fail = code => requireThat(false, 409, code);

export function publishedMarketQuery({ packet, publicHash }) {
  requireThat(typeof publicHash === 'string' && /^[a-f0-9]{64}$/.test(publicHash)
    && digest(JSON.stringify(packet)) === publicHash, 409, 'MARKET_PUBLICATION_MISMATCH');
  const parsed = parsePublicManualReport(packet), identity = parsed.report.identity;
  // The existing engine's targetGrade adds a rounded PSA grade to the query.
  // ATLAS does not assert that conversion. Keep its exact award as context and
  // search identity across graders without targetGrade or a query override.
  const input = { category: parsed.report.cardProfile, year: identity.year, productSet: identity.productSet,
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
  for (const candidate of result.candidates) {
    if (candidate.parallelMatch === 'CONTRADICTORY') { excluded.contradictory++; continue; }
    let sale;
    try { sale = projectSelectedSoldReferences(result, [candidate.id]).sales[0]; }
    catch { excluded.undisclosedOrUnsupported++; continue; }
    if (!['MATCH', 'UNKNOWN'].includes(candidate.parallelMatch) || !Number.isFinite(candidate.matchScore)
      || typeof candidate.matchReason !== 'string' || candidate.matchReason.length > 2000) {
      excluded.undisclosedOrUnsupported++; continue;
    }
    candidates.push({ sale, match: candidate.parallelMatch, matchScore: candidate.matchScore,
      matchReason: candidate.matchReason, requiresReview: true });
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
  return Object.freeze({
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
      const preview = preparePreview(context, result); fresh(preview);
      return { state: 'READY', preview, sourceHash: digest(canonical(preview)) };
    },
    select({ packet, publicHash, preview, sourceHash, selectedIds }) {
      requireThat(preview?.version === 'atlas-market-preview-v1' && /^[a-f0-9]{64}$/.test(sourceHash ?? '')
        && digest(canonical(preview)) === sourceHash, 409, 'MARKET_PREVIEW_MISMATCH');
      const context = publishedMarketQuery({ packet, publicHash });
      for (const key of ['binding', 'identityHash', 'input', 'query', 'atlasGrade']) {
        if (!same(context[key], preview[key])) fail('MARKET_PUBLICATION_MISMATCH');
      }
      requireThat(preview.source === EBAY_SOLD_COMPS_V2_SOURCE && preview.engineVersion === EBAY_SOLD_COMPS_V2_ENGINE_VERSION
        && Array.isArray(preview.candidates) && preview.candidates.length <= 60
        && Array.isArray(selectedIds) && selectedIds.length <= 60 && new Set(selectedIds).size === selectedIds.length,
      409, 'MARKET_SELECTION_INVALID');
      fresh(preview);
      // Reproject the saved allowlisted sale evidence; selecting unknown, raw,
      // contradictory or excluded rows cannot introduce a fallback candidate.
      const result = { source: preview.source, engineVersion: preview.engineVersion, retrievedAt: preview.retrievedAt,
        candidates: preview.candidates.map(value => ({ id: value.sale.id, title: value.sale.title, listingUrl: value.sale.listingUrl,
          source: preview.source, raw: false, grader: value.sale.grader, numericGrade: Number(value.sale.grade),
          soldPriceCents: value.sale.priceMinor, soldDate: value.sale.soldAt?.slice(0, 10) ?? null, parallelMatch: value.match })) };
      return projectSelectedSoldReferences(result, selectedIds);
    },
  });
}
