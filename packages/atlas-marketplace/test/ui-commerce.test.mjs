import test from 'node:test';
import assert from 'node:assert/strict';
import {renderApp} from '../ui/view.mjs';
import {createListing} from '../src/listing.mjs';
import {makeTestTx,makeListingInput,makeSyntheticPolicy,makeSyntheticEligibility,FIXTURE_NOW} from './listing-fixtures.mjs';

function workspace(role) { return {schema:'atlas-marketplace-workspace-v1',runtime:'AUTHENTICATED',environment:'SYNTHETIC_LOCAL',scope:{role,actorId:role==='SELLER'?'demo_seller':'demo_buyer'},csrfToken:'fixture_session_csrf',now:FIXTURE_NOW,policy:makeSyntheticPolicy(),eligibilityCards:[makeSyntheticEligibility().approvedCard],consent:{demo_card:{choice:'HOLD_AND_LIST'}},listings:[],reservations:[],orders:[],intents:[],fulfillment:{},balance:{availableCents:10000},sellerEligibility:{status:'ELIGIBLE',payoutsEnabled:true,bank:{status:'PAYOUT_READY',externalAccountId:'demo_bank'},instantPayouts:{available:true}}}; }
const expiry=new Date(FIXTURE_NOW+300000).toISOString();
const fee={id:'demo_fee_review',cardId:'demo_card',listingId:null,listingVersion:0,listingHash:null,askingPriceCents:12500,feeCents:525,sellerNetCents:11975,feeDisclosure:'Explicit fixture fee only',expiresAt:expiry};
const instant={quoteId:'demo_instant',method:'instant',amountCents:5000,sellerFeeCents:100,totalDebitCents:5100,externalAccountId:'demo_bank',expiresAt:expiry,feeDisclosure:'Explicit fixture instant fee',timingDisclosure:'Provider timing under this fixture only'};

test('fee and destination reviews fail closed for changed price/version, expiry and missing qualified destinations',()=>{
  const seller=workspace('SELLER');seller.feePreviewRequired=true;
  assert.match(renderApp(seller,{price:'125.00'}),/aria-describedby="fee-disclosure" disabled/);
  assert.doesNotMatch(renderApp(seller,{price:'125.00',feeQuote:fee}),/aria-describedby="fee-disclosure" disabled/);
  for(const changed of [{price:'125.01',feeQuote:fee},{price:'125.00',feeQuote:{...fee,expiresAt:new Date(FIXTURE_NOW).toISOString()}},{price:'125.00',feeQuote:{...fee,listingId:'demo_wrong'}}])assert.match(renderApp(seller,changed),/aria-describedby="fee-disclosure" disabled/);
  const buyer=workspace('BUYER');buyer.listings=[createListing(makeTestTx(),makeListingInput())];buyer.quoteDestinationRequired=true;buyer.quoteDestinations=[];
  assert.match(renderApp(buyer),/No qualified delivery destination/);assert.match(renderApp(buyer),/data-action="quote"[^>]*disabled/);
  buyer.quoteDestinations=[{id:'demo_destination',label:'<private escaped label>',version:'v1'}];
  assert.match(renderApp(buyer,{destinationId:'demo_destination'}),/&lt;private escaped label&gt;/);
  assert.doesNotMatch(renderApp(buyer,{destinationId:'demo_destination'}),/data-action="quote"[^>]*disabled/);
});

