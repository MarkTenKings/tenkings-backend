import test from 'node:test';
import assert from 'node:assert/strict';
import {clone,hash} from '../src/contract.mjs';
import {createPilotCommercialTerms,applyPilotCommercialTerms,PILOT_RETURN_WINDOW_MS} from '../src/pilot-commercial-terms.mjs';
import {createApprovedFeeCalculator,calculateSellerFee} from '../src/fee-policy.mjs';
import {createListing,reviseListing} from '../src/listing.mjs';
import {openLocalStore} from '../src/store.mjs';
import {recordFulfillment,openProtectionCase,resolveProtectionCase,reviewReturnRequest} from '../src/fulfillment.mjs';
import {makeSyntheticPolicy,makeListingInput,makeTestTx,FIXTURE_NOW} from './listing-fixtures.mjs';

// All references and approvals here are isolated fixture evidence, not owner
// approval records, a physical card, an account or runtime activation.
function input(){return {id:'demo_commercial',version:'fixture-v1',environment:'SYNTHETIC_LOCAL',approvalRef:'demo_commercial_approval',effectiveAt:new Date(FIXTURE_NOW-1000).toISOString(),expiresAt:new Date(FIXTURE_NOW+864000000).toISOString(),feeScheduleId:'demo_fee_schedule',feeScheduleVersion:'fixture-v1',feeScheduleApprovalRef:'demo_fee_approval',termsRefs:{feeTermsRef:'demo_fee_terms',returnsTermsRef:'demo_returns',transferTermsRef:'demo_transfer',payoutTermsRef:'demo_payout'}};}
function policies(){return {listingPolicy:makeSyntheticPolicy(),fulfillmentPolicy:{environment:'SYNTHETIC_LOCAL',id:'demo_policy',version:'synthetic-v1',approvalRef:'demo_existing_fulfillment_approval',packingProtocolRef:'demo_packing',coverageTermsRef:'demo_coverage',returnsTermsRef:'demo_returns',appealsTermsRef:'demo_appeals',transferTermsRef:'demo_transfer',returnWindowMs:1000,missingScanAfterMs:100}};}

test('pilot terms require supplied identities, dates and references and freeze the exact owner-selected fee and return decisions',()=>{
  const source=input(),terms=createPilotCommercialTerms(source);
  assert.deepEqual(terms.feeSchedule.tiers,[{upToCents:null,rateBps:800,fixedCents:0}]);
  for(const [key,value] of Object.entries({basis:'ITEM_PRICE',tierMode:'VOLUME',rounding:'HALF_UP',processing:'INCLUDED',minimumCents:null,maximumCents:null}))assert.equal(terms.feeSchedule[key],value);
  assert.deepEqual(terms.fees,{listingFeeCents:0,buyerPremiumCents:0,standardWithdrawalRateBps:0});
  assert.equal(terms.returns.returnWindowMs,86400000);assert.equal(terms.returns.status,'OWNER_TERMS_SELECTED');assert.deepEqual(terms.returns.eligibleReasons,['SEVERE_DAMAGE','WRONG_PRODUCT']);assert.equal(terms.returns.returnShippingPayer,'ATLAS_INITIALLY');assert.equal(terms.returns.finalResponsibility,'STAFF_REVIEW');
  assert.equal(terms.returns.startsAt,'ACTUAL_DELIVERY');assert.equal(terms.returns.requiresBuyerEvidence,true);assert.equal(terms.returns.requiresStaffReview,true);
  assert.deepEqual(terms.pendingDecisions,[]);assert.equal(terms.enabled,undefined);
  const {termsHash,...content}=terms;assert.equal(termsHash,hash(content));assert.throws(()=>{terms.feeSchedule.tiers[0].rateBps=900;},TypeError);
  source.termsRefs.feeTermsRef='changed';assert.equal(terms.termsRefs.feeTermsRef,'demo_fee_terms');
  for(const key of Object.keys(input())){const bad=input();delete bad[key];assert.throws(()=>createPilotCommercialTerms(bad),{code:'PILOT_TERMS_INPUT_REQUIRED'});}
  for(const key of Object.keys(input().termsRefs)){const bad=input();delete bad.termsRefs[key];assert.throws(()=>createPilotCommercialTerms(bad),{code:'PILOT_TERMS_REFERENCE_REQUIRED'});}
  assert.throws(()=>createPilotCommercialTerms({...input(),buyerPremiumCents:1}),{code:'PILOT_TERMS_INPUT_REQUIRED'});
  assert.throws(()=>createPilotCommercialTerms({...input(),expiresAt:input().effectiveAt}),{code:'PILOT_TERMS_TIME_INVALID'});
  assert.throws(()=>createPilotCommercialTerms({...input(),environment:'PRODUCTION'}),{code:'PILOT_TERMS_ENVIRONMENT_MISMATCH'});
});

