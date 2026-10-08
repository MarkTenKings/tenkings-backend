import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHmac} from 'node:crypto';
import {CommerceService} from '../src/service.mjs';
import {clone,digest,assertPaidEvidence,receiptEffects} from '../src/contract.mjs';
import {customerOrder} from '../src/projections.mjs';
import {consumeStripeWebhook} from '../src/webhook.mjs';
import {notificationAdapter} from '../src/notifications.mjs';
import {now,source,payment,tax,memoryRepository} from './fixtures.mjs';
import {shipStationPlan,testPackage} from './shipstation-fixtures.mjs';
const terms={mailClockStart:'ATLAS_RECEIPT',mailChargedLegs:'BOTH_LEGS',shippingPayment:'SEPARATE_PAYMENT'};
function fixture(){
 const input=source('MAIL_IN',1);input.shippingPlans=[];
 const repository=memoryRepository(input),provider=payment('succeeded'),costs=[];
 const service=new CommerceService({repository,payment:provider,tax:{...tax,shippingConfigured:true,async calculateShipping(i){costs.push(i);return tax.calculate(i);}},terms,clock:()=>now});
 const shippingQuotes=new Map(),shippingAttempts=new Map();let paidOrder;
 const confirm=repository.confirmPaid;
 repository.confirmPaid=async d=>{const r=await confirm(d);paidOrder=r.order;return r;};
 repository.shippingCheckout=async orderId=>{assert.equal(orderId,paidOrder.id);const q=[...repository.quotes.values()][0];return {...clone(input),...clone(q),revision:q.draftRevision,cards:q.cards.map(c=>({...c,id:c.cardId})),shippingPlans:clone(input.shippingPlans),order:{...paidOrder,shippingPayment:{state:'UNQUOTED_UNPAID',activePayment:null,receipt:null}},activePayment:[...shippingAttempts.values()].find(a=>a.state!=='CANCELED')??null};};
 repository.saveShippingQuote=async(oid,q)=>{assert.equal(oid,paidOrder.id);shippingQuotes.set(q.id,clone(q));return q;};
 repository.reserveShippingPayment=async d=>{assert.equal(d.orderId,paidOrder.id);const prior=[...shippingAttempts.values()].find(a=>a.state!=='CANCELED');if(prior)return{dispatch:false,attempt:clone(prior)};const quote=shippingQuotes.get(d.quoteId),attempt={id:d.attemptId,orderId:d.orderId,merchant:d.merchant,quote:clone(quote),providerId:null,state:'DISPATCHED'};shippingAttempts.set(attempt.id,attempt);return{dispatch:true,attempt:clone(attempt)};};
 repository.shippingPayment=async(oid,id)=>{const a=shippingAttempts.get(id);assert.equal(a.orderId,oid);return clone(a);};
 repository.recordShippingPayment=async(oid,id,obs)=>{const a=shippingAttempts.get(id);assert.equal(a.orderId,oid);a.state=obs.state;a.observation={...a.observation,...obs};a.providerId=obs.providerId??a.providerId;return clone(a);};
 repository.confirmShippingPaid=async({orderId,attemptId,evidence})=>{const a=shippingAttempts.get(attemptId);assertPaidEvidence(a,evidence);assert.equal(a.orderId,orderId);if(a.state!=='PAID'){a.state='PAID';a.order={...paidOrder,shippingPayment:{state:'PAID',labelReadyEmailEnabled:true,activePayment:{attemptId,state:'PAID'},receipt:{...clone(a.quote),shippingStatus:'PAID'}}};for(const e of receiptEffects(orderId,a.quote).filter(e=>e.kind.endsWith('_LABEL')))repository.effects.set(e.id,{...e,state:'PENDING'});}return{order:clone(a.order)};};
 const carrier={provider:'SHIPSTATION',async quote(request){costs.push(request);return{provider:'SHIPSTATION',providerId:'se-rate-1',shipmentId:'se-shipment-1',carrierId:request.shipment.carrier_id,serviceCode:request.shipment.service_code,carrierName:'UPS',serviceName:'UPS Ground',currency:'usd',amountCents:1250,requestHash:digest(request),expiresAt:new Date(now.getTime()+900000).toISOString()};}};
 async function grade(){const q=await service.quote({draftId:input.draftId,expectedRevision:2});return service.pay({quoteId:q.id,requestId:randomUUID()});}
 async function available(){input.shippingPlans=[shipStationPlan()];service.carrier=carrier;}
 async function shippingQuote(oid){const plan=input.shippingPlans[0];return service.shippingQuote({orderId:oid,packingPresetId:plan.packingPresetId,shippingServiceCode:plan.shippingServiceCode,inboundPackage:testPackage});}
 return{service,input,repository,provider,shippingQuotes,shippingAttempts,costs,grade,available,shippingQuote};
}
test('grading-only quote requires real tax and verified email but no carrier, package or shipping tax; generates no labels',async()=>{
 const f=fixture();const checkout=await f.service.checkout(f.input.draftId);assert.equal(checkout.terms.shippingPayment,'SEPARATE_PAYMENT');assert(!checkout.blockers.includes('SHIPPING_NOT_CONFIGURED'));assert(!checkout.blockers.includes('MEASURED_PACKAGING_NOT_CONFIGURED'));const paid=await f.grade();assert.equal(paid.order.receipt.subtotalCents,4000);assert.equal(paid.order.receipt.totalCents,4800);assert.equal(paid.order.receipt.shippingStatus,'UNQUOTED_UNPAID');assert.equal(paid.order.receipt.terms.shippingPayment,'SEPARATE_PAYMENT');assert.deepEqual(paid.order.receipt.shipping,[]);assert.equal(f.costs.length,0);assert.equal(f.repository.effects.size,2);assert([...f.repository.effects.values()].every(e=>!e.kind.endsWith('_LABEL')));
 const f2=fixture();f2.input.emailVerified=false;await assert.rejects(f2.grade(),/EMAIL_VERIFICATION_REQUIRED/);assert.equal(f2.provider.creates,0);
 await assert.rejects(f.service.quote({draftId:f.input.draftId,expectedRevision:2,inboundPackage:testPackage}),/SHIPPING_SELECTION_DEFERRED/);
});
test('paid grading receipt and one grading reservation stay unchanged across real shipping quote and explicit second payment',async()=>{
 const f=fixture(),paid=await f.grade(),saved=clone(f.repository.quotes.values().next().value);await f.available();const q=await f.shippingQuote(paid.order.id);
 assert.equal(q.purpose,'SHIPPING');assert.equal(q.orderId,paid.order.id);assert.equal(q.subtotalCents,0);assert.equal(q.shippingCents,2500);assert.equal(q.totalCents,3300);assert.deepEqual(f.costs.at(-1).lines,[]);assert.equal(f.provider.creates,1);assert.equal(f.repository.effects.size,2);
 const results=await Promise.all(Array.from({length:8},()=>f.service.shippingPay({orderId:paid.order.id,quoteId:q.id,requestId:randomUUID()})));
 const done=await f.service.shippingReconcile({orderId:paid.order.id,attemptId:results[0].attemptId});assert.equal(done.state,'PAID');assert.equal(done.order.shippingPayment.state,'PAID');assert.equal(done.order.shippingPayment.labelReadyEmailEnabled,true);assert.equal(done.order.receipt.totalCents,4800);assert.equal(done.order.shippingPayment.receipt.totalCents,3300);
 assert.equal(f.provider.creates,2);assert.equal(f.repository.attempts.size,1);assert.equal(f.shippingAttempts.size,1);assert.deepEqual(f.repository.quotes.values().next().value,saved);assert.equal([...f.repository.effects.values()].filter(e=>e.kind==='SHIPSTATION_LABEL').length,2);
});
test('lost separate payment response never creates another intent and recovery ignores subsequently unavailable carrier/package configuration',async()=>{
 const f=fixture(),paid=await f.grade();await f.available();const q=await f.shippingQuote(paid.order.id);let creates=0;f.provider.create=async()=>{creates++;throw Error('lost response');};f.provider.retrieve=async()=>{throw Error('eventually consistent');};
 const pending=await f.service.shippingPay({orderId:paid.order.id,quoteId:q.id,requestId:randomUUID()});assert.equal(pending.state,'UNKNOWN');f.input.shippingPlans=[];f.service.carrier=null;
 const checked=await f.service.shippingCheckout({orderId:paid.order.id});assert.equal(checked.activePayment.attemptId,pending.attemptId);assert.equal(checked.activePayment.state,'UNKNOWN');assert.equal(checked.activePayment.quote.totalCents,3300);assert.equal(checked.activePayment.quote.purpose,'SHIPPING');assert(checked.blockers.includes('SHIPPING_NOT_CONFIGURED'));
 await f.service.shippingPay({orderId:paid.order.id,quoteId:q.id,requestId:randomUUID()});assert.equal(creates,1);assert.equal(f.repository.effects.size,2);
});
test('separate payment cannot mark paid from another amount, quote, order or merchant',async()=>{
 for(const key of ['amountCents','quoteHash','merchantId','attemptId']){const f=fixture(),paid=await f.grade();await f.available();const q=await f.shippingQuote(paid.order.id);const retrieve=f.provider.retrieve;f.provider.retrieve=async a=>({...await retrieve(a),[key]:key==='amountCents'?1:'foreign'});await assert.rejects(f.service.shippingPay({orderId:paid.order.id,quoteId:q.id,requestId:randomUUID()}),/MISMATCH/);assert.equal(f.repository.effects.size,2);}
});
test('one webhook retrieves a shipping intent and calls existing callback confirmation without grading receipt effects',async()=>{
 const attemptId=randomUUID(),orderId=randomUUID(),q={id:randomUUID(),purpose:'SHIPPING',channel:'MAIL_IN',totalCents:2000,currency:'usd',contentHash:'a'.repeat(64),terms:{paymentFlow:'CUSTOMER_PHONE'},merchant:payment().binding};
 const attempt={id:attemptId,orderId,quote:q,merchant:q.merchant,state:'UNKNOWN'};let events=0,confirms=0;
 const event={id:'evt_shipping',type:'payment_intent.succeeded',livemode:false,data:{object:{id:'pi_fixture',metadata:{atlas_attempt:attemptId}}}},rawBody=Buffer.from(JSON.stringify(event)),secret='whsec_fixture',stamp=Math.floor(now.getTime()/1000),signature=`t=${stamp},v1=${createHmac('sha256',secret).update(`${stamp}.`).update(rawBody).digest('hex')}`;
 const repository={async callbackPayment(id){assert.equal(id,attemptId);return attempt;},async providerEvent(){events++;},async callbackConfirm(data){confirms++;assert.equal(data.orderId,orderId);assert.equal(data.effects,undefined);return{order:{id:orderId}};}};
 for(let i=0;i<2;i++)assert.equal((await consumeStripeWebhook({rawBody,signature,secret,now:now.getTime(),repository,payment:payment('succeeded')})).orderId,orderId);assert.equal(events,2);assert.equal(confirms,2);
});
test('shipping receipt and notification DTO has no private second-payment or provider evidence',()=>{
 const order=customerOrder({id:randomUUID(),receipt:{shippingStatus:'UNQUOTED_UNPAID',terms:{shippingPayment:'SEPARATE_PAYMENT'}},shippingPayment:{state:'PAID',labelReadyEmailEnabled:true,secret:'NO_LEAK',activePayment:{id:randomUUID(),state:'PAID',observation:{clientSecret:'NO_LEAK'}},receipt:{purpose:'SHIPPING',shippingStatus:'PAID',tax:{secret:'NO_LEAK'},shipping:[{request:{secret:'NO_LEAK'}}]}},effects:[{id:'label-email',kind:'EMAIL_LABEL_READY',state:'PENDING',request:{to:'NO_LEAK'}}]});
 assert.equal(order.effects.length,1);assert.equal(order.shippingPayment.receipt.purpose,'SHIPPING');assert(!JSON.stringify(order).includes('NO_LEAK'));
});
test('label ready notification says ready only for the explicit label-ready effect and sends no PDF or private provider data',async()=>{
 const sent=[],notifications=notificationAdapter({smsEnabled:false,emailApiKey:'test',emailFrom:'atlas@example.test',fetchImpl:async(_url,o)=>{sent.push(JSON.parse(o.body));return{status:202,headers:new Headers({'x-message-id':'message-fixture'})};}});
 assert.equal(notifications.canSend('EMAIL_LABEL_READY'),true);await notifications.send('EMAIL_LABEL_READY',{to:'customer@example.test',orderId:randomUUID()},'label-ready-1');assert.match(sent[0].subject,/label is ready/);assert.match(sent[0].content[0].value,/sign in/i);assert(!JSON.stringify(sent[0]).includes('labelBase64'));
 await notifications.send('EMAIL_RECEIPT',{to:'customer@example.test',orderId:randomUUID(),totalCents:4000,shippingPayment:'SEPARATE_PAYMENT'},'grade-1');assert.match(sent[1].content[0].value,/Shipping is not quoted or paid/);assert(!sent[1].content[0].value.includes('label is ready'));
 await notifications.send('EMAIL_SHIPPING_RECEIPT',{to:'customer@example.test',orderId:randomUUID(),totalCents:2500},'shipping-1');assert.match(sent[2].subject,/shipping payment receipt/);assert.match(sent[2].content[0].value,/grading payment remains separate/);assert(!sent[2].content[0].value.includes('label is ready to print'));
});

test('separate mail shipping policy never changes dealer grading price or inserts a dealer shipping purchase',async()=>{
 const input=source('KIOSK',2),repository=memoryRepository(input),service=new CommerceService({repository,payment:payment(),tax,terms,clock:()=>now});
 const q=await service.quote({draftId:input.draftId,expectedRevision:2});assert.equal(q.subtotalCents,10000);assert.equal(q.terms.shippingPayment,undefined);assert.equal(q.shippingStatus,undefined);assert.deepEqual(q.shipping,[]);
});
