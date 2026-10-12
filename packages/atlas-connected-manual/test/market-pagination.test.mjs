import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { digest, canonical } from '@atlas/manual-service/contract';
import { EBAY_SOLD_COMPS_V2_ENGINE_VERSION } from '@tenkings/ebay-sold-comps-v2';
import { createPresentationMarket, publishedMarketQuery, marketPreviewHash } from '../src/presentation-market.mjs';
import { createMarketWorker, mergeMarketPages } from '../src/market-worker.mjs';
import { createMarketJobStore } from '../src/market-job-store.mjs';
import { publicationFixture } from './publication-fixture.mjs';

async function fixture() {
  const f = await publicationFixture(); await f.publication.publish({}, f.cardId, f.actionId);
  const manifest = JSON.parse(f.row.manifest), packet = await f.artifacts.read(manifest.packet.ref,
    { cardId: f.cardId, kind: 'PUBLIC_REPORT', sourceHash: manifest.packet.sourceHash });
  const source = { packet, publicHash: f.row.public_hash, row: f.row }, context = publishedMarketQuery(source);
  const response = (page, providerIds) => ({ responsePolicy: 'ATLAS_SLAB_V1', source: 'EBAY_SOLD', engineVersion: EBAY_SOLD_COMPS_V2_ENGINE_VERSION,
    query: context.query, retrievedAt: `2026-10-0${page}T00:00:00.000Z`, pagination: { page, pageSize: 240, hasNextPage: page === 1, totalResults: '3' },
    acquisitionDiagnostics: { returnedItemCount: providerIds.length }, items: providerIds.map((providerItemId, index) => ({
      id: `atlas-sale:${page}:${index}`, providerItemId, title: `Source listing ${providerItemId}`, listingUrl: `https://www.ebay.com/itm/${providerItemId}`,
      imageUrl: null, soldDate: '2026-09-01', soldPriceCents: 1234, currency: 'USD', reportedPrice: '12.34', priceBasis: 'EXACT' })) });
  const labels = async ({ response }) => ({ ...response, imageMatch: { policy: 'atlas-market-slab-label-v1', counts: {},
    readings: response.items.map(item => ({ rowId: item.id, sha256: null, gradingCompany: null, numericGrade: null,
      labelText: null, identityMatch: 'UNCERTAIN', evidenceKind: 'UNCERTAIN', reason: 'Image not available.' })) } });
  const firstResponse = response(1, ['123456789012']), nextResponse = response(2, ['123456789012','123456789013']);
  const market = createPresentationMarket(), first = market.project(source, await labels({ response: firstResponse }));
  const artifactHash = digest(JSON.stringify(first.preview)), ref = await f.artifacts.write(first.preview,
    { cardId: f.cardId, kind: 'MARKET_PREVIEW', sourceHash: artifactHash });
  return { f, source, market, labels, first, firstResponse, nextResponse, prior: { previewId: randomUUID(), response: firstResponse,
    record: { state: 'READY', ref, artifactHash, sourceHash: first.sourceHash } } };
}

test('same-query older-page worker survives artifact failure, retains both pages and never repeats the paid request', async () => {
  const x = await fixture(), before = structuredClone(x.source.packet);
  const job = { request_id: randomUUID(), card_id: x.f.cardId, approval_action_id: x.f.actionId, state: 'QUEUED', response: null };
  let calls = 0, writes = 0;
  const store = {
    async claim() { if (job.state !== 'QUEUED') return null; job.state = 'RUNNING'; return structuredClone(job); },
    async bind() { return true; }, async renew() { return true; }, async dispatch() { job.state = 'REQUESTED'; return true; },
    async pageContext() { return x.prior; }, async recordResponse(_job, response) { job.response = response; return true; },
    async finish(_job, result) { job.result = result.result; job.state = result.result ? 'READY' : result.disposition === 'RETRY' ? 'QUEUED' : result.disposition; },
  };
  const worker = createMarketWorker({ store, approved: { loadPacket: async () => x.source }, publication: { publish: async () => {} },
    authorityFor: async () => ({}), labelMarket: x.labels, provider: async (input, options) => {
      calls++; assert.equal(input.queryOverride, x.firstResponse.query); assert.deepEqual(options, { page: 2 }); return x.nextResponse;
    }, artifacts: { ...x.f.artifacts, write: async (...args) => { if (++writes === 1) throw Error('storage interrupted'); return x.f.artifacts.write(...args); } } });
  await worker.drainOnce(); assert.equal(job.state, 'QUEUED'); assert.equal(calls, 1);
  await worker.drainOnce(); assert.equal(job.state, 'READY'); assert.equal(calls, 1);
  const preview = await x.f.artifacts.read(job.result.ref, { cardId: x.f.cardId, kind: 'MARKET_PREVIEW', sourceHash: job.result.artifactHash });
  assert.equal(preview.candidates.length, 2); assert.equal(preview.counts.returned, 3); assert.equal(preview.counts.duplicates, 1);
  assert.equal(preview.pagination.page, 2); assert.equal(preview.pagination.hasNextPage, false); assert.equal(preview.pages.length, 2);
  assert.equal(preview.previousPreviewId, x.prior.previewId);
  const selected = x.market.select({ ...x.source, preview, sourceHash: marketPreviewHash(preview), selectedIds: preview.candidates.map(row => row.sale.id) });
  assert.equal(selected.sales.length, 2); assert(selected.sales.every(row => row.grade === null && row.priceMinor === 1234));
  assert.deepEqual(x.source.packet, before);
  const wrong = structuredClone(preview); wrong.binding.approvalVersion++;
  assert.throws(() => mergeMarketPages(x.first.preview, { preview: wrong }, x.prior.previewId), { code: 'MARKET_PAGE_MISMATCH' });
});

