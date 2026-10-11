import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { parseEbaySoldCompsV2Candidate, EBAY_SOLD_COMPS_V2_ENGINE_VERSION } from '@tenkings/ebay-sold-comps-v2';
import { createPresentationMarketService } from '../src/presentation-market-service.mjs';
import { createPresentationMarket, publishedMarketQuery } from '../src/presentation-market.mjs';
import { publicationFixture } from './publication-fixture.mjs';
import { canonical, digest } from '@atlas/manual-service/contract';

async function setup() {
  const f = await publicationFixture(); await f.publication.publish({}, f.cardId, f.actionId);
  const manifest = JSON.parse(f.row.manifest), packet = await f.artifacts.read(manifest.packet.ref, { cardId: f.cardId, kind: 'PUBLIC_REPORT', sourceHash: manifest.packet.sourceHash });
  const source = { packet, publicHash: f.row.public_hash }, context = publishedMarketQuery(source);
  let calls = 0, commitCalls = 0, wakes = 0;
  const requests = new Map(), receipts = new Map(), jobs = new Map();
  const repository = {
    async latestMarket() { return [...requests.keys()].at(-1) ?? null; },
    async market(_staff, _cardId, id) { return structuredClone(requests.get(id)); },
    async marketCommitStatus(_staff, _cardId, input) { const receipt = receipts.get(input.requestId); if (receipt) assert.deepEqual(receipt.selectedIds, input.selectedIds); return receipt?.result ?? null; },
    async commit(_staff, _cardId, input, photo, update) {
      commitCalls++; assert.equal(photo, null);
      const result = { presentation: { market: update.market }, revision: input.expectedRevision + 1, approvalActionId: input.approvalActionId };
      receipts.set(input.requestId, { selectedIds: update.source.selectedIds, result }); return result;
    },
  };
  const candidate = parseEbaySoldCompsV2Candidate({ title: '2026 Fixture Local only Synthetic report PSA 9', itemId: '123456789012', url: 'https://www.ebay.com/itm/123456789012', soldPrice: '40.00', soldCurrency: 'USD', bestOfferAccepted: false, endedAt: '2026-09-21' }, context.input);
  const options = { repository, approved: { async loadPacket() { return source; } }, artifacts: f.artifacts,
    provider: async () => { calls++; assert.fail('HTTP must never execute a provider'); },
    jobs: { async latest() { return structuredClone([...jobs.values()].at(-1) ?? null); }, async reserve(_staff, _cardId, input) {
      if (jobs.has(input.requestId)) { assert.deepEqual(requests.get(input.requestId).input, input); return structuredClone(jobs.get(input.requestId)); }
      const job = { state: 'QUEUED', request_id: input.requestId, approval_action_id: input.approvalActionId, created_at: '2026-09-22T16:00:00.000Z' };
      requests.set(input.requestId, { state: 'STARTED', input: structuredClone(input) }); jobs.set(input.requestId, job); return structuredClone(job);
    } }, worker: { wake() { wakes++; } } };
  const service = createPresentationMarketService(options), input = { requestId: randomUUID(), approvalActionId: f.actionId, expectedRevision: 0 };
  async function saveReady() {
    await service.preview({}, f.cardId, input);
    const ready = createPresentationMarket().project(source, { source: 'EBAY_SOLD', engineVersion: EBAY_SOLD_COMPS_V2_ENGINE_VERSION,
      query: context.query, retrievedAt: '2020-09-22T16:00:00.000Z', candidates: [candidate] });
    const artifactHash = digest(JSON.stringify(ready.preview)), ref = await f.artifacts.write(ready.preview, { cardId: f.cardId, kind: 'MARKET_PREVIEW', sourceHash: artifactHash });
    Object.assign(requests.get(input.requestId), { state: 'READY', saved: { state: 'READY', ref, artifactHash, sourceHash: ready.sourceHash } });
    jobs.get(input.requestId).state = 'READY'; return service.status({}, f.cardId);
  }
  return { ...f, service, options, requests, jobs, repository, input, saveReady, calls: () => calls, wakes: () => wakes, commitCalls: () => commitCalls };
}
test('HTTP only reserves the durable background job; exact request replay never executes a provider', async () => {
  const f = await setup(); assert.equal(f.service.enabled, true); assert.equal(f.calls(), 0);
  const first = await f.service.preview({}, f.cardId, f.input);
  assert.equal(first.state, 'QUEUED'); assert.equal(first.refreshable, false);
  assert.deepEqual(await f.service.preview({}, f.cardId, f.input), first);
  assert.equal(f.jobs.size, 1); assert.equal(f.calls(), 0); assert.equal(f.wakes(), 2);
});
test('retained historical preview stays selectable years later with exact approval/hash and committed retry semantics', async () => {
  const f = await setup(), first = await f.saveReady();
  assert.equal(first.state, 'READY'); assert.equal(first.preview.candidates.length, 1);
  assert.equal(first.sourceHash, undefined); assert.equal(first.ref, undefined); assert.equal(first.input, undefined);
  const input = { requestId: randomUUID(), approvalActionId: f.actionId, expectedRevision: 0, previewId: first.previewId, selectedIds: [first.preview.candidates[0].sale.id] };
  const selected = await f.service.select({}, f.cardId, input);
  assert.equal(selected.presentation.market.sales[0].priceMinor, 4000); assert.equal(selected.presentation.market.estimate, undefined);
  assert.deepEqual(await f.service.select({}, f.cardId, input), selected); assert.equal(f.commitCalls(), 1); assert.equal(f.calls(), 0);
});
test('client-supplied preview and saved source corruption cannot become public references', async () => {
  const f = await setup(), first = await f.saveReady();
  const input = { requestId: randomUUID(), approvalActionId: f.actionId, expectedRevision: 0, previewId: first.previewId, selectedIds: [first.preview.candidates[0].sale.id] };
  await assert.rejects(f.service.select({}, f.cardId, { ...input, preview: first.preview }));
  f.requests.get(f.input.requestId).saved.sourceHash = digest(canonical({ changed: true }));
  await assert.rejects(f.service.select({}, f.cardId, input), { code: 'MARKET_PREVIEW_CORRUPT' }); assert.equal(f.commitCalls(), 0);
});
test('configured provider without durable jobs cannot execute the obsolete synchronous fallback', async () => {
  const f = await setup(), service = createPresentationMarketService({ ...f.options, jobs: null });
  assert.equal(service.enabled, false);
  await assert.rejects(service.preview({}, f.cardId, f.input), { code: 'MARKET_DURABLE_LABEL_WORKER_REQUIRED' });
  assert.equal(f.calls(), 0); assert.equal(f.requests.size, 0);
});
test('OCR failure status directs retained-response recovery while an unknown listing dispatch stays fenced', async () => {
  const f = await setup(); await f.service.preview({}, f.cardId, f.input);
  Object.assign(f.jobs.get(f.input.requestId), { state: 'FAILED', code: 'MARKET_LABEL_OUTCOME_UNKNOWN', response: { items: [] } });
  const failed = await f.service.status({}, f.cardId);
  assert.equal(failed.reason, 'MARKET_LABEL_OUTCOME_UNKNOWN'); assert.equal(failed.refreshAction, 'RETRY_SAVED_RESPONSE');
  assert.equal(failed.response, undefined); assert.equal(failed.refreshable, true);
  Object.assign(f.jobs.get(f.input.requestId), { state: 'UNKNOWN', code: 'PROVIDER_OUTCOME_UNKNOWN', response: null });
  assert.equal((await f.service.status({}, f.cardId)).refreshable, false); assert.equal(f.calls(), 0);
});
test('unconfigured market service is cold and never creates a paid intent', async () => {
  const service = createPresentationMarketService({ repository: {}, approved: {}, artifacts: {} });
  assert.equal(service.enabled, false); assert.deepEqual(await service.preview({}, randomUUID(), {}), { state: 'UNAVAILABLE', reason: 'PROVIDER_NOT_CONFIGURED', refreshable: false });
});
test('historical terminal refusal remains readable with only its allowlisted reason', async () => {
  const f = await setup(), service = createPresentationMarketService({ ...f.options, jobs: null });
  f.requests.set(f.input.requestId, { state: 'UNAVAILABLE', input: f.input, saved: { state: 'UNAVAILABLE', reason: 'PROVIDER_QUOTA_REACHED', privateText: 'must not leak' } });
  assert.deepEqual(await service.status({}, f.cardId), { state: 'UNAVAILABLE', previewId: f.input.requestId, approvalActionId: f.actionId, reason: 'PROVIDER_QUOTA_REACHED', refreshable: false });
  f.requests.get(f.input.requestId).saved.reason = 'untrusted text';
  assert.equal((await service.status({}, f.cardId)).reason, undefined); assert.equal(f.calls(), 0);
});
