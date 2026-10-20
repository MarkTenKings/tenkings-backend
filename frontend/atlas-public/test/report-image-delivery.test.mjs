import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import * as policy from '../lib/server/policy.mjs';
import * as accessContract from '../../../packages/atlas-service-bridge/src/inspection-access.mjs';
import { PublicReportReader } from '../lib/server/reader.mjs';
import { manualPublicClient, MANUAL_PUBLIC_ORIGIN, MANUAL_PUBLIC_PATH } from '../../../packages/atlas-service-bridge/src/manual-public.mjs';
import { createApprovedManualReader, createManualPublicHandler } from '../../../packages/atlas-connected-manual/src/publication-reader.mjs';
import { publicationFixture } from '../../../packages/atlas-connected-manual/test/publication-fixture.mjs';
import { reportImageURL } from '../../../packages/atlas-report-view/src/report-images-contract.mjs';
import { loadVerifiedImage } from '../../../packages/atlas-manual-workspace/src/verified-image.mjs';
import { createPublicImageAccessLoader } from '../components/public-image-access.mjs';

const require=createRequire(new URL('../../atlas-app/package.json',import.meta.url));
const babel=require('next/dist/compiled/babel/core'),nextRequire=createRequire(require.resolve('next/package.json'));
const compile=file=>babel.transformSync(readFileSync(new URL(file,import.meta.url),'utf8'),{filename:file,
 presets:[[require.resolve('next/babel'),{'preset-env':{targets:{node:'current'}}}]],babelrc:false,configFile:false}).code;
const routeCode=compile('../pages/api/reports/[token]/presentation/[side].js');
const hookCode=compile('../components/useInspectionImages.mjs');
function route(reader){const exports={};vm.runInNewContext(routeCode,{exports,require(name){
 if(name.endsWith('/policy.mjs'))return policy;if(name.endsWith('/runtime.mjs'))return{runtime:()=>reader};
 return nextRequire(name.startsWith('@babel/runtime/')?`next/dist/compiled/${name}`:name);}});return exports.default;}
function response(){return{headers:{},statusCode:null,body:null,setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},end(){return this;},send(v){this.body=v;return this;},json(v){this.body=v;return this;}};}
const requestFor=(image,extra={})=>({method:'GET',query:{token:image.publicToken,v:String(image.approvalVersion),side:image.side,sha:image.sha256,...extra}});
const flush=async()=>{for(let n=0;n<30;n++)await Promise.resolve();};

async function fullResolutionFixture(){
 const f=await publicationFixture();await f.publication.publish({},f.cardId,f.actionId);
 const manifest=JSON.parse(f.row.manifest),packet=await f.artifacts.read(manifest.packet.ref,{cardId:f.cardId,kind:'PUBLIC_REPORT',sourceHash:manifest.packet.sourceHash});
 // The byte loader verifies exact transport, not PNG decoding (covered by the
 // provider tests). This finite 25MiB payload must never cross the web bridge.
 const bytes=Buffer.alloc(25*1024*1024,117);Buffer.from('89504e470d0a1a0a','hex').copy(bytes);
 const binding={publicToken:packet.publicToken,approvalVersion:1,publicHash:f.row.public_hash};
 const image={...binding,side:'FRONT',sourceSha256:packet.images.FRONT.sha256,sha256:policy.digest(bytes),byteCount:bytes.length,
  width:3024,height:4032,contentType:'image/png',transparent:true,presentationOnly:true,preservesOriginalRGB:false,preservesOpaqueRGB:true,
  foregroundRGBValidation:'bounded-edge-rgb-v1',alignment:'original-frame',recipeVersion:'atlas-photoroom-plus-hd-v2',execution:'PHOTOROOM_PLUS_API'};
 image.url=reportImageURL(image);
 const grant={version:'atlas-approved-report-image-access-v1',execution:'PHOTOROOM_PLUS_API',...binding,side:'FRONT',image:{
  url:accessContract.INSPECTION_STORAGE_ORIGIN+'/cutout.png?signature=synthetic',sha256:image.sha256,byteCount:image.byteCount,mime:'image/png',width:image.width,height:image.height}};
 return{...f,packet,bytes,image,grant,envelope:{version:'atlas-report-images-v1',...binding,images:{FRONT:image}}};
}

