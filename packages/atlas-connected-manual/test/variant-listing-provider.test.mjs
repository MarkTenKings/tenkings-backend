import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { createVariantCatalogService } from '../src/variant-catalog.mjs';
import { codexChoices, codexLibraryKey, codexReadingKey, projectCodexReading, variantCodexChoice } from '../src/variant-codex.mjs';
import { VARIANT_LABEL_POLICY, VARIANT_PHOTO_MODEL } from '../src/variant-photo-provider.mjs';
import { labelCatalog } from './variant-label-fixture.mjs';
import { variantIdentity } from './variant-fixture.mjs';
import { prepareVariantListingRequest as prepare, projectVariantListingSource as project,
  createVariantListingProvider as provider, composeVariantListingCandidates as compose, prepareRetainedVariantListingRequest, VARIANT_LISTING_LIMITS as limits } from '../src/variant-listing-provider.mjs';
import { importScrydexVariantCandidates, validateVariantCandidate, createVariantReviewSnapshot,
  canonicalJson, isVariantPhotoComparable, scrydexVariantSearchUrl, createManufacturerChecklistVariantProvider } from '@tenkings/card-catalog-evidence';

const sha = v => createHash('sha256').update(v).digest('hex');
const capturedAt = '2026-10-10T10:00:00.000Z', now = () => Date.parse(capturedAt);
const identity = { category: 'POKEMON', name: 'Mewtwo', year: '2016', setName: 'Evolutions',
  cardNumber: '051/108', manufacturer: null, language: null };
const sports = { category: 'SPORTS', name: 'Drake Maye', year: '2025', setName: 'Donruss Optic Football — Donruss Threads',
  cardNumber: 'DT-DM', manufacturer: 'Panini', language: null };
const imageUrl = n => `https://i.ebayimg.com/images/g/fixture${n}/s-l300.jpg`;
const item = (n, title = '2016 Pokemon Evolutions Mewtwo #51/108 Reverse Holo', more = {}) => ({
  itemId: String(123456780000 + n), title, url: `https://www.ebay.com/itm/${123456780000 + n}?nordt=true`,
  thumbnailUrl: imageUrl(n), listingType: 'sold', condition: 'Ungraded', endedAt: '2026-10-09',
  soldPrice: '99.95', soldCurrency: 'USD', bestOfferAccepted: false, ...more });
function source(request, items, more = {}) {
  const bodyText = JSON.stringify({ keyword: request.query, page: 1, totalItems: items.length, hasNextPage: false, items, ...more });
  return { schemaVersion: 'variant-listing-response/v1', requestKey: request.requestKey, url: request.url,
    httpStatus: 200, contentType: 'application/json', bodyText, sha256: sha(bodyText), capturedAt };
}
function cacheFixture() {
  const entries = new Map(); let puts = 0;
  return { entries, get puts() { return puts; }, get: async key => entries.get(key), getRetained: async key => entries.get(key),
    put: async (key, value) => { puts++; entries.set(key, structuredClone(value)); } };
}
const png = () => sharp({ create: { width: 12, height: 16, channels: 3, background: '#125cab' } }).png().toBuffer();
const noNetwork = () => { throw Error('NETWORK_FORBIDDEN'); };
const scrydexChoices = () => importScrydexVariantCandidates({ identity, card: { id: 'xy12-51', name: 'Mewtwo',
  number: '51', printed_number: '51/108', language_code: 'en', expansion: { id: 'xy12', name: 'Evolutions',
    release_date: '2016/11/02', is_online_only: false, printed_total: 108 },
  images: [{ type: 'front', large: 'https://images.scrydex.com/pokemon/xy12-51/large' }],
  variants: ['normal', 'holofoil', 'reverseHolofoil', 'cosmosHolofoil', 'snowflakeStamp'].map(name => ({ name, images: [] })) },
  source: { url: scrydexVariantSearchUrl(identity), sha256: sha('scrydex'), capturedAt } });

test('historical bootstrap reads only saved bytes and settled labels before a new printing, without fetching or expanding OCR', async () => {
  const cache = cacheFixture(), original = labelCatalog({ photos: 0 }), choice = variantCodexChoice(original.candidates[0]);
  const request = prepareRetainedVariantListingRequest(variantIdentity, { name: 'Base', language: null });
  const saved = source(request, [1, 2, 3, 4].map(n => item(n))), bytes = await png();
  let imageFetches = 0, decodes = 0;
  const initial = provider({ cache, now, fetchImpl: async url => {
    imageFetches++; return new Response(Buffer.concat([bytes, Buffer.from(url)]), { headers: { 'content-type': 'image/png' } });
  } });
  const acquired = await initial.acquireImages({ request, source: saved }, { imageLimit: 3 });
  assert.equal(imageFetches, 3);
  const [matched, unmatched, unread] = acquired.referencePhotos;
  const reading = (image, candidateKey, labelText) => ({ schemaVersion: 'atlas-codex-reading/v1', policy: VARIANT_LABEL_POLICY,
    choices: codexChoices(original), reading: { sha256: image.sha256, candidateKey, gradingCompany: 'CGC', labelText, reason: 'Saved literal reading' } });
  const matchedReading = reading(matched, choice.key, 'Known Base');
  const unmatchedReading = reading(unmatched, null, '2020 POKEMON REBEL CLASH\nMAGIKARP\n#039/192\nCostco Exclusive');
  for (const record of [matchedReading, unmatchedReading]) cache.entries.set(codexReadingKey({ policy: VARIANT_LABEL_POLICY, model: VARIANT_PHOTO_MODEL }, record.reading.sha256), record);
  cache.entries.set(codexLibraryKey(choice), { schemaVersion: 'atlas-codex-library/v1', policy: VARIANT_LABEL_POLICY, choice,
    references: [{ image: matched, reading: matchedReading.reading, responseHash: sha('saved response'), requestKey: 'saved' }] });
  const expanded = labelCatalog({ count: 2, photos: 0, candidateTransform: (candidate, index) => {
    if (index) { candidate.label = candidate.parallel = 'Costco Exclusive'; candidate.canonical.printingId = `setops-printing:v1:${'0'.repeat(64)}`; }
  } });
  assert.equal(expanded.candidates[0].label, 'Costco Exclusive');
  const writesBefore = cache.puts, lookups = [];
  const restored = provider({ cache, now, fetchImpl: () => { imageFetches++; return noNetwork(); }, inspectImage: () => { decodes++; return noNetwork(); } });
  const service = createVariantCatalogService({ cache, now, providers: [{ prepare: async () => ({ candidates: expanded.candidates, problems: [], truncated: false }) }], listingProvider: restored });
  const snapshot = await service.prepare({ identity: variantIdentity }, { executeListingSource: async (current, _dispatch, { retainedOnly = false } = {}) => {
    assert(retainedOnly, 'All ordinary acquisitions must be avoided'); lookups.push(current.printing.name);
    return current.printing.name === 'base' ? { state: 'REUSED', request, source: saved } : { state: 'MISSING' };
  } });
  assert.deepEqual(lookups, ['costco exclusive', 'base']);
  assert.equal(imageFetches, 3, 'The fourth old raw URL is not fetched'); assert.equal(decodes, 0); assert.equal(cache.puts, writesBefore);
  assert.deepEqual(snapshot.referencePhotos.map(photo => photo.sha256).sort(), [matched.sha256, unmatched.sha256].sort());
  assert(!snapshot.referencePhotos.some(photo => photo.sha256 === unread.sha256), 'A saved but unread photo cannot enter the new OCR batch');
  assert.equal(projectCodexReading(unmatchedReading.reading, snapshot, unmatchedReading.choices).candidateId, expanded.candidates[0].candidateId);
  assert.equal(unmatchedReading.reading.candidateKey, null); assert(!snapshot.problems.includes('LISTING_SOURCE_UNAVAILABLE'));
});

