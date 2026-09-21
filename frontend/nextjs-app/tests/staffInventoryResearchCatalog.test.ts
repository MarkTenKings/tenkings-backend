import assert from 'node:assert/strict';
import test from 'node:test';
import { createPublishedCatalogReader, type CatalogQuery, type LookupResult, type DeepReadonly } from '@tenkings/card-catalog-evidence';
import { catalogResearchReferences, createResearchCatalogAdapter, researchCatalogQuery, type CatalogPhotos } from '../lib/server/staffInventoryResearchCatalog';
import type { StaffInventoryResearchDescription } from '../lib/staffInventoryResearch';
// @ts-expect-error Synthetic protocol fixtures are outside the public package contract.
import { fixture, hostFixture } from '../../../packages/card-catalog-evidence/tests/fixtures.mjs';

function scopeReceipt(photos: CatalogPhotos) {
  return { attempt_id: 'fixture:attempt', invocation_id: 'fixture:scope', receipt_ref: 'fixture:receipt', request_sha256: 'd'.repeat(64), response_sha256: 'e'.repeat(64), http_status: 200, acknowledgement: 'adapter' as const,
    images: (['front', 'back'] as const).map(side => ({ side, mime_type: 'image/jpeg' as const, transmitted_sha256: photos[side]!.sha256, source_sha256: null })) };
}
function harness(category: 'SPORTS' | 'POKEMON' = 'SPORTS') {
  const manifest = fixture(category), stored = hostFixture(manifest);
  const reader = createPublishedCatalogReader({ loadAuthorizedPublication: async () => stored.loaded });
  const queries: CatalogQuery[] = [];
  let current = true;
  const photos: CatalogPhotos = { front: { key: 'fixture:front', sha256: 'a'.repeat(64), bytes: Buffer.from('front') }, back: { key: 'fixture:back', sha256: 'b'.repeat(64), bytes: Buffer.from('back') } };
  const description: StaffInventoryResearchDescription = { category: category === 'SPORTS' ? 'Sports cards' : 'Pokémon', name: manifest.cards[0].name,
    manufacturer: manifest.set.manufacturer ?? manifest.set.publisher, year: manifest.set.year, set_name: manifest.set.label, card_number: manifest.cards[0].number, variant: null, card_type: null };
  const host: NonNullable<Parameters<typeof createResearchCatalogAdapter>[0]>['host'] = {
    findCurrentSetCatalogPublications: async () => [stored.pin],
    lookupPublishedSetCatalogEvidence: async ({ publication, query, consumer }) => { assert.equal(consumer, 'inventory'); queries.push(query); return reader.lookup({ publication, query }); },
    isSetCatalogPublicationCurrent: async pin => { assert.deepEqual(pin, stored.pin); return current; },
    readPublishedSetCatalogImage: async () => assert.fail('Unexpected media read'),
  };
  return { manifest, stored, host, photos, description, queries, signal: new AbortController().signal, revoke() { current = false; } };
}

test('sports and Pokémon use exact category/product/number queries and do not infer printing scope', () => {
  for (const family of ['SPORTS', 'POKEMON'] as const) {
    const f = harness(family), q = researchCatalogQuery(f.description)!;
    assert.equal(q.category, family); assert.equal(q.cardNumber, f.manifest.cards[0].number);
    assert.equal(q.language, undefined); assert.equal(q.printingLabel, undefined);
    assert.equal(q.edition, undefined); assert.equal(q.channel, undefined);
    assert.equal(researchCatalogQuery({ ...f.description, year: null }), null);
  }
});

test('a target card photo, crop ancestor, or physical-card origin cannot become its own visual reference', async () => {
  for (const family of ['SPORTS', 'POKEMON'] as const) {
    const f = harness(family);
    const lookup = await f.host!.lookupPublishedSetCatalogEvidence({ publication: f.stored.pin,
      query: { category: family, setId: f.manifest.set.setId, cardId: f.manifest.cards[0].cardId,
        language: f.manifest.printings[0].language, edition: f.manifest.printings[0].edition }, consumer: 'inventory' });
    const image = lookup.candidates.flatMap(c => c.images)[0]!;
    assert.ok(catalogResearchReferences([lookup]).some(r => r.image));
    for (const target of [
      { sha256s: [image.sha256], originKeys: [] },
      { sha256s: [], originKeys: lookup.sources.find(s => image.sourceIds.includes(s.sourceId))!.originKeys },
    ]) {
      const filtered = catalogResearchReferences([lookup], target);
      assert.ok(filtered.some(r => !r.image));
      assert.equal(filtered.some(r => r.image), false);
    }
    const crop = JSON.parse(JSON.stringify(lookup)) as LookupResult;
    crop.candidates.flatMap(c => c.images).forEach(i => { i.parentImageIds = ['parent-outside-bounded-result']; });
    assert.equal(catalogResearchReferences([crop], { sha256s: [], originKeys: [] }).some(r => r.image), false);
    assert.ok(catalogResearchReferences([lookup], { sha256s: ['f'.repeat(64)], originKeys: ['different:physical:card'] }).some(r => r.image));
  }
});

