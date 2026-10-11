import test from 'node:test';
import assert from 'node:assert/strict';
import {createVariantPhotoProvider,prepareVariantLabelRequest,projectVariantPhotoResponse,VARIANT_PHOTO_MODEL,VARIANT_PHOTO_POLICY} from '../src/variant-photo-provider.mjs';
import {variantCodexChoice,codexReadingKey} from '../src/variant-codex.mjs';
import {labelCatalog,labelPhoto,labelHash,labelResponse} from './variant-label-fixture.mjs';
import {variantCatalog} from './variant-fixture.mjs';
import {VARIANT_SOURCE_PHOTO_POLICY} from '../src/variant-source-photos.mjs';
const secret='synthetic-secret-not-a-key';
function providerFor(catalog,fetchImpl){return createVariantPhotoProvider({apiKey:secret,readReferenceImage:async r=>{assert.equal(r.candidateId,null);assert.equal(r.snapshot.snapshotHash,catalog.snapshotHash);const i=catalog.referencePhotos.findIndex(p=>p.imageId===r.imageId);return labelPhoto(i).media;},fetchImpl});}
test('labels reference slabs only, with bounded strict output and one-shot dispatch; never reads physical uploads',async()=>{
 const catalog=labelCatalog(),request=prepareVariantLabelRequest(catalog);let calls=0;
 const provider=providerFor(catalog,async(_url,options)=>{calls++;const body=JSON.parse(options.body);assert.equal(body.store,false);assert.equal(body.text.format.strict,true);assert.equal(body.max_output_tokens,6000);
  assert.equal(body.input[1].content.filter(p=>p.type==='input_image').length,2);assert.match(body.input[0].content,/base-card label may omit/);assert.doesNotMatch(options.body,/physical-source-secret/);return Response.json(labelResponse(request));});
 const prepared=await provider.prepare({catalog,input:{sourceHash:'physical-source-secret'},photos:{get FRONT(){assert.fail('private photos');}}});assert.equal(calls,0);
 assert.equal(prepared.evidence.requestSha256,labelHash(prepared.body));const saved=await provider({prepared});const result=projectVariantPhotoResponse(saved,catalog);
 assert.equal(result.readings.length,2);assert.equal(result.readings[0].candidateId,catalog.candidates[0].candidateId);assert.equal(result.readings[0].canonicalPrintingKey,variantCodexChoice(catalog.candidates[0]).key);
 await assert.rejects(provider({prepared}),{code:'VARIANT_REQUEST_UNPREPARED'});assert.equal(calls,1);
});
test('shared requests ignore physical identity, capture/source evidence changes, case and padded collectors',()=>{
 const a=labelCatalog(),b=labelCatalog({capturedAt:'2026-10-11T00:00:00.000Z',source:'updated source',candidateTransform:c=>{c.identity.cardNumber='39/192';c.identity.name='MAGIKARP';}});
 assert.notEqual(a.snapshotHash,b.snapshotHash);assert.notEqual(a.candidates[0].candidateId,b.candidates[0].candidateId);assert.deepEqual(prepareVariantLabelRequest(a),prepareVariantLabelRequest(b));
 const expanded=labelCatalog({count:3,photos:2});assert.equal(codexReadingKey(prepareVariantLabelRequest(a),a.referencePhotos[0].sha256),codexReadingKey(prepareVariantLabelRequest(expanded),a.referencePhotos[0].sha256),'new known variants do not re-bill a previously read photo');
});
test('96 retained photos remain available, but every model call is bounded to eight exact hashes',async()=>{
 const catalog=labelCatalog({count:48}),provider=providerFor(catalog,()=>assert.fail('no dispatch'));assert.equal(catalog.referencePhotos.length,96);
 await assert.rejects(provider.prepare({catalog}),{code:'VARIANT_DIAGNOSTIC_REFERENCE_REQUIRED'});
 const prepared=await provider.prepare({catalog,photoShas:catalog.referencePhotos.slice(88).map(i=>i.sha256)});assert.equal(prepared.evidence.request.photos.length,8);
 assert.throws(()=>prepareVariantLabelRequest(catalog,['f'.repeat(64)]),{code:'VARIANT_LABEL_REQUEST_CHANGED'});
});
test('hash mismatch and non-image bytes stop before a model call; failed dispatch cannot replay',async()=>{
 const catalog=labelCatalog();let calls=0;const provider=createVariantPhotoProvider({apiKey:secret,readReferenceImage:async()=>({...labelPhoto().media,sha256:'f'.repeat(64)}),fetchImpl:()=>calls++});
 await assert.rejects(provider.prepare({catalog}),{code:'VARIANT_IMAGE_CHANGED'});assert.equal(calls,0);
 const failed=providerFor(catalog,async()=>{calls++;throw Error('uncertain');}),prepared=await failed.prepare({catalog});await assert.rejects(failed({prepared}),/uncertain/);await assert.rejects(failed({prepared}),{code:'VARIANT_REQUEST_UNPREPARED'});assert.equal(calls,1);
});
test('retained labels reject invented printing IDs, duplicate/foreign images, missing text, refusal and changed bytes',async()=>{
 const catalog=labelCatalog(),request=prepareVariantLabelRequest(catalog),provider=providerFor(catalog,async()=>Response.json(labelResponse(request))),saved=await provider({prepared:await provider.prepare({catalog})});
 const original=JSON.parse(JSON.parse(saved.bodyText).output[0].content[0].text).readings;
 for(const edit of [r=>r[0].candidateKey='invented',r=>r[0].sha256='f'.repeat(64),r=>r[0].labelText=null,r=>r[1]=r[0]]){
  const readings=structuredClone(original);edit(readings);assert.throws(()=>projectVariantPhotoResponse({...saved,bodyText:JSON.stringify(labelResponse(request,readings))},catalog));
 }
 const incomplete=JSON.parse(saved.bodyText);incomplete.status='incomplete';assert.throws(()=>projectVariantPhotoResponse({...saved,bodyText:JSON.stringify(incomplete)},catalog),{code:'VARIANT_RESPONSE_INCOMPLETE'});
 const altered=labelCatalog({photos:1});assert.throws(()=>projectVariantPhotoResponse(saved,altered));
});
test('literal slab label lines survive retained-response projection; unrelated control characters remain invalid',async()=>{
 const catalog=labelCatalog(),request=prepareVariantLabelRequest(catalog),provider=providerFor(catalog,async()=>Response.json(labelResponse(request))),saved=await provider({prepared:await provider.prepare({catalog})});
 const readings=JSON.parse(JSON.parse(saved.bodyText).output[0].content[0].text).readings;
 readings[0].labelText='2020 POKEMON\nMAGIKARP\n#039\nGEM MT 10';
 readings[1].labelText='2020 POKEMON\r\nMAGIKARP\r\n#039\r\nGEM MT 10';
 const retained={...saved,bodyText:JSON.stringify(labelResponse(request,readings))},before=JSON.stringify(retained);
 const projected=projectVariantPhotoResponse(retained,catalog);
 assert.deepEqual(projected.readings.map(r=>r.labelText),readings.map(r=>r.labelText));
 assert.equal(JSON.stringify(retained),before,'projection never rewrites the already-billed response');
 for(const control of ['\t','\r','\u0000','\u001b','\u007f']){
  const invalid=structuredClone(readings);invalid[0].labelText=`PSA${control}10`;
  assert.throws(()=>projectVariantPhotoResponse({...saved,bodyText:JSON.stringify(labelResponse(request,invalid))},catalog),{code:'VARIANT_RESPONSE_INVALID'});
 }
 for(const field of ['reason','gradingCompany']){
  const invalid=structuredClone(readings);invalid[0][field]='First\nSecond';
  assert.throws(()=>projectVariantPhotoResponse({...saved,bodyText:JSON.stringify(labelResponse(request,invalid))},catalog),{code:'VARIANT_RESPONSE_INVALID'});
 }
});
test('historical physical-card model responses retain their original strict binding and projector',()=>{
 const image=variantCatalog.candidates[0].images[0],sha=labelHash('original'),input={sourceHash:labelHash('source'),identityHash:labelHash('identity'),identityRevision:1};
 const evidence={policy:VARIANT_PHOTO_POLICY,model:VARIANT_PHOTO_MODEL,...input,catalogHash:variantCatalog.snapshotHash,requestSha256:labelHash('request'),originals:{FRONT:sha,BACK:sha},photoDerivation:{policy:VARIANT_SOURCE_PHOTO_POLICY,sides:Object.fromEntries(['FRONT','BACK'].map(side=>[side,{originalSha256:sha,frameSha256:sha,comparisonSha256:sha}]))},references:[{candidateId:variantCatalog.candidates[0].candidateId,imageId:image.imageId,sha256:image.sha256}],candidateIds:[variantCatalog.candidates[0].candidateId]};
 const answer={candidateId:variantCatalog.candidates[0].candidateId,confidence:.9,reason:'Historical physical observation.',evidence:[{side:'FRONT',sha256:sha,observation:'Recorded visible feature.'}]};
 const body=labelResponse({photos:[],choices:[]});body.output[0].content[0].text=JSON.stringify(answer);const saved={version:VARIANT_PHOTO_POLICY,requestEvidence:evidence,httpStatus:200,bodyText:JSON.stringify(body)};
 assert.deepEqual(projectVariantPhotoResponse(saved,variantCatalog,input),answer);assert.throws(()=>projectVariantPhotoResponse(saved,variantCatalog,{...input,sourceHash:labelHash('different')}),{code:'VARIANT_RESPONSE_BINDING_INVALID'});
});
