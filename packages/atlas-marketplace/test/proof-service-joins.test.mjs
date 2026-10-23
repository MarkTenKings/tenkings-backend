import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {openLocalStore} from '../src/store.mjs';
import {createMarketplacePilot,intentId} from '../src/service.mjs';
import {createApprovedFeeCalculator} from '../src/fee-policy.mjs';
import {createPilotCommercialTerms,applyPilotCommercialTerms} from '../src/pilot-commercial-terms.mjs';
import {createEncryptedProofStorage} from '../src/proof-storage.mjs';
import {createProofImageValidator} from '../src/proof-image.mjs';
import {createMarketplaceProofIntake} from '../src/proof-intake.mjs';
import {actors,createLocalFixture,syntheticFulfillmentEvidence} from '../scripts/local-fixture.mjs';
import {FIXTURE_NOW} from './listing-fixtures.mjs';
import {image,digest} from './proof-fixtures.mjs';

// Synthetic authority and finance only. The image decoder, encrypted filesystem,
// durable order state, service joins and immutable originals are real local code.
async function paidFixture(t){
  let now=FIXTURE_NOW,reviewerAllowed=true;
  const directory=mkdtempSync(join(realpathSync(tmpdir()),'atlas-proof-service-'));
  mkdirSync(join(directory,'objects'),{mode:0o700});
  const store=openLocalStore({filename:join(directory,'state.sqlite'),environment:'SYNTHETIC_LOCAL',clock:()=>now});
  const fixture=createLocalFixture({store,clock:()=>now,assets:false});
  const terms=createPilotCommercialTerms({id:'demo_commercial',version:'fixture-v1',environment:'SYNTHETIC_LOCAL',approvalRef:'demo_owner_fixture',effectiveAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+864000000).toISOString(),feeScheduleId:'demo_fee_schedule',feeScheduleVersion:'fixture-v1',feeScheduleApprovalRef:'demo_fee_approval',termsRefs:{feeTermsRef:'demo_fee_terms',returnsTermsRef:fixture.fulfillmentPolicy.returnsTermsRef,transferTermsRef:fixture.fulfillmentPolicy.transferTermsRef,payoutTermsRef:'demo_payout_terms'}});
  const policies=applyPilotCommercialTerms({terms,listingPolicy:fixture.listingPolicy,fulfillmentPolicy:fixture.fulfillmentPolicy});
  const feeCalculator=createApprovedFeeCalculator({enabled:true,schedule:terms.feeSchedule,approvalRef:'demo_calculator_approval',assertReady:()=>true,clock:()=>now});
  const policy={id:'demo_proof_policy',version:'demo_proof_v1',environment:'SYNTHETIC_LOCAL',approvalRef:'SYNTHETIC_APPROVAL_ONLY',retentionRef:'SYNTHETIC_RETENTION_ONLY',reviewerAuthorityRef:'SYNTHETIC_REVIEWER_AUTHORITY_ONLY',effectiveAt:now-1000,expiresAt:now+30*86400000,retentionMs:7*86400000,maxObjectBytes:10485760,maxProofsPerOrder:20,maxRetainedObjects:100,uploadTtlMs:300000,validationLeaseMs:30000};
  const storage=createEncryptedProofStorage({directory:join(directory,'objects'),encryptionKey:randomBytes(32),keyId:'demo_test_key',storageId:'demo_test_storage',environment:'SYNTHETIC_LOCAL',retentionRef:policy.retentionRef});
  const validator=createProofImageValidator();
  const proofIntake=createMarketplaceProofIntake({enabled:true,store,storage,validator,policy,clock:()=>now,assertReady:()=>true,authorize:(_actor,scope)=>scope.action!=='REVIEW'||reviewerAllowed});
  t.after(async()=>{await validator.close();storage.close();store.close();rmSync(directory,{recursive:true,force:true});});
  const service=createMarketplacePilot({...fixture,...policies,feeCalculator,proofIntake,enabled:true,environment:'SYNTHETIC_LOCAL',store,platformAccountId:'demo_platform',clock:()=>now});
  await service.recordConsent(actors.seller,{requestId:'demo_consent',cardId:'demo_card',choice:'HOLD_AND_LIST',evidenceRef:'demo_hold_consent'});
  const fee=await service.previewListingFee(actors.seller,{cardId:'demo_card',askingPriceCents:10000});
  const listing=await service.publishListing(actors.seller,{requestId:'demo_listing',cardId:'demo_card',askingPriceCents:10000,feeQuoteId:fee.id});
  assert.equal(listing.feeCents,800);
  const quote=await service.quote(actors.buyer,listing.id);
  const reservation=await service.reserve(actors.buyer,{requestId:'demo_reserve',listingId:listing.id,listingVersion:listing.version,listingHash:listing.bindingHash,quoteId:quote.quoteId});
  await service.pay(actors.buyer,{reservationId:reservation.id});
  fixture.provider.resolve(intentId('payment',reservation.id),{status:'succeeded'});
  const order=await service.reconcilePayment(actors.buyer,{reservationId:reservation.id});
  const bytes=await image();
  const f={store,service,order,provider:fixture.provider,bytes,get now(){return now;},set now(value){now=value;},set reviewerAllowed(value){reviewerAllowed=value;},
    async retain(purpose,actor=actors.staff){
      const plan=await service.prepareProof(actor,{requestId:'demo_upload_'+purpose,orderId:order.orderId,purpose,declaredType:'image/png',byteCount:bytes.length,sha256:digest(bytes)});
      return service.uploadProof(actor,{uploadId:plan.uploadId,bytes});
    },
    approve(proof){return service.reviewProof(actors.staff,{requestId:'demo_approve_'+proof.purpose,proofId:proof.proofId,decision:'APPROVE',reviewRef:'demo_actual_review_'+proof.purpose});},
    evidence(action,proof){const evidence=syntheticFulfillmentEvidence(order,action);for(const key of Object.keys(evidence))if(key==='ref'||key.endsWith('Ref'))evidence[key]=proof.proofId;return evidence;},
    fulfill(action,evidence){return service.fulfill(actors.staff,{requestId:'demo_'+action,orderId:order.orderId,action,evidence});},
    openReturn(proof,returnReason='SEVERE_DAMAGE'){return service.openCase(actors.buyer,{requestId:'demo_return',caseId:'demo_return',orderId:order.orderId,kind:'RETURN',returnReason,evidenceRef:proof.proofId});},
    reviewReturn(proof){return service.reviewReturn(actors.staff,{requestId:'demo_return_decision',orderId:order.orderId,caseId:'demo_return',decision:'APPROVE',reviewRef:proof.proofId});},
    inspection(proof){return {orderId:order.orderId,cardId:order.cardId,ref:proof.proofId,receivedParcelRef:proof.proofId,inspectionFrontRef:proof.proofId,inspectionBackRef:proof.proofId,holderInspectionRef:proof.proofId};},
    async deliver(){
      const packing=await this.retain('PACK');await this.approve(packing);await this.fulfill('PACK',this.evidence('PACK',packing));
      await this.fulfill('DISPATCH',syntheticFulfillmentEvidence(order,'DISPATCH'));
      const deliveredAt=now+3600000;now+=7200000;
      await this.fulfill('DELIVER',{...syntheticFulfillmentEvidence(order,'DELIVER'),deliveredAt});return deliveredAt;
    }
  };
  return f;
}

