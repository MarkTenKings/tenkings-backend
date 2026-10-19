import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical, digest } from '@atlas/manual-service/contract';
import { buildEbaySoldCompsV2Query, parseEbaySoldCompsV2Candidate, EBAY_SOLD_COMPS_V2_CLASSIFICATION_REVISION, EBAY_SOLD_COMPS_V2_ENGINE_VERSION } from '@tenkings/ebay-sold-comps-v2';
import { createPresentationMarket, projectResearchMarketPreview, publishedMarketQuery, marketPreviewHash } from '../src/presentation-market.mjs';
import { publishedResearchQuery } from '../src/research-market-query.mjs';
import { publicationFixture } from './publication-fixture.mjs';

const now = () => new Date('2026-09-22T16:00:00.000Z');
async function fixture() {
  const f = await publicationFixture(); await f.publication.publish({}, f.cardId, f.actionId);
  const manifest = JSON.parse(f.row.manifest), packet = await f.artifacts.read(manifest.packet.ref,
    { cardId: f.cardId, kind: 'PUBLIC_REPORT', sourceHash: manifest.packet.sourceHash });
  return { packet, publicHash: f.row.public_hash };
}
function source(context, overrides = {}) {
  const raw = { title: '2026 Fixture Local only Synthetic report PSA 9', itemId: '123456789012', url: 'https://www.ebay.com/itm/123456789012',
    soldPrice: '40.00', soldCurrency: 'USD', bestOfferAccepted: false, endedAt: '2026-09-21' };
  const candidate = change => parseEbaySoldCompsV2Candidate({ ...raw, ...change }, context.input);
  return { source: 'EBAY_SOLD', engineVersion: EBAY_SOLD_COMPS_V2_ENGINE_VERSION, query: context.query,
    retrievedAt: now().toISOString(), candidates: [candidate({}), candidate({ itemId: '123456789013', url: 'https://www.ebay.com/itm/123456789013', bestOfferAccepted: true })], ...overrides };
}
test('explicit research published identity drives query; ATLAS award is context without a PSA grade translation or raw packet mutation', async () => {
  const f = await fixture(), before = structuredClone(f.packet), context = publishedResearchQuery(f), market = createPresentationMarket();
  const saved = projectResearchMarketPreview(f, source(context));
  assert.equal(saved.state, 'READY'); assert.equal(Object.hasOwn(context.input, 'targetGrade'), false);
  assert.equal(context.input.queryOverride, context.query); assert.doesNotMatch(context.query, /PSA/);
  assert.equal(saved.preview.atlasGrade, f.packet.report.finalGrade); assert.equal(saved.preview.candidates.length, 1);
  assert.equal(saved.preview.candidates[0].requiresReview, true); assert.equal(saved.preview.excluded.undisclosedOrUnsupported, 1);
  assert.equal(saved.sourceHash, digest(canonical(saved.preview))); assert.deepEqual(f.packet, before);
  const selected = market.select({ ...f, ...saved, selectedIds: [saved.preview.candidates[0].sale.id] });
  assert.equal(selected.sales[0].priceMinor, 4000); assert.equal(selected.sales[0].grade, '9'); assert.equal(selected.sales[0].currency, 'USD');
  assert.equal(Object.hasOwn(selected, 'estimate'), false); assert.equal(market.select({ ...f, ...saved, selectedIds: [] }), null);
});
test('automatic market has no synchronous provider dispatcher and rejects title-only projection', async () => {
  let calls=0;const f=await fixture(),market=createPresentationMarket({provider:async()=>{calls++;}});
  assert.equal('preview' in market,false);assert.equal(calls,0);
  assert.throws(()=>market.project(f,source(publishedResearchQuery(f))),{code:'MARKET_PROVIDER_POLICY_INVALID'});
});
test('malformed provider source, wrong query, duplicate ids and invalid observation dates fail closed', async () => {
  const f = await fixture(), context = publishedResearchQuery(f), result = source(context);
  for (const change of [{ query: 'different card' }, { engineVersion: 'unknown' }, { source: 'ASKING_PRICES' },
    { candidates: [result.candidates[0], result.candidates[0]] }, { retrievedAt: 'not-a-date' }]) {
    assert.throws(() => projectResearchMarketPreview(f, { ...result, ...change }));
  }
});
test('selection requires retained source hash, same exact publication and explicit eligible ids at any retained observation age', async () => {
  const f = await fixture(), context = publishedResearchQuery(f), result = source(context);
  const market = createPresentationMarket(), saved = projectResearchMarketPreview(f, result), id = saved.preview.candidates[0].sale.id;
  for (const alter of [v => { v.sourceHash = 'a'.repeat(64); }, v => { v.preview.query = 'different'; },
    v => { v.publicHash = 'b'.repeat(64); }, v => { v.selectedIds = [result.candidates[1].id]; },
    v => { v.selectedIds = [id, id]; }, v => { v.packet.approvalVersion++; v.publicHash = digest(JSON.stringify(v.packet)); }]) {
    const request = structuredClone({ ...f, ...saved, selectedIds: [id] }); alter(request); assert.throws(() => market.select(request));
  }
  assert.equal(createPresentationMarket({ now: () => new Date('2030-09-24T16:00:00Z') }).select({ ...f, ...saved, selectedIds: [id] }).sales.length, 1);
});
test('unknown identity match requires explicit review and contradictory variant cannot become a reference', async () => {
  const f = await fixture(), context = publishedResearchQuery(f), result = source(context);
  result.candidates[0].parallelMatch = 'UNKNOWN';
  const saved = projectResearchMarketPreview(f, result); assert.equal(saved.preview.candidates[0].requiresReview, true); assert.equal(saved.preview.candidates[0].match, 'UNKNOWN');
  result.candidates[0].parallelMatch = 'CONTRADICTORY'; const contradicted = projectResearchMarketPreview(f, result);
  assert.equal(contradicted.preview.candidates.length, 0); assert.equal(contradicted.preview.excluded.contradictory, 1);
});


