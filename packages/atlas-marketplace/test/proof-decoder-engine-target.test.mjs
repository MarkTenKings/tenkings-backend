import test from 'node:test';
import {assertProofDecoderEngineTargetSocketPath,createProofDecoderEngineTargetEndpoint} from '../src/proof-decoder-engine-target-endpoint.mjs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createProofDecoderFixedParentBinding,assertProofDecoderFixedParentBinding,assertProofDecoderFixedParentReport} from '../src/proof-decoder-engine-target-binding.mjs';
import {compileProofDecoderEngineRequest} from '../src/proof-decoder-engine-request.mjs';
import {reviewProofDecoderEngineTranscript} from '../src/proof-decoder-engine-transcript.mjs';
import {syntheticEngineContext,syntheticContainerInspect,syntheticEngineHeaders} from './proof-decoder-engine-fixtures.mjs';
import {createProofDecoderTargetEngineExecutor} from '../src/proof-decoder-engine-target-executor.mjs';
import {createProofDecoderOwnedEngineCleanup,createProofDecoderTargetEffectSession,assertProofDecoderEngineEffectReceipt,assertProofDecoderEngineExitObservation,assertProofDecoderOwnedEngineCleanupReceipt} from '../src/proof-decoder-engine-owned-cleanup.mjs';

test('target endpoint refuses arbitrary paths and substitute observers without opening a socket',()=>{
  assert.equal(createProofDecoderEngineTargetEndpoint(),null);
  assert.equal(assertProofDecoderEngineTargetSocketPath('/run/docker.sock'),'/run/docker.sock');
  let calls=0;const fake={capture(){calls++;},boottimeNanoseconds(){calls++;}};
  for(const socketPath of ['/tmp/synthetic.sock','/var/run/docker.sock','/run/./docker.sock','/run/docker.sock/','/run/other.sock','',null]){
    assert.throws(()=>assertProofDecoderEngineTargetSocketPath(socketPath));
    assert.throws(()=>createProofDecoderEngineTargetEndpoint({enabled:true,socketPath,linuxObserver:fake}));
  }
  assert.throws(()=>createProofDecoderEngineTargetEndpoint({enabled:true,socketPath:'/run/docker.sock',linuxObserver:fake}));
  assert.equal(calls,0);
});

// Pure grammar only: this encoding token is deliberately no runtime permit.
test('fixed parent encoding is default off, sealed and admits no parent override',()=>{
  assert.equal(createProofDecoderFixedParentBinding(),null);
  const c=syntheticEngineContext({created:false}),binding=createProofDecoderFixedParentBinding({enabled:true,plan:c.plan});
  assert.equal(binding.cgroupParent,'atlasdecoder.slice');assert.equal(binding.executionAllowed,false);
  assert.equal(assertProofDecoderFixedParentBinding(binding,{plan:c.plan}),binding);
  assert.throws(()=>assertProofDecoderFixedParentBinding({...binding},{plan:c.plan}));
  assert.throws(()=>createProofDecoderFixedParentBinding({enabled:true,plan:c.plan,cgroupParent:'system.slice'}));
  assert.throws(()=>assertProofDecoderFixedParentBinding(binding,{plan:{...c.plan,profileHash:'0'.repeat(64)}}));
});

test('target runtime factories default off and reject substitute controllers before invoking callbacks',()=>{
  const c=syntheticEngineContext(),targetBinding=createProofDecoderFixedParentBinding({enabled:true,plan:c.plan});let calls=0;
  const fake=Object.freeze({status(){calls++;return {};},boottimeNanoseconds(){calls++;return 1n;},freezeAndKill(){calls++;}});
  for(const factory of [createProofDecoderTargetEngineExecutor,createProofDecoderOwnedEngineCleanup,createProofDecoderTargetEffectSession]){
    assert.equal(factory(),null);
    assert.throws(()=>factory({enabled:true,plan:c.plan,targetBinding,parentController:fake,targetRegistry:{},socketPath:'/tmp/not-opened.sock',apiVersion:'1.47'}));
  }
  assert.equal(calls,0);
});

