import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {digest} from '@atlas/manual-service/contract';
import {createConnectedHandler} from '../src/http.mjs';
import {createVariantReviewService,variantReviewStatus} from '../src/variant-service.mjs';
import {variantBinding} from '../src/variant-job-store.mjs';
import {variantCatalog} from './variant-fixture.mjs';
const origin='https://atlasgrading.com',hash='a'.repeat(64);
const card={cardId:randomUUID(),revision:4,draft:{source:{sourceHash:hash},identityRevision:1,identity:{cardName:'Magikarp',year:'2020',productSet:'Rebel Clash',cardNumber:'039/192',parallel:null,layoutType:'POKEMON'}}};
function fixture(){
 const calls=[],actor={id:randomUUID()},cardId=card.cardId;
 const connected={workflow:{},intake:{},variantReview:{refresh:async(staff,id,input)=>{assert.equal(staff,actor);calls.push(['refresh',id,input]);return {state:'QUEUED',refreshRequestId:input.requestId};},status:async(staff,id)=>{assert.equal(staff,actor);calls.push(['read',id]);return {state:'READY'};},confirm:async(staff,id,input)=>{assert.equal(staff,actor);calls.push(['write',id,input]);return {state:'READY'};},image:async(staff,id,sha)=>{assert.equal(staff,actor);calls.push(['image',id,sha]);return {bytes:Buffer.from('image'),contentType:'image/jpeg'};}}};
 const handler=createConnectedHandler({connected,origin,assertRequest:async()=>calls.push('gateway'),boundary:{authenticate:async(cookie,csrf)=>{assert.equal(cookie,'staff');calls.push(['auth',csrf]);return actor;}}});
 const req={url:`/api/staff/manual-connected/cards/${cardId}/variants`,method:'GET',headers:{cookie:'staff'}};
 const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(v){this.statusCode=v;return this;},json(v){this.body=v;},send(v){this.body=v;}};
 return {calls,connected,handler,req,res,cardId};
}
test('variant GET is an authenticated no-store read; only explicit CSRF POST confirms',async()=>{
 const f=fixture();await f.handler(f.req,f.res);assert.equal(f.res.statusCode,200);assert.deepEqual(f.calls,['gateway',['auth',undefined],['read',f.cardId]]);assert.equal(f.res.headers['Cache-Control'],'private, no-store');
 const g=fixture();Object.assign(g.req,{url:g.req.url+'/confirm',method:'POST',body:{actionId:randomUUID()}});Object.assign(g.req.headers,{origin,'content-type':'application/json','x-atlas-csrf':'csrf'});await g.handler(g.req,g.res);assert.deepEqual(g.calls,['gateway',['auth','csrf'],['write',g.cardId,g.req.body]]);
});
test('variant routes reject unintended methods, queries, origin, missing CSRF and oversized input before service effects',async()=>{
 for(const change of [r=>r.method='GET',r=>r.url+='?refresh=1',r=>r.headers.origin='https://other.invalid',r=>delete r.headers['x-atlas-csrf'],r=>r.headers['content-type']='text/plain',r=>r.body={large:'x'.repeat(65536)}]){
  const f=fixture();Object.assign(f.req,{url:f.req.url+'/confirm',method:'POST',body:{}});Object.assign(f.req.headers,{origin,'content-type':'application/json','x-atlas-csrf':'csrf'});change(f.req);await f.handler(f.req,f.res);assert([403,405,413].includes(f.res.statusCode));assert.deepEqual(f.calls,['gateway']);
 }
 const f=fixture();f.connected.variantReview=null;await f.handler(f.req,f.res);assert.equal(f.res.body.error,'VARIANT_DISABLED');
});
test('reference image route is authenticated and isolated from active content',async()=>{
 const f=fixture();f.req.url+='/images/'+hash;await f.handler(f.req,f.res);assert.equal(f.res.statusCode,200);assert.deepEqual(f.calls,['gateway',['auth',undefined],['image',f.cardId,hash]]);assert.equal(f.res.headers['Content-Security-Policy'],"default-src 'none'; sandbox");assert.equal(f.res.headers['X-Content-Type-Options'],'nosniff');
});
test('reference read verifies exact saved image bytes and rejects changed source/result or revoked access after the read',async()=>{
 for(const scenario of ['valid','wrong-bytes','source-changed','result-changed','revoked']){
  const bytes=Buffer.from('fixture-image'),sha=digest(bytes),catalog=structuredClone(variantCatalog);catalog.candidates[0].images[0].sha256=sha;
  const saved={card:structuredClone(card),job:{key:hash,result_hash:hash,result:{catalog}}};let reads=0,fetches=0;
  const service=createVariantReviewService({store:{async read(){reads++;if(reads===2){if(scenario==='revoked')throw Object.assign(Error('revoked'),{code:'STAFF_ACCESS_REVOKED'});if(scenario==='source-changed')return {...saved,card:{...saved.card,draft:{...saved.card.draft,source:{sourceHash:'b'.repeat(64)}}}};if(scenario==='result-changed')return {...saved,job:{...saved.job,result_hash:'b'.repeat(64)}};}return saved;}},workflow:{},readReferenceImage:async(input)=>{fetches++;assert.equal(input.snapshot,catalog);assert.equal(input.candidateId,catalog.candidates[0].candidateId);return {bytes:scenario==='wrong-bytes'?Buffer.from('wrong'):bytes,mimeType:'image/jpeg'};}});
  if(scenario==='valid')assert.deepEqual((await service.image({},card.cardId,sha)).bytes,bytes);
  else await assert.rejects(service.image({},card.cardId,sha),e=>e.code===({'wrong-bytes':'VARIANT_IMAGE_UNVERIFIED','source-changed':'VARIANT_RESULT_STALE','result-changed':'VARIANT_RESULT_STALE',revoked:'STAFF_ACCESS_REVOKED'})[scenario]);
  assert.equal(fetches,1);
  await assert.rejects(service.image({},card.cardId,'c'.repeat(64)),e=>e.code==='VARIANT_IMAGE_NOT_FOUND');assert.equal(fetches,1);
 }
});
test('queued and failed status keep exact draft binding; confirmation forwards only one atomic workflow action',async()=>{
 for(const state of ['QUEUED','FAILED','UNKNOWN']){const value=variantReviewStatus({card,job:{key:hash,state},confirmation:null,approvalReady:false,reason:'VARIANT_CONFIRMATION_REQUIRED'});assert.equal(value.state,state);assert.equal(value.revision,4);for(const [key,val]of Object.entries(variantBinding(card)))assert.deepEqual(value[key],val);}
 const input={actionId:randomUUID(),expectedRevision:4,...variantBinding(card),jobId:null,resultHash:null,decision:'UNRESOLVED',candidateId:null,reviewed:true};delete input.cardId;let calls=0;
 const service=createVariantReviewService({store:{read:async()=>({card,job:null,confirmation:null,approvalReady:false})},workflow:{service:{execute:async(staff,id,request)=>{calls++;assert.equal(id,card.cardId);assert.equal(request.action.type,'VARIANT_CONFIRM');assert.equal(request.action.sourceHash,hash);assert.equal(request.expectedRevision,4);}}}});
 await service.confirm({},card.cardId,input);assert.equal(calls,1);await assert.rejects(service.confirm({},card.cardId,{...input,identity:{parallel:'Base'}}));assert.equal(calls,1);
});

