import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../src/contract.mjs';
import {calculateSellerFee,createApprovedFeeCalculator} from '../src/fee-policy.mjs';
import {createApprovedCheckoutQuoteProvider} from '../src/checkout-quote.mjs';
import {createListing,reviseListing,assertListingBinding} from '../src/listing.mjs';
import {reserveListing,markReservationPaymentPending} from '../src/reservation.mjs';
import {makeListingInput,makeTestTx,FIXTURE_NOW} from './listing-fixtures.mjs';
import {makeFeeSchedule,makeScheduledListingPolicy,makeCheckoutPolicy,makeQuoteAdapters} from './policy-quote-fixtures.mjs';
const calculator=(schedule,other={})=>createApprovedFeeCalculator({enabled:true,schedule,approvalRef:'LOCAL_FIXTURE_ENGINE',assertReady:()=>true,clock:()=>FIXTURE_NOW,...other});
const feeInput=(policy,extra={})=>({policy,cardId:'demo_card',sellerId:'demo_seller',askingPriceCents:12500,...extra});
const quoteFixture=(options={})=>{const tx=makeTestTx(),listing=createListing(tx,makeListingInput()),adapters=makeQuoteAdapters();const provider=createApprovedCheckoutQuoteProvider({enabled:true,policy:makeCheckoutPolicy(),approvalRef:'LOCAL_FIXTURE_ENGINE',assertReady:()=>true,clock:()=>FIXTURE_NOW,...adapters,...options});return {tx,listing,adapters,provider};};
const quoteInput=listing=>({listing,buyerId:'demo_buyer',destinationId:'demo_destination'});

test('fee schedules are default-off, exact, integer and explicitly rounded at tier/min/max boundaries',()=>{
  assert.throws(()=>createApprovedFeeCalculator().preview({}),{code:'FEE_CALCULATOR_UNAVAILABLE'});
  const schedule=makeFeeSchedule();
  assert.deepEqual(calculateSellerFee(schedule,10000),{feeCents:625,sellerNetCents:9375,tierIndex:0});
  assert.deepEqual(calculateSellerFee(schedule,10001),{feeCents:425,sellerNetCents:9576,tierIndex:1});
  for(const [rounding,expected] of [['DOWN',1],['UP',2],['HALF_UP',2]]) assert.equal(calculateSellerFee(makeFeeSchedule({rounding,tiers:[{upToCents:null,rateBps:5000,fixedCents:0}]}),3).feeCents,expected);
  assert.equal(calculateSellerFee(makeFeeSchedule({minimumCents:700}),10000).feeCents,700);
  assert.equal(calculateSellerFee(makeFeeSchedule({maximumCents:300}),10000).feeCents,300);
  assert.equal(calculateSellerFee(makeFeeSchedule({tiers:[{upToCents:null,rateBps:1,fixedCents:0}]}),Number.MAX_SAFE_INTEGER).feeCents,900719925474);
  assert.throws(()=>calculateSellerFee({...schedule,rounding:undefined},10000),{code:'FEE_POLICY_UNSUPPORTED'});
  assert.throws(()=>calculateSellerFee({...schedule,basis:'ITEM_AND_SHIPPING'},10000),{code:'FEE_POLICY_UNSUPPORTED'});
  assert.throws(()=>calculateSellerFee(schedule,'10000'),{code:'INVALID_CENTS'});
  assert.throws(()=>calculateSellerFee(makeFeeSchedule({tiers:[{upToCents:null,rateBps:10000,fixedCents:Number.MAX_SAFE_INTEGER}]}),Number.MAX_SAFE_INTEGER),{code:'CENTS_OVERFLOW'});
});

