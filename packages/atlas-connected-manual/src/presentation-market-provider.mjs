import { searchEbaySoldCompsV2 } from '@tenkings/ebay-sold-comps-v2';
import { requireThat } from '@atlas/manual-service/contract';

// Dedicated ATLAS configuration; no Ten Kings credential lookup or inherited
// report-reader capability. Construction does not issue a provider request.
export function createSoldReferenceProvider({ apiKey, fetchImpl = globalThis.fetch } = {}) {
  requireThat(typeof apiKey === 'string' && apiKey.trim().length >= 8 && apiKey.length <= 2048 && !/[\r\n]/.test(apiKey), 503, 'MARKET_CONFIGURATION_INVALID');
  requireThat(typeof fetchImpl === 'function', 503, 'MARKET_CONFIGURATION_INVALID');
  // The dedicated credential is sent only to the engine's fixed provider URL.
  // A redirect is an uncertain failed request, never another authorized hop.
  const fetchProvider = (url, init) => fetchImpl(url, { ...init, redirect: 'error' });
  return input => searchEbaySoldCompsV2(input, { apiKey, timeoutMs: 45000, requestCount: 40, fetch: fetchProvider });
}
