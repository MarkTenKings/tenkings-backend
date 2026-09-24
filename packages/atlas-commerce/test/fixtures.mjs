import { randomUUID } from 'node:crypto';
import { clone, digest, assertPaidEvidence } from '../src/contract.mjs';
export const now = new Date('2026-09-24T10:00:00.000Z');
export const merchant = { provider:'STRIPE',accountId:'acct_atlas',livemode:false };
export const profile = {name:'Test Customer',email:'customer@example.test',address1:'10 Example Way',address2:'',city:'Example',region:'CA',postalCode:'90001',country:'US'};
export const party = {contact:{personName:'ATLAS Test',phoneNumber:'+15555550101'},address:{streetLines:['20 Test Way'],city:'Example',stateOrProvinceCode:'CA',postalCode:'90001',countryCode:'US'}};
export const shipment = () => ({shipDateTimeZone:'America/Los_Angeles',requestedShipment:{shipper:clone(party),recipients:[clone(party)],shipDatestamp:'2026-09-25',serviceType:'FEDEX_GROUND',pickupType:'DROPOFF_AT_FEDEX_LOCATION',packagingType:'YOUR_PACKAGING',totalPackageCount:1,shippingChargesPayment:{paymentType:'THIRD_PARTY'},
    requestedPackageLineItems:[{weight:{units:'LB',value:1.2},dimensions:{units:'IN',length:9,width:6,height:4}}]}});
export function source(channel='KIOSK',count=2) { return {draftId:randomUUID(),accountId:randomUUID(),revision:2,profile:clone(profile),profileRevision:2,phone:'+15555550102',channel,
    cards:Array.from({length:count},()=>({id:randomUUID(),revision:1,photoPairHash:'a'.repeat(64),identity:{title:'Reviewed test card'}})),
    location:channel==='KIOSK'?{id:randomUUID(),dealerId:randomUUID(),revision:1,name:'Configured Test Kiosk',terminalId:'tmr_atlas',terminalLocationId:'tml_atlas',address:{line1:'20 Kiosk Way',city:'Example',region:'CA',postalCode:'90002',country:'US'},
        schedule:{timeZone:'America/Los_Angeles',nextCollectionAt:'2026-09-25T10:00:00.000Z',projectedReturnAt:'2026-10-02T10:00:00.000Z'}}:null,
    shippingPlans:[{version:'atlas-measured-shipping-plan-v1',packingPresetId:'measured-one',shippingServiceCode:'FEDEX_GROUND',cardCount:count,measurementReference:'LOCAL_FIXTURE_ONLY: measured package for exact card count',validFrom:'2026-09-24T00:00:00.000Z',validUntil:'2026-09-25T00:00:00.000Z',label:'Measured test box · FedEx Ground',packaging:'9 × 6 × 4 in / 1.2 lb',legs:{INBOUND:shipment(),RETURN:shipment()}}]}; }
export function memoryRepository(checkout) {
    const quotes=new Map(),attempts=new Map(),effects=new Map();let order=null;
    return {quotes,attempts,effects,source:checkout,
        async loadCheckout(){return clone(checkout);},async saveQuote(expected,q){quotes.set(q.id,clone(q));return q;},
        async reservePayment(data){const q=quotes.get(data.quoteId);if(!q)throw Error('Missing quote');
            let attempt=[...attempts.values()].find(a=>a.quote.draftId===q.draftId&&a.state!=='CANCELED');
            if(attempt)return {attempt:clone(attempt),dispatch:false};
            if(q.draftRevision!==checkout.revision)throw Error('CHECKOUT_CHANGED');
            attempt={id:data.attemptId,quote:clone(q),merchant:data.merchant,state:'DISPATCHED',providerId:null};attempts.set(attempt.id,attempt);
            return {attempt:clone(attempt),dispatch:true};},
        async recordPayment(id,obs){const a=attempts.get(id);a.observation={...a.observation,...obs};a.state=obs.state;a.providerId=obs.providerId??a.providerId;return clone(a);},
        async payment(id){return clone(attempts.get(id));},
        async confirmPaid({attemptId,evidence,receiptId,effects:jobs}){const a=attempts.get(attemptId);assertPaidEvidence(a,evidence);
            if(!order){order={id:receiptId,reference:'ATLAS-TEST',receipt:clone(a.quote)};a.state='PAID';a.order=order;for(const job of jobs)effects.set(job.id,{...job,state:'PENDING'});}return {order:clone(order)};},
        async effect(id){return clone(effects.get(id));},
        async claimEffect(id,claimId){const e=effects.get(id);if(e.state!=='PENDING')return {effect:clone(e),dispatch:false};e.state='DISPATCHED';e.claimId=claimId;return {effect:clone(e),dispatch:true};},
        async finishEffect({effectId,claimId,state,result}){const e=effects.get(effectId);if(e.claimId!==claimId)throw Error('claim mismatch');Object.assign(e,{state,result});return clone(e);}
    };
}
export const tax = { async calculate(input){return {provider:'STRIPE_TAX',providerId:'taxcalc_fixture',currency:'usd',taxCents:800,totalCents:input.subtotalCents+input.shippingCents+800,requestHash:digest(input),expiresAt:'2026-09-24T10:15:00.000Z'};}};
export function payment(status='requires_payment_method') {return {binding:merchant,publishableKey:'pk_test_fixture',creates:0,
    async create(attempt){this.creates++;return {providerId:'pi_fixture',state:'AWAITING_PAYMENT',clientSecret:'pi_fixture_secret'};},
    async retrieve(attempt){return {source:'PROVIDER_RETRIEVAL',provider:'STRIPE',merchantId:merchant.accountId,livemode:false,providerId:'pi_fixture',status,
        amountCents:attempt.quote.totalCents,receivedCents:status==='succeeded'?attempt.quote.totalCents:0,currency:'usd',quoteHash:attempt.quote.contentHash,attemptId:attempt.id,
        paymentMethodTypes:[attempt.quote.channel==='KIOSK'?'card_present':'card'],clientSecret:'pi_fixture_secret'};}};}
export const carrier = { async quote(input){return {provider:'FEDEX',providerId:'rate_fixture',currency:'usd',amountCents:1250,requestHash:digest(input),expiresAt:'2026-09-24T10:15:00.000Z'};}};
