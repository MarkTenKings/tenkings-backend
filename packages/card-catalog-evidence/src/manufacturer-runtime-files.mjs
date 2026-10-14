import assert from 'node:assert/strict';
import {open,realpath,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';

const DATA='packages/card-catalog-evidence/data/';
const HASH=/^[a-f0-9]{64}$/;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)
  ?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const common=['manufacturer-parallel-families.json','manufacturer-product-aliases.json'];
async function readBounded(workspace,path,maximum){
  const full=resolve(workspace,path),root=await realpath(workspace);
  const link=await lstat(full);assert(link.isFile()&&!link.isSymbolicLink(),`Catalog file is not a regular file: ${path}`);
  const rel=relative(root,await realpath(full));
  assert(rel&&!rel.startsWith('..'),'Catalog dependency outside workspace');
  const file=await open(full,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const stat=await file.stat();assert(stat.isFile()&&stat.size<=maximum,`Catalog file bounds: ${path}`);
    const bytes=await file.readFile();assert.equal(bytes.length,stat.size);return bytes;
  }finally{await file.close();}
}

/** Resolve the exact reader data closure. Validate all shard bindings before
 * packaging, keeping one decompressed product at a time. No network access. */
export async function manufacturerRuntimeFiles(workspace){
  const files=[];
  for(const name of common){await readBounded(workspace,DATA+name,128*1024);files.push(DATA+name);}
  const indexPath=DATA+'manufacturer-checklists.index.json';
  const raw=await readBounded(workspace,indexPath,16*1024*1024);
  const index=JSON.parse(raw);
  assert.equal(index.schemaVersion,'manufacturer-checklist-index/v2');assert.equal(index.complete,false);
  assert(Array.isArray(index.sources)&&index.sources.length<=20000,'Catalog source bounds');
  assert.equal(Object.keys(index).sort().join(','),'complete,schemaVersion,sources');
  files.push(indexPath);
  for(const {shard,...metadata} of index.sources){
    assert(shard&&HASH.test(shard.sha256)&&HASH.test(shard.decodedSha256),'Catalog shard hashes');
    assert.equal(Object.keys(shard).sort().join(','),'compressedBytes,decodedBytes,decodedSha256,path,rowCount,sha256');
    assert.equal(shard.path,`manufacturer-checklists/${shard.sha256}.json.gz`,'Catalog shard path');
    assert(Number.isSafeInteger(shard.compressedBytes)&&shard.compressedBytes>0&&shard.compressedBytes<=4*1024*1024);
    assert(Number.isSafeInteger(shard.decodedBytes)&&shard.decodedBytes>0&&shard.decodedBytes<=8*1024*1024);
    assert(Number.isSafeInteger(shard.rowCount)&&shard.rowCount>=0&&shard.rowCount<=100000);
    const path=DATA+shard.path,bytes=await readBounded(workspace,path,4*1024*1024);
    assert.equal(bytes.length,shard.compressedBytes,path);assert.equal(sha(bytes),shard.sha256,path);
    const decoded=gunzipSync(bytes,{maxOutputLength:8*1024*1024});
    assert.equal(decoded.length,shard.decodedBytes,path);assert.equal(sha(decoded),shard.decodedSha256,path);
    const data=JSON.parse(decoded);
    assert.equal(data.schemaVersion,'manufacturer-checklist/v1');assert.equal(data.complete,false);
    assert.equal(canonical(data.sources),canonical([metadata]),'Catalog shard source binding');
    assert(Array.isArray(data.rows)&&data.rows.length===shard.rowCount,'Catalog shard row count');
    assert(data.rows.every(row=>Array.isArray(row)&&row.length===5&&row[0]===0),'Catalog shard row binding');
    files.push(path);
  }
  return [...new Set(files)].sort();
}
