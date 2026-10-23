import http from 'node:http';
import {setImmediate as yieldToIO} from 'node:timers/promises';
import {performance} from 'node:perf_hooks';
import {canonicalJSON,requireValue} from './contract.mjs';
import {assertProofDecoderLaunchPlan,decoderFreeze} from './proof-decoder-profile.mjs';
import {proofDecoderOwnedIdentity} from './proof-decoder-owned-operations.mjs';
import {engineBytesHash,engineDataOptions} from './proof-decoder-engine-json.mjs';
import {compileProofDecoderEngineRequest} from './proof-decoder-engine-request.mjs';
import {projectProofDecoderEngineResponse} from './proof-decoder-engine-response.mjs';
import {assertProofDecoderFixedParentBinding,assertProofDecoderFixedParentReport} from './proof-decoder-engine-target-binding.mjs';
import {createProofDecoderEngineTransport} from './proof-decoder-engine-transport.mjs';
import {assertProofDecoderControlProbeLaunchPlan,createProofDecoderEngineControlProbeTransport,assertProofDecoderControlProbeRequest,PROOF_DECODER_CONTROL_PROBE_IMAGE,PROOF_DECODER_CONTROL_PROBE_CLEANUP} from './proof-decoder-engine-control-probe-transport.mjs';
import {assertProofDecoderTargetRegistry} from './proof-decoder-target-registry.mjs';
import {assertProofDecoderLinuxCgroupController} from './proof-decoder-linux-cgroup.mjs';
import {assertProofDecoderKernelGuardClient} from './proof-decoder-kernel-guard.mjs';
import {createProofDecoderEngineTargetEndpoint} from './proof-decoder-engine-target-endpoint.mjs';

const effectReceipts=new WeakMap(),exitObservations=new WeakMap(),cleanupReceipts=new WeakMap(),decodedJobs=new WeakMap(),probeJobs=new WeakMap();
const MARKERS={classification:'UNQUALIFIED',executionAllowed:false};
const check=(value,code='ENGINE_TARGET_INVALID')=>requireValue(value,code);
const fault=code=>Object.assign(new Error(code),{code});
const same=(a,b)=>canonicalJSON(a)===canonicalJSON(b);
const requestHash=request=>engineBytesHash(Buffer.from(canonicalJSON(request.http)));
const now=controller=>controller.boottimeNanoseconds();
const decimal=value=>typeof value==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(value)&&BigInt(value)<=18446744073709551615n;

function context(input) {
  const plan=assertProofDecoderLaunchPlan(input.plan),controller=assertProofDecoderLinuxCgroupController(input.parentController);
  const registry=assertProofDecoderTargetRegistry(input.targetRegistry,{plan,controller});
  const targetBinding=assertProofDecoderFixedParentBinding(input.targetBinding,{plan});
  check(input.apiVersion==='1.47');
  const endpoint=createProofDecoderEngineTargetEndpoint({enabled:true,socketPath:input.socketPath,linuxObserver:input.linuxObserver});
  const bindingHash=registry.status().bindingHash;
  check(typeof bindingHash==='string'&&/^[a-f0-9]{64}$/.test(bindingHash));
  return {plan,controller,registry,targetBinding,bindingHash,endpoint,linuxObserver:input.linuxObserver,apiVersion:input.apiVersion,socketPath:input.socketPath};
}
function current(c,jobId) {
  const row=c.registry.get(jobId);
  check(row&&row.bindingHash===c.bindingHash,'ENGINE_TARGET_OWNERSHIP');
  proofDecoderOwnedIdentity(row.identity,c.plan);
  check(decimal(row.deadlineAtNs),'ENGINE_TARGET_DEADLINE');
  return row;
}
function healthy(c,row) {
  c.endpoint.assertCurrent();
  if(c.guardClient)c.guardClient.assertLive(c.guardLease);
  const state=c.registry.status(),parent=c.controller.status();
  check(!c.closed&&!state.poisoned&&!state.closed&&parent.healthy&&!parent.closed&&!parent.freezeRequested&&!parent.frozen,'ENGINE_TARGET_QUARANTINED');
  check(parent.bindingHash===state.parentBindingHash&&parent.bootId===state.bootId,'ENGINE_TARGET_PARENT');
  check(now(c.controller)<BigInt(row.deadlineAtNs),'ENGINE_TARGET_DEADLINE');
}
function poison(c,jobId) {
  // Keep every pending intent. Failure to persist poison cannot permit reuse.
  try{c.registry.quarantineEpoch({reason:'ENGINE_TARGET_UNCERTAIN',jobId});}catch{}
  try{c.controller.freezeAndKill();}catch{}
}
function mintEffect(c,before,intent,operation,compiled,report) {
  const status=operation==='CREATE'?201:204;
  check(report.statusCode===status&&report.kind===operation+'_REPORTED','ENGINE_TARGET_EFFECT_UNCERTAIN');
  const receipt=decoderFreeze({schema:'atlas-proof-decoder-engine-effect-observation-v1',classification:'UNQUALIFIED',
    evidenceOrigin:'ENGINE_SOCKET_REPORT',identity:before.identity,operationId:intent.operationId,operation,
    requestHash:requestHash(compiled),containerId:operation==='CREATE'?report.data.containerId:before.identity.containerId,
    status,observedAtNs:now(c.controller).toString(),bindingHash:c.bindingHash});
  effectReceipts.set(receipt,receipt);return receipt;
}