test('Photoroom public route crosses the signed JSON bridge then verifies 25MiB directly from the fixed storage origin',async t=>{
 const f=await fullResolutionFixture();let queries=0,grants=0,bridgeBytes=0,storageFetches=0;
 const config=policy.makePublicConfig({mode:'LOCAL_FIXTURE',origin:'https://atlasgrading.com',deploymentId:'photoroom-fixture.vercel.app',
  releaseSha:'a'.repeat(40),manualOrigin:MANUAL_PUBLIC_ORIGIN,manualKey:Buffer.alloc(32,19)});
 const client={$transaction:async work=>work({async $queryRawUnsafe(_sql,token,version,deployment,release,hash){queries++;
  return token===f.image.publicToken&&version===1&&deployment===config.deploymentId&&release===config.releaseSha&&hash===config.configHash?[f.row]:[];}})};
 const reportImages={async manifest(){return f.envelope;},async image(){throw Error('PNG proxy must not be used');},
  async imageAccess(row,packet,side,hash){grants++;assert.equal(row.manifest_hash,f.row.manifest_hash);assert.equal(packet.publicToken,f.image.publicToken);
   return side==='FRONT'&&hash===f.image.sha256?f.grant:null;}};
 const native=createApprovedManualReader({client,artifacts:f.artifacts,storage:f.storage,reportImages});
 const handler=createManualPublicHandler({key:config.manualKey,reader:native});
 const server=createServer(async(req,res)=>{if(!await handler(req,res)){res.statusCode=404;res.end();}});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const fetchLocal=(url,options)=>new Promise((resolve,reject)=>{
  assert.equal(url,MANUAL_PUBLIC_ORIGIN+MANUAL_PUBLIC_PATH);assert.equal(options.redirect,'error');
  const req=request({host:'127.0.0.1',port:server.address().port,path:MANUAL_PUBLIC_PATH,method:'POST',signal:options.signal,
   headers:{...options.headers,host:'private.atlasgrading.com'}},res=>{const parts=[];res.on('data',part=>parts.push(part));res.on('error',reject);
   res.on('end',()=>{const body=Buffer.concat(parts);bridgeBytes+=body.length;assert.equal(res.headers['content-type'],'application/json');
    assert.ok(body.length<16384);resolve(new Response(body,{status:res.statusCode,headers:res.headers}));});});req.on('error',reject);req.end(options.body);
 });
 const reader=new PublicReportReader(config,manualPublicClient(config,fetchLocal)),handle=route(reader);
 const redirect=response();await handle(requestFor(f.image),redirect);assert.equal(redirect.statusCode,307);assert.equal(redirect.headers.Location,f.grant.image.url);
 assert.equal(redirect.body,null);assert.equal(redirect.headers['Content-Length'],undefined);assert.equal(redirect.headers['Cache-Control'],'no-store, max-age=0');
 const direct=response();await handle(requestFor(f.image,{delivery:'direct'}),direct);assert.equal(direct.statusCode,200);assert.deepEqual(direct.body,f.grant);
 const head=response();await handle({...requestFor(f.image),method:'HEAD'},head);assert.equal(head.statusCode,307);assert.equal(head.body,null);
 const bad=response();await handle(requestFor(f.image,{sha:'d'.repeat(64)}),bad);assert.equal(bad.statusCode,404);
 let blob;const verified=await loadVerifiedImage({...f.image,...direct.body.image},{origin:'https://atlasgrading.com',cryptoImpl:webcrypto,
  urlImpl:{createObjectURL(value){blob=value;return'blob:verified-photoroom';},revokeObjectURL(){}},fetchImpl:async(url,options)=>{
   storageFetches++;assert.equal(url,f.grant.image.url);assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');
   return new Response(f.bytes,{headers:{'content-type':'image/png','content-length':String(f.bytes.length)}});
  }});
 assert.equal(verified.sha256,f.image.sha256);assert.equal(blob.size,f.bytes.length);assert.equal(policy.digest(Buffer.from(await blob.arrayBuffer())),f.image.sha256);verified.dispose();
 assert.equal(storageFetches,1);assert.equal(grants,3);assert.ok(queries>=18);assert.ok(bridgeBytes<f.bytes.length/100);
});

