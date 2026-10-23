import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {openProofDecoderJobRegistry} from '../src/proof-decoder-job-registry.mjs';
import {createProofDecoderEngineTransport} from '../src/proof-decoder-engine-transport.mjs';
import {createProofDecoderEngineExecutor,assertProofDecoderEngineExecutor} from '../src/proof-decoder-engine-executor.mjs';
import {assertLocalFixtureDecoderExecutor} from '../src/proof-decoder-fixture-executor.mjs';
import {assertProofImageValidator} from '../src/proof-image.mjs';
import {PROOF_DECODER_VERSION} from '../src/proof-decoder-protocol.mjs';
import {createProofDecoderWorkerRequestReader,encodeProofDecoderWorkerResult} from '../src/proof-decoder-worker-protocol.mjs';
import {syntheticEngineContext,syntheticContainerInspect,syntheticDockerFrame} from './proof-decoder-engine-fixtures.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sendJSON=(response,status,value)=>{response.writeHead(status,{'content-type':'application/json'});response.end(JSON.stringify(value));};

// Temporary fake HTTP peer only. It does not run Docker, a worker or an image.
async function scenario(t,{mode='OK',size=32,deadlineMs=3000,headerTimeoutMs=500}={}) {
  const directory=realpathSync(mkdtempSync('/tmp/atlas-wire-')),socketPath=join(directory,'engine.sock');
  const context=syntheticEngineContext({created:false}),bytes=Buffer.alloc(size,65),original={byteCount:size,sha256:sha(bytes),declaredType:'image/png'};
  const registry=openProofDecoderJobRegistry({enabled:true,directory:join(directory,'registry'),plan:context.plan});
  const now=Date.now(),row=registry.reserve({requestId:randomUUID(),epoch:context.job.epoch,requestPlan:original,now,deadlineAt:now+deadlineMs});
  context.job=row.identity;
  const created={...context,job:{...row.identity,containerId:'9'.repeat(64)}};
  const requests=[],connections=new Set(),received=[];let starts=0,finished=false,waiters=[],createBody=null,attachSocket=null;
  const diagnostics=syntheticDockerFrame(2,Buffer.from('SYNTHETIC_DIAGNOSTIC_DO_NOT_EXPOSE'));
  const server=http.createServer(async(request,response)=>{
    requests.push({method:request.method,path:request.url});request.on('error',()=>{});response.on('error',()=>{});
    const path=request.url;
    if(path.startsWith('/v1.47/images/')){
      if(mode==='HEADER_HANG')return;
      if(mode==='BIG_HEADER'){response.setHeader('x-extra','x'.repeat(9000));response.end();return;}
      if(mode==='BIG_BODY'){response.writeHead(200,{'content-type':'application/json'});response.end('x'.repeat(262145));return;}
      sendJSON(response,200,{Id:'sha256:'+'7'.repeat(64),Os:'linux',Architecture:'amd64',RepoDigests:[context.plan.profile.image],Config:{Env:[],Volumes:null}});return;
    }
    if(path.startsWith('/v1.47/containers/create?')){
      const parts=[];for await(const part of request)parts.push(part);createBody=JSON.parse(Buffer.concat(parts).toString());
      if(mode==='LOST_CREATE'){request.socket.destroy();return;}
      sendJSON(response,201,{Id:created.job.containerId,Warnings:[]});return;
    }
    if(path.endsWith('/json')){
      if(mode==='NOT_FOUND'){sendJSON(response,404,{message:'SYNTHETIC_SECRET_DO_NOT_EXPOSE'});return;}
      const value=syntheticContainerInspect(created);
      if(!starts)value.State={...value.State,Status:'created',Running:false,Pid:0,StartedAt:'0001-01-01T00:00:00Z'};
      if(mode==='FOREIGN')value.Config.Labels['atlas.proof.nonce']='0'.repeat(64);
      sendJSON(response,200,value);return;
    }
    if(path.endsWith('/start')){
      starts++;
      if(mode==='LOST_START'){request.socket.destroy();return;}
      response.writeHead(204);response.end();return;
    }
    if(path.endsWith('/wait?condition=not-running')){
      if(finished)sendJSON(response,200,{StatusCode:0,Error:null});else waiters.push(response);return;
    }
    sendJSON(response,500,{message:'unexpected synthetic request'});
  });
  server.on('connection',socket=>{connections.add(socket);socket.on('error',()=>{});socket.on('close',()=>connections.delete(socket));});
  server.on('upgrade',(request,socket,head)=>{
    requests.push({method:request.method,path:request.url});attachSocket=socket;socket.allowHalfOpen=true;
    const prefix=mode==='EARLY_STDOUT'?Buffer.from([1]):diagnostics.subarray(0,5);
    socket.write(Buffer.concat([Buffer.from('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: tcp\r\nContent-Type: application/vnd.docker.multiplexed-stream\r\n\r\n'),prefix]));
    assert.equal(head.length,0);
    if(mode==='PAUSE_INPUT'||mode==='CANCEL_INPUT'){socket.pause();if(mode==='PAUSE_INPUT')setTimeout(()=>socket.resume(),40);}
    socket.on('data',chunk=>received.push(Buffer.from(chunk)));
    socket.on('end',()=>{
      if(mode==='EARLY_STDOUT'||mode==='CANCEL_INPUT'||mode==='NO_RESULT')return;
      const reader=createProofDecoderWorkerRequestReader();reader.feed(Buffer.concat(received));
      const decoded=reader.end();assert.equal(sha(decoded.bytes),original.sha256);assert.equal(decoded.requestId,row.identity.requestId);reader.dispose();
      const frame=syntheticDockerFrame(1,encodeProofDecoderWorkerResult({requestId:row.identity.requestId,outcome:'SUCCESS',validation:{schema:'atlas-marketplace-proof-image-v1',decoder:PROOF_DECODER_VERSION,byteCount:size,sha256:original.sha256,contentType:'image/png',width:1,height:1}}));
      socket.write(Buffer.concat([diagnostics.subarray(5),frame.subarray(0,3)]));
      setImmediate(()=>socket.end(frame.subarray(3)));
      finished=true;for(const waiter of waiters)sendJSON(waiter,200,{StatusCode:0,Error:null});waiters=[];
    });
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve);});
  const executor=createProofDecoderEngineExecutor({enabled:true,plan:context.plan,registry,socketPath,apiVersion:'1.47',epoch:row.identity.epoch,headerTimeoutMs});
  t.after(async()=>{await executor.close();for(const socket of connections)socket.destroy();await new Promise(resolve=>server.close(resolve));registry.close();rmSync(directory,{recursive:true,force:true});});
  return {context,bytes,original,row,registry,executor,requests,socketPath,
    run:signal=>executor.run({jobId:row.identity.jobId,originalBytes:bytes,seccompBytes:context.seccompBytes,signal}),
    inspect:()=>({createBody,starts,finished,receivedBytes:received.reduce((sum,chunk)=>sum+chunk.length,0),attachSocket})};
}