async function pokemonFixture(identity) {
  const value = await fixture(); value.packet.report.cardProfile = 'POKEMON';
  value.packet.report.identity = { cardName: 'Pikachu', year: '2023', productSet: 'Scarlet & Violet 151',
    cardNumber: '025/165', parallel: null, ...identity };
  value.publicHash = digest(JSON.stringify(value.packet)); return value;
}
function titleResult(context, titles) {
  return { source: 'EBAY_SOLD', engineVersion: EBAY_SOLD_COMPS_V2_ENGINE_VERSION, query: context.query, retrievedAt: now().toISOString(),
    candidates: titles.map((title, i) => parseEbaySoldCompsV2Candidate({ title, itemId: String(123456789010 + i),
      url: `https://www.ebay.com/itm/${123456789010 + i}`, soldPrice: '40.00', soldCurrency: 'USD', bestOfferAccepted: false,
      endedAt: '2026-09-21' }, context.input)) };
}
test('explicit research result can be projected locally and raw/special grades survive exact selection without relabeling', async () => {
  const f = await pokemonFixture(), context = publishedResearchQuery(f), prefix = '2023 Pikachu Scarlet & Violet 151 025/165';
  const result = titleResult(context, [`${prefix} Ungraded`, `${prefix} CGC 10 Pristine`, `${prefix} CGC 10`, `${prefix} BGS 10 Black Label`]);
  const market = createPresentationMarket({ now }), ready = projectResearchMarketPreview(f, result);
  assert.equal(ready.preview.candidates.length, 4);
  const selected = market.select({ ...f, ...ready, selectedIds: ready.preview.candidates.map(value => value.sale.id) });
  const raw = selected.sales.find(value => value.raw); assert.equal(raw.grader, null); assert.equal(raw.grade, null);
  assert.equal(selected.sales.find(value => value.title.endsWith('Pristine')).designation, 'PRISTINE');
  assert.equal(selected.sales.find(value => value.title.endsWith('CGC 10')).designation, null);
  assert.equal(selected.sales.find(value => value.title.endsWith('Black Label')).designation, 'BLACK_LABEL');
  assert.equal(ready.preview.candidates.every(value => value.requiresReview), true);
  assert.equal(Object.hasOwn(selected, 'estimate'), false);
});
test('collector zero typography is equivalent; omitted denominator stays unknown; explicit different denominator is excluded', async () => {
  const f = await pokemonFixture(), context = publishedResearchQuery(f), prefix = '2023 Pikachu Scarlet & Violet 151';
  const result = titleResult(context, [`${prefix} #25/165 PSA 9`, `${prefix} #025 PSA 9`, `${prefix} #25/189 PSA 9`]);
  const ready = projectResearchMarketPreview(f, result);
  assert.equal(ready.preview.candidates.length, 2); assert.equal(ready.preview.excluded.contradictory, 1);
  assert.equal(ready.preview.candidates[1].identityEvidence.status, 'UNKNOWN');
  assert.ok(ready.preview.candidates[1].identityEvidence.reasonCodes.includes('collector_denominator_missing'));
});
test('explicit identity conflicts and card lots never enter selectable references', async () => {
  const f = await pokemonFixture(), context = publishedResearchQuery(f), prefix = 'Pikachu Scarlet & Violet 151 025/165 PSA 9';
  const ready = projectResearchMarketPreview(f, titleResult(context, [`2021 ${prefix}`, `2023 ${prefix} lot of 3 cards`]));
  assert.equal(ready.preview.candidates.length, 0); assert.equal(ready.preview.excluded.contradictory, 1);
  assert.equal(ready.preview.excluded.undisclosedOrUnsupported, 1);
});
test('retained legacy preview remains explicitly selectable; unrelated input changes still fail', async () => {
  const f = await fixture(), context = publishedResearchQuery(f), market = createPresentationMarket({ now });
  const ready = projectResearchMarketPreview(f, source(context));
  delete ready.preview.input.matchingPolicy; ready.sourceHash = digest(canonical(ready.preview));
  const input = { ...f, ...ready, selectedIds: [ready.preview.candidates[0].sale.id] };
  assert.equal(market.select(input).sales.length, 1);
  ready.preview.input.parallel = 'unrelated variant'; ready.sourceHash = digest(canonical(ready.preview));
  assert.throws(() => market.select({ ...input, ...ready }), { code: 'MARKET_PUBLICATION_MISMATCH' });
});

