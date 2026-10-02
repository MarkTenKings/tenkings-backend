import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, createHash, randomUUID } from 'node:crypto';
import { fedexAdapter,stripePaymentAdapter,stripeTaxAdapter,stripeTransport,verifyStripeWebhook,dollarsToCents,validateShipment } from '../src/providers.mjs';
import { createPackageLabel } from '../src/package-label.mjs';
import { notificationAdapter } from '../src/notifications.mjs';
import { consumeStripeWebhook } from '../src/webhook.mjs';
import { source,merchant,shipment,now,payment } from './fixtures.mjs';
const json=value=>new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
function attempt(channel='KIOSK') {const s=source(channel);return {id:randomUUID(),merchant,providerId:'pi_original',quote:{...s,id:randomUUID(),merchant,totalCents:10800,currency:'usd',contentHash:'a'.repeat(64)}};}
const pi=a=>({id:'pi_original',amount:10800,amount_received:0,currency:'usd',status:'requires_payment_method',livemode:false,client_secret:'pi_original_secret',payment_method_types:[a.quote.channel==='KIOSK'?'card_present':'card'],metadata:{atlas_attempt:a.id,atlas_quote_hash:a.quote.contentHash}});
test('Stripe transport validates ATLAS merchant before dispatch and sends pinned version/idempotency',async()=>{const calls=[];const transport=stripeTransport({secretKey:'sk_test_fixture',apiVersion:'2024-06-20',accountId:'acct_atlas',livemode:false,
    fetchImpl:async(url,options)=>{calls.push({url,options});return json(url.endsWith('/account')?{id:'acct_atlas',charges_enabled:true}:{id:'response'});}});
    await transport.request('POST','/v1/payment_intents',{amount:5000,payment_method_types:['card']},'atlas-attempt');assert.equal(calls.length,2);assert.equal(calls[1].options.headers['Idempotency-Key'],'atlas-attempt');assert.equal(calls[1].options.headers['Stripe-Version'],'2024-06-20');assert.match(calls[1].options.body,/amount=5000/);assert.match(calls[1].options.body,/payment_method_types%5B0%5D=card/);});
test('wrong merchant or disabled account prevents payment dispatch',async()=>{for(const account of [{id:'acct_other',charges_enabled:true},{id:'acct_atlas',charges_enabled:false}]){let calls=0;const transport=stripeTransport({secretKey:'sk_test_fixture',apiVersion:'2024-06-20',accountId:'acct_atlas',livemode:false,fetchImpl:async()=>{calls++;return json(account);}});await assert.rejects(()=>transport.request('POST','/v1/payment_intents',{}),/NOT_QUALIFIED/);assert.equal(calls,1);}});
test('Stripe live/test mismatch fails before network',()=>{assert.throws(()=>stripeTransport({secretKey:'sk_live_fixture',apiVersion:'2024-06-20',accountId:'acct_atlas',livemode:false}),/NOT_CONFIGURED/);});
test('terminal uses only configured reader/location and one PaymentIntent identity',async()=>{const a=attempt(),calls=[];const adapter=stripePaymentAdapter({publishableKey:'pk_test_fixture',transport:{binding:merchant,async request(method,path,body,key){calls.push({method,path,body,key});
    if(path==='/v1/terminal/readers/tmr_atlas')return {id:'tmr_atlas',location:'tml_atlas',livemode:false,status:'online'};
    if(path==='/v1/payment_intents')return pi(a);return {action:{status:'in_progress'}};}}});const result=await adapter.create(a);
    assert.equal(result.state,'AWAITING_PAYMENT');assert.equal(result.providerId,'pi_original');assert.equal(result.clientSecret,undefined);assert.equal(calls[2].body.payment_intent,'pi_original');assert.deepEqual(calls[1].body.payment_method_types,['card_present']);assert.equal(calls[1].body.capture_method,'automatic');});
