import test from 'node:test';
import assert from 'node:assert/strict';
import {createVariantCatalogService} from '../src/variant-catalog.mjs';
import {variantCodexChoice,codexLibraryKey,codexReadingKey,validateCodexLibrary,validateVariantReferenceLabels} from '../src/variant-codex.mjs';
import {createVariantWorker} from '../src/variant-worker.mjs';
import {prepareVariantLabelRequest} from '../src/variant-photo-provider.mjs';
import {labelCatalog,labelPhoto,labelHash} from './variant-label-fixture.mjs';
import {variantIdentity} from './variant-fixture.mjs';

test('all48known printings receive two photo slots; seller title never establishes the association',async()=>{
 const catalog=labelCatalog({count:48}),calls=[];
 const service=createVariantCatalogService({providers:[{prepare:async()=>({candidates:catalog.candidates,problems:[],truncated:false})}],listingProvider:{acquireImages:async({request},{imageLimit})=>{
  assert.equal(imageLimit,2);calls.push(request.printing.name);const index=catalog.candidates.findIndex(c=>c.label.toLowerCase()===request.printing.name.toLowerCase());assert(index>=0);
  return {referencePhotos:[labelPhoto(index*2,'fixture').image,labelPhoto(index*2+1,'fixture').image]};}}});
 const snapshot=await service.prepare({identity:variantIdentity},{executeListingSource:async()=>({state:'REUSED',source:{sha256:labelHash('fixture')}})});
 assert.equal(calls.length,48);assert.equal(new Set(calls).size,48);assert.equal(snapshot.candidates.length,48);assert.equal(snapshot.referencePhotos.length,96);assert(snapshot.candidates.every(c=>c.images.length===0));
});
test('stable manufacturer IDs exclude retained checklist bytes; provider card+printing IDs remain explicit',()=>{
 const make=source=>labelCatalog({source,candidateTransform:c=>{c.authority='provider_candidate';c.canonical=null;c.applicability='unknown';c.source.provider='manufacturer_checklist';c.source.recordId=`manufacturer-row:v1:${labelHash(source)}`;c.source.url='https://www.paniniamerica.net/checklist.html';c.warnings=['APPLICABILITY_UNCONFIRMED'];}});
 const a=make('one'),b=make('two');assert.notEqual(a.candidates[0].candidateId,b.candidates[0].candidateId);assert.deepEqual(variantCodexChoice(a.candidates[0]),variantCodexChoice(b.candidates[0]));
 const scrydex={...a.candidates[0],source:{...a.candidates[0].source,provider:'scrydex',recordId:'sv3pt5-25:variant:reverseHolofoil'}};
 assert.deepEqual(variantCodexChoice(scrydex).catalog,{card:{provider:'scrydex',cardId:'sv3pt5-25',language:null},printing:{printingId:'reverseHolofoil'}});
});
test('library keeps exact image provenance and canonical IDs, tolerates display set spelling, refuses different core identity',()=>{
 const catalog=labelCatalog(),choice=variantCodexChoice(catalog.candidates[0]),image=catalog.referencePhotos[0];
 const saved={schemaVersion:'atlas-codex-library/v1',policy:'atlas-slab-label-association-v1',choice,references:[{image,reading:{sha256:image.sha256,candidateKey:choice.key,labelText:'Exact slab label',gradingCompany:'PSA'},responseHash:labelHash('response'),requestKey:'variant-label-source:v1:fixture'}]};
 const display={...choice,label:'New display label',identity:{...choice.identity,setName:'Verified new display spelling'}};assert.equal(validateCodexLibrary(saved,display),saved);
 assert.throws(()=>validateCodexLibrary(saved,{...choice,identity:{...choice.identity,year:'2021'}}),{code:'VARIANT_CODEX_LIBRARY_INVALID'});
 assert.throws(()=>validateCodexLibrary({...saved,references:[{...saved.references[0],image:{...image,sha256:'f'.repeat(64)}}]},choice));
 assert.throws(()=>validateVariantReferenceLabels({version:'atlas-slab-label-associations/v1',catalogHash:catalog.snapshotHash,readings:[{imageId:image.imageId,sha256:image.sha256,candidateId:catalog.candidates[0].candidateId,canonicalPrintingKey:'invented',labelText:'PSA',gradingCompany:'PSA',reason:'wrong'}]},catalog));
});
test('worker processes96photos in12bounded calls, never loads intake images or writes legacy dispatch fields',async()=>{
 const snapshot=labelCatalog({count:48}),readings=new Map(),calls=[],row={key:'fixture',claim_id:'claim',input:{identity:variantIdentity},catalog:snapshot};let claimed=false,result;
 const store={discover:async()=>{},claim:async()=>{if(claimed)return null;claimed=true;return row;},renew:async()=>true,
  codexReadings:async()=>({version:'atlas-slab-label-associations/v1',catalogHash:snapshot.snapshotHash,readings:[...readings.values()]}),
  labelSource:async(_j,request,evidence)=>evidence?{state:'RESERVED',reservation:{request}}:{state:'MISSING'},saveLabelSource:async()=>true,
  publishLabelSource:async(_j,request)=>{for(const p of request.photos)readings.set(p.sha256,{sha256:p.sha256});},finish:async(_j,o)=>{result=o;return true;},
  dispatch:()=>assert.fail('legacy dispatch'),response:()=>assert.fail('legacy response')};
 const provider=async({prepared})=>{calls.push(prepared.request.photos.length);return {};};provider.labelRequest=prepareVariantLabelRequest;provider.prepare=async({catalog,photoShas})=>({request:prepareVariantLabelRequest(catalog,photoShas),evidence:{}});
 const worker=createVariantWorker({store,catalog:{},provider,loadPhotos:()=>assert.fail('physical uploads'),projectResponse:()=>assert.fail('legacy projector')});await worker.drainOnce();
 assert.deepEqual(calls,Array(12).fill(8));assert.equal(result.result.referenceLabels.readings.length,96);assert.equal(result.result.suggestion.candidateId,null);
});

