import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {canonicalJSON,hash,requireValue} from './contract.mjs';
import {assertProofDecoderLaunchPlan,PROOF_DECODER_RUNTIME_ENVIRONMENT,decoderFreeze} from './proof-decoder-profile.mjs';
import {buildProofDecoderOwnedOperation,proofDecoderOwnedIdentity} from './proof-decoder-owned-operations.mjs';
import {encodeProofDecoderWorkerRequestHeader,createProofDecoderWorkerResultReader,assertProofDecoderWorkerResult} from './proof-decoder-worker-protocol.mjs';

const executors=new WeakMap(),cleanupReceipts=new WeakMap();
const worker=fileURLToPath(new URL('./proof-decoder-worker.mjs',import.meta.url));
const check=(value,code='DECODER_FIXTURE_EXECUTOR_INVALID')=>requireValue(value,code);
const fault=code=>Object.assign(new Error(code),{code,classification:'UNQUALIFIED'});
async function joinWithin(promise,deadline) {let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(fault('DECODER_CLEANUP_UNCONFIRMED')),Math.max(1,deadline-performance.now()));})]);}finally{clearTimeout(timer);}}

/** Local subprocess experiment, NEVER Docker or OS containment. Scenarios are
 * sealed test controls; no injected command, path, environment or callback. */
