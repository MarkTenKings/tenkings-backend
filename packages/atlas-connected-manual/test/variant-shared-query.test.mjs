import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { importScrydexVariantCandidates, scrydexVariantSearchUrl } from '@tenkings/card-catalog-evidence';
import { createVariantCatalogService } from '../src/variant-catalog.mjs';
import {
  createVariantListingProvider,
  prepareVariantListingRequest as prepare,
  projectVariantListingSource as project,
  VARIANT_LISTING_REVISION,
  VARIANT_LISTING_LEGACY_REVISION,
} from '../src/variant-listing-provider.mjs';

const capturedAt = '2026-10-19T10:00:00.000Z';
const now = () => Date.parse(capturedAt);
const sha = value => createHash('sha256').update(value).digest('hex');
const generation = '681c9a6b-1385-4e4a-9239-2da0ab5d8da4';
const identity = {
  category: 'POKEMON', name: 'Mewtwo', year: '2016', setName: 'Evolutions',
  cardNumber: '051/108', manufacturer: null, language: null,
};
const sports = {
  category: 'SPORTS', name: 'Drake Maye', year: '2025',
  setName: 'Donruss Optic Football — Donruss Threads', cardNumber: 'DT-DM',
  manufacturer: 'Panini', language: null,
};

function choices({ language = 'en', names = ['holofoil', 'reverseHolofoil', 'cosmosHolofoil'] } = {}) {
  return importScrydexVariantCandidates({
    identity,
    card: {
      id: `xy12-51-${language}`, name: 'Mewtwo', number: '51', printed_number: '51/108',
      language_code: language,
      expansion: { id: 'xy12', name: 'Evolutions', release_date: '2016/11/02', is_online_only: false, printed_total: 108 },
      images: [], variants: names.map(name => ({ name, images: [] })),
    },
    source: { url: scrydexVariantSearchUrl(identity), sha256: sha(`metadata-${language}`), capturedAt },
  });
}

function response(request) {
  const bodyText = JSON.stringify({ keyword: request.query, page: 1, totalItems: 0, hasNextPage: false, items: [] });
  return {
    schemaVersion: 'variant-listing-response/v1', requestKey: request.requestKey, url: request.url,
    httpStatus: 200, contentType: 'application/json', bodyText, sha256: sha(bodyText), capturedAt,
  };
}

function legacyRequest(candidate, refreshGeneration = null) {
  return prepare({ ...identity, cardNumber: candidate.identity.cardNumber },
    { name: candidate.label, language: candidate.identity.language },
    { revision: VARIANT_LISTING_LEGACY_REVISION, generation: refreshGeneration });
}

// Synthetic durable transport journal. Every permitted dispatch calls the real
// listing provider with an injected fetch; no test uses a live service or DB.
function fixture(candidates = choices()) {
  const records = new Map(), cacheEntries = new Map(), probes = [], acquisitions = [], fetches = [];
  const cache = {
    get: async key => structuredClone(cacheEntries.get(key)),
    getRetained: async key => structuredClone(cacheEntries.get(key)),
    put: async (key, value) => cacheEntries.set(key, structuredClone(value)),
  };
  const listingProvider = createVariantListingProvider({
    apiKey: 'synthetic-shared-query-credential', cache, now,
    fetchImpl: async (url, options) => {
      fetches.push(url);
      assert.equal(options.method, 'GET');
      const body = { keyword: new URL(url).searchParams.get('keyword'), page: 1, totalItems: 0, hasNextPage: false, items: [] };
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    },
  });
  const service = () => createVariantCatalogService({
    now, listingProvider, cache,
    providers: [{ prepare: async () => ({ candidates: structuredClone(candidates), problems: [], truncated: false }) }],
  });
  const executeListingSource = async (request, dispatch, { retainedOnly = false } = {}) => {
    (retainedOnly ? probes : acquisitions).push(structuredClone(request));
    const saved = records.get(request.requestKey);
    if (saved) {
      assert.deepEqual(request, saved.request, 'reusing a journal must preserve its exact request');
      return saved.source ? { state: 'REUSED', source: structuredClone(saved.source) } : { state: 'UNKNOWN' };
    }
    if (retainedOnly) return { state: 'MISSING' };
    const source = await dispatch();
    records.set(request.requestKey, { request: structuredClone(request), source: structuredClone(source) });
    return { state: 'SAVED', source };
  };
  return {
    records, probes, acquisitions, fetches, listingProvider,
    retain(request, state = 'REUSED') {
      records.set(request.requestKey, { request: structuredClone(request), source: state === 'UNKNOWN' ? null : response(request) });
    },
    prepare: async input => {
      const result = await service().prepare({ identity, ...input }, { executeListingSource });
      assert(!result.problems.includes('LISTING_SOURCE_UNAVAILABLE'), 'fixtures must finish source acquisition or retained projection successfully');
      return result;
    },
  };
}

