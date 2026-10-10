import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {createVariantCatalogService} from '../src/variant-catalog.mjs';
import {createVariantListingProvider,prepareVariantListingRequest} from '../src/variant-listing-provider.mjs';
import {createVariantReviewService} from '../src/variant-service.mjs';

const identity={category:'POKEMON',name:'Mewtwo',year:'2016',setName:'Evolutions',cardNumber:'051/108',manufacturer:null,language:'en'};
const date='2026-10-10T10:00:00.000Z',now=()=>Date.parse(date),sha=v=>createHash('sha256').update(v).digest('hex');
const noNetwork=()=>assert.fail('Saved image GET must never acquire source, images or model output');
const responseFor=(request,status=200)=>{
 const bodyText=status===200?JSON.stringify({keyword:request.query,page:1,totalItems:1,hasNextPage:false,items:[{
  itemId:'123456780001',title:'2016 Pokemon Evolutions Mewtwo #51/108 English Reverse Holo',url:'https://www.ebay.com/itm/123456780001',
  thumbnailUrl:'https://i.ebayimg.com/images/g/fixture1/s-l300.jpg',listingType:'sold',condition:'Ungraded',endedAt:'2026-10-09',soldPrice:'99.95',soldCurrency:'USD',bestOfferAccepted:false
 }]}):'{"message":"retained failure"}';
 return {schemaVersion:'variant-listing-response/v1',requestKey:request.requestKey,url:request.url,httpStatus:status,contentType:'application/json',bodyText,sha256:sha(bodyText),capturedAt:date};
};

test('listing preparation requires durable worker capability; unknown and retained source errors stay explicit',async()=>{
 const provider=createVariantListingProvider({fetchImpl:noNetwork,now}),service=createVariantCatalogService({providers:[],listingProvider:provider,now});
 const missing=await service.prepare({identity});assert(missing.problems.includes('LISTING_SOURCE_NOT_CONFIGURED'));
 const unknown=await service.prepare({identity},{executeListingSource:async()=>({state:'UNKNOWN'})});assert(unknown.problems.includes('LISTING_SOURCE_OUTCOME_UNKNOWN'));
 const failure=await service.prepare({identity},{executeListingSource:async request=>({state:'REUSED',source:responseFor(request,429)})});assert(failure.problems.includes('LISTING_SOURCE_UNAVAILABLE'));
 assert.equal(failure.candidates.length,0);
 await assert.rejects(service.prepare({identity},{executeListingSource:async()=>{throw Object.assign(Error('priority'),{code:'VARIANT_GRADING_PRIORITY_DEFERRED'});}}),{code:'VARIANT_GRADING_PRIORITY_DEFERRED'});
});

test('hung metadata discovery cannot block independent listing retrieval, but external cancellation prevents dispatch',async()=>{
 const metadata={prepare:()=>new Promise(()=>{})},provider=createVariantListingProvider({fetchImpl:noNetwork,cache:{get:noNetwork,getRetained:noNetwork,put:noNetwork},now});let dispatches=0;
 const service=createVariantCatalogService({providers:[metadata],listingProvider:provider,now,timeoutMs:10});
 const executeListingSource=async request=>{dispatches++;const bodyText=JSON.stringify({keyword:request.query,page:1,totalItems:0,hasNextPage:false,items:[]});
  return {state:'REUSED',source:{...responseFor(request),bodyText,sha256:sha(bodyText)}};};
 const result=await service.prepare({identity},{executeListingSource});assert.equal(dispatches,1);
 assert(result.problems.includes('CATALOG_UNAVAILABLE'));assert(!result.problems.includes('LISTING_SOURCE_UNAVAILABLE'));
 const controller=new AbortController(),reason=Error('external cancellation');
 const pending=service.prepare({identity},{signal:controller.signal,executeListingSource});controller.abort(reason);
 await assert.rejects(pending,error=>error===reason);assert.equal(dispatches,1);
});

test('one saved source supplies separate physical cards and refreshed photos; authenticated retained GET stays offline after TTL and checks the current result',async()=>{
 const bytes=await sharp({create:{width:12,height:16,channels:3,background:'#125cab'}}).png().toBuffer(),entries=new Map(),journal=new Map();
 let paid=0,images=0,writes=0;
 const cache={get:async k=>entries.get(k),getRetained:async k=>entries.get(k),put:async(k,v)=>{writes++;entries.set(k,structuredClone(v));}};
 const provider=createVariantListingProvider({apiKey:'synthetic-credential',cache,now,fetchImpl:async url=>{
  if(url.startsWith('https://api.sold-comps.com/')){paid++;return new Response(responseFor(prepareVariantListingRequest(identity)).bodyText,{headers:{'content-type':'application/json'}});}
  images++;return new Response(bytes,{headers:{'content-type':'image/png'}});
 }});
 const executeListingSource=async(request,dispatch)=>{if(journal.has(request.requestKey))return {state:'REUSED',source:journal.get(request.requestKey)};const source=await dispatch();journal.set(request.requestKey,source);return {state:'SAVED',source};};
 const catalogClient={findCurrentSetCatalogPublications:async()=>[],prepareSetDemand:async()=>({state:'QUEUED',coverage:'unknown',candidates:[]})};
 const service=createVariantCatalogService({providers:[],catalogClient,listingProvider:provider,now});
 const snapshot=await service.prepare({identity,cardId:'physical-a'},{executeListingSource});
 const again=await service.prepare({identity,cardId:'physical-b',generation:'another-refresh'},{executeListingSource});
 assert.equal(paid,1);assert.equal(images,1);assert.equal(again.snapshotHash,snapshot.snapshotHash);
 const candidate=snapshot.candidates.find(c=>c.images.some(i=>i.relationship==='listing_photo')),image=candidate?.images.find(i=>i.relationship==='listing_photo');assert(image);
 assert.equal(image.listing.title,'2016 Pokemon Evolutions Mewtwo #51/108 English Reverse Holo');assert.doesNotMatch(JSON.stringify(snapshot),/99\.95|soldPrice|soldCurrency/);
 const beforeWrites=writes,restarted=createVariantCatalogService({providers:[{prepare:noNetwork}],listingProvider:createVariantListingProvider({cache,now:()=>now()+3*86400000,fetchImpl:noNetwork,inspectImage:noNetwork}),now});
 assert.equal((await restarted.readImage({snapshot,candidateId:candidate.candidateId,imageId:image.imageId})).sha256,sha(bytes));assert.equal(writes,beforeWrites);
 const card={cardId:'physical-a',draft:{source:{sourceHash:'a'.repeat(64)},identityRevision:1,identity:{cardName:'Mewtwo',year:'2016',productSet:'Evolutions',cardNumber:'051/108',parallel:null}}};
 let reads=0,stale=false;const saved={card,job:{key:'job-a',result_hash:'result-a',result:{catalog:snapshot}}};
 const review=createVariantReviewService({store:{read:async()=>{reads++;return stale&&reads%2===0?{...saved,job:{...saved.job,result_hash:'new-result'}}:saved;}},workflow:{},readReferenceImage:restarted.readImage});
 assert.deepEqual((await review.image({},card.cardId,image.sha256)).bytes,bytes);assert.equal(reads,2);
 stale=true;await assert.rejects(review.image({},card.cardId,image.sha256),{code:'VARIANT_RESULT_STALE'});
 assert.equal(paid,1);assert.equal(images,1);assert.equal(writes,beforeWrites);
});
