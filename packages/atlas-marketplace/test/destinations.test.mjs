import test from 'node:test';
import assert from 'node:assert/strict';
import {openLocalStore} from '../src/store.mjs';
import {createMarketplaceDestinations,assertMarketplaceDestinations} from '../src/destinations.mjs';
import {createMarketplacePilot} from '../src/service.mjs';
import {createApprovedCheckoutQuoteProvider} from '../src/checkout-quote.mjs';
import {createLocalFixture,actors} from '../scripts/local-fixture.mjs';
import {makeCheckoutPolicy,makeQuoteAdapters} from './policy-quote-fixtures.mjs';
import {FIXTURE_NOW as NOW} from './listing-fixtures.mjs';
const address={name:'SYNTHETIC Recipient',phone:'+15555550123',line1:'123 SYNTHETIC TEST STREET',line2:null,city:'Test City',state:'CA',postalCode:'90210',country:'US',residential:'yes'};
const policy={id:'fixture_addresses',version:'1',environment:'SYNTHETIC_LOCAL',approvalRef:'FIXTURE_ONLY',privacyRef:'FIXTURE_ONLY',allowedCountries:['US'],maxActive:3,receiptTtlMs:180000};
function fixture(override){const base=openLocalStore({filename:':memory:',environment:'SYNTHETIC_LOCAL',clock:()=>NOW}),store=override?override(base):base,keys={activeKeyId:'fixture',keys:{fixture:Buffer.alloc(32,9)}};let ready=true;
 const destinations=createMarketplaceDestinations({enabled:true,store,policy,keyring:keys,assertReady:()=>ready,clock:()=>NOW});
 const save=(extra={})=>store.transaction(tx=>destinations.save(tx,{buyerId:'demo_buyer',requestId:'demo_save',destinationId:'demo_address',expectedVersion:0,label:'Home',address,...extra}));
 return {base,store,keys,destinations,save,revoke(){ready=false;},close(){destinations.close();base.close();}};}
test('private address persistence is encrypted and authenticated, owner scoped, versioned and independently gated',async()=>{const f=fixture();try{
 const saved=f.save();assert.equal(saved.version,'1');assert.deepEqual(f.save(),saved);
 assert.throws(()=>f.save({address:{...address,line1:'Different'}}),{code:'IDEMPOTENCY_CONFLICT'});
 const state=f.store.read();assert.equal(JSON.stringify(state).includes(address.line1),false);assert.equal(JSON.stringify(state).includes(address.phone),false);
 const descriptor=await f.destinations.resolve({buyerId:'demo_buyer',destinationId:'demo_address'});assert.equal(descriptor.address,undefined);
 assert.deepEqual(await f.destinations.readAddress({buyerId:'demo_buyer',destinationId:'demo_address',version:descriptor.version,addressHash:descriptor.addressHash}),address);
 await assert.rejects(f.destinations.readAddress({buyerId:'demo_other',destinationId:'demo_address',version:descriptor.version,addressHash:descriptor.addressHash}),{code:'DESTINATION_UNAVAILABLE'});
 assert.throws(()=>f.save({buyerId:'demo_other',requestId:'demo_other',expectedVersion:1}),{code:'DESTINATION_CHANGED'});
 f.save({requestId:'demo_update',expectedVersion:1,address:{...address,line1:'456 SYNTHETIC TEST STREET'}});
 assert.throws(()=>f.store.transaction(tx=>f.destinations.assertInTransaction(tx,descriptor,{buyerId:'demo_buyer'})),{code:'DESTINATION_CHANGED'});
 f.store.transaction(tx=>{tx.state.marketplaceDestinations.demo_address.encrypted.tag=Buffer.alloc(16).toString('base64');});
 const next=await f.destinations.resolve({buyerId:'demo_buyer',destinationId:'demo_address'});await assert.rejects(f.destinations.readAddress({buyerId:'demo_buyer',destinationId:'demo_address',version:next.version,addressHash:next.addressHash}),{code:'DESTINATION_DECRYPTION_UNAVAILABLE'});
 f.revoke();await assert.rejects(f.destinations.list({buyerId:'demo_buyer'}),{code:'DESTINATION_APPROVAL_REQUIRED'});
 }finally{f.close();}});
