import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { acquireSetCatalogDemand } from '../lib/server/setCatalogDemandSources';
import { filterCatalogDemandResult } from '@tenkings/card-catalog-evidence';
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
