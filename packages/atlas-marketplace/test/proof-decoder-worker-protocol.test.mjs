import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {canonicalJSON} from '../src/contract.mjs';
import {PROOF_DECODER_LIMITS,proofDecoderLimitsHash} from '../src/proof-decoder-protocol.mjs';
import {WORKER_REQUEST_SCHEMA,WORKER_RESULT_SCHEMA,encodeProofDecoderWorkerRequestHeader,encodeProofDecoderWorkerRequest,encodeProofDecoderWorkerResult,createProofDecoderWorkerRequestReader,createProofDecoderWorkerResultReader,assertProofDecoderWorkerResult} from '../src/proof-decoder-worker-protocol.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function input(bytes=Buffer.from('original')){const limits={...PROOF_DECODER_LIMITS};return{requestId:randomUUID(),plan:{byteCount:bytes.length,sha256:hash(bytes),declaredType:'image/png'},limits,limitsHash:proofDecoderLimitsHash(limits)};}
function raw(text,bytes=Buffer.alloc(0)){const payload=Buffer.from(text),header=Buffer.alloc(8);header.write('PDW1');header.writeUInt32BE(payload.length,4);return Buffer.concat([header,payload,bytes]);}
function result(i){return{schema:'atlas-marketplace-proof-image-v1',decoder:'sharp-0.33.5/libvips-8.15.3',contentType:i.plan.declaredType,byteCount:i.plan.byteCount,sha256:i.plan.sha256,width:1,height:1};}

test('worker request parses every-byte fragmentation, owns bytes and exposes only after EOF',()=>{
  const bytes=Buffer.from('original'),i=input(bytes),wire=encodeProofDecoderWorkerRequest(i,bytes);let calls=0,observed;
  const reader=createProofDecoderWorkerRequestReader({onRequest(value){calls++;observed=value;}});
  for(const byte of wire){reader.feed(Buffer.from([byte]));assert.ok(reader.status().allocatedBytes<=8+1024+bytes.length);}
  assert.equal(calls,0);const parsed=reader.end();assert.equal(calls,1);assert.equal(observed,parsed);assert.deepEqual(parsed.bytes,bytes);
  bytes.fill(0);assert.equal(parsed.bytes.toString(),'original');reader.dispose();assert.ok(parsed.bytes.every(v=>v===0));
});

test('canonical worker metadata rejects duplicate/escaped keys, unknown fields, depth, null limits and mismatched limits hash',()=>{
  const bytes=Buffer.from('original'),i=input(bytes),base={schema:WORKER_REQUEST_SCHEMA,...i},canonical=canonicalJSON(base);
  const invalid=[
    canonical.replace('"requestId":','"requestId":"'+i.requestId+'","requestId":'),
    canonical.replace('"requestId":','"request\\u0049d":"'+i.requestId+'","requestId":'),
    canonicalJSON({...base,command:'/bin/sh'}),canonical+' ',
    '{"a":[[[[[0]]]]]}',
    canonicalJSON({...base,limits:{...base.limits,maxPixels:null}}),
    canonicalJSON({...base,limitsHash:'0'.repeat(64)}),
    canonicalJSON({...base,plan:{...base.plan,filename:'/private/original'}}),
  ];
  for(const text of invalid){const r=createProofDecoderWorkerRequestReader();assert.throws(()=>{r.feed(raw(text,bytes));r.end();});r.dispose();}
});

test('worker framing refuses oversized metadata, wrong magic, missing bytes, trailing bytes and contradictory originals',()=>{
  const bytes=Buffer.from('original'),i=input(bytes),wire=encodeProofDecoderWorkerRequest(i,bytes);
  const wrongMagic=Buffer.from(wire);wrongMagic[0]=0;const oversized=Buffer.from(wire.subarray(0,8));oversized.writeUInt32BE(1025,4);
  const badDigest=raw(canonicalJSON({schema:WORKER_REQUEST_SCHEMA,...i,plan:{...i.plan,sha256:'0'.repeat(64)}}),bytes);
  for(const candidate of [wrongMagic,oversized,wire.subarray(0,7),wire.subarray(0,-1),Buffer.concat([wire,Buffer.from([0])]),badDigest]){
    const r=createProofDecoderWorkerRequestReader();assert.throws(()=>{r.feed(candidate);r.end();});r.dispose();
  }
  assert.throws(()=>encodeProofDecoderWorkerRequest(i,Buffer.from('changed!')));
  assert.throws(()=>encodeProofDecoderWorkerRequestHeader({...i,limits:{...i.limits,maxObjectBytes:0}}));
});

test('worker results wait for EOF, refuse trailing/duplicate results and bind originals without cleanup authority',()=>{
  const i=input(),validation=result(i),wire=encodeProofDecoderWorkerResult({requestId:i.requestId,outcome:'SUCCESS',validation});
  let calls=0;const r=createProofDecoderWorkerResultReader({onResult(){calls++;}});for(const byte of wire)r.feed(Buffer.from([byte]));assert.equal(calls,0);
  const value=r.end();assert.equal(calls,1);assert.equal(value.schema,WORKER_RESULT_SCHEMA);assert.deepEqual(assertProofDecoderWorkerResult(value,{requestId:i.requestId,plan:i.plan,limits:i.limits}),value);
  for(const candidate of [Buffer.concat([wire,Buffer.from([0])]),Buffer.concat([wire,wire]),wire.subarray(0,-1)]){
    const bad=createProofDecoderWorkerResultReader();assert.throws(()=>{bad.feed(candidate);bad.end();});
  }
  for(const changes of [{requestId:randomUUID()},{validation:{...validation,sha256:'0'.repeat(64)}},{validation:{...validation,byteCount:99}},{validation:{...validation,contentType:'image/jpeg'}}]){
    assert.throws(()=>assertProofDecoderWorkerResult({...value,...changes},{requestId:i.requestId,plan:i.plan,limits:i.limits}));
  }
  assert.throws(()=>encodeProofDecoderWorkerResult({requestId:i.requestId,outcome:'SUCCESS',validation,workerState:'REAPED'}));
  assert.throws(()=>encodeProofDecoderWorkerResult({requestId:i.requestId,outcome:'INVALID_IMAGE',validation}));
  for(const outcome of ['INVALID_IMAGE','DECODER_FAILURE']){
    const p=createProofDecoderWorkerResultReader();p.feed(encodeProofDecoderWorkerResult({requestId:i.requestId,outcome,validation:null}));assert.equal(p.end().outcome,outcome);
  }
});
