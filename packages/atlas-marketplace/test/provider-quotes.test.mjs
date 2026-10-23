import test from 'node:test';
import assert from 'node:assert/strict';
import {clone,hash} from '../src/contract.mjs';
import {createShipStationQuoteAdapter,shipStationMinor} from '../src/provider-shipping-shipstation.mjs';
import {createStripeTaxQuoteAdapter} from '../src/provider-tax-stripe.mjs';
import {createQuoteHttp} from '../src/provider-quote-http.mjs';
import {createStripeTaxLifecycle,assertStripeTaxLifecycle} from '../src/tax-lifecycle.mjs';
import {createMarketplaceDestinations} from '../src/destinations.mjs';
import {createApprovedCheckoutQuoteProvider} from '../src/checkout-quote.mjs';
import {createAuthorityContext} from '../src/authority-context.mjs';
import {createListing,listingBindingHash} from '../src/listing.mjs';
import {makeTestTx,makeListingInput} from './listing-fixtures.mjs';
import {makeCheckoutPolicy} from './policy-quote-fixtures.mjs';
import {NOW,ADDRESS,FROM,config,input,json,carrier,rate,calculation,shippingFixture,taxFixture,memoryStore,resolver} from './provider-quote-fixtures.mjs';

test('provider adapters default off; explicit mode, account, coverage and independent approval are mandatory',async()=>{
  let calls=0;const fetchImpl=async()=>{calls++;throw new Error('must not run');};
  for(const factory of [createShipStationQuoteAdapter,createStripeTaxQuoteAdapter]){const adapter=factory({fetchImpl});assert.equal(adapter.enabled,false);assert.equal(adapter.assertReady(),false);await assert.rejects(adapter.quote({}));}
  assert.throws(()=>createShipStationQuoteAdapter({enabled:true,store:memoryStore(),config:config('shipping'),apiKey:'LIVE_SYNTHETIC_NOT_REAL',resolveDestination:resolver,assertReady:()=>true,fetchImpl}),{code:'SHIPPING_ACCOUNT_REQUIRED'});
  const noCoverage=config('shipping');delete noCoverage.coverage;
  assert.throws(()=>createShipStationQuoteAdapter({enabled:true,config:noCoverage}),{code:'SHIPPING_CONFIG_INVALID'});
  const f=shippingFixture({fetchImpl});f.config.coverage.termsRef='changed';await assert.rejects(f.adapter.quote(input('shipping')),{code:'QUOTE_PROVIDER_CONFIG_CHANGED'});assert.equal(calls,0);
});

test('ShipStation rates exact measured insured shipment once, includes every quoted charge, and stores no plaintext address',async()=>{
  const calls=[],f=shippingFixture({fetchImpl:async(url,options)=>{calls.push({url,...options});const result=url.endsWith('/v1/rates')?rate():carrier();if(result.rate_response)result.rate_response.rates[0].insurance_amount.amount='2.00';return json(result);}});
  const request=input('shipping'),receipt=await f.adapter.quote(request),same=await f.adapter.quote(request);
  assert.deepEqual(receipt,same);assert.equal(receipt.amountCents,1400);assert.equal(receipt.requestHash,hash(request));assert.match(receipt.deliveryEstimate,/estimated 3/);
  const writes=calls.filter(call=>call.method==='POST');assert.equal(writes.length,1);assert.equal(writes[0].url,'https://api.shipengine.com/v1/rates');assert.equal(writes[0].redirect,'error');
  const wire=JSON.parse(writes[0].body);assert.equal(wire.shipment.ship_to.address_line1,ADDRESS.line1);assert.equal(wire.shipment.ship_from.address_line1,FROM.line1);
  assert.equal(wire.shipment.insurance_provider,'carrier');assert.deepEqual(wire.shipment.packages[0].insured_value,{currency:'usd',amount:100});assert.deepEqual(wire.rate_options.carrier_ids,['se-123']);
  assert.deepEqual(wire.shipment.packages[0].dimensions,{unit:'inch',length:8,width:6,height:3});
  const saved=f.store.read(),operation=Object.values(saved.quoteProviderOperations)[0];assert.equal(operation.status,'SUCCEEDED');assert.equal(operation.evidence.insuranceCents,200);assert.equal(operation.evidence.declaredValueCents,10000);
  for(const privateValue of [ADDRESS.line1,ADDRESS.phone,FROM.line1,'TEST_SYNTHETIC_NOT_A_REAL_KEY'])assert.equal(JSON.stringify(saved).includes(privateValue),false);
  assert.equal(operation.wire,undefined);assert.equal(f.adapter.createLabel,undefined);assert.equal(f.adapter.createShipment,undefined);
});

