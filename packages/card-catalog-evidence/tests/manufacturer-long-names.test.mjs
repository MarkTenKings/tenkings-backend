import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createManufacturerChecklistVariantProvider, normalizeVariantIdentity, createVariantReviewSnapshot, validateVariantReviewSnapshot} from '../src/index.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const name=Array.from({length:24},(_,index)=>`Fixture Athlete ${String(index+1).padStart(2,'0')}`).join(' / ');
assert(name.length>240&&name.length<=512);
const source={manufacturer:'Panini',sport:'basketball',year:'2024-25',setName:'Fixture Team',aliases:[],url:'https://www.paniniamerica.net/checklist.html',sha256:'f'.repeat(64)};
const identity={category:'SPORTS',manufacturer:'Panini',year:'2024-25',name,setName:'Fixture Team',cardNumber:'TEAM-1',language:null};
const tuple=[0,'Team Autographs','TEAM-1',name,'sheet:Team;row:2'];
const plain={schemaVersion:'manufacturer-checklist/v1',complete:false,sources:[source],rows:[tuple]};
const compact={...plain,strings:tuple.slice(1),rows:[[0,0,1,2,3]]};
function sharded(catalog){const decoded=Buffer.from(JSON.stringify(catalog)),bytes=gzipSync(decoded),hash=sha(bytes);return {catalog:{schemaVersion:'manufacturer-checklist-index/v2',complete:false,sources:[{...source,shard:{path:`manufacturer-checklists/${hash}.json.gz`,sha256:hash,decodedSha256:sha(decoded),compressedBytes:bytes.length,decodedBytes:decoded.length,rowCount:1}}]},loadShard:async()=>bytes};}
test('long multi-athlete names survive row, interned and shard lookup without becoming a single player',async()=>{
  for(const options of [{catalog:plain},{catalog:compact},sharded(compact)]){
    const provider=createManufacturerChecklistVariantProvider(options),input=structuredClone(identity),result=await provider.prepare(input);
    assert.equal(result.candidates.length,1);assert.deepEqual(input,identity);assert.equal(result.candidates[0].identity.name,name);
    const snapshot=createVariantReviewSnapshot({identity,...result,capturedAt:'2026-10-14T00:00:00.000Z'});
    assert.equal(validateVariantReviewSnapshot(snapshot).candidates[0].identity.name,name);
    assert.equal((await provider.prepare({...identity,name:name.split(' / ')[0]})).candidates.length,0);
    assert.equal((await provider.prepare({...identity,name:name.split(' / ').reverse().join(' / ')})).candidates.length,0);
  }
});
test('only sports names gain capacity; other identity and source-column bounds stay unchanged',async()=>{
  assert.equal(normalizeVariantIdentity({...identity,name:'A'.repeat(512)}).name.length,512);
  assert.throws(()=>normalizeVariantIdentity({...identity,name:'A'.repeat(513)}));
  assert.throws(()=>normalizeVariantIdentity({...identity,category:'POKEMON',name:'A'.repeat(241)}));
  assert.throws(()=>normalizeVariantIdentity({...identity,setName:'A'.repeat(241)}));
  for(const [column,size] of [[1,121],[2,121],[3,513],[4,161]]){
    const row=tuple.map((value,index)=>index===column?'A'.repeat(size):value);
    await assert.rejects(createManufacturerChecklistVariantProvider({catalog:{...plain,rows:[row]}}).prepare(identity),/MANUFACTURER_CHECKLIST_INVALID/);
  }
});
