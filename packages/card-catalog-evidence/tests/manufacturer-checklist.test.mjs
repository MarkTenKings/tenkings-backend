import test from 'node:test';
import assert from 'node:assert/strict';
import { createManufacturerChecklistVariantProvider, validateVariantCandidate, createVariantReviewSnapshot } from '../src/index.mjs';
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

const lameloIdentity = { category:'SPORTS',name:'LaMelo Ball',year:'2025',setName:'Topps Chrome — Ball of Duty',cardNumber:'BD-13',manufacturer:'Topps',language:null };
const lameloSource = {manufacturer:'Topps',manufacturerAliases:[],sport:'basketball',year:'2025-26',setName:'2025-26 Topps Chrome® Basketball',aliases:[],url:'https://cdn.shopify.com/s/files/1/0662/9749/5709/files/2025-26_Topps_Chrome_Basketball_Checklist.pdf?v=1763392799',sha256:'d63c903fd5609901be188aca3424830c50d4e75c5dca77cf7c4ca1d98abac955'};
const lameloCatalog = {schemaVersion:'manufacturer-checklist/v1',complete:false,sources:[lameloSource],rows:[[0,'BALL OF DUTY','BD-13','LaMelo Ball','page:14;row:25']]};

test('current LaMelo composite identity finds its explicit official season row without changing saved identity',async()=>{
 const result=await createManufacturerChecklistVariantProvider({catalog:lameloCatalog}).prepare(lameloIdentity);
 assert.equal(result.candidates.length,1);const c=result.candidates[0];
 assert.equal(c.label,'BALL OF DUTY');assert.equal(c.identity.year,'2025');assert.equal(c.identity.setName,lameloIdentity.setName);assert.equal(c.identity.language,null);
 assert.equal(c.source.url,lameloSource.url);assert.equal(c.source.sha256,lameloSource.sha256);
 assert.match(c.diagnostics[0].description,/2025-26/);assert.match(c.diagnostics[0].description,/page:14;row:25/);
 assert.equal(c.applicability,'unknown');assert.equal(c.canonical,null);
});
test('composite scope retains named parallel descendants but rejects unrelated or partial-word subsets',async()=>{
 const data={...lameloCatalog,rows:[...lameloCatalog.rows,[0,'BALL OF DUTY GOLD','BD-13','LaMelo Ball','page:14;row:26'],[0,'BALL OF DUTYBOUND','BD-13','LaMelo Ball','page:15;row:1'],[0,'CHROME CLASS','BD-13','LaMelo Ball','page:15;row:2']]};
 const p=createManufacturerChecklistVariantProvider({catalog:data});
 assert.deepEqual((await p.prepare({...lameloIdentity,setName:'Topps Chrome – Ball of Duty'})).candidates.map(c=>c.label),['BALL OF DUTY','BALL OF DUTY GOLD']);
 for(const patch of [{setName:'Topps Chrome — Ball of Dut'},{setName:'Topps Chrome — Nonexistent Insert'},{setName:'Topps Cosmic Chrome — Ball of Duty'},{year:'2024'},{year:'2024-25'},{year:'2025-27'},{cardNumber:'BD-14'},{name:'Lonzo Ball'},{manufacturer:'Panini'}])assert.equal((await p.prepare({...lameloIdentity,...patch})).candidates.length,0,JSON.stringify(patch));
});
test('bare starting-year alias is basketball-only and explicit seasons never broaden',async()=>{
 const p=createManufacturerChecklistVariantProvider({catalog:lameloCatalog});
 assert.equal((await p.prepare({...lameloIdentity,year:'2025-26'})).candidates.length,1);
 assert.deepEqual((await p.prepare({...lameloIdentity,year:'2025-26'})).candidates[0].diagnostics,[]);
 for(const sport of ['baseball','football'])assert.equal((await createManufacturerChecklistVariantProvider({catalog:{...lameloCatalog,sources:[{...lameloSource,sport}]}}).prepare(lameloIdentity)).candidates.length,0);
});
test('exact-year records win over a starting-season fallback',async()=>{
 const data={...lameloCatalog,sources:[lameloSource,{...lameloSource,year:'2025',sha256:'b'.repeat(64)}],rows:[...lameloCatalog.rows,[1,'BALL OF DUTY EXACT YEAR','BD-13','LaMelo Ball','row:1']]};
 const r=await createManufacturerChecklistVariantProvider({catalog:data}).prepare(lameloIdentity);
 assert.deepEqual(r.candidates.map(c=>c.label),['BALL OF DUTY EXACT YEAR']);assert.deepEqual(r.candidates[0].diagnostics,[]);
});
test('ambiguous season product aliases fail closed while duplicate same-product evidence is allowed',async()=>{
 const second={...lameloSource,setName:'2025-26 Topps Chrome Basketball Special Edition',aliases:['Topps Chrome'],sha256:'b'.repeat(64)};
 const data={...lameloCatalog,sources:[lameloSource,second],rows:[...lameloCatalog.rows,[1,'BALL OF DUTY','BD-13','LaMelo Ball','row:1']]};
 const r=await createManufacturerChecklistVariantProvider({catalog:data}).prepare(lameloIdentity);
 assert.deepEqual(r.candidates,[]);assert.deepEqual(r.problems,['PROVIDER_NOT_SUPPORTED']);
 assert.doesNotThrow(()=>createVariantReviewSnapshot({identity:lameloIdentity,...r,capturedAt:'2026-10-10T00:00:00.000Z'}));
 const duplicate={...data,sources:[lameloSource,{...lameloSource,sha256:'b'.repeat(64)}]};
 assert.equal((await createManufacturerChecklistVariantProvider({catalog:duplicate}).prepare(lameloIdentity)).candidates.length,1);
});
test('frozen official bundle resolves LaMelo and keeps the Jaxson printed-number gap explicit',async()=>{
 const provider=createManufacturerChecklistVariantProvider();
 const r=await provider.prepare(lameloIdentity);
 assert.equal(r.candidates.length,1);assert.equal(r.candidates[0].label,'BALL OF DUTY');
 assert.equal(r.candidates[0].source.sha256,lameloSource.sha256);
 assert.equal(r.candidates[0].identity.year,'2025');assert.match(r.candidates[0].diagnostics[0].description,/2025-26/);
 const jaxson={category:'SPORTS',name:'Jaxson Dart',year:'2025',setName:'Donruss Optic Football — Donruss Threads',cardNumber:'DTBH-JDT',manufacturer:'Panini',language:null};
 assert.equal((await provider.prepare(jaxson)).candidates.length,0);
 const official=await provider.prepare({...jaxson,cardNumber:'3'});
 assert.equal(official.candidates.length,9);assert.ok(official.candidates.some(c=>c.label==='Donruss Threads Blue Hyper'));
 assert.ok(official.candidates.every(c=>c.label.startsWith('Donruss Threads ')&&c.source.sha256==='5ea74b6c404251b503f64d635c58d8c714c87d21eef716f5455fb02e0e65d567'));
});
