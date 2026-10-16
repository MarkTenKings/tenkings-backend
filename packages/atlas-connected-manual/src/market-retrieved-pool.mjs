import { requireThat } from '@atlas/manual-service/contract';
import { projectSelectedSlabReferences } from '@atlas/report-view/sold-reference-projection';
import { EBAY_SOLD_COMPS_V2_ENGINE_VERSION, EBAY_SOLD_COMPS_V2_SOURCE } from '@tenkings/ebay-sold-comps-v2';
import { publishedMarketQuery } from './presentation-market.mjs';

/** Read-only display of the already purchased pool. This is not a selectable
 * preview: photographed identity and grade evidence are still being prepared. */
export function projectRetrievedMarketPool(source, job) {
  const row = source?.row, response = job?.response;
  requireThat(row?.state === 'PUBLISHED' && row.card_id === job.card_id && row.action_id === job.approval_action_id
    && row.mode === job.mode && row.source_hash === job.source_hash && row.report_hash === job.report_hash
    && source.publicHash === row.public_hash && job.public_hash === source.publicHash,
  409, 'MARKET_APPROVAL_MISMATCH');
  // The durable job already binds this retained response to the approval.
  // Display its immutable query even when a later release changes acquisition.
  const context = publishedMarketQuery(source, { savedQuery: response?.query });
  requireThat(response?.responsePolicy === 'ATLAS_SLAB_V1' && response.source === EBAY_SOLD_COMPS_V2_SOURCE
    && response.engineVersion === EBAY_SOLD_COMPS_V2_ENGINE_VERSION && response.query === context.query
    && typeof response.retrievedAt === 'string' && Number.isFinite(Date.parse(response.retrievedAt))
    && Array.isArray(response.items) && response.items.every(item => item && typeof item.id === 'string')
    && new Set(response.items.map(item => item.id)).size === response.items.length,
  502, 'MARKET_PROVIDER_RESULT_INVALID');
  // Reuse the sale/date/price and eBay URL validation, supplying no model or
  // seller-title grade inference. The separate whitelist below excludes every
  // provisional classification and all raw provider/private response fields.
  const evidence = { responsePolicy: response.responsePolicy, retrievedAt: response.retrievedAt, items: response.items,
    imageMatch: { readings: response.items.map(item => ({ rowId: item.id, identityMatch: 'UNCERTAIN',
      evidenceKind: 'UNCERTAIN', numericGrade: null, gradingCompany: null, labelText: null })) } };
  const sales = projectSelectedSlabReferences(evidence, response.items.map(item => item.id), context.atlasGrade)?.sales ?? [];
  return { query: response.query, retrievedAt: response.retrievedAt,
    candidates: sales.map(({ id, title, listingUrl, imageUrl, soldAt, priceMinor, currency, priceBasis, reportedPrice }) => ({
      sale: { id, title, listingUrl, imageUrl, soldAt, priceMinor, currency, priceBasis, reportedPrice },
    })) };
}