test('target receipt brands never revive from JSON, clone, freeze or claimed observation markers',()=>{
  const c=syntheticEngineContext(),bindingHash='1'.repeat(64),barrierId=c.job.jobId;
  const fake=Object.freeze({classification:'UNQUALIFIED',evidenceOrigin:'ENGINE_SOCKET_REPORT',identity:c.job,bindingHash,barrierId,
    operation:'REMOVE',operationId:c.job.requestId,requestHash:'2'.repeat(64),containerId:c.job.containerId,status:204,
    settled:true,absentAfterRemove:true,observedAtNs:'123',lastRemoveAtNs:'122'});
  for(const receipt of [fake,JSON.parse(JSON.stringify(fake)),{},null]){
    assert.throws(()=>assertProofDecoderEngineEffectReceipt(receipt,{identity:c.job,operation:'REMOVE',operationId:c.job.requestId,requestHash:'2'.repeat(64),bindingHash}));
    assert.throws(()=>assertProofDecoderEngineExitObservation(receipt,{identity:c.job,bindingHash,barrierId}));
    assert.throws(()=>assertProofDecoderOwnedEngineCleanupReceipt(receipt,{identity:c.job,bindingHash,barrierId}));
  }
});

test('target CREATE changes only fixed CgroupParent and hashes its actual body',()=>{
  const c=syntheticEngineContext({created:false}),targetBinding=createProofDecoderFixedParentBinding({enabled:true,plan:c.plan});
  const baseline=compileProofDecoderEngineRequest({...c,operation:'CREATE'});
  const actual=compileProofDecoderEngineRequest({...c,operation:'CREATE',targetBinding});
  const expected=JSON.parse(baseline.http.body),body=JSON.parse(actual.http.body);
  assert.equal(Object.hasOwn(expected.HostConfig,'CgroupParent'),false);
  expected.HostConfig.CgroupParent='atlasdecoder.slice';assert.deepEqual(body,expected);
  assert.notEqual(actual.bodySha256,baseline.bodySha256);
  assert.equal(actual.bodySha256,createHash('sha256').update(actual.http.body).digest('hex'));
  const original={byteCount:1,sha256:'1'.repeat(64),declaredType:'image/png'};
  const review=reviewProofDecoderEngineTranscript({plan:c.plan,job:c.job,original,seccompBytes:c.seccompBytes,events:[],targetBinding});
  assert.equal(review.createRequestHash,actual.bodySha256);assert.equal(review.capacityHeld,true);
  assert.throws(()=>compileProofDecoderEngineRequest({...c,operation:'CREATE',targetBinding:{...targetBinding}}));
});

test('target parent report check refuses absent, foreign or malformed parent without exposing raw fields',()=>{
  const c=syntheticEngineContext(),targetBinding=createProofDecoderFixedParentBinding({enabled:true,plan:c.plan});
  const value=syntheticContainerInspect(c);value.HostConfig={CgroupParent:'atlasdecoder.slice'};
  const check=body=>assertProofDecoderFixedParentReport({body:Buffer.from(JSON.stringify(body)),targetBinding,plan:c.plan});
  assert.equal(check(value),true);
  for(const HostConfig of [undefined,null,[],{}, {CgroupParent:'system.slice'}, {CgroupParent:'atlasdecoder.slice/other'}]){
    assert.throws(()=>check({...value,HostConfig}),error=>!error.message.includes('SYNTHETIC_SECRET'));
  }
});

test('target transcript refuses parent mismatch before ATTACH or START',()=>{
  const c=syntheticEngineContext({created:false}),targetBinding=createProofDecoderFixedParentBinding({enabled:true,plan:c.plan});
  const created=syntheticContainerInspect({...c,job:{...c.job,containerId:'9'.repeat(64)}});
  created.State={...created.State,Status:'created',Running:false,Pid:0,StartedAt:'0001-01-01T00:00:00Z'};
  const response=(operation,value,statusCode=200)=>({type:'RESPONSE',operation,statusCode,body:Buffer.from(JSON.stringify(value)),headers:syntheticEngineHeaders(),upgradeHead:Buffer.alloc(0)});
  const original={byteCount:1,sha256:'1'.repeat(64),declaredType:'image/png'};
  for(const parent of ['atlasdecoder.slice','system.slice']){
    created.HostConfig={CgroupParent:parent};
    const events=[{type:'REQUEST',operation:'IMAGE_INSPECT'},response('IMAGE_INSPECT',{Id:created.Image,Os:'linux',Architecture:'amd64',RepoDigests:[c.plan.profile.image],Config:{Env:[],Volumes:null}}),
      {type:'REQUEST',operation:'CREATE'},response('CREATE',{Id:created.Id,Warnings:[]},201),{type:'REQUEST',operation:'INSPECT'},response('INSPECT',created)];
    const review=reviewProofDecoderEngineTranscript({plan:c.plan,job:c.job,original,seccompBytes:c.seccompBytes,targetBinding,events:events.map((event,atMs)=>({...event,atMs,epoch:c.job.epoch}))});
    assert.equal(review.reviewStatus,parent==='atlasdecoder.slice'?'INCOMPLETE':'RECONCILIATION_REQUIRED');
    assert.equal(review.startAttempted,false);assert.equal(review.capacityHeld,true);
  }
});
