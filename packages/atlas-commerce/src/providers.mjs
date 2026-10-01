import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { clone, digest, requireValue, minor, UUID, customerPhonePayment } from './contract.mjs';

const form = (value, prefix, out = new URLSearchParams()) => {
    if (Array.isArray(value)) value.forEach((item, index) => form(item, `${prefix}[${index}]`, out));
    else if (value && typeof value === 'object') Object.entries(value).forEach(([key, item]) => form(item, prefix ? `${prefix}[${key}]` : key, out));
    else if (value !== undefined && value !== null) out.append(prefix, String(value));
    return out;
};
async function jsonResponse(response) {
    requireValue(response.ok, 'PROVIDER_REQUEST_FAILED', 503);
    const text = await response.text();
    requireValue(Buffer.byteLength(text) <= 12 * 1024 * 1024, 'PROVIDER_RESPONSE_TOO_LARGE', 503);
    try { return JSON.parse(text); } catch { requireValue(false, 'PROVIDER_RESPONSE_INVALID', 503); }
}

export function stripeTransport({ secretKey, apiVersion, accountId, livemode, fetchImpl = fetch }) {
    requireValue(/^sk_(live|test)_/.test(secretKey ?? '') && /^acct_[A-Za-z0-9]+$/.test(accountId ?? '')
        && typeof livemode === 'boolean' && secretKey.startsWith(livemode ? 'sk_live_' : 'sk_test_')
        && /^\d{4}-\d{2}-\d{2}(?:\.[a-z]+)?$/.test(apiVersion ?? ''), 'STRIPE_NOT_CONFIGURED', 503);
    let qualified = false;
    const request = async (method, path, values, key) => {
        requireValue(path.startsWith('/v1/') && !/[\r\n]/.test(path), 'INVALID_PROVIDER_PATH');
        const response = await fetchImpl(`https://api.stripe.com${path}`, { method, redirect: 'error', signal: AbortSignal.timeout(20000),
            headers: { Authorization: `Bearer ${secretKey}`, 'Stripe-Version': apiVersion,
                ...(key ? { 'Idempotency-Key': key } : {}), ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
            ...(method === 'POST' ? { body: form(values).toString() } : {}) });
        return jsonResponse(response);
    };
    return { binding: Object.freeze({ provider: 'STRIPE', accountId, livemode }),
        async request(...args) {
            if (!qualified) { const account = await request('GET','/v1/account');
                requireValue(account.id === accountId && account.charges_enabled === true, 'STRIPE_MERCHANT_NOT_QUALIFIED', 503); qualified = true; }
            return request(...args);
        } };
}

export function stripePaymentAdapter({ transport, publishableKey }) {
    requireValue(publishableKey?.startsWith(transport.binding.livemode ? 'pk_live_' : 'pk_test_'), 'STRIPE_PUBLIC_KEY_INVALID', 503);
    const binding = transport.binding;
    const read = async (attempt, providerId) => {
        const pi = await transport.request('GET', `/v1/payment_intents/${encodeURIComponent(providerId)}`);
        requireValue(pi.id === providerId && pi.livemode === binding.livemode, 'PAYMENT_PROVIDER_MISMATCH');
        return { source: 'PROVIDER_RETRIEVAL', provider: 'STRIPE', merchantId: binding.accountId, livemode: pi.livemode,
            providerId: pi.id, status: pi.status, amountCents: pi.amount, receivedCents: pi.amount_received,
            currency: pi.currency, quoteHash: pi.metadata?.atlas_quote_hash, attemptId: pi.metadata?.atlas_attempt,
            paymentMethodTypes: pi.payment_method_types,
            ...(pi.client_secret ? { clientSecret: pi.client_secret } : {}) };
    };
    return { binding, publishableKey,
        async create(attempt) {
            requireValue(UUID.test(attempt.id) && attempt.quote.merchant.accountId === binding.accountId
                && attempt.quote.merchant.livemode === binding.livemode, 'PAYMENT_MERCHANT_MISMATCH');
            const q = attempt.quote, kiosk = q.channel === 'KIOSK' && !customerPhonePayment(q);
            if (kiosk) {
                const reader = await transport.request('GET', `/v1/terminal/readers/${encodeURIComponent(q.location.terminalId)}`);
                requireValue(reader.id === q.location.terminalId && reader.location === q.location.terminalLocationId
                    && reader.livemode === binding.livemode && reader.status === 'online' && reader.action?.status !== 'in_progress', 'TERMINAL_UNAVAILABLE');
            }
            const pi = await transport.request('POST','/v1/payment_intents', { amount: q.totalCents, currency: q.currency,
                payment_method_types: [kiosk ? 'card_present' : 'card'], capture_method: 'automatic',
                metadata: { atlas_attempt: attempt.id, atlas_quote_hash: q.contentHash, atlas_quote: q.id } }, `atlas:${attempt.id}:payment:v1`);
            requireValue(/^pi_[A-Za-z0-9]+$/.test(pi.id ?? '') && pi.amount === q.totalCents && pi.currency === q.currency
                && pi.livemode === binding.livemode && pi.metadata?.atlas_attempt === attempt.id
                && pi.metadata?.atlas_quote_hash === q.contentHash, 'PAYMENT_PROVIDER_MISMATCH');
            if (kiosk) {
                try {
                    await transport.request('POST', `/v1/terminal/readers/${encodeURIComponent(q.location.terminalId)}/process_payment_intent`,
                        { payment_intent: pi.id, process_config: { enable_customer_cancellation: true } }, `atlas:${attempt.id}:reader:v1`);
                } catch { return { state: 'UNKNOWN', providerId: pi.id, code: 'TERMINAL_RECONCILIATION_REQUIRED' }; }
            }
            return { state: 'AWAITING_PAYMENT', providerId: pi.id, ...(kiosk ? {} : { clientSecret: pi.client_secret }) };
        },
        async retrieve(attempt) {
            let providerId = attempt.providerId;
            if (!providerId) {
                requireValue(UUID.test(attempt.id), 'INVALID_PAYMENT_ATTEMPT');
                // Search is read-only and eventually consistent. An empty response
                // remains unknown; it never permits a fresh charge or intent.
                const query = new URLSearchParams({ query: `metadata['atlas_attempt']:'${attempt.id}'`, limit: '2' });
                const result = await transport.request('GET', `/v1/payment_intents/search?${query}`);
                requireValue(result.data?.length === 1 && !result.has_more, 'PAYMENT_RECONCILIATION_REQUIRED');
                providerId = result.data[0].id;
            }
            return read(attempt, providerId);
        },
    };
}

export function stripeTaxAdapter({ transport, taxCode, shippingTaxCode, addressSource, sourcingPolicy }) {
    requireValue(/^txcd_[0-9]+$/.test(taxCode ?? '') && /^txcd_[0-9]+$/.test(shippingTaxCode ?? '')
        && ['billing','shipping'].includes(addressSource) && sourcingPolicy === 'MAIL_RETURN_ADDRESS_KIOSK_LOCATION', 'TAX_NOT_CONFIGURED', 503);
    return {
        async calculate(input) {
            // Kiosk addresses use the registry's line1 schema; customer return
            // profiles use address1/address2. Never substitute the customer's
            // home address when the sale belongs to a configured kiosk.
            const location = input.location?.address;
            const p = input.channel === 'KIOSK' ? location && { ...location, address1: location.line1, address2: undefined } : input.profile;
            requireValue(p && ['address1','city','region','postalCode','country'].every(key => p[key]), 'TAX_ADDRESS_REQUIRED', 503);
            const value = await transport.request('POST', '/v1/tax/calculations', { currency: input.currency,
                customer_details: { address: { line1:p.address1,line2:p.address2,city:p.city,state:p.region,postal_code:p.postalCode,country:p.country }, address_source: addressSource },
                line_items: input.lines.map(line => ({ amount: line.unitCents, reference: line.cardId, tax_code: taxCode, tax_behavior: 'exclusive' })),
                shipping_cost: { amount: input.shippingCents, tax_code: shippingTaxCode, tax_behavior: 'exclusive' } }, `atlas:${input.quoteId}:tax:v1`);
            requireValue(value.id?.startsWith('taxcalc_') && value.livemode === transport.binding.livemode
                && minor(value.tax_amount_exclusive) && value.tax_amount_inclusive === 0 && minor(value.amount_total)
                && Number.isSafeInteger(value.expires_at), 'TAX_QUOTE_INVALID', 503);
            return { provider: 'STRIPE_TAX', providerId: value.id, currency: value.currency, taxCents: value.tax_amount_exclusive,
                totalCents: value.amount_total, requestHash: digest(input), expiresAt: new Date(value.expires_at * 1000).toISOString(),
                breakdown: value.tax_breakdown ?? [] };
        },
        async recordTransaction(input, effectId) {
            const value = await transport.request('POST', '/v1/tax/transactions/create_from_calculation',
                { calculation: input.calculationId, reference: input.orderId }, `atlas:${effectId}`);
            requireValue(value.id?.startsWith('tax_') && value.reference === input.orderId && value.livemode === transport.binding.livemode, 'TAX_TRANSACTION_INVALID');
            return { provider: 'STRIPE_TAX', providerId: value.id, orderId: input.orderId };
        },
    };
}

export function verifyStripeWebhook({ rawBody, signature, secret, now = Date.now() }) {
    requireValue(Buffer.isBuffer(rawBody) && rawBody.length <= 1024 * 1024 && typeof signature === 'string'
        && secret?.startsWith('whsec_'), 'WEBHOOK_REJECTED', 400);
    const parts = signature.split(',').map(part => part.split('='));
    const timestamps = parts.filter(([key]) => key === 't');
    requireValue(timestamps.length === 1 && /^\d+$/.test(timestamps[0][1]), 'WEBHOOK_REJECTED', 400);
    const timestamp = Number(timestamps[0][1]);
    requireValue(Number.isSafeInteger(timestamp) && Math.abs(now / 1000 - timestamp) <= 300, 'WEBHOOK_REJECTED', 400);
    const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest();
    requireValue(parts.some(([key, value]) => key === 'v1' && /^[a-f0-9]{64}$/.test(value ?? '')
        && timingSafeEqual(Buffer.from(value, 'hex'), expected)), 'WEBHOOK_REJECTED', 400);
    let event; try { event = JSON.parse(rawBody.toString('utf8')); } catch { requireValue(false, 'WEBHOOK_REJECTED', 400); }
    requireValue(/^evt_[A-Za-z0-9]+$/.test(event.id ?? '') && typeof event.livemode === 'boolean'
        && typeof event.type === 'string' && event.data?.object, 'WEBHOOK_REJECTED', 400);
    return event;
}

export function validateShipmentParty(party) {
    requireValue(party?.address?.countryCode === 'US', 'SHIPPING_ADDRESS_NOT_SUPPORTED');
    requireValue(party.address.streetLines?.length && party.address.city && party.address.stateOrProvinceCode && party.address.postalCode
        && party.contact?.personName && party.contact?.phoneNumber, 'SHIPPING_ADDRESS_INCOMPLETE');
}
export function validateShipmentPackage(s) {
    requireValue(s && /^\d{4}-\d{2}-\d{2}$/.test(s.shipDatestamp ?? '') && s.serviceType && s.pickupType
        && s.packagingType && s.totalPackageCount === 1 && s.requestedPackageLineItems?.length === 1, 'PACKAGE_NOT_CONFIGURED');
    requireValue(['SENDER','RECIPIENT','THIRD_PARTY'].includes(s.shippingChargesPayment?.paymentType), 'SHIPMENT_BILLING_NOT_CONFIGURED');
    const p = s.requestedPackageLineItems[0];
    requireValue(p.weight && ['LB','KG'].includes(p.weight.units) && Number.isFinite(p.weight.value) && p.weight.value > 0
        && p.dimensions && ['IN','CM'].includes(p.dimensions.units)
        && ['length','width','height'].every(key => Number.isInteger(p.dimensions[key]) && p.dimensions[key] > 0), 'MEASURED_PACKAGE_REQUIRED');
    return s;
}
export function validateShipment(request) {
    const s = request?.requestedShipment;
    requireValue(s && s.recipients?.length === 1, 'SHIPPING_ADDRESS_NOT_SUPPORTED');
    for (const party of [s.shipper, s.recipients[0]]) validateShipmentParty(party);
    return validateShipmentPackage(s);
}
export const dollarsToCents = value => {
    const text = String(value); requireValue(/^\d+(?:\.\d{1,2})?$/.test(text), 'CARRIER_AMOUNT_INVALID');
    const [whole, decimal = ''] = text.split('.'), amount = Number(whole) * 100 + Number(decimal.padEnd(2,'0'));
    requireValue(minor(amount), 'CARRIER_AMOUNT_INVALID'); return amount;
};

export function fedexAdapter({ clientId, clientSecret, accountNumber, environment, fetchImpl = fetch, clock = () => new Date() }) {
    requireValue(clientId && clientSecret && /^\d{6,12}$/.test(accountNumber ?? '') && ['PRODUCTION','SANDBOX'].includes(environment), 'FEDEX_NOT_CONFIGURED', 503);
    const origin = environment === 'PRODUCTION' ? 'https://apis.fedex.com' : 'https://apis-sandbox.fedex.com';
    let accessToken, expires = 0;
    const request = async (path, body) => {
        if (!accessToken || clock().getTime() >= expires) {
            const token = await jsonResponse(await fetchImpl(`${origin}/oauth/token`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: form({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }).toString() }));
            requireValue(token.access_token && Number.isFinite(token.expires_in) && token.expires_in > 60, 'FEDEX_AUTH_INVALID', 503);
            accessToken = token.access_token; expires = clock().getTime() + (token.expires_in - 60) * 1000;
        }
        return jsonResponse(await fetchImpl(`${origin}${path}`, { method:'POST',redirect:'error',signal:AbortSignal.timeout(25000),
            headers:{'Content-Type':'application/json',Authorization:`Bearer ${accessToken}`},body:JSON.stringify(body) }));
    };
    const parseLabel = (value, requestHash) => {
        const shipment = value.output?.transactionShipments?.[0], pieces = shipment?.pieceResponses;
        requireValue(value.output?.transactionShipments?.length === 1 && pieces?.length === 1, 'FEDEX_SHIPMENT_OUTCOME_UNKNOWN');
        const document = pieces[0].packageDocuments?.find(doc => doc.contentType === 'LABEL' && doc.encodedLabel);
        requireValue(document && typeof pieces[0].trackingNumber === 'string' && /^[A-Za-z0-9+/=]+$/.test(document.encodedLabel), 'FEDEX_LABEL_MISSING');
        const bytes = Buffer.from(document.encodedLabel,'base64');
        requireValue(bytes.length <= 4 * 1024 * 1024 && bytes.subarray(0,5).toString('ascii') === '%PDF-', 'FEDEX_LABEL_INVALID');
        return { provider:'FEDEX',trackingNumber:pieces[0].trackingNumber,labelBase64:document.encodedLabel,
            labelSha256:createHash('sha256').update(bytes).digest('hex'),mimeType:'application/pdf',requestHash,
            providerId:value.transactionId ?? shipment.masterTrackingNumber ?? pieces[0].trackingNumber };
    };
    return {
        async quote(input) {
            const s = validateShipment(input);
            const value = await request('/rate/v1/rates/quotes', { accountNumber:{value:accountNumber},requestedShipment:{
                shipper:s.shipper,recipient:s.recipients[0],shipDateStamp:s.shipDatestamp,serviceType:s.serviceType,pickupType:s.pickupType,
                packagingType:s.packagingType,rateRequestType:['ACCOUNT'],totalPackageCount:1,requestedPackageLineItems:s.requestedPackageLineItems,
                shippingChargesPayment:{...clone(s.shippingChargesPayment),payor:{responsibleParty:{...s.shippingChargesPayment.payor?.responsibleParty,accountNumber:{value:accountNumber}}}},
                ...(s.shipmentSpecialServices ? {shipmentSpecialServices:s.shipmentSpecialServices}: {}) } });
            const details = value.output?.rateReplyDetails?.filter(reply => reply.serviceType === s.serviceType) ?? [];
            const rates = details.flatMap(reply => reply.ratedShipmentDetails ?? []).filter(rate => rate.rateType === 'ACCOUNT' && rate.currency === 'USD');
            requireValue(rates.length === 1 && value.transactionId, 'FEDEX_ACCOUNT_RATE_UNAVAILABLE', 503);
            return {provider:'FEDEX',providerId:value.transactionId,currency:'usd',amountCents:dollarsToCents(rates[0].totalNetCharge),
                requestHash:digest(input),expiresAt:new Date(clock().getTime()+15*60000).toISOString()};
        },
        async createLabel(input, effectId) {
            const s = validateShipment(input);
            const value = await request('/ship/v1/shipments',{accountNumber:{value:accountNumber},labelResponseOptions:'LABEL',
                requestedShipment:{...clone(s),shippingChargesPayment:{...clone(s.shippingChargesPayment),payor:{responsibleParty:{...s.shippingChargesPayment.payor?.responsibleParty,accountNumber:{value:accountNumber}}}},
                    labelSpecification:{imageType:'PDF',labelStockType:'PAPER_4X6'},
                    requestedPackageLineItems:s.requestedPackageLineItems.map(p => ({...p,customerReferences:[{customerReferenceType:'CUSTOMER_REFERENCE',value:effectId}]}))}});
            // A job acknowledgement is not a purchased printable label.
            if (value.output?.jobId) return {provider:'FEDEX',state:'PROCESSING',jobId:value.output.jobId,requestHash:digest(input)};
            return parseLabel(value,digest(input));
        },
        async retrieveAsync(jobId, input) {
            requireValue(typeof jobId === 'string' && jobId.length < 200, 'FEDEX_JOB_INVALID');
            return parseLabel(await request('/ship/v1/shipments/results',{accountNumber:{value:accountNumber},jobId}),digest(input));
        },
    };
}
