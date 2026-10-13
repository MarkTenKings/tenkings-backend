import {variantCatalog as catalog,variantCandidate as candidate} from './variant-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createVariantWorker} from '../src/variant-worker.mjs';
import {labelCatalog} from './variant-label-fixture.mjs';
import {prepareVariantLabelRequest} from '../src/variant-photo-provider.mjs';
import {variantReviewStatus} from '../src/variant-service.mjs';
import {variantBinding,variantJobKey,variantSelectedIdentity,validateVariantAction,variantJobGrantSQL} from '../src/variant-job-store.mjs';
const hash='a'.repeat(64),card={cardId:'16b96563-96ac-4e94-8337-2f1999271aa1',revision:4,draft:{source:{sourceHash:hash},identityRevision:1,identity:{cardName:'Magikarp',year:'2020',productSet:'Rebel Clash',cardNumber:'039/192',parallel:null,layoutType:'POKEMON'}}};
async function fixture({count=1,failPrepare=false,failProvider=false,failProjection=false,loseResponse=false,images=true,photos=null,retainedReadings=0}={}){
 const snapshot=labelCatalog({photos:photos??(images?1:0)}),rows=Array.from({length:count},(_,n)=>({key:String(n),state:'QUEUED',attempts:0,labels:snapshot.referencePhotos.slice(0,retainedReadings).map(p=>({sha256:p.sha256})),input:{...variantBinding(card)}}));let sends=0,prepares=0,maximum=0,active=0,discoveries=0;
 const store={async discover(){discoveries++;},async claim(){const r=rows.find(r=>r.state==='QUEUED');if(!r)return null;r.state='RUNNING';r.attempts++;r.claim_id=String(r.attempts);return structuredClone(r);},async renew(){return true;},async saveCatalog(j,c){rows[+j.key].catalog=c;return true;},
  async codexReadings(j){return {readings:rows[+j.key].labels??[]};},
  async labelSource(j,request,evidence){const r=rows[+j.key];if(r.label_response)return {state:'REUSED'};if(r.reserved)return {state:'UNKNOWN'};if(!evidence)return {state:'MISSING'};r.reserved=true;r.evidence=evidence;return {state:'RESERVED',reservation:{job:j,request}};},
  async saveLabelSource(reservation,response){rows[+reservation.job.key].label_response=response;if(loseResponse){loseResponse=false;throw Error('Lost response acknowledgement');}return true;},
  async publishLabelSource(j,request){if(failProjection){failProjection=false;throw Error('Projection transient');}rows[+j.key].labels=request.photos.map(p=>({sha256:p.sha256}));},
  async finish(j,o){const r=rows[+j.key];r.state=o.result?'READY':o.state==='RETRY'?'QUEUED':o.state;r.result=o.result;},
  dispatch:()=>assert.fail('retired physical comparison dispatch'),response:()=>assert.fail('retired physical comparison response')};
 const provider=async()=>{sends++;active++;maximum=Math.max(maximum,active);await new Promise(r=>setImmediate(r));active--;if(failProvider)throw Error('Provider unknown');return {answer:'a'};};
 provider.labelRequest=prepareVariantLabelRequest;provider.prepare=async()=>{prepares++;if(failPrepare)throw Error('Reference missing');return {evidence:{requestSha256:hash}};};
 const worker=createVariantWorker({store,catalog:{async prepare(){return snapshot;}},loadPhotos:()=>assert.fail('physical photos'),provider,projectResponse:()=>assert.fail('retired projector'),concurrency:2});
 return {rows,worker,sends:()=>sends,prepares:()=>prepares,maximum:()=>maximum,discoveries:()=>discoveries};
}
test('cold construction; own bounded worker processes every card independent of browser and grading limiter',async()=>{const f=await fixture({count:17});assert.equal(f.sends(),0);assert.equal(f.discoveries(),0);while(f.rows.some(r=>r.state==='QUEUED'))await f.worker.drainOnce();assert.equal(f.sends(),17);assert(f.maximum()<=2);assert(f.rows.every(r=>r.state==='READY'&&r.label_response&&r.evidence.requestSha256===hash));});
test('preflight image failure does not record paid dispatch; unavailable catalog produces truthful READY without model',async()=>{const f=await fixture({failPrepare:true});await f.worker.drainOnce();assert.equal(f.sends(),0);assert.equal(f.rows[0].dispatch_id,undefined);const g=await fixture({images:false});await g.worker.drainOnce();assert.equal(g.sends(),0);assert.equal(g.rows[0].result.suggestion.candidateId,null);});
test('uncertain send and lost response acknowledgement never repeat provider dispatch',async()=>{for(const options of[{failProvider:true},{loseResponse:true}]){const f=await fixture(options);await f.worker.drainOnce();await f.worker.drainOnce();assert.equal(f.sends(),1);assert.equal(f.rows[0].state,'READY');assert.equal(f.rows[0].result.catalog.referencePhotos.length,1);assert.equal(f.rows[0].result.labelProcessing.unread,1);}});
test('saved raw response supports local-only projection recovery with immutable request evidence',async()=>{const f=await fixture({failProjection:true});await f.worker.drainOnce();assert.equal(f.rows[0].state,'QUEUED');const response=f.rows[0].label_response;await f.worker.drainOnce();assert.equal(f.sends(),1);assert.equal(f.rows[0].state,'READY');assert.deepEqual(f.rows[0].label_response,response);});
test('dedup binds source, identity revision/hash and policy; manual unknown finish is never guessed',()=>{const b=variantBinding(card);assert.equal(variantJobKey(b),variantJobKey({...b}));assert.notEqual(variantJobKey(b),variantJobKey({...b,identityRevision:2}));const action={type:'VARIANT_CONFIRM',...Object.fromEntries(['sourceHash','identityRevision','identityHash'].map(k=>[k,b[k]])),jobId:hash,resultHash:hash,decision:'SELECTED',candidateId:candidate.candidateId,reviewed:true};validateVariantAction(action);assert.equal(variantSelectedIdentity(card,action,{catalog}).parallel,'Reverse Holo');assert.throws(()=>variantSelectedIdentity(card,action,{catalog:{candidates:[{...candidate,parallel:null}]}}),{code:'VARIANT_FINISH_UNRESOLVED'});assert.throws(()=>validateVariantAction({...action,decision:'MANUAL',candidateId:null,manualParallel:'',observedFeatures:'foil visible'}));});
test('status exposes only current binding, saved result and explicit human confirmation; worker gets no confirmation INSERT',()=>{const s=variantReviewStatus({card,job:null,confirmation:null,approvalReady:false,reason:'VARIANT_CONFIRMATION_REQUIRED'});assert.equal(s.state,'NOT_REQUESTED');assert.equal(s.revision,4);assert.equal(s.sourceHash,hash);assert.equal(s.approvalReady,false);assert.equal(s.response,undefined);assert(!/INSERT ON atlas_manual_connected.variant_confirmation/.test(variantJobGrantSQL('atlas_variant_worker',{worker:true})));assert.throws(()=>variantJobGrantSQL('unsafe"role'));});

