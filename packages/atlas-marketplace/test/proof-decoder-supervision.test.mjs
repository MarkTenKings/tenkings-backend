import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {createConnection} from 'node:net';
import {once} from 'node:events';
import {createProofDecoderLaunchPlan} from '../src/proof-decoder-profile.mjs';
import {openProofDecoderJobRegistry} from '../src/proof-decoder-job-registry.mjs';
import {createLocalFixtureDecoderExecutor} from '../src/proof-decoder-fixture-executor.mjs';
import {createProofDecoderWatchdog} from '../src/proof-decoder-watchdog.mjs';
import {createProofDecoderSupervisor} from '../src/proof-decoder-supervisor.mjs';
import {buildProofDecoderOwnedOperation} from '../src/proof-decoder-owned-operations.mjs';
import {PROOF_DECODER_PROTOCOL,createProofDecoderFrameReader,encodeProofDecoderFrame} from '../src/proof-decoder-protocol.mjs';
import {assertProofImageValidator} from '../src/proof-image.mjs';
import {syntheticDecoderProfile} from './proof-decoder-profile-fixtures.mjs';

function fixture({scenario='REAL_WORKER',timeoutMs=2000}={}) {
  const directory=mkdtempSync(join(realpathSync(tmpdir()),'atlas-decoder-life-')),profile=syntheticDecoderProfile();
  profile.ipc.socketPath=join(directory,'decoder.sock');profile.limits.timeoutMs=timeoutMs;
  const plan=createProofDecoderLaunchPlan({enabled:true,profile});
  const registry=openProofDecoderJobRegistry({enabled:true,directory:join(directory,'registry'),plan});
  const executor=createLocalFixtureDecoderExecutor({enabled:true,plan,scenario});
  const watchdog=createProofDecoderWatchdog({enabled:true,registry,executor,plan});
  const expectedQualificationHash='7'.repeat(64),epoch='LOCAL_LIFECYCLE_FIXTURE';
  const supervisor=createProofDecoderSupervisor({enabled:true,registry,executor,watchdog,plan,expectedQualificationHash,epoch});
  const requestPlan={byteCount:3,sha256:createHash('sha256').update('abc').digest('hex'),declaredType:'image/png'};
  return {directory,profile,plan,registry,executor,watchdog,supervisor,expectedQualificationHash,epoch,requestPlan,
    reserve(){const now=Date.now(),record=registry.reserve({requestId:randomUUID(),epoch,requestPlan,now,deadlineAt:now+timeoutMs});watchdog.adoptJob(record,{deadlineMono:performance.now()+timeoutMs});return record;},
    request(row){return {requestId:row.identity.requestId,plan:requestPlan,limits:profile.limits,limitsHash:plan.limitsHash};},
    async close(){await supervisor.close();await watchdog.close();await executor.close();registry.close();}};
}
async function created(f){let row=f.reserve();row=f.registry.transition(row.identity.jobId,row.revision,{phase:'CREATE_INTENT'});const found=await f.executor.create(row);return f.registry.transition(row.identity.jobId,row.revision,{phase:'CREATED',containerId:found.identity.containerId});}
async function running(f){let row=await created(f);row=f.registry.transition(row.identity.jobId,row.revision,{phase:'START_INTENT'});const stream=await f.executor.start(row,{request:f.request(row)});return f.registry.transition(row.identity.jobId,row.revision,{phase:'RUNNING',startedAt:stream.startedAt});}
async function peer(f,{start=true}={}) {
  const socket=createConnection({path:f.profile.ipc.socketPath,allowHalfOpen:true}),frames=[],requestId=randomUUID();let accept;
  const accepted=new Promise(resolve=>{accept=resolve;});socket.on('error',()=>{});
  const reader=createProofDecoderFrameReader({allowedTypes:['HELLO','ACCEPT','TERMINAL'],maxFrames:3,onFrame(type,value){frames.push({type,value});if(type==='HELLO'&&start)socket.write(encodeProofDecoderFrame('START',{schema:PROOF_DECODER_PROTOCOL,requestId,qualificationHash:f.expectedQualificationHash,epoch:f.epoch,limitsHash:f.plan.limitsHash,plan:f.requestPlan}));if(type==='ACCEPT')accept();}});
  socket.on('data',bytes=>reader.feed(bytes));await once(socket,'connect');return {socket,frames,requestId,accepted};
}

