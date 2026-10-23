import test from 'node:test';
import assert from 'node:assert/strict';
import {createMarketplaceHttpHandler} from '../src/http.mjs';
import {openLocalStore} from '../src/store.mjs';
import {createLocalFixture,actors} from '../scripts/local-fixture.mjs';
import {createPilotCommercialTerms,applyPilotCommercialTerms} from '../src/pilot-commercial-terms.mjs';
import {FIXTURE_NOW} from './listing-fixtures.mjs';

test('return review HTTP route binds the authenticated staff actor, refuses CSRF/body escalation and reaches actual service/domain once',async()=>{
  const store=openLocalStore({filename:':memory:',environment:'SYNTHETIC_LOCAL',clock:()=>FIXTURE_NOW});let handler;
  try{
    const fixture=createLocalFixture({store,assets:false,clock:()=>FIXTURE_NOW});
    const terms=createPilotCommercialTerms({id:'demo_commercial',version:'fixture-v1',environment:'SYNTHETIC_LOCAL',approvalRef:'demo_commercial_approval',effectiveAt:new Date(FIXTURE_NOW-1000).toISOString(),expiresAt:new Date(FIXTURE_NOW+864000000).toISOString(),feeScheduleId:'demo_fee',feeScheduleVersion:'fixture-v1',feeScheduleApprovalRef:'demo_fee_approval',termsRefs:{feeTermsRef:'demo_fee_terms',returnsTermsRef:fixture.fulfillmentPolicy.returnsTermsRef,transferTermsRef:fixture.fulfillmentPolicy.transferTermsRef,payoutTermsRef:'demo_payout'}});
    const {listingPolicy,fulfillmentPolicy}=applyPilotCommercialTerms({terms,listingPolicy:fixture.listingPolicy,fulfillmentPolicy:fixture.fulfillmentPolicy});
    store.transaction(tx=>{
      tx.state.orders.demo_order={orderId:'demo_order',cardId:'demo_card',buyerId:actors.buyer.id,sellerId:actors.seller.id,paymentIntentId:'demo_payment',bindingHash:'original_binding',policyVersion:listingPolicy.version,policy:listingPolicy};
      tx.state.intents.demo_payment={kind:'PAYMENT',status:'SUCCEEDED',confirmed:true,orderId:'demo_order',bindingHash:'original_binding'};
      tx.state.fulfillment.demo_order={orderId:'demo_order',cardId:'demo_card',status:'DELIVERED',policy:fulfillmentPolicy,deliveredAt:FIXTURE_NOW-1000,releaseNotBefore:FIXTURE_NOW+86399000,history:[],cases:[{id:'demo_return',kind:'RETURN',status:'OPEN',actorId:actors.buyer.id,evidenceRef:'demo_private_buyer_proof',returnReason:'WRONG_PRODUCT',openedAt:FIXTURE_NOW-500,history:[],returnReview:null}]};
    });
    const origin='https://marketplace.example.test',csrf='c'.repeat(64),principal={actor:actors.buyer,authenticated:true,expiresAt:FIXTURE_NOW+60000,sessionId:'fixture_session'};let calls=0;
    const service={...fixture.service,async reviewReturn(actor,input){calls++;return fixture.service.reviewReturn(actor,input);}};
    handler=createMarketplaceHttpHandler({enabled:true,origin,apiPath:'/account/marketplace/api',service,clock:()=>FIXTURE_NOW,resolveSession:async()=>principal,verifyCsrf:async({token})=>token===csrf,issueCsrf:async()=>csrf,admitRequest:async()=>true});
    const input={requestId:'demo_review',orderId:'demo_order',caseId:'demo_return',decision:'APPROVE',reviewRef:'demo_independent_review'};
    const request=(body=input,headers={})=>handler.handle({method:'POST',url:'/account/marketplace/api/cases/return/review',headers:{host:new URL(origin).host,origin,'content-type':'application/json','x-atlas-csrf':csrf,...headers},rawBody:Buffer.from(JSON.stringify(body))});
    for(const actor of [actors.buyer,actors.seller,actors.alternateBuyer]){principal.actor=actor;assert.equal((await request()).status,403);await assert.rejects(fixture.service.reviewReturn(actor,input),{code:'FORBIDDEN'});}
    assert.equal(calls,0);principal.actor=actors.staff;
    assert.equal((await request(input,{'x-atlas-csrf':'incorrect'})).status,403);assert.equal((await request({...input,actor:actors.staff})).status,409);assert.equal((await request({...input,environment:'PRODUCTION'})).status,409);assert.equal(calls,0);
    const result=await request();assert.equal(result.status,200);assert.deepEqual(result.body,{id:'demo_return',status:'OPEN',kind:'RETURN'});assert.equal(calls,1);
    const saved=store.read().fulfillment.demo_order.cases[0];assert.deepEqual(saved.returnReview,{decision:'APPROVE',reviewRef:'demo_independent_review',actorId:actors.staff.id,at:FIXTURE_NOW});assert.equal(saved.initialShippingPayer,'ATLAS_INITIALLY');
    assert.deepEqual((await request()).body,result.body);assert.equal((await request({...input,decision:'DENY'})).status,409);assert.equal(store.read().fulfillment.demo_order.cases[0].status,'OPEN');assert.equal(store.read().journals.length,0);
    assert.equal(JSON.stringify(result.body).includes('demo_private_buyer_proof'),false);assert.equal(JSON.stringify(result.body).includes('demo_independent_review'),false);
  }finally{handler?.close();store.close();}
});
