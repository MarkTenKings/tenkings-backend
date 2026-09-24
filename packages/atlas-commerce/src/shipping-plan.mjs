import { requireValue } from './contract.mjs';
import { validateShipmentPackage, validateShipmentParty } from './providers.mjs';

const instant = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const calendarDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
function localDate(now, timeZone) {
    requireValue(typeof timeZone === 'string' && /^[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)+$/.test(timeZone), 'SHIPPING_DATE_NOT_CONFIGURED', 503);
    try {
        const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
            .formatToParts(now).map(({ type, value }) => [type, value]));
        return `${parts.year}-${parts.month}-${parts.day}`;
    } catch { requireValue(false, 'SHIPPING_DATE_NOT_CONFIGURED', 503); }
}

/** The configured date is retained exactly. Neither quotes nor delayed label
 * jobs silently replace a customer's shipping date with today's date. */
export function assertShipmentDate(request, now = new Date()) {
    const date = request?.requestedShipment?.shipDatestamp;
    requireValue(calendarDate(date) && date >= localDate(now, request.shipDateTimeZone), 'SHIPPING_DATE_EXPIRED', 503);
    return date;
}

/** One measured package per exact card count and direction. A range cannot
 * prove the packed weight of every count, and no weight is extrapolated. */
export function assertShippingPlan(plan, cardCount, chargedLegs, now = new Date()) {
    requireValue(plan?.version === 'atlas-measured-shipping-plan-v1'
        && typeof plan.packingPresetId === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(plan.packingPresetId)
        && typeof plan.shippingServiceCode === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(plan.shippingServiceCode)
        && Number.isInteger(cardCount) && cardCount >= 1 && cardCount <= 100 && plan.cardCount === cardCount
        && typeof plan.measurementReference === 'string' && plan.measurementReference.trim().length > 0
        && plan.measurementReference.length <= 240 && !/[\x00-\x1f\x7f]/.test(plan.measurementReference), 'MEASURED_PACKAGING_NOT_CONFIGURED', 503);
    requireValue(instant(plan.validFrom) && instant(plan.validUntil) && Date.parse(plan.validFrom) <= now.getTime()
        && now.getTime() < Date.parse(plan.validUntil) && Date.parse(plan.validUntil) - Date.parse(plan.validFrom) <= 86400000,
    'SHIPPING_PLAN_EXPIRED', 503);
    requireValue(['INBOUND_ONLY', 'BOTH_LEGS'].includes(chargedLegs), 'MAIL_SHIPPING_TERMS_NOT_CONFIGURED', 503);
    for (const leg of chargedLegs === 'BOTH_LEGS' ? ['INBOUND', 'RETURN'] : ['INBOUND']) {
        const request = plan.legs?.[leg], shipment = validateShipmentPackage(request?.requestedShipment);
        // The customer party comes only from the verified profile at checkout.
        // Configuration must supply the real ATLAS party, not a fake customer.
        if (leg === 'INBOUND') requireValue(shipment.recipients?.length === 1, 'SHIPPING_ADDRESS_INCOMPLETE', 503);
        validateShipmentParty(leg === 'INBOUND' ? shipment.recipients[0] : shipment.shipper);
        requireValue(shipment.serviceType === plan.shippingServiceCode, 'SHIPPING_SERVICE_MISMATCH', 503);
        assertShipmentDate(request, now);
    }
    return plan;
}

export function availableShippingPlans(plans, cardCount, chargedLegs, now = new Date()) {
    return (Array.isArray(plans) ? plans : []).filter(plan => {
        try { assertShippingPlan(plan, cardCount, chargedLegs, now); return true; } catch { return false; }
    });
}
