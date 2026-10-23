import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createCollectionDisplayFixture,deferred} from './collection-display-fixture.mjs';
import {createCollectionDisplayReader} from '../lib/collection-display-client.mjs';
import {COLLECTION_DISPLAY_LIMITS as LIMITS} from '../lib/collection-display-contract.mjs';
const tick=()=>new Promise(r=>setImmediate(r));
function reader(f,overrides={}){const made=[],revoked=[];const r=createCollectionDisplayReader({fetcher:f.fetch,urls:{createObjectURL(blob){made.push(blob);return 'blob:fixture-'+made.length;},revokeObjectURL(url){revoked.push(url);}},...overrides});return {r,made,revoked};}
const input=f=>({accountId:f.accountId,card:f.card});
test('actual HTTP/client chain hashes approved Front before Blob publication, with metadata first and idempotent disposal',async()=>{
 const f=await createCollectionDisplayFixture(),digest=deferred(),entered=deferred();let metadata;
 const x=reader(f,{crypto:{subtle:{digest:async(...args)=>{entered.resolve();await digest.promise;return webcrypto.subtle.digest(...args);}}}});
 const pending=x.r.read({...input(f),onDisplay:v=>{metadata=v;}});await entered.promise;assert.match(metadata.title,/Synthetic/);assert.equal(x.made.length,0);
 digest.resolve();const result=await pending;assert.equal(x.made.length,1);assert.equal(x.made[0].size,f.bytes.length);result.dispose();result.dispose();assert.deepEqual(x.revoked,[result.url]);
 assert.equal(f.requests.length,2);for(const req of f.requests)assert.deepEqual([req.options.method,req.options.credentials,req.options.cache,req.options.redirect],['GET','same-origin','no-store','error']);
});
test('foreign owner or approval binding ends scope; corrupt photos never publish; there is no public fallback or retry',async()=>{
 for(const mode of ['account','revision','hash','mime','photo404']){
  const f=await createCollectionDisplayFixture();let calls=0;
  const x=reader(f,{fetcher:async(...args)=>{calls++;const r=await f.fetch(...args);
    if(calls===1&&['account','revision'].includes(mode)){const body=await r.json();if(mode==='account')body.binding.accountId='99999999-9999-4999-8999-999999999999';else body.binding.ownershipRevision++;return Response.json(body);}
    if(calls===2){if(mode==='photo404')return new Response('',{status:404});const bytes=new Uint8Array(await r.arrayBuffer());if(mode==='hash')bytes[bytes.length-1]^=1;
      return new Response(bytes,{headers:{'content-type':mode==='mime'?'image/jpeg':'image/webp','x-atlas-image-sha256':r.headers.get('x-atlas-image-sha256')}});}return r;}});
  await assert.rejects(x.r.read(input(f)),e=>['account','revision'].includes(mode)?e.code==='COLLECTION_DISPLAY_ACCESS_ENDED':e.code==='COLLECTION_DISPLAY_UNAVAILABLE');assert.equal(x.made.length,0);assert.equal(calls,['account','revision'].includes(mode)?1:2);
 }
});
test('stalled transport/body cancellation settles promptly, discards late bodies, and never creates URLs',async()=>{
 for(const body of [false,true]){
  const f=await createCollectionDisplayFixture(),wait=deferred(),controller=new AbortController();let cancelled=0;
  const response=new Response(new ReadableStream({pull(){return new Promise(()=>{});},cancel(){cancelled++;return new Promise(()=>{});}}),{headers:{'content-type':'application/json'}});
  const x=reader(f,{fetcher:()=>body?response:wait.promise});const pending=x.r.read({...input(f),signal:controller.signal});await tick();controller.abort();await assert.rejects(pending,{name:'AbortError'});
  if(!body)wait.resolve(response);await tick();assert.equal(cancelled,1);assert.equal(x.made.length,0);
 }
});
test('shared reader caps active visible reads at two and cancelled queued requests never fetch',async()=>{
 const f=await createCollectionDisplayFixture(),wait=deferred();let calls=0;const x=reader(f,{fetcher:async()=>{calls++;return wait.promise;}});
 const controllers=Array.from({length:4},()=>new AbortController()),pending=controllers.map(c=>x.r.read({...input(f),signal:c.signal}).catch(e=>e));await tick();assert.equal(calls,2);
 controllers.forEach(c=>c.abort());await Promise.all(pending);wait.resolve(new Response('',{status:503}));await tick();assert.equal(calls,2);assert.equal(x.made.length,0);
});
test('too-large metadata/body and redirects refuse before resource publication; declared limits cannot be bypassed',async()=>{
 const f=await createCollectionDisplayFixture();for(const response of [new Response('x'.repeat(LIMITS.metadataBytes+1),{headers:{'content-type':'application/json'}}),new Response('{}',{headers:{'content-type':'application/json','content-length':String(LIMITS.metadataBytes+1)}})]){
  const x=reader(f,{fetcher:async()=>response});await assert.rejects(x.r.read(input(f)));assert.equal(x.made.length,0);
 }
});
