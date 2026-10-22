import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarketplaceHttpHandler } from '../src/http.mjs';
import { openLocalStore } from '../src/store.mjs';
import { createLocalFixture, actors } from '../scripts/local-fixture.mjs';
import { marketplaceOperations, projectMarketplaceWorkspace, staffQueueCsv } from '../src/projections.mjs';
import { makeSyntheticEligibility } from './listing-fixtures.mjs';
import { createMarketplacePilot } from '../src/service.mjs';

const origin='https://marketplace.example.test', token='t'.repeat(64);
function boundary(service) {
  const state={actor:actors.buyer,authenticated:true,expiresAt:Date.now()+100000,admit:true};
  const handler=createMarketplaceHttpHandler({enabled:true,origin,service,resolveSession:async()=>({...state,sessionId:'session_1'}),verifyCsrf:async({token:value})=>value===token,issueCsrf:async()=>token,admitRequest:async()=>state.admit});
  const request=(path,body,headers={})=>handler.handle({method:body===undefined?'GET':'POST',url:'/api/marketplace'+path,headers:{host:new URL(origin).host,origin,'content-type':'application/json','x-atlas-csrf':token,...headers},rawBody:body===undefined?Buffer.alloc(0):Buffer.from(JSON.stringify(body))});
  return {state,handler,request};
}
test('authenticated HTTP refuses absent/expired sessions, cross-site requests, CSRF, role/body escalation and untyped filters',async()=>{
  let called=0;
  const {state,handler,request}=boundary({workspace:async()=>({schema:'atlas-marketplace-workspace-v1'}),publishListing:async()=>{called++;},catalog:async(_,filters)=>filters});
  assert.equal((await createMarketplaceHttpHandler().handle({})).status,503);
  state.authenticated=false; assert.equal((await request('/workspace')).status,401); state.authenticated=true;
  state.expiresAt=0; assert.equal((await request('/workspace')).status,401); state.expiresAt=Date.now()+100000;
  assert.equal((await request('/workspace',undefined,{host:'other.test'})).status,403);
  assert.equal((await request('/workspace',undefined,{'sec-fetch-site':'cross-site'})).status,403);
  assert.equal((await request('/listings',{requestId:'demo_a'})).status,403);
  state.actor=actors.seller;
  assert.equal((await request('/listings',{requestId:'demo_a'},{'x-atlas-csrf':'bad'})).status,403);
  assert.equal((await request('/listings',{requestId:'demo_a',actor:{id:'admin',role:'STAFF'}})).status,409);
  assert.equal(called,0);
  const bootstrap=await request('/workspace'); assert.equal(bootstrap.body.csrfToken,token); assert.equal(bootstrap.headers['Cache-Control'],'no-store');
  assert.equal((await request('/catalog?autograph=false&grade=9.5')).body.autograph,false);
  assert.equal((await request('/catalog?autograph=maybe')).status,409);
  assert.equal((await request('/catalog?limit=1&limit=2')).status,409);
  state.admit=false; assert.equal((await request('/workspace')).status,429);
  handler.close(); assert.equal((await request('/workspace')).status,503);
});

test('buyer workspace includes only their retained checkout and conceals seller finance, private evidence and other buyers',async()=>{
  const store=openLocalStore({filename:':memory:',environment:'SYNTHETIC_LOCAL'});
  try {
    const {service}=createLocalFixture({store,assets:false}),{state,request}=boundary(service);
    await service.recordConsent(actors.seller,{requestId:'demo_consent',cardId:'demo_card',choice:'HOLD_AND_LIST',evidenceRef:'demo_hold_consent'});
    const listing=await service.publishListing(actors.seller,{requestId:'demo_listing',cardId:'demo_card',askingPriceCents:12500});
    const quote=await service.quote(actors.buyer,listing.id);
    const reservation=await service.reserve(actors.buyer,{requestId:'demo_reservation',listingId:listing.id,listingVersion:listing.version,listingHash:listing.bindingHash,quoteId:quote.quoteId});
    await service.pay(actors.buyer,{reservationId:reservation.id});
    const response=await request('/workspace'); assert.equal(response.status,200);
    const visible=response.body; assert.equal(visible.reservations.length,1); assert.equal(visible.listings.length,1);
    assert.equal(visible.listings[0].sellerNetCents,undefined); assert.equal(visible.listings[0].policy,undefined);
    assert.equal(visible.balance,null); assert.equal(visible.sellerEligibility,null); assert.equal(visible.intents[0].objectId,undefined);
    assert.equal(visible.intents[0].policy,undefined); assert.deepEqual(visible.consent,{});
    state.actor=actors.alternateBuyer; const other=(await request('/workspace')).body;
    for(const key of ['reservations','listings','orders','intents']) assert.deepEqual(other[key],[]);
    assert.equal((await request('/payments',{reservationId:reservation.id})).body.error,'RESERVATION_NOT_FOUND');
    state.actor=actors.seller; const seller=(await request('/workspace')).body;
    assert.equal(seller.scope.actorId,actors.seller.id); assert.equal(seller.balance.currency,'USD');
    assert.equal(seller.sellerEligibility.bank.externalAccountId,'demo_bank');
  } finally {store.close();}
});

