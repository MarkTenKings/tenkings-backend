import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createIntakeClient } from '../src/client.mjs';
import { memoryJournal, sha } from './helpers.mjs';
const cardId='00000000-0000-4000-8000-000000000001';
const fail=code=>Object.assign(new Error(code),{code});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};

function fixture({planLost=false,signLost=false,completeLost=false,prepareGate=null}={}) {
  const journal=memoryJournal(),calls=[],uploads=new Map(),versions={FRONT:0,BACK:0};
  let puts=0;
  const request=async(url,{body})=>{
    const stage=url.split('/').at(-1);
    if(stage==='uploads'){
      // This must be durable before a request can have an uncertain outcome.
      const saved=await journal.get(body.requestId);assert.equal(saved.planUncertain,true);
      calls.push({stage,side:body.side});
      if(!uploads.has(body.requestId)){
        assert.equal(body.expectedVersion,versions[body.side]);versions[body.side]++;
        uploads.set(body.requestId,{id:body.requestId,input:structuredClone(body),bytes:null,verification:null});
      }else assert.deepEqual(body,uploads.get(body.requestId).input);
      if(planLost){planLost=false;throw fail('NETWORK_LOST');}
      return {upload:{uploadId:body.requestId}};
    }
    const id=url.split('/').at(-2),upload=uploads.get(id);assert(upload);
    calls.push({stage,side:upload.input.side});
    assert.equal((await journal.get(id)).uploadId,id);
    if(stage==='sign'){
      if(signLost){signLost=false;throw fail('NETWORK_LOST');}
      return {state:'UPLOAD',uploadId:id,method:'PUT',byteCount:upload.input.byteCount,url:`https://storage.invalid/${id}`,headers:{'If-None-Match':'*'}};
    }
    if(stage==='complete'){
      if(!upload.bytes)throw fail('INTAKE_UPLOAD_ABSENT');
      assert.equal(sha(upload.bytes),upload.input.sha256);assert.equal(upload.bytes.length,upload.input.byteCount);
      upload.verification={sha256:sha(upload.bytes),byteCount:upload.bytes.length};
      if(completeLost){completeLost=false;throw fail('NETWORK_LOST');}
      return {upload:{uploadId:id,verification:upload.verification}};
    }
    if(stage==='prepare'){
      assert(upload.verification);await prepareGate?.(upload.input.side);
      return {card:{sides:structuredClone(versions)},upload:{uploadId:id,verification:upload.verification,source:{ref:'exact-'+id}}};
    }
    throw new Error(url);
  };
  const fetchImpl=async(url,options)=>{
    const id=url.split('/').at(-1),upload=uploads.get(id),saved=await journal.get(id);
    assert.equal(saved.uploadId,id);assert.equal(saved.planUncertain,true);
    assert.equal(options.headers['If-None-Match'],'*');assert.equal(options.credentials,'omit');
    assert.equal(options.redirect,'error');assert.equal(options.referrerPolicy,'no-referrer');
    assert.equal(upload.bytes,null);calls.push({stage:'PUT',side:upload.input.side});puts++;
    upload.bytes=Buffer.from(await options.body.arrayBuffer());return {status:200};
  };
  const client=()=>createIntakeClient({journal,request,fetchImpl,cryptoImpl:webcrypto});
  return {journal,calls,uploads,versions,client,get puts(){return puts;}};
}

test('fresh certain plan omits only the absent probe and still verifies bytes before preparation',async()=>{
  const f=fixture(),file=new Blob([Uint8Array.of(0,255,18,7)]);
  await f.client().upload(cardId,'FRONT',0,file);
  assert.deepEqual(f.calls.map(x=>x.stage),['uploads','sign','PUT','complete','prepare']);
  assert.deepEqual([...f.uploads.values()][0].bytes,Buffer.from(await file.arrayBuffer()));
  assert.equal(f.puts,1);assert.equal((await f.journal.list()).length,0);
});

