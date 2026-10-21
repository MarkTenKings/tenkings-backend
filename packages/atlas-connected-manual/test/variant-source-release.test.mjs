import test from 'node:test';
import assert from 'node:assert/strict';
import {canonical,digest} from '@atlas/manual-service/contract';
import {createManufacturerChecklistVariantProvider,createVariantReviewSnapshot,variantCandidateId,validateVariantCandidate} from '@tenkings/card-catalog-evidence';
import {variantCodexChoice,variantCodexAliases,codexChoices,codexCatalogContext,codexLibraryKey,codexReadingKey,reassociateCodexReading,CODEX_LABEL_POLICY,CODEX_LABEL_MODEL} from '../src/variant-codex.mjs';
import {createVariantCatalogService} from '../src/variant-catalog.mjs';
import {readRetainedVariantLabels} from '../src/variant-job-store.mjs';
import {createVariantWorker} from '../src/variant-worker.mjs';
import {prepareVariantLabelRequest,readVariantLabelResponse} from '../src/variant-photo-provider.mjs';
import {labelPhoto,labelResponse} from './variant-label-fixture.mjs';
const base={category:'SPORTS',name:'Jameis Winston',year:'2015',setName:'Metal Draft',cardNumber:'BA-JW1',manufacturer:'Leaf',language:null};
const source=(sport,setName=`2015 Leaf Metal Draft ${sport[0].toUpperCase()+sport.slice(1)}`,extra={})=>({manufacturer:'Leaf',sport,year:'2015',setName,aliases:[],url:`https://example.test/${sport}.xlsx`,sha256:digest(sport),...extra});
const row=['Base Auto','BA-JW1','Jameis Winston','sheet:FINAL;row:30'];
const provider=()=>createManufacturerChecklistVariantProvider({catalog:{schemaVersion:'manufacturer-checklist/v1',complete:false,sources:[source('baseball'),source('football')],rows:[[0,...row],[1,...row.slice(0,3),'sheet:FINAL;row:46']]}});
const snapshot=(candidates,referencePhotos=[])=>createVariantReviewSnapshot({identity:candidates[0].identity,candidates,referencePhotos,capturedAt:'2026-10-14T00:00:00.000Z'});
const legacy=c=>{const old=structuredClone(c);delete old.source.release;return old;};
const reading=(candidate,image)=>({sha256:image.sha256,candidateKey:variantCodexChoice(candidate).key,gradingCompany:'PSA',labelText:'2015 Leaf Metal Draft Jameis Winston BA-JW1 Base Auto',reason:'Saved literal evidence.'});
const library=(candidate,image)=>({schemaVersion:'atlas-codex-library/v1',policy:CODEX_LABEL_POLICY,choice:variantCodexChoice(candidate),references:[{image,reading:reading(candidate,image),requestKey:'saved-paid-request',responseHash:digest('original response')}]});

test('source sport and canonical product titles constrain candidates; generic releases remain distinct without changing identity or winner ID',async()=>{
 const p=provider(),generic=await p.prepare(base);assert.equal(generic.candidates.length,2);assert.deepEqual(generic.problems,['CHECKLIST_SCOPE_AMBIGUOUS']);assert.equal(codexChoices(snapshot(generic.candidates)).length,2);
 for(const sport of ['baseball','football']){const identity={...base,setName:source(sport).setName},r=await p.prepare(identity);assert.equal(r.candidates.length,1);assert.deepEqual(r.candidates[0].source.release.sports,[sport]);assert.deepEqual(r.candidates[0].identity,identity);assert.equal(r.candidates[0].candidateId,variantCandidateId(legacy(r.candidates[0])));assert.equal(variantCodexChoice(r.candidates[0]).key,variantCodexChoice(generic.candidates.find(c=>c.source.release.sports[0]===sport)).key);}
 const p2=createManufacturerChecklistVariantProvider({catalog:{schemaVersion:'manufacturer-checklist/v1',complete:false,sources:[source('basketball','2015 Leaf Memories Basketball'),source('basketball','2015 Pro Set Power Basketball',{aliases:['2015 Leaf Memories Basketball'],sha256:digest('power')})],rows:[[0,...row],[1,...row]]}});
 assert.deepEqual((await p2.prepare({...base,setName:'2015 Leaf Memories Basketball'})).candidates.map(c=>c.source.release.setName),['2015 Leaf Memories Basketball']);
});

