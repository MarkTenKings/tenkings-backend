import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildEbaySoldCompsV2Query, EbaySoldCompsV2Error, EBAY_SOLD_COMPS_V2_ENGINE_VERSION } from '@tenkings/ebay-sold-comps-v2';
import { createMarketWorker, marketProviderFailure } from '../src/market-worker.mjs';
import { marketJobStatus, marketJobGrantSQL, createMarketJobStore } from '../src/market-job-store.mjs';
import { publishedMarketQuery } from '../src/presentation-market.mjs';
import { publicationFixture } from './publication-fixture.mjs';

async function setup({ providerError = null, failArtifact = false, loseResponseReceipt = false, jobs = 1, now, reclassify=false, legacyResponse=false, labelMarket=async({response})=>({...response,imageMatch:{policy:'atlas-market-slab-label-v1',readings:[],counts:{}}}), queryContextResolver=null } = {}) {
  const fixture = await publicationFixture(); await fixture.publication.publish({}, fixture.cardId, fixture.actionId);
  const manifest = JSON.parse(fixture.row.manifest);
  const packet = await fixture.artifacts.read(manifest.packet.ref, { cardId: fixture.cardId, kind: 'PUBLIC_REPORT', sourceHash: manifest.packet.sourceHash });
  const source = { packet, publicHash: fixture.row.public_hash, row: fixture.row }, context = publishedMarketQuery(source);
  let calls = 0, writes = 0, maxActive = 0, active = 0, publicationCalls = 0;
  const priorInput = { ...context.input }; delete priorInput.queryOverride;
  const original={source:'EBAY_SOLD',engineVersion:EBAY_SOLD_COMPS_V2_ENGINE_VERSION,query:legacyResponse ? buildEbaySoldCompsV2Query(priorInput) : context.query,retrievedAt:new Date().toISOString(),offset:0,nextOffset:0,requestedResultCount:legacyResponse||reclassify?60:240,hasMore:false,...(legacyResponse||reclassify?{candidates:[]}:{responsePolicy:'ATLAS_SLAB_V1',items:[],acquisitionDiagnostics:{returnedItemCount:0,retainedItemCount:0,missingImageCount:0}})};
  const marker={event:'RECLASSIFY',version:'atlas-market-reclassification-v1'};
  const rows = Array.from({ length: jobs }, () => ({ request_id: randomUUID(), card_id: fixture.cardId, approval_action_id: fixture.actionId,
    state: 'QUEUED', created_at: new Date().toISOString(), attempts: 0, response: null, source_hash: fixture.row.source_hash, report_hash: fixture.row.report_hash,
    origin:reclassify?'REFRESH':'APPROVAL',audit:reclassify?[structuredClone(marker)]:[] }));
  const before = structuredClone(fixture.row);
  const store = {
    async claim() { const row = rows.find(row => row.state === 'QUEUED'); if (!row) return null;
      row.state = 'RUNNING'; row.claim_id = randomUUID(); row.attempts++; return structuredClone(row); },
    async renew() { return true; }, async bind() { return true; },
    async dispatch(job) { const row = rows.find(row => row.request_id === job.request_id); assert.equal(row.state, 'RUNNING'); assert.equal(row.response, null); row.state = 'REQUESTED'; return true; },
    async recordResponse(job, response) { const row = rows.find(row => row.request_id === job.request_id); row.response = structuredClone(response);
      if (loseResponseReceipt) { loseResponseReceipt = false; throw Error('Commit acknowledgement lost'); } return true; },
    async finish(job, outcome) { const row = rows.find(row => row.request_id === job.request_id);
      row.state = outcome.result ? 'READY' : outcome.disposition === 'RETRY' ? 'QUEUED' : outcome.disposition;
      row.result = outcome.result ?? null; row.code = outcome.code; return true; },
  };
  const worker = createMarketWorker({ store, approved: { async loadPacket() { return source; } }, publication: { async publish() { publicationCalls++; } },
    artifacts: { ...fixture.artifacts, async write(...args) { writes++; if (failArtifact) { failArtifact = false; throw Error('Object storage unavailable'); } return fixture.artifacts.write(...args); } },
    provider: async () => { calls++; active++; maxActive = Math.max(maxActive, active); await new Promise(resolve => setImmediate(resolve)); active--;
      if (providerError) throw providerError; return structuredClone(original); },
    authorityFor: () => ({ machine: true }), concurrency: 2, now, labelMarket, queryContextResolver });
  return { worker, rows, before, fixture,original, calls: () => calls, writes: () => writes, maxActive: () => maxActive, publicationCalls: () => publicationCalls };
}
test('construction and GET status stay cold; automatic jobs run independently and save exact response before preview', async () => {
  const f = await setup({ jobs: 23 }); assert.equal(f.calls(), 0);
  while (f.rows.some(row => row.state === 'QUEUED')) await f.worker.drainOnce();
  assert.equal(f.rows.filter(row => row.state === 'READY').length, 23); assert.equal(f.calls(), 23);
  assert(f.maxActive() <= 2); assert.equal(f.publicationCalls(), 23);
  assert(f.rows.every(row => row.response && row.result.ref.kind === 'MARKET_PREVIEW'));
  assert.deepEqual(f.fixture.row, f.before);
});
test('retired reclassification jobs fail without publication, projection or provider effects, even with saved responses',async()=>{
  for(const response of [null,{responsePolicy:'ATLAS_SLAB_V1',items:[]}]){
    const f=await setup({reclassify:true});f.rows[0].response=response;const before=structuredClone(f.rows[0].response);
    await f.worker.drainOnce();await f.worker.drainOnce();
    assert.equal(f.rows[0].state,'FAILED');assert.equal(f.rows[0].code,'MARKET_RECLASSIFICATION_RETIRED');
    assert.equal(f.calls(),0);assert.equal(f.writes(),0);assert.equal(f.publicationCalls(),0);assert.deepEqual(f.rows[0].response,before);
    const status=marketJobStatus(f.rows[0]);assert.equal(status.refreshable,false);assert.equal(status.refreshAction,undefined);
  }
  const store=createMarketJobStore({boundary:{machineTransaction(){throw Error('must remain cold');}}});
  for(const name of ['reclassificationPlan','reclassify','reclassificationSource','recordReclassification'])assert.equal(name in store,false);
});
test('artifact failure resumes from durable provider response without another search', async () => {
  const f = await setup({ failArtifact: true });
  f.original.acquisitionDiagnostics = { returnedItemCount: 2, examinedItemCount: 2, parsedItemCount: 0, duplicateItemCount: 0,
    structuralRejections: { NOT_OBJECT: 1, INVALID_LISTING_URL: 1, INVALID_ITEM_ID: 0, INVALID_TITLE: 0 } };
  await f.worker.drainOnce();
  assert.equal(f.rows[0].state, 'QUEUED'); assert.equal(f.calls(), 1);
  assert.deepEqual(f.rows[0].response.acquisitionDiagnostics, f.original.acquisitionDiagnostics);const response = JSON.stringify(f.rows[0].response);
  await f.worker.drainOnce(); assert.equal(f.rows[0].state, 'READY'); assert.equal(f.calls(), 1); assert.equal(f.writes(), 2);
  assert.equal(JSON.stringify(f.rows[0].response), response);assert.deepEqual(f.fixture.row, f.before);
});
test('ambiguous provider dispatch becomes UNKNOWN and worker never blindly repeats it', async () => {
  const f = await setup({ providerError: new Error('Connection lost after request') }); await f.worker.drainOnce(); await f.worker.drainOnce();
  assert.equal(f.rows[0].state, 'UNKNOWN'); assert.equal(f.calls(), 1);
});
test('lost response commit acknowledgement retains UNKNOWN and saved bytes for reconciliation', async () => {
  const f = await setup({ loseResponseReceipt: true }); await f.worker.drainOnce();
  assert.equal(f.rows[0].state, 'UNKNOWN'); assert(f.rows[0].response); assert.equal(f.calls(), 1);
  f.rows[0].state = 'QUEUED'; await f.worker.drainOnce(); assert.equal(f.rows[0].state, 'READY'); assert.equal(f.calls(), 1);
});
test('only typed explicit refusals permit retries; status hides all private job/source material', () => {
  assert.equal(marketProviderFailure(new EbaySoldCompsV2Error('SOLDCOMPS_TEMPORARY_UNAVAILABLE','safe',{statusCode:429})).disposition, 'RETRY');
  assert.equal(marketProviderFailure(new EbaySoldCompsV2Error('SOLDCOMPS_QUOTA_REACHED','safe',{statusCode:429})).disposition, 'UNAVAILABLE');
  assert.equal(marketProviderFailure(Object.assign(new Error('Not a typed provider refusal'),{statusCode:429})).disposition, 'UNKNOWN');
  assert.deepEqual(marketJobStatus(null), {state:'NOT_REQUESTED',refreshable:true});
  const status = marketJobStatus({state:'REQUESTED',request_id:'a',approval_action_id:'b',created_at:'2026-10-09T00:00:00Z',response:'private',actor_id:'private'});
  assert.equal(status.state,'SEARCHING'); assert.equal(status.refreshable,false); assert.equal(status.response,undefined); assert.equal(status.actor_id,undefined);
  const grants = marketJobGrantSQL('atlas_fixture_manual'); assert.equal(/DELETE|TRUNCATE|ALL|UPDATE ON/.test(grants), false);
  assert.throws(() => marketJobGrantSQL('bad"role'));
});


