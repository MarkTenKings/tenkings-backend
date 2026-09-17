import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import sharp from 'sharp';
import {
  StaffInventoryResearchInputSchema, StaffInventoryResearchResultSchema,
  type StaffInventoryResearchInput, type StaffInventoryResearchReference,
} from '../lib/staffInventoryResearch';
import {
  researchStaffInventoryCard, researchCatalogScopeResolver, StaffInventoryResearchError, parseStaffInventoryResearchOutput,
  isExactStaffInventoryResearchReference, buildStaffInventoryResearchQuery, validateRefinedStaffInventoryResearchQuery, type StaffInventoryResearchDependencies,
} from '../lib/server/staffInventoryResearch';

const NOW = '2026-09-11T10:00:00.000Z';
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const key = (bytes: Buffer) => `inventory-photos/11111111-1111-4111-8111-111111111111/${sha(bytes)}.jpg`;
const output = (data: unknown) => ({ model: 'gpt-6-astra', status: 'completed', error: null, incomplete_details: null, output: [
  { type: 'reasoning', summary: [] }, { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(data) }] },
] });
const code = (expected: string) => (error: unknown) => error instanceof StaffInventoryResearchError && error.code === expected;

async function fixture() {
  const bytes = await Promise.all(['white', 'blue', 'red', 'green', 'yellow'].map(background => sharp({ create: { width: 100, height: 140, channels: 3, background } }).jpeg().toBuffer()));
  const input: StaffInventoryResearchInput = {
    schema_version: 1, unit_id: 'fixture-unit', description_event_id: 'fixture-event', description_hash: 'b'.repeat(64),
    description: { name: 'Fixture Runner', category: 'Sports cards', manufacturer: 'Fixture Cards', card_number: '007', year: '2024', set_name: 'Fixture Chrome', variant: null, card_type: 'Baseball' },
    front_photo_key: key(bytes[0]), back_photo_key: key(bytes[1]),
  };
  const reference: StaffInventoryResearchReference = {
    id: 'catalog:fixture-base', kind: 'catalog', trust: 'published_catalog', catalog_id: 'fixture-catalog',
    identity: { name: 'Fixture Runner', category: 'Sports cards', year: '2024', manufacturer: 'Fixture Cards', set_name: 'Fixture Chrome', card_number: '007' },
    variant_name: 'Base', variant_kind: 'BASE', source_url: null, source_sha256: 'c'.repeat(64), captured_at: NOW,
    distinguishing_features: ['A printed circular base mark beneath the card number'], image: null,
  };
  const items: Record<string, unknown>[] = [0, 1].map(index => ({
    itemId: `11111111111${index}`, url: `https://www.ebay.com/itm/11111111111${index}`, title: '2024 Fixture Cards Fixture Chrome Fixture Runner #007 Base Raw',
    soldPrice: index ? '10.02' : '10.01', soldCurrency: 'USD', bestOfferAccepted: false, listingType: 'sold', endedAt: '2026-09-09', condition: 'Ungraded',
    thumbnailUrl: `https://i.ebayimg.com/images/g/fixture${index}/s-l400.jpg`,
  }));
  let modelValue: any = {
    identity: { status: 'base', variant_name: 'Base', suggestion: null, reason: 'The published exact card checklist and visible circular base mark match.', reference_ids: [reference.id], photo_features: [{ side: 'back', photo_sha256: sha(bytes[1]), reference_id: reference.id, evidence_type: 'catalog_feature', reference_feature: reference.distinguishing_features[0], observation: 'Back: circular base mark beneath 007.' }] },
    target_condition: { status: 'raw', grader: null, numeric_grade: null, photo_evidence: 'Both photos show an ungraded card without a grading label.' },
    refinement: null,
    selected_candidate_ids: items.map(item => `ebay:${item.itemId}`),
    comparisons: items.map(item => ({ candidate_id: `ebay:${item.itemId}`, classification: 'matched', identity_match: true, variant_match: true, visual_match: true, condition_match: true, reason: 'The exact identity and printed mark match the uploaded raw card.' })),
  };
  const calls: { url: string; init: RequestInit; body: any }[] = [];
  const deps: StaffInventoryResearchDependencies = {
    env: { OPENAI_API_KEY: 'fixture-openai-key', SOLDCOMPS_API_KEY: 'fixture-sold-key', SERPAPI_KEY: 'must-never-use' }, now: () => new Date(NOW),
    loadPhoto: async photoKey => { const source = photoKey === input.front_photo_key ? bytes[0] : bytes[1]; return { key: photoKey, sha256: sha(source), bytes: source }; },
    loadReferences: async () => [reference],
    fetchImpl: (async (url, init) => {
      const uri = String(url); calls.push({ url: uri, init: init ?? {}, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (uri.startsWith('https://api.sold-comps.com/v1/scrape?')) return Response.json({ keyword: new URL(uri).searchParams.get('keyword'), page: 1, totalItems: items.length, hasNextPage: false, items });
      if (uri === 'https://api.openai.com/v1/responses') return Response.json(output(modelValue));
      const index = items.findIndex(item => item.thumbnailUrl === uri);
      assert.ok(index >= 0, 'Only supplied approved image URLs may be fetched');
      return new Response(new Uint8Array(bytes[2 + index]), { headers: { 'content-type': 'image/jpeg' } });
    }) as typeof fetch,
  };
  return { input, reference, items, bytes, deps, calls, get model() { return modelValue; }, set model(value: any) { modelValue = value; } };
}

test('private research selects only exact supplied sales and calculates source cents without model prices', async () => {
  const f = await fixture();
  const result = await researchStaffInventoryCard(f.input, f.deps);
  assert.equal(StaffInventoryResearchResultSchema.safeParse(result).success, true);
  assert.equal(result.estimate.value_cents, 1002); // exact half-cent rounds up
  assert.equal(result.estimate.low_cents, 1001); assert.equal(result.estimate.high_cents, 1002); assert.equal(result.estimate.count, 2);
  assert.equal(result.identity.status, 'base');
  assert.equal(result.candidates[0].best_offer_accepted, false);
  assert.equal(result.candidates[0].sold_currency, 'USD');
  assert.equal(result.candidates[0].sold_price, '10.01');
  assert.equal(result.candidates[0].sold_date_raw, '2026-09-09');
  assert.equal(result.candidates[0].image?.sha256, sha(f.bytes[2]));
  assert.equal(result.candidates[0].image?.storage_key, null);
  const source = f.calls.find(call => call.url.startsWith('https://api.sold-comps.com/'))!;
  assert.equal(source.init.method, 'GET'); assert.equal((source.init.headers as any).Authorization, 'Bearer fixture-sold-key');
  assert.equal(new URL(source.url).searchParams.get('count'), '240');
  assert.ok(f.calls.every(call => call.init.redirect === 'error' && call.init.cache === 'no-store'));
  assert.equal(f.calls.some(call => /serpapi|must-never-use/i.test(call.url)), false);
  const model = f.calls.find(call => call.url === 'https://api.openai.com/v1/responses')!;
  assert.equal(model.body.model, 'gpt-6-astra'); assert.equal(model.body.store, false);
  assert.equal(model.body.tools, undefined);
  assert.equal(JSON.stringify(model.body).includes('inventory-photos/'), false);
  assert.equal(JSON.stringify(model.body).includes('fixture-unit'), false);
  assert.equal(JSON.stringify(model.body).includes('10.01'), false);
  const images = model.body.input[0].content.filter((part: any) => part.type === 'input_image');
  assert.deepEqual(images.slice(0, 2).map((image: any) => Buffer.from(image.image_url.split(',')[1], 'base64')), f.bytes.slice(0, 2));
  assert.equal(JSON.stringify(result).includes('fixture-openai-key'), false);
});

test('saved source inputs stay compatible and unsafe-to-transmit descriptions complete unknown without vendor calls', async () => {
  const f = await fixture();
  const input = { ...f.input, unit_id: `source/${'x'.repeat(190)}`, description: { ...f.input.description, name: 'Name with\na line and https://example.com' } };
  assert.equal(StaffInventoryResearchInputSchema.safeParse(input).success, true);
  const result = await researchStaffInventoryCard(input, f.deps);
  assert.equal(result.estimate.status, 'unknown'); assert.equal(result.query, null); assert.equal(f.calls.length, 0);
  assert.equal(result.unit_id, input.unit_id);
});

test('blank variant never becomes base without exact published evidence; useful fetched comps remain', async () => {
  const f = await fixture(); f.deps.loadReferences = async () => [];
  f.model.identity = { status: 'unresolved', variant_name: null, suggestion: null, reason: 'No published checklist establishes the base or variant.', reference_ids: [], photo_features: [] };
  f.model.selected_candidate_ids = [];
  const result = await researchStaffInventoryCard(f.input, f.deps);
  assert.equal(result.candidates.length, 2); assert.equal(result.rejections.length, 2);
  assert.equal(result.identity.status, 'unresolved'); assert.equal(result.estimate.status, 'unknown'); assert.equal(result.estimate.value_cents, null);
  assert.match(result.warnings.join(' '), /No exact published checklist/);
  assert.equal(f.calls.filter(call => call.url.startsWith('https://api.sold-comps.com/')).length, 1);
});

test('missing and corrupted photos retain source candidates and never enter image/model assessment', async () => {
  for (const corrupt of [false, true]) {
    const f = await fixture();
    if (corrupt) f.deps.loadPhoto = async photoKey => ({ key: photoKey, sha256: sha(f.bytes[0]), bytes: f.bytes[1] });
    else f.input.front_photo_key = null;
    const result = await researchStaffInventoryCard(f.input, f.deps);
    assert.equal(result.candidates.length, 2); assert.equal(result.estimate.status, 'unknown');
    assert.equal(f.calls.length, 1); assert.ok(f.calls[0].url.startsWith('https://api.sold-comps.com/'));
  }
});

test('source price eligibility preserves Best Offer, currency, malformed price and date uncertainty', async () => {
  for (const change of [
    { bestOfferAccepted: true }, { bestOfferAccepted: undefined }, { soldCurrency: 'CAD' }, { soldCurrency: undefined },
    { soldPrice: '12.345' }, { soldPrice: '0.00' }, { soldPrice: '$10.00' }, { endedAt: '2026-02-30' }, { endedAt: '2027-01-01' },
  ]) {
    const f = await fixture(); Object.assign(f.items[0], change); f.input.front_photo_key = null;
    const result = await researchStaffInventoryCard(f.input, f.deps);
    const candidate = result.candidates.find(candidate => candidate.id === 'ebay:111111111110')!;
    assert.equal(candidate.source_eligible, false); assert.ok(candidate.exclusion_reason); assert.equal(result.estimate.value_cents, null);
    if (change.bestOfferAccepted === true) { assert.equal(candidate.best_offer_accepted, true); assert.equal(candidate.sold_price, '10.01'); assert.equal(candidate.sold_price_cents, null); }
  }
});

test('lots, proxy cards and other explicitly unsupported sale products stay unselectable', async () => {
  for (const suffix of ['lot of 2', 'custom proxy', 'sealed booster box', 'complete set']) {
    const f = await fixture(); f.items[0].title = `${f.items[0].title} ${suffix}`;
    await assert.rejects(researchStaffInventoryCard(f.input, f.deps), code('malformed_response'));
    f.input.front_photo_key = null;
    const result = await researchStaffInventoryCard(f.input, f.deps);
    assert.equal(result.candidates.find(candidate => candidate.id === 'ebay:111111111110')!.source_eligible, false);
  }
});

test('bad listing links and conflicting duplicate source rows cannot become valid selected evidence', async () => {
  const f = await fixture(); f.input.front_photo_key = null;
  f.items.push({ ...f.items[0], soldPrice: '400.00' });
  f.items.push({ ...f.items[1], itemId: '999999999999', url: 'https://evil.example/itm/999999999999' });
  f.items.push({ ...f.items[1], itemId: '999999999998' });
  const result = await researchStaffInventoryCard(f.input, f.deps);
  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates.find(candidate => candidate.id === 'ebay:111111111110')!.source_eligible, false);
  assert.match(result.candidates.find(candidate => candidate.id === 'ebay:111111111110')!.exclusion_reason!, /conflicting/);
});

test('foreign IDs, forged photo/reference facts, wrong identities and grade mismatches fail closed', async () => {
  const changes = [
    (f: Awaited<ReturnType<typeof fixture>>) => { f.model.selected_candidate_ids[0] = 'ebay:999999999999'; },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.model.comparisons[0].candidate_id = 'ebay:999999999999'; },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.model.identity.photo_features[0].photo_sha256 = 'f'.repeat(64); },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.model.identity.reference_ids = ['catalog:invented']; },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.model.identity.photo_features[0].reference_feature = 'Imaginary red pattern'; },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.model.identity.variant_name = 'Invented Rainbow'; },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.model.identity.suggestion = 'Invented Rainbow'; },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.model.comparisons[0].visual_match = false; },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.items[0].title = String(f.items[0].title).replace('2024', '2023'); },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.items[0].title = `${f.items[0].title} PSA 10`; },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.items[0].title = `${f.items[0].title} PSA`; },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.items[0].bestOfferAccepted = true; },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.model.target_condition = { status: 'graded', grader: 'PSA', numeric_grade: 10, photo_evidence: 'Front: PSA 10.' }; },
  ];
  for (const change of changes) { const f = await fixture(); change(f); await assert.rejects(researchStaffInventoryCard(f.input, f.deps), code('malformed_response')); }
});

