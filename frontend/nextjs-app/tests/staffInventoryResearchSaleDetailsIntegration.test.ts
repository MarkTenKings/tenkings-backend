import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import sharp from 'sharp';
import { canonical, inventoryHash } from '../../../packages/database/src/cardInventoryV2';
import { completeStaffInventoryResearchV2, readStaffInventoryResearchV2 } from '../../../packages/database/src/staffInventoryResearchV2';
import { StaffInventoryResearchResultSchema, type StaffInventoryResearchInput, type StaffInventoryResearchReference, type StaffInventoryResearchResult } from '../lib/staffInventoryResearch';
import { researchStaffInventoryCard, type StaffInventoryResearchDependencies } from '../lib/server/staffInventoryResearch';

const NOW = '2026-09-17T10:29:54.200Z';
const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const key = (bytes: Buffer) => `inventory-photos/11111111-1111-4111-8111-111111111111/${sha(bytes)}.jpg`;
const TITLE = '2020 Topps Baseball Example Player 1985 35th Anniversary Auto RC #85A-BB PSA 9';
type Row = Record<string, unknown>;
// Sanitized ordinary-sale spelling from the archived sports observation. A
// second synthetic sale supports selection tests; it is not a live observation.
function row(index = 0, change: Row = {}): Row {
  const id = String(900000000000 + index);
  return { itemId: id, url: `https://www.ebay.com/itm/${id}`, title: TITLE,
    soldPrice: index ? '90.00' : '89', soldCurrency: 'USD', listingType: 'sold', endedAt: '2026-09-08',
    condition: 'Graded', thumbnailUrl: `https://i.ebayimg.com/images/g/synthetic${index}/s-l225.jpg`, ...change };
}
function detail(item: Row): Row {
  return { itemId: item.itemId, title: item.title, price: item.soldPrice === '89' ? '89.0' : item.soldPrice,
    currency: 'USD', bestOfferAccepted: false, ended: true, endedDate: 'Sep 08, 2026 18:17:08 PDT',
    soldBanner: 'Item sold on Tue, Sep 8 at 6:17 PM' };
}
const wrapped = (value: unknown) => ({ model: 'gpt-6-astra', status: 'completed', error: null, incomplete_details: null,
  output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });
const refinements = ['2020 Baseball Example Player 85A-BB', '2020 Baseball Example Player 85A-BB PSA 9'];
const images = Promise.all(['white', 'blue', 'red', 'green', 'yellow'].map(background => sharp({ create: { width: 40, height: 60, channels: 3, background } }).jpeg().toBuffer()));

