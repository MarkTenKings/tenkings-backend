import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicCatalogHandler } from '../src/public-http.mjs';
import { createListing } from '../src/listing.mjs';
import { catalogListings } from '../src/catalog.mjs';
import { makeListingInput,makeTestTx } from './listing-fixtures.mjs';
import { approvedPublicUrl,publicCatalogConfig,publicFilters,renderPublicCatalog } from '../ui/catalog-view.mjs';
import { createPublicCatalogApp } from '../ui/catalog-app.mjs';

const origin='http://127.0.0.1:4318';
function fixture(){const tx=makeTestTx();createListing(tx,makeListingInput());return {tx,page:()=>({environment:'SYNTHETIC_LOCAL',...catalogListings(tx.state)})};}
const request=(url='/marketplace/catalog',extra={})=>({method:'GET',url,headers:{host:'127.0.0.1:4318'},...extra});

test('public catalog is default-off, GET-only, exact-host/path and limited; invalid typed queries never reach the read port',async()=>{
  const f=fixture();let reads=0,admissions=0,lastFilters;
  const options={enabled:true,origin,service:{publicCatalog(filters){reads++;lastFilters=filters;return {environment:'SYNTHETIC_LOCAL',...catalogListings(f.tx.state,filters)};}},admitPublicRequest:async()=>{admissions++;return true;}};
  const handler=createPublicCatalogHandler(options),before=structuredClone(f.tx.state);
  assert.equal((await createPublicCatalogHandler().handle(request())).status,503);
  assert.equal((await createPublicCatalogHandler({...options,admitPublicRequest:undefined}).handle(request())).status,503);
  for(const [req,status] of [[request('/marketplace/catalog',{method:'POST'}),405],[request('/marketplace/catalog',{headers:{host:'elsewhere.invalid'}}),403],[request('/marketplace/catalog',{headers:{host:'127.0.0.1:4318',origin:'https://elsewhere.invalid'}}),403],[request('/marketplace/a/../catalog'),404],[request('/marketplace/catalog?grade=1&grade=2'),400],[request('/marketplace/catalog?autograph=unknown'),400],[request('/marketplace/catalog?grade=9.9.9'),400],[request('/marketplace/catalog?actor=STAFF'),400],[request('/marketplace/catalog',{rawBody:Buffer.from('{}')}),400]])assert.equal((await handler.handle(req)).status,status);
  assert.equal(reads,0);
  const ok=await handler.handle(request('/marketplace/catalog?grade=9&autograph=false&minPriceCents=12000&limit=12'));
  assert.equal(ok.status,200);assert.deepEqual(lastFilters,{grade:9,autograph:false,minPriceCents:12000,limit:12});assert.equal(admissions,1);assert.equal(reads,1);assert.deepEqual(f.tx.state,before);
  assert.equal((await createPublicCatalogHandler({...options,admitPublicRequest:()=>false}).handle(request())).status,429);
  assert.equal((await createPublicCatalogHandler({...options,maxQueryLength:5}).handle(request('/marketplace/catalog?query=too-long'))).status,400);
  handler.close();assert.equal((await handler.handle(request())).status,503);
});

test('public HTTP closes nested card projection and refuses mixed environments or invalid catalog rows',async()=>{
  const f=fixture(),page=f.page();page.privateState={sessions:'private'};page.items[0].sellerId='private seller';page.items[0].approvedCard.privateTitle='private';page.items[0].approvedCard.identity.privateOwner='private';page.items[0].approvedCard.media.front.privateStorage='private';
  const handler=createPublicCatalogHandler({enabled:true,origin,service:{publicCatalog:()=>page},admitPublicRequest:()=>true});
  const response=await handler.handle(request());assert.equal(response.status,200);assert.doesNotMatch(JSON.stringify(response.body),/private|sellerId|connectedAccountId|activeReservationId/);assert.equal(response.body.items[0].approvedCard.reportHash,page.items[0].approvedCard.reportHash);
  page.environment='PRODUCTION';assert.equal((await handler.handle(request())).status,503);page.environment='SYNTHETIC_LOCAL';page.items[0].status='RESERVED';assert.equal((await handler.handle(request())).status,503);
});

