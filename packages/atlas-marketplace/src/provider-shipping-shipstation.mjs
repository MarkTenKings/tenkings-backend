import {clone,hash,requireValue,cents,sumCents} from './contract.mjs';
import {exactKeys,exactTime} from './fee-policy.mjs';
import {createProviderQuoteGate,createQuoteHttp,quoteText,validateQuoteAddress,readQuoteAddress,retainedQuoteOperation} from './provider-quote-http.mjs';

const ID=/^se(?:-[a-z0-9]+)+$/;
const party=a=>({name:a.name,phone:a.phone,address_line1:a.line1,...(a.line2?{address_line2:a.line2}:{}),city_locality:a.city,state_province:a.state,postal_code:a.postalCode,country_code:a.country,address_residential_indicator:a.residential});
export function shipStationMinor(value) {
  requireValue(value?.currency==='usd'&&(typeof value.amount==='number'||typeof value.amount==='string'),'SHIPPING_CURRENCY_INVALID');
  const decimal=String(value.amount);requireValue(/^\d+(?:\.\d{1,2})?$/.test(decimal),'SHIPPING_AMOUNT_INVALID');
  const [whole,fraction='']=decimal.split('.'),minor=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
  requireValue(minor<=BigInt(Number.MAX_SAFE_INTEGER),'CENTS_OVERFLOW');return Number(minor);
}
function plan(config) {
  exactKeys(config,['environment','approvalRef','accountApprovalRef','policyRef','checkoutPolicyHash','effectiveAt','expiresAt','maxQuoteAgeMs','carrierId','carrierCode','carrierAccountNumber','serviceCode','shipFrom','parcel','measurementRef','shipDate','shipDateTimeZone','confirmation','coverage'],'SHIPPING_CONFIG_INVALID');
  requireValue(ID.test(config.carrierId)&&quoteText(config.carrierAccountNumber)&&quoteText(config.accountApprovalRef)&&quoteText(config.measurementRef)&&/^[a-z0-9_]+$/.test(config.carrierCode)&&/^[a-z0-9_]+$/.test(config.serviceCode),'SHIPPING_CONFIG_INVALID');
  requireValue(/^\d{4}-\d{2}-\d{2}$/.test(config.shipDate)&&new Date(`${config.shipDate}T00:00:00.000Z`).toISOString().slice(0,10)===config.shipDate,'SHIPPING_DATE_INVALID');
  try{new Intl.DateTimeFormat('en-US',{timeZone:config.shipDateTimeZone}).format();}catch{requireValue(false,'SHIPPING_DATE_INVALID');}
  validateQuoteAddress(config.shipFrom);
  exactKeys(config.parcel,['weightOunces','lengthInches','widthInches','heightInches'],'SHIPPING_MEASUREMENT_REQUIRED');
  const p=config.parcel;requireValue(Object.values(p).every(value=>typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=2400)&&p.weightOunces<=2400,'SHIPPING_MEASUREMENT_REQUIRED');
  const sides=[p.lengthInches,p.widthInches,p.heightInches].sort((a,b)=>b-a);requireValue(sides[0]<=108&&sides[0]+2*(sides[1]+sides[2])<=165,'SHIPPING_MEASUREMENT_REQUIRED');
  requireValue(['none','delivery','signature','adult_signature','direct_signature'].includes(config.confirmation),'SHIPPING_CONFIRMATION_REQUIRED');
  exactKeys(config.coverage,['provider','approvalRef','termsRef','coveredItemType','valueBasis','maxDeclaredValueCents','disclosure'],'SHIPPING_COVERAGE_REQUIRED');
  const c=config.coverage;requireValue(['carrier','parcelguard','shipsurance'].includes(c.provider)&&quoteText(c.approvalRef)&&quoteText(c.termsRef)&&c.coveredItemType==='GRADED_TRADING_CARD'&&c.valueBasis==='ITEM_PRICE'&&quoteText(c.disclosure,500),'SHIPPING_COVERAGE_REQUIRED');cents(c.maxDeclaredValueCents,{positive:true});
}
export function createShipStationQuoteAdapter({enabled=false,store,config,apiKey,resolveDestination,assertReady,fetchImpl=fetch,clock=Date.now,timeoutMs=15000}={}) {
  if(!enabled)return Object.freeze({enabled:false,assertReady:()=>false,quote:async()=>{requireValue(false,'SHIPPING_PROVIDER_DISABLED');},close(){}});
  plan(config);requireValue(typeof apiKey==='string'&&apiKey.length>=20&&apiKey.length<=500&&!/\s/.test(apiKey)&&(config.environment==='PROVIDER_SANDBOX')===apiKey.startsWith('TEST_')&&typeof store?.transaction==='function','SHIPPING_ACCOUNT_REQUIRED');
  const gate=createProviderQuoteGate({provider:'SHIPSTATION_SHIPENGINE_V1',config,assertReady,clock}),p=gate.saved;
  const pins={read:store.read,transaction:store.transaction,address:resolveDestination?.readAddress,destinationCurrent:resolveDestination?.assertCurrent};
  const current=parent=>{requireValue(store.read===pins.read&&store.transaction===pins.transaction&&resolveDestination?.readAddress===pins.address&&resolveDestination?.assertCurrent===pins.destinationCurrent,'QUOTE_PROVIDER_PORT_CHANGED');const now=gate.current(parent);const parts=new Intl.DateTimeFormat('en-CA',{timeZone:p.shipDateTimeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);const part=name=>parts.find(item=>item.type===name).value;
    requireValue(`${part('year')}-${part('month')}-${part('day')}`<=p.shipDate,'SHIPPING_DATE_EXPIRED');return now;};
  const http=createQuoteHttp({origin:'https://api.shipengine.com',headers:{'API-Key':apiKey,'Content-Type':'application/json'},fetchImpl,timeoutMs,current,
    allow:(method,path)=>method==='GET'&&path===`/v1/carriers/${p.carrierId}`||method==='POST'&&path==='/v1/rates'});
  return Object.freeze({enabled:true,binding:gate.binding,assertReady(parent){current(parent);return true;},
    async quote(input) {
      const issuedAt=current();const {signal,...request}=input;
      requireValue(request.environment===p.environment&&request.policyRef===p.policyRef&&request.currency==='USD'&&request.destination?.countryCode==='US','SHIPPING_REQUEST_MISMATCH');cents(request.itemCents,{positive:true});
      requireValue(request.itemCents<=p.coverage.maxDeclaredValueCents,'SHIPPING_DECLARED_VALUE_EXCEEDED');
      const declared=Number(`${Math.floor(request.itemCents/100)}.${String(request.itemCents%100).padStart(2,'0')}`);requireValue(shipStationMinor({currency:'usd',amount:declared})===request.itemCents,'SHIPPING_DECLARED_VALUE_INVALID');
      const address=await readQuoteAddress(resolveDestination,input,current);
      const account=await http.request('GET',`/v1/carriers/${p.carrierId}`,{signal});
      requireValue(account.carrier_id===p.carrierId&&account.carrier_code===p.carrierCode&&account.account_number===p.carrierAccountNumber&&account.disabled_by_billing_plan!==true&&account.connection_status!=='pending_approval'&&account.services?.some(service=>service.service_code===p.serviceCode),'SHIPPING_ACCOUNT_MISMATCH');
      const parcel=p.parcel,wire={rate_options:{carrier_ids:[p.carrierId],service_codes:[p.serviceCode],preferred_currency:'USD'},shipment:{carrier_id:p.carrierId,service_code:p.serviceCode,ship_date:p.shipDate,ship_from:party(p.shipFrom),ship_to:party(address),packages:[{package_code:'package',weight:{value:parcel.weightOunces,unit:'ounce'},dimensions:{unit:'inch',length:parcel.lengthInches,width:parcel.widthInches,height:parcel.heightInches},insured_value:{currency:'usd',amount:declared}}],confirmation:p.confirmation,insurance_provider:p.coverage.provider}};
      return retainedQuoteOperation({store,binding:gate.binding,kind:'SHIPPING_RATE',request,wire,current,execute:async()=>{
        const result=await http.request('POST','/v1/rates',{body:JSON.stringify(wire),signal});current();
        const response=result.rate_response,rates=response?.rates?.filter(rate=>rate.carrier_id===p.carrierId&&rate.service_code===p.serviceCode);
        requireValue(response?.status==='completed'&&ID.test(response.shipment_id)&&Array.isArray(rates)&&rates.length===1&&!(response.errors?.length),'SHIPPING_RATE_UNAVAILABLE');
        const rate=rates[0];requireValue(ID.test(rate.rate_id)&&rate.validation_status==='valid'&&rate.trackable===true&&!(rate.error_messages?.length)&&!(rate.warning_messages?.length),'SHIPPING_RATE_UNAVAILABLE');
        requireValue(!rate.tax_amount||shipStationMinor(rate.tax_amount)===0,'SHIPPING_UNAPPROVED_SURCHARGE');
        const insuranceCents=shipStationMinor(rate.insurance_amount),amountCents=sumCents(shipStationMinor(rate.shipping_amount),shipStationMinor(rate.confirmation_amount),shipStationMinor(rate.other_amount),insuranceCents);
        requireValue(quoteText(rate.carrier_friendly_name,100)&&quoteText(rate.service_type,100),'SHIPPING_RATE_INVALID');
        const days=rate.delivery_days;requireValue(days===null||Number.isSafeInteger(days)&&days>=0&&days<=365,'SHIPPING_ESTIMATE_INVALID');
        const deliveryEstimate=`${rate.carrier_friendly_name} ${rate.service_type}: ${days===null?'delivery timing unavailable':`estimated ${days} carrier transit days`}. Estimate only; dispatch and delivery are separate recorded events. ${p.coverage.disclosure}`;
        const receipt={requestHash:hash(request),quoteRef:rate.rate_id,amountCents,currency:'USD',policyRef:p.policyRef,issuedAt:new Date(issuedAt).toISOString(),expiresAt:new Date(Math.min(issuedAt+p.maxQuoteAgeMs,exactTime(p.expiresAt),exactTime(request.destination.expiresAt))).toISOString(),deliveryEstimate};
        requireValue(exactTime(receipt.expiresAt)>current(),'SHIPPING_QUOTE_EXPIRED');
        await readQuoteAddress(resolveDestination,input,current);
        return {receipt,evidence:{provider:'SHIPSTATION_SHIPENGINE_V1',rateId:rate.rate_id,shipmentId:response.shipment_id,carrierId:p.carrierId,carrierAccountHash:hash(p.carrierAccountNumber),serviceCode:p.serviceCode,measurementRef:p.measurementRef,wireHash:hash(wire),addressHash:request.destination.addressHash,amountCents,insuranceCents,coverageProvider:p.coverage.provider,coverageTermsRef:p.coverage.termsRef,coverageApprovalRef:p.coverage.approvalRef,declaredValueCents:request.itemCents}};
      }});
    },close(){gate.close();http.close();},
  });
}