test('offline, other-location and busy readers fail before PaymentIntent creation',async()=>{for(const fields of [{status:'offline'},{location:'tml_other'},{action:{status:'in_progress'}}]){let calls=0;const adapter=stripePaymentAdapter({publishableKey:'pk_test_fixture',transport:{binding:merchant,async request(){calls++;return {id:'tmr_atlas',location:'tml_atlas',status:'online',livemode:false,...fields};}}});await assert.rejects(()=>adapter.create(attempt()),/TERMINAL_UNAVAILABLE/);assert.equal(calls,1);}});
test('lost terminal command reply retains provider intent, does not infer failure',async()=>{const a=attempt();const adapter=stripePaymentAdapter({publishableKey:'pk_test_fixture',transport:{binding:merchant,async request(method,path){if(path.includes('process_payment_intent'))throw Error('timeout');return path.includes('/readers/')?{id:'tmr_atlas',location:'tml_atlas',status:'online',livemode:false}:pi(a);}}});const result=await adapter.create(a);assert.equal(result.state,'UNKNOWN');assert.equal(result.providerId,'pi_original');});
test('unknown intent uses metadata read search only; empty result stays unknown',async()=>{const a=attempt();a.providerId=null;const calls=[];const adapter=stripePaymentAdapter({publishableKey:'pk_test_fixture',transport:{binding:merchant,async request(method,path){calls.push({method,path});return {data:[],has_more:false};}}});await assert.rejects(()=>adapter.retrieve(a),/RECONCILIATION_REQUIRED/);assert.equal(calls[0].method,'GET');assert.match(calls[0].path,/payment_intents\/search/);});
test('online card flow returns private client secret, no reader action',async()=>{const a=attempt('MAIL_IN'),calls=[];const adapter=stripePaymentAdapter({publishableKey:'pk_test_fixture',transport:{binding:merchant,async request(method,path,body){calls.push({path,body});return pi(a);}}});const result=await adapter.create(a);assert.equal(result.clientSecret,'pi_original_secret');assert.equal(calls.length,1);assert.deepEqual(calls[0].body.payment_method_types,['card']);});
test('new shop quote uses customer phone card payment without a terminal and exposes only its own secret',async()=>{
    const a=attempt('KIOSK'),calls=[];a.quote.terms={paymentFlow:'CUSTOMER_PHONE'};
    delete a.quote.location.terminalId;delete a.quote.location.terminalLocationId;delete a.quote.location.packagePrinterId;
    const adapter=stripePaymentAdapter({publishableKey:'pk_test_fixture',transport:{binding:merchant,async request(method,path,body,key){
        calls.push({method,path,body,key});return {...pi(a),payment_method_types:['card']};
    }}});
    const result=await adapter.create(a);assert.equal(result.state,'AWAITING_PAYMENT');assert.equal(result.clientSecret,'pi_original_secret');
    assert.equal(calls.length,1);assert.equal(calls[0].path,'/v1/payment_intents');assert.deepEqual(calls[0].body.payment_method_types,['card']);
    assert.equal(calls[0].body.metadata.atlas_attempt,a.id);assert.equal(calls[0].body.metadata.atlas_quote_hash,a.quote.contentHash);
});
test('tax requires explicitly configured classification and sourcing; no implicit zero',()=>{assert.throws(()=>stripeTaxAdapter({transport:{binding:merchant},taxCode:'txcd_123',shippingTaxCode:'txcd_456',addressSource:'shipping'}),/TAX_NOT_CONFIGURED/);});
test('tax uses configured kiosk address and returns real amount/reference',async()=>{const a=attempt(),calls=[];const tax=stripeTaxAdapter({transport:{binding:merchant,async request(method,path,input){calls.push(input);return {id:'taxcalc_test',currency:'usd',livemode:false,tax_amount_exclusive:0,tax_amount_inclusive:0,amount_total:10000,expires_at:Math.floor(now.getTime()/1000)+900};}},taxCode:'txcd_123',shippingTaxCode:'txcd_456',addressSource:'shipping',sourcingPolicy:'MAIL_RETURN_ADDRESS_KIOSK_LOCATION'});
    const result=await tax.calculate({quoteId:a.quote.id,currency:'usd',channel:'KIOSK',profile:{address1:'Wrong address'},location:a.quote.location,lines:a.quote.cards.map(c=>({cardId:c.id,unitCents:5000})),shippingCents:0});assert.equal(result.taxCents,0);assert.equal(calls[0].customer_details.address.line1,a.quote.location.address.line1);assert.equal(calls[0].line_items[0].tax_code,'txcd_123');});
