import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { parseEbaySoldCompsV2Candidate, EBAY_SOLD_COMPS_V2_ENGINE_VERSION } from '@tenkings/ebay-sold-comps-v2';
import { createPresentationMarketService } from '../src/presentation-market-service.mjs';
import { publishedMarketQuery } from '../src/presentation-market.mjs';
import { publicationFixture } from './publication-fixture.mjs';
import { canonical, digest } from '@atlas/manual-service/contract';

async function setup() {
  const f = await publicationFixture(); await f.publication.publish({}, f.cardId, f.actionId);
  const manifest = JSON.parse(f.row.manifest), packet = await f.artifacts.read(manifest.packet.ref, { cardId: f.cardId, kind: 'PUBLIC_REPORT', sourceHash: manifest.packet.sourceHash });
  const source = { packet, publicHash: f.row.public_hash }, context = publishedMarketQuery(source);
  let calls = 0, approvedCalls = 0, commitCalls = 0, failFinish = false, failProvider = false, time = '2026-09-22T16:00:00.000Z';
  const requests = new Map(), receipts = new Map();
  const repository = {
    async reserveMarket(_staff, _cardId, input) {
      const existing = requests.get(input.requestId);
      if (existing) { assert.equal(canonical(existing.input), canonical(input)); return { created: false, ...existing }; }
      const row = { state: 'STARTED', input: structuredClone(input), saved: null }; requests.set(input.requestId, row); return { created: true, ...row };
    },
    async market(_staff, _cardId, id) { return structuredClone(requests.get(id)); },
    async finishMarket(_staff, _cardId, id, result) {
      if (failFinish) throw new Error('Storage response unknown');
      const row = requests.get(id); assert.equal(row.state, 'STARTED'); row.state = result.state; row.saved = structuredClone(result);
    },
    async marketCommitStatus(_staff, _cardId, input) { const receipt = receipts.get(input.requestId); if (receipt) assert.deepEqual(receipt.selectedIds, input.selectedIds); return receipt?.result ?? null; },
    async commit(_staff, _cardId, input, photo, update) {
      commitCalls++; assert.equal(photo, null);
      const result = { presentation: { market: update.market }, revision: input.expectedRevision + 1, approvalActionId: input.approvalActionId };
      receipts.set(input.requestId, { selectedIds: update.source.selectedIds, result }); return result;
    },
  };
  const candidate = parseEbaySoldCompsV2Candidate({ title: '2026 Fixture Local only Synthetic report PSA 9', itemId: '123456789012', url: 'https://www.ebay.com/itm/123456789012', soldPrice: '40.00', soldCurrency: 'USD', bestOfferAccepted: false, endedAt: '2026-09-21' }, context.input);
  const service = createPresentationMarketService({ repository, approved: { async loadPacket() { approvedCalls++; return source; } }, artifacts: f.artifacts,
    now: () => new Date(time), provider: async input => { calls++; assert.equal('targetGrade' in input, false); if (failProvider) throw new Error('Response lost after dispatch'); return { source: 'EBAY_SOLD', engineVersion: EBAY_SOLD_COMPS_V2_ENGINE_VERSION, query: context.query, retrievedAt: time, candidates: [candidate] }; } });
  return { ...f, service, requests, repository, input: { requestId: randomUUID(), approvalActionId: f.actionId, expectedRevision: 0 },
    calls: () => calls, commitCalls: () => commitCalls, approvedCalls: () => approvedCalls, failFinish() { failFinish = true; }, failProvider() { failProvider = true; }, age() { time = '2026-09-25T16:00:00.000Z'; } };
}
test('market search persists its source before returning and exact replay does not purchase another lookup', async () => {
  const f = await setup(), first = await f.service.preview({}, f.cardId, f.input);
  assert.equal(first.state, 'READY'); assert.equal(first.preview.candidates.length, 1);
  assert.equal(first.sourceHash, undefined); assert.equal(first.ref, undefined); assert.equal(first.input, undefined);
  assert.deepEqual(await f.service.preview({}, f.cardId, f.input), first); assert.equal(f.calls(), 1);
  const input = { requestId: randomUUID(), approvalActionId: f.actionId, expectedRevision: 0, previewId: first.previewId, selectedIds: [first.preview.candidates[0].sale.id] };
  const selected = await f.service.select({}, f.cardId, input);
  assert.equal(selected.presentation.market.sales[0].priceMinor, 4000); assert.equal(selected.presentation.market.estimate, undefined);
  f.age(); assert.deepEqual(await f.service.select({}, f.cardId, input), selected); assert.equal(f.commitCalls(), 1);
});
test('provider completion uncertainty leaves a durable no-repeat fence', async () => {
  const f = await setup(); f.failFinish();
  await assert.rejects(f.service.preview({}, f.cardId, f.input)); assert.equal(f.calls(), 1);
  assert.deepEqual(await f.service.preview({}, f.cardId, f.input), { state: 'PENDING', previewId: f.input.requestId }); assert.equal(f.calls(), 1);
});
test('lost provider response saves UNKNOWN and replay never dispatches another paid lookup', async () => {
  const f = await setup(); f.failProvider();
  const first = await f.service.preview({}, f.cardId, f.input);
  assert.equal(first.state, 'UNKNOWN'); assert.equal(first.previewId, f.input.requestId);
  assert.equal(f.requests.get(f.input.requestId).state, 'UNKNOWN');
  const replay = await f.service.preview({}, f.cardId, f.input);
  assert.deepEqual(replay, { state: 'UNKNOWN', previewId: f.input.requestId }); assert.equal(f.calls(), 1);
});
test('client-supplied preview is not accepted and saved source corruption cannot become public references', async () => {
  const f = await setup(), first = await f.service.preview({}, f.cardId, f.input);
  const input = { requestId: randomUUID(), approvalActionId: f.actionId, expectedRevision: 0, previewId: first.previewId, selectedIds: [first.preview.candidates[0].sale.id] };
  await assert.rejects(f.service.select({}, f.cardId, { ...input, preview: first.preview }));
  f.requests.get(f.input.requestId).saved.sourceHash = digest(canonical({ changed: true }));
  await assert.rejects(f.service.select({}, f.cardId, input), { code: 'MARKET_PREVIEW_CORRUPT' }); assert.equal(f.commitCalls(), 0);
});
test('unconfigured market service is cold and never creates a paid intent', async () => {
  const service = createPresentationMarketService({ repository: {}, approved: {}, artifacts: {} });
  assert.equal(service.enabled, false); assert.deepEqual(await service.preview({}, randomUUID(), {}), { state: 'UNAVAILABLE', reason: 'PROVIDER_NOT_CONFIGURED' });
});
