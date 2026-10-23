import { cents, clone, hash, requireValue } from './contract.mjs';
import { authorityContext, authorityId, domainId } from './authority-context.mjs';

export const FEE_SCHEDULE_SCHEMA = 'atlas-fee-schedule-v1';
export const FEE_QUOTE_SCHEMA = 'atlas-seller-fee-quote-v1';
const MAX_AGE = 900000;
const text = value => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 1000;
export function requireSyncApproval(value, code) {
  // A Promise is never an approval. Observe an accidental rejection so the
  // failed synchronous gate cannot also become an unhandled process rejection.
  if (value !== true && value && (typeof value === 'object' || typeof value === 'function')) Promise.resolve(value).catch(()=>{});
  requireValue(value === true, code);
}
export function exactKeys(value, keys, code) {
  requireValue(value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value,key)), code);
}
export function exactTime(value) {
  const parsed = Date.parse(value);
  requireValue(typeof value === 'string' && Number.isSafeInteger(parsed) && parsed >= 0 && new Date(parsed).toISOString() === value, 'POLICY_TIME_INVALID');
  return parsed;
}
export function assertFeeSchedule(schedule, context) {
  context = authorityContext(context);
  exactKeys(schedule,['schema','id','version','environment','currency','approvalRef','effectiveAt','expiresAt','basis','tierMode','rounding','tiers','minimumCents','maximumCents','processing','disclosure'],'FEE_POLICY_INVALID');
  requireValue(schedule.schema === FEE_SCHEDULE_SCHEMA && schedule.environment === context.environment && schedule.currency === 'USD', 'FEE_POLICY_INVALID');
  domainId(schedule.id,'fee schedule',context);
  requireValue(text(schedule.version) && text(schedule.approvalRef) && text(schedule.disclosure), 'FEE_POLICY_INVALID');
  requireValue(exactTime(schedule.expiresAt) > exactTime(schedule.effectiveAt), 'FEE_POLICY_INVALID');
  requireValue(schedule.basis === 'ITEM_PRICE' && schedule.tierMode === 'VOLUME' && ['DOWN','UP','HALF_UP'].includes(schedule.rounding) && schedule.processing === 'INCLUDED', 'FEE_POLICY_UNSUPPORTED', 'This fee contract includes processing; an additional seller processing charge requires a separately approved complete allocation contract.');
  requireValue(Array.isArray(schedule.tiers) && schedule.tiers.length > 0 && schedule.tiers.length <= 20, 'FEE_POLICY_INVALID');
  let previous = 0;
  schedule.tiers.forEach((tier,index) => {
    exactKeys(tier,['upToCents','rateBps','fixedCents'],'FEE_POLICY_INVALID');
    requireValue(Number.isSafeInteger(tier.rateBps) && tier.rateBps >= 0 && tier.rateBps <= 10000, 'FEE_POLICY_INVALID');
    cents(tier.fixedCents);
    if(index === schedule.tiers.length - 1) requireValue(tier.upToCents === null, 'FEE_POLICY_INVALID');
    else { cents(tier.upToCents,{positive:true}); requireValue(tier.upToCents > previous, 'FEE_POLICY_INVALID'); previous=tier.upToCents; }
  });
  if(schedule.minimumCents !== null) cents(schedule.minimumCents);
  if(schedule.maximumCents !== null) cents(schedule.maximumCents);
  requireValue(schedule.minimumCents === null || schedule.maximumCents === null || schedule.minimumCents <= schedule.maximumCents, 'FEE_POLICY_INVALID');
  return schedule;
}
// Volume tiers apply the selected rate to the entire item price. No graduated
// tiers, shipping/tax fee base, provider surcharge or rounding default is inferred.
export function calculateSellerFee(schedule, askingPriceCents, context) {
  assertFeeSchedule(schedule,context); cents(askingPriceCents,{positive:true});
  const tierIndex=schedule.tiers.findIndex(tier => tier.upToCents === null || askingPriceCents <= tier.upToCents), tier=schedule.tiers[tierIndex];
  const numerator=BigInt(askingPriceCents)*BigInt(tier.rateBps), denominator=10000n;
  let fee=numerator/denominator, remainder=numerator%denominator;
  if(schedule.rounding==='UP' && remainder>0n || schedule.rounding==='HALF_UP' && remainder*2n>=denominator) fee+=1n;
  fee+=BigInt(tier.fixedCents);
  if(schedule.minimumCents!==null && fee<BigInt(schedule.minimumCents)) fee=BigInt(schedule.minimumCents);
  if(schedule.maximumCents!==null && fee>BigInt(schedule.maximumCents)) fee=BigInt(schedule.maximumCents);
  requireValue(fee<=BigInt(Number.MAX_SAFE_INTEGER),'CENTS_OVERFLOW');
  requireValue(fee<BigInt(askingPriceCents),'SELLER_NET_INVALID');
  return {feeCents:Number(fee),sellerNetCents:askingPriceCents-Number(fee),tierIndex};
}
function inputBinding(input,context) {
  const {policy,cardId,sellerId,askingPriceCents,listingId=null,listingVersion=0,listingHash=null}=input;
  authorityId(sellerId,'seller',context); domainId(cardId,'card',context); cents(askingPriceCents,{positive:true});
  requireValue(policy?.environment===context.environment && policy.feeSchedule, 'FEE_POLICY_REQUIRED');
  domainId(policy.id,'listing policy',context);
  requireValue(text(policy.version) && text(policy.approvalRef),'FEE_POLICY_REQUIRED');
  if(listingId===null) requireValue(listingVersion===0 && listingHash===null,'FEE_QUOTE_BINDING_INVALID');
  else { domainId(listingId,'listing',context); requireValue(Number.isSafeInteger(listingVersion)&&listingVersion>0&&/^[a-f0-9]{64}$/.test(listingHash),'FEE_QUOTE_BINDING_INVALID'); }
  return {policyHash:hash(policy),cardId,sellerId,askingPriceCents,listingId,listingVersion,listingHash};
}
export function assertSellerFeeQuote(receipt,input,now,context) {
  context=authorityContext(context);
  const binding=inputBinding(input,context), schedule=assertFeeSchedule(input.policy.feeSchedule,context);
  requireValue(receipt?.schema===FEE_QUOTE_SCHEMA && receipt.environment===context.environment && receipt.currency==='USD', 'FEE_QUOTE_REQUIRED');
  const {receiptHash,...content}=receipt;
  requireValue(receiptHash===hash(content),'FEE_QUOTE_BINDING_INVALID');
  requireValue(Object.entries(binding).every(([key,value])=>receipt[key]===value) && receipt.scheduleHash===hash(schedule) && receipt.scheduleId===schedule.id && receipt.scheduleVersion===schedule.version, 'FEE_QUOTE_BINDING_INVALID');
  const result=calculateSellerFee(schedule,input.askingPriceCents,context);
  requireValue(Object.entries(result).every(([key,value])=>receipt[key]===value) && receipt.feeDisclosure===schedule.disclosure && receipt.processing===schedule.processing, 'FEE_QUOTE_BINDING_INVALID');
  requireValue(Number.isSafeInteger(now) && exactTime(receipt.issuedAt)<=now && exactTime(receipt.expiresAt)>now && exactTime(receipt.expiresAt)-exactTime(receipt.issuedAt)<=MAX_AGE && exactTime(schedule.effectiveAt)<=now && exactTime(schedule.expiresAt)>now,'FEE_QUOTE_EXPIRED');
  domainId(receipt.id,'fee quote',context);
  return receipt;
}
export function createApprovedFeeCalculator({enabled=false,context:suppliedContext,schedule,approvalRef,assertReady,clock=Date.now,maxQuoteAgeMs=300000}={}) {
  if(!enabled) return Object.freeze({enabled:false,preview(){requireValue(false,'FEE_CALCULATOR_UNAVAILABLE');},assertCurrent(){requireValue(false,'FEE_CALCULATOR_UNAVAILABLE');}});
  const context=authorityContext(suppliedContext), policy=clone(assertFeeSchedule(schedule,context)), scheduleHash=hash(policy);
  requireValue(text(approvalRef)&&typeof assertReady==='function'&&Number.isSafeInteger(maxQuoteAgeMs)&&maxQuoteAgeMs>0&&maxQuoteAgeMs<=MAX_AGE,'FEE_APPROVAL_REQUIRED');
  const binding=Object.freeze({environment:context.environment,scheduleHash,approvalRef,maxQuoteAgeMs}); let lastNow=0;
  function current(now=clock()) {
    requireValue(Number.isSafeInteger(now)&&now>=lastNow,'FEE_CLOCK_INVALID'); lastNow=now;
    requireValue(hash(schedule)===scheduleHash,'FEE_APPROVAL_REQUIRED');requireSyncApproval(assertReady(binding),'FEE_APPROVAL_REQUIRED');
    requireValue(exactTime(policy.effectiveAt)<=now&&exactTime(policy.expiresAt)>now,'FEE_POLICY_EXPIRED'); return now;
  }
  return Object.freeze({enabled:true,binding,
    preview(input) {
      const now=current(), value=inputBinding(input,context);
      requireValue(hash(input.policy.feeSchedule)===scheduleHash,'FEE_POLICY_MISMATCH');
      const content={schema:FEE_QUOTE_SCHEMA,environment:context.environment,currency:'USD',...value,scheduleId:policy.id,scheduleVersion:policy.version,scheduleHash,...calculateSellerFee(policy,input.askingPriceCents,context),feeDisclosure:policy.disclosure,processing:policy.processing,issuedAt:new Date(now).toISOString(),expiresAt:new Date(Math.min(now+maxQuoteAgeMs,exactTime(policy.expiresAt))).toISOString()};
      const receipt={id:`${context.environment==='SYNTHETIC_LOCAL'?'demo_':'atlas_'}fee_${hash(content).slice(0,32)}`,...content}; receipt.receiptHash=hash(receipt); return receipt;
    },
    assertCurrent(receipt,input,now=clock()) { current(now); requireValue(receipt.scheduleHash===scheduleHash,'FEE_POLICY_MISMATCH'); return assertSellerFeeQuote(receipt,input,now,context); },
  });
}
