import {clone,hash,requireValue} from './contract.mjs';
import {authorityContext,domainId} from './authority-context.mjs';
import {assertFeeSchedule,exactKeys,exactTime,FEE_SCHEDULE_SCHEMA} from './fee-policy.mjs';
import {assertListingPolicy} from './listing.mjs';
import {assertFulfillmentPolicy} from './fulfillment.mjs';

export const PILOT_COMMERCIAL_TERMS_SCHEMA='atlas-pilot-commercial-terms-v1';
export const PILOT_RETURN_WINDOW_MS=86400000;
const fields=['id','version','environment','approvalRef','effectiveAt','expiresAt','feeScheduleId','feeScheduleVersion','feeScheduleApprovalRef','termsRefs'];
const referenceFields=['feeTermsRef','returnsTermsRef','transferTermsRef','payoutTermsRef'];
const text=value=>typeof value==='string'&&value.length>0&&value.length<=1000&&value.trim()===value&&!/[\u0000-\u001f\u007f]/.test(value);
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const feeDisclosure='8% of the card price, including ordinary payment processing. No listing fee or buyer premium. The fee is rounded to the nearest cent, with half cents rounded up.';
const returnsDisclosure='A buyer must request a return within 24 hours after actual delivery, verified by delivery evidence. Returns are eligible only for severe damage or the wrong product (not the product sold), and the buyer must provide proof to ATLAS staff for review. The request deadline is exclusive. ATLAS initially pays return shipping; ATLAS staff determines final responsibility after review.';
const releaseDisclosure='Seller proceeds remain held until the 24-hour return-request window ends and staff review clears all open cases. Elapsed time alone does not release proceeds.';
const payoutDisclosure='No percentage fee for standard withdrawals. Account eligibility, available balance and the existing approved payout process remain required. This term does not approve instant payout pricing.';

// This constructs data only. Caller-supplied references are retained evidence
// identifiers, never a substitute for legal review or host readiness.
export function createPilotCommercialTerms(input,suppliedContext) {
  const context=authorityContext(suppliedContext);
  exactKeys(input,fields,'PILOT_TERMS_INPUT_REQUIRED');exactKeys(input.termsRefs,referenceFields,'PILOT_TERMS_REFERENCE_REQUIRED');
  requireValue(input.environment===context.environment,'PILOT_TERMS_ENVIRONMENT_MISMATCH');
  domainId(input.id,'commercial terms',context);domainId(input.feeScheduleId,'fee schedule',context);
  requireValue(['version','approvalRef','feeScheduleVersion','feeScheduleApprovalRef'].every(key=>text(input[key]))&&referenceFields.every(key=>text(input.termsRefs[key])),'PILOT_TERMS_REFERENCE_REQUIRED');
  requireValue(exactTime(input.expiresAt)>exactTime(input.effectiveAt),'PILOT_TERMS_TIME_INVALID');
  const feeSchedule={schema:FEE_SCHEDULE_SCHEMA,id:input.feeScheduleId,version:input.feeScheduleVersion,environment:input.environment,currency:'USD',approvalRef:input.feeScheduleApprovalRef,effectiveAt:input.effectiveAt,expiresAt:input.expiresAt,basis:'ITEM_PRICE',tierMode:'VOLUME',rounding:'HALF_UP',tiers:[{upToCents:null,rateBps:800,fixedCents:0}],minimumCents:null,maximumCents:null,processing:'INCLUDED',disclosure:feeDisclosure};
  assertFeeSchedule(feeSchedule,context);
  const content={schema:PILOT_COMMERCIAL_TERMS_SCHEMA,...clone(input),feeSchedule,
    fees:{listingFeeCents:0,buyerPremiumCents:0,standardWithdrawalRateBps:0},
    returns:{status:'OWNER_TERMS_SELECTED',returnWindowMs:PILOT_RETURN_WINDOW_MS,startsAt:'ACTUAL_DELIVERY',interval:'UTC_ELAPSED',deadlineExclusive:true,eligibleReasons:['SEVERE_DAMAGE','WRONG_PRODUCT'],requiresBuyerEvidence:true,requiresStaffReview:true,returnShippingPayer:'ATLAS_INITIALLY',finalResponsibility:'STAFF_REVIEW'},
    sellerRelease:{requiresWindowEnded:true,requiresStaffReview:true,requiresOpenCasesCleared:true},
    pendingDecisions:[]};
  return freeze({...content,termsHash:hash(content)});
}

export function applyPilotCommercialTerms({terms,listingPolicy,fulfillmentPolicy},suppliedContext) {
  const context=authorityContext(suppliedContext);
  const expected=createPilotCommercialTerms(Object.fromEntries(fields.map(key=>[key,terms?.[key]])),context);
  requireValue(hash(terms)===hash(expected),'PILOT_TERMS_CHANGED');
  assertListingPolicy(listingPolicy,context);assertFulfillmentPolicy(fulfillmentPolicy,context);
  requireValue(listingPolicy.id===fulfillmentPolicy.id&&listingPolicy.version===fulfillmentPolicy.version&&(!listingPolicy.fulfillmentPolicy||hash(listingPolicy.fulfillmentPolicy)===hash(fulfillmentPolicy)),'PILOT_POLICY_BINDING_MISMATCH');
  requireValue(fulfillmentPolicy.returnsTermsRef===terms.termsRefs.returnsTermsRef&&fulfillmentPolicy.transferTermsRef===terms.termsRefs.transferTermsRef,'PILOT_TERMS_REFERENCE_MISMATCH');
  const commercialTerms={schema:terms.schema,id:terms.id,version:terms.version,approvalRef:terms.approvalRef,termsHash:terms.termsHash,termsRefs:clone(terms.termsRefs),fees:clone(terms.fees),returns:clone(terms.returns),sellerRelease:clone(terms.sellerRelease),pendingDecisions:clone(terms.pendingDecisions)};
  const fulfillment={...clone(fulfillmentPolicy),returnWindowMs:PILOT_RETURN_WINDOW_MS,commercialTerms:clone(commercialTerms)};
  const listing=clone(listingPolicy);delete listing.feeCents;
  Object.assign(listing,{feeSchedule:clone(terms.feeSchedule),feeDisclosure,returnsTerms:returnsDisclosure,transferReleaseTerms:releaseDisclosure,payoutTerms:payoutDisclosure,commercialTerms:clone(commercialTerms),fulfillmentPolicy:fulfillment});
  assertListingPolicy(listing,context);assertFulfillmentPolicy(fulfillment,context);
  return freeze({listingPolicy:listing,fulfillmentPolicy:fulfillment,terms:clone(terms)});
}
