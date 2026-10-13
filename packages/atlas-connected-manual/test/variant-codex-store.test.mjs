import test from 'node:test';
import assert from 'node:assert/strict';
import {canonical,digest} from '@atlas/manual-service/contract';
import {variantSnapshotHash} from '@tenkings/card-catalog-evidence';
import {createVariantJobStore,variantJobKey} from '../src/variant-job-store.mjs';
import {createVariantCatalogService} from '../src/variant-catalog.mjs';
import {createVariantWorker} from '../src/variant-worker.mjs';
import {prepareVariantLabelRequest,VARIANT_LABEL_POLICY,VARIANT_PHOTO_MODEL} from '../src/variant-photo-provider.mjs';
import {codexLibraryKey,codexPhotoPoolKey,codexReadingKey,codexChoices,variantCodexChoice,validateCodexLibrary,validateCodexPhotoPool} from '../src/variant-codex.mjs';
import {labelCatalog,labelResponse} from './variant-label-fixture.mjs';
import {variantIdentity} from './variant-fixture.mjs';

test('old and context-bearing label batches recover into the shared library once, independent of the original card',async()=>{
 const catalog=labelCatalog({photos:16}),entries=new Map(),appends=[];let heldLocks=[];
 const put=(key,value)=>{const snapshot=canonical(value,{maxBytes:8388608});const rows=entries.get(key)??[];rows.push({snapshot,snapshot_hash:digest(snapshot)});entries.set(key,rows);};
 const tx={async $queryRawUnsafe(sql,key){
  if(sql.includes('variant_job'))return [{key:'new-physical-card-job'}];
  if(heldLocks.length&&/^atlas-codex-(reading|library):/.test(key))assert(heldLocks.includes(`atlas-listing-source:${key}`),'Every reading/library read holds its preacquired transaction lock');
  assert.match(sql,/variant_catalog_cache/);const rows=entries.get(key)??[];return sql.includes('DESC')?rows.slice(-1):rows.slice(0,2);
 },async $executeRawUnsafe(sql,...args){
  if(sql.includes('pg_advisory_xact_lock')){assert(!heldLocks.includes(args[0]),'No duplicate lock round trip inside a transaction');heldLocks.push(args[0]);}
  if(sql.startsWith('INSERT INTO atlas_manual_connected.variant_catalog_cache'))assert(heldLocks.includes(`atlas-listing-source:${args[0]}`),'Every journal write holds its preacquired transaction lock');
  if(sql.startsWith('INSERT INTO atlas_manual_connected.variant_catalog_cache')){appends.push(args[0]);const rows=entries.get(args[0])??[];rows.push({snapshot:args[1],snapshot_hash:args[2]});entries.set(args[0],rows);}return 1;
 }};
 const store=createVariantJobStore({boundary:{machineTransaction:async(_,work)=>{heldLocks=[];const value=await work({tx});if(heldLocks.length){assert.equal(heldLocks.length,9,'Eight unique reading locks and one printing-library lock');assert.deepEqual(heldLocks.slice(0,8),heldLocks.slice(0,8).sort());}return value;}}}),job={key:'new-physical-card-job',claim_id:'current'};
 for(let offset=0;offset<16;offset+=8){
  const batch={...catalog,referencePhotos:catalog.referencePhotos.slice(offset,offset+8)};batch.snapshotHash=variantSnapshotHash(batch);
  const request=prepareVariantLabelRequest(batch,null,{includeCatalogContext:offset>0}),evidence={policy:VARIANT_LABEL_POLICY,model:VARIANT_PHOTO_MODEL,requestSha256:digest(`saved-request-${offset}`),request};
  const reservation={schemaVersion:'variant-label-dispatch/v1',request,evidence,catalog:batch,jobKey:'deleted-original-physical-card',claimId:'historical',reservedAt:'2026-10-10T00:00:00.000Z'};
  const response={version:VARIANT_LABEL_POLICY,requestEvidence:evidence,httpStatus:200,bodyText:JSON.stringify(labelResponse(request)),requestId:null};
  put(`variant-label-dispatch:v1:${request.requestKey}`,reservation);
  put(`variant-label-response:v1:${request.requestKey}`,{...response,schemaVersion:'variant-label-response/v1',reservationHash:digest(canonical(reservation))});
  const before=JSON.stringify(reservation);await store.publishLabelSource(job,request);assert.equal(JSON.stringify(reservation),before);
  await store.publishLabelSource(job,request); // Same saved response remains idempotent.
  const reading=await store.cache.getRetained(codexReadingKey(request,batch.referencePhotos[0].sha256));
  assert.equal(Object.hasOwn(reading,'catalogContext'),offset>0,'Historical readings retain their original shape');
 }
 const choice=variantCodexChoice(catalog.candidates[0]),key=codexLibraryKey(choice),saved=await store.cache.getRetained(key);
 assert.equal(validateCodexLibrary(saved,choice).references.length,16);assert.equal(new Set(saved.references.map(r=>r.image.sha256)).size,16);
 assert.equal(appends.filter(value=>value===key).length,2,'No per-photo copies or duplicate recovery appends');
 assert.equal(appends.filter(value=>value.startsWith('atlas-codex-reading:')).length,16);
});

