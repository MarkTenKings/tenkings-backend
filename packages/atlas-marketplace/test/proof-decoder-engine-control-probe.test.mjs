import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createProofDecoderLaunchPlan} from '../src/proof-decoder-profile.mjs';
import {assertProofDecoderPlan} from '../src/proof-decoder-protocol.mjs';
import {encodeProofDecoderControlProbeInput,PROOF_DECODER_CONTROL_PROBE_MODES} from '../src/proof-decoder-control-probe-protocol.mjs';
import {PROOF_DECODER_CONTROL_PROBE_IMAGE,proofDecoderControlProbeRequest,assertProofDecoderControlProbeRequest,assertProofDecoderControlProbeLaunchPlan,createProofDecoderControlProbeStreamReader,createProofDecoderEngineControlProbeTransport} from '../src/proof-decoder-engine-control-probe-transport.mjs';
import {createProofDecoderTargetControlProbeSession,assertProofDecoderOwnedEngineCleanupReceipt,assertProofDecoderEngineEffectReceipt} from '../src/proof-decoder-engine-owned-cleanup.mjs';
import {assertProofDecoderTargetRegistry,openProofDecoderTargetRegistry} from '../src/proof-decoder-target-registry.mjs';
import {syntheticDecoderProfile} from './proof-decoder-profile-fixtures.mjs';

const nonce='ab'.repeat(32),sha=b=>createHash('sha256').update(b).digest('hex');
function profile(){return {...syntheticDecoderProfile(),image:PROOF_DECODER_CONTROL_PROBE_IMAGE,platform:'linux/amd64',nodeVersion:'22.16.0',uid:65532,gid:65532,
  limits:{maxConcurrent:1,maxObjectBytes:10485760,maxPixels:16000000,timeoutMs:15000},
  resources:{memoryBytes:536870912,cpuQuotaMicros:150000,cpuPeriodMicros:100000,pidsLimit:32,nofileLimit:64,tmpfsBytes:8388608,shmBytes:8388608},
  seccomp:{path:'/etc/atlas-r2-decoder/security-01/seccomp.json',sha256:'5f179abeafd17a18dbb6d0617fbda4a980d9b941e984b270f438ffdaebf47ede'},
  mac:{kind:'apparmor',name:'atlas_r2_decoder_8c01465b205082c010733e63f6966b7b24913d0da1db72ab8befc3dbc32d0291'}};}
function plan(value=profile()){return createProofDecoderLaunchPlan({enabled:true,profile:value});}
function frame(kind,bytes){const header=Buffer.alloc(8);header[0]=kind;header.writeUInt32BE(bytes.length,4);return Buffer.concat([header,bytes]);}
function records(mode='READONLY'){
  const begin={schema:'atlas-proof-decoder-control-probe-v1',classification:'UNVERIFIED',evidenceKind:'PROBE_ONLY',executionAllowed:false,freshPublicationAllowed:false,runtimeQualified:false,stage:'BEGIN',mode,nonce,pid:1,startedBootNs:'100'};
  const final={...begin,stage:'FINAL',finishedBootNs:'200',completion:'COMPLETE',reason:'NORMAL',observations:[{id:'OPEN_NODE_WRITE',value:-1,error:30},{id:'OPEN_WORKER_WRITE',value:-1,error:30}]};
  return {begin,final,bytes:Buffer.from(JSON.stringify(begin)+'\n'+JSON.stringify(final)+'\n')};
}
const reader=mode=>createProofDecoderControlProbeStreamReader({expectedMode:mode??'READONLY',expectedNonce:nonce});

test('nine exact probe challenges are bounded, deterministic and rejected by the unchanged image plan contract',()=>{
  for(const mode of PROOF_DECODER_CONTROL_PROBE_MODES){
    const request=proofDecoderControlProbeRequest({mode,nonce}),bytes=encodeProofDecoderControlProbeInput({mode,nonce});
    assert.equal(bytes.length,48);assert.equal(request.byteCount,48);assert.equal(request.sha256,sha(bytes));assert.equal(request.evidenceKind,'PROBE_ONLY');assert.ok(Object.isFrozen(request));
    assert.deepEqual(assertProofDecoderControlProbeRequest(request),request);assert.throws(()=>assertProofDecoderPlan(request));
    for(const field of [{sha256:'0'.repeat(64)},{byteCount:49},{evidenceKind:'WORKER'},{declaredType:'image/png'},{image:'other'}])assert.throws(()=>assertProofDecoderControlProbeRequest({...request,...field}));
  }
  assert.doesNotThrow(()=>assertProofDecoderPlan({byteCount:48,sha256:'a'.repeat(64),declaredType:'image/png'}));
  assert.throws(()=>proofDecoderControlProbeRequest({mode:'SHELL',nonce}));assert.throws(()=>proofDecoderControlProbeRequest({mode:'FD',nonce,command:'id'}));
});

test('probe plan fixes actual comparison image, policy and limits without changing ordinary profile validation',()=>{
  assert.deepEqual(assertProofDecoderControlProbeLaunchPlan(plan()),plan());
  for(const change of [p=>p.image='example.invalid/probe@sha256:'+'1'.repeat(64),p=>p.resources.pidsLimit=64,p=>p.resources.memoryBytes*=2,p=>p.limits.timeoutMs=14000,p=>p.seccomp.sha256='a'.repeat(64),p=>p.mac.name='other_profile',p=>p.uid=65531]){
    const p=profile();change(p);const other=plan(p);assert.throws(()=>assertProofDecoderControlProbeLaunchPlan(other));
  }
  assert.doesNotThrow(()=>createProofDecoderLaunchPlan({enabled:true,profile:syntheticDecoderProfile()}));
});