test('repeated wake calls do not overlap discovery with an active label read',async()=>{
 let claimed=false,providerActive=false,discoveries=0,finish;const responseGate=new Promise(r=>finish=r),snapshot=labelCatalog({photos:1}),row={key:'isolated',input:variantBinding(card),catalog:snapshot};let readings=[];
 const store={discover:async()=>{assert.equal(providerActive,false);discoveries++;},claim:async()=>{if(claimed)return null;claimed=true;return row;},renew:async()=>true,finish:async()=>true,
  codexReadings:async()=>({readings}),labelSource:async(_j,request,evidence)=>evidence?{state:'RESERVED',reservation:{request}}:{state:'MISSING'},saveLabelSource:async()=>true,publishLabelSource:async(_j,request)=>{readings=request.photos.map(p=>({sha256:p.sha256}));}};
 const provider=async()=>{providerActive=true;await responseGate;providerActive=false;return {};};provider.labelRequest=prepareVariantLabelRequest;provider.prepare=async()=>({evidence:{}});
 const worker=createVariantWorker({store,catalog:{},provider,projectResponse:()=>assert.fail('retired projector'),concurrency:1});
 worker.start();for(let i=0;i<20&&!providerActive;i++)await new Promise(r=>setImmediate(r));assert.equal(providerActive,true);assert.equal(discoveries,1);await Promise.all([worker.wake(),worker.wake(),worker.wake()]);assert.equal(discoveries,1);finish();await worker.stop();assert.equal(providerActive,false);
});

test('retired physical comparison is archived without replay or dispatch',async()=>{
 const row={key:'legacy',input:variantBinding(card),catalog,response:{version:'atlas-variant-photo-comparison-v1'},dispatch_id:'historic'};let claimed=false,finished;
 const store={discover:async()=>{},claim:async()=>claimed?null:(claimed=true,row),renew:async()=>true,finish:async(_j,o)=>{finished=o;}};
 await createVariantWorker({store,catalog:{},provider:()=>assert.fail('retired provider')}).drainOnce();
 assert.equal(finished.state,'FAILED');assert.equal(finished.code,'VARIANT_LEGACY_WORKFLOW_RETIRED');
});

