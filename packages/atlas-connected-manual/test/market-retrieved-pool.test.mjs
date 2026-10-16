import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EBAY_SOLD_COMPS_V2_ENGINE_VERSION } from '@tenkings/ebay-sold-comps-v2';
import { createPresentationMarketService } from '../src/presentation-market-service.mjs';
import { publishedMarketQuery } from '../src/presentation-market.mjs';
import { projectRetrievedMarketPool } from '../src/market-retrieved-pool.mjs';
import { publicationFixture } from './publication-fixture.mjs';

async function fixture(count = 240) {
  const f = await publicationFixture();
  await f.publication.publish({}, f.cardId, f.actionId);
  const manifest = JSON.parse(f.row.manifest);
  const packet = await f.artifacts.read(manifest.packet.ref, { cardId: f.cardId, kind: 'PUBLIC_REPORT', sourceHash: manifest.packet.sourceHash });
  const source = { packet, publicHash: f.row.public_hash, row: f.row };
  const response = { responsePolicy: 'ATLAS_SLAB_V1', source: 'EBAY_SOLD', engineVersion: EBAY_SOLD_COMPS_V2_ENGINE_VERSION,
    query: publishedMarketQuery(source).query, retrievedAt: '2026-10-16T04:00:00.000Z',
    items: Array.from({ length: count }, (_, i) => ({ id: `atlas-sale:${i}`, title: `Seller claims PSA 10 gem mint ${i}`,
      listingUrl: `https://www.ebay.com/itm/${123456789000 + i}`, imageUrl: `https://i.ebayimg.com/images/g/fixture${i}/s-l1600.jpg`,
      soldDate: '2026-10-15', reportedPrice: '40.00', soldPriceCents: 4000, currency: 'USD', priceBasis: 'EXACT',
      privateProviderData: 'private-row-sentinel', numericGrade: 10, identityMatch: 'MATCH' })),
    privateCredential: 'private-provider-sentinel', imageMatch: { privateData: 'private-model-sentinel', readings: [] } };
  const job = { request_id: randomUUID(), card_id: f.cardId, approval_action_id: f.actionId,
    actor_id: 'private-actor-sentinel', claim_id: 'private-claim-sentinel', state: 'REQUESTED',
    created_at: '2026-10-16T03:59:00.000Z', mode: f.row.mode, source_hash: f.row.source_hash,
    report_hash: f.row.report_hash, public_hash: source.publicHash, response };
  const staff = { fixture: 'authenticated staff' };
  let providerCalls = 0, writes = 0, wakes = 0, reads = 0;
  const options = { artifacts: f.artifacts,
    provider: async () => { providerCalls++; assert.fail('A status read cannot buy a lookup'); },
    worker: { wake() { wakes++; } },
    jobs: { async latest(givenStaff, cardId) { assert.equal(givenStaff, staff); assert.equal(cardId, f.cardId); return structuredClone(job); } },
    approved: { async loadPacket(givenStaff, cardId, actionId) {
      reads++; assert.equal(givenStaff, staff); assert.equal(cardId, f.cardId); assert.equal(actionId, f.actionId); return source;
    } },
    repository: { async market() { return { state: 'STARTED', input: { approvalActionId: f.actionId } }; },
      async marketCommitStatus() { return null; }, async commit() { writes++; assert.fail('Provisional listings cannot be published'); } } };
  return { ...f, source, job, response, staff, options, service: createPresentationMarketService(options),
    counts: () => ({ providerCalls, writes, wakes, reads }) };
}

test('saved listings appear during photo reading without exposing provider/private fields or inventing per-row evidence', async () => {
  const f = await fixture(), original = structuredClone(f.job);
  const status = await f.service.status(f.staff, f.cardId);
  assert.equal(status.state, 'SEARCHING'); assert.equal(status.stage, 'READING_PHOTOS'); assert.equal(status.refreshable, false);
  assert.equal(status.retrieved.query, f.response.query); assert.equal(status.retrieved.retrievedAt, f.response.retrievedAt);
  assert.equal(status.retrieved.candidates.length, 240);
  const sale = status.retrieved.candidates[0].sale;
  assert.deepEqual(Object.keys(sale).sort(), ['id','title','listingUrl','imageUrl','soldAt','priceMinor','currency','priceBasis','reportedPrice'].sort());
  assert.equal(sale.title, 'Seller claims PSA 10 gem mint 0'); assert.equal(sale.priceMinor, 4000); assert.equal(sale.priceBasis, 'sold');
  for (const key of ['preview','sourceHash','ref','response','actor_id','claim_id']) assert.equal(status[key], undefined);
  for (const key of ['completed','failed','unknown','unavailable','pending']) assert.equal(status.progress?.[key], undefined);
  assert.doesNotMatch(JSON.stringify(status), /private-.*-sentinel/);
  assert.deepEqual(await f.service.status(f.staff, f.cardId), status);
  assert.deepEqual(f.job, original); assert.deepEqual(f.counts(), { providerCalls: 0, writes: 0, wakes: 0, reads: 2 });
});

