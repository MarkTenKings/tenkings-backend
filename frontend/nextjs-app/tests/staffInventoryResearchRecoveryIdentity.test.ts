import assert from 'node:assert/strict';
import test from 'node:test';
import { StaffInventoryResearchRecoveryAssessmentSchema } from '@tenkings/shared';
import { applyStaffInventoryResearchRecoveryContext } from '../lib/server/staffInventoryResearchRecoveryContext';
import { createPublishedCatalogReader } from '@tenkings/card-catalog-evidence';
import { prepareStaffInventoryResearchRecoveryIdentity as recover } from '../lib/server/staffInventoryResearchRecoveryIdentity';
import { createResearchCatalogAdapter, type CatalogPhotos } from '../lib/server/staffInventoryResearchCatalog';
import { STAFF_INVENTORY_IDENTIFICATION_FIELDS, type StaffInventoryIdentificationResponse } from '../lib/staffInventoryIdentification';
import { type StaffInventoryResearchInput, type StaffInventoryResearchReference } from '../lib/staffInventoryResearch';
// @ts-expect-error Synthetic protocol fixtures are outside the public package contract.
import { fixture, hostFixture } from '../../../packages/card-catalog-evidence/tests/fixtures.mjs';

const photoKey = (hash: string) => `inventory-photos/11111111-1111-4111-8111-111111111111/${hash.repeat(64)}.jpg`;
const input: StaffInventoryResearchInput = {
  schema_version: 1, unit_id: 'fixture:unit', description_event_id: 'fixture:description', description_hash: 'c'.repeat(64),
  front_photo_key: photoKey('a'), back_photo_key: photoKey('b'),
  description: { name: 'Fixture Runner', category: 'Sports cards', year: '2025', manufacturer: 'Fixture', set_name: 'Chrome Baseball', card_number: '007/100', variant: null, card_type: null },
};
function receipt(source = input): StaffInventoryIdentificationResponse {
  return { suggestions: Object.fromEntries(STAFF_INVENTORY_IDENTIFICATION_FIELDS.map(field => [field,
    source.description[field] === null ? { value: null, confidence: 'unknown', evidence: null }
      : { value: source.description[field], confidence: 'high', evidence: `Front or back: synthetic printed ${field}.` }])) as StaffInventoryIdentificationResponse['suggestions'],
  warnings: [], provenance: { model: 'gpt-6-astra', reasoning_effort: 'low', identified_at: '2026-09-21T00:00:00.000Z', elapsed_ms: 10,
    photos: { front: { key: source.front_photo_key!, sha256: 'a'.repeat(64) }, back: { key: source.back_photo_key!, sha256: 'b'.repeat(64) } },
    ocr: { provider: 'google_vision', front: 'read', back: 'read' } } };
}
function reference(): StaffInventoryResearchReference {
  return { id: 'fixture:ref', kind: 'catalog', trust: 'published_catalog', catalog_id: 'fixture:catalog',
    identity: { name: 'Fixture Runner', category: 'Sports cards', year: '2025', manufacturer: 'Fixture', set_name: 'Chrome Baseball', card_number: '007/100' },
    variant_name: 'Gold', variant_kind: 'PARALLEL', source_url: null, source_sha256: 'd'.repeat(64), captured_at: '2026-09-21T00:00:00.000Z',
    distinguishing_features: ['Synthetic source-backed diagnostic.'], image: null };
}

test('complete saved anchors use only cheap reviewed lookup and no recognition', async () => {
  let lookups = 0;
  const result = await recover(input, { recognize: async () => assert.fail('No missing descriptive anchors'), loadReferences: async description => {
    lookups++; assert.deepEqual(description, input.description); return [reference()];
  } });
  assert.equal(lookups, 1); assert.equal(result.recognition.status, 'not_needed');
  assert.equal(result.ready_for_research, true); assert.match(result.evidence_sha256!, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.proposed_description, input.description); assert.deepEqual(result.need_codes, []);
});

