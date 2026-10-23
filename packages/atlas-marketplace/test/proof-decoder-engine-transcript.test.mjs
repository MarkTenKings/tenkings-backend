import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {reviewProofDecoderEngineTranscript} from '../src/proof-decoder-engine-transcript.mjs';
import {encodeProofDecoderWorkerRequest,encodeProofDecoderWorkerResult} from '../src/proof-decoder-worker-protocol.mjs';
import {PROOF_DECODER_VERSION} from '../src/proof-decoder-protocol.mjs';
import {syntheticEngineContext,syntheticEngineHeaders,syntheticUpgradeHeaders,syntheticContainerInspect,syntheticDockerFrame} from './proof-decoder-engine-fixtures.mjs';

// Invented bytes/reports only: these tests do not run a decoder or an Engine.
function scenario({outcome='SUCCESS',head=Buffer.alloc(0)}={}) {
  const context=syntheticEngineContext({created:false}),createdContext={...context,job:{...context.job,containerId:'9'.repeat(64)}};
  const bytes=Buffer.from('invented photo bytes'),original={byteCount:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),declaredType:'image/png'};
  const input=encodeProofDecoderWorkerRequest({requestId:context.job.requestId,plan:original,limits:context.plan.profile.limits,limitsHash:context.plan.limitsHash},bytes);
  const result={requestId:context.job.requestId,outcome,validation:outcome==='SUCCESS'?{schema:'atlas-marketplace-proof-image-v1',decoder:PROOF_DECODER_VERSION,byteCount:original.byteCount,sha256:original.sha256,contentType:original.declaredType,width:1,height:1}:null};
  const output=syntheticDockerFrame(1,encodeProofDecoderWorkerResult(result));
  const request=operation=>({type:'REQUEST',operation});
  const response=(operation,value,statusCode=200,extra={})=>({type:'RESPONSE',operation,statusCode,headers:syntheticEngineHeaders(),body:value===null?Buffer.alloc(0):Buffer.from(JSON.stringify(value)),upgradeHead:Buffer.alloc(0),...extra});
  const running=syntheticContainerInspect(createdContext),created=structuredClone(running);
  created.State={...created.State,Status:'created',Running:false,Pid:0,StartedAt:'0001-01-01T00:00:00Z'};
  const image={Id:running.Image,Os:'linux',Architecture:'amd64',RepoDigests:[context.plan.profile.image],Config:{Env:[],Volumes:null}};
  const events=[request('IMAGE_INSPECT'),response('IMAGE_INSPECT',image),request('CREATE'),response('CREATE',{Id:createdContext.job.containerId,Warnings:[]},201),request('INSPECT'),response('INSPECT',created),request('ATTACH'),response('ATTACH',null,101,{headers:syntheticUpgradeHeaders(),upgradeHead:head}),request('START'),response('START',null,204),request('INSPECT'),response('INSPECT',running),request('WAIT'),{type:'INPUT',bytes:input},{type:'INPUT_EOF'},{type:'OUTPUT',bytes:output},{type:'OUTPUT_EOF'},response('WAIT',{StatusCode:outcome==='DECODER_FAILURE'?2:0,Error:null})];
  const review=(supplied=events)=>reviewProofDecoderEngineTranscript({plan:context.plan,job:context.job,original,seccompBytes:context.seccompBytes,events:supplied.map((event,i)=>({atMs:i,epoch:context.job.epoch,...event}))});
  return {context,original,input,output,result,events,review,request,response,running,created};
}
function held(result,code){
  assert.equal(result.reviewStatus,'RECONCILIATION_REQUIRED');if(code)assert.equal(result.refusal,code);
  assert.equal(result.executionAllowed,false);assert.equal(result.capacityHeld,true);assert.equal(result.cleanup,'UNKNOWN');assert.equal(result.freshPublicationAllowed,false);
}

