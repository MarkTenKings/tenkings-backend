import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createVariantCatalogService } from '../src/variant-catalog.mjs';
const now = () => Date.parse('2026-10-09T08:00:00.000Z');
const hash = value => createHash('sha256').update(value).digest('hex');
const identity = { category: 'POKEMON', name: 'Charizard', year: '1999', setName: 'Base', cardNumber: '004/102', language: 'en' };
const gallery = 'https://images.scrydex.com/pokemon/base1-4/large';
const exact = 'https://images.scrydex.com/pokemon/base1-4/first-edition/large';
const card = { id: 'base1-4', name: 'Charizard', number: '4', printed_number: '4/102', language_code: 'EN',
 expansion: { id: 'base1', name: 'Base', series: 'Base', printed_total: 102, release_date: '1999/01/09', is_online_only: false },
 images: [{ type: 'front', large: gallery }], variants: [
 { name: 'unlimitedHolofoil' }, { name: 'firstEditionShadowlessHolofoil', images: [{ type: 'front', large: exact }] }] };
function fixture() {
 const data = new Map(), calls = [], bytes = Buffer.from('synthetic-decoded-reference');
 const cache = { get: async key => structuredClone(data.get(key)), getRetained: async key => structuredClone(data.get(key)),
  put: async (key, value) => data.set(key, structuredClone(value)) };
 const body = JSON.stringify({ status: 'success', data: [card], page: 1, page_size: 7, total_count: 1 });
 const fetchImpl = async (url, options) => {
  calls.push(url); assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
  assert.ok(!url.includes('private-card') && !url.includes('physical-source'));
  if (url.startsWith('https://api.scrydex.com/')) return new Response(body, { headers: { 'content-type': 'application/json' } });
  assert.equal(url, exact); return new Response(bytes, { headers: { 'content-type': 'image/png' } });
 };
 const options = { cache, now, scrydex: { apiKey: 'test-only-key', teamId: 'test-only-team' }, fetchImpl,
  inspectProviderImage: async value => { assert.deepEqual(value, bytes); return { mimeType: 'image/png', width: 600, height: 825 }; } };
 return { data, calls, bytes, body, options };
}
test('direct Scrydex keeps all literal choices and exact source/photo bytes without catalog authority', async () => {
 const f = fixture(), service = createVariantCatalogService(f.options);
 const snapshot = await service.prepare({ identity, cardId: 'private-card', sourceHash: 'physical-source' });
 assert.equal(snapshot.candidates.length, 2); assert.equal(f.calls.length, 2);
 assert.ok(snapshot.candidates.every(c => c.authority === 'provider_candidate' && c.canonical === null));
 assert.deepEqual(snapshot.candidates.map(c => c.source.sha256), [hash(f.body), hash(f.body)]);
 assert.ok([...f.data.values()].some(value => value.body === f.body));
 const choice = snapshot.candidates.find(c => c.images.some(i => i.relationship === 'exact')), image = choice.images[0];
 assert.equal(image.sha256, hash(f.bytes));
 const restarted = createVariantCatalogService({ ...f.options, fetchImpl: () => assert.fail('retained references must not fetch') });
 assert.deepEqual((await restarted.readImage({ snapshot, candidateId: choice.candidateId, imageId: image.imageId })).bytes, f.bytes);
 const retained = await restarted.prepare({ identity, localOnly: true });
 assert.deepEqual(retained.candidates.map(c => [c.candidateId, c.label, c.source]), snapshot.candidates.map(c => [c.candidateId, c.label, c.source])); assert.equal(f.calls.length, 2);
 assert.deepEqual((await restarted.readImage({ snapshot, candidateId: choice.candidateId, imageId: image.imageId })).bytes, f.bytes);
 assert.equal(service.submitReference, undefined); assert.equal(service.submitObservation, undefined);
});
test('provider failures remain explicit without inventing a base printing or leaking details', async () => {
 const service = createVariantCatalogService({ providers: [{ prepare: async () => { throw Error('secret provider detail'); } }], now });
 const result = await service.prepare({ identity });
 assert.deepEqual(result.candidates, []); assert.ok(result.problems.includes('PROVIDER_UNAVAILABLE'));
 assert.ok(!result.problems.includes('CATALOG_UNAVAILABLE')); assert.ok(!JSON.stringify(result).includes('secret'));
});
test('incomplete identity and aborted work do not request provider evidence', async () => {
 let calls = 0; const service = createVariantCatalogService({ providers: [{ prepare: async () => { calls++; } }], now });
 const result = await service.prepare({ identity: { ...identity, year: null } });
 assert.equal(calls, 0); assert.ok(result.problems.includes('IDENTITY_INCOMPLETE'));
 const controller = new AbortController(); controller.abort();
 await assert.rejects(service.prepare({ identity }, { signal: controller.signal })); assert.equal(calls, 0);
});
test('provider preparation is bounded and changed retained bytes cannot be served', async () => {
 const timed = createVariantCatalogService({ providers: [{ prepare: async () => new Promise(() => {}) }], now, timeoutMs: 5 });
 await assert.rejects(timed.prepare({ identity }), /TIMEOUT/);
 const f = fixture(), snapshot = await createVariantCatalogService(f.options).prepare({ identity });
 const choice = snapshot.candidates.find(c => c.images.some(i => i.relationship === 'exact')), image = choice.images[0];
 const corrupted = createVariantCatalogService({ providers: [{ id: choice.source.provider, prepare: async () => ({ candidates: [], problems: [] }),
  readImage: async () => ({ bytes: Buffer.from('substitution'), sha256: image.sha256, mimeType: image.mimeType, width: image.width, height: image.height }) }], now });
 await assert.rejects(corrupted.readImage({ snapshot, candidateId: choice.candidateId, imageId: image.imageId }), /CHANGED/);
});
