import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createManufacturerChecklistVariantProvider} from '../src/manufacturer-checklist.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const identity = {category:'SPORTS', manufacturer:'Fleer', name:'Michael Jordan', year:'1992-93', setName:'Fleer', cardNumber:'273', language:null};
const source = {manufacturer:'Fleer', sport:'basketball', year:'1992-93', setName:'Fleer', aliases:[],
  url:'https://www.tcdb.com/Checklist.cfm/sid/2096/1992-93-Fleer?PageIndex=3', sha256:'a'.repeat(64),
  evidenceAuthority:'secondary', sourcePublisher:'Trading Card Database'};
// Authored contract fixture only; this test is not an acquisition/import receipt.
const data = {schemaVersion:'manufacturer-checklist/v1', complete:false, sources:[source], rows:[[0,'Slam Dunk','273','Michael Jordan','table:5;row:74']]};
function sharded(catalog) {
  const decoded=Buffer.from(JSON.stringify(catalog)), bytes=gzipSync(decoded), sha256=hash(bytes);
  return {catalog:{schemaVersion:'manufacturer-checklist-index/v2',complete:false,sources:[{...catalog.sources[0],shard:{
    path:`manufacturer-checklists/${sha256}.json.gz`,sha256,decodedSha256:hash(decoded),compressedBytes:bytes.length,decodedBytes:decoded.length,rowCount:catalog.rows.length}}]},loadShard:async()=>bytes};
}
test('secondary provenance remains explicit for exact, abbreviated, starting-year and missing-year row/shard lookup', async()=>{
  for(const options of [{catalog:data},sharded(data)])for(const year of ['1992-93','92-93','1992',null]){
    const input={...identity,year},original=structuredClone(input),result=await createManufacturerChecklistVariantProvider(options).prepare(input);
    assert.equal(result.candidates.length,1);assert.deepEqual(input,original);
    const candidate=result.candidates[0],description=candidate.diagnostics.map(d=>d.description).join('\n');
    assert.match(description,/Secondary checklist evidence from Trading Card Database; not manufacturer authority/);
    assert.match(description,/table:5;row:74/);assert.doesNotMatch(description,/Official checklist|Manufacturer checklist/);
    assert.equal(candidate.source.provider,'manufacturer_checklist');assert.equal(candidate.source.url,source.url);
    assert.equal(candidate.source.sha256,source.sha256);assert.equal(candidate.applicability,'unknown');assert.equal(candidate.canonical,null);
  }
});
test('provenance disclosure cannot rewrite candidate IDs or the existing primary diagnostics',async()=>{
  const {evidenceAuthority,sourcePublisher,...prior}=source;
  const legacy={...data,sources:[prior]},explicitPrimary={...data,sources:[{...prior,evidenceAuthority:'primary',sourcePublisher:'Fleer'}]};
  const a=await createManufacturerChecklistVariantProvider({catalog:legacy}).prepare(identity);
  const b=await createManufacturerChecklistVariantProvider({catalog:explicitPrimary}).prepare(identity);
  const c=await createManufacturerChecklistVariantProvider({catalog:data}).prepare(identity);
  assert.deepEqual(a,b);assert.equal(c.candidates[0].candidateId,a.candidates[0].candidateId);
  assert.equal(c.candidates[0].source.recordId,a.candidates[0].source.recordId);
});
test('secondary sources require explicit valid publisher and reject invented authority levels',async()=>{
  for(const patch of [{sourcePublisher:undefined},{sourcePublisher:''},{sourcePublisher:'x'.repeat(161)},{evidenceAuthority:'official-ish'}]){
    const catalog={...data,sources:[{...source,...patch}]};
    await assert.rejects(createManufacturerChecklistVariantProvider({catalog}).prepare(identity),/MANUFACTURER_CHECKLIST_INVALID/);
  }
});