test('application preserves supplied policies and unrelated physical requirements; mismatched or changed terms refuse',()=>{
  const source=policies(),saved=clone(source),terms=createPilotCommercialTerms(input()),result=applyPilotCommercialTerms({terms,...source});
  assert.deepEqual(source,saved);assert.equal(result.listingPolicy.feeCents,undefined);assert.equal(result.listingPolicy.feeSchedule.disclosure,result.listingPolicy.feeDisclosure);
  assert.equal(result.fulfillmentPolicy.returnWindowMs,PILOT_RETURN_WINDOW_MS);assert.equal(result.fulfillmentPolicy.packingProtocolRef,saved.fulfillmentPolicy.packingProtocolRef);assert.equal(result.listingPolicy.protectionTerms,saved.listingPolicy.protectionTerms);
  assert.equal(result.listingPolicy.fulfillmentPolicy,result.fulfillmentPolicy);assert.equal(result.listingPolicy.commercialTerms.termsHash,terms.termsHash);
  assert.match(result.listingPolicy.returnsTerms,/ATLAS initially pays return shipping/);assert.match(result.listingPolicy.payoutTerms,/No percentage fee for standard withdrawals/);
  assert.throws(()=>{result.fulfillmentPolicy.commercialTerms.returns.eligibleReasons=['anything'];},TypeError);
  assert.throws(()=>applyPilotCommercialTerms({terms,...source,fulfillmentPolicy:{...source.fulfillmentPolicy,version:'different'}}),{code:'PILOT_POLICY_BINDING_MISMATCH'});
  assert.throws(()=>applyPilotCommercialTerms({terms,...source,fulfillmentPolicy:{...source.fulfillmentPolicy,returnsTermsRef:'demo_other'}}),{code:'PILOT_TERMS_REFERENCE_MISMATCH'});
  const changed=clone(terms);changed.feeSchedule.tiers[0].rateBps=900;assert.throws(()=>applyPilotCommercialTerms({terms:changed,...source}),{code:'PILOT_TERMS_CHANGED'});
});

test('actual preview, listing and revision use card-only 8 percent including processing and safe HALF_UP integer cents',()=>{
  const terms=createPilotCommercialTerms(input()),{listingPolicy}=applyPilotCommercialTerms({terms,...policies()});
  const calculator=createApprovedFeeCalculator({enabled:true,schedule:terms.feeSchedule,approvalRef:'demo_calculator_approval',assertReady:()=>true,clock:()=>FIXTURE_NOW});
  for(const [price,fee] of [[1,0],[6,0],[7,1],[19,2],[10000,800],[12500,1000],[12501,1000],[12507,1001]])assert.deepEqual(calculateSellerFee(terms.feeSchedule,price),{feeCents:fee,sellerNetCents:price-fee,tierIndex:0});
  const large=Number.MAX_SAFE_INTEGER,numerator=BigInt(large)*800n;assert.equal(calculateSellerFee(terms.feeSchedule,large).feeCents,Number((numerator+5000n)/10000n));
  const tx=makeTestTx(),listingInput=makeListingInput({policy:listingPolicy}),feeQuote=calculator.preview({policy:listingPolicy,cardId:'demo_card',sellerId:'demo_seller',askingPriceCents:12500});
  const listing=createListing(tx,{...listingInput,feeQuote});assert.equal(listing.feeCents,1000);assert.equal(listing.sellerNetCents,11500);assert.equal(listing.policy.fulfillmentPolicy.returnWindowMs,86400000);
  const revisionQuote=calculator.preview({policy:listingPolicy,cardId:'demo_card',sellerId:'demo_seller',askingPriceCents:10000,listingId:listing.id,listingVersion:listing.version,listingHash:listing.bindingHash});
  const revision=reviseListing(tx,{requestId:'demo_revision',listingId:listing.id,sellerId:'demo_seller',expectedVersion:listing.version,expectedBindingHash:listing.bindingHash,askingPriceCents:10000,eligibility:listingInput.eligibility,feeQuote:revisionQuote});
  assert.equal(revision.feeCents,800);assert.equal(revision.sellerNetCents,9200);assert.equal(revision.policy.commercialTerms.fees.buyerPremiumCents,0);
  assert.throws(()=>createApprovedFeeCalculator().preview({}),{code:'FEE_CALCULATOR_UNAVAILABLE'});
});

