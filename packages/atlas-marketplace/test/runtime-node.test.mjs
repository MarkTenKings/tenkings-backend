import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, IncomingMessage } from 'node:http';
import { createMarketplaceNodeHandler } from '../src/runtime-node.mjs';
import { createMarketplacePublicNodeHandler } from '../src/runtime-public-node.mjs';

test('Node integration serves only authenticated assets, bounds raw webhook bytes, and closes every route',async()=>{
  let handler,seen=null;
  const server=createServer((req,res)=>handler.listener(req,res));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  handler=createMarketplaceNodeHandler({enabled:true,origin,receiveProviderWebhook:async({rawBody,signature})=>{assert.equal(signature,'signed-test');seen=rawBody;}});
  try {
    const home=await fetch(origin+'/marketplace/?payment_intent_client_secret=not-a-real-secret');
    assert.equal(home.status,200); assert.ok((await home.text()).includes('data-runtime="AUTHENTICATED"'));
    assert.ok(home.headers.get('content-security-policy').includes('https://js.stripe.com'));
    const module=await fetch(origin+'/marketplace/stripe-payment.mjs');assert.equal(module.status,200);assert.match(module.headers.get('content-type'),/javascript/);
    assert.notEqual((await fetch(origin+'/demo/front.svg')).status,200);
    assert.equal((await fetch(origin+'/api/marketplace/workspace')).status,503);
    const bytes=Buffer.from('{ "preserve" : "exact whitespace" }');
    assert.equal((await fetch(origin+'/api/marketplace/provider/webhook',{method:'POST',headers:{'stripe-signature':'signed-test'},body:bytes})).status,200);
    assert.deepEqual(seen,bytes);
    assert.equal((await fetch(origin+'/api/marketplace/provider/webhook',{method:'POST',body:'x'.repeat(262145)})).status,413);
    handler.close();assert.equal((await fetch(origin+'/marketplace/')).status,503);
    assert.equal((await fetch(origin+'/api/marketplace/provider/webhook',{method:'POST',body:bytes})).status,503);
  } finally {await new Promise(resolve=>server.close(resolve));}
});

test('trusted account-path mounts retain scoped cookies and cannot inject shell markup or add asset routes',async()=>{
  for(const mountPath of ['//external.test/','/account/../marketplace/','/account/\"bad/']) assert.throws(()=>createMarketplaceNodeHandler({mountPath}),{code:'ROUTE_CONFIGURATION_UNAVAILABLE'});
  let handler;
  const server=createServer((req,res)=>handler.listener(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  handler=createMarketplaceNodeHandler({enabled:true,origin,mountPath:'/account/marketplace/',apiPath:'/account/marketplace/api'});
  try {
    const response=await fetch(origin+'/account/marketplace/');const html=await response.text();
    assert.equal(response.status,200);assert.match(html,/data-api-path="\/account\/marketplace\/api"/);assert.match(html,/data-mount-path="\/account\/marketplace\/"/);assert.match(html,/src="\.\/app.mjs"/);
    assert.equal((await fetch(origin+'/account/marketplace/app.mjs')).status,200);
    assert.notEqual((await fetch(origin+'/marketplace/')).status,200);
    assert.notEqual((await fetch(origin+'/account/marketplace/stripe-payment.mjs/extra')).status,200);
  } finally {await new Promise(resolve=>server.close(resolve));}
});

test('actual mounted HTTP dispatch passes the original IncomingMessage, socket and exact body bytes into request-scoped authentication',async()=>{
  let handler,originalRequest,received=0,dispatched=0,closed=0,csrfVerified=false;
  const server=createServer((req,res)=>{originalRequest=req;handler.listener(req,res);});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`,uri='/account/marketplace/api/payments',bytes=Buffer.from(' {\n "reservationId" : "bound_reservation"\n} ');
  const principal=Object.freeze({authenticated:true,sessionId:'opaque_request_session',expiresAt:Date.now()+60000,actor:Object.freeze({id:'11111111-1111-4111-8111-111111111111',role:'BUYER'})});
  handler=createMarketplaceNodeHandler({enabled:true,origin,mountPath:'/account/marketplace/',apiPath:'/account/marketplace/api',
    createAuthContext(request){
      received++;assert.equal(request,originalRequest);assert.ok(request instanceof IncomingMessage);assert.equal(request.socket,originalRequest.socket);assert.equal(request.socket.remoteAddress,'127.0.0.1');assert.equal(request.url,uri);assert.equal(request.method,'POST');assert.equal(request.headers.cookie,'r1_fixture=opaque');assert.deepEqual(request.rawBody,bytes);
      return {resolveSession:async input=>{assert.deepEqual(input,{cookie:'r1_fixture=opaque',method:'POST',path:'/payments'});return principal;},admitRequest:async()=>true,verifyCsrf:async()=>{csrfVerified=true;return true;},withAuthorized:async(value,work)=>{assert.equal(value,principal);assert.equal(csrfVerified,true);assert.equal(request.url,uri);assert.deepEqual(request.rawBody,bytes);return work(principal.actor);},close(){closed++;}};
    },service:{pay:async(actor,input)=>{dispatched++;assert.equal(actor,principal.actor);assert.deepEqual(input,{reservationId:'bound_reservation'});return {status:'PENDING'};}}});
  try {
    const response=await fetch(origin+uri,{method:'POST',headers:{origin,'content-type':'application/json',cookie:'r1_fixture=opaque','x-atlas-csrf':'fixture_token'},body:bytes});
    assert.equal(response.status,200);assert.deepEqual(await response.json(),{status:'PENDING'});assert.equal(received,1);assert.equal(dispatched,1);assert.equal(closed,1);
  } finally {handler.close();await new Promise(resolve=>server.close(resolve));}
});

test('public Node mount serves catalog without a session and cannot dispatch private actions or expose workspace assets',async()=>{
  let handler,reads=0;
  const server=createServer((req,res)=>handler.listener(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  handler=createMarketplacePublicNodeHandler({enabled:true,origin,service:{publicCatalog:async()=>{reads++;return {environment:'PROVIDER_SANDBOX',items:[],total:0,offset:0,nextOffset:null};}},admitPublicRequest:async()=>true});
  try {
    const home=await fetch(origin+'/marketplace/');assert.equal(home.status,200);assert.match(await home.text(),/Available cards/);
    assert.equal((await fetch(origin+'/marketplace/catalog')).status,200);assert.equal(reads,1);
    assert.equal((await fetch(origin+'/marketplace/catalog',{method:'POST',body:'{}'})).status,405);
    assert.equal((await fetch(origin+'/api/marketplace/payments',{method:'POST',body:'{}'})).status,404);
    assert.equal((await fetch(origin+'/marketplace/workspace.html')).status,404);assert.equal(reads,1);
    handler.close();assert.equal((await fetch(origin+'/marketplace/')).status,503);
  } finally {await new Promise(resolve=>server.close(resolve));}
});
