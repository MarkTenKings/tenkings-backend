import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { createVariantCatalogService } from '../src/variant-catalog.mjs';
import { codexChoices, codexLibraryKey, codexReadingKey, projectCodexReading, variantCodexChoice } from '../src/variant-codex.mjs';
import { VARIANT_LABEL_POLICY, VARIANT_PHOTO_MODEL } from '../src/variant-photo-provider.mjs';
import { labelCatalog } from './variant-label-fixture.mjs';
import { variantIdentity } from './variant-fixture.mjs';
import { prepareVariantListingRequest as prepare, projectVariantListingSource as project,
  createVariantListingProvider as provider, VARIANT_LISTING_LIMITS as limits } from '../src/variant-listing-provider.mjs';
import { importScrydexVariantCandidates, validateVariantCandidate, createVariantReviewSnapshot,
  canonicalJson, isVariantPhotoComparable, scrydexVariantSearchUrl, createManufacturerChecklistVariantProvider } from '@tenkings/card-catalog-evidence';

const sha = v => createHash('sha256').update(v).digest('hex');
const capturedAt = '2026-10-10T10:00:00.000Z', now = () => Date.parse(capturedAt);
const identity = { category: 'POKEMON', name: 'Mewtwo', year: '2016', setName: 'Evolutions',
  cardNumber: '051/108', manufacturer: null, language: null };
const sports = { category: 'SPORTS', name: 'Drake Maye', year: '2025', setName: 'Donruss Optic Football — Donruss Threads',
  cardNumber: 'DT-DM', manufacturer: 'Panini', language: null };
const imageUrl = n => `https://i.ebayimg.com/images/g/fixture${n}/s-l300.jpg`;
const item = (n, title = '2016 Pokemon Evolutions Mewtwo #51/108 Reverse Holo', more = {}) => ({
  itemId: String(123456780000 + n), title, url: `https://www.ebay.com/itm/${123456780000 + n}?nordt=true`,
  thumbnailUrl: imageUrl(n), listingType: 'sold', condition: 'Ungraded', endedAt: '2026-10-09',
  soldPrice: '99.95', soldCurrency: 'USD', bestOfferAccepted: false, ...more });
function source(request, items, more = {}) {
  const bodyText = JSON.stringify({ keyword: request.query, page: 1, totalItems: items.length, hasNextPage: false, items, ...more });
  return { schemaVersion: 'variant-listing-response/v1', requestKey: request.requestKey, url: request.url,
    httpStatus: 200, contentType: 'application/json', bodyText, sha256: sha(bodyText), capturedAt };
}
function cacheFixture() {
  const entries = new Map(); let puts = 0;
  return { entries, get puts() { return puts; }, get: async key => entries.get(key), getRetained: async key => entries.get(key),
    put: async (key, value) => { puts++; entries.set(key, structuredClone(value)); } };
}
const png = () => sharp({ create: { width: 12, height: 16, channels: 3, background: '#125cab' } }).png().toBuffer();
const noNetwork = () => { throw Error('NETWORK_FORBIDDEN'); };
const scrydexChoices = () => importScrydexVariantCandidates({ identity, card: { id: 'xy12-51', name: 'Mewtwo',
  number: '51', printed_number: '51/108', language_code: 'en', expansion: { id: 'xy12', name: 'Evolutions',
    release_date: '2016/11/02', is_online_only: false, printed_total: 108 },
  images: [{ type: 'front', large: 'https://images.scrydex.com/pokemon/xy12-51/large' }],
  variants: ['normal', 'holofoil', 'reverseHolofoil', 'cosmosHolofoil', 'snowflakeStamp'].map(name => ({ name, images: [] })) },
  source: { url: scrydexVariantSearchUrl(identity), sha256: sha('scrydex'), capturedAt } });