test('explicit refresh proceeds when a historical source probe fails, while preserving the partial problem', async () => {
  const catalog = labelCatalog({ photos: 0 }), generation = '1c24bd7a-b4e6-4d79-97f0-b634d830a204', requests = [];
  const service = createVariantCatalogService({ providers: [{ prepare: async () => ({ candidates: catalog.candidates, problems: [], truncated: false }) }],
    listingProvider: { acquireImages: async (_input, { retainedOnly }) => { assert.equal(retainedOnly, false); return { referencePhotos: [] }; } } });
  const snapshot = await service.prepare({ identity: variantIdentity, generation }, { executeListingSource: async (request, _dispatch, { retainedOnly = false } = {}) => {
    if (retainedOnly) throw new Error('Corrupt historical journal'); requests.push(request);
    return { state: 'SAVED', source: { sha256: sha('new response') } };
  } });
  assert.equal(requests.length, 1); assert.equal(requests[0].generation, generation); assert(snapshot.problems.includes('LISTING_SOURCE_UNAVAILABLE'));
});

test('public identity request is deterministic, bounded, ungraded and preserves unknown language/finish', () => {
  const request = prepare(identity), url = new URL(request.url);
  assert.deepEqual(prepare({ ...identity }), request);
  assert.equal(request.identity.language, null); assert.equal(url.origin, 'https://api.sold-comps.com');
  assert.equal(url.searchParams.get('count'), '40'); assert.equal(url.searchParams.get('page'), '1');
  assert.equal(url.searchParams.get('sold'), 'true'); assert.equal(url.searchParams.get('hydrateBoa'), 'false');
  assert.doesNotMatch(request.query, /PSA|base|normal|english/i);
  assert.notEqual(prepare({ ...identity, cardNumber: '52/108' }).requestKey, request.requestKey);
  for (const extra of [{ cardId: 'private' }, { photos: [] }, { apiKey: 'secret' }, { queryOverride: 'wrong' }])
    assert.throws(() => prepare({ ...identity, ...extra }), /VARIANT_LISTING_IDENTITY/);
  assert.throws(() => prepare({ ...identity, cardNumber: null }), /INCOMPLETE/);
});

test('paid request canonicalization shares case, whitespace, language and safe collector aliases without merging distinct identities', () => {
  const original = prepare({ ...identity, language: 'English' });
  for (const cardNumber of ['#051/0108', '51/108', '00051/00108']) assert.deepEqual(prepare({ ...identity,
    name: ' MEWTWO ', setName: '  EVOLUTIONS  ', cardNumber, language: 'en' }), original);
  const rc = { ...identity, cardNumber: 'RC01/RC025' };
  assert.deepEqual(prepare(rc), prepare({ ...rc, cardNumber: '#rc1/rc25' }));
  for (const cardNumber of ['1/25', 'RC1/25', 'RC1', 'RC1/RC26']) assert.notEqual(prepare({ ...rc, cardNumber }).requestKey, prepare(rc).requestKey);
  for (const delta of [{ language: null }, { language: 'Japanese' }, { setName: 'Base Set' }, { year: '2017' }, { name: 'Mew' }])
    assert.notEqual(prepare({ ...identity, language: 'English', ...delta }).requestKey, original.requestKey);
  assert.equal(prepare(sports).requestKey, prepare({ ...sports, name: 'DRAKE MAYE', manufacturer: 'PANINI', cardNumber: '#dt-dm' }).requestKey);
});

test('conflicting language, ambiguous editions/finishes and imitation claims are excluded', () => {
  const request = prepare(identity), base = '2016 Evolutions Mewtwo #51/108';
  const result = project(request, source(request, ['English Japanese Holo', 'First Edition Unlimited Holo', 'Non Holo Reverse Holo',
    'Custom Reverse Holo', 'Replica Holo', 'Maybe Holo', 'Holo?'].map((claim, n) => item(n, `${base} ${claim}`))));
  assert.equal(result.listings.length, 0);
});

test('one metadata GET retains exact public source bytes and no bearer; failure body is retained without retry', async () => {
  const request = prepare(identity,null,{graded:true}), expected = source(request, [item(1)]), calls = [];
  const p = provider({ apiKey: 'test-secret-credential', now, fetchImpl: async (url, init) => {
    calls.push({ url, init }); return new Response(expected.bodyText, { status: 200, headers: { 'content-type': 'application/json' } });
  } });
  assert.deepEqual(await p.fetchSource(request), expected); assert.equal(calls.length, 1);
  assert.equal(calls[0].init.redirect, 'error'); assert.equal(calls[0].init.headers.Authorization, 'Bearer test-secret-credential');
  assert.ok(!JSON.stringify(expected).includes('test-secret-credential'));
  let failedCalls = 0;
  const unavailable = provider({ apiKey: 'test-secret-credential', now, fetchImpl: async () => {
    failedCalls++; return new Response('{"message":"quota"}', { status: 429, headers: { 'content-type': 'application/json' } });
  } });
  const retained = await unavailable.fetchSource(request); assert.equal(retained.httpStatus, 429);
  assert.throws(() => project(request, retained), /LIMITED/); assert.equal(failedCalls, 1);
});