test('exact same visible grader and grade may match; no grade mapping occurs', async () => {
  const f = await fixture();
  for (const item of f.items) item.title = String(item.title).replace('Raw', 'PSA 9');
  f.model.target_condition = { status: 'graded', grader: 'PSA', numeric_grade: 9, photo_evidence: 'Front label: PSA 9.' };
  const result = await researchStaffInventoryCard(f.input, f.deps);
  assert.equal(result.estimate.status, 'estimated'); assert.equal(result.target_condition.numeric_grade, 9);
  f.model.target_condition.numeric_grade = 9.5; f.model.target_condition.photo_evidence = 'Front label: PSA 9.5.';
  await assert.rejects(researchStaffInventoryCard(f.input, f.deps), code('malformed_response'));
});

test('image downloads are source-allowlisted, bounded, redirect-free and hash-bound', async () => {
  for (const url of ['https://127.0.0.1/private', 'https://i.ebayimg.com.evil.example/card.jpg', 'http://i.ebayimg.com/card.jpg', 'https://i.ebayimg.com:444/card.jpg', 'https://user:password@i.ebayimg.com/card.jpg', 'https://i.ebayimg.com/card.jpg?token=secret']) {
    const f = await fixture(); f.items[0].thumbnailUrl = url;
    await assert.rejects(researchStaffInventoryCard(f.input, f.deps), code('malformed_response'));
    assert.equal(f.calls.some(call => call.url === url), false);
  }
  for (const response of [
    () => new Response('not an image', { headers: { 'content-type': 'image/jpeg' } }),
    () => new Response('x', { headers: { 'content-type': 'image/jpeg', 'content-length': String(2 * 1024 * 1024 + 1) } }),
    () => new Response('redirect', { status: 302, headers: { location: 'https://127.0.0.1/private' } }),
  ]) {
    const f = await fixture(), original = f.deps.fetchImpl!;
    f.deps.fetchImpl = ((url, init) => String(url).startsWith('https://i.ebayimg.com/') ? Promise.resolve(response()) : original(url, init)) as typeof fetch;
    await assert.rejects(researchStaffInventoryCard(f.input, f.deps), code('malformed_response'));
  }
});

