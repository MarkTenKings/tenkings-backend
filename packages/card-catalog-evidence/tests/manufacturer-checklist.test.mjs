import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
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

test('bundled Ball of Duty player rows join exact official odds printings, not base-set parallels',async()=>{
 const p=createManufacturerChecklistVariantProvider();
 const result=await p.prepare({...lameloIdentity,year:null});
 assert.equal(result.candidates.length,16);
 assert.deepEqual(result.candidates.map(c=>c.parallel).sort(),['BALL OF DUTY',...['Refractor','RayWave Refractor','Magenta Refractor','Teal Refractor','Yellow Refractor','Aqua Refractor','Blue Refractor','Green Refractor','Purple Refractor','Gold Refractor','Orange Refractor','Black Refractor','Red Refractor','Superfractor','Pulsar Refractor'].map(n=>`BALL OF DUTY ${n}`)].sort());
 for(const c of result.candidates){assert.equal(c.identity.year,'2025-26');assert.equal(c.identity.cardNumber,'BD-13');assert.equal(c.applicability,'unknown');validateVariantCandidate(c);}
 const blue=result.candidates.find(c=>c.parallel==='BALL OF DUTY Blue Refractor');
 assert.equal(blue.source.sha256,'f1394a48d438d6ed93c791de9bfe8aafd57ee2de1d176b17aa3b1c3cb8996a1a');
 assert.equal(blue.source.references[0].sha256,lameloSource.sha256);
 assert.match(blue.diagnostics.find(d=>d.id==='manufacturer-parallel-family').description,/Ball of Duty Refractors Blue/);
 for(const patch of [{year:'2024-25'},{setName:'Topps Cosmic Chrome — Ball of Duty'},{cardNumber:'BD-99'},{name:'Lonzo Ball'}])assert.equal((await p.prepare({...lameloIdentity,...patch})).candidates.length,0);
});

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
test('frozen official bundle exposes Jaxson insert variants while retaining the different printed number',async()=>{
 const provider=createManufacturerChecklistVariantProvider();
 const r=await provider.prepare(lameloIdentity);
 assert.equal(r.candidates.length,16);assert.equal(r.candidates[0].label,'BALL OF DUTY');
 assert.equal(r.candidates[0].source.sha256,lameloSource.sha256);
 assert.equal(r.candidates[0].identity.year,'2025');assert.match(r.candidates[0].diagnostics[0].description,/2025-26/);
 const jaxson={category:'SPORTS',name:'Jaxson Dart',year:'2025',setName:'Donruss Optic Football — Donruss Threads',cardNumber:'DTBH-JDT',manufacturer:'Panini',language:null};
 const printed=await provider.prepare(jaxson);
 assert.equal(printed.candidates.length,9);assert.ok(printed.candidates.some(c=>c.label==='Donruss Threads Blue Hyper'));
 assert.ok(printed.candidates.every(c=>c.identity.cardNumber==='DTBH-JDT'&&c.applicability==='unknown'&&c.warnings.includes('SCOPE_UNCONFIRMED')));
 assert.ok(printed.candidates.every(c=>c.diagnostics.some(d=>d.id==='manufacturer-checklist-number'&&d.description.includes('checklist number: 3')&&d.description.includes('DTBH-JDT'))));
 const official=await provider.prepare({...jaxson,cardNumber:'3'});
 assert.equal(official.candidates.length,9);assert.ok(official.candidates.some(c=>c.label==='Donruss Threads Blue Hyper'));
 assert.ok(official.candidates.every(c=>c.label.startsWith('Donruss Threads ')&&c.source.sha256==='5ea74b6c404251b503f64d635c58d8c714c87d21eef716f5455fb02e0e65d567'));
});