test('Pokémon photos remain unreviewed listing claims; absent finish never becomes Normal; no prices escape', () => {
  const request = prepare(identity), rows = [item(1), item(2, '2016 Evolutions Mewtwo #051/108 Cracked Ice Holo English'),
    item(3, '2016 Evolutions Mewtwo #51/108 Staff Stamp'), item(4, '2016 Evolutions Mewtwo #51/108')];
  const saved = source(request, rows), before = JSON.stringify(saved), result = project(request, saved);
  assert.equal(result.listings.length, 4); assert.equal(result.authority, 'provider_candidate');
  assert.equal(result.requiresReview, true); assert.equal(result.coverage, 'partial');
  assert.equal(result.listings[0].listing.title, rows[0].title);
  assert.equal(result.listings[0].listing.url, 'https://www.ebay.com/itm/123456780001');
  assert.equal(result.listings[0].soldAt, '2026-10-09');
  assert.equal(result.listings[0].variantEvidence.status, 'UNKNOWN');
  assert.ok(result.listings[0].variantEvidence.observed.finish.includes('reverse holo'));
  assert.equal(result.listings[3].claimedParallel, null);
  assert.ok(result.listings.every(v => v.identityEvidence.physicalVariantConfirmed === false));
  assert.doesNotMatch(JSON.stringify(result), /soldPrice|sold_price|99\.95|USD|99\.95/);
  assert.equal(JSON.stringify(saved), before, 'retained response immutable');
});

test('explicit Pokémon language/number contradictions reject; missing denominator is honest and RC prefix remains meaningful', () => {
  const request = prepare({ ...identity, language: 'English' });
  const result = project(request, source(request, [item(1), item(2, '2016 Evolutions Mewtwo #51/108 Japanese'),
    item(3, '2016 Evolutions Mewtwo #51/109'), item(4, '2016 Evolutions Mewtwo #51')]));
  assert.deepEqual(result.listings.map(v => v.listing.id), ['123456780001', '123456780004']);
  assert.ok(result.listings[1].identityEvidence.reason_codes.includes('collector_denominator_missing'));
  const rc = prepare({ ...identity, name: 'Snivy', setName: 'Legendary Treasures Radiant Collection', year: '2013', cardNumber: 'RC1/RC25' });
  const rcResult = project(rc, source(rc, [item(1, '2013 Snivy Legendary Treasures Radiant Collection #RC01/RC025'),
    item(2, '2013 Snivy Legendary Treasures Radiant Collection #1/25')]));
  assert.equal(rcResult.listings.length, 1);
});

test('sports composite parent query retains insert and rejects wrong card, parent, year, player and generic selections', () => {
  const request = prepare(sports);
  assert.equal(request.identity.setName, sports.setName.toLowerCase()); assert.match(request.query, /donruss threads/i);
  const title = '2025 Panini Donruss Optic Drake Maye Donruss Threads #DT-DM Jersey';
  const result = project(request, source(request, [item(1, title),
    item(2, title.replace('Donruss Threads', 'Rookie Phenoms')), item(3, title.replace('Donruss Optic', 'Prizm')),
    item(4, title.replace('Drake Maye', 'Jayden Daniels')), item(5, title.replace('#DT-DM', '#DT-JD')),
    item(6, title.replace('2025', '2024')), item(7, '2025 Panini Donruss Optic Donruss Threads Choose Your Player'),
    item(8, `${title} Lot of 2 cards`)]));
  assert.deepEqual(result.listings.map(v => v.listing.id), ['123456780001']);
  assert.equal(result.listings[0].variantEvidence.observed.memorabilia, true);
  assert.equal(result.excluded.length, 7);
});

test('active/unknown sale, forged listing ID and conflicting duplicates cannot supply photos', () => {
  const request = prepare(identity), good = item(1);
  const result = project(request, source(request, [good, good, item(2), item(2, '2016 Evolutions Mewtwo #51/108 Base'),
    item(3, undefined, { listingType: 'active' }), item(4, undefined, { listingType: null }),
    item(5, undefined, { url: 'https://www.ebay.com/itm/999999999999' })]));
  assert.equal(result.listings.length, 1); assert.equal(result.excluded.length, 4);
  assert.ok(result.excluded.some(v => v.reason === 'CONFLICTING_LISTING_EVIDENCE'));
});

test('source/request tampering, mismatched query, malformed envelope and unsafe metadata fail closed', async () => {
  const request = prepare(identity), saved = source(request, []);
  for (const mutated of [{ ...saved, sha256: '0'.repeat(64) }, { ...saved, url: 'https://attacker.invalid/' },
    { ...saved, requestKey: 'other' }, { ...saved, contentType: 'text/html' }, { ...saved, extra: true },
    source(request, [], { keyword: 'other' }), source(request, [], { page: 2 }), source(request, [], { hasNextPage: 'false' }),
    source(request, Array.from({ length: 61 }, (_, n) => item(n)))]) assert.throws(() => project(request, mutated), /VARIANT_LISTING/);
  assert.throws(() => project({ ...request, query: 'other' }, saved), /REQUEST_CHANGED/);
  const p = provider({ apiKey: 'secret-test-key', fetchImpl: async () => new Response('secret-test-key', { headers: { 'content-type': 'application/json' } }) });
  await assert.rejects(p.fetchSource(prepare(identity,null,{graded:true})), /SOURCE_UNSAFE/);
});

