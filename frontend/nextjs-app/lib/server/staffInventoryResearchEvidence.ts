import { isStaffInventoryResearchImageUrl } from '../staffInventoryResearch';
import { readResearchPriceEvidence } from './staffInventoryResearchPrice';

/** Provider-reported sold event, not a model guess or an inferred missing flag.
 * An explicit active status always defeats other stale sale-looking fields. */
export function researchSaleEvidence(raw: Record<string, unknown>) {
  const price = readResearchPriceEvidence(raw);
  const sale_evidence = raw.listingType === 'active'
    ? { status: 'active' as const, basis: 'listing_type' as const }
    : raw.listingType === 'sold'
      ? { status: 'sold' as const, basis: 'listing_type' as const }
      : price.accepted_offer && raw.listingType == null
        ? { status: 'sold' as const, basis: 'hydrated_offer' as const }
        : { status: 'unknown' as const, basis: 'not_supplied' as const };
  const verifiedPrice: ReturnType<typeof readResearchPriceEvidence> = sale_evidence.status === 'sold' ? price : { sold_price_cents: null };
  return {
    sale_evidence,
    price: verifiedPrice,
    reason: sale_evidence.status === 'active' ? 'The source identifies an active listing, not a completed sale.'
      : sale_evidence.status === 'unknown' ? 'The source does not affirmatively establish a completed sale.' : null,
  };
}

/** Retain only URLs actually supplied by the provider; never manufacture size
 * suffixes, follow redirects, or permit a seller-controlled image host. */
export function researchImageOptions(raw: Record<string, unknown>, preferFullResolution: boolean) {
  const thumbnail_url = isStaffInventoryResearchImageUrl(raw.thumbnailUrl) ? raw.thumbnailUrl : null;
  const full_resolution_url = isStaffInventoryResearchImageUrl(raw.fullResThumbnailUrl) ? raw.fullResThumbnailUrl : null;
  return { image_options: { thumbnail_url, full_resolution_url },
    image_url: preferFullResolution ? full_resolution_url ?? thumbnail_url : thumbnail_url };
}
