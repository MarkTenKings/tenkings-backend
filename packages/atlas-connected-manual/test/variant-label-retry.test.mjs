import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {canonical,digest} from '@atlas/manual-service/contract';
import {createVariantJobStore,variantBinding,variantJobKey} from '../src/variant-job-store.mjs';
import {createVariantWorker} from '../src/variant-worker.mjs';
import {createVariantPhotoProvider,prepareVariantLabelRequest,variantLabelCreditRejected,VARIANT_LABEL_CREDIT_ERROR} from '../src/variant-photo-provider.mjs';
import {labelCatalog,labelPhoto,labelResponse} from './variant-label-fixture.mjs';
import {variantIdentity} from './variant-fixture.mjs';

const credit={httpStatus:429,bodyText:JSON.stringify({error:{code:'credit_balance_exhausted',message:'No remaining credits.'}})};
async function fixture({photos=8,outcome='success'}={}){
 const principal={id:randomUUID(),role:'REVIEWER'},card={cardId:randomUUID(),revision:4,draft:{source:{sourceHash:digest('generated pair')},identityRevision:1,
  identity:{cardName:'Magikarp',year:'2020',productSet:'Rebel Clash',cardNumber:'039/192',parallel:null}}};
 const binding=variantBinding(card),catalog=labelCatalog({photos}),input={...binding,generation:randomUUID(),identity:variantIdentity};
 const row={key:variantJobKey(input),card_id:card.cardId,actor_id:principal.id,source_hash:binding.sourceHash,identity_revision:1,identity_hash:binding.identityHash,
  generation:input.generation,input:canonical(input),input_hash:digest(canonical(input)),state:'FAILED',attempts:6,claim_id:null,lease_until:null,
  catalog:canonical(catalog,{maxBytes:4194304}),catalog_hash:catalog.snapshotHash,audit:[],code:'VARIANT_PREPARATION_INTERRUPTED'};
 const rows=new Map(),writes=[],queries=[];let sends=0,retryCalls=0,failAfterResponse=false,projectionFailures=0,projectionAckFailures=0;
 const put=(key,value)=>{const snapshot=canonical(value,{maxBytes:8388608}),record={key,snapshot,snapshot_hash:digest(snapshot)};rows.set(key,[...(rows.get(key)??[]),record]);return record;};
 const latest=key=>JSON.parse(rows.get(key).at(-1).snapshot);
 const media=new Map(Array.from({length:photos},(_,i)=>labelPhoto(i,'fixture')).map(p=>[p.image.sha256,p.media]));
 const provider=createVariantPhotoProvider({apiKey:'unit-test-placeholder-only',readReferenceImage:async({snapshot,imageId})=>media.get(snapshot.referencePhotos.find(p=>p.imageId===imageId).sha256),fetchImpl:async(_url,options)=>{
  sends++;const body=JSON.parse(options.body);assert.equal(body.model,'gpt-6-astra');assert.equal(body.reasoning.effort,'xhigh');
  if(outcome==='unknown')throw Error('Uncertain transport');
  if(outcome==='credit')return new Response(credit.bodyText,{status:429});
  const shas=body.input[1].content.filter(p=>p.type==='input_text'&&p.text.startsWith('Sold reference')).map(p=>p.text.match(/[a-f0-9]{64}/)[0]);
  return Response.json(labelResponse(prepareVariantLabelRequest(catalog,shas)));
 }});
 const request=prepareVariantLabelRequest(catalog,prepareVariantLabelRequest(catalog).photos.slice(0,8).map(p=>p.sha256)),prepared=await provider.prepare({catalog,photoShas:request.photos.map(p=>p.sha256)});
 const reservation={schemaVersion:'variant-label-dispatch/v1',request,evidence:prepared.evidence,catalog:{...catalog,referencePhotos:catalog.referencePhotos.filter(p=>request.photos.some(v=>v.sha256===p.sha256))},jobKey:row.key,claimId:randomUUID(),reservedAt:'2026-10-13T15:50:00Z'};
 // Use the same snapshot constructor as a real reserved eight-photo packet.
 reservation.catalog=labelCatalog({photos:8});
 if(photos!==8){const {variantSnapshotHash}=await import('@tenkings/card-catalog-evidence');reservation.catalog={...catalog,referencePhotos:catalog.referencePhotos.filter(p=>request.photos.some(v=>v.sha256===p.sha256))};reservation.catalog.snapshotHash=variantSnapshotHash(reservation.catalog);}
 put('variant-label-dispatch:v1:'+request.requestKey,reservation);
 const rejected={schemaVersion:'variant-label-response/v1',reservationHash:digest(canonical(reservation)),version:request.policy,requestEvidence:prepared.evidence,...credit};
 const rejection=put('variant-label-response:v1:'+request.requestKey,rejected);
 for(const p of request.photos){const {codexImageReservationKey}=await import('../src/variant-codex.mjs');put(codexImageReservationKey(request,p.sha256),{schemaVersion:'atlas-codex-reservation/v1',requestKey:request.requestKey});}
 const tx={async $queryRawUnsafe(sql,...args){queries.push(sql);
  if(sql.startsWith('SELECT atlas_manual_connected.retry_variant_labels')){
   retryCalls++;assert.equal(row.state,'FAILED');const[actorId,requestId,cardId,jobKey,sourceHash,identityRevision,identityHash,catalogHash,failedRequestKey,failedResponseHash]=args;
   const receipt={schemaVersion:'variant-label-retry/v1',actorId,requestId,cardId,jobKey,sourceHash,identityRevision,identityHash,catalogHash,failedRequestKey,failedResponseHash,attemptKey:'variant-label-attempt:v1:'+requestId,requestKey:request.requestKey};
   assert(!rows.has('variant-label-retry-next:v1:'+failedRequestKey));put('variant-label-retry:v1:'+requestId,receipt);put('variant-label-retry-next:v1:'+failedRequestKey,receipt);
   row.audit.push({event:'LABEL_RETRY_REQUESTED',requestId,failedRequestKey,failedResponseHash,attemptKey:receipt.attemptKey,catalogHash});row.state='QUEUED';row.code='VARIANT_LABEL_RETRY_REQUESTED';return [{receipt}];
  }
  if(sql.includes('variant_catalog_cache')){if(sql.includes('ANY('))return args[0].flatMap(key=>{const values=rows.get(key)??[];return sql.includes('DISTINCT ON')?values.slice(-1):values;});const values=rows.get(args[0])??[];return sql.includes('DESC')?values.slice(-1):values;}
  if(/^SELECT (?:\*|id) FROM atlas_manual.card /.test(sql))return [{id:card.cardId,owner_id:principal.id,editors:[],readers:[],approvers:[],revision:card.revision,content:canonical(card.draft),content_hash:digest(canonical(card.draft))}];
  if(sql.startsWith('SELECT * FROM atlas_manual_connected.variant_confirmation')||sql.startsWith('SELECT 1 FROM atlas_manual.approval'))return [];
  if(sql.includes('variant_job')){
   if(sql.includes('generation=$2'))return args[1]===row.generation?[row]:[];
   if(sql.includes('WHERE key=$1')&&args[0]!==row.key)return [];
   if(sql.startsWith('SELECT key '))return args[0]===row.key&&args[1]===row.claim_id&&row.state==='RUNNING'?[{key:row.key}]:[];
   return [row];
  }
  assert.fail(sql);
 },async $executeRawUnsafe(sql,...args){
  if(sql.startsWith('SELECT pg_advisory'))return 1;
  writes.push({sql,args});if(sql.startsWith('UPDATE atlas_manual_connected.variant_job j SET state=$3')){const[key,claim,state,result,resultHash,code,appended]=args;assert.equal(key,row.key);assert.equal(claim,row.claim_id);Object.assign(row,{state,result,result_hash:resultHash,code,claim_id:null,lease_until:null,audit:[...row.audit,...JSON.parse(appended)]});return 1;}
  assert(sql.startsWith('INSERT INTO atlas_manual_connected.variant_catalog_cache'),'no listing, card, approval or ordinary job insert');
  const record={key:args[0],snapshot:args[1],snapshot_hash:args[2]};rows.set(args[0],[...(rows.get(args[0])??[]),record]);return 1;
 }};
 const store=createVariantJobStore({boundary:{machineTransaction:async(_,work)=>work({tx}),transaction:async(_,work)=>work({tx,principal})}});
 const job=()=>({...row,input,catalog});
 const worker=createVariantWorker({store:{...store,discover:async()=>{},claim:async()=>{if(row.state!=='QUEUED')return null;row.state='RUNNING';row.claim_id=randomUUID();return job();},renew:async()=>true,
  saveLabelSource:async(...args)=>{const saved=await store.saveLabelSource(...args);if(failAfterResponse){failAfterResponse=false;throw Error('Lost saved response acknowledgement');}return saved;},
  publishLabelSource:async(...args)=>{if(projectionFailures>0){projectionFailures--;throw Error('Transient projection failure');}const result=await store.publishLabelSource(...args);if(projectionAckFailures>0){projectionAckFailures--;throw Error('Lost projection acknowledgement');}return result;},
  finish:(...args)=>store.finish(...args),
  defer:async()=>{row.state='QUEUED';row.claim_id=null;return true;}},catalog:{prepare:()=>assert.fail('Retry must not reacquire SoldComps/catalog')},provider});
 const retryInput=()=>({requestId:randomUUID(),sourceHash:binding.sourceHash,identityRevision:1,identityHash:binding.identityHash,jobId:row.key,catalogManifestHash:catalog.snapshotHash,labelRequestKey:request.requestKey,labelResponseHash:rejection.snapshot_hash});
 return {store,worker,row,rows,queries,writes,card,request,reservation,rejection,prepared,provider,catalog,input,job,retryInput,latest,sends:()=>sends,retryCalls:()=>retryCalls,loseAcknowledgement:()=>{failAfterResponse=true;},failProjection:(count=1)=>{projectionFailures=count;},loseProjectionAcknowledgement:()=>{projectionAckFailures=1;}};
}