test('public command receipts exclude provider internals; payment secret reaches only its buyer collection route',async()=>{
  const {state,request}=boundary({withdraw:async()=>({id:'payout',status:'PENDING',objectId:'po_private',raw:{client_secret:'never'}}),paymentCollection:async()=>({clientSecret:'test_only_ephemeral',reservationId:'r'})});
  state.actor=actors.seller;
  const payout=await request('/withdrawals',{requestId:'r',amountCents:100,externalAccountId:'ba_1'});
  assert.deepEqual(payout.body,{id:'payout',status:'PENDING'});
  assert.equal((await request('/payments/collection',{reservationId:'r'})).status,403);
  state.actor=actors.buyer; assert.equal((await request('/payments/collection',{reservationId:'r'})).body.clientSecret,'test_only_ephemeral');
});

test('provider outage keeps saved seller work visible without asserting bank readiness or enabling payout',async()=>{
  const store=openLocalStore({filename:':memory:',environment:'SYNTHETIC_LOCAL'});
  try {
    const fixture=createLocalFixture({store,assets:false});
    await fixture.service.recordConsent(actors.seller,{requestId:'demo_consent',cardId:'demo_card',choice:'HOLD_AND_LIST',evidenceRef:'demo_hold_consent'});
    const listing=await fixture.service.publishListing(actors.seller,{requestId:'demo_listing',cardId:'demo_card',askingPriceCents:12500});
    const service=createMarketplacePilot({...fixture,store,enabled:true,environment:'SYNTHETIC_LOCAL',platformAccountId:'demo_platform',provider:{...fixture.provider,getAccount:async()=>{throw new Error('provider unavailable');}}});
    const result=await service.workspace(actors.seller);
    assert.equal(result.listings[0].id,listing.id);
    assert.equal(result.sellerEligibility.status,'UNAVAILABLE');
    assert.equal(result.sellerEligibility.bank.status,'UNAVAILABLE');
    assert.deepEqual(result.sellerEligibility.banks,[]);
    assert.equal(result.sellerEligibility.payoutsEnabled,false);
    assert.equal(result.balance.availableCents,0);
    assert.equal(Object.keys(store.read().intents).length,0);
  } finally {store.close();}
});

test('metrics exclude all sandbox events and staff CSV neutralizes formula fields',()=>{
  const state={events:[{at:1,type:'SALE_CONFIRMED',environment:'SYNTHETIC_LOCAL'},{at:2,type:'SALE_CONFIRMED',environment:'PROVIDER_SANDBOX'},{at:3,type:'LISTING_CREATED',environment:'PRODUCTION'}]};
  const metrics=marketplaceOperations(state); assert.equal(metrics.salesCount,0); assert.equal(metrics.listingCount,1); assert.equal(metrics.syntheticExcluded,2); assert.equal(metrics.contributionProfit,null);
  const csv=staffQueueCsv({items:[{name:'=HYPERLINK("https://bad.test")',orderId:'ok'}]});
  assert.ok(csv.includes("'="));
  assert.throws(()=>projectMarketplaceWorkspace({}, {role:'GUEST'}),{code:'FORBIDDEN'});
});