test('explicit refresh proceeds when a historical source probe fails, while preserving the partial problem', async () => {
  const catalog = labelCatalog({ photos: 0 }), generation = '1c24bd7a-b4e6-4d79-97f0-b634d830a204', requests = [];
  const service = createVariantCatalogService({ providers: [{ prepare: async () => ({ candidates: catalog.candidates, problems: [], truncated: false }) }],
    listingProvider: { acquireImages: async (_input, { retainedOnly }) => { assert.equal(retainedOnly, false); return { referencePhotos: [] }; } } });
  const snapshot = await service.prepare({ identity: variantIdentity, generation }, { executeListingSource: async (request, _dispatch, { retainedOnly = false } = {}) => {
    if (retainedOnly) throw new Error('Corrupt historical journal'); requests.push(request);
    return { state: 'SAVED', source: { sha256: sha('new response') } };
  } });
  assert.equal(requests.length, 1); assert.equal(requests[0].generation, generation); assert(snapshot.problems.includes('LISTING_SOURCE_UNAVAILABLE'));
});

test('one metadata GET retains exact public source bytes and no bearer; failure body is retained without retry', async () => {
  const request = prepare(identity,null,{graded:true}), expected = source(request, [item(1)]), calls = [];
  const p = provider({ apiKey: 'test-secret-credential', now, fetchImpl: async (url, init) => {
    calls.push({ url, init }); return new Response(expected.bodyText, { status: 200, headers: { 'content-type': 'application/json' } });
  } });
  assert.deepEqual(await p.fetchSource(request), expected); assert.equal(calls.length, 1);
  assert.equal(calls[0].init.redirect, 'error'); assert.equal(calls[0].init.headers.Authorization, 'Bearer test-secret-credential');
  assert.ok(!JSON.stringify(expected).includes('test-secret-credential'));
  let failedCalls = 0;
  const unavailable = provider({ apiKey: 'test-secret-credential', now, fetchImpl: async () => {
    failedCalls++; return new Response('{"message":"quota"}', { status: 429, headers: { 'content-type': 'application/json' } });
  } });
  const retained = await unavailable.fetchSource(request); assert.equal(retained.httpStatus, 429);
  assert.throws(() => project(request, retained), /LIMITED/); assert.equal(failedCalls, 1);
});

test('retained serving survives TTL without credentials, network, writes or decode and rejects forged attribution', async () => {
  const bytes = await png(), request = prepare(identity), cache = cacheFixture();
  const acquired = await provider({ cache, now, fetchImpl: async () => new Response(bytes, { headers: { 'content-type': 'image/png' } }) })
    .acquireImages({ request, source: source(request, [item(1)]) });
  const image = acquired.listings[0].image, puts = cache.puts;
  const reader = provider({ cache, now: () => now() + 2 * limits.ttlMs, fetchImpl: noNetwork, inspectImage: noNetwork });
  assert.equal((await reader.readImage(image)).sha256, sha(bytes)); assert.equal(cache.puts, puts);
  for (const mutated of [{ ...image, sha256: '0'.repeat(64) }, { ...image, sourceResponseSha256: '0'.repeat(64) },
    { ...image, width: 99 }, { ...image, listing: { ...image.listing, title: 'forged' } }, { ...image, relationship: 'exact' }])
    await assert.rejects(reader.readImage(mutated), /VARIANT_LISTING/);
  await assert.rejects(reader.fetchSource(prepare(identity,null,{graded:true})), /CREDENTIAL_MISSING/);
  for (const [key, entry] of cache.entries) if (key.startsWith('variant-listing-image-evidence:')) entry.body = Buffer.from('changed').toString('base64');
  await assert.rejects(reader.readImage(image), /CACHE_INVALID/);
});

test('images use only provider URLs, can fall back to actual thumbnail and never expand a size suffix', async () => {
  const bytes = await png(), request = prepare(identity), cache = cacheFixture(), calls = [];
  const full = 'https://i.ebayimg.com/images/g/actual/s-l1200.jpg';
  const p = provider({ cache, now, fetchImpl: async url => {
    calls.push(url); return url === full ? new Response('unavailable', { status: 404 }) : new Response(bytes, { headers: { 'content-type': 'image/png' } });
  } });
  const result = await p.acquireImages({ request, source: source(request, [item(1, undefined, { fullResThumbnailUrl: full }),
    item(2, undefined, { thumbnailUrl: 'https://attacker.invalid/a.jpg' }),
    item(3, undefined, { thumbnailUrl: 'https://i.ebayimg.com/a.jpg?redirect=private' })]) });
  assert.deepEqual(calls, [full, imageUrl(1)]); assert.equal(result.listings[0].image.url, imageUrl(1));
  assert.equal(result.listings[1].image, null); assert.equal(result.listings[2].image, null);
});