test('frozen Fleer supplement serves six official sports sources with literal labels and no inferred plates',async()=>{
 const provider=createManufacturerChecklistVariantProvider();
 const cases=[
  ['2016-17','Fleer Showcase','Sidney Crosby','1',6,'2016-17-fleer-showcase-checklist/','Base Set'],
  ['2015-16','Fleer Showcase','Steven Stamkos','1',3,'2015-16-fleer-showcase-checklist/','Base Set'],
  ['25-26','Fleer Ultra PWHL','Abby Roque','1',12,'2025-26-fleer-ultra-pwhl-checklist/','Base Set'],
  ['2025-2026','Fleer Ultra','Tomas Hertl','1',8,'2025-2026-fleer-ultra-checklist/','Printing Plates Parallel'],
  ['2026','Fleer Ultra Golf','Viktor Hovland','1',12,'2026-fleer-ultra-golf/','Base Set'],
  ['2023','Fleer Ultra Golf','Tiger Woods','2',18,'2023-fleer-ultra-golf-checklist/','2023 Fleer Ultra Golf'],
 ];
 for(const [year,setName,name,cardNumber,count,slug,literal] of cases){
  const result=await provider.prepare({category:'SPORTS',year,setName,name,cardNumber,manufacturer:'Fleer',language:'en'});
  assert.equal(result.candidates.length,count,name);
  assert.ok(result.candidates.some(c=>c.label===literal),name);
  assert.ok(result.candidates.every(c=>c.source.url===`https://upperdeck.com/checklist/${slug}`&&c.applicability==='unknown'&&c.canonical===null));
  assert.ok(result.candidates.every(c=>!/^Printing Plates (Black|Cyan|Magenta|Yellow)/i.test(c.label)));
 }
 const missing=await provider.prepare({category:'SPORTS',year:'2026',setName:'Fleer Ultra Golf',name:'Matthieu Pavon',cardNumber:'FLAIR-1',manufacturer:'Fleer',language:'en'});
 assert.equal(missing.candidates.length,0,'a blank printed subset is not filled from another row');
 const jordan=await provider.prepare({category:'SPORTS',year:'92-93',setName:'Fleer',name:'Michael Jordan',cardNumber:'273',manufacturer:'Fleer',language:'en'});
 assert.equal(jordan.candidates.length,0,'unacquired historical Fleer remains an explicit gap');
});