async function fixture(options: { rounds?: Row[][]; photos?: boolean; references?: boolean; details?: string; refine?: boolean } = {}) {
  const bytes = await images, rounds = options.rounds ?? [[row(), row(1)]];
  const input: StaffInventoryResearchInput = { schema_version: 1, unit_id: 'detail-fixture-unit', description_event_id: 'detail-fixture-description', description_hash: 'b'.repeat(64),
    description: { name: 'Example Player', category: 'Sports cards', manufacturer: 'Topps', year: '2020', set_name: 'Topps Baseball', card_number: '85A-BB', variant: null, card_type: 'Baseball' },
    front_photo_key: options.photos === false ? null : key(bytes[0]), back_photo_key: options.photos === false ? null : key(bytes[1]) };
  const reference: StaffInventoryResearchReference = { id: 'catalog:detail-base', kind: 'catalog', trust: 'published_catalog', catalog_id: 'detail-base',
    identity: { name: input.description.name, category: input.description.category, year: '2020', manufacturer: 'Topps', set_name: 'Topps Baseball', card_number: '85A-BB' },
    variant_name: 'Base', variant_kind: 'BASE', source_url: null, source_sha256: 'c'.repeat(64), captured_at: NOW,
    distinguishing_features: ['A circular base mark beneath the card number'], image: null };
  const calls: { url: string; init: RequestInit }[] = [], sourceBodies: string[] = [], detailBodies = new Map<string, string>();
  let searchCount = 0, modelCount = 0;
  let getDetail = async (id: string, _signal: AbortSignal): Promise<Response> => {
    const item = rounds.flat().find(item => item.itemId === id)!;
    const body = JSON.stringify(detail(item)); detailBodies.set(id, body);
    return new Response(body, { headers: { 'content-type': 'application/json' } });
  };
  let afterSearch = () => {};
  const deps: StaffInventoryResearchDependencies = {
    env: { OPENAI_API_KEY: 'fixture-openai-key', SOLDCOMPS_API_KEY: 'fixture-sold-key', STAFF_INVENTORY_RESEARCH_SALE_DETAILS: options.details ?? 'true' }, now: () => new Date(NOW),
    loadPhoto: async photoKey => { const data = photoKey === input.front_photo_key ? bytes[0] : bytes[1]; return { key: photoKey, sha256: sha(data), bytes: data }; },
    loadReferences: async () => options.references === false ? [] : [reference],
    fetchImpl: (async (url, init) => {
      const uri = String(url); calls.push({ url: uri, init: init ?? {} });
      if (uri.startsWith('https://api.sold-comps.com/v1/scrape?')) {
        const items = rounds[Math.min(searchCount++, rounds.length - 1)];
        const body = JSON.stringify({ keyword: new URL(uri).searchParams.get('keyword'), page: 1, totalItems: items.length, hasNextPage: false, items });
        sourceBodies.push(body); afterSearch(); return new Response(body, { headers: { 'content-type': 'application/json' } });
      }
      const match = /^https:\/\/api\.sold-comps\.com\/v1\/item\/(\d+)\?ebaySite=ebay\.com$/.exec(uri);
      if (match) return getDetail(match[1], init!.signal!);
      if (uri === 'https://api.openai.com/v1/responses') {
        const content = JSON.parse(String(init?.body)).input[0].content as { type: string; text?: string }[];
        const candidates = content.filter(part => part.text?.startsWith('Candidate data: ')).map(part => JSON.parse(part.text!.slice('Candidate data: '.length)));
        const hasReferences = options.references !== false;
        const selected = candidates.filter(candidate => candidate.source_eligible && candidate.image_sha256).map(candidate => candidate.id);
        const refinement = options.refine && modelCount < refinements.length ? { query: refinements[modelCount], reason: 'A narrower spelling of the saved identity may retrieve additional exact sales.' } : null;
        modelCount++;
        return Response.json(wrapped({
          identity: hasReferences ? { status: 'base', variant_name: 'Base', suggestion: null, reason: 'The visible circular mark matches the exact published base checklist.', reference_ids: [reference.id],
            photo_features: [{ side: 'back', photo_sha256: sha(bytes[1]), reference_id: reference.id, evidence_type: 'catalog_feature', reference_feature: reference.distinguishing_features[0], observation: 'Back: circular base mark beneath the card number.' }] }
            : { status: 'unresolved', variant_name: null, suggestion: null, reason: 'No reviewed checklist establishes the exact variant.', reference_ids: [], photo_features: [] },
          target_condition: { status: 'graded', grader: 'PSA', numeric_grade: 9, photo_evidence: 'Front grading label reads PSA 9.' }, refinement,
          selected_candidate_ids: hasReferences && selected.length >= 2 ? selected : [],
          comparisons: candidates.map(candidate => ({ candidate_id: candidate.id, classification: candidate.image_sha256 ? 'matched' : 'possible', identity_match: true, variant_match: true,
            visual_match: !!candidate.image_sha256, condition_match: true, reason: 'The exact identity and PSA 9 slab match the uploaded card views.' })),
        }));
      }
      const item = rounds.flat().find(item => item.thumbnailUrl === uri);
      assert.ok(item, `Unexpected fixture request: ${uri}`);
      return new Response(new Uint8Array(bytes[2 + Number(String(item.itemId).slice(-1)) % 3]), { headers: { 'content-type': 'image/jpeg' } });
    }) as typeof fetch,
  };
  return { input, reference, deps, calls, rounds, sourceBodies, detailBodies,
    getDetail: (handler: typeof getDetail) => { getDetail = handler; }, afterSearch: (handler: typeof afterSearch) => { afterSearch = handler; },
    detailCalls: () => calls.filter(call => call.url.includes('/v1/item/')), counts: () => ({ searches: searchCount, models: modelCount }) };
}