test('fee preview binds exact policy, seller, card, price and current revision; listing revisions retain immutable earlier allocation',()=>{
  const tx=makeTestTx(),schedule=makeFeeSchedule(),policy=makeScheduledListingPolicy(schedule),engine=calculator(schedule),input=feeInput(policy),feeQuote=engine.preview(input);
  engine.assertCurrent(feeQuote,input);
  const listing=createListing(tx,makeListingInput({policy,feeQuote}));assert.equal(listing.feeCents,525);assert.equal(listing.sellerNetCents,11975);
  const revisionInput=feeInput(policy,{askingPriceCents:9000,listingId:listing.id,listingVersion:1,listingHash:listing.bindingHash}),revisionQuote=engine.preview(revisionInput);
  const revised=reviseListing(tx,{...makeListingInput(),listingId:listing.id,expectedVersion:1,expectedBindingHash:listing.bindingHash,askingPriceCents:9000,feeQuote:revisionQuote});
  assert.equal(revised.feeCents,565);assert.equal(revised.sellerNetCents,8435);assert.equal(tx.state.listingRevisions['demo_listing:1'].feeCents,525);
  assert.equal(revised.approvedCard.reportHash,listing.approvedCard.reportHash);assertListingBinding(revised);
  assert.throws(()=>engine.assertCurrent(feeQuote,{...input,askingPriceCents:12000}),{code:'FEE_QUOTE_BINDING_INVALID'});
  assert.throws(()=>engine.assertCurrent(feeQuote,{...input,sellerId:'demo_other'}),{code:'FEE_QUOTE_BINDING_INVALID'});
  const corrupted=structuredClone(revised);corrupted.feeQuote.feeCents++;assert.throws(()=>assertListingBinding(corrupted),{code:'LISTING_BINDING_INVALID'});
});

test('fee approval revocation, schedule drift, expiry and backward clock refuse without minting renewed authority',()=>{
  let now=FIXTURE_NOW,ready=true;const schedule=makeFeeSchedule(),policy=makeScheduledListingPolicy(schedule),engine=calculator(schedule,{clock:()=>now,assertReady:()=>ready,maxQuoteAgeMs:1000}),input=feeInput(policy),receipt=engine.preview(input);
  ready=false;assert.throws(()=>engine.assertCurrent(receipt,input),{code:'FEE_APPROVAL_REQUIRED'});ready=true;
  now+=1000;assert.throws(()=>engine.assertCurrent(receipt,input),{code:'FEE_QUOTE_EXPIRED'});
  now--;assert.throws(()=>engine.preview(input),{code:'FEE_CLOCK_INVALID'});now++;
  schedule.tiers[0].rateBps++;assert.throws(()=>engine.preview(input),{code:'FEE_APPROVAL_REQUIRED'});
});

test('checkout composes exact destination, shipping then tax basis and earliest expiry, reserving the same complete total',async()=>{
  const {tx,listing,adapters,provider}=quoteFixture();
  assert.deepEqual(await provider.listDestinations({buyerId:'demo_buyer'}),[{id:'demo_destination',label:'Synthetic destination only',version:'fixture-address-v1'}]);
  const quote=await provider(quoteInput(listing));assert.equal(quote.totalCents,14450);assert.equal(quote.buyerFeeCents,0);assert.equal(quote.expiresAt,new Date(FIXTURE_NOW+120000).toISOString());
  assert.equal(adapters.calls[1].basisCents,13700);assert.equal(adapters.calls[1].shippingQuoteRef,quote.shippingQuoteRef);
  const reserved=reserveListing(tx,{requestId:'demo_reserve',reservationId:'demo_reservation',listingId:listing.id,listingVersion:listing.version,listingHash:listing.bindingHash,buyerId:'demo_buyer',eligibility:makeListingInput().eligibility,quote});
  assert.equal(reserved.order.totalCents,14450);assert.equal(reserved.quote.receiptHash,quote.receiptHash);
  assert.throws(()=>provider.assertCurrent(quote,{...quoteInput(listing),buyerId:'demo_other'}),{code:'QUOTE_BINDING_MISMATCH'});
  adapters.revoke();assert.throws(()=>provider.assertCurrent(quote,quoteInput(listing)),{code:'QUOTE_DESTINATION_CHANGED'});
});