test('closed descriptors refuse getters, prototypes and coercion hooks without invoking them',()=>{
  let calls=0;const request=proofDecoderControlProbeRequest({mode:'FD',nonce});
  assert.throws(()=>assertProofDecoderControlProbeRequest({...request,get mode(){calls++;return 'FD';}}));
  assert.throws(()=>proofDecoderControlProbeRequest({mode:{toString(){calls++;return 'FD';}},nonce}));
  assert.throws(()=>proofDecoderControlProbeRequest(Object.assign(Object.create({}),{mode:'FD',nonce})));
  assert.throws(()=>createProofDecoderEngineControlProbeTransport({get enabled(){calls++;return true;}}));assert.equal(calls,0);
});

test('default-off target factories admit no callbacks, fake registries, controllers or JSON receipts',()=>{
  assert.equal(createProofDecoderEngineControlProbeTransport(),null);assert.equal(createProofDecoderTargetControlProbeSession(),null);assert.equal(openProofDecoderTargetRegistry(),null);
  assert.throws(()=>createProofDecoderEngineControlProbeTransport({enabled:false,onResult(){}}));assert.throws(()=>createProofDecoderTargetControlProbeSession({enabled:false,command:['sh']}));
  assert.throws(()=>assertProofDecoderTargetRegistry({reserveControlProbe(){}}),{code:'DECODER_TARGET_REGISTRY_REQUIRED'});
  assert.throws(()=>openProofDecoderTargetRegistry({enabled:true,plan:plan(),controller:{status:()=>({healthy:true})},epoch:'PROBE'}),{code:'DECODER_KERNEL_PARENT_REQUIRED'});
  assert.throws(()=>assertProofDecoderOwnedEngineCleanupReceipt({schema:'atlas-proof-decoder-control-probe-cleanup-v1',settled:true},{identity:{},bindingHash:'a',barrierId:'b'}),{code:'ENGINE_TARGET_CLEANUP_RECEIPT_REQUIRED'});
  assert.throws(()=>assertProofDecoderEngineEffectReceipt({status:204},{identity:{},operation:'START',operationId:'x',requestHash:'a',bindingHash:'b'}),{code:'ENGINE_TARGET_EFFECT_RECEIPT_REQUIRED'});
});

test('fragmented Docker records preserve the first stdout byte and finite probe output without stderr disclosure',()=>{
  const r=reader(),wire=Buffer.concat([frame(2,Buffer.from('DO_NOT_RECORD_STDERR')),frame(1,records().bytes)]);
  for(const byte of wire)r.feed(Buffer.from([byte]));const result=r.end();assert.equal(result.state,'ENDED');assert.equal(result.final.completion,'COMPLETE');assert.equal(result.runtimeQualified,false);assert.equal(result.evidenceKind,'PROBE_ONLY');assert.ok(!JSON.stringify(result).includes('DO_NOT_RECORD'));
  const prefix=reader();prefix.feed(Buffer.from([1]));assert.equal(prefix.status().stdoutStarted,true);assert.equal(prefix.status().bufferedBytes,1);prefix.dispose();assert.throws(()=>prefix.feed(Buffer.from([0])));
});

test('probe framing allows its bounded output above worker cap and rejects oversize, malformed or truncated records absorbingly',()=>{
  const r=reader(),parts=records(),padding=' '.repeat(2000),large=Buffer.from(padding+JSON.stringify(parts.begin)+'\n'+padding+JSON.stringify(parts.final)+'\n');
  assert.ok(large.length>4104&&large.length<=8192);r.feed(frame(1,large));assert.equal(r.end().final.reason,'NORMAL');
  const header=Buffer.alloc(8);header[0]=1;header.writeUInt32BE(8193,4);
  for(const bad of [header,Buffer.from([3,0,0,0,0,0,0,0]),Buffer.from([1,1,0,0,0,0,0,0])]){const x=reader();assert.throws(()=>x.feed(bad));assert.equal(x.status().failed,true);assert.equal(x.snapshot().state,'FAILED');assert.throws(()=>x.feed(frame(1,parts.bytes)));}
  for(const bytes of [Buffer.from([1]),frame(1,parts.bytes).subarray(0,-1)]){const x=reader();x.feed(bytes);assert.throws(()=>x.end());assert.throws(()=>x.feed(Buffer.alloc(0)));}
  const stderr=reader();assert.throws(()=>stderr.feed(frame(2,Buffer.alloc(4097))));
  const many=reader();assert.throws(()=>many.feed(Buffer.concat(Array.from({length:257},()=>frame(2,Buffer.alloc(0))))));
});

test('missing FINAL, wrong nonce, trailing data and expected termination never become normal completion',()=>{
  const parts=records();const x=reader();x.feed(frame(1,Buffer.from(JSON.stringify(parts.begin)+'\n')));assert.equal(x.snapshot().state,'BEGIN_ONLY');assert.throws(()=>x.end());assert.equal(x.snapshot().final,null);
  for(const bytes of [Buffer.from(JSON.stringify({...parts.begin,nonce:'0'.repeat(64)})+'\n'),Buffer.concat([parts.bytes,Buffer.from('x')])]){const y=reader();assert.throws(()=>y.feed(frame(1,bytes)));assert.equal(y.status().failed,true);}
  for(const mode of ['MEMORY_OOM','CPU_DEADLINE']){const y=reader(mode),begin={...parts.begin,mode},final={...parts.final,mode};assert.throws(()=>y.feed(frame(1,Buffer.from(JSON.stringify(begin)+'\n'+JSON.stringify(final)+'\n'))));assert.equal(y.status().failed,true);}
});