test('observed 60-row provider overdelivery reuses the exact request and projects only the first40 with explicit truncation', () => {
  const request = prepare({ ...identity, cardNumber: '51/108' });
  assert.equal(request.requestKey, 'variant-listing-source:v1:5ae0815cc53bdd59dda0150d42fc62997e696ef6bf2a93df4a7f89c904fc82dc');
  assert.equal(new URL(request.url).searchParams.get('count'), '40');
  for (const count of [41, 60]) {
    const retained = source(request, Array.from({ length: count }, (_, n) => item(n)), { hasNextPage: false });
    const before = JSON.stringify(retained), result = project(request, retained);
    assert.equal(result.listings.length, 40); assert.equal(result.excluded.length, 0);
    assert.deepEqual(result.listings.map(row => row.listing.id), Array.from({ length: 40 }, (_, n) => item(n).itemId));
    assert.ok(result.warnings.includes('SOURCE_TRUNCATED')); assert.equal(JSON.stringify(retained), before);
  }
  const rows = Array.from({ length: 60 }, (_, n) => item(n)); rows[59] = item(0, '2016 Evolutions Mewtwo #51/108 Non Holo');
  const conflicting = project(request, source(request, rows));
  assert.equal(conflicting.listings.length, 39); assert.ok(conflicting.excluded.some(row => row.listingId === item(0).itemId && row.reason === 'CONFLICTING_LISTING_EVIDENCE'));
  assert.throws(() => project(request, source(request, Array.from({ length: 61 }, (_, n) => item(n)))), /SOURCE_SHAPE/);
});

test('explicit xN and Nx quantities reject multi-card photos without reinterpreting collector identifiers', () => {
  const request = prepare(identity), base = '2016 Pokemon Evolutions Mewtwo 51/108';
  for (const quantity of ['x2', '2x', 'x 2', '2 x', '×2', '2×', 'x10', '20x', '(x3)']) {
    const result = project(request, source(request, [item(1, `${base} & Mew 53/108 Holo English ${quantity}`)]));
    assert.equal(result.listings.length, 0, quantity);
  }
  for (const quantity of ['x1', '1x']) assert.equal(project(request, source(request, [item(1, `${base} Reverse Holo ${quantity}`)])).listings.length, 1);
  for (const cardNumber of ['X2/108', '2X/108']) {
    const numbered = prepare({ ...identity, cardNumber });
    assert.equal(project(numbered, source(numbered, [item(1, `2016 Pokemon Evolutions Mewtwo ${cardNumber} Reverse Holo`)])).listings.length, 1, cardNumber);
  }
});

test('actual image decode verifies bytes; repeated source URL fetched once with distinct listing attribution', async () => {
  const bytes = await png(), request = prepare(identity), cache = cacheFixture(), calls = [];
  const full = 'https://i.ebayimg.com/images/g/fixture1/s-l1600.jpg';
  const saved = source(request, [item(1, undefined, { fullResThumbnailUrl: full }), item(2, undefined, { fullResThumbnailUrl: full })]);
  const p = provider({ cache, now, fetchImpl: async url => { calls.push(url); return new Response(bytes, { headers: { 'content-type': 'image/png' } }); } });
  const result = await p.acquireImages({ request, source: saved });
  assert.deepEqual(calls, [full]); assert.deepEqual(result.acquisition, { requests: 1, images: 2, uniqueImages: 1, bytes: bytes.length });
  const images = result.listings.map(v => v.image);
  assert.ok(images.every(v => v.relationship === 'listing_photo' && v.width === 12 && v.height === 16 && v.sha256 === sha(bytes)));
  assert.notEqual(images[0].imageId, images[1].imageId); assert.equal(images[0].listing.title, item(1).title);
  assert.equal(images[0].sourceResponseSha256, saved.sha256);
  const again = await p.acquireImages({ request, source: saved }); assert.equal(again.acquisition.requests, 0);
  assert.equal(calls.length, 1);
});

test('retained serving survives TTL without credentials, network, writes or decode and rejects forged attribution', async () => {
  const bytes = await png(), request = prepare(identity), cache = cacheFixture();
  const acquired = await provider({ cache, now, fetchImpl: async () => new Response(bytes, { headers: { 'content-type': 'image/png' } }) })
    .acquireImages({ request, source: source(request, [item(1)]) });
  const image = acquired.listings[0].image, puts = cache.puts;
  const reader = provider({ cache, now: () => now() + 2 * limits.ttlMs, fetchImpl: noNetwork, inspectImage: noNetwork });
  assert.equal((await reader.readImage(image)).sha256, sha(bytes)); assert.equal(cache.puts, puts);
  for (const mutated of [{ ...image, sha256: '0'.repeat(64) }, { ...image, sourceResponseSha256: '0'.repeat(64) },
    { ...image, width: 99 }, { ...image, listing: { ...image.listing, title: 'forged' } }, { ...image, relationship: 'exact' }])
    await assert.rejects(reader.readImage(mutated), /VARIANT_LISTING/);
  await assert.rejects(reader.fetchSource(prepare(identity,null,{graded:true})), /CREDENTIAL_MISSING/);
  for (const [key, entry] of cache.entries) if (key.startsWith('variant-listing-image-evidence:')) entry.body = Buffer.from('changed').toString('base64');
  await assert.rejects(reader.readImage(image), /CACHE_INVALID/);
});

test('images use only provider URLs, can fall back to actual thumbnail and never expand a size suffix', async () => {
  const bytes = await png(), request = prepare(identity), cache = cacheFixture(), calls = [];
  const full = 'https://i.ebayimg.com/images/g/actual/s-l1200.jpg';
  const p = provider({ cache, now, fetchImpl: async url => {
    calls.push(url); return url === full ? new Response('unavailable', { status: 404 }) : new Response(bytes, { headers: { 'content-type': 'image/png' } });
  } });
  const result = await p.acquireImages({ request, source: source(request, [item(1, undefined, { fullResThumbnailUrl: full }),
    item(2, undefined, { thumbnailUrl: 'https://attacker.invalid/a.jpg' }),
    item(3, undefined, { thumbnailUrl: 'https://i.ebayimg.com/a.jpg?redirect=private' })]) });
  assert.deepEqual(calls, [full, imageUrl(1)]); assert.equal(result.listings[0].image.url, imageUrl(1));
  assert.equal(result.listings[1].image, null); assert.equal(result.listings[2].image, null);
});

