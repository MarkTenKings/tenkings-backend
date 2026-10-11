import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {createVariantCatalogService} from '../src/variant-catalog.mjs';
import {createVariantListingProvider,prepareVariantListingRequest} from '../src/variant-listing-provider.mjs';
import {importScrydexVariantCandidates,scrydexVariantSearchUrl} from '@tenkings/card-catalog-evidence';
import {createVariantReviewService} from '../src/variant-service.mjs';
import {codexChoices,codexReadingKey} from '../src/variant-codex.mjs';
import {VARIANT_LABEL_POLICY,VARIANT_PHOTO_MODEL} from '../src/variant-photo-provider.mjs';

const identity={category:'POKEMON',name:'Mewtwo',year:'2016',setName:'Evolutions',cardNumber:'051/108',manufacturer:null,language:'en'};
const date='2026-10-10T10:00:00.000Z',now=()=>Date.parse(date),sha=v=>createHash('sha256').update(v).digest('hex');
const noNetwork=()=>assert.fail('Saved image GET must never acquire source, images or model output');
const responseFor=(request,status=200)=>{
 const bodyText=status===200?JSON.stringify({keyword:request.query,page:1,totalItems:1,hasNextPage:false,items:[{
  itemId:'123456780001',title:'2016 Pokemon Evolutions Mewtwo #51/108 PSA 9',url:'https://www.ebay.com/itm/123456780001',
  thumbnailUrl:'https://i.ebayimg.com/images/g/fixture1/s-l300.jpg',listingType:'sold',condition:'PSA 9',endedAt:'2026-10-09',soldPrice:'99.95',soldCurrency:'USD',bestOfferAccepted:false
 }]}):'{"message":"retained failure"}';
 return {schemaVersion:'variant-listing-response/v1',requestKey:request.requestKey,url:request.url,httpStatus:status,contentType:'application/json',bodyText,sha256:sha(bodyText),capturedAt:date};
};

const printing={name:'Reverse Holofoil',language:'en'};
const metadata={prepare:async()=>({candidates:importScrydexVariantCandidates({identity,card:{id:'xy12-51',name:'Mewtwo',number:'51',printed_number:'51/108',language_code:'en',expansion:{id:'xy12',name:'Evolutions',release_date:'2016/11/02',is_online_only:false},variants:[{name:'reverseHolofoil'}]},source:{url:scrydexVariantSearchUrl(identity),sha256:sha('fixture'),capturedAt:date}}),problems:[],truncated:false})};

test('listing preparation requires durable worker capability; unknown and retained source errors stay explicit',async()=>{
 const provider=createVariantListingProvider({fetchImpl:noNetwork,now}),service=createVariantCatalogService({providers:[metadata],listingProvider:provider,now});
 const missing=await service.prepare({identity});assert(missing.problems.includes('LISTING_SOURCE_NOT_CONFIGURED'));
 const unknown=await service.prepare({identity},{executeListingSource:async()=>({state:'UNKNOWN'})});assert(unknown.problems.includes('LISTING_SOURCE_OUTCOME_UNKNOWN'));
 const failure=await service.prepare({identity},{executeListingSource:async request=>({state:'REUSED',source:responseFor(request,429)})});assert(failure.problems.includes('LISTING_SOURCE_UNAVAILABLE'));
 assert.equal(failure.candidates.length,1);
 await assert.rejects(service.prepare({identity},{executeListingSource:async()=>{throw Object.assign(Error('priority'),{code:'VARIANT_GRADING_PRIORITY_DEFERRED'});}}),{code:'VARIANT_GRADING_PRIORITY_DEFERRED'});
});

test('missing catalog metadata never buys unnamed listing photos, and external cancellation prevents dispatch',async()=>{
 const metadata={prepare:()=>new Promise(()=>{})},provider=createVariantListingProvider({fetchImpl:noNetwork,cache:{get:noNetwork,getRetained:noNetwork,put:noNetwork},now});let dispatches=0;
 const service=createVariantCatalogService({providers:[metadata],listingProvider:provider,now,timeoutMs:10});
 const executeListingSource=async request=>{dispatches++;const bodyText=JSON.stringify({keyword:request.query,page:1,totalItems:0,hasNextPage:false,items:[]});
  return {state:'REUSED',source:{...responseFor(request),bodyText,sha256:sha(bodyText)}};};
 const result=await service.prepare({identity},{executeListingSource});assert.equal(dispatches,0);
 assert(result.problems.includes('CATALOG_UNAVAILABLE'));assert(!result.problems.includes('LISTING_SOURCE_UNAVAILABLE'));
 const controller=new AbortController(),reason=Error('external cancellation');
 const pending=service.prepare({identity},{signal:controller.signal,executeListingSource});controller.abort(reason);
 await assert.rejects(pending,error=>error===reason);assert.equal(dispatches,0);
});

