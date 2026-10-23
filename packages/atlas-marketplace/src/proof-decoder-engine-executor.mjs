import {performance} from 'node:perf_hooks';
import {canonicalJSON,requireValue} from './contract.mjs';
import {assertProofDecoderLaunchPlan,decoderFreeze} from './proof-decoder-profile.mjs';
import {assertProofDecoderJobRegistry} from './proof-decoder-job-registry.mjs';
import {engineDataOptions} from './proof-decoder-engine-json.mjs';
import {createProofDecoderEngineTransport} from './proof-decoder-engine-transport.mjs';

const executors=new WeakMap();
const MARKERS={classification:'UNQUALIFIED',executionAllowed:false,evidenceOrigin:'ENGINE_UNVERIFIED_REPORTS'};
const check=(condition,code='ENGINE_EXECUTOR_INVALID')=>requireValue(condition,code);
const sameIdentity=(a,b)=>canonicalJSON({...a,containerId:null})===canonicalJSON({...b,containerId:null});

/** Concrete, default-off qualification-harness executor. It is intentionally
 * incompatible with fixture executor/watchdog and production validator brands.
 * Never releases a registry slot, invents cleanup, retries an effect, adopts a
 * foreign container, or uses Engine reports as cgroup/peer/watchdog authority.
 */
