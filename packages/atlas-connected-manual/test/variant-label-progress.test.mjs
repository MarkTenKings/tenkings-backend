import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {canonical,digest} from '@atlas/manual-service/contract';
import {readManualResponse} from '@atlas/manual-service/response';
import {createVariantJobStore,readRetainedVariantLabels,variantBinding,variantJobKey} from '../src/variant-job-store.mjs';
import {createVariantReviewService} from '../src/variant-service.mjs';
import {codexChoices,codexLibraryKey,codexReadingKey} from '../src/variant-codex.mjs';
import {prepareVariantLabelRequest,VARIANT_LABEL_POLICY} from '../src/variant-photo-provider.mjs';
import {labelCatalog} from './variant-label-fixture.mjs';
import {variantIdentity} from './variant-fixture.mjs';
import {MANUAL_TRANSPORT_LIMITS} from '../src/transport.mjs';

function fixture({photos=581,count=1}={}){
 const principal={id:randomUUID(),role:'REVIEWER'},card={cardId:randomUUID(),revision:4,draft:{source:{sourceHash:digest('saved photos')},identityRevision:1,
  identity:{cardName:'Magikarp',year:'2020',productSet:'Rebel Clash',cardNumber:'039/192',parallel:null}}};
 const binding=variantBinding(card),catalog=labelCatalog({photos,count}),input={...binding,generation:randomUUID(),identity:variantIdentity};
 const row={key:variantJobKey(input),card_id:card.cardId,actor_id:principal.id,source_hash:binding.sourceHash,identity_revision:1,identity_hash:binding.identityHash,
  generation:input.generation,input:canonical(input),input_hash:digest(canonical(input)),state:'RUNNING',attempts:6,claim_id:randomUUID(),
  catalog:canonical(catalog,{maxBytes:4194304}),catalog_hash:catalog.snapshotHash,result:null,result_hash:null,audit:[]};
 const entries=new Map(),queries=[],request=prepareVariantLabelRequest(catalog),choices=codexChoices(catalog);
 const put=(key,value)=>{const snapshot=canonical(value,{maxBytes:8388608}),record={key,snapshot,snapshot_hash:digest(snapshot)};
  entries.set(key,[...(entries.get(key)??[]),record]);return record;};
 const addReading=(index,associated=true)=>{
  const reading={sha256:catalog.referencePhotos[index].sha256,candidateKey:associated?choices[0].key:null,gradingCompany:associated?'PSA':null,
   labelText:associated?'2020 Pokemon Rebel Clash Magikarp #39':null,reason:associated?'Exact saved printing.':'No readable printing.'};
  const value={schemaVersion:'atlas-codex-reading/v1',policy:VARIANT_LABEL_POLICY,choices,reading,responseHash:digest(`response ${index}`),requestKey:`retained-request-${index}`};
  put(codexReadingKey(request,reading.sha256),value);return value;
 };
 let approved=false;
 const tx={async $queryRawUnsafe(sql,...args){queries.push({sql,args});
  if(sql.includes('variant_catalog_cache')){
   if(sql.includes('ANY('))return args[0].flatMap(key=>{const rows=entries.get(key)??[];return sql.includes('DISTINCT ON')?rows.slice(-1):rows;});
   return entries.get(args[0])??[];
  }
  if(/^SELECT (?:\*|id) FROM atlas_manual.card /.test(sql))return [{id:card.cardId,owner_id:principal.id,editors:[],readers:[],approvers:[],revision:card.revision,content:canonical(card.draft),content_hash:digest(canonical(card.draft))}];
  if(sql.startsWith('SELECT * FROM atlas_manual_connected.variant_confirmation'))return [];
  if(sql.startsWith('SELECT 1 FROM atlas_manual.approval'))return approved?[{}]:[];
  if(sql.includes('variant_job'))return [row];
  assert.fail(sql);
 },async $executeRawUnsafe(){assert.fail('Status projection must not write or take a worker lock');}};
 const store=createVariantJobStore({boundary:{machineTransaction:()=>assert.fail('Status must stay in its staff transaction'),transaction:async(_,work)=>work({tx,principal})}});
 const service=createVariantReviewService({store,workflow:{service:{execute:()=>assert.fail('No human action')}}});
 return {card,catalog,row,request,choices,entries,queries,tx,store,service,put,addReading,approve:()=>{approved=true;}};
}

test('running status shows saved partial readings without completing or changing the job, catalog, or human review',async()=>{
 const f=fixture();for(let i=0;i<8;i++)f.addReading(i,i<7);
 const before=structuredClone({row:f.row,entries:[...f.entries],card:f.card});
 const status=await f.service.status({},f.card.cardId);
 assert.equal(status.state,'SEARCHING');assert.equal(status.jobId,f.row.key);
 assert.equal(status.refreshRequestId,f.row.generation);assert.equal(status.resultHash,f.catalog.snapshotHash);
 assert.equal(status.catalogManifestHash,f.catalog.snapshotHash);assert.deepEqual(status.result.catalog,f.catalog);
 assert.equal(status.result.referenceLabels.catalogHash,f.catalog.snapshotHash);assert.equal(status.result.referenceLabels.readings.length,8);
 assert.equal(status.result.referenceLabels.readings.filter(r=>r.candidateId).length,7);
 assert.deepEqual(status.labelProcessing,{total:581,read:8,unread:573});
 assert.equal(status.confirmation,null);assert.equal(status.approvalReady,false);assert.equal(status.refreshable,false);
 assert.equal(f.queries.filter(q=>q.sql.includes('ANY(')).length,3,'Three batched reads cover all 581 readings, printing libraries and shared reservations');
 assert.deepEqual({row:f.row,entries:[...f.entries],card:f.card},before);
 for(let i=8;i<16;i++)f.addReading(i);
 const next=await f.service.status({},f.card.cardId);
 assert.deepEqual(next.labelProcessing,{total:581,read:16,unread:565});
 assert.equal(next.resultHash,status.resultHash);assert.equal(next.catalogManifestHash,status.catalogManifestHash);
 assert.equal(f.row.result,null);assert.equal(f.row.state,'RUNNING');
 f.approve();assert.equal((await f.service.status({},f.card.cardId)).approvalReady,true,'Reference progress cannot revoke existing approval');
});

