import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { webcrypto } from 'node:crypto';
import { CustomerAuth } from '../lib/server/auth.mjs';
import { makeConfig } from '../lib/server/config.mjs';
import { createHandler } from '../lib/server/http.mjs';
import { createCollectionDisplayComposition } from '../lib/server/collection-display-composition.mjs';
import { collectionDisplayBinding, displayFrontPath } from '../lib/collection-display-contract.mjs';
import { createCollectionDisplayFixture, deferred, sha } from './collection-display-fixture.mjs';
import { approvedReportHandler } from '../../atlas-public/lib/server/approved-report-http.mjs';
import { signRoute } from '@atlas/site-router/proof';
import { acceptsSiteRequest } from '@atlas/site-router/server';

const turn=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture(...values) {
  const enabled=values.length?values[0]:'1';
  const f=await createCollectionDisplayFixture();f.publicCalls=[];f.admissions=0;f.publicHook=null;
  const config=makeConfig({mode:'LOCAL_FIXTURE',origin:'https://atlasgrading.com',deploymentId:'display-fixture.vercel.app',deploymentHost:'display-fixture.vercel.app',releaseSha:'0'.repeat(40),
    accountSid:'AC'+'0'.repeat(32),serviceSid:'VA'+'0'.repeat(32),phoneKey:Buffer.alloc(32,8),sessionKey:Buffer.alloc(32,9),routerKey:Buffer.alloc(32,10),cookies:{browser:'browser',session:'session'}});
  const auth=new CustomerAuth({config,database:{async call(action,input){assert.equal(action,'bootstrap');return {browserHash:input.browserHash,customer:{id:f.accountId}};}}});
  const state={auth,config,ownershipRead:f.ownershipRead,clientAddress:()=> 'fixture',cookie:()=> 'fixture-cookie',
    assertRequest(req){assert.equal(this,state);f.admissions++;if(!acceptsSiteRequest(req,{zone:'customer',deploymentId:config.deploymentHost,routerKey:config.routerKey}))throw {status:403};}};
  const publicHandler=approvedReportHandler(()=>({read:()=>({packet:structuredClone(f.packet),publicHash:f.card.approvedCard.report.publicHash})}));
  const request=async(url,options)=>{
    f.publicCalls.push({url,options});assert.equal(new URL(url).origin,'https://atlasgrading.com');
    assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.deepEqual(Object.keys(options.headers).sort(),['accept','accept-encoding']);
    if(f.publicHook)await f.publicHook(url,options);
    if(new URL(url).pathname.endsWith('/images/FRONT'))return new Response(f.bytes,{headers:{'content-type':'image/webp','cache-control':'no-store'}});
    const res={headers:{},setHeader(k,v){this.headers[k]=String(v);},status(n){this.code=n;return this;},end(bytes){this.bytes=bytes;},send(bytes){this.bytes=bytes;}};
    await publicHandler({method:'GET',url:new URL(url).pathname+new URL(url).search,headers:{}},res);
    return new Response(res.bytes,{status:res.code,headers:res.headers});
  };
  const options={customerState:state,enabled,request},composition=createCollectionDisplayComposition(options);state.collectionDisplay=composition;
  async function req(patch={}){
    const url=patch.url??`/api/customer/collection/cards/${f.card.cardId}/display`,method=patch.method??'GET';
    const proof=await signRoute({zone:'customer',deployment:`https://${config.deploymentHost}`,method,target:'/account'+url,issuedAt:Date.now()},config.routerKey.toString('base64'),webcrypto);
    return Object.assign(new EventEmitter(),{method,url,body:'',socket:{remoteAddress:'127.0.0.1'},...patch,headers:{host:config.deploymentHost,'x-forwarded-host':config.deploymentHost,'x-forwarded-proto':'https',cookie:f.cookie,...proof,...patch.headers}});
  }
  function response(){return Object.assign(new EventEmitter(),{headers:{},writes:0,setHeader(k,v){this.headers[k.toLowerCase()]=String(v);},status(n){this.code=n;return this;},
    json(value){this.value=value;this.writes++;this.writableEnded=true;return this;},end(bytes){this.bytes=bytes;this.writes++;this.writableEnded=true;return this;}});}
  async function invoke(request,res=response()){await createHandler(state)(request,res);assert.match(res.headers['cache-control'],/private, no-store/);assert.equal(request.listenerCount('aborted'),0);assert.equal(res.listenerCount('close'),0);return res;}
  return Object.assign(f,{config,auth,state,options,composition,req,response,invoke,front:()=>displayFrontPath(collectionDisplayBinding(f.card,f.accountId)).replace('/account','')});
}

