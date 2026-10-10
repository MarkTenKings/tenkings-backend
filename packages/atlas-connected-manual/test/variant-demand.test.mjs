import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonicalJson, catalogDemandKey, catalogDemandResultHash } from '@tenkings/card-catalog-evidence';
import { variantChoicesFromDemand } from '../src/variant-demand.mjs';
import { createVariantCatalogService } from '../src/variant-catalog.mjs';
import { createAtlasCatalogClient } from '../src/research-catalog.mjs';
const hash=value=>createHash('sha256').update(canonicalJson(value)).digest('hex');
const demand={category:'SPORTS',year:'2024',manufacturer:'Topps',setName:'Chrome',language:null};
const identity={...demand,name:'Synthetic Player',cardNumber:'025'};
function fixture(state='READY') {
  const source={url:'https://www.topps.com/files/2024-chrome.pdf',sha256:'a'.repeat(64),kind:'manufacturer',byteSize:20};
  source.sourceId=hash({url:source.url,sha256:source.sha256});
  const result={schemaVersion:'catalog-demand-result/v1',demandKey:catalogDemandKey(demand),demand,state,attempt:1,coverage:'partial',sources:[source],
    choices:[{rowId:'b'.repeat(64),identity,parallel:'Gold Refractor /50',sourceId:source.sourceId,locator:'row:1',diagnostics:['Read the physical stamped serial and foil pattern.']}],
    context:[{parallel:'Superfractor',program:'Chrome inserts',serial:'1/1',sourceId:source.sourceId,locator:'program:2'}],
    problems:[],capturedAt:'2026-10-09T00:00:00.000Z',snapshotHash:''};
  result.snapshotHash=catalogDemandResultHash(result);return result;
}
test('literal card rows remain unreviewed; program-level parallels never become card choices',()=>{
  const choices=variantChoicesFromDemand(fixture(),{...identity,cardNumber:'25'});
  assert.equal(choices.length,1);assert.equal(choices[0].parallel,'Gold Refractor /50');
  assert.equal(choices[0].authority,'provider_candidate');assert.equal(choices[0].applicability,'unknown');
  assert.equal(choices[0].canonical,null);assert.deepEqual(choices[0].images,[]);
  assert.deepEqual(variantChoicesFromDemand(fixture(),{...identity,name:'Another Player'}),[]);
  assert.deepEqual(variantChoicesFromDemand(fixture(),{...identity,cardNumber:'RC25'}),[]);
  assert.throws(()=>variantChoicesFromDemand(fixture(),{...identity,year:'2025'}),{code:'VARIANT_DEMAND_MISMATCH'});
});
test('set demand sends only public descriptors and refuses another set result',async()=>{
  let sent;
  const client=createAtlasCatalogClient({token:'s'.repeat(43),fetchImpl:async(url,options)=>{
    assert.equal(url,'https://collect.tenkings.co/api/internal/card-catalog/v1/demand');assert.equal(options.redirect,'error');
    sent=JSON.parse(options.body);return Response.json({schemaVersion:'card-catalog-service/v1',result:fixture()});
  }});
  await client.prepareSetDemand({demand:{...demand,cardId:'private-card',sourceHash:'private-source'},card:{name:identity.name,cardNumber:identity.cardNumber,photo:'private-photo'}});
  assert.deepEqual(sent,{demand,card:{name:identity.name,cardNumber:identity.cardNumber}});
  await assert.rejects(client.prepareSetDemand({demand:{...demand,year:'2025'},card:identity}),{code:'RESEARCH_CATALOG_INVALID'});
});
test('shared pending acquisition retries before pinning empty evidence; ready rows combine with provider choices',async()=>{
  let state='RUNNING',calls=0;
  const client={findCurrentSetCatalogPublications:async()=>[],prepareSetDemand:async()=>{calls++;return fixture(state);}};
  const service=createVariantCatalogService({catalogClient:client,providers:[]});
  await assert.rejects(service.prepare({identity}),{code:'VARIANT_CATALOG_PENDING'});
  state='READY';const snapshot=await service.prepare({identity});assert.equal(calls,2);assert.equal(snapshot.candidates.length,1);
  assert.ok(snapshot.problems.includes('NO_DIAGNOSTIC_PHOTOS'));
});
