import test from 'node:test';
import assert from 'node:assert/strict';
import {renderApp} from '../ui/view.mjs';
import {projectMarketplaceWorkspace,projectBuyerQuote} from '../src/projections.mjs';
import {makeSyntheticEligibility,makeSyntheticPolicy,FIXTURE_NOW} from './listing-fixtures.mjs';

const returnPolicy={returnWindowMs:86400000,startsAt:'ACTUAL_DELIVERY',deadlineExclusive:true,eligibleReasons:['SEVERE_DAMAGE','WRONG_PRODUCT'],requiresBuyerEvidence:true,requiresStaffReview:true,returnShippingPayer:'ATLAS_INITIALLY',finalResponsibility:'STAFF_REVIEW'};
function workspace(role='BUYER'){
  return {schema:'atlas-marketplace-workspace-v1',runtime:'AUTHENTICATED',environment:'SYNTHETIC_LOCAL',scope:{role,actorId:role==='STAFF'?'demo_staff':role==='SELLER'?'demo_seller':'demo_buyer'},csrfToken:'fixture_csrf',now:FIXTURE_NOW,listings:[],reservations:[],intents:[],orders:[{orderId:'demo_order',cardId:'demo_card',status:'PAID',totalCents:10000,itemCents:10000,feeCents:800,sellerNetCents:9200,shippingCents:0,taxCents:0,returnPolicy}],fulfillment:{demo_order:{status:'DELIVERED',deliveredAt:FIXTURE_NOW-3600000,releaseNotBefore:FIXTURE_NOW+82800000,cases:[{id:'demo_return',kind:'RETURN',status:'OPEN',returnReason:'WRONG_PRODUCT',evidenceRef:'PRIVATE_BUYER_PROOF_<script>',openedAt:FIXTURE_NOW,history:[]}]}}};
}

test('return controls are buyer-only; proof and approval controls are staff-only and refunds wait for staff approval',()=>{
  const data=workspace();let html=renderApp(data);assert.match(html,/<option value="RETURN">/);assert.match(html,/<option value="SEVERE_DAMAGE">/);assert.match(html,/<option value="WRONG_PRODUCT">/);assert.doesNotMatch(html,/PRIVATE_BUYER_PROOF|data-form="return-review"|data-form="refund-review"/);
  data.scope.role='SELLER';html=renderApp(data);assert.doesNotMatch(html,/<option value="RETURN">|name="returnReason"|PRIVATE_BUYER_PROOF|data-form="return-review"|data-form="refund-review"/);
  data.scope.role='STAFF';html=renderApp(data);assert.doesNotMatch(html,/<option value="RETURN">|name="returnReason"|data-form="refund-review"|data-form="case-resolve"|PRIVATE_BUYER_PROOF_<script>/);assert.match(html,/PRIVATE_BUYER_PROOF_&lt;script&gt;/);assert.match(html,/data-form="return-review"/);assert.match(html,/<option value="APPROVE">/);assert.match(html,/<option value="DENY">/);
  const item=data.fulfillment.demo_order.cases[0];item.returnReview={decision:'APPROVE',reviewRef:'PRIVATE_STAFF_REVIEW',at:FIXTURE_NOW};html=renderApp(data);assert.match(html,/data-form="refund-review"/);assert.match(html,/data-form="case-resolve"/);assert.doesNotMatch(html,/data-form="return-review"/);
  item.returnReview.decision='DENY';item.status='CLOSED';item.outcome='RETURN_REQUEST_DENIED';html=renderApp(data);assert.doesNotMatch(html,/data-form="return-review"|data-form="refund-review"|data-form="case-resolve"/);assert.match(html,/RETURN_REQUEST_DENIED/);
});

