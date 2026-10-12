import test from 'node:test';
import assert from 'node:assert/strict';
import {canonical,digest} from '@atlas/manual-service/contract';
import {createVariantJobStore,variantJobKey} from '../src/variant-job-store.mjs';
import {prepareVariantListingRequest} from '../src/variant-listing-provider.mjs';
import {variantIdentity} from './variant-fixture.mjs';

function fixture({historical=null,generation=null,identity=variantIdentity,storedIdentity=identity,initial=false,printing={name:'Base',language:null},historicalPhotoPool=false}={}){
 const listingGeneration=initial?null:generation;
 const input={cardId:'04c3c3e1-4a66-4912-93cc-26dc534f6cb2',identity:storedIdentity,sourceHash:digest('source'),identityHash:digest('identity'),identityRevision:1,...(generation?{generation}:{}),...(initial?{reuseJobKey:null}:{})};
 const text=canonical(input),job={key:variantJobKey(input),card_id:input.cardId,source_hash:input.sourceHash,identity_hash:input.identityHash,identity_revision:1,
  generation:generation??'00000000-0000-0000-0000-000000000000',input:text,input_hash:digest(text),claim_id:'claim',state:'RUNNING'};
 const rows=new Map(),writes=[];
 const put=(key,value)=>{const snapshot=canonical(value);rows.set(key,{snapshot,snapshot_hash:digest(snapshot)});};
 const old=prepareVariantListingRequest(identity,printing,{generation:listingGeneration});
 const reservation={schemaVersion:'variant-listing-dispatch/v1',request:old,dispatchId:'old-dispatch',jobKey:'deleted-original-card-job',claimId:'old-claim',reservedAt:'2026-10-10T00:00:00.000Z'};
 if(historical){put(`variant-listing-dispatch:v1:${old.requestKey}`,reservation);
  if(historical==='saved')put(`variant-listing-response:v1:${old.requestKey}`,{schemaVersion:'variant-listing-source-journal/v1',sourceSchemaVersion:'variant-listing-response/v1',dispatchId:reservation.dispatchId,
   reservationHash:digest(canonical(reservation)),requestKey:old.requestKey,url:old.url,httpStatus:200,contentType:'application/json',bodyText:'{}',sha256:digest('{}'),capturedAt:'2026-10-10T00:00:00.000Z'});
 }
 const tx={async $executeRawUnsafe(sql,...args){writes.push({sql,args});if(sql.startsWith('INSERT INTO atlas_manual_connected.variant_catalog_cache'))rows.set(args[0],{snapshot:args[1],snapshot_hash:args[2]});return 1;},
  async $queryRawUnsafe(sql,key){if(sql.includes('variant_catalog_cache'))return rows.has(key)?[rows.get(key)]:[];assert.match(sql,/SELECT j\.\* FROM atlas_manual_connected.variant_job/);assert.equal(key,job.key);return [job];}};
 const store=createVariantJobStore({boundary:{machineTransaction:async(_,work)=>work({tx})}});
 const request=prepareVariantListingRequest(identity,printing,{graded:true,...(listingGeneration?{generation:listingGeneration}:{})});
 return {store,job:{...job,input},request,old,rows,writes};
}