test('bad MIME, failed decode, redirects and oversized images are excluded without a retry storm', async () => {
  const bytes = await png(), request = prepare(identity);
  for (const make of [() => new Response(bytes, { headers: { 'content-type': 'image/jpeg' } }),
    () => new Response('<html>not a photo</html>', { headers: { 'content-type': 'image/png' } }),
    () => new Response(bytes, { headers: { 'content-type': 'image/png', 'content-length': String(limits.imageBytes + 1) } }),
    () => ({ ok: true, redirected: true })]) {
    let calls = 0; const result = await provider({ cache: cacheFixture(), now, fetchImpl: async () => { calls++; return make(); } })
      .acquireImages({ request, source: source(request, [item(1)]) });
    assert.equal(result.listings[0].image, null); assert.equal(calls, 1);
  }
});

test('worker cancellation ends stalled source body without another paid request', async () => {
  const request = prepare(identity,null,{graded:true}); let calls = 0, cancelled = 0;
  const p = provider({ apiKey: 'test-secret-key', timeoutMs: 20, fetchImpl: async () => {
    calls++; return new Response(new ReadableStream({ cancel() { cancelled++; } }), { headers: { 'content-type': 'application/json' } });
  } });
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(new Error('worker cancelled')),20);
  try { await assert.rejects(p.fetchSource(request,{signal:controller.signal})); } finally { clearTimeout(timer); }
  assert.equal(calls, 1); assert.equal(cancelled, 1);
});

test('named requests share a durable public printing key and reject language conflicts or injected fields',()=>{
 const a=prepare(identity,{name:'Reverse Holofoil',language:'English'});
 assert.deepEqual(a,prepare({...identity},{name:' reverse holofoil ',language:'en'}));
 assert.match(a.query,/reverse holo/i);assert.doesNotMatch(a.query,/holofoil/i);assert.doesNotMatch(a.query,/english/i,'English seller titles often omit the language; contradictory languages are rejected from returned evidence');
 assert.notEqual(a.requestKey,prepare(identity,{name:'Holofoil',language:'en'}).requestKey);
 assert.notEqual(a.requestKey,prepare(identity).requestKey);
 assert.throws(()=>prepare({...identity,language:'ja'},{name:'Reverse Holofoil',language:'en'}),/LANGUAGE/);
 assert.throws(()=>prepare(identity,{name:'Reverse Holofoil',language:'en',cardId:'private'}),/PRINTING/);
});
test('a Scrydex exact image does not suppress the durable listing search for its named variant',async()=>{
 const choice=structuredClone(scrydexChoices().find(c=>c.label==='Snowflake Stamp'));
 choice.images[0].relationship='exact';choice.images[0].imageId=`scrydex:variant-image:v1:${sha('synthetic exact image')}`;validateVariantCandidate(choice);let dispatched=0;
 const service=createVariantCatalogService({now,providers:[{prepare:async()=>({candidates:[choice],problems:[],truncated:false})}],
  listingProvider:{fetchSource:async()=>{throw Error('should use journal');}}});
 const result=await service.prepare({identity},{executeListingSource:async request=>{dispatched++;assert.equal(request.printing.name,'snowflake stamp');return{state:'UNKNOWN'};}});
 assert.equal(dispatched,1);assert.equal(result.candidates[0].label,'Snowflake Stamp');assert.ok(result.problems.includes('LISTING_SOURCE_OUTCOME_UNKNOWN'));
});

