import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createIntakeClient, MAX_NATIVE_PHOTO_BYTES } from '../src/client.mjs';
import { memoryJournal, sha } from './helpers.mjs';

const cardId='00000000-0000-4000-8000-000000000001',uploadId='00000000-0000-4000-8000-000000000002';
const failure=(code,status)=>Object.assign(new Error(code),{code,...(status?{status}:{})});
function fixture() {
  const journal=memoryJournal(),calls=[],signals=[];
  let plan=null,original=null,puts=0,planFailure=null,putMode='success',prepareFailure=false;
  const request=async(url,{body})=>{
    calls.push({url,body});
    if(url.endsWith('/uploads')) {
      if(planFailure){if(planFailure.code==='NETWORK_LOST')plan=structuredClone(body);throw planFailure;}
      if(plan)assert.deepEqual(body,plan);else plan=structuredClone(body);
      return {upload:{uploadId}};
    }
    if(url.endsWith('/complete')) {
      if(!original)throw failure('INTAKE_UPLOAD_ABSENT');
      return {upload:{uploadId,verification:{sha256:sha(original),byteCount:original.length}}};
    }
    if(url.endsWith('/sign'))return {state:'UPLOAD',method:'PUT',uploadId,byteCount:plan.byteCount,
      url:'https://storage.invalid/exact-native-key',headers:{'Content-Type':'application/octet-stream','If-None-Match':'*'}};
    if(url.endsWith('/prepare')) {
      if(prepareFailure)throw failure('PHOTO_DECODE_TIMEOUT');
      return {upload:{uploadId,source:{ref:'synthetic'}}};
    }
    throw new Error(url);
  };
  const fetchImpl=async(url,options)=>{
    assert.equal(url,'https://storage.invalid/exact-native-key');assert.equal(options.credentials,'omit');
    assert.equal(options.redirect,'error');assert.equal(options.referrerPolicy,'no-referrer');
    assert(options.signal instanceof AbortSignal);signals.push(options.signal);puts++;
    if(putMode!=='hang-without-write')original=Buffer.from(await options.body.arrayBuffer());
    if(putMode.startsWith('hang-'))return new Promise(()=>{});
    return {status:200};
  };
  return {journal,calls,signals,client:()=>createIntakeClient({request,journal,fetchImpl,cryptoImpl:webcrypto,uploadTimeoutMs:20}),
    setPlanFailure:value=>{planFailure=value;},setPutMode:value=>{putMode=value;},setPrepareFailure:value=>{prepareFailure=value;},
    get puts(){return puts;},get original(){return original;}};
}

test('native 64 MiB bound rejects before file read, hashing or journal mutation',async()=>{
  let read=false,requested=false,hashed=false;
  class TooLarge extends Blob {get size(){return MAX_NATIVE_PHOTO_BYTES+1;}async arrayBuffer(){read=true;throw new Error('must not read');}}
  const journal=memoryJournal(),client=createIntakeClient({journal,request:async()=>{requested=true;},cryptoImpl:{subtle:{digest:async()=>{hashed=true;}}}});
  assert.equal(MAX_NATIVE_PHOTO_BYTES,64*1024*1024);
  await assert.rejects(client.upload(cardId,'FRONT',0,new TooLarge(['native'])),{code:'INTAKE_PHOTO_TOO_LARGE'});
  assert.equal(read,false);assert.equal(hashed,false);assert.equal(requested,false);assert.equal((await journal.list()).length,0);
});

test('first definite plan refusals permit explicit discard and a new native selection',async()=>{
  for(const status of [400,403,404,409,413]){
    const f=fixture(),client=f.client();f.setPlanFailure(failure('INTAKE_TEST_PLAN_REFUSED',status));
    await assert.rejects(client.upload(cardId,'FRONT',0,new Blob(['first'])),{status});
    const [pending]=await client.pending();assert.equal(pending.value.planUncertain,false);assert.equal(pending.value.uploadId,undefined);
    assert.deepEqual(pending.value.planRefusal,{status,code:'INTAKE_TEST_PLAN_REFUSED'});
    await assert.rejects(client.upload(cardId,'FRONT',0,new Blob(['second'])),{code:'INTAKE_SIDE_UPLOAD_PENDING'});
    await client.discardUnplanned(pending.id);assert.equal((await client.pending()).length,0);
    f.setPlanFailure(null);await client.upload(cardId,'FRONT',1,new Blob(['second']));assert.equal(f.original.toString(),'second');
  }
});