test('Back completes while Front preparation is pending, preserving independent versions and journals',async()=>{
  const frontEntered=deferred(),releaseFront=deferred();
  const f=fixture({prepareGate:async side=>{if(side==='FRONT'){frontEntered.resolve();await releaseFront.promise;}}}),client=f.client();
  const front=client.upload(cardId,'FRONT',0,new Blob(['untouched-front']));
  await frontEntered.promise;
  try{
    assert.equal((await client.pending()).length,1);
    const back=await client.upload(cardId,'BACK',0,new Blob(['untouched-back']));
    assert(back.upload.source);assert.deepEqual(f.versions,{FRONT:1,BACK:1});
    const pending=await client.pending();assert.equal(pending.length,1);assert.equal(pending[0].value.input.side,'FRONT');
    assert.equal(pending[0].value.verified,true);assert.equal(f.puts,2);
  }finally{releaseFront.resolve();await front;}
  assert.equal((await client.pending()).length,0);
  assert.deepEqual([...f.uploads.values()].map(x=>[x.input.side,x.bytes.toString()]),[['FRONT','untouched-front'],['BACK','untouched-back']]);
});

test('same-side reservation precedes hashing and prevents a second journal or plan',async()=>{
  const entered=deferred(),release=deferred(),f=fixture(),client=f.client();
  class SlowNative extends Blob{async arrayBuffer(){entered.resolve();await release.promise;return super.arrayBuffer();}}
  const first=client.upload(cardId,'FRONT',0,new SlowNative(['native']));await entered.promise;
  try{
    await assert.rejects(client.upload(cardId,'FRONT',0,new Blob(['duplicate'])),{code:'INTAKE_UPLOAD_IN_PROGRESS'});
    assert.equal((await client.pending()).length,0);assert.equal(f.calls.length,0);
  }finally{release.resolve();await first;}
  assert.equal(f.calls.filter(x=>x.stage==='uploads').length,1);assert.equal(f.puts,1);
});

test('same-side reservation covers the journal read window and releases after local failure',async()=>{
  const gate=deferred(),journal=memoryJournal(),list=journal.list;let first=true,requests=0;
  journal.list=async()=>{if(first){first=false;await gate.promise;throw fail('INTAKE_JOURNAL_UNAVAILABLE');}return list();};
  const client=createIntakeClient({journal,request:async()=>{requests++;throw fail('EXPECTED_TEST_STOP');},cryptoImpl:webcrypto});
  const uploading=client.upload(cardId,'FRONT',0,new Blob(['native']));
  await assert.rejects(client.upload(cardId,'FRONT',0,new Blob(['duplicate'])),{code:'INTAKE_UPLOAD_IN_PROGRESS'});
  gate.resolve();await assert.rejects(uploading,{code:'INTAKE_JOURNAL_UNAVAILABLE'});
  await assert.rejects(client.upload(cardId,'FRONT',0,new Blob(['new'])),{code:'EXPECTED_TEST_STOP'});
  assert.equal(requests,1);
});

for(const kind of ['planLost','signLost','completeLost'])test(`reload after ${kind} reconciles before signing or another PUT`,async()=>{
  const f=fixture({[kind]:true});
  await assert.rejects(f.client().upload(cardId,'BACK',0,new Blob(['original'])),{code:'NETWORK_LOST'});
  const [pending]=await f.journal.list();assert.equal(pending.value.planUncertain,true);
  const at=f.calls.length;await f.client().resume(pending.id);
  const resumed=f.calls.slice(at).map(x=>x.stage);
  assert.deepEqual(resumed,kind==='planLost'?['uploads','complete','sign','PUT','complete','prepare']:
    kind==='signLost'?['complete','sign','PUT','complete','prepare']:['complete','prepare']);
  assert.equal(f.puts,1);assert.equal((await f.journal.list()).length,0);
});
