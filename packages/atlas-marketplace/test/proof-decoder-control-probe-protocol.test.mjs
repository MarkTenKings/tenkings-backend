import test from 'node:test';
import assert from 'node:assert/strict';
import {PROOF_DECODER_CONTROL_PROBE_SCHEMA as SCHEMA,PROOF_DECODER_CONTROL_PROBE_MODES as MODES,encodeProofDecoderControlProbeInput,createProofDecoderControlProbeOutputReader} from '../src/proof-decoder-control-probe-protocol.mjs';

const nonce='a3'.repeat(32),other='b4'.repeat(32),begin=(mode='READONLY')=>({schema:SCHEMA,classification:'UNVERIFIED',evidenceKind:'PROBE_ONLY',executionAllowed:false,freshPublicationAllowed:false,runtimeQualified:false,stage:'BEGIN',mode,nonce,pid:1,startedBootNs:'1000000000'});
const final=(mode='READONLY')=>({...begin(mode),stage:'FINAL',finishedBootNs:'1100000000',completion:'COMPLETE',reason:'NORMAL',observations:[{id:'OPEN_NODE_WRITE',value:-1,error:13},{id:'OPEN_WORKER_WRITE',value:-1,error:30}]});
const bytes=value=>Buffer.from(JSON.stringify(value)+'\n');
const reader=(mode='READONLY')=>createProofDecoderControlProbeOutputReader({expectedMode:mode,expectedNonce:nonce});

test('input is exactly48 bytes with finite mode, reserved zeros and copied nonce; no path/count/command options',()=>{
  for(const [index,mode] of MODES.entries()){const frame=encodeProofDecoderControlProbeInput({mode,nonce});assert.equal(frame.length,48);assert.equal(frame.subarray(0,8).toString(),'ATR2P001');assert.equal(frame[8],index+1);assert.ok(frame.subarray(9,16).every(byte=>byte===0));assert.equal(frame.subarray(16).toString('hex'),nonce);}
  for(const input of [{mode:'SHELL',nonce},{mode:'NETWORK',nonce,command:'id'},{mode:'NETWORK',nonce:other.toUpperCase()},{mode:'NETWORK',nonce:'a'.repeat(63)}])assert.throws(()=>encodeProofDecoderControlProbeInput(input));
  let called=false;assert.throws(()=>encodeProofDecoderControlProbeInput({get mode(){called=true;return 'NETWORK';},nonce}));assert.equal(called,false);
});
test('every-byte fragmentation preserves two closed UNVERIFIED records without granting authority',()=>{
  const input=Buffer.concat([bytes(begin()),bytes(final())]),r=reader();for(let at=0;at<input.length;at++){r.feed(input.subarray(at,at+1));assert.equal(r.status().allocatedBytes,4096);}
  const result=r.end();assert.equal(result.state,'ENDED');assert.deepEqual(result.final,final());assert.equal(result.runtimeQualified,false);assert.equal(result.executionAllowed,false);assert.equal(result.freshPublicationAllowed,false);assert.ok(Object.isFrozen(result.final.observations));
});
test('OOM/guard termination with BEGIN only remains incomplete, including absorbing EOF failure',()=>{
  for(const mode of ['MEMORY_OOM','CPU_DEADLINE']){const r=reader(mode);r.feed(bytes(begin(mode)));assert.equal(r.snapshot().state,'BEGIN_ONLY');assert.throws(()=>r.end());assert.equal(r.status().failed,true);assert.equal(r.snapshot().final,null);assert.throws(()=>r.feed(bytes(final(mode))));}
  const r=reader();r.feed(bytes(begin()).subarray(0,-1));assert.throws(()=>r.end());assert.equal(r.status().bufferedBytes,0);
  const closed=reader();closed.feed(bytes(begin()));closed.close();assert.equal(closed.snapshot().state,'INCOMPLETE');assert.equal(closed.snapshot().final,null);
});
test('wrong nonce/mode/pid/time, unknown fields and forged authority all refuse',()=>{
  for(const mutation of [{nonce:other},{mode:'NETWORK'},{executionAllowed:true},{runtimeQualified:true},{freshPublicationAllowed:true},{classification:'QUALIFIED'},{extra:'ignored'},{startedBootNs:'01'},{startedBootNs:'18446744073709551616'}]){const r=reader();assert.throws(()=>r.feed(bytes({...begin(),...mutation})));assert.equal(r.status().failed,true);}
  for(const mutation of [{pid:2},{nonce:other},{startedBootNs:'999999999'},{finishedBootNs:'999999999'},{reason:'PASS'},{completion:'PASS'},{observations:[{id:'OPEN_NODE_WRITE',value:-1,error:13,authority:true}]}]){const r=reader();r.feed(bytes(begin()));assert.throws(()=>r.feed(bytes({...final(),...mutation})));}
});
test('duplicate aliases, malformed UTF8, reversed stages, duplicate and trailing records refuse',()=>{
  const serialized=JSON.stringify(begin());for(const text of [serialized.replace('{','{"nonce":"'+nonce+'",'),serialized.replace('{','{"n\\u006fnce":"'+nonce+'",')])assert.throws(()=>reader().feed(Buffer.from(text+'\n')));
  const malformed=bytes(begin());malformed[2]=255;assert.throws(()=>reader().feed(malformed));assert.throws(()=>reader().feed(bytes(final())));
  for(const suffix of [Buffer.from('\n'),bytes(final()),Buffer.from('x')]){const r=reader();assert.throws(()=>r.feed(Buffer.concat([bytes(begin()),bytes(final()),suffix])));}
  const r=reader();r.feed(bytes(begin()));assert.throws(()=>r.feed(bytes(begin())));
});
test('finite output budgets and per-mode observation bounds refuse oversized or reordered claims',()=>{
  assert.throws(()=>reader().feed(Buffer.alloc(8193,32)));assert.throws(()=>reader().feed(Buffer.alloc(4096,32)));
  for(const observations of [[{id:'OPEN_WORKER_WRITE',value:-1,error:13},{id:'OPEN_NODE_WRITE',value:-1,error:13}],[{id:'OPEN_NODE_WRITE',value:-1,error:0}],[{id:'UNKNOWN',value:0,error:0}]]){const r=reader();r.feed(bytes(begin()));assert.throws(()=>r.feed(bytes({...final(),observations})));}
  for(const [mode,id,value] of [['PIDS','THREADS_CREATED',41],['FD','FD_OPENED',81],['MEMORY_OOM','TOUCHED_BYTES',671092736],['TMPFS','TMP_WRITTEN',9437185],['CPU_QUOTA','THREADS_CREATED',5]]){const r=reader(mode);r.feed(bytes(begin(mode)));assert.throws(()=>r.feed(bytes({...final(mode),completion:'STOPPED',reason:'BUDGET',observations:[{id,value,error:0}]})));}
});
test('bounded STOPPED output retains observations but cannot turn missing control coverage into completion',()=>{
  const r=reader('TMPFS');r.feed(bytes(begin('TMPFS')));const stopped={...final('TMPFS'),completion:'STOPPED',reason:'SYSCALL_ERROR',observations:[{id:'TMP_CREATE',value:-1,error:17}]};r.feed(bytes(stopped));assert.deepEqual(r.end().final,stopped);
  for(const mode of ['MEMORY_OOM','CPU_DEADLINE']){const r=reader(mode);r.feed(bytes(begin(mode)));assert.throws(()=>r.feed(bytes({...final(mode),observations:[]})));}
  const r2=reader();r2.feed(bytes(begin()));assert.throws(()=>r2.feed(bytes({...final(),observations:[]})));
});