test('high-confidence original-photo evidence fills only missing required context, never saved fields or variant', async () => {
  const source = structuredClone(input), recognized = receipt(); source.description.year = null;
  recognized.suggestions.variant = { value: 'Gold', confidence: 'high', evidence: 'Front: synthetic gold border.' };
  const before = JSON.stringify(source);
  let calls = 0;
  const result = await recover(source, { recognize: async request => { calls++; assert.equal(request.front_photo_key, input.front_photo_key); return recognized; }, loadReferences: async () => [reference()] });
  assert.equal(calls, 1); assert.equal(JSON.stringify(source), before);
  assert.deepEqual(result.added_fields, ['year']); assert.equal(result.proposed_description.year, '2025');
  assert.equal(result.proposed_description.variant, null); assert.equal(result.ready_for_research, true);
  assert.deepEqual(result.recognition.evidence, recognized);
  const cached = await recover(source, { previousRecognition: recognized, allowRecognition: false,
    recognize: async () => assert.fail('A successful receipt must not be purchased again'), loadReferences: async () => [reference()] });
  assert.equal(cached.evidence_sha256, result.evidence_sha256);
});

test('low and medium confidence remain reviewable without silently becoming research identity', async () => {
  for (const confidence of ['low', 'medium'] as const) {
    const source = structuredClone(input), recognized = receipt(); source.description.year = null; recognized.suggestions.year.confidence = confidence;
    const result = await recover(source, { recognize: async () => recognized, loadReferences: async () => assert.fail('Incomplete identity') });
    assert.deepEqual(result.missing_fields, ['year']); assert.equal(result.proposed_description.year, null);
    assert.equal(result.recognition.evidence?.suggestions.year.confidence, confidence); assert.match(result.evidence_sha256!, /^[a-f0-9]{64}$/); assert.equal(result.ready_for_research, true);
  }
});

test('season, denominator, prefix, leading zero and saved variant conflicts require review without lookup', async () => {
  for (const [field, suggested] of [['year', '2025-26'], ['card_number', '7/100'], ['card_number', '007'], ['card_number', 'A-007/100'], ['variant', 'Gold']] as const) {
    const source = structuredClone(input), recognized = receipt(); source.description.manufacturer = null;
    if (field === 'variant') source.description.variant = 'Silver';
    recognized.suggestions[field] = { value: suggested, confidence: 'high', evidence: 'Synthetic conflicting printed detail.' };
    const result = await recover(source, { recognize: async () => recognized, loadReferences: async () => assert.fail('Conflict is not catalog authority') });
    assert.equal(result.proposed_description[field], source.description[field]);
    assert.equal(result.conflicts[0].field, field); assert.ok(result.need_codes.includes('DESCRIPTION_CONFLICT')); assert.match(result.evidence_sha256!, /^[a-f0-9]{64}$/); assert.equal(result.ready_for_research, true);
  }
});

test('missing or repeated photos retain retrieval permission but cannot trigger recognition or photo additions', async () => {
  for (const patch of [{ back_photo_key: null }, { back_photo_key: input.front_photo_key },
    { back_photo_key: input.front_photo_key!.replace('11111111', '22222222') }]) {
    const result = await recover({ ...input, ...patch }, { recognize: async () => assert.fail('Invalid originals'), loadReferences: async () => [] });
    assert.ok(result.need_codes.includes('MISSING_ORIGINAL_PHOTOS')); assert.equal(result.ready_for_research, true);
    assert.deepEqual(applyStaffInventoryResearchRecoveryContext({ ...input, ...patch }, result).description, input.description);
  }
  const source = { ...input, description: { ...input.description, year: null } }, foreign = receipt();
  foreign.provenance.photos.front.key = photoKey('e'); foreign.provenance.photos.front.sha256 = 'e'.repeat(64);
  const result = await recover(source, { previousRecognition: foreign, recognize: async () => assert.fail('Do not repay for corrupted cached data') });
  assert.ok(result.need_codes.includes('RECOGNITION_FAILED')); assert.deepEqual(result.added_fields, []);
});