test('kiosk tax requires the registry address and mail tax preserves the customer return address',async()=>{const calls=[];const tax=stripeTaxAdapter({transport:{binding:merchant,async request(method,path,input){calls.push(input);return {id:'taxcalc_test',currency:'usd',livemode:false,tax_amount_exclusive:0,tax_amount_inclusive:0,amount_total:4000,expires_at:Math.floor(now.getTime()/1000)+900};}},taxCode:'txcd_123',shippingTaxCode:'txcd_456',addressSource:'shipping',sourcingPolicy:'MAIL_RETURN_ADDRESS_KIOSK_LOCATION'});
    const input={quoteId:randomUUID(),currency:'usd',channel:'KIOSK',profile:source('MAIL_IN').profile,lines:[{cardId:randomUUID(),unitCents:4000}],shippingCents:0};
    for(const address of [undefined,{...input.profile},{line1:'Missing city'}])await assert.rejects(tax.calculate({...input,location:{address}}),/TAX_ADDRESS_REQUIRED/);
    assert.equal(calls.length,0);await tax.calculate({...input,channel:'MAIL_IN',location:{address:{line1:'Wrong kiosk address'}}});assert.equal(calls[0].customer_details.address.line1,input.profile.address1);});
test('shop tax uses registry address with a name-only contact and no fabricated billing or shipping profile',async()=>{
    const checkout=source('KIOSK'),calls=[];
    const tax=stripeTaxAdapter({transport:{binding:merchant,async request(method,path,input){calls.push(input);return {id:'taxcalc_test',currency:'usd',livemode:false,tax_amount_exclusive:0,tax_amount_inclusive:0,amount_total:5000,expires_at:Math.floor(now.getTime()/1000)+900};}},taxCode:'txcd_123',shippingTaxCode:'txcd_456',addressSource:'shipping',sourcingPolicy:'MAIL_RETURN_ADDRESS_KIOSK_LOCATION'});
    await tax.calculate({quoteId:randomUUID(),currency:'usd',channel:'KIOSK',profile:{name:'Shop Customer'},location:checkout.location,lines:[{cardId:randomUUID(),unitCents:5000}],shippingCents:0});
    assert.deepEqual(calls[0].customer_details.address,{line1:checkout.location.address.line1,line2:undefined,city:checkout.location.address.city,state:checkout.location.address.region,postal_code:checkout.location.address.postalCode,country:checkout.location.address.country});
    assert.equal(calls[0].shipping_cost.amount,0);assert.equal(calls[0].customer_details.address_source,'shipping');
});
function fedex(fetchImpl){return fedexAdapter({clientId:'fixture-client',clientSecret:'fixture-secret',accountNumber:'123456789',environment:'SANDBOX',fetchImpl,clock:()=>now});}
const rateResponse={transactionId:'rate-transaction',output:{rateReplyDetails:[{serviceType:'FEDEX_GROUND',ratedShipmentDetails:[{rateType:'ACCOUNT',currency:'USD',totalNetCharge:12.34}]}]}};
test('FedEx authenticates then quotes actual account rate with measured package and selected service',async()=>{const calls=[];const adapter=fedex(async(url,options)=>{calls.push({url,options});return json(url.endsWith('/oauth/token')?{access_token:'temporary',expires_in:3600}:rateResponse);});const result=await adapter.quote(shipment());assert.equal(result.amountCents,1234);assert.equal(result.providerId,'rate-transaction');const body=JSON.parse(calls[1].options.body);assert.equal(body.requestedShipment.serviceType,'FEDEX_GROUND');assert.equal(body.requestedShipment.requestedPackageLineItems[0].weight.value,1.2);assert.equal(body.accountNumber.value,'123456789');assert.equal(body.requestedShipment.shippingChargesPayment.paymentType,'THIRD_PARTY');});
test('FedEx list rate, other service, unsupported currency or missing total do not become quotes',async()=>{for(const patch of [{rateType:'LIST'},{currency:'CAD'},{totalNetCharge:null}]){const reply=structuredClone(rateResponse);Object.assign(reply.output.rateReplyDetails[0].ratedShipmentDetails[0],patch);const adapter=fedex(async url=>json(url.endsWith('/oauth/token')?{access_token:'temporary',expires_in:3600}:reply));await assert.rejects(()=>adapter.quote(shipment()),/FEDEX_ACCOUNT_RATE_UNAVAILABLE|CARRIER_AMOUNT_INVALID/);}});
test('missing package measurements or explicit billing stops before network',()=>{const s=shipment();delete s.requestedShipment.requestedPackageLineItems[0].weight;assert.throws(()=>validateShipment(s),/MEASURED_PACKAGE_REQUIRED/);const b=shipment();delete b.requestedShipment.shippingChargesPayment;assert.throws(()=>validateShipment(b),/BILLING_NOT_CONFIGURED/);assert.throws(()=>dollarsToCents('1.234'),/CARRIER_AMOUNT_INVALID/);});
test('FedEx creates and saves exact PDF label and tracking without refetching external URLs',async()=>{const pdf=Buffer.from('%PDF-1.4\nfixture\n'),calls=[];const adapter=fedex(async(url,options)=>{calls.push({url,options});return json(url.endsWith('/oauth/token')?{access_token:'temporary',expires_in:3600}:{transactionId:'ship-transaction',output:{transactionShipments:[{pieceResponses:[{trackingNumber:'123456789012',packageDocuments:[{contentType:'LABEL',encodedLabel:pdf.toString('base64')}]}]}]}});});
    const result=await adapter.createLabel(shipment(),'order-inbound-v1');assert.equal(result.trackingNumber,'123456789012');assert.equal(result.labelSha256,createHash('sha256').update(pdf).digest('hex'));assert.equal(result.mimeType,'application/pdf');assert.equal(calls.length,2);const body=JSON.parse(calls[1].options.body);assert.equal(body.requestedShipment.labelSpecification.imageType,'PDF');assert.equal(body.requestedShipment.requestedPackageLineItems[0].customerReferences[0].value,'order-inbound-v1');});