test('v5 uses two exact ordinary details without overwriting the original search evidence', async () => {
  const f = await fixture({ rounds: [[row(), row(1, { bestOfferAccepted: null })]] }), before = structuredClone(f.rounds), result = await researchStaffInventoryCard(f.input, f.deps);
  assert.equal(result.engine_version, 'staff-inventory-research-v5'); assert.equal(result.sale_details?.base_engine_version, 'staff-inventory-research-v3');
  assert.equal(result.estimate.value_cents, 8950); assert.equal(result.estimate.count, 2);
  assert.deepEqual(result.selected_candidate_ids, ['ebay:900000000000', 'ebay:900000000001']);
  assert.equal(f.detailCalls().length, 2); assert.deepEqual(f.rounds, before);
  for (const candidate of result.candidates) {
    const proof = candidate.ordinary_sale_detail!;
    assert.ok(candidate.source_eligible); assert.equal(candidate.best_offer_accepted, null); assert.equal(candidate.accepted_offer, undefined);
    assert.equal(candidate.source_response_sha256, sha(f.sourceBodies[0])); assert.equal(proof.search.response_sha256, candidate.source_response_sha256);
    assert.equal(proof.search.offer_field, candidate.id.endsWith('0') ? 'absent' : 'null'); assert.equal(proof.detail.response_sha256, sha(f.detailBodies.get(proof.item_id)!));
    assert.equal(proof.search.retrieved_at, NOW); assert.equal(proof.detail.retrieved_at, NOW);
  }
  assert.equal(result.candidates[0].sold_price, '89'); assert.equal(result.candidates[0].ordinary_sale_detail!.detail.price, '89.0');
  for (const call of f.detailCalls()) {
    assert.equal(call.init.method, 'GET'); assert.equal((call.init.headers as Record<string, string>).Authorization, 'Bearer fixture-sold-key');
    assert.equal(call.init.redirect, 'error'); assert.equal(call.init.cache, 'no-store'); assert.ok(call.init.signal?.aborted);
  }
  assert.equal(JSON.stringify(result).includes('fixture-sold-key'), false);
  assert.equal(StaffInventoryResearchResultSchema.safeParse(result).success, true);
});

test('detail selection skips deterministic mismatches and every existing source gate before spending slots', async () => {
  const cases: Row[] = [
    { title: TITLE.replace('2020', '2021') }, { title: TITLE.replace('#85A-BB', '#85A-AA') },
    { title: TITLE.replace('Topps Baseball', 'Topps Chrome Baseball') }, { title: `${TITLE} lot of 2` },
    { soldPriceMax: '95' }, { currentPriceMax: '95' }, { priceMax: '95' }, { listingType: 'active' },
    { bestOfferAccepted: true }, { bestOfferAccepted: 'false' }, { boaHydrated: true }, { boaAcceptedPrice: '89' },
    { soldCurrency: 'CAD' }, { soldPrice: '89.001' }, { endedAt: '2026-02-30' }, { endedAt: '2027-09-08' }, { invalid_fields: ['soldPrice'] },
  ];
  for (const change of cases) {
    const f = await fixture({ photos: false, rounds: [[row(0, change), row(1), row(2)]] });
    const result = await researchStaffInventoryCard(f.input, f.deps);
    assert.deepEqual(f.detailCalls().map(call => /\/item\/(\d+)/.exec(call.url)![1]), ['900000000001', '900000000002'], JSON.stringify(change));
    const bad = result.candidates.find(candidate => candidate.id === 'ebay:900000000000')!;
    assert.equal(bad.ordinary_sale_detail, undefined, JSON.stringify(change)); assert.equal(bad.source_eligible, false);
    assert.equal(result.estimate.status, 'unknown');
  }
  const f = await fixture({ photos: false, rounds: [[row(0, { title: `${TITLE} Gold Refractor` }), row(1, { title: `${TITLE} Blue Refractor` })]] });
  f.input.description.variant = 'Blue Refractor';
  const result = await researchStaffInventoryCard(f.input, f.deps);
  assert.equal(f.detailCalls().length, 1); assert.equal(result.candidates.find(c => c.id === 'ebay:900000000000')!.ordinary_sale_detail, undefined);
});

