import { createHash } from 'node:crypto';
import { clone, digest, requireValue, minor } from './contract.mjs';
import { dollarsToCents } from './providers.mjs';

const ID = /^se(?:-[a-z0-9]+)+$/;
const text = (v, max = 100) => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !/[\x00-\x1f\x7f]/.test(v);
const ownKeys = (v, allowed) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).every(k => allowed.includes(k));
export const SHIPSTATION_PLAN = 'atlas-measured-shipstation-plan-v1';
export const SHIPSTATION_DATE_POLICY = 'SHIPSTATION_FULFILLMENT_DATE_V1';

export function validateShipStationParty(party) {
    requireValue(ownKeys(party, ['name','phone','address_line1','address_line2','city_locality','state_province','postal_code','country_code','address_residential_indicator'])
        && ['name','phone','address_line1','city_locality','state_province','postal_code'].every(k => text(party[k]))
        && (!Object.hasOwn(party, 'address_line2') || text(party.address_line2))
        && party.country_code === 'US' && ['unknown','yes','no'].includes(party.address_residential_indicator), 'SHIPPING_ADDRESS_INCOMPLETE', 503);
    return party;
}

/** Only explicitly measured domestic packages. Insurance remains disabled until
 * eligibility and coverage for customer-owned grading cards are established. */
export function validateInboundPackage(p) {
    requireValue(ownKeys(p,['weight','dimensions'])
        && ownKeys(p.weight,['unit','value']) && ['pound','ounce','gram','kilogram'].includes(p.weight.unit)
        && Number.isFinite(p.weight.value) && p.weight.value > 0
        && ownKeys(p.dimensions,['unit','length','width','height']) && ['inch','centimeter'].includes(p.dimensions.unit)
        && ['length','width','height'].every(k => Number.isFinite(p.dimensions[k]) && p.dimensions[k] > 0), 'MEASURED_PACKAGE_REQUIRED',400);
    // Widest supported ordinary domestic parcel envelope. Individual carrier
    // services may have stricter limits, which their actual rate must accept.
    const pounds=p.weight.value*{pound:1,ounce:1/16,gram:1/453.59237,kilogram:1000/453.59237}[p.weight.unit];
    const sizes=['length','width','height'].map(k=>p.dimensions[k]/(p.dimensions.unit==='inch'?1:2.54)).sort((a,b)=>b-a);
    requireValue(pounds<=150 && sizes[0]<=108 && sizes[0]+2*(sizes[1]+sizes[2])<=165,'PACKAGE_EXCEEDS_PARCEL_LIMITS',400);
    return p;
}
export function validateShipStationShipment(input, { templateLeg, customerMeasured=false } = {}) {
    requireValue(ownKeys(input, ['provider','shipDateTimeZone','labelDatePolicy','shipment']) && input.provider === 'SHIPSTATION'
        && input.labelDatePolicy === SHIPSTATION_DATE_POLICY, 'SHIPPING_DATE_POLICY_INVALID', 503);
    const s = input.shipment;
    requireValue(ownKeys(s, ['carrier_id','service_code','ship_date','ship_from','ship_to','packages','confirmation','insurance_provider'])
        && ID.test(s.carrier_id ?? '') && /^[a-z0-9]+(?:_[a-z0-9-]+)*$/.test(s.service_code ?? '')
        && ['none','delivery','signature','adult_signature','direct_signature'].includes(s.confirmation)
        && s.insurance_provider === 'none' && (customerMeasured && templateLeg === 'INBOUND' ? !Object.hasOwn(s,'packages') : Array.isArray(s.packages) && s.packages.length === 1), 'PACKAGE_NOT_CONFIGURED', 503);
    if (templateLeg) requireValue(!Object.hasOwn(s,'ship_date') && !Object.hasOwn(s,templateLeg === 'INBOUND' ? 'ship_from' : 'ship_to'), 'SHIPPING_TEMPLATE_INVALID', 503);
    else requireValue(/^\d{4}-\d{2}-\d{2}$/.test(s.ship_date ?? '') && new Date(`${s.ship_date}T00:00:00.000Z`).toISOString().slice(0,10) === s.ship_date, 'SHIPPING_DATE_NOT_CONFIGURED', 503);
    if (templateLeg !== 'INBOUND') validateShipStationParty(s.ship_from);
    if (templateLeg !== 'RETURN') validateShipStationParty(s.ship_to);
    if (customerMeasured && templateLeg === 'INBOUND') return s;
    const p = s.packages[0];
    requireValue(ownKeys(p,['package_code','weight','dimensions']) && p.package_code === 'package','MEASURED_PACKAGE_REQUIRED',503);
    validateInboundPackage({weight:p.weight,dimensions:p.dimensions});
    return s;
}

