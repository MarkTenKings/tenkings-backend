import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createScrydexMetadataReader, createScrydexVariantProvider, createVariantProviderImageReader,
  importScrydexVariantCandidates, scrydexVariantSearchUrl, isVariantPhotoComparable,
  validateVariantCandidate, variantCandidateId } from '../src/index.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const now = () => Date.parse('2026-10-09T08:00:00.000Z');
const target = { category: 'POKEMON', name: 'Charizard', year: '1999', setName: 'Base', cardNumber: '004/102', language: null };
const gallery = 'https://images.scrydex.com/pokemon/base1-4/large';
const firstEdition = 'https://images.scrydex.com/pokemon/base1-4/first-edition/large';
// The metadata is based on the official card schema. This conditional gallery
// is synthetic; no test implies that the live provider has this particular scan.
const card = { id: 'base1-4', name: 'Charizard', number: '4', printed_number: '4/102', language_code: 'EN',
  expansion: { id: 'base1', name: 'Base', series: 'Base', printed_total: 102, release_date: '1999/01/09', is_online_only: false },
  images: [{ type: 'front', large: gallery }], variants: [
    { name: 'unlimitedHolofoil' }, { name: 'firstEditionShadowlessHolofoil', images: [{ type: 'front', large: firstEdition }] },
  ] };
const response = () => ({ status: 'success', data: [structuredClone(card)], page: 1, page_size: 7, total_count: 1 });
const source = () => ({ url: scrydexVariantSearchUrl(target), sha256: hash(JSON.stringify(response())), capturedAt: new Date(now()).toISOString() });
const credentials = { apiKey: 'private-test-api-key-do-not-log', teamId: 'private-test-team-id-do-not-log' };
function cacheFixture() {
  const data = new Map(), writes = [];
  return { data, writes, get: async key => structuredClone(data.get(key)), getRetained: async key => structuredClone(data.get(key)), put: async (key, value) => { data.set(key, structuredClone(value)); writes.push([key, structuredClone(value)]); } };
}
const bytes = Buffer.from('decoder-verified-synthetic-front-reference');
const inspectImage = async value => { assert.deepEqual(value, bytes); return { mimeType: 'image/png', width: 600, height: 825 }; };

test('conditional variant gallery is distinct from generic card artwork and never acquires canonical authority', () => {
  const choices = importScrydexVariantCandidates({ identity: target, card, source: source() });
  assert.equal(choices.length, 2);
  const first = choices.find(c => c.label.startsWith('1st')), unlimited = choices.find(c => c.label.startsWith('unlimited'));
  assert.equal(first.images[0].relationship, 'exact'); assert.equal(first.images[0].sha256, null);
  assert.equal(isVariantPhotoComparable(first, first.images[0]), false, 'URL alone is insufficient');
  assert.equal(unlimited.images[0].relationship, 'card_art_only'); assert.equal(first.applicability, 'unknown');
  assert.equal(first.canonical, null); assert.ok(first.warnings.includes('LANGUAGE_UNCONFIRMED'));
  const shared = structuredClone(card); shared.variants[0].images = shared.variants[1].images;
  assert.ok(importScrydexVariantCandidates({ identity: target, card: shared, source: source() }).every(c => c.images[0].relationship === 'card_art_only'));
  const duplicatedGeneric = structuredClone(card); duplicatedGeneric.variants[1].images[0].large = gallery;
  assert.ok(importScrydexVariantCandidates({ identity: target, card: duplicatedGeneric, source: source() }).every(c => c.images[0].relationship === 'card_art_only'));
});

