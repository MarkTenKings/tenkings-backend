import {clone,hash,requireValue,fail} from './contract.mjs';
import {exactKeys,exactTime,requireSyncApproval} from './fee-policy.mjs';

export const quoteText=(value,max=500)=>typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=max&&!/[\x00-\x1f\x7f]/.test(value);
export function validateQuoteAddress(address) {
  exactKeys(address,['name','phone','line1','line2','city','state','postalCode','country','residential'],'QUOTE_ADDRESS_INVALID');
  requireValue(['name','phone','city'].every(key=>quoteText(address[key],100))&&quoteText(address.line1,200)&&(address.line2===null||quoteText(address.line2,200))&&/^[A-Z]{2}$/.test(address.state)&&/^\d{5}(?:-\d{4})?$/.test(address.postalCode)&&address.country==='US'&&['yes','no','unknown'].includes(address.residential),'QUOTE_ADDRESS_INVALID');
  return clone(address);
}
export function stripeAddress(address) {return {line1:address.line1,...(address.line2?{line2:address.line2}:{}),city:address.city,state:address.state,postal_code:address.postalCode,country:address.country};}
export function formBody(value,prefix,out=new URLSearchParams()) {
  if(Array.isArray(value))value.forEach((item,i)=>formBody(item,`${prefix}[${i}]`,out));
  else if(value&&typeof value==='object')Object.entries(value).forEach(([key,item])=>formBody(item,prefix?`${prefix}[${key}]`:key,out));
  else if(value!==null&&value!==undefined)out.append(prefix,String(value));
  return out.toString();
}
export function createProviderQuoteGate({provider,config,assertReady,clock=Date.now}) {
  requireValue(config&&['PROVIDER_SANDBOX','PRODUCTION'].includes(config.environment)&&quoteText(config.approvalRef)&&quoteText(config.policyRef)&&/^[a-f0-9]{64}$/.test(config.checkoutPolicyHash)&&typeof assertReady==='function','QUOTE_PROVIDER_CONFIG_REQUIRED');
  requireValue(Number.isSafeInteger(config.maxQuoteAgeMs)&&config.maxQuoteAgeMs>0&&config.maxQuoteAgeMs<=900000&&exactTime(config.expiresAt)>exactTime(config.effectiveAt),'QUOTE_PROVIDER_CONFIG_REQUIRED');
  const saved=clone(config),configHash=hash(config),binding=Object.freeze({provider,environment:config.environment,configHash,approvalRef:config.approvalRef,policyRef:config.policyRef,checkoutPolicyHash:config.checkoutPolicyHash});
  let lastNow=0,closed=false;
  const current=(parent,{historical=false}={})=>{
    const now=clock();requireValue(!closed&&Number.isSafeInteger(now)&&now>=lastNow,'QUOTE_PROVIDER_CLOCK_INVALID');lastNow=now;
    requireValue(hash(config)===configHash,'QUOTE_PROVIDER_CONFIG_CHANGED');
    requireSyncApproval(assertReady(binding),'QUOTE_PROVIDER_APPROVAL_REQUIRED');
    requireValue(now>=exactTime(saved.effectiveAt)&&(historical||now<exactTime(saved.expiresAt)),'QUOTE_PROVIDER_POLICY_EXPIRED');
    if(parent)requireValue(parent.environment===binding.environment&&parent.policyHash===binding.checkoutPolicyHash,'QUOTE_PROVIDER_BINDING_MISMATCH');
    return now;
  };
  return {saved,binding,current,historical(){return current(undefined,{historical:true});},close(){closed=true;}};
}
// Fixed origin and operation allowlist are supplied only by a provider module.
// Capacity follows the underlying request through abort-ignoring transports.
export function createQuoteHttp({origin,headers,allow,fetchImpl=fetch,timeoutMs=15000,maxBytes=262144,maxConcurrent=2,current}) {
  requireValue(typeof fetchImpl==='function'&&typeof current==='function'&&Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=20000&&Number.isSafeInteger(maxBytes)&&maxBytes>0&&maxBytes<=1048576,'QUOTE_TRANSPORT_INVALID');
  const active=new Set();let closed=false;
  return {async request(method,path,{body,signal,idempotencyKey}={}) {
    current();requireValue(!closed&&active.size<maxConcurrent&&!signal?.aborted,'QUOTE_TRANSPORT_UNAVAILABLE');
    requireValue(allow(method,path)===true,'QUOTE_PROVIDER_PATH_REFUSED');
    const controller=new AbortController();active.add(controller);let timer;
    const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
    const running=Promise.resolve().then(async()=>{
      current();requireValue(!controller.signal.aborted,'QUOTE_TRANSPORT_UNAVAILABLE');
      const response=await fetchImpl(origin+path,{method,redirect:'error',signal:controller.signal,headers:{...headers,...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{})},...(body===undefined?{}:{body})});
      requireValue(response.ok&&response.status>=200&&response.status<300,'QUOTE_PROVIDER_HTTP_FAILED');
      const length=response.headers?.get('content-length');if(length!==null&&length!==undefined)requireValue(/^\d+$/.test(length)&&Number(length)<=maxBytes,'QUOTE_PROVIDER_RESPONSE_TOO_LARGE');
      requireValue(response.body&&typeof response.body.getReader==='function','QUOTE_PROVIDER_BODY_UNAVAILABLE');
      const reader=response.body.getReader(),chunks=[];let size=0;
      try {for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;requireValue(size<=maxBytes,'QUOTE_PROVIDER_RESPONSE_TOO_LARGE');chunks.push(Buffer.from(value));}}
      finally {if(size>maxBytes)void reader.cancel().catch(()=>{});reader.releaseLock();}
      current();requireValue(!controller.signal.aborted,'QUOTE_PROVIDER_IO_TIMEOUT');
      try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('QUOTE_PROVIDER_JSON_INVALID');}
    });
    running.finally(()=>{active.delete(controller);signal?.removeEventListener('abort',abort);}).catch(()=>{});
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();try{fail('QUOTE_PROVIDER_IO_TIMEOUT');}catch(error){reject(error);}},timeoutMs);});
    const aborted=new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>{try{fail('QUOTE_PROVIDER_IO_TIMEOUT');}catch(error){reject(error);}},{once:true}));
    try{return await Promise.race([running,timeout,aborted]);}catch(error){if(error?.name==='MarketplaceError')throw error;fail('QUOTE_PROVIDER_IO_UNKNOWN');}finally{clearTimeout(timer);}
  },close(){closed=true;for(const controller of active)controller.abort();}};
}
export async function readQuoteAddress(resolveDestination,input,current) {
  requireValue(typeof resolveDestination?.readAddress==='function'&&typeof resolveDestination.assertCurrent==='function','QUOTE_ADDRESS_SOURCE_REQUIRED');
  current();requireSyncApproval(resolveDestination.assertCurrent(input.destination,{buyerId:input.buyerId,destinationId:input.destination?.id}),'QUOTE_DESTINATION_CHANGED');
  const address=validateQuoteAddress(await resolveDestination.readAddress({buyerId:input.buyerId,destinationId:input.destination.id,version:input.destination.version,addressHash:input.destination.addressHash,signal:input.signal}));
  current();requireValue(hash(address)===input.destination.addressHash,'QUOTE_ADDRESS_BINDING_MISMATCH');
  requireSyncApproval(resolveDestination.assertCurrent(input.destination,{buyerId:input.buyerId,destinationId:input.destination.id}),'QUOTE_DESTINATION_CHANGED');return address;
}
// Once claimed, no automatic POST replay, including after process death. A
// provider id recovered by an operator is retrieved and verified separately.
export async function retainedQuoteOperation({store,binding,kind,request,wire,current,execute}) {
  const id=`atlas_qop_${hash({binding,kind,request}).slice(0,40)}`,requestHash=hash(request),wireHash=hash(wire);
  const claimed=await store.transaction(tx=>{
    current();const operations=tx.state.quoteProviderOperations??={};const previous=operations[id];
    if(previous){requireValue(previous.bindingHash===hash(binding)&&previous.requestHash===requestHash&&previous.wireHash===wireHash,'QUOTE_OPERATION_CONFLICT');return {owned:false,operation:clone(previous)};}
    const operation={id,kind,bindingHash:hash(binding),requestHash,wireHash,request:clone(request),status:'DISPATCHING',dispatchCount:1,createdAt:tx.now,providerId:null};operations[id]=operation;return {owned:true,operation:clone(operation)};
  });
  if(!claimed.owned){requireValue(claimed.operation.status==='SUCCEEDED','QUOTE_PROVIDER_OUTCOME_UNKNOWN');requireValue(exactTime(claimed.operation.receipt.expiresAt)>current(),'QUOTE_PROVIDER_QUOTE_EXPIRED');return clone(claimed.operation.receipt);}
  try {
    const {receipt,evidence}=await execute(claimed.operation);current();
    return await store.transaction(tx=>{current();const operation=tx.state.quoteProviderOperations[id];requireValue(operation.status==='DISPATCHING'&&operation.wireHash===wireHash,'QUOTE_OPERATION_CONFLICT');Object.assign(operation,{status:'SUCCEEDED',providerId:receipt.quoteRef,receipt:clone(receipt),evidence:clone(evidence),completedAt:tx.now});return clone(receipt);});
  } catch(error) {
    await store.transaction(tx=>{const operation=tx.state.quoteProviderOperations[id];if(operation?.status==='DISPATCHING')Object.assign(operation,{status:'UNKNOWN',failureCode:'QUOTE_PROVIDER_RECONCILIATION_REQUIRED',failedAt:tx.now});});
    throw error;
  }
}
