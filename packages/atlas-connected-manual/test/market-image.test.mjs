import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { digest } from '@atlas/manual-service/contract';
import { createConnectedHandler } from '../src/http.mjs';
import { createPresentationMarketService } from '../src/presentation-market-service.mjs';
import { marketPreviewHash } from '../src/presentation-market.mjs';

test('market image serves only the exact retained image authorized by a saved preview', async () => {
  const cardId=randomUUID(), previewId=randomUUID(), bytes=Buffer.from('retained-photo'), sha=digest(bytes), staff={id:randomUUID()};
  const preview={version:'atlas-market-preview-v2',candidates:[{slabReading:{sha256:sha,imageUrl:'https://i.ebayimg.com/photo.jpg'}}]};
  let reads=0;
  const service=createPresentationMarketService({repository:{async market(actor,card,id){assert.equal(actor,staff);assert.equal(card,cardId);assert.equal(id,previewId);
    return {state:'READY',input:{approvalActionId:randomUUID()},saved:{state:'READY',ref:{kind:'MARKET_PREVIEW'},artifactHash:digest(JSON.stringify(preview)),sourceHash:marketPreviewHash(preview)}};}},
    artifacts:{async read(){return preview;}},readPhoto:async(url,hash)=>{reads++;assert.equal(url,preview.candidates[0].slabReading.imageUrl);assert.equal(hash,sha);return {bytes,mimeType:'image/jpeg'};}});
  assert.deepEqual(await service.image(staff,cardId,previewId,sha),{bytes,contentType:'image/jpeg'});
  await assert.rejects(service.image(staff,cardId,previewId,'a'.repeat(64)),{code:'MARKET_IMAGE_NOT_FOUND'});
  assert.equal(reads,1);
});

test('market image uses the existing authenticated GET path without starting a search', async () => {
  const cardId=randomUUID(), previewId=randomUUID(), sha='a'.repeat(64), actor={id:randomUUID()}, calls=[];
  const handler=createConnectedHandler({origin:'https://atlasgrading.com',assertRequest:async()=>calls.push('gateway'),
    boundary:{authenticate:async(cookie)=>{assert.equal(cookie,'staff');calls.push('auth');return actor;}},
    connected:{workflow:{},intake:{},market:{async image(staff,card,preview,hash){assert.equal(staff,actor);assert.deepEqual([card,preview,hash],[cardId,previewId,sha]);calls.push('saved-image');return{bytes:Buffer.from('photo'),contentType:'image/jpeg'};}}}});
  const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(v){this.code=v;return this;},send(v){this.body=v;},json(v){this.body=v;}};
  await handler({method:'GET',url:`/api/staff/manual-connected/cards/${cardId}/presentation/market?preview=${previewId}&image=${sha}`,headers:{cookie:'staff'}},res);
  assert.equal(res.code,200);assert.deepEqual(calls,['gateway','auth','saved-image']);assert.equal(res.headers['Content-Type'],'image/jpeg');
  assert.equal(res.headers['Cache-Control'],'private, no-store');assert.equal(res.body.toString(),'photo');
});


test('market image rechecks card access after the retained photo read', async () => {
  const cardId=randomUUID(), previewId=randomUUID(), bytes=Buffer.from('saved'), sha=digest(bytes);
  const preview={version:'atlas-market-preview-v2',candidates:[{slabReading:{sha256:sha,imageUrl:'https://i.ebayimg.com/photo.jpg'}}]};
  let allowed=true;
  const service=createPresentationMarketService({repository:{async market(){
    if(!allowed) throw Object.assign(new Error('STAFF_ACCESS_REVOKED'),{code:'STAFF_ACCESS_REVOKED'});
    return {state:'READY',input:{approvalActionId:randomUUID()},saved:{state:'READY',ref:{kind:'MARKET_PREVIEW'},artifactHash:digest(JSON.stringify(preview)),sourceHash:marketPreviewHash(preview)}};
  }},artifacts:{async read(){return preview;}},readPhoto:async()=>{allowed=false;return{bytes,mimeType:'image/jpeg'};}});
  await assert.rejects(service.image({},cardId,previewId,sha),{code:'STAFF_ACCESS_REVOKED'});
});