test('retained response recovery survives elapsed days without a new search', async () => {
  let elapsed=0;const f=await setup({failArtifact:true,now:()=>new Date(Date.now()+elapsed)});
  await f.worker.drainOnce();assert.equal(f.rows[0].state,'QUEUED');const response=structuredClone(f.rows[0].response);
  elapsed=48*60*60*1000;await f.worker.drainOnce();await f.worker.drainOnce();
  assert.equal(f.rows[0].state,'READY');
  assert.equal(f.calls(),1);assert.equal(f.writes(),2);assert.deepEqual(f.rows[0].response,response);
  const previousFailure={...f.rows[0],state:'FAILED',code:'MARKET_PREVIEW_EXPIRED'};assert.equal(marketJobStatus(previousFailure).refreshAction,'RETRY_SAVED_RESPONSE');
});


test('unprocessed historical responses are retained without executing the retired title-only classifier', async () => {
  const f=await setup({legacyResponse:true});f.rows[0].response=structuredClone(f.original);
  await f.worker.drainOnce();await f.worker.drainOnce();
  assert.equal(f.rows[0].state,'FAILED');assert.equal(f.rows[0].code,'MARKET_PROVIDER_POLICY_INVALID');
  assert.equal(f.calls(),0);assert.equal(f.writes(),0);assert.deepEqual(f.rows[0].response,f.original);
  assert.equal(marketJobStatus(f.rows[0]).refreshable,false);assert.equal(marketJobStatus(f.rows[0]).refreshAction,undefined);
});

