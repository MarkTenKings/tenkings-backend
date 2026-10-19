import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createManufacturerChecklistVariantProvider,createVariantReviewSnapshot} from '@tenkings/card-catalog-evidence';
import {variantCodexChoice,variantCodexAliases,projectCodexReading,codexCatalogContext,codexChoices,codexLibraryKey} from '../src/variant-codex.mjs';
import {createVariantCatalogService} from '../src/variant-catalog.mjs';
import {prepareVariantLabelRequest,projectVariantLabelResponse,VARIANT_LABEL_POLICY,VARIANT_PHOTO_MODEL} from '../src/variant-photo-provider.mjs';
import {labelHash,labelResponse} from './variant-label-fixture.mjs';
import {prepareVariantListingRequest} from '../src/variant-listing-provider.mjs';
const saved=JSON.parse(readFileSync(new URL('./fixtures/variant-references-20261012.json',import.meta.url)));
const reading=r=>({sha256:r.sha256,candidateKey:r.canonicalPrintingKey,gradingCompany:r.gradingCompany,labelText:r.labelText,reason:r.reason});

test('saved LaMelo two-photo library crosses only the manufacturer-sourced 2025/2025-26 alias without acquisition',async()=>{
 const old=saved.lamelo,before=JSON.stringify(old),identity={...old.catalog.candidates[0].identity,year:null};
 const found=await createManufacturerChecklistVariantProvider().prepare(identity);
 assert.equal(found.candidates.length,16);assert.equal(found.candidates[0].identity.year,'2025-26');
 const previous=variantCodexChoice(old.catalog.candidates[0],{literalIdentity:true});
 const current=variantCodexChoice(found.candidates[0]);
 assert.notEqual(previous.key,current.key);assert(variantCodexAliases(found.candidates[0]).some(c=>c.key===previous.key));
 const library={schemaVersion:'atlas-codex-library/v1',policy:VARIANT_LABEL_POLICY,choice:previous,references:old.referenceLabels.readings.map(r=>({
  image:old.catalog.referencePhotos.find(p=>p.sha256===r.sha256),reading:reading(r),responseHash:labelHash('retained saved response'),requestKey:'saved-real-photo'}))};
 const service=createVariantCatalogService({cache:{getRetained:async key=>key===codexLibraryKey(previous)?library:null},listingProvider:{fetchSource:()=>assert.fail('No provider acquisition'),acquireImages:()=>assert.fail('No image acquisition')}});
 const result=await service.prepare({identity,localOnly:true},{executeListingSource:async(_r,_d,{retainedOnly})=>{assert(retainedOnly);return {state:'MISSING'};}});
 assert.equal(result.referencePhotos.length,2);assert.equal(result.candidates.length,16);
 for(const r of old.referenceLabels.readings){const projected=projectCodexReading(reading(r),result,[previous],codexCatalogContext(old.catalog,{literalIdentity:true}));assert.equal(projected.canonicalPrintingKey,current.key);assert.equal(projected.labelText,r.labelText);}
 assert.equal(JSON.stringify(old),before);
 const unrelated={...found.candidates[0],identity:{...found.candidates[0].identity,year:'2024'}};
 assert(!variantCodexAliases(unrelated).some(c=>c.key===previous.key));
});

test('official Ball of Duty printings share one identity search while literal finish association remains distinct',async()=>{
 const old=saved.lamelo,identity={...old.catalog.candidates[0].identity,year:null};
 const found=await createManufacturerChecklistVariantProvider().prepare(identity);
 const catalog=createVariantReviewSnapshot({identity,candidates:found.candidates,referencePhotos:old.catalog.referencePhotos,capturedAt:old.catalog.capturedAt});
 const queries=found.candidates.map(c=>prepareVariantListingRequest(c.identity,{name:c.parallel,language:c.identity.language}).query);
 assert.equal(new Set(queries).size,1);assert.equal(queries[0],'Topps 2025-26 Topps Chrome Ball of Duty LaMelo Ball #BD-13');
 const r={...reading(old.referenceLabels.readings[0]),candidateKey:null,labelText:'2025 TOPPS CHROME LaMelo Ball BALL OF DUTY #BD-13 BLUE REFRACTOR'};
 assert.equal(projectCodexReading(r,catalog,[]).candidateId,null,'Saved text without source sport remains visible and unassociated');
 const scoped={...r,labelText:r.labelText+' BASKETBALL'};
 const projected=projectCodexReading(scoped,catalog,[]);
 assert.equal(catalog.candidates.find(c=>c.candidateId===projected.candidateId)?.parallel,'BALL OF DUTY Blue Refractor');
 assert.equal(projectCodexReading({...r,labelText:r.labelText+' GOLD REFRACTOR'},catalog,[]).candidateId,null);
 assert.equal(projectCodexReading({...r,labelText:r.labelText.replace('BD-13','BD-14')},catalog,[]).candidateId,null);
});

test('saved Pikachu holiday abbreviation resolves sourced printing; unsupported Costco mapping stays visible and unassigned',()=>{
 const {catalog,referenceLabels}=saved.pikachu,before=JSON.stringify(saved.pikachu),choices=codexChoices(catalog);
 const holiday=referenceLabels.readings.find(r=>r.labelText?.includes('HOLIDAY CAL'));
 const costco=referenceLabels.readings.find(r=>r.labelText?.includes('Costco'));
 assert(holiday&&costco);assert.equal(holiday.candidateId,null);
 const projected=projectCodexReading(reading(holiday),catalog,choices);
 assert.equal(catalog.candidates.find(c=>c.candidateId===projected.candidateId).label,'Snowflake Stamp');
 assert.equal(projectCodexReading(reading(costco),catalog,choices).candidateId,null);
 const abbreviation={...reading(costco),labelText:'2023 POKEMON 151 PIKACHU #025/165 C.HOLO',candidateKey:null};
 const abbreviated=projectCodexReading(abbreviation,catalog,choices);
 assert.equal(catalog.candidates.find(c=>c.candidateId===abbreviated.candidateId).label,'Cosmos Holofoil');
 assert.equal(projectCodexReading({...abbreviation,labelText:abbreviation.labelText.replace('025/165','026/165')},catalog,choices).candidateId,null);
 assert.equal(projectCodexReading({...abbreviation,labelText:abbreviation.labelText.replace('025/165','025/166')},catalog,choices).candidateId,null);
 assert.equal(JSON.stringify(saved.pikachu),before);assert.equal(catalog.referencePhotos.length,7);
});

test('pre-revision manufacturer label response remains readable with its original context and choices',()=>{
 const catalog=saved.lamelo.catalog,request=prepareVariantLabelRequest(catalog,null,{includeAssociationRevision:false});
 const records=saved.lamelo.referenceLabels.readings.map(reading),response={version:VARIANT_LABEL_POLICY,requestEvidence:{policy:VARIANT_LABEL_POLICY,model:VARIANT_PHOTO_MODEL,requestSha256:labelHash('old body'),request},httpStatus:200,bodyText:JSON.stringify(labelResponse(request,records))};
 const before=JSON.stringify(response),result=projectVariantLabelResponse(response,catalog);
 assert.equal(result.readings.length,2);assert(result.readings.every(r=>r.candidateId===catalog.candidates[0].candidateId));assert.equal(JSON.stringify(response),before);
});
