import type { StaffInventoryResearchStatusV2 } from '@tenkings/database';
import { StaffInventoryResearchResultSchema, type StaffInventoryResearchResult } from '../../lib/staffInventoryResearch';
import { inventoryHash } from '../../../../packages/database/src/cardInventoryV2';
import type { StaffInventoryResearchReviewSnapshot } from '../../lib/staffInventoryMarketValue';

export const MARKET_TIME = '2026-09-21T12:00:00.000Z';
/** Synthetic in-memory evidence; never contacts storage, a provider, or a DB. */
export function marketResult(version: 1 | 2 | 3 | 5 | 6 = 1): StaffInventoryResearchResult {
  const candidates = [1001, 1002, 9900].map((price, index) => {
    const id = `ebay:${111111111110 + index}`, image_url = `https://i.ebayimg.com/images/g/fixture${index}/s-l1600.jpg`;
    return {
      id, source: 'SoldCompsAPI' as const, listing_url: `https://www.ebay.com/itm/${id.slice(5)}`,
      retrieved_at: MARKET_TIME, source_response_sha256: 'c'.repeat(64), title: index === 2 ? 'A different fixture card' : 'Fixture Runner Base Raw',
      sold_price: (price / 100).toFixed(2), sold_price_cents: price, sold_currency: 'USD', best_offer_accepted: false,
      sold_date: '2026-09-20', sold_date_raw: '2026-09-20', condition: 'Ungraded', grader: null, numeric_grade: null, raw: true,
      image_url, image: { source_url: image_url, sha256: String(index + 1).repeat(64), retrieved_at: MARKET_TIME, content_type: 'image/jpeg' as const, byte_size: 1200, storage_key: null },
      source_eligible: true, exclusion_reason: null,
      ...(version >= 3 ? { sale_evidence: { status: 'sold' as const, basis: 'listing_type' as const }, image_options: { thumbnail_url: image_url, full_resolution_url: null }, multiple_price_options: false } : {}),
    };
  });
  const comparisons = candidates.map((candidate, index) => ({ candidate_id: candidate.id, classification: index < 2 ? 'matched' as const : 'rejected' as const,
    reason: index < 2 ? 'The identity, finish and raw condition match.' : 'This is a different card.', identity_match: index < 2, variant_match: index < 2, visual_match: index < 2, condition_match: true }));
  const photo = (hash: string) => ({ key: `inventory-photos/11111111-1111-4111-8111-111111111111/${hash}.jpg`, sha256: hash });
  return StaffInventoryResearchResultSchema.parse({
    schema_version: 1, unit_id: 'fixture-unit', description_event_id: 'workflow:fixture', description_hash: 'b'.repeat(64),
    engine_version: `staff-inventory-research-v${version}`, model: 'gpt-6-astra', researched_at: MARKET_TIME,
    timings_ms: { photos: 1, sources: 1, images: 1, model: 1, total: 4 }, photos: { front: photo('d'.repeat(64)), back: photo('e'.repeat(64)) }, query: 'Fixture Runner Base Raw',
    identity: { status: 'base', variant_name: 'Base', suggestion: null, reason: 'The published card and plain border match.', reference_ids: ['catalog:fixture-base'], photo_features: [{ side: 'front', photo_sha256: 'd'.repeat(64), reference_id: 'catalog:fixture-base', evidence_type: 'catalog_feature', reference_feature: 'Plain border', observation: 'The border is plain.' }] },
    target_condition: { status: 'raw', grader: null, numeric_grade: null, photo_evidence: 'The photographed card is unslabbed.' },
    references: [{ id: 'catalog:fixture-base', kind: 'catalog', trust: 'published_catalog', catalog_id: 'fixture-catalog', identity: { name: 'Fixture Runner', category: 'Sports cards', year: '2024', manufacturer: 'Fixture Cards', set_name: 'Fixture Chrome', card_number: '007' }, variant_name: 'Base', variant_kind: 'BASE', source_url: null, source_sha256: 'f'.repeat(64), captured_at: MARKET_TIME, distinguishing_features: ['Plain border'], image: null }],
    candidates, selected_candidate_ids: candidates.slice(0, 2).map(candidate => candidate.id), rejections: [{ candidate_id: candidates[2].id, reason: 'This is a different card.' }],
    estimate: { status: 'estimated', value_cents: 1002, low_cents: 1001, high_cents: 1002, currency: 'USD', count: 2, reason: 'Mean of the selected matching sales, excluding shipping.' }, warnings: [],
    ...(version >= 2 ? { comparison_assessments: comparisons, research_queries: [{ sequence: 1, query: 'Fixture Runner Base Raw', reason: 'Search the saved card.', status: 'completed', source_response_sha256: 'c'.repeat(64), candidate_ids: candidates.map(candidate => candidate.id), error_code: null }] } : {}),
    ...(version >= 3 ? { diagnostics: { schema_version: 1, reason_codes: [], sources: [{ sequence: 1, returned_count: 3, parsed_count: 3, retained_count: 3, has_next_page: false }], candidates: candidates.map((candidate, index) => ({ candidate_id: candidate.id, model_assessment: comparisons[index], model_image_sha256: candidate.image.sha256, decision_codes: [], comparison_status: 'assessed', image_attempts: [], image_width: 100, image_height: 140 })) } } : {}),
    ...(version === 5 ? { sale_details: { schema_version: 1, base_engine_version: 'staff-inventory-research-v3', requests: [] } } : {}),
    ...(version === 6 ? {
      identity: { status: 'unresolved', variant_name: null, suggestion: null, reason: 'No published catalog record.', reference_ids: [], photo_features: [] }, references: [],
      photo_identity: { schema_version: 1, status: 'supported', reason: 'Original front and back identify the exact card and visible treatment.',
        observations: [
          { field: 'name', value: 'Fixture Runner', side: 'front', photo_sha256: 'd'.repeat(64), observation: 'The front prints Fixture Runner.' },
          { field: 'year', value: '2024', side: 'back', photo_sha256: 'e'.repeat(64), observation: 'The back prints the year 2024.' },
          { field: 'set_name', value: 'Fixture Chrome', side: 'back', photo_sha256: 'e'.repeat(64), observation: 'The back names Fixture Chrome.' },
          { field: 'card_number', value: '007', side: 'back', photo_sha256: 'e'.repeat(64), observation: 'The back prints card number 007.' },
          { field: 'treatment', value: 'Circular printed base mark beneath card number', side: 'back', photo_sha256: 'e'.repeat(64), observation: 'The distinctive circular base-printing mark is visible beneath 007.' },
        ] },
    } : {}),
  });
}

export function marketJob(result: StaffInventoryResearchResult = marketResult()): StaffInventoryResearchStatusV2 {
  return { job_id: '11111111-1111-4111-8111-111111111111', unit_id: result.unit_id, description_event_id: result.description_event_id,
    description_hash: result.description_hash, input_hash: 'a'.repeat(64), status: 'complete', attempt_count: 1, max_attempts: 3, can_retry: false,
    queued_at: MARKET_TIME, updated_at: MARKET_TIME, started_at: MARKET_TIME, completed_at: MARKET_TIME, next_attempt_at: null, error: null, result };
}

export function marketReview(job: StaffInventoryResearchStatusV2 = marketJob()): StaffInventoryResearchReviewSnapshot {
  return { schema_version: 1, job_id: job.job_id, unit_id: job.unit_id, description_event_id: job.description_event_id,
    input_hash: job.input_hash, result_hash: inventoryHash(job.result), revision: 0, decisions: [], updated_at: null };
}