test('unavailable recognition and exhausted allowance retain warnings without blocking saved-name retrieval', async () => {
  const source = { ...input, description: { ...input.description, year: null } };
  const deferred = await recover(source, { allowRecognition: false, recognize: async () => assert.fail('Exhausted allowance') });
  assert.equal(deferred.recognition.status, 'deferred'); assert.match(deferred.evidence_sha256!, /^[a-f0-9]{64}$/); assert.equal(deferred.ready_for_research, true);
  const unavailable = await recover(source, { recognize: async () => { throw { code: 'unavailable' }; } });
  assert.equal(unavailable.recognition.status, 'unavailable'); assert.ok(unavailable.need_codes.includes('RECOGNITION_UNAVAILABLE'));
});

test('empty, unreviewed, wrong or diagnostic-free references remain warnings while retrieval is authorized', async () => {
  for (const [records, need] of [[[], 'MISSING_CATALOG_REFERENCE'], [[{ ...reference(), distinguishing_features: [] }], 'MISSING_DIAGNOSTIC_EVIDENCE'],
    [[{ ...reference(), trust: 'model_inference' }], 'CATALOG_UNAVAILABLE'],
    [[{ ...reference(), identity: { ...reference().identity, card_number: '7/100' } }], 'CATALOG_UNAVAILABLE']] as const) {
    const result = await recover(input, { loadReferences: async () => records as unknown as StaffInventoryResearchReference[] });
    assert.ok(result.need_codes.includes(need)); assert.match(result.evidence_sha256!, /^[a-f0-9]{64}$/); assert.equal(result.ready_for_research, true);
  }
});

test('meaningful evidence digest ignores time/order but binds actual reviewed evidence, originals and engine', async () => {
  const ref = reference(), second = { ...reference(), id: 'fixture:second', variant_name: 'Silver' };
  const run = (refs: StaffInventoryResearchReference[], source = input, engine = 'fixture-engine') => recover(source, { researchEngineVersion: engine, loadReferences: async () => refs });
  const a = await run([ref, second]);
  assert.equal((await run([{ ...second, captured_at: '2026-09-22T00:00:00.000Z' }, ref])).evidence_sha256, a.evidence_sha256);
  assert.notEqual((await run([{ ...ref, source_sha256: 'e'.repeat(64) }, second])).evidence_sha256, a.evidence_sha256);
  assert.notEqual((await run([ref, second], { ...input, back_photo_key: photoKey('e') })).evidence_sha256, a.evidence_sha256);
  assert.notEqual((await run([ref, second], input, 'new-engine')).evidence_sha256, a.evidence_sha256);
});

test('real reviewed partial text-only catalog accepts explicit set alias but not fuzzy names', async () => {
  const manifest = fixture('POKEMON'); manifest.images = [];
  const stored = hostFixture(manifest), reader = createPublishedCatalogReader({ loadAuthorizedPublication: async () => stored.loaded });
  const photos: CatalogPhotos = { front: { key: input.front_photo_key!, sha256: 'a'.repeat(64), bytes: Buffer.from('fixture') }, back: { key: input.back_photo_key!, sha256: 'b'.repeat(64), bytes: Buffer.from('different fixture') } };
  const adapter = createResearchCatalogAdapter({ host: {
    findCurrentSetCatalogPublications: async () => [stored.pin],
    lookupPublishedSetCatalogEvidence: async ({ publication, query }) => reader.lookup({ publication, query: { ...query, language: 'fr', edition: 'standard' } }),
    isSetCatalogPublicationCurrent: async () => true, readPublishedSetCatalogImage: async () => assert.fail('Text authority needs no image'),
  } });
  const source = { ...input, description: { ...input.description, category: 'Pokémon', year: manifest.set.year, manufacturer: manifest.set.publisher,
    set_name: 'Fixture pokemon alias', name: manifest.cards[0].name, card_number: manifest.cards[0].number } };
  const loadCatalog = (description: typeof input.description, signal: AbortSignal) => adapter.load(description, photos, signal);
  const result = await recover(source, { loadCatalog });
  assert.equal(result.ready_for_research, true); assert.equal(result.references.length, 1); assert.equal(result.references[0].image, null);
  assert.equal(result.catalog_context?.publications[0].coverage.text, 'partial');
  const fuzzy = await recover({ ...source, description: { ...source.description, set_name: 'Fixture pokemon aliases' } }, { loadCatalog });
  assert.equal(fuzzy.ready_for_research, true); assert.deepEqual(fuzzy.references, []); assert.ok(fuzzy.need_codes.includes('MISSING_CATALOG_REFERENCE'));
});

