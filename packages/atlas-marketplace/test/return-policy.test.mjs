import test from 'node:test';
import assert from 'node:assert/strict';
import {clone} from '../src/contract.mjs';
import {openLocalStore} from '../src/store.mjs';
import {createPilotCommercialTerms,applyPilotCommercialTerms} from '../src/pilot-commercial-terms.mjs';
import {recordFulfillment,openProtectionCase,reviewReturnRequest,recordRefundObligation,resolveProtectionCase} from '../src/fulfillment.mjs';
import {makeSyntheticPolicy,FIXTURE_NOW} from './listing-fixtures.mjs';

const STAFF={id:'demo_staff',role:'STAFF'},BUYER={id:'demo_buyer',role:'BUYER'};
function fixture({pilot=true}={}){
  let now=FIXTURE_NOW;
  const base={listingPolicy:makeSyntheticPolicy(),fulfillmentPolicy:{environment:'SYNTHETIC_LOCAL',id:'demo_policy',version:'synthetic-v1',approvalRef:'demo_fixture_approval',packingProtocolRef:'demo_packing',coverageTermsRef:'demo_coverage',returnsTermsRef:'demo_returns',appealsTermsRef:'demo_appeals',transferTermsRef:'demo_transfer',returnWindowMs:86400000,missingScanAfterMs:1000}};
  const terms=createPilotCommercialTerms({id:'demo_commercial',version:'fixture-v1',environment:'SYNTHETIC_LOCAL',approvalRef:'demo_commercial_approval',effectiveAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+864000000).toISOString(),feeScheduleId:'demo_fee',feeScheduleVersion:'fixture-v1',feeScheduleApprovalRef:'demo_fee_approval',termsRefs:{feeTermsRef:'demo_fee_terms',returnsTermsRef:'demo_returns',transferTermsRef:'demo_transfer',payoutTermsRef:'demo_payout'}});
  const {listingPolicy,fulfillmentPolicy:policy}=pilot?applyPilotCommercialTerms({terms,...base}):{...base,listingPolicy:{...base.listingPolicy,fulfillmentPolicy:base.fulfillmentPolicy}};
  const store=openLocalStore({filename:':memory:',environment:'SYNTHETIC_LOCAL',clock:()=>now});
  store.transaction(tx=>{tx.state.orders.demo_order={orderId:'demo_order',cardId:'demo_card',buyerId:BUYER.id,sellerId:'demo_seller',paymentIntentId:'demo_payment',bindingHash:'paid_original',policyVersion:listingPolicy.version,policy:clone(listingPolicy)};tx.state.intents.demo_payment={kind:'PAYMENT',status:'SUCCEEDED',confirmed:true,orderId:'demo_order',bindingHash:'paid_original'};(tx.state.financeOrders??={}).demo_order={confirmed:true,blocked:false};});
  const evidence=action=>({environment:'SYNTHETIC_LOCAL',orderId:'demo_order',cardId:'demo_card',ref:`demo_${action}_evidence`,...Object.fromEntries(['intakeFrontRef','intakeBackRef','holderConditionRef','packingPhotoRef','fittedInsertRef','firstSealRef','secondSealRef','cleanLabelAreaRef','resaleInstructionsRef','replacementKitRef','carrierRef','trackingRef','coverageRef','dispatchReceiptRef','deliveryProofRef','releaseReviewRef','receivedParcelRef','inspectionFrontRef','inspectionBackRef','holderInspectionRef'].map(key=>[key,`demo_${key}`]))});
  const run=(action,extra={})=>store.transaction(tx=>recordFulfillment(tx,{requestId:`demo_${action}`,orderId:'demo_order',action,actor:STAFF,policy,evidence:evidence(action),...extra}));
  const open=(extra={})=>store.transaction(tx=>openProtectionCase(tx,{requestId:'demo_return_request',caseId:'demo_return',orderId:'demo_order',kind:'RETURN',actor:BUYER,evidenceRef:'demo_buyer_proof',returnReason:'SEVERE_DAMAGE',...extra}));
  const review=(extra={})=>store.transaction(tx=>reviewReturnRequest(tx,{requestId:'demo_review_request',orderId:'demo_order',caseId:'demo_return',actor:STAFF,decision:'APPROVE',reviewRef:'demo_staff_review',...extra}));
  const refund=(extra={})=>store.transaction(tx=>recordRefundObligation(tx,{orderId:'demo_order',caseId:'demo_return',actor:STAFF,amountCents:100,allocations:{sellerCents:92,feeCents:8,taxCents:0,shippingCents:0},reviewRef:'demo_refund_review',...extra}));
  const resolve=(extra={})=>store.transaction(tx=>resolveProtectionCase(tx,{requestId:'demo_resolve',orderId:'demo_order',caseId:'demo_return',actor:STAFF,outcome:'NO_REFUND_DUE',evidence:evidence('resolve'),...extra}));
  run('PACK');run('DISPATCH');
  return {store,policy,evidence,run,open,review,refund,resolve,setNow(value){now=value;},deliver(deliveredAt=now){return run('DELIVER',{evidence:{...evidence('DELIVER'),deliveredAt}});},close(){store.close();}};
}