test('wrong, active, accepted, ambiguous and malformed detail observations never confirm a price', async () => {
  const cases: Row[] = [
    { itemId: '900000000999' }, { title: `${TITLE} signed` }, { price: '89.01' }, { currency: 'CAD' },
    { bestOfferAccepted: true }, { bestOfferAccepted: null }, { bestOfferAccepted: 'false' }, { boaHydrated: true },
    { boaAcceptedPrice: '88' }, { priceMax: '90' }, { invalid_fields: ['endedDate'] }, { listingType: 'active' },
    { ended: false }, { endedDate: '3d 20h', soldBanner: null }, { endedDate: 'Sep 08 18:17:08 PDT' },
    { endedDate: 'Sep 09, 2026 18:17:08 PDT' }, { soldBanner: null }, { soldBanner: 'Item sold on Wed, Sep 9 at 6:17 PM' },
  ];
  for (const change of cases) {
    const f = await fixture({ photos: false, rounds: [[row()]] });
    f.getDetail(async () => Response.json({ ...detail(row()), ...change }));
    const result = await researchStaffInventoryCard(f.input, f.deps);
    assert.equal(f.detailCalls().length, 1); assert.equal(result.sale_details!.requests[0].status, 'observed');
    assert.equal(result.candidates[0].sold_price_cents, null, JSON.stringify(change));
    assert.equal(result.candidates[0].source_eligible, false); assert.equal(result.candidates[0].ordinary_sale_detail, undefined);
    assert.equal(result.candidates[0].best_offer_accepted, null); assert.equal(result.estimate.status, 'unknown');
  }
});

test('one attempt shares two distinct requests across three searches and rebinds equal cached observations', async () => {
  const first = row(), second = row(1), third = row(2);
  const f = await fixture({ references: false, refine: true, rounds: [[first], [first, second], [first, second, third]] });
  const result = await researchStaffInventoryCard(f.input, f.deps);
  assert.deepEqual(f.counts(), { searches: 3, models: 3 }); assert.equal(f.detailCalls().length, 2);
  assert.deepEqual(result.sale_details!.requests.map(request => request.item_id), ['900000000000', '900000000001']);
  for (const [index, candidate] of result.candidates.slice(0, 2).entries()) {
    assert.equal(candidate.source_eligible, true); assert.equal(candidate.source_response_sha256, sha(f.sourceBodies[index]));
    assert.equal(candidate.ordinary_sale_detail!.search.response_sha256, candidate.source_response_sha256);
    assert.equal(candidate.best_offer_accepted, null);
  }
  assert.equal(result.candidates.find(c => c.id === 'ebay:900000000002')!.sold_price_cents, null);
  assert.equal(result.estimate.status, 'unknown');
});

test('equivalent amounts and absent/null/false offer observations preserve the original detail receipt without a false conflict', async () => {
  const first = row(), second = row(0, { soldPrice: '89.0', bestOfferAccepted: null, boaHydrated: null,
    boaAcceptedPrice: null, boaAcceptedCurrency: null, soldPriceMax: null, currentPriceMax: null, priceMax: null, invalid_fields: [] }),
    third = row(0, { soldPrice: '89.00', bestOfferAccepted: false, boaHydrated: false });
  const f = await fixture({ references: false, refine: true, rounds: [[first], [second], [third]] });
  const result = await researchStaffInventoryCard(f.input, f.deps), candidate = result.candidates[0];
  assert.deepEqual(f.counts(), { searches: 3, models: 3 }); assert.equal(f.detailCalls().length, 1);
  assert.equal(candidate.source_eligible, true); assert.equal(candidate.exclusion_reason, null);
  assert.equal(candidate.best_offer_accepted, null); assert.equal(candidate.sold_price, '89'); assert.equal(candidate.sold_price_cents, 8900);
  assert.equal(candidate.source_response_sha256, sha(f.sourceBodies[0]));
  assert.equal(candidate.ordinary_sale_detail!.search.offer_field, 'absent'); assert.equal(candidate.ordinary_sale_detail!.search.sold_price, '89');
  assert.deepEqual(result.research_queries!.map(query => query.source_response_sha256), f.sourceBodies.map(sha));
});