test('Scrydex does not substitute online cards, wrong language, denominator, year or set; missing finish stays unknown', () => {
  for (const change of [c => { c.expansion.is_online_only = true; }, c => { c.language_code = 'JA'; },
    c => { c.printed_number = '4/105'; }, c => { c.expansion.release_date = '2024/01/01'; }, c => { c.expansion.name = 'Base Set 2'; }, c => { c.name = 'Charizard V'; }]) {
    const altered = structuredClone(card); change(altered);
    assert.deepEqual(importScrydexVariantCandidates({ identity: { ...target, language: 'en' }, card: altered, source: source() }), []);
  }
  const unknown = structuredClone(card); unknown.variants = [{ name: 'normal' }];
  assert.equal(importScrydexVariantCandidates({ identity: target, card: unknown, source: source() })[0].parallel, null);
  assert.deepEqual(importScrydexVariantCandidates({ identity: { ...target, category: 'SPORTS' }, card, source: source() }), []);
});

test('configured provider acquires and pins exact bytes, reuses durable source after restart, and rereads without paid metadata GET', async () => {
  const cache = cacheFixture(); let metadataCalls = 0, imageCalls = 0;
  const fetchImpl = async (url, options) => {
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    if (url.startsWith('https://api.scrydex.com/')) {
      metadataCalls++; assert.equal(options.headers['X-Api-Key'], credentials.apiKey);
      assert.ok(!url.includes('include=') && !url.includes('private-card'));
      return new Response(JSON.stringify(response()), { headers: { 'content-type': 'application/json' } });
    }
    imageCalls++; assert.equal(url, firstEdition); assert.ok(!options.headers['X-Api-Key']);
    return new Response(bytes, { headers: { 'content-type': 'image/png' } });
  };
  const make = () => createScrydexVariantProvider({ reader: createScrydexMetadataReader({ ...credentials, cache, fetchImpl, now }),
    imageReader: createVariantProviderImageReader({ cache, fetchImpl, inspectImage, now }) });
  const prepared = await make().prepare({ ...target, cardId: 'private-card' });
  assert.equal(prepared.truncated, false); assert.equal(metadataCalls, 1); assert.equal(imageCalls, 1);
  const choice = prepared.candidates.find(c => c.label.startsWith('1st')), image = choice.images[0];
  assert.equal(isVariantPhotoComparable(choice, image), true); assert.equal(image.sha256, hash(bytes));
  assert.equal(choice.authority, 'provider_candidate'); assert.equal(choice.applicability, 'unknown');
  assert.deepEqual((await make().readImage({ candidate: choice, image })).bytes, bytes);
  await make().prepare(target); assert.equal(metadataCalls, 1); assert.equal(imageCalls, 1);
  const expiredCache = { ...cache, get: async () => null, put: async () => { throw new Error('browser wrote cache'); } };
  const readonly = createScrydexVariantProvider({ reader: createScrydexMetadataReader({ ...credentials, cache: expiredCache, now,
    fetchImpl: async () => { throw new Error('browser metadata fetch'); } }), imageReader: createVariantProviderImageReader({ cache: expiredCache,
      now: () => now() + 2 * 86400000, inspectImage: async () => { throw new Error('browser decoded'); }, fetchImpl: async () => { throw new Error('browser image fetch'); } }) });
  assert.deepEqual((await readonly.readImage({ candidate: choice, image })).bytes, bytes, 'saved references survive refresh TTL with readonly exact bytes');
  const intents = cache.writes.filter(([key]) => key.startsWith('variant-scrydex-request:')); assert.equal(intents.length, 1);
  assert.equal(intents[0][1].requests, 1); assert.ok(!JSON.stringify(cache.writes).includes(credentials.apiKey));
  assert.ok(!JSON.stringify(cache.writes).includes(credentials.teamId));
  const forged = structuredClone(choice); forged.images[0].url = gallery;
  await assert.rejects(make().readImage({ candidate: forged, image: forged.images[0] }), /CHANGED/);
});

