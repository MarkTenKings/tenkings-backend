import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import sharp from 'sharp';
import {descriptorSha256,planDecode} from '@atlas/photo-core';
import {createOrderDeskPhotoReader} from '../src/order-desk-photos.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
async function fixture(side='FRONT') {
  const accountId=randomUUID(),cardId=randomUUID(),pairId=randomUUID(),draftId=randomUUID(),uploadId=randomUUID();
  const bytes=await sharp({create:{width:40,height:60,channels:3,background:side==='FRONT'?'#ae2131':'#132bae'}}).png().toBuffer();
  const plan={schemaVersion:1,uploadId,binding:{cardId,pairId,side,version:1},object:{key:`atlas-customer/originals/${accountId}/${cardId}/${uploadId}`,versionId:null},expected:{sha256:sha(bytes),byteCount:bytes.length}};
  const verification={object:{...plan.object,versionId:'original-v1'},sha256:sha(bytes),byteCount:bytes.length,contentType:'application/octet-stream'};
  const original={schemaVersion:1,kind:'original',uploadId,binding:plan.binding,object:verification.object,content:{mime:'image/png',sha256:sha(bytes),byteCount:bytes.length},metadata:null};
  const decodePlan=planDecode(original,{encoded:{width:40,height:60},orientation:1,orientationSource:'identity',crop:null,selection:{kind:'single-frame'},bitDepth:8,iccSha256:null,colorSpace:'sRGB',dynamicRange:'SDR'},
    {maxInputBytes:100000,maxPixels:10000,maxRasterBytes:80000,maxOutputBytes:100000,timeoutMs:5000});
  const decodedFrame={schemaVersion:1,kind:'decoded-frame',id:uploadId,originalDescriptorSha256:descriptorSha256(original),decodePlanSha256:descriptorSha256(decodePlan),
    raster:{object:{key:`atlas-customer/derived/${cardId}/${uploadId}/decoded.png`,versionId:'decoded'},content:{mime:'image/png',sha256:sha(bytes),byteCount:bytes.length},dimensions:{width:40,height:60}},sourceToFrame:decodePlan.geometry.matrix,
    treatment:{decoder:'fixture',version:'1',policyVersion:'fixture',channels:3,bitDepth:8,colorSpace:'sRGB',colorTreatment:'converted',hdrTreatment:'not-present'}};
  const workingFrame={...decodedFrame,schemaVersion:2,id:`${uploadId}-working`,raster:{...decodedFrame.raster,object:{key:`atlas-customer/derived/${cardId}/${uploadId}/working.png`,versionId:'working'}},
    treatment:{...decodedFrame.treatment,policyVersion:'atlas-sdr-working-srgb8-v1'},workingImage:{policyVersion:'atlas-sdr-working-srgb8-v1',sourceRaster:{content:decodedFrame.raster.content,dimensions:decodedFrame.raster.dimensions},sourceTreatment:decodedFrame.treatment,
      outputIccSha256:'c56e1685d888f5edb92fe07f2750f387f8fe8e91b32ff8fb0b56bfbbb9458353',geometryTreatment:'identity-no-resampling'}};
  const source={orderId:randomUUID(),uploadId,paidPhotoPairHash:'a'.repeat(64),photoPairHash:'a'.repeat(64),upload:{accountId,cardId,pairId,draftId,side,plan,verification,prepared:{original,decodePlan,decodedFrame,workingFrame}}};
  const f={source,bytes,reads:0,found:{bytes,object:workingFrame.raster.object,sha256:sha(bytes),byteCount:bytes.length,contentType:'image/png'}};
  f.storage={readDecodedFrame:async()=>{f.reads++;return f.found;}};return f;
}
test('actual customer Front/Back get independent JPEG previews and enlargement without storage/provider writes',async()=>{
  const front=await fixture(),back=await fixture('BACK');
  const read=createOrderDeskPhotoReader({storage:{readDecodedFrame:async({frame})=>frame.raster.content.sha256===front.found.sha256?front.found:back.found}});
  const a=await read.read(front.source,'thumbnail'),b=await read.read(back.source,'detail');
  assert.equal(a.contentType,'image/jpeg');assert.equal(b.contentType,'image/jpeg');assert.notEqual(a.sha256,b.sha256);
  assert.equal(sha(a.bytes),a.sha256);assert.deepEqual(await sharp(a.bytes).metadata().then(v=>[v.width,v.height,v.format]),[40,60,'jpeg']);
  assert.deepEqual([b.width,b.height],[40,60]);assert.equal(front.source.upload.prepared.original.content.sha256,sha(front.bytes));
});
test('cached derivatives preserve byte ownership, side/upload/order scope and bounded eviction',async()=>{
  const f=await fixture();let generations=0;
  const generate=async input=>{generations++;const bytes=Buffer.from(`fixture-${generations}`);return{sourceSha256:input.frame.raster.content.sha256,[input.output]:{bytes,content:{mime:'image/jpeg',sha256:sha(bytes),byteCount:bytes.length},dimensions:{width:40,height:60}}};};
  const reader=createOrderDeskPhotoReader({storage:f.storage,generate,maxCacheBytes:24});
  const a=await reader.read(f.source,'thumbnail');a.bytes.fill(0);assert.match((await reader.read(f.source,'thumbnail')).bytes.toString(),/^fixture-/);assert.equal(generations,1);
  await reader.read(f.source,'detail');assert.equal(generations,2);
  await reader.read({...f.source,orderId:randomUUID()},'thumbnail');assert.equal(generations,3);
  await reader.read(f.source,'thumbnail');assert.equal(generations,4);
});
test('concurrent reads coalesce only exact source and variant; no partial cache after failure',async()=>{
  const f=await fixture();let generations=0;
  const generate=async input=>{generations++;await new Promise(resolve=>setTimeout(resolve,10));const bytes=Buffer.from('safe');return{sourceSha256:input.frame.raster.content.sha256,[input.output]:{bytes,content:{mime:'image/jpeg',sha256:sha(bytes),byteCount:bytes.length},dimensions:{width:40,height:60}}};};
  const reader=createOrderDeskPhotoReader({storage:f.storage,generate});const [a,b]=await Promise.all([reader.read(f.source,'thumbnail'),reader.read(f.source,'thumbnail')]);assert.deepEqual(a,b);assert.equal(generations,1);assert.equal(f.reads,1);
  const broken=await fixture();broken.found.bytes=Buffer.from('corrupt');const rejected=createOrderDeskPhotoReader({storage:broken.storage,generate});
  for(let i=0;i<2;i++)await assert.rejects(rejected.read(broken.source,'thumbnail'),{code:'ORDER_PHOTO_BINDING_INVALID'});assert.equal(broken.reads,2);assert.equal(generations,1);
});
test('unprepared uploads, wrong pair, swapped upload/account/frame and oversize output fail closed',async()=>{
  for(const mutate of [s=>s.photoPairHash='b'.repeat(64),s=>s.uploadId=randomUUID(),s=>s.upload.accountId=randomUUID(),s=>s.upload.prepared.workingFrame.originalDescriptorSha256='0'.repeat(64),s=>s.upload.prepared.workingFrame.raster.object.key='atlas-manual/derived/wrong']){
    const f=await fixture();mutate(f.source);const reader=createOrderDeskPhotoReader({storage:f.storage});await assert.rejects(reader.read(f.source,'thumbnail'));assert.equal(f.reads,0);
  }
  const f=await fixture();f.source.upload.prepared=null;await assert.rejects(createOrderDeskPhotoReader({storage:f.storage}).read(f.source,'detail'),{code:'ORDER_PHOTO_NOT_PREPARED'});assert.equal(f.reads,0);
  const g=await fixture();const bytes=Buffer.alloc(4194305);const reader=createOrderDeskPhotoReader({storage:g.storage,generate:async input=>({sourceSha256:input.frame.raster.content.sha256,full:{bytes,content:{mime:'image/jpeg',sha256:sha(bytes),byteCount:bytes.length},dimensions:{width:40,height:60}}})});
  await assert.rejects(reader.read(g.source,'detail'),{code:'ORDER_PHOTO_BINDING_INVALID'});
});