test('bad MIME, failed decode, redirects and oversized images are excluded without a retry storm', async () => {
  const bytes = await png(), request = prepare(identity);
  for (const make of [() => new Response(bytes, { headers: { 'content-type': 'image/jpeg' } }),
    () => new Response('<html>not a photo</html>', { headers: { 'content-type': 'image/png' } }),
    () => new Response(bytes, { headers: { 'content-type': 'image/png', 'content-length': String(limits.imageBytes + 1) } }),
    () => ({ ok: true, redirected: true })]) {
    let calls = 0; const result = await provider({ cache: cacheFixture(), now, fetchImpl: async () => { calls++; return make(); } })
      .acquireImages({ request, source: source(request, [item(1)]) });
    assert.equal(result.listings[0].image, null); assert.equal(calls, 1);
  }
});

test('image network budget is eight requests, including failed full-resolution attempts', async () => {
  const request = prepare(identity), calls = [];
  const rows = Array.from({ length: 12 }, (_, n) => item(n, undefined, { fullResThumbnailUrl: `https://i.ebayimg.com/images/g/full${n}/s-l1600.jpg` }));
  const result = await provider({ cache: cacheFixture(), now, fetchImpl: async url => { calls.push(url); return new Response('missing', { status: 404 }); } })
    .acquireImages({ request, source: source(request, rows) });
  assert.equal(calls.length, 8); assert.equal(result.acquisition.requests, 8); assert.equal(result.acquisition.images, 0);
});

test('worker cancellation ends stalled source body without another paid request', async () => {
  const request = prepare(identity,null,{graded:true}); let calls = 0, cancelled = 0;
  const p = provider({ apiKey: 'test-secret-key', timeoutMs: 20, fetchImpl: async () => {
    calls++; return new Response(new ReadableStream({ cancel() { cancelled++; } }), { headers: { 'content-type': 'application/json' } });
  } });
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(new Error('worker cancelled')),20);
  try { await assert.rejects(p.fetchSource(request,{signal:controller.signal})); } finally { clearTimeout(timer); }
  assert.equal(calls, 1); assert.equal(cancelled, 1);
});

test('named requests share a durable public printing key and reject language conflicts or injected fields',()=>{
 const a=prepare(identity,{name:'Reverse Holofoil',language:'English'});
 assert.deepEqual(a,prepare({...identity,cardNumber:'#051/0108'},{name:' reverse holofoil ',language:'en'}));
 assert.match(a.query,/reverse holo/i);assert.doesNotMatch(a.query,/holofoil/i);assert.doesNotMatch(a.query,/english/i,'English seller titles often omit the language; contradictory languages are rejected from returned evidence');
 assert.notEqual(a.requestKey,prepare(identity,{name:'Holofoil',language:'en'}).requestKey);
 assert.notEqual(a.requestKey,prepare(identity).requestKey);
 assert.throws(()=>prepare({...identity,language:'ja'},{name:'Reverse Holofoil',language:'en'}),/LANGUAGE/);
 assert.throws(()=>prepare(identity,{name:'Reverse Holofoil',language:'en',cardId:'private'}),/PRINTING/);
});
test('named searches attach explicit finish claims without inventing extra variants or requiring a seller language word',async()=>{
 const printing={name:'Reverse Holofoil',language:'en'},request=prepare(identity,printing),bytes=await png();
 const p=provider({cache:cacheFixture(),now,fetchImpl:async()=>new Response(bytes,{headers:{'content-type':'image/png'}})});
 const evidence=await p.acquireImages({request,source:source(request,[
  item(1,'2016 Pokemon Evolutions Mewtwo #51/108 Reverse Holo'),
  item(2,'2016 Pokemon Evolutions Mewtwo #51/108 Holo English'),
  item(3,'2016 Pokemon Evolutions Mewtwo #51/108 Reverse Holo Japanese'),
  item(4,'2016 Pokemon Evolutions Mewtwo #51/108'),
 ])});
 const choices=scrydexChoices(),result=compose({identity,candidates:choices,evidence,printing});
 assert.equal(result.candidates.length,choices.length);
 const reverse=result.candidates.find(c=>c.label==='Reverse Holofoil'),photos=reverse.images.filter(i=>i.relationship==='listing_photo');
 assert.equal(photos.length,1);assert.equal(photos[0].listing.id,'123456780001');
 assert(result.candidates.every(c=>c.source.provider==='scrydex'));
 assert.throws(()=>compose({identity,candidates:choices,evidence,printing:{name:'Holofoil',language:'en'}}),/EVIDENCE/);
});

test('verified Scrydex expansion alias recovers Together photos from the same paid response without weakening other identity checks',async()=>{
 const target={category:'POKEMON',name:'Pikachu',year:'2023',setName:'Scarlet & Violet—151',cardNumber:'025/165',manufacturer:null,language:null};
 const choices=importScrydexVariantCandidates({identity:target,card:{id:'sv3pt5-25',name:'Pikachu',number:'25',printed_number:'025/165',language_code:'EN',
  expansion:{id:'sv3pt5',name:'151',series:'Scarlet & Violet',release_date:'2023/09/22',is_online_only:false},
  variants:[{name:'pokemonTogetherStamp',images:[]}],images:[]},source:{url:scrydexVariantSearchUrl(target),sha256:sha('retained Pikachu fixture')}});
 const printing={name:'Pokémon Together Stamp',language:'en'},request=prepare(target,printing);
 const valid='2023 Pokemon 151 Pikachu Pokemon Together Pop Up Exclusive 25/165 NM Card';
 const saved=source(request,[item(1,valid),item(2,valid.replace('2023','2022')),item(3,valid.replace('Pikachu','Raichu')),
  item(4,valid.replace('25/165','25/166')),item(5,valid+' French'),item(6,'2023 Pokemon 151 Pikachu Eevee Pokemon Together 25/165 133/165 2x'),
  item(7,'2023 Pokemon 151 Pikachu Pokemon Together Choose Your Card 25/165')]);
 assert.equal(project(request,saved).listings.length,0);
 const before=structuredClone(request),bytes=await png(),calls=[];
 const p=provider({cache:cacheFixture(),now,fetchImpl:async url=>{assert(url.startsWith('https://i.ebayimg.com/'));calls.push(url);return new Response(bytes,{headers:{'content-type':'image/png'}});}});
 const evidence=await p.acquireImages({request,source:saved,catalogCandidates:choices});
 const result=compose({identity:target,candidates:choices,evidence,printing});
 assert.deepEqual(request,before);assert.equal(result.candidates.length,1);
 const photos=result.candidates[0].images.filter(i=>i.relationship==='listing_photo');
 assert.equal(photos.length,1);assert.equal(photos[0].listing.id,item(1).itemId);assert(calls.length>=1);
 for(const change of [{warnings:[...choices[0].warnings,'SET_NAME_REQUIRES_REVIEW']},
  {identity:{...choices[0].identity,year:'2022'}},{identity:{...choices[0].identity,cardNumber:'025/166'}}]){
  const altered={...choices[0],...change};
  // Recompute only the candidate ID for these valid but unrelated metadata fixtures.
  const {variantCandidateId}=await import('@tenkings/card-catalog-evidence');altered.candidateId=variantCandidateId(altered);
  assert.equal(project(request,saved,{catalogCandidates:[altered]}).listings.length,0);
 }
});