test('same number/name on different approved programs stays ambiguous instead of silently choosing an insert', async () => {
  const manifest = fixture('SPORTS'), stored = hostFixture(manifest);
  const reader = createPublishedCatalogReader({ loadAuthorizedPublication: async () => stored.loaded });
  const adapter = createResearchCatalogAdapter({ host: {
    findCurrentSetCatalogPublications: async () => [stored.pin], lookupPublishedSetCatalogEvidence: async ({ publication, query }) => reader.lookup({ publication, query: { ...query, language: 'en', edition: 'standard' } }),
    isSetCatalogPublicationCurrent: async () => true, readPublishedSetCatalogImage: async () => assert.fail('No image download'),
  } });
  const source = { ...input, description: { ...input.description, year: manifest.set.year, manufacturer: manifest.set.manufacturer,
    set_name: manifest.set.label, name: manifest.cards[0].name, card_number: manifest.cards[0].number } };
  const result = await recover(source, { loadCatalog: (description, signal) => adapter.load(description, {}, signal) });
  assert.equal(result.ready_for_research, true); assert.ok(result.need_codes.includes('AMBIGUOUS_CATALOG_IDENTITY'));
  assert.match(result.evidence_sha256!, /^[a-f0-9]{64}$/); assert.equal(result.ready_for_research, true);
});

test('cancellation cannot be converted to a completed recovery assessment', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(recover(input, { loadReferences: async () => assert.fail('Cancelled') }, controller.signal), /cancelled/);
  const live = new AbortController();
  await assert.rejects(recover(input, { loadReferences: async () => { live.abort(); return []; } }, live.signal), /cancelled/);
});

test('catalog outage or disabled consumer keeps the paid exact-photo receipt without stale references or publication authority', async () => {
  const previousCatalogContext = { schema_version: 1 as const, status: 'current' as const, publications: [], scope_evidence: [],
    scope_receipt: { attempt_id: 'fixture:attempt', invocation_id: 'fixture:invocation', receipt_ref: 'fixture:receipt', request_sha256: 'd'.repeat(64), response_sha256: 'e'.repeat(64),
      http_status: 200, acknowledgement: 'adapter' as const, images: (['front', 'back'] as const).map((side, index) => ({ side,
        mime_type: 'image/jpeg' as const, transmitted_sha256: (index ? 'b' : 'a').repeat(64), source_sha256: null })) } };
  const unavailable = await recover(input, { previousCatalogContext, loadCatalog: async () => { throw new Error('Temporary catalog failure'); } });
  assert.ok(unavailable.need_codes.includes('CATALOG_UNAVAILABLE')); assert.deepEqual(unavailable.references, []);
  assert.deepEqual(unavailable.catalog_context?.publications, []); assert.equal(unavailable.catalog_context?.status, 'unavailable');
  assert.deepEqual(unavailable.catalog_context?.scope_receipt, previousCatalogContext.scope_receipt);
  const legacy = await recover(input, { previousCatalogContext, loadReferences: async () => [] });
  assert.deepEqual(legacy.catalog_context?.scope_receipt, previousCatalogContext.scope_receipt);
  assert.equal(legacy.catalog_context?.status, 'not_consulted'); assert.deepEqual(legacy.catalog_context?.publications, []);
  const foreign = await recover({ ...input, front_photo_key: photoKey('f') }, { previousCatalogContext, loadReferences: async () => [] });
  assert.equal(foreign.catalog_context, null);
});


