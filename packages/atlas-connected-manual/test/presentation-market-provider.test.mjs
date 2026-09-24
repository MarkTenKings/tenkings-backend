import test from 'node:test';
import assert from 'node:assert/strict';
import { createSoldReferenceProvider } from '../src/presentation-market-provider.mjs';
test('ATLAS provider uses one no-cookie sold page with the dedicated server credential', async () => {
  let calls = 0;
  const provider = createSoldReferenceProvider({ apiKey: 'sc_fixture_only', fetchImpl: async (url, init) => {
    calls++; const params = new URL(url).searchParams;
    assert.equal(params.get('count'), '40'); assert.equal(params.get('page'), '1');
    assert.equal(init.redirect, 'error');
    assert.deepEqual(Object.keys(init.headers), ['Authorization']);
    assert.equal(init.headers.Authorization, 'Bearer sc_fixture_only');
    return { ok: true, status: 200, text: async () => JSON.stringify({ keyword: params.get('keyword'), page: 1, totalItems: 0, items: [], hasNextPage: true }) };
  } });
  assert.equal(calls, 0);
  const result = await provider({ category: 'SPORTS', year: '2026', manufacturer: 'Fixture', productSet: 'Synthetic', playerName: 'Local Test' });
  assert.equal(calls, 1); assert.deepEqual(result.candidates, []); assert.equal(result.hasMore, false);
});

test('ATLAS redirect refusal stays unknown and never makes a second request', async () => {
  let calls = 0;
  const provider = createSoldReferenceProvider({ apiKey: 'sc_fixture_only', fetchImpl: async (_url, init) => {
    calls++; assert.equal(init.redirect, 'error'); throw new TypeError('fetch failed: redirect');
  } });
  await assert.rejects(provider({ category: 'SPORTS', year: '2026', manufacturer: 'Fixture', productSet: 'Synthetic', playerName: 'Local Test' }),
    error => error.code === 'SOLDCOMPS_NETWORK_ERROR' && error.retryable === false);
  assert.equal(calls, 1);
});
