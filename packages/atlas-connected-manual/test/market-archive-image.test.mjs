import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical, digest, requireThat } from '@atlas/manual-service/contract';
import { createMarketArchiveSearchCapability } from '../src/market-archive-search.mjs';
import { createPresentationMarketService } from '../src/presentation-market-service.mjs';
import { marketPreviewHash } from '../src/presentation-market.mjs';
import { createConnectedHandler } from '../src/http.mjs';
import { manualResponsePolicy, MANUAL_TRANSPORT_LIMITS } from '../src/transport.mjs';
const cardId='11111111-1111-4111-8111-111111111111', previewId='22222222-2222-4222-8222-222222222222',
  actionId='33333333-3333-4333-8333-333333333333', actorId='44444444-4444-4444-8444-444444444444';
const imageUrl='https://i.ebayimg.com/images/g/synthetic/s-l1600.jpg';
const path=sha=>`/api/staff/manual-connected/cards/${cardId}/presentation/market/archive-image?preview=${previewId}&image=${sha}`;
function fixture({acl='readers',enabled=true}={}) {
  const bytes=Buffer.from('synthetic retained photo'),sha=digest(bytes),staff=Object.freeze({}),
    actor={id:actorId,accessVersion:3,role:'REVIEWER',mode:'PRODUCTION',actorKind:'HUMAN'}, principal=structuredClone(actor);
  const card={id:cardId,owner_id:actionId,approvers:[],editors:[],readers:[]};card[acl].push(actor.id);
  const publication={card_id:cardId,action_id:actionId,state:'PUBLISHED',mode:'PRODUCTION',source_revision:1,
    source_hash:'a'.repeat(64),report_hash:'b'.repeat(64),public_token:'ar_synthetic',version:1,public_hash:'c'.repeat(64),manifest_hash:'d'.repeat(64)};
  const preview={version:'atlas-market-preview-v2',responsePolicy:'ATLAS_SLAB_V1',candidates:[{slabReading:{sha256:sha,imageUrl}}]};
  const input={requestId:previewId,approvalActionId:actionId,expectedRevision:0};
  const saved={state:'READY',ref:{kind:'MARKET_PREVIEW',key:'synthetic'},artifactHash:digest(JSON.stringify(preview)),sourceHash:marketPreviewHash(preview)};
  const row={card_id:cardId,request_id:previewId,approval_action_id:actionId,state:'READY',request:canonical(input),request_hash:digest(canonical(input)),result:canonical(saved),result_hash:digest(canonical(saved))};
  const state={active:true,photo:null,onPhoto:null,onArtifact:null},counts={photo:0,artifact:0,legacy:0,writes:0,provider:0};
  const tx={async $queryRawUnsafe(sql,...args) {
    if(sql.includes('market-archive:card'))return args[0]===cardId?[structuredClone(card)]:[];
    if(sql.includes('market-archive:active'))return state.active?[{id:cardId}]:[];
    if(sql.includes('market-archive:publication'))return[structuredClone(publication)];
    if(sql.includes('market-archive:market'))return args[0]===cardId&&args[1]===previewId?[structuredClone(row)]:[];
    assert.fail('Unexpected query');
  },$executeRawUnsafe(){counts.writes++;assert.fail('No write');}};
  const boundary={async transaction(handle,work){assert.equal(handle,staff);return work({tx,principal:structuredClone(principal),async refresh(){return{principal:structuredClone(actor)};}});},
    machineTransaction(){assert.fail('No worker authority');}};
  const artifacts={async read(ref,binding){counts.artifact++;assert.deepEqual(ref,saved.ref);assert.deepEqual(binding,{cardId,kind:'MARKET_PREVIEW',sourceHash:saved.artifactHash});state.onArtifact?.();return structuredClone(preview);}};
  const validateAccess=async()=>requireThat(state.active,410,'INTAKE_CARD_DELETED');
  const capability=createMarketArchiveSearchCapability({boundary,artifacts,validateAccess});
  const service=createPresentationMarketService({archiveSearch:enabled?capability:null,jobs:enabled?{archiveSearch:capability}:null,artifacts,
    repository:{market(){counts.legacy++;throw Object.assign(new Error('legacy access'),{code:'LEGACY_OWNER_ONLY'});}},
    approved:{loadPacket(){assert.fail('No publication loader');}},provider(){counts.provider++;assert.fail('No provider');},
    async readPhoto(url,hash){counts.photo++;assert.equal(url,imageUrl);assert.equal(hash,sha);state.onPhoto?.();return state.photo??{bytes,mimeType:'image/jpeg'};}});
  return {service,staff,actor,card,publication,preview,row,saved,state,counts,bytes,sha,read:()=>service.archiveImage(staff,cardId,previewId,sha)};
}

test('archive reader/editor reads only exact saved slab photo without legacy, worker, write or provider authority',async()=>{
  for(const acl of ['readers','editors']){
    const f=fixture({acl});assert.deepEqual(await f.read(),{bytes:f.bytes,contentType:'image/jpeg'});
    assert.deepEqual(f.counts,{photo:1,artifact:1,legacy:0,writes:0,provider:0});
    await assert.rejects(f.service.image(f.staff,cardId,previewId,f.sha),{code:'LEGACY_OWNER_ONLY'});
  }
  const disabled=fixture({enabled:false});await assert.rejects(disabled.read(),{code:'MARKET_ARCHIVE_CONFIGURATION_REQUIRED'});
  assert.equal(disabled.counts.photo,0);
});

