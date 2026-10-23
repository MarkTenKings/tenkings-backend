import test from 'node:test';
import assert from 'node:assert/strict';
import {marketplaceOperations,projectBuyerQuote,projectFinanceOperations} from '../src/projections.mjs';

test('metrics use durable production cohorts and exclude sandbox records from every denominator',()=>{
  const prod={environment:'PRODUCTION'},sandbox={environment:'PROVIDER_SANDBOX'};
  const state={events:[],orders:{old:{...prod,buyerId:'buyer',reservationId:'old',paidAt:new Date(50).toISOString()},one:{...prod,orderId:'one',buyerId:'buyer',reservationId:'one',paidAt:new Date(150).toISOString()},fake:{...sandbox,orderId:'fake',buyerId:'fake',reservationId:'fake',paidAt:new Date(150).toISOString()}},
    reservations:{one:{...prod,id:'one',createdAt:new Date(100).toISOString()},two:{...prod,id:'two',createdAt:new Date(100).toISOString()},fake:{...sandbox,id:'fake',createdAt:new Date(100).toISOString()}},
    fulfillment:{one:{cases:[{kind:'DISPUTE'},{kind:'DISPUTE'}]}},
    intents:{a:{kind:'PAYOUT',createdAt:100,policy:{environment:'stripe-production'},confirmed:true},b:{kind:'PAYOUT',createdAt:100,policy:{environment:'stripe-production'},status:'FAILED'},c:{kind:'PAYOUT',createdAt:100,policy:{environment:'stripe-production'},status:'UNKNOWN'},fake:{kind:'PAYOUT',createdAt:100,policy:{environment:'stripe-sandbox'},confirmed:true}}};
  const m=marketplaceOperations(state,{since:100});
  assert.equal(m.checkoutConversion.rate,0.5);assert.equal(m.checkoutConversion.denominator,2);
  assert.equal(m.repeatPurchaseRate,1);assert.equal(m.repeatPurchases.buyers,1);
  assert.deepEqual([m.payoutReliability.paid,m.payoutReliability.failed,m.payoutReliability.pending,m.payoutReliability.rate],[1,1,1,0.5]);
  state.intents.voided={kind:'PAYOUT',createdAt:100,policy:{environment:'stripe-production'},status:'VOIDED',dispatchCount:0};
  const afterVoid=marketplaceOperations(state,{since:100});assert.equal(afterVoid.payoutReliability.voided,1);assert.equal(afterVoid.payoutReliability.pending,1);assert.equal(afterVoid.payoutReliability.rate,0.5);
  assert.equal(m.disputes.orders,1);assert.equal(m.disputes.rate,1);
  assert.equal(m.contributionProfit,null);assert.equal(m.conversionRate,null);assert.equal(m.handlingTime,null);
  const empty=marketplaceOperations(state,{since:1000});assert.equal(empty.repeatPurchaseRate,null);assert.equal(empty.checkoutConversion.rate,null);assert.equal(empty.payoutReliability.rate,null);
});
test('incident review projection points at the latest evidence reference while preserving the original retained record',()=>{
  const alert={alertId:'a',scope:'s',status:'OPEN',code:'CURRENT_CODE',reference:'original_ref',latestReference:'current_ref',latestEvidenceHash:'current_hash',lastObservedAt:10};
  const state={financeOperationalAlerts:{a:alert}};
  assert.equal(projectFinanceOperations(state).incidents[0].reference,'current_ref');assert.equal(alert.reference,'original_ref');
  delete alert.latestReference;assert.equal(projectFinanceOperations(state).incidents[0].reference,'original_ref');
});
test('buyer quote transport excludes retained address and provider evidence; seller projection omits the destination',()=>{
  const raw={quoteId:'q',totalCents:200,buyerId:'private_buyer',receiptHash:'private',shippingReceipt:{secret:'private'},taxReceipt:{secret:'private'},destination:{id:'d',label:'Approved destination',version:'v',addressHash:'private',evidenceRef:'private'}};
  const buyer=projectBuyerQuote(raw);assert.equal(buyer.destination.label,'Approved destination');assert.equal(JSON.stringify(buyer).includes('private'),false);
  assert.equal(projectBuyerQuote(raw,{includeDestination:false}).destination,undefined);
});