test('all catalog choices are checkpointed before acquisition; saved photos append without becoming verified choices',async()=>{
 const choices=scrydexChoices(),cache=cacheFixture(),bytes=await png(),requests=[],checkpoints=[];
 const p=provider({cache,now,fetchImpl:async()=>new Response(bytes,{headers:{'content-type':'image/png'}})});
 const service=createVariantCatalogService({providers:[{prepare:async()=>({candidates:choices,problems:[],truncated:false})}],listingProvider:p,now});
 const result=await service.prepare({identity},{onCatalog:async snapshot=>{checkpoints.push(snapshot);},executeListingSource:async(request,_dispatch,{retainedOnly=false}={})=>{
  assert.equal(checkpoints[0].candidates.length,choices.length);assert(checkpoints[0].problems.includes('REFERENCE_ACQUISITION_PENDING'));
  assert.equal(checkpoints[0].referencePhotos?.length??0,0);
  if(retainedOnly)return {state:'MISSING'};requests.push(request);return {state:'SAVED',source:source(request,[item(1,'Mewtwo PSA 9')])};}});
 assert.equal(requests.length,choices.length);assert(requests.every(r=>!r.query.includes('graded')&&!r.query.includes('PSA')));
 assert.equal(result.referencePhotos.length,1);assert.equal(result.candidates.length,choices.length);
 assert(result.candidates.every(c=>c.images.every(i=>i.relationship!=='listing_photo')));
 assert.equal(checkpoints.length,choices.length+1);assert.equal(checkpoints.at(-1).referencePhotos.length,1);
 assert(checkpoints.every(snapshot=>snapshot.problems.includes('REFERENCE_ACQUISITION_PENDING')));
 assert(!result.problems.includes('REFERENCE_ACQUISITION_PENDING'));
});

test('explicit missing-reference refresh has a new durable key without changing the search or historical keys',()=>{
 const printing={name:'Normal',language:'en'},ordinary=prepare(identity,printing,{graded:true});
 const generation='eaf7aeb8-b65a-4737-954a-08003c35d271';
 const refresh=prepare(identity,printing,{graded:true,generation});
 assert.equal(refresh.query,ordinary.query);assert.equal(refresh.url,ordinary.url);
 assert.notEqual(refresh.requestKey,ordinary.requestKey);assert.equal(refresh.generation,generation);
 assert.deepEqual(prepare(identity,printing,{graded:true,generation}),refresh);
 assert.deepEqual(prepare(identity,printing,{graded:true,generation:null}),ordinary);
 assert.equal(project(refresh,source(refresh,[])).listings.length,0);
 assert.throws(()=>project({...refresh,generation:'13febeb4-2b94-4a6e-8e44-a7e6d1f42442'},source(refresh,[])),/REQUEST_CHANGED/);
 assert.deepEqual(prepare(identity,printing,{generation}),refresh);
 assert.throws(()=>prepare(identity,printing,{graded:true,generation:'automatic'}),/REFRESH_GENERATION/);
});

test('explicit refresh retains already-read photos while deduplicating identical bytes',async()=>{
 const generation='eaf7aeb8-b65a-4737-954a-08003c35d271',printing={name:'Normal',language:'en'};
 const request=prepare(identity,printing,{graded:true,generation}),cache=cacheFixture(),known=await png();
 const fresh=await sharp({create:{width:12,height:16,channels:3,background:'#fc4820'}}).png().toBuffer();
 const p=provider({cache,now,fetchImpl:async url=>new Response(url===imageUrl(1)?known:fresh,{headers:{'content-type':'image/png'}})});
 const saved=source(request,[item(1,'Mewtwo PSA 9'),item(2,'Mewtwo PSA 10'),item(3,'Mewtwo CGC 10')]);
 const result=await p.acquireImages({request,source:saved},{imageLimit:2});
 assert.deepEqual(result.referencePhotos.map(p=>p.sha256),[sha(known),sha(fresh)]);assert.equal(result.acquisition.uniqueImages,2);
 const later=provider({cache,now:()=>now()+1000*limits.ttlMs,fetchImpl:noNetwork,inspectImage:noNetwork});
 const reused=await later.acquireImages({request,source:saved},{imageLimit:2});
 assert.deepEqual(reused.referencePhotos,result.referencePhotos);assert.equal(reused.acquisition.requests,0);
});