test('explicit missing-only refresh uses its saved generation, skips completed printings and already-read photo bytes',async()=>{
 const catalog=labelCatalog({count:2}),complete=catalog.candidates[0],choice=variantCodexChoice(complete),known=labelPhoto(2,'fixture').image,requests=[];
 const library={schemaVersion:'atlas-codex-library/v1',policy:'atlas-slab-label-association-v1',choice,references:[{image:labelPhoto(0,'fixture').image,reading:{sha256:labelPhoto(0,'fixture').image.sha256,candidateKey:choice.key,labelText:'Exact slab',gradingCompany:'PSA',reason:'Known label'},responseHash:labelHash('response'),requestKey:'saved'}]};
 const cache={getRetained:async key=>key===codexLibraryKey(choice)?library:key.startsWith('atlas-codex-reading:')&&key===codexReadingKey({policy:'atlas-slab-label-association-v1',model:'gpt-6-astra'},known.sha256)?{schemaVersion:'atlas-codex-reading/v1',policy:'atlas-slab-label-association-v1',reading:{sha256:known.sha256,candidateKey:null}}:null};
 const generation='ea7d85e4-c52a-41bc-b6f5-5c267daf55cb';
 const service=createVariantCatalogService({cache,providers:[{prepare:async()=>({candidates:catalog.candidates,problems:[],truncated:false})}],listingProvider:{acquireImages:async({request},{isKnownReference})=>{
  assert.equal(request.generation,generation);assert.equal(await isKnownReference(known.sha256),true);assert.equal(await isKnownReference(labelPhoto(3).image.sha256),false);return {referencePhotos:[labelPhoto(3,'fixture').image]};}}});
 const result=await service.prepare({identity:variantIdentity,generation},{executeListingSource:async request=>{requests.push(request);return {state:'REUSED',source:{sha256:labelHash('fixture')}};}});
 assert.equal(requests.length,1);assert.notEqual(requests[0].printing.name,complete.label.toLowerCase());assert.equal(result.referencePhotos.length,2);assert(result.referencePhotos.some(p=>p.sha256===library.references[0].image.sha256));
});