test('instant review requires exact fee-inclusive balance and explicit confirmation; staff incidents remain role scoped',()=>{
  const seller=workspace('SELLER');
  seller.intents=[{id:'demo_pending_withdrawal',kind:'PAYOUT',status:'PREPARED',amountCents:5000}];assert.match(renderApp(seller),/data-action="cancel-withdrawal"/);
  for(const status of ['UNKNOWN','DISPATCHING','PENDING','SUCCEEDED','VOIDED']){seller.intents[0].status=status;assert.doesNotMatch(renderApp(seller),/data-action="cancel-withdrawal"/);}
  assert.doesNotMatch(renderApp(seller),/data-action="confirm-instant-withdrawal"/);
  let html=renderApp(seller,{instantAmount:'50.00',instantQuote:instant});assert.match(html,/Total balance debit/);assert.match(html,/\$51\.00/);assert.doesNotMatch(html,/data-action="confirm-instant-withdrawal"[^>]*disabled/);
  seller.balance.availableCents=5000;assert.match(renderApp(seller,{instantAmount:'50.00',instantQuote:instant}),/data-action="confirm-instant-withdrawal"[^>]*disabled/);
  seller.operations={incidentCounts:{open:1,acknowledged:0,resolved:0},incidents:[{alertId:'incident_fixture',generation:1,version:2,status:'OPEN',code:'BALANCE_DIFFERENCE',reference:'<script>bad</script>',latestEvidenceHash:'a'.repeat(64),firstObservedAt:FIXTURE_NOW,lastObservedAt:FIXTURE_NOW,deliveryStatus:'PENDING',privatePayload:'MUST_NOT_RENDER'}]};
  assert.doesNotMatch(renderApp(seller),/incident_fixture|MUST_NOT_RENDER/);
  seller.scope.role='STAFF';html=renderApp(seller);assert.match(html,/data-form="finance-incident"/);assert.match(html,/name="reviewRef"/);assert.match(html,/Resolving an alert does not clear a money exception/);assert.doesNotMatch(html,/<script>|MUST_NOT_RENDER/);
});
const rootNotice=html=>html.match(/<div class="notice[\s\S]*?<\/div>/)?.[0];
let count=0;
async function boot(data,post) {
  const before={document:globalThis.document,fetch:globalThis.fetch,FormData:globalThis.FormData,location:globalThis.location};const listeners={},calls=[];
  const root={dataset:{apiPath:'/account/marketplace/api',mountPath:'/account/marketplace/'},innerHTML:'',addEventListener(type,fn){listeners[type]=fn;},querySelector(){return null;},querySelectorAll(){return [];}};
  globalThis.location={pathname:'/account/marketplace/',search:'',origin:'https://fixture.invalid'};
  globalThis.document={getElementById:()=>root,querySelector:()=>null};
  globalThis.fetch=async(url,options={})=>{calls.push({url,options});return {ok:true,json:async()=>options.method==='POST'?post(url,JSON.parse(options.body)):data};};
  globalThis.FormData=class {constructor(form){this.values=new Map(Object.entries(form.values??{}));}get(key){return this.values.get(key);}getAll(key){const value=this.values.get(key);return Array.isArray(value)?value:value===undefined?[]:[value];}has(key){return this.values.has(key);}[Symbol.iterator](){return this.values[Symbol.iterator]();}};
  try {await import(`../ui/app.mjs?commerce=${++count}`);}catch(error){Object.assign(globalThis,before);throw error;}
  return {root,listeners,calls,click:async dataset=>listeners.click({target:{closest:()=>({disabled:false,dataset})}}),close(){Object.assign(globalThis,before);}};
}

test('actual seller UI sends feeQuoteId after review and instant quoteId only after explicit confirmation',async()=>{
  const data=workspace('SELLER');data.feePreviewRequired=true;
  const app=await boot(data,(url)=>url.endsWith('/listings/preview')?fee:url.endsWith('/withdrawals/quote')?instant:{});
  try {
    app.listeners.input({target:{id:'asking-price',value:'125.00'}});
    await app.click({action:'preview-fee'});
    assert.equal(app.calls.filter(call=>call.url.endsWith('/listings')).length,0);
    await app.listeners.submit({preventDefault(){},target:{id:'listing-form',dataset:{mode:'create'}}});
    const publish=app.calls.find(call=>call.url.endsWith('/listings'));assert.equal(JSON.parse(publish.options.body).feeQuoteId,fee.id);assert.equal(publish.options.headers['x-atlas-csrf'],data.csrfToken);assert.equal(JSON.parse(publish.options.body).feeCents,undefined);
    app.listeners.input({target:{id:'instant-amount',value:'50.00'}});await app.click({action:'quote-withdrawal',bank:'demo_bank'});
    assert.equal(app.calls.filter(call=>call.url.endsWith('/withdrawals')).length,0);
    await app.click({action:'confirm-instant-withdrawal',quote:instant.quoteId});
    assert.ok(app.calls.some(call=>call.url.endsWith('/withdrawals')),JSON.stringify(app.calls)+' '+rootNotice(app.root.innerHTML));const withdraw=JSON.parse(app.calls.find(call=>call.url.endsWith('/withdrawals')).options.body);assert.equal(withdraw.quoteId,instant.quoteId);assert.equal(withdraw.method,'instant');assert.equal(withdraw.externalAccountId,'demo_bank');assert.equal(withdraw.sellerFeeCents,undefined);
  }finally{app.close();}
});

test('actual buyer UI accepts only safe quote projection and posts selected destination without private receipts',async()=>{
  const data=workspace('BUYER'),listing=createListing(makeTestTx(),makeListingInput());data.listings=[listing];data.quoteDestinationRequired=true;data.quoteDestinations=[{id:'demo_destination',label:'Saved fixture destination',version:'v1'}];
  const quote={quoteId:'demo_quote',listingHash:listing.bindingHash,listingId:listing.id,listingVersion:listing.version,itemCents:12500,shippingCents:1200,taxCents:750,buyerFeeCents:0,totalCents:14450,deliveryEstimate:'Fixture delivery',protectionTerms:'Fixture protection',expiresAt:expiry,destination:data.quoteDestinations[0]};
  const app=await boot(data,url=>url.endsWith('/quote')?quote:{});
  try {
    app.listeners.change({target:{id:'quote-destination',value:'demo_destination'}});await app.click({action:'quote',listing:listing.id});
    const quoted=app.calls.find(call=>call.url.endsWith('/quote'));assert.equal(quoted.options.method,'POST');assert.deepEqual(JSON.parse(quoted.options.body),{listingId:listing.id,destinationId:'demo_destination'});
    await app.click({action:'reserve',listing:listing.id});const reserve=JSON.parse(app.calls.find(call=>call.url.endsWith('/reservations')).options.body);assert.equal(reserve.quoteId,quote.quoteId);assert.equal(reserve.destination,undefined);assert.equal(reserve.receiptHash,undefined);
  }finally{app.close();}
});

test('actual staff incident UI uses retained evidence/version and a deliberate review; no automatic review POST',async()=>{
  const data=workspace('STAFF');data.operations={instantFeeSettlementAvailable:true,unsettledInstantFeeIntents:[{id:'demo_payout',amountCents:5000,providerFeeCents:75}],incidents:[{alertId:'demo_alert',version:3,generation:1,status:'OPEN',code:'MISSING_REPORT',reference:'demo_report',latestEvidenceHash:'b'.repeat(64)}],incidentCounts:{open:1,acknowledged:0,resolved:0}};
  const app=await boot(data,()=>({}));
  try {
    assert.equal(app.calls.filter(call=>call.options.method==='POST').length,0);
    await app.listeners.submit({preventDefault(){},target:{dataset:{form:'finance-incident',alert:'demo_alert'},values:{action:'ACKNOWLEDGE',reviewRef:'demo_review',reviewConfirmed:'on'}}});
    const request=app.calls.find(call=>call.url.endsWith('/staff/incidents')),body=JSON.parse(request.options.body);assert.equal(body.expectedVersion,3);assert.equal(body.evidenceHash,'b'.repeat(64));assert.equal(body.reviewRef,'demo_review');assert.equal(body.action,'ACKNOWLEDGE');assert.equal(body.reviewConfirmed,undefined);
    await app.listeners.submit({preventDefault(){},target:{dataset:{form:'instant-fee-settlement'},values:{intentIds:['demo_payout'],evidenceRef:'demo_provider_assessment',reviewRef:'demo_fee_review',reviewConfirmed:'on'}}});
    const settlement=JSON.parse(app.calls.find(call=>call.url.endsWith('/staff/instant-fees/settle')).options.body);assert.deepEqual(settlement.intentIds,['demo_payout']);assert.equal(settlement.evidenceRef,'demo_provider_assessment');assert.equal(settlement.reviewRef,'demo_fee_review');assert.equal(settlement.reviewConfirmed,undefined);
  }finally{app.close();}
});