test('complete synthetic success and invalid-image reports never grant cleanup or publication',()=>{
  for(const outcome of ['SUCCESS','INVALID_IMAGE','DECODER_FAILURE']){
    const s=scenario({outcome}),result=s.review();
    assert.equal(result.reviewStatus,'DECODE_REPORTED_CLEANUP_UNVERIFIED');assert.equal(result.reportedOutcome,outcome);
    assert.equal(result.reportedExitCode,outcome==='DECODER_FAILURE'?2:0);assert.equal(result.inputBytes,s.original.byteCount);assert.equal(result.inputClosed,true);assert.equal(result.outputClosed,true);
    assert.equal(result.terminalReported,true);assert.equal(result.cleanup,'UNKNOWN');assert.equal(result.capacityHeld,true);assert.equal(result.executionAllowed,false);assert.equal(result.freshPublicationAllowed,false);
    assert.equal(result.classification,'UNQUALIFIED');assert.equal(Object.isFrozen(result.requiredAuthority),true);
    assert.ok(!JSON.stringify(result).includes('SYNTHETIC_SECRET'));assert.ok(!JSON.stringify(result).includes('invented photo bytes'));
  }
});

test('input half-close and output EOF are separate mandatory transcript boundaries',()=>{
  const s=scenario();
  assert.equal(s.review(s.events.slice(0,15)).reviewStatus,'INCOMPLETE');
  assert.equal(s.review(s.events.filter(event=>event.type!=='OUTPUT_EOF')).reviewStatus,'INCOMPLETE');
  assert.equal(s.review(s.events.slice(0,-1)).reviewStatus,'INCOMPLETE');
  held(s.review(s.events.filter(event=>event.type!=='INPUT_EOF')),'ENGINE_TRANSCRIPT_OUTCOME');
  held(s.review([...s.events.slice(0,14),s.events[15],s.events[14],...s.events.slice(16)]),'ENGINE_TRANSCRIPT_OUTCOME');
  held(s.review([...s.events.slice(0,15),{type:'INPUT_EOF'},...s.events.slice(15)]),'ENGINE_TRANSCRIPT_INPUT');
});

test('buffered upgrade head is consumed once and byte-fragmented streams preserve exact original binding',()=>{
  const stderr=syntheticDockerFrame(2,Buffer.from('SYNTHETIC_SECRET_DIAGNOSTIC'));
  const s=scenario({head:stderr.subarray(0,5)});
  const events=[...s.events.slice(0,13),...Array.from(s.input,byte=>({type:'INPUT',bytes:Buffer.from([byte])})),s.events[14],{type:'OUTPUT',bytes:stderr.subarray(5)},...Array.from(s.output,byte=>({type:'OUTPUT',bytes:Buffer.from([byte])})),...s.events.slice(16)];
  // Keep the deliberately bounded event grammar; input fragment boundaries are arbitrary.
  const fragments=[...s.events.slice(0,13),{type:'INPUT',bytes:s.input.subarray(0,3)},{type:'INPUT',bytes:s.input.subarray(3,100)},{type:'INPUT',bytes:s.input.subarray(100)},s.events[14],{type:'OUTPUT',bytes:stderr.subarray(5)},...Array.from(s.output,byte=>({type:'OUTPUT',bytes:Buffer.from([byte])})),...s.events.slice(16)];
  assert.ok(events.length>512);assert.throws(()=>s.review(events));
  const result=s.review(fragments);assert.equal(result.reviewStatus,'DECODE_REPORTED_CLEANUP_UNVERIFIED');assert.equal(result.streamSummary.frames,2);
  assert.ok(!JSON.stringify(result).includes('SYNTHETIC_SECRET'));
  const duplicate=[...fragments];duplicate.splice(13,0,{type:'OUTPUT',bytes:stderr.subarray(0,5)});held(s.review(duplicate));
});

test('observed start is mandatory before wait or input, and identity inspection precedes attachment',()=>{
  const s=scenario();
  for(const cut of [0,2,4,6,8,10])held(s.review([...s.events.slice(0,cut),s.request('WAIT')]));
  held(s.review([...s.events.slice(0,4),s.request('ATTACH')]));
  held(s.review([...s.events.slice(0,6),s.request('START')]));
  held(s.review([...s.events.slice(0,10),s.events[13]]));
  held(s.review([...s.events.slice(0,3),s.request('LOOKUP'),s.response('LOOKUP',s.created)]));
  const wrong=structuredClone(s.created);wrong.Id='a'.repeat(64);
  held(s.review([...s.events.slice(0,5),s.response('INSPECT',wrong),...s.events.slice(6)]));
});

