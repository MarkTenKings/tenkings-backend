import { source, now } from './fixtures.mjs';
export const testPackage={weight:{unit:'ounce',value:7.5},dimensions:{unit:'inch',length:8,width:5,height:2.5}};
export function shipStationPlan({customerMeasured=true,count=1,carrierId='se-123',serviceCode='ups_ground',shippingServiceCode='UPS_GROUND'}={}) {
    const party={name:'Synthetic ATLAS',phone:'+12025550101',address_line1:'20 Test Way',city_locality:'Example',state_province:'CA',postal_code:'90001',country_code:'US',address_residential_indicator:'no'};
    const leg=direction=>({provider:'SHIPSTATION',shipDateTimeZone:'America/Los_Angeles',labelDatePolicy:'SHIPSTATION_FULFILLMENT_DATE_V1',
        shipment:{carrier_id:carrierId,service_code:serviceCode,confirmation:'none',insurance_provider:'none',
            [direction==='INBOUND'?'ship_to':'ship_from']:structuredClone(party),
            ...(direction==='RETURN'||!customerMeasured ? {packages:[{package_code:'package',...structuredClone(testPackage)}]}:{})}});
    return {version:'atlas-measured-shipstation-plan-v1',provider:'SHIPSTATION',fulfillmentPolicy:'INBOUND_AFTER_PAYMENT_RETURN_WHEN_PREPARED',
        inboundPackaging:customerMeasured?'CUSTOMER_MEASURED':'CONFIGURED',carrierId,serviceCode,carrierLabel:'UPS',serviceLabel:'Ground',
        packingPresetId:'fixture-count-'+count,shippingServiceCode,cardCount:count,measurementReference:'SYNTHETIC_TEST_ONLY: measured return package',
        validFrom:'2026-01-01T00:00:00.000Z',label:'UPS Ground',packaging:'Synthetic measured return box',legs:{INBOUND:leg('INBOUND'),RETURN:leg('RETURN')}};
}
export function shipStationSource(options) {const s=source('MAIL_IN',options?.count??1);s.shippingPlans=[shipStationPlan(options)];return s;}
export function ratePayload(shipment,{amount='10.25',rateId='se-rate-123',serviceCode=shipment.service_code}={}) {
    const money=amount=>({currency:'usd',amount});
    return {rate_response:{status:'completed',shipment_id:'se-shipment-123',rates:[{rate_id:rateId,carrier_id:shipment.carrier_id,service_code:serviceCode,
        shipping_amount:money(amount),insurance_amount:money(0),confirmation_amount:money(1),other_amount:money('0.25'),
        validation_status:'valid',error_messages:[],trackable:true,carrier_friendly_name:'UPS',service_type:'UPS Ground'}]}};
}
