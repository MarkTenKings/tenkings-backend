import test from 'node:test';
import assert from 'node:assert/strict';
import {openLocalStore} from '../src/store.mjs';
import {createMarketplacePilot,intentId} from '../src/service.mjs';
import {createApprovedFeeCalculator} from '../src/fee-policy.mjs';
import {createPilotCommercialTerms,applyPilotCommercialTerms} from '../src/pilot-commercial-terms.mjs';
import {actors,createLocalFixture,syntheticFulfillmentEvidence} from '../scripts/local-fixture.mjs';
import {FIXTURE_NOW} from './listing-fixtures.mjs';

test('joined return review preserves other holds, private buyer evidence and the actual 24-hour release deadline',async t=>{
  let now=FIXTURE_NOW;
  const store=openLocalStore({filename:':memory:',environment:'SYNTHETIC_LOCAL',clock:()=>now});t.after(()=>store.close());
  const fixture=createLocalFixture({store,clock:()=>now,assets:false});
  const terms=createPilotCommercialTerms({id:'demo_commercial',version:'fixture-v1',environment:'SYNTHETIC_LOCAL',approvalRef:'demo_owner_fixture',effectiveAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+864000000).toISOString(),feeScheduleId:'demo_fee_schedule',feeScheduleVersion:'fixture-v1',feeScheduleApprovalRef:'demo_fee_approval',termsRefs:{feeTermsRef:'demo_fee_terms',returnsTermsRef:fixture.fulfillmentPolicy.returnsTermsRef,transferTermsRef:fixture.fulfillmentPolicy.transferTermsRef,payoutTermsRef:'demo_payout_terms'}});
  const policies=applyPilotCommercialTerms({terms,listingPolicy:fixture.listingPolicy,fulfillmentPolicy:fixture.fulfillmentPolicy});
  const feeCalculator=createApprovedFeeCalculator({enabled:true,schedule:terms.feeSchedule,approvalRef:'demo_calculator_approval',assertReady:()=>true,clock:()=>now});
  const service=createMarketplacePilot({...fixture,...policies,feeCalculator,enabled:true,environment:'SYNTHETIC_LOCAL',store,platformAccountId:'demo_platform',clock:()=>now});
  await service.recordConsent(actors.seller,{requestId:'demo_consent',cardId:'demo_card',choice:'HOLD_AND_LIST',evidenceRef:'demo_hold_consent'});
  const fee=await service.previewListingFee(actors.seller,{cardId:'demo_card',askingPriceCents:10000});
  const listing=await service.publishListing(actors.seller,{requestId:'demo_listing',cardId:'demo_card',askingPriceCents:10000,feeQuoteId:fee.id});
  assert.equal(listing.feeCents,800);
  const quote=await service.quote(actors.buyer,listing.id);
  const reservation=await service.reserve(actors.buyer,{requestId:'demo_reserve',listingId:listing.id,listingVersion:listing.version,listingHash:listing.bindingHash,quoteId:quote.quoteId});
  await service.pay(actors.buyer,{reservationId:reservation.id});
  fixture.provider.resolve(intentId('payment',reservation.id),{status:'succeeded'});
  const order=await service.reconcilePayment(actors.buyer,{reservationId:reservation.id});
  for(const action of ['PACK','DISPATCH'])await service.fulfill(actors.staff,{requestId:`demo_${action}`,orderId:order.orderId,action,evidence:syntheticFulfillmentEvidence(order,action)});
  const deliveredAt=now+3600000;now+=7200000;
  await service.fulfill(actors.staff,{requestId:'demo_DELIVER',orderId:order.orderId,action:'DELIVER',evidence:{...syntheticFulfillmentEvidence(order,'DELIVER'),deliveredAt}});
  const open=(id,returnReason)=>service.openCase(actors.buyer,{requestId:id,caseId:id,orderId:order.orderId,kind:'RETURN',returnReason,evidenceRef:`demo_private_proof_${id}`});
  await open('demo_damage','SEVERE_DAMAGE');await open('demo_wrong','WRONG_PRODUCT');
  const review=(caseId,decision)=>service.reviewReturn(actors.staff,{requestId:`demo_review_${caseId}`,orderId:order.orderId,caseId,decision,reviewRef:`demo_staff_private_${caseId}`});
  await assert.rejects(service.reviewReturn(actors.buyer,{requestId:'demo_bad_review',orderId:order.orderId,caseId:'demo_damage',decision:'APPROVE',reviewRef:'demo_ref'}),{code:'FORBIDDEN'});
  await review('demo_damage','APPROVE');await review('demo_wrong','DENY');await review('demo_wrong','DENY');
  let state=store.read();assert.equal(state.financeHolds.demo_damage.active,true);assert.equal(state.financeHolds.demo_wrong.active,false);assert.equal(state.financeOrders[order.orderId].blocked,true);
  for(const actor of [actors.buyer,actors.seller]){
    const workspace=await service.workspace(actor),serialized=JSON.stringify(workspace);
    assert.ok(!serialized.includes('demo_private_proof_'));assert.ok(!serialized.includes('demo_staff_private_'));
    assert.equal(workspace.orders[0].returnPolicy.returnWindowMs,86400000);
    assert.equal(workspace.orders[0].returnPolicy.approvalRef,undefined);
  }
  assert.match(JSON.stringify(await service.workspace(actors.staff)),/demo_private_proof_demo_damage/);
  await service.resolveCase(actors.staff,{requestId:'demo_inspected',orderId:order.orderId,caseId:'demo_damage',outcome:'NO_REFUND_DUE',evidence:{orderId:order.orderId,cardId:order.cardId,ref:'demo_resolution',receivedParcelRef:'demo_received',inspectionFrontRef:'demo_front',inspectionBackRef:'demo_back',holderInspectionRef:'demo_holder'}});
  state=store.read();assert.equal(state.financeOrders[order.orderId].blocked,false);
  const release=()=>service.fulfill(actors.staff,{requestId:'demo_RELEASE',orderId:order.orderId,action:'RELEASE',evidence:syntheticFulfillmentEvidence(order,'RELEASE')});
  now=deliveredAt+86400000-1;await assert.rejects(release(),{code:'PROTECTION_HOLD'});
  now++;await assert.rejects(open('demo_late','SEVERE_DAMAGE'),{code:'RETURN_WINDOW_CLOSED'});await release();
  state=store.read();assert.equal(state.fulfillment[order.orderId].status,'RELEASED');assert.equal(state.intents[intentId('transfer',order.orderId)].dispatchCount,1);
});