test('ordinary acquisition reuses exact historical paid source independent of its physical card',async()=>{
 const f=fixture({historical:'saved'}),before=[...f.rows];
 const result=await f.store.reserveListingSource(f.job,f.request);
 assert.equal(result.state,'REUSED');assert.equal(result.source.requestKey,f.old.requestKey);assert.equal(result.source.requestKey,f.old.requestKey);
 assert.deepEqual([...f.rows],before);assert(!f.writes.some(w=>w.sql.startsWith('INSERT')));
});
test('read-only probes return MISSING or exact historical state without journal or audit writes',async()=>{
 for(const historical of [null,'saved','unknown']){
  const f=fixture({historical}),before=[...f.rows],result=await f.store.reserveListingSource(f.job,f.request,{retainedOnly:true});
  assert.equal(result.state,historical==='saved'?'REUSED':historical==='unknown'?'UNKNOWN':'MISSING');
  assert.deepEqual([...f.rows],before);assert(f.writes.every(w=>w.sql.startsWith('SELECT pg_advisory_xact_lock')));
  if(historical==='saved')assert.equal(result.source.requestKey,f.old.requestKey);
 }
});
test('unknown historical dispatch cannot become a fresh paid request under the new revision',async()=>{
 const f=fixture({historical:'unknown'}),result=await f.store.reserveListingSource(f.job,f.request);
 assert.equal(result.state,'UNKNOWN');assert(!f.writes.some(w=>w.sql.startsWith('INSERT')));
});
test('new acquisition and deliberate refresh reserve only the unrestricted 240-row query',async()=>{
 for(const options of [{},{generation:'7b109de3-c117-49d8-81aa-1221b735b8cb'}]){
  const f=fixture(options),result=await f.store.reserveListingSource(f.job,f.request);
  assert.equal(result.state,'RESERVED');assert.deepEqual(result.reservation.request,f.request);
  assert.doesNotMatch(f.request.query,/graded$/);assert.doesNotMatch(f.request.query,/PSA|CGC|BGS|SGC/);assert.equal(new URL(f.request.url).searchParams.get('count'),'240');
  const again=await f.store.reserveListingSource(f.job,f.request);assert.equal(again.state,'UNKNOWN','A reservation is never sent twice');
  await assert.rejects(f.store.reserveListingSource(f.job,{...f.old,revision:'retired'}),{code:'VARIANT_LISTING_REQUEST_CHANGED'});
 }
});
test('unknown-year manufacturer listing reservation independently verifies exact retained card, year and printing',async()=>{
 const identity={category:'SPORTS',name:'LaMelo Ball',year:'2025-26',setName:'Topps Chrome — Ball of Duty',cardNumber:'BD-13',manufacturer:'Topps',language:null};
 const storedIdentity={...identity,year:null},printing={name:'BALL OF DUTY',language:null};
 const f=fixture({identity,storedIdentity,printing}),result=await f.store.reserveListingSource(f.job,f.request);
 assert.equal(result.state,'RESERVED');assert.equal(result.reservation.request.requestKey,prepareVariantListingRequest(identity,printing,{graded:true}).requestKey);
 assert.equal(result.reservation.identityEvidence.length,1);assert.equal(result.reservation.identityEvidence[0].source.sha256,'d63c903fd5609901be188aca3424830c50d4e75c5dca77cf7c4ca1d98abac955');
 assert.equal(f.job.input.identity.year,null);
 for(const patch of [{year:'2024-25'},{name:'Lonzo Ball'},{cardNumber:'BD-14'},{manufacturer:'Panini'}]){
  const invalid=prepareVariantListingRequest({...identity,...patch},printing,{graded:true});
  await assert.rejects(f.store.reserveListingSource(f.job,invalid),{code:'VARIANT_LISTING_REQUEST_CHANGED'});
 }
 await assert.rejects(f.store.reserveListingSource(f.job,prepareVariantListingRequest(identity,{...printing,name:'Invented Gold'}, {graded:true})),{code:'VARIANT_LISTING_REQUEST_CHANGED'});
 assert.equal(f.writes.filter(w=>w.sql.startsWith('INSERT')).length,1);
 const reused=fixture({identity,storedIdentity,printing,historical:'saved'});
 assert.equal((await reused.store.reserveListingSource(reused.job,reused.request)).state,'REUSED');assert(!reused.writes.some(w=>w.sql.startsWith('INSERT')));
});
test('initial reference preparation keeps ordinary source keys despite its durable browser generation',async()=>{
 const generation='7b109de3-c117-49d8-81aa-1221b735b8cb',f=fixture({generation,initial:true,historical:'saved'});
 assert.equal(f.request.generation,undefined);assert.equal((await f.store.reserveListingSource(f.job,f.request)).state,'REUSED');
 assert(!f.writes.some(w=>w.sql.startsWith('INSERT')));
 await assert.rejects(f.store.reserveListingSource(f.job,prepareVariantListingRequest(variantIdentity,{name:'Base',language:null},{graded:true,generation})),{code:'VARIANT_LISTING_REQUEST_CHANGED'});
});