test('new raw market pool is saved before labels; label retry and artifact retry reuse the one paid response', async () => {
  let labels = 0, queries = 0, f;
  f = await setup({ failArtifact: true, queryContextResolver: async () => { queries++; return null; },
    labelMarket: async ({ source, response }) => {
      labels++; assert.deepEqual(f.rows[0].response, response); assert.equal(f.calls(), 1);
      assert.equal(response.responsePolicy, 'ATLAS_SLAB_V1');
      if (labels === 1) throw Error('Label receipt temporarily unavailable');
      return { ...response, imageMatch: { policy: 'atlas-market-slab-label-v1', counts: {}, readings: [{
        rowId: 'atlas-sale:0', sha256: 'a'.repeat(64), imageUrl: response.items[0].imageUrl,
        gradingCompany: 'Any Company', numericGrade: source.packet.report.finalGrade, labelText: 'VISIBLE LABEL\nGRADE 10',
        identityMatch: 'UNCERTAIN', reason: 'Compatible abbreviated slab label', canonicalCardKey: null, canonicalPrintingKey: null }] } };
    } });
  Object.assign(f.original, { responsePolicy: 'ATLAS_SLAB_V1', items: [{ id: 'atlas-sale:0', sourceIndex: 0,
    title: 'Wrong seller title lot of cards', listingUrl: null, providerItemId: null,
    imageUrl: 'https://i.ebayimg.com/images/g/fixture/s-l1600.jpg', soldDate: null, reportedPrice: null,
    soldPriceCents: null, currency: null, priceBasis: 'UNKNOWN' }],
    acquisitionDiagnostics: { returnedItemCount: 1, retainedItemCount: 1, missingImageCount: 0 } });
  const original = structuredClone(f.original);
  await f.worker.drainOnce(); assert.equal(f.rows[0].state, 'QUEUED'); assert.deepEqual(f.rows[0].response, original);
  await f.worker.drainOnce(); assert.equal(f.rows[0].state, 'QUEUED');
  await f.worker.drainOnce(); assert.equal(f.rows[0].state, 'READY');
  assert.equal(f.calls(), 1); assert.equal(queries, 1); assert.equal(labels, 3);
  assert.deepEqual(f.rows[0].response, original); assert.deepEqual(f.fixture.row, f.before);
  const result = f.rows[0].result;
  const preview = await f.fixture.artifacts.read(result.ref, { cardId: f.fixture.cardId, kind: 'MARKET_PREVIEW', sourceHash: result.artifactHash });
  assert.equal(preview.version, 'atlas-market-preview-v2'); assert.equal(preview.candidates.length, 1);
  assert.equal(preview.candidates[0].sale.priceMinor, null); assert.equal(preview.candidates[0].sale.priceBasis, 'unknown');
});


