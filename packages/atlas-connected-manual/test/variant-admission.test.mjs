import test from 'node:test';
import assert from 'node:assert/strict';
import {createVariantAdmission} from '../src/variant-admission.mjs';
import {createVariantWorker} from '../src/variant-worker.mjs';
import {variantCatalog as catalog} from './variant-fixture.mjs';

test('priority observation fails closed and carries only the exact current recheck exclusion',async()=>{
 let row={batch_busy:false,identification_busy:false,analysis_busy:false},seen;
 const admission=createVariantAdmission({boundary:{machineTransaction:async(_staff,fn)=>fn({tx:{$queryRawUnsafe:async(sql,actionId)=>{seen={sql,actionId};return[row];}}})}});
 assert.equal(await admission(),true);assert.equal(seen.actionId,null);
 for(const key of Object.keys(row)){row[key]=true;assert.equal(await admission(),false);row[key]=false;}
 const actionId='11111111-1111-4111-8111-111111111111';await admission({actionId});assert.equal(seen.actionId,actionId);
 row={};await assert.rejects(admission(),{code:'VARIANT_ADMISSION_UNAVAILABLE'});
});

test('grading arriving during preparation defers before DISPATCH; known busy work is never claimed',async()=>{
 let busy=true,claims=0,prepares=0,dispatches=0,sends=0,deferrals=0,finished=0,row={input:{},catalog:null};
 const store={discover:async()=>{},claim:async()=>{claims++;return claims<=1?row:null;},renew:async()=>true,saveCatalog:async()=>true,defer:async()=>{deferrals++;return true;},dispatch:async()=>{dispatches++;return true;},response:async()=>true,finish:async()=>{finished++;return true;}};
 const provider=async()=>{sends++;return {};};provider.prepare=async()=>{prepares++;busy=true;return {evidence:{}};};
 const worker=createVariantWorker({store,catalog:{prepare:async()=>catalog},loadPhotos:async()=>({}),provider,projectResponse:()=>({candidateId:null}),concurrency:1,admitDispatch:async()=>!busy});
 await worker.drainOnce();assert.equal(claims,0);busy=false;await worker.drainOnce();
 assert.equal(prepares,1);assert.equal(deferrals,1);assert.equal(dispatches,0);assert.equal(sends,0);assert.equal(finished,0);
});

test('arrival after the last admission may overlap one admitted POST; it cannot be falsely reported as isolated capacity',async()=>{
 let claimed=false,busy=false,dispatches=0,sends=0;
 const store={discover:async()=>{},claim:async()=>{if(claimed)return null;claimed=true;return{input:{},catalog};},renew:async()=>true,dispatch:async()=>{dispatches++;busy=true;return true;},response:async()=>true,finish:async()=>true};
 const worker=createVariantWorker({store,catalog:{},loadPhotos:async()=>({}),provider:async()=>{assert.equal(busy,true);sends++;return{};},projectResponse:()=>({candidateId:null}),concurrency:1,admitDispatch:async()=>!busy});
 await worker.drainOnce();assert.equal(dispatches,1);assert.equal(sends,1);
});