export function createProofDecoderEngineExecutor(options={}) {
  const input=engineDataOptions(options,[],['enabled','plan','registry','socketPath','apiVersion','epoch','headerTimeoutMs']);
  if(input.enabled!==true)return null;
  const plan=assertProofDecoderLaunchPlan(input.plan),registry=assertProofDecoderJobRegistry(input.registry,{plan});
  check(typeof input.epoch==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(input.epoch));
  // Reopening an executor must not turn a durable uncertain/unfinished intent
  // into fresh capacity. Root's future independent reconciliation owns that.
  let quarantined=registry.snapshot().jobs.some(row=>!['RESERVED','FINALIZED'].includes(row.phase));
  let closed=false;const active=new Map(),seen=new Set();
  function quarantine(exceptJobId) {quarantined=true;for(const [id,item] of active)if(id!==exceptJobId)item.controller.abort();}
  function alive(controller) {check(!closed&&!quarantined&&!controller.signal.aborted,'ENGINE_EXECUTOR_QUARANTINED');}
  const executor=Object.freeze({...MARKERS,
    run(options) {
      const run=engineDataOptions(options,['jobId','originalBytes','seccompBytes'],['signal']);
      check(!closed&&!quarantined&&active.size<plan.profile.limits.maxConcurrent&&seen.size<128,'ENGINE_EXECUTOR_QUARANTINED');
      check(typeof run.jobId==='string'&&!seen.has(run.jobId),'ENGINE_EXECUTOR_REPLAY');
      const record=registry.get(run.jobId);
      check(record&&record.phase==='RESERVED'&&record.identity.epoch===input.epoch&&record.identity.containerId===null,'ENGINE_EXECUTOR_OWNERSHIP');
      check(run.signal===undefined||run.signal instanceof AbortSignal);
      const controller=new AbortController(),abort=()=>controller.abort();
      run.signal?.addEventListener('abort',abort,{once:true});if(run.signal?.aborted)controller.abort();
      const item={controller,promise:null};active.set(run.jobId,item);seen.add(run.jobId);
      item.promise=(async()=>{
        let transport=null,review=null,workerReport=null,failure=null,registryHeld=false,heldPhase=null,io=null;
        const transition=(phase,extra={})=>{
          alive(controller);const current=registry.get(run.jobId);
          check(current&&sameIdentity(current.identity,record.identity),'ENGINE_EXECUTOR_OWNERSHIP');
          return registry.transition(run.jobId,current.revision,{phase,...extra});
        };
        try {
          alive(controller);
          const remaining=Math.min(plan.profile.limits.timeoutMs,record.deadlineAt-Date.now());check(remaining>0,'ENGINE_EXECUTOR_DEADLINE');
          transport=createProofDecoderEngineTransport({enabled:true,plan,job:record.identity,original:record.requestPlan,
            originalBytes:run.originalBytes,seccompBytes:run.seccompBytes,socketPath:input.socketPath,apiVersion:input.apiVersion,
            deadlineMono:performance.now()+remaining,headerTimeoutMs:input.headerTimeoutMs,signal:controller.signal});
          await transport.request('IMAGE_INSPECT');alive(controller);
          transition('CREATE_INTENT');
          const created=await transport.request('CREATE');alive(controller);
          transition('CREATED',{containerId:created.data.containerId});
          await transport.request('INSPECT');alive(controller);
          await transport.request('ATTACH');alive(controller);
          transition('START_INTENT');
          await transport.request('START');alive(controller);
          await transport.request('INSPECT');alive(controller);
          check(transport.review().started,'ENGINE_EXECUTOR_START_UNCONFIRMED');
          // This is local observation time, not an authenticated daemon clock.
          transition('RUNNING',{startedAt:Date.now()});
          await transport.sendOriginal();alive(controller);
          const [,output]=await Promise.all([transport.request('WAIT'),transport.outputComplete()]);
          alive(controller);review=transport.review();workerReport=output.workerReport;
          check(review.reviewStatus==='DECODE_REPORTED_CLEANUP_UNVERIFIED','ENGINE_EXECUTOR_TRANSCRIPT');
        }catch(error){
          failure=typeof error?.code==='string'&&/^(?:ENGINE_|DECODER_)[A-Z0-9_]+$/.test(error.code)?error.code:'ENGINE_EXECUTOR_UNCERTAIN';
          if(transport)try{review=transport.review();}catch{}
        }finally{
          // Keep unknown CREATE/START intents verbatim: no rollback, inferred
          // no-effect or replacement job. Their non-final rows occupy capacity.
          quarantine(run.jobId);
          try {
            const current=registry.get(run.jobId);
            check(current&&sameIdentity(current.identity,record.identity)&&current.phase!=='FINALIZED','ENGINE_EXECUTOR_OWNERSHIP');
            if(!['CREATE_INTENT','START_INTENT','QUARANTINED'].includes(current.phase))registry.transition(run.jobId,current.revision,{phase:'QUARANTINED'});
            const held=registry.get(run.jobId);registryHeld=held.phase!=='FINALIZED';heldPhase=held.phase;
          }catch{failure??='ENGINE_EXECUTOR_REGISTRY_UNCERTAIN';}
          if(transport){const state=transport.status();io={requestCount:state.requestCount,backpressureEvents:state.backpressureEvents,
            localWriteAcceptedBytes:state.inputBytesWritten,outputBytes:state.outputBytes,inputClosed:state.inputClosed,outputClosed:state.outputClosed};transport.close();}
          run.signal?.removeEventListener('abort',abort);active.delete(run.jobId);
        }
        return decoderFreeze({...MARKERS,jobId:run.jobId,requestId:record.identity.requestId,failure,
          disposition:'QUARANTINED_CLEANUP_UNVERIFIED',registryHeld,heldPhase,review,workerReport,io,
          capacityHeld:true,cleanup:'UNKNOWN',freshPublicationAllowed:false,peerIdentityVerified:false,
          cgroupObserved:false,independentWatchdog:false});
      })();
      return item.promise;
    },
    status(){return decoderFreeze({...MARKERS,closed,quarantined,activeJobs:active.size,seenJobs:seen.size,capacityReleaseImplemented:false,
      peerIdentityVerified:false,cgroupObserved:false,independentWatchdog:false});},
    async close(){closed=true;quarantine();await Promise.all([...active.values()].map(item=>item.promise));return this.status();},
  });
  executors.set(executor,{registry,profileHash:plan.profileHash});return executor;
}

/** Implementation identity only, never a runtime qualification assertion. */
export function assertProofDecoderEngineExecutor(value,{registry,plan}) {
  const binding=executors.get(value);check(binding?.registry===registry&&binding.profileHash===plan.profileHash,'ENGINE_EXECUTOR_REQUIRED');return value;
}
