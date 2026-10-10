import test from 'node:test';
import assert from 'node:assert/strict';
import {canonical,digest} from '@atlas/manual-service/contract';
import {createVariantJobStore} from '../src/variant-job-store.mjs';

function fixture(){
 const rows=new Map(),writes=[];
 const tx={async $executeRawUnsafe(sql,...args){writes.push({sql,args});if(sql.includes('variant_catalog_cache'))rows.set(args[0],{snapshot:args[1],snapshot_hash:args[2]});return 1;},
  async $queryRawUnsafe(sql,key){assert.match(sql,/variant_catalog_cache/);return rows.has(key)?[rows.get(key)]:[];}};
 return {store:createVariantJobStore({boundary:{machineTransaction:async(_,work)=>work({tx})}}),writes,rows};
}
const metadata=body=>({schemaVersion:'variant-source-cache/v1',key:'variant-source:v1:'+digest('fixture'),url:'https://api.tcgdex.net/v2/en/cards',body,sha256:digest(body),capturedAt:'2026-10-10T00:00:00.000Z',expiresAt:'2099-10-11T00:00:00.000Z'});

test('durable public metadata above the manual 8KiB string limit retains exact opaque bytes and hash',async()=>{
 const f=fixture(),entry=metadata(JSON.stringify({value:'é\n"\\'.repeat(10000)}));assert(Buffer.byteLength(entry.body)>8192);
 await f.store.cache.put(entry.key,entry);assert.deepEqual(await f.store.cache.get(entry.key),entry);assert.deepEqual(await f.store.cache.getRetained(entry.key,entry.sha256),entry);
 assert.equal(digest(f.writes[0].args[1]),f.writes[0].args[2]);assert.throws(()=>canonical(entry),{code:'MANUAL_OBJECT_REFERENCE_REQUIRED'});
 const small=metadata('{}');await f.store.cache.put('small',small);assert.equal(f.writes[1].args[1],canonical(small),'existing small hashes stay byte-identical');
});
test('public image evidence accepts the exact 4MiB byte cap and rejects one additional decoded byte',async()=>{
 const f=fixture(),bytes=Buffer.alloc(4194304,0x65),entry={...metadata(bytes.toString('base64')),schemaVersion:'variant-provider-image/v1',sha256:digest(bytes),mimeType:'image/jpeg',width:1600,height:1600};
 await f.store.cache.put('image',entry);assert.deepEqual(await f.store.cache.getRetained('image'),entry);
 const tooLarge=Buffer.alloc(4194305,0x65);await assert.rejects(f.store.cache.put('invalid',{...entry,body:tooLarge.toString('base64'),sha256:digest(tooLarge)}),{code:'VARIANT_IMAGE_CACHE_INVALID'});
 await assert.rejects(f.store.cache.put('invalid',{...entry,sha256:digest('foreign bytes')}),{code:'VARIANT_IMAGE_CACHE_INVALID'});assert.equal(f.writes.length,1);
});
test('raw model response remains exact before projection while its actual 1MiB byte cap stays enforced',async()=>{
 const f=fixture(),bodyText=JSON.stringify({output:'x'.repeat(65536),untrusted:'https://example.invalid/?token=opaque-evidence'}),response={httpStatus:200,bodyText,requestEvidence:{requestSha256:digest('request')}};
 assert(await f.store.response({key:'job',claim_id:'claim'},response));const saved=f.writes[0].args[2];assert.deepEqual(JSON.parse(saved),response);assert.equal(digest(saved),f.writes[0].args[3]);
 assert.equal(f.writes[0].args[4],canonical(response.requestEvidence));
 await assert.rejects(f.store.response({},{...response,bodyText:'é'.repeat(524289)}),{code:'VARIANT_EVIDENCE_BODY_TOO_LARGE'});assert.equal(f.writes.length,1);
});
test('large-field exception cannot broaden metadata, binary values, accessors or manual action envelopes',async()=>{
 const f=fixture(),entry=metadata('normal');
 for(const bad of [{...entry,body:'x'.repeat(1048577)},{...entry,extra:'x'.repeat(8193)},{...entry,bytes:'photo'}, {...entry,body:Buffer.from('photo')}, {...entry,toJSON(){return {};}}])await assert.rejects(f.store.cache.put('bad',bad));
 const accessor={...entry};Object.defineProperty(accessor,'body',{enumerable:true,get(){assert.fail('accessor must never run');}});await assert.rejects(f.store.cache.put('bad',accessor),{code:'VARIANT_EVIDENCE_INVALID'});
 let deep={};for(let n=0;n<42;n++)deep={nested:deep};await assert.rejects(f.store.cache.put('bad',{...entry,extra:deep}),{code:'MANUAL_DOCUMENT_TOO_LARGE'});
 assert.equal(f.writes.length,0);assert.throws(()=>canonical({bodyText:'x'.repeat(8193)},{publicAction:true}),{code:'MANUAL_OBJECT_REFERENCE_REQUIRED'});
});
