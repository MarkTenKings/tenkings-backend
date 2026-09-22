import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { StaffInventoryResearchResultSchema, type StaffInventoryResearchCandidate, type StaffInventoryResearchResult } from '../lib/staffInventoryResearch';
import { marketResult } from './fixtures/staffInventoryMarketValue';
const { JSDOM } = require('jsdom');
(globalThis as typeof globalThis & { React: typeof React }).React = React;
const cssLoader = require.extensions['.css']; require.extensions['.css'] = module => { module.exports = {}; };
const Panel = require('../components/admin/StaffInventoryResearchPanel').default as typeof import('../components/admin/StaffInventoryResearchPanel').default;
if (cssLoader) require.extensions['.css'] = cssLoader; else delete require.extensions['.css'];
const job = { job_id: '11111111-1111-4111-8111-111111111111', unit_id: 'fixture-unit', description_event_id: 'fixture-description', description_hash: 'a'.repeat(64), input_hash: 'b'.repeat(64), status: 'queued', attempt_count: 0, max_attempts: 3, can_retry: false, result: null };
const timestamp = '2026-09-11T12:00:00.000Z';
function candidate(number: number, overrides: Partial<StaffInventoryResearchCandidate> = {}): StaffInventoryResearchCandidate {
  return { id: `ebay:${number}`, source: 'SoldCompsAPI', listing_url: `https://www.ebay.com/itm/${number}`, retrieved_at: timestamp, source_response_sha256: 'c'.repeat(64), title: `2024 Fixture Chrome Runner #007 listing ${number}`, sold_price: '25.00', sold_price_cents: 2500, sold_currency: 'USD', best_offer_accepted: false, sold_date: '2026-09-10', sold_date_raw: 'Sep 10, 2026', condition: null, grader: null, numeric_grade: null, raw: true, image_url: null, image: null, source_eligible: true, exclusion_reason: null, ...overrides };
}
function withImage(item: StaffInventoryResearchCandidate, hash: string): StaffInventoryResearchCandidate {
  const image_url = `https://i.ebayimg.com/images/g/${item.id.slice(5)}/s-l1600.jpg`;
  return { ...item, image_url, image: { source_url: image_url, sha256: hash, retrieved_at: timestamp, content_type: 'image/jpeg', byte_size: 1200, storage_key: `research-evidence/${hash}.jpg` } };
}
function unknownResult(candidates: StaffInventoryResearchCandidate[]): StaffInventoryResearchResult {
  return { schema_version: 1, unit_id: job.unit_id, description_event_id: job.description_event_id, description_hash: job.description_hash, engine_version: 'staff-inventory-research-v1', model: 'gpt-6-astra', researched_at: timestamp, timings_ms: { photos: 1, sources: 1, images: 1, model: 1, total: 4 }, photos: { front: null, back: null }, query: candidates.length ? '2024 Fixture Chrome Runner 007' : null, identity: { status: 'unresolved', variant_name: null, suggestion: 'Unresolved fixture variant', reason: 'The reviewed catalog does not establish this variant.', reference_ids: [], photo_features: [] }, target_condition: { status: 'unresolved', grader: null, numeric_grade: null, photo_evidence: null }, references: [], candidates, selected_candidate_ids: [], rejections: candidates.map(item => ({ candidate_id: item.id, reason: item.exclusion_reason ?? 'Matching identity is not established.' })), estimate: { status: 'unknown', value_cents: null, low_cents: null, high_cents: null, currency: 'USD', count: 0, reason: 'Not enough matching sales with verified evidence.' }, warnings: [] };
}
function estimatedResult(candidates: StaffInventoryResearchCandidate[]): StaffInventoryResearchResult {
  const base = unknownResult(candidates), front = 'd'.repeat(64), back = 'e'.repeat(64), photoPrefix = 'inventory-photos/11111111-1111-4111-8111-111111111111/';
  return { ...base, photos: { front: { key: `${photoPrefix}${front}.jpg`, sha256: front }, back: { key: `${photoPrefix}${back}.jpg`, sha256: back } }, identity: { status: 'base', variant_name: 'Base', suggestion: null, reason: 'Exact fixture catalog and card photos establish Base.', reference_ids: ['fixture-reference'], photo_features: [{ side: 'front', photo_sha256: front, reference_id: 'fixture-reference', evidence_type: 'catalog_feature', reference_feature: 'Plain border', observation: 'The photographed card has the plain border.' }] }, target_condition: { status: 'raw', grader: null, numeric_grade: null, photo_evidence: 'The photos show an unslabbed card.' }, references: [{ id: 'fixture-reference', kind: 'catalog', trust: 'published_catalog', identity: { name: 'Runner', category: 'Sports cards', year: '2024', manufacturer: 'Fixture', set_name: 'Chrome', card_number: '007' }, catalog_id: 'fixture-catalog', variant_name: 'Base', variant_kind: 'BASE', source_url: null, source_sha256: 'f'.repeat(64), captured_at: timestamp, distinguishing_features: ['Plain border'], image: null }], selected_candidate_ids: candidates.slice(0, 2).map(item => item.id), rejections: base.rejections.slice(2), estimate: { status: 'estimated', value_cents: 2500, low_cents: 2500, high_cents: 2500, currency: 'USD', count: 2, reason: 'Arithmetic mean of two verified matching sales.' } };
}
function responseFor(result: StaffInventoryResearchResult, image_previews: Record<string, string> = {}) {
  StaffInventoryResearchResultSchema.parse(result);
  return Response.json({ version: 1, jobs: [{ ...job, status: 'complete', result }], image_previews });
}
async function mount(fetchImpl: typeof fetch) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://fixture.invalid/' });
  const values: Record<string, unknown> = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, fetch: fetchImpl, crypto: webcrypto, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, value, writable: true });
  const container = document.getElementById('root')!, root = createRoot(container);
  let props = { unitId: 'fixture-unit', token: 'fixture-admin', descriptionEventId: 'fixture-description' };
  await act(async () => { root.render(<Panel {...props} />); });
  return { container, async render(next: Partial<typeof props>) { props = { ...props, ...next }; await act(async () => { root.render(<Panel {...props} />); }); }, async close() { await act(async () => root.unmount()); dom.window.close(); for (const [key, descriptor] of previous) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } };
}
function article(container: HTMLElement, item: StaffInventoryResearchCandidate) {
  const element = [...container.querySelectorAll('article')].find(node => node.getAttribute('aria-label') === item.title);
  assert.ok(element, `Listing is readable: ${item.id}`); return element;
}