test('checkout rejects mismatched provider receipt, stale evidence, unknown approval and changed destinations',async()=>{
  const absent=createApprovedCheckoutQuoteProvider();await assert.rejects(absent({}),{code:'CHECKOUT_QUOTE_UNAVAILABLE'});
  const adapters=makeQuoteAdapters();const original=adapters.shipping.quote;
  adapters.shipping.quote=async input=>({...await original(input),requestHash:hash('wrong destination')});
  const f=quoteFixture(adapters);await assert.rejects(f.provider(quoteInput(f.listing)),{code:'QUOTE_PROVIDER_BINDING_MISMATCH'});
  const stale=makeQuoteAdapters();stale.destination.expiresAt=new Date(FIXTURE_NOW).toISOString();const s=quoteFixture(stale);await assert.rejects(s.provider(quoteInput(s.listing)),{code:'QUOTE_DESTINATION_EXPIRED'});
  const refused=quoteFixture({assertReady:()=>false});await assert.rejects(refused.provider(quoteInput(refused.listing)),{code:'CHECKOUT_APPROVAL_REQUIRED'});
  const changed=makeQuoteAdapters(),tax=changed.tax.quote;changed.tax.quote=async input=>{const result=await tax(input);changed.revoke();return result;};const c=quoteFixture(changed);await assert.rejects(c.provider(quoteInput(c.listing)),{code:'QUOTE_DESTINATION_CHANGED'});
});

test('bounded quote timeout retains capacity for abandoned underlying I/O; it cannot issue a late quote',async()=>{
  let resolve;const adapters=makeQuoteAdapters();adapters.resolveDestination.resolve=()=>new Promise(done=>{resolve=done;});
  const {provider,listing}=quoteFixture({...adapters,timeoutMs:15,maxConcurrent:1});
  await assert.rejects(provider(quoteInput(listing)),{code:'QUOTE_IO_TIMEOUT'});
  await assert.rejects(provider(quoteInput(listing)),{code:'QUOTE_CAPACITY_UNAVAILABLE'});
  resolve(adapters.destination);await new Promise(done=>setTimeout(done,0));
  provider.close();await assert.rejects(provider(quoteInput(listing)),{code:'QUOTE_CLOCK_UNAVAILABLE'});
});

test('a never-dispatched prepared payment cannot outlive the exact buyer quote',async()=>{
  const {tx,listing,provider}=quoteFixture(),quote=await provider(quoteInput(listing));
  const reservation=reserveListing(tx,{requestId:'demo_reserve',reservationId:'demo_reservation',listingId:listing.id,listingVersion:listing.version,listingHash:listing.bindingHash,buyerId:'demo_buyer',eligibility:makeListingInput().eligibility,quote});
  const intent={id:'demo_payment',intentId:'demo_payment',kind:'PAYMENT',status:'PREPARED',order:reservation.order,amountCents:reservation.order.totalCents,currency:'USD'};tx.state.intents[intent.id]=intent;
  markReservationPaymentPending(tx,{reservationId:reservation.id,paymentIntentId:intent.id,eligibility:makeListingInput().eligibility});
  tx.now=Date.parse(quote.expiresAt);
  assert.throws(()=>markReservationPaymentPending(tx,{reservationId:reservation.id,paymentIntentId:intent.id,eligibility:makeListingInput().eligibility}),{code:'RESERVATION_EXPIRED'});
  intent.status='UNKNOWN';assert.equal(markReservationPaymentPending(tx,{reservationId:reservation.id,paymentIntentId:intent.id}).status,'PAYMENT_PENDING');
});

test('asynchronous approval and destination gates refuse and consume rejected promises',async()=>{
  const schedule=makeFeeSchedule(),engine=calculator(schedule,{assertReady:()=>Promise.reject(new Error('not a synchronous approval'))});
  assert.throws(()=>engine.preview(feeInput(makeScheduledListingPolicy(schedule))),{code:'FEE_APPROVAL_REQUIRED'});
  const f=quoteFixture({assertReady:()=>Promise.reject(new Error('not a synchronous approval'))});await assert.rejects(f.provider(quoteInput(f.listing)),{code:'CHECKOUT_APPROVAL_REQUIRED'});
  const adapters=makeQuoteAdapters();adapters.resolveDestination.assertCurrent=()=>Promise.reject(new Error('not a current destination'));
  const d=quoteFixture(adapters);await assert.rejects(d.provider(quoteInput(d.listing)),{code:'QUOTE_DESTINATION_CHANGED'});
  await new Promise(resolve=>setTimeout(resolve,0)); // node:test would report any unhandled rejection.
});
