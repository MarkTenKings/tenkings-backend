import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CommerceService } from '../src/service.mjs';
import { digest, assertPaidEvidence, receiptEffects } from '../src/contract.mjs';
import { configurationPresence, createCommerceProviders } from '../src/config.mjs';
import { source, memoryRepository, tax, payment, carrier, now } from './fixtures.mjs';

const build=(channel='KIOSK',overrides={})=>{const checkout=source(channel),repository=memoryRepository(checkout),provider=payment();
    const service=new CommerceService({repository,payment:provider,tax,carrier,clock:()=>now,terms:{mailClockStart:'ATLAS_RECEIPT',mailChargedLegs:'INBOUND_ONLY'},...overrides});
    return {checkout,repository,provider,service,input:{draftId:checkout.draftId,expectedRevision:2,packingPresetId:'measured-one',shippingServiceCode:'FEDEX_GROUND'}};};
test('exact kiosk unit prices and commissions exclude actual tax; shipping never called',async()=>{let quotes=0;const b=build('KIOSK',{carrier:{quote(){quotes++;throw Error('must not call');}}});
    const q=await b.service.quote(b.input);assert.equal(q.subtotalCents,10000);assert.equal(q.taxCents,800);assert.equal(q.totalCents,10800);assert.equal(q.shippingCents,0);
    const saved=b.repository.quotes.get(q.id);assert.deepEqual(saved.cards.map(c=>c.commissionCents),[500,500]);assert.equal(quotes,0);assert.equal(q.terms.clockStart,'ATLAS_COLLECTION');assert.equal(digest(Object.fromEntries(Object.entries(saved).filter(([k])=>k!=='contentHash'))),saved.contentHash);});
test('mail rates use measured preset and actual confirmed customer address, $40 each',async()=>{let captured;const b=build('MAIL_IN',{carrier:{async quote(input){captured=input;return carrier.quote(input);}}});const q=await b.service.quote(b.input);
    assert.equal(q.subtotalCents,8000);assert.equal(q.shippingCents,1250);assert.equal(q.totalCents,10050);assert.equal(b.repository.quotes.get(q.id).cards[0].commissionCents,0);
    assert.equal(captured.requestedShipment.shipper.contact.personName,b.checkout.profile.name);assert.equal(captured.requestedShipment.shipper.address.streetLines[0],b.checkout.profile.address1);});
test('both legs obtain independent quotes and package inputs',async()=>{const b=build('MAIL_IN',{terms:{mailClockStart:'ATLAS_RECEIPT',mailChargedLegs:'BOTH_LEGS'}});const q=await b.service.quote(b.input);
    assert.equal(q.shipping.length,2);assert.equal(q.shippingCents,2500);const saved=b.repository.quotes.get(q.id);assert.notDeepEqual(saved.shipping[0].request,saved.shipping[1].request);});