test('v4 uses the complete saved Pokémon identity with no printing or language keyword', () => {
  assert.equal(VARIANT_LISTING_REVISION, 'variant-reference-photos-v4');
  const sylveon = { ...identity, name: 'Sylveon ex', year: '2024', setName: 'Scarlet & Violet—Surging Sparks', cardNumber: '#086/191' };
  const request = prepare(sylveon, { name: 'Holofoil', language: 'en' });
  assert.equal(request.query, 'Pokémon 2024 Scarlet & Violet Surging Sparks Sylveon ex #086/191');
  assert.deepEqual(request, prepare(sylveon, { name: 'Play Pokémon Stamp Holofoil', language: 'ja' }));
  assert.deepEqual(request, prepare(sylveon));
  assert.equal(Object.hasOwn(request, 'printing'), false);
  const japanese = prepare({ ...sylveon, language: 'ja' }, { name: 'Reverse Holofoil', language: 'ja' });
  assert.equal(japanese.identity.language, 'ja');
  assert.equal(japanese.query, request.query);
  const url = new URL(request.url);
  assert.equal(url.searchParams.get('keyword'), request.query);
  assert.equal(url.searchParams.get('count'), '240');
  assert.equal(url.searchParams.get('page'), '1');
  assert.equal(url.searchParams.get('sold'), 'true');
  assert.equal(url.searchParams.get('exactMatch'), 'true');
});

test('v4 Sports keeps the full product and insert wording, season and collector-number prefix', () => {
  const request = prepare(sports, { name: 'Gold Prizm', language: null });
  assert.equal(request.query, 'Panini 2025 Donruss Optic Football Donruss Threads Drake Maye #DT-DM');
  assert.equal(prepare({ ...sports, year: '2024-25', cardNumber: '#RC-007' }).query,
    'Panini 2024-25 Donruss Optic Football Donruss Threads Drake Maye #RC-007');
  assert.deepEqual(request, prepare(sports, { name: 'Base', language: null }));
  assert.doesNotMatch(request.query, /gold|prizm|graded|psa|english|japanese/i);
});

test('historical v3 request bytes, key and source remain readable without becoming dispatchable', async () => {
  assert.equal(VARIANT_LISTING_LEGACY_REVISION, 'variant-reference-photos-v3');
  // Captured from the pre-change HEAD builder, independently of the v4 code.
  const expected = {
    schemaVersion: 'variant-listing-request/v1', revision: 'variant-reference-photos-v3', parserRevision: 'photo-evidence-v3',
    identity: { ...identity, name: 'mewtwo', setName: 'evolutions' },
    printing: { name: 'reverse holofoil', language: 'ja' },
    query: 'mewtwo 051/108 reverse holo japanese',
    url: 'https://api.sold-comps.com/v1/scrape?keyword=mewtwo+051%2F108+reverse+holo+japanese&ebaySite=ebay.com&count=240&page=1&sold=true&includeCompleteListing=true&exactMatch=true&hydrateBoa=false',
    requestKey: 'variant-listing-source:v1:4ab45a602dd2bc9c91b5a2f036266e0fce52b9730e160acc5f4ca66913060eb9',
  };
  const request = prepare(identity, { name: 'Reverse Holofoil', language: 'Japanese' }, { revision: VARIANT_LISTING_LEGACY_REVISION });
  assert.deepEqual(request, expected);
  const saved = response(request), before = JSON.stringify({ request, saved });
  assert.equal(project(request, saved).query, expected.query);
  const f = fixture();
  const acquired = await f.listingProvider.acquireImages({ request, source: saved }, { retainedOnly: true });
  assert.deepEqual(acquired.referencePhotos, []);
  await assert.rejects(f.listingProvider.fetchSource(request), { code: 'VARIANT_LISTING_READ_ONLY' });
  assert.deepEqual(f.fetches, []);
  assert.equal(JSON.stringify({ request, saved }), before);
});

test('multiple printing and language choices buy one saved-number query and reuse it across visits', async () => {
  const candidates = [...choices(), ...choices({ language: 'ja', names: ['holofoil'] })], f = fixture(candidates);
  assert(candidates.every(candidate => candidate.identity.cardNumber === '51/108'));
  const first = await f.prepare();
  assert.equal(first.candidates.length, candidates.length);
  assert.equal(f.fetches.length, 1);
  assert.equal(f.acquisitions.length, 1);
  assert.equal(f.acquisitions[0].query, 'Pokémon 2016 Evolutions Mewtwo #051/108');
  assert.equal(Object.hasOwn(f.acquisitions[0], 'printing'), false);
  assert(f.probes.some(request => request.revision === VARIANT_LISTING_LEGACY_REVISION && request.query.includes('51/108')));
  assert(f.probes.filter(request => request.revision === VARIANT_LISTING_REVISION).every(request => request.query.endsWith('#051/108')));
  const before = JSON.stringify([...f.records]);
  const second = await f.prepare({ cardId: 'different-synthetic-card' });
  assert.deepEqual(second.candidates, first.candidates);
  assert.equal(f.fetches.length, 1, 'a new card or worker visit shares the retained ordinary response');
  assert.equal(f.acquisitions.length, 1);
  assert.equal(JSON.stringify([...f.records]), before);
});