export function shipStationCustomer(profile, phone) {
    return { name: profile.name, phone, address_line1: profile.address1, ...(profile.address2 ? {address_line2:profile.address2} : {}),
        city_locality: profile.city, state_province: profile.region, postal_code: profile.postalCode,
        country_code: profile.country, address_residential_indicator:'unknown' };
}

export function shippingExternalId(effectId) {
    requireValue(text(effectId,200), 'SHIPPING_EFFECT_ID_INVALID');
    return `atlas-${createHash('sha256').update(effectId).digest('hex').slice(0,44)}`;
}
const money = value => {
    requireValue(value?.currency?.toLowerCase() === 'usd', 'CARRIER_CURRENCY_INVALID');
    return dollarsToCents(value.amount);
};
function rateResult(rate, shipmentId, input, now) {
    const s = validateShipStationShipment(input);
    requireValue(ID.test(rate.rate_id ?? '') && ID.test(shipmentId ?? '') && rate.carrier_id === s.carrier_id
        && rate.service_code === s.service_code && ['valid','has_warnings'].includes(rate.validation_status)
        && (!rate.error_messages || rate.error_messages.length === 0) && rate.trackable === true, 'SHIPSTATION_RATE_UNAVAILABLE',503);
    const amounts = ['shipping_amount','insurance_amount','confirmation_amount','other_amount'].map(k => money(rate[k]));
    requireValue(amounts[1] === 0 && (!rate.tax_amount || money(rate.tax_amount) === 0), 'SHIPPING_INSURANCE_NOT_CONFIGURED',503);
    const amountCents = amounts.reduce((a,b)=>a+b,0);
    requireValue(minor(amountCents) && text(rate.carrier_friendly_name) && text(rate.service_type), 'SHIPSTATION_RATE_INVALID',503);
    return {provider:'SHIPSTATION',providerId:rate.rate_id,shipmentId,carrierId:rate.carrier_id,serviceCode:rate.service_code,
        carrierName:rate.carrier_friendly_name,serviceName:rate.service_type,amountCents,currency:'usd',requestHash:digest(input),
        expiresAt:new Date(now.getTime()+15*60000).toISOString()};
}

/** Standalone ShipStation API (formerly ShipEngine), not Companion V1/V2.
 * Label writes are called once under the existing durable effect claim. A
 * timeout stays UNKNOWN; reconciliation only reads the same external identity. */
