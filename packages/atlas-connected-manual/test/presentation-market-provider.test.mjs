import test from 'node:test';
import assert from 'node:assert/strict';
import { createSoldReferenceProvider } from '../src/presentation-market-provider.mjs';
test('ATLAS provider uses one no-cookie sold page with the dedicated server credential', async () => {
  let calls = 0;
  const provider = createSoldReferenceProvider({ apiKey: 'sc_fixture_only', fetchImpl: async (url, init) => {
    calls++; const params = new URL(url).searchParams;
    assert.equal(params.get('count'), '240'); assert.equal(params.get('page'), '1');
    assert.equal(init.redirect, 'error'); assert.equal(init.signal?.aborted, false);
    assert.deepEqual(Object.keys(init.headers), ['Authorization']);
    assert.equal(init.headers.Authorization, 'Bearer sc_fixture_only');
    return { ok: true, status: 200, text: async () => JSON.stringify({ keyword: params.get('keyword'), page: 1, totalItems: 0, items: [], hasNextPage: true }) };
  } });
  assert.equal(calls, 0);
  const result = await provider({ category: 'SPORTS', year: '2026', manufacturer: 'Fixture', productSet: 'Synthetic', playerName: 'Local Test' });
  assert.equal(calls, 1); assert.deepEqual(result.items, []); assert.equal(result.responsePolicy, 'ATLAS_SLAB_V1');
});

test('ATLAS redirect refusal stays unknown and never makes a second request', async () => {
  let calls = 0;
  const provider = createSoldReferenceProvider({ apiKey: 'sc_fixture_only', fetchImpl: async (_url, init) => {
    calls++; assert.equal(init.redirect, 'error'); assert.equal(init.signal?.aborted, false); throw new TypeError('fetch failed: redirect');
  } });
  await assert.rejects(provider({ category: 'SPORTS', year: '2026', manufacturer: 'Fixture', productSet: 'Synthetic', playerName: 'Local Test' }),
    error => error.code === 'SOLDCOMPS_NETWORK_ERROR' && error.retryable === false);
  assert.equal(calls, 1);
});


test('ATLAS one-page retrieval retains every row for image matching without legacy classification or application timeout', async () => {
  let calls = 0;
  const input = { category: 'POKEMON', matchingPolicy: 'ATLAS_IDENTITY_V1', cardName: 'Pikachu', year: '2023',
    productSet: '151', cardNumber: '025/165', parallel: 'English Cosmos Holofoil', queryOverride: '2023 Scarlet & Violet 151 Pikachu Cosmo Holo 25/165 grade 8.5' };
  const before = structuredClone(input);
  const provider = createSoldReferenceProvider({ apiKey: 'sc_fixture_only', fetchImpl: async (url) => {
    calls++; const params = new URL(url).searchParams;
    assert.equal(params.get('keyword'), input.queryOverride); assert.equal(params.get('count'), '240'); assert.equal(params.get('page'), '1');
    const items = Array.from({ length: 240 }, (_, index) => ({ itemId: String(123456780000 + index),
      url: `https://www.ebay.com/itm/${123456780000 + index}`, title: '2023 Pokemon 151 Pikachu 25/165 English Cosmos Holo PSA 10',
      soldPrice: '40.00', soldCurrency: 'USD', bestOfferAccepted: false, endedAt: '2026-09-21' }));
    return { ok: true, status: 200, text: async () => JSON.stringify({ keyword: params.get('keyword'), page: 1, totalItems: items.length, items, hasNextPage: true }) };
  } });
  const result = await provider(input);
  assert.equal(calls, 1); assert.deepEqual(input, before); assert.equal(result.query, input.queryOverride);
  assert.equal(result.acquisitionDiagnostics.retainedItemCount, 240); assert.equal(result.items.length, 240);
  assert.equal(Object.hasOwn(result, 'candidates'), false); assert.equal(Object.hasOwn(result.items[0], 'parallelMatch'), false);
});
