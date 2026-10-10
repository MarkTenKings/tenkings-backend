import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { acquireSetCatalogDemand } from '../lib/server/setCatalogDemandSources';
import { catalogDemandKey, filterCatalogDemandResult } from '@tenkings/card-catalog-evidence';
import { parseCatalogDemandSourceFile } from '../lib/server/setOpsDiscovery';
const demand = { category: 'SPORTS' as const, year: '2024', manufacturer: 'Panini', setName: 'Prizm', language: null };
const url = 'https://www.paniniamerica.net/2024-prizm-checklist.csv';
const discover: any = async () => ({ candidates: [{ url }] });
const parse: any = () => ({ text: '2024 Panini Prizm checklist', truncated: false, rows: [
  { player: 'Example Player', cardNumber: '25', parallel: 'Silver Prizm', evidenceKind: 'literal_columns' },
  { player: 'Example Player', cardNumber: '25', parallel: 'Base Set', evidenceKind: 'literal_section' },
  { player: 'Example Player', cardNumber: '25', parallel: 'Big Kahuna', evidenceKind: 'literal_section' },
  { player: 'Other Player', cardNumber: '26', parallel: 'Gold Prizm /10', evidenceKind: 'literal_columns', language: 'en' },
], context: [{ program: 'Base Set', parallel: 'Gold Prizm', serial: '/10' }] });
const fetchImpl: typeof fetch = async input => { assert.equal(input, url); return new Response('actual source fixture bytes', { headers: { 'content-type': 'text/csv' } }); };
test('literal exact-card evidence is separate from program context, unknown language and inferred base', async () => {
  const acquired = await acquireSetCatalogDemand(demand, 1, { discover, parse, fetchImpl });
  assert.equal(acquired.result.choices.length, 2); assert.equal(acquired.result.context.length, 1);
  const selected = filterCatalogDemandResult(acquired.result, { name: 'Example Player', cardNumber: '025' });
  assert.equal(selected.choices.length, 1); assert.equal(selected.choices[0].identity.language, null);
  assert.equal(selected.choices[0].parallel, 'Silver Prizm'); assert.equal(acquired.requests, 1);
  assert.equal(acquired.result.sources[0].sha256, createHash('sha256').update(acquired.artifacts[0].bytes).digest('hex'));
  assert.equal(acquired.result.coverage, 'partial'); assert.ok(acquired.result.problems.includes('REFERENCE_IMAGES_NOT_ACQUIRED'));
});
test('wrong-product document, malformed redirects and oversized source cannot become choices', async () => {
  const wrong = await acquireSetCatalogDemand(demand, 1, { discover: async () => ({ candidates: [{ url: 'https://www.paniniamerica.net/checklist.csv' }] }) as any,
    parse: (() => ({ text: '2023 Other product', rows: [], context: [], truncated: false })) as any, fetchImpl: async () => new Response('wrong', { headers: { 'content-type': 'text/csv' } }) });
  assert.equal(wrong.result.state, 'UNAVAILABLE'); assert.equal(wrong.artifacts.length, 0);
  for (const response of [new Response('redirect', { status: 302 }), new Response('too big', { headers: { 'content-type': 'text/csv', 'content-length': '2097153' } }), new Response('html', { headers: { 'content-type': 'image/png' } })]) {
    const r = await acquireSetCatalogDemand(demand, 1, { discover, parse, fetchImpl: async () => response }); assert.equal(r.result.choices.length, 0); assert.equal(r.result.state, 'UNAVAILABLE');
  }
});
test('Topps index follows only actual product PDF anchors with exact source bytes, not fabricated links', async () => {
  const source = 'https://cdn.shopify.com/s/files/1/0662/9749/5709/files/2024_Chrome_Checklist.pdf'; const requests: string[] = [];
  const r = await acquireSetCatalogDemand({ ...demand, manufacturer: 'Topps', setName: 'Chrome' }, 1, {
    discover: async () => assert.fail('No search needed after exact manufacturer source'),
    fetchImpl: async input => { requests.push(String(input)); return input === 'https://www.topps.com/pages/checklists'
      ? new Response(`<a href="${source}?v=123">2024 Topps Chrome Checklist</a><a href="https://private.test/key">Other</a>`, { headers: { 'content-type': 'text/html' } })
      : new Response('exact pdf fixture', { headers: { 'content-type': 'application/pdf' } }); },
    parse: (() => ({ text: '2024 Topps Chrome', rows: [], context: [{ parallel: 'Gold Refractor', serial: '/50' }], truncated: false })) as any,
  });
  assert.deepEqual(requests, ['https://www.topps.com/pages/checklists', source]); assert.equal(r.result.state, 'READY'); assert.equal(r.result.sources[0].url, source);
});
test('cancelled acquisitions cannot dispatch and a stalled GET respects the parent abort', async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  await acquireSetCatalogDemand(demand, 1, { discover, parse, signal: controller.signal, fetchImpl: async () => { calls++; throw Error(); } }); assert.equal(calls, 0);
  const next = new AbortController(); const pending = acquireSetCatalogDemand(demand, 1, { discover, parse, signal: next.signal, fetchImpl: async () => new Promise(() => {}) });
  setTimeout(() => next.abort(), 10); const result = await pending; assert.equal(result.result.state, 'UNAVAILABLE');
});