test('duplicate images across distinct listing IDs do not provide two independent visual comparisons', async () => {
  const f = await fixture(), original = f.deps.fetchImpl!;
  f.deps.fetchImpl = ((url, init) => String(url).startsWith('https://i.ebayimg.com/') ? Promise.resolve(new Response(new Uint8Array(f.bytes[2]), { headers: { 'content-type': 'image/jpeg' } })) : original(url, init)) as typeof fetch;
  const result = await researchStaffInventoryCard(f.input, f.deps);
  assert.equal(result.estimate.status, 'unknown'); assert.equal(result.candidates.length, 2); assert.equal(result.rejections.length, 2);
  assert.ok(result.rejections.every(rejection => /Fewer than two independent/.test(rejection.reason)));
  const one = await fixture(); one.model.selected_candidate_ids.pop();
  const insufficient = await researchStaffInventoryCard(one.input, one.deps);
  assert.equal(insufficient.estimate.status, 'unknown'); assert.equal(insufficient.estimate.value_cents, null); assert.equal(insufficient.candidates.length, 2);
});

test('reference matching requires exact explicit card anchors and admits unambiguous composite names', async () => {
  const f = await fixture();
  const description = { ...f.input.description, name: '2024 Fixture Cards Fixture Runner #007' };
  const reference = { ...f.reference, identity: { ...f.reference.identity, category: null, set_name: '2024_Fixture_Cards_Fixture_Chrome' } };
  assert.equal(isExactStaffInventoryResearchReference(description, reference), true);
  assert.equal(isExactStaffInventoryResearchReference(description, { ...reference, identity: { ...reference.identity, set_name: '2024_Fixture_Cards_Fixture_Chrome_Baseball' } }), true);
  assert.equal(isExactStaffInventoryResearchReference({ ...description, card_type: null }, { ...reference, identity: { ...reference.identity, set_name: '2024_Fixture_Cards_Fixture_Chrome_Baseball' } }), false);
  for (const identity of [
    { ...reference.identity, name: 'Runner Two' }, { ...reference.identity, card_number: '7' }, { ...reference.identity, card_number: '007/100' },
    { ...reference.identity, year: '2025' }, { ...reference.identity, set_name: '2024 Fixture Cards Fixture Chrome Black' }, { ...reference.identity, category: 'Pokémon' },
  ]) assert.equal(isExactStaffInventoryResearchReference(description, { ...reference, identity }), false);
  assert.equal(isExactStaffInventoryResearchReference({ ...description, year: null }, reference), false);
  assert.equal(buildStaffInventoryResearchQuery({ ...description, name: null }), null);
  assert.equal(buildStaffInventoryResearchQuery({ ...description, card_number: '007/120' }), '2024 Fixture Cards Chrome Runner #007 007/120');
  f.input.description.name = '2024 Fixture Cards Fixture Runner #007';
  const result = await researchStaffInventoryCard(f.input, f.deps);
  assert.equal(result.estimate.status, 'estimated');
  assert.equal(result.query, '2024 Fixture Cards Chrome Runner #007');
});

test('approved reference image evidence requires the exact retained source hash', async () => {
  const f = await fixture();
  const reference: StaffInventoryResearchReference = { ...f.reference, id: 'reference:fixture', kind: 'reference', trust: 'approved_reference', image: { source_url: 'https://i.ebayimg.com/images/g/reference/s-l400.jpg', sha256: sha(f.bytes[4]), storage_key: 'approved-reference/source.jpg', content_type: 'image/jpeg' } };
  f.deps.loadReferences = async () => [f.reference, reference];
  f.deps.loadReferenceImage = async () => f.bytes[4];
  f.model.identity.reference_ids.push(reference.id);
  f.model.identity.photo_features = [{ side: 'back', photo_sha256: sha(f.bytes[1]), reference_id: reference.id, evidence_type: 'reference_image', reference_feature: sha(f.bytes[4]), observation: 'Back: the exact reference circular printed base mark matches.' }];
  const result = await researchStaffInventoryCard(f.input, f.deps); assert.equal(result.estimate.status, 'estimated');
  f.deps.loadReferenceImage = async () => f.bytes[2];
  await assert.rejects(researchStaffInventoryCard(f.input, f.deps), code('malformed_response'));
});

test('private image archives record exact key/hash and failed archives remain explicitly unretained', async () => {
  const f = await fixture(); let archived = 0;
  f.deps.archiveCandidateImage = async image => { archived++; assert.equal(image.sha256, sha(image.bytes)); return { storage_key: `research-evidence/${image.sha256}.jpg` }; };
  const result = await researchStaffInventoryCard(f.input, f.deps); assert.equal(archived, 2);
  assert.ok(result.candidates.every(candidate => candidate.image !== null && candidate.image.storage_key === `research-evidence/${candidate.image.sha256}.jpg`));
  f.deps.archiveCandidateImage = async () => { throw new Error('private credentials must not appear'); };
  const unavailable = await researchStaffInventoryCard(f.input, f.deps);
  assert.ok(unavailable.candidates.every(candidate => candidate.image?.storage_key === null));
  assert.match(unavailable.warnings.join(' '), /could not be retained/);
  assert.equal(JSON.stringify(unavailable).includes('credentials'), false);
});

test('response and persistence validation reject extra model prices, wrong models and tampered math', async () => {
  const f = await fixture();
  for (const payload of [output({ ...f.model, value_cents: 99999 }), { ...output(f.model), model: 'gpt-5.5' }, { ...output(f.model), status: 'incomplete' }, output({ ...f.model, identity: { ...f.model.identity, reason: 'https://secret.example/key' } })]) assert.throws(() => parseStaffInventoryResearchOutput(payload), code('malformed_response'));
  const result = await researchStaffInventoryCard(f.input, f.deps);
  for (const mutate of [
    (r: any) => { r.estimate.value_cents = 1000; }, (r: any) => { r.candidates[0].sold_price = '99.00'; },
    (r: any) => { r.candidates[0].best_offer_accepted = true; }, (r: any) => { r.candidates[0].image.sha256 = '0'.repeat(64); r.candidates[0].image.storage_key = 'research-evidence/' + '1'.repeat(64) + '.jpg'; },
    (r: any) => { r.identity.reference_ids = ['foreign']; }, (r: any) => { r.identity.status = 'unresolved'; },
  ]) { const changed = structuredClone(result); mutate(changed); assert.equal(StaffInventoryResearchResultSchema.safeParse(changed).success, false); }
});