test('shipping controls need no invented customer party: both directions use the confirmed profile',async()=>{const b=build('MAIL_IN',{terms:{mailClockStart:'ATLAS_RECEIPT',mailChargedLegs:'BOTH_LEGS'}});
    delete b.checkout.shippingPlans[0].legs.INBOUND.requestedShipment.shipper;delete b.checkout.shippingPlans[0].legs.RETURN.requestedShipment.recipients;
    const q=await b.service.quote(b.input),saved=b.repository.quotes.get(q.id);assert.equal(saved.shipping[0].request.requestedShipment.shipper.contact.personName,b.checkout.profile.name);
    assert.equal(saved.shipping[1].request.requestedShipment.recipients[0].contact.personName,b.checkout.profile.name);
});
test('mail package options and quotes require the exact measured card count before any provider request',async()=>{let calls=0;const b=build('MAIL_IN',{carrier:{async quote(){calls++;throw Error('must not call');}}});
    b.checkout.shippingPlans[0].cardCount=1;
    assert.deepEqual((await b.service.checkout(b.checkout.draftId)).shippingOptions,[]);
    await assert.rejects(()=>b.service.quote({...b.input,cardCount:1}),/PACKAGING_REQUIRED/);assert.equal(calls,0);
});
test('unmeasured, stale, future-admission and malformed shipment plans cannot dispatch a quote',async()=>{
    const changes=[p=>delete p.measurementReference,p=>p.validUntil='2026-09-24T09:59:59.000Z',p=>p.validFrom='2026-09-24T10:01:00.000Z',
        p=>p.validUntil='2026-09-27T00:00:00.000Z',p=>p.legs.INBOUND.requestedShipment.shipDatestamp='2026-02-30',
        p=>p.legs.INBOUND.requestedShipment.shipDatestamp='2026-09-23',p=>p.legs.INBOUND.shipDateTimeZone='Mars/Olympus',
        p=>p.legs.INBOUND.requestedShipment.requestedPackageLineItems[0].weight.value=0,
        p=>p.legs.INBOUND.requestedShipment.serviceType='WRONG_SERVICE'];
    for(const change of changes){let calls=0;const b=build('MAIL_IN',{carrier:{async quote(){calls++;throw Error('must not call');}}});change(b.checkout.shippingPlans[0]);
        assert.deepEqual((await b.service.checkout(b.checkout.draftId)).shippingOptions,[]);await assert.rejects(()=>b.service.quote(b.input));assert.equal(calls,0);}
});
test('both-leg plans validate return measurements and date before the first carrier quote',async()=>{let calls=0;const b=build('MAIL_IN',{terms:{mailClockStart:'ATLAS_RECEIPT',mailChargedLegs:'BOTH_LEGS'},carrier:{async quote(){calls++;throw Error('must not call');}}});
    b.checkout.shippingPlans[0].legs.RETURN.requestedShipment.shipDatestamp='2026-09-23';await assert.rejects(()=>b.service.quote(b.input),/SHIPPING_DATE_EXPIRED/);assert.equal(calls,0);
});
test('a duplicate preset/count/service is refused rather than silently selecting one measurement',async()=>{const b=build('MAIL_IN');b.checkout.shippingPlans.push(structuredClone(b.checkout.shippingPlans[0]));await assert.rejects(()=>b.service.quote(b.input),/PACKAGING_REQUIRED/);});
test('quote persists exact private measured plan and cannot outlive its configured admission window',async()=>{const b=build('MAIL_IN');b.checkout.shippingPlans[0].validUntil='2026-09-24T10:02:00.000Z';const q=await b.service.quote(b.input),saved=b.repository.quotes.get(q.id);
    assert.deepEqual(saved.shippingPlan,b.checkout.shippingPlans[0]);assert.equal(q.shippingPlan,undefined);assert.equal(q.expiresAt,'2026-09-24T10:02:00.000Z');
    b.checkout.shippingPlans[0].legs.INBOUND.requestedShipment.requestedPackageLineItems[0].weight.value=99;assert.equal(saved.shippingPlan.legs.INBOUND.requestedShipment.requestedPackageLineItems[0].weight.value,1.2);
});
test('shipment dates use configured origin timezone and are never rewritten',async()=>{const time=new Date('2026-09-24T00:30:00.000Z');let actual;const b=build('MAIL_IN',{clock:()=>time,carrier:{async quote(input){actual=input;return carrier.quote(input);}}});
    b.checkout.shippingPlans[0].legs.INBOUND.requestedShipment.shipDatestamp='2026-09-23';await b.service.quote(b.input);assert.equal(actual.requestedShipment.shipDatestamp,'2026-09-23');
});
for(const terms of [{},{mailClockStart:'ATLAS_RECEIPT'},{mailChargedLegs:'INBOUND_ONLY'},{mailClockStart:'CARRIER_ACCEPTANCE',mailChargedLegs:'INBOUND_ONLY'}])test(`mail unknown terms fail closed ${JSON.stringify(terms)}`,async()=>{const b=build('MAIL_IN',{terms});await assert.rejects(()=>b.service.quote(b.input),/NOT_CONFIGURED/);});
test('missing tax is never zero tax',async()=>{const b=build('KIOSK',{tax:null});await assert.rejects(()=>b.service.quote(b.input),/NOT_CONFIGURED/);});
test('real zero tax calculation is valid with source',async()=>{const b=build('KIOSK',{tax:{async calculate(input){const result=await tax.calculate(input);return {...result,taxCents:0,totalCents:input.subtotalCents};}}});assert.equal((await b.service.quote(b.input)).taxCents,0);});
test('mismatched tax, amount, currency and source binding fail',async()=>{for(const change of [{totalCents:1},{currency:'eur'},{taxCents:-1},{providerId:null},{requestHash:'bad'}]){
    const b=build('KIOSK',{tax:{async calculate(input){return {...await tax.calculate(input),...change};}}});await assert.rejects(()=>b.service.quote(b.input),/TAX_QUOTE_INVALID/);}});
