import test from 'node:test';
import assert from 'node:assert/strict';
import {createEarlyGeometryClient,earlyGeometryIdentity,geometryIsProcessing} from '../lib/early-geometry-client.mjs';
const snapshot=(state='QUEUED')=>({card:{sides:{FRONT:{upload:{uploadId:'front-one',source:{ready:true}}},BACK:{}}},details:{matColor:'BLACK',cornerShape:'SQUARE',fields:{name:''}},earlyGeometry:{FRONT:{state,key:'front-key',canRetry:true},BACK:{state:'WAITING_PHOTO'}}});
test('first verified side ensures once before identity or the opposite photo and unchanged identity details reuse it',async()=>{
 const calls=[];let reads=0;const c=createEarlyGeometryClient({request:async body=>calls.push(body),read:async()=>reads++});
 const value=snapshot();assert.equal(value.card.sides.BACK.upload,undefined);await c.ensure(value);await c.ensure(value);
 value.details.fields.name='Known later';await c.ensure(value);assert.deepEqual(calls,[{}]);assert.equal(reads,1);
 value.card.sides.BACK.upload={uploadId:'back-one',source:{ready:true}};value.earlyGeometry.BACK={state:'QUEUED',key:'back-key'};
 await c.ensure(value);assert.equal(calls.length,2);c.dispose();
});
test('replacement photo and changed physical settings reconcile new exact work identities',async()=>{
 let posts=0;const c=createEarlyGeometryClient({request:async()=>posts++,read:async()=>{}}),s=snapshot();
 const before=earlyGeometryIdentity(s);await c.ensure(s);s.card.sides.FRONT.upload.uploadId='replacement';await c.ensure(s);
 s.details.matColor='WHITE';s.earlyGeometry.FRONT.key='new-key';await c.ensure(s);
 assert.notEqual(earlyGeometryIdentity(s),before);assert.equal(posts,3);c.dispose();
});
test('read-only progress pauses in hidden pages and does not overlap, retry failed reads rapidly, or poll finished work',async()=>{
 let visible=false,reads=0,finish;const c=createEarlyGeometryClient({request:async()=>{throw Error('No POST during poll');},read:()=>{reads++;return new Promise(resolve=>finish=resolve);},isVisible:()=>visible});
 await c.poll(snapshot(),1000);assert.equal(reads,0);visible=true;const first=c.poll(snapshot(),1000);await c.poll(snapshot(),1000);assert.equal(reads,1);finish();await first;
 await c.poll(snapshot(),2000);await c.poll(snapshot('READY'),5000);assert.equal(reads,1);assert.equal(geometryIsProcessing(snapshot('NEEDS_REVIEW')),false);c.dispose();
});
test('progress read failures back off, denied access stops, and disposal prevents late reply refresh',async()=>{
 let reads=0,errors=0;const c=createEarlyGeometryClient({request:async()=>{},read:async()=>{reads++;throw {status:reads===3?403:503};},onError:()=>errors++});
 await c.poll(snapshot(),100);await c.poll(snapshot(),1000);assert.equal(reads,1);
 await c.poll(snapshot(),5000);await c.poll(snapshot(),14000);await c.poll(snapshot(),50000);assert.equal(reads,3);assert.equal(errors,1);
 let resolve;const late=createEarlyGeometryClient({request:()=>new Promise(done=>resolve=done),read:async()=>reads++});const pending=late.ensure(snapshot());late.dispose();resolve();await pending;assert.equal(reads,3);
});
test('explicit retry binds the displayed geometry key and never retries a completed side',async()=>{
 const bodies=[];let reads=0;const c=createEarlyGeometryClient({request:async body=>bodies.push(body),read:async()=>reads++});
 await c.retry('FRONT',{key:'exact-shown-key',state:'FAILED',canRetry:true});await c.retry('BACK',{key:'ready',state:'READY',canRetry:false});
 assert.deepEqual(bodies,[{side:'FRONT',expectedKey:'exact-shown-key'}]);assert.equal(reads,1);c.dispose();
});
test('uncertain ensure retries use capped backoff and stop posting after acknowledgement',async()=>{
 const bodies=[];let now=0,fail=true,reads=0;
 const c=createEarlyGeometryClient({clock:()=>now,request:async body=>{bodies.push(body);if(fail)throw {status:503};},read:async()=>reads++});
 const s=snapshot();await c.ensure(s);
 for(const due of [2000,6000,14000,30000,60000]){
  const before=bodies.length;now=due-1;await c.poll(s);assert.equal(bodies.length,before);
  now=due;await c.poll(s);assert.equal(bodies.length,before+1);
 }
 assert.equal(bodies.length,6);fail=false;now=90000;await c.poll(s);
 await c.ensure(s);now=120000;await c.poll(snapshot('NEEDS_REVIEW'));
 assert.equal(bodies.length,7);assert.ok(bodies.every(body=>Object.keys(body).length===0));assert.ok(reads>0);c.dispose();
});
test('429 and lost scheduling responses retry only their current visible identity',async()=>{
 for(const failure of [{status:429},new TypeError('Network reply lost')]){
  let posts=0,visible=true,now=0;const c=createEarlyGeometryClient({clock:()=>now,isVisible:()=>visible,
   request:async()=>{posts++;if(posts===1)throw failure;},read:async()=>{}});
  const s=snapshot();await c.ensure(s);visible=false;now=2000;await c.poll(s);assert.equal(posts,1);
  visible=true;const replaced=snapshot();replaced.card.sides.FRONT.upload.uploadId='replacement';replaced.earlyGeometry.FRONT.key='replacement-key';
  await c.poll(replaced);assert.equal(posts,1);await c.ensure(replaced);assert.equal(posts,2);
  now=30000;await c.poll(replaced);assert.equal(posts,2);c.dispose();
 }
});
test('in-flight ensure is deduplicated and a failed GET never repeats an acknowledged POST',async()=>{
 let posts=0,reads=0,finish,now=0;
 const c=createEarlyGeometryClient({clock:()=>now,request:()=>{posts++;return new Promise(resolve=>finish=resolve);},read:async()=>{reads++;if(reads===1)throw {status:503};}});
 const s=snapshot(),first=c.ensure(s);await c.ensure(s);assert.equal(posts,1);finish();await first;
 await c.ensure(s);now=4000;await c.poll(snapshot('READY'));assert.equal(reads,2);assert.equal(posts,1);c.dispose();
});
test('terminal detector outcomes are not implicitly retried after scheduling reconciliation',async()=>{
 const bodies=[];let now=0;const c=createEarlyGeometryClient({clock:()=>now,request:async body=>{bodies.push(body);if(bodies.length===1)throw {status:503};},read:async()=>{}});
 const s=snapshot('NEEDS_REVIEW');await c.ensure(s);now=2000;await c.poll(s);now=30000;await c.poll(s);await c.ensure(s);
 assert.deepEqual(bodies,[{},{}]);await c.retry('FRONT',s.earlyGeometry.FRONT);now=60000;await c.poll(s);
 assert.deepEqual(bodies,[{},{},{side:'FRONT',expectedKey:'front-key'}]);c.dispose();
});
test('ensure authorization failures stop every reconciliation and permanent request failures do not loop',async()=>{
 for(const status of [400,401,403,409]){
  let posts=0,reads=0,errors=0;const c=createEarlyGeometryClient({clock:()=>0,request:async()=>{posts++;throw {status};},read:async()=>reads++,onError:()=>errors++});
  const s=snapshot('NEEDS_REVIEW');await c.ensure(s);await c.ensure(s);await c.poll(s,60000);
  if(status===401||status===403)await c.retry('FRONT',s.earlyGeometry.FRONT);
  assert.equal(posts,1);assert.equal(reads,0);assert.equal(errors,1);c.dispose();
 }
});
test('uncertain explicit retry reconciles status and only retries failed GETs thereafter',async()=>{
 const failure={status:503};let posts=0,reads=0,now=0;
 const c=createEarlyGeometryClient({clock:()=>now,request:async()=>{posts++;throw failure;},read:async()=>{reads++;if(reads===1)throw {status:503};}});
 const s=snapshot('NEEDS_REVIEW');await assert.rejects(c.retry('FRONT',s.earlyGeometry.FRONT),error=>error===failure);
 assert.equal(reads,1);now=2000;await c.poll(s);assert.equal(reads,1);now=4000;await c.poll(s);assert.equal(reads,2);
 now=8000;await c.poll(s);assert.equal(reads,2);assert.equal(posts,1);c.dispose();
});
test('explicit retry refuses duplicate in-flight submissions and stops on unauthorized POST or GET',async()=>{
 let posts=0,reads=0,finish;const s=snapshot('FAILED');
 const c=createEarlyGeometryClient({request:()=>{posts++;return new Promise(resolve=>finish=resolve);},read:async()=>reads++});
 const first=c.retry('FRONT',s.earlyGeometry.FRONT);await c.retry('FRONT',s.earlyGeometry.FRONT);assert.equal(posts,1);
 finish();await first;assert.equal(reads,1);c.dispose();
 for(const deniedAt of ['POST','GET']){
  let requests=0,gets=0,errors=0;const d=createEarlyGeometryClient({request:async()=>{requests++;if(deniedAt==='POST')throw {status:401};},
   read:async()=>{gets++;throw {status:403};},onError:()=>errors++});
  await assert.rejects(d.retry('FRONT',s.earlyGeometry.FRONT));await d.ensure(s);await d.retry('FRONT',s.earlyGeometry.FRONT);await d.poll(snapshot(),60000);
  assert.equal(requests,1);assert.equal(gets,deniedAt==='GET'?1:0);assert.equal(errors,1);d.dispose();
 }
});
test('a read started before an uncertain retry cannot satisfy its later reconciliation',async()=>{
 let reads=0,posts=0,finish,now=0;
 const c=createEarlyGeometryClient({clock:()=>now,request:async()=>{posts++;throw new TypeError('Lost reply');},read:()=>{reads++;return reads===1?new Promise(resolve=>finish=resolve):Promise.resolve();}});
 const before=c.poll(snapshot());await assert.rejects(c.retry('FRONT',snapshot('NEEDS_REVIEW').earlyGeometry.FRONT));
 assert.equal(reads,1);finish();await before;now=2000;await c.poll(snapshot('NEEDS_REVIEW'));
 assert.equal(reads,2);assert.equal(posts,1);c.dispose();
});