test('only an unmixed definite HTTP429 credit rejection authorizes retry',()=>{
 assert.equal(variantLabelCreditRejected(credit),true);
 for(const patch of [{httpStatus:200},{httpStatus:500},{bodyText:'unknown'},{bodyText:'{}'},{bodyText:JSON.stringify({error:{code:'rate_limit_exceeded'}})},
  ...['id','status','output','usage'].map(k=>({bodyText:JSON.stringify({error:{code:'credit_balance_exhausted'},[k]:null})}))])assert.equal(variantLabelCreditRejected({...credit,...patch}),false);
});
test('historical exhausted job exposes exact safe refusal, while image reads skip label journals',async()=>{
 const f=await fixture({photos:581}),before=structuredClone([...f.rows]);
 const status=await f.store.read({},f.card.cardId);assert.deepEqual(status.labelFailure,{code:VARIANT_LABEL_CREDIT_ERROR,labelRequestKey:f.request.requestKey,labelResponseHash:f.rejection.snapshot_hash,retryable:true});
 assert.equal(status.labelRetryRequestId,null);assert.deepEqual([...f.rows],before);
 f.queries.length=0;await f.store.read({},f.card.cardId,{includeLabelStatus:false});assert(!f.queries.some(sql=>sql.includes('variant_catalog_cache')));
 await assert.rejects(f.store.refresh({},f.card.cardId,{requestId:randomUUID(),sourceHash:f.input.sourceHash,identityRevision:1,identityHash:f.input.identityHash,jobId:f.row.key}),{code:'VARIANT_LABEL_RETRY_REQUIRED'});
 assert.equal(f.writes.length,0);
});
test('explicit retry is idempotent, source-bound, and preserves the same job/generation/catalog',async()=>{
 const f=await fixture(),input=f.retryInput(),before={key:f.row.key,generation:f.row.generation,catalog:f.row.catalog,card:structuredClone(f.card)};
 const receipt=await f.store.retryLabels({},f.card.cardId,input);assert.equal(receipt.requestId,input.requestId);
 assert.deepEqual(await f.store.retryLabels({},f.card.cardId,input),receipt);assert.equal(f.retryCalls(),1);assert.equal(f.row.attempts,6);
 assert.deepEqual({key:f.row.key,generation:f.row.generation,catalog:f.row.catalog,card:f.card},before);
 const status=await f.store.read({},f.card.cardId);assert.equal(status.labelRetryRequestId,input.requestId);assert.equal(status.labelFailure.retryable,false);
 await assert.rejects(f.store.retryLabels({},f.card.cardId,{...input,labelResponseHash:digest('changed')}),{code:'VARIANT_LABEL_RETRY_CONFLICT'});
 await assert.rejects(f.store.retryLabels({},f.card.cardId,{...input,requestId:randomUUID()}),{code:'VARIANT_LABEL_RETRY_UNAVAILABLE'});
 const g=await fixture();for(const change of [{sourceHash:digest('other')},{identityRevision:2},{identityHash:digest('other')},{catalogManifestHash:digest('other')},{labelResponseHash:digest('other')}])await assert.rejects(g.store.retryLabels({},g.card.cardId,{...g.retryInput(),...change}));assert.equal(g.retryCalls(),0);
});
test('new attempt uses exact original Astra request; paid uncertainty cannot be dispatched twice',async()=>{
 const f=await fixture(),input=f.retryInput();await f.store.retryLabels({},f.card.cardId,input);f.row.state='RUNNING';f.row.claim_id=randomUUID();
 const base=[...f.rows].filter(([key])=>!key.startsWith('variant-label-retry'));
 assert.equal((await f.store.labelSource(f.job(),f.request)).state,'MISSING');
 await assert.rejects(f.store.labelSource(f.job(),f.request,{...f.prepared.evidence,requestSha256:digest('different prompt')}),{code:'VARIANT_LABEL_RETRY_REQUEST_CHANGED'});
 const reserved=await f.store.labelSource(f.job(),f.request,f.prepared.evidence);assert.equal(reserved.attemptKey,'variant-label-attempt:v1:'+input.requestId);
 assert.deepEqual(reserved.reservation.evidence,f.prepared.evidence);assert.equal((await f.store.labelSource(f.job(),f.request,f.prepared.evidence)).state,'PENDING');
 f.row.claim_id=randomUUID();assert.equal((await f.store.labelSource(f.job(),f.request,f.prepared.evidence)).state,'UNKNOWN');
 for(const[key,records]of base)assert.deepEqual(f.rows.get(key),records);
});
test('581 saved photos finish through real journal/parser/worker in73 bounded mocked Astra calls, with no listings',async()=>{
 const f=await fixture({photos:581}),before={catalog:f.row.catalog,input:f.row.input,generation:f.row.generation,oldResponse:structuredClone(f.rows.get('variant-label-response:v1:'+f.request.requestKey))};
 const retry=f.retryInput();await f.store.retryLabels({},f.card.cardId,retry);await f.worker.drainOnce();
 assert.equal(f.row.state,'READY');assert.equal(f.sends(),73);const result=JSON.parse(f.row.result);assert.equal(result.referenceLabels.readings.length,581);assert.equal(result.catalog.referencePhotos.length,581);
 assert.equal(f.row.catalog,before.catalog);assert.equal(f.row.input,before.input);assert.equal(f.row.generation,before.generation);assert.deepEqual(f.rows.get('variant-label-response:v1:'+f.request.requestKey),before.oldResponse);
 const attemptKey='variant-label-attempt:v1:'+retry.requestId,response=f.latest('variant-label-response:v1:'+attemptKey),libraries=[...f.rows.keys()].filter(key=>key.startsWith('atlas-codex-library:')).map(f.latest);
 for(const photo of f.request.photos){const references=libraries.flatMap(library=>library.references).filter(reference=>reference.image.sha256===photo.sha256);assert(references.length>0);for(const reference of references){assert.equal(reference.requestKey,attemptKey);assert.equal(reference.responseHash,digest(response.bodyText));}}
 await f.worker.drainOnce();assert.equal(f.sends(),73);assert.equal((await f.store.read({},f.card.cardId)).labelFailure,null);
});
test('another definite credit rejection stops after one new call and requires another exact explicit retry',async()=>{
 const f=await fixture({outcome:'credit'});const first=f.retryInput();await f.store.retryLabels({},f.card.cardId,first);await f.worker.drainOnce();await f.worker.drainOnce();
 assert.equal(f.sends(),1);assert.equal(f.row.state,'FAILED');assert.equal(f.row.code,VARIANT_LABEL_CREDIT_ERROR);
 const status=await f.store.read({},f.card.cardId);assert.equal(status.labelFailure.retryable,true);assert.equal(status.labelFailure.labelRequestKey,'variant-label-attempt:v1:'+first.requestId);
 await assert.rejects(f.store.retryLabels({},f.card.cardId,f.retryInput()),{code:'VARIANT_LABEL_RETRY_UNAVAILABLE'});
 await f.store.retryLabels({},f.card.cardId,{...f.retryInput(),labelRequestKey:status.labelFailure.labelRequestKey,labelResponseHash:status.labelFailure.labelResponseHash});
 await f.worker.drainOnce();await f.worker.drainOnce();assert.equal(f.sends(),2);assert.equal(f.row.state,'FAILED');
});
test('lost response acknowledgment projects retained success and continues the saved photo pool without redispatch',async()=>{
 const f=await fixture({photos:16});await f.store.retryLabels({},f.card.cardId,f.retryInput());f.loseAcknowledgement();
 await f.worker.drainOnce();await f.worker.drainOnce();assert.equal(f.sends(),2);assert.equal(f.row.state,'READY');
 const result=JSON.parse(f.row.result);assert.equal(result.catalog.referencePhotos.length,16);assert.equal(result.referenceLabels.readings.length,16);assert(result.referenceLabels.readings.every(reading=>reading.candidateId));
});
test('lost credit acknowledgment remains explicitly retryable; uncertain transport cannot be redispatched',async()=>{
 const credit=await fixture({outcome:'credit'});await credit.store.retryLabels({},credit.card.cardId,credit.retryInput());credit.loseAcknowledgement();
 await credit.worker.drainOnce();await credit.worker.drainOnce();assert.equal(credit.sends(),1);assert.equal(credit.row.state,'FAILED');assert.equal((await credit.store.read({},credit.card.cardId)).labelFailure.retryable,true);
 const unknown=await fixture({outcome:'unknown'});await unknown.store.retryLabels({},unknown.card.cardId,unknown.retryInput());
 await unknown.worker.drainOnce();await unknown.worker.drainOnce();assert.equal(unknown.sends(),1);assert.equal(JSON.parse(unknown.row.result).catalog.referencePhotos.length,8);assert.equal(JSON.parse(unknown.row.result).referenceLabels.readings.length,0);
});

