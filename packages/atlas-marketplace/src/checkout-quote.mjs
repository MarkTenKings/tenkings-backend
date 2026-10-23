import { cents, clone, hash, requireValue, sumCents } from './contract.mjs';
import { authorityContext, authorityId, domainId } from './authority-context.mjs';
import { assertListingBinding } from './listing.mjs';
import { exactKeys, exactTime, requireSyncApproval } from './fee-policy.mjs';

export const CHECKOUT_POLICY_SCHEMA='atlas-checkout-policy-v1';
export const CHECKOUT_QUOTE_SCHEMA='atlas-checkout-quote-v1';
const text=value=>typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=1000;
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function policyCheck(policy,context) {
  exactKeys(policy,['schema','id','version','environment','currency','approvalRef','effectiveAt','expiresAt','maxQuoteAgeMs','shippingPolicyRef','taxPolicyRef','taxResponsibleEntityRef','taxBasis','allowedCountries'],'CHECKOUT_POLICY_INVALID');
  requireValue(policy.schema===CHECKOUT_POLICY_SCHEMA&&policy.environment===context.environment&&policy.currency==='USD','CHECKOUT_POLICY_INVALID');
  domainId(policy.id,'checkout policy',context);
  for(const key of ['version','approvalRef','shippingPolicyRef','taxPolicyRef','taxResponsibleEntityRef'])requireValue(text(policy[key]),'CHECKOUT_POLICY_INVALID');
  requireValue(exactTime(policy.expiresAt)>exactTime(policy.effectiveAt)&&Number.isSafeInteger(policy.maxQuoteAgeMs)&&policy.maxQuoteAgeMs>0&&policy.maxQuoteAgeMs<=900000,'CHECKOUT_POLICY_INVALID');
  requireValue(['ITEM_ONLY','ITEM_AND_SHIPPING'].includes(policy.taxBasis),'TAX_BASIS_UNSUPPORTED');
  requireValue(Array.isArray(policy.allowedCountries)&&policy.allowedCountries.length>0&&policy.allowedCountries.length<=250&&new Set(policy.allowedCountries).size===policy.allowedCountries.length&&policy.allowedCountries.every(value=>/^[A-Z]{2}$/.test(value)),'CHECKOUT_POLICY_INVALID');
  return policy;
}
function quoteContent(quote) { const {receiptHash,...content}=quote; return content; }
export function assertCheckoutQuoteBinding(quote,{listing,buyerId,destinationId},now,context) {
  context=authorityContext(context); assertListingBinding(listing,context); authorityId(buyerId,'buyer',context);
  requireValue(quote?.schema===CHECKOUT_QUOTE_SCHEMA&&quote.environment===context.environment&&quote.receiptHash===hash(quoteContent(quote)),'CHECKOUT_QUOTE_INVALID');
  requireValue(quote.buyerId===buyerId&&quote.listingHash===listing.bindingHash&&quote.listingVersion===listing.version&&quote.listingId===listing.id&&quote.listingPolicyHash===hash(listing.policy)&&quote.policyId===listing.policy.id&&quote.policyVersion===listing.policy.version,'QUOTE_BINDING_MISMATCH');
  requireValue(quote.destination?.id===destinationId&&quote.destination.buyerId===buyerId&&digest(quote.destination.addressHash),'QUOTE_DESTINATION_MISMATCH');
  requireValue(quote.itemCents===listing.askingPriceCents&&quote.buyerFeeCents===0&&quote.totalCents===sumCents(quote.itemCents,quote.shippingCents,quote.taxCents)&&quote.protectionTerms===listing.policy.protectionTerms,'QUOTE_TOTAL_MISMATCH');
  requireValue(Number.isSafeInteger(now)&&exactTime(quote.issuedAt)<=now&&exactTime(quote.expiresAt)>now&&exactTime(quote.expiresAt)-exactTime(quote.issuedAt)<=900000,'QUOTE_EXPIRED');
  return quote;
}
// All adapters are explicit server composition. These ports never discover a
// credential, address, provider, destination or tax jurisdiction themselves.
export function createApprovedCheckoutQuoteProvider({enabled=false,context:suppliedContext,policy,approvalRef,assertReady,resolveDestination,shipping,tax,clock=Date.now,timeoutMs=20000,maxConcurrent=2}={}) {
  if(!enabled) {
    const unavailable=async()=>{requireValue(false,'CHECKOUT_QUOTE_UNAVAILABLE');};
    return Object.freeze(Object.assign(unavailable,{enabled:false,destinationRequired:true,listDestinations:async()=>[],assertCurrent(){requireValue(false,'CHECKOUT_QUOTE_UNAVAILABLE');},close(){}}));
  }
  const context=authorityContext(suppliedContext), savedPolicy=clone(policyCheck(policy,context)), policyHash=hash(savedPolicy);
  requireValue(text(approvalRef)&&typeof assertReady==='function'&&Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=20000&&Number.isSafeInteger(maxConcurrent)&&maxConcurrent>0&&maxConcurrent<=4,'CHECKOUT_APPROVAL_REQUIRED');
  requireValue(typeof resolveDestination?.resolve==='function'&&typeof resolveDestination.list==='function'&&typeof resolveDestination.assertCurrent==='function'&&typeof resolveDestination.assertReady==='function'&&typeof shipping?.quote==='function'&&typeof shipping.assertReady==='function'&&typeof tax?.quote==='function'&&typeof tax.assertReady==='function','QUOTE_ADAPTER_REQUIRED');
  const pins={resolve:resolveDestination.resolve,list:resolveDestination.list,destinationCurrent:resolveDestination.assertCurrent,destinationReady:resolveDestination.assertReady,shipping:shipping.quote,shippingReady:shipping.assertReady,tax:tax.quote,taxReady:tax.assertReady};
  const binding=Object.freeze({environment:context.environment,policyHash,approvalRef,timeoutMs,maxConcurrent});
  let closed=false,lastNow=0; const active=new Set();
  function current(now=clock()) {
    requireValue(!closed&&Number.isSafeInteger(now)&&now>=lastNow,'QUOTE_CLOCK_UNAVAILABLE'); lastNow=now;
    requireValue(hash(policy)===policyHash&&resolveDestination.resolve===pins.resolve&&resolveDestination.list===pins.list&&resolveDestination.assertCurrent===pins.destinationCurrent&&resolveDestination.assertReady===pins.destinationReady&&shipping.quote===pins.shipping&&shipping.assertReady===pins.shippingReady&&tax.quote===pins.tax&&tax.assertReady===pins.taxReady,'CHECKOUT_APPROVAL_REQUIRED');
    requireSyncApproval(assertReady(binding),'CHECKOUT_APPROVAL_REQUIRED');
    for (const port of [resolveDestination,shipping,tax]) requireSyncApproval(port.assertReady(binding),'QUOTE_ADAPTER_UNAVAILABLE');
    requireValue(exactTime(savedPolicy.effectiveAt)<=now&&exactTime(savedPolicy.expiresAt)>now,'CHECKOUT_POLICY_EXPIRED'); return now;
  }
  function destinationCheck(destination,buyerId,destinationId,now) {
    exactKeys(destination,['id','buyerId','version','addressHash','countryCode','label','evidenceRef','observedAt','expiresAt'],'QUOTE_DESTINATION_INVALID');
    domainId(destination.id,'destination',context);
    requireValue(destination.id===destinationId&&destination.buyerId===buyerId&&text(destination.version)&&digest(destination.addressHash)&&text(destination.label)&&text(destination.evidenceRef)&&savedPolicy.allowedCountries.includes(destination.countryCode),'QUOTE_DESTINATION_INVALID');
    requireValue(exactTime(destination.observedAt)<=now&&exactTime(destination.expiresAt)>now&&now-exactTime(destination.observedAt)<=savedPolicy.maxQuoteAgeMs,'QUOTE_DESTINATION_EXPIRED');
    requireSyncApproval(resolveDestination.assertCurrent(clone(destination),{buyerId,destinationId}),'QUOTE_DESTINATION_CHANGED');
    return destination;
  }
  function bounded(work) {
    current();requireValue(active.size<maxConcurrent,'QUOTE_CAPACITY_UNAVAILABLE');
    const controller=new AbortController();active.add(controller);
    let timer; const deadline=clock()+timeoutMs;
    const assertLive=()=>{current();requireValue(!controller.signal.aborted&&clock()<deadline,'QUOTE_IO_TIMEOUT');};
    const running=Promise.resolve().then(()=>work(controller.signal,assertLive));
    // Keep capacity until the underlying port really settles, even if it ignores abort.
    running.finally(()=>active.delete(controller)).catch(()=>{});
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();try{requireValue(false,'QUOTE_IO_TIMEOUT');}catch(error){reject(error);}},timeoutMs);});
    return Promise.race([running,timeout]).finally(()=>clearTimeout(timer));
  }
  function providerReceipt(value,request,kind,now) {
    requireValue(JSON.stringify(value??null).length<=8192,'QUOTE_RESPONSE_TOO_LARGE');
    exactKeys(value,['requestHash','quoteRef','amountCents','currency','policyRef','issuedAt','expiresAt',...(kind==='shipping'?['deliveryEstimate']:['basisCents'])],'QUOTE_PROVIDER_RECEIPT_INVALID');
    requireValue(value.requestHash===hash(request)&&value.currency==='USD'&&value.policyRef===request.policyRef&&text(value.quoteRef),'QUOTE_PROVIDER_BINDING_MISMATCH');
    cents(value.amountCents);
    requireValue(exactTime(value.issuedAt)<=now&&exactTime(value.expiresAt)>now&&now-exactTime(value.issuedAt)<=savedPolicy.maxQuoteAgeMs,'QUOTE_PROVIDER_EXPIRED');
    if(kind==='shipping')requireValue(text(value.deliveryEstimate),'QUOTE_PROVIDER_RECEIPT_INVALID');
    else requireValue(value.basisCents===request.basisCents,'QUOTE_TAX_BASIS_MISMATCH');
    return clone(value);
  }
  const quote=async({listing,buyerId,destinationId})=>bounded(async(signal,assertLive)=>{
    const started=current(); assertListingBinding(listing,context);authorityId(buyerId,'buyer',context);domainId(destinationId,'destination',context);
    requireValue(listing.status==='ACTIVE'&&buyerId!==listing.sellerId,'CARD_UNAVAILABLE');
    const savedListing=clone(listing);
    const destination=clone(await resolveDestination.resolve({buyerId,destinationId,signal}));assertLive();destinationCheck(destination,buyerId,destinationId,current());
    const base={environment:context.environment,listingId:listing.id,listingVersion:listing.version,listingHash:listing.bindingHash,buyerId,destination:clone(destination),currency:'USD',itemCents:listing.askingPriceCents};
    const shippingRequest={...base,policyRef:savedPolicy.shippingPolicyRef};
    const shippingReceipt=providerReceipt(await shipping.quote({...clone(shippingRequest),signal}),shippingRequest,'shipping',current());assertLive();
    const basisCents=savedPolicy.taxBasis==='ITEM_ONLY'?listing.askingPriceCents:sumCents(listing.askingPriceCents,shippingReceipt.amountCents);
    const taxRequest={...base,shippingCents:shippingReceipt.amountCents,shippingQuoteRef:shippingReceipt.quoteRef,basisCents,taxBasis:savedPolicy.taxBasis,responsibleEntityRef:savedPolicy.taxResponsibleEntityRef,policyRef:savedPolicy.taxPolicyRef};
    const taxReceipt=providerReceipt(await tax.quote({...clone(taxRequest),signal}),taxRequest,'tax',current());assertLive();
    destinationCheck(destination,buyerId,destinationId,current());
    requireValue(hash(listing)===hash(savedListing),'QUOTE_BINDING_MISMATCH');
    const expiresAt=new Date(Math.min(started+savedPolicy.maxQuoteAgeMs,exactTime(savedPolicy.expiresAt),exactTime(destination.expiresAt),exactTime(shippingReceipt.expiresAt),exactTime(taxReceipt.expiresAt))).toISOString();
    const content={schema:CHECKOUT_QUOTE_SCHEMA,environment:context.environment,currency:'USD',buyerId,listingId:listing.id,listingVersion:listing.version,listingHash:listing.bindingHash,listingPolicyHash:hash(listing.policy),policyId:listing.policy.id,policyVersion:listing.policy.version,checkoutPolicyHash:policyHash,checkoutPolicyId:savedPolicy.id,checkoutPolicyVersion:savedPolicy.version,destination,itemCents:listing.askingPriceCents,shippingCents:shippingReceipt.amountCents,taxCents:taxReceipt.amountCents,buyerFeeCents:0,totalCents:sumCents(listing.askingPriceCents,shippingReceipt.amountCents,taxReceipt.amountCents),shippingQuoteRef:shippingReceipt.quoteRef,taxQuoteRef:taxReceipt.quoteRef,deliveryEstimate:shippingReceipt.deliveryEstimate,protectionTerms:listing.policy.protectionTerms,shippingReceipt,taxReceipt,issuedAt:new Date(started).toISOString(),expiresAt};
    const result={quoteId:`${context.environment==='SYNTHETIC_LOCAL'?'demo_':'atlas_'}quote_${hash(content).slice(0,32)}`,...content};result.receiptHash=hash(result);
    quote.assertCurrent(result,{listing,buyerId,destinationId},current());return result;
  });
  Object.assign(quote,{enabled:true,destinationRequired:true,binding,
    listDestinations({buyerId}) { authorityId(buyerId,'buyer',context);return bounded(async(signal,assertLive)=>{
      const list=await resolveDestination.list({buyerId,signal});assertLive();requireValue(Array.isArray(list)&&list.length<=25,'QUOTE_DESTINATION_INVALID');
      const seen=new Set();return list.map(row=>{destinationCheck(row,buyerId,row.id,current());requireValue(!seen.has(row.id),'QUOTE_DESTINATION_INVALID');seen.add(row.id);return {id:row.id,label:row.label,version:row.version};});
    }); },
    assertCurrent(receipt,{listing,buyerId,destinationId=receipt?.destination?.id},now=clock()) {
      current(now);requireValue(receipt?.checkoutPolicyHash===policyHash,'CHECKOUT_POLICY_MISMATCH');
      assertCheckoutQuoteBinding(receipt,{listing,buyerId,destinationId},now,context);
      destinationCheck(receipt.destination,buyerId,destinationId,now); return receipt;
    },
    close(){closed=true;for(const controller of active)controller.abort();},
  });
  return Object.freeze(quote);
}
