import test from 'node:test';
import assert from 'node:assert/strict';
import {canonical,digest} from '@atlas/manual-service/contract';
import {createVariantJobStore,variantJobKey} from '../src/variant-job-store.mjs';
import {prepareVariantListingRequest,prepareRetainedVariantListingRequest} from '../src/variant-listing-provider.mjs';
import {variantIdentity} from './variant-fixture.mjs';

function fixture({historical=null,generation=null}={}){
 const input={cardId:'04c3c3e1-4a66-4912-93cc-26dc534f6cb2',identity:variantIdentity,sourceHash:digest('source'),identityHash:digest('identity'),identityRevision:1,...(generation?{generation}:{})};
 const text=canonical(input),job={key:variantJobKey(input),card_id:input.cardId,source_hash:input.sourceHash,identity_hash:input.identityHash,identity_revision:1,
  generation:generation??'00000000-0000-0000-0000-000000000000',input:text,input_hash:digest(text),claim_id:'claim',state:'RUNNING'};
 const rows=new Map(),writes=[];
 const put=(key,value)=>{const snapshot=canonical(value);rows.set(key,{snapshot,snapshot_hash:digest(snapshot)});};
 const printing={name:'Base',language:null},old=prepareRetainedVariantListingRequest(variantIdentity,printing);
 const reservation={schemaVersion:'variant-listing-dispatch/v1',request:old,dispatchId:'old-dispatch',jobKey:'deleted-original-card-job',claimId:'old-claim',reservedAt:'2026-10-10T00:00:00.000Z'};
 if(historical){put(`variant-listing-dispatch:v1:${old.requestKey}`,reservation);
  if(historical==='saved')put(`variant-listing-response:v1:${old.requestKey}`,{schemaVersion:'variant-listing-source-journal/v1',sourceSchemaVersion:'variant-listing-response/v1',dispatchId:reservation.dispatchId,
   reservationHash:digest(canonical(reservation)),requestKey:old.requestKey,url:old.url,httpStatus:200,contentType:'application/json',bodyText:'{}',sha256:digest('{}'),capturedAt:'2026-10-10T00:00:00.000Z'});
 }
 const tx={async $executeRawUnsafe(sql,...args){writes.push({sql,args});if(sql.startsWith('INSERT INTO atlas_manual_connected.variant_catalog_cache'))rows.set(args[0],{snapshot:args[1],snapshot_hash:args[2]});return 1;},
  async $queryRawUnsafe(sql,key){if(sql.includes('variant_catalog_cache'))return rows.has(key)?[rows.get(key)]:[];assert.match(sql,/SELECT j\.\* FROM atlas_manual_connected.variant_job/);assert.equal(key,job.key);return [job];}};
 const store=createVariantJobStore({boundary:{machineTransaction:async(_,work)=>work({tx})}});
 const request=prepareVariantListingRequest(variantIdentity,printing,{graded:true,...(generation?{generation}:{})});
 return {store,job:{...job,input},request,old,rows,writes};
}

test('ordinary acquisition reuses exact historical paid source independent of its physical card',async()=>{
 const f=fixture({historical:'saved'}),before=[...f.rows];
 const result=await f.store.reserveListingSource(f.job,f.request);
 assert.equal(result.state,'REUSED');assert.deepEqual(result.request,f.old);assert.equal(result.source.requestKey,f.old.requestKey);
 assert.deepEqual([...f.rows],before);assert(!f.writes.some(w=>w.sql.startsWith('INSERT')));
});
test('read-only probes return MISSING or exact historical state without journal or audit writes',async()=>{
 for(const historical of [null,'saved','unknown']){
  const f=fixture({historical}),before=[...f.rows],result=await f.store.reserveListingSource(f.job,f.request,{retainedOnly:true});
  assert.equal(result.state,historical==='saved'?'REUSED':historical==='unknown'?'UNKNOWN':'MISSING');
  assert.deepEqual([...f.rows],before);assert(f.writes.every(w=>w.sql.startsWith('SELECT pg_advisory_xact_lock')));
  if(historical==='saved')assert.deepEqual(result.request,f.old);
 }
});
test('unknown historical dispatch cannot become a fresh paid request under the new revision',async()=>{
 const f=fixture({historical:'unknown'}),result=await f.store.reserveListingSource(f.job,f.request);
 assert.equal(result.state,'UNKNOWN');assert(!f.writes.some(w=>w.sql.startsWith('INSERT')));
});
test('new acquisition and deliberate refresh reserve only the unrestricted 240-row query',async()=>{
 for(const options of [{},{historical:'saved',generation:'7b109de3-c117-49d8-81aa-1221b735b8cb'}]){
  const f=fixture(options),result=await f.store.reserveListingSource(f.job,f.request);
  assert.equal(result.state,'RESERVED');assert.deepEqual(result.reservation.request,f.request);
  assert.match(f.request.query,/graded$/);assert.doesNotMatch(f.request.query,/PSA|CGC|BGS|SGC/);assert.equal(new URL(f.request.url).searchParams.get('count'),'240');
  const again=await f.store.reserveListingSource(f.job,f.request);assert.equal(again.state,'UNKNOWN','A reservation is never sent twice');
  await assert.rejects(f.store.reserveListingSource(f.job,f.old),{code:'VARIANT_LISTING_REQUEST_CHANGED'});
 }
});
