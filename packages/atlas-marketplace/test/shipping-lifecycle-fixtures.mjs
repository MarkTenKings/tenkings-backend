import {clone,hash} from '../src/contract.mjs';
import {openLocalStore} from '../src/store.mjs';
import {createShipStationTrackingAdapter} from '../src/provider-tracking-shipstation.mjs';
import {createShippingLifecycle} from '../src/shipping-lifecycle.mjs';

export const TRACKING_NOW=Date.parse('2026-10-23T12:00:00.000Z');
export const TRACKING_FROM={name:'Synthetic ATLAS',phone:'+12025550123',line1:'456 Synthetic Warehouse Road',line2:null,city:'Austin',state:'TX',postalCode:'78701',country:'US',residential:'no'};
export const TRACKING_TO={...TRACKING_FROM,name:'Synthetic Buyer',line1:'123 Synthetic Buyer Road',city:'Seattle',state:'WA',postalCode:'98104',residential:'yes'};
const wire=a=>({name:a.name,phone:a.phone,address_line1:a.line1,address_line2:a.line2,city_locality:a.city,state_province:a.state,postal_code:a.postalCode,country_code:a.country,address_residential_indicator:a.residential});
export function trackingFixture(t,{fetchImpl,filename=':memory:'}={}) {
  const control={now:TRACKING_NOW,approved:true,authorized:true,validEvidence:true,hooks:{},calls:[],tracking:{tracking_number:'SYNTHETICTRACK01',status_code:'NY',actual_delivery_date:null,events:[]}};
  const config={environment:'PROVIDER_SANDBOX',approvalRef:'SYNTHETIC_TRACKING_APPROVAL',accountApprovalRef:'SYNTHETIC_ACCOUNT_APPROVAL',qualificationRef:'SYNTHETIC_HTTP_ONLY',timestampPolicyApprovalRef:'SYNTHETIC_TIME_CONTRACT',effectiveAt:new Date(TRACKING_NOW-86400000).toISOString(),expiresAt:new Date(TRACKING_NOW+10*86400000).toISOString(),carrierId:'se-123',carrierCode:'ups',carrierAccountNumber:'SYNTHETIC_ACCOUNT',serviceCodes:['ups_ground'],insuranceProviders:['carrier'],confirmations:['signature'],maxDeclaredValueCents:100000};
  const expected={shipFrom:TRACKING_FROM,shipTo:TRACKING_TO,parcel:{weightOunces:16,lengthInches:8,widthInches:6,heightInches:4},serviceCode:'ups_ground',confirmation:'signature',insuranceProvider:'carrier',declaredValueCents:10000,shipmentCostCents:700,insuranceCostCents:200};
  const account={carrier_id:'se-123',carrier_code:'ups',account_number:'SYNTHETIC_ACCOUNT',services:[{service_code:'ups_ground'}]};
  const label={label_id:'se-label-123',shipment_id:'se-shipment-123',carrier_id:'se-123',carrier_code:'ups',service_code:'ups_ground',tracking_number:'SYNTHETICTRACK01',is_return_label:false,is_international:false,status:'completed',voided:false,trackable:true,confirmation:'signature',shipment_cost:{currency:'usd',amount:'7.00'},insurance_cost:{currency:'usd',amount:'2.00'},created_at:new Date(TRACKING_NOW-3000).toISOString(),label_download:{href:'https://private.invalid/DO_NOT_RETAIN'}};
  const shipment={shipment_id:label.shipment_id,carrier_id:'se-123',service_code:'ups_ground',external_shipment_id:'SYNTHETIC_ORDER_ONE',confirmation:'signature',insurance_provider:'carrier',ship_from:wire(TRACKING_FROM),ship_to:wire(TRACKING_TO),packages:[{package_code:'package',weight:{unit:'ounce',value:16},dimensions:{unit:'inch',length:8,width:6,height:4},insured_value:{currency:'usd',amount:'100.00'}}]};
  const store=openLocalStore({filename,environment:'SYNTHETIC_LOCAL',clock:()=>control.now});t.after(()=>store.close());
  const order={orderId:'order_one',cardId:'11111111-1111-4111-8111-111111111111',environment:'PROVIDER_SANDBOX',status:'PAID',bindingHash:hash('SYNTHETIC_ORDER_ONLY'),itemCents:10000,paymentIntentId:'payment_one',policy:{fulfillmentPolicy:{missingScanAfterMs:60000}}};
  store.transaction(tx=>{tx.state.orders[order.orderId]=clone(order);tx.state.intents.payment_one={kind:'PAYMENT',status:'SUCCEEDED',confirmed:true,orderId:order.orderId,bindingHash:order.bindingHash,reconciledAt:TRACKING_NOW-5000};});
  const remote=async(url,options)=>{control.calls.push({url,method:options.method,body:options.body});const path=new URL(url).pathname;if(control.hooks[path])await control.hooks[path]();const value=path.endsWith('/track')?control.tracking:path.includes('/carriers/')?account:path.includes('/labels/')?label:shipment;return new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});};
  const adapter=createShipStationTrackingAdapter({enabled:true,config,apiKey:'TEST_SYNTHETIC_NO_REAL_CREDENTIAL',assertReady:()=>control.approved,clock:()=>control.now,fetchImpl:fetchImpl??remote});t.after(()=>adapter.close());
  const options={enabled:true,store,trackingAdapter:adapter,approvalRef:'SYNTHETIC_LIFECYCLE_ONLY',assertReady:()=>control.approved,resolveShipment:async()=>clone(expected),validateEvidence:async()=>{if(control.hooks.evidence)await control.hooks.evidence();return control.validEvidence;},clock:()=>control.now};
  const lifecycle=createShippingLifecycle(options);t.after(()=>lifecycle.close());
  const input={requestId:'request_issued',orderId:'order_one',direction:'OUTBOUND',caseId:null,labelId:label.label_id,shipmentId:shipment.shipment_id,trackingNumber:label.tracking_number,externalShipmentId:shipment.external_shipment_id,issuanceEvidenceRef:'proof_issuance',coverageEvidenceRef:'proof_coverage',measurementRef:'proof_measured'};
  const auth={authorizeCommit:()=>control.authorized};
  const event=(status,at)=>({status_code:status,occurred_at:new Date(at).toISOString(),event_code:status,carrier_occurred_at:'LOCAL_TIME_MUST_NOT_BE_USED',signer:'PRIVATE_PERSON_MUST_NOT_BE_RETAINED'});
  return {control,config,expected,account,label,shipment,store,order,adapter,lifecycle,input,options,remote,auth,event,wire};
}
