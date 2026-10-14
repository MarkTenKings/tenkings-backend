import test from 'node:test';
import assert from 'node:assert/strict';
import {createManufacturerChecklistVariantProvider} from '../../card-catalog-evidence/src/manufacturer-checklist.mjs';
import {variantCodexChoice,variantCodexAliases,codexLibraryKey} from '../src/variant-codex.mjs';
import {createVariantCatalogService} from '../src/variant-catalog.mjs';
import {labelPhoto,labelHash} from './variant-label-fixture.mjs';
const identity={category:'SPORTS',manufacturer:'Fleer',setName:'Fleer',year:'1992-93',name:'Michael Jordan',cardNumber:'273',language:null};
const data={schemaVersion:'manufacturer-checklist/v1',complete:false,sources:[{manufacturer:'Fleer',sport:'basketball',year:'1992-93',setName:'Fleer',aliases:[],url:'https://example.com/retained',sha256:'a'.repeat(64),evidenceAuthority:'secondary',sourcePublisher:'Historical checklist publisher'}],rows:[[0,'Slam Dunk','273','Michael Jordan','row:1']]};
const provider=createManufacturerChecklistVariantProvider({catalog:data});
const candidate=async year=>(await provider.prepare({...identity,year})).candidates[0];
test('secondary bare, explicit, abbreviated and missing years share the source season key without mutating candidates',async()=>{
 const candidates=await Promise.all(['1992','1992-93','92-93','1992-1993',null].map(candidate));
 const before=JSON.stringify(candidates),choices=candidates.map(c=>variantCodexChoice({...c,diagnostics:[]}));
 assert.equal(new Set(choices.map(c=>c.key)).size,1);assert.equal(new Set(choices.map(c=>c.cardKey)).size,1);assert.equal(choices[0].identity.year,'1992-93');
 assert.equal(JSON.stringify(candidates),before);
 const bareLegacy=variantCodexChoice(candidates[0],{literalIdentity:true});
 for(const c of candidates)assert(variantCodexAliases(c).some(alias=>alias.key===bareLegacy.key));
});
test('both year entry directions read historical libraries before any new listing/image/model call (authored fixture)',async()=>{
 for(const [savedYear,inputYear] of [['1992','1992-93'],['1992-93','1992']]){
  const savedCandidate=await candidate(savedYear),choice=variantCodexChoice(savedCandidate,{literalIdentity:true}),image=labelPhoto(0,'fixture').image;
  const library={schemaVersion:'atlas-codex-library/v1',policy:'atlas-slab-label-association-v1',choice,references:[{image,reading:{sha256:image.sha256,candidateKey:choice.key,labelText:'1992-93 FLEER\nMICHAEL JORDAN\n273 SLAM DUNK',gradingCompany:'PSA'},responseHash:labelHash('response'),requestKey:'saved-request'}]};
  const before=JSON.stringify(library),reads=[];
  const service=createVariantCatalogService({providers:[provider],cache:{getRetained:async key=>{reads.push(key);return key===codexLibraryKey(choice)?library:null;}},listingProvider:{fetchSource:()=>assert.fail('No paid listing call'),acquireImages:()=>assert.fail('No image call')}});
  const result=await service.prepare({identity:{...identity,year:inputYear}},{executeListingSource:async(_request,_dispatch,{retainedOnly}={})=>{assert.equal(retainedOnly,true,'No paid source reservation');return {state:'MISSING'};}});
  assert.equal(result.referencePhotos.length,1);assert.equal(result.referencePhotos[0].sha256,image.sha256);assert(reads.includes(codexLibraryKey(choice)));assert.equal(JSON.stringify(library),before);
 }
});
test('legacy official diagnostic snapshots keep their key while structured season denies ambiguous bare-year reuse',async()=>{
 const c=await candidate('1992'),{season,...oldSource}=c.source;
 const legacy={...c,source:oldSource,diagnostics:[{id:'manufacturer-checklist-season',description:'Official checklist season: 1992-93. Requested starting year: 1992. Source locator: row:1.'}]};
 assert.equal(variantCodexChoice(legacy).key,variantCodexChoice(c).key);
 const exact=await candidate('1992-93'),restricted={...exact,source:{...exact.source,season:{year:'1992-93',startingYearAlias:false}}};
 const historic=variantCodexChoice(c,{literalIdentity:true});assert(!variantCodexAliases(restricted).some(alias=>alias.key===historic.key));
});


test('contradictory structured source year never creates a historical alias even before wire validation',async()=>{
 const c=await candidate('1992-93'),historic=variantCodexChoice(await candidate('1992'),{literalIdentity:true});
 for(const year of ['1991','1991-92','1993','1993-94'])assert(!variantCodexAliases({...c,identity:{...c.identity,year}}).some(alias=>alias.key===historic.key));
});
