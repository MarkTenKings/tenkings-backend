import {createServer} from 'node:net';
import {lstatSync,realpathSync,existsSync,chmodSync} from 'node:fs';
import {dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {requireValue} from './contract.mjs';
import {assertProofDecoderLaunchPlan,decoderFreeze} from './proof-decoder-profile.mjs';
import {assertProofDecoderJobRegistry} from './proof-decoder-job-registry.mjs';
import {assertLocalFixtureDecoderExecutor} from './proof-decoder-fixture-executor.mjs';
import {assertProofDecoderWatchdog,assertProofDecoderObservedOwnership} from './proof-decoder-watchdog.mjs';
import {PROOF_DECODER_PROTOCOL,createProofDecoderFrameReader,encodeProofDecoderFrame} from './proof-decoder-protocol.mjs';

const check=(condition,code='DECODER_SUPERVISOR_INVALID')=>requireValue(condition,code);
/** Local-only protocol experiment. No Docker, peer credential observer, service
 * manager or production authority. Only the shipped sealed fixture ports fit. */
export function createProofDecoderSupervisor({enabled=false,plan:input,registry,executor,watchdog,expectedQualificationHash,epoch,bounds={}}={}) {
  if(enabled!==true)return null;
  const plan=assertProofDecoderLaunchPlan(input);assertProofDecoderJobRegistry(registry,{plan});assertLocalFixtureDecoderExecutor(executor,{plan});assertProofDecoderWatchdog(watchdog,{registry,executor,plan});
  check(typeof expectedQualificationHash==='string'&&/^[a-f0-9]{64}$/.test(expectedQualificationHash)&&typeof epoch==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(epoch));
  check(Object.keys(bounds).every(key=>['maxConnections','maxRequests','maxLifetimeMs','cleanupTimeoutMs'].includes(key)));
  const maxConnections=bounds.maxConnections??4,maxRequests=bounds.maxRequests??128,maxLifetimeMs=bounds.maxLifetimeMs??30000,cleanupTimeoutMs=bounds.cleanupTimeoutMs??500;
  check(Number.isSafeInteger(maxConnections)&&maxConnections>=1&&maxConnections<=8&&Number.isSafeInteger(maxRequests)&&maxRequests>=1&&maxRequests<=128&&Number.isSafeInteger(maxLifetimeMs)&&maxLifetimeMs>=100&&maxLifetimeMs<=60000&&Number.isSafeInteger(cleanupTimeoutMs)&&cleanupTimeoutMs>=1&&cleanupTimeoutMs<=1000);
  const socketPath=plan.profile.ipc.socketPath,parent=dirname(socketPath),sessions=new Set();
  let server=null,started=false,closed=false,quarantined=false,requests=0,rejectedConnections=0,lifetime=null,closePromise=null,startPromise=null,parentStamp=null;
  function privateParent() {const stat=lstatSync(parent);check(realpathSync(parent)===parent&&stat.isDirectory()&&!stat.isSymbolicLink()&&stat.uid===process.getuid()&&(stat.mode&0o777)===0o700,'DECODER_IPC_OWNERSHIP');if(parentStamp)check(stat.dev===parentStamp.dev&&stat.ino===parentStamp.ino,'DECODER_IPC_OWNERSHIP');return stat;}
  function snapshot() {let durable;try{durable=registry.snapshot();}catch{quarantined=true;}return decoderFreeze({classification:'UNQUALIFIED',evidenceOrigin:'LOCAL_FIXTURE',state:closed?'CLOSED':quarantined?'QUARANTINED':started?'OPEN':'DISABLED',started,closed,quarantined,requests,rejectedConnections,activeConnections:sessions.size,occupiedSlots:durable?.occupiedSlots??null,cleanupUncertain:durable?durable.occupiedSlots>0:true,peerIdentityVerified:false,independentWatchdog:false});}
  function connection(socket) {
    if(closed||quarantined||sessions.size>=maxConnections||requests>=maxRequests){rejectedConnections++;socket.destroy();return;}
    requests++;
    const beganMono=performance.now(),beganWall=Date.now(),deadlineMono=beganMono+plan.profile.limits.timeoutMs,deadlineAt=beganWall+plan.profile.limits.timeoutMs;
    let record=null,request=null,stream=null,accepted=false,received=0,finishing=null,terminalSent=false,cancelled=null,disconnected=false,captured=null;
    const digest=createHash('sha256');
    const session={stop:()=>{cancelled='CANCELLED';socket.destroy();return finish('CANCELLED');},done:null};sessions.add(session);
    const live=()=>{check(!closed&&!cancelled&&!finishing&&!disconnected&&performance.now()<deadlineMono,'DECODER_DEADLINE');privateParent();};
    const write=(type,value)=>new Promise((resolve,reject)=>{if(socket.destroyed)return reject(new Error('DECODER_TRANSPORT'));socket.write(encodeProofDecoderFrame(type,value),cause=>cause?reject(cause):resolve());});
    const same=value=>check(value.qualificationHash===expectedQualificationHash&&value.epoch===epoch&&value.limitsHash===plan.limitsHash,'PROOF_DECODER_PROTOCOL');
    function latest() {return record?registry.get(record.identity.jobId):null;}
    async function cleanup() {
      if(!record)return true;
      const end=Math.min(deadlineMono,performance.now()+cleanupTimeoutMs);
      // Joining an unrelated watchdog flight does not prove this job finished.
      for(let attempt=0;attempt<2&&performance.now()<end;attempt++){
        await watchdog.reconcileOnce({jobId:record.identity.jobId,deadlineMono:end});
        const row=latest();if(row?.phase==='FINALIZED'&&row.cleanup?.confirmed===true)return row;
      }
      quarantined=true;return false;
    }
    function finish(outcome,validation=null) {
      if(['CANCELLED','TIMEOUT','CONTAINMENT_FAILURE'].includes(outcome))cancelled??=outcome;
      if(finishing)return finishing;
      finishing=(async()=>{
        let cleaned=false;try{cleaned=await cleanup();}catch{quarantined=true;}
        const deadlinePassed=performance.now()>=deadlineMono;
        if(!cleaned)quarantined=true;
        // Never invent NOT_STARTED after create/start uncertainty, or REAPED
        // before ACCEPT. Pre-ACCEPT failure closes and the client quarantines.
        if(!accepted||!request||socket.destroyed||disconnected||deadlinePassed){socket.destroy();return;}
        let finalOutcome=cancelled??outcome;
        if(!cleaned||cleaned.cleanup?.processState!=='EXITED'||cleaned.cleanup?.waitObserved!==true)finalOutcome='CONTAINMENT_FAILURE';
        if(finalOutcome==='CONTAINMENT_FAILURE')quarantined=true;
        terminalSent=true;
        try{await write('TERMINAL',{requestId:request.requestId,qualificationHash:expectedQualificationHash,epoch,outcome:finalOutcome,workerState:finalOutcome==='CONTAINMENT_FAILURE'?'UNKNOWN':'REAPED',validation:finalOutcome==='SUCCESS'?validation:null});socket.end(()=>socket.destroy());}catch{socket.destroy();}
      })();finishing.catch(()=>{quarantined=true;socket.destroy();});return finishing;
    }
    const timer=setTimeout(()=>{cancelled='TIMEOUT';socket.destroy();void finish('TIMEOUT');},Math.max(1,deadlineMono-performance.now()));
    const reader=createProofDecoderFrameReader({allowedTypes:['START','DATA','CANCEL'],maxFrames:162,maxTotalBytes:plan.profile.limits.maxObjectBytes+16384,onFrame(type,value){check(captured===null,'PROOF_DECODER_PROTOCOL');captured={type,value};}});
    async function frame(type,value) {
      if(type==='CANCEL'){check(request&&value.requestId===request.requestId,'PROOF_DECODER_PROTOCOL');cancelled='CANCELLED';await finish('CANCELLED');return;}
      live();
      if(type==='START') {
        check(request===null,'PROOF_DECODER_PROTOCOL');same(value);check(value.plan.byteCount<=plan.profile.limits.maxObjectBytes,'PROOF_DECODER_PROTOCOL');request=value;
        if(watchdog.status().quarantined||registry.snapshot().occupiedSlots>=plan.profile.limits.maxConcurrent){terminalSent=true;await write('TERMINAL',{requestId:value.requestId,qualificationHash:expectedQualificationHash,epoch,outcome:'BUSY',workerState:'NOT_STARTED',validation:null});socket.end(()=>socket.destroy());return;}
        record=registry.reserve({requestId:value.requestId,epoch,requestPlan:value.plan,now:beganWall,deadlineAt});
        watchdog.adoptJob(record,{deadlineMono});
        record=registry.transition(record.identity.jobId,record.revision,{phase:'CREATE_INTENT'});
        const observed=await executor.create(record,{deadlineMono});live();
        const identity=assertProofDecoderObservedOwnership(observed,record.identity,plan);
        record=registry.transition(record.identity.jobId,record.revision,{phase:'CREATED',containerId:identity.containerId});
        record=registry.transition(record.identity.jobId,record.revision,{phase:'START_INTENT'});
        stream=await executor.start(record,{request:{requestId:value.requestId,plan:value.plan,limits:plan.profile.limits,limitsHash:plan.limitsHash}});live();
        record=registry.transition(record.identity.jobId,record.revision,{phase:'RUNNING',startedAt:stream.startedAt});
        await write('ACCEPT',{requestId:value.requestId,qualificationHash:expectedQualificationHash,epoch});live();accepted=true;return;
      }
      check(type==='DATA'&&accepted&&stream&&request&&received<request.plan.byteCount,'PROOF_DECODER_PROTOCOL');
      const required=Math.min(65536,request.plan.byteCount-received);check(value.length===required,'PROOF_DECODER_PROTOCOL');
      try{digest.update(value);received+=value.length;await stream.write(value);live();}finally{value.fill(0);}
      if(received===request.plan.byteCount){check(digest.digest('hex')===request.plan.sha256,'PROOF_SOURCE_MISMATCH');await stream.end();live();
        void stream.result.then(result=>{if(!finishing)void finish(result.outcome==='DECODER_FAILURE'?'CONTAINMENT_FAILURE':result.outcome,result.validation);},()=>{if(!finishing)void finish(performance.now()>=deadlineMono?'TIMEOUT':'CONTAINMENT_FAILURE');});}
    }
    socket.on('error',()=>{});
    socket.on('close',()=>{disconnected=true;if(!terminalSent)void finish('CANCELLED');});
    session.done=(async()=>{
      try {
        await write('HELLO',{schema:PROOF_DECODER_PROTOCOL,qualificationHash:expectedQualificationHash,epoch,limitsHash:plan.limitsHash});
        for await(const chunk of socket) {
          check(!terminalSent,'PROOF_DECODER_PROTOCOL');
          // Feed only up to each header/frame boundary; one bounded frame is
          // handled before another allocation or child-pipe write is admitted.
          let offset=0;while(offset<chunk.length){check(!closed&&!disconnected&&performance.now()<deadlineMono,'DECODER_DEADLINE');const state=reader.status(),take=Math.min(chunk.length-offset,state.allocatedBytes-state.bufferedBytes);check(take>0,'PROOF_DECODER_PROTOCOL');reader.feed(chunk.subarray(offset,offset+take));offset+=take;if(captured){const next=captured;captured=null;await frame(next.type,next.value);}}
        }
        reader.end();if(!terminalSent)await finish('CANCELLED');
      }catch{if(!terminalSent)await finish(performance.now()>=deadlineMono?'TIMEOUT':'CONTAINMENT_FAILURE');socket.destroy();}
      finally {clearTimeout(timer);if(finishing)await finishing;else if(record)await finish('CANCELLED');sessions.delete(session);}
    })();session.done.catch(()=>{quarantined=true;socket.destroy();sessions.delete(session);});
  }
  const supervisor=Object.freeze({classification:'UNQUALIFIED',evidenceOrigin:'LOCAL_FIXTURE',
    start(){if(startPromise)return startPromise;check(!closed,'DECODER_SUPERVISOR_CLOSED');startPromise=(async()=>{parentStamp=privateParent();check(!existsSync(socketPath),'DECODER_IPC_OWNERSHIP');await watchdog.start();check(!closed,'DECODER_SUPERVISOR_CLOSED');privateParent();check(!existsSync(socketPath),'DECODER_IPC_OWNERSHIP');server=createServer({allowHalfOpen:true,pauseOnConnect:true},connection);await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve);});check(!closed,'DECODER_SUPERVISOR_CLOSED');server.on('error',()=>{quarantined=true;void this.close();});chmodSync(socketPath,0o600);started=true;lifetime=setTimeout(()=>{void this.close();},maxLifetimeMs);return snapshot();})();return startPromise;},
    status:snapshot,
    close(){if(closePromise)return closePromise;closed=true;clearTimeout(lifetime);closePromise=(async()=>{if(startPromise)try{await startPromise;}catch{}clearTimeout(lifetime);const pending=[...sessions];const listenerClosed=new Promise(resolve=>{if(server?.listening)server.close(resolve);else resolve();});await Promise.all(pending.map(session=>session.stop()));for(const session of pending)if(!session.done)quarantined=true;await Promise.all(pending.map(session=>session.done));await listenerClosed;await watchdog.close();return snapshot();})();return closePromise;}
  });return supervisor;
}
