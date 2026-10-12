import { canonical, digest, requireThat } from '@atlas/manual-service/contract';
import { parsePublicManualReport } from '@atlas/report-view/manual-public-contract';
import { buildEbaySoldCompsV2Query } from '@tenkings/ebay-sold-comps-v2';

// Explicit research has its own provider and journal. It is never an automatic
// market fallback or a second query purchased when ordinary sales are empty.
export function publishedResearchQuery({ packet, publicHash }, { savedQuery, savedInput } = {}) {
  requireThat(digest(JSON.stringify(packet)) === publicHash, 409, 'MARKET_PUBLICATION_MISMATCH');
  const parsed = parsePublicManualReport(packet), identity = parsed.report.identity;
  const identityInput = { matchingPolicy: 'ATLAS_IDENTITY_V1', category: parsed.report.cardProfile, year: identity.year, productSet: identity.productSet,
    ...(parsed.report.cardProfile === 'SPORTS' ? { playerName: identity.playerName, manufacturer: identity.manufacturer } : { cardName: identity.cardName }),
    parallel: identity.parallel, cardNumber: identity.cardNumber, ...('insert' in identity ? { insert: identity.insert } : {}) };
  const query = buildEbaySoldCompsV2Query(identityInput);
  requireThat(savedQuery === undefined || savedQuery === query, 409, 'MARKET_PUBLICATION_MISMATCH');
  const input = { ...identityInput, queryOverride: query };
  if (savedInput !== undefined) {
    if (!Object.hasOwn(savedInput ?? {}, 'matchingPolicy')) delete input.matchingPolicy;
    if (!Object.hasOwn(savedInput ?? {}, 'queryOverride')) delete input.queryOverride;
    requireThat(canonical(input) === canonical(savedInput), 409, 'MARKET_PUBLICATION_MISMATCH');
  }
  return { binding: { publicToken: parsed.publicToken, approvalVersion: parsed.approvalVersion, publicHash },
    identityHash: digest(canonical(identity)), input, query, atlasGrade: parsed.report.finalGrade };
}
