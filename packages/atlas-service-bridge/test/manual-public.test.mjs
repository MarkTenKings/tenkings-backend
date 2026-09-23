import test from 'node:test';
import assert from 'node:assert/strict';
import { signManualPublicRequest,verifyManualPublicRequest,manualPublicClient,MANUAL_PUBLIC_ORIGIN,MANUAL_PUBLIC_PATH,MANUAL_PUBLIC_TTL_MS } from '../src/manual-public.mjs';
const config={manualKey:Buffer.alloc(32,7),manualOrigin:MANUAL_PUBLIC_ORIGIN,deploymentId:'approved-fixture.vercel.app',releaseSha:'a'.repeat(40),configHash:'b'.repeat(64)};
const request={kind:'REPORT',token:'ar_'+'A'.repeat(24),version:1,side:null,findingId:null};
test('dedicated signed request binds exact path, canonical selector, deployment and short TTL',()=>{
 const now=Date.now(),signed=signManualPublicRequest(config,request,now),verified=verifyManualPublicRequest({key:config.manualKey},signed.body,signed.signature,now);
 assert.equal(verified.path,MANUAL_PUBLIC_PATH);assert.deepEqual(verified.request,request);assert.equal(verified.expiresAt-now,MANUAL_PUBLIC_TTL_MS);
 assert.throws(()=>verifyManualPublicRequest({key:Buffer.alloc(32,8)},signed.body,signed.signature,now));
 assert.throws(()=>verifyManualPublicRequest({key:config.manualKey},signed.body+' ',signed.signature,now));
 assert.throws(()=>verifyManualPublicRequest({key:config.manualKey},signed.body,signed.signature,now+MANUAL_PUBLIC_TTL_MS));
 assert.throws(()=>verifyManualPublicRequest({key:config.manualKey},signed.body,signed.signature,now-1));
});
test('selectors refuse arbitrary fetch URLs, extra authority, unversioned media and wrong origin',()=>{
 for(const change of [{url:'https://attacker.invalid'},{kind:'IMAGE',side:'FRONT',version:null},{kind:'IMAGE',side:'LEFT'},{kind:'TRACE',findingId:''},{token:'bad'},{version:0}])assert.throws(()=>signManualPublicRequest(config,{...request,...change}));
 assert.throws(()=>manualPublicClient({...config,manualOrigin:'https://attacker.invalid'}));
});
test('client makes one fixed HTTPS POST with no redirect or retry; checks type and response bounds',async()=>{
 let calls=0;const client=manualPublicClient(config,async(url,options)=>{calls++;assert.equal(url,MANUAL_PUBLIC_ORIGIN+MANUAL_PUBLIC_PATH);assert.equal(options.redirect,'error');assert.equal(options.method,'POST');assert.ok(options.signal);return new Response('{"ok":true}',{status:200,headers:{'content-type':'application/json'}});});
 assert.deepEqual(await client.read(request),{ok:true});assert.equal(calls,1);
 const failure=manualPublicClient(config,async()=>{calls++;return new Response('secret',{status:503});});await assert.rejects(failure.read(request));assert.equal(calls,2);
 assert.equal(await manualPublicClient(config,async()=>new Response(null,{status:404})).read(request),null);
 await assert.rejects(manualPublicClient(config,async()=>new Response('{}',{headers:{'content-type':'text/html'}})).read(request));
});
test('presentation image binds an exact revision without broadening ordinary report selectors',async()=>{
 const image={...request,kind:'PRESENTATION_IMAGE',presentationRevision:3};
 const signed=signManualPublicRequest(config,image);
 assert.deepEqual(verifyManualPublicRequest({key:config.manualKey},signed.body,signed.signature).request,image);
 for(const change of [{version:null},{presentationRevision:0},{presentationRevision:1.5},{presentationRevision:2147483648},{side:'FRONT'},{findingId:'finding-1'},{url:'https://other.invalid/photo.webp'}])assert.throws(()=>signManualPublicRequest(config,{...image,...change}));
 assert.throws(()=>signManualPublicRequest(config,{...request,presentationRevision:3}));
 const bytes=Buffer.from('signed-media-fixture');
 const client=manualPublicClient(config,async(url,options)=>{
  assert.equal(url,MANUAL_PUBLIC_ORIGIN+MANUAL_PUBLIC_PATH);
  const claims=verifyManualPublicRequest({key:config.manualKey},options.body,options.headers['x-atlas-manual-public-signature']);
  assert.deepEqual(claims.request,image);
  return new Response(bytes,{headers:{'content-type':'image/webp'}});
 });
 assert.deepEqual(await client.read(image),bytes);
 await assert.rejects(manualPublicClient(config,async()=>new Response('{}',{headers:{'content-type':'application/json'}})).read(image));
});