test('shipping rejects wrong carrier identity, ambiguous rates, fractional cents, failed validation and unapproved amount before checkout',async()=>{
  let writes=0;const identity=shippingFixture({fetchImpl:async()=>json({...carrier(),account_number:'OTHER'})});await assert.rejects(identity.adapter.quote(input('shipping')),{code:'SHIPPING_ACCOUNT_MISMATCH'});assert.equal(identity.store.read().quoteProviderOperations,undefined);
  for(const mutate of [v=>v.rate_response.rates.push(clone(v.rate_response.rates[0])),v=>v.rate_response.rates[0].shipping_amount.amount='1.111',v=>v.rate_response.rates[0].validation_status='has_warnings',v=>v.rate_response.rates[0].trackable=false,v=>v.rate_response.rates[0].tax_amount.amount=1]){
    const f=shippingFixture({fetchImpl:async(url)=>{if(!url.endsWith('/v1/rates'))return json(carrier());writes++;const value=rate();mutate(value);return json(value);}});await assert.rejects(f.adapter.quote(input('shipping')));assert.equal(Object.values(f.store.read().quoteProviderOperations)[0].status,'UNKNOWN');await assert.rejects(f.adapter.quote(input('shipping')),{code:'QUOTE_PROVIDER_OUTCOME_UNKNOWN'});
  }assert.equal(writes,5);assert.throws(()=>shipStationMinor({currency:'usd',amount:'9007199254740992'}),{code:'CENTS_OVERFLOW'});
});

test('bounded HTTP keeps abort-ignoring IO capacity, rejects oversized bodies and never follows redirects or logs raw errors',async()=>{
  const pending=[];const transport=createQuoteHttp({origin:'https://api.stripe.com',headers:{},allow:()=>true,current:()=>NOW,timeoutMs:5,maxBytes:100,fetchImpl:()=>new Promise(resolve=>pending.push(resolve))});
  const first=transport.request('GET','/one'),second=transport.request('GET','/two');await Promise.all([assert.rejects(first,{code:'QUOTE_PROVIDER_IO_TIMEOUT'}),assert.rejects(second,{code:'QUOTE_PROVIDER_IO_TIMEOUT'})]);
  await assert.rejects(transport.request('GET','/three'),{code:'QUOTE_TRANSPORT_UNAVAILABLE'});pending.forEach(resolve=>resolve(json({ok:true})));await new Promise(resolve=>setImmediate(resolve));transport.close();
  const large=createQuoteHttp({origin:'https://api.stripe.com',headers:{},allow:()=>true,current:()=>NOW,maxBytes:10,fetchImpl:async()=>json({secret:'x'.repeat(20)})});await assert.rejects(large.request('GET','/one'),{code:'QUOTE_PROVIDER_RESPONSE_TOO_LARGE'});
  const error=createQuoteHttp({origin:'https://api.stripe.com',headers:{},allow:()=>true,current:()=>NOW,fetchImpl:async()=>{throw new Error('SECRET_FROM_PROVIDER');}});await assert.rejects(error.request('GET','/one'),e=>e.code==='QUOTE_PROVIDER_IO_UNKNOWN'&&!e.message.includes('SECRET'));
});

