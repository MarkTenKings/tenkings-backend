import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createVariantJobStore } from '../src/variant-job-store.mjs';
import { createVariantListingProvider, prepareVariantListingRequest, readRetainedListingPhoto,
  readSavedListingPhoto, retainedListingImageBodyKey, VARIANT_LISTING_LIMITS } from '../src/variant-listing-provider.mjs';
import { createVariantReviewSnapshot } from '@tenkings/card-catalog-evidence';
import { prepareVariantLabelRequest } from '../src/variant-photo-provider.mjs';
import { labelCatalog } from './variant-label-fixture.mjs';
import { photoCacheDatabase as database } from './variant-photo-retention-fixture.mjs';

// Authored offline transport/SQL fixture. It emulates transaction-scoped locks
// and the real (key,snapshot_hash) PK; it does not establish PostgreSQL runtime
// qualification or genuine second-physical-submission reuse.
const sha = value => createHash('sha256').update(value).digest('hex');
const capturedAt = '2026-10-14T00:00:00.000Z', now = () => Date.parse(capturedAt);
const identity = {category:'POKEMON',name:'Magikarp',year:'2020',setName:'Rebel Clash',cardNumber:'039/192',manufacturer:null,language:null};
const url = n => `https://i.ebayimg.com/images/g/retention${n}/s-l1600.jpg`;
const photo = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO/a7X8AAAAASUVORK5CYII=','base64');
const metadata = {mimeType:'image/png',width:1,height:1};
const noCalls = () => assert.fail('No real network, provider, decoder or model call is allowed');
function source(request, urls=[url(1),url(2)]) {
  const items=urls.map((image,index)=>({itemId:String(123456789000+index),title:index?'PSA 9 seller claim':'Raw ungraded seller claim',
    url:`https://www.ebay.com/itm/${123456789000+index}`,thumbnailUrl:image}));
  const bodyText=JSON.stringify({keyword:request.query,page:1,totalItems:items.length,hasNextPage:false,items});
  return {schemaVersion:'variant-listing-response/v1',requestKey:request.requestKey,url:request.url,httpStatus:200,
    contentType:'application/json',bodyText,sha256:sha(bodyText),capturedAt};
}
const makeProvider = (f, options={}) => createVariantListingProvider({cache:f.store.cache,now,
  inspectImage:async()=>metadata,fetchImpl:async()=>new Response(photo,{headers:{'content-type':'image/png'}}),...options});

test('two listings and two URLs retain two permanent descriptors, one body and one display/model photo; serialized restart is offline',async()=>{
  const f=database(),request=prepareVariantListingRequest(identity),raw=source(request),before=JSON.stringify(raw);
  // Preserve an opaque source journal alongside a literal unassociated reading.
  f.rows.set('fixture-raw-source',[{snapshot:before,snapshot_hash:sha(before)}]);
  const reading=JSON.stringify({sha256:sha(photo),candidateKey:null,labelText:'RAW\nUnassociated',gradingCompany:null});
  f.rows.set('fixture-unmatched-reading',[{snapshot:reading,snapshot_hash:sha(reading)}]);
  const acquired=await makeProvider(f).acquireImages({request,source:raw});
  const descriptors=f.values().filter(v=>v.schemaVersion==='variant-listing-reference/v1');
  const bodies=f.values().filter(v=>Object.hasOwn(v,'body'));
  assert.equal(descriptors.length,2);assert.equal(bodies.length,1);assert.equal(bodies[0].schemaVersion,'variant-provider-image-body/v1');
  assert.equal(acquired.listings.filter(row=>row.image).length,2);assert.equal(acquired.referencePhotos.length,1);
  assert.equal(acquired.acquisition.uniqueImages,1);assert.equal(acquired.acquisition.bytes,photo.length);
  assert.deepEqual(descriptors.map(d=>d.image.listing.id),['123456789000','123456789001']);
  assert(descriptors.every(d=>d.image.sourceResponseSha256===raw.sha256&&d.image.sha256===sha(photo)));
  assert.equal(JSON.stringify(raw),before);assert.equal(f.rows.get('fixture-raw-source')[0].snapshot,before);
  assert.equal(f.rows.get('fixture-unmatched-reading')[0].snapshot,reading);
  const catalog=createVariantReviewSnapshot({identity,candidates:labelCatalog({photos:0}).candidates,capturedAt,referencePhotos:acquired.referencePhotos});
  assert.equal(prepareVariantLabelRequest(catalog).photos.length,1);
  const restarted=database(f.serialized()),reader=makeProvider(restarted,{now:()=>now()+1000*VARIANT_LISTING_LIMITS.ttlMs,fetchImpl:noCalls,inspectImage:noCalls});
  const replay=await reader.acquireImages({request,source:raw},{retainedOnly:true});
  assert.equal(replay.listings.filter(row=>row.image).length,2);assert.deepEqual(replay.referencePhotos,acquired.referencePhotos);
  for(const descriptor of descriptors){const media=await reader.readImage(descriptor.image);assert(media.bytes.equals(photo));}
  assert.equal(restarted.writes.length,0);
});

