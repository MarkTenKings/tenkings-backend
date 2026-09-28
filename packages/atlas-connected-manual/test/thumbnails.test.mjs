import test from 'node:test';import assert from 'node:assert/strict';
import {createThumbnailReader} from '../src/thumbnails.mjs';
const fail=code=>Object.assign(Error(code),{code});
function fixture(){
 const f={reads:0,grants:[],revision:2,sourceHash:'a'.repeat(64),manualRevision:4};
 const card=()=>({cardId:'card',sourceHash:f.sourceHash,revision:f.revision,sides:Object.fromEntries(['FRONT','BACK'].map(side=>[side,{upload:{uploadId:side,source:{ref:{sha256:side}}}}]))});
 f.dependencies={intake:{async read(){if(++f.reads===2)f.beforeFinish?.();return{card:card()};},async readSource(_s,_c,side){return{photo:{workingFrame:{side}}};}},
  workflow:{service:{async read(){if(f.noManual)throw fail('MANUAL_CARD_NOT_FOUND');return{revision:f.manualRevision,contentHash:String(f.manualRevision),draft:{source:{sourceHash:f.sourceHash}}};}}},
  async readManifest(_card,side){return{images:{inspection:{side}},inspectionPreview:{side}};},
  reviewDisplay:{async inspection(photo,image){if(f.noInspection)return null;f.grants.push('small-'+image.side);return{url:'https://small.invalid/'+image.side,byteCount:1000,sourceSha256:image.side};}},
  async imageReadUrl(input){assert.equal(input.contextOnly,true);f.grants.push('context-'+input.photo.workingFrame.side);return{displayState:{state:f.failed?'FAILED':'PENDING',...(f.failed?{code:'PHOTO_DECODE_INVALID',retry:{jobId:'source-job',photoSourceHash:'a'.repeat(64)}}:{})},...(f.context?{preview:{url:'https://small.invalid/context',byteCount:900}}:{})};}};
 f.run=()=>createThumbnailReader(f.dependencies)({},'card');return f;
}
test('thumbnail API reads only small inspection grants and final source/revision fences',async()=>{
 const f=fixture(),r=await f.run();assert.equal(r.images.FRONT.state,'READY');assert.equal(r.images.FRONT.preview.byteCount,1000);
 assert.deepEqual(f.grants.sort(),['small-BACK','small-FRONT']);assert.equal(f.reads,2);assert.equal(r.sourceHash,f.sourceHash);
});
test('partial intake falls back only to independent context, never full working PNG',async()=>{
 const f=fixture();f.noManual=true;f.context=true;const r=await f.run();assert.equal(r.images.BACK.preview.byteCount,900);assert.deepEqual(f.grants.sort(),['context-BACK','context-FRONT']);
 const g=fixture();g.noInspection=true;const pending=await g.run();assert.equal(pending.images.FRONT.state,'PENDING');assert.equal(pending.images.FRONT.preview,undefined);
 g.failed=true;const failed=(await g.run()).images.FRONT;assert.equal(failed.state,'FAILED');assert.deepEqual(failed.retry,{jobId:'source-job',photoSourceHash:'a'.repeat(64)});assert.equal(failed.retryable,true);
});
for(const field of ['revision','sourceHash','manualRevision'])test(`late ${field} substitution cannot return thumbnail grants`,async()=>{
 const f=fixture();f.beforeFinish=()=>{if(field==='sourceHash')f.sourceHash='b'.repeat(64);else f[field]++;};await assert.rejects(f.run(),{code:'MANUAL_PHOTOS_CHANGED'});
});
test('revoked source read fails without granting even a context image',async()=>{
 const f=fixture();f.dependencies.intake.readSource=async()=>{throw fail('INTAKE_ACCESS_DENIED');};await assert.rejects(f.run(),{code:'INTAKE_ACCESS_DENIED'});assert.equal(f.grants.length,0);
});

test('bad optional inspection falls back to independent context and unavailable context has an explicit failure state',async()=>{
 const f=fixture();f.context=true;f.dependencies.reviewDisplay.inspection=async()=>{throw fail('MANUAL_PREVIEW_BINDING_INVALID');};
 const context=await f.run();assert.equal(context.images.FRONT.state,'READY');assert.equal(context.images.FRONT.preview.byteCount,900);
 f.dependencies.imageReadUrl=async()=>{throw fail('PHOTO_STORAGE_UNAVAILABLE');};const unavailable=await f.run();
 assert.deepEqual(unavailable.images.FRONT,{state:'FAILED',code:'MANUAL_PREVIEW_UNAVAILABLE',retryable:false});assert.equal(unavailable.images.FRONT.preview,undefined);
});
test('preview fallback cannot swallow source authority or cancellation',async()=>{
 for(const error of [Object.assign(fail('INTAKE_ACCESS_DENIED'),{status:403}),Object.assign(Error(),{name:'AbortError'})]){
  const f=fixture();f.dependencies.reviewDisplay.inspection=async()=>{throw error;};await assert.rejects(f.run(),e=>e===error);
 }
});