test('archive photo rechecks identity, current approval, ACL and active intake after reading',async()=>{
  for(const change of [f=>{f.card.readers=[];},f=>{f.actor.accessVersion++;},f=>{f.actor.role='OPERATOR';},
    f=>{f.actor.mode='DEMO';},f=>{f.state.active=false;},f=>{f.publication.state='PUBLISHING';},
    f=>{f.publication.action_id=actorId;},f=>{f.publication.source_hash='e'.repeat(64);},
    f=>{f.publication.report_hash='e'.repeat(64);},f=>{f.publication.public_hash='e'.repeat(64);},f=>{f.publication.version++;}]) {
    const f=fixture();f.state.onPhoto=()=>change(f);await assert.rejects(f.read());assert.equal(f.counts.photo,1);
  }
  const f=fixture();f.state.onArtifact=()=>{f.card.readers=[];};await assert.rejects(f.read());assert.equal(f.counts.photo,0);
});

test('saved preview membership, artifact/source hashes, exact final ref and photo digest remain authoritative',async()=>{
  const missing=fixture();await assert.rejects(missing.service.archiveImage(missing.staff,cardId,previewId,'e'.repeat(64)),{code:'MARKET_IMAGE_NOT_FOUND'});assert.equal(missing.counts.photo,0);
  const wrong=fixture();await assert.rejects(wrong.service.archiveImage(wrong.staff,actorId,previewId,wrong.sha));assert.equal(wrong.counts.photo,0);
  const artifact=fixture();artifact.preview.candidates=[];await assert.rejects(artifact.read(),{code:'MARKET_PREVIEW_CORRUPT'});assert.equal(artifact.counts.photo,0);
  const source=fixture();const changed={...source.saved,sourceHash:'e'.repeat(64)};source.row.result=canonical(changed);source.row.result_hash=digest(source.row.result);
  await assert.rejects(source.read(),{code:'MARKET_PREVIEW_CORRUPT'});assert.equal(source.counts.photo,0);
  const stale=fixture();stale.state.onPhoto=()=>{stale.row.result=canonical({...stale.saved,ref:{...stale.saved.ref,key:'changed'}});stale.row.result_hash=digest(stale.row.result);};
  await assert.rejects(stale.read(),{code:'MARKET_PREVIEW_STALE'});
  for(const photo of [{bytes:Buffer.from('different'),mimeType:'image/jpeg'},{bytes:Buffer.from('synthetic retained photo'),mimeType:'image/svg+xml'},
    {bytes:Buffer.alloc(4*1024*1024+1),mimeType:'image/png'}]){
    const f=fixture();f.state.photo=photo;await assert.rejects(f.read(),{code:'MARKET_IMAGE_CORRUPT'});
  }
});

const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(v){this.code=v;return this;},send(v){this.body=v;},json(v){this.body=v;}});
test('separate authenticated GET route accepts only exact UUID/digest query and cannot search/select',async()=>{
  const f=fixture(),calls=[];
  const handler=createConnectedHandler({origin:'https://atlasgrading.com',assertRequest:async()=>calls.push('gateway'),
    boundary:{async authenticate(cookie){assert.equal(cookie,'synthetic');calls.push('auth');return f.staff;}},
    connected:{workflow:{},intake:{},market:{async archiveImage(...args){calls.push('archive');return f.service.archiveImage(...args);},
      image(){assert.fail('legacy route');},preview(){assert.fail('search');},select(){assert.fail('select');}}}});
  const good=path(f.sha),alternate=good.replace(`preview=${previewId}&image=${f.sha}`,`image=${f.sha}&preview=${previewId}`);
  for(const url of [good,alternate]){const res=response();await handler({method:'GET',url,headers:{cookie:'synthetic'}},res);assert.equal(res.code,200);assert.deepEqual(res.body,f.bytes);assert.equal(res.headers['Cache-Control'],'private, no-store');assert.equal(res.headers['Content-Type'],'image/jpeg');assert.equal(res.headers['X-Content-Type-Options'],'nosniff');}
  assert.deepEqual(calls,['gateway','auth','archive','gateway','auth','archive']);
  for(const [method,url] of [['POST',good],['GET',good+'&preview='+previewId],['GET',good+'&extra=1'],['GET',good.replace(previewId,'invalid')],
    ['GET',good.replace(f.sha,f.sha.toUpperCase())],['GET',good.replace('preview=','preview=%31')],['GET',good.split('?')[0]]]){
    const res=response();await handler({method,url,headers:{cookie:'synthetic'}},res);assert.equal(res.code,405);assert.equal(res.body.error,'METHOD_NOT_ALLOWED');
  }
  for(const extra of [{body:{extra:true}},{body:'unexpected'},{body:Buffer.from('unexpected')},{rawBody:Buffer.from('unexpected')},
    {headers:{cookie:'synthetic','content-length':'1'}},{headers:{cookie:'synthetic','transfer-encoding':'chunked'}},{readableLength:1}]){
    const res=response();await handler({method:'GET',url:good,headers:{cookie:'synthetic'},...extra},res);
    assert.equal(res.code,400);assert.equal(res.body.error,'MANUAL_REQUEST_INVALID');
  }
  assert.equal(f.counts.photo,2);
});

test('proxy raster allowlist admits the separate archive path and rejects malformed/MIME variants',()=>{
  const good=path('a'.repeat(64));
  for(const mime of ['image/jpeg','image/png','image/webp'])assert.equal(manualResponsePolicy(good,mime).limit,MANUAL_TRANSPORT_LIMITS.imageResponseBytes);
  for(const bad of [good+'&extra=1',good+'&preview='+previewId,good.replace(previewId,'invalid'),good.split('?')[0],good.replace('/archive-image?','/archive-image/other?')])assert.throws(()=>manualResponsePolicy(bad,'image/jpeg'),{code:'MANUAL_SERVICE_RESPONSE_INVALID'});
  assert.throws(()=>manualResponsePolicy(good,'image/svg+xml'),{code:'MANUAL_SERVICE_RESPONSE_INVALID'});
});
