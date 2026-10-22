import test from 'node:test';
import assert from 'node:assert/strict';
import {createCollectionDisplayFixture,deferred,sha} from './collection-display-fixture.mjs';
import {createCollectionDisplayService} from '../lib/server/collection-display-service.mjs';
import {createCollectionDisplayHandler,parseCollectionDisplayRequest} from '../lib/server/collection-display-http.mjs';
import {collectionDisplayBinding,displayPath,displayFrontPath,COLLECTION_DISPLAY_LIMITS} from '../lib/collection-display-contract.mjs';
const request=f=>({method:'GET',url:displayPath(f.card.cardId).replace('/account',''),body:'',headers:{cookie:f.cookie,'x-fixture-ingress':'accepted','sec-fetch-site':'same-origin'}});

test('same approved identity/grade and Front bytes through actual optional HTTP; owner before/after and no generic writer',async()=>{
 const f=await createCollectionDisplayFixture(),before=JSON.stringify(f.packet),d=await f.service.readDisplay(f.cookie,f.card.cardId);
 assert.match(d.title,/Synthetic collection card/);assert.equal(d.finalGrade,9);assert.equal(d.front.provenance,'APPROVED_GRADING_PHOTOGRAPH');
 assert.deepEqual(f.reads.map(x=>x.kind),['owner','report','owner']);f.reads.length=0;
 const r=await f.invoke({...request(f),url:d.front.path.replace('/account','')});assert.equal(r.code,200);assert.equal(sha(r.bytes),d.front.sha256);assert.equal(r.headers['cache-control'],'private, no-store, max-age=0');
 assert.deepEqual(f.reads.map(x=>x.kind),['owner','report','owner','image','owner','report','owner']);assert.equal(JSON.stringify(f.packet),before);
 assert(f.reads.filter(x=>x.kind==='owner').every(x=>x.action==='read_card'));assert(f.reads.filter(x=>x.kind==='image').every(x=>x.input.side==='FRONT'&&x.input.maxBytes===COLLECTION_DISPLAY_LIMITS.imageBytes));
 assert.equal(createCollectionDisplayHandler(),null);assert.throws(()=>createCollectionDisplayService());
});
test('packet substitution, mode/certificate/identity tamper and inspection mismatch refuse before disclosure',async()=>{
 for(const modify of [f=>{f.packet.report.identity.playerName='OTHER';},f=>{f.packet.mode='PRODUCTION';f.refreshHash();},f=>{f.packet.reportNumber='ATLAS-FFFFFFFFFFFF';f.refreshHash();},f=>{f.packet.images.FRONT.sha256='d'.repeat(64);f.refreshHash();},f=>{f.packet.approvalVersion=2;f.refreshHash();},f=>{f.packet.publicToken='ar_'+'Z'.repeat(24);f.refreshHash();}]){
  const f=await createCollectionDisplayFixture();modify(f);const res=await f.invoke(request(f));assert.equal(res.code,503);assert.deepEqual(res.value,{error:'COLLECTION_DISPLAY_UNAVAILABLE'});assert(!JSON.stringify(res).includes('OTHER'));
 }
});
test('actual owner-read absence after report/photo I/O ends scope; photo-only absence stays unavailable',async()=>{
 for(const phase of ['initial','report','photo']){
  const f=await createCollectionDisplayFixture();const req=request(f);if(phase==='photo')req.url=displayFrontPath(collectionDisplayBinding(f.card,f.accountId)).replace('/account','');
  const missing=()=>{f.ownerHook=()=>{throw {code:'OWNERSHIP_NOT_FOUND',status:404};};};
  if(phase==='initial')missing();else f[phase==='report'?'reportHook':'imageHook']=missing;
  const r=await f.invoke(req);assert.equal(r.code,403);assert.equal(r.value.error,'COLLECTION_DISPLAY_ACCESS_ENDED');assert(!r.bytes);
 }
 const f=await createCollectionDisplayFixture();f.imageHook=()=>{throw {code:'PHOTO_NOT_FOUND',status:404};};
 const r=await f.invoke({...request(f),url:displayFrontPath(collectionDisplayBinding(f.card,f.accountId)).replace('/account','')});assert.equal(r.code,503);
});
test('owner/approval changes while I/O waits deny buffered output; stable public report alone cannot establish title',async()=>{
 for(const change of [f=>{f.card.ownership.ownerAccountId='99999999-9999-4999-8999-999999999999';},f=>{f.card.ownership.revision++;},f=>{f.card.approvedCard.approvalActionId='99999999-9999-4999-8999-999999999999';}]){
  const f=await createCollectionDisplayFixture(),wait=deferred();f.reportHook=()=>wait.promise;
  const pending=f.invoke(request(f));await new Promise(r=>setImmediate(r));change(f);wait.resolve();const res=await pending;assert.equal(res.code,403);assert(!res.bytes);
 }
});
test('strict private GET route/query/body and binding; no actor account or arbitrary URL admission',async()=>{
 const f=await createCollectionDisplayFixture(),base=request(f);
 for(const patch of [{method:'POST'},{body:{accountId:f.accountId}},{url:base.url+'?accountId='+f.accountId},{url:base.url+'?url=https://evil.invalid'}, {url:base.url.replace('cards/','cards/%32')},{headers:{...base.headers,'transfer-encoding':'chunked'}},{headers:{...base.headers,'content-length':'1'}}])assert.throws(()=>parseCollectionDisplayRequest({...base,...patch}));
 const path=displayFrontPath(collectionDisplayBinding(f.card,f.accountId)).replace('/account','');
 for(const suffix of ['&version=1','&actor=foo','&url=x'])assert.throws(()=>parseCollectionDisplayRequest({...base,url:path+suffix}));
 const response=await f.invoke({...base,url:path.replace('ownershipRevision=1','ownershipRevision=2')});assert.equal(response.code,403);
 assert.equal((await f.invoke({...base,headers:{...base.headers,'sec-fetch-site':'cross-site'}})).code,403);
});
test('front hash/MIME/container limits and source after-read fence; oversized photograph keeps truthful metadata only',async()=>{
 const f=await createCollectionDisplayFixture(),path=displayFrontPath(collectionDisplayBinding(f.card,f.accountId)).replace('/account','');f.bytes[f.bytes.length-1]^=1;
 assert.equal((await f.invoke({...request(f),url:path})).code,503);
 const large=await createCollectionDisplayFixture();large.packet.images.FRONT.byteCount=COLLECTION_DISPLAY_LIMITS.imageBytes+1;large.refreshHash();
 const d=await large.service.readDisplay(large.cookie,large.card.cardId);assert.equal(d.front.status,'EXCEEDS_DISPLAY_LIMIT');assert.equal(d.front.path,null);assert.match(d.title,/Synthetic/);
});
test('HTTP final config/cookie/capability drift refuses private response; ingress must finish synchronously',async()=>{
 for(const change of [f=>{f.state.config.cookies.session='changed';},f=>{f.state.auth.authority=()=>({});},f=>{f.approvedReader.readReport=async()=>({});}]){
  const f=await createCollectionDisplayFixture(),wait=deferred();f.reportHook=()=>wait.promise;const pending=f.invoke(request(f));await new Promise(r=>setImmediate(r));change(f);wait.resolve();assert.equal((await pending).code,503);
 }
 const f=await createCollectionDisplayFixture();f.state.assertRequest=async()=>{};
 const handler=createCollectionDisplayHandler({customerState:f.state,displayService:f.service}),res={setHeader(){},status(n){this.code=n;return this;},json(){}};
 await handler(request(f),res);assert.equal(res.code,503);assert.equal(f.reads.length,0);
});
test('aborted delayed initial ownership read cannot start report or photo I/O after the caller settles',async()=>{
 for(const front of [false,true]){
  const f=await createCollectionDisplayFixture(),entered=deferred(),wait=deferred(),controller=new AbortController();
  f.ownerHook=()=>{entered.resolve();return wait.promise;};
  const pending=front?f.service.readFront(f.cookie,f.card.cardId,{ownershipRevision:1,approvalActionId:f.card.approvedCard.approvalActionId,version:1,publicHash:f.card.approvedCard.report.publicHash},{signal:controller.signal})
   :f.service.readDisplay(f.cookie,f.card.cardId,{signal:controller.signal});
  await entered.promise;controller.abort();await assert.rejects(pending);wait.resolve();await new Promise(r=>setImmediate(r));
  assert.deepEqual(f.reads.map(x=>x.kind),['owner']);
 }
});
test('buffered HTTP read pins admitted ingress and rejects auth key/digest drift after observed I/O',async()=>{
 for(const change of [
  (f,req)=>{req.headers['x-fixture-ingress']='changed';},
  (f,req)=>{req.headers['x-forwarded-host']='other.invalid';},
  (f,req)=>{req.headers['x-atlas-route-proof']='changed';},
  (f,req)=>{req.headers['sec-fetch-site']='cross-site';},
  (f,req)=>{req.headers['transfer-encoding']='chunked';},
  f=>{f.state.config.sessionKey=Buffer.alloc(32,1);},
  f=>{f.state.auth.digest=()=>'';}
 ]){
  const f=await createCollectionDisplayFixture(),entered=deferred(),wait=deferred(),req=request(f);
  f.reportHook=()=>{entered.resolve();return wait.promise;};
  const pending=f.invoke(req);await entered.promise;change(f,req);wait.resolve();const res=await pending;
  assert([400,403,503].includes(res.code));assert(!res.bytes);assert(!JSON.stringify(res.value).includes('Synthetic collection card'));
 }
});
