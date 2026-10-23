import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createServer,request as httpRequest} from 'node:http';
import {canonicalHostFixture,bootstrapFixture} from './host-bootstrap-fixtures.mjs';
import {createR1MarketplaceAuthBridge} from '../src/auth-r1.mjs';
import {createR1MarketplaceHost} from '../src/host-r1.mjs';
import {createHostedFinance} from '../src/host-finance.mjs';
import {createR1MarketplaceRouteComposition} from '../src/routes-r1.mjs';
import {requireValue} from '../src/contract.mjs';
import {acceptsSiteRequest} from '../../atlas-site-router/server.mjs';
import {signRoute} from '../../atlas-site-router/proof.mjs';

// Actual canonical auth classes and HMAC signer/verifier; SQL/provider ports
// are isolated doubles. PRODUCTION here selects only the ingress contract.
async function signedFixture(finance=false){
  const f=await (finance?bootstrapFixture():canonicalHostFixture());
  const {r1,config}=f.options;config.authPolicy.r1Mode='PRODUCTION';
  for(const [zone,state] of [['customer',r1.customerState],['staff',r1.staffState]]){
    const cfg=state.auth.config;cfg.mode='PRODUCTION';cfg.deploymentId='isolated-'+zone+'.vercel.app';cfg.routerKey=Buffer.alloc(32,zone==='customer'?51:52);
    if(zone==='customer'){cfg.deploymentHost=cfg.deploymentId;cfg.binding={...cfg.binding,mode:cfg.mode,deploymentId:cfg.deploymentId};}
    state.assertRequest=req=>{requireValue(acceptsSiteRequest(req,{zone,deploymentId:cfg.deploymentId,routerKey:cfg.routerKey},f.now),'HOST_REFUSED');f.ingress.push(req);};
  }
  r1.publicConfig.mode='PRODUCTION';r1.publicConfig.deploymentId='isolated-public.vercel.app';
  f.headers=async(target,{zone='customer',method='GET'}={})=>{const cfg=r1[zone==='staff'?'staffState':'customerState'].auth.config;return {host:'atlasgrading.com','x-forwarded-proto':'https',origin:'https://atlasgrading.com',cookie:f.cookie,...await signRoute({zone,deployment:'https://'+cfg.deploymentId,method,target,issuedAt:f.now},cfg.routerKey.toString('base64'))};};
  f.open=request=>createR1MarketplaceAuthBridge({enabled:true,environment:'PROVIDER_SANDBOX',policy:config.authPolicy,customer:{state:r1.customerState,CustomerAuth:r1.customerState.auth.constructor,CustomerDatabase:r1.customerState.auth.database.constructor},admitRequest:r1.admitRequest,clock:()=>f.now,maxDatabaseClockSkewMs:1000}).open(request,{audience:'BUYER'});
  return f;
}
function request(url,headers,method='GET'){return {url,method,headers,rawBody:Buffer.alloc(0),socket:{remoteAddress:'127.0.0.1'}};}
async function get(server,url,headers={},method='GET',body){return new Promise((resolve,reject)=>{const req=httpRequest({host:'127.0.0.1',port:server.address().port,path:url,method,headers:{host:'atlasgrading.com',...headers}},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(chunks).toString()}));});req.on('error',reject);req.end(body);});}

test('nested canonical API ingress rejects changed queries and normalized aliases before session or service dispatch',async()=>{
  const f=await signedFixture(),target='/account/marketplace/api/proofs?orderId=atlas_A&filter=x%20y';
  const headers=await f.headers(target),cfg=f.options.r1.customerState.auth.config;
  const verify=req=>acceptsSiteRequest(req,{zone:'customer',deploymentId:cfg.deploymentId,routerKey:cfg.routerKey},f.now);
  for(const actual of [target.replace('atlas_A','atlas_B'),target.replace('&filter=x%20y','&filter=x+y'),'/account/marketplace/api/proofs?filter=x%20y&orderId=atlas_A',target+'&orderId=atlas_A',target.replace('/account/','/')]){
    const req=request(actual,headers);assert.equal(verify(req),true,'canonical nested-query/alias behavior is unchanged');
    assert.throws(()=>f.open(req),{code:'SIGNED_TARGET_REFUSED'});
  }
  for(const req of [request(target.replace('/proofs','/workspace'),headers),request(target,headers,'POST'),request(target,{...headers,'x-atlas-route-target':undefined}),request(target,{...headers,'x-atlas-route-target':[target]}),request(target,{...headers,'x-atlas-route-target':42})])assert.throws(()=>f.open(req),{code:'HOST_REFUSED'});
  assert.equal(f.gatewayCalls.length,0);assert.equal(f.admitted.length,0);
  const ctx=f.open(request(target,headers)),principal=await ctx.resolveSession({cookie:f.cookie,method:'GET',path:'/proofs'});
  await ctx.admitRequest({sessionId:principal.sessionId,actorId:principal.actor.id,method:'GET',path:'/proofs'});
  assert.equal(await ctx.withAuthorized(principal,()=>true),true);ctx.close();
  const postTarget='/account/marketplace/api/proofs/prepare?proof=atlas_A',postHeaders=await f.headers(postTarget,{method:'POST'});
  assert.throws(()=>f.open(request(postTarget.replace('atlas_A','atlas_B'),postHeaders,'POST')),{code:'SIGNED_TARGET_REFUSED'});
  const post=f.open(request(postTarget,postHeaders,'POST'));post.close();
  // Ordinary canonical API query ordering remains canonical's own behavior.
  const ordinary='/account/api/profile?x=1&y=2';assert.equal(verify(request('/account/api/profile?y=2&x=1',await f.headers(ordinary))),true);
});

