import test from 'node:test';
import assert from 'node:assert/strict';
import {clone,hash} from '../src/contract.mjs';
import {createAuthorityContext} from '../src/authority-context.mjs';
import {createPilotCommercialTerms} from '../src/pilot-commercial-terms.mjs';
import {createMarketplacePilot,intentId} from '../src/service.mjs';
import {trackingFixture,TRACKING_NOW} from './shipping-lifecycle-fixtures.mjs';

const staff={id:'22222222-2222-4222-8222-222222222222',role:'STAFF'};
const buyer={id:'33333333-3333-4333-8333-333333333333',role:'BUYER'};
async function fixture(t) {
  const f=trackingFixture(t),environment='PROVIDER_SANDBOX',platformAccountId='acct_SYNTHETIC_PLATFORM';
  const context=createAuthorityContext({environment,evidenceOrigin:'https://fixture.invalid',evidencePathPrefixes:['/approved/'],qualificationRefs:{fingerprintRef:'SYNTHETIC_ONLY',titlePolicyRef:'SYNTHETIC_ONLY',marketplacePolicyRef:'SYNTHETIC_ONLY',evidenceContractRef:'SYNTHETIC_ONLY'}});
  const terms=createPilotCommercialTerms({id:'commercial_fixture',version:'1',environment,approvalRef:'SYNTHETIC_ONLY',effectiveAt:new Date(TRACKING_NOW-86400000).toISOString(),expiresAt:new Date(TRACKING_NOW+10*86400000).toISOString(),feeScheduleId:'fee_fixture',feeScheduleVersion:'1',feeScheduleApprovalRef:'SYNTHETIC_ONLY',termsRefs:{feeTermsRef:'fixture_fee',returnsTermsRef:'fixture_returns',transferTermsRef:'fixture_transfer',payoutTermsRef:'fixture_payout'}},context);
  const fulfillmentPolicy={environment,id:'policy_fixture',version:'1',approvalRef:'SYNTHETIC_ONLY',packingProtocolRef:'fixture_packing',coverageTermsRef:'fixture_coverage',returnsTermsRef:'fixture_returns',appealsTermsRef:'fixture_appeals',transferTermsRef:'fixture_transfer',returnWindowMs:86400000,missingScanAfterMs:60000,commercialTerms:clone(terms)};
  const listingPolicy={id:fulfillmentPolicy.id,version:'1',environment,fulfillmentPolicy},financePolicy={environment:'stripe-sandbox'};
  f.store.transaction(tx=>{Object.assign(tx.state.orders.order_one,{policy:listingPolicy,policyVersion:'1',buyerId:buyer.id,connectedAccountId:'acct_SYNTHETIC_SELLER'});tx.state.financeOrders={order_one:{confirmed:true,blocked:false,connectedAccountId:'acct_SYNTHETIC_SELLER'}};});
  const finance={creates:0,accountReads:0,onAccount:null};
  const provider={async getAccount(){finance.accountReads++;if(finance.onAccount)await finance.onAccount(finance.accountReads);return {};},async create(){finance.creates++;throw new Error('NO_FINANCIAL_EFFECT_EXPECTED');}};
  const options={enabled:true,environment,context,store:f.store,shippingLifecycle:f.lifecycle,provider,platformAccountId,listingPolicy,financePolicy,fulfillmentPolicy,clock:()=>f.control.now,validateEvidence:async()=>true,assertRuntimeReady:()=>true,runtimeApproval:{approved:true,binding:{environment,platformAccountId,listingPolicyHash:hash(listingPolicy),financePolicyHash:hash(financePolicy),fulfillmentPolicyHash:hash(fulfillmentPolicy),qualificationRefs:context.qualificationRefs}}};
  const service=createMarketplacePilot(options);
  const row=await service.retainIssuedShipment(staff,f.input);
  const evidence={environment,orderId:'order_one',cardId:f.order.cardId,ref:'physical_fixture'};
  for(const field of ['intakeFrontRef','intakeBackRef','holderConditionRef','packingPhotoRef','fittedInsertRef','firstSealRef','secondSealRef','cleanLabelAreaRef','resaleInstructionsRef','replacementKitRef','releaseReviewRef'])evidence[field]='fixture_'+field;
  await service.fulfill(staff,{requestId:'pack_fixture',orderId:'order_one',action:'PACK',evidence});
  f.control.tracking={tracking_number:f.input.trackingNumber,status_code:'DE',actual_delivery_date:new Date(TRACKING_NOW-1000).toISOString(),events:[f.event('AC',TRACKING_NOW-2000),f.event('DE',TRACKING_NOW-1000)]};
  f.control.now+=30*3600000;await service.syncShipmentTracking(staff,{shipmentKey:row.shipmentKey});
  return {...f,service,options,finance,evidence,row,context};
}