test('manufacturer printings receive only matching sports photos, preserving named rows and exact seller provenance',async()=>{
 const target={category:'SPORTS',name:'Drake Maye',year:'2024',setName:'Donruss Optic',cardNumber:'229',manufacturer:'Panini',language:null};
 const catalog={schemaVersion:'manufacturer-checklist/v1',complete:false,sources:[{manufacturer:'Panini',year:'2024',setName:'Donruss Optic',sport:'football',aliases:[],url:'https://www.paniniamerica.net/checklist.html',sha256:sha('owned checklist fixture')}],
  rows:['Rated Rookies','Rated Rookies Blue','Rated Rookies Blue Hyper'].map(label=>[0,label,'229','Drake Maye','New England Patriots'])};
 const {candidates}=await createManufacturerChecklistVariantProvider({catalog}).prepare(target),printing={name:'Rated Rookies Blue Hyper',language:null},request=prepare(target,printing);
 assert.match(request.query,/blue hyper/i);assert.doesNotMatch(request.query,/rated rookies/i);
 const title='2024 Panini Donruss Optic Drake Maye #229 Blue Hyper Rated Rookie',bytes=await png(),cache=cacheFixture();
 const p=provider({cache,now,fetchImpl:async()=>new Response(bytes,{headers:{'content-type':'image/png'}})});
 const evidence=await p.acquireImages({request,source:source(request,[item(1,title),item(2,'2024 Panini Donruss Optic Drake Maye #229 Blue Rated Rookie')])});
 const result=compose({identity:target,candidates,evidence,printing}),choice=result.candidates.find(c=>c.label===printing.name),photo=choice.images[0];
 assert.equal(result.candidates.length,3);assert.equal(choice.images.length,1);assert.equal(photo.listing.title,title);assert.equal(choice.parallel,printing.name);
 assert.equal(choice.source.provider,'manufacturer_checklist');assert.equal(choice.authority,'provider_candidate');assert.equal(choice.applicability,'unknown');assert.equal(isVariantPhotoComparable(choice,photo),false);
 assert.equal(result.candidates.filter(c=>c.images.length).length,1);
 const reader=provider({cache,now:()=>now()+2*limits.ttlMs,fetchImpl:noNetwork,inspectImage:noNetwork});assert.equal((await reader.readImage(photo)).sha256,sha(bytes));
 for(const mutate of [c=>{c.images[0].listing.title='forged'},c=>{c.images[0].relationship='exact'},c=>{c.images[0].provenance.usage='reviewed_catalog'},c=>{c.authority='reviewed_catalog'},c=>{c.applicability='supported'}]){const changed=structuredClone(choice);mutate(changed);assert.throws(()=>validateVariantCandidate(changed));}
 const blue={name:'Rated Rookies Blue',language:null},blueRequest=prepare(target,blue),blueEvidence=await p.acquireImages({request:blueRequest,source:source(blueRequest,[item(1,title)])});
 assert(compose({identity:target,candidates,evidence:blueEvidence,printing:blue}).candidates.every(c=>c.images.length===0),'Blue Hyper is never shown as Blue');
 assert.throws(()=>compose({identity:target,candidates,evidence}),/PRINTING_REQUIRED/);
});

test('partial insert checklists do not label an explicit Refractor photo as the unqualified insert',async()=>{
 const target={category:'SPORTS',name:'LaMelo Ball',year:'2025',setName:'Topps Chrome — Ball of Duty',cardNumber:'BD-13',manufacturer:'Topps',language:null};
 const catalog={schemaVersion:'manufacturer-checklist/v1',complete:false,sources:[{manufacturer:'Topps',year:'2025-26',setName:'Topps Chrome Basketball',sport:'basketball',aliases:[],url:'https://www.topps.com/pages/checklists',sha256:sha('owned LaMelo checklist fixture')}],rows:[[0,'BALL OF DUTY','BD-13','LaMelo Ball','page:14;row:25']]};
 const {candidates}=await createManufacturerChecklistVariantProvider({catalog}).prepare(target),printing={name:'BALL OF DUTY',language:null},request=prepare(target,printing),bytes=await png();
 const p=provider({cache:cacheFixture(),now,fetchImpl:async()=>new Response(bytes,{headers:{'content-type':'image/png'}})});
 // These seller titles were observed in the existing real-card job; the
 // response envelope and tiny image bytes here are explicitly local fixtures.
 const evidence=await p.acquireImages({request,source:source(request,[
  item(1,'2025 Topps Chrome LaMelo Ball PSA 10 GEM Ball of Duty #BD-13 Charlotte Hornets'),
  item(2,'2025 Topps Chrome LaMelo Ball Ball of Duty Refractor #BD-13 PWE'),
 ])});
 assert.equal(evidence.listings.length,2);
 const result=compose({identity:target,candidates,evidence,printing});
 assert.equal(result.candidates.length,1);
 assert.deepEqual(result.candidates[0].images.map(image=>image.listing.id),['123456780001']);
 assert.equal(result.candidates[0].identity.year,'2025');
 assert.equal(result.candidates[0].applicability,'unknown');
});