test('provisional sale metadata keeps every returned row and preserves safe links, unknown amounts and accepted offers', async () => {
  const f = await fixture(241);
  Object.assign(f.response.items[0], { priceBasis: 'UPPER_BOUND', imageUrl: 'https://private.example/image', listingUrl: 'javascript:alert(1)' });
  Object.assign(f.response.items[1], { priceBasis: 'UNKNOWN', soldDate: 'not-a-date', currency: null, soldPriceCents: null, reportedPrice: null });
  const result = projectRetrievedMarketPool(f.source, f.job);
  assert.equal(result.candidates.length, 241);
  const offer = result.candidates.find(row => row.sale.id === 'atlas-sale:0').sale;
  assert.equal(offer.priceBasis, 'accepted_offer_unknown'); assert.equal(offer.priceMinor, null); assert.equal(offer.reportedPrice, '40.00');
  assert.equal(offer.listingUrl, null); assert.equal(offer.imageUrl, null);
  const unknown = result.candidates.find(row => row.sale.id === 'atlas-sale:1').sale;
  assert.equal(unknown.priceMinor, null); assert.equal(unknown.currency, null); assert.equal(unknown.soldAt, null);
  assert.equal(result.candidates.find(row => row.sale.id === 'atlas-sale:2').sale.imageUrl, f.response.items[2].imageUrl);
});

test('retrieved rows cannot be selected or used as a client-supplied final preview', async () => {
  const f = await fixture(1), status = await f.service.status(f.staff, f.cardId);
  const input = { requestId: randomUUID(), approvalActionId: f.actionId, expectedRevision: 0,
    previewId: status.previewId, selectedIds: [status.retrieved.candidates[0].sale.id] };
  await assert.rejects(f.service.select(f.staff, f.cardId, input), { code: 'MARKET_PREVIEW_NOT_READY' });
  await assert.rejects(f.service.select(f.staff, f.cardId, { ...input, preview: status.retrieved }));
  assert.equal(f.counts().writes, 0); assert.equal(f.counts().providerCalls, 0);
});

test('provisional rows stay bound to the exact published approval, query and trusted provider policy', async () => {
  const f = await fixture(1);
  for (const key of ['card_id','approval_action_id','mode','source_hash','report_hash','public_hash']) {
    assert.throws(() => projectRetrievedMarketPool(f.source, { ...f.job, [key]: 'changed' }), { code: 'MARKET_APPROVAL_MISMATCH' });
  }
  for (const change of [{ source: 'ASKING_PRICES' }, { engineVersion: 'unknown' },
    { responsePolicy: 'title-only' }, { retrievedAt: 'not-a-date' }, { items: [f.response.items[0], f.response.items[0]] }]) {
    assert.throws(() => projectRetrievedMarketPool(f.source, { ...f.job, response: { ...f.response, ...change } }), { code: 'MARKET_PROVIDER_RESULT_INVALID' });
  }
  const refused = Object.assign(new Error('access revoked'), { code: 'MANUAL_CARD_NOT_FOUND' });
  const service = createPresentationMarketService({ ...f.options, approved: { loadPacket: async () => { throw refused; } } });
  await assert.rejects(service.status(f.staff, f.cardId), error => error === refused);
  assert.equal(f.counts().providerCalls, 0);
});

test('an exact retained approval can display its historical saved query without buying a new search', async () => {
  const f = await fixture(1);
  f.response.query = '2026 Fixture Local only Synthetic report';
  assert.notEqual(f.response.query, publishedMarketQuery(f.source).query);
  const status = await f.service.status(f.staff, f.cardId);
  assert.equal(status.retrieved.query, f.response.query); assert.equal(status.retrieved.candidates.length, 1);
  assert.equal(status.state, 'SEARCHING'); assert.equal(status.preview, undefined); assert.equal(f.counts().providerCalls, 0);
  for (const query of ['', ' invalid ', 'invalid\nquery']) {
    assert.throws(() => projectRetrievedMarketPool(f.source, { ...f.job, response: { ...f.response, query } }), { code: 'MARKET_PUBLICATION_MISMATCH' });
  }
});

test('no saved response and retired jobs remain status-only; an actual empty pool is displayed honestly', async () => {
  const f = await fixture(0), empty = await f.service.status(f.staff, f.cardId);
  assert.deepEqual(empty.retrieved.candidates, []); assert.equal(empty.stage, 'READING_PHOTOS');
  f.job.audit = [{ event: 'RECLASSIFY' }];
  assert.equal((await f.service.status(f.staff, f.cardId)).retrieved, undefined);
  f.job.audit = []; f.job.response = null;
  assert.equal((await f.service.status(f.staff, f.cardId)).retrieved, undefined);
  assert.equal(f.counts().reads, 1); assert.equal(f.counts().providerCalls, 0);
});
