import {requireThat} from '@atlas/manual-service/contract';
import {CODEX_ASSOCIATION_REVISION} from './variant-codex.mjs';
/** Separate-process only: no grading limiter, grading reservation, browser or approval capability. */
export function createVariantWorker({store,catalog,provider,concurrency=1,intervalMs=5000,heartbeatMs=30000,timers=globalThis,onError=()=>{},maintenance=null,admitDispatch=null}){
 requireThat(store&&catalog&&typeof provider==='function'&&Number.isInteger(concurrency)&&concurrency>=1&&concurrency<=4,500,'VARIANT_CONFIG_INVALID');
 const tasks=new Set();let stopped=true,cycling=null,timer=null;const emit=e=>{try{onError({code:/^[A-Z][A-Z0-9_]{0,100}$/.test(e?.code??'')?e.code:'VARIANT_WORKER_INTERRUPTED'});}catch{}};
 async function execute(job){let dispatched=Boolean(job.dispatch_id),saved=Boolean(job.response),lost=false,snapshot=job.catalog,renewing=Promise.resolve();const controller=new AbortController();
  const heartbeat=timers.setInterval(()=>{renewing=renewing.then(async()=>{if(!await store.renew(job)){lost=true;controller.abort();}}).catch(e=>{lost=true;controller.abort();emit(e);});},heartbeatMs);heartbeat.unref?.();
  const executeListingSource=async(request,dispatch,{retainedOnly=false}={})=>{
   requireThat(typeof store.reserveListingSource==='function'&&typeof store.saveListingSource==='function'&&typeof dispatch==='function',503,'VARIANT_LISTING_JOURNAL_UNAVAILABLE');
   requireThat(!lost&&!controller.signal.aborted,409,'VARIANT_LEASE_LOST');
   if(!retainedOnly&&admitDispatch&&!await admitDispatch())throw Object.assign(new Error('VARIANT_GRADING_PRIORITY_DEFERRED'),{code:'VARIANT_GRADING_PRIORITY_DEFERRED'});
   const reserved=await store.reserveListingSource(job,request,{retainedOnly});
   requireThat(!retainedOnly||reserved.state!=='RESERVED',503,'VARIANT_LISTING_READ_ONLY');
   if(reserved.state!=='RESERVED')return reserved;
   // A committed source reservation is permanent even when the transport or
   // response acknowledgement is lost. Never reuse the photo-model fields.
   try{requireThat(!lost&&!controller.signal.aborted,409,'VARIANT_LEASE_LOST');const source=await dispatch();
    requireThat(await store.saveListingSource(reserved.reservation,source),503,'VARIANT_LISTING_RESPONSE_NOT_SAVED');return {state:'SAVED',source};
   }catch(e){emit(e);return {state:'UNKNOWN',code:'LISTING_SOURCE_OUTCOME_UNKNOWN'};}
  };
  const finishReview=async(code=null)=>{
   const referenceLabels=await store.codexReadings(job);requireThat(!lost,409,'VARIANT_LEASE_LOST');
   await store.finish(job,{code,result:{catalog:snapshot,referenceLabels:{...referenceLabels,associationRevision:CODEX_ASSOCIATION_REVISION},
    labelProcessing:{total:snapshot.referencePhotos?.length??0,read:referenceLabels.readings.length,unread:(snapshot.referencePhotos?.length??0)-referenceLabels.readings.length},
    suggestion:{candidateId:null,confidence:null,reason:'Compare the saved reference photos and choose the variant you can verify on your card.',evidence:[]}}});
  };
  try{if(job.dispatch_id){await store.finish(job,{state:'FAILED',code:'VARIANT_LEGACY_WORKFLOW_RETIRED'});return;}if(!snapshot||snapshot.problems.includes('REFERENCE_ACQUISITION_PENDING')){
    const prior=snapshot??await store.priorCatalog?.(job);
    snapshot=await catalog.prepare(job.input,{signal:controller.signal,executeListingSource,priorCatalog:prior,onCatalog:async progress=>{
      if(progress.snapshotHash===snapshot?.snapshotHash)return;
      requireThat(!lost&&await store.saveCatalog(job,progress),409,'VARIANT_LEASE_LOST');snapshot=progress;
    }});requireThat(!lost&&await store.saveCatalog(job,snapshot),409,'VARIANT_LEASE_LOST');
   }
   const reused=await store.reusableResult?.(job,snapshot);if(reused){requireThat(!lost,409,'VARIANT_LEASE_LOST');await store.finish(job,{result:{...reused,catalog:snapshot}});return;}
   {
    requireThat(typeof store.codexReadings==='function'&&typeof store.publishLabelSource==='function',503,'VARIANT_LABEL_JOURNAL_UNAVAILABLE');
    let referenceLabels=await store.codexReadings(job);
    const all=provider.labelRequest(snapshot);
    const missing=all.photos.filter(p=>!referenceLabels.readings.some(r=>r.sha256===p.sha256));
    for(let offset=0;!job.input.localOnly&&all.choices.length&&offset<missing.length;offset+=8){
     const photoShas=missing.slice(offset,offset+8).map(p=>p.sha256),request=provider.labelRequest(snapshot,photoShas);
     let reserved=await store.labelSource(job,request);
     if(reserved.state==='MISSING'){
      const prepared=await provider.prepare({catalog:snapshot,photoShas,signal:controller.signal});
      if(admitDispatch&&!await admitDispatch()){requireThat(await store.defer(job),409,'VARIANT_LEASE_LOST');return;}
      reserved=await store.labelSource(job,request,prepared.evidence);
      if(reserved.state==='RESERVED'){
       dispatched=true;saved=false;requireThat(!lost&&!controller.signal.aborted,409,'VARIANT_LEASE_LOST');
       const response=await provider({prepared,signal:controller.signal});
       requireThat(await store.saveLabelSource(reserved.reservation,response),503,'VARIANT_RESPONSE_NOT_SAVED');saved=true;
      }
     }
     if(reserved.state==='RECOVER'){await store.publishLabelSource(job,reserved.request);requireThat(await store.defer(job,'VARIANT_LABEL_PENDING'),409,'VARIANT_LEASE_LOST');return;}
     if(reserved.state==='PENDING'){requireThat(await store.defer(job,'VARIANT_LABEL_PENDING'),409,'VARIANT_LEASE_LOST');return;}
     if(reserved.state==='UNKNOWN'){await finishReview('VARIANT_PROVIDER_OUTCOME_UNKNOWN');return;}
     // The raw response and each image reading remain globally reusable even
     // when a job loses its lease between this projection and final READY.
     requireThat(!lost,409,'VARIANT_LEASE_LOST');
     await store.publishLabelSource(job,request);dispatched=false;saved=false;
    }
    referenceLabels=await store.codexReadings(job);
    requireThat(!lost,409,'VARIANT_LEASE_LOST');
    await store.finish(job,{result:{catalog:snapshot,referenceLabels:{...referenceLabels,associationRevision:CODEX_ASSOCIATION_REVISION},suggestion:{candidateId:null,confidence:null,
      reason:'Compare the saved reference labels and choose the variant you can verify on your card.',evidence:[]}}});return;
   }
  }catch(e){emit(e);try{if(e.code==='VARIANT_GRADING_PRIORITY_DEFERRED'&&!dispatched&&!saved){requireThat(await store.defer(job),409,'VARIANT_LEASE_LOST');return;}if(snapshot&&dispatched&&!saved&&!lost){await finishReview('VARIANT_PROVIDER_OUTCOME_UNKNOWN');return;}await store.finish(job,{state:saved?'RETRY':dispatched?'UNKNOWN':'RETRY',code:saved?'VARIANT_PROJECTION_INTERRUPTED':dispatched?'VARIANT_PROVIDER_OUTCOME_UNKNOWN':'VARIANT_PREPARATION_INTERRUPTED'});}catch(error){emit(error);}}
  finally{timers.clearInterval(heartbeat);await renewing;}
 }
 async function cycle(){if(stopped||cycling||tasks.size>0)return cycling;cycling=(async()=>{await store.discover();if(maintenance)await maintenance();while(!stopped&&tasks.size<concurrency){if(admitDispatch&&!await admitDispatch())break;const job=await store.claim(concurrency);if(!job)break;const task=execute(job).finally(()=>tasks.delete(task));tasks.add(task);}})().catch(emit).finally(()=>{cycling=null;});return cycling;}
 return Object.freeze({start(){if(!stopped)return;stopped=false;timer=timers.setInterval(()=>void cycle(),intervalMs);timer.unref?.();void cycle();},wake:cycle,
  async stop(){stopped=true;if(timer)timers.clearInterval(timer);timer=null;await cycling;await Promise.allSettled([...tasks]);},
  async drainOnce(){requireThat(stopped,409,'VARIANT_WORKER_RUNNING');stopped=false;try{await cycle();await Promise.allSettled([...tasks]);}finally{stopped=true;}}
 });
}
