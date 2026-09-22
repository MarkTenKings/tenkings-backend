import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { getEventListeners } from 'node:events';
import test from 'node:test';
import { StaffInventoryRecoverySourceDiscoverySchema } from '@tenkings/shared';
import { inventoryRecoverySourceDemand, isInventoryRecoverySourceUrl, prepareRecoverySources, STAFF_INVENTORY_RECOVERY_SOURCE_LIMITS } from '../lib/server/staffInventoryResearchRecoverySources';
import type { StaffInventoryResearchDescription } from '../lib/staffInventoryResearch';

const description: StaffInventoryResearchDescription = { name: 'Private card display name', category: 'Sports cards', year: '2023-24',
  manufacturer: 'Panini', set_name: 'Donruss Optic', card_type: 'Basketball', card_number: 'PRIVATE-007/100', variant: 'Private finish suggestion' };
const signal = () => new AbortController().signal;
const rss = (rows: { title: string; url: string }[]) => `<rss><channel>${rows.map(row => `<item><title>${row.title}</title><link>${row.url}</link></item>`).join('')}</channel></rss>`;
const xml = (body: string) => new Response(body, { headers: { 'content-type': 'application/rss+xml' } });
const html = (body: string) => new Response(`<!doctype html><html><body>${body}</body></html>`, { headers: { 'content-type': 'text/html' } });

test('only normalized public product demand enters queries and distinct years/seasons never merge', () => {
  const demand = inventoryRecoverySourceDemand(description)!;
  assert.match(demand.query, /2023-24 panini donruss optic basketball/);
  for (const privateValue of [description.name!, description.card_number!, description.variant!]) assert.equal(demand.query.includes(privateValue.toLowerCase()), false);
  assert.equal(inventoryRecoverySourceDemand({ ...description, name: 'Another physical card', card_number: 'other', variant: null })?.demand_sha256, demand.demand_sha256);
  assert.equal(inventoryRecoverySourceDemand({ ...description, manufacturer: 'PANINI', set_name: 'Donruss  Optic' })?.demand_sha256, demand.demand_sha256);
  assert.notEqual(inventoryRecoverySourceDemand({ ...description, year: '2023' })?.demand_sha256, demand.demand_sha256);
  for (const year of ['2023–24', '2023—24', '2023‑24']) {
    assert.equal(inventoryRecoverySourceDemand({ ...description, year })?.query, demand.query);
    assert.notEqual(inventoryRecoverySourceDemand({ ...description, year })?.demand_sha256, demand.demand_sha256);
  }
  assert.notEqual(inventoryRecoverySourceDemand({ ...description, card_type: 'Football' })?.demand_sha256, demand.demand_sha256);
  for (const patch of [{ year: null }, { set_name: null }, { manufacturer: null }, { category: 'Other trading cards' },
    { year: '2023 or 2024' }, { set_name: 'https://private.example/card' }, { card_type: 'Basketball\nInjected query' }]) assert.equal(inventoryRecoverySourceDemand({ ...description, ...patch }), null);
});

test('source URLs require a canonical public HTTPS host and exclude queries, credentials, lookalikes and navigation', () => {
  for (const url of ['https://www.topps.com/pages/checklists', 'https://assets.pokemon.com/assets/checklist.pdf', 'https://www.tcdb.com/ViewSet.cfm/sid/123']) assert.equal(isInventoryRecoverySourceUrl(url), true);
  for (const url of ['http://www.topps.com/checklist', 'https://user:pass@www.topps.com/checklist', 'https://www.topps.com:443/checklist',
    'https://www.topps.com/checklist?key=secret', 'https://www.topps.com/checklist#fragment', 'https://www.topps.com/', 'https://topps.com.evil.test/checklist',
    'https://eviltopps.com/checklist', 'https://127.0.0.1/checklist', 'https://www.topps.com/search/optic', 'https://www.tcdb.com/Search.cfm',
    'https://www.topps.com/account/login', 'https://www.topps.com/%73earch/optic', 'https://www.topps.com/%00checklist', 'https://www.topps.com/%FF']) assert.equal(isInventoryRecoverySourceUrl(url), false, url);
});