test('explicit research projection retains exclusion evidence, original capture age and sale amounts', async () => {
  const f = await fixture(), context = publishedResearchQuery(f), result = source(context);
  const metadata = { classificationRevision: EBAY_SOLD_COMPS_V2_CLASSIFICATION_REVISION,
    classificationExcluded: [{ id: 'ebay:123456789099', reason: 'UNANCHORED_MULTI_CARD_LISTING' }] };
  const market = createPresentationMarket({ now });
  const ready = projectResearchMarketPreview(f, { ...result, ...metadata });
  assert.equal(ready.preview.excluded.undisclosedOrUnsupported, 2);
  assert.deepEqual(ready.preview.classificationExcluded, metadata.classificationExcluded);
  assert.notEqual(ready.preview.classificationExcluded, metadata.classificationExcluded);
  assert.equal(ready.preview.classificationRevision, EBAY_SOLD_COMPS_V2_CLASSIFICATION_REVISION);
  assert.equal(ready.preview.retrievedAt, result.retrievedAt);
  const selected = market.select({ ...f, ...ready, selectedIds: [ready.preview.candidates[0].sale.id] });
  assert.equal(selected.sales[0].priceMinor, 4000);
  assert.throws(() => market.select({ ...f, ...ready, selectedIds: ['ebay:123456789099'] }));
  assert.deepEqual(projectResearchMarketPreview(f, { ...result, ...metadata }), ready);
});

test('malformed or double-counted reclassification exclusions cannot become trusted preview evidence', async () => {
  const f = await fixture(), result = source(publishedResearchQuery(f)), market = createPresentationMarket({ now });
  const row = { id: 'ebay:123456789099', reason: 'UNANCHORED_MULTI_CARD_LISTING' };
  for (const metadata of [
    { classificationRevision: 'unknown', classificationExcluded: [] },
    { classificationExcluded: [row] },
    { classificationRevision: EBAY_SOLD_COMPS_V2_CLASSIFICATION_REVISION },
    ...[null, [row, row], [{ ...row, id: result.candidates[0].id }], [{ ...row, reason: 'UNVERIFIED' }],
      [{ ...row, inventedPrice: 100 }], Array.from({ length: 59 }, (_, i) => ({ ...row, id: `ebay:excluded-${i}` }))]
      .map(classificationExcluded => ({ classificationRevision: EBAY_SOLD_COMPS_V2_CLASSIFICATION_REVISION, classificationExcluded })),
  ]) assert.throws(() => projectResearchMarketPreview(f, { ...result, ...metadata }), { code: 'MARKET_PROVIDER_RESULT_INVALID' });
});


