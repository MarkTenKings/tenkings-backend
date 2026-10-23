import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { canonical, digest } from '@atlas/manual-service/contract';
import { createServingCompCuration } from '../scripts/comp-runtime.mjs';
import { nativeCompRuntimeFixture, deferred } from './fixtures/comp-curation-runtime-fixture.mjs';
import { createPresentationMarket, publishedMarketQuery } from '../src/presentation-market.mjs';

async function fixture({ evidenceSelection = false, archiveCompAccess = false, designationReviewsEnabled = false } = {}) {
  let env, source, f; const dbInputs = [], storageInputs = [], commands = []; let destroyed = 0;
  class Get { constructor(input) { this.input = input; } }
  class Storage {
    constructor(input) { storageInputs.push(input); }
    async send(command, { abortSignal }) {
      assert(command instanceof Get); commands.push(command.input); abortSignal.throwIfAborted();
      const saved = f.records.get(command.input.Key); assert(saved, command.input.Key);
      return { ContentLength: saved.bytes.length, ContentType: saved.contentType,
        Metadata: { 'atlas-manual-lineage-sha256': saved.lineageSha256 }, Body: Readable.from([saved.bytes]) };
    }
    destroy() { destroyed++; }
  }
  f = await nativeCompRuntimeFixture({ evidenceSelection, archiveCompAccess, runtimeFactory(options) {
    source = options;
    env = { ATLAS_STAFF_COMP_CURATION: '1', ATLAS_COMP_DATABASE_URL: options.settings.databaseUrl,
      ATLAS_COMP_DATABASE_ROLE: options.settings.role, ATLAS_COMP_SCHEMA_OWNER: options.settings.schemaOwner,
      ATLAS_COMP_SCHEMA_SHA256: options.settings.schemaSha256, ATLAS_MANUAL_SERVICE_KEY: options.settings.transportKey.toString('base64'),
      ATLAS_COMP_STORAGE_ENDPOINT: 'https://objects.invalid', ATLAS_COMP_STORAGE_REGION: 'synthetic', ATLAS_COMP_STORAGE_BUCKET: 'synthetic-comp',
      ATLAS_COMP_STORAGE_PREFIX: 'atlas-manual-artifacts/v1', ATLAS_COMP_STORAGE_ACCESS_KEY: 'comp-read-access', ATLAS_COMP_STORAGE_SECRET_KEY: 'comp-read-secret-value',
      ...(evidenceSelection ? {ATLAS_COMP_GUARD_VERSION:'EVIDENCE_SELECTION_V1',ATLAS_COMP_EVIDENCE_SELECTION:'1'} : {}),
      ...(archiveCompAccess ? {ATLAS_COMP_ARCHIVE_ACCESS:'1'} : {}),
      ...(designationReviewsEnabled ? {ATLAS_COMP_DESIGNATION_REVIEWS:'1',ATLAS_STAFF_ARCHIVE_COMP_SEARCH:'1'} : {}),
      ATLAS_MANUAL_STORAGE_ACCESS_KEY: 'different-manual', ATLAS_MANUAL_STORAGE_SECRET_KEY: 'different-manual-secret' };
    class Client { constructor(input) {
      dbInputs.push(input); return options.createClient({ databaseUrl: options.settings.databaseUrl });
    } }
    return createServingCompCuration({ env, auth: options.auth, staffConfig: options.staffConfig,
      Client, nonceStore: options.nonceStore, ObjectClient: Storage, ReadCommand: Get });
  } });
  // Replace only the test's abbreviated market reference with actual immutable
  // artifact-store output so this test crosses the real read-only byte boundary.
  const artifactHash = digest(JSON.stringify(f.preview));
  const ref = await f.artifacts.write(f.preview, { cardId: f.cardId, kind: 'MARKET_PREVIEW', sourceHash: artifactHash });
  f.market.result = canonical({ ...JSON.parse(f.market.result), ref }); f.market.result_hash = digest(f.market.result);
  return { ...f, env, source, dbInputs, storageInputs, commands, get destroyed() { return destroyed; } };
}

