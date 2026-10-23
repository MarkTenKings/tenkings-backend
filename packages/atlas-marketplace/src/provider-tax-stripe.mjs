import {clone,hash,requireValue,cents,sumCents} from './contract.mjs';
import {exactKeys,exactTime} from './fee-policy.mjs';
import {createProviderQuoteGate,createQuoteHttp,quoteText,validateQuoteAddress,stripeAddress,formBody,readQuoteAddress,retainedQuoteOperation} from './provider-quote-http.mjs';

const CALC=/^taxcalc_[A-Za-z0-9]+$/,TRANSACTION=/^tax_[A-Za-z0-9]+$/,LINE=/^tax_li_[A-Za-z0-9]+$/;
const brands=new WeakMap();
const addressHash=value=>hash({line1:value?.line1,line2:value?.line2||null,city:value?.city,state:value?.state,postal_code:value?.postal_code,country:value?.country});
function configCheck(config) {
  exactKeys(config,['environment','approvalRef','policyRef','checkoutPolicyHash','effectiveAt','expiresAt','maxQuoteAgeMs','accountId','apiVersion','itemTaxCode','shippingTaxCode','taxBasis','responsibleEntityRef','registrationApprovalRef','shipFrom','allowedZeroTaxReasons'],'TAX_CONFIG_INVALID');
  requireValue(/^acct_[A-Za-z0-9]+$/.test(config.accountId)&&/^\d{4}-\d{2}-\d{2}\.[a-z]+$/.test(config.apiVersion)&&/^txcd_\d{8}$/.test(config.itemTaxCode)&&/^txcd_\d{8}$/.test(config.shippingTaxCode)&&['ITEM_ONLY','ITEM_AND_SHIPPING'].includes(config.taxBasis)&&quoteText(config.responsibleEntityRef)&&quoteText(config.registrationApprovalRef),'TAX_CONFIG_INVALID');
  validateQuoteAddress(config.shipFrom);
  requireValue(Array.isArray(config.allowedZeroTaxReasons)&&config.allowedZeroTaxReasons.length<=20&&new Set(config.allowedZeroTaxReasons).size===config.allowedZeroTaxReasons.length&&config.allowedZeroTaxReasons.every(reason=>typeof reason==='string'&&/^[a-z_]{1,80}$/.test(reason)),'TAX_ZERO_REASON_POLICY_REQUIRED');
}
function normalizedLine(value,expected,{livemode,type='calculation',originalLineId}={}) {
  requireValue(LINE.test(value?.id)&&value.livemode===livemode&&value.amount===expected.itemCents&&value.amount_tax===expected.itemTaxCents&&value.reference===expected.lineReference&&value.tax_code===expected.itemTaxCode&&value.tax_behavior==='exclusive'&&value.quantity===1,'TAX_LINE_MISMATCH');
  if(type!=='calculation')requireValue(value.type===type,'TAX_LINE_MISMATCH');
  if(originalLineId)requireValue(value.reversal?.original_line_item===originalLineId,'TAX_REVERSAL_MISMATCH');
  return {id:value.id,itemCents:value.amount,itemTaxCents:value.amount_tax,lineReference:value.reference,itemTaxCode:value.tax_code};
}
export function assertStripeTaxAdapter(adapter,{store}={}) {
  const internal=brands.get(adapter);requireValue(internal&&(!store||internal.store===store),'TAX_ADAPTER_BINDING_MISMATCH');internal.current();return internal;
}
export function createStripeTaxQuoteAdapter({enabled=false,store,config,secretKey,resolveDestination,assertReady,fetchImpl=fetch,clock=Date.now,timeoutMs=15000}={}) {
  if(!enabled)return Object.freeze({enabled:false,assertReady:()=>false,quote:async()=>{requireValue(false,'TAX_PROVIDER_DISABLED');},close(){}});
  configCheck(config);const livemode=config.environment==='PRODUCTION';
  requireValue(typeof secretKey==='string'&&(livemode?/^(sk|rk)_live_[A-Za-z0-9]+$/:/^(sk|rk)_test_[A-Za-z0-9]+$/).test(secretKey)&&typeof store?.transaction==='function'&&typeof store.read==='function','TAX_ACCOUNT_REQUIRED');
  const gate=createProviderQuoteGate({provider:'STRIPE_TAX',config,assertReady,clock}),p=gate.saved;
  const pins={read:store.read,transaction:store.transaction,address:resolveDestination?.readAddress,destinationCurrent:resolveDestination?.assertCurrent};
  const historical=()=>{requireValue(store.read===pins.read&&store.transaction===pins.transaction,'QUOTE_PROVIDER_PORT_CHANGED');return gate.historical();};
  const current=parent=>{historical();requireValue(resolveDestination?.readAddress===pins.address&&resolveDestination?.assertCurrent===pins.destinationCurrent,'QUOTE_PROVIDER_PORT_CHANGED');return gate.current(parent);};
  const http=createQuoteHttp({origin:'https://api.stripe.com',headers:{Authorization:`Bearer ${secretKey}`,'Stripe-Version':p.apiVersion,'Content-Type':'application/x-www-form-urlencoded'},fetchImpl,timeoutMs,current:historical,
    allow:(method,path)=>method==='GET'&&(path==='/v1/account'||/^\/v1\/tax\/(calculations\/taxcalc_|transactions\/tax_)[A-Za-z0-9]+\?expand%5B0%5D=line_items$/.test(path))||method==='POST'&&['/v1/tax/calculations','/v1/tax/transactions/create_from_calculation','/v1/tax/transactions/create_reversal'].includes(path)});
  async function account(signal) {const result=await http.request('GET','/v1/account',{signal});requireValue(result.id===p.accountId,'TAX_ACCOUNT_MISMATCH');historical();}
  function validateCalculation(value,expected,{requireFresh=true}={}) {
    requireValue(CALC.test(value?.id)&&value.object==='tax.calculation'&&value.livemode===livemode&&value.currency==='usd'&&value.tax_amount_inclusive===0&&Number.isSafeInteger(value.expires_at),'TAX_CALCULATION_INVALID');
    cents(value.tax_amount_exclusive);cents(value.amount_total);
    requireValue(value.customer_details?.address_source==='shipping'&&(!value.customer_details.taxability_override||value.customer_details.taxability_override==='none')&&!(value.customer_details.tax_ids?.length)&&addressHash(value.customer_details.address)===expected.customerAddressHash&&addressHash(value.ship_from_details?.address)===expected.shipFromAddressHash,'TAX_ADDRESS_MISMATCH');
    requireValue(value.line_items?.has_more===false&&value.line_items.data?.length===1,'TAX_LINE_MISMATCH');
    const itemTaxCents=cents(value.line_items.data[0].amount_tax),shippingTaxCents=cents(value.shipping_cost?.amount_tax);
    normalizedLine(value.line_items.data[0],{...expected,itemTaxCents},{livemode});
    requireValue(value.shipping_cost.amount===expected.shippingCents&&value.shipping_cost.tax_code===p.shippingTaxCode&&value.shipping_cost.tax_behavior==='exclusive'&&sumCents(itemTaxCents,shippingTaxCents)===value.tax_amount_exclusive&&value.amount_total===sumCents(expected.itemCents,expected.shippingCents,value.tax_amount_exclusive),'TAX_TOTAL_MISMATCH');
    requireValue(p.taxBasis!=='ITEM_ONLY'||shippingTaxCents===0,'TAX_BASIS_MISMATCH');
    if(value.tax_amount_exclusive===0)requireValue(Array.isArray(value.tax_breakdown)&&value.tax_breakdown.length>0&&value.tax_breakdown.every(row=>row.amount===0&&p.allowedZeroTaxReasons.includes(row.taxability_reason)),'TAX_ZERO_NOT_APPROVED');
    if(requireFresh)requireValue(value.expires_at*1000>historical(),'TAX_CALCULATION_EXPIRED');
    return {...expected,calculationId:value.id,itemTaxCents,shippingTaxCents,taxCents:value.tax_amount_exclusive,totalCents:value.amount_total,providerExpiresAt:value.expires_at*1000};
  }
  async function findCalculation(calculationId) {
    historical();
    requireValue(CALC.test(calculationId),'TAX_CALCULATION_INVALID');
    const entries=await store.read(state=>Object.values(state.quoteProviderOperations??{}).filter(row=>row.kind==='TAX_CALCULATION'&&row.providerId===calculationId&&row.status==='SUCCEEDED'&&row.bindingHash===hash(gate.binding)));
    requireValue(entries.length===1,'TAX_CALCULATION_NOT_OWNED');return entries[0];
  }
  async function verifyCalculation(calculationId,{signal}={}) {
    const saved=await findCalculation(calculationId);await account(signal);
    const value=await http.request('GET',`/v1/tax/calculations/${calculationId}?expand%5B0%5D=line_items`,{signal});
    requireValue(value.id===calculationId,'TAX_CALCULATION_MISMATCH');const evidence=validateCalculation(value,saved.evidence);
    requireValue(hash(evidence)===hash(saved.evidence),'TAX_CALCULATION_CHANGED');return clone(saved);
  }
  function validateTransaction(value,operation) {
    const e=operation.expected,reversal=operation.kind==='TAX_REFUND';
    requireValue(TRANSACTION.test(value?.id)&&value.object==='tax.transaction'&&value.livemode===livemode&&value.currency==='usd'&&value.type===(reversal?'reversal':'transaction')&&value.reference===operation.reference&&value.metadata?.atlas_marketplace_tax_operation===operation.id&&value.metadata?.atlas_marketplace_binding===operation.bindingHash,'TAX_TRANSACTION_MISMATCH');
    requireValue(value.customer_details?.address_source==='shipping'&&addressHash(value.customer_details.address)===e.customerAddressHash&&addressHash(value.ship_from_details?.address)===e.shipFromAddressHash,'TAX_TRANSACTION_ADDRESS_MISMATCH');
    requireValue(value.line_items?.has_more===false&&Array.isArray(value.line_items.data)&&value.line_items.data.length===(e.itemCents!==0||e.itemTaxCents!==0?1:0),'TAX_TRANSACTION_LINE_MISMATCH');
    const line=value.line_items.data[0];if(line)normalizedLine(line,e,{livemode,type:reversal?'reversal':'transaction',...(reversal?{originalLineId:operation.originalLineId}:{})});
    if(e.shippingCents!==0||e.shippingTaxCents!==0)requireValue(value.shipping_cost?.amount===e.shippingCents&&value.shipping_cost?.amount_tax===e.shippingTaxCents&&value.shipping_cost.tax_code===p.shippingTaxCode&&value.shipping_cost.tax_behavior==='exclusive','TAX_TRANSACTION_SHIPPING_MISMATCH');
    else requireValue(!value.shipping_cost||(value.shipping_cost.amount===0&&value.shipping_cost.amount_tax===0),'TAX_TRANSACTION_SHIPPING_MISMATCH');
    if(reversal)requireValue(value.reversal?.original_transaction===operation.originalTransactionId,'TAX_REVERSAL_MISMATCH');else requireValue(value.reversal===null,'TAX_TRANSACTION_MISMATCH');
    return {providerId:value.id,reference:value.reference,type:value.type,lineId:line?.id??null,itemCents:e.itemCents,itemTaxCents:e.itemTaxCents,shippingCents:e.shippingCents,shippingTaxCents:e.shippingTaxCents,originalTransactionId:reversal?operation.originalTransactionId:null,evidenceHash:hash({id:value.id,reference:value.reference,metadata:value.metadata,expected:e})};
  }
  async function retrieveTransaction(operation,providerId,{signal}={}) {
    requireValue(TRANSACTION.test(providerId),'TAX_TRANSACTION_ID_INVALID');await account(signal);
    const value=await http.request('GET',`/v1/tax/transactions/${providerId}?expand%5B0%5D=line_items`,{signal});requireValue(value.id===providerId,'TAX_TRANSACTION_MISMATCH');return validateTransaction(value,operation);
  }
  async function createTransaction(operation,{signal}={}) {
    historical();await account(signal);const e=operation.expected;
    const common={reference:operation.reference,metadata:{atlas_marketplace_tax_operation:operation.id,atlas_marketplace_binding:operation.bindingHash},expand:['line_items']};
    const body=operation.kind==='TAX_SALE'?{...common,calculation:operation.calculationId}:{...common,mode:'partial',original_transaction:operation.originalTransactionId,
      ...(e.itemCents!==0||e.itemTaxCents!==0?{line_items:[{amount:e.itemCents,amount_tax:e.itemTaxCents,original_line_item:operation.originalLineId,reference:e.lineReference}]}:{}),
      ...(e.shippingCents!==0||e.shippingTaxCents!==0?{shipping_cost:{amount:e.shippingCents,amount_tax:e.shippingTaxCents}}:{})};
    const value=await http.request('POST',operation.kind==='TAX_SALE'?'/v1/tax/transactions/create_from_calculation':'/v1/tax/transactions/create_reversal',{body:formBody(body),idempotencyKey:`atlas-marketplace-tax:${operation.id}`,signal});
    // Do not treat a POST response as the final tax record; caller retains this
    // ID before the independently retrieved, fully bound original is accepted.
    requireValue(TRANSACTION.test(value?.id),'TAX_TRANSACTION_ID_INVALID');return {providerId:value.id};
  }
  const adapter={enabled:true,binding:gate.binding,assertReady(parent){current(parent);return true;},
    async quote(input) {
      const issuedAt=current(),{signal,...request}=input;
      requireValue(request.environment===p.environment&&request.currency==='USD'&&request.policyRef===p.policyRef&&request.responsibleEntityRef===p.responsibleEntityRef&&request.taxBasis===p.taxBasis&&request.basisCents===(p.taxBasis==='ITEM_ONLY'?request.itemCents:sumCents(request.itemCents,request.shippingCents)),'TAX_REQUEST_MISMATCH');cents(request.itemCents,{positive:true});cents(request.shippingCents);
      if(request.shippingPricingReceiptHash!==undefined||request.shippingTaxCode!==undefined)requireValue(/^[a-f0-9]{64}$/.test(request.shippingPricingReceiptHash)&&request.shippingTaxCode===p.shippingTaxCode&&p.taxBasis==='ITEM_AND_SHIPPING','TAX_SHIPPING_PRICING_MISMATCH');
      const address=await readQuoteAddress(resolveDestination,input,current);await account(signal);
      const lineReference=`listing:${request.listingId}:v${request.listingVersion}:${request.listingHash}`;
      const wire={currency:'usd',customer_details:{address:stripeAddress(address),address_source:'shipping'},ship_from_details:{address:stripeAddress(p.shipFrom)},line_items:[{amount:request.itemCents,quantity:1,reference:lineReference,tax_code:p.itemTaxCode,tax_behavior:'exclusive'}],shipping_cost:{amount:request.shippingCents,tax_code:p.shippingTaxCode,tax_behavior:'exclusive'},expand:['line_items']};
      const expected={itemCents:request.itemCents,shippingCents:request.shippingCents,itemTaxCode:p.itemTaxCode,lineReference,customerAddressHash:addressHash(wire.customer_details.address),shipFromAddressHash:addressHash(wire.ship_from_details.address)};
      return retainedQuoteOperation({store,binding:gate.binding,kind:'TAX_CALCULATION',request,wire,current,execute:async operation=>{
        const value=await http.request('POST','/v1/tax/calculations',{body:formBody(wire),signal,idempotencyKey:`atlas-marketplace-quote:${operation.id}`});
        const evidence=validateCalculation(value,expected);await readQuoteAddress(resolveDestination,input,current);
        const receipt={requestHash:hash(request),quoteRef:value.id,amountCents:evidence.taxCents,currency:'USD',policyRef:p.policyRef,issuedAt:new Date(issuedAt).toISOString(),expiresAt:new Date(Math.min(issuedAt+p.maxQuoteAgeMs,exactTime(p.expiresAt),exactTime(request.destination.expiresAt),evidence.providerExpiresAt)).toISOString(),basisCents:request.basisCents};
        requireValue(exactTime(receipt.expiresAt)>current(),'TAX_QUOTE_EXPIRED');return {receipt,evidence};
      }});
    },close(){gate.close();http.close();},
  };
  const frozen=Object.freeze(adapter);brands.set(frozen,{store,current:historical,binding:gate.binding,accountId:p.accountId,environment:p.environment,findCalculation,verifyCalculation,createTransaction,retrieveTransaction});return frozen;
}
