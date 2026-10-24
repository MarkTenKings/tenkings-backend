import {createServer,createConnection} from 'node:net';
import {lstatSync,realpathSync,readdirSync,chmodSync,chownSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {setImmediate as yieldToIO} from 'node:timers/promises';
import {requireValue} from './contract.mjs';
import {assertProofDecoderLaunchPlan,decoderContractData,decoderFreeze} from './proof-decoder-profile.mjs';
import {assertProofDecoderPlan} from './proof-decoder-protocol.mjs';
import {engineDataOptions,engineBytesHash} from './proof-decoder-engine-json.mjs';
import {assertProofDecoderLinuxObserver} from './proof-decoder-linux-observer.mjs';
import {assertProofDecoderLinuxCgroupController} from './proof-decoder-linux-cgroup.mjs';
import {assertProofDecoderTargetRegistry} from './proof-decoder-target-registry.mjs';
import {assertProofDecoderTargetEngineExecutor} from './proof-decoder-engine-target-executor.mjs';
import {TARGET_BROKER_SCHEMA,TARGET_BROKER_SOCKET,TARGET_BROKER_CHUNK,brokerNanoseconds,encodeTargetBrokerFrame,createTargetBrokerFrameReader,createTargetBrokerInputCollector} from './proof-decoder-target-broker-protocol.mjs';

const MARKERS=Object.freeze({classification:'UNQUALIFIED',executionAllowed:false,freshPublicationAllowed:false});
const owners=new WeakSet(),targetClients=new WeakMap(),DIRECTORY=dirname(TARGET_BROKER_SOCKET),POLL_MS=25;
const check=(value,code='DECODER_BROKER_INVALID')=>requireValue(value,code);
const error=code=>Object.assign(new Error(code),{code,...MARKERS});
const stamp=st=>`${st.dev}:${st.ino}`;
function launch(input){
  const plan=assertProofDecoderLaunchPlan(input),ipc=plan.profile.ipc;
  check(ipc.socketPath===TARGET_BROKER_SOCKET&&ipc.supervisorUid===0&&ipc.supervisorGid===0&&plan.profile.limits.maxConcurrent===1,'DECODER_BROKER_CONFIGURATION');return plan;
}
function directory(plan){
  for(let path=DIRECTORY;;path=dirname(path)){
    const st=lstatSync(path,{bigint:true});check(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===0n&&(st.mode&0o022n)===0n&&realpathSync(path)===path,'DECODER_BROKER_DIRECTORY');
    if(path===DIRECTORY)check(st.gid===BigInt(plan.profile.ipc.clientGid)&&(st.mode&0o7777n)===0o750n,'DECODER_BROKER_DIRECTORY');if(path==='/')break;
  }
  return stamp(lstatSync(DIRECTORY,{bigint:true}));
}
function endpoint(plan){const st=lstatSync(TARGET_BROKER_SOCKET,{bigint:true});check(st.isSocket()&&!st.isSymbolicLink()&&st.uid===0n&&st.gid===BigInt(plan.profile.ipc.clientGid)&&(st.mode&0o7777n)===0o660n&&st.nlink===1n,'DECODER_BROKER_SOCKET');return stamp(st);}
function write(socket,type,value){
  const bytes=encodeTargetBrokerFrame(type,value);
  return new Promise((resolve,reject)=>{
    let done=false;
    const finish=cause=>{if(done)return;done=true;socket.off('error',bad);socket.off('close',bad);bytes.fill(0);cause?reject(error('DECODER_BROKER_TRANSPORT')):resolve();};
    const bad=()=>finish(true);socket.once('error',bad);socket.once('close',bad);
    try{check(!socket.destroyed&&socket.writable&&socket.writableLength<=65544,'DECODER_BROKER_TRANSPORT');socket.write(bytes,finish);}catch{finish(true);}
  });
}
const time=observer=>{const value=observer.boottimeNanoseconds();check(typeof value==='bigint'&&value>=0n&&value<=18446744073709551615n,'DECODER_BROKER_CLOCK');return value;};

/** Listener for the concrete root broker process. Constructor inputs must be
 * existing same-process private brands; no callbacks or fixture effects fit.
 * Every returned wire object remains an UNQUALIFIED transport report. */
export async function startProofDecoderTargetBroker(options={}){
  const input=engineDataOptions(options,[],['enabled','plan','targetRegistry','parentController','observer','executor','seccompBytes']);
  if(input.enabled!==true)return null;
  const plan=launch(input.plan),controller=assertProofDecoderLinuxCgroupController(input.parentController),observer=assertProofDecoderLinuxObserver(input.observer);
  const registry=assertProofDecoderTargetRegistry(input.targetRegistry,{plan,controller});
  const executor=assertProofDecoderTargetEngineExecutor(input.executor,{targetRegistry:registry,parentController:controller,plan});
  check(process.getuid()===0&&process.getgid()===0&&!owners.has(registry),'DECODER_BROKER_OWNER');
  check(Buffer.isBuffer(input.seccompBytes)&&input.seccompBytes.length>0&&input.seccompBytes.length<=65536&&engineBytesHash(input.seccompBytes)===plan.profile.seccomp.sha256,'DECODER_BROKER_SECCOMP');
  const seccomp=Buffer.from(input.seccompBytes),initial=registry.status();
  check(!initial.closed&&!initial.poisoned&&initial.occupiedSlots===0,'DECODER_BROKER_RECOVERY_REQUIRED');
  const directoryStamp=directory(plan);check(readdirSync(DIRECTORY).length===0,'DECODER_BROKER_STALE_SOCKET');
  const seen=new Set();let active=null,closed=false,poisoned=false,ready=false,socketStamp=null,rejected=0,closePromise=null;
  const bound={bootId:initial.bootId,epoch:initial.epoch,bindingHash:initial.bindingHash};
  function healthy(){
    check(!closed&&!poisoned,'DECODER_BROKER_UNAVAILABLE');check(directory(plan)===directoryStamp&&(!ready||endpoint(plan)===socketStamp),'DECODER_BROKER_SOCKET');
    const state=registry.status(),parent=controller.status(),worker=executor.status();
    check(!state.closed&&!state.poisoned&&state.bindingHash===bound.bindingHash&&!worker.closed&&!worker.poisoned&&parent.healthy&&!parent.closed&&!parent.freezeRequested&&!parent.frozen&&parent.bootId===bound.bootId&&parent.bindingHash===initial.parentBindingHash,'DECODER_BROKER_UNAVAILABLE');
    return time(observer);
  }
  function poison(session,reason){
    if(!session.record)return;
    poisoned=true;try{registry.quarantineEpoch({reason:'BROKER_'+reason,jobId:session.record.identity.jobId});}catch{}
    try{controller.freezeAndKill();}catch{}
  }
  const server=createServer({allowHalfOpen:true,pauseOnConnect:true},socket=>{
    socket.on('error',()=>{});
    if(!ready||closed||poisoned||active||seen.size>=128){rejected=Math.min(rejected+1,128);socket.destroy();return;}
    let peer;
    try{healthy();peer=observer.capture(socket,{uid:plan.profile.ipc.clientUid,gid:plan.profile.ipc.clientGid});check(peer.assertAlive().pid!==process.pid,'DECODER_BROKER_INDEPENDENCE');}
    catch{peer?.close();socket.destroy();rejected=Math.min(rejected+1,128);return;}
    const session={record:null,socket,stop:null,done:null};active=session;
    const nonce=randomBytes(32).toString('hex'),connectedAt=time(observer),connectionDeadline=connectedAt+BigInt(plan.profile.limits.timeoutMs)*1000000n;
    let deadline=connectedAt+BigInt(Math.min(500,plan.profile.limits.timeoutMs))*1000000n,request=null,original=null,collector=null,inputEnded=false,captured=null,accepted=false,completed=false,stopped=false,runPromise=null,poll,pendingInputBytes=0;
    const aborter=new AbortController();
    const reader=createTargetBrokerFrameReader({allowedTypes:['START','DATA','INPUT_END','CANCEL'],maxFrames:163,maxTotalBytes:plan.profile.limits.maxObjectBytes+16384,onFrame(type,value){check(captured===null,'DECODER_BROKER_PROTOCOL');captured={type,value};}});
    const live=()=>{const now=healthy();check(!stopped&&!completed&&now<deadline,'DECODER_BROKER_DEADLINE');peer.assertAlive();return now;};
    const stop=reason=>{if(stopped)return;stopped=true;if(!completed)poison(session,reason);aborter.abort();socket.destroy();};session.stop=()=>stop('SHUTDOWN');
    socket.on('close',()=>{if(!completed)stop('DISCONNECT');});
    poll=setInterval(()=>{if(completed){socket.destroy();return;}try{live();}catch{stop('LIVENESS');}},POLL_MS);
    async function completeExecution(){
      try{
        live();const result=await executor.run({jobId:session.record.identity.jobId,originalBytes:original,seccompBytes:seccomp,signal:aborter.signal});live();
        const row=registry.get(session.record.identity.jobId),report=result.workerReport;
        check(result.cleanupConfirmed===true&&result.capacityHeld===false&&result.epochPoisoned===false&&result.failure===null&&row?.phase==='FINALIZED'&&report&&report.requestId===request.requestId&&['SUCCESS','INVALID_IMAGE'].includes(report.outcome),'DECODER_BROKER_CLEANUP_UNKNOWN');
        if(report.outcome==='SUCCESS')check(report.validation.sha256===request.plan.sha256&&report.validation.byteCount===request.plan.byteCount&&report.validation.contentType===request.plan.declaredType&&report.validation.width*report.validation.height<=plan.profile.limits.maxPixels,'DECODER_BROKER_SOURCE');
        check(reader.status().bufferedBytes===0&&pendingInputBytes===0&&socket.readableLength===0&&captured===null,'DECODER_BROKER_TRAILING_INPUT');
        await write(socket,'TERMINAL',{schema:TARGET_BROKER_SCHEMA,...MARKERS,requestId:request.requestId,nonce,bindingHash:bound.bindingHash,jobId:row.identity.jobId,outcome:report.outcome,reportedCleanup:'OBSERVED',validation:report.validation});live();
        completed=true;socket.end(()=>socket.destroy());
      }catch{stop('EXECUTION_UNCERTAIN');}
      finally{original?.fill(0);}
    }
    async function frame(type,value){
      live();
      if(type==='CANCEL'){check(request&&value.requestId===request.requestId&&value.nonce===nonce,'DECODER_BROKER_PROTOCOL');stop('CANCELLED');return;}
      if(type==='START'){
        check(request===null&&value.nonce===nonce&&value.bindingHash===bound.bindingHash&&!seen.has(value.requestId),'DECODER_BROKER_PROTOCOL');
        const now=time(observer),end=brokerNanoseconds(value.deadlineBootNs);check(end>now&&end<=connectionDeadline&&end-now<=BigInt(plan.profile.limits.timeoutMs)*1000000n&&value.plan.byteCount<=plan.profile.limits.maxObjectBytes,'DECODER_BROKER_DEADLINE');
        request=value;deadline=end;
        session.record=registry.reserve({requestId:value.requestId,requestPlan:value.plan,deadlineBootNs:value.deadlineBootNs});seen.add(value.requestId);live();
        collector=createTargetBrokerInputCollector(value.plan);
        await write(socket,'ACCEPT',{requestId:value.requestId,nonce,jobId:session.record.identity.jobId,deadlineBootNs:session.record.deadlineAtNs});live();accepted=true;return;
      }
      check(accepted&&request&&collector&&!inputEnded,'DECODER_BROKER_PROTOCOL');
      if(type==='DATA'){
        collector.feed(value);
        // Buffered socket reads and resolved promises can otherwise monopolize
        // microtasks. Give the independent guard channel a poll opportunity
        // after each bounded frame; recheck the same original deadline/peer.
        await yieldToIO();live();return;
      }
      check(type==='INPUT_END'&&value.requestId===request.requestId&&value.nonce===nonce,'DECODER_BROKER_SOURCE');
      original=collector.end();inputEnded=true;runPromise=completeExecution();
    }
    session.done=(async()=>{
      try{
        await write(socket,'HELLO',{schema:TARGET_BROKER_SCHEMA,...bound,profileHash:plan.profileHash,limitsHash:plan.limitsHash,nonce,nowNs:String(live())});
        for await(const chunk of socket){
          if(completed){poison(session,'TRAILING_INPUT');check(false,'DECODER_BROKER_PROTOCOL');}let offset=0;pendingInputBytes=chunk.length;
          try{while(offset<chunk.length){live();const state=reader.status(),count=Math.min(chunk.length-offset,state.allocatedBytes-state.bufferedBytes);check(count>0,'DECODER_BROKER_PROTOCOL');reader.feed(chunk.subarray(offset,offset+count));offset+=count;pendingInputBytes=chunk.length-offset;if(captured){const next=captured;captured=null;try{await frame(next.type,next.value);}finally{if(next.type==='DATA')next.value.fill(0);}}}}finally{pendingInputBytes=0;chunk.fill(0);}
        }
        reader.end();if(!completed)stop('DISCONNECT');
      }catch{if(!completed)stop('PROTOCOL');else socket.destroy();}
      finally{clearInterval(poll);if(runPromise)await runPromise;original?.fill(0);collector?.close();if(captured?.type==='DATA')captured.value.fill(0);reader.close();peer.close();socket.destroy();if(active===session)active=null;}
    })();session.done.catch(()=>{stop('UNEXPECTED');if(active===session)active=null;});
  });
  server.maxConnections=2;
  server.on('error',()=>{poisoned=true;active?.stop();});
  owners.add(registry);
  try{
    healthy();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen({path:TARGET_BROKER_SOCKET,backlog:1},()=>{server.off('error',reject);resolve();});});
    chownSync(TARGET_BROKER_SOCKET,0,plan.profile.ipc.clientGid);chmodSync(TARGET_BROKER_SOCKET,0o660);socketStamp=endpoint(plan);ready=true;healthy();
  }catch(cause){seccomp.fill(0);server.close(()=>{});throw cause;}
  return Object.freeze({...MARKERS,
    status(){return decoderFreeze({...MARKERS,...bound,closed,poisoned:poisoned||registry.status().poisoned,activeConnections:active?1:0,requests:seen.size,rejectedConnections:rejected});},
    close(){if(closePromise)return closePromise;closed=true;ready=false;const pending=active;pending?.stop();closePromise=(async()=>{if(pending)await pending.done;await new Promise(resolve=>{if(server.listening)server.close(resolve);else resolve();});await executor.close();seccomp.fill(0);return this.status();})();return closePromise;}
  });
}

