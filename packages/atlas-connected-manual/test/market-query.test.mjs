import test from 'node:test';
import assert from 'node:assert/strict';
import { digest } from '@atlas/manual-service/contract';
import { EBAY_SOLD_COMPS_V2_ENGINE_VERSION } from '@tenkings/ebay-sold-comps-v2';
import { createPresentationMarket, publishedMarketQuery } from '../src/presentation-market.mjs';
import { publicationFixture } from './publication-fixture.mjs';

async function source({ category = 'SPORTS', identity, grade = 9, rawGrade = grade,
  policy = 'atlas-final-whole-point-v1' }) {
  const f = await publicationFixture(); await f.publication.publish({}, f.cardId, f.actionId);
  const manifest = JSON.parse(f.row.manifest), packet = await f.artifacts.read(manifest.packet.ref,
    { cardId: f.cardId, kind: 'PUBLIC_REPORT', sourceHash: manifest.packet.sourceHash });
  Object.assign(packet.report, { cardProfile: category, identity, finalGrade: grade, finalGradePolicy: policy });
  packet.report.grade.overall = { rawGrade, displayGrade: rawGrade };
  return { packet, publicHash: digest(JSON.stringify(packet)) };
}
const sports = { manufacturer: 'Panini', year: '2025', playerName: 'Jaxson Dart', productSet: 'Mosaic Football — Center Stage',
  cardNumber: '7', parallel: 'Red', insert: 'Rated Rookie' };
const pokemon = { year: '2024', cardName: 'Alakazam ex', productSet: 'Scarlet & Violet — Paldean Fates',
  cardNumber: '215/091', parallel: null };

test('approved sports and Pokémon examples use the recorded final award and exact collector number', async () => {
  for (const [input, expected] of [
    [{ identity: sports, grade: 8, rawGrade: 7.64684128229908 }, 'Panini 2025 Mosaic Football Center Stage Jaxson Dart #7 psa 8'],
    [{ identity: sports, grade: 9, rawGrade: 8.5 }, 'Panini 2025 Mosaic Football Center Stage Jaxson Dart #7 psa 9'],
    [{ category: 'POKEMON', identity: pokemon }, 'Pokémon 2024 Scarlet & Violet Paldean Fates Alakazam ex #215/091 psa 9'],
    [{ category: 'POKEMON', identity: { ...pokemon, productSet: 'Scarlet & Violet–Surging Sparks', cardName: 'Sylveon ex', cardNumber: '#086/191' } },
      'Pokémon 2024 Scarlet & Violet Surging Sparks Sylveon ex #086/191 psa 9'],
  ]) {
    const saved = await source(input), before = structuredClone(saved), context = publishedMarketQuery(saved);
    assert.equal(context.query, expected); assert.equal(context.input.queryOverride, expected);
    assert.equal(context.atlasGrade, input.grade ?? 9); assert.equal(Object.hasOwn(context.input, 'targetGrade'), false);
    assert.deepEqual(saved, before);
  }
});

test('missing descriptive fields stay omitted and historical half-point awards remain exact', async () => {
  const half = { grade: 8.5, rawGrade: 8.35, policy: 'atlas-final-half-point-v1' };
  const saved = await source({ ...half, identity: { ...sports, manufacturer: null, year: null, productSet: null, cardNumber: null } });
  assert.equal(publishedMarketQuery(saved).query, 'Jaxson Dart psa 8.5');
  const partial = await source({ ...half, category: 'POKEMON', identity: { ...pokemon, year: null, productSet: null,
    cardName: 'Ho-Oh', cardNumber: '## 025/165' } });
  assert.equal(publishedMarketQuery(partial).query, 'Pokémon Ho-Oh #025/165 psa 8.5');
  const season = await source({ identity: { ...sports, year: '2025-26', cardNumber: '#BD-013' } });
  assert.equal(publishedMarketQuery(season).query, 'Panini 2025-26 Mosaic Football Center Stage Jaxson Dart #BD-013 psa 9');
});

test('saved graded searches retain exact wording and input when fresh searches use psa', async () => {
  const saved = await source({ identity: sports, grade: 8.5, rawGrade: 8.35, policy: 'atlas-final-half-point-v1' });
  const oldQuery = 'Panini 2025 Jaxson Dart #7 graded 8.5';
  const context = publishedMarketQuery(saved, { savedQuery: oldQuery }), before = structuredClone(context);
  assert.deepEqual(publishedMarketQuery(saved, { savedQuery: oldQuery, savedInput: context.input }), context);
  assert.equal(publishedMarketQuery(saved).query, 'Panini 2025 Mosaic Football Center Stage Jaxson Dart #7 psa 8.5');
  assert.deepEqual(context, before);
});

test('saved historical market query and bound input remain selectable without mutation', async () => {
  const saved = await source({ category: 'POKEMON', identity: pokemon }), oldQuery = 'Alakazam ex 215/091';
  const context = publishedMarketQuery(saved, { savedQuery: oldQuery });
  const response = { responsePolicy: 'ATLAS_SLAB_V1', source: 'EBAY_SOLD', engineVersion: EBAY_SOLD_COMPS_V2_ENGINE_VERSION,
    query: oldQuery, retrievedAt: '2026-10-17T00:00:00.000Z', pagination: { page: 1, pageSize: 240, hasNextPage: true, totalResults: '1' },
    items: [{ id: 'atlas-sale:0', sourceIndex: 0, providerItemId: '123456789012', title: 'Retained sale',
      listingUrl: 'https://www.ebay.com/itm/123456789012', imageUrl: null, soldDate: '2026-10-16',
      reportedPrice: '12.34', soldPriceCents: 1234, currency: 'USD', priceBasis: 'EXACT' }],
    acquisitionDiagnostics: { returnedItemCount: 1, retainedItemCount: 1, missingImageCount: 1 },
    imageMatch: { policy: 'atlas-market-slab-label-v1', readings: [{ rowId: 'atlas-sale:0', sha256: null,
      gradingCompany: null, numericGrade: null, labelText: null, evidenceKind: 'UNCERTAIN', identityMatch: 'UNCERTAIN', reason: 'Saved photo unavailable.' }], counts: {} } };
  const before = structuredClone(response), market = createPresentationMarket(), preview = market.project(saved, response);
  assert.equal(preview.preview.query, oldQuery); assert.deepEqual(preview.preview.input, context.input);
  assert.equal(market.select({ ...saved, ...preview, selectedIds: ['atlas-sale:0'] }).sales[0].priceMinor, 1234);
  assert.deepEqual(response, before);
  const wrong = { ...context.input, cardNumber: '216/091' };
  assert.throws(() => publishedMarketQuery(saved, { savedQuery: oldQuery, savedInput: wrong }), { code: 'MARKET_PUBLICATION_MISMATCH' });
  for (const savedQuery of ['', ' invalid ', 'invalid\nquery']) {
    assert.throws(() => publishedMarketQuery(saved, { savedQuery }), { code: 'MARKET_PUBLICATION_MISMATCH' });
  }
  assert.throws(() => publishedMarketQuery({ ...saved, publicHash: 'f'.repeat(64) }), { code: 'MARKET_PUBLICATION_MISMATCH' });
});
