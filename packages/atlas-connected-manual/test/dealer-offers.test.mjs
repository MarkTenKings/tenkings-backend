import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { canonical, digest } from '@atlas/manual-service/contract';
import { createDealerOfferService } from '../src/dealer-offers.mjs';
import { createPresentationMarketService } from '../src/presentation-market-service.mjs';
import { publishedMarketQuery } from '../src/presentation-market.mjs';
import { parseEbaySoldCompsV2Candidate, EBAY_SOLD_COMPS_V2_ENGINE_VERSION } from '@tenkings/ebay-sold-comps-v2';
import { createDealerOffersClient } from '../../../frontend/atlas-app/lib/dealer-offers-client.mjs';
import { createReportMarketClient } from '../../../frontend/atlas-app/lib/report-market-client.mjs';
import { presentationIntegrationFixture } from './presentation-integration-fixture.mjs';

async function fixture() {
  const f = await presentationIntegrationFixture(); f.now = new Date('2026-09-24T04:00:00.000Z');
  const binding = publishedMarketQuery(f.source).binding;
  f.config = { directory: { version: 'atlas-dealer-directory-v1', updatedAt: '2026-09-23T00:00:00.000Z', dealers: [{ id: 'synthetic-shop', name: 'Synthetic authorized shop',
    authorizedAt: '2026-09-23T00:00:00.000Z', authorizationExpiresAt: null, services: ['BUY'],
    address: { line1: '1 Fixture Street', city: 'Fixture City', region: 'CA', postalCode: '90000', country: 'US' }, position: null, website: 'https://example.com/', phone: null, programs: [] }] },
    offers: { version: 'atlas-dealer-offers-v1', offers: [{ id: 'synthetic-offer', dealerId: 'synthetic-shop', binding, amountMinor: 4000, currency: 'USD', kind: 'indicative',
      terms: 'Synthetic terms. Physical inspection required.', expiresAt: '2026-09-25T00:00:00.000Z', source: { reference: 'Synthetic written offer only', receivedAt: '2026-09-24T02:00:00.000Z' } }] } };
  f.offers = createDealerOfferService({ repository: f.repository, approved: f.approved, loadConfiguration: async () => structuredClone(f.config), now: () => f.now });
  f.status = () => f.offers.status(f.staff, f.cardId);
  f.select = async ids => { const status = await f.status(); return f.offers.select(f.staff, f.cardId,
    f.command({ sourceHash: status.sourceHash, selectedIds: ids })); };
  return f;
}
test('actual client/HTTP/service/repository/public reader publish only sourced configured offers and retain exact grade bytes', async () => {
  const f = await fixture(), request = f.transport({ dealerOffers: f.offers });
  const client = createDealerOffersClient({ staffId: f.actorId, cardId: f.cardId, approvalActionId: f.actionId, storage: f.storageClient(), request, cryptoImpl: { randomUUID } });
  const status = await client.read(); assert.equal(status.offers.length, 1); assert.match(status.offers[0].source.reference, /Synthetic/);
  const saved = await client.select({ sourceHash: status.sourceHash, expectedRevision: 0, selectedIds: ['synthetic-offer'] });
  assert.equal(saved.revision, 1); assert.equal(client.pending(), null);
  const report = JSON.parse((await f.reader(f.offers).read(f.claims())).bytes);
  assert.equal(digest(JSON.stringify(report.packet)), f.source.publicHash);
  assert.equal(report.presentation.dealerOffers[0].kind, 'indicative'); assert.equal(report.presentation.dealerOffers[0].amountMinor, 4000);
  assert.equal(report.presentation.dealerOffers[0].source, undefined);
  assert.doesNotMatch(JSON.stringify(report), /Synthetic written offer only|sourceHash|actor_id|market_source/);
  const sources = JSON.parse(f.presentations[0].market_source);
  assert.equal(sources.dealerOffers.sources[0].reference, 'Synthetic written offer only');
  assert.equal(sources.dealerOffers.sources[0].sourceHash, digest(canonical(f.config.offers.offers[0])));
});
test('contact-only, non-buying, removed, future and expired dealers cannot supply an offer', async () => {
  for (const mutate of [config => { config.directory.dealers[0].contactOnly = true; config.directory.dealers[0].services = []; },
    config => { config.directory.dealers[0].services = ['SUBMIT']; }, config => { config.directory.dealers = []; },
    config => { config.directory.dealers[0].authorizedAt = '2026-09-25T00:00:00.000Z'; },
    config => { config.directory.dealers[0].authorizationExpiresAt = '2026-09-24T03:00:00.000Z'; }]) {
    const f = await fixture(); mutate(f.config); const status = await f.status(); assert.deepEqual(status.offers, []);
    await assert.rejects(f.select(['synthetic-offer']), { code: 'DEALER_OFFER_SOURCE_CHANGED' }); assert.equal(f.presentations.length, 0);
  }
});
test('offer configuration binds every report identity, source date, disclosed terms, amount and currency', async () => {
  for (const mutate of [offer => { offer.binding.publicHash = 'f'.repeat(64); }, offer => { offer.binding.approvalVersion++; },
    offer => { offer.binding.publicToken = 'ar_' + 'B'.repeat(24); }, offer => { offer.expiresAt = '2026-09-23T00:00:00.000Z'; },
    offer => { offer.source.receivedAt = '2026-09-25T00:00:00.000Z'; }]) {
    const f = await fixture(); mutate(f.config.offers.offers[0]); assert.deepEqual((await f.status()).offers, []);
  }
  for (const mutate of [offer => { delete offer.source; }, offer => { offer.terms = ''; }, offer => { offer.amountMinor = -1; },
    offer => { offer.currency = 'usd'; }, offer => { offer.kind = 'buyback'; }, offer => { offer.extra = 'untrusted'; }]) {
    const f = await fixture(); mutate(f.config.offers.offers[0]); await assert.rejects(f.status(), { code: 'DEALER_OFFERS_CONFIGURATION_INVALID' });
  }
});
test('expiry, revocation, removal, changed terms and broken configuration suppress published offers while grade stays readable', async () => {
  for (const mutate of [f => { f.now = new Date('2026-09-25T00:00:00.000Z'); }, f => { f.config.directory.dealers = []; },
    f => { f.config.offers.offers = []; }, f => { f.config.offers.offers[0].terms = 'Changed terms'; },
    f => { f.config.directory.dealers[0].services = ['SUBMIT']; }, f => { f.config = {}; }]) {
    const f = await fixture(); await f.select(['synthetic-offer']); mutate(f);
    const report = JSON.parse((await f.reader(f.offers).read(f.claims())).bytes);
    assert.deepEqual(report.presentation.dealerOffers, []); assert.equal(digest(JSON.stringify(report.packet)), f.source.publicHash);
  }
});
test('changed offer terms require new review, exact committed replay survives expiry, request tampering and other card authority fail', async () => {
  const f = await fixture(), status = await f.status(), input = f.command({ sourceHash: status.sourceHash, selectedIds: ['synthetic-offer'] });
  f.config.offers.offers[0].amountMinor++;
  await assert.rejects(f.offers.select(f.staff, f.cardId, input), { code: 'DEALER_OFFER_SOURCE_CHANGED' }); assert.equal(f.presentations.length, 0);
  f.config.offers.offers[0].amountMinor--; const saved = await f.offers.select(f.staff, f.cardId, input);
  f.now = new Date('2026-09-26T00:00:00.000Z'); assert.deepEqual(await f.offers.select(f.staff, f.cardId, input), saved); assert.equal(f.presentations.length, 1);
  await assert.rejects(f.offers.select(f.staff, f.cardId, { ...input, selectedIds: [] }), { code: 'PRESENTATION_REQUEST_CONFLICT' });
  await assert.rejects(f.offers.select(f.staff, randomUUID(), input), { code: 'MANUAL_CARD_NOT_FOUND' });
  f.principal = { id: randomUUID(), role: 'REVIEWER' };
  await assert.rejects(f.offers.select(f.staff, f.cardId, input), { code: 'MANUAL_CARD_NOT_FOUND' });
});
test('legacy sold references, photo evidence and committed retries survive offer publication, removal and later comps updates', async () => {
  const f = await fixture(), context = publishedMarketQuery(f.source); let calls = 0;
  const candidates = ['123456789012','123456789013'].map((itemId, index) => parseEbaySoldCompsV2Candidate({ title: '2026 Fixture Local only Synthetic report PSA 9', itemId,
    url: `https://www.ebay.com/itm/${itemId}`, soldPrice: `${40 + index}.00`, soldCurrency: 'USD', bestOfferAccepted: false, endedAt: `2026-09-${21 + index}` }, context.input));
  const market = createPresentationMarketService({ repository: f.repository, approved: f.approved, artifacts: f.artifacts, now: () => f.now,
    provider: async () => { calls++; return { source: 'EBAY_SOLD', engineVersion: EBAY_SOLD_COMPS_V2_ENGINE_VERSION, query: context.query, retrievedAt: f.now.toISOString(), candidates }; } });
  const search = await market.preview(f.staff, f.cardId, f.command());
  const selection = f.command({ previewId: search.previewId, selectedIds: candidates.map(value => value.id) });
  const comps = await market.select(f.staff, f.cardId, selection);
  assert.equal(JSON.parse(f.presentations[0].market_source).version, 'atlas-selected-market-source-v1');
  await f.repository.commit(f.staff, f.cardId, f.command(), { descriptor: { sha256: 'd'.repeat(64), byteCount: 8,
    contentType: 'image/webp', width: 100, height: 150, alt: 'Synthetic photo descriptor' }, media: { fixture: 'photo bytes are outside this SQL fixture' } });
  const offers = await f.select(['synthetic-offer']); assert.deepEqual(offers.presentation.market, comps.presentation.market);
  assert.equal(offers.presentation.slabPhoto.sha256, 'd'.repeat(64)); assert.notEqual(f.presentations.at(-1).media, null);
  assert.deepEqual(await market.select(f.staff, f.cardId, selection), comps);
  const next = await market.select(f.staff, f.cardId, f.command({ previewId: search.previewId, selectedIds: [candidates[0].id] }));
  assert.equal(next.presentation.dealerOffers.length, 1); assert.equal(calls, 1);
  const removed = await f.select([]); assert.deepEqual(removed.presentation.dealerOffers, []); assert.deepEqual(removed.presentation.market, next.presentation.market);
  const report = JSON.parse((await f.reader(f.offers).read(f.claims())).bytes);
  assert.deepEqual(report.presentation.market.sales.map(value => value.id), [candidates[0].id]); assert.equal(report.presentation.market.estimate, undefined);
  assert.equal(digest(JSON.stringify(report.packet)), f.source.publicHash);
});
test('market browser selection traverses real HTTP/service/repository and public projection without an automatic search', async () => {
  const f = await fixture(), context = publishedMarketQuery(f.source); let calls = 0;
  const candidate = parseEbaySoldCompsV2Candidate({ title: '2026 Fixture Local only Synthetic report PSA 9', itemId: '123456789012', url: 'https://www.ebay.com/itm/123456789012', soldPrice: '40.00', soldCurrency: 'USD', bestOfferAccepted: false, endedAt: '2026-09-21' }, context.input);
  const market = createPresentationMarketService({ repository: f.repository, approved: f.approved, artifacts: f.artifacts, now: () => f.now,
    provider: async () => { calls++; return { source: 'EBAY_SOLD', engineVersion: EBAY_SOLD_COMPS_V2_ENGINE_VERSION, query: context.query, retrievedAt: f.now.toISOString(), candidates: [candidate] }; } });
  const request = f.transport({ market, presentation: { status: (staff, cardId) => f.repository.status(staff, cardId) } });
  const client = createReportMarketClient({ staffId: f.actorId, cardId: f.cardId, approvalActionId: f.actionId, storage: f.storageClient(), request, cryptoImpl: { randomUUID } });
  await client.read(); assert.equal(calls, 0); const preview = await client.preview();
  await client.select({ previewId: preview.previewId, selectedIds: [candidate.id] });
  const report = JSON.parse((await f.reader(f.offers).read(f.claims())).bytes);
  assert.equal(report.presentation.market.sales[0].listingUrl, candidate.listingUrl); assert.equal(calls, 1);
  assert.equal(digest(JSON.stringify(report.packet)), f.source.publicHash); assert.equal(client.pending(), null);
});