test('a refused sixth request preserves five actual-dispatch count and previously acquired source evidence', async () => {
  let calls = 0;
  const result = await acquireSetCatalogDemand(demand, 1, { parse,
    discover: (async (_description: unknown, _signal: AbortSignal, dependencies: any) => {
      for (let i = 0; i < 4; i++) await dependencies.fetchImpl('https://www.bing.com/search?format=rss&q=fixture');
      return { candidates: [{ url }, { url: 'https://www.paniniamerica.net/2024-prizm-other.csv' }] };
    }) as any,
    fetchImpl: async () => { calls++; return new Response('fixture source bytes', { headers: { 'content-type': 'text/csv' } }); },
  });
  assert.equal(calls, 5); assert.equal(result.requests, 5); assert.equal(result.result.sources.length, 1);
  assert.equal(result.result.state, 'READY'); assert.equal(result.artifacts.length, 1); assert.ok(result.result.problems.includes('SOURCE_ACQUISITION_UNAVAILABLE'));
});

// Synthetic source bytes for the actual saved composite product. These URLs
// and checklist rows are controlled fixtures, not claimed live provider data.
const drakeProduct = { ...demand, year: '2025', setName: 'Donruss Optic Football — Donruss Threads' };
const parentUrl = 'https://www.paniniamerica.net/2025-donruss-optic-football-checklist.html';
function parentDocument(product = '2025 Panini Donruss Optic Football', programHeader = 'Program') {
  return `<html><body><article><h1>${product} Checklist</h1><p>${'Product checklist information. '.repeat(70)}</p>
    <table><thead><tr><th>${programHeader}</th><th>Card Number</th><th>Player</th><th>Parallel</th></tr></thead><tbody>
    <tr><td>Donruss Threads</td><td>DT-DM</td><td>Drake Maye</td><td>Silver Prizm</td></tr>
    <tr><td>Rookie Threads</td><td>DT-DM</td><td>Drake Maye</td><td>Gold Prizm /10</td></tr>
    <tr><td></td><td>DT-DM</td><td>Drake Maye</td><td>Green Prizm</td></tr>
    <tr><td>Donruss Threads</td><td>DT-DM</td><td>Other Player</td><td>Red Prizm</td></tr>
    <tr><td>Donruss Threads</td><td>DT-OTHER</td><td>Drake Maye</td><td>Orange Prizm</td></tr>
    </tbody></table></article></body></html>`;
}
test('actual composite Drake product discovers the parent, then real parsed rows require the exact insert and card', async () => {
  for (const setName of [drakeProduct.setName, 'Donruss Optic — Donruss Threads']) {
    const original = { ...drakeProduct, setName }, key = catalogDemandKey(original), requests: string[] = [];
    const source = parentDocument();
    assert.ok(!parseCatalogDemandSourceFile({ fileName: 'checklist.html', fileBuffer: Buffer.from(source), contentType: 'text/html' }).text.slice(0, 1500).includes('Threads'));
    const result = await acquireSetCatalogDemand(original, 1, { fetchImpl: async input => {
      const target = new URL(String(input)); requests.push(target.href);
      if (target.hostname === 'www.bing.com') {
        assert.equal(target.searchParams.get('q'), `2025 panini ${setName.split(' — ')[0].toLowerCase()} trading cards checklist`);
        return new Response(`<rss><channel><item><title>2025 Panini Donruss Elite Football Checklist</title><link>https://www.paniniamerica.net/2025-donruss-elite-football.html</link></item>
          <item><title>2024 Panini Donruss Optic Football Checklist</title><link>https://www.paniniamerica.net/2024-donruss-optic-football.html</link></item>
          <item><title>2025 Panini Donruss Optic Football Checklist</title><link>${parentUrl}</link></item></channel></rss>`, { headers: { 'content-type': 'text/xml' } });
      }
      if (target.hostname === 'html.duckduckgo.com') return new Response('<html><body><div class="no-results">No results</div></body></html>', { headers: { 'content-type': 'text/html' } });
      assert.equal(target.href, parentUrl, 'wrong-product and wrong-year search hits must never be fetched');
      return new Response(source, { headers: { 'content-type': 'text/html' } });
    } });
    assert.equal(result.result.state, 'READY'); assert.equal(result.requests, 3); assert.equal(requests.length, 3);
    assert.deepEqual(result.result.demand, original); assert.equal(result.result.demandKey, key);
    assert.equal(result.result.choices.length, 3, 'wrong or missing insert cannot borrow the parent product identity');
    const selected = filterCatalogDemandResult(result.result, { name: 'Drake Maye', cardNumber: 'DT-DM' });
    assert.equal(selected.choices.length, 1); assert.equal(selected.choices[0].parallel, 'Silver Prizm');
    assert.equal(selected.choices[0].identity.setName, original.setName); assert.equal(selected.choices[0].identity.language, null);
    assert.ok(selected.problems.includes('UNREVIEWED_SOURCE_CANDIDATES')); assert.ok(selected.problems.includes('REFERENCE_IMAGES_NOT_ACQUIRED'));
  }
});
test('parent document mismatch still rejects all insert evidence through the real document parser', async () => {
  for (const product of ['2024 Panini Donruss Optic Football', '2025 Panini Donruss Elite Football', '2025 Panini Donruss Optic Basketball']) {
    const result = await acquireSetCatalogDemand(drakeProduct, 1, { discover: async () => ({ candidates: [{ url: parentUrl }] }) as any,
      fetchImpl: async () => new Response(parentDocument(product), { headers: { 'content-type': 'text/html' } }) });
    assert.equal(result.result.state, 'UNAVAILABLE'); assert.equal(result.result.choices.length, 0); assert.equal(result.artifacts.length, 0);
    assert.ok(result.result.problems.includes('SOURCE_PRODUCT_UNRESOLVED'));
  }
});
test('insert matching supports the existing literal Card Type field and keeps program context separate', async () => {
  const result = await acquireSetCatalogDemand(drakeProduct, 1, { discover: async () => ({ candidates: [{ url: parentUrl }] }) as any,
    fetchImpl: async () => new Response(parentDocument(undefined, 'Card Type'), { headers: { 'content-type': 'text/html' } }) });
  assert.equal(filterCatalogDemandResult(result.result, { name: 'Drake Maye', cardNumber: 'DT-DM' }).choices.length, 1);
  const contextual = await acquireSetCatalogDemand(drakeProduct, 1, { discover, fetchImpl,
    parse: (() => ({ text: '2025 Panini Donruss Optic Football', rows: [
      { player: 'Drake Maye', cardNumber: 'DT-DM', program: 'Donruss Threads', cardType: 'Rookie Threads', parallel: 'Gold Prizm', evidenceKind: 'literal_columns' },
    ], truncated: false, context: [
      { program: 'Donruss Threads', parallel: 'Gold Prizm', serial: '/10' },
      { program: 'Rookie Threads', parallel: 'Gold Prizm', serial: '/10' },
      { program: null, parallel: 'Gold Prizm', serial: '/10' },
    ] })) as any });
  assert.deepEqual(contextual.result.context.map(row => row.program), ['Donruss Threads']); assert.equal(contextual.result.choices.length, 0);
});
test('Pokémon and ambiguous sports labels are not silently split into invented parent products', async () => {
  for (const original of [{ ...demand, category: 'POKEMON' as const, manufacturer: null, setName: 'HS — Triumphant' },
    { ...drakeProduct, setName: 'Donruss Optic — Donruss Threads — Gold' }, { ...drakeProduct, setName: 'Donruss-Optic' }]) {
    await acquireSetCatalogDemand(original, 1, { discover: (async (description: { set_name: string | null }) => {
      assert.equal(description.set_name, original.setName); return { candidates: [], status: 'not_found', requests: [] };
    }) as any, fetchImpl: async () => assert.fail('No candidate means no source fetch') });
  }
});
test('saved problem codes distinguish completed no-match discovery, provider failure and source-policy rejection', async () => {
  const missing = await acquireSetCatalogDemand(drakeProduct, 1, { fetchImpl: async input => String(input).includes('bing.com')
    ? new Response('<rss><channel></channel></rss>', { headers: { 'content-type': 'text/xml' } })
    : new Response('<html><body><div class="no-results">No results</div></body></html>', { headers: { 'content-type': 'text/html' } }) });
  assert.ok(missing.result.problems.includes('SOURCE_DISCOVERY_NOT_FOUND')); assert.ok(!missing.result.problems.includes('SOURCE_DISCOVERY_UNAVAILABLE'));
  const unavailable = await acquireSetCatalogDemand(drakeProduct, 1, { fetchImpl: async () => new Response('unavailable', { status: 503 }) });
  assert.ok(unavailable.result.problems.includes('SOURCE_DISCOVERY_UNAVAILABLE'));
  assert.ok(unavailable.result.problems.includes('SOURCE_DISCOVERY_BING_RSS_FAILED'));
  assert.ok(unavailable.result.problems.includes('SOURCE_DISCOVERY_DUCKDUCKGO_HTML_FAILED'));
  const rejected = await acquireSetCatalogDemand(drakeProduct, 1, { discover: async () => ({ candidates: [{ url: 'https://private.example/checklist' }], status: 'candidates', requests: [] }) as any,
    fetchImpl: async () => assert.fail('Rejected discovery URL must not be fetched') });
  assert.ok(rejected.result.problems.includes('SOURCE_DISCOVERY_POLICY_REJECTED'));
});