/** These verifiers accept only private objects minted after this module's actual
 * bounded socket operation. There is no receipt constructor or JSON rebranding.
 */
export function assertProofDecoderEngineEffectReceipt(value,{identity,operation,operationId,requestHash:expectedHash,bindingHash}) {
  const receipt=effectReceipts.get(value);
  check(receipt&&same(receipt.identity,identity)&&receipt.operation===operation&&receipt.operationId===operationId&&
    receipt.requestHash===expectedHash&&receipt.bindingHash===bindingHash,'ENGINE_TARGET_EFFECT_RECEIPT_REQUIRED');
  return receipt;
}
export function assertProofDecoderOwnedEngineCleanupReceipt(value,{identity,bindingHash,barrierId}) {
  const receipt=cleanupReceipts.get(value);
  check(receipt&&same(receipt.identity,identity)&&receipt.bindingHash===bindingHash&&receipt.barrierId===barrierId,'ENGINE_TARGET_CLEANUP_RECEIPT_REQUIRED');
  return receipt;
}
export function assertProofDecoderEngineExitObservation(value,{identity,bindingHash,barrierId}) {
  const receipt=exitObservations.get(value);
  check(receipt&&same(receipt.identity,identity)&&receipt.bindingHash===bindingHash&&receipt.barrierId===barrierId,'ENGINE_TARGET_EXIT_OBSERVATION_REQUIRED');
  return receipt;
}

/** Broker-only wrapper owns the concrete decode transport and writes its own
 * effect receipts to the same-process sole-writer ledger. No callback ports.
 */