test('lost replies and daemon failure stop review without accepting later replay or cleanup claims',()=>{
  for(const [operation,at] of [['CREATE',3],['ATTACH',7],['START',9],['WAIT',13],['WATCHDOG',15],['REGISTRY',15],['ADMISSION',15]]){
    const s=scenario(),result=s.review([...s.events.slice(0,at),{type:'UNCERTAIN',operation},...s.events]);
    held(result,'ENGINE_TRANSCRIPT_UNCERTAIN');assert.equal(result.processedEvents,at+1);assert.ok(result.unprocessedEvents>0);
  }
  const s=scenario();
  for(const statusCode of [404,500])held(s.review([...s.events.slice(0,5),s.response('INSPECT',{message:'SYNTHETIC_SECRET'},statusCode),...s.events.slice(6)]),'ENGINE_TRANSCRIPT_UNCERTAIN');
  for(const event of [{type:'CLEANUP_CLAIM'},s.request('KILL'),s.request('REMOVE')])held(s.review([...s.events,event]),'ENGINE_TRANSCRIPT_CLEANUP_UNVERIFIED');
  held(s.review([...s.events.slice(0,3),s.request('CREATE')]));
});

test('late and stale-epoch events refuse before accepting a result',()=>{
  const s=scenario();
  for(const atMs of [-1,1.5,s.context.plan.profile.limits.timeoutMs,Number.MAX_SAFE_INTEGER])held(s.review([...s.events.slice(0,15),{...s.events[15],atMs},...s.events.slice(16)]),'ENGINE_TRANSCRIPT_DEADLINE');
  held(s.review([...s.events.slice(0,15),{...s.events[15],atMs:2},...s.events.slice(16)]),'ENGINE_TRANSCRIPT_DEADLINE');
  held(s.review([...s.events.slice(0,15),{...s.events[15],epoch:'STALE_EPOCH'},...s.events.slice(16)]),'ENGINE_TRANSCRIPT_EPOCH');
});

test('input header, original digest, byte count and worker-result binding are all required',()=>{
  const s=scenario();
  for(const bytes of [Buffer.from('bad'),Buffer.concat([s.input,Buffer.from('x')]),Buffer.concat([s.input.subarray(0,-1),Buffer.from('x')]),s.input.subarray(0,-1)])held(s.review([...s.events.slice(0,13),{type:'INPUT',bytes},...s.events.slice(14)]),'ENGINE_TRANSCRIPT_INPUT');
  for(const change of [v=>v.requestId='00000000-0000-4000-8000-000000000004',v=>v.validation.sha256='a'.repeat(64),v=>v.validation.byteCount++,v=>v.validation.contentType='image/jpeg']){
    const result=structuredClone(s.result);change(result);const bytes=syntheticDockerFrame(1,encodeProofDecoderWorkerResult(result));
    held(s.review([...s.events.slice(0,15),{type:'OUTPUT',bytes},...s.events.slice(16)]));
  }
});

test('malformed/trailing PDW1, truncated multiplex and stderr overflow remain operational holds',()=>{
  const s=scenario();
  for(const bytes of [syntheticDockerFrame(1,Buffer.from('WRONGMAGIC')),Buffer.concat([s.output,syntheticDockerFrame(1,Buffer.from('x'))]),s.output.subarray(0,-1),syntheticDockerFrame(2,Buffer.alloc(4097))])held(s.review([...s.events.slice(0,15),{type:'OUTPUT',bytes},...s.events.slice(16)]));
  const bad=s.events.map(event=>({...event}));bad[7]={...bad[7],statusCode:200};held(s.review(bad));
});