test('ATLAS acquisition uses approved Pokémon metadata and award without translating grade or adding a variant', async () => {
  const f = await pokemonFixture({ productSet: '151', parallel: 'English Cosmos Holofoil' }), before = structuredClone(f.packet);
  const context = publishedMarketQuery(f);
  assert.equal(context.query, `Pokémon 2023 151 Pikachu #025/165 psa ${f.packet.report.finalGrade}`);
  assert.deepEqual(context.input, { matchingPolicy: 'ATLAS_IDENTITY_V1', category: 'POKEMON', cardName: 'Pikachu', year: '2023',
    productSet: '151', parallel: 'English Cosmos Holofoil', cardNumber: '025/165', queryOverride: context.query });
  assert.deepEqual(f.packet, before);
  assert.equal(buildEbaySoldCompsV2Query({ ...context.input, queryOverride: undefined }), '2023 151 Pikachu English Cosmos Holofoil #025/165');
  const base = await pokemonFixture({ parallel: 'English Base' });
  assert.equal(publishedMarketQuery(base).query, `Pokémon 2023 Scarlet & Violet 151 Pikachu #025/165 psa ${base.packet.report.finalGrade}`);
});

test('sports retrieval includes the saved full set without adding printing fields or changing saved identity', async () => {
  const f = await fixture();
  f.packet.report.identity = { year: '2025', manufacturer: 'Topps', productSet: '2025 Topps Chrome — Ball of Duty',
    playerName: 'LaMelo Ball', cardNumber: 'BD-013', insert: 'Ball of Duty', parallel: 'Ball of Duty' };
  f.publicHash = digest(JSON.stringify(f.packet));
  const before = structuredClone(f.packet), context = publishedMarketQuery(f);
  assert.equal(context.query, `Topps 2025 2025 Topps Chrome Ball of Duty LaMelo Ball #BD-013 psa ${f.packet.report.finalGrade}`);
  assert.deepEqual(f.packet, before); assert.equal(context.input.cardNumber, 'BD-013');
  f.packet.report.identity = { year: '2025', manufacturer: 'Panini', productSet: '2025 Panini Donruss Optic Football',
    playerName: 'Jaxson Dart', cardNumber: 'DTBH-JDT', insert: 'Donruss Threads', parallel: 'Base Donruss Threads Red' };
  f.publicHash = digest(JSON.stringify(f.packet));
  assert.equal(publishedMarketQuery(f).query, `Panini 2025 2025 Panini Donruss Optic Football Jaxson Dart #DTBH-JDT psa ${f.packet.report.finalGrade}`);
  f.packet.report.identity = { year: '1990', manufacturer: 'Fleer', productSet: 'Fleer Basketball',
    playerName: 'Alex English', cardNumber: '001', insert: null, parallel: 'Base Card' };
  f.publicHash = digest(JSON.stringify(f.packet));
  assert.equal(publishedMarketQuery(f).query, `Fleer 1990 Fleer Basketball Alex English #001 psa ${f.packet.report.finalGrade}`);
});

test('explicit research preserves historical paid query and signed preview remains selectable', async () => {
  const f = await pokemonFixture({ productSet: '151', parallel: 'English Cosmos Holofoil' }), context = publishedMarketQuery(f);
  const legacyInput = { ...context.input }; delete legacyInput.queryOverride;
  const oldQuery = buildEbaySoldCompsV2Query(legacyInput);
  assert.equal(oldQuery, '2023 151 Pikachu English Cosmos Holofoil #025/165');
  const response = titleResult({ ...context, query: oldQuery }, ['2023 Pokemon 151 Pikachu 025/165 English Cosmos Holofoil PSA 9']);
  const original = structuredClone(response), market = createPresentationMarket(), ready = projectResearchMarketPreview(f, response);
  assert.equal(ready.preview.query, oldQuery); assert.equal(ready.preview.input.queryOverride, oldQuery);
  assert.deepEqual(response, original); assert.equal(ready.preview.candidates.length, 1);
  for (const matchingPolicy of [true, false]) {
    const saved = structuredClone(ready); saved.preview.input = { ...legacyInput };
    if (!matchingPolicy) delete saved.preview.input.matchingPolicy;
    saved.sourceHash = digest(canonical(saved.preview));
    const before = structuredClone(saved), selected = market.select({ ...f, ...saved, selectedIds: [ready.preview.candidates[0].sale.id] });
    assert.equal(selected.sales[0].priceMinor, 4000); assert.deepEqual(saved, before);
    saved.preview.input.cardNumber = '026/165'; saved.sourceHash = digest(canonical(saved.preview));
    assert.throws(() => market.select({ ...f, ...saved, selectedIds: [] }), { code: 'MARKET_PUBLICATION_MISMATCH' });
  }
  assert.throws(() => publishedResearchQuery(f, { savedQuery: 'pokemon charizard' }), { code: 'MARKET_PUBLICATION_MISMATCH' });
  assert.throws(() => publishedMarketQuery(f, { savedQuery: oldQuery, savedInput: context.input }), { code: 'MARKET_PUBLICATION_MISMATCH' });
});