test('caller amounts cannot override server pricing; stale revision denied',async()=>{const b=build();const q=await b.service.quote({...b.input,unitCents:1,taxCents:0,shippingCents:999});assert.equal(q.cards[0].unitCents,5000);await assert.rejects(()=>b.service.quote({...b.input,expectedRevision:1}),/CHECKOUT_CHANGED/);});
test('new shop checkout needs schedule and dealer identity but no terminal or package printer',async()=>{
    const b=build();delete b.checkout.location.terminalId;delete b.checkout.location.terminalLocationId;delete b.checkout.location.packagePrinterId;
    const q=await b.service.quote(b.input);assert.equal(q.terms.paymentFlow,'CUSTOMER_PHONE');
    assert.equal(b.repository.quotes.get(q.id).location.terminalId,undefined);
    delete b.checkout.location.schedule.projectedReturnAt;await assert.rejects(()=>b.service.quote(b.input),/KIOSK_NOT_AVAILABLE/);
});
test('new shop checkout requires receipt email and produces no SMS effect',async()=>{
    for (const contact of [{name:'Shop Customer',email:'shop@example.test'}]) {
        let taxInput,shippingCalls=0;const b=build('KIOSK',{payment:payment('succeeded'),tax:{async calculate(input){taxInput=input;return tax.calculate(input);}},carrier:{async quote(){shippingCalls++;throw Error('must not ship shop cards');}}});
        b.checkout.profile=contact;
        const quote=await b.service.quote(b.input),stored=b.repository.quotes.get(quote.id);
        assert.deepEqual(stored.profile,contact);assert.equal(stored.phone,b.checkout.phone);assert.equal(quote.shippingCents,0);assert.equal(shippingCalls,0);
        assert.deepEqual(taxInput.location.address,b.checkout.location.address);assert.deepEqual(taxInput.profile,contact);
        const paid=await b.service.pay({quoteId:quote.id,requestId:randomUUID()});assert.equal(paid.state,'PAID');
        const expected=['EMAIL_RECEIPT','TAX_TRANSACTION'];
        assert.deepEqual([...b.repository.effects.values()].map(effect=>effect.kind).sort(),expected);
        assert.equal([...b.repository.effects.values()].some(effect=>effect.kind==='SMS_RECEIPT'),false);
        assert.equal((await b.service.reconcile(paid.attemptId)).order.id,paid.order.id);assert.equal(b.repository.effects.size,expected.length);
    }
});
test('new shop name and receipt email are required; a compact shop contact cannot be used for mail',async()=>{
    for(const contact of [{},{name:''},{name:'Shop Customer'},{name:'Shop Customer',email:''},{name:'Shop Customer',email:'bad'},{name:'Shop Customer',email:null}]) {
        let taxCalls=0;const b=build('KIOSK',{tax:{async calculate(){taxCalls++;throw Error('must not call');}}});b.checkout.profile=contact;
        await assert.rejects(()=>b.service.quote(b.input),/PROFILE_(INCOMPLETE|EMAIL_REQUIRED)/);assert.equal(taxCalls,0);
    }
    const mail=build('MAIL_IN');mail.checkout.profile={name:'Shop Customer'};await assert.rejects(()=>mail.service.quote(mail.input),/PROFILE_INCOMPLETE/);
});
test('unverified or duplicate photo roster cannot quote',async()=>{const b=build();b.checkout.cards[0].photoPairHash='';await assert.rejects(()=>b.service.quote(b.input),/CARD_REVIEW_REQUIRED/);
    b.checkout.cards[0].photoPairHash='a'.repeat(64);b.checkout.cards[1].id=b.checkout.cards[0].id;await assert.rejects(()=>b.service.quote(b.input),/DUPLICATE_CARD/);});
