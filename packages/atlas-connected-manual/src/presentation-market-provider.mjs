import { searchEbaySoldCompsV2 } from '@tenkings/ebay-sold-comps-v2';
import { requireThat } from '@atlas/manual-service/contract';

// Dedicated ATLAS configuration; no Ten Kings credential lookup or inherited
// report-reader capability. Construction does not issue a provider request.
export function createSoldReferenceProvider({ apiKey, fetchImpl } = {}) {
  requireThat(typeof apiKey === 'string' && apiKey.trim().length >= 8 && apiKey.length <= 2048 && !/[\r\n]/.test(apiKey), 503, 'MARKET_CONFIGURATION_INVALID');
  return input => searchEbaySoldCompsV2(input, { apiKey, timeoutMs: 45000, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
}