test('workspace return policy uses closed public keys and never leaks buyer proof or staff review references to seller/buyer',()=>{
  const policy=makeSyntheticPolicy({commercialTerms:{approvalRef:'PRIVATE_APPROVAL',returns:{...returnPolicy,privateAddress:'PRIVATE_ADDRESS',approvalRef:'PRIVATE_RETURN_APPROVAL',status:'OWNER_TERMS_SELECTED'}}}),card=makeSyntheticEligibility().approvedCard;
  const state={listings:{},reservations:{},orders:{demo_order:{orderId:'demo_order',cardId:'demo_card',buyerId:'demo_buyer',sellerId:'demo_seller',status:'PAID',policy,approvedCard:card}},intents:{},fulfillment:{demo_order:{orderId:'demo_order',status:'DELIVERED',history:[],cases:[{id:'demo_return',kind:'RETURN',status:'OPEN',returnReason:'SEVERE_DAMAGE',evidenceRef:'PRIVATE_BUYER_PROOF',history:[{evidence:{ref:'PRIVATE_REVIEW_HISTORY'}}],returnReview:{decision:'APPROVE',reviewRef:'PRIVATE_STAFF_REVIEW',actorId:'PRIVATE_REVIEWER',at:FIXTURE_NOW,privateAudit:'PRIVATE_AUDIT'}}]}},consent:{},events:[],journals:[]};
  for(const role of ['BUYER','SELLER','STAFF']){
    const view=projectMarketplaceWorkspace(state,{role,id:role==='BUYER'?'demo_buyer':role==='SELLER'?'demo_seller':'demo_staff'},{now:FIXTURE_NOW,environment:'SYNTHETIC_LOCAL'}),serialized=JSON.stringify(view);
    assert.deepEqual(Object.keys(view.orders[0].returnPolicy).sort(),Object.keys(returnPolicy).sort());assert.deepEqual(view.orders[0].returnPolicy,returnPolicy);
    for(const value of ['PRIVATE_APPROVAL','PRIVATE_ADDRESS','PRIVATE_RETURN_APPROVAL','PRIVATE_AUDIT'])assert.equal(serialized.includes(value),false,value);
    const review=view.fulfillment.demo_order.cases[0].returnReview;
    if(role==='STAFF'){assert.equal(view.fulfillment.demo_order.cases[0].evidenceRef,'PRIVATE_BUYER_PROOF');assert.equal(review.reviewRef,'PRIVATE_STAFF_REVIEW');}
    else{for(const value of ['PRIVATE_BUYER_PROOF','PRIVATE_REVIEW_HISTORY','PRIVATE_STAFF_REVIEW','PRIVATE_REVIEWER'])assert.equal(serialized.includes(value),false,value);assert.deepEqual(Object.keys(review).sort(),['at','decision']);}
  }
  const other=projectMarketplaceWorkspace(state,{role:'BUYER',id:'demo_other'},{now:FIXTURE_NOW,environment:'SYNTHETIC_LOCAL'});assert.deepEqual(other.orders,[]);assert.deepEqual(other.fulfillment,{});
});

test('shipping projection retains only buyer disclosure or four staff cost fields, and UI never renders raw receipts',()=>{
  const pricing={quotedCarrierCostCents:1200,handlingCents:200,buyerChargeCents:1400,costStatus:'QUOTED_NOT_SETTLED',label:'Shipping & handling',disclosure:'Carrier rate plus handling <approved fixture>',providerQuoteRef:'PRIVATE_PROVIDER_QUOTE',providerCostReceiptHash:'PRIVATE_PROVIDER_HASH',policy:{approvalRef:'PRIVATE_PRICING_APPROVAL'},policyHash:'PRIVATE_POLICY_HASH',receiptHash:'PRIVATE_RECEIPT_HASH'};
  const quote={quoteId:'demo_quote',listingHash:'listing_hash',itemCents:10000,shippingCents:1400,taxCents:0,buyerFeeCents:0,totalCents:11400,expiresAt:new Date(FIXTURE_NOW+60000).toISOString(),shippingPricing:pricing};
  const safe=projectBuyerQuote(quote);assert.deepEqual(safe.shippingCharge,{label:pricing.label,disclosure:pricing.disclosure});assert.equal(safe.shippingPricing,undefined);assert.doesNotMatch(JSON.stringify(safe),/PRIVATE_/);
  const card=makeSyntheticEligibility().approvedCard,state={listings:{},reservations:{},orders:{demo_order:{orderId:'demo_order',cardId:'demo_card',buyerId:'demo_buyer',sellerId:'demo_seller',status:'PAID',quote,shippingPricing:pricing,approvedCard:card}},intents:{},fulfillment:{},consent:{},events:[],journals:[]};
  for(const role of ['BUYER','SELLER','STAFF']){
    const projected=projectMarketplaceWorkspace(state,{role,id:role==='BUYER'?'demo_buyer':role==='SELLER'?'demo_seller':'demo_staff'},{now:FIXTURE_NOW,environment:'SYNTHETIC_LOCAL'});assert.doesNotMatch(JSON.stringify(projected),/PRIVATE_/);
    const view={...projected,runtime:'AUTHENTICATED',csrfToken:'fixture_csrf'},html=renderApp(view);
    if(role==='STAFF'){assert.deepEqual(Object.keys(projected.orders[0].shippingPricing).sort(),['buyerChargeCents','costStatus','handlingCents','quotedCarrierCostCents']);assert.match(html,/Quoted carrier cost/);assert.match(html,/\$12\.00/);assert.match(html,/\$2\.00/);assert.match(html,/\$14\.00/);assert.match(html,/quoted, not settled/);}
    else{assert.equal(projected.orders[0].shippingPricing,undefined);assert.doesNotMatch(html,/Quoted carrier cost|ATLAS handling charge/);}
  }
  const buyer=workspace();buyer.listings=[{id:'demo_listing',status:'ACTIVE',bindingHash:'listing_hash',askingPriceCents:10000,approvedCard:card,policy:makeSyntheticPolicy()}];const html=renderApp(buyer,{quote:safe});assert.match(html,/Shipping &amp; handling/);assert.match(html,/Carrier rate plus handling &lt;approved fixture&gt;/);assert.doesNotMatch(html,/<approved fixture>|PRIVATE_/);
});