test('actual host maps separate lazy bounded clients through signed auth, verified artifacts and saved private receipt', async () => {
  const f = await fixture(); assert.equal(f.dbInputs.length, 0); assert.equal(f.storageInputs.length, 0);
  const read = await f.request(); assert.equal(read.statusCode, 200); assert.equal(read.body.result.availability, 'POLICY_REQUIRED');
  const decision = await f.request(f.decision('NO_SUITABLE_COMPS'));
  assert.equal(decision.statusCode, 200); assert.equal(decision.body.result.outcome, 'NO_SUITABLE_COMPS'); assert.equal(f.rows.length, 1);
  assert.equal(f.dbInputs.length, 1); const url = new URL(f.dbInputs[0].datasources.db.url);
  assert.equal(url.searchParams.get('connection_limit'), '2'); assert.equal(url.searchParams.get('pool_timeout'), '3'); assert.equal(url.searchParams.get('connect_timeout'), '5');
  assert.equal(f.storageInputs.length, 1); assert.equal(f.storageInputs[0].credentials.accessKeyId, 'comp-read-access');
  assert(f.commands.length > 0); assert(f.commands.every(command => /^atlas-manual-artifacts\/v1\/.+\/(PUBLIC_REPORT|MARKET_PREVIEW)\//.test(command.Key)));
  await f.runtime.close(); await f.runtime.close(); assert.equal(f.counts.disconnect, 1); assert.equal(f.destroyed, 1);
});

test('default-off designation review crosses the host/private runtime only with explicit evidence/archive flags', async () => {
  for(const enabled of [false,true]) {
    const f=await fixture({evidenceSelection:true,archiveCompAccess:true,designationReviewsEnabled:enabled});
    try {
      const source={packet:f.packet,publicHash:f.row.public_hash},context=publishedMarketQuery(source);
      const item={id:'host-designation:1',title:'SYNTHETIC saved sale',listingUrl:'https://www.ebay.com/itm/123456789701',
        imageUrl:'https://i.ebayimg.com/images/g/hostfixture/s-l1600.jpg',soldDate:'2026-10-19',soldPriceCents:1000,currency:'USD',priceBasis:'EXACT'};
      const projected=createPresentationMarket().project(source,{responsePolicy:'ATLAS_SLAB_V1',source:'EBAY_SOLD',engineVersion:'ebay-sold-comps-v2.3.0',
        query:context.query,retrievedAt:'2026-10-20T12:00:00.000Z',items:[item],acquisitionDiagnostics:{returnedItemCount:1},
        imageMatch:{policy:'atlas-market-slab-label-v1',counts:{},readings:[{rowId:item.id,imageUrl:item.imageUrl,sha256:'1'.repeat(64),
          evidenceKind:'SLABBED',identityMatch:'MATCH',numericGrade:9,gradingCompany:'PSA',labelText:'SYNTHETIC PSA MINT 9',reason:'Synthetic only'}]}});
      for(const key of Object.keys(f.preview))delete f.preview[key];Object.assign(f.preview,projected.preview);f.savePreview();
      const artifactHash=digest(JSON.stringify(f.preview)),ref=await f.artifacts.write(f.preview,{cardId:f.cardId,kind:'MARKET_PREVIEW',sourceHash:artifactHash});
      f.market.result=canonical({...JSON.parse(f.market.result),ref});f.market.result_hash=digest(f.market.result);
      const read=await f.request();assert.equal(read.statusCode,200);const state=read.body.result,row=state.preview.candidates[0];
      assert.equal(Boolean(row.designationReview),enabled);assert.equal(row.designation,null);assert.equal(row.eligible,false);
      if(enabled){
        const input=f.input({expectedPolicyHash:state.policyHash,selectedIds:[row.id],reviewedIds:[row.id],designationReviews:{
          version:'atlas-comp-designation-reviews-v1',rows:[{id:row.id,designation:'STANDARD',photoSha256:row.designationReview.photoSha256,proofHash:row.designationReview.proofHash}]}});
        const saved=await f.request(input);assert.equal(saved.statusCode,200);assert.equal(saved.body.result.guidance,null);
        assert.equal(saved.body.result.selected[0].designationEvidence.authority,'HUMAN_REVIEWED');assert.equal(f.rows.length,1);
      }else assert.equal(f.rows.length,0);
    }finally{await f.runtime.close();}
  }
});

test('designation host flag rejects malformed/missing prerequisites and mutation during admitted work',async()=>{
  const f=await fixture();await f.runtime.close();
  for(const patch of [{ATLAS_COMP_DESIGNATION_REVIEWS:'true'},{ATLAS_COMP_DESIGNATION_REVIEWS:'1'},
    {ATLAS_COMP_DESIGNATION_REVIEWS:'1',ATLAS_COMP_GUARD_VERSION:'EVIDENCE_SELECTION_V1',ATLAS_COMP_EVIDENCE_SELECTION:'1'},
    {ATLAS_COMP_DESIGNATION_REVIEWS:'1',ATLAS_COMP_GUARD_VERSION:'EVIDENCE_SELECTION_V1',ATLAS_COMP_EVIDENCE_SELECTION:'1',ATLAS_COMP_ARCHIVE_ACCESS:'1'}]){
    assert.throws(()=>createServingCompCuration({env:{...f.env,...patch},auth:f.auth,staffConfig:f.config,
      Client(){assert.fail('No client');},nonceStore:f.source.nonceStore}),{code:'COMP_NOT_CONFIGURED'});
  }
  const g=await fixture({evidenceSelection:true,archiveCompAccess:true,designationReviewsEnabled:true}),entered=deferred(),resume=deferred();
  try{
    g.hooks.transaction=async()=>{entered.resolve();await resume.promise;};const pending=g.request();await entered.promise;
    g.env.ATLAS_COMP_DESIGNATION_REVIEWS='0';resume.resolve();assert.equal((await pending).statusCode,503);assert.equal(g.rows.length,0);
  }finally{await g.runtime.close();}
});

test('captured host environment drift across a real transaction wait refuses content and any private write', async () => {
  const f = await fixture(), entered = deferred(), resume = deferred();
  f.hooks.transaction = async () => { entered.resolve(); await resume.promise; };
  const pending = f.request(f.decision()); await entered.promise;
  f.env.ATLAS_COMP_STORAGE_SECRET_KEY = 'changed-secret-value'; resume.resolve();
  const reply = await pending; assert.equal(reply.statusCode, 503); assert.deepEqual(Object.keys(reply.body), ['error']); assert.equal(f.rows.length, 0);
  await f.runtime.close(); assert.equal(f.counts.disconnect, 1);
});

test('host close drains admitted work, refuses successors and leaves shared auth client intact', async () => {
  const f = await fixture(), entered = deferred(), resume = deferred();
  f.hooks.transaction = async () => { entered.resolve(); await resume.promise; };
  const pending = f.request(); await entered.promise; const closing = f.runtime.close();
  assert.equal(f.runtime.configuredForDisplay, false); assert.equal((await f.request()).statusCode, 503);
  assert.equal(f.counts.disconnect, 0); resume.resolve(); assert.equal((await pending).statusCode, 200);
  await closing; assert.equal(f.counts.disconnect, 1); assert.equal(f.destroyed, 1); assert.equal(typeof f.auth.database.transaction, 'function');
});

test('reusing grading storage credentials is refused before constructing a client', async () => {
  const f = await fixture(); await f.runtime.close();
  const env = { ...f.env, ATLAS_COMP_STORAGE_ACCESS_KEY: f.env.ATLAS_MANUAL_STORAGE_ACCESS_KEY };
  assert.throws(() => createServingCompCuration({ env, auth: f.auth, staffConfig: f.config,
    Client() { assert.fail('client must remain uncreated'); }, nonceStore: f.source.nonceStore }), { code: 'COMP_NOT_CONFIGURED' });
  assert.equal(f.dbInputs.length, 0); assert.equal(f.storageInputs.length, 0);
});


test('explicit evidence/archive host flags forward the exact private candidate policy through signed transport', async () => {
  const f=await fixture({evidenceSelection:true,archiveCompAccess:true});
  try {
    const read=await f.request();assert.equal(read.statusCode,200);assert.equal(read.body.result.policy.recencyDays,null);
    const request=f.input({expectedPolicyHash:read.body.result.policyHash}), saved=await f.request(request);
    assert.equal(saved.statusCode,200);assert.equal(saved.body.result.guidance,null);assert.equal(f.rows.length,1);
    assert.deepEqual((await f.request(request)).body,saved.body);
  } finally {await f.runtime.close();}
});

test('host opt-ins reject malformed flags/missing candidate guard and remain pinned across waits', async () => {
  const f=await fixture();await f.runtime.close();
  for(const patch of [{ATLAS_COMP_EVIDENCE_SELECTION:'true'},{ATLAS_COMP_ARCHIVE_ACCESS:'true'},
    {ATLAS_COMP_EVIDENCE_SELECTION:'1'}, {ATLAS_COMP_EVIDENCE_SELECTION:'1',ATLAS_COMP_GUARD_VERSION:'SQL011'}]) {
    assert.throws(()=>createServingCompCuration({env:{...f.env,...patch},auth:f.auth,staffConfig:f.config,
      Client(){assert.fail('No client');},nonceStore:f.source.nonceStore}),{code:'COMP_NOT_CONFIGURED'});
  }
  for(const name of ['ATLAS_COMP_GUARD_VERSION','ATLAS_COMP_EVIDENCE_SELECTION','ATLAS_COMP_ARCHIVE_ACCESS']) {
    const g=await fixture({evidenceSelection:true,archiveCompAccess:true}),entered=deferred(),resume=deferred();
    g.hooks.transaction=async()=>{entered.resolve();await resume.promise;};
    const pending=g.request();await entered.promise;g.env[name]='0';resume.resolve();
    assert.equal((await pending).statusCode,503);assert.equal(g.rows.length,0);await g.runtime.close();
  }
});