export function createProofDecoderTargetEffectSession(options={}) {
  const input=engineDataOptions(options,[],['enabled','plan','targetRegistry','parentController','targetBinding','guardClient','guardLease',
    'socketPath','apiVersion','jobId','originalBytes','seccompBytes','headerTimeoutMs','signal','linuxObserver']);
  if(input.enabled!==true)return null;
  const c=context(input),initial=current(c,input.jobId);healthy(c,initial);
  check(initial.phase==='RESERVED'&&initial.identity.containerId===null,'ENGINE_TARGET_PHASE');
  const guard=assertProofDecoderKernelGuardClient(input.guardClient,{controller:c.controller,bindingHash:c.bindingHash});
  const lease=guard.assertLive(input.guardLease);
  check(same(lease.identity,initial.identity)&&lease.deadlineBootNs===initial.deadlineAtNs&&lease.bindingHash===c.bindingHash,'ENGINE_TARGET_LEASE');
  let jobs=decodedJobs.get(c.registry);if(!jobs){jobs=new Map();decodedJobs.set(c.registry,jobs);}
  check(!jobs.has(input.jobId)&&jobs.size<128,'ENGINE_TARGET_REPLAY');
  check(Buffer.isBuffer(input.seccompBytes)&&input.seccompBytes.length<=65536);
  const seccomp=Buffer.from(input.seccompBytes);
  let transport;
  try{
    transport=createProofDecoderEngineTransport({enabled:true,plan:c.plan,job:initial.identity,original:initial.requestPlan,
      originalBytes:input.originalBytes,seccompBytes:seccomp,socketPath:c.socketPath,apiVersion:c.apiVersion,
      deadlineMono:performance.now()+Math.min(c.plan.profile.limits.timeoutMs,Number(BigInt(initial.deadlineAtNs)-now(c.controller))/1e6),
      headerTimeoutMs:input.headerTimeoutMs,signal:input.signal,targetBinding:c.targetBinding,
      targetRuntime:{controller:c.controller,guardClient:guard,lease:input.guardLease,bindingHash:c.bindingHash,deadlineBootNs:initial.deadlineAtNs,linuxObserver:c.linuxObserver}});
  }catch(error){seccomp.fill(0);throw error;}
  const saved={identity:initial.identity,wait:null,complete:false,guardClient:guard,guardLease:input.guardLease};jobs.set(input.jobId,saved);
  let closed=false;
  function live(){check(!closed,'ENGINE_TARGET_CLOSED');guard.assertLive(input.guardLease);healthy(c,current(c,input.jobId));}
  return Object.freeze({...MARKERS,
    async request(operation){
      await yieldToIO();
      live();check(['IMAGE_INSPECT','CREATE','INSPECT','ATTACH','START','WAIT'].includes(operation),'ENGINE_TARGET_OPERATION');
      const before=current(c,input.jobId);
      try{
        let intent=null,compiled=null;
        if(operation==='CREATE'||operation==='START'){
          compiled=compileProofDecoderEngineRequest({apiVersion:c.apiVersion,plan:c.plan,job:before.identity,operation,targetBinding:c.targetBinding,
            ...(operation==='CREATE'?{seccompBytes:seccomp}:{})});
          intent=c.registry.beginEffect(input.jobId,before.revision,{operation,requestHash:requestHash(compiled)});
          live();
        }
        const report=await transport.request(operation);live();
        if(intent){
          const receipt=mintEffect(c,before,intent,operation,compiled,report);
          c.registry.observeEffect(input.jobId,intent.revision,{operationId:intent.operationId,receipt});
          saved.identity=current(c,input.jobId).identity;
        }
        if(operation==='WAIT')saved.wait=report;
        if(operation==='IMAGE_INSPECT')saved.imageId=report.data.imageId;
        if(operation==='INSPECT'&&report.data?.state?.running)saved.startedAt=report.data.state.startedAt;
        return report;
      }catch(error){poison(c,input.jobId);throw error;}
    },
    async sendOriginal(){try{live();await transport.sendOriginal();live();}catch(error){poison(c,input.jobId);throw error;}},
    async complete(){
      try{
        await yieldToIO();
        live();const output=await transport.outputComplete();live();const review=transport.review();
        check(review.reviewStatus==='DECODE_REPORTED_CLEANUP_UNVERIFIED'&&saved.wait?.kind==='WAIT_REPORTED','ENGINE_TARGET_DECODE_INCOMPLETE');
        await yieldToIO();live();
        saved.complete=true;saved.waitExitCode=saved.wait.data.exitCode;
        return decoderFreeze({...MARKERS,workerReport:output.workerReport,review});
      }catch(error){poison(c,input.jobId);throw error;}
    },
    status(){return transport.status();},
    close(){if(!closed){closed=true;if(!saved.complete)poison(c,input.jobId);seccomp.fill(0);transport.close();}}
  });
}

/** Separate same-process producer for the finite C probe. Neither its output nor
 * its completion state enters decodedJobs or the worker validation parser. */
