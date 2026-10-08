import { clone, requireValue } from './contract.mjs';
import { validateShipmentPackage, validateShipmentParty } from './providers.mjs';
import { SHIPSTATION_PLAN, validateShipStationShipment } from './shipstation.mjs';

const instant = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const calendarDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
export function localDate(now, timeZone) {
    requireValue(typeof timeZone === 'string' && /^[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)+$/.test(timeZone), 'SHIPPING_DATE_NOT_CONFIGURED', 503);
    try {
        const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
            .formatToParts(now).map(({ type, value }) => [type, value]));
        return `${parts.year}-${parts.month}-${parts.day}`;
    } catch { requireValue(false, 'SHIPPING_DATE_NOT_CONFIGURED', 503); }
}

const NATIVE_DATE_POLICY = 'FEDEX_PRINT_RETURN_CREATION_DATE_V1';
const STABLE_PLAN = 'atlas-measured-print-return-plan-v2';
function nativePrintReturn(request) {
    const special = request?.requestedShipment?.shipmentSpecialServices;
    return request?.labelDatePolicy === NATIVE_DATE_POLICY
        && Array.isArray(special?.specialServiceTypes) && special.specialServiceTypes.length === 1 && special.specialServiceTypes[0] === 'RETURN_SHIPMENT'
        && special.returnShipmentDetail?.returnType === 'PRINT_RETURN_LABEL';
}

/** Preserve the request bytes. FedEx Ship REST explicitly uses the current date
 * for a past shipDatestamp; only opted-in native print-return requests rely on
 * that behavior. Ordinary v1 shipments retain their exact-date refusal. */
export function assertShipmentDate(request, now = new Date()) {
    const date = request?.requestedShipment?.shipDatestamp;
    const today = localDate(now, request?.shipDateTimeZone);
    requireValue(calendarDate(date) && (date >= today || nativePrintReturn(request)), 'SHIPPING_DATE_EXPIRED', 503);
    requireValue(!Object.hasOwn(request, 'labelDatePolicy') || nativePrintReturn(request), 'SHIPPING_DATE_POLICY_INVALID', 503);
    return date;
}

/** One measured package per exact card count and direction. A range cannot
 * prove the packed weight of every count, and no weight is extrapolated. */
export function assertShippingPlan(plan, cardCount, chargedLegs, now = new Date()) {
    const shipstation = plan?.version === SHIPSTATION_PLAN;
    const stable = plan?.version === STABLE_PLAN || shipstation;
    requireValue((stable || plan?.version === 'atlas-measured-shipping-plan-v1')
        && typeof plan.packingPresetId === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(plan.packingPresetId)
        && typeof plan.shippingServiceCode === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(plan.shippingServiceCode)
        && Number.isInteger(cardCount) && cardCount >= 1 && cardCount <= 100 && plan.cardCount === cardCount
        && typeof plan.measurementReference === 'string' && plan.measurementReference.trim().length > 0
        && plan.measurementReference.length <= 240 && !/[\x00-\x1f\x7f]/.test(plan.measurementReference), 'MEASURED_PACKAGING_NOT_CONFIGURED', 503);
    requireValue(instant(plan.validFrom) && Date.parse(plan.validFrom) <= now.getTime()
        && (stable ? !Object.hasOwn(plan, 'validUntil') : instant(plan.validUntil) && now.getTime() < Date.parse(plan.validUntil)
            && Date.parse(plan.validUntil) - Date.parse(plan.validFrom) <= 86400000), 'SHIPPING_PLAN_EXPIRED', 503);
    requireValue(['INBOUND_ONLY', 'BOTH_LEGS'].includes(chargedLegs), 'MAIL_SHIPPING_TERMS_NOT_CONFIGURED', 503);
    for (const leg of chargedLegs === 'BOTH_LEGS' ? ['INBOUND', 'RETURN'] : ['INBOUND']) {
        const template = plan.legs?.[leg];
        if (shipstation) {
            const shipment = validateShipStationShipment(template, {templateLeg:leg,customerMeasured:plan.inboundPackaging==='CUSTOMER_MEASURED'});
            requireValue(plan.provider === 'SHIPSTATION' && plan.fulfillmentPolicy === 'INBOUND_AFTER_PAYMENT_RETURN_WHEN_PREPARED'
                && ['CONFIGURED','CUSTOMER_MEASURED'].includes(plan.inboundPackaging)
                && shipment.carrier_id === plan.carrierId && shipment.service_code === plan.serviceCode, 'SHIPPING_SERVICE_MISMATCH',503);
            localDate(now, template.shipDateTimeZone);
            continue;
        }
        requireValue(stable ? nativePrintReturn(template) && !Object.hasOwn(template.requestedShipment, 'shipDatestamp')
            : template && !Object.hasOwn(template, 'labelDatePolicy'), 'SHIPPING_DATE_POLICY_INVALID', 503);
        const request = materializeShippingRequest(plan, leg, now), shipment = validateShipmentPackage(request?.requestedShipment);
        // The customer party comes only from the verified profile at checkout.
        // Configuration must supply the real ATLAS party, not a fake customer.
        if (leg === 'INBOUND') requireValue(shipment.recipients?.length === 1, 'SHIPPING_ADDRESS_INCOMPLETE', 503);
        validateShipmentParty(leg === 'INBOUND' ? shipment.recipients[0] : shipment.shipper);
        requireValue(shipment.serviceType === plan.shippingServiceCode, 'SHIPPING_SERVICE_MISMATCH', 503);
        assertShipmentDate(request, now);
    }
    return plan;
}

/** Stable measured templates are reusable; each quote freezes its own rate date. */
export function materializeShippingRequest(plan, leg, now = new Date()) {
    const request = clone(plan.legs?.[leg]);
    if (plan.version === SHIPSTATION_PLAN) {
        validateShipStationShipment(request,{templateLeg:leg,customerMeasured:plan.inboundPackaging==='CUSTOMER_MEASURED'});
        request.shipment.ship_date = localDate(now,request.shipDateTimeZone);
    }
    if (plan.version === STABLE_PLAN) {
        requireValue(nativePrintReturn(request) && !Object.hasOwn(request.requestedShipment, 'shipDatestamp'), 'SHIPPING_DATE_POLICY_INVALID', 503);
        request.requestedShipment.shipDatestamp = localDate(now, request.shipDateTimeZone);
    }
    return request;
}

export function availableShippingPlans(plans, cardCount, chargedLegs, now = new Date()) {
    return (Array.isArray(plans) ? plans : []).filter(plan => {
        try { assertShippingPlan(plan, cardCount, chargedLegs, now); return true; } catch { return false; }
    });
}