test('paid service requires retained reviewed packing, private buyer originals and separate reviewed return inspection before exact-deadline release',async t=>{
  const f=await paidFixture(t),{service,store,order}=f;
  await assert.rejects(f.fulfill('PACK',syntheticFulfillmentEvidence(order,'PACK')),{code:'PROOF_UNAVAILABLE'});
  const packing=await f.retain('PACK');
  await assert.rejects(f.fulfill('PACK',f.evidence('PACK',packing)),{code:'PROOF_REVIEW_REQUIRED'});
  f.reviewerAllowed=false;await assert.rejects(f.approve(packing),{code:'PROOF_ACCESS_REFUSED'});
  f.reviewerAllowed=true;await f.approve(packing);await f.fulfill('PACK',f.evidence('PACK',packing));
  assert.equal(store.read(s=>s.fulfillment[order.orderId].status),'PACKED');
  await f.fulfill('DISPATCH',syntheticFulfillmentEvidence(order,'DISPATCH'));
  const deliveredAt=f.now+3600000;f.now+=7200000;
  await f.fulfill('DELIVER',{...syntheticFulfillmentEvidence(order,'DELIVER'),deliveredAt});
  await assert.rejects(f.openReturn({proofId:'demo_self_asserted_photo'}),{code:'PROOF_UNAVAILABLE'});
  const photo=await f.retain('RETURN_REQUEST',actors.buyer);
  assert.equal(photo.reviewStatus,'NOT_REVIEWED');
  await assert.rejects(service.readProof(actors.seller,{proofId:photo.proofId}),{code:'FORBIDDEN'});
  await assert.rejects(service.readProof(actors.alternateBuyer,{proofId:photo.proofId}),{code:'PROOF_ACCESS_REFUSED'});
  assert.ok((await service.readProof(actors.buyer,{proofId:photo.proofId})).bytes.equals(f.bytes));
  await f.openReturn(photo);
  let state=store.read();assert.equal(state.fulfillment[order.orderId].cases[0].returnReview,null);assert.equal(state.financeOrders[order.orderId].blocked,true);
  const reviewed=await f.retain('RETURN_REVIEW');
  await assert.rejects(f.reviewReturn(reviewed),{code:'PROOF_REVIEW_REQUIRED'});
  await f.approve(reviewed);await f.reviewReturn(reviewed);
  assert.equal(store.read(s=>s.financeHolds.demo_return.active),true);
  const inspection=await f.retain('RETURN_INSPECTION');
  const resolve=()=>service.resolveCase(actors.staff,{requestId:'demo_resolve_return',orderId:order.orderId,caseId:'demo_return',outcome:'NO_REFUND_DUE',evidence:f.inspection(inspection)});
  await assert.rejects(resolve(),{code:'PROOF_REVIEW_REQUIRED'});await f.approve(inspection);await resolve();
  assert.equal(store.read(s=>s.financeOrders[order.orderId].blocked),false);
  const release=await f.retain('RELEASE');await f.approve(release);
  f.now=deliveredAt+86400000-1;await assert.rejects(f.fulfill('RELEASE',f.evidence('RELEASE',release)),{code:'PROTECTION_HOLD'});
  f.now++;await f.fulfill('RELEASE',f.evidence('RELEASE',release));
  state=store.read();assert.equal(state.fulfillment[order.orderId].status,'RELEASED');assert.equal(state.intents[intentId('transfer',order.orderId)].dispatchCount,1);
  for(const actor of [actors.buyer,actors.seller]){
    const workspace=await service.workspace(actor),serialized=JSON.stringify(workspace);
    for(const id of [photo.proofId,reviewed.proofId,inspection.proofId])assert.equal(serialized.includes(id),false);
    assert.equal(workspace.orders[0].returnPolicy.returnWindowMs,86400000);
  }
  assert.deepEqual((await service.listProofs(actors.buyer,{orderId:order.orderId})).proofs.map(p=>p.proofId),[photo.proofId]);
});