test('concise named Pokemon search preserves strict full identity filtering and retained legacy decoding',()=>{
 const printing={name:'Reverse Holofoil',language:'en'},request=prepare(identity,printing);
 assert.equal(request.query,'pokemon mewtwo 51/108 reverse Holo');
 const good='2016 Pokemon Evolutions Mewtwo #51/108 Reverse Holo';
 const result=project(request,source(request,[item(1,good),item(2,good.replace('2016','2017')),item(3,good.replace('Evolutions','Base Set')),
  item(4,good.replace('51/108','51/109')),item(5,`${good} Japanese`),item(6,'Pokemon Evolutions Reverse Holo Choose your card')]));
 assert.deepEqual(result.listings.map(v=>v.listing.id),['123456780001']);
 const legacy={...request,revision:'variant-listing-2026-10-10-v2',query:'2016 evolutions mewtwo reverse Holo #51/108'};
 const url=new URL(legacy.url);url.searchParams.set('keyword',legacy.query);legacy.url=url.href;delete legacy.requestKey;
 legacy.requestKey=`variant-listing-source:v1:${sha(canonicalJson(legacy))}`;
 assert.notEqual(legacy.requestKey,request.requestKey);assert.equal(project(legacy,source(legacy,[item(1,good)])).listings.length,1);
 assert.throws(()=>project({...request,query:'tampered'},source(request,[])),/REQUEST_CHANGED/);
 assert.throws(()=>project({...request,revision:'unknown'},source(request,[])),/REQUEST_CHANGED/);
});
test('a Scrydex exact image does not suppress the durable listing search for its named variant',async()=>{
 const choice=structuredClone(scrydexChoices().find(c=>c.label==='Snowflake Stamp'));
 choice.images[0].relationship='exact';choice.images[0].imageId=`scrydex:variant-image:v1:${sha('synthetic exact image')}`;validateVariantCandidate(choice);let dispatched=0;
 const service=createVariantCatalogService({now,providers:[{prepare:async()=>({candidates:[choice],problems:[],truncated:false})}],
  listingProvider:{fetchSource:async()=>{throw Error('should use journal');}}});
 const result=await service.prepare({identity},{executeListingSource:async request=>{dispatched++;assert.equal(request.printing.name,'snowflake stamp');return{state:'UNKNOWN'};}});
 assert.equal(dispatched,1);assert.equal(result.candidates[0].label,'Snowflake Stamp');assert.ok(result.problems.includes('LISTING_SOURCE_OUTCOME_UNKNOWN'));
});

test('production-style 151 identity accepts a single matching reverse-holo title and rejects a generic selection',()=>{
 const pikachu={category:'POKEMON',name:'Pikachu',year:'2023',setName:'Scarlet & Violet—151',cardNumber:'025/165',manufacturer:null,language:null};
 const request=prepare(pikachu,{name:'Reverse Holofoil',language:'en'});
 assert.equal(request.query,'pokemon pikachu 25/165 reverse Holo');
 const result=project(request,source(request,[item(1,'Pikachu 025/165 Reverse Holo Pokemon Scarlet & Violet 151'),
  item(2,'Pokemon TCG Scarlet & Violet 151 ENGLISH REVERSE HOLO - Choose your card!')]));
 assert.deepEqual(result.listings.map(v=>v.listing.id),['123456780001']);
});


test('graded search includes base and any company while retaining old paid request identities for reads',async()=>{
 const printing={name:'Normal',language:'en'},request=prepare(identity,printing,{graded:true});
 assert.match(request.query,/graded$/);assert.doesNotMatch(request.query,/normal|PSA|CGC|BGS|SGC/i);assert.equal(new URL(request.url).searchParams.get('count'),'240');
 const old=prepareRetainedVariantListingRequest(identity,printing);assert.match(old.query,/\(PSA,CGC,BGS,SGC\)/);assert.equal(new URL(old.url).searchParams.get('count'),'40');assert.notEqual(old.requestKey,request.requestKey);
 assert.notEqual(request.requestKey,prepare(identity,printing).requestKey);
 const saved=source(request,[item(1,'Mewtwo PSA 9'),item(2,'Mewtwo PSA 9 pick your card'),item(3,'Mewtwo PSA 9 lot of 2'),
  item(4,'Mewtwo PSA 9',{listingType:'active'})]);
 const projected=project(request,saved);assert.deepEqual(projected.listings.map(v=>v.listing.id),[1,2,3,4].map(n=>item(n).itemId));
 const cache=cacheFixture(),bytes=await png();let reads=0;
 const first=await provider({cache,now,fetchImpl:async()=>{reads++;return new Response(bytes,{headers:{'content-type':'image/png'}});}}).acquireImages({request,source:saved});
 assert.equal(first.referencePhotos.length,1);assert.equal(first.referencePhotos[0].relationship,'listing_photo');assert.equal(reads,4);
 const retained=provider({cache,now:()=>now()+1000*limits.ttlMs,fetchImpl:noNetwork,inspectImage:noNetwork});
 const second=await retained.acquireImages({request,source:saved});
 assert.equal(second.acquisition.requests,0);assert.deepEqual(second.referencePhotos,first.referencePhotos);
 assert.equal((await retained.readImage(second.referencePhotos[0])).sha256,sha(bytes));
});
test('graded photos remain outside catalog choices until the slab label is read',async()=>{
 const choices=scrydexChoices(),cache=cacheFixture(),bytes=await png(),requests=[];
 const p=provider({cache,now,fetchImpl:async()=>new Response(bytes,{headers:{'content-type':'image/png'}})});
 const service=createVariantCatalogService({providers:[{prepare:async()=>({candidates:choices,problems:[],truncated:false})}],listingProvider:p,now});
 const result=await service.prepare({identity},{executeListingSource:async(request,_dispatch,{retainedOnly=false}={})=>{if(retainedOnly)return {state:'MISSING'};requests.push(request);return {state:'SAVED',source:source(request,[item(1,'Mewtwo PSA 9')])};}});
 assert.equal(requests.length,choices.length);assert(requests.every(r=>r.query.endsWith('graded')&&!r.query.includes('PSA')));
 assert.equal(result.referencePhotos.length,1);assert.equal(result.candidates.length,choices.length);
 assert(result.candidates.every(c=>c.images.every(i=>i.relationship!=='listing_photo')));
});

