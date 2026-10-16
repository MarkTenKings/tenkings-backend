import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {manufacturerRuntimeFiles} from '../src/manufacturer-runtime-files.mjs';
import {createManufacturerIdentityIndexBuilder} from '../src/manufacturer-identity-index.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const prefix='packages/card-catalog-evidence/data/';
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'atlas-catalog-closure-')),data=join(root,prefix);
 await mkdir(join(data,'manufacturer-checklists'),{recursive:true});
 for(const name of ['manufacturer-parallel-families.json','manufacturer-product-aliases.json'])await writeFile(join(data,name),'{}');
 const source={manufacturer:'Fleer',sport:'basketball',year:'1992-93',setName:'Fleer',aliases:[],url:'https://example.com/checklist',sha256:'a'.repeat(64)};
 const raw=Buffer.from(JSON.stringify({schemaVersion:'manufacturer-checklist/v1',complete:false,sources:[source],rows:[[0,'Slam Dunk','273','Michael Jordan','row:273']]})),bytes=gzipSync(raw);
 const shard={path:`manufacturer-checklists/${sha(bytes)}.json.gz`,sha256:sha(bytes),decodedSha256:sha(raw),compressedBytes:bytes.length,decodedBytes:raw.length,rowCount:1};
 const index={schemaVersion:'manufacturer-checklist-index/v2',complete:false,sources:[{...source,shard}]};
 const save=async()=>{await writeFile(join(data,'manufacturer-checklists.index.json'),JSON.stringify(index));
  const builder=createManufacturerIdentityIndexBuilder(index);builder.add(0,JSON.parse(raw));
  await writeFile(join(data,'manufacturer-identities.index.json.gz'),gzipSync(Buffer.from(JSON.stringify(builder.finish()))));};
 await writeFile(join(data,shard.path),bytes);await save();
 return {root,data,source,shard,index,save,bytes};
}
test('v2 packaging takes index, every referenced product and shared metadata, excluding old monolith and unrelated sources',async()=>{
 const f=await fixture();try{
  await writeFile(join(f.data,'manufacturer-checklists.json.gz'),'obsolete');await writeFile(join(f.data,'unrelated.txt'),'not a runtime input');
  assert.deepEqual(await manufacturerRuntimeFiles(f.root),['manufacturer-checklists.index.json','manufacturer-identities.index.json.gz',f.shard.path,'manufacturer-parallel-families.json','manufacturer-product-aliases.json'].map(x=>prefix+x).sort());
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test('missing or changed shard, wrong source binding and traversal cannot form a package',async()=>{
 const f=await fixture();try{
  await rm(join(f.data,f.shard.path));await assert.rejects(manufacturerRuntimeFiles(f.root),/ENOENT/);
  await writeFile(join(f.data,f.shard.path),'corrupt');await assert.rejects(manufacturerRuntimeFiles(f.root));
  await writeFile(join(f.data,f.shard.path),f.bytes);f.index.sources[0].setName='Different';await f.save();await assert.rejects(manufacturerRuntimeFiles(f.root),/source binding/);
  f.index.sources[0].setName=f.source.setName;f.shard.path='../escape';await f.save();await assert.rejects(manufacturerRuntimeFiles(f.root),/shard path/);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test('broken index symlink cannot select obsolete monolith',async()=>{
 const f=await fixture();try{
  await rm(join(f.data,'manufacturer-checklists.index.json'));await symlink(join(f.data,'missing'),join(f.data,'manufacturer-checklists.index.json'));
  await writeFile(join(f.data,'manufacturer-checklists.json.gz'),'old');await assert.rejects(manufacturerRuntimeFiles(f.root),/regular file/);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test('missing index rejects packaging even when an obsolete monolith is present',async()=>{
 const f=await fixture();try{
  await rm(join(f.data,'manufacturer-checklists.index.json'));await writeFile(join(f.data,'manufacturer-checklists.json.gz'),'legacy');
  await assert.rejects(manufacturerRuntimeFiles(f.root),/ENOENT/);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test('a catalog-bound acceleration file cannot silently omit an athlete or reference the wrong source',async()=>{
 const f=await fixture();try{
  const path=join(f.data,'manufacturer-identities.index.json.gz');
  const value=JSON.parse(gunzipSync(await readFile(path)));value.names=[];
  await writeFile(path,gzipSync(Buffer.from(JSON.stringify(value))));
  await assert.rejects(manufacturerRuntimeFiles(f.root),/cover every source row/);
  await f.save();await rm(path);await assert.rejects(manufacturerRuntimeFiles(f.root),/ENOENT/);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
