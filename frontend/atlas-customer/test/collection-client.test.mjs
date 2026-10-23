import test from 'node:test';
import assert from 'node:assert/strict';
import { collectionPagePath, readCollectionPage } from '../lib/collection-client.mjs';
import { parseOwnerCollectionPage } from '../lib/collection-contract.mjs';
import { createCollectionPreviewFixture } from './collection-preview-fixture.mjs';
const fixture = () => createCollectionPreviewFixture();
const reply = (body, options = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store, max-age=0' }, ...options });

test('collection client sends bounded same-origin GET only with caller cancellation', async () => {
  const f = fixture(), calls = [], controller = new AbortController();
  const result = await readCollectionPage({ accountId: f.accountId, signal: controller.signal }, async (...args) => { calls.push(args); return reply(f.snapshot); });
  assert.equal(result.accountId, f.accountId); assert.equal(calls.length, 1);
  const [path, options] = calls[0]; assert.equal(path, '/account/api/customer/collection?limit=25');
  assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'same-origin'); assert.equal(options.cache, 'no-store');
  assert.equal(options.redirect, 'error'); assert.equal(options.body, undefined); assert.equal(options.headers, undefined);
});

test('empty, unavailable and access-ended responses are distinct', async () => {
  const f = fixture(); f.snapshot.cards = [];
  assert.deepEqual((await readCollectionPage({ accountId: f.accountId }, async () => reply(f.snapshot))).cards, []);
  for (const status of [401, 403, 404, 500, 503]) await assert.rejects(readCollectionPage({ accountId: f.accountId }, async () => reply({ error: 'private internals' }, { status })),
    { code: [401, 403].includes(status) ? 'COLLECTION_ACCESS_ENDED' : 'COLLECTION_UNAVAILABLE' });
});

test('client refuses malformed, cacheable, oversized and foreign-account successes', async () => {
  const f = fixture();
  for (const get of [() => reply(f.snapshot, { headers: { 'content-type': 'application/json', 'cache-control': 'public,max-age=100' } }),
    () => reply(f.snapshot, { headers: { 'content-type': 'text/html', 'cache-control': 'private,no-store' } }),
    () => reply({ extra: 'x'.repeat(262145) }), () => new Response('{bad', { headers: { 'content-type': 'application/json', 'cache-control': 'private,no-store' } })]) {
    await assert.rejects(readCollectionPage({ accountId: f.accountId }, async () => get()), { code: 'COLLECTION_UNAVAILABLE' });
  }
});

test('abort before dispatch and after a noncompliant fetch resolves cannot reveal data', async () => {
  const f = fixture(), stopped = new AbortController(); stopped.abort();
  await assert.rejects(readCollectionPage({ accountId: f.accountId, signal: stopped.signal }, () => assert.fail('dispatch')), { code: 'COLLECTION_CANCELLED' });
  const controller = new AbortController(); let resolve, seen;
  const pending = readCollectionPage({ accountId: f.accountId, signal: controller.signal }, (_, opts) => { seen = opts.signal; return new Promise(r => { resolve = r; }); });
  controller.abort(); assert.equal(seen.aborted, true); resolve(reply(f.snapshot));
  await assert.rejects(pending, { code: 'COLLECTION_CANCELLED' });
});

test('strict keyset boundary rejects impossible pages and never invents totals', () => {
  const f = fixture(), card = f.snapshot.cards[0], page = { ...f.snapshot, cards: [card], nextCardId: card.cardId };
  assert.equal(parseOwnerCollectionPage(page, f.accountId, { limit: 1 }).nextCardId, card.cardId);
  assert.equal(parseOwnerCollectionPage(page, f.accountId, { limit: 1 }).total, undefined);
  for (const changed of [{ ...page, cards: [] }, { ...page, nextCardId: f.snapshot.cards[1].cardId }, { ...page, cards: [card, card] }])
    assert.throws(() => parseOwnerCollectionPage(changed, f.accountId, { limit: 1 }));
  assert.throws(() => parseOwnerCollectionPage(page, f.accountId, { afterCardId: card.cardId, limit: 1 }));
  for (const input of [{ limit: 51 }, { limit: '25' }, { afterCardId: '../card' }]) assert.throws(() => collectionPagePath(input));
});


test('foreign account or owner replies end shared access while malformed projections remain unavailable', async () => {
  const f=fixture();
  for(const mutate of [v=>v.accountId=f.snapshot.cards[0].cardId, v=>v.preferences.accountId=f.snapshot.cards[0].cardId,
    v=>v.cards[0].ownership.ownerAccountId=f.snapshot.cards[0].cardId]){
    const value=structuredClone(f.snapshot);mutate(value);
    await assert.rejects(readCollectionPage({accountId:f.accountId},async()=>reply(value)),{code:'COLLECTION_ACCESS_ENDED'});
  }
  const invalid=structuredClone(f.snapshot);invalid.cards[0].approvedCard.report.publicHash='invalid';
  await assert.rejects(readCollectionPage({accountId:f.accountId},async()=>reply(invalid)),{code:'COLLECTION_UNAVAILABLE'});
});
