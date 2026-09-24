// Extracted from Inventory 20643deae9b9b341fc7dfcd7fb703c53d0b73d0b. See SOURCE_MANIFEST.json.
import { z } from 'zod';
import { resolveStaffInventoryResearchSaleDetails, STAFF_INVENTORY_RESEARCH_SALE_DETAILS_ENGINE_VERSION } from './sale-details.mjs';
export const STAFF_INVENTORY_RESEARCH_MODEL = 'gpt-6-astra';
export const STAFF_INVENTORY_RESEARCH_ENGINE_VERSION = 'staff-inventory-research-v3';
export const STAFF_INVENTORY_RESEARCH_CATALOG_ENGINE_VERSION = 'staff-inventory-research-v4';
export const STAFF_INVENTORY_RESEARCH_PHOTO_ENGINE_VERSION = 'staff-inventory-research-v6';
export const STAFF_INVENTORY_RESEARCH_LIMITS = { searches: 3, candidates: 24, candidateImages: 12, references: 24, referenceImages: 4, minimumComps: 2, overallTimeoutMs: 150000 };
const unsafeText = /[\u0000-\u001f\u007f]|https?:\/\/|data:|\b(?:sk|sess|proj)-[A-Za-z0-9_-]{8,}|(?:^|\s)(?:\/[\w.-]+){2,}|<\/?[a-z][^>]*>/i;
const text = (max) => z.string().min(1).max(max).refine(value => value === value.trim() && !unsafeText.test(value));
const id = z.string().min(1).max(180).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);
const sourceId = z.string().min(1).max(200).refine(value => value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value));
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime().refine(value => value.length === 24 && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);
const cents = z.number().int().min(1).max(2_147_483_647);
const category = text(80);
export const StaffInventoryResearchPhotoKeySchema = z.string().regex(/^inventory-photos\/[a-f0-9-]{36}\/[a-f0-9]{64}\.jpg$/);
/** Public provenance only. Query strings, fragments, credentials and ports are not retained. */
export function isStaffInventoryResearchSourceUrl(value) {
    if (typeof value !== 'string' || value.length > 2048)
        return false;
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash &&
            !/^(?:localhost|.*\.localhost|\d+(?:\.\d+){3}|\[.*\])$/.test(url.hostname) && url.toString() === value;
    }
    catch {
        return false;
    }
}
export function isStaffInventoryResearchImageUrl(value) {
    if (!isStaffInventoryResearchSourceUrl(value))
        return false;
    const host = new URL(value).hostname;
    return host === 'ebayimg.com' || host.endsWith('.ebayimg.com') || host === 'ebaystatic.com' || host.endsWith('.ebaystatic.com');
}
const sourceUrl = z.string().refine(isStaffInventoryResearchSourceUrl);
const imageUrl = z.string().refine(isStaffInventoryResearchImageUrl);
const listingUrl = z.string().regex(/^https:\/\/www\.ebay\.com\/itm\/\d{6,20}$/);
const savedDetail = (max) => z.string().min(1).max(max).refine(value => value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value)).nullable();
/** Accept every existing saved description verbatim; research cannot tighten the save contract. */
export const StaffInventoryResearchDescriptionSchema = z.object({
    name: z.string().min(1).max(160).refine(value => value.trim() === value).nullable(), category: z.string().min(1).max(80).refine(value => value.trim() === value).nullable(), manufacturer: savedDetail(160),
    card_number: savedDetail(80), year: savedDetail(20), set_name: savedDetail(160),
    variant: savedDetail(160), card_type: savedDetail(160),
}).strict();
export const LegacyInventoryResearchInputSchema = z.object({
    schema_version: z.literal(1), unit_id: sourceId, description_event_id: sourceId, description_hash: sha256,
    description: StaffInventoryResearchDescriptionSchema,
    front_photo_key: StaffInventoryResearchPhotoKeySchema.nullable(), back_photo_key: StaffInventoryResearchPhotoKeySchema.nullable(),
}).strict();
const referenceIdentity = z.object({ name: text(160).nullable(), category: category.nullable(), year: text(20).nullable(), manufacturer: text(160).nullable(), set_name: text(160).nullable(), card_number: text(80).nullable() }).strict();
const catalogPin = z.object({ publicationId: sourceId, setId: sourceId, revision: z.number().int().positive(), manifestSha256: sha256 }).strict();
const catalogScope = z.object({ language: text(160), edition: text(160), format: text(160), channel: text(160) }).strict();
const catalogBinding = z.object({ publication: catalogPin, card_id: sourceId, printing_id: sourceId,
    applicability: z.literal('supported'), scope: catalogScope, image_id: sourceId.nullable(),
    image_relationship: z.enum(['depicts_candidate_identity', 'representative_finish']).nullable(),
    image_depicted: z.object({ card_id: sourceId, printing_id: sourceId }).strict().nullable(),
    image_represents_printing_ids: z.array(sourceId).max(100), image_visible_diagnostic_ids: z.array(sourceId).max(30),
}).strict();
export const StaffInventoryResearchScopeReceiptSchema = z.object({
    attempt_id: id, invocation_id: id, receipt_ref: id, request_sha256: sha256, response_sha256: sha256,
    http_status: z.number().int().min(200).max(299), acknowledgement: z.enum(['adapter', 'process']),
    images: z.array(z.object({ side: z.enum(['front', 'back']), mime_type: z.enum(['image/jpeg', 'image/png', 'image/webp']),
        transmitted_sha256: sha256, source_sha256: sha256.nullable() }).strict()).length(2),
}).strict().refine(receipt => new Set(receipt.images.map(image => image.side)).size === 2, 'Scope receipt requires both image sides.');
export const StaffInventoryResearchCatalogContextSchema = z.object({
    schema_version: z.literal(1), status: z.enum(['not_consulted', 'no_publication', 'current', 'unavailable']),
    scope_receipt: StaffInventoryResearchScopeReceiptSchema.nullable(),
    publications: z.array(z.object({ publication: catalogPin, lookup_sha256: sha256,
        coverage: z.object({ text: z.enum(['complete', 'partial', 'truncated', 'unknown']), applicability: z.enum(['complete', 'partial', 'truncated', 'unknown']), images: z.enum(['complete', 'partial', 'truncated', 'unknown']) }).strict(),
        candidate_count: z.number().int().min(0), returned_count: z.number().int().min(0).max(24), truncated: z.boolean(),
    }).strict()).max(8),
    scope_evidence: z.array(z.object({ field: z.enum(['language', 'edition', 'format', 'channel']), value: text(160), side: z.enum(['front', 'back']), photo_sha256: sha256, observation: text(400) }).strict()).max(4),
}).strict();
export const StaffInventoryResearchReferenceSchema = z.object({
    id, kind: z.enum(['catalog', 'reference']), trust: z.enum(['published_catalog', 'approved_reference']),
    identity: referenceIdentity, catalog_id: id, variant_name: text(160), variant_kind: z.enum(['BASE', 'PARALLEL', 'VARIANT']),
    source_url: sourceUrl.nullable(), source_sha256: sha256, captured_at: timestamp,
    distinguishing_features: z.array(text(240)).max(16),
    image: z.object({ source_url: imageUrl.nullable(), sha256, storage_key: z.string().min(1).max(512).nullable(), content_type: z.enum(['image/jpeg', 'image/png', 'image/webp']) }).strict().nullable(),
    catalog_binding: catalogBinding.optional(),
}).strict().superRefine((value, ctx) => {
    if (value.kind === 'catalog' ? value.trust !== 'published_catalog' : value.trust !== 'approved_reference')
        ctx.addIssue({ code: 'custom', message: 'Invalid reference authority.' });
    if (value.catalog_binding) {
        if (value.source_sha256 !== value.catalog_binding.publication.manifestSha256 || Boolean(value.image) !== Boolean(value.catalog_binding.image_id)
            || Boolean(value.image) !== Boolean(value.catalog_binding.image_relationship) || value.image && (value.image.source_url !== null || value.image.storage_key !== null))
            ctx.addIssue({ code: 'custom', message: 'Unbound private catalog image.' });
        const binding = value.catalog_binding;
        const represented = binding.image_represents_printing_ids, visible = binding.image_visible_diagnostic_ids;
        if (new Set(represented).size !== represented.length || new Set(visible).size !== visible.length)
            ctx.addIssue({ code: 'custom', message: 'Duplicate reviewed image association.' });
        if (value.image) {
            const depictsTarget = binding.image_depicted?.card_id === binding.card_id && binding.image_depicted?.printing_id === binding.printing_id;
            if (!binding.image_depicted || !represented.includes(binding.printing_id) || !visible.length || !value.distinguishing_features.length || binding.image_relationship !== (depictsTarget ? 'depicts_candidate_identity' : 'representative_finish'))
                ctx.addIssue({ code: 'custom', message: 'Missing reviewed target-to-depicted association.' });
        }
        else if (binding.image_depicted || represented.length || visible.length)
            ctx.addIssue({ code: 'custom', message: 'Image association without image evidence.' });
    }
    else if (value.image?.source_url === null)
        ctx.addIssue({ code: 'custom', message: 'Missing legacy image URL.' });
});
const photo = z.object({ key: StaffInventoryResearchPhotoKeySchema, sha256 }).strict()
    .refine(value => value.sha256 === value.key.slice(value.key.lastIndexOf('/') + 1, -4));
