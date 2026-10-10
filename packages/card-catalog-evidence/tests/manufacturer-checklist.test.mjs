import test from 'node:test';
import assert from 'node:assert/strict';
import { createManufacturerChecklistVariantProvider, validateVariantCandidate } from '../src/index.mjs';
const identity = { category:'SPORTS', name:'Drake Maye', year:'2024', setName:'Donruss Optic', cardNumber:'203', manufacturer:'Panini', language:'en' };
const source = { manufacturer:'Donruss',manufacturerAliases:['Panini'],sport:'football',year:'2024',setName:'2024 Donruss Optic Football',aliases:['Optic','Donruss Optic'],url:'https://www.paniniamerica.net/checklist.html',sha256:'a'.repeat(64) };
const catalog = {schemaVersion:'manufacturer-checklist/v1',complete:false,sources:[source],rows:[[0,'Rated Rookies','203','Drake Maye','row:2'],[0,'Rated Rookies Holo','203','Drake Maye','row:3'],[0,'Rated Rookies Gold','204','Caleb Williams','row:4']]};

test('manufacturer rows offer exact card choices without a family-wide expansion or physical approval',async()=>{
 const result=await createManufacturerChecklistVariantProvider({catalog}).prepare(identity);
 assert.deepEqual(result.candidates.map(c=>c.label),['Rated Rookies','Rated Rookies Holo']);
 for(const c of result.candidates){assert.equal(c.source.provider,'manufacturer_checklist');assert.equal(c.applicability,'unknown');assert.equal(c.canonical,null);assert.deepEqual(c.images,[]);validateVariantCandidate(c);}
});
test('number, athlete, manufacturer and product-year conflicts fail closed',async()=>{
 const p=createManufacturerChecklistVariantProvider({catalog});
 for(const patch of [{cardNumber:'204'},{name:'Caleb Williams'},{year:'2023'},{setName:'Donruss'},{manufacturer:'Topps'},{cardNumber:'RC203'},{cardNumber:'203/300'}])assert.equal((await p.prepare({...identity,...patch})).candidates.length,0,JSON.stringify(patch));
 assert.equal((await p.prepare({...identity,setName:'2024 Donruss Optic Football',manufacturer:'Donruss'})).candidates.length,2);
});
test('same athlete on two faces is one identity; multi-athlete printing is not',async()=>{
 const data={...catalog,rows:[[0,'Dual Player','203','Drake Maye/Jayden Daniels','row:8'],[0,'Same Player','203','Drake Maye/Drake Maye','row:9']]};
 assert.deepEqual((await createManufacturerChecklistVariantProvider({catalog:data}).prepare(identity)).candidates.map(c=>c.label),['Same Player']);
});
test('unsupported category and incomplete identity never load the source archive',async()=>{
 let loads=0;const p=createManufacturerChecklistVariantProvider({loadCatalog:async()=>{loads++;return catalog;}});
 assert.equal((await p.prepare({...identity,category:'POKEMON'})).candidates.length,0);
 assert.deepEqual((await p.prepare({...identity,manufacturer:null})).problems,['IDENTITY_INCOMPLETE']);assert.equal(loads,0);
});
test('candidate bounds report truncation and repeated prepares reuse the immutable local index',async()=>{
 let loads=0;const p=createManufacturerChecklistVariantProvider({limit:1,loadCatalog:async()=>{loads++;return catalog;}});
 const [a,b]=await Promise.all([p.prepare(identity),p.prepare(identity)]);assert.equal(loads,1);assert.equal(a.truncated,true);assert.deepEqual(a.problems,['PROVIDER_TRUNCATED']);assert.deepEqual(a,b);
});
test('catalog corruption and cancelled work cannot silently generate a reference',async()=>{
 await assert.rejects(createManufacturerChecklistVariantProvider({catalog:{...catalog,complete:true}}).prepare(identity),/INVALID/);
 const c=new AbortController();c.abort();await assert.rejects(createManufacturerChecklistVariantProvider({catalog}).prepare(identity,{signal:c.signal}),{name:'AbortError'});
});
test('compact interned rows preserve candidate IDs and reject bad dictionary references',async()=>{
 const strings=[],ids=new Map();const intern=v=>{if(!ids.has(v)){ids.set(v,strings.length);strings.push(v);}return ids.get(v);};
 const compact={...catalog,strings,rows:catalog.rows.map(r=>[r[0],...r.slice(1).map(intern)])};
 assert.deepEqual(await createManufacturerChecklistVariantProvider({catalog:compact}).prepare(identity),await createManufacturerChecklistVariantProvider({catalog}).prepare(identity));
 await assert.rejects(createManufacturerChecklistVariantProvider({catalog:{...compact,rows:[[0,999999,0,0,0]]}}).prepare(identity),/INVALID/);
});