test('later explicit-false search evidence upgrades an unknown price using its own receipt after a failed detail', async () => {
  const first = row(), second = row(0, { soldPrice: '89.0', bestOfferAccepted: false }), third = row(0, { soldPrice: '89.00', bestOfferAccepted: null });
  const f = await fixture({ references: false, refine: true, rounds: [[first], [second], [third]] });
  f.getDetail(async () => new Response('rate limited', { status: 429 }));
  const result = await researchStaffInventoryCard(f.input, f.deps), candidate = result.candidates[0];
  assert.equal(f.detailCalls().length, 1); assert.equal(f.counts().searches, 3); assert.equal(candidate.source_eligible, true);
  assert.equal(candidate.best_offer_accepted, false); assert.equal(candidate.sold_price, '89.0'); assert.equal(candidate.sold_price_cents, 8900);
  assert.equal(candidate.ordinary_sale_detail, undefined); assert.equal(candidate.source_response_sha256, sha(f.sourceBodies[1]));
  assert.equal(result.sale_details!.requests[0].status, 'failed'); assert.equal(result.sale_details!.requests[0].response_sha256, null);
  assert.ok(candidate.image); assert.equal(result.diagnostics!.candidates[0].comparison_status, 'assessed');
  assert.deepEqual(result.research_queries!.map(query => query.source_response_sha256), f.sourceBodies.map(sha));
});

test('equivalent rows in the same response do not consume extra details or conflict', async () => {
  const f = await fixture({ photos: false, rounds: [[row(), row(0, { soldPrice: '89.0', bestOfferAccepted: null }), row(1)]] });
  const result = await researchStaffInventoryCard(f.input, f.deps);
  assert.equal(result.candidates.length, 2); assert.equal(f.detailCalls().length, 2);
  assert.ok(result.candidates.every(candidate => candidate.source_eligible)); assert.equal(result.candidates[0].sold_price, '89');
});

test('a genuine cross-search contradiction stays excluded after the original facts return', async () => {
  for (const change of [{ soldPrice: '88' }, { listingType: 'active' }, { bestOfferAccepted: true }, { bestOfferAccepted: 'false' }, { boaHydrated: true }]) {
    const original = row(), f = await fixture({ references: false, refine: true, rounds: [[original], [{ ...original, ...change }], [original]] });
    const result = await researchStaffInventoryCard(f.input, f.deps), candidate = result.candidates[0];
    assert.equal(f.counts().searches, 3); assert.equal(f.detailCalls().length, 1);
    assert.equal(candidate.source_eligible, false, JSON.stringify(change)); assert.match(candidate.exclusion_reason!, /conflicting/);
    assert.equal(candidate.source_response_sha256, sha(f.sourceBodies[0])); assert.equal(candidate.best_offer_accepted, null);
    assert.equal(result.estimate.status, 'unknown'); assert.deepEqual(result.selected_candidate_ids, []);
  }
});

test('contradictory duplicates in one search are ineligible before detail selection', async () => {
  const first = row(), f = await fixture({ photos: false, rounds: [[first, { ...first, listingType: 'active' }, row(1), row(2)]] });
  const result = await researchStaffInventoryCard(f.input, f.deps);
  assert.equal(f.detailCalls().length, 2); assert.equal(f.detailCalls().some(call => call.url.includes('/900000000000?')), false);
  assert.match(result.candidates.find(candidate => candidate.id === 'ebay:900000000000')!.exclusion_reason!, /conflicting/);
});