export function createProofDecoderTargetControlProbeSession(options={}){
  const input=engineDataOptions(options,[],['enabled','plan','targetRegistry','parentController','targetBinding','guardClient','guardLease',
    'socketPath','apiVersion','jobId','seccompBytes','headerTimeoutMs','signal','linuxObserver']);
  if(input.enabled!==true)return null;
  check(process.platform==='linux'&&process.getuid()===0&&process.getgid()===0,'ENGINE_PROBE_ROOT');
  const c=context(input),initial=current(c,input.jobId);healthy(c,initial);
  assertProofDecoderControlProbeLaunchPlan(c.plan);
  const challenge=assertProofDecoderControlProbeRequest(initial.requestPlan);
  check(initial.phase==='RESERVED'&&initial.identity.containerId===null,'ENGINE_TARGET_PHASE');
  const guard=assertProofDecoderKernelGuardClient(input.guardClient,{controller:c.controller,bindingHash:c.bindingHash});
  const lease=guard.assertLive(input.guardLease);
  check(same(lease.identity,initial.identity)&&lease.deadlineBootNs===initial.deadlineAtNs&&lease.bindingHash===c.bindingHash,'ENGINE_TARGET_LEASE');
  let jobs=probeJobs.get(c.registry);if(!jobs){jobs=new Map();probeJobs.set(c.registry,jobs);}
  check(!jobs.has(input.jobId)&&jobs.size<128,'ENGINE_TARGET_REPLAY');
  check(Buffer.isBuffer(input.seccompBytes)&&input.seccompBytes.length<=65536);
  const seccomp=Buffer.from(input.seccompBytes);let transport;
  try{transport=createProofDecoderEngineControlProbeTransport({enabled:true,plan:c.plan,job:initial.identity,challenge,
    seccompBytes:seccomp,socketPath:c.socketPath,apiVersion:c.apiVersion,
    deadlineMono:performance.now()+Math.min(c.plan.profile.limits.timeoutMs,Number(BigInt(initial.deadlineAtNs)-now(c.controller))/1e6),
    headerTimeoutMs:input.headerTimeoutMs,signal:input.signal,targetBinding:c.targetBinding,
    targetRuntime:{controller:c.controller,guardClient:guard,lease:input.guardLease,bindingHash:c.bindingHash,deadlineBootNs:initial.deadlineAtNs,linuxObserver:c.linuxObserver}});
  }catch(error){seccomp.fill(0);throw error;}
  const saved={identity:initial.identity,complete:false,wait:null,guardClient:guard,guardLease:input.guardLease};jobs.set(input.jobId,saved);
  let closed=false,ran=false;
  function live(){check(!closed,'ENGINE_TARGET_CLOSED');guard.assertLive(input.guardLease);healthy(c,current(c,input.jobId));}
  async function request(operation){
    await yieldToIO();
    live();const before=current(c,input.jobId);let intent=null,compiled=null;
    if(operation==='CREATE'||operation==='START'){
      compiled=compileProofDecoderEngineRequest({apiVersion:c.apiVersion,plan:c.plan,job:before.identity,operation,targetBinding:c.targetBinding,...(operation==='CREATE'?{seccompBytes:seccomp}:{})});
      intent=c.registry.beginEffect(input.jobId,before.revision,{operation,requestHash:requestHash(compiled)});live();
    }
    const report=await transport.request(operation);live();
    if(intent){const receipt=mintEffect(c,before,intent,operation,compiled,report);c.registry.observeEffect(input.jobId,intent.revision,{operationId:intent.operationId,receipt});saved.identity=current(c,input.jobId).identity;}
    if(operation==='IMAGE_INSPECT')saved.imageId=report.data.imageId;
    if(operation==='INSPECT'&&report.data?.state?.running)saved.startedAt=report.data.state.startedAt;
    if(operation==='WAIT')saved.wait=report;
    return report;
  }
  return Object.freeze({...MARKERS,evidenceKind:'PROBE_ONLY',freshPublicationAllowed:false,runtimeQualified:false,
    async run(){
      try{
        check(!ran,'ENGINE_TARGET_REPLAY');ran=true;live();
        for(const operation of ['IMAGE_INSPECT','CREATE','INSPECT','ATTACH','START','INSPECT'])await request(operation);
        await transport.sendChallenge();live();
        await request('WAIT');const output=await transport.outputComplete();live();
        const report=output.probeReport;
        check(!['MEMORY_OOM','CPU_DEADLINE'].includes(challenge.mode)&&report.state==='ENDED'&&report.final?.completion==='COMPLETE'&&report.final?.reason==='NORMAL'&&saved.wait?.kind==='WAIT_REPORTED'&&saved.wait.data.exitCode===0,'ENGINE_PROBE_INCOMPLETE_HOLD');
        saved.complete=true;saved.waitExitCode=0;
        return decoderFreeze({...MARKERS,evidenceKind:'PROBE_ONLY',probeReport:report,inputControls:transport.status().inputControls,workerValidation:null,freshPublicationAllowed:false,runtimeQualified:false});
      }catch(error){poison(c,input.jobId);throw error;}
    },
    status(){return transport.status();},
    close(){if(!closed){closed=true;if(!saved.complete)poison(c,input.jobId);seccomp.fill(0);transport.close();}}
  });
}