const hashBytes = value => createHash('sha256').update(value).digest('hex');
function shardsFor(data) {
 const files = new Map();
 const sources = data.sources.map((source, sourceIndex) => {
  const rows = data.rows.filter(row => row[0] === sourceIndex).map(row => [0, ...row.slice(1)]);
  const decoded = Buffer.from(JSON.stringify({ ...data, sources:[source], rows }));
  const bytes = gzipSync(decoded), sha256 = hashBytes(bytes);
  const shard = {path:`manufacturer-checklists/${sha256}.json.gz`,sha256,decodedSha256:hashBytes(decoded),compressedBytes:bytes.length,decodedBytes:decoded.length,rowCount:rows.length};
  files.set(shard.path, bytes);
  return {...source, shard};
 });
 const catalog = {schemaVersion:'manufacturer-checklist-index/v2',complete:false,sources};
 return {catalog,files,loadShard:async descriptor => files.get(descriptor.path)};
}
function productsFixture() {
 return {...catalog,sources:[source,{...source,setName:'Prizm',aliases:['Prizm'],sha256:'b'.repeat(64)},{...source,setName:'Select',aliases:['Select'],sha256:'c'.repeat(64)}],
  rows:[...catalog.rows,[1,'Base','203','Drake Maye','row:1'],[2,'Silver','203','Drake Maye','row:2']]};
}
test('explicit Fleer season spellings resolve from catalog evidence in row and shard readers',async()=>{
 const jordan={...identity,name:'Michael Jordan',year:'92-93',setName:'Fleer',cardNumber:'273',manufacturer:'Fleer'};
 const fleer={...source,manufacturer:'Fleer',manufacturerAliases:[],sport:'basketball',year:'1992-93',setName:'1992-93 Fleer Basketball',aliases:[],url:'https://example.com/season-fixture'};
 for(const sourceYear of ['1992-93','1992-1993','1992–93']){
  const data={...catalog,sources:[{...fleer,year:sourceYear}],rows:[[0,'Base','273','Michael Jordan','row:274']]};
  for(const options of [{catalog:data},shardsFor(data)]){
   const p=createManufacturerChecklistVariantProvider(options);
   for(const year of ['92-93','92–93','1992-93','1992-1993','1992 / 1993']){
    const result=await p.prepare({...jordan,year});
    assert.deepEqual(result.candidates.map(c=>c.label),['Base']);
    assert.equal(result.candidates[0].identity.year,year);
   }
   assert.equal((await p.prepare({...jordan,setName:'92-93 Fleer'})).candidates.length,1);
   for(const year of ['92','93','1993','91-92','1992-94','1992-2093','92-94'])
    assert.equal((await p.prepare({...jordan,year})).candidates.length,0,year);
  }
 }
});
test('abbreviated season never chooses a century from the player or current date',async()=>{
 const fleer={...source,manufacturer:'Fleer',manufacturerAliases:[],sport:'basketball',year:'1992-93',setName:'Fleer',aliases:[]};
 const data={...catalog,sources:[fleer,{...fleer,year:'2092-2093',sha256:'b'.repeat(64)}],rows:[[0,'Base','273','Michael Jordan','row:274'],[1,'Base','1','Different Athlete','row:2']]};
 for(const options of [{catalog:data},shardsFor(data)]){
  const p=createManufacturerChecklistVariantProvider(options);
  const query={...identity,name:'Michael Jordan',year:'92-93',setName:'Fleer',cardNumber:'273',manufacturer:'Fleer'};
  assert.deepEqual((await p.prepare(query)).problems,['PROVIDER_NOT_SUPPORTED']);
  assert.equal((await p.prepare({...query,year:'1992-1993'})).candidates.length,1);
 }
});
test('season rollover and unrelated products do not create century guesses or conflicts',async()=>{
 const data={...catalog,sources:[{...source,year:'1999-2000'},{...source,year:'2099-2100',setName:'Other Product',aliases:[]}],rows:catalog.rows};
 for(const options of [{catalog:data},shardsFor(data)]){
  const p=createManufacturerChecklistVariantProvider(options);
  assert.equal((await p.prepare({...identity,year:'99-00'})).candidates.length,2);
  assert.equal((await p.prepare({...identity,year:'1999-00'})).candidates.length,2);
  assert.equal((await p.prepare({...identity,year:'1999-1900'})).candidates.length,0);
 }
});
test('v2 source selection loads only the exact product and preserves v1 IDs, ordering and evidence',async()=>{
 const data=productsFixture(), f=shardsFor(data), reads=[];
 const provider=createManufacturerChecklistVariantProvider({catalog:f.catalog,loadShard:async d=>{reads.push(d.path);return f.loadShard(d);}});
 assert.deepEqual(await provider.prepare(identity),await createManufacturerChecklistVariantProvider({catalog:data}).prepare(identity));
 assert.deepEqual(reads,[f.catalog.sources[0].shard.path]);
 assert.equal((await provider.prepare({...identity,manufacturer:'Topps'})).candidates.length,0);
 assert.equal(reads.length,1);
 const duplicate={...catalog,sources:[source,{...source,sha256:'d'.repeat(64)}],rows:[...catalog.rows,[1,'Rated Rookies','203','Drake Maye','row:99']]};
 const dup=shardsFor(duplicate);
 assert.deepEqual(await createManufacturerChecklistVariantProvider(dup).prepare(identity),await createManufacturerChecklistVariantProvider({catalog:duplicate}).prepare(identity));
});
test('v2 keeps composite and season rules, tries fallback only after no exact matching rows, and skips other sports',async()=>{
 const exact={...lameloSource,year:'2025',sha256:'b'.repeat(64)}, otherSport={...lameloSource,sport:'football',sha256:'c'.repeat(64)};
 const data={...lameloCatalog,sources:[exact,otherSport,lameloSource],rows:[[0,'BALL OF DUTY','BD-99','LaMelo Ball','row:1'],[1,'BALL OF DUTY','BD-13','LaMelo Ball','row:2'],[2,...lameloCatalog.rows[0].slice(1)]]};
 const f=shardsFor(data), reads=[];
 const p=createManufacturerChecklistVariantProvider({catalog:f.catalog,loadShard:async d=>{reads.push(d.path);return f.loadShard(d);}});
 assert.deepEqual(await p.prepare(lameloIdentity),await createManufacturerChecklistVariantProvider({catalog:data}).prepare(lameloIdentity));
 assert.deepEqual(reads,[f.catalog.sources[0].shard.path,f.catalog.sources[2].shard.path]);
 assert.equal((await p.prepare({...lameloIdentity,setName:'Topps Chrome — Ball of Dut'})).candidates.length,0);
 const exactData={...data,rows:[[0,'BALL OF DUTY EXACT','BD-13','LaMelo Ball','row:1'],...data.rows.slice(1)]}, e=shardsFor(exactData), exactReads=[];
 assert.deepEqual((await createManufacturerChecklistVariantProvider({catalog:e.catalog,loadShard:async d=>{exactReads.push(d.path);return e.loadShard(d);}}).prepare(lameloIdentity)).candidates.map(c=>c.label),['BALL OF DUTY EXACT']);
 assert.equal(exactReads.length,1);
 const ambiguous={...lameloCatalog,sources:[lameloSource,{...lameloSource,setName:'Special Edition',aliases:['Topps Chrome'],sha256:'d'.repeat(64)}],rows:[...lameloCatalog.rows,[1,...lameloCatalog.rows[0].slice(1)]]};
 assert.deepEqual((await createManufacturerChecklistVariantProvider(shardsFor(ambiguous)).prepare(lameloIdentity)).problems,['PROVIDER_NOT_SUPPORTED']);
});
test('v2 coalesces concurrent reads, serializes different products and evicts the least recently used of two shards',async()=>{
 const f=shardsFor(productsFixture()), reads=[];let active=0, peak=0;
 const p=createManufacturerChecklistVariantProvider({catalog:f.catalog,loadShard:async d=>{reads.push(d.path);active++;peak=Math.max(peak,active);await new Promise(resolve=>setImmediate(resolve));active--;return f.loadShard(d);}});
 await Promise.all([p.prepare(identity),p.prepare(identity)]);assert.equal(reads.length,1);
 await p.prepare({...identity,setName:'Prizm'});await p.prepare(identity);await p.prepare({...identity,setName:'Select'});
 await p.prepare(identity);assert.equal(reads.length,3);
 await p.prepare({...identity,setName:'Prizm'});assert.equal(reads.length,4);assert.equal(reads[3],f.catalog.sources[1].shard.path);
 const fresh=createManufacturerChecklistVariantProvider({catalog:f.catalog,loadShard:async d=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setImmediate(resolve));active--;return f.loadShard(d);}});
 await Promise.all(['Donruss Optic','Prizm','Select'].map(setName=>fresh.prepare({...identity,setName})));
 assert.equal(peak,1);
});
test('v2 failed reads can recover and cancelling one shared caller does not cancel the other',async()=>{
 const f=shardsFor(catalog);let reads=0,release;
 const p=createManufacturerChecklistVariantProvider({catalog:f.catalog,loadShard:async d=>{reads++;if(reads===1)throw new Error('offline');await new Promise(resolve=>{release=resolve;});return f.loadShard(d);}});
 await assert.rejects(p.prepare(identity),/offline/);
 const controller=new AbortController(), first=p.prepare(identity,{signal:controller.signal}), second=p.prepare(identity);
 const rejected=assert.rejects(first,{name:'AbortError'});
 while(!release)await new Promise(resolve=>setImmediate(resolve));
 controller.abort();release();await rejected;assert.equal((await second).candidates.length,2);assert.equal(reads,2);
 assert.equal((await p.prepare(identity)).candidates.length,2);assert.equal(reads,2);
});
test('v2 rejects descriptor traversal, unsafe bounds and non-partial coverage before reading rows',async()=>{
 const f=shardsFor(catalog);
 const patches=[{path:'../catalog.json.gz'},{path:`manufacturer-checklists/${'f'.repeat(64)}.json.gz`},{compressedBytes:4*1024*1024+1},{decodedBytes:8*1024*1024+1},{rowCount:100001},{sha256:'invalid'},{decodedSha256:'invalid'},{extra:true}];
 for(const patch of patches){const data=structuredClone(f.catalog);Object.assign(data.sources[0].shard,patch);let reads=0;await assert.rejects(createManufacturerChecklistVariantProvider({catalog:data,loadShard:async()=>{reads++;return null;}}).prepare(identity),/INVALID/);assert.equal(reads,0);}
 for(const patch of [{complete:true},{extra:true}])await assert.rejects(createManufacturerChecklistVariantProvider({...f,catalog:{...f.catalog,...patch}}).prepare(identity),/INVALID/);
});
test('v2 validates compressed and decoded hashes, bytes, source metadata and row count on every uncached shard',async()=>{
 const f=shardsFor(catalog);
 for(const patch of [{compressedBytes:f.catalog.sources[0].shard.compressedBytes+1},{decodedBytes:f.catalog.sources[0].shard.decodedBytes+1},{decodedSha256:'f'.repeat(64)},{rowCount:2}]){
  const data=structuredClone(f.catalog);Object.assign(data.sources[0].shard,patch);await assert.rejects(createManufacturerChecklistVariantProvider({...f,catalog:data}).prepare(identity),/INVALID/);
 }
 const changed=structuredClone(f.catalog);changed.sources[0].url='https://example.com/other';
 await assert.rejects(createManufacturerChecklistVariantProvider({...f,catalog:changed}).prepare(identity),/source/);
 await assert.rejects(createManufacturerChecklistVariantProvider({...f,loadShard:async()=>Buffer.alloc(f.catalog.sources[0].shard.compressedBytes)}).prepare(identity),/compressed bytes\/hash/);
 // A content hash cannot be reused under changed metadata, even after caching.
 const shared=structuredClone(f.catalog);shared.sources.push({...shared.sources[0],url:'https://example.com/other'});
 await assert.rejects(createManufacturerChecklistVariantProvider({...f,catalog:shared}).prepare(identity),/source binding/);
 const badRow=shardsFor({...catalog,rows:[[0,'Base','203','Drake Maye','']]});
 await assert.rejects(createManufacturerChecklistVariantProvider(badRow).prepare(identity),/INVALID: row/);
});
test('v2 stops oversized gzip output before parsing despite a false small decoded descriptor',async()=>{
 const f=shardsFor(catalog), bytes=gzipSync(Buffer.alloc(8*1024*1024+1,32)), sha256=hashBytes(bytes);
 Object.assign(f.catalog.sources[0].shard,{sha256,path:`manufacturer-checklists/${sha256}.json.gz`,compressedBytes:bytes.length});
 await assert.rejects(createManufacturerChecklistVariantProvider({...f,loadShard:async()=>bytes}).prepare(identity),{code:'ERR_BUFFER_TOO_LARGE'});
});


