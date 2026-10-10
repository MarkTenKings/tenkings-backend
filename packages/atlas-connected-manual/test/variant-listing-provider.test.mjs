import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { prepareVariantListingRequest as prepare, projectVariantListingSource as project,
  createVariantListingProvider as provider, composeVariantListingCandidates as compose, VARIANT_LISTING_LIMITS as limits } from '../src/variant-listing-provider.mjs';
import { importScrydexVariantCandidates, validateVariantCandidate, createVariantReviewSnapshot,
  isVariantPhotoComparable, scrydexVariantSearchUrl } from '@tenkings/card-catalog-evidence';

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
async function acquireFixture(rows, target = identity) {
  const bytes = await png(), request = prepare(target), cache = cacheFixture();
  const p = provider({ cache, now, fetchImpl: async () => new Response(bytes, { headers: { 'content-type': 'image/png' } }) });
  return { evidence: await p.acquireImages({ request, source: source(request, rows) }), cache, bytes };
}

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

test('composition attaches only explicit compatible finish and language claims while preserving Scrydex names and provenance', async () => {
  const original = scrydexChoices(), before = JSON.stringify(original); assert.equal(original.length, 5);
  const { evidence } = await acquireFixture([
    item(1, '2016 Evolutions Mewtwo #51/108 Reverse Holo English'),
    item(2, '2016 Evolutions Mewtwo #51/108 Cosmos Holo English'),
    item(3, '2016 Evolutions Mewtwo #51/108 Snowflake Stamp English'),
    item(4, '2016 Evolutions Mewtwo #51/108 Non Holo English'),
    item(5, '2016 Evolutions Mewtwo #51/108 Reverse Holo'),
    item(6, '2016 Evolutions Mewtwo #51 Reverse Holo English'),
  ]);
  const result = compose({ identity, candidates: original, evidence });
  assert.equal(result.candidates.length, 8); assert.equal(JSON.stringify(original), before);
  for (const originalChoice of original) {
    const choice = result.candidates.find(c => c.candidateId === originalChoice.candidateId);
    assert.equal(choice.label, originalChoice.label); assert.equal(choice.parallel, originalChoice.parallel);
    for (const key of ['provider', 'recordId', 'sha256', 'url']) assert.equal(choice.source[key], originalChoice.source[key]);
  }
  for (const label of ['Reverse Holofoil', 'Cosmos Holofoil', 'Snowflake Stamp']) {
    const choice = result.candidates.find(c => c.label === label), photo = choice.images.find(i => i.relationship === 'listing_photo');
    assert.ok(photo, label); assert.equal(photo.provenance.provider, 'ebay_sold_comps_v2');
    assert.equal(photo.sourceResponseSha256, evidence.source.sha256); assert.equal(isVariantPhotoComparable(choice, photo), false);
  }
  assert.equal(result.candidates.find(c => c.label === 'Normal').images.some(i => i.relationship === 'listing_photo'), false);
  assert.equal(result.candidates.find(c => c.label === 'Holofoil').images.some(i => i.relationship === 'listing_photo'), false);
  const snapshot = createVariantReviewSnapshot({ identity, candidates: result.candidates, capturedAt });
  assert.equal(snapshot.coverage.images, 'partial'); assert.ok(snapshot.problems.includes('NO_DIAGNOSTIC_PHOTOS'));
  assert.doesNotMatch(JSON.stringify(result), /99\.95|soldPrice|soldCurrency/);
});

