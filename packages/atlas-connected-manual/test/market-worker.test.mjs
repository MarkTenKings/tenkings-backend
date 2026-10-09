import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EbaySoldCompsV2Error, EBAY_SOLD_COMPS_V2_ENGINE_VERSION } from '@tenkings/ebay-sold-comps-v2';
import { createMarketWorker, marketProviderFailure } from '../src/market-worker.mjs';
import { marketJobStatus, marketJobGrantSQL } from '../src/market-job-store.mjs';
import { publishedMarketQuery } from '../src/presentation-market.mjs';
import { publicationFixture } from './publication-fixture.mjs';

async function setup({ providerError = null, failArtifact = false, loseResponseReceipt = false, jobs = 1, now } = {}) {
  const fixture = await publicationFixture(); await fixture.publication.publish({}, fixture.cardId, fixture.actionId);
  const manifest = JSON.parse(fixture.row.manifest);
  const packet = await fixture.artifacts.read(manifest.packet.ref, { cardId: fixture.cardId, kind: 'PUBLIC_REPORT', sourceHash: manifest.packet.sourceHash });
  const source = { packet, publicHash: fixture.row.public_hash, row: fixture.row }, context = publishedMarketQuery(source);
  let calls = 0, writes = 0, maxActive = 0, active = 0, publicationCalls = 0;
  const rows = Array.from({ length: jobs }, () => ({ request_id: randomUUID(), card_id: fixture.cardId, approval_action_id: fixture.actionId,
    state: 'QUEUED', created_at: new Date().toISOString(), attempts: 0, response: null, source_hash: fixture.row.source_hash, report_hash: fixture.row.report_hash }));
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
      if (providerError) throw providerError; return { source: 'EBAY_SOLD', engineVersion: EBAY_SOLD_COMPS_V2_ENGINE_VERSION, query: context.query, retrievedAt: new Date().toISOString(), candidates: [] }; },
    authorityFor: () => ({ machine: true }), concurrency: 2, now });
  return { worker, rows, before, fixture, calls: () => calls, writes: () => writes, maxActive: () => maxActive, publicationCalls: () => publicationCalls };
}
test('construction and GET status stay cold; automatic jobs run independently and save exact response before preview', async () => {
  const f = await setup({ jobs: 23 }); assert.equal(f.calls(), 0);
  while (f.rows.some(row => row.state === 'QUEUED')) await f.worker.drainOnce();
  assert.equal(f.rows.filter(row => row.state === 'READY').length, 23); assert.equal(f.calls(), 23);
  assert(f.maxActive() <= 2); assert.equal(f.publicationCalls(), 23);
  assert(f.rows.every(row => row.response && row.result.ref.kind === 'MARKET_PREVIEW'));
  assert.deepEqual(f.fixture.row, f.before);
});
test('artifact failure resumes from durable provider response without another search', async () => {
  const f = await setup({ failArtifact: true }); await f.worker.drainOnce();
  assert.equal(f.rows[0].state, 'QUEUED'); assert.equal(f.calls(), 1);
  await f.worker.drainOnce(); assert.equal(f.rows[0].state, 'READY'); assert.equal(f.calls(), 1); assert.equal(f.writes(), 2);
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


test('retained response expiry conclusively stops local retries and offers only explicit new search', async () => {
  let elapsed=0;const f=await setup({failArtifact:true,now:()=>new Date(Date.now()+elapsed)});
  await f.worker.drainOnce();assert.equal(f.rows[0].state,'QUEUED');const response=structuredClone(f.rows[0].response);
  elapsed=48*60*60*1000;await f.worker.drainOnce();await f.worker.drainOnce();
  assert.equal(f.rows[0].state,'FAILED');assert.equal(f.rows[0].code,'MARKET_PREVIEW_EXPIRED');
  assert.equal(f.calls(),1);assert.equal(f.writes(),1);assert.deepEqual(f.rows[0].response,response);
  const status=marketJobStatus(f.rows[0]);assert.equal(status.refreshable,true);assert.equal(status.refreshAction,'SEARCH_AGAIN');
});