test('default off, separate brands, exact copied original, partial writes and half-close keep capacity held',async t=>{
  assert.equal(createProofDecoderEngineTransport(),null);assert.equal(createProofDecoderEngineExecutor(),null);
  const s=await scenario(t,{mode:'PAUSE_INPUT',size:1024*1024});
  assert.equal(assertProofDecoderEngineExecutor(s.executor,{registry:s.registry,plan:s.context.plan}),s.executor);
  assert.throws(()=>assertLocalFixtureDecoderExecutor(s.executor,{plan:s.context.plan}),{code:'LOCAL_FIXTURE_DECODER_EXECUTOR_REQUIRED'});
  assert.throws(()=>assertProofImageValidator(s.executor),{code:'PROOF_DECODER_UNAVAILABLE'});
  const pending=s.run();s.bytes.fill(90);s.context.seccompBytes.fill(32);const result=await pending;
  assert.equal(result.failure,null);assert.equal(result.review.reviewStatus,'DECODE_REPORTED_CLEANUP_UNVERIFIED');
  assert.equal(result.review.reportedOutcome,'SUCCESS');assert.equal(result.review.inputBytes,1024*1024);
  assert.equal(result.review.streamSummary.frames,2);assert.equal(result.review.streamSummary.stderrBytes,Buffer.byteLength('SYNTHETIC_DIAGNOSTIC_DO_NOT_EXPOSE'));
  assert.ok(result.io.backpressureEvents>0);assert.ok(result.io.localWriteAcceptedBytes>1024*1024);
  assert.equal(result.registryHeld,true);assert.equal(result.heldPhase,'QUARANTINED');assert.equal(s.registry.snapshot().occupiedSlots,1);
  assert.equal(result.freshPublicationAllowed,false);assert.equal(result.cgroupObserved,false);assert.equal(result.cleanup,'UNKNOWN');
  assert.ok(!JSON.stringify(result).includes('SYNTHETIC_SECRET'));assert.ok(!JSON.stringify(result).includes('SYNTHETIC_DIAGNOSTIC'));
  assert.ok(s.inspect().receivedBytes>1024*1024);assert.equal(s.inspect().starts,1);
  assert.equal(s.inspect().createBody.HostConfig.ReadonlyRootfs,true);
  assert.deepEqual(s.requests.map(value=>value.method),['GET','POST','GET','POST','POST','GET','POST']);
  assert.ok(s.requests.every(value=>value.path.startsWith('/v1.47/')));
  assert.throws(()=>s.run(),{code:'ENGINE_EXECUTOR_QUARANTINED'});
});

