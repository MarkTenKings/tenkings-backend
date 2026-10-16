import {requireThat} from '@atlas/manual-service/contract';
import {CODEX_ASSOCIATION_REVISION} from './variant-codex.mjs';
import {VARIANT_LABEL_CREDIT_ERROR,variantLabelCreditRejected} from './variant-photo-provider.mjs';
/** Separate-process only: no grading limiter, grading reservation, browser or approval capability. */
export function createVariantWorker({store,catalog,provider,concurrency=1,intervalMs=5000,heartbeatMs=30000,timers=globalThis,onError=()=>{},admitDispatch=null}){
 requireThat(store&&catalog&&typeof provider==='function'&&Number.isInteger(concurrency)&&concurrency>=1&&concurrency<=4,500,'VARIANT_CONFIG_INVALID');
 const tasks=new Set();let stopped=true,cycling=null,timer=null;const emit=e=>{try{onError({code:/^[A-Z][A-Z0-9_]{0,100}$/.test(e?.code??'')?e.code:'VARIANT_WORKER_INTERRUPTED'});}catch{}};
 async function execute(job){let dispatched=Boolean(job.dispatch_id),saved=Boolean(job.response),lost=false,snapshot=job.catalog,renewing=Promise.resolve();const controller=new AbortController();
  const heartbeat=timers.setInterval(()=>{renewing=renewing.then(async()=>{if(!await store.renew(job)){lost=true;controller.abort();}}).catch(e=>{lost=true;controller.abort();emit(e);});},heartbeatMs);heartbeat.unref?.();
  const executeListingSource=async(request,dispatch,{retainedOnly=false}={})=>{
   requireThat(typeof store.reserveListingSource==='function'&&typeof store.saveListingSource==='function'&&typeof dispatch==='function',503,'VARIANT_LISTING_JOURNAL_UNAVAILABLE');
   requireThat(!lost&&!controller.signal.aborted,409,'VARIANT_LEASE_LOST');
   // Saved sources do not consume a dispatch allowance or wait for grading.
   let reserved=await store.reserveListingSource(job,request,{retainedOnly:true});
   requireThat(reserved.state!=='RESERVED',503,'VARIANT_LISTING_READ_ONLY');
   if(!retainedOnly&&reserved.state==='MISSING'){
    if(admitDispatch&&!await admitDispatch({jobKey:job.key,claimId:job.claim_id}))throw Object.assign(new Error('VARIANT_GRADING_PRIORITY_DEFERRED'),{code:'VARIANT_GRADING_PRIORITY_DEFERRED'});
    reserved=await store.reserveListingSource(job,request,{retainedOnly:false});
   }
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
    snapshot=await catalog.prepare(job.input,{signal:controller.signal,executeListingSource,priorCatalog:prior,
     admitImageAcquisition:async()=>{requireThat(!lost&&!controller.signal.aborted,409,'VARIANT_LEASE_LOST');
      if(admitDispatch&&!await admitDispatch({jobKey:job.key,claimId:job.claim_id}))throw Object.assign(new Error('VARIANT_GRADING_PRIORITY_DEFERRED'),{code:'VARIANT_GRADING_PRIORITY_DEFERRED'});
     },onCatalog:async progress=>{
      if(progress.snapshotHash===snapshot?.snapshotHash)return;
      requireThat(!lost&&await store.saveCatalog(job,progress),409,'VARIANT_LEASE_LOST');snapshot=progress;
    }});requireThat(!lost&&await store.saveCatalog(job,snapshot),409,'VARIANT_LEASE_LOST');
   }
   const reused=await store.reusableResult?.(job,snapshot);if(reused){requireThat(!lost,409,'VARIANT_LEASE_LOST');await store.finish(job,{result:{...reused,catalog:snapshot}});return;}
   {
    requireThat(typeof store.codexReadings==='function'&&typeof store.publishLabelSource==='function',503,'VARIANT_LABEL_JOURNAL_UNAVAILABLE');
    const referenceLabels=await store.codexReadings(job),all=provider.labelRequest(snapshot);
    const remaining=new Set(all.photos.filter(p=>!referenceLabels.readings.some(r=>r.sha256===p.sha256)).map(p=>p.sha256));
    let pending=false,unknown=false,credit=false,deferred=false;
    const remove=shas=>{for(const sha of shas)remaining.delete(sha);};
    while(!job.input.localOnly&&all.choices.length&&remaining.size){
     let photoShas=[...remaining].slice(0,8),request=provider.labelRequest(snapshot,photoShas),reserved=await store.labelSource(job,request);
     if(reserved.state==='RESUME'){
      request=reserved.request;photoShas=request.photos.map(p=>p.sha256);
      reserved=await store.labelSource(job,request);
     }
     if(reserved.state==='MISSING'){
      if(credit||deferred){remove(photoShas);continue;}
      const prepared=await provider.prepare({catalog:reserved.catalog??snapshot,photoShas,request:reserved.evidence?.request,signal:controller.signal});
      // Reconstruct only a verifiably identical historical request. A changed
      // prompt is not permission to reinterpret an old credit retry.
      if(reserved.evidence)requireThat(prepared.evidence.requestSha256===reserved.evidence.requestSha256,409,'VARIANT_LABEL_RETRY_REQUEST_CHANGED');
      if(admitDispatch&&!await admitDispatch({jobKey:job.key,claimId:job.claim_id})){deferred=true;remove(photoShas);continue;}
      reserved=await store.labelSource(job,request,prepared.evidence);
      if(reserved.state==='RESERVED'){
       dispatched=true;saved=false;requireThat(!lost&&!controller.signal.aborted,409,'VARIANT_LEASE_LOST');
       try{
        const response=await provider({prepared,signal:controller.signal});
        try{requireThat(await store.saveLabelSource(reserved.reservation,response),503,'VARIANT_RESPONSE_NOT_SAVED');}
        catch(error){
         const retained=await store.labelSource(job,request);
         requireThat(retained.state!=='CREDIT_REJECTED',429,VARIANT_LABEL_CREDIT_ERROR);
         if(retained.state!=='REUSED')throw error;
         requireThat(retained.attemptKey===reserved.attemptKey,409,'VARIANT_LABEL_REQUEST_CHANGED');
        }
        saved=true;requireThat(!variantLabelCreditRejected(response),429,VARIANT_LABEL_CREDIT_ERROR);
       }catch(error){
        if(lost)throw error;
        emit(error);
        if(error.code===VARIANT_LABEL_CREDIT_ERROR)credit=true;
        else if(!saved)unknown=true;
        else throw error;
        // This packet remains reserved permanently. Independent photographs
        // can still complete; none of these SHAs is ever dispatched again.
        remove(photoShas);dispatched=false;saved=false;continue;
       }
      }
     }
     if(reserved.state==='CREDIT_REJECTED'){credit=true;remove(reserved.photoShas??photoShas);continue;}
     if(reserved.state==='PENDING'||reserved.state==='UNKNOWN'){
      if(reserved.state==='PENDING')pending=true;else unknown=true;
      remove(reserved.photoShas??photoShas);continue;
     }
     if(reserved.state==='PUBLISHED'){remove(reserved.photoShas);continue;}
     if(reserved.state==='RECOVER'){
      saved=true;await store.publishLabelSource(job,reserved.request,{attemptKey:reserved.attemptKey});
      remove(reserved.request.photos.map(p=>p.sha256));dispatched=false;saved=false;continue;
     }
     requireThat(['RESERVED','REUSED'].includes(reserved.state),503,'VARIANT_LABEL_JOURNAL_CONFLICT');
     requireThat(!lost,409,'VARIANT_LEASE_LOST');saved=true;
     await store.publishLabelSource(job,request,{attemptKey:reserved.attemptKey});
     remove(photoShas);dispatched=false;saved=false;
    }
    if(credit){await store.finish(job,{state:'FAILED',code:VARIANT_LABEL_CREDIT_ERROR});return;}
    if(pending||deferred){requireThat(await store.defer(job,pending?'VARIANT_LABEL_PENDING':'VARIANT_GRADING_PRIORITY_DEFERRED'),409,'VARIANT_LEASE_LOST');return;}
    await finishReview(unknown?'VARIANT_PROVIDER_OUTCOME_UNKNOWN':null);return;
   }
  }catch(e){emit(e);try{if(e.code==='VARIANT_LABEL_RETRY_REQUEST_CHANGED'){await store.finish(job,{state:'FAILED',code:e.code});return;}if(e.code===VARIANT_LABEL_CREDIT_ERROR){await store.finish(job,{state:'FAILED',code:VARIANT_LABEL_CREDIT_ERROR});return;}if(e.code==='VARIANT_GRADING_PRIORITY_DEFERRED'&&!dispatched&&!saved){requireThat(await store.defer(job),409,'VARIANT_LEASE_LOST');return;}if(snapshot&&dispatched&&!saved&&!lost){await finishReview('VARIANT_PROVIDER_OUTCOME_UNKNOWN');return;}await store.finish(job,{state:saved?'RETRY':dispatched?'UNKNOWN':'RETRY',code:saved?'VARIANT_PROJECTION_INTERRUPTED':dispatched?'VARIANT_PROVIDER_OUTCOME_UNKNOWN':'VARIANT_PREPARATION_INTERRUPTED'});}catch(error){emit(error);}}
  finally{timers.clearInterval(heartbeat);await renewing;}
 }
 async function cycle(){if(stopped||cycling||tasks.size>0)return cycling;cycling=(async()=>{await store.discover();while(!stopped&&tasks.size<concurrency){const job=await store.claim(concurrency);if(!job)break;const task=execute(job).finally(()=>tasks.delete(task));tasks.add(task);}})().catch(emit).finally(()=>{cycling=null;});return cycling;}
 return Object.freeze({start(){if(!stopped)return;stopped=false;timer=timers.setInterval(()=>void cycle(),intervalMs);timer.unref?.();void cycle();},wake:cycle,
  async stop(){stopped=true;if(timer)timers.clearInterval(timer);timer=null;await cycling;await Promise.allSettled([...tasks]);},
  async drainOnce(){requireThat(stopped,409,'VARIANT_WORKER_RUNNING');stopped=false;try{await cycle();await Promise.allSettled([...tasks]);}finally{stopped=true;}}
 });
}