test('pilot delivery requires an actual evidenced timestamp and a late observation cannot extend the 24-hour window',()=>{
  const f=fixture();try{
    f.setNow(FIXTURE_NOW+10800000);
    for(const deliveredAt of [undefined,null,'2026-10-22T22:00:00.000Z',FIXTURE_NOW-1,FIXTURE_NOW+10800001,FIXTURE_NOW+0.5]){
      assert.throws(()=>f.deliver(deliveredAt===undefined?null:deliveredAt),{code:'DELIVERY_TIMESTAMP_REQUIRED'});assert.equal(f.store.read().fulfillment.demo_order.status,'DISPATCHED');
    }
    assert.throws(()=>f.run('DELIVER'),{code:'DELIVERY_TIMESTAMP_REQUIRED'});
    const actual=FIXTURE_NOW+3600000,record=f.deliver(actual);assert.equal(record.deliveredAt,actual);assert.equal(record.deliveryObservedAt,FIXTURE_NOW+10800000);assert.equal(record.releaseNotBefore,actual+86400000);
    f.setNow(actual+86400000+1);assert.throws(()=>f.open(),{code:'RETURN_WINDOW_CLOSED'});
    assert.deepEqual(f.deliver(actual),record);assert.throws(()=>f.deliver(actual+1),{code:'IDEMPOTENCY_CONFLICT'});assert.equal(f.run('RELEASE').status,'RELEASED');
  }finally{f.close();}
});

test('pilot returns require the purchased buyer, one of exactly two reasons and buyer evidence before the exclusive deadline',()=>{
  const f=fixture();try{
    const delivery=f.deliver();
    for(const actor of [STAFF,{id:'demo_seller',role:'SELLER'},{id:'demo_other_buyer',role:'BUYER'}])assert.throws(()=>f.open({actor}),{code:'FORBIDDEN'});
    for(const returnReason of [undefined,'BUYER_REMORSE','DAMAGED','',null])assert.throws(()=>f.open({returnReason}),{code:'RETURN_REASON_REQUIRED'});
    assert.throws(()=>f.open({evidenceRef:null}));
    f.setNow(delivery.releaseNotBefore-1);const damage=f.open();assert.equal(damage.actorId,BUYER.id);assert.equal(damage.returnReason,'SEVERE_DAMAGE');assert.equal(damage.initialShippingPayer,'ATLAS_INITIALLY');assert.equal(damage.finalResponsibility,'STAFF_REVIEW');assert.equal(damage.returnReview,null);
    const wrong=f.open({requestId:'demo_wrong_request',caseId:'demo_wrong',returnReason:'WRONG_PRODUCT'});assert.equal(wrong.returnReason,'WRONG_PRODUCT');
    f.setNow(delivery.releaseNotBefore);assert.throws(()=>f.open({requestId:'demo_at_deadline',caseId:'demo_at_deadline'}),{code:'RETURN_WINDOW_CLOSED'});
    f.setNow(delivery.releaseNotBefore+1);assert.throws(()=>f.open({requestId:'demo_after_deadline',caseId:'demo_after_deadline'}),{code:'RETURN_WINDOW_CLOSED'});
  }finally{f.close();}
});

test('staff approval is explicit and idempotent, retains the hold and is required before any pilot refund or resolution',()=>{
  const f=fixture();try{
    const delivery=f.deliver();f.open();
    assert.throws(()=>f.refund(),{code:'RETURN_REVIEW_REQUIRED'});assert.throws(()=>f.resolve(),{code:'RETURN_REVIEW_REQUIRED'});
    assert.throws(()=>f.review({actor:BUYER}),{code:'FORBIDDEN'});assert.throws(()=>f.review({reviewRef:null}));assert.throws(()=>f.review({decision:'AUTO'}),{code:'RETURN_REVIEW_DECISION_INVALID'});
    const reviewed=f.review();assert.equal(reviewed.status,'OPEN');assert.deepEqual(reviewed.returnReview,{decision:'APPROVE',reviewRef:'demo_staff_review',actorId:STAFF.id,at:FIXTURE_NOW});assert.deepEqual(f.review(),reviewed);
    assert.throws(()=>f.review({decision:'DENY'}),{code:'IDEMPOTENCY_CONFLICT'});assert.throws(()=>f.review({requestId:'demo_replace_review',decision:'DENY'}),{code:'RETURN_REVIEW_CONFLICT'});
    f.setNow(delivery.releaseNotBefore);assert.throws(()=>f.run('RELEASE'),{code:'PROTECTION_HOLD'});
    const obligation=f.refund();assert.equal(obligation.amountCents,100);assert.throws(()=>f.resolve(),{code:'REFUND_RECONCILIATION_REQUIRED'});
    assert.throws(()=>f.resolve({outcome:'REFUND_REQUIRED'}),{code:'REFUND_RECONCILIATION_REQUIRED'});
    const state=f.store.read();assert.equal(state.journals.length,0);assert.equal(Object.keys(state.intents).length,1);assert.equal(state.fulfillment.demo_order.cases[0].status,'OPEN');
  }finally{f.close();}
});