test('lost create and start replies preserve exact durable intents and never retry',async t=>{
  for(const [mode,phase,containerId] of [['LOST_CREATE','CREATE_INTENT',null],['LOST_START','START_INTENT','9'.repeat(64)]]){
    await t.test(mode,async t=>{
      const s=await scenario(t,{mode}),result=await s.run(),held=s.registry.get(s.row.identity.jobId);
      assert.ok(result.failure);assert.equal(result.registryHeld,true);assert.equal(held.phase,phase);assert.equal(held.identity.containerId,containerId);
      assert.equal(held.identity.ownerNonce,s.row.identity.ownerNonce);assert.deepEqual(held.requestPlan,s.row.requestPlan);
      assert.equal(s.requests.filter(value=>value.path.includes('/create?')).length,1);
      const reopened=createProofDecoderEngineExecutor({enabled:true,plan:s.context.plan,registry:s.registry,socketPath:s.socketPath,apiVersion:'1.47',epoch:s.row.identity.epoch});
      assert.equal(reopened.status().quarantined,true);assert.throws(()=>reopened.run({jobId:s.row.identity.jobId,originalBytes:s.bytes,seccompBytes:s.context.seccompBytes}));await reopened.close();
    });
  }
});

test('foreign identity, 404 and stdout upgrade prefix refuse with no cleanup or start grant',async t=>{
  for(const mode of ['FOREIGN','NOT_FOUND','EARLY_STDOUT'])await t.test(mode,async t=>{
    const s=await scenario(t,{mode}),result=await s.run();assert.ok(result.failure);assert.equal(result.capacityHeld,true);assert.equal(result.cleanup,'UNKNOWN');
    assert.equal(s.inspect().starts,0);assert.equal(s.registry.snapshot().occupiedSlots,1);
    assert.ok(!s.requests.some(value=>/kill|DELETE/.test(value.path)));assert.equal(result.freshPublicationAllowed,false);
  });
});

test('header/body limits and header deadline terminate the owned connection before any create',async t=>{
  for(const mode of ['HEADER_HANG','BIG_HEADER','BIG_BODY'])await t.test(mode,async t=>{
    const s=await scenario(t,{mode,headerTimeoutMs:30}),began=performance.now(),result=await s.run();
    assert.ok(result.failure);assert.ok(performance.now()-began<1000);assert.equal(result.registryHeld,true);
    assert.equal(s.requests.length,1);assert.equal(s.inspect().starts,0);
  });
});

test('cancel while input is backpressured destroys sockets, retains capacity and does not turn into cleanup',async t=>{
  const s=await scenario(t,{mode:'CANCEL_INPUT',size:1024*1024}),controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),100),began=performance.now();
  const result=await s.run(controller.signal);clearTimeout(timer);
  assert.ok(performance.now()-began<1000);assert.ok(result.failure);assert.equal(result.registryHeld,true);assert.equal(result.cleanup,'UNKNOWN');
  assert.equal(s.inspect().starts,1);assert.equal(s.registry.snapshot().occupiedSlots,1);
  assert.ok(!s.requests.some(value=>value.path.includes('/wait')));
});

test('overall deadline covers completed input and hung output/wait independently of header timeout',async t=>{
  const s=await scenario(t,{mode:'NO_RESULT',deadlineMs:120,headerTimeoutMs:1000}),began=performance.now(),result=await s.run();
  assert.ok(performance.now()-began<1000);assert.ok(result.failure);assert.equal(result.io.inputClosed,true);assert.equal(result.io.outputClosed,false);
  assert.equal(result.capacityHeld,true);assert.equal(result.cleanup,'UNKNOWN');assert.equal(result.registryHeld,true);
  assert.ok(s.requests.some(value=>value.path.includes('/wait')));
});

test('caller original mismatch, stale epoch and arbitrary operations cannot send an effect',async t=>{
  const s=await scenario(t);s.bytes[0]=66;const result=await s.run();
  assert.equal(result.failure,'ENGINE_TRANSPORT_SOURCE_MISMATCH');assert.equal(s.requests.length,0);
  const wrong=createProofDecoderEngineExecutor({enabled:true,plan:s.context.plan,registry:s.registry,socketPath:s.socketPath,apiVersion:'1.47',epoch:'OTHER'});
  assert.throws(()=>wrong.run({jobId:s.row.identity.jobId,originalBytes:s.bytes,seccompBytes:s.context.seccompBytes}));await wrong.close();
  const context=syntheticEngineContext({created:false}),bytes=Buffer.from('x'),original={byteCount:1,sha256:sha(bytes),declaredType:'image/png'};
  const transport=createProofDecoderEngineTransport({enabled:true,...context,original,originalBytes:bytes,socketPath:s.socketPath,deadlineMono:performance.now()+1000});
  for(const operation of ['KILL','REMOVE','/containers/json','http://localhost'])await assert.rejects(transport.request(operation),{code:'ENGINE_TRANSPORT_OPERATION'});
  assert.equal(s.requests.length,0);transport.close();
});