test('paid metadata GET requires explicit configuration, a durable audit, one request budget and strict origin', async () => {
  assert.throws(() => createScrydexMetadataReader({ cache: cacheFixture() }), /NOT_CONFIGURED/);
  const cache = cacheFixture(); let calls = 0;
  const reader = createScrydexMetadataReader({ ...credentials, cache, now, fetchImpl: async () => { calls++; throw new Error('network'); } });
  await assert.rejects(reader.json('https://evil.invalid/pokemon/v1/cards', { budget: { remaining: 1 } }), /URL/);
  await assert.rejects(reader.json(scrydexVariantSearchUrl(target), { budget: { remaining: 0 } }), /BUDGET/);
  assert.equal(calls, 0);
  await assert.rejects(reader.json(scrydexVariantSearchUrl(target), { budget: { remaining: 1 } }), /network/);
  assert.equal(calls, 1, 'transport does not retry an idempotent credit-consuming request');
  assert.equal(cache.writes.filter(([key]) => key.includes('request:')).length, 1);
  const refused = createScrydexMetadataReader({ ...credentials, cache: { get: async () => null, getRetained: async () => null, put: async () => { throw new Error('audit unavailable'); } }, fetchImpl: async () => { calls++; } });
  await assert.rejects(refused.json(scrydexVariantSearchUrl(target), { budget: { remaining: 1 } }), /audit unavailable/); assert.equal(calls, 1);
});

test('provider image acquisition rejects redirects, wrong MIME, oversized images and changed hash; counterfeit TCGdex exact rejected', async () => {
  const cache = cacheFixture();
  const large = createVariantProviderImageReader({ cache, inspectImage, now, fetchImpl: async () => new Response('', { headers: { 'content-length': String(5 * 1024 * 1024) } }) });
  await assert.rejects(large.read(firstEdition), /TOO_LARGE/);
  const mime = createVariantProviderImageReader({ cache, inspectImage, now, fetchImpl: async () => new Response(bytes, { headers: { 'content-type': 'image/jpeg' } }) });
  await assert.rejects(mime.read(firstEdition), /INVALID/);
  const redirect = createVariantProviderImageReader({ cache, inspectImage, now, fetchImpl: async () => ({ ok: true, redirected: true }) });
  await assert.rejects(redirect.read(firstEdition), /UNAVAILABLE/);
  await assert.rejects(redirect.read('https://127.0.0.1/image'), /URL/);
  const correct = createVariantProviderImageReader({ cache, inspectImage, now, fetchImpl: async () => new Response(bytes, { headers: { 'content-type': 'image/png' } }) });
  await assert.rejects(correct.read(firstEdition, { expectedSha256: 'a'.repeat(64) }), /CHANGED/);
  const c = structuredClone(importScrydexVariantCandidates({ identity: target, card, source: source() })[1]);
  c.source.provider = 'tcgdex'; c.images[0].provenance.provider = 'tcgdex'; c.images[0].url = 'https://assets.tcgdex.net/en/base/base1/4/high.webp'; c.candidateId = variantCandidateId(c);
  assert.throws(() => validateVariantCandidate(c)); assert.equal(isVariantPhotoComparable(c, c.images[0]), false);
});

test('Scrydex image failure cannot trigger model comparison or fallback to generic art as exact', async () => {
  const saved = { data: response(), source: source() }, provider = createScrydexVariantProvider({ reader: { json: async () => saved, retained: async () => saved },
    imageReader: { read: async () => { throw new Error('reference unavailable'); } } });
  const prepared = await provider.prepare(target);
  assert.ok(prepared.candidates.every(c => c.images.every(i => !isVariantPhotoComparable(c, i))));
  assert.ok(prepared.candidates.some(c => c.warnings.includes('REFERENCE_IMAGE_MISSING')));
});