function headersOf(raw) {
  check(Array.isArray(raw)&&raw.length<=64,'ENGINE_CLEANUP_HEADERS');const values={};let bytes=0;
  for(let i=0;i<raw.length;i+=2){
    const name=raw[i].toLowerCase(),value=raw[i+1];
    check(/^[a-z0-9-]{1,64}$/.test(name)&&typeof value==='string'&&!Object.hasOwn(values,name),'ENGINE_CLEANUP_HEADERS');
    bytes+=Buffer.byteLength(name)+Buffer.byteLength(value);check(bytes<=8192,'ENGINE_CLEANUP_HEADERS');values[name]=value;
  }
  check(values['content-encoding']===undefined,'ENGINE_CLEANUP_HEADERS');return values;
}

/** Only the private, already-compiled exact operation reaches HTTP. */
async function controlRequest(c,row,operation,deadline) {
  check(['INSPECT','REMOVE'].includes(operation),'ENGINE_CLEANUP_OPERATION');
  // A resolved promise is not a poll boundary. Keep queued guard frames from
  // waiting behind transcript review and successive synchronous ledger writes.
  // Every boundary is followed by the same live/ownership/deadline checks.
  await yieldToIO();healthy(c,current(c,row.identity.jobId));
  const compiled=compileProofDecoderEngineRequest({apiVersion:c.apiVersion,plan:c.plan,job:row.identity,operation,targetBinding:c.targetBinding});
  const live=()=>{healthy(c,current(c,row.identity.jobId));check(now(c.controller)<deadline,'ENGINE_CLEANUP_DEADLINE');};
  live();let intent=null;
  if(operation==='REMOVE'){
    intent=c.registry.beginEffect(row.identity.jobId,row.revision,{operation,requestHash:requestHash(compiled)});live();
    await yieldToIO();live();
  }
  const agent=new http.Agent({keepAlive:false,maxSockets:1,maxTotalSockets:1,maxFreeSockets:0});
  const connecting=new AbortController();
  agent.createConnection=(_,callback)=>{
    c.endpoint.connect({timeoutMs:Math.max(1,Math.min(500,Math.floor(Number(deadline-now(c.controller))/1e6))),signal:connecting.signal})
      .then(socket=>callback(null,socket),error=>callback(error));
  };
  try{
    const report=await new Promise((resolve,reject)=>{
      let request,requestSocket,timer,headerTimer,settled=false,buffer=Buffer.alloc(262144),used=0;
      const peerLive=()=>{live();c.endpoint.assertSocket(requestSocket);};
      const finish=(error,value)=>{
        if(settled)return;settled=true;clearTimeout(timer);clearTimeout(headerTimer);connecting.abort();buffer.fill(0);
        if(error){request?.destroy();reject(fault(error));}else resolve(value);
      };
      try{
        const remaining=Math.max(1,Math.min(1000,Number(deadline-now(c.controller))/1e6));
        timer=setTimeout(()=>finish('ENGINE_CLEANUP_DEADLINE'),remaining);
        headerTimer=setTimeout(()=>finish('ENGINE_CLEANUP_HEADER_DEADLINE'),Math.min(500,remaining));
        request=http.request({agent,socketPath:c.socketPath,host:'localhost',method:compiled.http.method,path:compiled.http.path,
          headers:{connection:'close','content-length':'0'},maxHeaderSize:8192,insecureHTTPParser:false,joinDuplicateHeaders:false},response=>{
          clearTimeout(headerTimer);let headers;
          try{peerLive();headers=headersOf(response.rawHeaders);}catch{response.destroy();finish('ENGINE_CLEANUP_RESPONSE');return;}
          response.on('data',chunk=>{
            try{peerLive();check(!settled&&used+chunk.length<=buffer.length,'ENGINE_CLEANUP_BODY_LIMIT');chunk.copy(buffer,used);used+=chunk.length;}
            catch{response.destroy();finish('ENGINE_CLEANUP_RESPONSE');}
          });
          response.on('aborted',()=>finish('ENGINE_CLEANUP_RESPONSE'));
          response.on('error',()=>finish('ENGINE_CLEANUP_RESPONSE'));
          response.on('end',()=>{
            if(settled)return;
            try{
              peerLive();check(response.complete&&response.rawTrailers.length===0,'ENGINE_CLEANUP_RESPONSE');
              const body=buffer.subarray(0,used);
              const value=projectProofDecoderEngineResponse({apiVersion:c.apiVersion,plan:c.plan,job:row.identity,operation,
                statusCode:response.statusCode,headers,body});
              if(operation==='INSPECT'&&value.kind==='CONTAINER_REPORTED')assertProofDecoderFixedParentReport({body,targetBinding:c.targetBinding,plan:c.plan});
              finish(null,value);
            }catch{finish('ENGINE_CLEANUP_RESPONSE');}
          });
        });
        request.on('socket',socket=>{requestSocket=socket;try{peerLive();}catch{finish('ENGINE_CLEANUP_SOCKET');}});
        request.on('information',()=>finish('ENGINE_CLEANUP_HEADERS'));
        request.on('upgrade',(_,socket)=>{socket.destroy();finish('ENGINE_CLEANUP_HEADERS');});
        request.on('error',()=>finish('ENGINE_CLEANUP_SOCKET'));
        live();request.end();
      }catch{finish('ENGINE_CLEANUP_SOCKET');}
    });
    live();
    if(intent){
      const receipt=mintEffect(c,row,intent,operation,compiled,report);
      c.registry.observeEffect(row.identity.jobId,intent.revision,{operationId:intent.operationId,receipt});
    }
    return report;
  }finally{connecting.abort();agent.destroy();}
}

