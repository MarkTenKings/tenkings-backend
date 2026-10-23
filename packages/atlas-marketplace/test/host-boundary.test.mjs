import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer,request as httpRequest } from 'node:http';
import { createMarketplaceHostCheck } from '../src/host-boundary.mjs';
import { createMarketplaceNodeHandler } from '../src/runtime-node.mjs';
import { createMarketplacePublicNodeHandler } from '../src/runtime-public-node.mjs';

const send=(origin,path,headers={},body=null)=>new Promise((resolve,reject)=>{
  const req=httpRequest(origin+path,{method:body?'POST':'GET',headers},res=>{
    const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(chunks).toString()}));
  });req.on('error',reject);req.end(body);
});
test('host pins are immutable and exact, with no wildcard, normalization or request-derived expansion',()=>{
  const origin='https://atlas.example',acceptedHosts=['atlas.example','release-exact.vercel.app'];
  const check=createMarketplaceHostCheck({origin,acceptedHosts});acceptedHosts.push('later.example');
  for(const host of ['atlas.example','release-exact.vercel.app'])assert.equal(check(host),true);
  for(const host of ['later.example','release-exact.vercel.app.evil.test','RELEASE-EXACT.vercel.app','release-exact.vercel.app:443',undefined,['atlas.example']])assert.equal(check(host),false);
  assert.equal(createMarketplaceHostCheck({origin})('release-exact.vercel.app'),false);
  for(const hosts of [[],['elsewhere.test'],['atlas.example','atlas.example'],['atlas.example','*.vercel.app'],['atlas.example','a/b'],['atlas.example','a@b'],['atlas.example','a:443'],['atlas.example','a?b'],['atlas.example','a#b'],['atlas.example','a b'],['atlas.example','a','b','c','d']])assert.throws(()=>createMarketplaceHostCheck({origin,acceptedHosts:hosts}),{code:'HOST_CONFIGURATION_UNAVAILABLE'});
  for(const value of ['http://atlas.example','https://atlas.example/path','https://user@atlas.example'])assert.throws(()=>createMarketplaceHostCheck({origin:value}),{code:'HOST_CONFIGURATION_UNAVAILABLE'});
  assert.doesNotThrow(()=>createMarketplaceNodeHandler());assert.doesNotThrow(()=>createMarketplacePublicNodeHandler());
});
test('exact deployment Host preserves the original authenticated request and raw webhook, without accepting it as browser Origin',async()=>{
  let handler,original,authCalls=0,payments=0,webhooks=0;
  const server=createServer((req,res)=>{original=req;handler.listener(req,res);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`,deployment='release-exact.vercel.app',acceptedHosts=[new URL(origin).host,deployment],uri='/account/marketplace/api/payments',bytes=Buffer.from(' { "reservationId" : "original" } ');
  const principal={authenticated:true,sessionId:'server_bound',expiresAt:Date.now()+60000,actor:{id:'buyer',role:'BUYER'}};
  handler=createMarketplaceNodeHandler({enabled:true,origin,acceptedHosts,mountPath:'/account/marketplace/',apiPath:'/account/marketplace/api',
    createAuthContext(req){authCalls++;assert.equal(req,original);assert.equal(req.headers.host,deployment);assert.equal(req.headers.origin,origin);assert.equal(req.url,uri);assert.equal(req.socket.remoteAddress,'127.0.0.1');assert.deepEqual(req.rawBody,bytes);return {resolveSession:async()=>principal,verifyCsrf:async()=>true,admitRequest:async()=>true,withAuthorized:async(_,work)=>work(principal.actor)};},
    service:{pay:async()=>{payments++;return {status:'PENDING'};}},
    receiveProviderWebhook:async({rawBody,signature})=>{webhooks++;assert.deepEqual(rawBody,bytes);assert.equal(signature,'exact_signature');}});
  const headers={host:deployment,origin,'content-type':'application/json','x-atlas-csrf':'opaque'};
  try {
    assert.equal((await send(origin,uri,headers,bytes)).status,200);assert.equal(authCalls,1);assert.equal(payments,1);
    assert.equal((await send(origin,'/account/marketplace/api/provider/webhook',{host:deployment,'stripe-signature':'exact_signature'},bytes)).status,200);assert.equal(webhooks,1);
    for(const host of ['other.vercel.app',deployment+'.evil.test'])assert.equal((await send(origin,uri,{...headers,host,'x-forwarded-host':deployment},bytes)).status,403);
    assert.equal((await send(origin,uri,{...headers,origin:'https://'+deployment},bytes)).status,403);
    acceptedHosts.push('mutated.example');assert.equal((await send(origin,uri,{...headers,host:'mutated.example'},bytes)).status,403);
    assert.equal(authCalls,1);assert.equal(payments,1);assert.equal(webhooks,1);
  }finally{handler.close();await new Promise(resolve=>server.close(resolve));}
});
test('public catalog and static assets share exact trusted Host pins while browser Origin stays canonical',async()=>{
  let handler,reads=0;
  const server=createServer((req,res)=>handler.listener(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`,deployment='catalog-exact.vercel.app';
  handler=createMarketplacePublicNodeHandler({enabled:true,origin,acceptedHosts:[new URL(origin).host,deployment],service:{publicCatalog:async()=>{reads++;return {environment:'PROVIDER_SANDBOX',items:[],total:0,offset:0,nextOffset:null};}},admitPublicRequest:async()=>true});
  try{
    assert.equal((await send(origin,'/marketplace/',{host:deployment})).status,200);
    assert.equal((await send(origin,'/marketplace/catalog',{host:deployment,origin})).status,200);
    assert.equal((await send(origin,'/marketplace/catalog',{host:deployment,origin:'https://'+deployment})).status,403);
    for(const path of ['/marketplace/','/marketplace/catalog'])assert.equal((await send(origin,path,{host:'elsewhere.vercel.app','x-forwarded-host':deployment})).status,403);
    assert.equal(reads,1);
  }finally{handler.close();await new Promise(resolve=>server.close(resolve));}
});
