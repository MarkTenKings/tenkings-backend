import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublishedCatalogReader, variantChoicesFromPublishedLookup, normalizeVariantIdentity, variantDemandKey,
  compareVariantCardNumber, createVariantReviewSnapshot, validateVariantReviewSnapshot, validateVariantCandidate,
  variantSelectionParallel, importTcgdexVariantCandidates, createTcgdexVariantProvider, createVariantSourceReader,
  variantSourceCacheKey, VARIANT_SOURCE_LIMITS } from '../src/index.mjs';
import { fixture, hostFixture, queryFor, sha, copy } from './fixtures.mjs';

const identity = { category: 'POKEMON', name: 'Magikarp', year: '2020', setName: 'Rebel Clash', cardNumber: '039/192', manufacturer: null, language: null };
const now = '2026-10-09T08:00:00.000Z';
// Minimal metadata fields observed from public TCGdex 2026-10-09. These fixtures
// preserve provider assertions, not verified physical finish or image rights.
const card = { id: 'swsh2-39', name: 'Magikarp', localId: '39', image: 'https://assets.tcgdex.net/en/swsh/swsh2/39',
  set: { id: 'swsh2', name: 'Rebel Clash', cardCount: { official: 192, total: 209 } }, variants: { normal: true, reverse: true, holo: false, firstEdition: false } };
const set = { id: 'swsh2', name: 'Rebel Clash', releaseDate: '2020-05-01', serie: { id: 'swsh', name: 'Sword & Shield' } };
const source = (url, value) => ({ url, sha256: sha(JSON.stringify(value)), capturedAt: now });
const imported = (overrides = {}) => importTcgdexVariantCandidates({ identity, language: 'en', card, set,
  cardSource: source('https://api.tcgdex.net/v2/en/cards/swsh2-39', card), setSource: source('https://api.tcgdex.net/v2/en/sets/swsh2', set), ...overrides });

test('public demand ignores private context but preserves exact language, number and set distinctions', () => {
  assert.equal(variantDemandKey({ ...identity, cardId: 'private-a', sourceHash: sha('a') }), variantDemandKey({ ...identity, cardId: 'private-b' }));
  assert.notEqual(variantDemandKey(identity), variantDemandKey({ ...identity, language: 'fr' }));
  assert.notEqual(variantDemandKey(identity), variantDemandKey({ ...identity, cardNumber: '039/193' }));
  assert.equal(normalizeVariantIdentity({ ...identity, language: 'French' }).language, 'fr');
  assert.equal(compareVariantCardNumber('039/192', '39/192'), 'match');
  assert.equal(compareVariantCardNumber('RC01/RC25', 'RC1/RC25'), 'match');
  assert.equal(compareVariantCardNumber('RC1/RC25', '1/25'), 'conflict');
  assert.equal(compareVariantCardNumber('RC1/RC25', 'RC1'), 'unknown');
});

for (const category of ['POKEMON', 'SPORTS']) test(`${category}: reviewed choices retain canonical IDs and actual representative scope`, async () => {
  const manifest = fixture(category), host = hostFixture(manifest);
  const result = await createPublishedCatalogReader({ loadAuthorizedPublication: async () => host.loaded }).lookup({ publication: host.pin, query: queryFor(manifest) });
  const [c] = variantChoicesFromPublishedLookup(result);
  assert.equal(c.authority, 'reviewed_catalog'); assert.equal(c.canonical.printingId, manifest.printings[0].printingId);
  assert.equal(c.images[0].relationship, 'representative'); assert.equal(c.images[0].url, null);
  assert.equal(c.images[0].sha256, manifest.images[0].sha256); assert.equal(c.applicability, 'supported');
  assert.match(variantSelectionParallel(c), category === 'SPORTS' ? /^English / : /^French /);
  const unscoped = await createPublishedCatalogReader({ loadAuthorizedPublication: async () => host.loaded }).lookup({ publication: host.pin,
    query: { category, setId: manifest.set.setId, cardId: manifest.cards[0].cardId } });
  const choices = variantChoicesFromPublishedLookup(unscoped);
  assert.equal(choices.length, 1, 'explicitly excluded printing is not offered');
  assert.equal(choices[0].applicability, 'unknown'); assert.deepEqual(choices[0].images, []);
});