test('actual pure reader yields no authority without explicit scope, even when applicability was recorded supported', async () => {
  const f = harness(), adapter = createResearchCatalogAdapter({ host: f.host });
  const snapshot = await adapter.load(f.description, f.photos, f.signal);
  assert.equal(snapshot.context.status, 'current'); assert.equal(snapshot.references.length, 0);
  assert.equal(snapshot.context.publications[0].coverage.text, 'partial');
  assert.equal(snapshot.context.scope_evidence.length, 0);
});

test('observed scope binds exact reviewed publication and representative image without claiming the depicted card is this card', async () => {
  for (const family of ['SPORTS', 'POKEMON'] as const) {
    const f = harness(family), language = family === 'SPORTS' ? 'en' : 'fr';
    const adapter = createResearchCatalogAdapter({ host: f.host, resolveScope: async ({ choices }) => {
      assert.ok(choices.language.includes(language));
      return { receipt: scopeReceipt(f.photos), evidence: [{ field: 'language', value: language, side: 'front', photo_sha256: f.photos.front!.sha256, observation: 'Synthetic legible language evidence.' },
        { field: 'edition', value: 'standard', side: 'back', photo_sha256: f.photos.back!.sha256, observation: 'Synthetic visible explicit edition mark.' }] };
    } });
    const snapshot = await adapter.load(f.description, f.photos, f.signal);
    assert.equal(snapshot.references.length, family === 'SPORTS' ? 3 : 2); // Sports fixture also contains a distinct numbered insert; no automatic selection.
    assert.ok(snapshot.references.every(r => r.catalog_binding?.publication.manifestSha256 === f.stored.pin.manifestSha256));
    const image = snapshot.references.find(r => r.image)!;
    assert.equal(image.catalog_binding?.image_relationship, 'representative_finish'); assert.equal(image.image?.source_url, null);
    assert.equal(image.image?.storage_key, null); assert.equal(image.catalog_binding?.card_id, f.manifest.cards[0].cardId);
    assert.deepEqual(image.catalog_binding?.image_depicted, { card_id: f.manifest.cards[1].cardId, printing_id: f.manifest.printings[0].printingId });
    assert.deepEqual(image.catalog_binding?.image_represents_printing_ids, f.manifest.images[0].representsPrintingIds);
    assert.deepEqual(image.catalog_binding?.image_visible_diagnostic_ids, f.manifest.images[0].visibleDiagnosticIds);
    for (const catalog of snapshot.references.filter(r => !r.image)) {
      assert.equal(catalog.catalog_binding?.image_depicted, null);
      assert.deepEqual(catalog.catalog_binding?.image_represents_printing_ids, []);
      assert.deepEqual(catalog.catalog_binding?.image_visible_diagnostic_ids, []);
    }
    assert.equal(await adapter.current(snapshot, f.signal), true); f.revoke(); assert.equal(await adapter.current(snapshot, f.signal), false);
  }
});

test('reviewed representative association retains different depicted printing and all diagnostic IDs while exposing only target features', async () => {
  for (const family of ['SPORTS', 'POKEMON'] as const) {
    const manifest = fixture(family), target = manifest.printings[0], depicted = manifest.printings[1];
    // These are deliberately synthetic associations exercising the real reader;
    // they assert no real card finish or approval.
    const depictedApplicability = manifest.applicability.find((a: { cardId: string; printingId: string }) => a.cardId === manifest.cards[1].cardId && a.printingId === depicted.printingId);
    depictedApplicability.status = 'supported'; depictedApplicability.sourceIds = [manifest.sources[0].sourceId];
    target.diagnostics[0].description = 'Synthetic target-only diagnostic.';
    depicted.diagnostics[0].description = 'Synthetic depicted-printing-only diagnostic.';
    manifest.images[0].depicted.printingId = depicted.printingId;
    manifest.images[0].representsPrintingIds = [target.printingId, depicted.printingId];
    manifest.images[0].visibleDiagnosticIds = [target.diagnostics[0].id, depicted.diagnostics[0].id];
    for (const targetVisible of [true, false]) {
      if (!targetVisible) manifest.images[0].visibleDiagnosticIds = [depicted.diagnostics[0].id];
      const stored = hostFixture(manifest);
      const lookup = await createPublishedCatalogReader({ loadAuthorizedPublication: async () => stored.loaded }).lookup({ publication: stored.pin,
        query: { category: family, setId: manifest.set.setId, cardId: manifest.cards[0].cardId, language: target.language, edition: target.edition } });
      const references = catalogResearchReferences([lookup]), image = references.find(r => r.image);
      assert.equal(references.filter(r => r.kind === 'catalog').length, 1);
      if (!targetVisible) { assert.equal(image, undefined); continue; }
      assert.ok(image?.catalog_binding);
      assert.equal(image.catalog_binding.card_id, manifest.cards[0].cardId);
      assert.equal(image.catalog_binding.printing_id, target.printingId);
      assert.equal(image.catalog_binding.image_relationship, 'representative_finish');
      assert.deepEqual(image.catalog_binding.image_depicted, { card_id: manifest.cards[1].cardId, printing_id: depicted.printingId });
      assert.deepEqual(image.catalog_binding.image_represents_printing_ids, manifest.images[0].representsPrintingIds);
      assert.deepEqual(image.catalog_binding.image_visible_diagnostic_ids, manifest.images[0].visibleDiagnosticIds);
      assert.deepEqual(image.distinguishing_features, [target.diagnostics[0].description]);
    }
  }
});

