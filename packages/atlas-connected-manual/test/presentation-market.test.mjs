import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical, digest } from '@atlas/manual-service/contract';
import { parseEbaySoldCompsV2Candidate, EbaySoldCompsV2Error, EBAY_SOLD_COMPS_V2_CLASSIFICATION_REVISION, EBAY_SOLD_COMPS_V2_ENGINE_VERSION } from '@tenkings/ebay-sold-comps-v2';
import { createPresentationMarket, publishedMarketQuery } from '../src/presentation-market.mjs';
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
test('published identity drives query; ATLAS award is context without a PSA grade translation or raw packet mutation', async () => {
  const f = await fixture(), before = structuredClone(f.packet), context = publishedMarketQuery(f), calls = [];
  const market = createPresentationMarket({ now, provider: async input => { calls.push(input); return source(context); } });
  const saved = await market.preview(f);
  assert.equal(saved.state, 'READY'); assert.equal(calls.length, 1); assert.equal(Object.hasOwn(calls[0], 'targetGrade'), false);
  assert.equal(Object.hasOwn(calls[0], 'queryOverride'), false); assert.doesNotMatch(context.query, /PSA/);
  assert.equal(saved.preview.atlasGrade, f.packet.report.finalGrade); assert.equal(saved.preview.candidates.length, 1);
  assert.equal(saved.preview.candidates[0].requiresReview, true); assert.equal(saved.preview.excluded.undisclosedOrUnsupported, 1);
  assert.equal(saved.sourceHash, digest(canonical(saved.preview))); assert.deepEqual(f.packet, before);
  const selected = market.select({ ...f, ...saved, selectedIds: [saved.preview.candidates[0].sale.id] });
  assert.equal(selected.sales[0].priceMinor, 4000); assert.equal(selected.sales[0].grade, '9'); assert.equal(selected.sales[0].currency, 'USD');
  assert.equal(Object.hasOwn(selected, 'estimate'), false); assert.equal(market.select({ ...f, ...saved, selectedIds: [] }), null);
});
test('provider absence is unavailable while a transport failure retains an unknown paid outcome', async () => {
  const f = await fixture();
  assert.deepEqual(await createPresentationMarket({ now }).preview(f), { state: 'UNAVAILABLE', reason: 'PROVIDER_NOT_CONFIGURED' });
  assert.deepEqual(await createPresentationMarket({ now, provider: async () => { throw new Error('secret provider response'); } }).preview(f),
    { state: 'UNKNOWN', reason: 'PROVIDER_OUTCOME_UNKNOWN' });
});
test('malformed provider source, wrong query, duplicate ids and future observations fail closed', async () => {
  const f = await fixture(), context = publishedMarketQuery(f), result = source(context);
  for (const change of [{ query: 'different card' }, { engineVersion: 'unknown' }, { source: 'ASKING_PRICES' },
    { candidates: [result.candidates[0], result.candidates[0]] }, { retrievedAt: '2026-09-23T16:00:00.000Z' }]) {
    await assert.rejects(createPresentationMarket({ now, provider: async () => ({ ...result, ...change }) }).preview(f));
  }
});
test('selection requires retained source hash, same exact publication, unexpired observation and explicit eligible ids', async () => {
  const f = await fixture(), context = publishedMarketQuery(f), result = source(context);
  const market = createPresentationMarket({ now, provider: async () => result }), saved = await market.preview(f), id = saved.preview.candidates[0].sale.id;
  for (const alter of [v => { v.sourceHash = 'a'.repeat(64); }, v => { v.preview.query = 'different'; },
    v => { v.publicHash = 'b'.repeat(64); }, v => { v.selectedIds = [result.candidates[1].id]; },
    v => { v.selectedIds = [id, id]; }, v => { v.packet.approvalVersion++; v.publicHash = digest(JSON.stringify(v.packet)); }]) {
    const request = structuredClone({ ...f, ...saved, selectedIds: [id] }); alter(request); assert.throws(() => market.select(request));
  }
  assert.throws(() => createPresentationMarket({ now: () => new Date('2026-09-24T16:00:00Z') }).select({ ...f, ...saved, selectedIds: [id] }), { code: 'MARKET_PREVIEW_EXPIRED' });
});
test('unknown identity match requires explicit review and contradictory variant cannot become a reference', async () => {
  const f = await fixture(), context = publishedMarketQuery(f), result = source(context);
  result.candidates[0].parallelMatch = 'UNKNOWN';
  const market = createPresentationMarket({ now, provider: async () => result });
  const saved = await market.preview(f); assert.equal(saved.preview.candidates[0].requiresReview, true); assert.equal(saved.preview.candidates[0].match, 'UNKNOWN');
  result.candidates[0].parallelMatch = 'CONTRADICTORY'; const contradicted = await market.preview(f);
  assert.equal(contradicted.preview.candidates.length, 0); assert.equal(contradicted.preview.excluded.contradictory, 1);
});