test('destination changes cannot rewrite the encrypted delivery snapshot retained for a paid order',async()=>{const f=fixture();try{
 f.save();const descriptor=await f.destinations.resolve({buyerId:'demo_buyer',destinationId:'demo_address'});
 f.store.transaction(tx=>{f.destinations.retainForReservation(tx,{reservationId:'demo_reservation',buyerId:'demo_buyer',destination:descriptor});tx.state.orders.demo_order={status:'PAID',orderId:'demo_order',buyerId:'demo_buyer',reservationId:'demo_reservation',quote:{destination:descriptor}};});
 f.store.transaction(tx=>f.destinations.remove(tx,{buyerId:'demo_buyer',requestId:'demo_remove',destinationId:'demo_address',expectedVersion:1}));
 assert.equal((await f.destinations.list({buyerId:'demo_buyer'})).length,0);
 const input={orderId:'demo_order',actorId:'demo_staff',requestId:'demo_read'};assert.deepEqual(f.store.transaction(tx=>f.destinations.readOrderAddress(tx,input)).address,address);f.store.transaction(tx=>f.destinations.readOrderAddress(tx,input));
 assert.equal(f.store.read().events.filter(row=>row.type==='MARKETPLACE_DELIVERY_ADDRESS_ACCESSED').length,1);
 assert.equal(JSON.stringify(f.store.read()).includes(address.line1),false);
 assert.throws(()=>assertMarketplaceDestinations(f.destinations,{store:{read(){},transaction(){}}}),{code:'DESTINATION_STORE_MISMATCH'});
 }finally{f.close();}});
test('joined checkout refuses an address changed between payment preparation and the atomic dispatch claim',async()=>{
 let arm=false,changed=false,destinations;
 const f=fixture(base=>({transaction:fn=>base.transaction(fn),read(fn){const result=base.read(fn);if(arm&&!changed&&result?.kind==='PAYMENT'&&result.status==='PREPARED'){changed=true;base.transaction(tx=>destinations.save(tx,{buyerId:'demo_buyer',requestId:'demo_raced',destinationId:'demo_address',expectedVersion:1,label:'Home',address:{...address,line1:'Changed in other session'}}));}return result;}}));destinations=f.destinations;
 const local=createLocalFixture({store:f.store,clock:()=>NOW,assets:false}),ports=makeQuoteAdapters({clock:()=>NOW}),quoteProvider=createApprovedCheckoutQuoteProvider({enabled:true,policy:makeCheckoutPolicy(),approvalRef:'FIXTURE',assertReady:()=>true,resolveDestination:destinations,shipping:ports.shipping,tax:ports.tax,clock:()=>NOW});
 const service=createMarketplacePilot({...local,enabled:true,environment:'SYNTHETIC_LOCAL',store:f.store,platformAccountId:'demo_platform',destinations,quoteProvider,clock:()=>NOW});
 try {f.save();await service.recordConsent(actors.seller,{requestId:'demo_consent',cardId:'demo_card',choice:'HOLD_AND_LIST',evidenceRef:'demo_hold_consent'});const listing=await service.publishListing(actors.seller,{requestId:'demo_listing',cardId:'demo_card',askingPriceCents:12500});const quote=await service.quote(actors.buyer,{listingId:listing.id,destinationId:'demo_address'}),reservation=await service.reserve(actors.buyer,{requestId:'demo_reserve',listingId:listing.id,listingVersion:listing.version,listingHash:listing.bindingHash,quoteId:quote.quoteId});arm=true;
 await assert.rejects(service.pay(actors.buyer,{reservationId:reservation.id}),{code:'DESTINATION_CHANGED'});assert.equal(changed,true);const intent=Object.values(f.store.read().intents)[0];assert.equal(intent.status,'PREPARED');assert.equal(intent.dispatchCount,0);assert.equal(intent.objectId,null);
 await service.cancelReservation(actors.buyer,{requestId:'demo_cancel',reservationId:reservation.id});assert.equal(f.store.read().reservations[reservation.id].status,'RELEASED');
 await assert.rejects(service.saveDestination(actors.seller,{}),{code:'FORBIDDEN'});await assert.rejects(service.deliveryDestination(actors.buyer,{}),{code:'FORBIDDEN'});
 }finally{quoteProvider.close();f.close();}
});