test('numeric checklist positions are advisory only for a unique explicit athlete and insert in both catalog readers',async()=>{
 const entry={...source,year:'2025',setName:'2025 Donruss Optic Football'};
 const data={schemaVersion:'manufacturer-checklist/v1',complete:false,sources:[entry],rows:[
  [0,'Donruss Threads Blue Hyper','3','Jaxson Dart','row:1'],
  [0,'Donruss Threads Gold','3','Jaxson Dart','row:2'],
  [0,'Rated Rookie','3','Jaxson Dart','row:3'],
  [0,'Donruss Threads Blue Hyper','4','Other Player','row:4']]};
 const input={...identity,name:'Jaxson Dart',year:'2025',setName:'Donruss Optic — Donruss Threads',cardNumber:'DTBH-JDT'};
 for(const provider of [createManufacturerChecklistVariantProvider({catalog:data}),createManufacturerChecklistVariantProvider(shardsFor(data))]){
  const result=await provider.prepare(input);
  assert.deepEqual(result.candidates.map(c=>c.label),['Donruss Threads Blue Hyper','Donruss Threads Gold']);
  assert.ok(result.candidates.every(c=>c.identity.cardNumber===input.cardNumber&&c.canonical===null&&c.warnings.includes('SCOPE_UNCONFIRMED')));
  for(const patch of [{cardNumber:'4'},{setName:'Donruss Optic'},{setName:'Donruss Optic — Other Insert'},{name:'Unknown Player'},{year:'2024'},{manufacturer:'Topps'}])
   assert.equal((await provider.prepare({...input,...patch})).candidates.length,0,JSON.stringify(patch));
  assert.ok((await provider.prepare({...input,cardNumber:'3'})).candidates.every(c=>!c.warnings.includes('SCOPE_UNCONFIRMED')));
 }
 const ambiguous={...data,rows:[...data.rows,[0,'Donruss Threads Black','5','Jaxson Dart','row:5']]};
 assert.equal((await createManufacturerChecklistVariantProvider({catalog:ambiguous}).prepare(input)).candidates.length,0);
});


