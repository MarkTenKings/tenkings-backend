import assert from 'node:assert/strict';
import test from 'node:test';
import { canonical, inventoryHash } from '../../../packages/database/src/cardInventoryV2';
import { completeStaffInventoryResearchV2, readStaffInventoryResearchV2, STAFF_INVENTORY_RESEARCH_LIMITS_V2 } from '../../../packages/database/src/staffInventoryResearchV2';
import { StaffInventoryResearchResultSchema } from '../lib/staffInventoryResearch';

const NOW = '2026-09-11T10:00:00.000Z';
// A legacy persisted envelope: no adaptive-search or accepted-offer fields.
// All data is synthetic and remains in memory; no database is opened.
function legacyResult() {
  return {
    schema_version: 1, unit_id: 'fixture-unit', description_event_id: 'fixture-event', description_hash: 'a'.repeat(64),
    engine_version: 'staff-inventory-research-v1', model: 'gpt-6-astra', researched_at: NOW,
    timings_ms: { photos: 10, sources: 10, images: 0, model: 0, total: 20 },
    photos: { front: null, back: null }, query: 'Fixture Source Card',
    identity: { status: 'unresolved', variant_name: null, suggestion: null, reason: 'The exact variant is unverified.', reference_ids: [], photo_features: [] },
    target_condition: { status: 'unresolved', grader: null, numeric_grade: null, photo_evidence: null },
    references: [],
    candidates: [{
      id: 'ebay:111111111111', source: 'SoldCompsAPI', listing_url: 'https://www.ebay.com/itm/111111111111',
      retrieved_at: NOW, source_response_sha256: 'b'.repeat(64), title: 'Fixture Source Card Raw',
      sold_price: '25.00', sold_price_cents: null, sold_currency: 'USD', best_offer_accepted: null,
      sold_date: '2026-09-09', sold_date_raw: '2026-09-09', condition: 'Ungraded', grader: null, numeric_grade: null, raw: true,
      image_url: null, image: null, source_eligible: false, exclusion_reason: 'Best Offer status is unavailable.',
    }],
    selected_candidate_ids: [], rejections: [{ candidate_id: 'ebay:111111111111', reason: 'Price evidence is unverified.' }],
    estimate: { status: 'unknown', value_cents: null, low_cents: null, high_cents: null, currency: 'USD', count: 0, reason: 'No verified matching sales.' },
    warnings: [],
  };
}

test('legacy research parsing preserves exact persisted bytes and does not add optional evidence', () => {
  const stored = legacyResult(), encoded = canonical(stored), parsed = StaffInventoryResearchResultSchema.parse(JSON.parse(encoded));
  assert.equal(canonical(parsed), encoded);
  assert.equal(inventoryHash(parsed), inventoryHash(stored));
  assert.deepEqual(parsed, stored);
  assert.equal(Object.hasOwn(parsed, 'research_queries'), false);
  assert.equal(Object.hasOwn(parsed, 'comparison_assessments'), false);
  assert.equal(Object.hasOwn(parsed.candidates[0], 'accepted_offer'), false);
});

test('a legacy reported price remains unverified when Best Offer status is unavailable', () => {
  const stored = legacyResult(), parsed = StaffInventoryResearchResultSchema.parse(stored);
  assert.equal(parsed.candidates[0].sold_price, '25.00');
  assert.equal(parsed.candidates[0].sold_price_cents, null);
  assert.equal(parsed.candidates[0].best_offer_accepted, null);
  assert.equal(parsed.estimate.value_cents, null);
  for (const best_offer_accepted of [null, true]) {
    const changed = { ...stored, candidates: [{ ...stored.candidates[0], best_offer_accepted, sold_price_cents: 2500 }] };
    assert.equal(StaffInventoryResearchResultSchema.safeParse(changed).success, false);
  }
});