test('public view exposes every facet, exact evidence and sign-in handoff without controls or unsafe URLs',()=>{
  const f=fixture(),page=f.page(),config=publicCatalogConfig(),state={status:'ready',page,origin,filters:{query:'"><script>unsafe</script>'},sides:{},previousOffsets:[]};
  page.items[0].approvedCard.identity.name='<img src=x onerror=alert(1)>';
  const html=renderPublicCatalog(state,config);
  for(const key of ['query','category','year','set','grade','minPriceCents','maxPriceCents','numberedDenominator','autograph','relic'])assert.match(html,new RegExp(`name="${key}"`));
  assert.match(html,/LOCAL SYNTHETIC DEMO/);assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);assert.doesNotMatch(html,/<script>|data-action="(?:pay|reserve|simulate|fulfill)"/);assert.match(html,/href="\/account\/marketplace\/\?listingId=demo_listing"/);assert.match(html,/Grade Report/);
  assert.equal(approvedPublicUrl('/demo/front.svg','PRODUCTION',origin),null);assert.equal(approvedPublicUrl('https://evil.invalid/evidence/front','PRODUCTION',origin),null);assert.equal(approvedPublicUrl('/account/private','PRODUCTION',origin),null);assert.equal(approvedPublicUrl('/marketplace/evidence/front','PRODUCTION',origin),'/marketplace/evidence/front');
  assert.equal(approvedPublicUrl('/marketplace/evidence/%2e%2e/private','PRODUCTION',origin),null);
  page.environment='PRODUCTION';assert.match(renderPublicCatalog(state,config),/Approved image unavailable/);assert.doesNotMatch(renderPublicCatalog(state,config),/src="\/demo\//);
  state.failedMedia=['demo_listing:front'];page.environment='SYNTHETIC_LOCAL';assert.match(renderPublicCatalog(state,config),/Approved image unavailable/);
  assert.throws(()=>publicCatalogConfig({customerPath:'//evil.invalid/'}));assert.throws(()=>publicFilters({minPriceCents:'100',maxPriceCents:'99'}));assert.throws(()=>publicFilters({grade:'10.1'}));assert.deepEqual(publicFilters({grade:'9.5',relic:'false'}),{grade:'9.5',relic:'false'});
  assert.deepEqual(publicFilters({minPriceCents:'100.25',maxPriceCents:'250'}),{minPriceCents:'10025',maxPriceCents:'25000'});assert.throws(()=>publicFilters({minPriceCents:'1.001'}));assert.throws(()=>publicFilters({maxPriceCents:'9007199254740992'}));
});

test('public app uses only credential-free GET, shows image failure and error retry, and ignores stale responses',async()=>{
  const f=fixture(),listeners=new Map(),calls=[],root={dataset:{},innerHTML:'',addEventListener(name,fn){listeners.set(name,fn);},removeEventListener(name){listeners.delete(name);},querySelector(){return {focus(){}};}};
  let fail=true;
  const app=createPublicCatalogApp({root,origin,fetchImpl:async(url,options)=>{calls.push({url,options});return {ok:!fail,json:async()=>f.page()};}});
  await app.ready;assert.match(root.innerHTML,/Retry catalog/);fail=false;
  await listeners.get('click')({target:{closest:()=>({dataset:{action:'retry'}})}});
  assert.match(root.innerHTML,/ATLAS Synthetic Specimen/);assert.equal(calls.length,2);
  for(const call of calls){assert.equal(call.options.method,'GET');assert.equal(call.options.credentials,'omit');assert.equal(call.options.body,undefined);}
  listeners.get('error')({target:{tagName:'IMG',dataset:{listing:'demo_listing',side:'front'}}});assert.match(root.innerHTML,/Approved image unavailable/);app.close();assert.equal(listeners.size,0);
  const pending=[],lateRoot={...root,dataset:{},addEventListener(){},removeEventListener(){}};
  const race=createPublicCatalogApp({root:lateRoot,origin,fetchImpl:()=>new Promise(resolve=>pending.push(resolve))});
  const latest=race.reload(),newPage=f.page();newPage.items[0].approvedCard.identity.name='Current catalog';pending[1]({ok:true,json:async()=>newPage});await latest;
  pending[0]({ok:true,json:async()=>f.page()});await race.ready;assert.match(lateRoot.innerHTML,/Current catalog/);assert.doesNotMatch(lateRoot.innerHTML,/ATLAS Synthetic Specimen/);race.close();
});