test('staff denial closes only the reviewed request, is idempotent and cannot bypass the window, other cases or explicit release',()=>{
  const f=fixture();try{
    const delivery=f.deliver();f.open();const denied=f.review({decision:'DENY'});assert.equal(denied.status,'CLOSED');assert.equal(denied.outcome,'RETURN_REQUEST_DENIED');assert.deepEqual(f.review({decision:'DENY'}),denied);
    assert.throws(()=>f.review(),{code:'IDEMPOTENCY_CONFLICT'});assert.throws(()=>f.refund(),{code:'CASE_UNAVAILABLE'});assert.throws(()=>f.run('RELEASE'),{code:'PROTECTION_HOLD'});
    f.open({requestId:'demo_second_request',caseId:'demo_second_return',returnReason:'WRONG_PRODUCT'});f.setNow(delivery.releaseNotBefore);assert.throws(()=>f.run('RELEASE'),{code:'PROTECTION_HOLD'});
    f.review({requestId:'demo_second_review',caseId:'demo_second_return',decision:'DENY'});
    assert.equal(f.store.read().fulfillment.demo_order.status,'DELIVERED');assert.equal(f.run('RELEASE').status,'RELEASED');
    assert.equal(f.store.read().journals.length,0);assert.equal(Object.keys(f.store.read().intents).length,1);
  }finally{f.close();}
});

test('review cannot replace a refund obligation; approved return resolution still needs inspection and exact confirmed refund',()=>{
  const f=fixture();try{
    f.deliver();f.open();f.store.transaction(tx=>{tx.state.fulfillment.demo_order.cases[0].refundObligation={amountCents:100};});assert.throws(()=>f.review(),{code:'RETURN_REVIEW_CONFLICT'});
    f.store.transaction(tx=>{delete tx.state.fulfillment.demo_order.cases[0].refundObligation;});f.review();const obligation=f.refund();
    f.store.transaction(tx=>{tx.state.intents.demo_refund={kind:'REFUND',status:'SUCCEEDED',confirmed:true,orderId:'demo_order',bindingHash:'paid_original',amountCents:100,allocations:clone(obligation.allocations),policyEvidence:{caseId:'demo_return',obligationHash:obligation.hash,evidenceRef:obligation.reviewRef,policyVersion:obligation.policyVersion}};});
    const evidence={...f.evidence('resolved'),refundIntentId:'demo_refund'};
    assert.throws(()=>f.resolve({outcome:'REFUND_REQUIRED',evidence:{...evidence,inspectionBackRef:null}}));
    f.store.transaction(tx=>{tx.state.intents.demo_refund.amountCents=99;});assert.throws(()=>f.resolve({outcome:'REFUND_REQUIRED',evidence}),{code:'REFUND_RECONCILIATION_REQUIRED'});
    f.store.transaction(tx=>{tx.state.intents.demo_refund.amountCents=100;});assert.equal(f.resolve({outcome:'REFUND_REQUIRED',evidence}).status,'CLOSED');
  }finally{f.close();}
});

test('generic historical policies retain their original behavior and malformed pilot metadata fails closed',()=>{
  const f=fixture({pilot:false});try{
    const delivery=f.run('DELIVER');assert.equal(delivery.deliveredAt,FIXTURE_NOW);f.open({actor:STAFF,returnReason:undefined});assert.equal(f.refund().amountCents,100);assert.throws(()=>f.review(),{code:'PILOT_RETURN_REQUIRED'});
  }finally{f.close();}
  const bad=fixture();try{
    const policy=clone(bad.policy);policy.commercialTerms.returns.requiresBuyerEvidence=false;
    assert.throws(()=>bad.run('DELIVER',{policy,evidence:{...bad.evidence('DELIVER'),deliveredAt:FIXTURE_NOW}}),{code:'PILOT_RETURN_POLICY_REQUIRED'});
  }finally{bad.close();}
});