test('FedEx lost shipment reply is not retried inside adapter',async()=>{let creates=0;const adapter=fedex(async url=>{if(url.endsWith('/oauth/token'))return json({access_token:'temporary',expires_in:3600});creates++;throw Error('lost');});await assert.rejects(()=>adapter.createLabel(shipment(),'order'),/lost/);assert.equal(creates,1);});
test('package label is exact order/card count PDF without print completion',()=>{const label=createPackageLabel({orderId:randomUUID(),reference:'ATLAS-123456',cardCount:2});assert.equal(label.printed,false);assert.equal(label.state,'GENERATED');const bytes=Buffer.from(label.labelBase64,'base64');assert.match(bytes.toString(),/ATLAS-123456/);assert.match(bytes.toString(),/2 CARDS/);assert.equal(label.labelSha256,createHash('sha256').update(bytes).digest('hex'));});
function webhook(){const rawBody=Buffer.from(JSON.stringify({id:'evt_fixture',type:'payment_intent.succeeded',livemode:false,data:{object:{id:'pi_original',metadata:{atlas_attempt:randomUUID()}}}}));const timestamp=Math.floor(now.getTime()/1000),secret='whsec_fixture',signature=`t=${timestamp},v1=${createHmac('sha256',secret).update(`${timestamp}.`).update(rawBody).digest('hex')}`;return {rawBody,signature,secret,now:now.getTime()};}
test('webhook requires unchanged raw bytes, matching signature and fresh timestamp',()=>{const w=webhook();assert.equal(verifyStripeWebhook(w).id,'evt_fixture');for(const change of [{rawBody:Buffer.concat([w.rawBody,Buffer.from(' ')])},{secret:'whsec_wrong'},{now:w.now+301000},{rawBody:JSON.parse(w.rawBody)}])assert.throws(()=>verifyStripeWebhook({...w,...change}),/WEBHOOK_REJECTED/);});
test('webhook ignores irrelevant events without payment effects',async()=>{const w=webhook(),event=JSON.parse(w.rawBody);event.type='customer.created';w.rawBody=Buffer.from(JSON.stringify(event));w.signature=`t=${Math.floor(w.now/1000)},v1=${createHmac('sha256',w.secret).update(`${Math.floor(w.now/1000)}.`).update(w.rawBody).digest('hex')}`;const result=await consumeStripeWebhook({...w,payment:payment(),repository:{callbackPayment(){throw Error('must not call');}}});assert.equal(result.ignored,true);});
test('notification adapter records acceptance separately from delivery and uses ATLAS senders',async()=>{const calls=[];const send=notificationAdapter({emailApiKey:'email-fixture',emailFrom:'receipts@example.test',smsAccountSid:`AC${'1'.repeat(32)}`,smsApiKeySid:`SK${'2'.repeat(32)}`,smsApiKeySecret:'sms-fixture',smsServiceSid:`MG${'3'.repeat(32)}`,fetchImpl:async(url,options)=>{calls.push({url,options});return url.includes('sendgrid')?new Response(null,{status:202,headers:{'x-message-id':'message-123'}}):json({sid:`SM${'4'.repeat(32)}`,account_sid:`AC${'1'.repeat(32)}`,status:'queued'});}});
    const mail=await send.send('EMAIL_RECEIPT',{orderId:randomUUID(),reference:'ATLAS-TEST',to:'customer@example.test',totalCents:5000},'effect');assert.equal(mail.deliveryStatus,'ACCEPTED');const sms=await send.send('SMS_RECEIPT',{orderId:randomUUID(),reference:'ATLAS-TEST',to:'+15555550123',totalCents:5000},'effect-sms');assert.equal(sms.deliveryStatus,'QUEUED');assert.equal(calls.length,2);});