test('terminal wait or exited inspection forbids later input and running reports but permits buffered drain',()=>{
  const s=scenario(),exited=structuredClone(s.running);exited.State={...exited.State,Status:'exited',Running:false,Pid:0,FinishedAt:'2026-10-23T00:00:01Z'};
  const terminalCases=[[s.events[17]],[s.request('INSPECT'),s.response('INSPECT',exited)]];
  for(const terminal of terminalCases){
    held(s.review([...s.events.slice(0,13),...terminal,...s.events.slice(13,17)]));
    held(s.review([...s.events.slice(0,14),...terminal,...s.events.slice(14,17)]));
    held(s.review([...s.events.slice(0,15),...terminal,s.request('INSPECT'),s.response('INSPECT',s.running)]));
  }
  assert.equal(s.review([...s.events.slice(0,15),s.events[17],...s.events.slice(15,17)]).reviewStatus,'DECODE_REPORTED_CLEANUP_UNVERIFIED');
  const failed=scenario({outcome:'DECODER_FAILURE'});
  const withoutInput=[...failed.events.slice(0,13),failed.events[17],...failed.events.slice(15,17)];
  const result=failed.review(withoutInput);assert.equal(result.reportedOutcome,'DECODER_FAILURE');assert.equal(result.reviewStatus,'DECODE_REPORTED_CLEANUP_UNVERIFIED');assert.equal(result.inputClosed,false);
});

test('a stream that reports output or completion before launch cannot then authorize start',()=>{
  const s=scenario({outcome:'DECODER_FAILURE'});
  held(s.review([...s.events.slice(0,8),s.events[15],s.events[16],...s.events.slice(8,13),s.events[17]]));
  held(s.review([...s.events.slice(0,8),s.events[15],...s.events.slice(8)]));
});

test('stdout record prefixes before input EOF or start cannot hide behind later payload completion',()=>{
  const s=scenario();
  for(const size of [1,7,8,10,s.output.length-1]){
    held(s.review([...s.events.slice(0,14),{type:'OUTPUT',bytes:s.output.subarray(0,size)},s.events[14],{type:'OUTPUT',bytes:s.output.subarray(size)},...s.events.slice(16)]),'ENGINE_TRANSCRIPT_OUTCOME');
    const early=scenario({head:s.output.subarray(0,size)});
    held(early.review([...early.events.slice(0,15),{type:'OUTPUT',bytes:s.output.subarray(size)},...early.events.slice(16)]));
  }
});

test('state contradictions, restart identity changes and inconsistent exit status refuse',()=>{
  const s=scenario();
  for(const change of [v=>v.State.Pid++,v=>v.State.StartedAt='2026-10-23T00:00:02Z',v=>v.State.FinishedAt='2026-10-23T00:00:02Z',v=>v.State.ExitCode=2,v=>v.State.OOMKilled=true]){
    const report=structuredClone(s.running);change(report);
    held(s.review([...s.events.slice(0,13),s.request('INSPECT'),s.response('INSPECT',report),...s.events.slice(13)]));
  }
  const exited=structuredClone(s.running);exited.State={...exited.State,Status:'exited',Running:false,Pid:0,ExitCode:2,FinishedAt:'2026-10-23T00:00:01Z'};
  held(s.review([...s.events.slice(0,15),s.request('INSPECT'),s.response('INSPECT',exited),...s.events.slice(15)]),'ENGINE_TRANSCRIPT_OUTCOME');
  held(s.review([...s.events.slice(0,-1),s.response('WAIT',{StatusCode:137,Error:null})]),'ENGINE_TRANSCRIPT_OUTCOME');
});

test('closed event grammar refuses getters, coercion, sparse arrays and caller additions',()=>{
  const s=scenario();let calls=0;
  const coercion={type:{[Symbol.toPrimitive](){calls++;return 'CLEANUP_CLAIM';}}};held(s.review([coercion]));assert.equal(calls,0);
  const event={atMs:0,epoch:s.context.job.epoch};Object.defineProperty(event,'type',{enumerable:true,get(){calls++;return 'CLEANUP_CLAIM';}});
  const input={plan:s.context.plan,job:s.context.job,original:s.original,seccompBytes:s.context.seccompBytes};
  held(reviewProofDecoderEngineTranscript({...input,events:[event]}));assert.equal(calls,0);
  const sparse=new Array(1);assert.throws(()=>reviewProofDecoderEngineTranscript({...input,events:sparse}));
  assert.throws(()=>reviewProofDecoderEngineTranscript({...input,events:[],execute:true}));
  held(s.review([{...s.request('IMAGE_INSPECT'),endpoint:'/containers/json'}]));
});