test('provider failures, wrong-query results and stalled headers or bodies are bounded and sanitized', async () => {
  for (const answer of [
    () => { throw new Error('https://secret.example/?key=sk-private-secret'); },
    () => new Response('private server error', { status: 500 }),
    () => Response.json({ keyword: 'different query', page: 1, totalItems: 0, hasNextPage: false, items: [] }),
    () => new Response('{', { headers: { 'content-type': 'application/json' } }),
    () => Response.json({ message: 'fixture-sold-key' }),
  ]) {
    const f = await fixture(); f.deps.fetchImpl = (async () => answer()) as typeof fetch;
    await assert.rejects(researchStaffInventoryCard(f.input, f.deps), error => error instanceof StaffInventoryResearchError && !/secret|https:|server error/.test(error.message));
  }
  for (const stallBody of [false, true]) {
    const f = await fixture(); f.deps.timeoutMs = 50; let cancelled = false, observed: AbortSignal | undefined;
    f.deps.fetchImpl = (async (_url, init) => {
      observed = init?.signal as AbortSignal;
      if (!stallBody) return new Promise<Response>(() => {});
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const started = Date.now();
    await assert.rejects(researchStaffInventoryCard(f.input, f.deps), code('timeout'));
    assert.ok(Date.now() - started < 1000); assert.equal(observed?.aborted, true); if (stallBody) assert.equal(cancelled, true);
  }
});

test('provider rows, image reads and concurrency stay bounded even with a large source response', async () => {
  const f = await fixture(); f.deps.loadReferences = async () => [];
  f.items.splice(0, f.items.length, ...Array.from({ length: 250 }, (_, index) => ({
    itemId: String(200000000000 + index), url: `https://www.ebay.com/itm/${200000000000 + index}`,
    title: '2024 Fixture Cards Fixture Chrome Fixture Runner #007 Base Raw', soldPrice: '10.00', soldCurrency: 'USD', bestOfferAccepted: false,
    endedAt: '2026-09-09', thumbnailUrl: `https://i.ebayimg.com/images/g/bounded${index}/s-l400.jpg`,
  })));
  f.model.identity = { status: 'unresolved', variant_name: null, suggestion: null, reason: 'No exact published catalog evidence.', reference_ids: [], photo_features: [] };
  f.model.selected_candidate_ids = [];
  f.model.comparisons = f.items.slice(0, 24).map(item => ({ candidate_id: `ebay:${item.itemId}`, classification: 'matched', identity_match: true, variant_match: false, visual_match: false, condition_match: true, reason: 'Catalog evidence is unavailable.' }));
  const original = f.deps.fetchImpl!; let active = 0, highest = 0, imageCount = 0;
  f.deps.fetchImpl = (async (url, init) => {
    if (!String(url).startsWith('https://i.ebayimg.com/')) return original(url, init);
    imageCount++; active++; highest = Math.max(highest, active);
    await new Promise(resolve => setTimeout(resolve, 5)); active--;
    return new Response(new Uint8Array(f.bytes[2]), { headers: { 'content-type': 'image/jpeg' } });
  }) as typeof fetch;
  const result = await researchStaffInventoryCard(f.input, f.deps);
  assert.equal(result.candidates.length, 24); assert.equal(imageCount, 6); assert.equal(highest, 4); assert.equal(result.estimate.status, 'unknown');
});

test('decoded compressed responses use decoded byte bounds without confusing the encoded length', async () => {
  const f = await fixture(), original = f.deps.fetchImpl!;
  f.deps.fetchImpl = (async (url, init) => {
    const response = await original(url, init);
    if (String(url).startsWith('https://api.sold-comps.com/')) {
      // WHATWG fetch has already decoded the body but leaves these wire headers.
      response.headers.set('content-encoding', 'gzip'); response.headers.set('content-length', '1');
    }
    return response;
  }) as typeof fetch;
  assert.equal((await researchStaffInventoryCard(f.input, f.deps)).estimate.status, 'estimated');
  f.deps.fetchImpl = (async () => new Response('x'.repeat(5 * 1024 * 1024 + 1), { headers: { 'content-type': 'application/json', 'content-encoding': 'gzip', 'content-length': '1' } })) as typeof fetch;
  await assert.rejects(researchStaffInventoryCard(f.input, f.deps), code('malformed_response'));
});

test('missing research credentials stop without photo, reference or alternate provider access', async () => {
  const f = await fixture(); let reads = 0;
  f.deps.loadPhoto = async () => { reads++; assert.fail('No photo read before configuration'); };
  f.deps.loadReferences = async () => { reads++; return []; };
  for (const env of [{}, { OPENAI_API_KEY: 'x' }, { SOLDCOMPS_API_KEY: 'x' }, { SERPAPI_KEY: 'present-but-not-allowed' }]) {
    await assert.rejects(researchStaffInventoryCard(f.input, { ...f.deps, env }), code('unavailable'));
  }
  assert.equal(f.calls.length, 0); assert.equal(reads, 0);
});

test('worker cancellation aborts one bounded source request without alternate providers or retries', async () => {
  const f = await fixture(), controller = new AbortController(); let started: () => void = () => {};
  const ready = new Promise<void>(resolve => { started = resolve; }); let calls = 0, observed: AbortSignal | undefined;
  f.deps.fetchImpl = (async (_url, init) => { calls++; observed = init?.signal as AbortSignal; started(); return new Promise<Response>(() => {}); }) as typeof fetch;
  const pending = researchStaffInventoryCard(f.input, f.deps, controller.signal); await ready; controller.abort();
  await assert.rejects(pending, code('cancelled')); assert.equal(calls, 1); assert.equal(observed?.aborted, true);
});

test('refined queries preserve exact player, product, number and validated season while allowing bounded visual wording', async () => {
  const f = await fixture(), description = { ...f.input.description, year: '2024-25' };
  const valid = '2025 Fixture Chrome Fixture Runner #007 blue';
  assert.equal(validateRefinedStaffInventoryResearchQuery(description, valid), valid);
  assert.equal(validateRefinedStaffInventoryResearchQuery(description, valid.replace('2025', '2024')), valid.replace('2025', '2024'));
  for (const query of [
    valid.replace('Runner', 'Stranger'), valid.replace('Chrome', 'Phoenix'), valid.replace('#007', '#7'), valid.replace('2025', '2023'),
    valid + ' https://evil.example', valid + ' -PSA', valid + ' secret', valid + ' 101', valid.replace('#007', '#007/100'),
  ]) assert.equal(validateRefinedStaffInventoryResearchQuery(description, query), null, query);
  const denominator = { ...description, card_number: '007/100' };
  assert.equal(validateRefinedStaffInventoryResearchQuery(denominator, valid), null);
  assert.equal(validateRefinedStaffInventoryResearchQuery(denominator, valid.replace('#007', '#007/100')), valid.replace('#007', '#007/100'));
  assert.equal(description.year, '2024-25');
});

async function adaptiveFixture(count = 2) {
  const f = await fixture(); f.deps.loadReferences = async () => [];
  f.model.identity = { status: 'unresolved', variant_name: null, suggestion: null, reason: 'The exact published catalog is unavailable.', reference_ids: [], photo_features: [] };
  f.model.selected_candidate_ids = [];
  const queries = ['2024 Fixture Chrome Fixture Runner #007 blue', '2024 Fixture Chrome Fixture Runner #007 silver'];
  const sources: string[] = [], modelBodies: any[] = [];
  const rows = (round: number) => Array.from({ length: count }, (_, index) => ({
    ...f.items[index % 2], itemId: String(300000000000 + round * 100 + index), url: `https://www.ebay.com/itm/${300000000000 + round * 100 + index}`,
    title: round === 0 ? '2024 Fixture Cards Fixture Chrome Unrelated Player #999 Raw' : '2024 Fixture Cards Fixture Chrome Fixture Runner #007 Blue Raw',
    bestOfferAccepted: null, thumbnailUrl: `https://i.ebayimg.com/images/g/round${round}-${index}/s-l400.jpg`,
  }));
  let nextRows = rows, nextModel: ((value: any, round: number) => any) | null = null;
  f.deps.fetchImpl = (async (url, init) => {
    const uri = String(url);
    if (uri.startsWith('https://api.sold-comps.com/')) {
      const keyword = new URL(uri).searchParams.get('keyword')!;
      const round = sources.length; sources.push(keyword);
      const items = nextRows(round);
      return Response.json({ keyword, page: 1, totalItems: items.length, hasNextPage: false, items });
    }
    if (uri.startsWith('https://i.ebayimg.com/')) return new Response(new Uint8Array(f.bytes[2 + sources.length % 2]), { headers: { 'content-type': 'image/jpeg' } });
    assert.equal(uri, 'https://api.openai.com/v1/responses');
    const body = JSON.parse(String(init?.body)); modelBodies.push(body);
    const candidates = body.input[0].content.filter((part: any) => part.type === 'input_text' && part.text.startsWith('Candidate data: ')).map((part: any) => JSON.parse(part.text.slice(16)));
    const value = { ...f.model, refinement: sources.length < 3 ? { query: queries[sources.length - 1], reason: 'Refine the visible finish wording after the first mismatched listing results.' } : null,
      comparisons: candidates.map((candidate: any) => ({ candidate_id: candidate.id, classification: candidate.title.includes('Unrelated Player') ? 'rejected' : candidate.image_sha256 ? 'matched' : 'possible', identity_match: !candidate.title.includes('Unrelated Player'), variant_match: !candidate.title.includes('Unrelated Player'), visual_match: Boolean(candidate.image_sha256), condition_match: true, reason: candidate.title.includes('Unrelated Player') ? 'The card number and player differ from the uploaded card.' : 'The visible card artwork and blue finish match; catalog and sale-price evidence remain unresolved.' })) };
    return Response.json(output(nextModel ? nextModel(value, sources.length - 1) : value));
  }) as typeof fetch;
  return { ...f, sources, modelBodies, rows, queries, setRows(value: typeof rows) { nextRows = value; }, setModel(value: NonNullable<typeof nextModel>) { nextModel = value; } };
}

test('Astra refines poor searches, retains query provenance and separates visual matches from unknown-price estimates', async () => {
  const f = await adaptiveFixture();
  const result = await researchStaffInventoryCard(f.input, f.deps);
  assert.deepEqual(f.sources, [buildStaffInventoryResearchQuery(f.input.description), ...f.queries]);
  assert.equal(result.research_queries?.length, 3); assert.equal(result.candidates.length, 6);
  assert.equal(result.comparison_assessments?.filter(assessment => assessment.classification === 'rejected').length, 2);
  assert.equal(result.comparison_assessments?.filter(assessment => assessment.classification === 'matched').length, 4);
  assert.equal(result.selected_candidate_ids.length, 0); assert.equal(result.estimate.status, 'unknown');
  assert.equal(result.candidates.every(candidate => candidate.sold_price === '10.01' || candidate.sold_price === '10.02'), true);
  assert.equal(result.candidates.every(candidate => candidate.sold_price_cents === null), true);
  assert.ok(result.research_queries?.every(query => query.status === 'completed' && query.source_response_sha256?.length === 64));
  assert.equal(f.modelBodies.length, 3);
  assert.deepEqual(f.input.description, (await fixture()).input.description);
});

test('query history attributes thirteen initial results and an empty refinement before an anchor-preserving broader search', async () => {
  const f = await adaptiveFixture(13), broadened = '2024 Fixture Chrome Fixture Runner #007';
  f.setRows(round => round === 0 ? f.rows(0) : round === 1 ? [] : f.rows(2).slice(0, 2));
  const histories: Array<Array<{ query: string; result_count: number | null; candidate_ids: string[] }>> = [];
  f.setModel((value, round) => {
    const body = f.modelBodies[round];
    const historyText = body.input[0].content.find((part: any) => part.type === 'input_text' && part.text.startsWith('Research queries already attempted: ')).text;
    const history = JSON.parse(historyText.slice('Research queries already attempted: '.length).split('. This is search ')[0]);
    histories.push(history);
    if (round === 1) {
      assert.deepEqual(history.map((query: any) => query.result_count), [13, 0]);
      assert.deepEqual(history[0].candidate_ids, f.rows(0).map(item => `ebay:${item.itemId}`));
      assert.deepEqual(history[1].candidate_ids, []);
      // The merged old candidates are still visible, but none is attributed to
      // the empty query. The model can therefore choose a broader third search.
      assert.equal(value.comparisons.length, 13);
      assert.match(body.instructions, /Do not add further restrictions after a zero-result search/);
      assert.match(body.instructions, /raw, ungraded, rookie and rc.*must not be automatic search filters/);
      return { ...value, refinement: { query: broadened, reason: 'The blue refinement returned zero results; remove its optional finish term and retain the saved identity.' } };
    }
    return value;
  });
  const saved = JSON.stringify(f.input), result = await researchStaffInventoryCard(f.input, f.deps);
  assert.deepEqual(f.sources, [buildStaffInventoryResearchQuery(f.input.description), f.queries[0], broadened]);
  assert.deepEqual(histories[2].map(query => query.result_count), [13, 0, 2]);
  assert.deepEqual(histories[2][2].candidate_ids, f.rows(2).slice(0, 2).map(item => `ebay:${item.itemId}`));
  assert.equal(validateRefinedStaffInventoryResearchQuery(f.input.description, broadened), broadened);
  assert.equal(JSON.stringify(f.input), saved);
  assert.equal(result.estimate.status, 'unknown');
  assert.equal(Object.hasOwn(result.research_queries![0], 'result_count'), false);
});

test('repeated or foreign-anchor model refinements are not searched and never erase useful first evidence', async () => {
  for (const query of ['#007 Runner Chrome Cards Fixture 2024', '2024 Fixture Chrome Different Player #007 blue']) {
    const f = await adaptiveFixture();
    f.setModel(value => ({ ...value, refinement: { query, reason: 'Try another wording.' } }));
    const result = await researchStaffInventoryCard(f.input, f.deps);
    assert.equal(f.sources.length, 1); assert.equal(result.candidates.length, 2);
    assert.match(result.warnings.join(' '), /repeat-free query rules/);
  }
});

test('three-query work deduplicates listings, bounds retained candidates and spends at most twelve image downloads', async () => {
  const f = await adaptiveFixture(24);
  f.setRows(round => round === 0 ? f.rows(0) : [f.rows(0)[0], ...f.rows(round).slice(1)]);
  const original = f.deps.fetchImpl!; let imageReads = 0, active = 0, maximum = 0; const imageUrls: string[] = [];
  f.deps.fetchImpl = (async (url, init) => {
    if (!String(url).startsWith('https://i.ebayimg.com/')) return original(url, init);
    imageReads++; imageUrls.push(String(url)); active++; maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    try { return await original(url, init); } finally { active--; }
  }) as typeof fetch;
  const result = await researchStaffInventoryCard(f.input, f.deps);
  assert.equal(f.sources.length, 3); assert.equal(result.candidates.length, 24);
  assert.equal(new Set(result.candidates.map(candidate => candidate.id)).size, 24);
  assert.equal(imageReads, 12); assert.ok(maximum <= 4);
  assert.equal(imageUrls.filter(url => url.includes('/round0-')).length, 6);
  assert.equal(imageUrls.filter(url => url.includes('/round1-')).length, 3);
  assert.equal(imageUrls.filter(url => url.includes('/round2-')).length, 3);
  assert.equal(result.candidates.filter(candidate => candidate.image).length, 12);
  assert.ok(result.research_queries?.every(query => query.candidate_ids.length === 24));
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 524288);
});

test('conflicting prices across queries preserve original source provenance and remove sale eligibility', async () => {
  const f = await adaptiveFixture();
  f.setRows(round => round === 0 ? f.rows(1) : [{ ...f.rows(1)[0], soldPrice: '500.00' }, f.rows(2)[1]]);
  f.setModel(value => ({ ...value, refinement: f.sources.length === 1 ? value.refinement : null }));
  const result = await researchStaffInventoryCard(f.input, f.deps);
  const prior = result.candidates.find(candidate => candidate.id === f.rows(1)[0].itemId.toString().replace(/^/, 'ebay:'))!;
  assert.ok(prior); assert.equal(prior.source_eligible, false); assert.equal(prior.sold_price, '10.01');
  assert.match(prior.exclusion_reason!, /conflicting evidence/);
  assert.equal(prior.source_response_sha256, result.research_queries?.[0].source_response_sha256);
  assert.ok(result.research_queries?.[1].candidate_ids.includes(prior.id));
  assert.equal(new Set(result.candidates.map(candidate => candidate.id)).size, 3);
  assert.equal(StaffInventoryResearchResultSchema.safeParse(result).success, true);
});

test('optional source, model and timeout failures preserve the last valid research and retained extra evidence', async () => {
  for (const failure of ['source', 'model', 'timeout'] as const) {
    const f = await adaptiveFixture(), original = f.deps.fetchImpl!;
    if (failure === 'timeout') f.deps.timeoutMs = 300;
    let sourceCalls = 0, modelCalls = 0;
    f.deps.fetchImpl = (async (url, init) => {
      if (String(url).startsWith('https://api.sold-comps.com/') && ++sourceCalls === 2 && failure === 'source') return new Response('private error', { status: 500 });
      if (String(url) === 'https://api.openai.com/v1/responses' && ++modelCalls === 2) {
        if (failure === 'model') return Response.json(output({ invented_value: 123 }));
        if (failure === 'timeout') return new Promise<Response>(() => {});
      }
      return original(url, init);
    }) as typeof fetch;
    const started = Date.now(), result = await researchStaffInventoryCard(f.input, f.deps);
    assert.equal(result.estimate.status, 'unknown'); assert.equal(result.identity.reason, 'The exact published catalog is unavailable.');
    assert.equal(result.candidates.length, failure === 'source' ? 2 : 4);
    assert.equal(result.research_queries?.length, 2);
    assert.equal(result.research_queries?.[1].status, failure === 'source' ? 'failed' : 'completed');
    assert.match(result.warnings.join(' '), /prior verified research was preserved/);
    assert.equal(StaffInventoryResearchResultSchema.safeParse(result).success, true);
    if (failure === 'timeout') assert.ok(Date.now() - started < 500);
  }
});

test('unknown-price visual matches stay matched and deterministic wrong card or grade evidence cannot become a match', async () => {
  const f = await fixture();
  f.model.selected_candidate_ids = [];
  for (const item of f.items) item.bestOfferAccepted = null;
  const result = await researchStaffInventoryCard(f.input, f.deps);
  assert.equal(result.comparison_assessments?.every(assessment => assessment.classification === 'matched'), true);
  for (const suffix of ['#999', 'PSA 10']) {
    const altered = await fixture(); altered.model.selected_candidate_ids = [];
    altered.items[0].title = suffix === '#999' ? String(altered.items[0].title).replace('#007', '#999') : `${altered.items[0].title} ${suffix}`;
    const checked = await researchStaffInventoryCard(altered.input, altered.deps);
    assert.equal(checked.comparison_assessments?.find(assessment => assessment.candidate_id === 'ebay:111111111110')?.classification, 'rejected');
  }
});

test('equivalent consecutive-season listing wording remains a possible visual match without rewriting saved identity', async () => {
  for (const titleYear of ['2024-25', '2024-2025', '2024/25', '2024/2025']) {
    const f = await fixture(); f.input.description.year = '2024-25'; f.deps.loadReferences = async () => [];
    f.model.identity = { status: 'unresolved', variant_name: null, suggestion: null, reason: 'The exact published catalog is unavailable.', reference_ids: [], photo_features: [] };
    f.model.selected_candidate_ids = [];
    for (const item of f.items) item.title = String(item.title).replace('2024', titleYear);
    const result = await researchStaffInventoryCard(f.input, f.deps);
    assert.equal(result.comparison_assessments?.every(assessment => assessment.classification === 'matched'), true, titleYear);
    assert.equal(f.input.description.year, '2024-25'); assert.equal(result.estimate.status, 'unknown');
  }
});

test('legacy immutable results parse with identical JSON and hashes without inserting optional research or price fields', async () => {
  const f = await fixture(), current = await researchStaffInventoryCard(f.input, f.deps);
  const legacy = { ...current, engine_version: 'staff-inventory-research-v1' } as any;
  delete legacy.research_queries; delete legacy.comparison_assessments; delete legacy.diagnostics;
  for (const candidate of legacy.candidates) { delete candidate.sale_evidence; delete candidate.image_options; delete candidate.multiple_price_options; }
  const bytes = JSON.stringify(legacy), parsed = StaffInventoryResearchResultSchema.parse(JSON.parse(bytes));
  assert.equal(JSON.stringify(parsed), bytes);
  assert.equal(sha(Buffer.from(JSON.stringify(parsed))), sha(Buffer.from(bytes)));
  assert.equal(Object.hasOwn(parsed, 'research_queries'), false); assert.equal(Object.hasOwn(parsed, 'comparison_assessments'), false);
  assert.ok(parsed.candidates.every(candidate => !Object.hasOwn(candidate, 'accepted_offer')));
  for (const mutate of [
    (value: any) => { value.research_queries[0].source_response_sha256 = 'f'.repeat(64); },
    (value: any) => { value.comparison_assessments[0].candidate_id = 'ebay:999999999999'; },
    (value: any) => { value.comparison_assessments[0].visual_match = false; },
  ]) { const bad = structuredClone(current); mutate(bad); assert.equal(StaffInventoryResearchResultSchema.safeParse(bad).success, false); }
});

test('only explicit hydrated accepted-offer evidence can supply an estimate, retaining original source amounts', async () => {
  for (const crossCurrency of [false, true]) {
    const f = await fixture();
    for (const item of f.items) Object.assign(item, { bestOfferAccepted: true, boaHydrated: true, ...(crossCurrency ? { soldPrice: '30.00', soldCurrency: 'CAD', boaAcceptedPrice: '9.00', boaAcceptedCurrency: 'USD' } : {}) });
    const result = await researchStaffInventoryCard(f.input, f.deps);
    assert.equal(result.estimate.value_cents, crossCurrency ? 900 : 1002);
    assert.equal(result.candidates[0].accepted_offer?.source_field, crossCurrency ? 'boaAcceptedPrice' : 'soldPrice');
    assert.equal(result.candidates[0].sold_price, crossCurrency ? '30.00' : '10.01');
    const sourceCall = f.calls.find(call => call.url.startsWith('https://api.sold-comps.com/'))!;
    for (const flag of ['includeCompleteListing', 'exactMatch', 'hydrateBoa']) assert.equal(new URL(sourceCall.url).searchParams.get(flag), 'true');
    const bad = structuredClone(result); bad.candidates[0].accepted_offer!.amount = '99.00';
    assert.equal(StaffInventoryResearchResultSchema.safeParse(bad).success, false);
  }
});


test('provider sale status is independent from visual matching and never inferred from an ended date', async () => {
  for (const listingType of ['active', undefined]) {
    const f = await fixture(); f.model.selected_candidate_ids = [];
    for (const item of f.items) item.listingType = listingType;
    const result = await researchStaffInventoryCard(f.input, f.deps);
    assert.ok(result.comparison_assessments!.every(row => row.classification === 'matched'));
    assert.ok(result.candidates.every(row => !row.source_eligible && row.sold_price_cents === null));
    assert.ok(result.diagnostics!.candidates.every(row => row.decision_codes.includes(listingType ? 'ACTIVE_LISTING' : 'SOLD_EVENT_UNVERIFIED')));
    assert.equal(result.estimate.status, 'unknown');
    const bad = structuredClone(result); bad.candidates[0].source_eligible = true;
    assert.equal(StaffInventoryResearchResultSchema.safeParse(bad).success, false);
  }
});

test('v3 primary images use only supplied URLs, retain dimensions and fall back within the same bounded attempt', async () => {
  for (const highResolution of [false, true]) for (const failPrimary of [false, true]) {
    const f = await fixture(), original = f.deps.fetchImpl!;
    f.deps.env = { ...f.deps.env, STAFF_INVENTORY_RESEARCH_FULL_RES_IMAGES: String(highResolution) };
    const imageCalls: string[] = [];
    for (const [index, item] of f.items.entries()) item.fullResThumbnailUrl = `https://i.ebayimg.com/images/g/primary${index}/s-l1600.jpg`;
    f.deps.fetchImpl = (async (url, init) => {
      const uri = String(url);
      if (!uri.startsWith('https://i.ebayimg.com/')) return original(url, init);
      imageCalls.push(uri);
      const index = f.items.findIndex(item => item.fullResThumbnailUrl === uri);
      if (index < 0) return original(url, init);
      if (failPrimary) return new Response('unavailable', { status: 404 });
      return new Response(new Uint8Array(f.bytes[2 + index]), { headers: { 'content-type': 'image/jpeg' } });
    }) as typeof fetch;
    const result = await researchStaffInventoryCard(f.input, f.deps);
    assert.equal(result.estimate.status, 'estimated');
    assert.equal(imageCalls.length, highResolution && failPrimary ? 4 : 2);
    for (const [index, candidate] of result.candidates.entries()) {
      const expected = highResolution && !failPrimary ? f.items[index].fullResThumbnailUrl : f.items[index].thumbnailUrl;
      assert.equal(candidate.image?.source_url, expected);
      const diagnostic = result.diagnostics!.candidates[index];
      assert.equal(diagnostic.image_width, 100); assert.equal(diagnostic.image_height, 140);
      assert.equal(diagnostic.comparison_status, 'assessed');
      assert.deepEqual(diagnostic.image_attempts.map(row => row.status), highResolution && failPrimary ? ['failed', 'acquired'] : ['acquired']);
    }
    const source = f.calls.find(call => call.url.startsWith('https://api.sold-comps.com/'))!;
    assert.equal(new URL(source.url).searchParams.get('sold'), 'true');
    assert.deepEqual(result.diagnostics!.sources, [{ sequence: 1, returned_count: 2, parsed_count: 2, retained_count: 2, has_next_page: false }]);
  }
});

test('full-resolution fallback shares the twelve-download budget and four-way concurrency across all three queries', async () => {
  const f = await adaptiveFixture(24), original = f.deps.fetchImpl!;
  f.deps.env = { ...f.deps.env, STAFF_INVENTORY_RESEARCH_FULL_RES_IMAGES: 'true' };
  f.setRows(round => f.rows(round).map(item => ({ ...item, fullResThumbnailUrl: String(item.thumbnailUrl).replace('s-l400', 's-l1600') })));
  let reads = 0, active = 0, maximum = 0;
  f.deps.fetchImpl = (async (url, init) => {
    if (!String(url).startsWith('https://i.ebayimg.com/')) return original(url, init);
    reads++; active++; maximum = Math.max(maximum, active);
    try {
      await new Promise(resolve => setTimeout(resolve, 2));
      return String(url).includes('s-l1600') ? new Response('not found', { status: 404 }) : await original(url, init);
    } finally { active--; }
  }) as typeof fetch;
  const result = await researchStaffInventoryCard(f.input, f.deps);
  assert.equal(reads, 12); assert.ok(maximum <= 4); assert.equal(f.sources.length, 3);
  assert.ok(result.candidates.filter(candidate => candidate.image).length <= 6);
  assert.ok(result.candidates.filter(candidate => !candidate.image).every(candidate => result.comparison_assessments!.find(row => row.candidate_id === candidate.id)?.classification !== 'matched'));
});

test('a successful image download followed by optional model failure is recorded as unassessed, preserving original model evidence', async () => {
  const f = await adaptiveFixture(), original = f.deps.fetchImpl!;
  let calls = 0;
  f.deps.fetchImpl = (async (url, init) => String(url) === 'https://api.openai.com/v1/responses' && ++calls === 2
    ? new Response('failed', { status: 500 }) : original(url, init)) as typeof fetch;
  const result = await researchStaffInventoryCard(f.input, f.deps);
  const later = result.candidates.filter(candidate => candidate.id.startsWith('ebay:3000000001'));
  assert.equal(later.length, 2);
  for (const candidate of later) {
    assert.ok(candidate.image);
    const diagnostic = result.diagnostics!.candidates.find(row => row.candidate_id === candidate.id)!;
    assert.equal(diagnostic.comparison_status, 'failed'); assert.equal(diagnostic.model_assessment, null);
    assert.ok(diagnostic.decision_codes.includes('OPTIONAL_COMPARISON_FAILED'));
    const assessment = result.comparison_assessments!.find(row => row.candidate_id === candidate.id)!;
    assert.equal(assessment.classification, 'possible'); assert.doesNotMatch(assessment.reason, /image.*unavailable|image.*missing/i);
  }
  assert.ok(result.diagnostics!.candidates.filter(row => !later.some(candidate => candidate.id === row.candidate_id)).every(row => row.model_assessment !== null));
});


test('a duplicate listing with a newly exposed price range cannot retain safe-sale eligibility', async () => {
  const f = await fixture(); f.model.selected_candidate_ids = [];
  f.items.push({ ...f.items[0], soldPriceMax: '500.00' });
  const sameResponse = await researchStaffInventoryCard(f.input, f.deps);
  assert.equal(sameResponse.candidates.find(row => row.id === 'ebay:111111111110')!.source_eligible, false);
  const a = await adaptiveFixture();
  a.setRows(round => round === 0 ? a.rows(1) : [{ ...a.rows(1)[0], bestOfferAccepted: null, currentPriceMax: '500.00' }, a.rows(2)[1]]);
  const acrossQueries = await researchStaffInventoryCard(a.input, a.deps);
  assert.match(acrossQueries.candidates.find(row => row.id === `ebay:${a.rows(1)[0].itemId}`)!.exclusion_reason!, /conflicting evidence/);
});

test('documented anniversary, NM-MT and sport-suffix failure mechanisms pass the final estimate gate without relaxing wrong-print controls', async () => {
  const cases = [
    { name: 'Bo Bichette', year: '2020', manufacturer: 'Topps', set_name: 'Topps', card_number: '85A-BB', card_type: 'Baseball', grade: 9, title: '2020 Topps Bo Bichette #85A-BB 1985 35th Anniversary PSA 9', wrong: '2019 Topps Bo Bichette #85A-BB 1985 35th Anniversary PSA 9' },
    { name: 'Ken Griffey Jr', year: '1989', manufacturer: 'Donruss', set_name: 'Donruss Baseball', card_number: '33', card_type: 'Baseball', grade: 8, title: '1989 Donruss Ken Griffey Jr #33 PSA NM-MT 8', wrong: '1989 Donruss Ken Griffey Jr #33 PSA NM-MT 9' },
    { name: 'Jayson Tatum', year: '2023', manufacturer: 'Panini', set_name: 'Contenders Basketball', card_number: '77', card_type: 'Basketball', grade: null, title: '2023 Panini Contenders Jayson Tatum #77 Raw', wrong: '2023 Panini Contenders Jayson Tatum Optic #77 Raw' },
  ];
  for (const example of cases) {
    const f = await fixture();
    const { title, wrong, grade, ...details } = example;
    Object.assign(f.input.description, details);
    f.reference.identity = { name: example.name, category: 'Sports cards', year: example.year, manufacturer: example.manufacturer, set_name: example.set_name, card_number: example.card_number };
    if (grade) f.model.target_condition = { status: 'graded', grader: 'PSA', numeric_grade: grade, photo_evidence: `Front: PSA ${grade}.` };
    for (const item of f.items) { item.title = title; item.condition = grade ? 'Graded' : 'Ungraded'; }
    const saved = JSON.stringify(f.input), result = await researchStaffInventoryCard(f.input, f.deps);
    assert.equal(result.estimate.status, 'estimated', title);
    assert.equal(JSON.stringify(f.input), saved);
    assert.ok(result.diagnostics!.candidates.every(row => row.model_assessment?.classification === 'matched'));
    f.items[0].title = wrong;
    await assert.rejects(researchStaffInventoryCard(f.input, f.deps), code('malformed_response'), wrong);
  }
});

test('v3 diagnostics reject removed or mismatched model-image, source and price-option attribution', async () => {
  const f = await fixture(), result = await researchStaffInventoryCard(f.input, f.deps);
  for (const mutate of [
    (value: any) => { delete value.diagnostics; },
    (value: any) => { delete value.candidates[0].multiple_price_options; },
    (value: any) => { value.diagnostics.candidates[0].model_image_sha256 = 'f'.repeat(64); },
    (value: any) => { value.diagnostics.sources[0].retained_count = 1; },
    (value: any) => { value.diagnostics.candidates[0].image_width = 8000; value.diagnostics.candidates[0].image_height = 8000; },
  ]) {
    const altered = structuredClone(result); mutate(altered);
    assert.equal(StaffInventoryResearchResultSchema.safeParse(altered).success, false);
  }
  const legacy = structuredClone(result) as any;
  legacy.engine_version = 'staff-inventory-research-v2'; delete legacy.diagnostics;
  for (const candidate of legacy.candidates) { delete candidate.sale_evidence; delete candidate.image_options; delete candidate.multiple_price_options; }
  const bytes = JSON.stringify(legacy);
  assert.equal(JSON.stringify(StaffInventoryResearchResultSchema.parse(legacy)), bytes);
});


test('optional archival timeout retains an already verified image and consistent acquired diagnostics', async t => {
  const f = await fixture(), originalTimer = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', ((callback: (...args: any[]) => void, delay?: number, ...args: any[]) => originalTimer(callback, delay === 18000 ? 30 : delay, ...args)) as typeof setTimeout);
  f.deps.archiveCandidateImage = async () => new Promise(() => {});
  const result = await researchStaffInventoryCard(f.input, f.deps);
  assert.equal(result.estimate.status, 'estimated');
  assert.ok(result.candidates.every(row => row.image && row.image.storage_key === null));
  assert.ok(result.diagnostics!.candidates.every(row => row.image_attempts.some(attempt => attempt.status === 'acquired')));
  assert.ok(result.warnings.some(warning => /image time limit/.test(warning)));
});

test('v4 catalog authority is explicit, photo-scoped and revalidated; revoked evidence cannot retain matching comps or value', async () => {
  for (const current of [true, false]) {
    const f = await fixture();
    const publication = { publicationId: 'fixture:publication', setId: 'fixture:set', revision: 1, manifestSha256: f.reference.source_sha256 };
    f.reference.catalog_binding = { publication, card_id: 'fixture:card', printing_id: 'fixture:printing', applicability: 'supported',
      scope: { language: 'en', edition: 'not_applicable', format: 'not_applicable', channel: 'not_applicable' }, image_id: null, image_relationship: null, image_depicted: null, image_represents_printing_ids: [], image_visible_diagnostic_ids: [] };
    f.deps.loadReferences = async () => assert.fail('No legacy fallback when v4 is selected');
    f.deps.loadCatalog = async (_description, photos) => ({ references: [f.reference], context: { schema_version: 1, status: 'current',
      publications: [{ publication, lookup_sha256: 'd'.repeat(64), coverage: { text: 'partial', applicability: 'partial', images: 'unknown' }, candidate_count: 1, returned_count: 1, truncated: false }],
      scope_receipt: { attempt_id: 'fixture:attempt', invocation_id: 'fixture:scope', receipt_ref: 'fixture:receipt', request_sha256: 'd'.repeat(64), response_sha256: 'e'.repeat(64), http_status: 200, acknowledgement: 'adapter',
        images: (['front', 'back'] as const).map(side => ({ side, mime_type: 'image/jpeg' as const, transmitted_sha256: photos[side]!.sha256, source_sha256: null })) },
      scope_evidence: [{ field: 'language', value: 'en', side: 'front', photo_sha256: photos.front!.sha256, observation: 'Synthetic English card text.' }] } });
    let checked = false; f.deps.isCatalogCurrent = async () => { checked = true; return current; };
    const result = await researchStaffInventoryCard(f.input, f.deps);
    assert.equal(result.engine_version, 'staff-inventory-research-v4'); assert.equal(checked, true);
    assert.equal(result.identity.status, current ? 'base' : 'unresolved'); assert.equal(result.estimate.status, current ? 'estimated' : 'unknown');
    assert.equal(result.catalog_context?.status, current ? 'current' : 'unavailable');
    if (!current) { assert.equal(result.references.length, 0); assert.equal(result.selected_candidate_ids.length, 0); assert.ok(result.comparison_assessments?.every(a => a.classification !== 'matched')); }
    assert.equal(StaffInventoryResearchResultSchema.safeParse({ ...result, engine_version: 'staff-inventory-research-v3' }).success, false);
    if (current) {
      assert.equal(StaffInventoryResearchResultSchema.safeParse({ ...result, catalog_context: { ...result.catalog_context, scope_evidence: [] } }).success, false);
      assert.equal(StaffInventoryResearchResultSchema.safeParse({ ...result, catalog_context: { ...result.catalog_context, scope_receipt: null } }).success, false);
      const receipt = result.catalog_context!.scope_receipt!;
      assert.equal(StaffInventoryResearchResultSchema.safeParse({ ...result, catalog_context: { ...result.catalog_context, scope_receipt: { ...receipt, images: receipt.images.map(image => ({ ...image, transmitted_sha256: 'e'.repeat(64) })) } } }).success, false);
      const entry = result.catalog_context!.publications[0];
      for (const publicationEntry of [
        { ...entry, candidate_count: 0, returned_count: 0 },
        { ...entry, candidate_count: 2, returned_count: 1, truncated: true },
        { ...entry, coverage: { ...entry.coverage, applicability: 'truncated' } },
      ]) assert.equal(StaffInventoryResearchResultSchema.safeParse({ ...result, catalog_context: { ...result.catalog_context, publications: [publicationEntry] } }).success, false);
      for (const pinChange of [{ revision: 2 }, { manifestSha256: 'e'.repeat(64) }, { publicationId: 'fixture:other' }]) {
        const conflict = { ...entry, publication: { ...entry.publication, ...pinChange } };
        assert.equal(StaffInventoryResearchResultSchema.safeParse({ ...result, catalog_context: { ...result.catalog_context, publications: [entry, conflict] } }).success, false);
      }
    }
  }
});

test('catalog printing-scope model cannot assert absent-stamp defaults, wrong photos or unavailable enum choices', async () => {
  const f = await fixture();
  const photos = { front: await f.deps.loadPhoto!(f.input.front_photo_key!, new AbortController().signal), back: await f.deps.loadPhoto!(f.input.back_photo_key!, new AbortController().signal) };
  const input = { choices: { language: ['en'], edition: ['first'], format: [], channel: [] }, photos };
  const evidence = { field: 'language', value: 'en', side: 'front', photo_sha256: photos.front.sha256, observation: 'Synthetic visible English card text.' };
  f.model = { evidence: [evidence] };
  const scoped = await researchCatalogScopeResolver(f.deps)(input, new AbortController().signal);
  assert.deepEqual(scoped.evidence, [evidence]); assert.equal(scoped.receipt?.acknowledgement, 'process');
  assert.equal(scoped.receipt?.images[0].transmitted_sha256, photos.front.sha256); assert.equal(scoped.receipt?.images[0].source_sha256, null);
  for (const mutation of [{ value: 'not_applicable' }, { photo_sha256: 'a'.repeat(64) }, { field: 'edition', value: 'standard' }]) {
    f.model = { evidence: [{ ...evidence, ...mutation }] };
    await assert.rejects(researchCatalogScopeResolver(f.deps)(input, new AbortController().signal));
  }
  assert.match(f.calls.find(c => c.body?.text?.format?.name === 'card_printing_scope')!.body.instructions, /absence of a stamp does not establish/);
});
