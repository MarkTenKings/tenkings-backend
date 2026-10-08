import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CommerceService } from '../src/service.mjs';
import { digest,receiptEffects } from '../src/contract.mjs';
import { shipStationAdapter,shippingExternalId,validateInboundPackage,shipStationCustomer } from '../src/shipstation.mjs';
import { assertShippingPlan,materializeShippingRequest } from '../src/shipping-plan.mjs';
import { customerQuote,customerOrder } from '../src/projections.mjs';
import { now,profile,source,payment,tax,carrier,memoryRepository } from './fixtures.mjs';
import { testPackage,shipStationPlan,shipStationSource,ratePayload } from './shipstation-fixtures.mjs';

const response=value=>({ok:true,text:async()=>JSON.stringify(value)});
const request=()=>{const r=materializeShippingRequest(shipStationPlan(), 'RETURN',now);r.shipment.ship_to=shipStationCustomer(profile,'+12025550102');return r;};
const adapter=fetchImpl=>shipStationAdapter({apiKey:'TEST_abcdefghijklmnopqrstuvwxyz',environment:'SANDBOX',fetchImpl,clock:()=>now});
function build(){const checkout=shipStationSource(),repository=memoryRepository(checkout),calls=[];
    const provider={provider:'SHIPSTATION',async quote(input){calls.push({kind:'rate',input:structuredClone(input)});return {provider:'SHIPSTATION',providerId:'se-rate-'+calls.length,shipmentId:'se-shipment-123',carrierId:input.shipment.carrier_id,serviceCode:input.shipment.service_code,
        carrierName:'UPS',serviceName:'UPS Ground',amountCents:1150,currency:'usd',requestHash:digest(input),expiresAt:new Date(service.clock().getTime()+900000).toISOString()};},
        async createLabel(input,id,selected){calls.push({kind:'label',input:structuredClone(input),id,selected:structuredClone(selected)});return {provider:'SHIPSTATION',providerId:'se-label-123',requestHash:digest(input),trackingNumber:'1ZTEST'};}};
    const service=new CommerceService({repository,payment:payment('succeeded'),tax,carrier:provider,terms:{mailClockStart:'ATLAS_RECEIPT',mailChargedLegs:'BOTH_LEGS'},clock:()=>now});
    return {checkout,repository,provider,service,calls,input:{draftId:checkout.draftId,expectedRevision:2,packingPresetId:checkout.shippingPlans[0].packingPresetId,shippingServiceCode:'UPS_GROUND',inboundPackage:structuredClone(testPackage)}};
}
test('stable ShipStation plans bind exact count, carrier, service and measured return package; customer inbound is required without invented defaults',async()=>{
    const p=shipStationPlan();assert.equal(assertShippingPlan(p,1,'BOTH_LEGS',new Date('2027-01-01')),p);
    for(const change of [p=>p.cardCount=2,p=>p.serviceCode='fedex_ground',p=>p.legs.RETURN.shipment.packages[0].weight.value=0,p=>p.legs.RETURN.shipment.insurance_provider='parcelguard',p=>p.legs.INBOUND.shipment.packages=[],p=>p.legs.RETURN.shipment.ship_date='2027-01-01',p=>p.legs.INBOUND.shipDateTimeZone='Mars/Olympus']){const q=structuredClone(p);change(q);assert.throws(()=>assertShippingPlan(q,1,'BOTH_LEGS',now));}
    const b=build();delete b.input.inboundPackage;await assert.rejects(b.service.quote(b.input),/MEASURED_PACKAGE_REQUIRED/);assert.equal(b.calls.length,0);
    for(const value of [null,{}, {...testPackage,insurance:500}, {weight:{unit:'pound',value:0},dimensions:testPackage.dimensions},{weight:testPackage.weight,dimensions:{...testPackage.dimensions,height:Infinity}}])assert.throws(()=>validateInboundPackage(value));
});
test('rates use standalone API selected carrier/service and sum shipping, confirmation and other charges exactly',async()=>{
    const input=request(),before=structuredClone(input),calls=[];
    const a=adapter(async(url,opts)=>{calls.push({url,opts,body:JSON.parse(opts.body)});return response(ratePayload(input.shipment));});
    const result=await a.quote(input);assert.equal(result.amountCents,1150);assert.equal(result.requestHash,digest(input));assert.deepEqual(input,before);
    assert.equal(calls[0].url,'https://api.shipengine.com/v1/rates');assert.deepEqual(calls[0].body.rate_options,{carrier_ids:['se-123'],service_codes:['ups_ground']});
    assert.equal(calls[0].body.shipment.insurance_provider,'none');assert.equal(calls[0].opts.redirect,'error');assert(!JSON.stringify(calls[0].body).includes('TEST_'));
});
test('foreign, duplicate, invalid, untrackable, non-USD and insurance-charged rates never become a paid quote',async()=>{
    for(const mutate of [v=>v.rate_response.rates[0].carrier_id='se-other',v=>v.rate_response.rates.push({...v.rate_response.rates[0]}),v=>v.rate_response.rates[0].validation_status='invalid',v=>v.rate_response.rates[0].trackable=false,v=>v.rate_response.rates[0].shipping_amount.currency='cad',v=>v.rate_response.rates[0].insurance_amount.amount=1,v=>v.rate_response.rates[0].shipping_amount.amount=1.111]){
        const input=request(),v=ratePayload(input.shipment);mutate(v);await assert.rejects(adapter(async()=>response(v)).quote(input));
    }
});
test('rate-ID purchase preserves selected identity, returns bounded private PDF, and only reads the same identity for reconciliation',async()=>{
    const input=request(),id=`${randomUUID()}:shipstation:INBOUND:v1`,pdf=Buffer.from('%PDF-1.7\nSYNTHETIC\n%%EOF'),calls=[];
    const label={label_id:'se-label-123',shipment_id:'se-shipment-123',external_shipment_id:shippingExternalId(id),carrier_id:'se-123',service_code:'ups_ground',voided:false,is_return_label:false,
        status:'completed',tracking_number:'1ZTEST',label_format:'pdf',label_download:{href:`data:application/pdf;base64,${pdf.toString('base64')}`},insurance_cost:{currency:'usd',amount:0},shipment_cost:{currency:'usd',amount:11.5},ship_date:'2026-09-24T00:00:00Z'};
    const a=adapter(async(url,opts)=>{calls.push({url,opts});return response(url.endsWith('/rates')?ratePayload(input.shipment):label);});
    const selected=await a.quote(input),result=await a.createLabel(input,id,selected);assert.equal(result.purchasedAmountCents,1150);assert.equal(result.labelBase64,pdf.toString('base64'));assert.equal(result.requestHash,digest(input));
    assert.deepEqual(JSON.parse(calls[1].opts.body),{label_format:'pdf',label_layout:'4x6',label_download_type:'inline',validate_address:'no_validation',external_shipment_id:shippingExternalId(id)});
    assert(calls[1].url.endsWith('/labels/rates/se-rate-123'));assert.equal(shippingExternalId(id).length,50);
    assert.deepEqual(await a.retrieveLabel(input,id,selected),result);assert.equal(calls[2].opts.method,'GET');assert.match(calls[2].url,/external_shipment_id\/atlas-/);
    label.external_shipment_id='foreign';await assert.rejects(a.retrieveLabel(input,id,selected),/BINDING_MISMATCH/);
});
test('API environment mismatch is refused before network',()=>{
    assert.throws(()=>shipStationAdapter({apiKey:'TEST_abcdefghijklmnopqrstuvwxyz',environment:'PRODUCTION'}),/NOT_CONFIGURED/);
    assert.throws(()=>shipStationAdapter({apiKey:'abcdefghijklmnopqrstuvwxyz',environment:'SANDBOX'}),/NOT_CONFIGURED/);
});
test('customer-measured inbound and configured return freeze in selected paid quote; RETURN stays unclaimed until prepared',async()=>{
    const b=build(),q=await b.service.quote(b.input),saved=structuredClone(b.repository.quotes.get(q.id));
    assert.deepEqual(q.inboundPackage,testPackage);assert.equal(q.shipping.length,2);assert.equal(q.shipping[0].carrierName,'UPS');assert.equal(q.shipping[0].serviceName,'UPS Ground');
    assert.equal(saved.shipping[0].request.shipment.ship_from.name,profile.name);assert.equal(saved.shipping[1].request.shipment.ship_to.name,profile.name);assert.deepEqual(saved.shipping[0].request.shipment.packages[0],{package_code:'package',...testPackage});
    const paid=await b.service.pay({quoteId:q.id,requestId:randomUUID()}),inbound=`${paid.order.id}:shipstation:INBOUND:v1`,ret=`${paid.order.id}:shipstation:RETURN:v1`;
    const before=structuredClone(b.repository.effects.get(ret));await assert.rejects(b.service.runEffect(ret),/RETURN_LABEL_NOT_PREPARED/);assert.deepEqual(b.repository.effects.get(ret),before);
    await b.service.runEffect(inbound);await b.service.runEffect(inbound);assert.equal(b.calls.filter(c=>c.kind==='label').length,1);
    b.service.clock=()=>new Date('2026-10-20T19:00:00.000Z');b.repository.effects.get(ret).fulfillment={requestId:randomUUID(),preparedAt:b.service.clock().toISOString()};
    b.provider.quote=async input=>({provider:'SHIPSTATION',providerId:'se-later-rate',shipmentId:'se-later-shipment',carrierId:'se-123',serviceCode:'ups_ground',carrierName:'UPS',serviceName:'UPS Ground',currency:'usd',amountCents:1850,requestHash:digest(input),expiresAt:new Date(b.service.clock().getTime()+900000).toISOString()});
    await b.service.runEffect(ret);const completed=b.repository.effects.get(ret);
    assert.equal(completed.dispatchSnapshot.shipment.shipment.ship_date,'2026-10-20');assert.equal(completed.dispatchSnapshot.rate.amountCents,1850);
    assert.equal(completed.request.rate.amountCents,1150);assert.deepEqual(b.repository.quotes.get(q.id),saved);assert.equal(b.service.payment.creates,1);
});
test('a lost label response is UNKNOWN and reconciles by read with immutable dispatch, never repurchase or customer re-charge',async()=>{
    const b=build(),q=await b.service.quote(b.input),paid=await b.service.pay({quoteId:q.id,requestId:randomUUID()}),id=`${paid.order.id}:shipstation:INBOUND:v1`;let writes=0,reads=0;
    b.provider.createLabel=async()=>{writes++;throw Error('lost response');};assert.equal((await b.service.runEffect(id)).state,'UNKNOWN');const dispatch=structuredClone(b.repository.effects.get(id).dispatchSnapshot);
    b.service.clock=()=>new Date('2026-10-20T19:00:00Z');await b.service.runEffect(id);assert.equal(writes,1);
    b.provider.retrieveLabel=async(input,effectId,selected)=>{reads++;assert.equal(effectId,id);assert.deepEqual(input,dispatch.shipment);assert.deepEqual(selected,dispatch.rate);return{provider:'SHIPSTATION',providerId:'se-label-123',trackingNumber:'1ZTEST'};};
    assert.equal((await b.service.reconcileEffect(id)).state,'SUCCEEDED');await b.service.reconcileEffect(id);assert.equal(reads,1);assert.equal(writes,1);assert.equal(b.service.payment.creates,1);assert.deepEqual(b.repository.effects.get(id).dispatchSnapshot,dispatch);
});
test('historical FedEx IDs and adapter routing remain independent of selected ShipStation provider',async()=>{
    const b=build(),old=source('MAIL_IN',1);b.repository.source.shippingPlans=old.shippingPlans;b.service.carriers={FEDEX:carrier,SHIPSTATION:b.provider};
    const quote={...old,shipping:[{leg:'RETURN',request:{old:true},providerId:'old-rate'}],profile,totalCents:5000,tax:{providerId:'taxcalc_old'},currency:'usd',contentHash:'a'.repeat(64)};
    const effects=receiptEffects('historic',quote);assert.equal(effects.find(e=>e.kind==='FEDEX_LABEL').id,'historic:fedex:RETURN:v1');
    const publicOrder=customerOrder({id:'historic',receipt:quote,effects:[{id:'historic:fedex:RETURN:v1',kind:'FEDEX_LABEL',state:'SUCCEEDED',request:{secret:'no'}}]});assert.equal(publicOrder.effects.length,1);assert(!JSON.stringify(publicOrder).includes('secret'));
});
test('safe projections retain carrier/service and measured input but omit account, rate IDs, dispatch and label bytes',()=>{
    const q=customerQuote({inboundPackage:{...testPackage,private:'secret'},shipping:[{leg:'INBOUND',provider:'SHIPSTATION',carrierName:'UPS',serviceName:'Ground',providerId:'PRIVATE_RATE',request:{secret:1}}]});
    assert.deepEqual(q.inboundPackage,testPackage);assert(!JSON.stringify(q).includes('PRIVATE_RATE'));assert(!JSON.stringify(q).includes('secret'));
});
test('tracking reads one purchased label and refuses a foreign tracking number',async()=>{
    const calls=[],value={tracking_number:'1ZTEST',status_code:'DE',status_description:'Delivered'};
    const a=adapter(async(url,opts)=>{calls.push({url,method:opts.method});return response(value);});
    const result=await a.track('se-label-123','1ZTEST');assert.equal(result.statusCode,'DE');assert.deepEqual(calls,[{url:'https://api.shipengine.com/v1/labels/se-label-123/track',method:'GET'}]);
    await assert.rejects(a.track('se-label-123','OTHER'),/TRACKING_INVALID/);assert(!Object.hasOwn(result,'custody'));
});