test('three review candidates stop after one search and bind only actual search response bytes', async () => {
  const body = rss(['a', 'b', 'c', 'd'].map(letter => ({ title: `2023-24 Donruss Optic &amp; checklist ${letter}`, url: `https://www.topps.com/checklist-${letter}` })));
  const calls: { url: string; init: RequestInit }[] = [];
  const result = await prepareRecoverySources(description, signal(), { fetchImpl: async (url, init) => { calls.push({ url: String(url), init: init! }); return xml(body); } });
  assert.equal(calls.length, 1); assert.equal(calls[0].init.redirect, 'error'); assert.equal(calls[0].init.cache, 'no-store');
  assert.ok(calls[0].url.startsWith('https://www.bing.com/search?')); assert.equal('Authorization' in (calls[0].init.headers as object), false);
  assert.equal(result.disposition, 'review_required'); assert.equal(result.status, 'candidates'); assert.equal(result.candidates.length, 3);
  assert.equal(result.candidates[0].title, '2023-24 Donruss Optic & checklist a');
  assert.equal(result.requests[0].response_sha256, createHash('sha256').update(body).digest('hex'));
  assert.equal(JSON.stringify(result).includes('Private'), false);
});

test('second bounded search unwraps DuckDuckGo data links, deduplicates and rejects untrusted/search targets without visiting them', async () => {
  const a = 'https://www.topps.com/checklist-a', b = 'https://www.beckett.com/news/synthetic-checklist/';
  let calls = 0;
  const result = await prepareRecoverySources(description, signal(), { fetchImpl: async (url, init) => {
    calls++;
    if (String(url).startsWith('https://www.bing.com/')) return xml(rss([{ title: '2023-24 Donruss Optic A', url: a }, { title: 'Search', url: 'https://www.topps.com/search?q=optic' }]));
    const endpoint = new URL(String(url));
    assert.equal(endpoint.origin, 'https://html.duckduckgo.com'); assert.equal(endpoint.pathname, '/html/');
    assert.equal(endpoint.searchParams.get('q'), inventoryRecoverySourceDemand(description)!.query);
    assert.equal(init?.redirect, 'error');
    return html(`<a class="result__a" href="${a}">Duplicate A</a><a href="//duckduckgo.com/l/?uddg=${encodeURIComponent(b)}&amp;rut=ignored" class="result__a"><b>2023-24 Donruss Optic B</b></a>
      <a class="result__a" href="https://evil.example/steal">Ignore</a><a class="result__a" href="https://www.topps.com/search/something">Ignore search</a>`);
  } });
  assert.equal(calls, 2); assert.deepEqual(result.candidates.map(item => item.url), [a, b]);
  assert.equal(result.candidates[1].title, '2023-24 Donruss Optic B'); assert.equal(result.requests.length, 2);
});

test('response byte bounds cancel oversized bodies and redirects or unsupported content never become source facts', async () => {
  let calls = 0, cancelled = false;
  const result = await prepareRecoverySources(description, signal(), { fetchImpl: async () => {
    calls++;
    if (calls === 1) return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(STAFF_INVENTORY_RECOVERY_SOURCE_LIMITS.responseBytes + 1)); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'application/rss+xml' } });
    return new Response('[]', { headers: { 'content-type': 'application/json' } });
  } });
  assert.equal(calls, 2); assert.equal(cancelled, true); assert.equal(result.status, 'unavailable');
  assert.deepEqual(result.requests.map(request => request.status), ['oversized', 'failed']); assert.deepEqual(result.candidates, []);
  const redirect = await prepareRecoverySources(description, signal(), { fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'https://www.topps.com/checklist' } }) });
  assert.equal(redirect.status, 'unavailable'); assert.deepEqual(redirect.candidates, []);
});

test('bounded no-result and provider failure are honest terminal receipts, not synthetic source links', async () => {
  const empty = await prepareRecoverySources(description, signal(), { fetchImpl: async url => String(url).startsWith('https://www.bing.com/')
    ? xml(rss([])) : html('<div class="no-results"><h1>No results found</h1></div>') });
  assert.equal(empty.status, 'not_found'); assert.equal(empty.requests.length, 2); assert.deepEqual(empty.candidates, []);
  assert.deepEqual(empty.requests.map(request => request.status), ['completed', 'completed']);
  assert.ok(empty.requests.every(request => request.response_sha256 !== null));
  let calls = 0;
  const unavailable = await prepareRecoverySources(description, signal(), { fetchImpl: async () => { calls++; throw new Error('private detail'); } });
  assert.equal(calls, 2); assert.equal(unavailable.status, 'unavailable'); assert.equal(JSON.stringify(unavailable).includes('private detail'), false);
});