test('a second physical card discovers unmatched photos and exact new choices after the original card is deleted, with no paid or image calls',async()=>{
 const entries=new Map(),jobs=new Map(),appends=[];
 const put=(key,value)=>{const snapshot=canonical(value,{maxBytes:8388608});const rows=entries.get(key)??[];rows.push({snapshot,snapshot_hash:digest(snapshot)});entries.set(key,rows);};
 const tx={async $queryRawUnsafe(sql,key){
  if(sql.includes('variant_job'))return jobs.has(key)?[jobs.get(key)]:[];
  assert.match(sql,/variant_catalog_cache/);const rows=entries.get(key)??[];return sql.includes('DESC')?rows.slice(-1):rows.slice(0,2);
 },async $executeRawUnsafe(sql,...args){
  if(sql.startsWith('INSERT INTO atlas_manual_connected.variant_catalog_cache')){appends.push(args[0]);const rows=entries.get(args[0])??[];rows.push({snapshot:args[1],snapshot_hash:args[2]});entries.set(args[0],rows);}
  if(sql.includes('SET catalog=$3')){const row=jobs.get(args[0]);if(!row||row.catalog)return 0;row.catalog=args[2];row.catalog_hash=args[3];}
  return 1;
 }};
 const store=createVariantJobStore({boundary:{machineTransaction:async(_,work)=>work({tx})}});
 const addJob=cardId=>{
  const input={cardId,identity:variantIdentity,sourceHash:digest(cardId),identityHash:digest('identity'),identityRevision:1},text=canonical(input);
  const row={key:variantJobKey(input),card_id:cardId,source_hash:input.sourceHash,identity_hash:input.identityHash,identity_revision:1,
   generation:'00000000-0000-0000-0000-000000000000',input:text,input_hash:digest(text),claim_id:'claim',state:'RUNNING',catalog:null};
  jobs.set(row.key,row);return {...row,input};
 };
 const original=labelCatalog({photos:3}),choice=variantCodexChoice(original.candidates[0]),oldJob=addJob('deleted-original-card');
 assert(await store.saveCatalog(oldJob,original));
 const poolKey=codexPhotoPoolKey(choice),pool=validateCodexPhotoPool(await store.cache.getRetained(poolKey),choice);
 assert.equal(pool.photos.length,3);assert.equal(appends.filter(key=>key===poolKey).length,1);
 const permanent=original.referencePhotos.map((image,index)=>({schemaVersion:'atlas-codex-reading/v1',policy:VARIANT_LABEL_POLICY,
  choices:codexChoices(original),reading:{sha256:image.sha256,candidateKey:index===0?choice.key:null,gradingCompany:'CGC',
   labelText:`${index===2?'2024':'2020'} POKEMON REBEL CLASH\nMAGIKARP\n#039/192\nCostco Exclusive\nPRISTINE 10`,reason:index===0?'Known base':'Catalog printing absent or conflicting.'},
  responseHash:digest(`saved response ${index}`),requestKey:`saved-request-${index}`}));
 for(const record of permanent)put(codexReadingKey({policy:VARIANT_LABEL_POLICY,model:VARIANT_PHOTO_MODEL},record.reading.sha256),record);
 const before=JSON.stringify(permanent);jobs.delete(oldJob.key);assert.equal(jobs.size,0,'The source submission no longer exists');
 const expanded=labelCatalog({count:2,photos:0,candidateTransform:(c,index)=>{if(index)c.parallel=c.label='Costco Exclusive';}});
 let listingCalls=0,imageCalls=0,modelCalls=0;
 const catalog=createVariantCatalogService({cache:store.cache,providers:[{prepare:async()=>({candidates:expanded.candidates,problems:[],truncated:false})}],
  listingProvider:{fetchSource:()=>{listingCalls++;assert.fail('No new paid listing source');},acquireImages:()=>{imageCalls++;assert.fail('No image retrieval');}}});
 const next=addJob('second-physical-card'),snapshot=await catalog.prepare(next.input,{executeListingSource:(_request,_dispatch,{retainedOnly=false}={})=>{if(retainedOnly)return {state:'MISSING'};listingCalls++;assert.fail('Pool must satisfy catalog before paid source work');}});
 assert.equal(snapshot.referencePhotos.length,3);assert(await store.saveCatalog(next,snapshot));
 const labels=await store.codexReadings(next),costco=expanded.candidates.find(c=>c.label==='Costco Exclusive');
 assert.equal(labels.readings.find(r=>r.sha256===permanent[1].reading.sha256).candidateId,costco.candidateId);
 assert.equal(labels.readings.find(r=>r.sha256===permanent[2].reading.sha256).candidateId,null,'The conflicting year remains honestly unmatched');
 let claimed=false,finished;
 const provider=()=>{modelCalls++;assert.fail('No model request');};provider.labelRequest=prepareVariantLabelRequest;provider.prepare=()=>{imageCalls++;assert.fail('No label image preparation');};
 const worker=createVariantWorker({store:{...store,discover:async()=>{},claim:async()=>{if(claimed)return null;claimed=true;return {...next,catalog:snapshot};},
  finish:async(_job,outcome)=>{finished=outcome;return true;}},catalog,provider,projectResponse:()=>assert.fail('No retired physical comparison'),onError:error=>assert.fail(error.code)});
 await worker.drainOnce();assert.equal(finished.result.referenceLabels.readings.length,3);assert.equal(finished.result.suggestion.candidateId,null);
 assert.deepEqual({listingCalls,imageCalls,modelCalls},{listingCalls:0,imageCalls:0,modelCalls:0});
 assert.equal(appends.filter(key=>key===poolKey).length,1,'SHA deduplication makes repeat pool writes idempotent');
 for(const record of permanent)assert.deepEqual(await store.cache.getRetained(codexReadingKey({policy:VARIANT_LABEL_POLICY,model:VARIANT_PHOTO_MODEL},record.reading.sha256)),record);
 assert.equal(JSON.stringify(permanent),before,'Association never changes the original paid OCR');
});