test('unknown year discovers exact source-backed seasons and preserves competing years without inferring a variant',async()=>{
 const data={...lameloCatalog,sources:[lameloSource,{...lameloSource,year:'2024-25',sha256:'b'.repeat(64)}],
  rows:[...lameloCatalog.rows,[1,'BALL OF DUTY','BD-13','LaMelo Ball','row:1']]};
 const input={...lameloIdentity,year:null},original=structuredClone(input);
 for(const options of [{catalog:data},shardsFor(data)]){
  const result=await createManufacturerChecklistVariantProvider(options).prepare(input);
  assert.equal(result.candidates.length,2);
  assert.deepEqual(new Set(result.candidates.map(c=>c.identity.year)),new Set(['2025-26','2024-25']));
  assert.equal(new Set(result.candidates.map(c=>c.candidateId)).size,2);
  assert.ok(result.candidates.every(c=>c.applicability==='unknown'&&c.warnings.includes('SCOPE_UNCONFIRMED')&&c.diagnostics.some(d=>d.id==='manufacturer-checklist-year')));
  assert.deepEqual(input,original);
  for(const patch of [{cardNumber:'BD-14'},{name:'Lonzo Ball'},{manufacturer:'Panini'},{setName:'Topps Cosmic Chrome — Ball of Duty'}])
   assert.equal((await createManufacturerChecklistVariantProvider(options).prepare({...input,...patch})).candidates.length,0);
 }
 const numeric={...lameloCatalog,rows:[[0,'BALL OF DUTY','13','LaMelo Ball','row:1']]};
 for(const options of [{catalog:numeric},shardsFor(numeric)])assert.equal((await createManufacturerChecklistVariantProvider(options).prepare(input)).candidates.length,0,'unknown year cannot use numeric insert fallback');
});
test('unknown year can find an oldest exact card beyond sixteen matching seasons',async()=>{
 const sources=Array.from({length:20},(_,i)=>({...source,year:String(1990+i),sha256:i.toString(16).padStart(64,'0')}));
 const data={...catalog,sources,rows:sources.map((_,i)=>[i,'Base',i===0?'203':'999','Drake Maye','row:1'])};
 for(const options of [{catalog:data},shardsFor(data)]){
  const result=await createManufacturerChecklistVariantProvider(options).prepare({...identity,year:null});
  assert.deepEqual(result.candidates.map(c=>c.identity.year),['1990']);assert.equal(result.truncated,false);
 }
});
test('frozen manufacturer source identifies the unknown-year LaMelo number as a candidate only',async()=>{
 const input={...lameloIdentity,year:null},result=await createManufacturerChecklistVariantProvider().prepare(input);
 assert.equal(result.candidates.length,16);assert.equal(result.candidates[0].identity.year,'2025-26');
 assert.equal(result.candidates[0].identity.cardNumber,'BD-13');assert.equal(result.candidates[0].source.sha256,lameloSource.sha256);
 assert.equal(input.year,null);assert.equal(result.candidates[0].applicability,'unknown');
});


