import test from 'node:test';
import assert from 'node:assert/strict';
import {createVariantCatalogService} from '../src/variant-catalog.mjs';
import {variantCodexChoice,codexLibraryKey,codexReadingKey,validateCodexLibrary,validateVariantReferenceLabels,projectCodexReading,codexChoices} from '../src/variant-codex.mjs';
import {createVariantWorker} from '../src/variant-worker.mjs';
import {prepareVariantLabelRequest,projectVariantLabelResponse,VARIANT_LABEL_POLICY,VARIANT_PHOTO_MODEL} from '../src/variant-photo-provider.mjs';
import {labelCatalog,labelPhoto,labelHash,labelResponse} from './variant-label-fixture.mjs';
import {variantIdentity} from './variant-fixture.mjs';

test('all48known printings remain alongside96returned photos from one search; seller titles never establish associations',async()=>{
 const catalog=labelCatalog({count:48}),calls=[];
 const service=createVariantCatalogService({providers:[{prepare:async()=>({candidates:catalog.candidates,problems:[],truncated:false})}],listingProvider:{acquireImages:async({request},{imageLimit})=>{
  assert.equal(imageLimit,undefined);assert.equal(request.printing,undefined);calls.push(request.query);
  return {referencePhotos:Array.from({length:96},(_,index)=>labelPhoto(index,'fixture').image)};}}});
 const snapshot=await service.prepare({identity:variantIdentity},{executeListingSource:async(_r,_d,{retainedOnly=false}={})=>retainedOnly?{state:'MISSING'}:{state:'SAVED',source:{sha256:labelHash('fixture')}}});
 assert.equal(calls.length,1);assert.equal(snapshot.candidates.length,48);assert.equal(snapshot.referencePhotos.length,96);assert(snapshot.candidates.every(c=>c.images.length===0));
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
test('queued job publishes its retained multiline label response and reaches READY without another paid request',async()=>{
 const snapshot=labelCatalog(),request=prepareVariantLabelRequest(snapshot),literal='2020 POKEMON\nMAGIKARP\n#039\nGEM MT 10';
 const body=labelResponse(request,request.photos.map(p=>({sha256:p.sha256,candidateKey:request.choices[0].key,gradingCompany:'PSA',labelText:literal,reason:'Exact visible card and standard base printing.'})));
 const saved={version:VARIANT_LABEL_POLICY,requestEvidence:{policy:VARIANT_LABEL_POLICY,model:VARIANT_PHOTO_MODEL,requestSha256:labelHash('original paid body'),request},httpStatus:200,bodyText:JSON.stringify(body)};
 const original=JSON.stringify(saved),row={key:'recover-multiline',claim_id:'claim',input:{identity:variantIdentity},catalog:snapshot};let claimed=false,labels={version:'atlas-slab-label-associations/v1',catalogHash:snapshot.snapshotHash,readings:[]},finished;
 const store={discover:async()=>{},claim:async()=>{if(claimed)return null;claimed=true;return row;},renew:async()=>true,codexReadings:async()=>validateVariantReferenceLabels(labels,snapshot),
  labelSource:async(_job,requested,evidence)=>{assert.equal(evidence,undefined);assert.deepEqual(requested,request);return {state:'REUSED',response:saved};},
  publishLabelSource:async()=>{labels=projectVariantLabelResponse(saved,snapshot);const choice=request.choices[0];
   const library={schemaVersion:'atlas-codex-library/v1',policy:VARIANT_LABEL_POLICY,choice,references:labels.readings.map(r=>({image:snapshot.referencePhotos.find(p=>p.sha256===r.sha256),reading:{sha256:r.sha256,candidateKey:r.canonicalPrintingKey,gradingCompany:r.gradingCompany,labelText:r.labelText,reason:r.reason},responseHash:labelHash(saved.bodyText),requestKey:request.requestKey}))};
   assert.deepEqual(validateCodexLibrary(JSON.parse(JSON.stringify(library)),choice).references.map(r=>r.reading.labelText),[literal,literal]);},
  finish:async(_job,outcome)=>{finished=outcome;return true;},saveLabelSource:()=>assert.fail('retained response cannot be replaced')};
 const provider=()=>assert.fail('no second model call');provider.labelRequest=prepareVariantLabelRequest;provider.prepare=()=>assert.fail('no image read or new request preparation');
 const worker=createVariantWorker({store,catalog:{},provider,loadPhotos:()=>assert.fail('no physical images'),projectResponse:()=>assert.fail('no legacy projector'),onError:error=>assert.fail(error.code)});
 await worker.drainOnce();assert.equal(finished.result.referenceLabels.readings.length,2);assert.deepEqual(finished.result.referenceLabels.readings.map(r=>r.labelText),[literal,literal]);assert.equal(JSON.stringify(saved),original);assert.equal(finished.result.suggestion.candidateId,null);
});

test('explicit missing-only refresh skips completed printings and keeps unmatched retained photos',async()=>{
 const catalog=labelCatalog({count:2}),complete=catalog.candidates[0],choice=variantCodexChoice(complete),known=labelPhoto(2,'fixture').image,requests=[];
 const library={schemaVersion:'atlas-codex-library/v1',policy:'atlas-slab-label-association-v1',choice,references:[{image:labelPhoto(0,'fixture').image,reading:{sha256:labelPhoto(0,'fixture').image.sha256,candidateKey:choice.key,labelText:'Exact slab',gradingCompany:'PSA',reason:'Known label'},responseHash:labelHash('response'),requestKey:'saved'}]};
 const cache={getRetained:async key=>key===codexLibraryKey(choice)?library:key.startsWith('atlas-codex-reading:')&&key===codexReadingKey({policy:'atlas-slab-label-association-v1',model:'gpt-6-astra'},known.sha256)?{schemaVersion:'atlas-codex-reading/v1',policy:'atlas-slab-label-association-v1',choices:codexChoices(catalog),reading:{sha256:known.sha256,candidateKey:null,gradingCompany:null,labelText:null,reason:'Unreadable label'}}:null};
 const generation='ea7d85e4-c52a-41bc-b6f5-5c267daf55cb';
 const service=createVariantCatalogService({cache,providers:[{prepare:async()=>({candidates:catalog.candidates,problems:[],truncated:false})}],listingProvider:{acquireImages:async({request},options)=>{
  assert.equal(request.generation,generation);assert.equal(options.isKnownReference,undefined);return {referencePhotos:[known]};}}});
 const result=await service.prepare({identity:variantIdentity,generation},{executeListingSource:async(request,_dispatch,{retainedOnly=false}={})=>{if(retainedOnly)return {state:'MISSING'};requests.push(request);return {state:'REUSED',source:{sha256:labelHash('fixture')}};}});
 assert.equal(requests.length,1);assert.equal(requests[0].printing,undefined);assert.equal(result.referencePhotos.length,2);assert(result.referencePhotos.some(p=>p.sha256===library.references[0].image.sha256));
});

test('a new printing ordered first reuses unmatched siblings from a completed old printing before any acquisition',async()=>{
 const original=labelCatalog({photos:2}),image=original.referencePhotos[1],choice=variantCodexChoice(original.candidates[0]),finish='Costco Exclusive';
 const expanded=labelCatalog({count:2,photos:0,candidateTransform:(c,index)=>{if(index){c.label=c.parallel=finish;c.canonical.printingId=`setops-printing:v1:${'0'.repeat(64)}`;}}});
 assert.equal(expanded.candidates[0].label,finish,'The missing new printing is encountered before the old completed printing');
 const reading={schemaVersion:'atlas-codex-reading/v1',policy:VARIANT_LABEL_POLICY,choices:codexChoices(original),reading:{sha256:image.sha256,candidateKey:null,
  gradingCompany:'CGC',labelText:`2020 POKEMON REBEL CLASH\nMAGIKARP\n#039/192\n${finish}`,reason:'Printing absent'}};
 const matched=original.referencePhotos[0],library={schemaVersion:'atlas-codex-library/v1',policy:VARIANT_LABEL_POLICY,choice,references:[{image:matched,reading:{sha256:matched.sha256,candidateKey:choice.key,labelText:'Known base',gradingCompany:'PSA',reason:'Original label'},responseHash:labelHash('saved response'),requestKey:'saved'}]};
 const cache={getRetained:async key=>key===codexLibraryKey(choice)?library:key===codexReadingKey({policy:VARIANT_LABEL_POLICY,model:VARIANT_PHOTO_MODEL},image.sha256)?reading:null},lookups=[],replays=[];
 const service=createVariantCatalogService({cache,providers:[{prepare:async()=>({candidates:expanded.candidates,problems:[],truncated:false})}],
  listingProvider:{fetchSource:()=>assert.fail('Never repurchase'),acquireImages:async({request},{retainedOnly})=>{assert(retainedOnly);replays.push(request.printing.name);return {referencePhotos:original.referencePhotos};}}});
 const snapshot=await service.prepare({identity:variantIdentity},{executeListingSource:async(request,_dispatch,{retainedOnly=false}={})=>{assert.equal(retainedOnly,true,'No new source acquisition is allowed');lookups.push(request.printing?.name??'shared identity');return request.printing?.name==='base'?{state:'REUSED',source:{sha256:image.sourceResponseSha256}}:{state:'MISSING'};}});
 assert.deepEqual(lookups,[finish.toLowerCase(),'base','shared identity']);assert.deepEqual(replays,['base']);assert.equal(snapshot.referencePhotos.length,2);assert(!snapshot.problems.includes('LISTING_SOURCE_UNAVAILABLE'));
 assert.equal(projectCodexReading(reading.reading,snapshot,reading.choices).candidateId,expanded.candidates[0].candidateId);assert.equal(reading.reading.candidateKey,null);
 const completed=createVariantCatalogService({cache,providers:[{prepare:async()=>({candidates:original.candidates,problems:[],truncated:false})}],listingProvider:{fetchSource:()=>assert.fail('No new source'),acquireImages:()=>assert.fail('No saved source exists')}});
 const known=await completed.prepare({identity:variantIdentity},{executeListingSource:async(_r,_d,{retainedOnly})=>{assert(retainedOnly);return {state:'UNKNOWN'};}});
 assert(!known.problems.includes('LISTING_SOURCE_OUTCOME_UNKNOWN'),'An unrelated old UNKNOWN does not taint an already populated choice');
});

test('new exact catalog printing can reuse a permanent unmatched label without changing OCR or purchasing again',()=>{
 const original=labelCatalog({photos:1}),expanded=labelCatalog({count:2,photos:1,candidateTransform:(c,index)=>{if(index)c.parallel=c.label='Costco Exclusive';}});
 const image=original.referencePhotos[0],reading={sha256:image.sha256,candidateKey:null,gradingCompany:'CGC',
  labelText:'2020 POKEMON REBEL CLASH\nMAGIKARP\n#039/192\nCostco Exclusive\nPRISTINE 10',reason:'Catalog has no Costco printing.'};
 const before=JSON.stringify(reading),priorChoices=codexChoices(original);
 assert.equal(projectCodexReading(reading,original,priorChoices).candidateId,null);
 const resolved=projectCodexReading(reading,expanded,priorChoices);
 assert.equal(resolved.canonicalPrintingKey,variantCodexChoice(expanded.candidates.find(c=>c.label==='Costco Exclusive')).key);
 assert.equal(resolved.labelText,reading.labelText);assert.equal(JSON.stringify(reading),before);
 assert.equal(projectCodexReading(reading,expanded,codexChoices(expanded)).candidateId,resolved.candidateId,'Association revision can correct a prior refusal without changing OCR');
 assert.equal(projectCodexReading(reading,original,priorChoices).candidateId,null,'Association is a projection of the current catalog');
});

test('local reassociation accepts literal abbreviations and omitted language but rejects conflicts and ambiguity',()=>{
 const original=labelCatalog({photos:1}),expanded=labelCatalog({count:2,photos:1,candidateTransform:(c,index)=>{if(index)c.parallel=c.label='Costco Exclusive';}});
 const literal='2020 POKEMON REBEL CLASH\nMAGIKARP\n#039/192\nCostco Exclusive\nPRISTINE 10';
 const reading={sha256:original.referencePhotos[0].sha256,candidateKey:null,gradingCompany:'CGC',labelText:literal,reason:'Catalog printing absent.'};
 for(const labelText of [literal.replace('2020','2024'),literal+'\n2024',literal.replace('#039/192','#039/193'),literal.replace('MAGIKARP','PIKACHU'),literal.replace('REBEL CLASH','BASE SET'),literal.replace('Costco Exclusive','')])
  assert.equal(projectCodexReading({...reading,labelText},expanded,codexChoices(original)).candidateId,null,labelText);
 const ambiguous=labelCatalog({count:3,photos:1,candidateTransform:(c,index)=>{if(index)c.parallel=c.label='Costco Exclusive';}});
 assert.equal(projectCodexReading(reading,ambiguous,codexChoices(original)).candidateId,null);
 const english=labelCatalog({count:2,photos:1,candidateTransform:(c,index)=>{if(index){c.parallel=c.label='Costco Exclusive';c.identity.language='en';}}});
 assert.notEqual(projectCodexReading(reading,english,codexChoices(original)).candidateId,null,'A unique catalog language does not require a printed language word');
 assert.equal(projectCodexReading({...reading,labelText:literal+' Japanese'},english,codexChoices(original)).candidateId,null);
 for(const labelText of [literal.replace('Costco Exclusive','Costco Excl.'),literal.replace('#039/192','#039')])assert.notEqual(projectCodexReading({...reading,labelText},expanded,codexChoices(original)).candidateId,null);
 assert.notEqual(projectCodexReading({...reading,gradingCompany:null,evidenceKind:'RAW'},expanded,codexChoices(original)).candidateId,null);
});