test('partial projection uses the latest exact printing library and retained unmatched readings, excluding photos outside this catalog',async()=>{
 const f=fixture({photos:3}),a=f.addReading(0),b=f.addReading(1,false),outside=labelCatalog({photos:4}).referencePhotos[3];
 const reference=(image,reading)=>({image,reading,responseHash:digest('response'),requestKey:'retained-request'}),key=codexLibraryKey(f.choices[0]);
 f.put(key,{schemaVersion:'atlas-codex-library/v1',policy:VARIANT_LABEL_POLICY,choice:f.choices[0],references:[reference(f.catalog.referencePhotos[0],a.reading)]});
 const latestReading={...a.reading,labelText:'2020 Pokemon Rebel Clash Magikarp #39 · retained library'};
 f.put(key,{schemaVersion:'atlas-codex-library/v1',policy:VARIANT_LABEL_POLICY,choice:f.choices[0],references:[reference(f.catalog.referencePhotos[0],latestReading),reference(outside,{...a.reading,sha256:outside.sha256})]});
 const labels=(await readRetainedVariantLabels(f.tx,f.catalog)).referenceLabels;
 assert.equal(labels.readings.length,2);assert.equal(labels.readings.find(r=>r.sha256===a.reading.sha256).labelText,latestReading.labelText);
 assert.equal(labels.readings.find(r=>r.sha256===b.reading.sha256).candidateId,null);
 assert(!labels.readings.some(r=>r.sha256===outside.sha256));
 assert.equal(f.queries.length,2);
});

test('status rejects corrupt or duplicate retained readings and stale catalog hashes instead of presenting them',async()=>{
 for(const failure of ['hash','duplicate','photo','catalog']){
  const f=fixture({photos:2}),reading=f.addReading(0),key=codexReadingKey(f.request,reading.reading.sha256),rows=f.entries.get(key);
  if(failure==='hash')rows[0].snapshot_hash=digest('wrong');
  if(failure==='duplicate')rows.push({...rows[0]});
  if(failure==='photo'){
   const invalid={...reading,reading:{...reading.reading,sha256:digest('other photo')}};
   rows[0]={key,snapshot:canonical(invalid),snapshot_hash:digest(canonical(invalid))};
  }
  if(failure==='catalog')f.row.catalog_hash=digest('other catalog');
  await assert.rejects(f.service.status({},f.card.cardId),{code:({hash:'VARIANT_CACHE_CORRUPT',duplicate:'VARIANT_LISTING_JOURNAL_CONFLICT',photo:'VARIANT_CODEX_READING_INVALID',catalog:'VARIANT_STORED_CONTENT_INVALID'})[failure]});
 }
});

test('image authorization skips all label cache reads, and finalized results keep their committed labels and hash',async()=>{
 const f=fixture({photos:2});f.addReading(0);
 const imageRead=await f.store.read({},f.card.cardId,{includeLabelStatus:false});
 assert.equal(imageRead.referenceLabels,null);assert(!f.queries.some(q=>q.sql.includes('variant_catalog_cache')));
 const result={catalog:f.catalog,referenceLabels:(await readRetainedVariantLabels(f.tx,f.catalog)).referenceLabels};
 Object.assign(f.row,{state:'READY',result:canonical(result,{maxBytes:8388608}),result_hash:digest(canonical(result,{maxBytes:8388608}))});
 f.queries.length=0;f.addReading(1);
 const status=await f.service.status({},f.card.cardId);
 assert.equal(status.state,'READY');assert.equal(status.resultHash,f.row.result_hash);
 assert.deepEqual(status.result,result);assert.equal(digest(canonical(status.result,{maxBytes:8388608})),f.row.result_hash);
 assert.deepEqual(status.result.referenceLabels,result.referenceLabels);assert.deepEqual(status.labelProcessing,{total:2,read:1,unread:1});
 assert(!f.queries.some(q=>q.sql.includes('variant_catalog_cache')),'Committed final results are not silently replaced');
});

test('581 retained readings and 28 choices fit the existing JSON response limit and browser response parser',async t=>{
 const f=fixture({photos:581,count:28});for(let i=0;i<581;i++)f.addReading(i);
 const status=await f.service.status({},f.card.cardId),text=JSON.stringify(status),bytes=Buffer.byteLength(text);
 assert(bytes<MANUAL_TRANSPORT_LIMITS.jsonResponseBytes);
 const parsed=await readManualResponse(new Response(text,{status:200,headers:{'content-type':'application/json'}}));
 assert.equal(parsed.result.catalog.candidates.length,28);assert.equal(parsed.result.referenceLabels.readings.length,581);
 assert.deepEqual(parsed.labelProcessing,{total:581,read:581,unread:0});assert.equal(parsed.resultHash,f.catalog.snapshotHash);
 t.diagnostic(`Complete fixture response: ${bytes} bytes of ${MANUAL_TRANSPORT_LIMITS.jsonResponseBytes}`);
});