const downloadedImage = z.object({
    source_url: imageUrl, sha256, retrieved_at: timestamp, content_type: z.enum(['image/jpeg', 'image/png', 'image/webp']), byte_size: z.number().int().min(1).max(2 * 1024 * 1024),
    storage_key: z.string().regex(/^research-evidence\/[a-f0-9]{64}\.(?:jpg|png|webp)$/).nullable(),
}).strict();
const ordinarySaleDetail = z.object({
    schema_version: z.literal(1), basis: z.literal('same_item_ordinary_sale_detail'),
    candidate_id: z.string().regex(/^ebay:\d{10,15}$/), item_id: z.string().regex(/^\d{10,15}$/),
    search: z.object({ response_sha256: sha256, retrieved_at: timestamp, title: text(500),
        listing_type: z.literal('sold'), sold_price: text(80), sold_currency: z.literal('USD'), sold_date: text(10),
        offer_field: z.enum(['absent', 'null']) }).strict(),
    detail: z.object({ response_sha256: sha256, retrieved_at: timestamp, title: text(500),
        price: text(80), currency: z.literal('USD'), best_offer_accepted: z.literal(false), ended: z.literal(true),
        ended_date_raw: text(80), sold_date: text(10), sold_banner: text(240) }).strict(),
}).strict();
function resolveOrdinaryDetail(evidence) {
    return resolveStaffInventoryResearchSaleDetails({ candidate_id: evidence.candidate_id, requested_item_id: evidence.item_id,
        search: { response_sha256: evidence.search.response_sha256, retrieved_at: evidence.search.retrieved_at,
            item: { itemId: evidence.item_id, title: evidence.search.title, listingType: evidence.search.listing_type,
                soldPrice: evidence.search.sold_price, soldCurrency: evidence.search.sold_currency, endedAt: evidence.search.sold_date,
                ...(evidence.search.offer_field === 'null' ? { bestOfferAccepted: null } : {}) } },
        detail: { response_sha256: evidence.detail.response_sha256, retrieved_at: evidence.detail.retrieved_at,
            item: { itemId: evidence.item_id, title: evidence.detail.title, price: evidence.detail.price, currency: evidence.detail.currency,
                bestOfferAccepted: evidence.detail.best_offer_accepted, ended: evidence.detail.ended,
                endedDate: evidence.detail.ended_date_raw, soldBanner: evidence.detail.sold_banner } },
    });
}
export const StaffInventoryResearchCandidateSchema = z.object({
    id: z.string().regex(/^ebay:\d{6,20}$/), source: z.literal('SoldCompsAPI'), listing_url: listingUrl,
    retrieved_at: timestamp, source_response_sha256: sha256, title: text(500),
    sold_price: text(80).nullable(), sold_price_cents: cents.nullable(), sold_currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
    best_offer_accepted: z.boolean().nullable(), sold_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), sold_date_raw: text(80).nullable(),
    accepted_offer: z.object({ amount: z.string().regex(/^\d{1,8}(?:\.\d{1,2})?$/), currency: z.string().regex(/^[A-Z]{3}$/), source_field: z.enum(['soldPrice', 'boaAcceptedPrice']), hydrated: z.literal(true) }).strict().optional(),
    condition: text(200).nullable(), grader: z.enum(['PSA', 'BGS', 'SGC', 'CGC']).nullable(), numeric_grade: z.number().min(1).max(10).nullable(), raw: z.boolean(),
    image_url: imageUrl.nullable(), image: downloadedImage.nullable(), source_eligible: z.boolean(), exclusion_reason: text(400).nullable(),
    // Optional for immutable v1/v2 readers. New engine output binds affirmative
    // sold-event evidence separately from price and image matching.
    sale_evidence: z.object({ status: z.enum(['sold', 'active', 'unknown']), basis: z.enum(['listing_type', 'hydrated_offer', 'not_supplied']) }).strict().optional(),
    image_options: z.object({ thumbnail_url: imageUrl.nullable(), full_resolution_url: imageUrl.nullable() }).strict().optional(),
    multiple_price_options: z.boolean().optional(),
    ordinary_sale_detail: ordinarySaleDetail.optional(),
}).strict().superRefine((value, ctx) => {
    if (value.listing_url !== `https://www.ebay.com/itm/${value.id.slice(5)}`)
        ctx.addIssue({ code: 'custom', message: 'Listing identity mismatch.' });
    if (value.image && value.image.source_url !== value.image_url)
        ctx.addIssue({ code: 'custom', message: 'Image source mismatch.' });
    if (value.image?.storage_key) {
        const extension = value.image.content_type === 'image/jpeg' ? 'jpg' : value.image.content_type === 'image/png' ? 'png' : 'webp';
        if (value.image.storage_key !== `research-evidence/${value.image.sha256}.${extension}`)
            ctx.addIssue({ code: 'custom', message: 'Stored image hash mismatch.' });
    }
    const match = (value.accepted_offer?.amount ?? value.sold_price)?.match(/^(\d{1,8})(?:\.(\d{1,2}))?$/);
    const parsedPrice = match ? Number(BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0') || '0')) : null;
    let detailConfirmed = false;
    if (value.ordinary_sale_detail) {
        const evidence = value.ordinary_sale_detail, decision = resolveOrdinaryDetail(evidence);
        detailConfirmed = decision.status === 'confirmed' && decision.sold_price_cents === value.sold_price_cents
            && decision.evidence.detail.sold_date === evidence.detail.sold_date
            && evidence.candidate_id === value.id && evidence.item_id === value.id.slice(5)
            && evidence.search.response_sha256 === value.source_response_sha256 && evidence.search.retrieved_at === value.retrieved_at
            && evidence.search.title === value.title && evidence.search.sold_price === value.sold_price
            && evidence.search.sold_currency === value.sold_currency && evidence.search.sold_date === value.sold_date
            && evidence.search.sold_date === value.sold_date_raw && value.best_offer_accepted === null && !value.accepted_offer
            && value.sale_evidence?.status === 'sold' && value.sale_evidence.basis === 'listing_type' && value.multiple_price_options === false;
        if (!detailConfirmed)
            ctx.addIssue({ code: 'custom', message: 'Unbound ordinary-sale detail evidence.' });
    }
    if (value.accepted_offer && (value.best_offer_accepted !== true || parsedPrice === null || parsedPrice < 1 || parsedPrice > 2_147_483_647 || (value.accepted_offer.source_field === 'soldPrice' && (value.accepted_offer.amount !== value.sold_price || value.accepted_offer.currency !== value.sold_currency))))
        ctx.addIssue({ code: 'custom', message: 'Accepted offer evidence mismatch.' });
    if (value.sold_price_cents !== null && (value.sold_price_cents !== parsedPrice || (value.accepted_offer ? value.accepted_offer.currency !== 'USD' : !detailConfirmed && (value.best_offer_accepted !== false || value.sold_currency !== 'USD'))))
        ctx.addIssue({ code: 'custom', message: 'Price evidence mismatch.' });
    if (value.sold_date && (!Number.isFinite(Date.parse(value.sold_date)) || new Date(value.sold_date).toISOString().slice(0, 10) !== value.sold_date))
        ctx.addIssue({ code: 'custom', message: 'Invalid sold date.' });
    if (value.source_eligible && (value.sold_price_cents === null || value.sold_date === null || value.sold_date > value.retrieved_at.slice(0, 10) || value.exclusion_reason !== null))
        ctx.addIssue({ code: 'custom', message: 'Ineligible sale evidence.' });
    if (value.multiple_price_options && value.source_eligible)
        ctx.addIssue({ code: 'custom', message: 'Ambiguous price options.' });
    if (value.sale_evidence) {
        if (value.sale_evidence.status === 'unknown' ? value.sale_evidence.basis !== 'not_supplied' : value.sale_evidence.basis === 'not_supplied')
            ctx.addIssue({ code: 'custom', message: 'Unbound sold-event evidence.' });
        if (value.sale_evidence.basis === 'hydrated_offer' && (value.sale_evidence.status !== 'sold' || !value.accepted_offer))
            ctx.addIssue({ code: 'custom', message: 'Unbound hydrated sale.' });
        if (value.sale_evidence.status !== 'sold' && (value.source_eligible || value.sold_price_cents !== null))
            ctx.addIssue({ code: 'custom', message: 'Unsupported sold event.' });
    }
    if (value.image_options && value.image_url !== null && ![value.image_options.thumbnail_url, value.image_options.full_resolution_url].includes(value.image_url))
        ctx.addIssue({ code: 'custom', message: 'Unbound primary image.' });
    if (value.raw ? value.grader !== null || value.numeric_grade !== null : value.grader === null || value.numeric_grade === null)
        ctx.addIssue({ code: 'custom', message: 'Inconsistent sale grade evidence.' });
});
export const StaffInventoryResearchPhotoFeatureSchema = z.object({
    side: z.enum(['front', 'back']), photo_sha256: sha256, reference_id: id,
    evidence_type: z.enum(['printed_variant_name', 'catalog_feature', 'reference_image']), reference_feature: text(240), observation: text(400),
}).strict();
export const StaffInventoryResearchIdentitySchema = z.object({
    status: z.enum(['base', 'variant', 'unresolved']), variant_name: text(160).nullable(), suggestion: text(160).nullable(), reason: text(400),
    reference_ids: z.array(id).max(24), photo_features: z.array(StaffInventoryResearchPhotoFeatureSchema).max(12),
}).strict();
/** Private observations from this physical card, never catalog publication or
 * grading authority. Kept separate so existing catalog conclusions retain their
 * exact meaning and immutable v1-v5 snapshots keep their original bytes. */
export const StaffInventoryResearchPhotoIdentitySchema = z.object({
    schema_version: z.literal(1), status: z.enum(['supported', 'unresolved']),
    observations: z.array(z.object({
        field: z.enum(['name', 'year', 'manufacturer', 'set_name', 'card_number', 'treatment']),
        value: text(160), side: z.enum(['front', 'back']), photo_sha256: sha256, observation: text(400),
    }).strict()).max(6),
    reason: text(400),
}).strict().superRefine((value, ctx) => {
    const fields = new Set(value.observations.map(observation => observation.field));
    if (fields.size !== value.observations.length)
        ctx.addIssue({ code: 'custom', message: 'Duplicate photographed identity field.' });
    if (value.status === 'supported' && value.observations.some(observation => /^(?:unknown|unresolved|n\/?a|not visible|not supplied)$/i.test(observation.value)))
        ctx.addIssue({ code: 'custom', message: 'Unknown observations cannot establish photographed identity.' });
    const treatment = value.observations.find(observation => observation.field === 'treatment');
    if (value.status === 'supported' && treatment && (/^(?:base(?: card)?|standard|regular|normal|non[- ]?holo(?:graphic)?|non[- ]?foil|raw|ungraded)$/i.test(treatment.value)
        || /\b(?:no|without|absence of|lack of|not)\s+(?:visible\s+)?(?:foil|holo|stamp|parallel|variant|edition)\b|\b(?:appears|probably|likely)\s+(?:base|standard|regular)\b/i.test(`${treatment.value} ${treatment.observation}`)))
        ctx.addIssue({ code: 'custom', message: 'A generic label or absent feature is not positive printing evidence.' });
    if (value.status === 'supported' && (['name', 'year', 'set_name', 'card_number', 'treatment'].some(field => !fields.has(field))
        || new Set(value.observations.map(observation => observation.side)).size !== 2))
        ctx.addIssue({ code: 'custom', message: 'Both original sides and positive identity/treatment observations are required.' });
});
export const StaffInventoryResearchConditionSchema = z.object({
    status: z.enum(['raw', 'graded', 'unresolved']), grader: z.enum(['PSA', 'BGS', 'SGC', 'CGC']).nullable(), numeric_grade: z.number().min(1).max(10).nullable(), photo_evidence: text(240).nullable(),
}).strict().refine(value => value.status === 'graded' ? value.grader !== null && value.numeric_grade !== null && value.photo_evidence !== null : value.grader === null && value.numeric_grade === null && (value.status === 'unresolved' || value.photo_evidence !== null));
const duration = z.number().int().min(0).max(STAFF_INVENTORY_RESEARCH_LIMITS.overallTimeoutMs);
const timings = z.object({ photos: duration, sources: duration, images: duration, model: duration, total: duration }).strict();
const candidateId = z.string().regex(/^ebay:\d{6,20}$/);
export const StaffInventoryResearchComparisonSchema = z.object({
    candidate_id: candidateId, classification: z.enum(['matched', 'possible', 'rejected']), reason: text(400),
    identity_match: z.boolean(), variant_match: z.boolean(), visual_match: z.boolean(), condition_match: z.boolean(),
}).strict();
const decisionCode = z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/);
const imageAttempt = z.object({ source_url: imageUrl, status: z.enum(['acquired', 'failed']), error_code: decisionCode.nullable() }).strict()
    .refine(value => value.status === 'acquired' ? value.error_code === null : value.error_code !== null);
