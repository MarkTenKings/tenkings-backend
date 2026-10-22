import test from 'node:test';
import assert from 'node:assert/strict';
import { createCollectionPreferencesController } from '../lib/collection-preferences-state.mjs';
import { createPreferenceFixture, AID, OTHER, CID, prefId, defer } from './collection-preferences-fixture.mjs';
const input=(n=60,patch={})=>({requestId:prefId(n),visibility:'PRIVATE',offersDisabled:true,...patch});
const make=(f,patch={})=>createCollectionPreferencesController({session:f.session,request:f.request,...patch});
test('absent transport inert; save requires fresh current and derives exact independent card/collection revisions',async()=>{
 const f=createPreferenceFixture(),off=createCollectionPreferencesController({session:f.session});assert.equal(off.snapshot().phase,'DISABLED');await assert.rejects(off.load());assert.equal(f.requests.length,0);
 const c=make(f,{cardId:CID});await assert.rejects(c.save(input()),{code:'PREFERENCES_READ_REQUIRED'});await c.load();const r=await c.save(input());
 assert.equal(r.receipt.input.expectedOwnershipRevision,2);assert.equal(r.receipt.input.expectedPreferenceRevision,0);assert.equal(c.snapshot().phase,'CONFIRMED');assert.equal(c.snapshot().current,null);
 await assert.rejects(c.save(input(61)),{code:'PREFERENCES_READ_REQUIRED'});await c.load();assert.equal(c.snapshot().receipt.receipt.requestId,prefId(60));assert.equal(c.snapshot().current.cardPreferences.revision,1);
 c.dispose();assert.equal(c.snapshot().phase,'ENDED');
});
test('lost committed reply retains exact request; later current value cannot prove it, recovered old receipt wins',async()=>{
 const f=createPreferenceFixture(),c=make(f);await c.load();f.afterHTTP=()=>{if(f.records.size){f.afterHTTP=null;throw Error('lost committed reply');}};
 await c.save(input());assert.equal(c.snapshot().phase,'UNKNOWN');assert.equal(f.records.size,1);await assert.rejects(c.save(input(61)),{code:'PREFERENCES_RECOVERY_REQUIRED'});
 await f.service.setCollectionPreferences(f.cookie,f.csrf,{...input(62),expectedPreferenceRevision:1});await c.load();assert.equal(c.snapshot().current.collectionPreferences.revision,2);assert.equal(c.snapshot().phase,'UNKNOWN');
 await c.recover();assert.equal(c.snapshot().phase,'CONFIRMED');assert.equal(c.snapshot().receipt.receipt.preferenceRevision,1);assert.equal(c.snapshot().current.collectionPreferences.revision,2);assert.equal(f.records.size,2);
});
test('ABSENT and generic409 remain UNKNOWN; explicit retry identical, typed strictly-stale witness permits explicit refresh/new choice',async()=>{
 const f=createPreferenceFixture();let fail=true;const request=async(...args)=>fail?new Response('{}',{status:409}):f.request(...args);const c=make(f,{request});
 fail=false;await c.load();fail=true;await c.save(input());assert.equal(c.snapshot().phase,'UNKNOWN');fail=false;await c.recover();assert.equal(c.snapshot().recovery,'ABSENT');assert.equal(c.snapshot().phase,'UNKNOWN');
 await f.service.setCollectionPreferences(f.cookie,f.csrf,{...input(62),expectedPreferenceRevision:0});await c.retry();assert.equal(c.snapshot().phase,'STALE_REQUIRES_REFRESH');assert.equal(c.snapshot().pending,null);assert.equal(c.snapshot().receipt,null);assert.equal(c.snapshot().stale.requestId,prefId(60));
 await assert.rejects(c.save(input(63)),{code:'PREFERENCES_READ_REQUIRED'});await c.load();assert.equal(c.snapshot().phase,'READY');await c.save(input(63,{offersDisabled:false}));assert.equal(c.snapshot().phase,'CONFIRMED');assert.equal(f.records.size,2);
 const sent=f.requests.filter(r=>r.input.method==='POST');assert.deepEqual(JSON.parse(sent[0].input.body),{...input(),expectedPreferenceRevision:0});
});
test('same-ID retry returns historical receipt after newer revision and ownership access loss; no second append',async()=>{
 const f=createPreferenceFixture(),c=make(f,{cardId:CID});await c.load();f.afterHTTP=()=>{if(f.records.size){f.afterHTTP=null;throw Error('lost');}};await c.save(input());
 await f.service.setCardPreferences(f.cookie,f.csrf,{...input(61),cardId:CID,expectedOwnershipRevision:2,expectedPreferenceRevision:1});f.ownCard=false;
 await c.load();assert.equal(c.snapshot().phase,'UNKNOWN');await c.retry();assert.equal(c.snapshot().phase,'CONFIRMED');assert.equal(c.snapshot().receipt.receipt.preferenceRevision,1);assert.equal(f.records.size,2);
});
test('observed in-flight commit followed by scope/object/csrf/request teardown never revives private state or retries',async()=>{
 for(const change of [(f,c)=>{f.session.customer.id=OTHER;},(f,c)=>{f.session.customer={id:AID};},(f,c)=>{f.session.csrf='changed';},(f,c)=>{c.assertScope({...f.session});},(f,c)=>{c.assertScope(f.session,()=>{});},(f,c)=>{c.dispose();}]){
  const f=createPreferenceFixture(),c=make(f),entered=defer(),wait=defer();await c.load();f.afterHTTP=async()=>{if(f.records.size){entered.resolve();await wait.promise;}};
  const pending=c.save(input());await entered.promise;assert.equal(f.records.size,1);change(f,c);assert.equal(c.snapshot().phase,'ENDED');wait.resolve();await pending;
  assert.equal(c.snapshot().current,null);assert.equal(c.snapshot().receipt,null);assert.equal(c.snapshot().pending,null);await assert.rejects(c.retry());assert.equal(f.records.size,1);
 }
});
test('401/foreign response clears private pending, pure scope/snapshot checks never emit during render',async()=>{
 const f=createPreferenceFixture();let changes=0,ended=0;const c=make(f,{onChange(){changes++;},onAccessLost(){ended++;}});await c.load();const count=changes;
 assert(c.isCurrent(f.session,f.request));assert(c.snapshot().current);assert.equal(changes,count);f.session.customer.id=OTHER;assert(!c.isCurrent());assert.equal(c.snapshot().phase,'ENDED');assert.equal(changes,count);c.dispose();assert.equal(changes,count+1);
 const g=createPreferenceFixture(),other=make(g,{onAccessLost(){ended++;}});await other.load();g.liveAccount=null;await other.load();assert.equal(other.snapshot().phase,'ENDED');assert.equal(ended,1);
});