test('v1 assessment bytes and strict authority are preserved while v2 allows warning-ready retrieval', async () => {
  const current = await recover(input, { loadReferences: async () => [reference()] });
  const { research_engine_version: _engine, ...legacyFields } = current;
  const legacy = { ...legacyFields, resolver_version: 'staff-inventory-recovery-identity-v1' as const };
  const bytes = JSON.stringify(legacy);
  assert.equal(JSON.stringify(StaffInventoryResearchRecoveryAssessmentSchema.parse(JSON.parse(bytes))), bytes);
  for (const patch of [{ references: [] }, { missing_fields: ['year'] }, { need_codes: ['MISSING_CATALOG_REFERENCE'] },
    { conflicts: [{ field: 'year', saved_value: '2025', suggested_value: '2026', evidence: 'Synthetic photo conflict.' }] }]) {
    assert.equal(StaffInventoryResearchRecoveryAssessmentSchema.safeParse({ ...legacy, ...patch }).success, false);
    assert.equal(StaffInventoryResearchRecoveryAssessmentSchema.safeParse({ ...current, ...patch }).success, true);
  }
  const retained = { ...legacy, references: [], need_codes: ['MISSING_CATALOG_REFERENCE'], ready_for_research: false, evidence_sha256: null };
  assert.equal(JSON.stringify(StaffInventoryResearchRecoveryAssessmentSchema.parse(retained)), JSON.stringify(retained));
});

test('v2 context preserves nonnull staff facts with conflict and missing-evidence warnings', async () => {
  const source = { ...input, description: { ...input.description, year: null } }, recognized = receipt();
  recognized.suggestions.card_number = { value: '099', confidence: 'high', evidence: 'Back: synthetic different number.' };
  const result = await recover(source, { recognize: async () => recognized, loadReferences: async () => assert.fail('Conflict blocks catalog authority only') });
  const context = applyStaffInventoryResearchRecoveryContext(source, result);
  assert.equal(context.description.card_number, source.description.card_number); assert.equal(context.description.year, '2025');
  assert.equal(source.description.year, null); assert.ok(result.need_codes.includes('DESCRIPTION_CONFLICT'));
  for (const patch of [{ source_input_sha256: 'f'.repeat(64) }, { proposed_description: { ...result.proposed_description, card_number: '099' } },
    { added_fields: [] }, { proposed_description: { ...result.proposed_description, variant: 'Gold' }, added_fields: ['year', 'variant'] }]) {
    assert.throws(() => applyStaffInventoryResearchRecoveryContext(source, { ...result, ...patch }));
  }
});

test('unchanged saved identity produces the same retrieval digest through empty lookups and catalog outages', async () => {
  const empty = await recover(input, { loadReferences: async () => [] });
  const unavailable = await recover(input, { loadReferences: async () => { throw Error('Synthetic outage'); } });
  const unavailableAgain = await recover(input, { loadReferences: async () => { throw Error('Different provider wording'); } });
  assert.equal(unavailable.evidence_sha256, empty.evidence_sha256); assert.equal(unavailableAgain.evidence_sha256, empty.evidence_sha256);
  assert.ok(unavailable.need_codes.includes('CATALOG_UNAVAILABLE')); assert.equal(unavailable.ready_for_research, true);
});

test('absent usable card name cannot fabricate a search or a ready assessment', async () => {
  const source = { ...input, description: { ...input.description, name: null } };
  const result = await recover(source, { allowRecognition: false, loadReferences: async () => assert.fail('No usable identity') });
  assert.equal(result.ready_for_research, false); assert.equal(result.evidence_sha256, null); assert.ok(result.missing_fields.includes('name'));
  assert.equal(StaffInventoryResearchRecoveryAssessmentSchema.safeParse({ ...result, ready_for_research: true, evidence_sha256: 'a'.repeat(64) }).success, false);
});