test('429 failures are optional and cached across all searches without retries', async () => {
  const f = await fixture({ references: false, refine: true, rounds: [[row()], [row(), row(1)], [row(), row(1), row(2)]] });
  f.getDetail(async () => new Response('rate limited', { status: 429 }));
  const result = await researchStaffInventoryCard(f.input, f.deps);
  assert.deepEqual(f.counts(), { searches: 3, models: 3 }); assert.equal(f.detailCalls().length, 2);
  assert.deepEqual(result.sale_details!.requests.map(request => [request.status, request.error_code, request.response_sha256]), [['failed', 'provider_error', null], ['failed', 'provider_error', null]]);
  assert.equal(result.candidates.length, 3); assert.ok(result.candidates.every(candidate => !candidate.source_eligible && candidate.sold_price_cents === null));
  assert.ok(result.research_queries!.every(query => query.status === 'completed'));
});

test('detail transport admits only two concurrent requests and bounds optional timeout before the source deadline', async () => {
  const f = await fixture({ photos: false, rounds: [[row(), row(1), row(2)]] });
  f.deps.timeoutMs = 250;
  let active = 0, maximum = 0, aborted = 0;
  f.getDetail(async (_id, signal) => {
    active++; maximum = Math.max(maximum, active);
    return new Promise<Response>((_resolve, reject) => signal.addEventListener('abort', () => { active--; aborted++; reject(new Error('aborted')); }, { once: true }));
  });
  const result = await researchStaffInventoryCard(f.input, f.deps);
  assert.equal(maximum, 2); assert.equal(active, 0); assert.equal(aborted, 2); assert.equal(f.detailCalls().length, 2);
  assert.equal(result.candidates.length, 3); assert.equal(result.research_queries![0].status, 'completed');
  assert.ok(result.sale_details!.requests.every(request => request.error_code === 'timeout'));
  assert.ok(result.candidates.every(candidate => candidate.sold_price_cents === null));
});

test('a search using 19.8 seconds of the 20-second round returns its candidates without dispatching details', async () => {
  const f = await fixture({ photos: false }); let epoch = 0;
  const originalNow = Date.now; Date.now = () => epoch;
  try {
    f.afterSearch(() => { epoch = 19_800; });
    const result = await researchStaffInventoryCard(f.input, f.deps);
    assert.equal(f.detailCalls().length, 0); assert.equal(result.candidates.length, 2);
    assert.deepEqual(result.sale_details!.requests, []); assert.equal(result.research_queries![0].status, 'completed');
    assert.equal(result.timings_ms.sources, 19_800); assert.equal(result.estimate.status, 'unknown');
  } finally { Date.now = originalNow; }
});

test('a detail transport that ignores abort cannot mutate the returned result when it eventually resolves', async () => {
  const f = await fixture({ photos: false, rounds: [[row()]] }); f.deps.timeoutMs = 150;
  let finish: (response: Response) => void = () => assert.fail('The detail request must have been dispatched.');
  f.getDetail(async () => new Promise<Response>(resolve => { finish = resolve; }));
  const result = await researchStaffInventoryCard(f.input, f.deps), before = canonical(result);
  assert.equal(result.research_queries![0].status, 'completed'); assert.equal(result.sale_details!.requests[0].error_code, 'timeout');
  finish(Response.json(detail(row())));
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(canonical(result), before); assert.equal(result.candidates[0].sold_price_cents, null);
});

test('default and false preserve the same v3 bytes and never request details', async () => {
  const results: StaffInventoryResearchResult[] = [];
  const originalNow = Date.now; Date.now = () => 0;
  try {
    for (const flag of [undefined, 'false', 'TRUE']) {
      const f = await fixture({ photos: false }); f.deps.env!.STAFF_INVENTORY_RESEARCH_SALE_DETAILS = flag;
      const result = await researchStaffInventoryCard(f.input, f.deps); results.push(result);
      assert.equal(f.detailCalls().length, 0); assert.equal(result.engine_version, 'staff-inventory-research-v3');
      assert.equal(Object.hasOwn(result, 'sale_details'), false); assert.ok(result.candidates.every(candidate => !Object.hasOwn(candidate, 'ordinary_sale_detail')));
    }
  } finally { Date.now = originalNow; }
  assert.equal(canonical(results[0]), canonical(results[1])); assert.equal(canonical(results[0]), canonical(results[2]));
  for (const engine_version of ['staff-inventory-research-v1', 'staff-inventory-research-v2', 'staff-inventory-research-v3']) {
    const original = { ...results[0], engine_version };
    assert.equal(canonical(StaffInventoryResearchResultSchema.parse(original)), canonical(original));
    assert.equal(inventoryHash(StaffInventoryResearchResultSchema.parse(original)), inventoryHash(original));
  }
});