test('only HTTP 200 can complete a provider request, even when another success status contains plausible results', async () => {
  for (const status of [202, 204, 206]) {
    let calls = 0;
    const result = await prepareRecoverySources(description, signal(), { fetchImpl: async url => {
      calls++;
      const bing = String(url).startsWith('https://www.bing.com/');
      return new Response(status === 204 ? null : bing ? rss([]) : '<html><body><div class="no-results">No results found</div></body></html>',
        { status, headers: { 'content-type': bing ? 'application/rss+xml' : 'text/html' } });
    } });
    assert.equal(calls, 2); assert.equal(result.status, 'unavailable'); assert.deepEqual(result.candidates, []);
    assert.deepEqual(result.requests.map(request => [request.status, request.response_sha256]), [['failed', null], ['failed', null]]);
  }
});

test('DuckDuckGo challenges and malformed pages fail instead of becoming completed empty searches', async () => {
  const plausible = '<a class="result__a" href="https://www.topps.com/2023-24-donruss-optic">2023-24 Donruss Optic checklist</a>';
  const payloads = [
    `<html><body><form id="challenge-form"></form>${plausible}</body></html>`,
    `<html><body><div class="anomaly-modal"></div>${plausible}</body></html>`,
    '<html><body><script src="/anomaly.js"></script><div class="no-results">No results found</div></body></html>',
    '<html><body>Temporarily unavailable</body></html>',
    `<html><body>${plausible}`,
    rss([]),
  ];
  for (const payload of payloads) {
    let calls = 0;
    const result = await prepareRecoverySources(description, signal(), { fetchImpl: async url => {
      calls++; if (String(url).startsWith('https://www.bing.com/')) throw new Error('Fixture unavailable');
      return new Response(payload, { headers: { 'content-type': 'text/html' } });
    } });
    assert.equal(calls, 2); assert.equal(result.status, 'unavailable'); assert.deepEqual(result.candidates, []);
    assert.deepEqual(result.requests.map(request => [request.status, request.response_sha256]), [['failed', null], ['failed', null]]);
  }
});

test('Bing requires a complete RSS feed rather than HTML, a truncated feed or malformed result items', async () => {
  const payloads = [
    '<html><body>Provider challenge</body></html>',
    '<rss><channel><item><title>2023-24 Donruss Optic</title></item></channel></rss>',
    '<rss><channel><item><link>https://www.topps.com/2023-24-donruss-optic</link></item></channel></rss>',
    '<rss><channel><item><title>2023-24 Donruss Optic</title></channel></rss>',
    '<rss><channel></channel>',
  ];
  for (const payload of payloads) {
    const result = await prepareRecoverySources(description, signal(), { fetchImpl: async url => {
      if (String(url).startsWith('https://www.bing.com/')) return xml(payload);
      return html('<div class="no-results">No results found</div>');
    } });
    assert.equal(result.status, 'not_found'); assert.deepEqual(result.candidates, []);
    assert.deepEqual(result.requests[0], { provider: 'bing_rss', status: 'failed', response_sha256: null });
    assert.equal(result.requests[1].status, 'completed'); assert.ok(result.requests[1].response_sha256);
  }
});

test('one overall deadline stops even an abort-ignoring fetch and prevents the second search', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let started!: (signal: AbortSignal) => void; const active = new Promise<AbortSignal>(resolve => { started = resolve; });
  let calls = 0;
  const parent = new AbortController();
  const run = prepareRecoverySources(description, parent.signal, { timeoutMs: 5, fetchImpl: async (_, init) => {
    calls++; started(init!.signal as AbortSignal); return new Promise(() => {});
  } });
  const observed = await active; t.mock.timers.tick(5);
  const result = await run;
  assert.equal(calls, 1); assert.equal(observed.aborted, true); assert.equal(result.status, 'unavailable');
  assert.equal(result.requests[0].status, 'cancelled'); assert.equal(getEventListeners(parent.signal, 'abort').length, 0);
});