test('default off, immutable owned operations, and fixture objects never acquire validator authority',async()=>{
  assert.equal(createLocalFixtureDecoderExecutor(),null);assert.equal(createProofDecoderWatchdog(),null);assert.equal(createProofDecoderSupervisor(),null);
  const f=fixture({scenario:'MODEL_ONLY'});try{await f.watchdog.start();const row=f.reserve();
    const op=buildProofDecoderOwnedOperation({plan:f.plan,job:row.identity,operation:'CREATE'});
    assert.equal(op.executionAllowed,false);assert.ok(Object.isFrozen(op.arguments));assert.ok(op.arguments.includes('--network=none'));assert.ok(op.arguments.some(arg=>arg.includes(row.identity.ownerNonce)));
    assert.throws(()=>buildProofDecoderOwnedOperation({plan:f.plan,job:{...row.identity,name:'foreign'},operation:'KILL'}));
    for(const candidate of [op,f.executor,f.registry,f.watchdog,f.supervisor])assert.throws(()=>assertProofImageValidator(candidate),{code:'PROOF_DECODER_UNAVAILABLE'});
  }finally{await f.close();}
});

test('pending spawn cannot be removed or mint cleanup before joined process exit',async()=>{
  const f=fixture();try{await f.watchdog.start();let row=await created(f);row=f.registry.transition(row.identity.jobId,row.revision,{phase:'START_INTENT'});
    const pending=f.executor.start(row,{request:f.request(row)});pending.catch(()=>{});
    assert.equal((await f.executor.observe(row)).processState,'RUNNING');
    await assert.rejects(f.executor.remove(row),{code:'DECODER_CLEANUP_UNCONFIRMED'});
    assert.throws(()=>f.executor.cleanupReceipt(row),{code:'DECODER_CLEANUP_UNCONFIRMED'});
    await f.watchdog.reconcileOnce({jobId:row.identity.jobId});await pending.catch(()=>{});
    const saved=f.registry.get(row.identity.jobId);assert.equal(saved.phase,'FINALIZED');assert.equal(saved.cleanup.processState,'EXITED');assert.equal(saved.cleanup.waitObserved,true);
  }finally{await f.close();}
});

test('fresh executor cannot discover or free a persisted old live job',async()=>{
  const f=fixture();let reopened,other,watch;
  try{await f.watchdog.start();const row=await running(f),pid=f.executor.snapshot().containers[0].pid;assert.ok(pid>0);f.registry.close();
    reopened=openProofDecoderJobRegistry({enabled:true,directory:join(f.directory,'registry'),plan:f.plan,ownership:f.registry.ownership});other=createLocalFixtureDecoderExecutor({enabled:true,plan:f.plan});watch=createProofDecoderWatchdog({enabled:true,registry:reopened,executor:other,plan:f.plan});
    await assert.rejects(watch.start(),{code:'DECODER_WATCHDOG_QUARANTINED'});assert.equal(reopened.snapshot().occupiedSlots,1);assert.doesNotThrow(()=>process.kill(pid,0));assert.equal(other.snapshot().events.some(event=>['KILL','REMOVE'].includes(event.operation)),false);
    assert.throws(()=>other.cleanupReceipt(row),{code:'DECODER_FIXTURE_OWNERSHIP_UNKNOWN'});
  }finally{await watch?.close();await other?.close();reopened?.close();await f.close();}
});

test('committed create intent/lost reply and never-created failure reconcile through exact owned receipt',async()=>{
  for(const scenario of ['CREATE_LOST_REPLY','CREATE_FAIL']){const f=fixture({scenario});try{await f.watchdog.start();let row=f.reserve();row=f.registry.transition(row.identity.jobId,row.revision,{phase:'CREATE_INTENT'});await assert.rejects(f.executor.create(row));
    await f.watchdog.reconcileOnce({jobId:row.identity.jobId});const saved=f.registry.get(row.identity.jobId);assert.equal(saved.phase,'FINALIZED');assert.equal(saved.cleanup.processState,'NOT_STARTED');assert.equal(saved.cleanup.waitObserved,false);assert.equal(saved.identity.containerId!==null,scenario==='CREATE_LOST_REPLY');
  }finally{await f.close();}}
});