test('restricted Stripe keys run phone payments and tax through the qualified transport in both modes', async () => {
    for (const livemode of [false, true]) for (const channel of ['MAIL_IN', 'KIOSK']) {
        const mode = livemode ? 'live' : 'test', secretKey = `rk_${mode}_PRIVATE_FIXTURE`;
        const a = attempt(channel), calls = [];
        a.merchant = { ...merchant, livemode }; a.quote.merchant = a.merchant;
        a.quote.terms = { paymentFlow: 'CUSTOMER_PHONE' };
        const intent = { ...pi(a), livemode, payment_method_types: ['card'] };
        const transport = stripeTransport({ secretKey, apiVersion: '2024-06-20', accountId: merchant.accountId, livemode,
            fetchImpl: async (url, options) => {
                const path = new URL(url).pathname; calls.push({ path, options });
                assert.equal(options.headers.Authorization, `Bearer ${secretKey}`);
                assert.equal(options.headers['Stripe-Version'], '2024-06-20');
                if (path === '/v1/account') return json({ id: merchant.accountId, charges_enabled: true });
                if (path === '/v1/payment_intents' || path === '/v1/payment_intents/pi_original') return json(intent);
                if (path === '/v1/payment_intents/search') return json({ data: [intent], has_more: false });
                if (path === '/v1/tax/calculations') return json({ id: 'taxcalc_fixture', currency: 'usd', livemode,
                    tax_amount_exclusive: 800, tax_amount_inclusive: 0, amount_total: 10800, expires_at: 1790000000 });
                if (path === '/v1/tax/transactions/create_from_calculation') return json({ id: 'tax_fixture', reference: a.id, livemode });
                throw new Error('UNEXPECTED_STRIPE_ENDPOINT');
            } });
        const payment = stripePaymentAdapter({ transport, publishableKey: `pk_${mode}_fixture` });
        assert.equal((await payment.create(a)).clientSecret, 'pi_original_secret');
        assert.equal((await payment.retrieve({ ...a, providerId: null })).providerId, 'pi_original');
        const tax = stripeTaxAdapter({ transport, taxCode: 'txcd_123', shippingTaxCode: 'txcd_456', addressSource: 'shipping',
            sourcingPolicy: 'MAIL_RETURN_ADDRESS_KIOSK_LOCATION' });
        const calculation = await tax.calculate({ quoteId: a.quote.id, currency: 'usd', channel, profile: a.quote.profile,
            location: a.quote.location, lines: a.quote.cards.map(card => ({ cardId: card.id, unitCents: 5000 })), shippingCents: 0 });
        assert.equal(calculation.taxCents, 800);
        assert.equal((await tax.recordTransaction({ orderId: a.id, calculationId: calculation.providerId }, 'effect')).providerId, 'tax_fixture');
        assert.deepEqual(calls.map(call => call.path), ['/v1/account', '/v1/payment_intents', '/v1/payment_intents/search',
            '/v1/payment_intents/pi_original', '/v1/tax/calculations', '/v1/tax/transactions/create_from_calculation']);
        assert.equal(calls[1].options.headers['Idempotency-Key'], `atlas:${a.id}:payment:v1`);
        assert.equal(calls[4].options.headers['Idempotency-Key'], `atlas:${a.quote.id}:tax:v1`);
        assert.equal(calls[5].options.headers['Idempotency-Key'], 'atlas:effect');
        assert.doesNotMatch(JSON.stringify(transport.binding), /PRIVATE_FIXTURE/);
    }
});