test('only identical source capture, release and row locator coalesce sport classifications',async()=>{
 const common={url:'https://example.test/goodwin',sha256:digest('same capture'),setName:'2015 Goodwin Champions'};
 const p=createManufacturerChecklistVariantProvider({catalog:{schemaVersion:'manufacturer-checklist/v1',complete:false,sources:[source('basketball',common.setName,common),source('golf',common.setName,common)],rows:[[0,...row],[1,...row],[0,'Exclusive','BA-JW1','Jameis Winston','row:31'],[1,'Exclusive','BA-JW1','Jameis Winston','row:32']]}});
 const r=await p.prepare({...base,setName:'Goodwin Champions'});assert.equal(r.candidates.length,3);
 const same=r.candidates.find(c=>c.label==='Base Auto');assert.deepEqual(same.source.release.sports,['basketball','golf']);
 assert.equal(new Set(r.candidates.map(c=>variantCodexChoice(c).key)).size,3);
 assert.deepEqual(r.candidates.filter(c=>c.label==='Exclusive').map(c=>c.source.release.sports),[['basketball'],['golf']]);
 for(const sport of ['Basketball','Golf']){const c=(await p.prepare({...base,setName:`Goodwin Champions ${sport}`})).candidates.find(c=>c.label==='Base Auto');assert.equal(variantCodexChoice(c).key,variantCodexChoice(same).key);}
});

test('coverage absence, covered missing card and ambiguous abbreviated season have different problems',async()=>{
 const p=provider();assert.deepEqual((await p.prepare({...base,setName:'Unknown'})).problems,['CHECKLIST_SCOPE_NOT_RETAINED']);
 assert.deepEqual((await p.prepare({...base,cardNumber:'missing'})).problems,['CHECKLIST_CARD_NOT_FOUND']);
 const sources=['1992-93','2092-93'].map(year=>source('basketball','Leaf',{year}));
 const p2=createManufacturerChecklistVariantProvider({catalog:{schemaVersion:'manufacturer-checklist/v1',complete:false,sources,rows:[]}});
 assert.deepEqual((await p2.prepare({...base,setName:'Leaf',year:'92-93'})).problems,['CHECKLIST_SEASON_AMBIGUOUS']);
});

test('legacy keys only locate evidence; exact previous row context associates a single release and conflicting context stays unassigned',async()=>{
 const candidates=(await provider().prepare(base)).candidates,catalog=snapshot(candidates),photo=labelPhoto().image,old=legacy(candidates[0]),r=reading(old,photo),context=codexCatalogContext(snapshot([old]));
 assert(variantCodexAliases(candidates[0]).some(alias=>alias.key===r.candidateKey));
 assert.equal(reassociateCodexReading(r,catalog,[variantCodexChoice(old)],context).candidateKey,variantCodexChoice(candidates[0]).key);
 assert.equal(reassociateCodexReading(r,catalog,[variantCodexChoice(old)]).candidateKey,null);
 const ambiguous=[...context,...codexCatalogContext(snapshot([legacy(candidates[1])]))];
 assert.equal(reassociateCodexReading(r,catalog,[variantCodexChoice(old)],ambiguous).candidateKey,null);
 const football=snapshot([(await provider().prepare({...base,setName:'2015 Leaf Metal Draft Football'})).candidates[0]]);
 const falselyNamed=legacy({...candidates[0],identity:football.candidates[0].identity});falselyNamed.candidateId=variantCandidateId(falselyNamed);const wrong=reading(falselyNamed,photo);
 assert.equal(reassociateCodexReading(wrong,football,[variantCodexChoice(falselyNamed)],codexCatalogContext(snapshot([falselyNamed]))).candidateKey,null);
 assert.equal(reassociateCodexReading({...r,labelText:'2015 Leaf Metal Draft Football Jameis Winston BA-JW1 Base Auto'},catalog,[variantCodexChoice(old)]).candidateKey,variantCodexChoice(candidates[1]).key);
});