test('concurrent payment requests produce one provider intent; ACK is not paid',async()=>{const b=build();const q=await b.service.quote(b.input);
    const outcomes=await Promise.all([1,2,3].map(()=>b.service.pay({quoteId:q.id,requestId:randomUUID()})));assert.equal(b.provider.creates,1);assert.equal(new Set(outcomes.map(o=>o.attemptId)).size,1);assert.equal(b.repository.effects.size,0);assert.ok(outcomes.every(o=>!o.order));});
test('lost create reply stays unknown, repeated Pay does not create another intent',async()=>{const p=payment();p.create=async()=>{p.creates++;throw Error('lost');};p.retrieve=async()=>{throw Error('not yet discoverable');};const b=build('KIOSK',{payment:p});const q=await b.service.quote(b.input);
    const first=await b.service.pay({quoteId:q.id,requestId:randomUUID()});assert.equal(first.state,'UNKNOWN');await b.service.pay({quoteId:q.id,requestId:randomUUID()});assert.equal(p.creates,1);assert.equal(b.repository.effects.size,0);});
test('confirmed payment atomically creates one order and durable receipt effects on retries',async()=>{const b=build('KIOSK',{payment:payment('succeeded')});const q=await b.service.quote(b.input);
    const first=await b.service.pay({quoteId:q.id,requestId:randomUUID()}),second=await b.service.reconcile(first.attemptId);assert.equal(first.state,'PAID');assert.equal(first.order.id,second.order.id);assert.equal(b.repository.effects.size,2);assert.ok([...b.repository.effects.values()].every(effect=>effect.kind!=='PACKAGE_LABEL'));});
test('provider amount/merchant/mode/hash mismatches cannot mark paid',async()=>{for(const patch of [{amountCents:1},{receivedCents:1},{merchantId:'acct_other'},{livemode:true},{quoteHash:'b'.repeat(64)},{paymentMethodTypes:['card_present']}]){
    const p=payment('succeeded'),original=p.retrieve;p.retrieve=async a=>({...await original(a),...patch});const b=build('KIOSK',{payment:p}),q=await b.service.quote(b.input);
    await assert.rejects(()=>b.service.pay({quoteId:q.id,requestId:randomUUID()}),/PAYMENT_/);assert.equal(b.repository.effects.size,0);}});
test('unknown notification effect is durable and never automatically redispatched',async()=>{let sends=0;const b=build('KIOSK',{payment:payment('succeeded'),notifications:{async send(){sends++;throw Error('lost');}}});const q=await b.service.quote(b.input);await b.service.pay({quoteId:q.id,requestId:randomUUID()});
    const id=[...b.repository.effects.keys()].find(id=>id.includes(':email:'));assert.equal((await b.service.runEffect(id)).state,'UNKNOWN');await b.service.runEffect(id);assert.equal(sends,1);});
