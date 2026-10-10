import {isVariantPhotoComparable} from '@tenkings/card-catalog-evidence';
import {requireThat} from '@atlas/manual-service/contract';
/** Separate-process only: no grading limiter, grading reservation, browser or approval capability. */
export function createVariantWorker({store,catalog,loadPhotos,provider,projectResponse,concurrency=1,intervalMs=5000,heartbeatMs=30000,timers=globalThis,onError=()=>{},recheck=null}){
 requireThat(store&&catalog&&typeof loadPhotos==='function'&&typeof provider==='function'&&typeof projectResponse==='function'&&Number.isInteger(concurrency)&&concurrency>=1&&concurrency<=4,500,'VARIANT_CONFIG_INVALID');
 const tasks=new Set();let stopped=true,cycling=null,timer=null;const emit=e=>{try{onError({code:/^[A-Z][A-Z0-9_]{0,100}$/.test(e?.code??'')?e.code:'VARIANT_WORKER_INTERRUPTED'});}catch{}};
 async function execute(job){let dispatched=Boolean(job.dispatch_id),saved=Boolean(job.response),lost=false,renewing=Promise.resolve();const controller=new AbortController();
  const heartbeat=timers.setInterval(()=>{renewing=renewing.then(async()=>{if(!await store.renew(job)){lost=true;controller.abort();}}).catch(e=>{lost=true;controller.abort();emit(e);});},heartbeatMs);heartbeat.unref?.();
  try{let snapshot=job.catalog;if(!snapshot){snapshot=await catalog.prepare(job.input,{signal:controller.signal});requireThat(!lost&&await store.saveCatalog(job,snapshot),409,'VARIANT_LEASE_LOST');}
   const reused=await store.reusableResult?.(job,snapshot);if(reused){requireThat(!lost,409,'VARIANT_LEASE_LOST');await store.finish(job,{result:{catalog:snapshot,suggestion:reused.suggestion}});return;}
   let response=job.response;let suggestion={candidateId:null,confidence:null,reason:'No verified reference images are available for visual comparison.',evidence:[]};
   const comparable=snapshot.candidates.some(c=>c.images.some(i=>isVariantPhotoComparable(c,i)));
   if(comparable){if(!response){requireThat(!dispatched,409,'VARIANT_PROVIDER_OUTCOME_UNKNOWN');const photos=await loadPhotos(job,{signal:controller.signal});
     const prepared=typeof provider.prepare==='function'?await provider.prepare({input:job.input,catalog:snapshot,photos,signal:controller.signal}):null;
     dispatched=true;requireThat(!lost&&await store.dispatch(job,prepared?.evidence??null),409,'VARIANT_LEASE_LOST');response=await provider(prepared?{prepared,signal:controller.signal}:{input:job.input,catalog:snapshot,photos,signal:controller.signal});requireThat(await store.response(job,response),503,'VARIANT_RESPONSE_NOT_SAVED');saved=true;}
    suggestion=await projectResponse(response,snapshot,job.input);}
   requireThat(!lost,409,'VARIANT_LEASE_LOST');await store.finish(job,{result:{catalog:snapshot,suggestion}});
  }catch(e){emit(e);try{await store.finish(job,{state:saved?'RETRY':dispatched?'UNKNOWN':'RETRY',code:saved?'VARIANT_PROJECTION_INTERRUPTED':dispatched?'VARIANT_PROVIDER_OUTCOME_UNKNOWN':'VARIANT_PREPARATION_INTERRUPTED'});}catch(error){emit(error);}}
  finally{timers.clearInterval(heartbeat);await renewing;}
 }
 async function cycle(){if(stopped||cycling||tasks.size>0)return cycling;cycling=(async()=>{await store.discover();if(recheck)await recheck();while(!stopped&&tasks.size<concurrency){const job=await store.claim(concurrency);if(!job)break;const task=execute(job).finally(()=>tasks.delete(task));tasks.add(task);}})().catch(emit).finally(()=>{cycling=null;});return cycling;}
 return Object.freeze({start(){if(!stopped)return;stopped=false;timer=timers.setInterval(()=>void cycle(),intervalMs);timer.unref?.();void cycle();},wake:cycle,
  async stop(){stopped=true;if(timer)timers.clearInterval(timer);timer=null;await cycling;await Promise.allSettled([...tasks]);},
  async drainOnce(){requireThat(stopped,409,'VARIANT_WORKER_RUNNING');stopped=false;try{await cycle();await Promise.allSettled([...tasks]);}finally{stopped=true;}}
 });
}
