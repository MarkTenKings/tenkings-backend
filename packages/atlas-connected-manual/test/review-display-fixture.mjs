import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {verifyAndDecodePhoto,deriveSdrWorkingPhoto,describeDecodedFrame} from '@atlas/photo-runtime';
import {createReviewDisplay,REVIEW_DISPLAY_POLICY} from '../src/review-display.mjs';
export const sha=value=>createHash('sha256').update(value).digest('hex');
const bytes=await readFile(new URL('../../atlas-photo-runtime/test/fixtures/browser-canvas/opaque-p3.png',import.meta.url));
const object={key:'test/originals/front',versionId:null};
export const working=await deriveSdrWorkingPhoto(await verifyAndDecodePhoto({bytes,limits:{maxInputBytes:2e6,maxPixels:1e6,maxRasterBytes:8e6,maxOutputBytes:4e6,timeoutMs:5000},
  observedObject:object,uploadPlan:{schemaVersion:1,uploadId:'synthetic-upload',binding:{cardId:'synthetic-card',pairId:'pair',side:'FRONT',version:1},object,expected:{byteCount:bytes.length,sha256:sha(bytes)}}}));
export const photo={original:working.original,decodePlan:working.decodePlan,workingFrame:describeDecodedFrame(working,{id:'working',object:{key:'test/derived/working.png',versionId:null}})};
export const photoSource={ref:{sha256:'a'.repeat(64)}};
export function setup({real=false}={}){
 const f={generations:[],reads:0,writes:[],grants:[],jobs:new Map(),errors:[],objects:new Map()};
 for(const variant of ['context','full'])f.jobs.set(variant,{variant,state:'QUEUED',attempts:0,card_id:'synthetic-card',upload_id:'synthetic-upload',photoSource,prepared:null});
 f.store={async discover(){f.discoveries=(f.discoveries??0)+1;},async read(_source,variant){return f.jobs.get(variant);},async inspection(){return null;},
  async claim(){const job=[...f.jobs.values()].find(x=>x.state==='QUEUED'&&!x.delayed);if(!job)return null;job.state='RUNNING';job.attempts++;job.claim_id=String(job.attempts);return structuredClone(job);},
  async renew(){return f.lease!==false;},async finish(job,value){f.finishes=(f.finishes??0)+1;if(f.beforeFinish)await f.beforeFinish(job,value);if(f.lease===false)return false;
   const live=f.jobs.get(job.variant);Object.assign(live,value,{state:value.result?'READY':value.retry?'QUEUED':'FAILED',delayed:value.retry});return true;}};
 f.storage={async readDecodedFrame(){f.reads++;return{bytes:working.png};},async writeDerivative({descriptor,bytes}){f.writes.push(descriptor);f.objects.set(descriptor.raster.object.key,Buffer.from(bytes));return descriptor;},
  async createImmutableDerivativeRead({descriptor}){f.grants.push(descriptor);return{...descriptor.raster.content,url:`https://storage.invalid/${sha(descriptor.id)}?v=${f.grants.length}`};}};
 f.dependencies={store:f.store,storage:f.storage,intake:{async readSource(){return{upload:{source:photoSource},photo};}},artifacts:{},authorityFor:async()=>({}),
  keyPrefix:'test',onError:error=>f.errors.push(error),timers:{setInterval:()=>({unref(){}}),clearInterval(){}},
  ...(real?{}:{generate:async input=>{f.generations.push(input.output);assert.equal(input.frame,photo.workingFrame);
    if(f.beforeGenerate)await f.beforeGenerate(input);const bytes=Buffer.from(input.output);return{policyVersion:REVIEW_DISPLAY_POLICY,sourceSha256:photo.workingFrame.raster.content.sha256,
      [input.output]:{bytes,content:{mime:input.output==='full'?'image/webp':'image/jpeg',byteCount:bytes.length,sha256:sha(bytes)},dimensions:input.output==='full'?working.raster.dimensions:{width:24,height:32}}};}})};
 f.service=createReviewDisplay(f.dependencies);
 f.until=async condition=>{for(let i=0;i<200&&!condition();i++)await new Promise(resolve=>setTimeout(resolve,5));assert(condition(),'worker did not settle');};
 f.run=async()=>{f.service.start();await f.until(()=>[...f.jobs.values()].every(j=>['READY','FAILED'].includes(j.state)||j.delayed));};
 return f;
}