export function createLocalFixtureDecoderExecutor({enabled=false,plan:input,scenario='REAL_WORKER'}={}) {
  if(enabled!==true)return null;
  const plan=assertProofDecoderLaunchPlan(input);
  check(['REAL_WORKER','CREATE_FAIL','CREATE_LOST_REPLY','START_FAIL','CLEANUP_UNKNOWN','FOREIGN_LOOKUP','MODEL_ONLY'].includes(scenario));
  const containers=new Map(),events=[];let closed=false,discardedEvents=0;
  const identity=job=>proofDecoderOwnedIdentity(job.identity??job,plan);
  function record(operation,job) {const op=buildProofDecoderOwnedOperation({plan,job:identity(job),operation});if(events.length===512){events.shift();discardedEvents++;}events.push({operation,jobId:op.job.jobId,containerId:op.job.containerId});return op.job;}
  function find(job) {const id=identity(job),item=containers.get(id.jobId);if(item)check(canonicalJSON({...item.identity,containerId:null})===canonicalJSON({...id,containerId:null})&&(id.containerId===null||item.identity.containerId===id.containerId),'DECODER_FOREIGN_CONTAINER');check(item,'DECODER_FIXTURE_OWNERSHIP_UNKNOWN');return item;}
  const processState=item=>item.exited?'EXITED':item.child||item.startedAt!==null?'RUNNING':'NOT_STARTED';
  const view=item=>item&&item.created&&!item.removed?decoderFreeze({classification:'UNQUALIFIED',evidenceOrigin:'LOCAL_FIXTURE',identity:{...item.identity},startedAt:item.startedAt,processState:processState(item),pid:item.child?.pid??null}):null;
  const executor=Object.freeze({classification:'UNQUALIFIED',evidenceOrigin:'LOCAL_FIXTURE',
    adoptJob(job) {check(!closed,'DECODER_FIXTURE_EXECUTOR_CLOSED');const id=identity(job);check(job.phase==='RESERVED'&&id.containerId===null&&!containers.has(id.jobId),'DECODER_FIXTURE_OWNERSHIP_UNKNOWN');check(containers.size<128,'DECODER_FIXTURE_CAPACITY');containers.set(id.jobId,{identity:{...id},created:false,startedAt:null,exited:false,removed:false,child:null,done:null,deadlineMono:null});},
    async create(job,{deadlineMono=performance.now()+Math.min(plan.profile.limits.timeoutMs,Math.max(0,job.deadlineAt-Date.now()))}={}) {
      check(!closed,'DECODER_FIXTURE_EXECUTOR_CLOSED');const id=record('CREATE',job);check(Number.isFinite(deadlineMono)&&performance.now()<deadlineMono,'DECODER_DEADLINE');const item=find(job);check(!item.created&&!item.removed,'DECODER_CREATE_REPLAY');item.deadlineMono=deadlineMono;
      if(scenario==='CREATE_FAIL')throw fault('DECODER_CREATE_FAILED');
      item.identity={...id,containerId:randomBytes(32).toString('hex')};item.created=true;
      if(scenario==='CREATE_LOST_REPLY')throw fault('DECODER_CREATE_UNKNOWN');return view(item);
    },
    async lookup(job) {record('LOOKUP',job);const found=view(find(job));if(found&&scenario==='FOREIGN_LOOKUP')return decoderFreeze({...found,identity:{...found.identity,ownerNonce:'0'.repeat(64)}});return found;},
    async start(job,{request}) {
      check(!closed,'DECODER_FIXTURE_EXECUTOR_CLOSED');record('START',job);const item=find(job);check(item.created&&!item.removed&&item.startedAt===null&&!item.child);check(performance.now()<item.deadlineMono,'DECODER_DEADLINE');
      if(scenario==='START_FAIL')throw fault('DECODER_START_FAILED');
      const header=encodeProofDecoderWorkerRequestHeader(request);
      if(scenario==='MODEL_ONLY') {
        item.startedAt=Date.now();let resolveResult;item.done=new Promise(resolve=>{item.finish=()=>{item.exited=true;resolve();};});
        const result=new Promise(resolve=>{resolveResult=resolve;});item.modelFinish=()=>{resolveResult({schema:'atlas-proof-decoder-worker-result-v1',requestId:request.requestId,outcome:'DECODER_FAILURE',validation:null});item.finish();};
        return Object.freeze({startedAt:item.startedAt,async write(){check(!item.exited);},async end(){item.modelFinish();},result});
      }
      const child=spawn(process.execPath,['--max-old-space-size=128',worker],{env:{...PROOF_DECODER_RUNTIME_ENVIRONMENT},stdio:['pipe','pipe','pipe']});item.child=child;
      const reader=createProofDecoderWorkerResultReader();let failure=null,stdoutEnded=false,parsed=null,stderrBytes=0,exitCode=null,exitSignal=null;
      const fail=code=>{failure??=code;child.kill('SIGKILL');};
      const timer=setTimeout(()=>fail('DECODER_DEADLINE'),Math.max(1,item.deadlineMono-performance.now()));
      child.stdout.on('data',chunk=>{try{reader.feed(chunk);}catch{fail('DECODER_WORKER_UNAVAILABLE');}});
      child.stdout.on('end',()=>{stdoutEnded=true;try{parsed=reader.end();}catch{failure??='DECODER_WORKER_UNAVAILABLE';}});
      child.stderr.on('data',chunk=>{stderrBytes+=chunk.length;if(stderrBytes>4096)fail('DECODER_WORKER_UNAVAILABLE');});
      child.stdin.on('error',()=>{failure??='DECODER_WORKER_UNAVAILABLE';});child.on('error',()=>{failure??='DECODER_WORKER_UNAVAILABLE';});
      item.done=new Promise(resolveDone=>child.on('close',(code,signal)=>{clearTimeout(timer);item.exited=true;exitCode=code;exitSignal=signal;reader.dispose();resolveDone();}));
      const result=item.done.then(()=>{check(!failure&&stdoutEnded&&!exitSignal&&exitCode===0&&parsed,'DECODER_WORKER_UNAVAILABLE');return assertProofDecoderWorkerResult(parsed,{requestId:request.requestId,plan:request.plan,limits:request.limits});});result.catch(()=>{});
      await joinWithin(new Promise((accept,reject)=>{child.once('spawn',accept);child.once('error',()=>reject(fault('DECODER_WORKER_UNAVAILABLE')));}),item.deadlineMono);
      item.startedAt=Date.now();
      const write=bytes=>joinWithin(new Promise((accept,reject)=>{check(Buffer.isBuffer(bytes)&&bytes.length<=65536&&!item.exited&&performance.now()<item.deadlineMono,'DECODER_DEADLINE');child.stdin.write(bytes,cause=>cause?reject(fault('DECODER_WORKER_UNAVAILABLE')):accept());}),item.deadlineMono);
      await write(header);
      return Object.freeze({startedAt:item.startedAt,write,async end(){check(performance.now()<item.deadlineMono,'DECODER_DEADLINE');child.stdin.end();},result});
    },
    async kill(job,{deadlineMono=performance.now()+500}={}) {record('KILL',job);const item=find(job);if(item.removed)return;item.modelFinish?.();if(item.child&&!item.exited)item.child.kill('SIGKILL');if(item.done)await joinWithin(item.done,deadlineMono);},
    async observe(job) {record('CGROUP_OBSERVE',job);const item=find(job);return decoderFreeze({classification:'UNQUALIFIED',evidenceOrigin:'LOCAL_FIXTURE',processState:processState(item),waitObserved:!!item.done&&item.exited,cgroupState:scenario==='CLEANUP_UNKNOWN'?'UNKNOWN':processState(item)!=='RUNNING'?'SIMULATED_EMPTY':'SIMULATED_OCCUPIED'});},
    async remove(job) {record('REMOVE',job);const item=find(job);check(processState(item)!=='RUNNING','DECODER_CLEANUP_UNCONFIRMED');item.removed=true;},
    cleanupReceipt(job) {
      const id=identity(job),item=find(job);check((!item.created||item.removed)&&processState(item)!=='RUNNING'&&scenario!=='CLEANUP_UNKNOWN','DECODER_CLEANUP_UNCONFIRMED');
      const receipt=decoderFreeze({schema:'atlas-proof-decoder-local-cleanup-v1',classification:'UNQUALIFIED',evidenceOrigin:'LOCAL_FIXTURE',identity:{...id},processState:processState(item),waitObserved:!!item.done&&item.exited,cgroupState:'SIMULATED_EMPTY',containerAbsent:true,confirmed:true,observedAt:Date.now()});cleanupReceipts.set(receipt,hash(id));return receipt;
    },
    snapshot(){return decoderFreeze({classification:'UNQUALIFIED',evidenceOrigin:'LOCAL_FIXTURE',closed,scenario,discardedEvents,events:[...events],containers:[...containers.values()].map(item=>({...view(item),removed:item.removed,jobId:item.identity.jobId,pid:item.child?.pid??null,exited:item.exited}))});},
    async close(){closed=true;for(const item of containers.values()){item.modelFinish?.();if(item.child&&!item.exited)item.child.kill('SIGKILL');}try{await joinWithin(Promise.all([...containers.values()].map(item=>item.done)),performance.now()+1000);}catch{return {classification:'UNQUALIFIED',closed:true,cleanupUncertain:true};}return {classification:'UNQUALIFIED',closed:true,cleanupUncertain:false};}
  });executors.set(executor,{profileHash:plan.profileHash});return executor;
}
export function assertLocalFixtureDecoderExecutor(executor,{plan}) {check(executors.get(executor)?.profileHash===plan.profileHash,'LOCAL_FIXTURE_DECODER_EXECUTOR_REQUIRED');return executor;}
export function assertLocalFixtureDecoderCleanupReceipt(receipt,{identity}) {check(cleanupReceipts.get(receipt)===hash(identity),'DECODER_CLEANUP_UNCONFIRMED');return receipt;}