test('sports photos preserve saved identity; missing finish remains unknown, strict listing attribution cannot gain authority', async () => {
  const target = { ...sports, cardNumber: 'DTBH-DME' }, title = '2025 Panini Donruss Optic Drake Maye Donruss Threads #DTBH-DME';
  const { evidence, cache, bytes } = await acquireFixture([item(1, title)], target);
  const [choice] = compose({ identity: target, evidence }).candidates, photo = choice.images[0];
  assert.deepEqual(choice.identity, target); assert.equal(choice.parallel, null);
  assert.equal(choice.authority, 'provider_candidate'); assert.equal(choice.applicability, 'unknown');
  assert.equal(photo.listing.title, title); assert.equal(isVariantPhotoComparable(choice, photo), false);
  const reader = provider({ cache, now: () => now() + 2 * limits.ttlMs, fetchImpl: noNetwork, inspectImage: noNetwork });
  assert.equal((await reader.readImage(photo)).sha256, sha(bytes));
  for (const mutate of [c => { c.images[0].listing.title = 'forged'; }, c => { c.images[0].listing.url = 'https://evil.test'; },
    c => { c.images[0].sourceResponseSha256 = sha('forged'); }, c => { c.images[0].relationship = 'exact'; },
    c => { c.images[0].provenance.usage = 'reviewed_catalog'; }, c => { c.images[0].provenance.provider = 'scrydex'; },
    c => { c.images[0].visibleDiagnosticIds = ['invented']; }, c => { c.source.references = []; },
    c => { c.authority = 'reviewed_catalog'; }, c => { c.applicability = 'supported'; }]) {
    const changed = structuredClone(choice); mutate(changed); assert.throws(() => validateVariantCandidate(changed));
  }
  await assert.rejects(reader.readImage({ ...photo, provenance: { ...photo.provenance, sourceUrl: 'https://api.sold-comps.com/v1/scrape?forged=true' } }), /REFERENCE_UNAVAILABLE/);
});

test('conflicting language, ambiguous editions/finishes and imitation claims are excluded', () => {
  const request = prepare(identity), base = '2016 Evolutions Mewtwo #51/108';
  const result = project(request, source(request, ['English Japanese Holo', 'First Edition Unlimited Holo', 'Non Holo Reverse Holo',
    'Custom Reverse Holo', 'Replica Holo', 'Maybe Holo', 'Holo?'].map((claim, n) => item(n, `${base} ${claim}`))));
  assert.equal(result.listings.length, 0);
});

test('unknown Scrydex labels, wrong language and extra edition/stamp claims remain independent photo choices', async () => {
  const { evidence } = await acquireFixture([
    item(1, '2016 Evolutions Mewtwo #51/108 Reverse Holo French'),
    item(2, '2016 Evolutions Mewtwo #51/108 Reverse Holo First Edition English'),
    item(3, '2016 Evolutions Mewtwo #51/108 Reverse Holo Staff Stamp English'),
    item(4, '2016 Evolutions Mewtwo #51/108')]);
  const original = scrydexChoices(), result = compose({ identity, candidates: original, evidence });
  assert.equal(result.candidates.length, original.length + 4);
  assert.ok(result.candidates.filter(c => c.source.provider === 'scrydex').every(c => c.images.every(i => i.relationship !== 'listing_photo')));
  assert.equal(result.candidates.find(c => c.source.recordId === item(4).itemId).parallel, null);
  assert.throws(() => compose({ identity: { ...identity, cardNumber: '52/108' }, candidates: original, evidence }), /EVIDENCE/);
});

test('one metadata GET retains exact public source bytes and no bearer; failure body is retained without retry', async () => {
  const request = prepare(identity), expected = source(request, [item(1)]), calls = [];
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
    source(request, Array.from({ length: 41 }, (_, n) => item(n)))]) assert.throws(() => project(request, mutated), /VARIANT_LISTING/);
  assert.throws(() => project({ ...request, query: 'other' }, saved), /REQUEST_CHANGED/);
  const p = provider({ apiKey: 'secret-test-key', fetchImpl: async () => new Response('secret-test-key', { headers: { 'content-type': 'application/json' } }) });
  await assert.rejects(p.fetchSource(request), /SOURCE_UNSAFE/);
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
  await assert.rejects(reader.fetchSource(request), /CREDENTIAL_MISSING/);
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

test('bounded source read cancels stalled body and never issues another paid request', async () => {
  const request = prepare(identity); let calls = 0, cancelled = 0;
  const p = provider({ apiKey: 'test-secret-key', timeoutMs: 20, fetchImpl: async () => {
    calls++; return new Response(new ReadableStream({ cancel() { cancelled++; } }), { headers: { 'content-type': 'application/json' } });
  } });
  await assert.rejects(p.fetchSource(request), /CANCELLED/); assert.equal(calls, 1); assert.equal(cancelled, 1);
});