test('the real research reader accepts a legacy hash and preserves its explicit retry state', async () => {
  const stored = legacyResult();
  const input = {
    schema_version: 1, unit_id: stored.unit_id, description_event_id: stored.description_event_id, description_hash: stored.description_hash,
    description: { name: 'Fixture Source Card', category: null, manufacturer: null, card_number: null, year: null, set_name: null, variant: null, card_type: null },
    front_photo_key: null, back_photo_key: null,
  };
  const row = {
    id: '11111111-1111-4111-8111-111111111111', unitId: stored.unit_id, descriptionEventId: stored.description_event_id,
    descriptionHash: stored.description_hash, inputHash: inventoryHash(input), input: canonical(input), status: 'complete',
    attemptCount: 1, maxAttempts: 3, leaseToken: null, leaseExpiresAt: null,
    createdAt: new Date(NOW), updatedAt: new Date(NOW), nextAttemptAt: new Date(NOW), startedAt: new Date(NOW), completedAt: new Date(NOW),
    errorCode: null, errorMessage: null, result: canonical(stored), resultHash: inventoryHash(stored), retries: [],
    attempts: [{ lease_token: 'private-history-token' }],
  };
  const reader = { $queryRaw: async () => [row] } as unknown as Parameters<typeof readStaffInventoryResearchV2>[0];
  const [job] = await readStaffInventoryResearchV2(reader, { unitIds: [stored.unit_id] });
  assert.deepEqual(job.result, stored);
  assert.equal(job.can_retry, true);
  assert.equal(job.attempt_count, 1);
  assert.equal(job.max_attempts, 3);
  assert.equal(JSON.stringify(job).includes('lease'), false);
  assert.equal(JSON.stringify(job).includes('private-history-token'), false);
});

test('the persistence byte limit rejects oversized valid evidence before database access', async () => {
  const wide = (length: number) => '名'.repeat(length);
  const url = 'https://i.ebayimg.com/'.padEnd(2048, 'a');
  const candidates = Array.from({ length: 24 }, (_, index) => ({
    ...legacyResult().candidates[0], id: `ebay:${111111111111 + index}`, listing_url: `https://www.ebay.com/itm/${111111111111 + index}`,
    title: wide(500), condition: wide(200), exclusion_reason: wide(400), image_url: url,
    image: { source_url: url, sha256: 'c'.repeat(64), retrieved_at: NOW, content_type: 'image/jpeg', byte_size: 1, storage_key: null },
  }));
  const result = {
    ...legacyResult(), candidates,
    references: Array.from({ length: 24 }, (_, index) => ({
      id: `catalog:fixture-${index}`, kind: 'catalog', trust: 'published_catalog', catalog_id: `fixture-catalog-${index}`,
      identity: { name: wide(160), category: wide(80), year: wide(20), manufacturer: wide(160), set_name: wide(160), card_number: wide(80) },
      variant_name: wide(160), variant_kind: 'VARIANT', source_url: url, source_sha256: 'd'.repeat(64), captured_at: NOW,
      distinguishing_features: Array.from({ length: 16 }, () => wide(240)),
      image: { source_url: url, sha256: 'e'.repeat(64), storage_key: wide(512), content_type: 'image/jpeg' },
    })),
    rejections: candidates.map(candidate => ({ candidate_id: candidate.id, reason: wide(400) })),
  };
  StaffInventoryResearchResultSchema.parse(result);
  assert.ok(Buffer.byteLength(canonical(result)) > STAFF_INVENTORY_RESEARCH_LIMITS_V2.maxResultBytes);
  const unavailable = () => assert.fail('Oversized evidence must fail before querying or writing a database.');
  const tx = { $queryRaw: unavailable, $executeRaw: unavailable } as unknown as Parameters<typeof completeStaffInventoryResearchV2>[0];
  await assert.rejects(completeStaffInventoryResearchV2(tx, { jobId: '11111111-1111-4111-8111-111111111111', leaseToken: '22222222-2222-4222-8222-222222222222', result }), /Research evidence exceeds its byte limit/);
});
