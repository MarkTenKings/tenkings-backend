import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import sharp from 'sharp';
import {
  StaffInventoryResearchInputSchema, StaffInventoryResearchResultSchema,
  type StaffInventoryResearchInput, type StaffInventoryResearchReference,
} from '../lib/staffInventoryResearch';
import {
  researchStaffInventoryCard, StaffInventoryResearchError, parseStaffInventoryResearchOutput,
  isExactStaffInventoryResearchReference, buildStaffInventoryResearchQuery, type StaffInventoryResearchDependencies,
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
    soldPrice: index ? '10.02' : '10.01', soldCurrency: 'USD', bestOfferAccepted: false, endedAt: '2026-09-09', condition: 'Ungraded',
    thumbnailUrl: `https://i.ebayimg.com/images/g/fixture${index}/s-l400.jpg`,
  }));
  let modelValue: any = {
    identity: { status: 'base', variant_name: 'Base', suggestion: null, reason: 'The published exact card checklist and visible circular base mark match.', reference_ids: [reference.id], photo_features: [{ side: 'back', photo_sha256: sha(bytes[1]), reference_id: reference.id, evidence_type: 'catalog_feature', reference_feature: reference.distinguishing_features[0], observation: 'Back: circular base mark beneath 007.' }] },
    target_condition: { status: 'raw', grader: null, numeric_grade: null, photo_evidence: 'Both photos show an ungraded card without a grading label.' },
    selected_candidate_ids: items.map(item => `ebay:${item.itemId}`),
    comparisons: items.map(item => ({ candidate_id: `ebay:${item.itemId}`, identity_match: true, variant_match: true, visual_match: true, condition_match: true, reason: 'The exact identity and printed mark match the uploaded raw card.' })),
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
  f.model.comparisons = f.items.slice(0, 24).map(item => ({ candidate_id: `ebay:${item.itemId}`, identity_match: true, variant_match: false, visual_match: false, condition_match: true, reason: 'Catalog evidence is unavailable.' }));
  const original = f.deps.fetchImpl!; let active = 0, highest = 0, imageCount = 0;
  f.deps.fetchImpl = (async (url, init) => {
    if (!String(url).startsWith('https://i.ebayimg.com/')) return original(url, init);
    imageCount++; active++; highest = Math.max(highest, active);
    await new Promise(resolve => setTimeout(resolve, 5)); active--;
    return new Response(new Uint8Array(f.bytes[2]), { headers: { 'content-type': 'image/jpeg' } });
  }) as typeof fetch;
  const result = await researchStaffInventoryCard(f.input, f.deps);
  assert.equal(result.candidates.length, 24); assert.equal(imageCount, 12); assert.equal(highest, 4); assert.equal(result.estimate.status, 'unknown');
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