test('Stripe Tax quotes original item, shipping, responsibility and exact address; no tax or registration fallback',async()=>{
  const f=taxFixture(),request=input('tax'),receipt=await f.adapter.quote(request);assert.equal(receipt.amountCents,896);assert.equal(receipt.basisCents,11200);assert.equal(receipt.requestHash,hash(request));assert.deepEqual(await f.adapter.quote(request),receipt);
  const writes=f.provider.calls.filter(call=>call.method==='POST');assert.equal(writes.length,1);assert.equal(writes[0].url,'https://api.stripe.com/v1/tax/calculations');assert.match(writes[0].headers['Idempotency-Key'],/^atlas-marketplace-quote:atlas_qop_/);
  const wire=new URLSearchParams(writes[0].body);assert.equal(wire.get('line_items[0][amount]'),'10000');assert.equal(wire.get('shipping_cost[amount]'),'1200');assert.equal(wire.get('customer_details[address_source]'),'shipping');assert.equal(wire.get('ship_from_details[address][line1]'),FROM.line1);
  const state=f.store.read();for(const privateValue of [ADDRESS.line1,ADDRESS.phone,FROM.line1,'sk_test_SYNTHETICNOTAREALKEY'])assert.equal(JSON.stringify(state).includes(privateValue),false);
  for(const mutate of [v=>v.customer_details.address.line1='Other destination',v=>v.amount_total++,v=>v.livemode=true,v=>{v.tax_amount_exclusive=0;v.line_items.data[0].amount_tax=0;v.shipping_cost.amount_tax=0;v.amount_total=11200;v.tax_breakdown=[{amount:0,taxability_reason:'not_collecting'}];}]){
    const bad=taxFixture({fetchImpl:async(url,options)=>{if(url.endsWith('/account'))return json({id:'acct_SYNTHETIC'});const v=calculation(options.body);mutate(v);return json(v);}});await assert.rejects(bad.adapter.quote(request));assert.equal(Object.values(bad.store.read().quoteProviderOperations)[0].status,'UNKNOWN');
  }
});

async function paidFixture({clock=()=>NOW}={}) {
  const f=taxFixture({clock}),request=input('tax'),receipt=await f.adapter.quote(request);
  f.store.transaction(tx=>{tx.state.orders.order_one={orderId:'order_one',environment:'PROVIDER_SANDBOX',status:'PAID',buyerId:request.buyerId,bindingHash:request.listingHash,itemCents:10000,shippingCents:1200,taxCents:896,totalCents:12096,paymentIntentId:'payment_one',paymentObjectId:'pi_ORIGINAL',quote:{taxQuoteRef:receipt.quoteRef,taxReceipt:receipt}};tx.state.intents.payment_one={id:'payment_one',kind:'PAYMENT',status:'SUCCEEDED',confirmed:true,platformAccountId:'acct_SYNTHETIC',objectId:'pi_ORIGINAL',chargeId:'ch_ORIGINAL',order:{orderId:'order_one',bindingHash:request.listingHash},amountCents:12096,reconciledAt:NOW};});
  f.lifecycle=createStripeTaxLifecycle({enabled:true,store:f.store,taxAdapter:f.adapter,approvalRef:'SYNTHETIC_TAX_RECORD_REVIEW',assertReady:()=>true,clock});return f;
}
test('tax lifecycle only records confirmed exact sale, then one reviewed partial reversal with original GET evidence',async()=>{
  const f=await paidFixture();assertStripeTaxLifecycle(f.lifecycle,{store:f.store,environment:'PROVIDER_SANDBOX',platformAccountId:'acct_SYNTHETIC'});assert.throws(()=>assertStripeTaxLifecycle({...f.lifecycle},{store:f.store}),{code:'TAX_LIFECYCLE_BINDING_MISMATCH'});
  const sale=await f.lifecycle.recordSale({orderId:'order_one'});assert.equal(sale.status,'SUCCEEDED');assert.equal(sale.dispatchCount,1);assert.deepEqual(await f.lifecycle.recordSale({orderId:'order_one'}),sale);
  f.store.transaction(tx=>{tx.state.intents.refund_one={kind:'REFUND',status:'SUCCEEDED',confirmed:true,orderId:'order_one',platformAccountId:'acct_SYNTHETIC',parentObjectId:'ch_ORIGINAL',objectId:'re_ORIGINAL',amountCents:1080,allocations:{sellerCents:800,feeCents:200,taxCents:80,shippingCents:0},reconciledAt:NOW};});
  const request={refundIntentId:'refund_one',itemTaxCents:80,shippingTaxCents:0,reviewRef:'SYNTHETIC_EXACT_ALLOCATION_REVIEW'},refund=await f.lifecycle.recordRefund(request);assert.equal(refund.status,'SUCCEEDED');assert.deepEqual(await f.lifecycle.recordRefund(request),refund);
  await assert.rejects(f.lifecycle.recordRefund({...request,itemTaxCents:0,shippingTaxCents:80}),{code:'TAX_REFUND_REVIEW_CONFLICT'});
  const posts=f.provider.calls.filter(call=>call.method==='POST');assert.equal(posts.length,3);const reversal=new URLSearchParams(posts.at(-1).body);assert.equal(reversal.get('original_transaction'),'tax_SALE');assert.equal(reversal.get('line_items[0][original_line_item]'),'tax_li_SALE');assert.equal(reversal.get('line_items[0][amount]'),'-1000');assert.equal(reversal.get('line_items[0][amount_tax]'),'-80');
  assert.equal((await f.lifecycle.listUnresolved()).length,0);assert.equal((await f.lifecycle.status({orderId:'order_one'})).length,2);for(const value of [ADDRESS.line1,ADDRESS.phone,FROM.line1])assert.equal(JSON.stringify(f.store.read()).includes(value),false);
});