test('real Rebel Clash assertions are unreviewed; shared artwork cannot prove either foil finish', () => {
  const choices = imported(); assert.deepEqual(choices.map(c => c.parallel), ['Non-Holo', 'Reverse Holo']);
  for (const c of choices) {
    assert.equal(c.canonical, null); assert.equal(c.applicability, 'unknown'); assert.equal(c.identity.language, 'en');
    assert.equal(c.images[0].relationship, 'card_art_only'); assert.equal(c.images[0].sha256, null); assert.deepEqual(c.images[0].visibleDiagnosticIds, []);
    assert.ok(c.warnings.includes('LANGUAGE_UNCONFIRMED')); assert.match(variantSelectionParallel(c), /^English /);
  }
  const forged = copy(choices[0]); forged.images[0].relationship = 'exact'; assert.throws(() => validateVariantCandidate(forged));
  const wrongRights = copy(choices[0]); wrongRights.images[0].provenance.usage = 'reviewed_catalog'; assert.throws(() => validateVariantCandidate(wrongRights));
});

test('actual Snivy RC1 normal flag does not invent Non-Holo or silently replace the RC denominator', () => {
  const rcCard = { ...card, id: 'bw11-RC1', name: 'Snivy', localId: 'RC1', image: 'https://assets.tcgdex.net/en/bw/bw11/RC1',
    set: { id: 'bw11', name: 'Legendary Treasures', cardCount: { official: 113 } }, variants: { normal: true, reverse: false, holo: false, firstEdition: false } };
  const [c] = imported({ identity: { ...identity, name: 'Snivy', year: '2013', setName: 'Legendary Treasures – Radiant Collection', cardNumber: 'RC1/RC25' }, card: rcCard,
    set: { id: 'bw11', name: 'Legendary Treasures', releaseDate: '2013-11-06' },
    cardSource: source('https://api.tcgdex.net/v2/en/cards/bw11-RC1', rcCard), setSource: source('https://api.tcgdex.net/v2/en/sets/bw11', { id: 'bw11' }) });
  assert.equal(c.parallel, null); assert.equal(c.identity.cardNumber, 'RC1');
  assert.ok(c.warnings.includes('DENOMINATOR_UNVERIFIED')); assert.ok(c.warnings.includes('FINISH_UNVERIFIED'));
  assert.ok(c.warnings.includes('SET_NAME_REQUIRES_REVIEW')); assert.throws(() => variantSelectionParallel(c));
});

test('provider conflicts, hostile image paths, edition cross-products and absent images stay explicit', () => {
  for (const change of [{ year: '2021' }, { setName: 'Stormfront' }, { cardNumber: '39/193' }, { name: 'Gyarados' }]) assert.deepEqual(imported({ identity: { ...identity, ...change } }), []);
  const choices = imported({ card: { ...card, image: 'https://attacker.example/front', variants: { normal: true, firstEdition: true, holo: false, reverse: false } } });
  assert.equal(choices.length, 1); assert.deepEqual(choices[0].images, []); assert.equal(choices[0].parallel, 'Non-Holo');
  assert.ok(choices[0].warnings.includes('REFERENCE_IMAGE_MISSING'));
});

test('snapshot hashes evidence independently from observation time; duplicate conflicts and inflation are rejected', () => {
  const [a, b] = imported();
  const s = createVariantReviewSnapshot({ identity, candidates: [b, a, a], capturedAt: now });
  assert.equal(s.candidates.length, 2); assert.equal(s.coverage.images, 'unknown'); assert.ok(s.problems.includes('NO_DIAGNOSTIC_PHOTOS'));
  const later = createVariantReviewSnapshot({ identity, candidates: [a, b], capturedAt: '2026-10-10T08:00:00.000Z' }); assert.equal(s.snapshotHash, later.snapshotHash);
  const tampered = copy(s); tampered.candidates[0].label = 'Different finish'; assert.throws(() => validateVariantReviewSnapshot(tampered));
  assert.throws(() => createVariantReviewSnapshot({ identity, candidates: [a, { ...a, label: 'Different finish' }], capturedAt: now }));
});