test('actual fulfillment holds proceeds for 24 hours plus case clearance and staff review',()=>{
  const {listingPolicy,fulfillmentPolicy}=applyPilotCommercialTerms({terms:createPilotCommercialTerms(input()),...policies()});let now=FIXTURE_NOW;
  const store=openLocalStore({filename:':memory:',environment:'SYNTHETIC_LOCAL',clock:()=>now}),actor={id:'demo_staff',role:'STAFF'};
  const evidence=action=>Object.fromEntries([['environment','SYNTHETIC_LOCAL'],['orderId','demo_order'],['cardId','demo_card'],['ref',`demo_${action}`],...['intakeFrontRef','intakeBackRef','holderConditionRef','packingPhotoRef','fittedInsertRef','firstSealRef','secondSealRef','cleanLabelAreaRef','resaleInstructionsRef','replacementKitRef','carrierRef','trackingRef','coverageRef','dispatchReceiptRef','deliveryProofRef','releaseReviewRef','receivedParcelRef','inspectionFrontRef','inspectionBackRef','holderInspectionRef'].map(key=>[key,`demo_${key}`])]);
  const run=(action,extra={})=>store.transaction(tx=>recordFulfillment(tx,{requestId:`demo_${action}`,orderId:'demo_order',action,actor,policy:fulfillmentPolicy,evidence:evidence(action),...extra}));
  try{
    store.transaction(tx=>{tx.state.orders.demo_order={orderId:'demo_order',cardId:'demo_card',buyerId:'demo_buyer',sellerId:'demo_seller',paymentIntentId:'demo_payment',bindingHash:'original',policyVersion:listingPolicy.version,policy:clone(listingPolicy)};tx.state.intents.demo_payment={kind:'PAYMENT',status:'SUCCEEDED',confirmed:true,orderId:'demo_order',bindingHash:'original'};(tx.state.financeOrders??={}).demo_order={confirmed:true,blocked:false};});
    run('PACK');run('DISPATCH');const delivered=run('DELIVER',{evidence:{...evidence('DELIVER'),deliveredAt:now}});assert.equal(delivered.releaseNotBefore,FIXTURE_NOW+86400000);
    now=delivered.releaseNotBefore-1;assert.throws(()=>run('RELEASE'),{code:'PROTECTION_HOLD'});
    const open=()=>store.transaction(tx=>openProtectionCase(tx,{requestId:'demo_return_request',caseId:'demo_return',orderId:'demo_order',kind:'RETURN',returnReason:'SEVERE_DAMAGE',actor:{id:'demo_buyer',role:'BUYER'},evidenceRef:'demo_return_evidence'}));open();
    now=delivered.releaseNotBefore;assert.throws(()=>run('RELEASE'),{code:'PROTECTION_HOLD'});
    store.transaction(tx=>reviewReturnRequest(tx,{requestId:'demo_return_approval',orderId:'demo_order',caseId:'demo_return',actor,decision:'APPROVE',reviewRef:'demo_review_evidence'}));
    store.transaction(tx=>resolveProtectionCase(tx,{requestId:'demo_case_resolve',orderId:'demo_order',caseId:'demo_return',actor,outcome:'NO_REFUND_DUE',evidence:evidence('resolve')}));
    assert.throws(()=>run('RELEASE',{actor:{id:'demo_buyer',role:'BUYER'}}),{code:'FORBIDDEN'});
    const noReview=evidence('RELEASE');delete noReview.releaseReviewRef;assert.throws(()=>run('RELEASE',{evidence:noReview}));
    assert.equal(run('RELEASE').status,'RELEASED');now++;
    assert.throws(()=>store.transaction(tx=>openProtectionCase(tx,{requestId:'demo_late_request',caseId:'demo_late_return',orderId:'demo_order',kind:'RETURN',returnReason:'SEVERE_DAMAGE',actor:{id:'demo_buyer',role:'BUYER'},evidenceRef:'demo_late_evidence'})),{code:'RETURN_WINDOW_CLOSED'});
  }finally{store.close();}
});
