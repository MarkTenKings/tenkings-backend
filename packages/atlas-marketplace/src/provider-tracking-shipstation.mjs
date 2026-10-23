import {clone,hash,requireValue,cents,sumCents} from './contract.mjs';
import {exactKeys,exactTime,requireSyncApproval} from './fee-policy.mjs';
import {createQuoteHttp,quoteText,validateQuoteAddress} from './provider-quote-http.mjs';
import {shipStationMinor} from './provider-shipping-shipstation.mjs';

const branded=new WeakMap();
const ID=/^se(?:-[a-z0-9]+)+$/;
const TRACK=/^[A-Za-z0-9][A-Za-z0-9 -]{0,99}$/;
const statuses=new Set(['AC','IT','DE','EX','UN','AT','NY','SP']);
const possession=new Set(['AC','IT','DE','AT','SP']);
const validId=value=>typeof value==='string'&&value.length<=25&&ID.test(value);
function utc(value,now,{nullable=false}={}) {
  if(nullable&&(value===null||value===undefined))return null;
  requireValue(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/.test(value),'SHIPPING_EVENT_TIME_INVALID');
  const n=Date.parse(value);requireValue(Number.isSafeInteger(n)&&n>=0&&n<=now,'SHIPPING_EVENT_TIME_INVALID');
  requireValue(new Date(n).toISOString().slice(0,19)===value.slice(0,19),'SHIPPING_EVENT_TIME_INVALID');return n;
}
function address(value) {
  requireValue(value&&(!value.address_line3)&&(!value.ship_to_service_point_id),'SHIPPING_ADDRESS_MISMATCH');
  return validateQuoteAddress({name:value.name,phone:value.phone,line1:value.address_line1,line2:value.address_line2||null,city:value.city_locality,state:value.state_province,postalCode:value.postal_code,country:value.country_code,residential:value.address_residential_indicator});
}
function parcel(value) {
  exactKeys(value,['weightOunces','lengthInches','widthInches','heightInches'],'SHIPPING_MEASUREMENT_REQUIRED');
  requireValue(Object.values(value).every(n=>typeof n==='number'&&Number.isFinite(n)&&n>0&&n<=2400),'SHIPPING_MEASUREMENT_REQUIRED');
  const sides=[value.lengthInches,value.widthInches,value.heightInches].sort((a,b)=>b-a);
  requireValue(value.weightOunces<=2400&&sides[0]<=108&&sides[0]+2*(sides[1]+sides[2])<=165,'SHIPPING_MEASUREMENT_REQUIRED');return clone(value);
}
function wireParcel(value) {
  requireValue(value?.package_code==='package'&&value.weight?.unit==='ounce'&&value.dimensions?.unit==='inch','SHIPPING_MEASUREMENT_MISMATCH');
  return parcel({weightOunces:value.weight.value,lengthInches:value.dimensions.length,widthInches:value.dimensions.width,heightInches:value.dimensions.height});
}
function expectedFacts(value,config) {
  exactKeys(value,['shipFrom','shipTo','parcel','serviceCode','confirmation','insuranceProvider','declaredValueCents','shipmentCostCents','insuranceCostCents'],'SHIPPING_EXPECTED_INVALID');
  const from=validateQuoteAddress(value.shipFrom),to=validateQuoteAddress(value.shipTo),p=parcel(value.parcel);
  requireValue(config.serviceCodes.includes(value.serviceCode)&&config.insuranceProviders.includes(value.insuranceProvider)&&config.confirmations.includes(value.confirmation),'SHIPPING_SERVICE_UNQUALIFIED');
  cents(value.declaredValueCents,{positive:true});cents(value.shipmentCostCents);cents(value.insuranceCostCents);
  requireValue(value.declaredValueCents<=config.maxDeclaredValueCents,'SHIPPING_DECLARED_VALUE_EXCEEDED');
  return {shipFromHash:hash(from),shipToHash:hash(to),parcel:p,serviceCode:value.serviceCode,confirmation:value.confirmation,insuranceProvider:value.insuranceProvider,declaredValueCents:value.declaredValueCents,shipmentCostCents:value.shipmentCostCents,insuranceCostCents:value.insuranceCostCents,totalCostCents:sumCents(value.shipmentCostCents,value.insuranceCostCents)};
}
export function assertShipStationTrackingAdapter(adapter) {
  const internal=branded.get(adapter);requireValue(internal,'SHIPPING_TRACKING_ADAPTER_REQUIRED');internal.current();return internal;
}
// Only explicit original-object GETs exist here. No purchase, void, lookup-by-
// latest, tracking subscription, webhook registration, or URL supplied by a caller.
export function createShipStationTrackingAdapter({enabled=false,config,apiKey,assertReady,fetchImpl=fetch,clock=Date.now,timeoutMs=15000}={}) {
  if(!enabled)return Object.freeze({enabled:false,assertReady:()=>false,verifyIssuedShipment:async()=>{requireValue(false,'SHIPPING_TRACKING_DISABLED');},readTracking:async()=>{requireValue(false,'SHIPPING_TRACKING_DISABLED');},close(){}});
  exactKeys(config,['environment','approvalRef','accountApprovalRef','qualificationRef','timestampPolicyApprovalRef','effectiveAt','expiresAt','carrierId','carrierCode','carrierAccountNumber','serviceCodes','insuranceProviders','confirmations','maxDeclaredValueCents'],'SHIPPING_TRACKING_CONFIG_REQUIRED');
  requireValue(['PROVIDER_SANDBOX','PRODUCTION'].includes(config.environment)&&['approvalRef','accountApprovalRef','qualificationRef','timestampPolicyApprovalRef','carrierAccountNumber'].every(k=>quoteText(config[k]))&&validId(config.carrierId)&&/^[a-z0-9_]+$/.test(config.carrierCode),'SHIPPING_TRACKING_CONFIG_REQUIRED');
  for(const key of ['serviceCodes','insuranceProviders','confirmations'])requireValue(Array.isArray(config[key])&&config[key].length>0&&config[key].length<=20&&new Set(config[key]).size===config[key].length,'SHIPPING_TRACKING_CONFIG_REQUIRED');
  requireValue(config.serviceCodes.every(s=>typeof s==='string'&&/^[a-z0-9_]+$/.test(s))&&config.insuranceProviders.every(s=>['carrier','parcelguard','shipsurance'].includes(s))&&config.confirmations.every(s=>['none','delivery','signature','adult_signature','direct_signature'].includes(s)),'SHIPPING_TRACKING_CONFIG_REQUIRED');
  cents(config.maxDeclaredValueCents,{positive:true});requireValue(exactTime(config.expiresAt)>exactTime(config.effectiveAt)&&typeof assertReady==='function','SHIPPING_TRACKING_CONFIG_REQUIRED');
  requireValue(typeof apiKey==='string'&&apiKey.length>=20&&apiKey.length<=500&&!/\s/.test(apiKey)&&(config.environment==='PROVIDER_SANDBOX')===apiKey.startsWith('TEST_'),'SHIPPING_ACCOUNT_REQUIRED');
  const p=clone(config),configHash=hash(config),binding=Object.freeze({provider:'SHIPSTATION_SHIPENGINE_V1_TRACKING',environment:p.environment,configHash,approvalRef:p.approvalRef,qualificationRef:p.qualificationRef,carrierId:p.carrierId,carrierCode:p.carrierCode,carrierAccountHash:hash(p.carrierAccountNumber)});
  let lastNow=0,closed=false;
  const current=()=>{const now=clock();requireValue(!closed&&Number.isSafeInteger(now)&&now>=lastNow,'SHIPPING_TRACKING_CLOCK_INVALID');lastNow=now;requireValue(hash(config)===configHash,'SHIPPING_TRACKING_CONFIG_CHANGED');requireSyncApproval(assertReady(binding),'SHIPPING_TRACKING_APPROVAL_REQUIRED');requireValue(now>=exactTime(p.effectiveAt)&&now<exactTime(p.expiresAt),'SHIPPING_TRACKING_POLICY_EXPIRED');return now;};
  const http=createQuoteHttp({origin:'https://api.shipengine.com',headers:{'API-Key':apiKey,'Cache-Control':'no-cache'},fetchImpl,timeoutMs,current,allow:(method,path)=>method==='GET'&&(path===('/v1/carriers/'+p.carrierId)||/^\/v1\/labels\/se(?:-[a-z0-9]+)+(?:\/track)?$/.test(path)||/^\/v1\/shipments\/se(?:-[a-z0-9]+)+$/.test(path))});
  async function originalRead(original,{signal}={}) {
    current();requireValue(original?.bindingHash===hash(binding)&&validId(original.labelId)&&validId(original.shipmentId)&&TRACK.test(original.trackingNumber),'SHIPPING_ORIGINAL_INVALID');
    const account=await http.request('GET','/v1/carriers/'+p.carrierId,{signal});
    requireValue(account.carrier_id===p.carrierId&&account.carrier_code===p.carrierCode&&account.account_number===p.carrierAccountNumber&&account.disabled_by_billing_plan!==true&&account.connection_status!=='pending_approval'&&account.services?.some(s=>s.service_code===original.facts.serviceCode),'SHIPPING_ACCOUNT_MISMATCH');
    const label=await http.request('GET','/v1/labels/'+original.labelId,{signal});
    requireValue(label.label_id===original.labelId&&label.shipment_id===original.shipmentId&&label.carrier_id===p.carrierId&&label.carrier_code===p.carrierCode&&label.service_code===original.facts.serviceCode&&label.tracking_number===original.trackingNumber&&label.is_return_label===(original.direction==='RETURN')&&label.is_international===false&&label.status==='completed'&&label.voided===false&&label.trackable===true&&label.confirmation===original.facts.confirmation,'SHIPPING_LABEL_MISMATCH');
    requireValue(shipStationMinor(label.shipment_cost)===original.facts.shipmentCostCents&&shipStationMinor(label.insurance_cost)===original.facts.insuranceCostCents,'SHIPPING_COST_MISMATCH');
    if(label.packages!==undefined)requireValue(Array.isArray(label.packages)&&label.packages.length===1&&label.packages[0].tracking_number===original.trackingNumber,'SHIPPING_MULTIPACKAGE_REFUSED');
    const shipment=await http.request('GET','/v1/shipments/'+original.shipmentId,{signal});
    requireValue(shipment.shipment_id===original.shipmentId&&shipment.carrier_id===p.carrierId&&shipment.service_code===original.facts.serviceCode&&(shipment.external_shipment_id??null)===original.externalShipmentId&&shipment.confirmation===original.facts.confirmation&&shipment.insurance_provider===original.facts.insuranceProvider&&Array.isArray(shipment.packages)&&shipment.packages.length===1&&!shipment.ship_to_service_point_id&&!shipment.ship_from_service_point_id,'SHIPPING_SHIPMENT_MISMATCH');
    requireValue(hash(address(shipment.ship_from))===original.facts.shipFromHash&&hash(address(shipment.ship_to))===original.facts.shipToHash,'SHIPPING_ADDRESS_MISMATCH');
    requireValue(hash(wireParcel(shipment.packages[0]))===hash(original.facts.parcel)&&shipStationMinor(shipment.packages[0].insured_value)===original.facts.declaredValueCents,'SHIPPING_MEASUREMENT_MISMATCH');
    const labelCreatedAt=utc(label.created_at,current());
    requireValue(original.labelCreatedAt===undefined||labelCreatedAt===original.labelCreatedAt,'SHIPPING_ORIGINAL_CHANGED');
    return {...clone(original),labelCreatedAt,providerReadHash:hash({label,shipment,account})};
  }
  const adapter=Object.freeze({enabled:true,binding,assertReady(){current();return true;},
    async verifyIssuedShipment({labelId,shipmentId,trackingNumber,externalShipmentId=null,direction,expected,signal}={}) {
      current();requireValue(validId(labelId)&&validId(shipmentId)&&typeof trackingNumber==='string'&&TRACK.test(trackingNumber)&&['OUTBOUND','RETURN'].includes(direction)&&(externalShipmentId===null||quoteText(externalShipmentId,50)),'SHIPPING_ORIGINAL_INVALID');
      return originalRead({bindingHash:hash(binding),labelId,shipmentId,trackingNumber,externalShipmentId,direction,facts:expectedFacts(expected,p)},{signal});
    },
    async readTracking({original,signal}={}) {
      const refreshed=await originalRead(original,{signal});
      const raw=await http.request('GET','/v1/labels/'+original.labelId+'/track',{signal});const now=current();
      requireValue(raw.tracking_number===original.trackingNumber&&statuses.has(raw.status_code)&&Array.isArray(raw.events)&&raw.events.length<=500,'SHIPPING_TRACKING_MISMATCH');
      const events=raw.events.map(e=>{requireValue(e&&typeof e==='object','SHIPPING_TRACKING_MISMATCH');const status=statuses.has(e.status_code)?e.status_code:null;return {occurredAt:utc(e.occurred_at,now),statusCode:status,eventCode:quoteText(String(e.event_code??''),100)?String(e.event_code):null,detailCode:quoteText(e.status_detail_code,100)?e.status_detail_code:null};});
      requireValue(events.every(e=>e.occurredAt>=refreshed.labelCreatedAt),'SHIPPING_EVENT_BEFORE_LABEL');
      const actual=utc(raw.actual_delivery_date,now,{nullable:true}),deliveryEvents=events.filter(e=>e.statusCode==='DE'&&(!e.detailCode||e.detailCode==='DELIVERED')).map(e=>e.occurredAt);
      requireValue(actual===null||actual>=refreshed.labelCreatedAt,'SHIPPING_EVENT_BEFORE_LABEL');
      const detail=quoteText(raw.status_detail_code,100)?raw.status_detail_code:null;
      const dates=[...new Set([...(actual===null?[]:[actual]),...deliveryEvents])];
      const deliveryConflict=dates.length>1||actual!==null&&raw.status_code!=='DE'||raw.status_code==='DE'&&detail!==null&&detail!=='DELIVERED'||events.some(e=>e.statusCode==='DE'&&e.detailCode!==null&&e.detailCode!=='DELIVERED')||(dates.length===1&&events.some(e=>possession.has(e.statusCode)&&e.occurredAt>dates[0]));
      const deliveredAt=raw.status_code==='DE'&&!deliveryConflict&&dates.length===1?dates[0]:null;
      const progress=events.filter(e=>possession.has(e.statusCode)&&(!e.detailCode||!e.detailCode.includes('RETURN'))).map(e=>e.occurredAt);
      if(deliveredAt!==null)progress.push(deliveredAt);
      const result={statusCode:raw.status_code,detailCode:detail,deliveredAt,deliverySource:deliveredAt===null?null:(actual===null?'NORMALIZED_DE_EVENT':'ACTUAL_DELIVERY_DATE'),firstPossessionAt:progress.length?Math.min(...progress):null,lastProgressAt:progress.length?Math.max(...progress):null,deliveryConflict,deliveryTimeMissing:raw.status_code==='DE'&&dates.length===0,events:events.sort((a,b)=>a.occurredAt-b.occurredAt||hash(a).localeCompare(hash(b))),responseHash:hash(raw),originalReadHash:refreshed.providerReadHash};
      return {...result,observedAt:now,observationHash:hash(result)};
    },close(){closed=true;http.close();}
  });branded.set(adapter,{binding,current,verifyIssuedShipment:adapter.verifyIssuedShipment,readTracking:adapter.readTracking});return adapter;
}