test('source cache reuses exact bytes across process instances, versions refreshes, and rejects corrupted contents', async () => {
  const saved = new Map(), history = [], cache = { get: async k => saved.get(k), put: async (k, v) => { history.push(v); saved.set(k, v); } };
  let at = Date.parse(now), calls = 0;
  const options = { cache, now: () => at, fetchImpl: async () => { calls++; return Response.json({ id: `data-${calls}` }); } };
  const url = 'https://api.tcgdex.net/v2/en/cards/swsh2-39';
  const first = await createVariantSourceReader(options).json(url);
  const restarted = await createVariantSourceReader(options).json(url); assert.deepEqual(first, restarted); assert.equal(calls, 1);
  at += VARIANT_SOURCE_LIMITS.ttlMs + 1;
  const refreshed = await createVariantSourceReader(options).json(url); assert.equal(calls, 2); assert.notEqual(first.source.sha256, refreshed.source.sha256); assert.equal(history.length, 2);
  saved.get(variantSourceCacheKey(url)).body = '{"id":"tampered"}';
  await assert.rejects(createVariantSourceReader(options).json(url), /CACHE_INVALID/); assert.equal(calls, 2);
});

test('public source reader refuses SSRF, redirect, oversized bodies and hung fetches without credential use', async () => {
  let calls = 0;
  const reader = createVariantSourceReader({ fetchImpl: async () => { calls++; return Response.json({}); } });
  await assert.rejects(reader.json('http://127.0.0.1/private')); assert.equal(calls, 0);
  await assert.rejects(reader.json('https://api.tcgdex.net/v2/en/cards/../secrets')); assert.equal(calls, 0);
  const redirected = createVariantSourceReader({ fetchImpl: async () => ({ ok: true, redirected: true }) });
  await assert.rejects(redirected.json('https://api.tcgdex.net/v2/en/cards/swsh2-39'), /UNAVAILABLE/);
  const large = createVariantSourceReader({ fetchImpl: async () => new Response('a', { headers: { 'content-type': 'application/json', 'content-length': String(VARIANT_SOURCE_LIMITS.responseBytes + 1) } }) });
  await assert.rejects(large.json('https://api.tcgdex.net/v2/en/cards/swsh2-39'), /TOO_LARGE/);
  const hung = createVariantSourceReader({ timeoutMs: 10, fetchImpl: async () => new Promise(() => {}) });
  await assert.rejects(hung.json('https://api.tcgdex.net/v2/en/cards/swsh2-39'), /TIMEOUT/);
});

test('source requests deduplicate in flight and one cancelled consumer cannot abort another public lookup', async () => {
  let calls = 0, finish;
  const reader = createVariantSourceReader({ fetchImpl: async () => { calls++; await new Promise(resolve => { finish = resolve; }); return Response.json({ id: 'same' }); } });
  const controller = new AbortController(), url = 'https://api.tcgdex.net/v2/en/cards/swsh2-39';
  const first = reader.json(url, { signal: controller.signal }), second = reader.json(url);
  controller.abort(); await assert.rejects(first); finish(); const result = await second;
  assert.equal(result.data.id, 'same'); assert.equal(calls, 1);
});

test('bounded provider path sends only public descriptors and verifies card plus set before returning choices', async () => {
  const calls = [];
  const reader = createVariantSourceReader({ fetchImpl: async (url, init) => {
    calls.push({ url, init });
    if (url.includes('?')) return Response.json([{ id: card.id, localId: card.localId, name: card.name }]);
    return Response.json(url.includes('/sets/') ? set : card);
  }, now: () => Date.parse(now) });
  const provider = createTcgdexVariantProvider({ reader });
  const result = await provider.prepare({ ...identity, cardId: 'private-card', photo: 'secret-photo' });
  assert.equal(result.candidates.length, 2); assert.equal(calls.length, 3);
  assert.ok(calls.every(c => c.init.method === 'GET' && c.init.body === undefined && !c.init.headers.Authorization && !c.url.includes('private') && !c.url.includes('secret')));
  assert.deepEqual((await provider.prepare({ ...identity, category: 'SPORTS' })).candidates, []); assert.equal(calls.length, 3);
});