test('new raw-pool receipt retains long fields and more than512KiB while historical response serialization stays unchanged', async () => {
  let saved;
  const store = createMarketJobStore({ boundary: { machineTransaction: async (_, work) => work({ principal: { mode: 'LOCAL_FIXTURE' },
    tx: { $executeRawUnsafe: async (_sql, _id, _claim, value) => { saved = value; return 1; } } }) } });
  const job = { request_id: randomUUID(), claim_id: randomUUID(), audit: [] };
  const response = { responsePolicy: 'ATLAS_SLAB_V1', items: Array.from({ length: 40 }, (_, i) => ({ id: `atlas-sale:${i}`, title: 'x'.repeat(20000), nullable: null })) };
  assert.equal(await store.recordResponse(job, response), true); assert.ok(Buffer.byteLength(saved) > 524288);
  assert.deepEqual(JSON.parse(saved), response);
  const legacy = { source: 'EBAY_SOLD', candidates: [] };
  await store.recordResponse(job, legacy); assert.equal(saved, JSON.stringify({ candidates: [], source: 'EBAY_SOLD' }));
  assert.throws(() => store.recordResponse(job, { responsePolicy: 'ATLAS_SLAB_V1', bad: undefined }), { code: 'MARKET_RESPONSE_INVALID' });
});

test('label processing failures stay FAILED with their real reason and retained-response recovery action', async () => {
  for (const code of ['MARKET_LABEL_OUTCOME_UNKNOWN','MARKET_LABEL_RESPONSE_REJECTED','MARKET_LABEL_RESPONSE_INVALID','MARKET_LABEL_RESPONSE_INCOMPLETE','MARKET_LABEL_READING_INVALID','MARKET_PHOTO_UNAVAILABLE']) {
    const f = await setup({ labelMarket: async () => { throw Object.assign(new Error(code), { code }); } });
    await f.worker.drainOnce(); await f.worker.drainOnce();
    assert.equal(f.rows[0].state, 'FAILED'); assert.equal(f.rows[0].code, code); assert(f.rows[0].response);
    assert.equal(f.calls(), 1); assert.equal(f.writes(), 0);
    assert.equal(marketJobStatus(f.rows[0]).refreshAction, 'RETRY_SAVED_RESPONSE');
  }
});
test('fresh provider cannot execute the historical title-only path while its exact response remains retained', async () => {
  const f = await setup({ legacyResponse: true }); await f.worker.drainOnce();
  assert.equal(f.rows[0].state, 'FAILED');
  // A historical/manual recovery can clear the last code; the saved payload is still not a slab pool.
  Object.assign(f.rows[0],{state:'QUEUED',attempts:0,code:'MARKET_RESPONSE_RECOVERED'});
  await f.worker.drainOnce();
  assert.equal(f.rows[0].state, 'FAILED'); assert.equal(f.rows[0].code, 'MARKET_PROVIDER_POLICY_INVALID');
  assert.equal(f.calls(), 1); assert.equal(f.writes(), 0); assert.deepEqual(f.rows[0].response, f.original);
});