test('read-only source probes cannot dispatch even if a store incorrectly returns a reservation',async()=>{
 const row={key:'probe',claim_id:'probe-claim',input:{identity:{}}};let claimed=false,finished,calls=0;
 const store={discover:async()=>{},claim:async()=>{if(claimed)return null;claimed=true;return row;},renew:async()=>true,
  reserveListingSource:async(_job,_request,options)=>{assert.deepEqual(options,{retainedOnly:true});return {state:'RESERVED',reservation:{}};},
  saveListingSource:()=>assert.fail('No journal response write'),finish:async(_job,outcome)=>{finished=outcome;return true;}};
 const worker=createVariantWorker({store,catalog:{prepare:async(_input,{executeListingSource})=>executeListingSource({},()=>{calls++;assert.fail('Read-only probe dispatched');},{retainedOnly:true})},
  provider:()=>assert.fail('No model'),projectResponse:()=>assert.fail('No retired projector')});
 await worker.drainOnce();assert.equal(calls,0);assert.equal(finished.state,'RETRY');
});

for(const scenario of ['success','uncertain','saved_acknowledgement_lost','retained','priority'])test(`listing source ${scenario}: durable capability remains separate from photo-model dispatch`,async()=>{
 const events=[],row={key:'source-job',claim_id:'source-claim',input:{identity:{}}};let claimed=false,sourceCalls=0,finished;
 const source={bodyText:'retained raw provider body'},reservation={dispatchId:'source-dispatch'};
 const store={discover:async()=>{},claim:async()=>{if(claimed)return null;claimed=true;return row;},renew:async()=>true,
  reserveListingSource:async()=>{events.push('reserve committed');return scenario==='retained'?{state:'REUSED',source}:{state:'RESERVED',reservation};},
  saveListingSource:async(r,s)=>{assert.equal(r,reservation);assert.equal(s,source);events.push('response committed');if(scenario==='saved_acknowledgement_lost')throw Error('acknowledgement lost');return true;},
  codexReadings:async()=>({readings:[]}),publishLabelSource:async()=>{},saveCatalog:async()=>true,finish:async(_job,result)=>{finished=result;return true;},defer:async()=>{events.push('deferred');return true;},
  dispatch:async()=>assert.fail('No photo-model dispatch for an empty reference snapshot')};
 const noModel=()=>assert.fail('No model call');noModel.labelRequest=prepareVariantLabelRequest;
 let outcome,admissions=0;const worker=createVariantWorker({store,catalog:{prepare:async(_input,{executeListingSource})=>{
  outcome=await executeListingSource({requestKey:'public-identity'},async()=>{assert.equal(events[0],'reserve committed');events.push('HTTP');sourceCalls++;if(scenario==='uncertain')throw Error('transport lost');return source;});
  return labelCatalog({count:0,photos:0});}},loadPhotos:async()=>assert.fail('No private photos loaded'),provider:noModel,projectResponse:()=>assert.fail('No model projection'),
  admitDispatch:async()=>scenario!=='priority'||++admissions<2});
 await worker.drainOnce();
 assert.equal(sourceCalls,['retained','priority'].includes(scenario)?0:1);
 if(scenario==='priority'){assert.deepEqual(events,['deferred']);assert.equal(finished,undefined);}
 else{assert.equal(outcome.state,{success:'SAVED',uncertain:'UNKNOWN',saved_acknowledgement_lost:'UNKNOWN',retained:'REUSED'}[scenario]);assert(finished.result);}
});


test('Nick-shaped 240-photo catalog remains reviewable with32 saved readings after an uncertain next batch',async()=>{
 const f=await fixture({photos:240,retainedReadings:32,failProvider:true});
 await f.worker.drainOnce();await f.worker.drainOnce();
 assert.equal(f.sends(),1,'unknown paid batch is not dispatched again');
 assert.equal(f.rows[0].state,'READY');assert.equal(f.rows[0].result.catalog.referencePhotos.length,240);
 assert.equal(f.rows[0].result.referenceLabels.readings.length,32);
 assert.deepEqual(f.rows[0].result.labelProcessing,{total:240,read:32,unread:208});
 assert.equal(f.rows[0].result.suggestion.candidateId,null);
});