test('lost tax write response stays UNKNOWN; repeated recovery cannot POST, reviewed exact original GET alone recovers',async()=>{
  const f=await paidFixture();f.provider.loseWriteResponse();const unknown=await f.lifecycle.recordSale({orderId:'order_one'});assert.equal(unknown.status,'UNKNOWN');assert.equal(unknown.dispatchCount,1);
  assert.equal((await f.lifecycle.recordSale({orderId:'order_one'})).status,'UNKNOWN');assert.equal((await f.lifecycle.reconcile({operationId:unknown.id})).status,'UNKNOWN');
  assert.equal(f.provider.calls.filter(call=>call.url.endsWith('/create_from_calculation')).length,1);
  await assert.rejects(f.lifecycle.reconcile({operationId:unknown.id,providerId:'tax_SALE'}),{code:'TAX_RECOVERY_REVIEW_REQUIRED'});
  f.provider.transactions.set('tax_OTHER',{...clone(f.provider.transactions.get('tax_SALE')),id:'tax_OTHER',reference:'other order'});
  await assert.rejects(f.lifecycle.reconcile({operationId:unknown.id,providerId:'tax_OTHER',recoveryReviewRef:'SYNTHETIC_REVIEW'}),{code:'TAX_TRANSACTION_MISMATCH'});
  assert.equal(f.store.read().taxLifecycleOperations[unknown.id].providerId,null);
  const recovered=await f.lifecycle.reconcile({operationId:unknown.id,providerId:'tax_SALE',recoveryReviewRef:'SYNTHETIC_REVIEW'});assert.equal(recovered.status,'SUCCEEDED');assert.equal(recovered.dispatchCount,1);
  assert.equal(f.provider.calls.filter(call=>call.url.endsWith('/create_from_calculation')).length,1);
});

test('pending payments and mismatched tax allocation cannot create tax sale or refund records',async()=>{
  const f=await paidFixture();f.store.transaction(tx=>{tx.state.intents.payment_one.confirmed=false;});await assert.rejects(f.lifecycle.recordSale({orderId:'order_one'}),{code:'TAX_CONFIRMED_SALE_REQUIRED'});assert.equal(f.provider.calls.filter(call=>call.url.endsWith('/create_from_calculation')).length,0);
  f.store.transaction(tx=>{tx.state.intents.payment_one.confirmed=true;});await f.lifecycle.recordSale({orderId:'order_one'});
  f.store.transaction(tx=>{tx.state.intents.refund_bad={kind:'REFUND',status:'SUCCEEDED',confirmed:true,orderId:'order_one',platformAccountId:'acct_SYNTHETIC',parentObjectId:'ch_ORIGINAL',objectId:'re_ORIGINAL',amountCents:1000,allocations:{sellerCents:800,feeCents:100,taxCents:100,shippingCents:0},reconciledAt:NOW};});
  await assert.rejects(f.lifecycle.recordRefund({refundIntentId:'refund_bad',itemTaxCents:80,shippingTaxCents:0,reviewRef:'SYNTHETIC_REVIEW'}),{code:'TAX_REFUND_ALLOCATION_MISMATCH'});assert.equal(f.provider.calls.filter(call=>call.url.endsWith('/create_reversal')).length,0);
});

