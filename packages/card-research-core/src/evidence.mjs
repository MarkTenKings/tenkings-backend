// Extracted from Inventory 20643deae9b9b341fc7dfcd7fb703c53d0b73d0b. See SOURCE_MANIFEST.json.
import { isStaffInventoryResearchImageUrl } from './contract.mjs';
import { readResearchPriceEvidence } from './price.mjs';
/** Provider-reported sold event, not a model guess or an inferred missing flag.
 * An explicit active status always defeats other stale sale-looking fields. */
export function researchSaleEvidence(raw) {
    const price = readResearchPriceEvidence(raw);
    const sale_evidence = raw.listingType === 'active'
        ? { status: 'active', basis: 'listing_type' }
        : raw.listingType === 'sold'
            ? { status: 'sold', basis: 'listing_type' }
            : price.accepted_offer && raw.listingType == null
                ? { status: 'sold', basis: 'hydrated_offer' }
                : { status: 'unknown', basis: 'not_supplied' };
    const verifiedPrice = sale_evidence.status === 'sold' ? price : { sold_price_cents: null };
    return {
        sale_evidence,
        price: verifiedPrice,
        reason: sale_evidence.status === 'active' ? 'The source identifies an active listing, not a completed sale.'
            : sale_evidence.status === 'unknown' ? 'The source does not affirmatively establish a completed sale.' : null,
    };
}
/** Retain only URLs actually supplied by the provider; never manufacture size
 * suffixes, follow redirects, or permit a seller-controlled image host. */
export function researchImageOptions(raw, preferFullResolution) {
    const thumbnail_url = isStaffInventoryResearchImageUrl(raw.thumbnailUrl) ? raw.thumbnailUrl : null;
    const full_resolution_url = isStaffInventoryResearchImageUrl(raw.fullResThumbnailUrl) ? raw.fullResThumbnailUrl : null;
    return { image_options: { thumbnail_url, full_resolution_url },
        image_url: preferFullResolution ? full_resolution_url ?? thumbnail_url : thumbnail_url };
}