test('provenance survives a display limit for already-known identical bytes and distinct source responses',async()=>{
  const f=database(),request=prepareVariantListingRequest(identity),p=makeProvider(f);
  const first=await p.acquireImages({request,source:source(request,[url(1),url(1)])},{imageLimit:1});
  assert.equal(first.referencePhotos.length,1);assert.equal(first.listings.filter(row=>row.image).length,2);
  const changed=source(request,[url(1)]);changed.bodyText=changed.bodyText.replace('Raw ungraded seller claim','Another retained source response');changed.sha256=sha(changed.bodyText);
  await p.acquireImages({request,source:changed});
  assert.equal(f.values().filter(v=>v.schemaVersion==='variant-listing-reference/v1').length,3);
  assert.equal(f.values().filter(v=>v.schemaVersion==='variant-provider-image-body/v1').length,1);
});

test('old v1 inline bodies remain byte-readable after restart with no new body, rewrite or fetch',async()=>{
  const f=database(),entry={schemaVersion:'variant-provider-image/v1',url:url(1),body:photo.toString('base64'),sha256:sha(photo),...metadata,
    capturedAt,expiresAt:new Date(now()+VARIANT_LISTING_LIMITS.ttlMs).toISOString()};
  await f.store.cache.put(`variant-listing-image:v1:${sha(url(1))}`,entry);
  await f.store.cache.put(`variant-listing-image-evidence:v1:${sha(url(1))}:${entry.sha256}`,entry);
  const before=f.serialized(),restarted=database(before);
  assert((await readSavedListingPhoto(url(1),entry.sha256,{cache:restarted.store.cache})).bytes.equals(photo));
  assert((await readRetainedListingPhoto(url(1),{cache:restarted.store.cache,now,fetchImpl:noCalls,inspectImage:noCalls})).bytes.equals(photo));
  assert.equal(restarted.serialized(),before);assert.equal(restarted.writes.length,0);
});

test('a distinct retained SHA beyond the display budget keeps its listing descriptor without another download',async()=>{
  const f=database(),other=Buffer.concat([photo,Buffer.from('authored distinct byte fixture')]);
  for(const [u,bytes] of [[url(1),photo],[url(2),other]])await readRetainedListingPhoto(u,{cache:f.store.cache,now,
    inspectImage:async()=>metadata,fetchImpl:async()=>new Response(bytes,{headers:{'content-type':'image/png'}})});
  const request=prepareVariantListingRequest(identity),p=makeProvider(f,{fetchImpl:noCalls,inspectImage:noCalls});
  const acquired=await p.acquireImages({request,source:source(request)},{imageLimit:1});
  assert.equal(acquired.referencePhotos.length,1);assert.equal(acquired.acquisition.uniqueImages,1);assert.equal(acquired.acquisition.requests,0);
  assert.equal(acquired.listings.filter(row=>row.image).length,2);
  assert.equal(f.values().filter(v=>v.schemaVersion==='variant-listing-reference/v1').length,2);
  assert((await p.readImage(acquired.listings[1].image)).bytes.equals(other));
});