test('foreign lookup and uncertain cleanup retain durable capacity and do not claim image invalid',async()=>{
  for(const scenario of ['FOREIGN_LOOKUP','CLEANUP_UNKNOWN']){const f=fixture({scenario});try{await f.watchdog.start();const row=await created(f);await f.watchdog.reconcileOnce({jobId:row.identity.jobId});assert.equal(f.registry.snapshot().occupiedSlots,1);assert.equal(f.watchdog.status().quarantined,true);assert.equal(f.registry.get(row.identity.jobId).cleanup,null);
    if(scenario==='FOREIGN_LOOKUP')assert.equal(f.executor.snapshot().events.some(event=>['KILL','REMOVE'].includes(event.operation)),false);
  }finally{await f.close();}}
});

test('registry unavailable after adoption still permits only exact owned kill; durable finalization stays quarantined',async()=>{
  const f=fixture();try{await f.watchdog.start();const row=await running(f);writeFileSync(join(f.directory,'registry','jobs.sqlite-journal'),'synthetic foreign sidecar',{mode:0o600});
    await f.watchdog.reconcileOnce({jobId:row.identity.jobId});assert.equal(f.executor.snapshot().containers[0].exited,true);assert.equal(f.watchdog.status().quarantined,true);assert.equal(f.watchdog.status().adoptedJobs,1);assert.throws(()=>f.registry.snapshot(),{code:'DECODER_REGISTRY_RECOVERY_REQUIRED'});
  }finally{await f.close();}
});

test('concurrent watchdog reconciliations share one flight and target exact finalized state',async()=>{
  const f=fixture({scenario:'MODEL_ONLY'});try{await f.watchdog.start();const row=await running(f);const a=f.watchdog.reconcileOnce({jobId:row.identity.jobId}),b=f.watchdog.reconcileOnce({jobId:row.identity.jobId}),c=f.watchdog.reconcileOnce({all:true});assert.equal(a,b);assert.equal(b,c);await a;assert.equal(f.registry.get(row.identity.jobId).phase,'FINALIZED');assert.equal(f.executor.snapshot().events.filter(event=>event.operation==='REMOVE').length,1);
  }finally{await f.close();}
});

test('startup concurrent with close never publishes a post-close listener or watchdog timers',async()=>{
  const f=fixture();try{const opening=f.supervisor.start();opening.catch(()=>{});await f.supervisor.close();await assert.rejects(opening);assert.equal(f.supervisor.status().closed,true);assert.equal(f.watchdog.status().closed,true);
  }finally{await f.close();}
});

test('partial framing and malicious half-open input cannot hold supervisor close',async()=>{
  const f=fixture();let p;try{await f.supervisor.start();p=await peer(f,{start:false});p.socket.write(Buffer.from([0,0]));p.socket.pause();const began=performance.now();await f.supervisor.close();assert.ok(performance.now()-began<1200);assert.equal(f.supervisor.status().activeConnections,0);assert.equal(f.registry.snapshot().occupiedSlots,0);
  }finally{p?.socket.destroy();await f.close();}
});

test('CANCEL after actual worker start reports REAPED only after durable finalization',async()=>{
  const f=fixture();let p;try{await f.supervisor.start();p=await peer(f);await p.accepted;const ended=once(p.socket,'end');p.socket.write(encodeProofDecoderFrame('CANCEL',{requestId:p.requestId}));await ended;const terminal=p.frames.find(frame=>frame.type==='TERMINAL');assert.equal(terminal?.value.outcome,'CANCELLED');assert.equal(terminal.value.workerState,'REAPED');assert.equal(f.registry.snapshot().jobs[0].phase,'FINALIZED');
  }finally{p?.socket.destroy();await f.close();}
});

test('absolute input deadline destroys partial job transport and watchdog joins owned worker',async()=>{
  const f=fixture({timeoutMs:180});let p;try{await f.supervisor.start();p=await peer(f);await p.accepted;const ended=once(p.socket,'end'),began=performance.now();p.socket.write(Buffer.from([0,0,0,3,1]));await ended;assert.ok(performance.now()-began<1000);await f.watchdog.reconcileOnce({all:true});assert.equal(f.executor.snapshot().containers[0].exited,true);assert.equal(f.registry.snapshot().occupiedSlots,0);assert.equal(p.frames.some(frame=>frame.type==='TERMINAL'&&['SUCCESS','INVALID_IMAGE'].includes(frame.value.outcome)),false);
  }finally{p?.socket.destroy();await f.close();}
});

