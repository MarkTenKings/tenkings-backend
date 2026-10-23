import test from 'node:test';
import assert from 'node:assert/strict';
import {projectProofDecoderEngineResponse,assertProofDecoderEngineUpgrade,createProofDecoderEngineMultiplexReader} from '../src/proof-decoder-engine-response.mjs';
import {parseProofDecoderEngineJSON} from '../src/proof-decoder-engine-json.mjs';
import {createProofDecoderWorkerResultReader,encodeProofDecoderWorkerResult} from '../src/proof-decoder-worker-protocol.mjs';
import {syntheticEngineContext,syntheticEngineHeaders,syntheticUpgradeHeaders,syntheticContainerInspect,syntheticDockerFrame} from './proof-decoder-engine-fixtures.mjs';

function project(operation,value,{context=syntheticEngineContext({created:operation!=='CREATE'}),statusCode=operation==='CREATE'?201:200,headers=syntheticEngineHeaders(),body=Buffer.from(JSON.stringify(value))}={}){const {seccompBytes,...input}=context;return projectProofDecoderEngineResponse({...input,operation,statusCode,headers,body});}
const reader=options=>createProofDecoderEngineMultiplexReader({onStdout:()=>{},onStderr:()=>{},...options});

test('bounded Engine JSON accepts ordinary ordering/whitespace but rejects ambiguity and unsafe structures',()=>{
  assert.deepEqual(parseProofDecoderEngineJSON(Buffer.from(' { "b" : [true,null], "a" : 1 } ')),{b:[true,null],a:1});
  const invalid=['{"a":1,"a":2}','{"a":1,"\\u0061":2}','{"__proto__":{}}','{"x":01}','{"x":1e999}','{}{}','[1,]','{"a":1,}','[', '['.repeat(14)+'0'+']'.repeat(14),JSON.stringify(Array(16384).fill(0))];
  for(const text of invalid)assert.throws(()=>parseProofDecoderEngineJSON(Buffer.from(text)),{code:'DECODER_ENGINE_JSON_INVALID'});
  for(const bytes of [Buffer.from([0xc3,0x28]),Buffer.from('\ufeff{}'),Buffer.alloc(262145)])assert.throws(()=>parseProofDecoderEngineJSON(bytes));
});
test('inspect projects required owned identity and complete state while discarding secret-bearing extras',()=>{
  const context=syntheticEngineContext(),raw=syntheticContainerInspect(context);raw.BenignFutureField={anything:true};
  const result=project('INSPECT',raw,{context});assert.equal(result.kind,'CONTAINER_REPORTED');assert.equal(result.executionAllowed,false);assert.equal(result.data.state.running,true);assert.equal(result.data.state.pid,123);
  assert.deepEqual(Object.keys(result.data.state).sort(),['status','running','paused','restarting','dead','oomKilled','pid','exitCode','startedAt','finishedAt'].sort());
  assert.ok(!JSON.stringify(result).includes('SYNTHETIC_SECRET'));assert.ok(!JSON.stringify(result).includes('Env'));assert.ok(!JSON.stringify(result).includes('BenignFutureField'));
  for(const change of [value=>value.Id='a'.repeat(64),value=>value.Config.Labels['atlas.proof.nonce']='b'.repeat(64),value=>value.Name='/foreign',value=>delete value.State.OOMKilled,value=>value.State.Pid='123',value=>value.State.StartedAt='not-a-date',value=>value.State.StartedAt='2026-02-30T00:00:00Z']){const value=structuredClone(raw);change(value);assert.throws(()=>project('INSPECT',value,{context}));}
  const fresh={...context,job:{...context.job,containerId:null}};assert.equal(project('LOOKUP',raw,{context:fresh}).data.containerId,raw.Id);
});
test('create, image, wait and failure reports never claim cleanup or verified absence',()=>{
  assert.equal(project('CREATE',{Id:'9'.repeat(64),Warnings:['SYNTHETIC_SECRET_WARNING']}).data.warningCount,1);
  const context=syntheticEngineContext(),image={Id:'sha256:'+'7'.repeat(64),Os:'linux',Architecture:'amd64',RepoDigests:[context.plan.profile.image],Config:{Env:[],Volumes:null},Extra:'allowed'};
  assert.equal(project('IMAGE_INSPECT',image,{context}).kind,'IMAGE_REPORTED');
  image.Config.Env=['SYNTHETIC_SECRET=fixture'];assert.throws(()=>project('IMAGE_INSPECT',image,{context}));
  assert.deepEqual(project('WAIT',{StatusCode:0,Error:null}).data,{exitCode:0});
  assert.equal(project('WAIT',{StatusCode:0,Error:{Message:'SYNTHETIC_SECRET_ERROR'}}).kind,'ENGINE_ERROR_REPORTED');
  for(const operation of ['START','KILL','REMOVE'])assert.equal(project(operation,null,{statusCode:204,body:Buffer.alloc(0)}).kind,`${operation}_REPORTED`);
  for(const statusCode of [400,404,409,500]){const result=project('INSPECT',{message:'SYNTHETIC_SECRET_BODY'},{statusCode});assert.equal(result.kind,statusCode===404?'NOT_FOUND_REPORTED':'ENGINE_ERROR_REPORTED');assert.equal(result.data,null);assert.ok(!JSON.stringify(result).includes('SYNTHETIC_SECRET'));assert.equal(result.classification,'UNQUALIFIED');}
  assert.equal(project('START',null,{statusCode:304,body:Buffer.alloc(0)}).kind,'ENGINE_ERROR_REPORTED');
  for(const statusCode of [200,202,301,503])assert.throws(()=>project('START',null,{statusCode,body:Buffer.alloc(0)}));
});
test('API1.47 nonTTY upgrade requires101 and multiplexed-stream; hijack head must remain separate',()=>{
  const input={statusCode:101,headers:syntheticUpgradeHeaders(),body:Buffer.alloc(0)};assert.equal(assertProofDecoderEngineUpgrade(input),true);
  assert.equal(project('ATTACH',null,input).kind,'ATTACH_UPGRADE_REPORTED');
  for(const override of [{statusCode:200},{body:Buffer.from([1])},{headers:{...input.headers,'content-type':'application/vnd.docker.raw-stream'}},{headers:{...input.headers,upgrade:'websocket'}},{headers:{...input.headers,connection:'close'}},{headers:{...input.headers,'transfer-encoding':'chunked'}},{headers:{...input.headers,Upgrade:'tcp'}},{headers:{...input.headers,upgrade:undefined}}])assert.throws(()=>assertProofDecoderEngineUpgrade({...input,...override}));
});
test('multiplexer handles byte fragmentation, independent streams and explicit EOF with bounded buffers',()=>{
  const stdout=[],stderr=[],mux=reader({onStdout:bytes=>stdout.push(bytes),onStderr:bytes=>stderr.push(bytes)});
  const bytes=Buffer.concat([syntheticDockerFrame(1,Buffer.from('PD')),syntheticDockerFrame(2,Buffer.from('diagnostic')),syntheticDockerFrame(1,Buffer.from('W1')),syntheticDockerFrame(1,Buffer.alloc(0))]);
  for(const byte of bytes){mux.feed(Buffer.from([byte]));assert.ok(mux.status().allocatedBytes<=4112);}
  assert.equal(Buffer.concat(stdout).toString(),'PDW1');assert.equal(Buffer.concat(stderr).toString(),'diagnostic');assert.equal(mux.end().frames,4);assert.equal(mux.status().ended,true);assert.throws(()=>mux.feed(Buffer.alloc(0)));
});
test('malformed stream headers, excessive records, truncation and channel overflow poison the reader',()=>{
  const invalid=[];for(const stream of [0,3,255])invalid.push(syntheticDockerFrame(stream,Buffer.from('x')));
  const reserved=syntheticDockerFrame(1,Buffer.from('x'));reserved[1]=1;invalid.push(reserved);
  invalid.push(syntheticDockerFrame(1,Buffer.alloc(4105)),syntheticDockerFrame(2,Buffer.alloc(4097)));
  for(const bytes of invalid){const mux=reader();assert.throws(()=>mux.feed(bytes));assert.equal(mux.status().failed,true);assert.throws(()=>mux.end());assert.throws(()=>mux.feed(syntheticDockerFrame(1,Buffer.from('x'))));}
  const zero=reader({maxFrames:2});assert.throws(()=>zero.feed(Buffer.concat(Array(3).fill(syntheticDockerFrame(1,Buffer.alloc(0))))));
  for(const bytes of [Buffer.from([1]),syntheticDockerFrame(1,Buffer.from('xx')).subarray(0,9)]){const mux=reader();mux.feed(bytes);assert.throws(()=>mux.end());assert.equal(mux.status().failed,true);}
  const accumulated=reader({stderrLimit:3});accumulated.feed(syntheticDockerFrame(2,Buffer.from('xx')));assert.throws(()=>accumulated.feed(syntheticDockerFrame(2,Buffer.from('xx'))));
  const callback=reader({onStdout:()=>{throw Error('SYNTHETIC_SECRET_ERROR');}});assert.throws(()=>callback.feed(syntheticDockerFrame(1,Buffer.from('x'))),error=>error.message==='DECODER_ENGINE_RESPONSE_INVALID');
});
test('demultiplexed PDW1 requires its exact terminal EOF; trailing and malformed output refuse',()=>{
  const context=syntheticEngineContext(),wire=encodeProofDecoderWorkerResult({requestId:context.job.requestId,outcome:'INVALID_IMAGE',validation:null});
  const worker=createProofDecoderWorkerResultReader(),mux=reader({onStdout:bytes=>worker.feed(bytes)});mux.feed(syntheticDockerFrame(1,wire));assert.equal(worker.status().ended,false);mux.end();assert.equal(worker.end().outcome,'INVALID_IMAGE');
  const trailing=createProofDecoderWorkerResultReader(),bad=reader({onStdout:bytes=>trailing.feed(bytes)});bad.feed(syntheticDockerFrame(1,wire));assert.throws(()=>bad.feed(syntheticDockerFrame(1,Buffer.from('x'))));
  const malformed=createProofDecoderWorkerResultReader(),badMagic=reader({onStdout:bytes=>malformed.feed(bytes)});assert.throws(()=>badMagic.feed(syntheticDockerFrame(1,Buffer.from('WRONGMAGIC'))));
  const partial=createProofDecoderWorkerResultReader(),cut=reader({onStdout:bytes=>partial.feed(bytes)});cut.feed(syntheticDockerFrame(1,wire.subarray(0,-1)));cut.end();assert.throws(()=>partial.end());
});
test('multiplexer refuses explicit null limits and cannot resume through reentrant callbacks',()=>{
  for(const key of ['stdoutLimit','stderrLimit','maxFrames'])assert.throws(()=>reader({[key]:null}));
  let mux;mux=reader({onStdout:()=>{try{mux.end();}catch{}}});assert.throws(()=>mux.feed(syntheticDockerFrame(1,Buffer.from('x'))));assert.equal(mux.status().failed,true);
  let disposed;disposed=reader({onStdout:()=>disposed.dispose()});assert.throws(()=>disposed.feed(syntheticDockerFrame(1,Buffer.from('x'))));assert.equal(disposed.status().disposed,true);
});
test('stdout arrival is visible at the first record byte before fragmented header or payload completion',()=>{
  const delivered=[],mux=reader({onStdout:bytes=>delivered.push(bytes)}),frame=syntheticDockerFrame(1,Buffer.from('PDW1'));
  assert.equal(mux.status().stdoutStarted,false);
  mux.feed(syntheticDockerFrame(2,Buffer.from('diagnostic')));assert.equal(mux.status().stdoutStarted,false);
  mux.feed(frame.subarray(0,1));assert.equal(mux.status().stdoutStarted,true);assert.equal(mux.status().stdoutBytes,0);assert.equal(delivered.length,0);
  for(let at=1;at<frame.length-1;at++){mux.feed(frame.subarray(at,at+1));assert.equal(mux.status().stdoutStarted,true);assert.equal(delivered.length,0);}
  mux.feed(frame.subarray(-1));assert.equal(Buffer.concat(delivered).toString(),'PDW1');mux.end();assert.equal(mux.status().stdoutStarted,true);
  const empty=reader();empty.feed(Buffer.from([1]));assert.equal(empty.status().stdoutStarted,true);assert.throws(()=>empty.end());
});