test('slab pool keeps all returned rows and admits a late photo without seller title, item ID or link',async()=>{
 const request=prepare(identity,{name:'Normal',language:'en'},{graded:true}),cache=cacheFixture(),bytes=await png();
 const rows=Array.from({length:241},()=>({title:null,itemId:null,url:'not a link'}));
 rows[240].thumbnailUrl=imageUrl(240);
 rows[0]={title:'A'.repeat(5001),itemId:'not-a-numeric-id',url:'https://www.ebay.com/itm/123456780999'};
 rows[1]={...rows[0],title:'Different title, same provider ID'};
 const saved=source(request,rows),before=JSON.stringify(saved),projected=project(request,saved);
 assert.equal(projected.listings.length,241);assert.deepEqual(projected.excluded,[]);
 assert.equal(projected.listings[0].listing.title.length,2000);assert.equal(projected.listings[0].listing.id,'not-a-numeric-id');
 assert.deepEqual(projected.listings[240].listing,{id:null,title:null,url:null});
 const p=provider({cache,now,fetchImpl:async()=>new Response(bytes,{headers:{'content-type':'image/png'}})});
 const acquired=await p.acquireImages({request,source:saved});assert.equal(acquired.referencePhotos.length,1);
 const snapshot=createVariantReviewSnapshot({identity,candidates:scrydexChoices(),capturedAt,referencePhotos:acquired.referencePhotos});
 assert.deepEqual(snapshot.referencePhotos[0].listing,{id:null,title:null,url:null});
 assert.equal((await p.readImage(snapshot.referencePhotos[0])).sha256,sha(bytes));assert.equal(JSON.stringify(saved),before);
});

test('slab source ignores the obsolete short search timer but honors worker cancellation',async()=>{
 const request=prepare(identity,{name:'Normal',language:'en'},{graded:true}),controller=new AbortController();
 const p=provider({apiKey:'synthetic-credential',now,timeoutMs:1,fetchImpl:async(_url,options)=>{
  assert.equal(options.signal,controller.signal);await new Promise(resolve=>setTimeout(resolve,12));
  options.signal.throwIfAborted();return new Response(source(request,[]).bodyText,{headers:{'content-type':'application/json'}});
 }});
 assert.equal((await p.fetchSource(request,{signal:controller.signal})).httpStatus,200);
 controller.abort(new Error('worker lease lost'));
 await assert.rejects(p.fetchSource(request,{signal:controller.signal}),/worker lease lost/);
});

test('a complete 240-photo pool survives acquisition and catalog projection beyond former 8/2/96 limits',async()=>{
 const request=prepare(identity,{name:'Normal',language:'en'},{graded:true}),cache=cacheFixture(),base=await png();let calls=0;
 const rows=Array.from({length:240},(_,index)=>item(index));
 const p=provider({cache,now,inspectImage:async()=>({mimeType:'image/png',width:12,height:16}),fetchImpl:async url=>{
  calls++;return new Response(Buffer.concat([base,Buffer.from(url)]),{headers:{'content-type':'image/png'}});
 }});
 const acquired=await p.acquireImages({request,source:source(request,rows)});
 assert.equal(calls,240);assert.equal(acquired.referencePhotos.length,240);
 const snapshot=createVariantReviewSnapshot({identity,candidates:scrydexChoices(),capturedAt,referencePhotos:acquired.referencePhotos});
 assert.equal(snapshot.referencePhotos.length,240);assert.equal(acquired.acquisition.uniqueImages,240);
 const retained=provider({cache,now,fetchImpl:noNetwork,inspectImage:noNetwork});
 assert.equal((await retained.acquireImages({request,source:source(request,rows)})).referencePhotos.length,240);
 assert.equal(calls,240);
});