test('saved empty v3 responses suppress ordinary replacement and preserve every historical byte', async () => {
  const candidates = choices(), f = fixture(candidates);
  for (const candidate of candidates) f.retain(legacyRequest(candidate));
  const before = JSON.stringify([...f.records]);
  const result = await f.prepare();
  assert.equal(result.candidates.length, candidates.length);
  assert(result.problems.includes('LISTING_NO_RESULTS'));
  assert.deepEqual(f.fetches, []);
  assert.deepEqual(f.acquisitions, []);
  assert.equal(JSON.stringify([...f.records]), before);
});

test('one saved legacy printing does not suppress the shared acquisition needed by other missing printings', async () => {
  const candidates = choices(), f = fixture(candidates), old = legacyRequest(candidates[0]);
  f.retain(old);
  const before = JSON.stringify(f.records.get(old.requestKey));
  await f.prepare();
  assert.equal(f.fetches.length, 1);
  assert.equal(f.acquisitions.length, 1);
  assert.equal(f.acquisitions[0].revision, VARIANT_LISTING_REVISION);
  assert.equal(JSON.stringify(f.records.get(old.requestKey)), before);
});

test('one unknown legacy printing blocks the entire ordinary shared request', async () => {
  const candidates = choices(), f = fixture(candidates);
  f.retain(legacyRequest(candidates[0]), 'UNKNOWN');
  f.retain(legacyRequest(candidates[1]));
  const before = JSON.stringify([...f.records]);
  const result = await f.prepare();
  assert(result.problems.includes('LISTING_SOURCE_OUTCOME_UNKNOWN'));
  assert.equal(result.candidates.length, candidates.length);
  assert.deepEqual(f.fetches, []);
  assert.deepEqual(f.acquisitions, []);
  assert.equal(JSON.stringify([...f.records]), before);
});

test('a fresh explicit refresh bypasses an ordinary unknown once and shares its generation across printings', async () => {
  const candidates = choices(), f = fixture(candidates), old = legacyRequest(candidates[0]);
  f.retain(old, 'UNKNOWN');
  const before = JSON.stringify(f.records.get(old.requestKey));
  const input = { generation, reuseJobKey: 'synthetic-prior-job' };
  await f.prepare(input);
  assert.equal(f.fetches.length, 1);
  assert.equal(f.acquisitions.length, 1);
  assert.equal(f.acquisitions[0].generation, generation);
  assert.equal(f.acquisitions[0].query, 'Pokémon 2016 Evolutions Mewtwo #051/108');
  await f.prepare(input);
  assert.equal(f.fetches.length, 1, 'retrying an explicit generation must reuse its one response');
  assert.equal(JSON.stringify(f.records.get(old.requestKey)), before);
});

test('saved v3 responses for an existing refresh generation are reused without buying v4 replacements', async () => {
  const candidates = choices(), f = fixture(candidates);
  for (const candidate of candidates) f.retain(legacyRequest(candidate, generation));
  const before = JSON.stringify([...f.records]);
  await f.prepare({ generation, reuseJobKey: 'synthetic-prior-job' });
  assert.deepEqual(f.fetches, []);
  assert.deepEqual(f.acquisitions, []);
  assert.equal(JSON.stringify([...f.records]), before);
});

test('an unknown v3 request for the same refresh generation cannot be replaced with v4', async () => {
  const candidates = choices(), f = fixture(candidates);
  f.retain(legacyRequest(candidates[0], generation), 'UNKNOWN');
  const before = JSON.stringify([...f.records]);
  const result = await f.prepare({ generation, reuseJobKey: 'synthetic-prior-job' });
  assert(result.problems.includes('LISTING_SOURCE_OUTCOME_UNKNOWN'));
  assert.deepEqual(f.fetches, []);
  assert.deepEqual(f.acquisitions, []);
  assert.equal(JSON.stringify([...f.records]), before);
});

test('an initial job request ID and local-only recatalog never authorize a new refresh search', async () => {
  const candidates = choices(), f = fixture(candidates);
  await f.prepare({ generation, reuseJobKey: null });
  assert.equal(f.fetches.length, 1);
  assert.equal(Object.hasOwn(f.acquisitions[0], 'generation'), false);
  const local = fixture(candidates);
  await local.prepare({ localOnly: true, generation, reuseJobKey: 'synthetic-prior-job' });
  assert.deepEqual(local.fetches, []);
  assert.deepEqual(local.acquisitions, []);
});

test('zero catalog candidates keep the existing no-fallback behavior for Sports and Pokémon', async () => {
  for (const inputIdentity of [identity, sports]) {
    const f = fixture([]), result = await f.prepare({ identity: inputIdentity });
    assert.deepEqual(result.candidates, []);
    assert(result.problems.includes('NO_VARIANTS_FOUND'));
    assert.deepEqual(f.probes, []);
    assert.deepEqual(f.acquisitions, []);
    assert.deepEqual(f.fetches, []);
  }
});