test('retained live list envelope preserves five Pikachu printings and the sole distinct Snowflake gallery', async () => {
  const { readFile } = await import('node:fs/promises');
  const saved = JSON.parse(await readFile(new URL('./fixtures/scrydex-20261010-pikachu.json', import.meta.url), 'utf8'));
  assert.equal(hash(saved.body), saved.sha256, 'fixture retains the exact public response bytes');
  const envelope = JSON.parse(saved.body); assert.equal(envelope.status, undefined);
  const record = { data: envelope, source: { url: saved.url, sha256: saved.sha256 } };
  const provider = createScrydexVariantProvider({ reader: { json: async () => record, retained: async () => record } });
  const actual = { category: 'POKEMON', name: 'Pikachu', year: '2023', setName: '151', cardNumber: '025/165', language: 'en' };
  const result = await provider.prepare(actual);
  assert.equal(result.candidates.length, 5); assert.equal(result.truncated, false);
  assert.deepEqual(result.candidates.map(c => c.label), ['Normal', 'Reverse Holofoil', 'Cosmos Holofoil', 'Pokémon Together Stamp', 'Snowflake Stamp']);
  assert.deepEqual(result.candidates.map(c => c.parallel), [null, 'Reverse Holofoil', 'Cosmos Holofoil', 'Pokémon Together Stamp', 'Snowflake Stamp']);
  assert.deepEqual(result.candidates.map(c => c.source.recordId), ['normal', 'reverseHolofoil', 'cosmosHolofoil', 'pokemonTogetherStamp', 'snowflakeStamp'].map(name => `sv3pt5-25:variant:${name}`));
  assert.ok(result.candidates.every(c => c.candidateId === variantCandidateId(c)), 'display labels preserve deterministic validated candidate identities');
  assert.equal(result.candidates.filter(c => c.images[0].relationship === 'exact').length, 1);
  const snowflake = result.candidates.at(-1); assert.equal(snowflake.images[0].url, 'https://images.scrydex.com/pokemon/sv3pt5-25ss/large');
  assert.match(snowflake.diagnostics[1].description, /Holiday Calendar 2025/);
  assert.ok(result.candidates.every(c => c.canonical === null && c.applicability === 'unknown'));
  assert.ok(result.candidates.every(c => c.images.every(i => !isVariantPhotoComparable(c, i))), 'metadata URL is not acquired photo proof');
  for (const mutation of [e => { e.status = 'error'; }, e => { e.count++; }, e => { e.page = 2; }]) {
    const bad = structuredClone(record); mutation(bad.data);
    await assert.rejects(createScrydexVariantProvider({ reader: { json: async () => bad, retained: async () => bad } }).prepare(actual), /SOURCE_INVALID/);
  }
});

test('retained Classic Charizard Magmar alias stays provider-scoped and cannot admit other decks or languages', async () => {
  const { readFile } = await import('node:fs/promises');
  const saved = JSON.parse(await readFile(new URL('./fixtures/scrydex-20261010-magmar.json', import.meta.url), 'utf8'));
  assert.equal(hash(saved.body), saved.sha256);
  const record = { data: JSON.parse(saved.body), source: { url: saved.url, sha256: saved.sha256 } };
  const provider = createScrydexVariantProvider({ reader: { json: async () => record, retained: async () => record } });
  const actual = { category: 'POKEMON', name: 'Magmar', year: '2023', setName: 'Classic Collection (Charizard)', cardNumber: '006/034', language: 'en' };
  const result = await provider.prepare(actual);
  assert.equal(result.candidates.length, 1); const choice = result.candidates[0];
  assert.equal(choice.identity.setName, 'Pokémon TCG Classic - Charizard'); assert.equal(choice.parallel, 'Holofoil');
  assert.equal(choice.images[0].relationship, 'card_art_only'); assert.ok(choice.warnings.includes('SET_NAME_REQUIRES_REVIEW'));
  for (const change of [{ setName: 'Classic Collection (Blastoise)' }, { year: '1999' }, { language: 'ja' }, { cardNumber: '006/102' }]) assert.equal((await provider.prepare({ ...actual, ...change })).candidates.length, 0);
});