test('lost plan reply remains undiscardable after later definite refusal and resumes exact plan',async()=>{
  const f=fixture();f.setPlanFailure(failure('NETWORK_LOST'));
  await assert.rejects(f.client().upload(cardId,'FRONT',0,new Blob(['native'])),{code:'NETWORK_LOST'});
  const [pending]=await f.client().pending();assert.equal(pending.value.planUncertain,true);
  f.setPlanFailure(failure('INTAKE_CARD_ACCESS_DENIED',403));await assert.rejects(f.client().resume(pending.id),{status:403});
  await assert.rejects(f.client().discardUnplanned(pending.id),{code:'INTAKE_PLAN_NOT_DISCARDABLE'});
  f.setPlanFailure(null);await f.client().resume(pending.id);assert.equal(f.puts,1);assert.equal(f.original.toString(),'native');
  assert(f.calls.filter(call=>call.url.endsWith('/uploads')).every(call=>call.body.requestId===pending.id));
});

test('legacy unplanned journal rows cannot be discarded without prior outcome evidence',async()=>{
  const f=fixture(),id=webcrypto.randomUUID(),file=new Blob(['native']);
  await f.journal.put(id,{kind:'upload',cardId,file,input:{requestId:id,side:'FRONT',expectedVersion:0,sha256:sha(Buffer.from('native')),byteCount:6}});
  f.setPlanFailure(failure('INTAKE_CARD_ACCESS_DENIED',403));await assert.rejects(f.client().resume(id));
  assert.equal((await f.journal.get(id)).planUncertain,true);
  await assert.rejects(f.client().discardUnplanned(id),{code:'INTAKE_PLAN_NOT_DISCARDABLE'});
});

test('allocated plan and verified original cannot use never-allocated discard',async()=>{
  const f=fixture();f.setPrepareFailure(true);
  await assert.rejects(f.client().upload(cardId,'BACK',0,new Blob(['native'])),{code:'PHOTO_DECODE_TIMEOUT'});
  const [pending]=await f.client().pending();assert.equal(pending.value.uploadId,uploadId);assert.equal(pending.value.verified,true);
  await assert.rejects(f.client().discardUnplanned(pending.id),{code:'INTAKE_PLAN_NOT_DISCARDABLE'});
  assert.equal((await f.client().pending()).length,1);
});

test('stalled successful PUT aborts then reconciles exact original without second PUT',async()=>{
  const f=fixture();f.setPutMode('hang-after-write');
  await f.client().upload(cardId,'FRONT',0,new Blob(['untouched-native']));
  assert.equal(f.signals[0].aborted,true);assert.equal(f.signals[0].reason.code,'INTAKE_UPLOAD_TIMEOUT');
  assert.equal(f.puts,1);assert.equal(f.original.toString(),'untouched-native');assert.equal((await f.client().pending()).length,0);
});

test('stalled absent PUT retains exact planned Blob and resumes after client recreation',async()=>{
  const f=fixture();f.setPutMode('hang-without-write');
  await assert.rejects(f.client().upload(cardId,'BACK',0,new Blob(['untouched-native'])),{code:'INTAKE_UPLOAD_ABSENT'});
  const [pending]=await f.client().pending();assert.equal(pending.value.uploadId,uploadId);assert.equal(f.signals[0].aborted,true);
  assert.equal(await pending.value.file.text(),'untouched-native');
  f.setPutMode('success');await f.client().resume(pending.id);
  assert.equal(f.puts,2);assert.equal(f.calls.filter(call=>call.url.endsWith('/uploads')).length,1);assert.equal((await f.client().pending()).length,0);
});

test('timed-out committed PUT with preparation failure resumes verified original without another upload',async()=>{
  const f=fixture();f.setPutMode('hang-after-write');f.setPrepareFailure(true);
  await assert.rejects(f.client().upload(cardId,'BACK',0,new Blob(['native'])),{code:'PHOTO_DECODE_TIMEOUT'});
  const [pending]=await f.client().pending();assert.equal(pending.value.verified,true);
  f.setPrepareFailure(false);await f.client().resume(pending.id);assert.equal(f.puts,1);assert.equal((await f.client().pending()).length,0);
});

test('caller cancellation keeps exact pending original and fresh resume reconciles any committed PUT',async()=>{
  const f=fixture(),controller=new AbortController();f.setPutMode('hang-after-write');
  const active=f.client().upload(cardId,'FRONT',0,new Blob(['native']),{signal:controller.signal});
  while(!f.signals.length)await new Promise(resolve=>setImmediate(resolve));
  controller.abort(failure('CALLER_CANCELLED'));await assert.rejects(active,{code:'CALLER_CANCELLED'});
  assert.equal(f.signals[0].aborted,true);const [pending]=await f.client().pending();assert(pending);
  await f.client().resume(pending.id);assert.equal(f.puts,1);assert.equal((await f.client().pending()).length,0);
});