test('one saved source supplies separate physical cards and refreshed photos; authenticated retained GET stays offline after TTL and checks the current result',async()=>{
 const bytes=await sharp({create:{width:12,height:16,channels:3,background:'#125cab'}}).png().toBuffer(),entries=new Map(),journal=new Map();
 let paid=0,images=0,writes=0;
 const cache={get:async k=>entries.get(k),getRetained:async k=>entries.get(k),put:async(k,v)=>{writes++;entries.set(k,structuredClone(v));}};
 const provider=createVariantListingProvider({apiKey:'synthetic-credential',cache,now,fetchImpl:async url=>{
  if(url.startsWith('https://api.sold-comps.com/')){paid++;return new Response(responseFor(prepareVariantListingRequest(identity,printing,{graded:true})).bodyText,{headers:{'content-type':'application/json'}});}
  images++;return new Response(bytes,{headers:{'content-type':'image/png'}});
 }});
 const executeListingSource=async(request,dispatch,{retainedOnly=false}={})=>{if(journal.has(request.requestKey))return {state:'REUSED',source:journal.get(request.requestKey)};if(retainedOnly)return {state:'MISSING'};const source=await dispatch();journal.set(request.requestKey,source);return {state:'SAVED',source};};
 const catalogClient={findCurrentSetCatalogPublications:async()=>[],prepareSetDemand:async()=>({state:'QUEUED',coverage:'unknown',candidates:[]})};
 const service=createVariantCatalogService({providers:[metadata],catalogClient,listingProvider:provider,cache,now});
 const snapshot=await service.prepare({identity,cardId:'physical-a'},{executeListingSource});
 const settledImage=snapshot.referencePhotos[0];
 entries.set(codexReadingKey({policy:VARIANT_LABEL_POLICY,model:VARIANT_PHOTO_MODEL},settledImage.sha256),{
  schemaVersion:'atlas-codex-reading/v1',policy:VARIANT_LABEL_POLICY,choices:codexChoices(snapshot),
  reading:{sha256:settledImage.sha256,candidateKey:null,gradingCompany:'PSA',labelText:'2016 Pokemon Mewtwo',reason:'Finish remains unreadable'}});
 const again=await service.prepare({identity,cardId:'physical-b'},{executeListingSource});
 assert.equal(paid,1);assert.equal(images,1);assert.equal(again.snapshotHash,snapshot.snapshotHash);
 const image=snapshot.referencePhotos[0];assert(image);assert(snapshot.candidates.every(c=>c.images.every(i=>i.relationship!=='listing_photo')),'seller titles never attach photos to a printing');
 assert.equal(image.listing.title,'2016 Pokemon Evolutions Mewtwo #51/108 PSA 9');assert.doesNotMatch(JSON.stringify(snapshot),/99\.95|soldPrice|soldCurrency/);
 const beforeWrites=writes,restarted=createVariantCatalogService({providers:[{prepare:noNetwork}],listingProvider:createVariantListingProvider({cache,now:()=>now()+3*86400000,fetchImpl:noNetwork,inspectImage:noNetwork}),now});
 assert.equal((await restarted.readImage({snapshot,candidateId:null,imageId:image.imageId})).sha256,sha(bytes));assert.equal(writes,beforeWrites);
 const card={cardId:'physical-a',draft:{source:{sourceHash:'a'.repeat(64)},identityRevision:1,identity:{cardName:'Mewtwo',year:'2016',productSet:'Evolutions',cardNumber:'051/108',parallel:null}}};
 let reads=0,stale=false;const saved={card,job:{key:'job-a',result_hash:'result-a',result:{catalog:snapshot}}};
 const review=createVariantReviewService({store:{read:async()=>{reads++;return stale&&reads%2===0?{...saved,job:{...saved.job,result_hash:'new-result'}}:saved;}},workflow:{},readReferenceImage:restarted.readImage});
 assert.deepEqual((await review.image({},card.cardId,image.sha256)).bytes,bytes);assert.equal(reads,2);
 stale=true;await assert.rejects(review.image({},card.cardId,image.sha256),{code:'VARIANT_RESULT_STALE'});
 assert.equal(paid,1);assert.equal(images,1);assert.equal(writes,beforeWrites);
});

test('official sports metadata bypasses alternate acquisition and searches every known printing once across repeated cards',async()=>{
 const {createManufacturerChecklistVariantProvider}=await import('@tenkings/card-catalog-evidence');
 const target={category:'SPORTS',name:'Drake Maye',year:'2024',setName:'Donruss Optic',cardNumber:'229',manufacturer:'Panini',language:null};
 const labels=['Rated Rookies','Rated Rookies Blue','Rated Rookies Blue Hyper','Rated Rookies Orange','Rated Rookies Green','Rated Rookies Purple','Rated Rookies Red','Rated Rookies Gold','Rated Rookies Black'];
 const metadata=createManufacturerChecklistVariantProvider({catalog:{schemaVersion:'manufacturer-checklist/v1',complete:false,sources:[{manufacturer:'Panini',year:'2024',setName:'Donruss Optic',sport:'football',aliases:[],url:'https://www.paniniamerica.net/checklist.html',sha256:sha('synthetic source')}],rows:labels.map(label=>[0,label,'229','Drake Maye','New England Patriots'])}});
 const provider=createVariantListingProvider({fetchImpl:noNetwork,now,cache:{get:noNetwork,getRetained:noNetwork,put:noNetwork}}),journal=new Map();
 const service=createVariantCatalogService({providers:[metadata],listingProvider:provider,now,catalogClient:{findCurrentSetCatalogPublications:noNetwork,prepareSetDemand:noNetwork}});
 const executeListingSource=async(request,_dispatch,{retainedOnly=false}={})=>{if(journal.has(request.requestKey))return {state:'REUSED',source:journal.get(request.requestKey)};if(retainedOnly)return {state:'MISSING'};const bodyText=JSON.stringify({keyword:request.query,page:1,totalItems:0,hasNextPage:false,items:[]});const source={...responseFor(request),bodyText,sha256:sha(bodyText)};journal.set(request.requestKey,source);return {state:'SAVED',source};};
 const first=await service.prepare({identity:target},{executeListingSource}),second=await service.prepare({identity:target},{executeListingSource});
 assert.equal(journal.size,9);assert.equal(first.candidates.length,9);assert.deepEqual(first,second);assert(first.candidates.every(c=>c.images.length===0&&c.source.provider==='manufacturer_checklist'));
});
