import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CommerceService } from '../src/service.mjs';
import { digest } from '../src/contract.mjs';
import { assertShipmentDate, assertShippingPlan, materializeShippingRequest } from '../src/shipping-plan.mjs';
import { fedexAdapter } from '../src/providers.mjs';
import { source, memoryRepository, payment, tax, carrier, now } from './fixtures.mjs';

export function stablePlan() {
    const plan = source('MAIL_IN').shippingPlans[0];
    plan.version = 'atlas-measured-print-return-plan-v2';
    delete plan.validUntil;
    for (const [leg, request] of Object.entries(plan.legs)) {
        request.labelDatePolicy = 'FEDEX_PRINT_RETURN_CREATION_DATE_V1';
        delete request.requestedShipment.shipDatestamp;
        request.requestedShipment.shipmentSpecialServices = {
            specialServiceTypes: ['RETURN_SHIPMENT'], returnShipmentDetail: { returnType: 'PRINT_RETURN_LABEL' },
        };
        if (leg === 'INBOUND') delete request.requestedShipment.shipper;
        else delete request.requestedShipment.recipients;
    }
    return plan;
}
function fixture() {
    const checkout = source('MAIL_IN'); checkout.shippingPlans = [stablePlan()];
    const repository = memoryRepository(checkout), calls = [];
    let time = now;
    const expiry = () => new Date(time.getTime() + 900000).toISOString();
    const service = new CommerceService({ repository, payment: payment('succeeded'), clock: () => time,
        terms: { mailClockStart: 'ATLAS_RECEIPT', mailChargedLegs: 'BOTH_LEGS' },
        tax: { async calculate(input) { return { ...await tax.calculate(input), expiresAt: expiry() }; } },
        carrier: { async quote(input) { calls.push(structuredClone(input)); return { ...await carrier.quote(input), expiresAt: expiry() }; } },
    });
    return { checkout, repository, calls, service, setTime(value) { time = new Date(value); },
        input: { draftId: checkout.draftId, expectedRevision: 2, packingPresetId: 'measured-one', shippingServiceCode: 'FEDEX_GROUND' } };
}
test('stable measured native plan remains available across dates; every new quote freezes its own rate date and 15-minute expiry', async () => {
    const b = fixture(), original = structuredClone(b.checkout.shippingPlans[0]);
    const first = await b.service.quote(b.input), saved = structuredClone(b.repository.quotes.get(first.id));
    b.setTime('2026-10-08T07:01:00.000Z');
    assert.equal((await b.service.checkout(b.checkout.draftId)).shippingOptions.length, 1);
    const second = await b.service.quote(b.input);
    assert.equal(second.expiresAt, '2026-10-08T07:16:00.000Z');
    assert.deepEqual(b.calls.map(r => r.requestedShipment.shipDatestamp), ['2026-09-24', '2026-09-24', '2026-10-08', '2026-10-08']);
    assert.equal(b.calls[2].requestedShipment.shipper.contact.personName, b.checkout.profile.name);
    assert.equal(b.calls[3].requestedShipment.recipients[0].contact.personName, b.checkout.profile.name);
    assert.deepEqual(b.checkout.shippingPlans[0], original);
    assert.deepEqual(b.repository.quotes.get(first.id), saved);
    assert.deepEqual(b.repository.quotes.get(second.id).shippingPlan, original);
    assert.equal(second.shippingPlan, undefined);
});
test('native stable plans refuse unmeasured, fixed-date, non-return and malformed policies before either rate request', async () => {
    const mutations = [
        p => delete p.measurementReference,
        p => p.cardCount = 1,
        p => p.validFrom = '2030-01-01T00:00:00.000Z',
        p => p.validUntil = '2030-01-01T00:00:00.000Z',
        p => p.legs.RETURN.requestedShipment.shipDatestamp = '2026-09-24',
        p => delete p.legs.RETURN.labelDatePolicy,
        p => p.legs.RETURN.labelDatePolicy = 'TODAY',
        p => p.legs.RETURN.requestedShipment.shipmentSpecialServices.returnShipmentDetail.returnType = 'PENDING',
        p => p.legs.RETURN.requestedShipment.shipmentSpecialServices.specialServiceTypes = ['SATURDAY_DELIVERY'],
        p => p.legs.RETURN.requestedShipment.shipmentSpecialServices.specialServiceTypes = { length: 1, 0: 'RETURN_SHIPMENT' },
        p => p.legs.RETURN.requestedShipment.requestedPackageLineItems[0].weight.value = 0,
        p => p.legs.RETURN.requestedShipment.requestedPackageLineItems[0].dimensions.height = 0.5,
        p => p.legs.RETURN.requestedShipment.serviceType = 'OTHER_SERVICE',
        p => p.legs.RETURN.shipDateTimeZone = 'Mars/Olympus',
    ];
    for (const mutate of mutations) {
        const b = fixture(); mutate(b.checkout.shippingPlans[0]);
        assert.deepEqual((await b.service.checkout(b.checkout.draftId)).shippingOptions, []);
        await assert.rejects(() => b.service.quote(b.input)); assert.equal(b.calls.length, 0);
    }
});
test('quote dates use explicit leg timezones across midnight and DST without changing the stable template', () => {
    const plan = stablePlan(); plan.legs.RETURN.shipDateTimeZone = 'America/New_York';
    const original = structuredClone(plan), clock = new Date('2026-11-01T06:30:00.000Z');
    assertShippingPlan(plan, 2, 'BOTH_LEGS', clock);
    assert.equal(materializeShippingRequest(plan, 'INBOUND', clock).requestedShipment.shipDatestamp, '2026-10-31');
    assert.equal(materializeShippingRequest(plan, 'RETURN', clock).requestedShipment.shipDatestamp, '2026-11-01');
    assert.deepEqual(plan, original);
});
test('paid native print-return labels cross midnight with exact frozen bytes and original v1 effect IDs; unknown never redispatches', async () => {
    const b = fixture(); b.setTime('2026-09-25T06:59:00.000Z');
    const quote = await b.service.quote(b.input), saved = structuredClone(b.repository.quotes.get(quote.id));
    const paid = await b.service.pay({ quoteId: quote.id, requestId: randomUUID() });
    const ids = ['INBOUND', 'RETURN'].map(leg => `${paid.order.id}:fedex:${leg}:v1`);
    assert(ids.every(id => b.repository.effects.has(id)));
    const requests = ids.map(id => structuredClone(b.repository.effects.get(id).request.shipment));
    b.setTime('2026-10-09T09:00:00.000Z');
    let creates = 0; b.service.carrier.createLabel = async (request, id) => {
        assert.deepEqual(request, requests[ids.indexOf(id)]); creates++;
        if (id === ids[1]) throw Error('lost reply');
        return { trackingNumber: 'synthetic', labelBase64: 'synthetic' };
    };
    assert.equal((await b.service.runEffect(ids[0])).state, 'SUCCEEDED');
    assert.equal((await b.service.runEffect(ids[1])).state, 'UNKNOWN');
    await b.service.runEffect(ids[0]); await b.service.runEffect(ids[1]);
    assert.equal(creates, 2);
    assert.deepEqual(ids.map(id => b.repository.effects.get(id).request.shipment), requests);
    assert.deepEqual(b.repository.quotes.get(quote.id), saved);
    assert.equal((await b.service.reconcile(paid.attemptId)).order.id, paid.order.id);
    assert.equal([...b.repository.effects.values()].filter(e => e.kind === 'FEDEX_LABEL').length, 2);
});
test('past-date exception requires both the explicit policy and native print-return semantics', () => {
    const request = materializeShippingRequest(stablePlan(), 'INBOUND', now), later = new Date('2026-10-08T12:00:00.000Z');
    assert.equal(assertShipmentDate(request, later), '2026-09-24');
    for (const mutate of [r => delete r.labelDatePolicy, r => delete r.requestedShipment.shipmentSpecialServices,
        r => r.requestedShipment.shipmentSpecialServices.returnShipmentDetail.returnType = 'PENDING',
        r => r.requestedShipment.shipDatestamp = '2026-02-30']) {
        const invalid = structuredClone(request); mutate(invalid); assert.throws(() => assertShipmentDate(invalid, later));
    }
    const legacy = source('MAIL_IN').shippingPlans[0]; legacy.legs.INBOUND.labelDatePolicy = request.labelDatePolicy;
    legacy.legs.INBOUND.requestedShipment.shipmentSpecialServices = request.requestedShipment.shipmentSpecialServices;
    assert.throws(() => assertShippingPlan(legacy, 2, 'INBOUND_ONLY', now), /SHIPPING_DATE_POLICY_INVALID/);
});
test('FedEx adapter retains native return semantics in rate and shipment payloads while leaving the paid request unchanged', async () => {
    const b = fixture(); await b.service.quote(b.input); const request = b.calls[0], original = structuredClone(request), calls = [];
    const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
    const adapter = fedexAdapter({ clientId: 'fixture', clientSecret: 'fixture', accountNumber: '123456789', environment: 'SANDBOX', clock: () => now,
        fetchImpl: async (url, options) => {
            if (url.endsWith('/oauth/token')) return json({ access_token: 'fixture', expires_in: 3600 });
            calls.push(JSON.parse(options.body));
            if (url.includes('/rate/')) return json({ transactionId: 'fixture-rate', output: { rateReplyDetails: [{ serviceType: 'FEDEX_GROUND', ratedShipmentDetails: [{ rateType: 'ACCOUNT', currency: 'USD', totalNetCharge: 12.34 }] }] } });
            return json({ transactionId: 'fixture-ship', output: { transactionShipments: [{ pieceResponses: [{ trackingNumber: '123456789012', packageDocuments: [{ contentType: 'LABEL', encodedLabel: Buffer.from('%PDF-1.4\nfixture').toString('base64') }] }] }] } });
        } });
    assert.equal((await adapter.quote(request)).requestHash, digest(request));
    await adapter.createLabel(request, 'original-effect');
    for (const body of calls) {
        assert.deepEqual(body.requestedShipment.shipmentSpecialServices, request.requestedShipment.shipmentSpecialServices);
        assert.equal(body.labelDatePolicy, undefined); assert.equal(body.requestedShipment.labelDatePolicy, undefined);
    }
    assert.equal(calls[0].requestedShipment.shipDateStamp, '2026-09-24');
    assert.equal(calls[1].requestedShipment.shipDatestamp, '2026-09-24');
    assert.deepEqual(request, original);
});