test('retained tax requirement pins lifecycle approval and exact original calculation across retries and configuration changes',async()=>{
  const f=await paidFixture(),order=f.store.read().orders.order_one;
  const requirement={orderId:order.orderId,bindingHash:hash(f.lifecycle.binding),calculationId:order.quote.taxQuoteRef,paymentBindingHash:order.bindingHash};
  f.store.transaction(tx=>{tx.state.marketplaceTaxRequirements={[order.orderId]:clone(requirement)};});
  const changed=createStripeTaxLifecycle({enabled:true,store:f.store,taxAdapter:f.adapter,approvalRef:'DIFFERENT_APPROVAL',assertReady:()=>true,clock:()=>NOW});
  await assert.rejects(changed.recordSale({orderId:order.orderId}),{code:'TAX_REQUIREMENT_CHANGED'});
  const sale=await f.lifecycle.recordSale({orderId:order.orderId});assert.equal(sale.status,'SUCCEEDED');
  for(const key of ['bindingHash','calculationId','paymentBindingHash']){
    f.store.transaction(tx=>{tx.state.marketplaceTaxRequirements[order.orderId]={...requirement,[key]:'changed'};});
    await assert.rejects(f.lifecycle.recordSale({orderId:order.orderId}),{code:'TAX_REQUIREMENT_CHANGED'});
    await assert.rejects(f.lifecycle.reconcile({operationId:sale.id}),{code:'TAX_REQUIREMENT_CHANGED'});
  }
  f.store.transaction(tx=>{delete tx.state.marketplaceTaxRequirements;});
  await assert.rejects(changed.recordSale({orderId:order.orderId}),{code:'TAX_ORIGINAL_OPERATION_CONFLICT'});
  assert.equal(f.provider.calls.filter(call=>call.url.endsWith('/create_from_calculation')).length,1);
});

test('two explicit PREPARED resumes claim the retained tax operation once; reconcile never dispatches it',async()=>{
  const f=await paidFixture();f.provider.failNextCalculationRead();
  await assert.rejects(f.lifecycle.recordSale({orderId:'order_one'}),{code:'QUOTE_PROVIDER_IO_UNKNOWN'});
  const [prepared]=await f.lifecycle.listUnresolved();assert.equal(prepared.status,'PREPARED');assert.equal(prepared.dispatchCount,0);
  assert.equal((await f.lifecycle.reconcile({operationId:prepared.id})).status,'PREPARED');
  assert.equal(f.provider.calls.filter(call=>call.url.endsWith('/create_from_calculation')).length,0);
  const results=await Promise.allSettled([f.lifecycle.resume({operationId:prepared.id}),f.lifecycle.resume({operationId:prepared.id})]);
  assert.ok(results.some(result=>result.status==='fulfilled'&&result.value.status==='SUCCEEDED'));
  assert.equal(f.provider.calls.filter(call=>call.url.endsWith('/create_from_calculation')).length,1);
  assert.equal(f.store.read().taxLifecycleOperations[prepared.id].dispatchCount,1);
  await assert.rejects(f.lifecycle.resume({operationId:prepared.id}),{code:'TAX_PREPARED_OPERATION_REQUIRED'});
});

test('paid-original tax lifecycle survives quote policy expiry while new quotes refuse; provider calculation expiry remains binding',async()=>{
  let now=NOW;const f=await paidFixture({clock:()=>now});now+=7200000;
  await assert.rejects(f.adapter.quote(input('tax')),{code:'QUOTE_PROVIDER_POLICY_EXPIRED'});
  const sale=await f.lifecycle.recordSale({orderId:'order_one'});assert.equal(sale.status,'SUCCEEDED');assert.equal((await f.lifecycle.reconcile({operationId:sale.id})).status,'SUCCEEDED');
  let later=NOW;const expired=await paidFixture({clock:()=>later});later+=86400001;
  await assert.rejects(expired.lifecycle.recordSale({orderId:'order_one'}),{code:'TAX_CALCULATION_EXPIRED'});assert.equal(expired.provider.calls.filter(call=>call.url.endsWith('/create_from_calculation')).length,0);
});