/** Source-owned origin checks only. No caller method, JSON receipt or fresh
 * admission capability is accepted. Historical outcomes need no renewed lease. */
export function assertProofDecoderTargetBrokerClient(value){check(targetClients.has(value),'DECODER_BROKER_CLIENT_REQUIRED');return value;}
export function assertProofDecoderPreparedSubmission(value,options){
  const {client}=engineDataOptions(options,['client']),owner=targetClients.get(assertProofDecoderTargetBrokerClient(client)),record=owner.handles.get(value);
  check(record&&!record.claimed&&record.state==='PREPARED','DECODER_BROKER_PREPARED_HANDLE');return record.report;
}
/** Consume the old key synchronously, transferring the SAME prepared record.
 * The caller must retain the replacement privately after durable registration;
 * no bytes, deadline, timer, request ID or disposition is regenerated. */
export function takeProofDecoderPreparedSubmission(value,options){
 const {client}=engineDataOptions(options,['client']),request=assertProofDecoderPreparedSubmission(value,{client}),owner=targetClients.get(client),status=client.status(),now=time(owner.observer);
 check(!status.closed&&!status.quarantined&&now<brokerNanoseconds(request.deadlineBootNs),'DECODER_BROKER_DEADLINE');
 const record=owner.handles.get(value),handle=Object.freeze({});owner.handles.delete(value);owner.handles.set(handle,record);
 return Object.freeze({handle,request,observedAtBootNs:String(now)});
}
export function assertProofDecoderPreparedSubmissionBeforeDeadline(value,options){
 const {client}=engineDataOptions(options,['client']),request=assertProofDecoderPreparedSubmission(value,{client}),owner=targetClients.get(client),status=client.status(),now=time(owner.observer);
 check(!status.closed&&!status.quarantined&&now<brokerNanoseconds(request.deadlineBootNs),'DECODER_BROKER_DEADLINE');return request;
}
export function assertProofDecoderClientOutcome(value,options){
  const {client}=engineDataOptions(options,['client']),owner=targetClients.get(assertProofDecoderTargetBrokerClient(client)),observation=owner.outcomes.get(value);
  check(observation,'DECODER_BROKER_DISPOSITION_REQUIRED');return decoderFreeze({...observation,completion:observation.disposition==='COMPLETE_CLEAN'?value:null});
}

