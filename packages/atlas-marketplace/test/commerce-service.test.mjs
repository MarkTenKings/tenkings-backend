import test from 'node:test';
import assert from 'node:assert/strict';
import {openLocalStore} from '../src/store.mjs';
import {createMarketplacePilot} from '../src/service.mjs';
import {createApprovedFeeCalculator} from '../src/fee-policy.mjs';
import {createApprovedCheckoutQuoteProvider} from '../src/checkout-quote.mjs';
import {actors,createLocalFixture} from '../scripts/local-fixture.mjs';
import {FIXTURE_NOW} from './listing-fixtures.mjs';
import {makeFeeSchedule,makeScheduledListingPolicy,makeCheckoutPolicy,makeQuoteAdapters} from './policy-quote-fixtures.mjs';

test('joined service requires exact reviewed fee, retains changed revision and destination quote through original synthetic payment',async()=>{
  let now=FIXTURE_NOW;const clock=()=>now,store=openLocalStore({filename:':memory:',environment:'SYNTHETIC_LOCAL',clock});
  const fixture=createLocalFixture({store,clock,assets:false}),schedule=makeFeeSchedule(),listingPolicy=makeScheduledListingPolicy(schedule),adapters=makeQuoteAdapters({clock});
  const feeCalculator=createApprovedFeeCalculator({enabled:true,schedule,approvalRef:'LOCAL_FIXTURE_ENGINE',assertReady:()=>true,clock});
  const quoteProvider=createApprovedCheckoutQuoteProvider({enabled:true,policy:makeCheckoutPolicy(),approvalRef:'LOCAL_FIXTURE_ENGINE',assertReady:()=>true,clock,...adapters});
  const service=createMarketplacePilot({...fixture,store,enabled:true,environment:'SYNTHETIC_LOCAL',platformAccountId:'demo_platform',listingPolicy,feeCalculator,quoteProvider,clock});
  try {
    await service.recordConsent(actors.seller,{requestId:'demo_consent',cardId:'demo_card',choice:'HOLD_AND_LIST',evidenceRef:'demo_hold_consent'});
    const input={requestId:'demo_publish',cardId:'demo_card',askingPriceCents:12500};
    await assert.rejects(service.publishListing(actors.seller,input),{code:'FEE_QUOTE_REQUIRED'});
    const fee=await service.previewListingFee(actors.seller,{cardId:'demo_card',askingPriceCents:12500});
    await assert.rejects(service.publishListing(actors.seller,{...input,askingPriceCents:12501,feeQuoteId:fee.id}),{code:'FEE_QUOTE_BINDING_INVALID'});
    let listing=await service.publishListing(actors.seller,{...input,feeQuoteId:fee.id});assert.equal(listing.feeCents,525);
    const oldQuote=await service.quote(actors.buyer,{listingId:listing.id,destinationId:'demo_destination'});
    const revisionFee=await service.previewListingFee(actors.seller,{cardId:'demo_card',listingId:listing.id,askingPriceCents:9000});
    listing=await service.reviseListing(actors.seller,{requestId:'demo_revise',listingId:listing.id,expectedVersion:listing.version,expectedBindingHash:listing.bindingHash,askingPriceCents:9000,feeQuoteId:revisionFee.id});
    assert.equal(listing.feeCents,565);assert.equal(listing.sellerNetCents,8435);
    await assert.rejects(service.reserve(actors.buyer,{requestId:'demo_old_reserve',listingId:listing.id,listingVersion:listing.version,listingHash:listing.bindingHash,quoteId:oldQuote.quoteId}),{code:'QUOTE_BINDING_MISMATCH'});
    const quote=await service.quote(actors.buyer,{listingId:listing.id,destinationId:'demo_destination'});
    const reservation=await service.reserve(actors.buyer,{requestId:'demo_reserve',listingId:listing.id,listingVersion:listing.version,listingHash:listing.bindingHash,quoteId:quote.quoteId});
    assert.equal(reservation.order.totalCents,10950);assert.equal(reservation.quote.buyerId,actors.buyer.id);
    await service.pay(actors.buyer,{reservationId:reservation.id});
    const paymentId=store.read().reservations[reservation.id].paymentIntentId;fixture.provider.resolve(paymentId,{status:'succeeded'});
    const order=await service.reconcilePayment(actors.buyer,{reservationId:reservation.id});
    assert.equal(order.status,'PAID');assert.equal(order.sellerNetCents,8435);assert.equal(order.quote.destination.addressHash,adapters.destination.addressHash);
    assert.equal(store.read().syntheticProvider.calls[paymentId],1);
    const publicWorkspace=await service.workspace(actors.buyer);assert.equal(publicWorkspace.quoteDestinationRequired,true);
    assert.deepEqual(publicWorkspace.quoteDestinations,[{id:'demo_destination',label:'Synthetic destination only',version:'fixture-address-v1'}]);
    assert.equal(JSON.stringify(publicWorkspace).includes(adapters.destination.addressHash),false);assert.equal(JSON.stringify(publicWorkspace).includes('shippingReceipt'),false);
  } finally {quoteProvider.close();store.close();}
});