test('presentation route preserves historical bytes and refuses invalid delivery selectors without a read',async()=>{
 const bytes=Buffer.from('historical PNG');let calls=0;const handle=route({async reportImage(){calls++;return{bytes,contentType:'image/png'};}});
 const image={publicToken:'ar_'+'A'.repeat(24),approvalVersion:1,side:'FRONT',sha256:'a'.repeat(64)};
 const get=response();await handle(requestFor(image),get);assert.equal(get.statusCode,200);assert.deepEqual(get.body,bytes);assert.equal(get.headers['Content-Length'],bytes.length);
 const head=response();await handle({...requestFor(image),method:'HEAD'},head);assert.equal(head.statusCode,200);assert.equal(head.body,null);
 const direct=response();await handle(requestFor(image,{delivery:'direct'}),direct);assert.equal(direct.statusCode,404);
 const bad=response();await handle(requestFor(image,{delivery:'arbitrary'}),bad);assert.equal(bad.statusCode,404);assert.equal(calls,3);
});

function hookHarness(fetchImpl, loaderOptions={}, sharedLoader=null){const slots=[],effects=[],cleanup=[];let cursor=0;
 const loadPublicImageAccess=sharedLoader??createPublicImageAccessLoader({fetchImpl,...loaderOptions});
 const react={useState(initial){const index=cursor++;if(!(index in slots))slots[index]=initial;return[slots[index],value=>{slots[index]=typeof value==='function'?value(slots[index]):value;}];},
  useEffect(action,deps){const index=cursor++,old=slots[index];if(!old||deps.some((v,n)=>v!==old[n])){slots[index]=deps;effects.push(()=>{cleanup[index]?.();cleanup[index]=action();});}}};
 const exports={};vm.runInNewContext(hookCode,{exports,AbortSignal,AbortController,fetch:fetchImpl,require(name){
  if(name==='react')return react;if(name==='@atlas/service-bridge/inspection-access')return accessContract;
  if(name==='./public-image-access.mjs')return{loadPublicImageAccess};
  return nextRequire(name.startsWith('@babel/runtime/')?`next/dist/compiled/${name}`:name);}});
 return{render(packet,hash,images){cursor=0;const value=exports.useInspectionImages(packet,hash,images);for(const effect of effects.splice(0))effect();return value;},close(){cleanup.forEach(fn=>fn?.());}};
}

