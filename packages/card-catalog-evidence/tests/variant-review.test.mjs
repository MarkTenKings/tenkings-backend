import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublishedCatalogReader, variantChoicesFromPublishedLookup, normalizeVariantIdentity, variantDemandKey,
  compareVariantCardNumber, createVariantReviewSnapshot, validateVariantReviewSnapshot, validateVariantCandidate,
  variantSelectionParallel, importScrydexVariantCandidates, scrydexVariantSearchUrl, variantCandidateId, canonicalJson, isVariantPhotoComparable } from '../src/index.mjs';
import { fixture, hostFixture, queryFor, sha, copy } from './fixtures.mjs';

const identity = { category: 'POKEMON', name: 'Magikarp', year: '2020', setName: 'Rebel Clash', cardNumber: '039/192', manufacturer: null, language: null };
const now = '2026-10-09T08:00:00.000Z';
// Synthetic Scrydex metadata exercises the shared evidence contract.
const imported = () => importScrydexVariantCandidates({ identity, card: {
 id:'swsh2-39',name:'Magikarp',number:'39',printed_number:'39/192',language_code:'en',
 expansion:{id:'swsh2',name:'Rebel Clash',release_date:'2020/05/01',is_online_only:false},
 variants:[{name:'normal'},{name:'reverseHolofoil'}],images:[{type:'front',large:'https://images.scrydex.com/pokemon/swsh2-39/large'}]
},source:{url:scrydexVariantSearchUrl(identity),sha256:sha('synthetic'),capturedAt:now}});

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

test('Synthetic catalog assertions are unreviewed; shared artwork cannot prove either foil finish', () => {
  const choices = imported(); assert.deepEqual(choices.map(c => c.parallel), ['Normal', 'Reverse Holofoil']);
  for (const c of choices) {
    assert.equal(c.canonical, null); assert.equal(c.applicability, 'unknown'); assert.equal(c.identity.language, 'en');
    assert.equal(c.images[0].relationship, 'card_art_only'); assert.equal(c.images[0].sha256, null); assert.deepEqual(c.images[0].visibleDiagnosticIds, []);
    assert.ok(c.warnings.includes('LANGUAGE_UNCONFIRMED')); assert.match(variantSelectionParallel(c), /^English /);
  }
  const forged = copy(choices[0]); forged.images[0].relationship = 'exact'; assert.throws(() => validateVariantCandidate(forged));
  const wrongRights = copy(choices[0]); wrongRights.images[0].provenance.usage = 'reviewed_catalog'; assert.throws(() => validateVariantCandidate(wrongRights));
});

test('listing photos have a strict separate metadata and provenance branch, including Scrydex attachments', () => {
  const listing = { id: '123456789123', title: '2020 Rebel Clash Magikarp #39/192 Reverse Holo English', url: 'https://www.ebay.com/itm/123456789123' };
  const sourceUrl = 'https://api.sold-comps.com/v1/scrape?keyword=magikarp', sourceSha256 = sha('source');
  const image = { imageId: `listing-image:${sha(canonicalJson({ listing, sha256: sha('photo'), sourceResponseSha256: sourceSha256 }))}`,
    relationship: 'listing_photo', url: 'https://i.ebayimg.com/images/g/example/s-l1600.jpg', sha256: sha('photo'),
    mimeType: 'image/jpeg', width: 900, height: 1200, publication: null, sourceResponseSha256: sourceSha256, listing,
    provenance: { provider: 'ebay_sold_comps_v2', sourceUrl, sourceSha256, usage: 'provider_reference' }, visibleDiagnosticIds: [] };
  const c = { ...copy(imported()[1]), images: [image], source: { provider: 'ebay_sold_comps_v2', recordId: listing.id,
    url: sourceUrl, sha256: sourceSha256, references: [{ url: sourceUrl, sha256: sourceSha256 }] },
    warnings: ['LISTING_CLAIMS_UNREVIEWED', 'REFERENCE_USAGE_NOT_REVIEWED'] };
  c.candidateId = variantCandidateId(c); validateVariantCandidate(c);
  assert.equal(isVariantPhotoComparable(c, image), false);
  const cross = { ...copy(c), source: { provider: 'scrydex', recordId: 'swsh2-39:variant:reverseHolofoil',
    url: 'https://api.scrydex.com/pokemon/v1/cards?q=Magikarp', sha256: sha('scrydex'),
    references: [{ url: sourceUrl, sha256: sourceSha256 }] } };
  cross.candidateId = variantCandidateId(cross); validateVariantCandidate(cross);
  assert.equal(cross.label, c.label); assert.equal(isVariantPhotoComparable(cross, cross.images[0]), false);
  for (const mutate of [v => { v.images[0].listingId = listing.id; }, v => { delete v.images[0].listing; },
    v => { v.images[0].publication = { publicationId: 'fake' }; }, v => { v.images[0].sha256 = null; },
    v => { v.images[0].width = 9000; }, v => { v.images[0].url = 'https://attacker.test/photo'; },
    v => { v.images[0].url += '?redirect=other'; }, v => { v.images[0].provenance.usage = 'permission_required'; },
    v => { v.images[0].provenance.sourceSha256 = sha('other'); }, v => { v.warnings = []; },
    v => { v.source.provider = 'tcgdex'; v.candidateId = variantCandidateId(v); }]) {
    const changed = copy(cross); mutate(changed); assert.throws(() => validateVariantCandidate(changed));
  }
  const snapshot = createVariantReviewSnapshot({ identity, candidates: [c, cross], capturedAt: now,
    problems: ['LISTING_SOURCE_OUTCOME_UNKNOWN', 'LISTING_SOURCE_UNAVAILABLE', 'LISTING_SOURCE_NOT_CONFIGURED'] });
  assert.equal(snapshot.coverage.images, 'partial'); assert.ok(snapshot.problems.includes('NO_DIAGNOSTIC_PHOTOS'));
});

test('snapshot hashes evidence independently from observation time; duplicate conflicts and inflation are rejected', () => {
  const [a, b] = imported();
  const s = createVariantReviewSnapshot({ identity, candidates: [b, a, a], capturedAt: now });
  assert.equal(s.candidates.length, 2); assert.equal(s.coverage.images, 'unknown'); assert.ok(s.problems.includes('NO_DIAGNOSTIC_PHOTOS'));
  const later = createVariantReviewSnapshot({ identity, candidates: [a, b], capturedAt: '2026-10-10T08:00:00.000Z' }); assert.equal(s.snapshotHash, later.snapshotHash);
  const tampered = copy(s); tampered.candidates[0].label = 'Different finish'; assert.throws(() => validateVariantReviewSnapshot(tampered));
  assert.throws(() => createVariantReviewSnapshot({ identity, candidates: [a, { ...a, label: 'Different finish' }], capturedAt: now }));
});
