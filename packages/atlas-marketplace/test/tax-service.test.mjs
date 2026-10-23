import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../src/contract.mjs';
import {createAuthorityContext} from '../src/authority-context.mjs';
import {createStripeTaxLifecycle} from '../src/tax-lifecycle.mjs';
import {createMarketplacePilot} from '../src/service.mjs';
import {createRecoverySettlementCapability} from '../src/recovery-settlement.mjs';
import {retainTaxRequirement,assertOrderTaxComplete,projectTaxReporting} from '../src/tax-obligations.mjs';
import {createMarketplaceHttpHandler} from '../src/http.mjs';
import {NOW,input,taxFixture} from './provider-quote-fixtures.mjs';
const staff={id:'22222222-2222-4222-8222-222222222222',role:'STAFF'},buyer={id:'11111111-1111-4111-8111-111111111111',role:'BUYER'};
async function fixture(){
 const f=taxFixture(),request=input('tax'),receipt=await f.adapter.quote(request),environment='PROVIDER_SANDBOX',platformAccountId='acct_SYNTHETIC';
 const context=createAuthorityContext({environment,evidenceOrigin:'https://fixture.invalid',evidencePathPrefixes:['/approved/'],qualificationRefs:{fingerprintRef:'SYNTHETIC_ONLY',titlePolicyRef:'SYNTHETIC_ONLY',marketplacePolicyRef:'SYNTHETIC_ONLY',evidenceContractRef:'SYNTHETIC_ONLY'}});
 const fulfillmentPolicy={environment,id:'policy_one',version:'1',approvalRef:'FIXTURE',packingProtocolRef:'FIXTURE',coverageTermsRef:'FIXTURE',returnsTermsRef:'FIXTURE',appealsTermsRef:'FIXTURE',transferTermsRef:'FIXTURE',missingScanAfterMs:1000,returnWindowMs:1000};
 const listingPolicy={id:'policy_one',version:'1',environment,fulfillmentPolicy},financePolicy={environment:'stripe-sandbox'};
 const capability=createRecoverySettlementCapability({enabled:true,store:f.store,environment,platformAccountId,approvalRef:'SYNTHETIC_SETTLEMENT',assertRuntimeReady:()=>true});
 const lifecycle=createStripeTaxLifecycle({enabled:true,store:f.store,taxAdapter:f.adapter,approvalRef:'SYNTHETIC_TAX_RECORD',assertReady:()=>true,clock:()=>NOW});
 let evidenceAllowed=true;
 const options={enabled:true,store:f.store,environment,context,platformAccountId,listingPolicy,financePolicy,fulfillmentPolicy,taxLifecycle:lifecycle,recoverySettlementCapability:capability,clock:()=>NOW,provider:{},assertRuntimeReady:()=>true,validateEvidence:async()=>evidenceAllowed,runtimeApproval:{approved:true,binding:{environment,platformAccountId,listingPolicyHash:hash(listingPolicy),financePolicyHash:hash(financePolicy),fulfillmentPolicyHash:hash(fulfillmentPolicy),qualificationRefs:context.qualificationRefs}}};
 const service=createMarketplacePilot(options);
 f.store.transaction(tx=>{tx.state.receipts={};tx.state.fulfillment={};tx.state.financeOrders={order_one:{confirmed:true}};
 const order=tx.state.orders.order_one={orderId:'order_one',cardId:'33333333-3333-4333-8333-333333333333',reservationId:'reservation_one',environment,status:'PAID',buyerId:buyer.id,bindingHash:request.listingHash,itemCents:10000,shippingCents:1200,taxCents:896,totalCents:12096,paymentIntentId:'payment_one',paymentObjectId:'pi_ORIGINAL',policyVersion:'1',policy:listingPolicy,quote:{taxQuoteRef:receipt.quoteRef,taxReceipt:receipt}};
 tx.state.intents.payment_one={id:'payment_one',orderId:'order_one',bindingHash:request.listingHash,kind:'PAYMENT',status:'SUCCEEDED',confirmed:true,platformAccountId,objectId:'pi_ORIGINAL',chargeId:'ch_ORIGINAL',order:{orderId:'order_one',bindingHash:request.listingHash},amountCents:12096,reconciledAt:NOW};
 retainTaxRequirement(tx,{reservation:{orderId:'order_one',quote:order.quote,order},binding:lifecycle.binding});});
 return {...f,service,options,capability,lifecycle,context,fulfillmentPolicy,revokeEvidence(){evidenceAllowed=false;},close(){f.adapter.close();}};
}
test('paid order remains paid during lost tax response; role-scoped original recovery unlocks fulfillment without another POST',async t=>{
 const f=await fixture();t.after(()=>f.close());f.provider.loseWriteResponse();
 const original=JSON.stringify(f.store.read().intents.payment_one);
 await assert.rejects(f.service.runTaxFollowup({},{}),{code:'RECOVERY_SETTLEMENT_UNAVAILABLE'});
 const run=await f.service.runTaxFollowup(f.capability,{limit:1});assert.equal(run.status,'REVIEW_REQUIRED');assert.equal(run.results[0].status,'UNKNOWN');
 assert.equal(JSON.stringify(f.store.read().intents.payment_one),original);assert.equal(f.store.read().orders.order_one.status,'PAID');
 const evidence={environment:'PROVIDER_SANDBOX',orderId:'order_one',cardId:f.store.read().orders.order_one.cardId,ref:'packing_evidence'};
 await assert.rejects(f.service.fulfill(staff,{requestId:'pack_held',orderId:'order_one',action:'PACK',evidence}),{code:'TAX_SALE_RECORD_REQUIRED'});
 // Requirement survives removal of runtime tax configuration.
 const cold=createMarketplacePilot({...f.options,taxLifecycle:undefined});await assert.rejects(cold.fulfill(staff,{requestId:'pack_cold',orderId:'order_one',action:'PACK',evidence}),{code:'TAX_SALE_RECORD_REQUIRED'});
 await assert.rejects(f.service.recordTaxSale(buyer,{orderId:'order_one'}),{code:'FORBIDDEN'});
 const operationId=run.results[0].id;f.revokeEvidence();await assert.rejects(f.service.reconcileTax(staff,{operationId,providerId:'tax_SALE',reviewRef:'review_original'}),{code:'EVIDENCE_UNAVAILABLE'});
 const retry=await f.service.runTaxFollowup(f.capability,{limit:1});assert.equal(retry.results[0].status,'UNKNOWN');assert.equal(f.provider.calls.filter(row=>row.url.endsWith('/create_from_calculation')).length,1);
 // Separately reviewed original recovery succeeds; no replacement write.
 const permitted=createMarketplacePilot({...f.options,validateEvidence:async()=>true});assert.equal((await permitted.reconcileTax(staff,{operationId,providerId:'tax_SALE',reviewRef:'review_original'})).status,'SUCCEEDED');
 assert.equal(f.store.transaction(tx=>assertOrderTaxComplete(tx,'order_one')),true);
 for(const key of ['intakeFrontRef','intakeBackRef','holderConditionRef','packingPhotoRef','fittedInsertRef','firstSealRef','secondSealRef','cleanLabelAreaRef','resaleInstructionsRef','replacementKitRef'])evidence[key]='evidence_'+key;
 const packed=await permitted.fulfill(staff,{requestId:'pack_complete',orderId:'order_one',action:'PACK',evidence});assert.equal(packed.status,'PACKED');assert.equal(f.provider.calls.filter(row=>row.url.endsWith('/create_from_calculation')).length,1);
});
test('confirmed financial refund requires reviewed tax split before release; no replacement or cross-role action',async t=>{
 const f=await fixture();t.after(()=>f.close());await f.service.recordTaxSale(staff,{orderId:'order_one'});
 f.store.transaction(tx=>{tx.state.intents.refund_one={id:'refund_one',kind:'REFUND',status:'SUCCEEDED',confirmed:true,orderId:'order_one',platformAccountId:'acct_SYNTHETIC',parentObjectId:'ch_ORIGINAL',objectId:'re_ORIGINAL',amountCents:1080,allocations:{sellerCents:800,feeCents:200,taxCents:80,shippingCents:0},reconciledAt:NOW};});
 assert.throws(()=>f.store.transaction(tx=>assertOrderTaxComplete(tx,'order_one')),{code:'TAX_REFUND_RECORD_REQUIRED'});
 const request={refundIntentId:'refund_one',itemTaxCents:80,shippingTaxCents:0,reviewRef:'review_refund'};
 await assert.rejects(f.service.recordTaxRefund(buyer,request),{code:'FORBIDDEN'});assert.equal((await f.service.recordTaxRefund(staff,request)).status,'SUCCEEDED');assert.equal(f.store.transaction(tx=>assertOrderTaxComplete(tx,'order_one')),true);
 const view=projectTaxReporting(f.store.read(),{available:true});assert.equal(view.orders[0].refunds[0].status,'SUCCEEDED');assert.equal(JSON.stringify(view).includes('tax_SALE'),false);
 await assert.rejects(f.service.recordTaxRefund(staff,{...request,shippingTaxCents:80,itemTaxCents:0}),{code:'TAX_REFUND_REVIEW_CONFLICT'});
});
test('tax HTTP controls retain CSRF and roles; hosted server capability cannot be called over HTTP',async()=>{
 let calls=0;const api=createMarketplaceHttpHandler({enabled:true,origin:'https://fixture.invalid',service:{recordTaxSale:async()=>{calls++;return {status:'SUCCEEDED'};}},resolveSession:async()=>({authenticated:true,expiresAt:NOW+1000,sessionId:'fixture',actor:buyer}),admitRequest:async()=>true,verifyCsrf:async()=>true,clock:()=>NOW});
 const request={method:'POST',url:'https://fixture.invalid/api/marketplace/staff/tax/sale',headers:{host:'fixture.invalid',origin:'https://fixture.invalid','content-type':'application/json'},rawBody:Buffer.from(JSON.stringify({orderId:'order_one'}))};
 assert.equal((await api.handle(request)).status,403);assert.equal(calls,0);assert.equal((await api.handle({...request,url:'https://fixture.invalid/api/marketplace/runTaxFollowup'})).status,404);api.close();
});