test('explicit missing-reference refresh has a new durable key without changing the search or historical keys',()=>{
 const printing={name:'Normal',language:'en'},ordinary=prepare(identity,printing,{graded:true});
 const generation='eaf7aeb8-b65a-4737-954a-08003c35d271';
 const refresh=prepare(identity,printing,{graded:true,generation});
 assert.equal(refresh.query,ordinary.query);assert.equal(refresh.url,ordinary.url);
 assert.notEqual(refresh.requestKey,ordinary.requestKey);assert.equal(refresh.generation,generation);
 assert.deepEqual(prepare(identity,printing,{graded:true,generation}),refresh);
 assert.deepEqual(prepare(identity,printing,{graded:true,generation:null}),ordinary);
 assert.equal(project(refresh,source(refresh,[])).listings.length,0);
 assert.throws(()=>project({...refresh,generation:'13febeb4-2b94-4a6e-8e44-a7e6d1f42442'},source(refresh,[])),/REQUEST_CHANGED/);
 assert.throws(()=>prepare(identity,printing,{generation}),/REFRESH_GENERATION/);
 assert.throws(()=>prepare(identity,printing,{graded:true,generation:'automatic'}),/REFRESH_GENERATION/);
});

test('explicit refresh retains already-read photos while deduplicating identical bytes',async()=>{
 const generation='eaf7aeb8-b65a-4737-954a-08003c35d271',printing={name:'Normal',language:'en'};
 const request=prepare(identity,printing,{graded:true,generation}),cache=cacheFixture(),known=await png();
 const fresh=await sharp({create:{width:12,height:16,channels:3,background:'#fc4820'}}).png().toBuffer();
 const p=provider({cache,now,fetchImpl:async url=>new Response(url===imageUrl(1)?known:fresh,{headers:{'content-type':'image/png'}})});
 const saved=source(request,[item(1,'Mewtwo PSA 9'),item(2,'Mewtwo PSA 10'),item(3,'Mewtwo CGC 10')]);
 const result=await p.acquireImages({request,source:saved},{imageLimit:2});
 assert.deepEqual(result.referencePhotos.map(p=>p.sha256),[sha(known),sha(fresh)]);assert.equal(result.acquisition.uniqueImages,2);
 const later=provider({cache,now:()=>now()+1000*limits.ttlMs,fetchImpl:noNetwork,inspectImage:noNetwork});
 const reused=await later.acquireImages({request,source:saved},{imageLimit:2});
 assert.deepEqual(reused.referencePhotos,result.referencePhotos);assert.equal(reused.acquisition.requests,0);
});

test('slab pool keeps all returned rows and admits a late photo without seller title, item ID or link',async()=>{
 const request=prepare(identity,{name:'Normal',language:'en'},{graded:true}),cache=cacheFixture(),bytes=await png();
 const rows=Array.from({length:241},()=>({title:null,itemId:null,url:'not a link'}));
 rows[240].thumbnailUrl=imageUrl(240);
 rows[0]={title:'A'.repeat(5001),itemId:'not-a-numeric-id',url:'https://www.ebay.com/itm/123456780999'};
 rows[1]={...rows[0],title:'Different title, same provider ID'};
 const saved=source(request,rows),before=JSON.stringify(saved),projected=project(request,saved);
 assert.equal(projected.listings.length,241);assert.deepEqual(projected.excluded,[]);
 assert.equal(projected.listings[0].listing.title.length,2000);assert.equal(projected.listings[0].listing.id,'not-a-numeric-id');
 assert.deepEqual(projected.listings[240].listing,{id:null,title:null,url:null});
 const p=provider({cache,now,fetchImpl:async()=>new Response(bytes,{headers:{'content-type':'image/png'}})});
 const acquired=await p.acquireImages({request,source:saved});assert.equal(acquired.referencePhotos.length,1);
 const snapshot=createVariantReviewSnapshot({identity,candidates:scrydexChoices(),capturedAt,referencePhotos:acquired.referencePhotos});
 assert.deepEqual(snapshot.referencePhotos[0].listing,{id:null,title:null,url:null});
 assert.equal((await p.readImage(snapshot.referencePhotos[0])).sha256,sha(bytes));assert.equal(JSON.stringify(saved),before);
});

test('slab source ignores the obsolete short search timer but honors worker cancellation',async()=>{
 const request=prepare(identity,{name:'Normal',language:'en'},{graded:true}),controller=new AbortController();
 const p=provider({apiKey:'synthetic-credential',now,timeoutMs:1,fetchImpl:async(_url,options)=>{
  assert.equal(options.signal,controller.signal);await new Promise(resolve=>setTimeout(resolve,12));
  options.signal.throwIfAborted();return new Response(source(request,[]).bodyText,{headers:{'content-type':'application/json'}});
 }});
 assert.equal((await p.fetchSource(request,{signal:controller.signal})).httpStatus,200);
 controller.abort(new Error('worker lease lost'));
 await assert.rejects(p.fetchSource(request,{signal:controller.signal}),/worker lease lost/);
});

test('a complete 240-photo pool survives acquisition and catalog projection beyond former 8/2/96 limits',async()=>{
 const request=prepare(identity,{name:'Normal',language:'en'},{graded:true}),cache=cacheFixture(),base=await png();let calls=0;
 const rows=Array.from({length:240},(_,index)=>item(index));
 const p=provider({cache,now,inspectImage:async()=>({mimeType:'image/png',width:12,height:16}),fetchImpl:async url=>{
  calls++;return new Response(Buffer.concat([base,Buffer.from(url)]),{headers:{'content-type':'image/png'}});
 }});
 const acquired=await p.acquireImages({request,source:source(request,rows)});
 assert.equal(calls,240);assert.equal(acquired.referencePhotos.length,240);
 const snapshot=createVariantReviewSnapshot({identity,candidates:scrydexChoices(),capturedAt,referencePhotos:acquired.referencePhotos});
 assert.equal(snapshot.referencePhotos.length,240);assert.equal(acquired.acquisition.uniqueImages,240);
 const retained=provider({cache,now,fetchImpl:noNetwork,inspectImage:noNetwork});
 assert.equal((await retained.acquireImages({request,source:source(request,rows)})).referencePhotos.length,240);
 assert.equal(calls,240);
});

test('historical company-filtered and title-filtered requests can never dispatch another paid GET',async()=>{
 const p=provider({apiKey:'synthetic-credential',fetchImpl:noNetwork});
 for(const request of [prepare(identity),prepareRetainedVariantListingRequest(identity,{name:'Normal',language:'en'})])
  await assert.rejects(p.fetchSource(request),{code:'VARIANT_LISTING_RETIRED_REQUEST'});
});