test('only definitive typed provider refusals become recoverable unavailable results', async () => {
  const f = await fixture();
  for (const [code, statusCode, state, reason] of [
    ['SOLDCOMPS_CONFIGURATION_ERROR', 401, 'UNAVAILABLE', 'PROVIDER_CONFIGURATION_ERROR'],
    ['SOLDCOMPS_QUOTA_REACHED', 429, 'UNAVAILABLE', 'PROVIDER_QUOTA_REACHED'],
    ['SOLDCOMPS_QUOTA_REACHED', 403, 'UNAVAILABLE', 'PROVIDER_QUOTA_REACHED'],
    ['SOLDCOMPS_TEMPORARY_UNAVAILABLE', 429, 'UNAVAILABLE', 'PROVIDER_REQUEST_LIMITED'],
    ['SOLDCOMPS_TEMPORARY_UNAVAILABLE', 502, 'UNKNOWN', 'PROVIDER_OUTCOME_UNKNOWN'],
    ['SOLDCOMPS_TIMEOUT', null, 'UNKNOWN', 'PROVIDER_OUTCOME_UNKNOWN'],
  ]) {
    const result = await createPresentationMarket({ now, provider: async () => { throw new EbaySoldCompsV2Error(code, 'private provider text', { statusCode }); } }).preview(f);
    assert.deepEqual(result, { state, reason }); assert.doesNotMatch(JSON.stringify(result), /private provider/);
  }
  assert.equal((await createPresentationMarket({ now, provider: async () => { throw { code: 'SOLDCOMPS_QUOTA_REACHED', statusCode: 429 }; } }).preview(f)).state, 'UNKNOWN');
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
test('paid response can be reprojected locally and raw/special grades survive exact selection without relabeling', async () => {
  const f = await pokemonFixture(), context = publishedMarketQuery(f), prefix = '2023 Pikachu Scarlet & Violet 151 025/165';
  const result = titleResult(context, [`${prefix} Ungraded`, `${prefix} CGC 10 Pristine`, `${prefix} CGC 10`, `${prefix} BGS 10 Black Label`]);
  const market = createPresentationMarket({ now }), ready = market.project(f, result);
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
  const f = await pokemonFixture(), context = publishedMarketQuery(f), prefix = '2023 Pikachu Scarlet & Violet 151';
  const result = titleResult(context, [`${prefix} #25/165 PSA 9`, `${prefix} #025 PSA 9`, `${prefix} #25/189 PSA 9`]);
  const ready = createPresentationMarket({ now }).project(f, result);
  assert.equal(ready.preview.candidates.length, 2); assert.equal(ready.preview.excluded.contradictory, 1);
  assert.equal(ready.preview.candidates[1].identityEvidence.status, 'UNKNOWN');
  assert.ok(ready.preview.candidates[1].identityEvidence.reasonCodes.includes('collector_denominator_missing'));
});
test('explicit identity conflicts and card lots never enter selectable references', async () => {
  const f = await pokemonFixture(), context = publishedMarketQuery(f), prefix = 'Pikachu Scarlet & Violet 151 025/165 PSA 9';
  const ready = createPresentationMarket({ now }).project(f, titleResult(context, [`2021 ${prefix}`, `2023 ${prefix} lot of 3 cards`]));
  assert.equal(ready.preview.candidates.length, 0); assert.equal(ready.preview.excluded.contradictory, 1);
  assert.equal(ready.preview.excluded.undisclosedOrUnsupported, 1);
});
test('retained legacy preview remains explicitly selectable; unrelated input changes still fail', async () => {
  const f = await fixture(), context = publishedMarketQuery(f), market = createPresentationMarket({ now });
  const ready = market.project(f, source(context));
  delete ready.preview.input.matchingPolicy; ready.sourceHash = digest(canonical(ready.preview));
  const input = { ...f, ...ready, selectedIds: [ready.preview.candidates[0].sale.id] };
  assert.equal(market.select(input).sales.length, 1);
  ready.preview.input.parallel = 'unrelated variant'; ready.sourceHash = digest(canonical(ready.preview));
  assert.throws(() => market.select({ ...input, ...ready }), { code: 'MARKET_PUBLICATION_MISMATCH' });
});

test('local title reclassification retains exclusion evidence, original capture age and sale amounts', async () => {
  const f = await fixture(), context = publishedMarketQuery(f), result = source(context);
  const metadata = { classificationRevision: EBAY_SOLD_COMPS_V2_CLASSIFICATION_REVISION,
    classificationExcluded: [{ id: 'ebay:123456789099', reason: 'UNANCHORED_MULTI_CARD_LISTING' }] };
  const market = createPresentationMarket({ now });
  const ready = market.project(f, { ...result, ...metadata });
  assert.equal(ready.preview.excluded.undisclosedOrUnsupported, 2);
  assert.deepEqual(ready.preview.classificationExcluded, metadata.classificationExcluded);
  assert.notEqual(ready.preview.classificationExcluded, metadata.classificationExcluded);
  assert.equal(ready.preview.classificationRevision, EBAY_SOLD_COMPS_V2_CLASSIFICATION_REVISION);
  assert.equal(ready.preview.retrievedAt, result.retrievedAt);
  const selected = market.select({ ...f, ...ready, selectedIds: [ready.preview.candidates[0].sale.id] });
  assert.equal(selected.sales[0].priceMinor, 4000);
  assert.throws(() => market.select({ ...f, ...ready, selectedIds: ['ebay:123456789099'] }));
  assert.throws(() => createPresentationMarket({ now: () => new Date('2026-09-24T16:00:00Z') })
    .project(f, { ...result, ...metadata }), { code: 'MARKET_PREVIEW_EXPIRED' });
});

test('malformed or double-counted reclassification exclusions cannot become trusted preview evidence', async () => {
  const f = await fixture(), result = source(publishedMarketQuery(f)), market = createPresentationMarket({ now });
  const row = { id: 'ebay:123456789099', reason: 'UNANCHORED_MULTI_CARD_LISTING' };
  for (const metadata of [
    { classificationRevision: 'unknown', classificationExcluded: [] },
    { classificationExcluded: [row] },
    { classificationRevision: EBAY_SOLD_COMPS_V2_CLASSIFICATION_REVISION },
    ...[null, [row, row], [{ ...row, id: result.candidates[0].id }], [{ ...row, reason: 'UNVERIFIED' }],
      [{ ...row, inventedPrice: 100 }], Array.from({ length: 59 }, (_, i) => ({ ...row, id: `ebay:excluded-${i}` }))]
      .map(classificationExcluded => ({ classificationRevision: EBAY_SOLD_COMPS_V2_CLASSIFICATION_REVISION, classificationExcluded })),
  ]) assert.throws(() => market.project(f, { ...result, ...metadata }), { code: 'MARKET_PROVIDER_RESULT_INVALID' });
});