let count=0;
async function boot(data){
  const previous={document:globalThis.document,fetch:globalThis.fetch,FormData:globalThis.FormData,location:globalThis.location},listeners={},calls=[];
  const root={dataset:{apiPath:'/account/marketplace/api',mountPath:'/account/marketplace/'},innerHTML:'',addEventListener(type,fn){listeners[type]=fn;},querySelector(){return null;},querySelectorAll(){return [];}};
  globalThis.document={getElementById:()=>root,querySelector:()=>null};globalThis.location={pathname:'/account/marketplace/',search:'',origin:'https://fixture.invalid'};
  globalThis.FormData=class{constructor(form){this.values=new Map(Object.entries(form.values??{}));}get(key){return this.values.get(key);}has(key){return this.values.has(key);}[Symbol.iterator](){return this.values[Symbol.iterator]();}};
  globalThis.fetch=async(url,options={})=>{calls.push({url,options});return {ok:true,json:async()=>options.method==='POST'?{}:data};};
  try{await import(`../ui/app.mjs?return=${++count}`);}catch(error){Object.assign(globalThis,previous);throw error;}
  return {root,calls,submit:(dataset,values)=>listeners.submit({preventDefault(){},target:{dataset,values}}),close(){Object.assign(globalThis,previous);}};
}
const posts=app=>app.calls.filter(call=>call.options.method==='POST');

test('actual app sends exact return reason/evidence and separate explicit staff decisions with same-origin CSRF',async()=>{
  let app=await boot(workspace());
  try{
    await app.submit({form:'case-open',order:'demo_order'},{kind:'RETURN',returnReason:'',evidenceRef:'demo_buyer_proof'});assert.equal(posts(app).length,0);
    await app.submit({form:'case-open',order:'demo_order'},{kind:'RETURN',returnReason:'SEVERE_DAMAGE',evidenceRef:'demo_buyer_proof'});
    const request=posts(app)[0],body=JSON.parse(request.options.body);assert.equal(request.url,'/account/marketplace/api/cases');assert.equal(body.kind,'RETURN');assert.equal(body.returnReason,'SEVERE_DAMAGE');assert.equal(body.evidenceRef,'demo_buyer_proof');assert.equal(body.caseId,body.requestId);assert.equal(body.actor,undefined);assert.equal(request.options.headers['x-atlas-csrf'],'fixture_csrf');
  }finally{app.close();}
  app=await boot(workspace('STAFF'));
  try{
    assert.equal(posts(app).length,0);
    for(const decision of ['APPROVE','DENY']){
      await app.submit({form:'return-review',order:'demo_order',case:'demo_return'},{decision,reviewRef:`demo_${decision}_review`});
      const request=posts(app).at(-1),body=JSON.parse(request.options.body);assert.equal(request.url,'/account/marketplace/api/cases/return/review');assert.equal(body.orderId,'demo_order');assert.equal(body.caseId,'demo_return');assert.equal(body.decision,decision);assert.equal(body.reviewRef,`demo_${decision}_review`);assert.equal(body.actor,undefined);assert.equal(body.amountCents,undefined);
    }
  }finally{app.close();}
});

test('actual app converts entered local delivery datetime to epoch milliseconds and rejects an invalid date before POST',async()=>{
  const previousTZ=process.env.TZ;process.env.TZ='America/Los_Angeles';const data=workspace('STAFF');data.fulfillment.demo_order.status='DISPATCHED';data.fulfillment.demo_order.cases=[];
  let app;
  try{
    app=await boot(data);assert.match(app.root.innerHTML,/type="datetime-local" name="deliveredAt"/);assert.match(app.root.innerHTML,/your local time/);
    const form={form:'fulfillment-evidence',order:'demo_order',step:'DELIVER'},values={ref:'demo_delivery_observation',deliveryProofRef:'demo_carrier_proof'};
    await app.submit(form,{...values,deliveredAt:''});assert.equal(posts(app).length,0);
    await app.submit(form,{...values,deliveredAt:'2026-10-22T14:00:00'});const request=posts(app)[0],body=JSON.parse(request.options.body);
    assert.equal(request.url,'/account/marketplace/api/fulfillment');assert.equal(body.action,'DELIVER');assert.equal(body.evidence.deliveredAt,Date.UTC(2026,9,22,21));assert.equal(body.evidence.deliveryProofRef,'demo_carrier_proof');assert.equal(body.evidence.orderId,'demo_order');assert.equal(body.evidence.cardId,'demo_card');assert.equal(typeof body.evidence.deliveredAt,'number');
  }finally{app?.close();if(previousTZ===undefined)delete process.env.TZ;else process.env.TZ=previousTZ;}
});