test('slab preview uses image readings, retains uncertain abbreviations and unknown sale metadata, and reports every outcome', async () => {
  const f = await pokemonFixture({ productSet: '151', parallel: 'English Cosmos Holofoil' });
  f.packet.report.finalGrade = 8.5; f.packet.report.grade.overall = { rawGrade: 8.5, displayGrade: 8.5 }; f.publicHash = digest(JSON.stringify(f.packet));
  const context = publishedMarketQuery(f);
  const items = Array.from({ length: 6 }, (_, i) => ({ id: `atlas-sale:${i}`, sourceIndex: i, title: '1999 Different title lot of 12'.repeat(1000),
    listingUrl: null, providerItemId: null, imageUrl: i === 5 ? null : `https://i.ebayimg.com/images/g/fixture${i}/s-l1600.jpg`,
    soldDate: i === 0 ? '2026-09-20' : '2026-09-21', reportedPrice: i === 0 ? '40.00' : null,
    soldPriceCents: i === 0 ? 4000 : null, currency: i === 0 ? 'EUR' : null, priceBasis: i === 0 ? 'UPPER_BOUND' : 'UNKNOWN' }));
  const readings = items.slice(0, 5).map((item, i) => ({ rowId: item.id, sha256: String(i + 1).repeat(64), imageUrl: item.imageUrl,
    gradingCompany: i === 1 ? null : 'Other Company', numericGrade: [8.5, 9, 8.5, 6, null][i],
    labelText: '2023 PIKACHU\n151 C.HOLO 25/165', identityMatch: i === 1 ? 'UNCERTAIN' : i === 2 ? 'DIFFERENT' : 'MATCH',
    reason: 'Visible photographed label', canonicalCardKey: null, canonicalPrintingKey: null }));
  const result = { responsePolicy: 'ATLAS_SLAB_V1', source: 'EBAY_SOLD', engineVersion: EBAY_SOLD_COMPS_V2_ENGINE_VERSION,
    query: context.query, retrievedAt: now().toISOString(), items, acquisitionDiagnostics: { returnedItemCount: 6, retainedItemCount: 6, missingImageCount: 1 },
    imageMatch: { policy: 'atlas-market-slab-label-v1', readings, counts: {} } };
  const original = structuredClone(result), market = createPresentationMarket({ now }), ready = market.project(f, result);
  assert.equal(ready.preview.version, 'atlas-market-preview-v2'); assert.equal(ready.sourceHash, marketPreviewHash(ready.preview));
  assert.equal(ready.preview.candidates.length, 6);
  assert.deepEqual(ready.preview.counts, { returned: 6, missingImage: 1, unreadGrade: 2, differentIdentity: 1, outsideGrade: 1, raw: 0, graded: 4, recommended: 1, shown: 6 });
  const selected = market.select({ ...f, ...ready, selectedIds: ['atlas-sale:0', 'atlas-sale:1'] });
  assert.equal(selected.sales[0].grader, null); assert.equal(selected.sales[0].priceBasis, 'unknown');
  assert.equal(selected.sales[1].priceMinor, null); assert.equal(selected.sales[1].priceBasis, 'accepted_offer_unknown');
  assert.equal(selected.sales[1].reportedPrice, '40.00'); assert.equal(selected.sales[1].currency, 'EUR');
  assert.match(selected.sales[1].labelText, /\n/); assert.deepEqual(result, original);
  assert.equal(market.select({ ...f, ...ready, selectedIds: ['atlas-sale:2'] }).sales[0].identityStatus, 'DIFFERENT');
});


