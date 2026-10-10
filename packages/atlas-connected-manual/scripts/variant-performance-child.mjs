// Child of the owned disposable performance fixture only; no serving import.
import {PrismaClient} from '../../../frontend/atlas-app/.generated/staff-database/index.js';
import {localAccessConfig} from '../../../frontend/atlas-app/lib/server/access/fixture.mjs';
import {createMachineStaffBoundary} from '@atlas/manual-service/machine-auth';
import {createVariantJobStore} from '../src/variant-job-store.mjs';
import {createVariantWorker} from '../src/variant-worker.mjs';
import {variantCatalog} from '../test/variant-fixture.mjs';
import {digest} from '@atlas/manual-service/contract';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../../frontend/atlas-app/package.json',import.meta.url));
process.once('message',async config=>{
 let client,worker;const metrics={pid:process.pid,providerCalls:0,decodes:0,decodeMs:[],cacheReads:0,cacheWrites:0,cacheHits:0,errors:[]};
 try{
  const sharp=require('sharp');sharp.concurrency(1);sharp.cache({memory:16,files:0,items:8});
  const url=new URL(config.manualUrl);if(!['127.0.0.1','localhost'].includes(url.hostname)||url.searchParams.get('connection_limit')!=='1')throw Error('OWNED_LOCAL_ONLY');
  client=new PrismaClient({datasources:{db:{url:url.href}},errorFormat:'minimal'});
  const access=localAccessConfig({databaseUrl:config.staffUrl,sessionKey:Buffer.from(config.sessionKey,'hex'),phoneKey:Buffer.from(config.phoneKey,'hex'),phones:config.phones});
  const boundary=createMachineStaffBoundary({boundary:{transaction(){throw Error('NO_HUMAN_AUTH');}},auth:{config:access},manualClient:client}),store=createVariantJobStore({boundary});
  const image=await sharp({create:{width:1800,height:2500,channels:3,background:'#927fa1'}}).jpeg({quality:85}).toBuffer();
  const cacheKey='variant-source:v1:'+digest('performance-public-metadata'),entry={schemaVersion:'variant-source-cache/v1',key:cacheKey,url:'https://example.invalid/local-fixture',body:JSON.stringify({metadata:'x'.repeat(32000)}),sha256:digest(JSON.stringify({metadata:'x'.repeat(32000)})),capturedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString()};
  if(config.scenario==='warm')await store.cache.put(cacheKey,entry);
  const catalog={async prepare(){process.send?.({type:'busy'});metrics.cacheReads++;const saved=await store.cache.get(cacheKey);if(saved)metrics.cacheHits++;else{await store.cache.put(cacheKey,entry);metrics.cacheWrites++;}return variantCatalog;}};
  const provider=async()=>{metrics.providerCalls++;await new Promise(r=>setTimeout(r,2500));if(config.scenario==='failure')throw Object.assign(Error('Synthetic provider failure'),{code:'SYNTHETIC_PROVIDER_UNKNOWN'});return {ok:true};};
  provider.prepare=async()=>({evidence:{requestSha256:digest('synthetic-performance')}});
  worker=createVariantWorker({store,catalog,loadPhotos:async()=>{process.send?.({type:'busy'});const t=performance.now();await Promise.all([sharp(image).resize(1270,1778).raw().toBuffer(),sharp(image).resize(1270,1778).raw().toBuffer()]);metrics.decodes+=2;metrics.decodeMs.push(performance.now()-t);return {};},provider,projectResponse:()=>({candidateId:null,confidence:null,reason:'Synthetic performance fixture',evidence:[]}),intervalMs:5000,heartbeatMs:30000,concurrency:1,onError:e=>{metrics.errors.push(e.code);process.send?.({type:'diagnostic',code:e.code});}});
  process.on('message',async message=>{if(message?.type!=='stop')return;await worker.stop();await client.$disconnect();process.send?.({type:'done',metrics});process.disconnect();});
  worker.start();
 }catch(e){try{await worker?.stop();await client?.$disconnect();}catch{}process.send?.({type:'error',code:/^[A-Z][A-Z0-9_]+$/.test(e.code??'')?e.code:'LOCAL_PERFORMANCE_CHILD_FAILED'});process.exitCode=1;process.disconnect();}
});