test('strict persistence revalidates ordinary-sale semantics, receipts and engine version before any database access', async () => {
  const f = await fixture({ photos: false }), valid = await researchStaffInventoryCard(f.input, f.deps);
  const mutations: ((value: any) => void)[] = [
    value => { value.candidates[0].ordinary_sale_detail.item_id = '900000000999'; },
    value => { value.candidates[0].ordinary_sale_detail.detail.title += ' changed'; },
    value => { value.candidates[0].ordinary_sale_detail.detail.price = '89.01'; },
    value => { value.candidates[0].ordinary_sale_detail.detail.currency = 'CAD'; },
    value => { value.candidates[0].ordinary_sale_detail.detail.best_offer_accepted = true; },
    value => { value.candidates[0].ordinary_sale_detail.detail.ended_date_raw = '3d 20h'; },
    value => { value.candidates[0].ordinary_sale_detail.detail.sold_date = '2026-09-09'; },
    value => { value.candidates[0].ordinary_sale_detail.detail.sold_banner = 'Item sold on Wed, Sep 9 at 6:17 PM'; },
    value => { value.candidates[0].ordinary_sale_detail.search.response_sha256 = 'f'.repeat(64); },
    value => { value.candidates[0].ordinary_sale_detail.search.retrieved_at = '2026-09-17T10:00:00.000Z'; },
    value => { value.candidates[0].ordinary_sale_detail.detail.response_sha256 = 'f'.repeat(64); },
    value => { value.candidates[0].ordinary_sale_detail.detail.retrieved_at = '2026-09-17T10:00:00.000Z'; },
    value => { value.candidates[0].ordinary_sale_detail.search.offer_field = 'false'; },
    value => { value.candidates[0].ordinary_sale_detail.detail.unreviewed = true; },
    value => { value.candidates[0].best_offer_accepted = false; },
    value => { value.candidates[0].sold_price_cents++; },
    value => { value.candidates[0].sale_evidence.status = 'active'; },
    value => { value.candidates[0].multiple_price_options = true; },
    value => { value.sale_details.requests = []; },
    value => { value.sale_details.requests[0].item_id = '900000000999'; },
    value => { value.sale_details.requests.push({ ...value.sale_details.requests[0], item_id: '900000000999' }); },
    value => { value.sale_details.requests[1] = { ...value.sale_details.requests[0] }; },
    value => { value.sale_details.requests[0].requested_at = '2026-09-18T10:00:00.000Z'; },
    value => { value.engine_version = 'staff-inventory-research-v3'; },
    value => { delete value.sale_details; },
  ];
  const unavailable = () => assert.fail('Invalid v5 evidence must fail before any database call.');
  const tx = { $queryRaw: unavailable, $executeRaw: unavailable } as unknown as Parameters<typeof completeStaffInventoryResearchV2>[0];
  for (const mutate of mutations) {
    const changed = structuredClone(valid); mutate(changed);
    assert.equal(StaffInventoryResearchResultSchema.safeParse(changed).success, false, String(mutate));
    await assert.rejects(completeStaffInventoryResearchV2(tx, { jobId: '11111111-1111-4111-8111-111111111111', leaseToken: '22222222-2222-4222-8222-222222222222', result: changed }));
  }
  assert.equal(canonical(StaffInventoryResearchResultSchema.parse(valid)), canonical(valid));
  const reader = { $queryRaw: async () => [{ id: '11111111-1111-4111-8111-111111111111', unitId: valid.unit_id, descriptionEventId: valid.description_event_id,
    descriptionHash: valid.description_hash, inputHash: inventoryHash(f.input), input: canonical(f.input), status: 'complete', attemptCount: 1, maxAttempts: 3,
    leaseToken: null, leaseExpiresAt: null, createdAt: new Date(NOW), updatedAt: new Date(NOW), nextAttemptAt: new Date(NOW), startedAt: new Date(NOW), completedAt: new Date(NOW),
    errorCode: null, errorMessage: null, result: canonical(valid), resultHash: inventoryHash(valid), retries: [], attempts: [] }] } as unknown as Parameters<typeof readStaffInventoryResearchV2>[0];
  const [stored] = await readStaffInventoryResearchV2(reader, { unitIds: [valid.unit_id] });
  assert.deepEqual(stored.result, valid); assert.equal(inventoryHash(stored.result), inventoryHash(valid));
});