test('slab preview and explicit selection retain every eligible row when the provider exceeds the requested count', async () => {
  const f = await pokemonFixture({ productSet: '151', parallel: 'English Cosmos Holofoil' }), context = publishedMarketQuery(f);
  const items = Array.from({ length: 241 }, (_, i) => ({ id: `atlas-sale:${i}`, sourceIndex: i, title: null,
    listingUrl: null, providerItemId: null, imageUrl: `https://i.ebayimg.com/images/g/fixture${i}/s-l1600.jpg`,
    soldDate: '2026-09-21', reportedPrice: null, soldPriceCents: null, currency: null, priceBasis: 'UNKNOWN' }));
  const readings = items.map(item => ({ rowId: item.id, sha256: digest(item.id), imageUrl: item.imageUrl,
    gradingCompany: 'Other Company', numericGrade: context.atlasGrade, labelText: '2023 PIKACHU 151 C.HOLO 25/165',
    identityMatch: 'MATCH', reason: 'Visible photographed label', canonicalCardKey: null, canonicalPrintingKey: null }));
  const result = { responsePolicy: 'ATLAS_SLAB_V1', source: 'EBAY_SOLD', engineVersion: EBAY_SOLD_COMPS_V2_ENGINE_VERSION,
    query: context.query, retrievedAt: now().toISOString(), items,
    acquisitionDiagnostics: { returnedItemCount: items.length, retainedItemCount: items.length, missingImageCount: 0 },
    imageMatch: { policy: 'atlas-market-slab-label-v1', readings, counts: {} } };
  const market = createPresentationMarket({ now }), ready = market.project(f, result);
  assert.equal(ready.preview.candidates.length, 241);
  assert.equal(ready.preview.counts.returned, 241); assert.equal(ready.preview.counts.shown, 241);
  const selected = market.select({ ...f, ...ready, selectedIds: items.map(item => item.id) });
  assert.equal(selected.sales.length, 241);
  assert.deepEqual(new Set(selected.sales.map(item => item.id)), new Set(items.map(item => item.id)));
});

test('raw, unread, different and off-grade choices retain sale provenance and require explicit selection', async () => {
  const f = await pokemonFixture(), context = publishedMarketQuery(f), market = createPresentationMarket();
  const kinds = ['RAW', 'UNCERTAIN', 'SLABBED', 'SLABBED'];
  const items = kinds.map((_, i) => ({ id: `atlas-sale:${i}`, title: `Original seller title ${i}`,
    listingUrl: `https://www.ebay.com/itm/12345678900${i}`, providerItemId: `12345678900${i}`,
    imageUrl: null, soldDate: '2026-10-01', soldPriceCents: 1234 + i, currency: 'USD',
    reportedPrice: `12.${34+i}`, priceBasis: i === 1 ? 'UPPER_BOUND' : 'EXACT' }));
  const readings = kinds.map((evidenceKind, i) => ({ rowId: items[i].id, evidenceKind, sha256: null,
    numericGrade: i > 1 ? 5 : null, gradingCompany: i > 1 ? 'CGC' : null, labelText: null,
    identityMatch: i === 2 ? 'DIFFERENT' : i === 1 ? 'UNCERTAIN' : 'MATCH', reason: `Visible evidence ${i}` }));
  const original = { responsePolicy: 'ATLAS_SLAB_V1', source: 'EBAY_SOLD', engineVersion: EBAY_SOLD_COMPS_V2_ENGINE_VERSION,
    query: context.query, retrievedAt: now().toISOString(), items, acquisitionDiagnostics: { returnedItemCount: 4 },
    imageMatch: { policy: 'atlas-market-slab-label-v1', readings, counts: {} } };
  const ready = market.project(f, original);
  assert.equal(ready.preview.candidates.length, 4); assert.equal(ready.preview.counts.raw, 1);
  assert.equal(ready.preview.counts.outsideGrade, 2); assert.equal(ready.preview.counts.recommended, 0);
  assert(ready.preview.candidates.every(row => row.requiresReview));
  const selected = market.select({ ...f, ...ready, selectedIds: items.map(item => item.id) });
  const raw = selected.sales.find(row => row.id === items[0].id), unread = selected.sales.find(row => row.id === items[1].id);
  assert.equal(raw.raw, true); assert.equal(raw.grade, null); assert.equal(raw.grader, null);
  assert.equal(raw.title, items[0].title); assert.equal(raw.priceMinor, 1234); assert.equal(raw.listingUrl, items[0].listingUrl);
  assert.equal(unread.raw, false); assert.equal(unread.evidenceKind, 'UNCERTAIN'); assert.equal(unread.grade, null);
  assert.equal(unread.priceMinor, null); assert.equal(unread.reportedPrice, '12.35'); assert.equal(unread.priceBasis, 'accepted_offer_unknown');
  assert.equal(selected.sales.find(row => row.id === items[2].id).identityStatus, 'DIFFERENT');
  assert.equal(market.select({ ...f, ...ready, selectedIds: [] }), null);
});
