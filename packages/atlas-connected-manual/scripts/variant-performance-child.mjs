// Child of the owned disposable performance fixture only; no serving import.
import {PrismaClient} from '../../../frontend/atlas-app/.generated/staff-database/index.js';
import {localAccessConfig} from '../../../frontend/atlas-app/lib/server/access/fixture.mjs';
import {createMachineStaffBoundary} from '@atlas/manual-service/machine-auth';
import {createVariantJobStore} from '../src/variant-job-store.mjs';
import {createVariantWorker} from '../src/variant-worker.mjs';
import {createVariantAdmission} from '../src/variant-admission.mjs';
import {prepareVariantListingRequest} from '../src/variant-listing-provider.mjs';
import {createVariantPhotoProvider} from '../src/variant-photo-provider.mjs';
import {codexPhotoPoolKey,codexReadingKey,variantCodexChoice} from '../src/variant-codex.mjs';
import {createVariantReviewSnapshot,canonicalJson,variantSnapshotHash} from '@tenkings/card-catalog-evidence';
import {labelCatalog,labelPhoto,labelResponse} from '../test/variant-label-fixture.mjs';
import {digest} from '@atlas/manual-service/contract';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../../frontend/atlas-app/package.json',import.meta.url));
process.once('message',async config=>{
 let client,worker;const metrics={pid:process.pid,providerCalls:0,decodes:0,decodeMs:[],decodeIntervals:[],providerIntervals:[],cacheReads:0,cacheWrites:0,cacheHits:0,poolReferences:0,labelReadings:0,errors:[]};
 try{
  const sharp=require('sharp');sharp.concurrency(1);sharp.cache({memory:16,files:0,items:8});
  const url=new URL(config.manualUrl);if(!['127.0.0.1','localhost'].includes(url.hostname)||url.searchParams.get('connection_limit')!=='1')throw Error('OWNED_LOCAL_ONLY');
  client=new PrismaClient({datasources:{db:{url:url.href}},errorFormat:'minimal'});
  const access=localAccessConfig({databaseUrl:config.staffUrl,sessionKey:Buffer.from(config.sessionKey,'hex'),phoneKey:Buffer.from(config.phoneKey,'hex'),phones:config.phones});
  const boundary=createMachineStaffBoundary({boundary:{transaction(){throw Error('NO_HUMAN_AUTH');}},auth:{config:access},manualClient:client}),store=createVariantJobStore({boundary});
  const image=await sharp({create:{width:1800,height:2500,channels:3,background:'#927fa1'}}).jpeg({quality:85}).toBuffer();
  const labelSnapshot=structuredClone(labelCatalog({photos:0})),media=new Map();
  for(let index=0;index<2;index++){
   const bytes=await sharp({create:{width:1800,height:2500,channels:3,background:config.scenario==='failure'?(index?'#416985':'#648541'):(index?'#924fa1':'#927fa1')}}).jpeg({quality:85}).toBuffer();
   const descriptor={...labelPhoto(index).image,sha256:digest(bytes),mimeType:'image/jpeg',width:1800,height:2500};
   descriptor.imageId=`listing-image:${digest(canonicalJson({listing:descriptor.listing,sha256:descriptor.sha256,sourceResponseSha256:descriptor.sourceResponseSha256}))}`;
   labelSnapshot.referencePhotos.push(descriptor);media.set(descriptor.imageId,{bytes,sha256:descriptor.sha256,mimeType:descriptor.mimeType,width:descriptor.width,height:descriptor.height});
  }
  labelSnapshot.snapshotHash=variantSnapshotHash(labelSnapshot);
  const cacheKey='variant-source:v1:'+digest('performance-public-metadata'),entry={schemaVersion:'variant-source-cache/v1',key:cacheKey,url:'https://example.invalid/local-fixture',body:JSON.stringify({metadata:'x'.repeat(32000)}),sha256:digest(JSON.stringify({metadata:'x'.repeat(32000)})),capturedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString()};
  if(config.scenario==='warm')await store.cache.put(cacheKey,entry);
  const listingMode=config.scenario.startsWith('listing-');
  async function decode(bytes){const t=performance.now(),startedAt=Date.now();await sharp(bytes).resize(1270,1778).raw().toBuffer();metrics.decodes++;metrics.decodeMs.push(performance.now()-t);metrics.decodeIntervals.push({startedAt,finishedAt:Date.now()});}
  const catalog={async prepare(input,{executeListingSource}={}){
   process.send?.({type:'busy'});metrics.cacheReads++;const saved=await store.cache.get(cacheKey);if(saved)metrics.cacheHits++;else{await store.cache.put(cacheKey,entry);metrics.cacheWrites++;}
   if(!listingMode)return labelSnapshot;
   const request=prepareVariantListingRequest(input.identity,null,{graded:true}),outcome=await executeListingSource(request,async()=>{
    metrics.providerCalls++;const interval={startedAt:Date.now(),finishedAt:null,outcome:config.scenario==='listing-failure'?'UNKNOWN':'RESPONSE'};metrics.providerIntervals.push(interval);
    try{await new Promise(r=>setTimeout(r,2500));if(config.scenario==='listing-failure')throw Object.assign(Error('Synthetic source failure'),{code:'SYNTHETIC_PROVIDER_UNKNOWN'});
     const bodyText=JSON.stringify({keyword:request.query,page:1,totalItems:0,hasNextPage:false,items:[],metadata:'x'.repeat(32000)});
     return {schemaVersion:'variant-listing-response/v1',requestKey:request.requestKey,url:request.url,httpStatus:200,contentType:'application/json',bodyText,sha256:digest(bodyText),capturedAt:new Date().toISOString()};
    }finally{interval.finishedAt=Date.now();}
   });
   if(outcome.state==='REUSED')metrics.cacheHits++;
   if(outcome.source){await decode(image);await decode(image);const imageKey='variant-provider-image-evidence:v1:'+digest(image);await store.cache.put(imageKey,{...entry,schemaVersion:'variant-provider-image/v1',key:imageKey,body:image.toString('base64'),sha256:digest(image),mimeType:'image/jpeg',width:1800,height:2500});metrics.cacheWrites++;}
   return createVariantReviewSnapshot({identity:input.identity,candidates:[],problems:outcome.state==='UNKNOWN'?['LISTING_SOURCE_OUTCOME_UNKNOWN']:[],capturedAt:new Date().toISOString()});
  }};
  const provider=createVariantPhotoProvider({apiKey:'synthetic-performance-not-a-key',readReferenceImage:async({imageId})=>{
   if(listingMode)throw Error('LISTING_MUST_NOT_READ_LABEL_PHOTOS');const value=media.get(imageId);if(!value)throw Error('UNKNOWN_FIXTURE_IMAGE');await decode(value.bytes);return value;
  },fetchImpl:async(_url,options)=>{metrics.providerCalls++;const interval={startedAt:Date.now(),finishedAt:null,outcome:config.scenario==='failure'?'UNKNOWN':'RESPONSE'};metrics.providerIntervals.push(interval);
   try{await new Promise(r=>setTimeout(r,2500));if(config.scenario==='failure')throw Object.assign(Error('Synthetic provider failure'),{code:'SYNTHETIC_PROVIDER_UNKNOWN'});
    const body=JSON.parse(options.body),choices=JSON.parse(body.input[1].content[0].text).choices,photos=body.text.format.schema.properties.readings.items.properties.sha256.enum.map(sha256=>({sha256}));
    return Response.json(labelResponse({choices,photos}));
   }finally{interval.finishedAt=Date.now();}}});
  worker=createVariantWorker({store,catalog,admitDispatch:createVariantAdmission({boundary}),provider,projectResponse:()=>{throw Error('RETIRED_COMPARISON_FORBIDDEN');},intervalMs:5000,heartbeatMs:30000,concurrency:1,onError:e=>{metrics.errors.push(e.code);process.send?.({type:'diagnostic',code:e.code});}});
  process.on('message',async message=>{if(message?.type!=='stop')return;await worker.stop();
   if(!listingMode){const choice=variantCodexChoice(labelSnapshot.candidates[0]),pool=await store.cache.getRetained(codexPhotoPoolKey(choice));metrics.poolReferences=pool?.photos.length??0;
    for(const photo of provider.labelRequest(labelSnapshot).photos)if(await store.cache.getRetained(codexReadingKey(provider.labelRequest(labelSnapshot),photo.sha256)))metrics.labelReadings++;}
   await client.$disconnect();process.send?.({type:'done',metrics});process.disconnect();});
  worker.start();
 }catch(e){try{await worker?.stop();await client?.$disconnect();}catch{}process.send?.({type:'error',code:/^[A-Z][A-Z0-9_]+$/.test(e.code??'')?e.code:'LOCAL_PERFORMANCE_CHILD_FAILED'});process.exitCode=1;process.disconnect();}
});
