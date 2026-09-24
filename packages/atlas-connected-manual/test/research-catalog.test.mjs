import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublishedCatalogReader,prepareObservationProposal} from '@tenkings/card-catalog-evidence';
import {createAtlasCatalogClient,CATALOG_SERVICE_VERSION} from '../src/research-catalog.mjs';
import {fixture,hostFixture,queryFor,observationFixture,sha} from '../../card-catalog-evidence/tests/fixtures.mjs';
const token='s'.repeat(43),envelope=value=>Response.json({schemaVersion:CATALOG_SERVICE_VERSION,...value});
async function host(){const manifest=fixture(),bytes=Buffer.from('synthetic reviewed reference bytes');manifest.images[0].sha256=sha(bytes);const stored=hostFixture(manifest),reader=createPublishedCatalogReader({loadAuthorizedPublication:async()=>stored.loaded});let current=true,badImage=false;const calls=[];
 const fetchImpl=async(url,init)=>{calls.push({url,init});assert.equal(init.redirect,'error');assert.equal(init.headers.Authorization,`Bearer ${token}`);const request=JSON.parse(init.body);
  if(url.endsWith('/discover'))return envelope({publications:current?[stored.pin]:[]});
  if(url.endsWith('/lookup'))return envelope({result:await reader.lookup(request)});
  if(url.endsWith('/media'))return new Response(badImage?Buffer.from('changed'):bytes,{headers:{'content-type':'image/jpeg','x-catalog-image-sha256':manifest.images[0].sha256,'x-catalog-image-width':'1600','x-catalog-image-height':'2200'}});
  throw new Error('unexpected synthetic endpoint');};
 return {manifest,stored,calls,bytes,query:queryFor(manifest),client:createAtlasCatalogClient({token,fetchImpl}),revoke(){current=false},alterImage(){badImage=true}};}
test('ATLAS catalog facade pins host-reviewed source and media, rechecks currentness, and never exposes media storage',async()=>{
 const f=await host(),pins=await f.client.findCurrentSetCatalogPublications({query:f.query});assert.deepEqual(pins,[f.stored.pin]);
 await assert.rejects(f.client.readPublishedSetCatalogImage({publication:pins[0],imageId:f.manifest.images[0].imageId}),{code:'RESEARCH_CATALOG_IMAGE_UNBOUND'});
 const result=await f.client.lookupPublishedSetCatalogEvidence({publication:pins[0],query:f.query});assert.equal(result.authority,'host_authorized_setops_publication');assert(!JSON.stringify(result).includes('fixture:private:'));
 const image=await f.client.readPublishedSetCatalogImage({publication:pins[0],imageId:f.manifest.images[0].imageId});assert.deepEqual(image.bytes,f.bytes);
 assert.equal(await f.client.currentFor(pins[0],'SPORTS'),true);f.revoke();assert.equal(await f.client.currentFor(pins[0],'SPORTS'),false);
 f.alterImage();await assert.rejects(f.client.readPublishedSetCatalogImage({publication:pins[0],imageId:f.manifest.images[0].imageId}),{code:'RESEARCH_CATALOG_IMAGE_CHANGED'});
 assert(f.calls.every(c=>c.url.startsWith('https://collect.tenkings.co/api/internal/card-catalog/v1/')));
});
test('catalog discovery rejects mixed or duplicate publication claims instead of inventing current authority',async()=>{
 const f=await host(),bad=createAtlasCatalogClient({token,fetchImpl:async()=>envelope({publications:[f.stored.pin,f.stored.pin]})});
 await assert.rejects(bad.findCurrentSetCatalogPublications({query:f.query}),{code:'RESEARCH_CATALOG_INVALID'});
 await assert.rejects(bad.currentFor(f.stored.pin,'SPORTS'),{code:'RESEARCH_CATALOG_INVALID'});
});
test('only exact atlas metadata proposals can produce an unreviewed host receipt',async()=>{
 const proposal={...observationFixture('atlas'),images:[]},prepared=prepareObservationProposal(proposal);let count=0;
 const client=createAtlasCatalogClient({token,fetchImpl:async(_url,init)=>{count++;const sent=JSON.parse(init.body);assert.equal(sent.observation.evidenceSha256,prepared.proposalSha256);return envelope({disposition:'requires_authorized_review',receipt:{proposalId:'synthetic',proposalSha256:prepared.proposalSha256,idempotencyKey:prepared.idempotencyKey,outcome:'replay'}});}});
 assert.equal((await client.submit(proposal)).state,'RECORDED');await assert.rejects(client.submit(observationFixture('atlas')),{code:'RESEARCH_PROPOSAL_INVALID'});assert.equal(count,1);
 const wrong=createAtlasCatalogClient({token,fetchImpl:async()=>envelope({disposition:'published',receipt:{proposalId:'synthetic',proposalSha256:prepared.proposalSha256,idempotencyKey:prepared.idempotencyKey,outcome:'recorded'}})});
 await assert.rejects(wrong.submit(proposal),{code:'RESEARCH_PROPOSAL_RECEIPT_INVALID'});
});
