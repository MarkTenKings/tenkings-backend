import test from 'node:test';
import assert from 'node:assert/strict';
import {cp,mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const identity={category:'SPORTS',manufacturer:'Fleer',setName:'Fleer',year:'1992-93',name:'Michael Jordan',cardNumber:'273',language:null};
// Authored wire fixture; this is not a manufacturer acquisition receipt.
const catalog={schemaVersion:'manufacturer-checklist/v1',complete:false,sources:[{
 manufacturer:'Fleer',sport:'basketball',year:'1992-93',setName:'Fleer',aliases:[],
 url:'https://example.com/retained',sha256:'a'.repeat(64)}],rows:[[0,'Slam Dunk','273','Michael Jordan','row:1']]};
async function fixture(t,{index=true,malformed=false}={}){
 const root=await mkdtemp(join(tmpdir(),'atlas-default-index-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await cp(new URL('../src/',import.meta.url),join(root,'src'),{recursive:true});
 await mkdir(join(root,'data/manufacturer-checklists'),{recursive:true});
 const decoded=Buffer.from(JSON.stringify(catalog)),bytes=gzipSync(decoded),sha256=hash(bytes);
 await writeFile(join(root,'data/manufacturer-checklists.json.gz'),bytes);
 await writeFile(join(root,'data/manufacturer-parallel-families.json'),JSON.stringify({schemaVersion:'manufacturer-parallel-families/v1',complete:false,families:[]}));
 await writeFile(join(root,'data/manufacturer-product-aliases.json'),JSON.stringify({schemaVersion:'manufacturer-product-aliases/v1',complete:false,products:[]}));
 if(index){
  await writeFile(join(root,`data/manufacturer-checklists/${sha256}.json.gz`),bytes);
  await writeFile(join(root,'data/manufacturer-checklists.index.json'),malformed?'{}':JSON.stringify({schemaVersion:'manufacturer-checklist-index/v2',complete:false,sources:[{...catalog.sources[0],shard:{path:`manufacturer-checklists/${sha256}.json.gz`,sha256,decodedSha256:hash(decoded),compressedBytes:bytes.length,decodedBytes:decoded.length,rowCount:1}}]}));
 }
 return (await import(pathToFileURL(join(root,'src/manufacturer-checklist.mjs')))).createManufacturerChecklistVariantProvider;
}
test('default serving reader requires its v2 index even when a valid retained monolith exists',async t=>{
 const provider=(await fixture(t,{index:false}))();
 await assert.rejects(provider.prepare(identity),{code:'ENOENT'});
});
test('invalid default index cannot silently serve the old monolith',async t=>{
 const provider=(await fixture(t,{malformed:true}))();
 await assert.rejects(provider.prepare(identity),/MANUFACTURER_CHECKLIST_INVALID/);
});
test('complete default index closure serves its row and explicit v1 fixture injection remains available',async t=>{
 const create=await fixture(t),result=await create().prepare(identity);
 assert.equal(result.candidates.length,1);assert.equal(result.candidates[0].label,'Slam Dunk');
 const noIndex=await fixture(t,{index:false});
 assert.deepEqual(await noIndex({catalog}).prepare(identity),result);
 assert.deepEqual(await noIndex({loadCatalog:async()=>catalog}).prepare(identity),result);
});