test('a reviewed image of the target retains explicit matching depicted identity', async () => {
  const f = harness(), target = f.manifest.cards[1], printing = f.manifest.printings[0];
  const lookup = await createPublishedCatalogReader({ loadAuthorizedPublication: async () => f.stored.loaded }).lookup({ publication: f.stored.pin,
    query: { category: 'SPORTS', setId: f.manifest.set.setId, cardId: target.cardId, language: printing.language, edition: printing.edition } });
  const image = catalogResearchReferences([lookup]).find(r => r.image)!;
  assert.equal(image.catalog_binding?.image_relationship, 'depicts_candidate_identity');
  assert.deepEqual(image.catalog_binding?.image_depicted, { card_id: target.cardId, printing_id: printing.printingId });
  assert.equal(image.catalog_binding?.card_id, target.cardId);
  assert.equal(image.catalog_binding?.printing_id, printing.printingId);
});

test('invented scope values, wrong photo hashes and duplicate field assertions fail before a scoped lookup', async () => {
  const f = harness();
  for (const evidence of [
    [{ field: 'language' as const, value: 'invented', side: 'front' as const, photo_sha256: f.photos.front!.sha256, observation: 'Fixture' }],
    [{ field: 'language' as const, value: 'en', side: 'front' as const, photo_sha256: 'c'.repeat(64), observation: 'Fixture' }],
    [1, 2].map(() => ({ field: 'language' as const, value: 'en', side: 'front' as const, photo_sha256: f.photos.front!.sha256, observation: 'Fixture' })),
  ]) await assert.rejects(createResearchCatalogAdapter({ host: f.host, resolveScope: async () => ({ evidence, receipt: scopeReceipt(f.photos) }) }).load(f.description, f.photos, f.signal), /Invalid observed/);
});

test('unreviewed, truncated and excluded candidate rows cannot become catalog references', async () => {
  const f = harness();
  const lookup = await createPublishedCatalogReader({ loadAuthorizedPublication: async () => f.stored.loaded }).lookup({ publication: f.stored.pin,
    query: { category: 'SPORTS', setId: f.manifest.set.setId, cardId: f.manifest.cards[0].cardId, language: 'en', edition: 'standard' } });
  assert.equal(catalogResearchReferences([{ ...lookup, authority: 'unreviewed_manifest' }]).length, 0);
  assert.equal(catalogResearchReferences([{ ...lookup, truncated: true }]).length, 0);
  const excluded = { ...lookup, candidates: lookup.candidates.filter(c => c.applicability === 'excluded') } as DeepReadonly<LookupResult>;
  assert.equal(catalogResearchReferences([excluded]).length, 0);
});

test('truncated coverage and inconsistent counts provide no references while supported partial coverage remains useful', async () => {
  const f = harness();
  const lookup = await createPublishedCatalogReader({ loadAuthorizedPublication: async () => f.stored.loaded }).lookup({ publication: f.stored.pin,
    query: { category: 'SPORTS', setId: f.manifest.set.setId, cardId: f.manifest.cards[0].cardId, language: 'en', edition: 'standard' } });
  assert.equal(lookup.coverage.text.status, 'partial'); assert.equal(lookup.coverage.applicability.status, 'partial');
  assert.ok(catalogResearchReferences([lookup]).length > 0, 'positive supported evidence survives normal partial coverage');
  for (const field of ['text', 'applicability'] as const) {
    const truncated = { ...lookup, coverage: { ...lookup.coverage, [field]: { ...lookup.coverage[field], status: 'truncated' as const } } };
    assert.equal(catalogResearchReferences([truncated]).length, 0);
  }
  for (const counts of [
    { returnedCount: 0 }, { returnedCount: lookup.returnedCount + 1 }, { returnedCount: 0.5 },
    { totalCandidateCount: 0 }, { totalCandidateCount: lookup.returnedCount + 1 }, { totalCandidateCount: Number.NaN },
  ]) assert.equal(catalogResearchReferences([{ ...lookup, ...counts }]).length, 0);
  assert.equal(catalogResearchReferences([{ ...lookup, candidates: [], returnedCount: 0, totalCandidateCount: 0 }]).length, 0);
});
