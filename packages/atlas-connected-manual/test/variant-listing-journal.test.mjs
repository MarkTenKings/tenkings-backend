import test from 'node:test';
import assert from 'node:assert/strict';
import {canonical,digest} from '@atlas/manual-service/contract';
import {createVariantJobStore,variantJobKey} from '../src/variant-job-store.mjs';
import {prepareVariantListingRequest,VARIANT_LISTING_REVISION,VARIANT_LISTING_LEGACY_REVISION} from '../src/variant-listing-provider.mjs';
import {variantIdentity} from './variant-fixture.mjs';
import {createVariantCatalogService} from '../src/variant-catalog.mjs';

function fixture({historical=null,generation=null,identity=variantIdentity,storedIdentity=identity,initial=false,printing={name:'Base',language:null},historicalPhotoPool=false,historicalIdentity=identity,historicalRevision=VARIANT_LISTING_REVISION}={}){
 const listingGeneration=initial?null:generation;
 const input={cardId:'04c3c3e1-4a66-4912-93cc-26dc534f6cb2',identity:storedIdentity,sourceHash:digest('source'),identityHash:digest('identity'),identityRevision:1,...(generation?{generation}:{}),...(initial?{reuseJobKey:null}:{})};
 const text=canonical(input),job={key:variantJobKey(input),card_id:input.cardId,source_hash:input.sourceHash,identity_hash:input.identityHash,identity_revision:1,
  generation:generation??'00000000-0000-0000-0000-000000000000',input:text,input_hash:digest(text),claim_id:'claim',state:'RUNNING'};
 const rows=new Map(),writes=[];
 const put=(key,value)=>{const snapshot=canonical(value);rows.set(key,{snapshot,snapshot_hash:digest(snapshot)});};
 const old=prepareVariantListingRequest(historicalIdentity,printing,{generation:listingGeneration,revision:historicalRevision});
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
test('v3 ordinary and refresh journals are readable with exact bytes but can never reserve a new dispatch',async()=>{
 for(const generation of [null,'7b109de3-c117-49d8-81aa-1221b735b8cb'])for(const historical of ['saved','unknown']){
  const f=fixture({historical,generation,historicalRevision:VARIANT_LISTING_LEGACY_REVISION}),before=JSON.stringify([...f.rows]);
  const result=await f.store.reserveListingSource(f.job,f.old,{retainedOnly:true});
  assert.equal(result.state,historical==='saved'?'REUSED':'UNKNOWN');
  if(historical==='saved')assert.equal(result.source.requestKey,f.old.requestKey);
  await assert.rejects(f.store.reserveListingSource(f.job,f.old),{code:'VARIANT_LISTING_REQUEST_CHANGED'});
  assert.equal(JSON.stringify([...f.rows]),before);assert(f.writes.every(w=>w.sql.startsWith('SELECT pg_advisory_xact_lock')));
 }
});
test('v4 reservation preserves saved collector typography instead of substituting a matching catalog spelling',async()=>{
 const identity={category:'POKEMON',name:'Mewtwo',year:'2016',setName:'Evolutions',cardNumber:'051/108',manufacturer:null,language:null};
 const f=fixture({identity}),changed=prepareVariantListingRequest({...identity,cardNumber:'51/108'});
 await assert.rejects(f.store.reserveListingSource(f.job,changed),{code:'VARIANT_LISTING_REQUEST_CHANGED'});
 assert.equal(f.writes.length,0);assert.equal((await f.store.reserveListingSource(f.job,f.request)).state,'RESERVED');
 assert.equal(f.request.query,'Pokémon 2016 Evolutions Mewtwo #051/108');
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
test('unknown-year identity reservation independently verifies retained card/year and all source printing members',async()=>{
 const identity={category:'SPORTS',name:'LaMelo Ball',year:'2025-26',setName:'Topps Chrome — Ball of Duty',cardNumber:'BD-13',manufacturer:'Topps',language:null};
 const storedIdentity={...identity,year:null},printing={name:'BALL OF DUTY',language:null};
 const f=fixture({identity,storedIdentity,printing}),result=await f.store.reserveListingSource(f.job,f.request);
 assert.equal(result.state,'RESERVED');assert.equal(result.reservation.request.requestKey,prepareVariantListingRequest(identity,printing,{graded:true}).requestKey);
 assert.equal(result.reservation.identityEvidence.length,16);assert.equal(new Set(result.reservation.identityEvidence.map(c=>c.candidateId)).size,16);
 assert(result.reservation.identityEvidence.some(c=>c.source.sha256==='d63c903fd5609901be188aca3424830c50d4e75c5dca77cf7c4ca1d98abac955'));
 assert.equal(f.job.input.identity.year,null);
 for(const patch of [{year:'2024-25'},{name:'Lonzo Ball'},{cardNumber:'BD-14'},{manufacturer:'Panini'}]){
  const invalid=prepareVariantListingRequest({...identity,...patch},printing,{graded:true});
  await assert.rejects(f.store.reserveListingSource(f.job,invalid),{code:'VARIANT_LISTING_REQUEST_CHANGED'});
 }
 await assert.rejects(f.store.reserveListingSource(f.job,prepareVariantListingRequest(identity,{...printing,name:'Invented Gold'}, {revision:VARIANT_LISTING_LEGACY_REVISION}),{retainedOnly:true}),{code:'VARIANT_LISTING_REQUEST_CHANGED'});
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

const jordan={category:'SPORTS',name:'Michael Jordan',year:'1992-93',setName:'Fleer',cardNumber:'273',manufacturer:'Fleer',language:null};
test('source-season journals replay exact historical bare/full requests in either submission direction, preserving raw bytes (fixture SQL only)',async()=>{
 for(const [storedYear,oldYear] of [['1992-93','1992'],['1992','1992-93']]){
  const f=fixture({identity:jordan,storedIdentity:{...jordan,year:storedYear},historicalIdentity:{...jordan,year:oldYear},printing:{name:'Slam Dunk',language:null},historical:'saved',historicalRevision:VARIANT_LISTING_LEGACY_REVISION}),before=JSON.stringify([...f.rows]),replayed=[];
  const catalog=createVariantCatalogService({cache:f.store.cache,listingProvider:{fetchSource:()=>assert.fail('No paid HTTP'),acquireImages:async({request,source},{retainedOnly})=>{assert(retainedOnly);assert.deepEqual(request,f.old);assert.equal(source.requestKey,f.old.requestKey);assert.equal(source.bodyText,'{}');replayed.push(request.requestKey);return {referencePhotos:[]};}}});
  const snapshot=await catalog.prepare(f.job.input,{executeListingSource:async(request,_dispatch,{retainedOnly}={})=>{assert(retainedOnly,'No new source reservation');return f.store.reserveListingSource(f.job,request,{retainedOnly});}});
  assert.equal(replayed.length,1);assert.equal(snapshot.candidates.length,1);assert.equal(JSON.stringify([...f.rows]),before);assert(f.writes.every(w=>w.sql.startsWith('SELECT pg_advisory_xact_lock')));
 }
});
test('old bare-year UNKNOWN remains unknown under the canonical season and cannot cause another paid dispatch',async()=>{
 const f=fixture({identity:jordan,historicalIdentity:{...jordan,year:'1992'},printing:{name:'Slam Dunk',language:null},historical:'unknown',historicalRevision:VARIANT_LISTING_LEGACY_REVISION}),before=JSON.stringify([...f.rows]);
 const catalog=createVariantCatalogService({cache:f.store.cache,listingProvider:{fetchSource:()=>assert.fail('No paid HTTP'),acquireImages:()=>assert.fail('No response exists')}});
 const snapshot=await catalog.prepare(f.job.input,{executeListingSource:async(request,_dispatch,{retainedOnly}={})=>{assert(retainedOnly,'An unknown old transport cannot be bypassed');return f.store.reserveListingSource(f.job,request,{retainedOnly});}});
 assert(snapshot.problems.includes('LISTING_SOURCE_OUTCOME_UNKNOWN'));assert.equal(JSON.stringify([...f.rows]),before);assert(!f.writes.some(w=>w.sql.startsWith('INSERT')));
});
test('corrupt retained season response surfaces unavailability and cannot silently become MISSING',async()=>{
 const f=fixture({identity:jordan,historicalIdentity:{...jordan,year:'1992'},printing:{name:'Slam Dunk',language:null},historical:'saved',historicalRevision:VARIANT_LISTING_LEGACY_REVISION});
 const row=f.rows.get(`variant-listing-response:v1:${f.old.requestKey}`);row.snapshot_hash='f'.repeat(64);
 const catalog=createVariantCatalogService({cache:f.store.cache,listingProvider:{fetchSource:()=>assert.fail('No replacement paid request'),acquireImages:()=>assert.fail('Corrupt journal cannot be replayed')}});
 const snapshot=await catalog.prepare(f.job.input,{executeListingSource:async(request,_dispatch,{retainedOnly}={})=>{assert(retainedOnly);return f.store.reserveListingSource(f.job,request,{retainedOnly});}});
 assert(snapshot.problems.includes('LISTING_SOURCE_UNAVAILABLE'));assert(!f.writes.some(w=>w.sql.startsWith('INSERT')));
});
test('new requests use resolved season; historical bare-year spelling is admitted for read-only probes only',async()=>{
 const f=fixture({identity:jordan,storedIdentity:{...jordan,year:'1992'},printing:{name:'Slam Dunk',language:null}});
 const canonical=await f.store.reserveListingSource(f.job,f.request);assert.equal(canonical.state,'RESERVED');assert.equal(canonical.reservation.request.identity.year,'1992-93');assert.equal(canonical.reservation.identityEvidence.length,1);
 const literal=prepareVariantListingRequest({...jordan,year:'1992'},{name:'Slam Dunk',language:null});
 assert.equal((await f.store.reserveListingSource(f.job,literal,{retainedOnly:true})).state,'MISSING');
 await assert.rejects(f.store.reserveListingSource(f.job,literal),{code:'VARIANT_LISTING_REQUEST_CHANGED'});
 assert.equal(f.writes.filter(w=>w.sql.startsWith('INSERT')).length,1);
});
test('a source-declared exact-year collision never probes a bare-year journal, and refresh generation remains explicit',async()=>{
 const {createManufacturerChecklistVariantProvider}=await import('../../card-catalog-evidence/src/manufacturer-checklist.mjs');
 const source={manufacturer:'Fleer',sport:'basketball',year:'1992-93',setName:'Fleer',aliases:[],url:'https://example.com/retained',sha256:'a'.repeat(64)};
 const rows={schemaVersion:'manufacturer-checklist/v1',complete:false,sources:[source,{...source,year:'1992',sha256:'b'.repeat(64)}],rows:[[0,'Slam Dunk','273','Michael Jordan','row:1'],[1,'Other Release','273','Michael Jordan','row:2']]};
 const provider=createManufacturerChecklistVariantProvider({catalog:rows}),calls=[];
 const service=createVariantCatalogService({providers:[provider],listingProvider:{acquireImages:async()=>({referencePhotos:[]})}});
 const generation='7b109de3-c117-49d8-81aa-1221b735b8cb';
 await service.prepare({identity:jordan,generation},{executeListingSource:async(request,_dispatch,{retainedOnly}={})=>{calls.push({request,retainedOnly});return retainedOnly?{state:'MISSING'}:{state:'SAVED',source:{sha256:'c'.repeat(64)}};}});
 assert.equal(calls.length,5);assert(calls.every(c=>c.request.identity.year==='1992-93'));assert.equal(calls.filter(c=>!c.retainedOnly).length,1);
 assert.equal(calls[0].request.generation,undefined);assert.equal(calls[1].request.generation,generation);
});
test('retained HTTP failure is replayed as failure and cannot become a missing-source purchase',async()=>{
 const f=fixture({identity:jordan,historicalIdentity:{...jordan,year:'1992'},printing:{name:'Slam Dunk',language:null},historical:'saved',historicalRevision:VARIANT_LISTING_LEGACY_REVISION});
 const key=`variant-listing-response:v1:${f.old.requestKey}`,row=f.rows.get(key),body=JSON.parse(row.snapshot);body.httpStatus=429;row.snapshot=canonical(body);row.snapshot_hash=digest(row.snapshot);
 const before=JSON.stringify([...f.rows]);
 const catalog=createVariantCatalogService({cache:f.store.cache,listingProvider:{fetchSource:()=>assert.fail('No paid replacement'),acquireImages:async({source})=>{assert.equal(source.httpStatus,429);throw Object.assign(Error('retained failure'),{code:'VARIANT_LISTING_LIMITED'});}}});
 const snapshot=await catalog.prepare(f.job.input,{executeListingSource:async(request,_dispatch,{retainedOnly}={})=>{assert(retainedOnly);return f.store.reserveListingSource(f.job,request,{retainedOnly});}});
 assert(snapshot.problems.includes('LISTING_SOURCE_UNAVAILABLE'));assert.equal(JSON.stringify([...f.rows]),before);assert(!f.writes.some(w=>w.sql.startsWith('INSERT')));
});