test('one concise printing query preserves printed numbers, admits raw cards and keeps stamping terms',()=>{
 const reshiram={...identity,name:'Reshiram ex',setName:'Prismatic Evolutions',year:'2025',cardNumber:'030/159'};
 const stamped=prepare(reshiram,{name:'expansion Stamp',language:'en'});
 assert.equal(stamped.query,'reshiram ex 030/159 stamped');
 const pika=prepare({...identity,name:'Pikachu',setName:'Scarlet & Violet—151',year:'2023',cardNumber:'025/165'},{name:'Cosmos Holofoil',language:'en'});
 assert.equal(pika.query,'pikachu 025/165 cosmos holo');
 const ball=prepare({...sports,name:'LaMelo Ball',cardNumber:'BD-13'},{name:'Ball of Duty',language:null});
 assert.equal(ball.query,'lamelo ball bd-13 ball of duty');
 const curry={...sports,name:'Stephen Curry',cardNumber:'135'};
 assert.equal(prepare(curry,{name:'BASE CARDS I',language:null}).query,'stephen curry 135');
 assert.equal(prepare(curry,{name:'BASE CARDS I Gold',language:null}).query,'stephen curry 135 gold');
 assert.equal(prepare({...sports,name:'Nick Kurtz',cardNumber:'93'},{name:'Base Cards Chrome Rookie Red RC Variation',language:null}).query,'nick kurtz 93 red rc');
 for(const r of [stamped,pika,ball]){const u=new URL(r.url);assert.equal(u.searchParams.get('count'),'240');assert.equal(u.searchParams.get('exactMatch'),'true');assert.doesNotMatch(r.query,/graded|psa|cgc|bgs|sgc/i);}
});
test('raw, conflicting, unreadable and multi-card seller claims all remain unassigned source rows',()=>{
 const request=prepare(identity,{name:'Normal',language:'en'}),rows=[item(1),item(2,'Wrong name and card #999/999'),item(3,'Lot of 20 cards'),{thumbnailUrl:imageUrl(4)}];
 const saved=source(request,rows),before=JSON.stringify(saved),result=project(request,saved);
 assert.equal(result.listings.length,4);assert.deepEqual(result.excluded,[]);
 assert(result.listings.every(row=>!Object.hasOwn(row,'candidateId')&&!Object.hasOwn(row,'claimedParallel')));
 assert(result.warnings.includes('LISTING_CLAIMS_UNREVIEWED'));assert.equal(JSON.stringify(saved),before);
 assert.doesNotMatch(JSON.stringify(result),/soldPrice|99\.95/);
});
test('changed source bytes and retired request schemas cannot execute or project',async()=>{
 const request=prepare(identity),saved=source(request,[]);
 assert.throws(()=>project(request,{...saved,sha256:'0'.repeat(64)}),/SOURCE_CHANGED/);
 const p=provider({apiKey:'synthetic-credential',fetchImpl:noNetwork});
 await assert.rejects(p.fetchSource({...request,revision:'graded-reference-photos-v2'}),/REQUEST_CHANGED/);
});


test('retained empty listing results and missing images project separate diagnostics without changing choices',async()=>{
 const catalog=labelCatalog({photos:0});
 for(const [listings,warnings,expected] of [[[],[],'LISTING_NO_RESULTS'],[[{image:null}],['LISTING_IMAGES_INCOMPLETE'],'LISTING_IMAGES_INCOMPLETE']]){
  let dispatches=0;
  const service=createVariantCatalogService({providers:[{prepare:async()=>({candidates:catalog.candidates,problems:[],truncated:false})}],
   now:()=>Date.parse(capturedAt),listingProvider:{acquireImages:async()=>({listings,warnings,referencePhotos:[]})}});
  const snapshot=await service.prepare({identity:variantIdentity,localOnly:true,reuseJobKey:null},
   {executeListingSource:async(_request,_dispatch,{retainedOnly}={})=>{assert.equal(retainedOnly,true);dispatches++;return {state:'REUSED',source:{sha256:sha('saved empty or missing image source')}};}});
  assert(snapshot.problems.includes(expected));assert(!snapshot.problems.includes(expected==='LISTING_NO_RESULTS'?'LISTING_IMAGES_INCOMPLETE':'LISTING_NO_RESULTS'));
  assert.deepEqual(snapshot.candidates,catalog.candidates);assert.deepEqual(snapshot.referencePhotos,[]);assert(dispatches>0);
 }
});