test('FedEx label async acknowledgement never counts as a saved label',async()=>{const b=build('MAIL_IN',{payment:payment('succeeded'),carrier:{...carrier,async createLabel(){return {state:'PROCESSING',jobId:'fedex-job'};}}});const q=await b.service.quote(b.input);await b.service.pay({quoteId:q.id,requestId:randomUUID()});
    const id=[...b.repository.effects.keys()].find(id=>id.includes(':fedex:'));const effect=await b.service.runEffect(id);assert.equal(effect.state,'UNKNOWN');assert.equal(effect.result.jobId,'fedex-job');});
test('configuration defaults disabled, exposes presence only and ignores legacy keys',()=>{const env={STRIPE_SECRET_KEY:'never-use',ATLAS_COMMERCE_STRIPE_SECRET_KEY:'hidden'};assert.equal(createCommerceProviders(env).enabled,false);const safe=configurationPresence(env);assert.equal(safe.ATLAS_COMMERCE_STRIPE_SECRET_KEY,true);assert.doesNotMatch(JSON.stringify(safe),/hidden|never-use/);});
test('explicit enabled with missing actual tax or merchant fails',()=>{assert.throws(()=>createCommerceProviders({ATLAS_COMMERCE_ENABLED:'true'}),/NOT_CONFIGURED/);});
test('missing delivery adapter leaves outbox pending without claiming',async()=>{const b=build('KIOSK',{payment:payment('succeeded')});const q=await b.service.quote(b.input);await b.service.pay({quoteId:q.id,requestId:randomUUID()});
    const id=[...b.repository.effects.keys()].find(id=>id.includes(':email:'));await assert.rejects(()=>b.service.runEffect(id),/RECEIPTS_NOT_CONFIGURED/);assert.equal(b.repository.effects.get(id).state,'PENDING');assert.equal(b.repository.effects.get(id).claimId,undefined);});
test('historical paid order survives disabled kiosk and absent payment configuration',async()=>{const b=build('KIOSK',{payment:payment('succeeded')}),q=await b.service.quote(b.input),paid=await b.service.pay({quoteId:q.id,requestId:randomUUID()});
    b.checkout.activePayment={id:paid.attemptId,state:'PAID',order:paid.order};b.checkout.location=null;b.service.payment=null;b.service.tax=null;
    const recovered=await b.service.checkout(b.checkout.draftId);assert.equal(recovered.activePayment.order.id,paid.order.id);assert.equal(recovered.location.name,'Configured Test Kiosk');assert.equal(recovered.blockers.length,0);});
test('known async FedEx reconciliation retrieves original job and never creates another shipment',async()=>{let creates=0,reads=0;const b=build('MAIL_IN',{payment:payment('succeeded'),carrier:{...carrier,async createLabel(){creates++;return {state:'PROCESSING',jobId:'original-job'};},async retrieveAsync(jobId){reads++;assert.equal(jobId,'original-job');return {trackingNumber:'123',labelBase64:'fixture'};}}});
    const q=await b.service.quote(b.input);await b.service.pay({quoteId:q.id,requestId:randomUUID()});const id=[...b.repository.effects.keys()].find(id=>id.includes(':fedex:'));await b.service.runEffect(id);const result=await b.service.reconcileEffect(id);assert.equal(result.state,'SUCCEEDED');assert.equal(result.result.jobId,'original-job');assert.equal(creates,1);assert.equal(reads,1);});
test('delayed label creation with an expired ship date stays pending before dispatch and never changes the saved request',async()=>{let calls=0;const b=build('MAIL_IN',{payment:payment('succeeded'),carrier:{...carrier,async createLabel(){calls++;throw Error('must not call');}}});
    const q=await b.service.quote(b.input);await b.service.pay({quoteId:q.id,requestId:randomUUID()});const id=[...b.repository.effects.keys()].find(id=>id.includes(':fedex:')),saved=structuredClone(b.repository.effects.get(id));
    b.service.clock=()=>new Date('2026-09-26T10:00:00.000Z');await assert.rejects(()=>b.service.runEffect(id),/SHIPPING_DATE_EXPIRED/);assert.equal(calls,0);assert.deepEqual(b.repository.effects.get(id),saved);
});