const diagnostic = z.object({
    candidate_id: candidateId,
    model_assessment: StaffInventoryResearchComparisonSchema.nullable(),
    model_image_sha256: sha256.nullable(),
    decision_codes: z.array(decisionCode).max(24),
    comparison_status: z.enum(['not_assessed', 'assessed', 'failed']),
    image_attempts: z.array(imageAttempt).max(2),
    image_width: z.number().int().min(1).max(8000).nullable(),
    image_height: z.number().int().min(1).max(8000).nullable(),
}).strict();
const diagnostics = z.object({
    schema_version: z.literal(1),
    reason_codes: z.array(decisionCode).max(24),
    sources: z.array(z.object({ sequence: z.number().int().min(1).max(3),
        returned_count: z.number().int().min(0).max(10000), parsed_count: z.number().int().min(0).max(240),
        retained_count: z.number().int().min(0).max(24), has_next_page: z.boolean(),
    }).strict()).max(3),
    candidates: z.array(diagnostic).max(24),
}).strict();
const researchQuery = z.object({
    sequence: z.number().int().min(1).max(STAFF_INVENTORY_RESEARCH_LIMITS.searches), query: text(400), reason: text(400),
    status: z.enum(['completed', 'failed']), source_response_sha256: sha256.nullable(),
    candidate_ids: z.array(candidateId).max(STAFF_INVENTORY_RESEARCH_LIMITS.candidates),
    error_code: z.enum(['invalid_input', 'unavailable', 'unverified_photo', 'provider_error', 'malformed_response', 'timeout', 'cancelled']).nullable(),
}).strict();
const saleDetails = z.object({
    schema_version: z.literal(1),
    base_engine_version: z.enum([STAFF_INVENTORY_RESEARCH_ENGINE_VERSION, STAFF_INVENTORY_RESEARCH_CATALOG_ENGINE_VERSION]),
    requests: z.array(z.object({ item_id: z.string().regex(/^\d{10,15}$/), requested_at: timestamp, completed_at: timestamp,
        status: z.enum(['observed', 'failed']), response_sha256: sha256.nullable(),
        error_code: z.enum(['unavailable', 'provider_error', 'malformed_response', 'timeout', 'cancelled']).nullable(),
    }).strict().superRefine((value, ctx) => {
        if (value.completed_at < value.requested_at || (value.status === 'observed'
            ? value.response_sha256 === null || value.error_code !== null : value.response_sha256 !== null || value.error_code === null))
            ctx.addIssue({ code: 'custom', message: 'Invalid detail request receipt.' });
    })).max(2),
}).strict();
/** This validates the private persistence boundary as well as the engine output. */
export function createResearchResultSchema(bindingShape, photo) {
    return z.object({
        schema_version: z.literal(1), ...bindingShape,
        engine_version: z.enum(['staff-inventory-research-v1', 'staff-inventory-research-v2', STAFF_INVENTORY_RESEARCH_ENGINE_VERSION, STAFF_INVENTORY_RESEARCH_CATALOG_ENGINE_VERSION, STAFF_INVENTORY_RESEARCH_SALE_DETAILS_ENGINE_VERSION, STAFF_INVENTORY_RESEARCH_PHOTO_ENGINE_VERSION]), model: z.literal(STAFF_INVENTORY_RESEARCH_MODEL), researched_at: timestamp, timings_ms: timings,
        photos: z.object({ front: photo.nullable(), back: photo.nullable() }).strict(), query: text(400).nullable(),
        // Do not add defaults: parsing an existing immutable v1 result must preserve its hash.
        research_queries: z.array(researchQuery).max(STAFF_INVENTORY_RESEARCH_LIMITS.searches).optional(),
        comparison_assessments: z.array(StaffInventoryResearchComparisonSchema).max(STAFF_INVENTORY_RESEARCH_LIMITS.candidates).optional(),
        diagnostics: diagnostics.optional(),
        catalog_context: StaffInventoryResearchCatalogContextSchema.optional(),
        sale_details: saleDetails.optional(),
        photo_identity: StaffInventoryResearchPhotoIdentitySchema.optional(),
        identity: StaffInventoryResearchIdentitySchema, target_condition: StaffInventoryResearchConditionSchema,
        references: z.array(StaffInventoryResearchReferenceSchema).max(STAFF_INVENTORY_RESEARCH_LIMITS.references),
        candidates: z.array(StaffInventoryResearchCandidateSchema).max(STAFF_INVENTORY_RESEARCH_LIMITS.candidates),
        selected_candidate_ids: z.array(z.string().regex(/^ebay:\d{6,20}$/)).max(STAFF_INVENTORY_RESEARCH_LIMITS.candidates),
        rejections: z.array(z.object({ candidate_id: z.string().regex(/^ebay:\d{6,20}$/), reason: text(400) }).strict()).max(STAFF_INVENTORY_RESEARCH_LIMITS.candidates),
        estimate: z.object({ status: z.enum(['estimated', 'unknown']), value_cents: cents.nullable(), low_cents: cents.nullable(), high_cents: cents.nullable(), currency: z.literal('USD'), count: z.number().int().min(0).max(STAFF_INVENTORY_RESEARCH_LIMITS.candidates), reason: text(400) }).strict(),
        warnings: z.array(text(400)).max(12),
    }).strict().superRefine((value, ctx) => {
        const fail = (message) => ctx.addIssue({ code: 'custom', message });
        const candidates = new Map(value.candidates.map(candidate => [candidate.id, candidate]));
        const references = new Map(value.references.map(reference => [reference.id, reference]));
        const photoEngine = value.engine_version === STAFF_INVENTORY_RESEARCH_PHOTO_ENGINE_VERSION;
        const photoIdentitySupported = photoEngine && value.photo_identity?.status === 'supported';
        if (photoEngine ? !value.photo_identity : value.photo_identity !== undefined)
            fail('Photographed identity requires an explicit v6 result.');
        if (value.photo_identity) {
            if (value.photo_identity.observations.some(observation => value.photos[observation.side]?.sha256 !== observation.photo_sha256))
                fail('Unbound photographed identity.');
            if (photoIdentitySupported && (!value.photos.front || !value.photos.back || value.photos.front.sha256 === value.photos.back.sha256))
                fail('Distinct original photographs are required.');
        }
        const detailEngine = value.engine_version === STAFF_INVENTORY_RESEARCH_SALE_DETAILS_ENGINE_VERSION || photoEngine && value.sale_details !== undefined;
        if (photoEngine && value.sale_details && value.sale_details.base_engine_version !== (value.catalog_context ? STAFF_INVENTORY_RESEARCH_CATALOG_ENGINE_VERSION : STAFF_INVENTORY_RESEARCH_ENGINE_VERSION))
            fail('Sale-detail mode does not match catalog provenance.');
        if (detailEngine) {
            if (!value.sale_details)
                fail('Missing v5 sale-detail evidence.');
            if (value.sale_details) {
                const requests = value.sale_details.requests;
                if (new Set(requests.map(request => request.item_id)).size !== requests.length)
                    fail('Duplicate detail request.');
                for (const candidate of value.candidates)
                    if (candidate.ordinary_sale_detail) {
                        const detail = candidate.ordinary_sale_detail.detail;
                        if (!requests.some(request => request.item_id === candidate.id.slice(5) && request.status === 'observed'
                            && request.response_sha256 === detail.response_sha256 && request.completed_at === detail.retrieved_at))
                            fail('Missing ordinary-sale detail request receipt.');
                    }
            }
        }
        else if (value.sale_details || value.candidates.some(candidate => candidate.ordinary_sale_detail))
            fail('Sale-detail evidence requires an explicit v5 result.');
        const catalogEngine = value.engine_version === STAFF_INVENTORY_RESEARCH_CATALOG_ENGINE_VERSION
            || detailEngine && value.sale_details?.base_engine_version === STAFF_INVENTORY_RESEARCH_CATALOG_ENGINE_VERSION
            || photoEngine && value.catalog_context !== undefined;
        if (value.engine_version === 'staff-inventory-research-v3' || catalogEngine || detailEngine || photoEngine) {
            if (!value.diagnostics || !value.research_queries || !value.comparison_assessments)
                fail('Missing v3 decision evidence.');
            if (value.candidates.some(candidate => !candidate.sale_evidence || !candidate.image_options || candidate.multiple_price_options === undefined))
                fail('Missing source decision evidence.');
        }
        if (catalogEngine) {
            const context = value.catalog_context;
            if (!context)
                fail('Missing v4 catalog evidence.');
            if (context) {
                const pins = context.publications.map(entry => JSON.stringify(entry.publication));
                if (new Set(pins).size !== pins.length || new Set(context.publications.map(p => p.publication.publicationId)).size !== pins.length || new Set(context.publications.map(p => p.publication.setId)).size !== pins.length || context.publications.some(p => p.returned_count > p.candidate_count || p.truncated !== (p.candidate_count > p.returned_count)))
                    fail('Invalid catalog coverage.');
                if (context.scope_evidence.length && !context.scope_receipt || context.scope_receipt?.images.some(image => value.photos[image.side]?.sha256 !== image.transmitted_sha256))
                    fail('Scope observations require a bound invocation receipt.');
                if (new Set(context.scope_evidence.map(e => e.field)).size !== context.scope_evidence.length || context.scope_evidence.some(e => value.photos[e.side]?.sha256 !== e.photo_sha256 || e.value === 'not_applicable'))
                    fail('Unbound catalog scope observation.');
                if (value.references.some(ref => !ref.catalog_binding || !pins.includes(JSON.stringify(ref.catalog_binding.publication))))
                    fail('Unpinned v4 reference.');
                for (const ref of value.references)
                    if (ref.catalog_binding) {
                        const lookup = context.publications.find(p => JSON.stringify(p.publication) === JSON.stringify(ref.catalog_binding.publication));
                        if (!lookup || lookup.returned_count === 0 || lookup.truncated || lookup.coverage.text === 'truncated' || lookup.coverage.applicability === 'truncated')
                            fail('Reference requires usable catalog coverage.');
                        for (const field of ['language', 'edition', 'format', 'channel'])
                            if (ref.catalog_binding.scope[field] !== 'not_applicable' && !context.scope_evidence.some(e => e.field === field && e.value === ref.catalog_binding.scope[field]))
                                fail('Unobserved catalog printing scope.');
                    }
                if (context.status !== 'current' && (value.references.length || value.identity.status !== 'unresolved' || value.selected_candidate_ids.length && !photoIdentitySupported))
                    fail('Unavailable catalog cannot establish identity.');
            }
        }
        else if (value.catalog_context || value.references.some(ref => ref.catalog_binding))
            fail('Catalog evidence requires an explicit v4 result.');
        if (value.diagnostics) {
            const entries = value.diagnostics.candidates;
            const completed = value.research_queries?.filter(query => query.status === 'completed') ?? [];
            if (completed.length !== value.diagnostics.sources.length || value.diagnostics.sources.some((source, index) => source.sequence !== completed[index]?.sequence || source.retained_count !== completed[index]?.candidate_ids.length || source.retained_count > source.parsed_count || source.parsed_count > source.returned_count))
                fail('Unbound source diagnostics.');
            if (new Set(entries.map(entry => entry.candidate_id)).size !== entries.length || entries.length !== candidates.size)
                fail('Incomplete diagnostic attribution.');
            for (const entry of entries) {
                const candidate = candidates.get(entry.candidate_id);
                if (!candidate || entry.model_assessment && entry.model_assessment.candidate_id !== entry.candidate_id)
                    fail('Unbound diagnostic candidate.');
                if (entry.image_width !== null && (!candidate?.image || entry.image_height === null) || entry.image_height !== null && entry.image_width === null)
                    fail('Unbound image dimensions.');
                if (entry.image_width && entry.image_height && entry.image_width * entry.image_height > 16_000_000)
                    fail('Oversize image dimensions.');
                if (entry.model_image_sha256 && !entry.model_assessment)
                    fail('Missing image assessment.');
                if (entry.comparison_status === 'assessed' && (!entry.model_assessment || !candidate?.image || entry.model_image_sha256 !== candidate.image.sha256))
                    fail('Unbound model assessment.');
                if (entry.image_attempts.filter(attempt => attempt.status === 'acquired').some(attempt => attempt.source_url !== candidate?.image?.source_url))
                    fail('Unbound acquired image.');
                if (entry.image_attempts.some(attempt => ![candidate?.image_options?.thumbnail_url, candidate?.image_options?.full_resolution_url, candidate?.image_url].includes(attempt.source_url)))
                    fail('Unbound diagnostic image attempt.');
            }
        }
        if (candidates.size !== value.candidates.length || references.size !== value.references.length || new Set(value.selected_candidate_ids).size !== value.selected_candidate_ids.length)
            fail('Duplicate evidence identity.');
        if (value.candidates.length && value.query === null)
            fail('Missing source query.');
        if (value.research_queries) {
            const queries = value.research_queries;
            if (queries.length && queries[0].query !== value.query)
                fail('Initial source query mismatch.');
            if (new Set(queries.map(query => query.query.toLocaleLowerCase().split(/\s+/).sort().join(' '))).size !== queries.length)
                fail('Duplicate research query.');
            for (const [index, query] of queries.entries()) {
                if (query.sequence !== index + 1 || new Set(query.candidate_ids).size !== query.candidate_ids.length)
                    fail('Invalid research query history.');
                if (query.status === 'completed' ? query.source_response_sha256 === null || query.error_code !== null : query.source_response_sha256 !== null || query.candidate_ids.length !== 0 || query.error_code === null)
                    fail('Invalid research query outcome.');
            }
            if (value.candidates.some(candidate => !queries.some(query => query.status === 'completed' && query.source_response_sha256 === candidate.source_response_sha256 && query.candidate_ids.includes(candidate.id))))
                fail('Unbound candidate search provenance.');
        }
        if (value.comparison_assessments) {
            const assessments = new Map(value.comparison_assessments.map(assessment => [assessment.candidate_id, assessment]));
            if (assessments.size !== value.comparison_assessments.length || assessments.size !== candidates.size || [...assessments.keys()].some(id => !candidates.has(id)))
                fail('Incomplete comparison assessments.');
            for (const assessment of value.comparison_assessments) {
                if (assessment.classification === 'matched' && (!assessment.identity_match || !assessment.variant_match || !assessment.visual_match || !assessment.condition_match || !candidates.get(assessment.candidate_id)?.image || !value.photos.front || !value.photos.back || value.photos.front.sha256 === value.photos.back.sha256 || value.target_condition.status === 'unresolved'))
                    fail('Unsupported matched comparison.');
            }
            if (value.selected_candidate_ids.some(id => assessments.get(id)?.classification !== 'matched'))
                fail('Estimate selections require matched comparisons.');
        }
        const rejected = new Set(value.rejections.map(rejection => rejection.candidate_id));
        if (rejected.size !== value.rejections.length || value.rejections.some(rejection => !candidates.has(rejection.candidate_id)) || value.selected_candidate_ids.some(selected => rejected.has(selected)))
            fail('Invalid rejected evidence.');
        if (rejected.size + value.selected_candidate_ids.length !== candidates.size)
            fail('Incomplete selection evidence.');
        if (new Set(value.identity.reference_ids).size !== value.identity.reference_ids.length || value.identity.reference_ids.some(reference => !references.has(reference)))
            fail('Unknown identity reference.');
        if (value.identity.photo_features.some(feature => value.photos[feature.side]?.sha256 !== feature.photo_sha256 || !value.identity.reference_ids.includes(feature.reference_id)))
            fail('Unbound photo evidence.');
        if (value.identity.status === 'unresolved') {
            if (value.identity.variant_name !== null || value.selected_candidate_ids.length && !photoIdentitySupported)
                fail('Unresolved identity cannot establish a value.');
        }
        else {
            if (!value.photos.front || !value.photos.back || value.photos.front.sha256 === value.photos.back.sha256 || !value.identity.photo_features.length || value.identity.variant_name === null)
                fail('Missing exact photo evidence.');
            const authority = value.identity.reference_ids.map(reference => references.get(reference)).find(reference => reference?.kind === 'catalog' && reference.variant_name === value.identity.variant_name && (value.identity.status === 'base' ? reference.variant_kind === 'BASE' : reference.variant_kind !== 'BASE'));
            if (!authority)
                fail('Missing catalog authority.');
            if (!value.identity.photo_features.some(feature => {
                const reference = references.get(feature.reference_id);
                if (!reference || !authority || reference.catalog_id !== authority.catalog_id || reference.variant_name !== authority.variant_name)
                    return false;
                if (feature.evidence_type === 'catalog_feature')
                    return reference.distinguishing_features.includes(feature.reference_feature);
                if (feature.evidence_type === 'reference_image')
                    return reference.kind === 'reference' && reference.image?.sha256 === feature.reference_feature;
                return feature.reference_feature === reference.variant_name && feature.observation.toLocaleLowerCase().includes(reference.variant_name.toLocaleLowerCase());
            }))
                fail('Missing distinguishing source evidence.');
        }
        const selected = value.selected_candidate_ids.map(id => candidates.get(id));
        if (selected.some(candidate => !candidate || !candidate.source_eligible || !candidate.image || candidate.sold_price_cents === null))
            fail('Unsafe selected sale.');
        if (value.estimate.status === 'unknown') {
            if (value.estimate.value_cents !== null || value.estimate.low_cents !== null || value.estimate.high_cents !== null || value.estimate.count !== 0 || selected.length)
                fail('Unknown estimate has invented amounts.');
        }
        else {
            const prices = selected.flatMap(candidate => candidate?.sold_price_cents == null ? [] : [candidate.sold_price_cents]);
            const sum = prices.reduce((total, price) => total + BigInt(price), 0n);
            const mean = prices.length ? Number((sum * 2n + BigInt(prices.length)) / (2n * BigInt(prices.length))) : null;
            if (prices.length < STAFF_INVENTORY_RESEARCH_LIMITS.minimumComps || value.estimate.count !== prices.length || value.estimate.value_cents !== mean || value.estimate.low_cents !== Math.min(...prices) || value.estimate.high_cents !== Math.max(...prices))
                fail('Estimate does not match source cents.');
            if (new Set(selected.map(candidate => candidate?.image?.sha256)).size < STAFF_INVENTORY_RESEARCH_LIMITS.minimumComps)
                fail('Independent image comparisons are required.');
            if (photoEngine && new Set(selected.map(candidate => candidate?.image?.sha256)).size !== selected.length)
                fail('Duplicate image evidence cannot receive extra weight.');
            if (value.target_condition.status === 'unresolved' || selected.some(candidate => !candidate || (value.target_condition.status === 'raw' ? !candidate.raw || /\b(?:PSA|BGS|SGC|CGC|HGA|GMA|AGS|TAG|graded|slab(?:bed)?)\b/i.test(`${candidate.title} ${candidate.condition ?? ''}`) : candidate.raw || candidate.grader !== value.target_condition.grader || candidate.numeric_grade !== value.target_condition.numeric_grade)))
                fail('Condition mismatch.');
        }
    });
}
export const LegacyInventoryResearchResultSchema = createResearchResultSchema({ unit_id: sourceId, description_event_id: sourceId, description_hash: sha256 }, photo);
export const ResearchSubjectSchema = z.object({ namespace: z.string().regex(/^[a-z][a-z0-9_-]{0,40}$/), id, revision: sha256 }).strict();
export const ResearchPhotoSchema = z.object({ ref: id, sha256, sourceSha256: sha256, mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']), byteCount: z.number().int().positive().max(2 * 1024 * 1024).nullable() }).strict();
export const StaffInventoryResearchInputSchema = z.object({ schema_version: z.literal(1), subject: ResearchSubjectSchema, description: StaffInventoryResearchDescriptionSchema, photos: z.object({ front: ResearchPhotoSchema.nullable(), back: ResearchPhotoSchema.nullable() }).strict() }).strict();
export const StaffInventoryResearchResultSchema = createResearchResultSchema({ subject: ResearchSubjectSchema }, ResearchPhotoSchema.refine(value => value.byteCount !== null));
export const STAFF_INVENTORY_RESEARCH_ERROR_MESSAGES = {
    invalid_input: 'The saved card research input is invalid.',
    unavailable: 'Card research is not configured.',
    unverified_photo: 'A saved card photo could not be verified.',
    provider_error: 'The card research provider could not complete the request.',
    malformed_response: 'Card research returned evidence that could not be verified.',
    timeout: 'Card research exceeded its time limit.',
    cancelled: 'Card research was cancelled.',
};