test('service derives original carrier acceptance and actual delivery; arbitrary evidence and buyer calls fail',async t=>{
  const f=await fixture(t),request={orderId:'order_one',requestId:'dispatch_fixture',action:'DISPATCH'};
  await assert.rejects(f.service.recordCarrierMilestone(buyer,request),{code:'FORBIDDEN'});
  await assert.rejects(f.service.shipmentStatus(buyer,{orderId:'order_one'}),{code:'FORBIDDEN'});
  await assert.rejects(f.service.fulfill(staff,{...request,evidence:{...f.evidence,dispatchedAt:f.control.now}}),{code:'SHIPPING_MILESTONE_EVIDENCE_CHANGED'});
  // Even a direct service caller cannot inject timestamp/proof fields into this API.
  const dispatch=await f.service.recordCarrierMilestone(staff,{...request,evidence:{dispatchedAt:0}});
  assert.equal(dispatch.dispatchedAt,TRACKING_NOW-2000);assert.equal(dispatch.dispatchObservedAt,f.control.now);
  const delivery=await f.service.recordCarrierMilestone(staff,{requestId:'delivery_fixture',orderId:'order_one',action:'DELIVER',evidence:{deliveredAt:f.control.now}});
  assert.equal(delivery.deliveredAt,TRACKING_NOW-1000);assert.equal(delivery.deliveryObservedAt,f.control.now);
  assert.equal(delivery.releaseNotBefore,TRACKING_NOW-1000+86400000);
  const retained=delivery.history.find(row=>row.action==='DELIVER').evidence;
  await assert.rejects(f.service.fulfill(staff,{requestId:'arbitrary_delivery',orderId:'order_one',action:'DELIVER',evidence:{...retained,deliveredAt:f.control.now}}),{code:'SHIPPING_MILESTONE_EVIDENCE_CHANGED'});
  assert.equal(f.finance.creates,0);assert.ok(f.control.calls.every(row=>row.method==='GET'));
});

test('carrier regression holds release and original transfer recovery, including after an awaited account read',async t=>{
  const f=await fixture(t);for(const action of ['DISPATCH','DELIVER'])await f.service.recordCarrierMilestone(staff,{requestId:'milestone_'+action,orderId:'order_one',action});
  const before=clone(f.store.read().fulfillment.order_one);
  f.control.tracking={tracking_number:f.input.trackingNumber,status_code:'IT',actual_delivery_date:null,events:[f.event('IT',TRACKING_NOW)]};
  await f.service.syncShipmentTracking(staff,{shipmentKey:f.row.shipmentKey});
  await assert.rejects(f.service.fulfill(staff,{requestId:'release_held',orderId:'order_one',action:'RELEASE',evidence:f.evidence}),{code:'SHIPPING_RECONCILIATION_REQUIRED'});
  assert.deepEqual(f.store.read().fulfillment.order_one,before);
  await assert.rejects(f.service.resumeTransfer(staff,{orderId:'order_one'}),{code:'SHIPPING_RECONCILIATION_REQUIRED'});
  assert.equal(f.finance.creates,0);

  const race=await fixture(t);for(const action of ['DISPATCH','DELIVER'])await race.service.recordCarrierMilestone(staff,{requestId:'race_'+action,orderId:'order_one',action});
  const transferId=intentId('transfer','order_one',race.context);
  // Seed a prepared original finance intent. The shipping claim gate must refuse
  // it before finance's durable claim/create when an awaited read sees regression.
  race.store.transaction(tx=>{const fulfillment=tx.state.fulfillment.order_one;fulfillment.status='RELEASED';fulfillment.releaseEvidence={approved:true,orderId:'order_one'};tx.state.intents[transferId]={id:transferId,orderId:'order_one',kind:'TRANSFER',status:'PREPARED',connectedAccountId:'acct_SYNTHETIC_SELLER',releaseEvidence:clone(fulfillment.releaseEvidence),dispatchCount:0};});
  race.finance.onAccount=async count=>{if(count===2){race.control.tracking={tracking_number:race.input.trackingNumber,status_code:'IT',actual_delivery_date:null,events:[race.event('IT',TRACKING_NOW)]};await race.service.syncShipmentTracking(staff,{shipmentKey:race.row.shipmentKey});}};
  await assert.rejects(race.service.resumeTransfer(staff,{orderId:'order_one'}),{code:'SHIPPING_RECONCILIATION_REQUIRED'});
  assert.equal(race.finance.accountReads,2);assert.equal(race.finance.creates,0);
  assert.equal(race.store.read().intents[transferId].status,'PREPARED');assert.equal(race.store.read().intents[transferId].dispatchCount,0);
});


test('retained shipping requirements survive reconstruction without the shipping port',async t=>{
  const f=await fixture(t);for(const action of ['DISPATCH','DELIVER'])await f.service.recordCarrierMilestone(staff,{requestId:'retained_'+action,orderId:'order_one',action});
  f.control.tracking={tracking_number:f.input.trackingNumber,status_code:'IT',actual_delivery_date:null,events:[f.event('IT',TRACKING_NOW)]};await f.service.syncShipmentTracking(staff,{shipmentKey:f.row.shipmentKey});
  const reconstructed=createMarketplacePilot({...f.options,shippingLifecycle:undefined});
  await assert.rejects(reconstructed.fulfill(staff,{requestId:'omitted_release',orderId:'order_one',action:'RELEASE',evidence:f.evidence}),{code:'SHIPPING_LIFECYCLE_BINDING_MISMATCH'});
  await assert.rejects(reconstructed.resumeTransfer(staff,{orderId:'order_one'}),{code:'SHIPPING_LIFECYCLE_BINDING_MISMATCH'});assert.equal(f.finance.creates,0);
});