test('restricted Stripe keys retain merchant qualification and permission-denial failure without dispatch or retry', async () => {
    for (const response of [json({ id: 'acct_other', charges_enabled: true }), json({ id: 'acct_atlas', charges_enabled: false }),
        new Response('permission denied', { status: 403 })]) {
        const calls = [], transport = stripeTransport({ secretKey: 'rk_live_PRIVATE_FIXTURE', apiVersion: '2024-06-20',
            accountId: 'acct_atlas', livemode: true, fetchImpl: async url => { calls.push(url); return response; } });
        await assert.rejects(() => transport.request('POST', '/v1/payment_intents', {}), error =>
            error.status === 503 && ['STRIPE_MERCHANT_NOT_QUALIFIED', 'PROVIDER_REQUEST_FAILED'].includes(error.code));
        assert.deepEqual(calls, ['https://api.stripe.com/v1/account']);
    }
    const calls = [], transport = stripeTransport({ secretKey: 'rk_live_PRIVATE_FIXTURE', apiVersion: '2024-06-20',
        accountId: 'acct_atlas', livemode: true, fetchImpl: async url => { calls.push(url); return url.endsWith('/account')
            ? json({ id: 'acct_atlas', charges_enabled: true }) : new Response('permission denied', { status: 403 }); } });
    await assert.rejects(() => transport.request('POST', '/v1/payment_intents', {}), { code: 'PROVIDER_REQUEST_FAILED', status: 503 });
    assert.equal(calls.length, 2);
});

test('restricted Stripe mode mismatch and public or foreign credentials fail before network', () => {
    let calls = 0;
    for (const [secretKey, livemode] of [['rk_live_fixture', false], ['rk_test_fixture', true], ['pk_live_fixture', true],
        ['pk_test_fixture', false], ['rk_unknown_fixture', false], ['prefix_rk_live_fixture', true], ['other_live_fixture', true],
        [['rk_live_fixture'], true], [{ toString: () => 'rk_live_fixture' }, true]]) {
        assert.throws(() => stripeTransport({ secretKey, livemode, apiVersion: '2024-06-20', accountId: 'acct_atlas',
            fetchImpl: () => { calls++; throw Error('UNEXPECTED_NETWORK'); } }), { code: 'STRIPE_NOT_CONFIGURED', status: 503 });
    }
    assert.equal(calls, 0);
});
