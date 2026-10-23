import {canonicalJSON,requireValue} from './contract.mjs';
import {assertProofDecoderLaunchPlan,decoderFreeze} from './proof-decoder-profile.mjs';
import {engineDataOptions,engineBytesHash} from './proof-decoder-engine-json.mjs';
import {assertProofDecoderFixedParentBinding} from './proof-decoder-engine-target-binding.mjs';
import {assertProofDecoderTargetRegistry} from './proof-decoder-target-registry.mjs';
import {assertProofDecoderLinuxCgroupController} from './proof-decoder-linux-cgroup.mjs';
import {assertProofDecoderKernelGuardClient} from './proof-decoder-kernel-guard.mjs';
import {createProofDecoderTargetEffectSession,createProofDecoderOwnedEngineCleanup} from './proof-decoder-engine-owned-cleanup.mjs';

const executors=new WeakMap(),registryOwners=new WeakSet();
const MARKERS={classification:'UNQUALIFIED',executionAllowed:false,freshPublicationAllowed:false};
const check=(value,code='ENGINE_TARGET_EXECUTOR_INVALID')=>requireValue(value,code);

/** Privileged one-worker broker. The separate kernel guard survives this
 * process. No Engine receipt is serialized and rebranded over guard IPC.
 */
export function createProofDecoderTargetEngineExecutor(options={}) {
  const input=engineDataOptions(options,[],['enabled','plan','targetRegistry','parentController','targetBinding','guardClient','socketPath','apiVersion','headerTimeoutMs','linuxObserver']);
  if(input.enabled!==true)return null;
  const plan=assertProofDecoderLaunchPlan(input.plan),controller=assertProofDecoderLinuxCgroupController(input.parentController);
  const registry=assertProofDecoderTargetRegistry(input.targetRegistry,{plan,controller}),bindingHash=registry.status().bindingHash;
  const targetBinding=assertProofDecoderFixedParentBinding(input.targetBinding,{plan});
  const guard=assertProofDecoderKernelGuardClient(input.guardClient,{controller,bindingHash});
  check(!registryOwners.has(registry),'ENGINE_TARGET_EXECUTOR_REPLACEMENT');
  const shared={enabled:true,plan,targetRegistry:registry,parentController:controller,targetBinding,socketPath:input.socketPath,apiVersion:input.apiVersion,linuxObserver:input.linuxObserver};
  const cleanup=createProofDecoderOwnedEngineCleanup(shared);
  const seen=new Set();let active=null,closed=false,poisoned=false,lastFailure=null;
  function poison(jobId){
    poisoned=true;
    try{registry.quarantineEpoch({reason:'ENGINE_TARGET_UNCERTAIN',...(jobId?{jobId}:{})});}catch{}
    try{controller.freezeAndKill();}catch{}
  }
  const initial=registry.snapshot();
  if(initial.poisoned||initial.jobs.some(row=>!['RESERVED','FINALIZED'].includes(row.phase)))poison();
  registryOwners.add(registry);
  const executor=Object.freeze({...MARKERS,
    run(options){
      const run=engineDataOptions(options,['jobId','originalBytes','seccompBytes'],['signal']);
      check(!closed&&!poisoned&&!active&&!registry.status().poisoned&&seen.size<128,'ENGINE_TARGET_EXECUTOR_UNAVAILABLE');
      check(typeof run.jobId==='string'&&!seen.has(run.jobId),'ENGINE_TARGET_EXECUTOR_REPLAY');
      const initialRow=registry.get(run.jobId);
      check(initialRow&&initialRow.phase==='RESERVED'&&initialRow.identity.containerId===null&&initialRow.bindingHash===bindingHash,'ENGINE_TARGET_EXECUTOR_OWNERSHIP');
      check(Buffer.isBuffer(run.originalBytes)&&run.originalBytes.length===initialRow.requestPlan.byteCount&&run.originalBytes.length<=plan.profile.limits.maxObjectBytes);
      check(Buffer.isBuffer(run.seccompBytes)&&run.seccompBytes.length<=65536&&(run.signal===undefined||run.signal instanceof AbortSignal));
      // Copy and hash before guard adoption's first asynchronous boundary.
      const original=Buffer.from(run.originalBytes),seccomp=Buffer.from(run.seccompBytes);
      try{check(engineBytesHash(original)===initialRow.requestPlan.sha256&&engineBytesHash(seccomp)===plan.profile.seccomp.sha256,'ENGINE_TARGET_SOURCE_MISMATCH');}
      catch(error){original.fill(0);seccomp.fill(0);poison(run.jobId);throw error;}
      const aborter=new AbortController(),abort=()=>{aborter.abort();poison(run.jobId);};
      run.signal?.addEventListener('abort',abort,{once:true});if(run.signal?.aborted)abort();
      const item={jobId:run.jobId,aborter,promise:null};active=item;seen.add(run.jobId);
      item.promise=(async()=>{
        let session=null,lease=null,workerReport=null,review=null,finalized=false,failure=null;
        const live=()=>{
          check(!closed&&!poisoned&&!aborter.signal.aborted&&!registry.status().poisoned,'ENGINE_TARGET_EXECUTOR_UNAVAILABLE');
          const row=registry.get(run.jobId);
          check(row&&canonicalJSON({...row.identity,containerId:null})===canonicalJSON(initialRow.identity),'ENGINE_TARGET_EXECUTOR_OWNERSHIP');
          check(controller.boottimeNanoseconds()<BigInt(initialRow.deadlineAtNs),'ENGINE_TARGET_EXECUTOR_DEADLINE');
          if(lease)guard.assertLive(lease);
        };
        try{
          live();
          lease=await guard.adopt({identity:initialRow.identity,deadlineBootNs:initialRow.deadlineAtNs});live();
          session=createProofDecoderTargetEffectSession({...shared,guardClient:guard,guardLease:lease,jobId:run.jobId,
            originalBytes:original,seccompBytes:seccomp,headerTimeoutMs:input.headerTimeoutMs,signal:aborter.signal});
          await session.request('IMAGE_INSPECT');live();
          await session.request('CREATE');live();
          await session.request('INSPECT');live();
          await session.request('ATTACH');live();
          await session.request('START');live();
          await session.request('INSPECT');live();
          await session.sendOriginal();live();
          await session.request('WAIT');live();
          const completed=await session.complete();live();workerReport=completed.workerReport;review=completed.review;
          session.close();session=null;
          const result=await cleanup.finishSettledJob(run.jobId);
          check(result.record.phase==='FINALIZED','ENGINE_TARGET_CLEANUP_UNCERTAIN');live();
          await guard.settle(lease);lease=null;live();
          finalized=true;
        }catch(error){
          failure=typeof error?.code==='string'&&/^(ENGINE_|DECODER_)[A-Z0-9_]+$/.test(error.code)?error.code:'ENGINE_TARGET_UNCERTAIN';
          lastFailure=decoderFreeze({classification:'UNQUALIFIED',jobId:run.jobId,requestId:initialRow.identity.requestId,
            code:failure,workerOutcome:workerReport?.outcome??null,guard:guard.status().failure});
          poison(run.jobId);
        }finally{
          session?.close();original.fill(0);seccomp.fill(0);run.signal?.removeEventListener('abort',abort);
          if(active===item)active=null;
        }
        const state=registry.status();
        return decoderFreeze({...MARKERS,jobId:run.jobId,requestId:initialRow.identity.requestId,failure,
          workerReport,review,cleanupConfirmed:finalized,capacityHeld:!finalized||state.poisoned,
          epochPoisoned:poisoned||state.poisoned,disposition:finalized?'TARGET_CLEANUP_OBSERVED_UNQUALIFIED':'EPOCH_QUARANTINED'});
      })();return item.promise;
    },
    status(){const state=registry.status();return decoderFreeze({...MARKERS,closed,poisoned:poisoned||state.poisoned,activeJobs:active?1:0,seenJobs:seen.size,occupiedSlots:state.occupiedSlots,lastFailure});},
    async close(){
      if(!closed){closed=true;if(active){active.aborter.abort();poison(active.jobId);}}
      if(active)await active.promise;cleanup.close();return this.status();
    }
  });
  executors.set(executor,{registry,controller,profileHash:plan.profileHash});return executor;
}
export function assertProofDecoderTargetEngineExecutor(value,{targetRegistry,parentController,plan}) {
  const binding=executors.get(value);
  check(binding?.registry===targetRegistry&&binding.controller===parentController&&binding.profileHash===plan.profileHash,'ENGINE_TARGET_EXECUTOR_REQUIRED');
  return value;
}