test('new content bodies serialize at the exact 2MiB bound and reject excess bytes, wrong hashes, keys and conflicting metadata',async()=>{
  const f=database(),bytes=Buffer.alloc(VARIANT_LISTING_LIMITS.imageBytes,0x61),entry={schemaVersion:'variant-provider-image-body/v1',body:bytes.toString('base64'),sha256:sha(bytes),...metadata};
  const key=retainedListingImageBodyKey(entry.sha256);await f.store.cache.put(key,entry);
  assert.deepEqual(await database(f.serialized()).store.cache.getRetained(key),entry);
  const tooBig=Buffer.concat([bytes,Buffer.from('x')]);
  for(const [badKey,bad] of [[key,{...entry,body:tooBig.toString('base64'),sha256:sha(tooBig)}],
    [key,{...entry,sha256:'a'.repeat(64)}],['wrong-key',entry],[key,{...entry,body:entry.body+' '}],
    [key,{...entry,extra:'x'.repeat(8193)}]])await assert.rejects(f.store.cache.put(badKey,bad));
  await assert.rejects(f.store.cache.put(key,{...entry,width:2}),{code:'VARIANT_IMAGE_BODY_CONFLICT'});
  assert.equal(f.rows.get(key).length,1);assert.equal(f.writes.length,1);
});

test('missing/corrupt bodies, forged binding metadata and conflicting body versions fail closed without network',async()=>{
  const original=database(),request=prepareVariantListingRequest(identity),result=await makeProvider(original).acquireImages({request,source:source(request,[url(1)])});
  const image=result.listings[0].image,bodyKey=retainedListingImageBodyKey(image.sha256);
  for(const corruption of ['missing','snapshot-hash','body-hash','binding-metadata','two-versions']){
    const f=database(original.serialized());
    if(corruption==='missing')f.rows.delete(bodyKey);
    if(corruption==='snapshot-hash')f.rows.get(bodyKey)[0].snapshot_hash='f'.repeat(64);
    if(corruption==='body-hash'){const record=f.rows.get(bodyKey)[0],body=JSON.parse(record.snapshot);body.body=Buffer.from('bad').toString('base64');record.snapshot=JSON.stringify(body);record.snapshot_hash=sha(record.snapshot);}
    if(corruption==='binding-metadata'){const key=`variant-listing-image-evidence:v1:${sha(image.url)}:${image.sha256}`,record=f.rows.get(key)[0],binding=JSON.parse(record.snapshot);binding.width=2;record.snapshot=JSON.stringify(binding);record.snapshot_hash=sha(record.snapshot);}
    if(corruption==='two-versions')f.rows.get(bodyKey).push({...f.rows.get(bodyKey)[0]});
    await assert.rejects(makeProvider(f,{fetchImpl:noCalls,inspectImage:noCalls}).readImage(image));assert.equal(f.writes.length,0);
  }
});

test('concurrent acquisitions from independent stores and URLs serialize one immutable content body',async()=>{
  const f=database(),other=createVariantJobStore({boundary:f.boundary});let entered=0,release;
  const gate=new Promise(resolve=>{release=resolve;});
  const fetchImpl=async()=>{if(++entered===4)release();await gate;return new Response(photo,{headers:{'content-type':'image/png'}});};
  await Promise.all([url(1),url(1),url(2),url(3)].map((u,index)=>readRetainedListingPhoto(u,{cache:index%2?other.cache:f.store.cache,now:()=>now()+index,fetchImpl,inspectImage:async()=>metadata})));
  const key=retainedListingImageBodyKey(sha(photo));assert.equal(f.rows.get(key).length,1);
  assert.equal(f.values().filter(v=>Object.hasOwn(v,'body')).length,1);
  assert.equal(f.lockNames.filter(v=>v.name===`atlas-listing-source:${key}`).length,4);
  for(const u of [url(1),url(2),url(3)])assert((await readSavedListingPhoto(u,sha(photo),{cache:f.store.cache})).bytes.equals(photo));
});
