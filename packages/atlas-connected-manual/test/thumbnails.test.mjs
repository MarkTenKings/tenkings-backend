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
test('thumbnail reads only the prepared generated photo and never substitutes original pixels',async()=>{
 const f=fixture();let r=await f.run();assert.equal(r.images.FRONT.state,'PENDING');assert.deepEqual(f.grants,[]);
 f.dependencies.readCleanDescriptor=async({side})=>({url:'https://clean.invalid/'+side,byteCount:1000});
 r=await f.run();assert.equal(r.images.FRONT.state,'READY');assert.equal(r.images.FRONT.preview.byteCount,1000);
 assert.deepEqual(f.grants,[]);
});
for(const field of ['revision','sourceHash','manualRevision'])test(`late ${field} substitution cannot return thumbnail grants`,async()=>{
 const f=fixture();f.beforeFinish=()=>{if(field==='sourceHash')f.sourceHash='b'.repeat(64);else f[field]++;};await assert.rejects(f.run(),{code:'MANUAL_PHOTOS_CHANGED'});
});
test('revoked source read fails without granting even a context image',async()=>{
 const f=fixture();f.dependencies.intake.readSource=async()=>{throw fail('INTAKE_ACCESS_DENIED');};await assert.rejects(f.run(),{code:'INTAKE_ACCESS_DENIED'});assert.equal(f.grants.length,0);
});

test('ready upfront cutout is used for navigation without image generation or geometry preparation',async()=>{
 const f=fixture();f.dependencies.readCleanDescriptor=async({side})=>({url:'https://saved.invalid/'+side,sha256:'b'.repeat(64),byteCount:1200,width:40,height:56,generative:true});
 const r=await f.run();assert.equal(r.images.FRONT.preview.generative,true);assert.equal(r.images.BACK.state,'READY');assert.equal(f.grants.length,0);assert.equal(f.reads,2);
});