test('disabled/malformed display is inert and private; hint is configuration only; ordinary routes survive',async()=>{
  for(const enabled of [undefined,null,'','0',true,'true']){
    const f=await fixture(enabled);assert.equal(f.composition.configuredForDisplay,false);const r=await f.invoke(await f.req());assert.equal(r.code,503);
    assert.equal(f.publicCalls.length,0);assert.equal(f.reads.length,0);assert.equal(f.admissions,0);
    assert.equal((await f.invoke(await f.req({url:'/api/customer/session'}))).code,200);
  }
  const f=await fixture();assert.equal(f.composition.configuredForDisplay,true);assert.equal(f.reads.length,0);f.ownerHook=()=>{throw {code:'OWNERSHIP_NOT_FOUND',status:404};};
  assert.equal((await f.invoke(await f.req())).code,403);assert.equal(f.publicCalls.length,0);assert.equal(f.composition.configuredForDisplay,true);
  f.composition.close();assert.equal(f.composition.configuredForDisplay,false);assert.equal((await f.invoke(await f.req())).code,503);
});
test('actual router→signed handler→shared display service→fixed public adapter yields exact metadata and Front with one admission',async()=>{
  const f=await fixture(),original=JSON.stringify(f.packet);const meta=await f.invoke(await f.req());assert.equal(meta.code,200);assert.equal(meta.value.title.startsWith('Synthetic'),true);
  assert.equal(f.admissions,1);assert.equal(f.publicCalls.length,1);assert.equal(f.reads.length,2);
  const photo=await f.invoke(await f.req({url:f.front()}));assert.equal(photo.code,200);assert.equal(sha(photo.bytes),meta.value.front.sha256);
  assert.equal(f.admissions,2);assert.equal(f.publicCalls.length,4);assert.equal(f.reads.length,6);assert.equal(JSON.stringify(f.packet),original);
  assert.equal(photo.headers['content-type'],'image/webp');assert.equal(photo.headers['x-atlas-image-sha256'],meta.value.front.sha256);
  assert(f.reads.every(x=>x.kind==='owner'&&x.action==='read_card'));assert(f.publicCalls.every(x=>!JSON.stringify(x.options.headers).includes(f.cookie)));
});
test('only exact two GET paths, canonical query and existing cookie/signed ingress are admitted',async()=>{
  const f=await fixture();
  for(const patch of [{method:'POST'},{headers:{cookie:''}},{headers:{'x-atlas-route-proof':'0'.repeat(64)}},{body:{accountId:f.accountId}},
    {url:`/api/customer/collection/cards/${f.card.cardId}/display?url=https://other.invalid`},{url:f.front()+'&version=1'},
    {url:`/api/customer/collection/cards/${f.card.cardId}/display/back`},{url:`/api/customer/collection/cards/${f.card.cardId}/preview`}])assert.notEqual((await f.invoke(await f.req(patch))).code,200);
  assert.equal(f.reads.length,0);assert.equal(f.publicCalls.length,0);
  const disabled=await fixture('0');assert.equal((await disabled.invoke(await disabled.req({method:'POST'}))).code,405);
});
test('current owner disappearance after public I/O denies output, public availability never proves title',async()=>{
  const f=await fixture();f.publicHook=()=>{f.ownerHook=()=>{throw {status:404,code:'OWNERSHIP_NOT_FOUND'};};};
  const r=await f.invoke(await f.req());assert.equal(r.code,403);assert.deepEqual(r.value,{error:'COLLECTION_DISPLAY_ACCESS_ENDED'});assert.equal(f.admissions,1);
});
test('observed public read fences trusted reader/auth/router/config/request changes before output',async()=>{
  for(const change of [f=>{f.state.ownershipRead={read:()=>assert.fail('replacement used')};},f=>{f.ownershipRead.read=()=>assert.fail('replacement used');},
    f=>{f.config.routerKey[0]^=1;},f=>{f.state.config={...f.config,deploymentHost:'other.invalid'};},f=>{f.state.auth=new CustomerAuth({config:f.config,database:{}});},
    f=>{f.options.request=()=>assert.fail('replacement used');},(_f,req)=>{req.headers['x-forwarded-host']='other.invalid';}]){
    const f=await fixture(),entered=deferred(),release=deferred();f.publicHook=()=>{entered.resolve();return release.promise;};const req=await f.req(),pending=f.invoke(req);await entered.promise;change(f,req);release.resolve();
    const r=await pending;assert([403,503].includes(r.code));assert(!r.bytes);assert(!r.value?.title);assert.equal(f.admissions,1);
  }
});
test('request abort/response close during observed owner await emits nothing and starts no later public I/O',async()=>{
  for(const event of ['aborted','close'])for(const front of [false,true]){
    const f=await fixture(),entered=deferred(),release=deferred();f.ownerHook=()=>{entered.resolve();return release.promise;};const req=await f.req(front?{url:f.front()}:{}),res=f.response();
    const pending=f.invoke(req,res);await entered.promise;(event==='aborted'?req:res).emit(event);await pending;assert.equal(res.writes,0);release.resolve();await turn();assert.equal(f.publicCalls.length,0);assert.equal(f.reads.length,1);
  }
});
test('request abort cancels an observed stalled public body and removes handler listeners',async()=>{
  const f=await fixture(),entered=deferred();let cancelled=0;
  f.options.request=()=>new Response(new ReadableStream({pull(){entered.resolve();return new Promise(()=>{});},cancel(){cancelled++;}}),{headers:{'content-type':'application/json','cache-control':'no-store'}});
  f.state.collectionDisplay=createCollectionDisplayComposition(f.options);const req=await f.req(),res=f.response(),pending=f.invoke(req,res);await entered.promise;req.emit('aborted');await pending;
  assert.equal(res.writes,0);assert.equal(cancelled,1);assert.equal(f.reads.length,1);
});
test('shared service keeps the two-read admission bound across concurrent HTTP requests',async()=>{
  const f=await fixture(),entered=deferred(),release=deferred();let count=0;f.publicHook=()=>{if(++count===2)entered.resolve();return release.promise;};
  const a=f.invoke(await f.req()),b=f.invoke(await f.req());await entered.promise;const c=await f.invoke(await f.req());assert.equal(c.code,503);assert.equal(f.publicCalls.length,2);
  release.resolve();assert.equal((await a).code,200);assert.equal((await b).code,200);assert.equal(f.admissions,3);
});