/** Same-process cleanup owner. Success requires the in-memory actual decode
 * session, settled ledger effects and genuine kernel observations. Restarted
 * brokers cannot reconstruct those receipt brands from stored JSON.
 */
export function createProofDecoderOwnedEngineCleanup(options={}) {
  const input=engineDataOptions(options,[],['enabled','plan','targetRegistry','parentController','targetBinding','socketPath','apiVersion','linuxObserver']);
  if(input.enabled!==true)return null;
  const c=context(input);let active=false,closed=false,phases=[];
  // Bounded timing observations only; never used as a lease or permission.
  function note(phase){try{if(phases.length<16)phases.push({phase,atBootNs:String(now(c.controller))});}catch{}}
  async function finish(jobId,probe){
    const jobs=probe?probeJobs:decodedJobs;
      check(!active&&!closed,'ENGINE_CLEANUP_UNAVAILABLE');active=true;phases=[];note('ENTRY');
      try{
        let row=current(c,jobId);
        const saved=jobs.get(c.registry)?.get(jobId);
        check(saved?.complete&&same(saved.identity,row.identity)&&saved.waitExitCode!==undefined,probe?'ENGINE_CLEANUP_PROBE_REQUIRED':'ENGINE_CLEANUP_DECODE_REQUIRED');
        if(probe){assertProofDecoderControlProbeRequest(row.requestPlan);check(c.plan.profile.image===PROOF_DECODER_CONTROL_PROBE_IMAGE&&saved.waitExitCode===0,'ENGINE_CLEANUP_PROBE_REQUIRED');}
        c.guardClient=saved.guardClient;c.guardLease=saved.guardLease;
        await yieldToIO();healthy(c,row);
        const effect=operation=>row.effects.find(item=>item.operation===operation);
        check(row.phase==='RUNNING'&&row.effects.every(item=>item.receipt!==null)&&
          effect('CREATE')?.receipt.status===201&&effect('START')?.receipt.status===204&&!effect('REMOVE'),'ENGINE_CLEANUP_UNSETTLED');
        note('BARRIER_BEGIN');row=c.registry.enterCleanupBarrier(jobId,row.revision);note('BARRIER_END');healthy(c,row);
        const cleanupLimit=now(c.controller)+1000000000n;
        const deadline=cleanupLimit<BigInt(row.deadlineAtNs)?cleanupLimit:BigInt(row.deadlineAtNs);
        note('INSPECT_BEGIN');const observed=await controlRequest(c,row,'INSPECT',deadline);note('INSPECT_END');
        check(observed.kind==='CONTAINER_REPORTED'&&observed.data.imageId===saved.imageId&&observed.data.state.status==='exited'&&!observed.data.state.running&&
          !observed.data.state.paused&&!observed.data.state.restarting&&!observed.data.state.dead&&
          observed.data.state.pid===0&&observed.data.state.exitCode===saved.waitExitCode&&observed.data.state.startedAt===saved.startedAt&&
          Date.parse(observed.data.state.finishedAt)>=Date.parse(saved.startedAt),'ENGINE_CLEANUP_EXIT_UNCERTAIN');
        // Preserve exit/OOM/WAIT in the durable ledger BEFORE removal. This
        // private observation binds actual reports, not kernel authority.
        const exited=observed.data.state;
        const exitObservation=decoderFreeze({schema:'atlas-proof-decoder-engine-exit-v1',classification:'UNQUALIFIED',
          identity:row.identity,bindingHash:c.bindingHash,barrierId:row.barrierId,observedAtNs:now(c.controller).toString(),
          waitExitCode:saved.waitExitCode,state:exited});
        exitObservations.set(exitObservation,exitObservation);
        note('EXIT_RECORD_BEGIN');row=c.registry.recordExit(jobId,row.revision,{receipt:exitObservation});note('EXIT_RECORD_END');
        check(exited.oomKilled===false,'ENGINE_CLEANUP_OOM');
        c.controller.observeEmpty();healthy(c,row);
        note('REMOVE_BEGIN');const removed=await controlRequest(c,row,'REMOVE',deadline);note('REMOVE_END');
        check(removed.kind==='REMOVE_REPORTED'&&removed.statusCode===204,'ENGINE_CLEANUP_REMOVE_UNCERTAIN');
        row=current(c,jobId);
        note('ABSENCE_BEGIN');const absent=await controlRequest(c,row,'INSPECT',deadline);note('ABSENCE_END');
        check(absent.kind==='NOT_FOUND_REPORTED','ENGINE_CLEANUP_ABSENCE_UNCERTAIN');
        healthy(c,row);
        const remove=row.effects.find(item=>item.operation==='REMOVE');
        const receipt=decoderFreeze({schema:probe?PROOF_DECODER_CONTROL_PROBE_CLEANUP:'atlas-proof-decoder-owned-engine-cleanup-v1',classification:'UNQUALIFIED',identity:row.identity,
          bindingHash:c.bindingHash,barrierId:row.barrierId,lastRemoveAtNs:remove.receipt.observedAtNs,observedAtNs:now(c.controller).toString(),
          createOperationId:effect('CREATE').operationId,startOperationId:effect('START').operationId,removeOperationId:remove.operationId,
          waitExitCode:saved.waitExitCode,absentAfterRemove:true,settled:true});
        cleanupReceipts.set(receipt,receipt);
        await yieldToIO();healthy(c,row);
        check(now(c.controller)<deadline,'ENGINE_CLEANUP_DEADLINE');
        const nativeEmpty=c.controller.observeEmpty();
        note('FINALIZE_BEGIN');const final=c.registry.finalize(jobId,row.revision,{settledCleanup:receipt,nativeEmpty});note('FINALIZE_END');
        jobs.get(c.registry).delete(jobId);return decoderFreeze({...MARKERS,record:final,cleanup:receipt});
      }catch(error){note('FAILURE');poison(c,jobId);throw error;}finally{c.guardClient=null;c.guardLease=null;active=false;}
  }
  return Object.freeze({...MARKERS,
    finishSettledJob(jobId){return finish(jobId,false);},
    finishSettledControlProbe(jobId){return finish(jobId,true);},
    status(){return decoderFreeze({...MARKERS,active,closed,phases:[...phases]});},
    stopKnownJob(jobId){
      const row=current(c,jobId);
      // No competing Engine intent is appended over unknown CREATE/START.
      // Whole-parent native freeze/kill is independent of any daemon report.
      poison(c,jobId);
      return decoderFreeze({...MARKERS,identity:row.identity,capacityHeld:true,cleanup:'UNKNOWN'});
    },
    close(){closed=true;c.closed=true;}
  });
}