test('R1-scoped mount retains the original request and requires a fresh opaque authorization before dispatch',async()=>{
  const events=[], principal={authenticated:true,expiresAt:Date.now()+60000,sessionId:'r1_session',actor:actors.buyer};
  let revoked=false;
  const handler=createMarketplaceHttpHandler({enabled:true,origin,apiPath:'/account/marketplace/api',service:{workspace:async actor=>{events.push('service');assert.equal(actor,actors.buyer);return {schema:'atlas-marketplace-workspace-v1'};}},
    createAuthContext:async request=>{
      assert.equal(request.url,'/account/marketplace/api/workspace');assert.equal(request.headers.cookie,'existing_scoped_cookie');
      return {resolveSession:async()=>principal,verifyCsrf:async()=>true,issueCsrf:async()=>token,admitRequest:async()=>true,
        withAuthorized:async(p,work)=>{assert.equal(p,principal);events.push('revalidate');if(revoked) throw Object.assign(new Error(),{code:'SIGN_IN_REQUIRED'});return work(p.actor);},close:()=>events.push('close')};
    }});
  const request={method:'GET',url:'/account/marketplace/api/workspace',headers:{host:new URL(origin).host,cookie:'existing_scoped_cookie'},rawBody:Buffer.alloc(0)};
  assert.equal((await handler.handle(request)).status,200);assert.deepEqual(events,['revalidate','service','close']);
  revoked=true;events.length=0;assert.equal((await handler.handle(request)).status,401);assert.deepEqual(events,['revalidate','close']);
  assert.equal((await handler.handle({...request,url:'/api/marketplace/workspace'})).status,404);
});

test('POST CSRF is verified before entering the opaque R1 dispatch boundary',async()=>{
  let checked=false,calls=0,closed=0;
  const principal={authenticated:true,expiresAt:Date.now()+60000,sessionId:'r1_session',actor:actors.buyer};
  const handler=createMarketplaceHttpHandler({enabled:true,origin,service:{pay:async()=>{calls++;return {status:'PENDING'};}},createAuthContext:()=>({resolveSession:async()=>principal,admitRequest:async()=>true,verifyCsrf:async({token:value})=>{checked=value===token;return checked;},withAuthorized:async(p,work)=>{assert.equal(checked,true);assert.equal(p,principal);return work(p.actor);},close:()=>{closed++;}})});
  const request={method:'POST',url:'/api/marketplace/payments',headers:{host:new URL(origin).host,origin,'x-atlas-csrf':token,'content-type':'application/json'},rawBody:Buffer.from('{"reservationId":"demo_original"}')};
  assert.equal((await handler.handle(request)).status,200);assert.equal(calls,1);
  assert.equal((await handler.handle({...request,headers:{...request.headers,'x-atlas-csrf':'wrong'}})).status,403);assert.equal(calls,1);assert.equal(closed,2);
});

test('historical buyer workspace cannot expose another reservation or adapter-private card metadata',()=>{
  const card=makeSyntheticEligibility().approvedCard;
  card.privateLocation='secret-vault';card.identity.privateAccount='secret-account';card.media.front.storageSecret='secret-storage';
  const state={listings:{demo_l:{id:'demo_l',cardId:'demo_card',status:'RESERVED',activeReservationId:'other_buyers_reservation',approvedCard:card}},reservations:{demo_old:{id:'demo_old',buyerId:actors.buyer.id,listingId:'demo_l',status:'RELEASED'},other:{id:'other_buyers_reservation',buyerId:actors.alternateBuyer.id,listingId:'demo_l',status:'HELD'}},orders:{},intents:{},fulfillment:{},consent:{},events:[]};
  const projection=projectMarketplaceWorkspace(state,actors.buyer,{now:Date.now(),environment:'SYNTHETIC_LOCAL'});
  const json=JSON.stringify(projection);
  for(const privateValue of ['other_buyers_reservation','secret-vault','secret-account','secret-storage']) assert.equal(json.includes(privateValue),false);
  assert.equal(projection.listings[0].approvedCard.certificateId,'SYNTHETIC-001');
  assert.equal(card.privateLocation,'secret-vault');
});