test('research progress is a private read and never a save dependency', async () => {
  let calls = 0;
  const ui = await mount(async (url, init) => { calls++; assert.match(String(url), /research\?unit_id=fixture-unit/); assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer fixture-admin'); assert.equal(init?.cache, 'no-store'); assert.equal(init?.method, undefined); assert.ok(init?.signal); return Response.json({ version: 1, jobs: [job], image_previews: {} }); });
  try { assert.match(ui.container.textContent!, /Queued/); assert.match(ui.container.textContent!, /keep adding inventory or close this page/); assert.equal(calls, 1); } finally { await ui.close(); }
});
test('private photo matching shows selected sale value without claiming published catalog identity', async () => {
  const result = { ...marketResult(6), description_event_id: job.description_event_id, description_hash: job.description_hash };
  const before = JSON.stringify(result), ui = await mount(async () => responseFor(result));
  try {
    assert.match(ui.container.textContent!, /Card matched from original photos/);
    assert.match(ui.container.textContent!, /private research match/);
    assert.match(ui.container.textContent!, /\$10\.02/);
    const catalog = [...ui.container.querySelectorAll('details')].find(node => node.querySelector('summary')?.textContent === 'Catalog identity')!;
    assert.ok(catalog); assert.equal(catalog.open, false); assert.match(catalog.textContent!, /No published catalog record/);
    assert.equal(ui.container.querySelector('article')?.getAttribute('aria-label'), result.candidates[0].title);
    assert.equal(JSON.stringify(result), before);
  } finally { await ui.close(); }
});
test('old description results and unavailable reads cannot replace the current card', async () => {
  const ui = await mount(async () => Response.json({ version: 1, jobs: [{ ...job, description_event_id: 'old-revision' }] }));
  try { assert.match(ui.container.textContent!, /Not researched/); assert.doesNotMatch(ui.container.textContent!, /Queued/); } finally { await ui.close(); }
  const unavailable = await mount(async () => Response.json({ message: 'unsafe detail' }, { status: 503 }));
  try { assert.match(unavailable.container.textContent!, /Your inventory is saved/); assert.doesNotMatch(unavailable.container.textContent!, /unsafe detail/); } finally { await unavailable.close(); }
});
test('retry sends only the exact failed revision and does not update prices or inventory', async () => {
  let posted: any;
  const ui = await mount(async (_, init) => { if (init?.method === 'POST') { posted = JSON.parse(String(init.body)); assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer fixture-admin'); return Response.json({ outcome: 'QUEUED' }); } return Response.json({ version: 1, jobs: [{ ...job, status: 'failed', attempt_count: 3, can_retry: true, error: { message: 'Provider is temporarily unavailable.' } }] }); });
  try {
    await act(async () => ui.container.querySelector('button')!.click());
    assert.ok(posted); assert.equal(posted.jobId, job.job_id); assert.equal(posted.inputHash, job.input_hash); assert.equal(posted.expectedAttemptCount, 3);
    assert.deepEqual(Object.keys(posted).sort(), ['requestId', 'jobId', 'unitId', 'descriptionEventId', 'inputHash', 'expectedAttemptCount'].sort());
  } finally { await ui.close(); }
});
test('manual research start preserves the exact existing unit and description contract', async () => {
  let posted: any;
  const ui = await mount(async (_, init) => { if (init?.method === 'POST') { posted = JSON.parse(String(init.body)); return Response.json({ outcome: 'QUEUED' }); } return Response.json({ version: 1, jobs: [] }); });
  try { await act(async () => ui.container.querySelector('button')!.click()); assert.equal(posted.action, 'start'); assert.equal(posted.unitId, job.unit_id); assert.equal(posted.descriptionEventId, job.description_event_id); assert.deepEqual(Object.keys(posted).sort(), ['action', 'requestId', 'unitId', 'descriptionEventId'].sort()); } finally { await ui.close(); }
});
test('legacy results display each source price honestly without inventing a matching card or estimate', async () => {
  const items = [candidate(123450), candidate(123451, { sold_price: '49.99', sold_price_cents: null, best_offer_accepted: null, source_eligible: false, exclusion_reason: 'Final sale amount is unverified.' }), candidate(123452, { sold_price: '85.00', sold_price_cents: null, best_offer_accepted: true, source_eligible: false, exclusion_reason: 'Accepted offer is unavailable.' }), candidate(123453, { sold_price: '125.50', sold_price_cents: null, sold_currency: 'EUR', best_offer_accepted: null, source_eligible: false, exclusion_reason: 'Sale currency cannot establish a USD estimate.' }), candidate(123454, { sold_price: null, sold_price_cents: null, sold_currency: null, best_offer_accepted: null, source_eligible: false, exclusion_reason: 'No source amount was returned.' }), candidate(123455, { sold_price: '15.00', sold_price_cents: null, sold_currency: null, best_offer_accepted: null, source_eligible: false, exclusion_reason: 'Currency was not returned.' })];
  const result = unknownResult(items), before = JSON.stringify(result), ui = await mount(async () => responseFor(result));
  try {
    assert.match(article(ui.container, items[0]).textContent!, /Sold price\$25.00/);
    assert.match(article(ui.container, items[1]).textContent!, /Reported price\$49.99Final sale unverified/);
    assert.match(article(ui.container, items[2]).textContent!, /Listed price\$85.00Accepted offer unavailable/);
    assert.match(article(ui.container, items[3]).textContent!, /EUR\s*125.50/);
    assert.match(article(ui.container, items[4]).textContent!, /Price unavailable/);
    assert.match(article(ui.container, items[5]).textContent!, /15.00Final sale unverified · Currency not provided/);
    assert.match(ui.container.textContent!, /No matching comparisons established yet/);
    assert.doesNotMatch(ui.container.textContent!, /verified matching sales|Matching research candidates|\$0.00|—/);
    const other = [...ui.container.querySelectorAll('details')].find(node => node.querySelector('summary')?.textContent?.startsWith('Other results'))!;
    assert.ok(other); assert.equal(other.open, true); assert.equal(other.querySelectorAll('article').length, items.length);
    assert.equal(JSON.stringify(result), before); assert.equal(ui.container.querySelectorAll('img').length, 0);
    const source = article(ui.container, items[1]).querySelector('a')!; assert.equal(source.href, items[1].listing_url); assert.equal(source.target, '_blank'); assert.equal(source.rel, 'noreferrer');
  } finally { await ui.close(); }
});
test('verified accepted offers display the accepted amount without replacing the source listing amount', async () => {
  const item = candidate(123456, { sold_price: '75.00', sold_price_cents: 6000, best_offer_accepted: true, accepted_offer: { amount: '60.00', currency: 'USD', source_field: 'boaAcceptedPrice', hydrated: true } });
  const result = unknownResult([item]), ui = await mount(async () => responseFor(result));
  try { const text = article(ui.container, item).textContent!; assert.match(text, /Accepted offer\$60.00Verified sale amount/); assert.match(text, /Reported listing: \$75.00/); assert.equal(result.estimate.value_cents, null); assert.match(text, /Not included in estimate/); } finally { await ui.close(); }
});
test('conflicting accepted-offer evidence remains unverified even when visual research describes a match', async () => {
  const item = withImage(candidate(123457, { sold_price: '75.00', sold_price_cents: 6000, best_offer_accepted: true, accepted_offer: { amount: '60.00', currency: 'USD', source_field: 'boaAcceptedPrice', hydrated: true }, source_eligible: false, exclusion_reason: 'The provider returned conflicting evidence for the same listing.' }), '6'.repeat(64));
  const photoPrefix = 'inventory-photos/11111111-1111-4111-8111-111111111111/';
  const result: StaffInventoryResearchResult = { ...unknownResult([item]), engine_version: 'staff-inventory-research-v2', photos: { front: { key: `${photoPrefix}${'d'.repeat(64)}.jpg`, sha256: 'd'.repeat(64) }, back: { key: `${photoPrefix}${'e'.repeat(64)}.jpg`, sha256: 'e'.repeat(64) } }, target_condition: { status: 'raw', grader: null, numeric_grade: null, photo_evidence: 'The photographed card is unslabbed.' }, comparison_assessments: [{ candidate_id: item.id, classification: 'matched', reason: 'The photographed card design matches.', identity_match: true, variant_match: true, visual_match: true, condition_match: true }] };
  const ui = await mount(async () => responseFor(result));
  try {
    const text = article(ui.container, item).textContent!;
    assert.match(text, /Reported accepted offer\$60.00Conflicting source evidence · Unverified/);
    assert.match(text, /Reported listing: \$75.00/); assert.match(text, /The photographed card design matches/);
    assert.match(text, /The provider returned conflicting evidence for the same listing/); assert.doesNotMatch(text, /Verified sale amount/);
    assert.equal(result.estimate.value_cents, null); assert.match(text, /Not in estimate/);
  } finally { await ui.close(); }
});
test('estimate selections come first, research matches stay separate, and mismatch and search audits are collapsed', async () => {
  const items = [withImage(candidate(123460), '1'.repeat(64)), withImage(candidate(123461), '2'.repeat(64)), withImage(candidate(123462, { sold_price: '99.99', sold_price_cents: null, best_offer_accepted: null, source_eligible: false, exclusion_reason: 'Final price is unverified.', source_response_sha256: '9'.repeat(64) }), '3'.repeat(64)), withImage(candidate(123463, { source_response_sha256: '9'.repeat(64) }), '4'.repeat(64)), withImage(candidate(123464, { title: 'A different fixture player', source_response_sha256: '9'.repeat(64) }), '5'.repeat(64))];
  const result: StaffInventoryResearchResult = { ...estimatedResult(items), engine_version: 'staff-inventory-research-v2', comparison_assessments: items.map((item, index) => ({ candidate_id: item.id, classification: index < 3 ? 'matched' : index === 3 ? 'possible' : 'rejected', reason: index === 4 ? 'The player is different.' : index === 3 ? 'The parallel remains uncertain.' : 'The name, design and condition match the photographed card.', identity_match: index !== 4, variant_match: index !== 3 && index !== 4, visual_match: index !== 4, condition_match: true })), research_queries: [{ sequence: 1, query: '2024 Fixture Chrome Runner 007', reason: 'Search the saved identity.', status: 'completed', source_response_sha256: 'c'.repeat(64), candidate_ids: items.slice(0, 2).map(item => item.id), error_code: null }, { sequence: 2, query: '2024 Fixture Chrome Runner 007 Base', reason: 'Keep the card identity and narrow the design.', status: 'completed', source_response_sha256: '9'.repeat(64), candidate_ids: items.slice(2).map(item => item.id), error_code: null }, { sequence: 3, query: '2024 Fixture Chrome Runner 007 Base raw', reason: 'Clarify the raw condition.', status: 'failed', source_response_sha256: null, candidate_ids: [], error_code: 'provider_error' }] };
  const ui = await mount(async () => responseFor(result));
  try {
    const groups = [...ui.container.querySelectorAll('section[aria-label]')].map(node => node.getAttribute('aria-label'));
    assert.deepEqual(groups, ['Card market research', 'Included in market estimate', 'Matching research candidates', 'Candidates to review']);
    const included = ui.container.querySelector('section[aria-label="Included in market estimate"]')!;
    assert.deepEqual([...included.querySelectorAll('article')].map(node => node.getAttribute('aria-label')), items.slice(0, 2).map(item => item.title));
    assert.match(ui.container.querySelector('section[aria-label="Matching research candidates"]')!.textContent!, /Reported price\$99.99Final sale unverified/);
    assert.match(ui.container.textContent!, /2 AI-selected sold comps/); assert.equal(result.estimate.value_cents, 2500);
    const mismatch = article(ui.container, items[4]); assert.equal(mismatch.closest('details')?.open, false); assert.match(mismatch.textContent!, /Rejected comparison/);
    const searches = [...ui.container.querySelectorAll('details')].find(node => node.querySelector('summary')?.textContent?.startsWith('Searches & evidence'))!;
    assert.equal(searches.open, false); assert.match(searches.textContent!, /3 searches/); assert.match(searches.textContent!, /Initial search/); assert.match(searches.textContent!, /Refined search 2/); assert.match(searches.textContent!, /Earlier results remain available/);
    assert.doesNotMatch(searches.textContent!, /provider_error|cccccccc/);
  } finally { await ui.close(); }
});
test('only private saved previews render, with accessible enlargement and no remote fallback on failure', async () => {
  const item = withImage(candidate(123470), '7'.repeat(64)), result = unknownResult([item]);
  const preview = 'https://private-preview.invalid/evidence.jpg?signature=fixture';
  const ui = await mount(async () => responseFor(result, { [item.image!.storage_key!]: preview }));
  try {
    const row = article(ui.container, item), button = row.querySelector('button')!;
    assert.equal(row.querySelector('img')!.getAttribute('src'), preview); assert.equal(row.querySelector('img')!.getAttribute('referrerpolicy'), 'no-referrer');
    assert.equal(button.getAttribute('aria-expanded'), 'false'); assert.match(button.getAttribute('aria-label')!, /Enlarge listing photo/);
    await act(async () => button.click()); assert.equal(button.getAttribute('aria-expanded'), 'true'); assert.match(button.getAttribute('aria-label')!, /Reduce listing photo/);
    await act(async () => row.querySelector('img')!.dispatchEvent(new window.Event('error')));
    assert.equal(row.querySelector('img'), null); assert.match(row.textContent!, /Private preview could not load/); assert.ok(!ui.container.innerHTML.includes(item.image_url!));
  } finally { await ui.close(); }
  const missing = await mount(async () => responseFor(result));
  try { assert.equal(missing.container.querySelector('img'), null); assert.match(missing.container.textContent!, /No private preview saved/); } finally { await missing.close(); }
});
test('nested result unit, description and description hash must agree with the loaded job', async () => {
  for (const changed of [{ unit_id: 'other-unit' }, { description_event_id: 'other-description' }, { description_hash: '0'.repeat(64) }]) {
    const result = { ...unknownResult([candidate(123480)]), ...changed };
    const ui = await mount(async () => responseFor(result));
    try { assert.match(ui.container.textContent!, /Research is temporarily unavailable/); assert.equal(ui.container.querySelector('article'), null); } finally { await ui.close(); }
  }
});
test('late responses and a changed authentication token cannot retain another card’s private evidence', async () => {
  let resolveOld!: (value: Response) => void;
  const old = new Promise<Response>(resolve => { resolveOld = resolve; });
  const item = withImage(candidate(123490), '8'.repeat(64));
  const ui = await mount(async (url, init) => {
    if (String(url).endsWith('fixture-unit')) return old;
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer new-fixture-admin');
    return Response.json({ version: 1, jobs: [{ ...job, unit_id: 'new-unit', description_event_id: 'new-description' }] });
  });
  try {
    await ui.render({ unitId: 'new-unit', descriptionEventId: 'new-description', token: 'new-fixture-admin' });
    await act(async () => resolveOld(responseFor(unknownResult([item]), { [item.image!.storage_key!]: 'https://private-preview.invalid/old.jpg' })));
    assert.match(ui.container.textContent!, /Queued/); assert.doesNotMatch(ui.container.textContent!, /listing 123490/); assert.equal(ui.container.querySelector('img'), null);
  } finally { await ui.close(); }
  let call = 0;
  const changedAuth = await mount(async () => ++call === 1 ? responseFor(unknownResult([item]), { [item.image!.storage_key!]: 'https://private-preview.invalid/old.jpg' }) : Response.json({}, { status: 401 }));
  try { assert.ok(changedAuth.container.querySelector('img')); await changedAuth.render({ token: 'new-fixture-admin' }); assert.equal(changedAuth.container.querySelector('img'), null); assert.equal(changedAuth.container.querySelector('article'), null); assert.match(changedAuth.container.textContent!, /Research is temporarily unavailable/); } finally { await changedAuth.close(); }
});


test('value arithmetic uses selected sold prices and leaves the incorrect comp out', async () => {
  const prices = [10000, 11000, 9000, 90000];
  const items = prices.map((price, index) => withImage(candidate(123500 + index, {
    sold_price: (price / 100).toFixed(2), sold_price_cents: price,
    ...(index === 3 ? { title: 'Different player and parallel' } : {}),
  }), String(index + 1).repeat(64)));
  const result = { ...estimatedResult(items), selected_candidate_ids: items.slice(0, 3).map(item => item.id),
    rejections: [{ candidate_id: items[3].id, reason: 'Wrong card and parallel.' }],
    estimate: { status: 'estimated' as const, value_cents: 10000, low_cents: 9000, high_cents: 11000, currency: 'USD' as const, count: 3, reason: 'Arithmetic mean of selected verified USD sold prices.' } };
  const before = JSON.stringify(result), methods: (string | undefined)[] = [];
  const ui = await mount(async (_, init) => { methods.push(init?.method); return responseFor(result); });
  try {
    const formula = ui.container.querySelector('[aria-label="How the eBay comp value is calculated"]')!;
    assert.ok(formula); assert.match(formula.textContent!, /\$100.00 \+ \$110.00 \+ \$90.00 = \$300.00/);
    assert.match(formula.textContent!, /\$300.00 ÷ 3 sales = \$100.00/);
    assert.match(formula.textContent!, /3 included · 1 listing not used/);
    assert.doesNotMatch(formula.textContent!, /\$900.00/);
    assert.match(formula.textContent!, /excludes shipping/);
    assert.match(formula.textContent!, /AI matching can make mistakes/);
    assert.match(article(ui.container, items[3]).textContent!, /Wrong card and parallel/);
    assert.equal(JSON.stringify(result), before); assert.deepEqual(methods, [undefined]);
  } finally { await ui.close(); }
});

test('value formula rounds a half cent upward and does not round each sale first', async () => {
  const items = [1001, 1002].map((price, index) => withImage(candidate(123510 + index, { sold_price: (price / 100).toFixed(2), sold_price_cents: price }), String(index + 1).repeat(64)));
  const result = { ...estimatedResult(items), estimate: { status: 'estimated' as const, value_cents: 1002, low_cents: 1001, high_cents: 1002, currency: 'USD' as const, count: 2, reason: 'Arithmetic mean rounded to nearest cent.' } };
  const ui = await mount(async () => responseFor(result));
  try { const formula = ui.container.querySelector('[aria-label="How the eBay comp value is calculated"]')!;
    assert.match(formula.textContent!, /\$10.01 \+ \$10.02 = \$20.03/);
    assert.match(formula.textContent!, /\$20.03 ÷ 2 sales = \$10.02/);
    assert.match(formula.textContent!, /nearest cent/);
  } finally { await ui.close(); }
});

test('historical duplicate-image weighting keeps its evidence but cannot present a current value', async () => {
  const items = [1000, 2000, 3000].map((price, index) => withImage(candidate(123520 + index, { sold_price: (price / 100).toFixed(2), sold_price_cents: price }), (index < 2 ? '1' : '2').repeat(64)));
  const result = { ...estimatedResult(items), selected_candidate_ids: items.map(item => item.id), rejections: [],
    estimate: { status: 'estimated' as const, value_cents: 2000, low_cents: 1000, high_cents: 3000, currency: 'USD' as const, count: 3, reason: 'Historical equal-weight result.' } };
  const before = JSON.stringify(result), ui = await mount(async () => responseFor(result));
  try {
    assert.match(ui.container.textContent!, /More evidence needed/);
    const formula = ui.container.querySelector('[aria-label="How the eBay comp value is calculated"]')!;
    assert.match(formula.textContent!, /saved selection needs review/);
    assert.match(formula.textContent!, /0 included · 3 listings not used/);
    assert.equal(ui.container.querySelector('[aria-label="Included in market estimate"]'), null);
    assert.equal(ui.container.querySelectorAll('article').length, 3);
    assert.equal(JSON.stringify(result), before);
  } finally { await ui.close(); }
});