test('wrong-product refund requires review proof, separate return approval, original finance reconciliation and reviewed inspection',async t=>{
  const f=await paidFixture(t),{service,store,order}=f;await f.deliver();
  const photo=await f.retain('RETURN_REQUEST',actors.buyer);await f.openReturn(photo,'WRONG_PRODUCT');
  const refundProof=await f.retain('REFUND_REVIEW');
  const request={orderId:order.orderId,caseId:'demo_return',amountCents:10000,allocations:{sellerCents:9200,feeCents:800,taxCents:0,shippingCents:0},reviewRef:refundProof.proofId};
  await assert.rejects(service.refundCase(actors.staff,request),{code:'PROOF_REVIEW_REQUIRED'});await f.approve(refundProof);
  await assert.rejects(service.refundCase(actors.staff,request),{code:'RETURN_REVIEW_REQUIRED'});
  const review=await f.retain('RETURN_REVIEW');await f.approve(review);await f.reviewReturn(review);
  const refund=await service.refundCase(actors.staff,request);
  const inspection=await f.retain('RETURN_INSPECTION');await f.approve(inspection);
  const resolve=()=>service.resolveCase(actors.staff,{requestId:'demo_refunded',orderId:order.orderId,caseId:'demo_return',outcome:'REFUND_REQUIRED',evidence:{...f.inspection(inspection),refundIntentId:refund.id}});
  await assert.rejects(resolve(),{code:'REFUND_RECONCILIATION_REQUIRED'});
  assert.equal(store.read(s=>s.financeHolds.demo_return.active),true);
  f.provider.resolve(refund.id,{status:'succeeded'});await service.reconcileRefund(actors.staff,{orderId:order.orderId,caseId:'demo_return'});await resolve();
  const state=store.read();assert.equal(state.financeHolds.demo_return.active,false);assert.equal(state.intents[refund.id].dispatchCount,1);assert.equal(state.intents[refund.id].confirmed,true);
  assert.equal(state.fulfillment[order.orderId].cases[0].outcome,'REFUND_REQUIRED');
});

test('configured photo intake leaves non-return appeal evidence on its existing synthetic external-compatible path',async t=>{
  const f=await paidFixture(t),{service,store,order}=f;
  await service.openCase(actors.seller,{requestId:'demo_appeal',caseId:'demo_appeal',orderId:order.orderId,kind:'APPEAL',evidenceRef:'demo_external_appeal'});
  assert.equal(store.read(s=>s.financeHolds.demo_appeal.active),true);
  await service.resolveCase(actors.staff,{requestId:'demo_appeal_rejected',orderId:order.orderId,caseId:'demo_appeal',outcome:'APPEAL_REJECTED',evidence:{orderId:order.orderId,cardId:order.cardId,ref:'demo_external_appeal_review'}});
  assert.equal(store.read(s=>s.financeHolds.demo_appeal.active),false);
  assert.equal(store.read(s=>Object.keys(s.marketplaceProofObjects??{}).length),0);
});