test('Curry Flagship resolves the official product and every supported base printing without a 48-choice cut',async()=>{
 const p=createManufacturerChecklistVariantProvider();
 const identity={category:'SPORTS',name:'Stephen Curry',year:null,setName:'Flagship',cardNumber:'135',manufacturer:'Topps',language:null};
 const result=await p.prepare(identity);
 assert.equal(result.candidates.length,58);assert.equal(result.truncated,false);
 for(const c of result.candidates){assert.equal(c.identity.year,'2025-26');assert.equal(c.identity.cardNumber,'135');assert.equal(c.applicability,'unknown');}
 for(const parallel of ['BASE CARDS I','BASE CARDS I GOLDEN MIRROR IMAGE VARIATION','Gold','Rainbow Foilboard','Gold Rainbow','Holo Foil','Doorbuster'])assert(result.candidates.some(c=>c.parallel===parallel),parallel);
 assert.equal(createVariantReviewSnapshot({identity,candidates:result.candidates,capturedAt:'2026-10-13T00:00:00.000Z'}).candidates.length,58);
 for(const patch of [{setName:'Topps Chrome'},{year:'2024-25'},{name:'Seth Curry'},{cardNumber:'136'}])assert(!(await p.prepare({...identity,...patch})).candidates.some(c=>c.parallel==='Doorbuster'));
});

test('Nick Kurtz base Refractor is supplied by the exact official Bowman Chrome odds, not unrelated prospect parallels',async()=>{
 const result=await createManufacturerChecklistVariantProvider().prepare({category:'SPORTS',name:'Nick Kurtz',year:null,setName:'Bowman Chrome',cardNumber:'93',manufacturer:'Topps',language:null});
 assert.equal(result.candidates.length,28);assert.equal(result.truncated,false);
 const refractor=result.candidates.find(c=>c.parallel==='Refractor');assert(refractor);
 assert.equal(refractor.source.sha256,'287d0f8cba2a80724e186138c146832c2559418e99e73fb68d31add65da0d346');
 assert.equal(refractor.identity.year,'2025');assert.equal(refractor.source.references[0].sha256,'3ee770b295a63bc8482899b50fb651bcc6cdb55796d53e3bf4b1bd1efc5cc55f');
 assert(!result.candidates.some(c=>/Speckle|Reptilian|Shimmer/.test(c.parallel)));
});