test('parent cancellation and incomplete identity cannot emit a completed receipt or start later requests', async () => {
  const parent = new AbortController(); parent.abort(); let calls = 0;
  const deps = { fetchImpl: async () => { calls++; return xml(rss([])); } };
  await assert.rejects(prepareRecoverySources(description, parent.signal, deps), /cancelled/);
  await assert.rejects(prepareRecoverySources({ ...description, year: null }, signal(), deps), /Complete public/);
  assert.equal(calls, 0);
});

test('a stalled response body shares the single deadline and cannot start another search', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let began!: () => void; const active = new Promise<void>(resolve => { began = resolve; }); let calls = 0, cancelled = false;
  const run = prepareRecoverySources(description, signal(), { timeoutMs: 8, fetchImpl: async () => {
    calls++; return new Response(new ReadableStream({ start() { began(); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'application/rss+xml' } });
  } });
  await active; await Promise.resolve(); t.mock.timers.tick(8);
  const result = await run; assert.equal(calls, 1); assert.equal(cancelled, true);
  assert.equal(result.requests[0].status, 'cancelled'); assert.equal(result.status, 'unavailable');
});

test('trusted but unrelated product/year hits are excluded and typographic seasons retain the complete season', async () => {
  const rows = [
    { title: '2023 Donruss Optic checklist', url: 'https://www.beckett.com/news/old-set/' },
    { title: '2023-24 Donruss checklist', url: 'https://www.beckett.com/news/other-product/' },
    { title: '2023–24 Panini Donruss Optic checklist', url: 'https://www.beckett.com/news/encountered-set/' },
  ];
  const result = await prepareRecoverySources({ ...description, year: '2023–24' }, signal(), { fetchImpl: async () => xml(rss(rows)) });
  assert.deepEqual(result.candidates.map(candidate => candidate.url), ['https://www.beckett.com/news/encountered-set/']);
});

test('generator obeys shared query/title bounds so a completed lookup cannot lose its receipt during persistence', async () => {
  const long = { ...description, manufacturer: 'M'.repeat(160), set_name: 'S'.repeat(160), card_type: null };
  const remaining = 400 - inventoryRecoverySourceDemand(long)!.query.length - 1;
  assert.equal(inventoryRecoverySourceDemand({ ...long, card_type: 'T'.repeat(remaining) })!.query.length, 400);
  assert.equal(inventoryRecoverySourceDemand({ ...long, card_type: 'T'.repeat(remaining + 1) }), null);
  const prefix = '2023-24 Donruss Optic ', exact = `${prefix}${'X'.repeat(240 - prefix.length)}`;
  const result = await prepareRecoverySources(description, signal(), { fetchImpl: async () => xml(rss([
    { title: `${exact}X`, url: 'https://www.topps.com/overlong' }, { title: exact, url: 'https://www.topps.com/exact' },
  ])) });
  assert.equal(result.candidates.length, 1); assert.equal(result.candidates[0].title.length, 240);
  assert.equal(StaffInventoryRecoverySourceDiscoverySchema.safeParse(result).success, true);
});

test('shared receipt schema rejects forged provider success, untrusted links, mismatched domains and contradictory outcomes', async () => {
  const receipt = await prepareRecoverySources(description, signal(), { fetchImpl: async () => xml(rss([
    { title: '2023-24 Donruss Optic checklist', url: 'https://www.topps.com/exact-checklist' },
  ])) });
  const bad = [
    { ...receipt, status: 'not_found' }, { ...receipt, candidates: [] },
    { ...receipt, requests: [receipt.requests[0], receipt.requests[0]] },
    { ...receipt, requests: receipt.requests.map(request => ({ ...request, response_sha256: null })) },
    { ...receipt, requests: receipt.requests.map(request => ({ ...request, status: 'failed' })) },
    { ...receipt, candidates: receipt.candidates.map(candidate => ({ ...candidate, domain: 'other.example' })) },
    { ...receipt, candidates: receipt.candidates.map(candidate => ({ ...candidate, url: 'https://evil.example/checklist', domain: 'evil.example' })) },
    { ...receipt, requests: [{ ...receipt.requests[0], provider: 'duckduckgo_html' }] },
  ];
  for (const value of bad) assert.equal(StaffInventoryRecoverySourceDiscoverySchema.safeParse(value).success, false);
});