test('actual host enforces exact signed private API and shell targets while unrelated routes retain their original handler',async t=>{
  const f=await signedFixture(),composition=createR1MarketplaceRouteComposition({enabled:true,host:f.options});
  const server=createServer(composition.wrap('customer',(req,res)=>{res.end(JSON.stringify({original:req.url}));}));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await composition.close();await new Promise(resolve=>server.close(resolve));});
  const shell='/account/marketplace/?view=one',api='/account/marketplace/api/catalog?query=one';
  for(const target of [shell,api]){
    const headers=await f.headers(target),before=f.gatewayCalls.length;
    const bad=await get(server,target.replace('one','two'),headers);assert.ok([403,503].includes(bad.status));assert.equal(f.gatewayCalls.length,before);
    assert.equal((await get(server,target,headers)).status,200);
  }
  const unrelated='/account/profile?view=two';assert.deepEqual(JSON.parse((await get(server,unrelated,await f.headers('/account/profile?view=one'))).body),{original:unrelated});
  assert.equal(f.providerCalls,0);
});

test('staff private shell is exact while raw signed provider webhook retains its separate no-session ingress',async t=>{
  const f=await signedFixture(true),host=await createR1MarketplaceHost(f.options);
  const finance=createHostedFinance({...f.bootstrapOptions.finance,store:host.store,provider:host.provider,service:host.service,settlementCapability:host.settlementCapability});
  const handlers=await host.createHandlers({finance}),server=createServer(handlers.listener);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await host.close();await new Promise(resolve=>server.close(resolve));});
  const shell='/admin/marketplace/?view=one',headers=await f.headers(shell,{zone:'staff'});
  assert.equal((await get(server,shell.replace('one','two'),headers)).status,503);assert.equal((await get(server,shell,headers)).status,200);
  const raw=Buffer.from(JSON.stringify({id:'evt_exact_target_fixture',object:'event',type:'balance.available',livemode:false,data:{object:{object:'balance'}}})),timestamp=Math.floor(f.now/1000);
  const signature='t='+timestamp+',v1='+createHmac('sha256',f.options.marketplace.webhook.endpoints[0].secret).update(String(timestamp)+'.').update(raw).digest('hex');
  const webhook='/admin/marketplace/api/provider/webhook',providerHeaders={'stripe-signature':signature,'content-type':'application/json'};
  assert.equal((await get(server,webhook,providerHeaders,'POST',raw)).status,200);
  assert.equal(f.stateRow.document.financeWebhookIngress.evt_exact_target_fixture.deliveryCount,1);
  assert.notEqual((await get(server,webhook+'?unexpected=1',providerHeaders,'POST',raw)).status,200);
  for(const target of ['/account/marketplace/api/provider/webhook','/account/marketplace/seller/api/provider/webhook'])assert.notEqual((await get(server,target,providerHeaders,'POST',raw)).status,200);
  assert.equal(f.stateRow.document.financeWebhookIngress.evt_exact_target_fixture.deliveryCount,1);assert.equal(f.gatewayCalls.length,0);assert.equal(f.providerCalls,0);assert.equal(f.timerStarts,0);
  assert.equal((await get(server,'/marketplace/catalog')).status,200);
});


test('local fixture ingress permits wholly unsigned requests but rejects partial or inexact route proofs',async()=>{
  const f=await canonicalHostFixture(),{r1,config}=f.options,target='/account/marketplace/api/proofs?orderId=atlas_A';
  const bridge=createR1MarketplaceAuthBridge({enabled:true,environment:'PROVIDER_SANDBOX',policy:config.authPolicy,customer:{state:r1.customerState,CustomerAuth:r1.customerState.auth.constructor,CustomerDatabase:r1.customerState.auth.database.constructor},admitRequest:r1.admitRequest,clock:()=>f.now,maxDatabaseClockSkewMs:1000});
  const headers={cookie:f.cookie,'x-fixture-original-proof':'unchanged'},open=h=>bridge.open(request(target,h),{audience:'BUYER'});
  const unsigned=open(headers);unsigned.close();
  const proof={'x-atlas-route-target':target,'x-atlas-route-issued':String(f.now),'x-atlas-route-proof':'fixture-canonical-proof'};
  for(const [key,value] of Object.entries(proof)){
    assert.throws(()=>open({...headers,[key]:value}),{code:'SIGNED_TARGET_REFUSED'});
    const partial={...headers,...proof};delete partial[key];assert.throws(()=>open(partial),{code:'SIGNED_TARGET_REFUSED'});
  }
  for(const value of [target+'&orderId=atlas_B','',undefined,[target],42])assert.throws(()=>open({...headers,...proof,'x-atlas-route-target':value}),{code:'SIGNED_TARGET_REFUSED'});
  const signed=open({...headers,...proof});signed.close();
  assert.equal(f.gatewayCalls.length,0);assert.equal(f.admitted.length,0);
});