test('global source-bound reading takes precedence over an unsafe library; library-only literal evidence still prevents OCR',async()=>{
 const candidates=(await provider().prepare(base)).candidates,photo=labelPhoto().image,catalog=snapshot(candidates,[photo]),old=legacy(candidates[0]),lib=library(old,photo),record={schemaVersion:'atlas-codex-reading/v1',policy:CODEX_LABEL_POLICY,choices:[variantCodexChoice(old)],catalogContext:codexCatalogContext(snapshot([old])),reading:lib.references[0].reading};
 const records=new Map([[codexLibraryKey(lib.choice),lib],[codexReadingKey({policy:CODEX_LABEL_POLICY,model:CODEX_LABEL_MODEL},photo.sha256),record]]);
 const tx={$queryRawUnsafe:async(_sql,keys)=>keys.filter(key=>records.has(key)).map(key=>{const snapshot=canonical(records.get(key));return{key,snapshot,snapshot_hash:digest(snapshot)};})};
 let labels=(await readRetainedVariantLabels(tx,catalog)).referenceLabels;assert.equal(labels.readings[0].candidateId,candidates[0].candidateId);
 records.delete(codexReadingKey({policy:CODEX_LABEL_POLICY,model:CODEX_LABEL_MODEL},photo.sha256));labels=(await readRetainedVariantLabels(tx,catalog)).referenceLabels;assert.equal(labels.readings.length,1);assert.equal(labels.readings[0].candidateId,null);
 let claimed=false,finished,modelCalls=0;const noModel=()=>{modelCalls++;assert.fail('Retained literal must prevent OCR');};noModel.labelRequest=prepareVariantLabelRequest;noModel.prepare=noModel;
 const worker=createVariantWorker({store:{discover:async()=>{},claim:async()=>claimed?null:(claimed=true,{key:'second-submission',catalog,input:{}}),codexReadings:async()=>labels,publishLabelSource:async()=>assert.fail('No response recovery'),finish:async(_job,value)=>{finished=value;return true;}},catalog:{},provider:noModel,projectResponse:()=>assert.fail('No physical comparison'),onError:e=>assert.fail(e.code??e.message)});
 await worker.drainOnce();assert.equal(modelCalls,0);assert.equal(finished.result.referenceLabels.readings[0].candidateId,null);
});

test('same transport group preserves every source choice; the populated last member cannot hide its missing sibling',async()=>{
 const candidates=(await provider().prepare(base)).candidates,photo=labelPhoto().image,lib=library(candidates[1],photo);let paid=0,probes=0;
 const service=createVariantCatalogService({providers:[{prepare:async()=>({candidates,problems:[],truncated:false})}],cache:{getRetained:async key=>key===codexLibraryKey(lib.choice)?lib:null},listingProvider:{fetchSource:async()=>{paid++;return{};},acquireImages:async()=>({})}});
 const result=await service.prepare({identity:base,reuseJobKey:null},{executeListingSource:async(_request,dispatch,{retainedOnly=false}={})=>{if(retainedOnly){probes++;return{state:'MISSING'};}await dispatch();return{state:'SAVED',source:{sha256:digest('response')}};}});
 assert.equal(result.candidates.length,2);assert.equal(paid,1);assert.equal(probes,2);assert.equal(result.referencePhotos.length,1);
});

test('source title aliases share current keys, retain old literal aliases, and historical paid request bytes remain readable',async()=>{
 const p=createManufacturerChecklistVariantProvider(),short={category:'SPORTS',name:'Nick Kurtz',year:'2025',manufacturer:'Topps',setName:'Bowman Chrome',cardNumber:'93',language:null};
 const a=(await p.prepare(short)).candidates,b=(await p.prepare({...short,setName:'2025 Bowman Chrome Baseball'})).candidates;assert.equal(a.length,28);assert.deepEqual(a.map(c=>variantCodexChoice(c).key),b.map(c=>variantCodexChoice(c).key));
 for(let i=0;i<a.length;i++){assert(variantCodexAliases(a[i]).some(choice=>choice.key===variantCodexChoice(legacy(b[i])).key));assert(variantCodexAliases(b[i]).some(choice=>choice.key===variantCodexChoice(legacy(a[i])).key));}
 const oldCatalog=snapshot([legacy(a[0])],[labelPhoto().image]),request=prepareVariantLabelRequest(oldCatalog),saved={version:CODEX_LABEL_POLICY,requestEvidence:{policy:CODEX_LABEL_POLICY,model:CODEX_LABEL_MODEL,requestSha256:digest('original paid bytes'),request},httpStatus:200,bodyText:JSON.stringify(labelResponse(request)),requestId:null};
 const before=JSON.stringify(saved);readVariantLabelResponse(saved,oldCatalog);assert.equal(JSON.stringify(saved),before);assert.equal(request.associationRevision,'atlas-reference-association-v2');
 assert.throws(()=>validateVariantCandidate({...a[0],source:{...a[0].source,release:{...a[0].source.release,sports:['cricket']}}}));
});

