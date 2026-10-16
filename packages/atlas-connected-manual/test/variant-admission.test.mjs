import test from 'node:test';
import assert from 'node:assert/strict';
import {canonical,digest} from '@atlas/manual-service/contract';
import {createVariantAdmission} from '../src/variant-admission.mjs';
import {createVariantWorker} from '../src/variant-worker.mjs';
import {labelCatalog} from './variant-label-fixture.mjs';
import {prepareVariantLabelRequest} from '../src/variant-photo-provider.mjs';
const catalog=labelCatalog({photos:1});

test('priority observation fails closed and carries only the exact current recheck exclusion',async()=>{
 let row={batch_busy:false,identification_busy:false,analysis_busy:false},seen;
 const admission=createVariantAdmission({boundary:{machineTransaction:async(_staff,fn)=>fn({principal:{mode:'LOCAL_FIXTURE'},tx:{$queryRawUnsafe:async(sql,actionId,mode)=>{seen={sql,actionId,mode};return[row];}}})}});
 assert.equal(await admission(),true);assert.equal(seen.actionId,null);
 assert.doesNotMatch(seen.sql,/read_grading_photo|p\.state IN/,'terminal photo failures no longer exempt active grading batches');
 for(const key of Object.keys(row)){row[key]=true;assert.equal(await admission(),false);row[key]=false;}
 const actionId='11111111-1111-4111-8111-111111111111';await admission({actionId});assert.equal(seen.actionId,actionId);
 row={};await assert.rejects(admission(),{code:'VARIANT_ADMISSION_UNAVAILABLE'});
 const missingPrincipal=createVariantAdmission({boundary:{machineTransaction:async(_staff,fn)=>fn({tx:{$queryRawUnsafe:async()=>assert.fail('missing mode cannot observe photo bindings')}})}});
 await assert.rejects(missingPrincipal(),{code:'VARIANT_ADMISSION_UNAVAILABLE'});
});

test('busy grading permits claiming but defers a missing paid batch before DISPATCH',async()=>{
 let busy=true,claims=0,prepares=0,dispatches=0,sends=0,deferrals=0,finished=0,row={input:{},catalog:null};
 const store={discover:async()=>{},claim:async()=>{claims++;return claims<=1?row:null;},renew:async()=>true,saveCatalog:async()=>true,defer:async()=>{deferrals++;return true;},dispatch:async()=>{dispatches++;return true;},response:async()=>true,finish:async()=>{finished++;return true;}};
 store.codexReadings=async()=>({readings:[]});store.labelSource=async(_job,_request,evidence)=>evidence?{state:'RESERVED',reservation:{}}:{state:'MISSING'};store.publishLabelSource=async()=>{};
 const provider=async()=>{sends++;return {};};provider.labelRequest=prepareVariantLabelRequest;provider.prepare=async()=>{prepares++;busy=true;return {evidence:{}};};
 const worker=createVariantWorker({store,catalog:{prepare:async()=>catalog},loadPhotos:async()=>({}),provider,projectResponse:()=>({candidateId:null}),concurrency:1,admitDispatch:async()=>!busy});
 await worker.drainOnce();assert.equal(claims,1);
 assert.equal(prepares,1);assert.equal(deferrals,1);assert.equal(dispatches,0);assert.equal(sends,0);assert.equal(finished,0);
});

test('arrival after the last admission may overlap one admitted POST; it cannot be falsely reported as isolated capacity',async()=>{
 let claimed=false,busy=false,dispatches=0,sends=0;
 const store={discover:async()=>{},claim:async()=>{if(claimed)return null;claimed=true;return{input:{},catalog};},renew:async()=>true,dispatch:async()=>{dispatches++;busy=true;return true;},response:async()=>true,finish:async()=>true};
 store.codexReadings=async()=>({readings:[]});store.labelSource=async(_job,_request,evidence)=>{if(!evidence)return {state:'MISSING'};dispatches++;busy=true;return {state:'RESERVED',reservation:{}};};store.saveLabelSource=async()=>true;store.publishLabelSource=async()=>{};
 const provider=async()=>{assert.equal(busy,true);sends++;return{};};provider.labelRequest=prepareVariantLabelRequest;provider.prepare=async()=>({evidence:{}});
 const worker=createVariantWorker({store,catalog:{},provider,projectResponse:()=>({candidateId:null}),concurrency:1,admitDispatch:async()=>!busy});
 await worker.drainOnce();assert.equal(dispatches,1);assert.equal(sends,1);
});

test('fair dispatch survives restart and minute boundaries, gives young grading priority, and writes nothing on refused polls',async()=>{
 let now=119000,busy=true,aged=false,identity={cardName:'Exact current physical identity'};const identityHash=digest(canonical(identity)),records=[],jobKey='a'.repeat(64),claimId='11111111-1111-4111-8111-111111111111';
 const boundary={machineTransaction:async(_,work)=>work({principal:{mode:'LOCAL_FIXTURE'},tx:{
  async $queryRawUnsafe(sql,...args){
   if(sql.includes('AS batch_busy'))return [{batch_busy:busy,identification_busy:false,analysis_busy:false}];
   if(sql.includes('AS observed_at'))return [{observed_at:new Date(now),window:String(Math.floor(now/60000)),aged,identity,identity_hash:identityHash}];
   assert(sql.includes('key=ANY($1::text[])'));return [{busy:records.some(r=>args[0].includes(r.key)&&r.at>now-60000)}];
  },async $executeRawUnsafe(sql,...args){if(sql.startsWith('INSERT'))records.push({key:args[0],at:now});return 1;}
 }})};
 const permit={jobKey,claimId},admit=()=>createVariantAdmission({boundary})(permit);
 assert.equal(await admit(),false);assert.equal(records.length,0);aged=true;assert.equal(await admit(),true);
 now=120000;for(let n=0;n<12;n++)assert.equal(await admit(),false);assert.equal(records.length,1,'a new process/minute cannot reset the allowance');
 now=179000;assert.equal(await admit(),true);assert.equal(records.length,2);
 busy=false;assert.equal(await admit(),true);assert.equal(await admit(),true);assert.equal(records.length,4,'idle work uses ordinary bounded worker capacity');
 busy=true;now=180001;assert.equal(await admit(),false);assert.equal(records.length,4,'multiple idle permissions in the previous minute still suppress early busy dispatch');
 now=239000;assert.equal(await admit(),true);assert.equal(records.length,5);
 busy=false;identity={cardName:'Changed without matching current identity hash'};assert.equal(await admit(),false);assert.equal(records.length,5,'stale physical identity cannot authorize new acquisition');
});

test('missing-image page admission is carried from the worker and denied acquisition keeps the job queued',async()=>{
 let claimed=false,deferrals=0,permissions=0;
 const worker=createVariantWorker({store:{discover:async()=>{},claim:async()=>claimed?null:(claimed=true,{input:{}}),renew:async()=>true,
  defer:async()=>{deferrals++;return true;},finish:()=>assert.fail('denied image acquisition must not finalize the saved catalog')},
  catalog:{prepare:async(_input,{admitImageAcquisition})=>{await admitImageAcquisition();assert.fail('missing image fetch must remain gated');}},
  provider:async()=>assert.fail('no paid label call'),admitDispatch:async()=>{permissions++;return false;}});
 await worker.drainOnce();assert.equal(permissions,1);assert.equal(deferrals,1);
});