test('page context verifies immutable request and parent receipt within the existing approval', async () => {
  const x = await fixture(), requestId = randomUUID();
  const input = { requestId, approvalActionId: x.f.actionId, expectedRevision: 0, afterPreviewId: x.prior.previewId };
  let request = canonical(input), requestHash = digest(request), response = JSON.stringify(x.firstResponse), result = canonical(x.prior.record);
  const store = createMarketJobStore({ boundary: { machineTransaction: async (_, work) => work({ tx: { async $queryRawUnsafe(sql, cardId, second, third) {
    assert.equal(cardId, x.f.cardId);
    if (sql.includes('SELECT request,request_hash')) { assert.equal(second, requestId); return [{ request, request_hash: requestHash }]; }
    assert.equal(second, x.f.actionId); assert.equal(third, x.prior.previewId);
    assert(sql.includes("j.state='READY'")); return [{ response, response_hash: digest(response), result, result_hash: digest(result) }];
  } } }) } });
  const job = { card_id: x.f.cardId, approval_action_id: x.f.actionId, request_id: requestId };
  assert.deepEqual(await store.pageContext(job), x.prior);
  request += ' '; await assert.rejects(store.pageContext(job), { code: 'MARKET_REQUEST_CORRUPT' });
});

test('a terminal obsolete job can start only a fresh current-path request using the existing human approval', async () => {
  const cardId = randomUUID(), actionId = randomUUID(), actorId = randomUUID(), requestId = randomUUID();
  const old = { request_id: randomUUID(), state: 'FAILED', audit: [{ event: 'RECLASSIFY' }],
    response: JSON.stringify({ source: 'EBAY_SOLD', candidates: [] }) }, before = structuredClone(old);
  let inserted, savedRequest, updates = 0;
  const principal = { id: actorId, role: 'REVIEWER', actorKind: 'HUMAN', accessVersion: 7, mode: 'LOCAL_FIXTURE' };
  const tx = {
    async $queryRawUnsafe(sql, ...args) {
      if (sql.startsWith('SELECT * FROM atlas_manual.card')) return [{ id: cardId, owner_id: actorId, approvers: [], editors: [], readers: [] }];
      if (sql.startsWith('SELECT * FROM atlas_manual.publication')) return [{ action_id: actionId }];
      if (sql.includes("'RECOVERY'")) return [];
      if (sql.includes('request_actor') || sql.startsWith('SELECT request_id FROM atlas_manual.presentation_market')) return [];
      if (sql.startsWith('SELECT state FROM') || sql.startsWith('SELECT m.state')) return [];
      if (sql.includes('MAX(revision)')) return [{ revision: 0 }];
      if (sql.includes('ORDER BY created_at DESC,request_id DESC LIMIT 1')) return [old];
      if (sql.startsWith('SELECT a.source_hash')) return [{ source_hash: 'a'.repeat(64), report_hash: 'b'.repeat(64), mode: principal.mode }];
      if (sql.startsWith('SELECT * FROM atlas_manual_connected.market_job WHERE request_id')) return [inserted];
      assert.fail(sql);
    },
    async $executeRawUnsafe(sql, ...args) {
      if (sql.startsWith('INSERT INTO atlas_manual.presentation_market')) { savedRequest = JSON.parse(args[4]); return 1; }
      if (sql.startsWith('INSERT INTO atlas_manual_connected.market_job')) { inserted = { request_id: args[0], card_id: args[1], approval_action_id: args[2], origin: args[6], source_hash: args[7], report_hash: args[8], response: null, state: 'QUEUED' }; return 1; }
      updates++; assert.fail(sql);
    },
  };
  const boundary = { transaction: async (_, fn) => fn({ tx, principal }), machineTransaction: async (_, fn) => fn({ tx, principal }) };
  const result = await createMarketJobStore({ boundary }).reserve({}, cardId, { requestId, approvalActionId: actionId, expectedRevision: 0 });
  assert.equal(result.state, 'QUEUED'); assert.equal(result.origin, 'REFRESH'); assert.equal(result.approval_action_id, actionId);
  assert.deepEqual(savedRequest, { requestId, approvalActionId: actionId, expectedRevision: 0 }); assert.equal(updates, 0); assert.deepEqual(old, before);
});