/** Stricter source-owned freshness check for a new storage preparation. This
 * is still an UNQUALIFIED transport observation, never admission authority.
 * The historical verifier above intentionally retains its existing semantics. */
export function assertProofDecoderClientOutcomeBeforeDeadline(value,options){
 const {client}=engineDataOptions(options,['client']),observed=assertProofDecoderClientOutcome(value,{client}),owner=targetClients.get(client),status=client.status();
 check(!status.closed&&!status.quarantined&&observed.request,'DECODER_BROKER_OUTCOME_UNAVAILABLE');
 check(time(owner.observer)<brokerNanoseconds(observed.request.deadlineBootNs),'DECODER_BROKER_DEADLINE');
 return observed;
}

/** Nonroot application-side transport only. No Engine socket, registry, guard,
 * qualification constructor, proof publication or fresh capability is exposed. */
export function createProofDecoderTargetBrokerClient(options={}){
  const input=engineDataOptions(options,[],['enabled','plan','observer','expectedBootId','expectedEpoch','expectedBindingHash']);
  if(input.enabled!==true)return null;
  const plan=launch(input.plan),observer=assertProofDecoderLinuxObserver(input.observer),ipc=plan.profile.ipc;
  check(process.getuid()===ipc.clientUid&&process.getgid()===ipc.clientGid,'DECODER_BROKER_CLIENT_IDENTITY');
  check(typeof input.expectedBootId==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(input.expectedBootId)&&typeof input.expectedEpoch==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(input.expectedEpoch)&&typeof input.expectedBindingHash==='string'&&/^[a-f0-9]{64}$/.test(input.expectedBindingHash),'DECODER_BROKER_CONFIGURATION');
  let prepared=null,active=null,preparing=false,closed=false,quarantined=false,requests=0;
  const handles=new WeakMap(),outcomes=new WeakMap();
  const aborted=signal=>signal!==undefined&&Reflect.apply(Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get,signal,[]);
  const listen=(signal,callback,add)=>{if(signal)Reflect.apply(EventTarget.prototype[add?'addEventListener':'removeEventListener'],signal,['abort',callback,...(add?[{once:true}]:[])]);};
  function observe(value,disposition,record=null){
    outcomes.set(value,decoderFreeze({schema:'atlas-proof-decoder-client-disposition-v1',...MARKERS,disposition,request:record?.report??null}));return value;
  }
  function wipe(record){record.original?.fill(0);record.original=null;}
  function releasePrepared(record){clearInterval(record.poll);listen(record.signal,record.abort,false);if(prepared===record)prepared=null;}
  function retire(record,value){releasePrepared(record);wipe(record);record.state='RETIRED';record.outcome=observe(value,'KNOWN_NO_START_SENT',record);return record.outcome;}
  function unclaimed(handle){const record=handles.get(handle);check(record&&!record.claimed,'DECODER_BROKER_PREPARED_HANDLE');return record;}
  const client=Object.freeze({...MARKERS,
    status(){return decoderFreeze({...MARKERS,closed,quarantined,prepared:prepared?1:0,active:active?1:0,occupiedSlots:preparing||prepared||active||quarantined?1:0,retainedOriginalBytes:prepared?.original?.length??active?.record.original?.length??0,requests});},
    prepareRequest(options){
      let original=null,record=null,ownsPreparation=false;
      try{
        check(!closed&&!quarantined&&!preparing&&!prepared&&!active&&requests<128,'DECODER_BROKER_UNAVAILABLE');
        preparing=true;ownsPreparation=true;
        const began=time(observer),deadline=began+BigInt(plan.profile.limits.timeoutMs)*1000000n;
        check(deadline<=18446744073709551615n,'DECODER_BROKER_CLOCK');
        const value=engineDataOptions(options,['bytes','plan'],['signal']);
        check(Buffer.isBuffer(value.bytes)&&value.bytes.length>0&&value.bytes.length<=plan.profile.limits.maxObjectBytes,'DECODER_BROKER_SOURCE');
        original=Buffer.from(value.bytes);
        const requestPlan=decoderFreeze(decoderContractData(value.plan));assertProofDecoderPlan(requestPlan);
        check(original.length===requestPlan.byteCount&&engineBytesHash(original)===requestPlan.sha256,'DECODER_BROKER_SOURCE');
        check(value.signal===undefined||value.signal instanceof AbortSignal,'DECODER_BROKER_CONFIGURATION');
        check(!aborted(value.signal),'DECODER_BROKER_CANCELLED');check(time(observer)<deadline,'DECODER_BROKER_DEADLINE');
        check(!closed&&!quarantined&&!prepared&&!active,'DECODER_BROKER_UNAVAILABLE');
        const report=decoderFreeze({schema:'atlas-proof-decoder-prepared-request-v1',...MARKERS,requestId:randomUUID(),deadlineBootNs:String(deadline),plan:requestPlan,bootId:input.expectedBootId,epoch:input.expectedEpoch,bindingHash:input.expectedBindingHash,profileHash:plan.profileHash,limitsHash:plan.limitsHash});
        const handle=Object.freeze({report});record={report,original,signal:value.signal,deadline,state:'PREPARED',claimed:false,poll:null,abort:null,outcome:null};
        record.abort=()=>{if(record.state==='PREPARED')retire(record,error('DECODER_BROKER_CANCELLED'));};
        handles.set(handle,record);prepared=record;requests++;
        listen(record.signal,record.abort,true);
        record.poll=setInterval(()=>{if(record.state!=='PREPARED')return;try{check(!aborted(record.signal),'DECODER_BROKER_CANCELLED');check(time(observer)<deadline,'DECODER_BROKER_DEADLINE');}catch{retire(record,error('DECODER_BROKER_PREPARED_EXPIRED'));}},POLL_MS);record.poll.unref();
        return handle;
      }catch{const failure=error('DECODER_BROKER_PREPARATION');if(record)throw retire(record,failure);original?.fill(0);throw observe(failure,'KNOWN_NO_START_SENT');}
      finally{if(ownsPreparation)preparing=false;}
    },
    discardPrepared(handle){
      const record=unclaimed(handle);record.claimed=true;
      if(record.state==='RETIRED')throw record.outcome;
      check(record.state==='PREPARED'&&prepared===record,'DECODER_BROKER_PREPARED_HANDLE');
      return retire(record,decoderFreeze({schema:'atlas-proof-decoder-discarded-request-v1',...MARKERS,requestId:record.report.requestId}));
    },
    lookupDisposition(value){const observation=outcomes.get(value);check(observation,'DECODER_BROKER_DISPOSITION_REQUIRED');return observation;},
    async request(options){return client.submitPrepared(client.prepareRequest(options));},
    async submitPrepared(handle){
      const record=unclaimed(handle);record.claimed=true;
      if(record.state==='RETIRED')throw record.outcome;
      check(record.state==='PREPARED'&&prepared===record,'DECODER_BROKER_PREPARED_HANDLE');
      try{check(!closed&&!quarantined&&!active,'DECODER_BROKER_UNAVAILABLE');check(!aborted(record.signal),'DECODER_BROKER_CANCELLED');check(time(observer)<record.deadline,'DECODER_BROKER_DEADLINE');}
      catch{throw retire(record,error('DECODER_BROKER_NOT_SUBMITTED'));}
      releasePrepared(record);record.state='ACTIVE';
      const {original,signal}=record,{requestId,plan:requestPlan}=record.report,deadline=record.deadline;

      const job={cancel:null,done:null,record};active=job;
      job.done=new Promise((resolve,reject)=>{
        let socket,peer,directoryStamp,socketStamp,nonce=null,jobId=null,stage='HELLO',sentStart=false,inputEndSent=false,terminal=null,settled=false,localClosed=false,final=null,poll,sending=null,cancelReason=null;
        const reader=createTargetBrokerFrameReader({allowedTypes:['HELLO','ACCEPT','TERMINAL'],maxFrames:3,maxTotalBytes:8192,onFrame(type,message){
          live();check(!terminal,'DECODER_BROKER_PROTOCOL');
          if(type==='HELLO'){
            check(stage==='HELLO'&&message.bootId===input.expectedBootId&&message.epoch===input.expectedEpoch&&message.bindingHash===input.expectedBindingHash&&message.profileHash===plan.profileHash&&message.limitsHash===plan.limitsHash,'DECODER_BROKER_BINDING');
            const observed=brokerNanoseconds(message.nowNs),now=time(observer);check(observed<=now&&now-observed<=1000000000n,'DECODER_BROKER_STALE');nonce=message.nonce;stage='ACCEPT';sentStart=true;
            void write(socket,'START',{requestId,nonce,bindingHash:input.expectedBindingHash,deadlineBootNs:String(deadline),plan:requestPlan}).catch(()=>finish(error('DECODER_BROKER_TRANSPORT')));
          }else{
            check(message.requestId===requestId&&message.nonce===nonce,'DECODER_BROKER_BINDING');
            if(type==='ACCEPT'){check(stage==='ACCEPT'&&message.deadlineBootNs===String(deadline),'DECODER_BROKER_PROTOCOL');jobId=message.jobId;stage='DATA';sending=sendOriginal();sending.catch(()=>finish(error('DECODER_BROKER_TRANSPORT')));}
            else{
              check(stage==='TERMINAL'&&inputEndSent&&message.jobId===jobId&&message.bindingHash===input.expectedBindingHash,'DECODER_BROKER_PROTOCOL');
              if(message.outcome==='SUCCESS')check(message.validation.sha256===requestPlan.sha256&&message.validation.byteCount===requestPlan.byteCount&&message.validation.contentType===requestPlan.declaredType&&message.validation.width*message.validation.height<=plan.profile.limits.maxPixels,'DECODER_BROKER_SOURCE');
              terminal=message;stage='EOF';
            }
          }
        }});
        function live(){check(!settled&&!cancelReason&&!aborted(signal)&&time(observer)<deadline,'DECODER_BROKER_DEADLINE');check(directory(plan)===directoryStamp&&endpoint(plan)===socketStamp,'DECODER_BROKER_SOCKET');check(peer,'DECODER_BROKER_PEER');peer.assertAlive();}
        function complete(){if(!final||!localClosed)return;const outcome=final;final=null;active=null;outcome.cause?reject(outcome.cause):resolve(outcome.report);}
        function finish(cause,report){
          if(settled)return;settled=true;clearInterval(poll);listen(signal,abort,false);if(cause&&sentStart)quarantined=true;wipe(record);record.state='DONE';reader.close();if(cause)observe(cause,sentStart?'UNKNOWN':'KNOWN_NO_START_SENT',record);else observe(report,'COMPLETE_CLEAN',record);final={cause,report};socket?.destroy();peer?.close();if(!socket)localClosed=true;complete();
        }
        async function sendOriginal(){
          for(let at=0;at<original.length;at+=TARGET_BROKER_CHUNK){live();await write(socket,'DATA',original.subarray(at,Math.min(original.length,at+TARGET_BROKER_CHUNK)));}
          live();inputEndSent=true;stage='TERMINAL';await write(socket,'INPUT_END',{requestId,nonce});
        }
        function cancel(code){
          if(settled)return;cancelReason??=code;
          if(!sentStart){finish(error(cancelReason));return;}
          quarantined=true;void write(socket,'CANCEL',{requestId,nonce}).finally(()=>finish(error(cancelReason))).catch(()=>{});
        }
        const abort=()=>cancel('DECODER_BROKER_CANCELLED');job.cancel=()=>cancel('DECODER_BROKER_CLOSED');listen(signal,abort,true);
        try{
          directoryStamp=directory(plan);socketStamp=endpoint(plan);
          socket=createConnection({path:TARGET_BROKER_SOCKET,allowHalfOpen:true});
          socket.on('connect',()=>{try{check(directory(plan)===directoryStamp&&endpoint(plan)===socketStamp,'DECODER_BROKER_SOCKET');peer=observer.capture(socket,{uid:ipc.supervisorUid,gid:ipc.supervisorGid});check(peer.assertAlive().pid!==process.pid,'DECODER_BROKER_INDEPENDENCE');live();}catch{finish(error('DECODER_BROKER_PEER'));}});
          socket.on('data',chunk=>{if(settled)return;try{reader.feed(chunk);}catch{finish(error('DECODER_BROKER_PROTOCOL'));}});
          socket.on('end',()=>{void(async()=>{try{live();reader.end();check(terminal,'DECODER_BROKER_TRUNCATED');if(sending)await sending;live();check(terminal.outcome!=='QUARANTINED','DECODER_BROKER_CLEANUP_UNKNOWN');finish(null,decoderFreeze({...terminal,bootId:input.expectedBootId,epoch:input.expectedEpoch}));}catch{finish(error('DECODER_BROKER_UNCERTAIN'));}})();});
          socket.on('error',()=>finish(error('DECODER_BROKER_TRANSPORT')));
          socket.on('close',()=>{localClosed=true;if(!settled)finish(error('DECODER_BROKER_UNCERTAIN'));else complete();});
          poll=setInterval(()=>{try{if(aborted(signal))cancel('DECODER_BROKER_CANCELLED');check(!cancelReason&&time(observer)<deadline,'DECODER_BROKER_DEADLINE');if(peer)live();}catch{finish(error(cancelReason??'DECODER_BROKER_DEADLINE'));}},POLL_MS);
        }catch{finish(error('DECODER_BROKER_TRANSPORT'));}
      });return job.done;
    },
    async close(){closed=true;if(prepared)retire(prepared,error('DECODER_BROKER_CLOSED'));const job=active;job?.cancel?.();if(job)try{await job.done;}catch{}return this.status();}
  });targetClients.set(client,{handles,outcomes,observer});return client;
}