test('joined service rechecks destination revocation before payment and leaves no financial intent',async()=>{
  const clock=()=>FIXTURE_NOW,store=openLocalStore({filename:':memory:',environment:'SYNTHETIC_LOCAL',clock}),fixture=createLocalFixture({store,clock,assets:false}),adapters=makeQuoteAdapters({clock});
  const quoteProvider=createApprovedCheckoutQuoteProvider({enabled:true,policy:makeCheckoutPolicy(),approvalRef:'LOCAL_FIXTURE_ENGINE',assertReady:()=>true,clock,...adapters});
  const service=createMarketplacePilot({...fixture,store,enabled:true,environment:'SYNTHETIC_LOCAL',platformAccountId:'demo_platform',quoteProvider,clock});
  try {
    await service.recordConsent(actors.seller,{requestId:'demo_consent',cardId:'demo_card',choice:'HOLD_AND_LIST',evidenceRef:'demo_hold_consent'});
    const listing=await service.publishListing(actors.seller,{requestId:'demo_publish',cardId:'demo_card',askingPriceCents:12500}),quote=await service.quote(actors.buyer,{listingId:listing.id,destinationId:'demo_destination'});
    const reservation=await service.reserve(actors.buyer,{requestId:'demo_reserve',listingId:listing.id,listingVersion:listing.version,listingHash:listing.bindingHash,quoteId:quote.quoteId});
    adapters.revoke();await assert.rejects(service.pay(actors.buyer,{reservationId:reservation.id}),{code:'QUOTE_DESTINATION_CHANGED'});
    assert.equal(Object.keys(store.read().intents).length,0);assert.equal(store.read().reservations[reservation.id].status,'HELD');
  } finally {quoteProvider.close();store.close();}
});

test('atomic local cancellation and first dispatch have mutually exclusive outcomes; no provider proof is fabricated',async()=>{
  const {preparePayment,claimDispatch}=await import('../src/finance.mjs');
  const {markReservationPaymentPending}=await import('../src/reservation.mjs');
  for(const dispatchFirst of [false,true]) {
    let now=FIXTURE_NOW,reads=0;const clock=()=>now,store=openLocalStore({filename:':memory:',environment:'SYNTHETIC_LOCAL',clock}),fixture=createLocalFixture({store,clock,assets:false});
    const service=createMarketplacePilot({...fixture,provider:{...fixture.provider,retrieve:async()=>{reads++;throw new Error('No GET expected');}},store,enabled:true,environment:'SYNTHETIC_LOCAL',platformAccountId:'demo_platform',clock});
    try {
      await service.recordConsent(actors.seller,{requestId:'demo_consent',cardId:'demo_card',choice:'HOLD_AND_LIST',evidenceRef:'demo_hold_consent'});
      const listing=await service.publishListing(actors.seller,{requestId:'demo_publish',cardId:'demo_card',askingPriceCents:12500}),quote=await service.quote(actors.buyer,listing.id);
      const reservation=await service.reserve(actors.buyer,{requestId:'demo_reserve',listingId:listing.id,listingVersion:listing.version,listingHash:listing.bindingHash,quoteId:quote.quoteId});
      const assertion=(await fixture.eligibility.read({cardId:listing.cardId,sellerId:listing.sellerId})).assertion;
      store.transaction(tx=>{preparePayment(tx,{intentId:'demo_prepared',order:reservation.order,platformAccountId:'demo_platform',connectedAccountId:'demo_connected',policy:fixture.financePolicy});markReservationPaymentPending(tx,{reservationId:reservation.id,paymentIntentId:'demo_prepared',eligibility:assertion});});
      if(dispatchFirst) {
        store.transaction(tx=>claimDispatch(tx,'demo_prepared'));now+=3600000;
        await assert.rejects(service.cancelReservation(actors.buyer,{requestId:'demo_cancel',reservationId:reservation.id}),{code:'PAYMENT_LOCAL_VOID_REFUSED'});
        assert.equal(store.read().reservations[reservation.id].status,'PAYMENT_PENDING');assert.equal(store.read().intents.demo_prepared.dispatchCount,1);
      } else {
        now+=3600000;
        const released=await service.cancelReservation(actors.buyer,{requestId:'demo_cancel',reservationId:reservation.id});assert.equal(released.releaseReason,'UNDISPATCHED_CANCELED');
        assert.throws(()=>store.transaction(tx=>claimDispatch(tx,'demo_prepared')),{code:'RECONCILIATION_REQUIRED'});
        const intent=store.read().intents.demo_prepared;assert.equal(intent.status,'VOIDED');assert.equal(intent.terminalUnpaid,false);assert.equal(intent.objectId,null);assert.equal(intent.dispatchCount,0);assert.equal(store.read().journals.length,0);
        assert.equal((await service.reconcilePayment(actors.buyer,{reservationId:reservation.id})).status,'RELEASED');assert.equal(reads,0);
        const revised=await service.reviseListing(actors.seller,{requestId:'demo_revise',listingId:listing.id,expectedVersion:1,expectedBindingHash:listing.bindingHash,askingPriceCents:13000});assert.equal(revised.version,2);
      }
    }finally{store.close();}
  }
});