test('exhausted historical attempts retain bounded local projection continuation without another Astra call',async()=>{
 for(const lostAcknowledgement of [false,true]){
  const f=await fixture({photos:16});await f.store.retryLabels({},f.card.cardId,f.retryInput());
  if(lostAcknowledgement)f.loseProjectionAcknowledgement();else f.failProjection();
  await f.worker.drainOnce();assert.equal(f.row.state,'QUEUED');assert.equal(f.row.code,'VARIANT_LABEL_RETRY_REQUESTED');assert.equal(f.row.attempts,6);assert.equal(f.sends(),1);
  assert.equal(f.row.audit.filter(e=>e.event==='LABEL_RETRY_PROJECTION_CONTINUATION').length,1);
  await f.worker.drainOnce();assert.equal(f.row.state,'READY');assert.equal(f.sends(),2);assert.equal(JSON.parse(f.row.result).referenceLabels.readings.length,16);
 }
 const f=await fixture();await f.store.retryLabels({},f.card.cardId,f.retryInput());f.failProjection(7);
 for(let n=0;n<7;n++)await f.worker.drainOnce();assert.equal(f.row.state,'FAILED');assert.equal(f.sends(),1);assert.equal(f.row.attempts,6);assert.equal(f.row.audit.filter(e=>e.event==='LABEL_RETRY_PROJECTION_CONTINUATION').length,6);
 await f.worker.drainOnce();assert.equal(f.sends(),1);
});
