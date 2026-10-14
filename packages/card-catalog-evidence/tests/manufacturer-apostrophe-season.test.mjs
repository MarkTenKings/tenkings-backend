import test from 'node:test';
import assert from 'node:assert/strict';
import {createManufacturerChecklistVariantProvider} from '../src/manufacturer-checklist.mjs';
import {resolveVariantSourceSeasonYear} from '../src/variant-season.mjs';
const identity={category:'SPORTS',manufacturer:'Fleer',name:'Michael Jordan',setName:'Fleer Ultra',cardNumber:'216',year:"'92-93",language:null};
test('retained Card14 literal apostrophe season finds the same Ultra Jam Session row and preserves human identity',async()=>{
 const p=createManufacturerChecklistVariantProvider(),quoted=await p.prepare(identity),plain=await p.prepare({...identity,year:'92-93'}),canonical=await p.prepare({...identity,year:'1992-93'});
 assert.equal(quoted.candidates.length,1);const c=quoted.candidates[0];assert.equal(c.label,'Jam Session');
 assert.equal(c.identity.year,"'92-93");assert.equal(identity.year,"'92-93");
 assert.deepEqual(c.source,plain.candidates[0].source);assert.deepEqual(c.source,canonical.candidates[0].source);
 assert(c.diagnostics.some(d=>d.description.includes('Secondary checklist evidence from Trading Card Database')));
 assert.equal(resolveVariantSourceSeasonYear(identity.year,c.source.season),'1992-93');
 assert.equal(resolveVariantSourceSeasonYear(identity.year,{year:'1993-94',startingYearAlias:true}),null);
 for(const year of ["''92-93","'1992-93","’92-93","'92-94","'91-92","'92"]){assert.equal((await p.prepare({...identity,year})).candidates.length,0);assert.equal(resolveVariantSourceSeasonYear(year,c.source.season),null);}
 for(const patch of [{manufacturer:'Topps'},{setName:'Fleer'},{cardNumber:'273'},{name:'Other Athlete'}])assert.equal((await p.prepare({...identity,...patch})).candidates.length,0);
});
test('quoted abbreviated seasons remain ambiguous across retained centuries and never receive a date pivot',async()=>{
 const source={manufacturer:'Fleer',sport:'basketball',year:'1992-93',setName:'Fleer Ultra',aliases:[],url:'https://example.com/1992',sha256:'a'.repeat(64)};
 const catalog={schemaVersion:'manufacturer-checklist/v1',complete:false,sources:[source,{...source,year:'2092-93',url:'https://example.com/2092',sha256:'b'.repeat(64)}],rows:[[0,'Jam Session','216','Michael Jordan','row:1'],[1,'Jam Session','216','Michael Jordan','row:1']]};
 const result=await createManufacturerChecklistVariantProvider({catalog}).prepare(identity);assert.equal(result.candidates.length,0);assert.deepEqual(result.problems,['CHECKLIST_SEASON_AMBIGUOUS']);
});