test('public image hook resolves Photoroom grant before verification while retaining canonical and historical image paths',async()=>{
 const f=await fullResolutionFixture(),calls=[];let grant=f.grant;
 const h=hookHarness(async(url,options)=>{calls.push(url);assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');return{ok:true,json:async()=>grant};});
 try{
  assert.equal(h.render(f.packet,f.row.public_hash,f.envelope).FRONT.presentation,undefined);await flush();
  const loaded=h.render(f.packet,f.row.public_hash,f.envelope);assert.equal(loaded.FRONT.presentation.url,f.grant.image.url);
  assert.equal(loaded.FRONT.presentation.sha256,f.image.sha256);assert.equal(loaded.FRONT.presentation.byteCount,25*1024*1024);
  assert.equal(loaded.FRONT.inspection.url,`/api/reports/${f.packet.publicToken}/images/FRONT?v=1`);
  assert.deepEqual(calls,[f.image.url+'&delivery=direct']);
  const historical={...f.envelope,images:{FRONT:{...f.image,execution:'OPENAI_IMAGES_API'}}};
  assert.equal(h.render(f.packet,f.row.public_hash,historical).FRONT.presentation.url,f.image.url);
  grant={...f.grant,side:'BACK'};const changed={...f.envelope,images:{FRONT:{...f.image,sha256:'d'.repeat(64)}}};
  assert.equal(h.render(f.packet,f.row.public_hash,changed).FRONT.presentation,undefined);await flush();
  assert.equal(h.render(f.packet,f.row.public_hash,changed).FRONT.presentation,undefined);
 }finally{h.close();}
});


function productionAccessFixture(version=1) {
 const publicToken='ar_'+'J'.repeat(24),publicHash='c'.repeat(64),binding={publicToken,approvalVersion:version,publicHash};
 const packet={version:'atlas-public-manual-report-v2',mode:'PRODUCTION',publicToken,approvalVersion:version,images:{
  FRONT:{sha256:'a'.repeat(64),byteCount:100,width:1350,height:1858},BACK:{sha256:'b'.repeat(64),byteCount:101,width:1350,height:1858}}};
 const envelope={images:Object.fromEntries(['FRONT','BACK'].map(side=>[side,{...binding,side,execution:'PHOTOROOM_PLUS_API',
  url:`/api/reports/${publicToken}/presentation/${side}?v=${version}&sha=${side==='FRONT'?'d'.repeat(64):'e'.repeat(64)}`,
  sha256:side==='FRONT'?'d'.repeat(64):'e'.repeat(64),byteCount:200,width:3024,height:4032}]))};
 function response(url) {
  const side=url.includes('/FRONT?')?'FRONT':'BACK',optional=url.includes('/presentation/'),saved=optional?envelope.images[side]:packet.images[side];
  return{ok:true,status:200,json:async()=>({version:optional?'atlas-approved-report-image-access-v1':'atlas-approved-image-access-v1',
   ...(optional?{execution:'PHOTOROOM_PLUS_API'}:{}),...binding,side,image:{...saved,mime:optional?'image/png':'image/webp',
    url:`${accessContract.INSPECTION_STORAGE_ORIGIN}/${side}-${optional?'presentation':'inspection'}?version=${version}`}})};
 }
 return{packet,publicHash,envelope,response};
}
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
const tick=()=>new Promise(resolve=>setTimeout(resolve,2));

test('production first load waits for both canonical grants before optional work and preserves the saved version',async()=>{
 const f=productionAccessFixture(2),calls=[],waits=[];let active=0,peak=0;
 const h=hookHarness(async(url,init)=>{assert.match(url,/v=2/);calls.push(url);active++;peak=Math.max(peak,active);
  const wait=deferred();waits.push(wait);await wait.promise;active--;return f.response(url);});
 try{
  let images=h.render(f.packet,f.publicHash,f.envelope);assert.equal(images.FRONT.inspection.accessLoading,true);await flush();
  assert.equal(calls.length,2);assert.ok(calls.every(url=>url.includes('/images/')));
  waits[0].resolve();await flush();images=h.render(f.packet,f.publicHash,f.envelope);await flush();
  assert.ok(images.FRONT.inspection.url);assert.equal(images.BACK.inspection.accessLoading,true);assert.equal(calls.length,2);
  waits[1].resolve();await flush();images=h.render(f.packet,f.publicHash,f.envelope);await flush();
  assert.ok(images.BACK.inspection.url);assert.equal(calls.length,4);assert.ok(calls.slice(2).every(url=>url.includes('/presentation/')));
  waits[2].resolve();waits[3].resolve();await flush();images=h.render(f.packet,f.publicHash,f.envelope);
  assert.ok(images.FRONT.presentation.url);assert.ok(images.BACK.presentation.url);assert.equal(peak,2);
 }finally{h.close();}
});

test('production Back 503 recovers automatically; explicit Back retry preserves Front grant and presentation',async()=>{
 const f=productionAccessFixture(),calls=[];let backCalls=0,failBack=false;
 const h=hookHarness(async url=>{calls.push(url);if(url.includes('/images/BACK?')){backCalls++;if(backCalls===1)return{ok:false,status:503};if(failBack)return{ok:false,status:404};}return f.response(url);},{retryDelays:[0,0]});
 try{
  h.render(f.packet,f.publicHash,f.envelope);for(let i=0;i<10;i++){await tick();h.render(f.packet,f.publicHash,f.envelope);}
  let images=h.render(f.packet,f.publicHash,f.envelope);assert.equal(backCalls,2);assert.ok(images.BACK.inspection.url);assert.equal(images.BACK.inspection.accessError,false);
  const front=images.FRONT.inspection.url,frontPresentation=images.FRONT.presentation.url,frontCalls=calls.filter(url=>url.includes('/FRONT?')).length;
  failBack=true;images.BACK.inspection.retryAccess();images=h.render(f.packet,f.publicHash,f.envelope);assert.equal(images.FRONT.inspection.url,front);
  assert.equal(images.FRONT.presentation.url,frontPresentation);await flush();images=h.render(f.packet,f.publicHash,f.envelope);
  assert.equal(images.BACK.inspection.accessError,true);assert.equal(calls.filter(url=>url.includes('/FRONT?')).length,frontCalls);
  failBack=false;images.BACK.inspection.retryAccess();h.render(f.packet,f.publicHash,f.envelope);await flush();images=h.render(f.packet,f.publicHash,f.envelope);await flush();
  assert.ok(images.BACK.inspection.url);assert.equal(images.FRONT.inspection.url,front);assert.equal(calls.filter(url=>url.includes('/FRONT?')).length,frontCalls);
 }finally{h.close();}
});

test('production malformed grants and unavailable optional images cannot replace canonical evidence',async()=>{
 for(const mutate of [v=>{v.publicHash='f'.repeat(64);},v=>{v.approvalVersion=2;},v=>{v.side='BACK';},v=>{v.image.sha256='f'.repeat(64);},
  v=>{v.image.byteCount++;},v=>{v.image.url='https://other.invalid/image';},v=>{v.image.width=999;}]){
  const f=productionAccessFixture(),calls=[];const h=hookHarness(async url=>{calls.push(url);const response=f.response(url);
   if(url.includes('/presentation/'))return{ok:false,status:404};
   if(url.includes('/images/FRONT?')){const value=await response.json();mutate(value);return{...response,json:async()=>value};}return response;},{retryDelays:[0,0]});
  try{h.render(f.packet,f.publicHash,f.envelope);await flush();let images=h.render(f.packet,f.publicHash,f.envelope);await flush();images=h.render(f.packet,f.publicHash,f.envelope);
   assert.equal(images.FRONT.inspection.accessError,true);assert.equal(images.FRONT.inspection.url,undefined);assert.ok(images.BACK.inspection.url);
   assert.equal(images.FRONT.presentation,undefined);assert.equal(images.BACK.presentation,undefined);assert.equal(calls.filter(url=>url.includes('/images/FRONT?')).length,1);
  }finally{h.close();}
 }
});

test('replacing a report during slow grant parsing cannot publish old images and unmount cancels queued work',async()=>{
 const old=productionAccessFixture(1),next=productionAccessFixture(2),waits=[],calls=[];
 const h=hookHarness(async(url,options)=>{calls.push(url);if(url.includes('v=1')){const wait=deferred();waits.push({wait,signal:options.signal});return{ok:true,status:200,json:()=>wait.promise};}return next.response(url);});
 try{
  h.render(old.packet,old.publicHash,old.envelope);await flush();let images=h.render(next.packet,next.publicHash,next.envelope);await flush();
  assert.equal(images.FRONT.inspection.url,undefined);assert.equal(images.BACK.inspection.url,undefined);assert.ok(waits.every(value=>value.signal.aborted));
  waits.forEach((value,index)=>value.wait.resolve(old.response(`/images/${index===0?'FRONT':'BACK'}?v=1`).json()));await flush();
  images=h.render(next.packet,next.publicHash,next.envelope);await flush();images=h.render(next.packet,next.publicHash,next.envelope);
  assert.match(images.FRONT.inspection.url,/version=2/);assert.match(images.BACK.inspection.url,/version=2/);
  assert.equal(calls.filter(url=>url.includes('v=1')&&url.includes('/presentation/')).length,0);
 }finally{h.close();}
});


test('two mounted production report hooks share admission and cancellation leaves the remaining report usable',async()=>{
 const first=productionAccessFixture(1),second=productionAccessFixture(2),calls=[],waits=[];
 const fetchImpl=async(url,options)=>{calls.push(url);const wait=deferred();waits.push({wait,url,signal:options.signal});await wait.promise;
  return(url.includes('v=1')?first:second).response(url);};
 const loader=createPublicImageAccessLoader({fetchImpl}),a=hookHarness(fetchImpl,{},loader),b=hookHarness(fetchImpl,{},loader);
 try{
  a.render(first.packet,first.publicHash,first.envelope);b.render(second.packet,second.publicHash,second.envelope);await flush();assert.equal(calls.length,2);
  a.close();assert.ok(waits.every(value=>value.signal.aborted));waits[0].wait.resolve();waits[1].wait.resolve();await flush();
  assert.equal(calls.length,4);assert.ok(calls.slice(2).every(url=>url.includes('v=2')));
  waits[2].wait.resolve();waits[3].wait.resolve();await flush();const images=b.render(second.packet,second.publicHash,second.envelope);await flush();
  assert.ok(images.FRONT.inspection.url);assert.ok(images.BACK.inspection.url);assert.equal(calls.filter(url=>url.includes('v=1')&&url.includes('/presentation/')).length,0);
  for(const value of waits.slice(4))value.wait.resolve();await flush();
 }finally{a.close();b.close();}
});
