import test from 'node:test';
import assert from 'node:assert/strict';
import {createManufacturerChecklistVariantProvider} from '../src/manufacturer-checklist.mjs';
import {validateVariantCandidate,variantCandidateId} from '../src/variant-review.mjs';
import {validVariantSourceSeason,resolveVariantSourceSeasonYear} from '../src/variant-season.mjs';
const identity={category:'SPORTS',manufacturer:'Fleer',setName:'Fleer',year:'1992-93',name:'Michael Jordan',cardNumber:'273',language:null};
const source={manufacturer:'Fleer',sport:'basketball',year:'1992-93',setName:'Fleer',aliases:[],url:'https://example.com/retained',sha256:'a'.repeat(64),evidenceAuthority:'secondary',sourcePublisher:'Historical checklist publisher'};
const data={schemaVersion:'manufacturer-checklist/v1',complete:false,sources:[source],rows:[[0,'Slam Dunk','273','Michael Jordan','row:1']]};
test('explicit source season is structured, validated and independent of display prose or submitted year spelling',async()=>{
 for(const year of ['1992-93','92-93','1992-1993','1992–93','1992',null]){
  const input={...identity,year},before=structuredClone(input),result=await createManufacturerChecklistVariantProvider({catalog:data}).prepare(input),candidate=result.candidates[0];
  assert.equal(result.candidates.length,1);assert.deepEqual(input,before);assert.equal(candidate.identity.year,year??'1992-93');
  assert.deepEqual(candidate.source.season,{year:'1992-93',startingYearAlias:true});
  assert.equal(resolveVariantSourceSeasonYear(candidate.identity.year,candidate.source.season),'1992-93');
  const {season,...oldSource}=candidate.source;assert.equal(variantCandidateId({...candidate,source:oldSource}),candidate.candidateId);
  assert.equal(validateVariantCandidate({...candidate,diagnostics:[]}).candidateId,candidate.candidateId);
 }
});
test('a real bare-year row prevents season aliases in either entry direction; other sports never acquire bare-year aliases',async()=>{
 const catalog={...data,sources:[source,{...source,year:'1992',sha256:'b'.repeat(64)}],rows:[...data.rows,[1,'Other literal release','273','Michael Jordan','row:2']]};
 const provider=createManufacturerChecklistVariantProvider({catalog});
 const explicit=(await provider.prepare(identity)).candidates[0];assert.equal(explicit.source.season.startingYearAlias,false);
 const bare=(await provider.prepare({...identity,year:'1992'})).candidates[0];assert.equal(bare.label,'Other literal release');assert.equal(bare.source.season,undefined);
 assert.equal(resolveVariantSourceSeasonYear('1992',explicit.source.season),null);
 const hockey=await createManufacturerChecklistVariantProvider({catalog:{...data,sources:[{...source,sport:'hockey'}]}}).prepare(identity);
 assert.equal(hockey.candidates[0].source.season.startingYearAlias,false);
});
test('season contract rejects malformed values, unrelated years and non-manufacturer evidence',async()=>{
 const candidate=(await createManufacturerChecklistVariantProvider({catalog:data}).prepare(identity)).candidates[0];
 for(const season of [{year:'1992-94',startingYearAlias:true},{year:'92-93',startingYearAlias:true},{year:'1992-93',startingYearAlias:'true'},{year:'1992-93',startingYearAlias:true,extra:true},{year:'1993-94',startingYearAlias:true}]){
  assert.throws(()=>validateVariantCandidate({...candidate,source:{...candidate.source,season}}));
 }
 assert.throws(()=>validateVariantCandidate({...candidate,source:{...candidate.source,provider:'other'}}));
 assert.equal(validVariantSourceSeason({year:'1992-93',startingYearAlias:false}),true);
 assert.equal(resolveVariantSourceSeasonYear('1993',{year:'1992-93',startingYearAlias:true}),null);
});