export function shipStationAdapter({apiKey, environment, fetchImpl=fetch, clock=()=>new Date()}) {
    requireValue(typeof apiKey === 'string' && apiKey.length >= 20 && !/\s/.test(apiKey)
        && ['PRODUCTION','SANDBOX'].includes(environment)
        && (environment === 'SANDBOX') === apiKey.startsWith('TEST_'), 'SHIPSTATION_NOT_CONFIGURED',503);
    const request = async (method,path,body) => {
        requireValue(/^\/v1\/[a-z0-9_/?=&.-]+$/.test(path), 'INVALID_PROVIDER_PATH');
        const response = await fetchImpl(`https://api.shipengine.com${path}`, {method,redirect:'error',signal:AbortSignal.timeout(25000),
            headers:{'API-Key':apiKey,'Content-Type':'application/json'},...(body ? {body:JSON.stringify(body)} : {})});
        requireValue(response.ok,'SHIPSTATION_REQUEST_FAILED',503);
        const raw=await response.text(); requireValue(Buffer.byteLength(raw)<=8*1024*1024,'PROVIDER_RESPONSE_TOO_LARGE',503);
        try {return JSON.parse(raw);} catch {requireValue(false,'PROVIDER_RESPONSE_INVALID',503);}
    };
    const parseLabel = (value,input,effectId,selected) => {
        const s=validateShipStationShipment(input), externalId=shippingExternalId(effectId);
        requireValue(ID.test(value.label_id??'') && value.shipment_id===selected.shipmentId && value.external_shipment_id === externalId
            && value.carrier_id===s.carrier_id && value.service_code===s.service_code && value.voided===false
            && value.is_return_label===false, 'SHIPSTATION_LABEL_BINDING_MISMATCH');
        if(value.status==='processing') return {provider:'SHIPSTATION',state:'PROCESSING',providerId:value.label_id,externalShipmentId:externalId,requestHash:digest(input)};
        requireValue(value.status==='completed' && text(value.tracking_number,200) && value.label_format==='pdf', 'SHIPSTATION_LABEL_MISSING');
        const encoded=value.label_download?.href;
        requireValue(typeof encoded==='string' && /^data:application\/pdf;base64,[A-Za-z0-9+/]+={0,2}$/.test(encoded), 'SHIPSTATION_LABEL_INVALID');
        const labelBase64=encoded.slice(encoded.indexOf(',')+1),bytes=Buffer.from(labelBase64,'base64');
        requireValue(bytes.length<=4*1024*1024 && bytes.subarray(0,5).toString('ascii')==='%PDF-' && bytes.toString('base64')===labelBase64, 'SHIPSTATION_LABEL_INVALID');
        requireValue(money(value.insurance_cost)===0,'SHIPPING_INSURANCE_NOT_CONFIGURED');
        return {provider:'SHIPSTATION',providerId:value.label_id,shipmentId:value.shipment_id,externalShipmentId:externalId,
            carrierId:value.carrier_id,serviceCode:value.service_code,carrierName:selected.carrierName,serviceName:selected.serviceName,
            trackingNumber:value.tracking_number,labelBase64,labelSha256:createHash('sha256').update(bytes).digest('hex'),mimeType:'application/pdf',
            requestHash:digest(input),purchasedRateId:selected.providerId,purchasedAmountCents:money(value.shipment_cost),currency:'usd',shipDate:value.ship_date};
    };
    return {provider:'SHIPSTATION',environment,
        async quote(input) {
            const s=validateShipStationShipment(input);
            const value=await request('POST','/v1/rates',{rate_options:{carrier_ids:[s.carrier_id],service_codes:[s.service_code]},shipment:clone(s)});
            const rates=value.rate_response?.rates?.filter(r=>r.carrier_id===s.carrier_id&&r.service_code===s.service_code)??[];
            requireValue(['completed','partial'].includes(value.rate_response?.status)&&rates.length===1,'SHIPSTATION_RATE_UNAVAILABLE',503);
            return rateResult(rates[0],value.rate_response.shipment_id,input,clock());
        },
        async createLabel(input,effectId,selected) {
            validateShipStationShipment(input);
            requireValue(selected?.provider==='SHIPSTATION' && ID.test(selected.providerId??'') && selected.requestHash===digest(input), 'SHIPPING_QUOTE_INVALID');
            const value=await request('POST',`/v1/labels/rates/${selected.providerId}`,{label_format:'pdf',label_layout:'4x6',label_download_type:'inline',
                validate_address:'no_validation',external_shipment_id:shippingExternalId(effectId)});
            return parseLabel(value,input,effectId,selected);
        },
        async retrieveLabel(input,effectId,selected) {
            const value=await request('GET',`/v1/labels/external_shipment_id/${shippingExternalId(effectId)}?label_download_type=inline`);
            return parseLabel(value,input,effectId,selected);
        },
        async track(labelId,trackingNumber) {
            requireValue(ID.test(labelId??'') && text(trackingNumber,200),'SHIPPING_TRACKING_INVALID');
            const v=await request('GET',`/v1/labels/${labelId}/track`);
            requireValue(v.tracking_number===trackingNumber && ['UN','AC','IT','DE','EX','AT','NY'].includes(v.status_code),'SHIPPING_TRACKING_INVALID');
            return {provider:'SHIPSTATION',providerId:labelId,trackingNumber,statusCode:v.status_code,
                ...(text(v.status_description,240)?{description:v.status_description}:{}),observedAt:clock().toISOString()};
        },
    };
}