test('customer measurement limits accept equivalent units and reject excessive weight, length or girth',()=>{
    for(const p of [{weight:{unit:'pound',value:150},dimensions:{unit:'inch',length:108,width:14,height:14.5}}, {weight:{unit:'kilogram',value:68.0388555},dimensions:{unit:'centimeter',length:274.32,width:35.56,height:36.83}}])assert.equal(validateInboundPackage(p),p);
    for(const p of [{weight:{unit:'pound',value:150.01},dimensions:testPackage.dimensions},{weight:testPackage.weight,dimensions:{unit:'inch',length:109,width:1,height:1}},{weight:testPackage.weight,dimensions:{unit:'inch',length:100,width:20,height:20}}])assert.throws(()=>validateInboundPackage(p),/PACKAGE_EXCEEDS_PARCEL_LIMITS/);
});


test('dispatch preparation follows rate retrieval latency and refuses a date that crossed local midnight',async()=>{
    for(const crossMidnight of [false,true]){
        const b=build(),q=await b.service.quote(b.input),paid=await b.service.pay({quoteId:q.id,requestId:randomUUID()}),id=`${paid.order.id}:shipstation:INBOUND:v1`;
        let instant=new Date(crossMidnight?'2026-10-21T06:59:59.900Z':'2026-10-20T19:00:00.000Z');b.service.clock=()=>instant;
        const quote=b.provider.quote;b.provider.quote=async input=>{instant=new Date(instant.getTime()+500);return quote(input);};
        if(crossMidnight){await assert.rejects(b.service.runEffect(id),/SHIPPING_DATE_CHANGED/);assert.equal(b.repository.effects.get(id).state,'PENDING');assert.equal(b.calls.filter(c=>c.kind==='label').length,0);}
        else{await b.service.runEffect(id);const dispatch=b.repository.effects.get(id).dispatchSnapshot;assert.equal(dispatch.preparedAt,'2026-10-20T19:00:00.500Z');assert(Date.parse(dispatch.rate.expiresAt)<=Date.parse(dispatch.preparedAt)+900000);}
    }
});