test('transport probes the union of member-approved historical years once and UNKNOWN blocks ordinary dispatch',async()=>{
 const identity={...base,year:'1992-93'},p=createManufacturerChecklistVariantProvider({catalog:{schemaVersion:'manufacturer-checklist/v1',complete:false,sources:[source('football','1992-93 Leaf Metal Draft Football',{year:'1992-93'}),source('basketball','1992-93 Leaf Metal Draft Basketball',{year:'1992-93'})],rows:[[0,...row],[1,...row]]}}),result=await p.prepare(identity);let paid=0;const years=[];
 const service=createVariantCatalogService({providers:[{prepare:async()=>result}],listingProvider:{fetchSource:async()=>{paid++;assert.fail('Unknown original outcome');},acquireImages:async()=>assert.fail('No saved response')}});
 const catalog=await service.prepare({identity,reuseJobKey:null},{executeListingSource:async(request,_dispatch,{retainedOnly=false}={})=>{assert(retainedOnly);years.push(request.identity.year);return{state:request.identity.year==='1992'?'UNKNOWN':'MISSING'};}});
 assert.deepEqual(years,['1992-93','1992','1992-93']);assert.equal(paid,0);assert(catalog.problems.includes('LISTING_SOURCE_OUTCOME_UNKNOWN'));
});

test('actual Nick rows with authored legacy libraries reuse every source-proven reading across short/full names without paid work',async()=>{
 const identity={category:'SPORTS',name:'Nick Kurtz',year:'2025',manufacturer:'Topps',setName:'Bowman Chrome',cardNumber:'93',language:null},p=createManufacturerChecklistVariantProvider(),candidates=(await p.prepare(identity)).candidates,records=new Map();
 for(const [i,c]of candidates.entries()){const old=legacy(c),image=labelPhoto(i).image,lib=library(old,image),record={schemaVersion:'atlas-codex-reading/v1',policy:CODEX_LABEL_POLICY,choices:[lib.choice],catalogContext:codexCatalogContext(snapshot([old])),reading:{...lib.references[0].reading,labelText:'Retained fixture literal; association uses exact previous source row.'}};records.set(codexLibraryKey(lib.choice),lib);records.set(codexReadingKey({policy:CODEX_LABEL_POLICY,model:CODEX_LABEL_MODEL},image.sha256),record);}
 const before=JSON.stringify([...records]);let paid=0,images=0;const service=createVariantCatalogService({providers:[p],cache:{getRetained:async key=>records.get(key)??null},listingProvider:{fetchSource:async()=>{paid++;assert.fail('Every printing already has source-proven evidence');},acquireImages:async()=>{images++;assert.fail('Every image already retained');}}});
 const catalog=await service.prepare({identity:{...identity,setName:'2025 Bowman Chrome Baseball'},reuseJobKey:null},{executeListingSource:async(_request,_dispatch,{retainedOnly=false}={})=>{assert(retainedOnly);return{state:'MISSING'};}});
 assert.equal(catalog.candidates.length,28);assert.equal(catalog.referencePhotos.length,28);
 const tx={$queryRawUnsafe:async(_sql,keys)=>keys.filter(key=>records.has(key)).map(key=>{const snapshot=canonical(records.get(key));return{key,snapshot,snapshot_hash:digest(snapshot)};})};const labels=(await readRetainedVariantLabels(tx,catalog)).referenceLabels;
 assert.equal(labels.readings.length,28);assert(labels.readings.every(r=>r.candidateId!==null));assert.equal(new Set(labels.readings.map(r=>r.canonicalPrintingKey)).size,28);assert.deepEqual({paid,images},{paid:0,images:0});assert.equal(JSON.stringify([...records]),before);
});

test('actual retained conflicting template aliases keep source years and never discard bare-season alternatives',async()=>{
 const p=createManufacturerChecklistVariantProvider(),identity={category:'SPORTS',name:'Daimion Collins',manufacturer:'Leaf',setName:'Leaf Trinity',year:'2021',cardNumber:'BA-DC1',language:null},keys=[];
 for(const year of ['2021','2021-22',null]){const result=await p.prepare({...identity,year});assert.equal(result.candidates.length,3);assert(result.problems.includes('CHECKLIST_SCOPE_AMBIGUOUS'));keys.push(result.candidates.map(c=>variantCodexChoice(c).key));assert.deepEqual([...new Set(result.candidates.map(c=>c.source.release.setName))].sort(),['2021-22 Leaf Memories Basketball','2021-22 Pro Set Power Basketball']);}
 assert.deepEqual(keys[0],keys[1]);assert.deepEqual(keys[1],keys[2]);
 for(const year of ['2021','2021-22',null]){const result=await p.prepare({...identity,year,setName:'2017 Leaf Q'});assert.equal(result.candidates.length,0);assert.deepEqual(result.problems,['CHECKLIST_SCOPE_NOT_RETAINED']);}
 for(const setName of ['2021-22 Leaf Memories Basketball','2021/2022 Leaf Memories Basketball','21-22 Leaf Memories Basketball'])assert.equal((await p.prepare({...identity,year:null,setName})).candidates.length,2);
 assert.equal((await p.prepare({...identity,year:'2021-22',setName:'2020 Leaf Memories Basketball'})).candidates.length,0);
});