test('v5 catalog mode retains v4 pin, coverage, printing-scope and final-current invariants', async () => {
  const f = await fixture({ photos: false }), pin = { publicationId: 'detail-publication', setId: 'detail-set', revision: 1, manifestSha256: 'c'.repeat(64) };
  f.reference.catalog_binding = { publication: pin, card_id: 'detail-card', printing_id: 'detail-printing', applicability: 'supported',
    scope: { language: 'not_applicable', edition: 'not_applicable', format: 'not_applicable', channel: 'not_applicable' },
    image_id: null, image_relationship: null, image_depicted: null, image_represents_printing_ids: [], image_visible_diagnostic_ids: [] };
  f.deps.loadReferences = async () => assert.fail('V5 catalog mode cannot fall back to unpinned references.');
  f.deps.loadCatalog = async () => ({ context: { schema_version: 1, status: 'current', scope_evidence: [], scope_receipt: null,
    publications: [{ publication: pin, lookup_sha256: 'd'.repeat(64), coverage: { text: 'partial', applicability: 'partial', images: 'unknown' }, candidate_count: 1, returned_count: 1, truncated: false }] }, references: [f.reference] });
  let current = true; f.deps.isCatalogCurrent = async () => current;
  const valid = await researchStaffInventoryCard(f.input, f.deps);
  assert.equal(valid.sale_details!.base_engine_version, 'staff-inventory-research-v4'); assert.equal(valid.catalog_context!.status, 'current'); assert.equal(valid.references.length, 1);
  const mutations: ((value: any) => void)[] = [
    value => { delete value.catalog_context; }, value => { value.sale_details.base_engine_version = 'staff-inventory-research-v3'; },
    value => { delete value.references[0].catalog_binding; }, value => { value.references[0].catalog_binding.publication.revision++; },
    value => { value.catalog_context.publications[0].coverage.text = 'truncated'; }, value => { value.catalog_context.publications[0].coverage.applicability = 'truncated'; },
    value => { value.catalog_context.publications[0].candidate_count = 2; value.catalog_context.publications[0].truncated = true; },
    value => { value.references[0].catalog_binding.scope.language = 'en'; }, value => { value.catalog_context.status = 'unavailable'; },
  ];
  for (const mutate of mutations) { const changed = structuredClone(valid); mutate(changed); assert.equal(StaffInventoryResearchResultSchema.safeParse(changed).success, false, String(mutate)); }
  current = false;
  const stale = await researchStaffInventoryCard(f.input, f.deps);
  assert.equal(stale.catalog_context!.status, 'unavailable'); assert.deepEqual(stale.references, []); assert.equal(stale.estimate.status, 'unknown');
  f.deps.env!.STAFF_INVENTORY_RESEARCH_SALE_DETAILS = 'false'; current = true;
  const old = await researchStaffInventoryCard(f.input, f.deps);
  assert.equal(old.engine_version, 'staff-inventory-research-v4'); assert.equal(Object.hasOwn(old, 'sale_details'), false);
  assert.equal(canonical(StaffInventoryResearchResultSchema.parse(old)), canonical(old)); assert.equal(inventoryHash(StaffInventoryResearchResultSchema.parse(old)), inventoryHash(old));
});