test('actual quote composer uses encrypted saved destination and concrete mocked HTTP adapters without persisting plaintext',async()=>{
  const store=memoryStore(),context=createAuthorityContext({environment:'PROVIDER_SANDBOX',evidenceOrigin:'https://fixture.invalid',evidencePathPrefixes:['/approved/'],qualificationRefs:{fingerprintRef:'SYNTHETIC_STRUCTURE_ONLY',titlePolicyRef:'SYNTHETIC_STRUCTURE_ONLY',marketplacePolicyRef:'SYNTHETIC_STRUCTURE_ONLY',evidenceContractRef:'SYNTHETIC_STRUCTURE_ONLY'}});
  const buyerId=input('tax').buyerId,destinations=createMarketplaceDestinations({enabled:true,store,context,policy:{id:'destination_policy',version:'v1',environment:'PROVIDER_SANDBOX',approvalRef:'SYNTHETIC_ONLY',privacyRef:'SYNTHETIC_ONLY',allowedCountries:['US'],maxActive:2,receiptTtlMs:180000},keyring:{activeKeyId:'fixture',keys:{fixture:Buffer.alloc(32,7)}},assertReady:()=>true,clock:()=>NOW});
  store.transaction(tx=>destinations.save(tx,{buyerId,requestId:'address_request',destinationId:'destination_one',expectedVersion:0,label:'Synthetic destination',address:ADDRESS}));
  // This is only a portable data-shape fixture; it supplies no real authority.
  const listing=createListing(makeTestTx(),makeListingInput());Object.assign(listing,{id:'listing_one',environment:'PROVIDER_SANDBOX',sellerId:'22222222-2222-4222-8222-222222222222',askingPriceCents:10000,sellerNetCents:9500});Object.assign(listing.policy,{id:'policy_one',environment:'PROVIDER_SANDBOX'});listing.bindingHash=listingBindingHash(listing);
  const policy=makeCheckoutPolicy({id:'checkout_one',environment:'PROVIDER_SANDBOX',shippingPolicyRef:'shipping_policy',taxPolicyRef:'tax_policy',taxResponsibleEntityRef:'SYNTHETIC_TAX_ENTITY'}),shippingConfig={...config('shipping'),checkoutPolicyHash:hash(policy)},taxConfig={...config('tax'),checkoutPolicyHash:hash(policy)};
  const sf=shippingFixture(),tf=taxFixture();
  const shipping=createShipStationQuoteAdapter({enabled:true,store,config:shippingConfig,apiKey:'TEST_SYNTHETIC_NOT_A_REAL_KEY',resolveDestination:destinations,assertReady:()=>true,clock:()=>NOW,fetchImpl:async url=>json(url.endsWith('/v1/rates')?rate():carrier())});
  const tax=createStripeTaxQuoteAdapter({enabled:true,store,config:taxConfig,secretKey:'sk_test_SYNTHETICNOTAREALKEY',resolveDestination:destinations,assertReady:()=>true,clock:()=>NOW,fetchImpl:tf.provider.fetchImpl});sf.adapter.close();
  const quoteProvider=createApprovedCheckoutQuoteProvider({enabled:true,context,policy,approvalRef:'SYNTHETIC_COMPOSER',assertReady:()=>true,resolveDestination:destinations,shipping,tax,clock:()=>NOW});
  const quote=await quoteProvider({listing,buyerId,destinationId:'destination_one'});assert.equal(quote.shippingCents,1200);assert.equal(quote.taxCents,896);assert.equal(quote.totalCents,12096);assert.equal(quote.destination.addressHash,hash(ADDRESS));
  store.transaction(tx=>destinations.assertInTransaction(tx,quote.destination,{buyerId}));
  const state=JSON.stringify(store.read());for(const privateValue of [ADDRESS.line1,ADDRESS.phone,FROM.line1])assert.equal(state.includes(privateValue),false);
  store.transaction(tx=>destinations.remove(tx,{buyerId,requestId:'remove_address',destinationId:'destination_one',expectedVersion:1}));
  assert.throws(()=>store.transaction(tx=>destinations.assertInTransaction(tx,quote.destination,{buyerId})),{code:'DESTINATION_UNAVAILABLE'});
  await assert.rejects(quoteProvider({listing,buyerId,destinationId:'destination_one'}),{code:'DESTINATION_UNAVAILABLE'});quoteProvider.close();destinations.close();shipping.close();tax.close();tf.adapter.close();
});