test('committed cleanup receipt survives reopen and finalizes without invented fresh-executor discovery',async()=>{
  const f=fixture({scenario:'MODEL_ONLY'});let reopened,other,watch;
  try{await f.watchdog.start();let row=await running(f);row=f.registry.transition(row.identity.jobId,row.revision,{phase:'STOP_INTENT'});await f.executor.kill(row);await f.executor.remove(row);const receipt=f.executor.cleanupReceipt(row);row=f.registry.transition(row.identity.jobId,row.revision,{phase:'CLEANUP_OBSERVED',cleanup:receipt});f.registry.close();
    reopened=openProofDecoderJobRegistry({enabled:true,directory:join(f.directory,'registry'),plan:f.plan,ownership:f.registry.ownership});other=createLocalFixtureDecoderExecutor({enabled:true,plan:f.plan});watch=createProofDecoderWatchdog({enabled:true,registry:reopened,executor:other,plan:f.plan});await watch.start();assert.equal(reopened.get(row.identity.jobId).phase,'FINALIZED');assert.equal(other.snapshot().events.length,0);
  }finally{await watch?.close();await other?.close();reopened?.close();await f.close();}
});

test('each committed intent/effect boundary reconciles with same-executor ownership and no duplicate create/start',async()=>{
  const boundaries=['RESERVED','CREATE_INTENT','CREATED','START_INTENT','RUNNING','STOP_INTENT','CLEANUP_OBSERVED'];
  for(const boundary of boundaries){const f=fixture({scenario:'MODEL_ONLY'});let reopened,watch;
    try{
      // No watchdog is started during setup: this models committed state, not a
      // process crash or an interrupted SQLite transaction.
      const now=Date.now();let row=f.registry.reserve({requestId:randomUUID(),epoch:f.epoch,requestPlan:f.requestPlan,now,deadlineAt:now+f.profile.limits.timeoutMs});f.executor.adoptJob(row);
      if(boundaries.indexOf(boundary)>=1)row=f.registry.transition(row.identity.jobId,row.revision,{phase:'CREATE_INTENT'});
      if(boundaries.indexOf(boundary)>=2){const observed=await f.executor.create(row);row=f.registry.transition(row.identity.jobId,row.revision,{phase:'CREATED',containerId:observed.identity.containerId});}
      if(boundaries.indexOf(boundary)>=3)row=f.registry.transition(row.identity.jobId,row.revision,{phase:'START_INTENT'});
      if(boundaries.indexOf(boundary)>=4){const stream=await f.executor.start(row,{request:f.request(row)});row=f.registry.transition(row.identity.jobId,row.revision,{phase:'RUNNING',startedAt:stream.startedAt});}
      if(boundaries.indexOf(boundary)>=5)row=f.registry.transition(row.identity.jobId,row.revision,{phase:'STOP_INTENT'});
      if(boundary==='CLEANUP_OBSERVED'){await f.executor.kill(row);await f.executor.remove(row);row=f.registry.transition(row.identity.jobId,row.revision,{phase:'CLEANUP_OBSERVED',cleanup:f.executor.cleanupReceipt(row)});}
      assert.equal(row.phase,boundary);const before=f.executor.snapshot().events.filter(event=>['CREATE','START'].includes(event.operation));f.registry.close();
      reopened=openProofDecoderJobRegistry({enabled:true,directory:join(f.directory,'registry'),plan:f.plan,ownership:f.registry.ownership});watch=createProofDecoderWatchdog({enabled:true,registry:reopened,executor:f.executor,plan:f.plan});await watch.start();
      assert.equal(reopened.get(row.identity.jobId).phase,'FINALIZED',boundary);assert.equal(reopened.snapshot().occupiedSlots,0,boundary);assert.deepEqual(f.executor.snapshot().events.filter(event=>['CREATE','START'].includes(event.operation)),before,boundary);
    }finally{await watch?.close();reopened?.close();await f.close();}
  }
});