test('explicit refresh uses authenticated CSRF POST and returns its durable request acknowledgement',async()=>{const f=fixture();Object.assign(f.req,{url:f.req.url+'/refresh',method:'POST',body:{requestId:randomUUID()}});Object.assign(f.req.headers,{origin,'content-type':'application/json','x-atlas-csrf':'csrf'});await f.handler(f.req,f.res);assert.equal(f.res.statusCode,200);assert.deepEqual(f.calls,['gateway',['auth','csrf'],['refresh',f.cardId,f.req.body]]);assert.equal(f.res.body.refreshRequestId,f.req.body.requestId);});

test('exact confirmed and refreshed historical actions acknowledge original binding independently of latest status',async()=>{
 const sourceHash='b'.repeat(64),identityHash='c'.repeat(64),input={actionId:randomUUID(),expectedRevision:1,sourceHash,identityRevision:1,identityHash,jobId:null,resultHash:null,decision:'UNRESOLVED',candidateId:null,reviewed:true},latest={card,job:null,confirmation:null,approvalReady:false};
 let fail=false;const service=createVariantReviewService({store:{read:async()=>latest,refresh:async()=>{if(fail)throw Object.assign(Error('stale'),{code:'VARIANT_REFRESH_CONFLICT'});}},workflow:{service:{execute:async()=>{if(fail)throw Object.assign(Error('conflict'),{code:'MANUAL_ACTION_CONFLICT'});return {card};}}}});
 const confirmed=await service.confirm({},card.cardId,input);assert.equal(confirmed.sourceHash,card.draft.source.sourceHash);assert.deepEqual(confirmed.acknowledgedRequest,{operation:'CONFIRM',requestId:input.actionId,sourceHash,identityRevision:1,identityHash});
 const refresh={requestId:randomUUID(),sourceHash,identityRevision:1,identityHash,jobId:hash};assert.deepEqual((await service.refresh({},card.cardId,refresh)).acknowledgedRequest,{operation:'REFRESH',requestId:refresh.requestId,sourceHash,identityRevision:1,identityHash});assert.equal((await service.status({},card.cardId)).acknowledgedRequest,undefined);
 fail=true;await assert.rejects(service.confirm({},card.cardId,input),{code:'MANUAL_ACTION_CONFLICT'});await assert.rejects(service.refresh({},card.cardId,refresh),{code:'VARIANT_REFRESH_CONFLICT'});
});
