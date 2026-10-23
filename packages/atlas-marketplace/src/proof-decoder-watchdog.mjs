import {performance} from 'node:perf_hooks';
import {canonicalJSON,requireValue} from './contract.mjs';
import {assertProofDecoderLaunchPlan,decoderFreeze} from './proof-decoder-profile.mjs';
import {assertProofDecoderJobRegistry} from './proof-decoder-job-registry.mjs';
import {assertLocalFixtureDecoderExecutor} from './proof-decoder-fixture-executor.mjs';
import {proofDecoderOwnedIdentity} from './proof-decoder-owned-operations.mjs';

const watchdogs=new WeakMap();
const check=(condition,code='DECODER_WATCHDOG_INVALID')=>requireValue(condition,code);
export function assertProofDecoderObservedOwnership(observed,expected,plan) {
  const actual=proofDecoderOwnedIdentity(observed.identity,plan);
  check(canonicalJSON({...actual,containerId:null})===canonicalJSON({...expected,containerId:null})&&(expected.containerId===null||actual.containerId===expected.containerId),'DECODER_FOREIGN_CONTAINER');return actual;
}
/** Local fixture control loop. No independent OS service or cgroup observer. */
export function createProofDecoderWatchdog({enabled=false,registry,executor,plan:input,bounds={}}={}) {
  if(enabled!==true)return null;
  const plan=assertProofDecoderLaunchPlan(input);assertProofDecoderJobRegistry(registry,{plan});assertLocalFixtureDecoderExecutor(executor,{plan});
  check(Object.keys(bounds).every(key=>['pollMs','cleanupTimeoutMs','maxLifetimeMs'].includes(key)));
  const pollMs=bounds.pollMs??25,cleanupTimeoutMs=bounds.cleanupTimeoutMs??500,maxLifetimeMs=bounds.maxLifetimeMs??60000;
  check(Number.isSafeInteger(pollMs)&&pollMs>=5&&pollMs<=1000&&Number.isSafeInteger(cleanupTimeoutMs)&&cleanupTimeoutMs>=1&&cleanupTimeoutMs<=1000&&Number.isSafeInteger(maxLifetimeMs)&&maxLifetimeMs>=100&&maxLifetimeMs<=60000);
  const adopted=new Map(),failures=[];let started=false,closed=false,quarantined=false,timer=null,lifetime=null,pending=null,closing=null;
  const fail=(jobId,cause)=>{quarantined=true;if(failures.length===64)failures.shift();failures.push({jobId,code:cause?.code??'DECODER_CLEANUP_UNCONFIRMED'});};
  const within=deadline=>check(performance.now()<deadline,'DECODER_CLEANUP_UNCONFIRMED');
  function remember(record,deadlineMono) {adopted.set(record.identity.jobId,{record,deadlineMono:deadlineMono??performance.now()});}
  function current(jobId) {try{const row=registry.get(jobId);if(row)remember(row,adopted.get(jobId)?.deadlineMono);return row;}catch(cause){fail(jobId,cause);return adopted.get(jobId)?.record??null;}}
  function transition(row,patch,deadlineMono) {within(deadlineMono);const result=registry.transition(row.identity.jobId,row.revision,patch);remember(result,adopted.get(row.identity.jobId)?.deadlineMono);within(deadlineMono);return result;}
  async function cleanup(initial,deadlineMono) {
    let row=initial;
    if(row.phase==='FINALIZED'){adopted.delete(row.identity.jobId);return;}
    try {
      within(deadlineMono);
      // The exact durable receipt was validated on read. This committed crash
      // boundary needs no new claim of absence from another fixture executor.
      if(row.phase==='CLEANUP_OBSERVED'){row=transition(row,{phase:'FINALIZED'},deadlineMono);adopted.delete(row.identity.jobId);return;}
      const observed=await executor.lookup(row);within(deadlineMono);
      const found=observed?assertProofDecoderObservedOwnership(observed,row.identity,plan):null;
      const updates={phase:'STOP_INTENT'};
      if(found&&row.identity.containerId===null)updates.containerId=found.containerId;
      if(observed?.startedAt!==null&&observed?.startedAt!==undefined&&row.startedAt===null)updates.startedAt=observed.startedAt;
      try {if(row.phase!=='STOP_INTENT'||updates.containerId||updates.startedAt!==undefined)row=transition(row,updates,deadlineMono);}
      catch(cause){fail(row.identity.jobId,cause);row={...row,identity:found??row.identity,startedAt:observed?.startedAt??row.startedAt};remember(row,adopted.get(row.identity.jobId)?.deadlineMono);within(deadlineMono);}
      if(observed&&row.identity.containerId!==null){
        if(observed.processState==='RUNNING'){await executor.kill(row,{deadlineMono});within(deadlineMono);}
        const result=await executor.observe(row);within(deadlineMono);
        check(result.classification==='UNQUALIFIED'&&result.evidenceOrigin==='LOCAL_FIXTURE'&&result.cgroupState==='SIMULATED_EMPTY'&&['NOT_STARTED','EXITED'].includes(result.processState),'DECODER_CLEANUP_UNCONFIRMED');
        if(result.processState==='EXITED')check(result.waitObserved===true,'DECODER_CLEANUP_UNCONFIRMED');
        await executor.remove(row);within(deadlineMono);
      }
      const receipt=executor.cleanupReceipt(row);within(deadlineMono);
      row=transition(row,{phase:'CLEANUP_OBSERVED',cleanup:receipt},deadlineMono);row=transition(row,{phase:'FINALIZED'},deadlineMono);adopted.delete(row.identity.jobId);
    }catch(cause){fail(row.identity.jobId,cause);try{within(deadlineMono);const latest=registry.get(row.identity.jobId);if(latest&&latest.phase!=='FINALIZED'&&latest.phase!=='QUARANTINED')transition(latest,{phase:'QUARANTINED'},deadlineMono);}catch{} }
  }
  const watchdog=Object.freeze({classification:'UNQUALIFIED',evidenceOrigin:'LOCAL_FIXTURE',
    async start(){check(!closed,'DECODER_WATCHDOG_CLOSED');if(started){check(!quarantined,'DECODER_WATCHDOG_QUARANTINED');return;}started=true;await this.reconcileOnce({all:true});check(!closed,'DECODER_WATCHDOG_CLOSED');check(!quarantined,'DECODER_WATCHDOG_QUARANTINED');timer=setInterval(()=>{if(!pending)void this.reconcileOnce();},pollMs);lifetime=setTimeout(()=>{quarantined=true;void this.close();},maxLifetimeMs);},
    adoptJob(record,{deadlineMono}={}) {check(started&&!closed&&!quarantined,'DECODER_WATCHDOG_UNAVAILABLE');check(Number.isFinite(deadlineMono)&&deadlineMono>performance.now()&&adopted.size<plan.profile.limits.maxConcurrent,'DECODER_WATCHDOG_UNAVAILABLE');const currentRow=registry.get(record.identity.jobId);check(currentRow&&currentRow.revision===record.revision&&currentRow.phase==='RESERVED','DECODER_REGISTRY_CAS');executor.adoptJob(currentRow);remember(currentRow,deadlineMono);return decoderFreeze({classification:'UNQUALIFIED',adopted:true,jobId:record.identity.jobId});},
    reconcileOnce({all=false,jobId,deadlineMono=performance.now()+cleanupTimeoutMs}={}) {
      // Single flight, with no unbounded queue. A joining caller MUST inspect its
      // exact target row and request a subsequent flight when still unresolved.
      if(pending)return pending;
      const end=Math.min(deadlineMono,performance.now()+cleanupTimeoutMs);
      const task=Promise.resolve().then(async()=>{
        try{for(const row of registry.snapshot().jobs)if(row.phase!=='FINALIZED'&&!adopted.has(row.identity.jobId))remember(row);}
        catch(cause){fail(null,cause);}
        const rows=[...adopted.values()].filter(item=>all||item.record.identity.jobId===jobId||performance.now()>=item.deadlineMono);
        for(const item of rows){const row=current(item.record.identity.jobId)??item.record;await cleanup(row,end);}
        return this.status();
      });pending=task;task.finally(()=>{if(pending===task)pending=null;}).catch(()=>{});return task;
    },
    status(){return decoderFreeze({classification:'UNQUALIFIED',evidenceOrigin:'LOCAL_FIXTURE',independentOsService:false,started,closed,quarantined,adoptedJobs:adopted.size,cleanupUncertain:adopted.size>0,failures:[...failures]});},
    close(){if(closing)return closing;closed=true;clearInterval(timer);clearTimeout(lifetime);const deadlineMono=performance.now()+cleanupTimeoutMs;closing=(async()=>{if(pending)await pending;await this.reconcileOnce({all:true,deadlineMono});return this.status();})();return closing;}
  });watchdogs.set(watchdog,{registry,executor,profileHash:plan.profileHash});return watchdog;
}
export function assertProofDecoderWatchdog(value,{registry,executor,plan}) {const binding=watchdogs.get(value);check(binding?.registry===registry&&binding.executor===executor&&binding.profileHash===plan.profileHash,'DECODER_WATCHDOG_REQUIRED');return value;}
