import { financeAssert as check, integerCents as cents, safeSum, identifier, digest, copy, postJournal, posting, recordProviderTransaction } from './ledger.mjs';

export function validateInstantPayoutPolicy(policy) {
  check(policy?.enabled === true && ['synthetic','stripe-sandbox','stripe-production'].includes(policy.environment), 'INSTANT_PAYOUT_DISABLED');
  for (const key of ['version','platformAccountId','applicationId','approvalRef','eligibilityRef','pricingRef','providerCostRef','bankOwnershipRef','feeQualificationRef']) identifier(policy[key]);
  check(policy.feeStrategy === 'STRIPE_APPLICATION_FEE' && policy.providerFeePayer === 'PLATFORM' && typeof policy.allowPlatformSubsidy === 'boolean' && policy.failureFeeTreatment === 'RETAIN_OBSERVED', 'INSTANT_PAYOUT_POLICY_REQUIRED');
  cents(policy.minCents,{positive:true}); cents(policy.maxCents,{positive:true}); check(policy.maxCents >= policy.minCents, 'INSTANT_PAYOUT_POLICY_REQUIRED');
  for (const key of ['maxEvidenceAgeMs','quoteTtlMs']) check(Number.isSafeInteger(policy[key]) && policy[key] > 0 && policy[key] <= 300000, 'INSTANT_PAYOUT_POLICY_REQUIRED');
  for (const key of ['timingDisclosure','feeDisclosure']) check(typeof policy[key] === 'string' && policy[key].trim().length > 0 && policy[key].length <= 2000, 'INSTANT_PAYOUT_DISCLOSURE_REQUIRED');
  return copy(policy);
}
export function validateInstantEligibility(now, policy, evidence, { connectedAccountId, externalAccountId, amountCents, sellerFeeCents = 0 }) {
  validateInstantPayoutPolicy(policy);
  check(evidence && Number.isSafeInteger(evidence.observedAt) && evidence.observedAt <= now && now-evidence.observedAt <= policy.maxEvidenceAgeMs, 'INSTANT_PAYOUT_EVIDENCE_STALE');
  check(evidence.provider === (policy.environment === 'synthetic' ? 'synthetic' : 'stripe') && evidence.platformAccountId === policy.platformAccountId && evidence.accountId === connectedAccountId && evidence.livemode === (policy.environment === 'stripe-production') && evidence.currency === 'USD' && evidence.externalAccountId === externalAccountId && evidence.type === 'bank_account' && evidence.instantSupported === true && evidence.fullServiceAgreement === true && evidence.requirementsSatisfied === true && evidence.manualPayouts === true, 'INSTANT_PAYOUT_INELIGIBLE');
  for (const key of ['availableCents','instantAvailableCents','instantNetAvailableCents']) cents(evidence[key]);
  check(amountCents >= policy.minCents && amountCents <= policy.maxCents && amountCents <= evidence.instantNetAvailableCents && safeSum(amountCents,sellerFeeCents) <= Math.min(evidence.availableCents,evidence.instantAvailableCents), 'INSTANT_PAYOUT_BALANCE_INSUFFICIENT');
  return true;
}
export function createInstantPayoutQuote(tx, input) {
  const { quoteId,sellerId,connectedAccountId,externalAccountId,amountCents,eligibilityEvidence,feeEvidence } = input;
  for (const value of [quoteId,sellerId,connectedAccountId,externalAccountId]) identifier(value); cents(amountCents,{positive:true});
  const policy=validateInstantPayoutPolicy(input.policy), policyHash=digest(policy), fee=feeEvidence;
  check(fee?.approved === true && fee.policyHash === policyHash && fee.sellerId === sellerId && fee.accountId === connectedAccountId && fee.externalAccountId === externalAccountId && fee.amountCents === amountCents && Number.isSafeInteger(fee.observedAt) && fee.observedAt <= tx.now && tx.now-fee.observedAt <= policy.maxEvidenceAgeMs, 'INSTANT_PAYOUT_FEE_APPROVAL_REQUIRED');
  identifier(fee.evidenceRef); cents(fee.sellerFeeCents); cents(fee.providerFeeCents);
  check(policy.allowPlatformSubsidy || fee.sellerFeeCents >= fee.providerFeeCents, 'INSTANT_PAYOUT_SUBSIDY_UNAPPROVED');
  validateInstantEligibility(tx.now,policy,eligibilityEvidence,{connectedAccountId,externalAccountId,amountCents,sellerFeeCents:fee.sellerFeeCents});
  const requestHash=digest(input), quotes=tx.state.financePayoutQuotes ??= {}, old=quotes[quoteId];
  if(old){check(old.requestHash===requestHash,'INSTANT_PAYOUT_QUOTE_CONFLICT');return copy(old);}
  const quote={quoteId,method:'instant',sellerId,connectedAccountId,externalAccountId,currency:'USD',amountCents,sellerFeeCents:fee.sellerFeeCents,providerFeeCents:fee.providerFeeCents,totalDebitCents:safeSum(amountCents,fee.sellerFeeCents),policyHash,createdAt:tx.now,expiresAt:new Date(tx.now+policy.quoteTtlMs).toISOString(),timingDisclosure:policy.timingDisclosure,feeDisclosure:policy.feeDisclosure,feeEvidenceHash:digest(fee),eligibilityEvidenceHash:digest(eligibilityEvidence),requestHash,consumedBy:null};
  quote.quoteHash=digest(quote);quotes[quoteId]=quote;return copy(quote);
}
export function validateInstantPayoutQuote(tx,{quoteId,sellerId,connectedAccountId,externalAccountId,amountCents,policy,eligibilityEvidence,intentId=null}) {
  const quote=tx.state.financePayoutQuotes?.[identifier(quoteId)];validateInstantPayoutPolicy(policy);
  check(quote && quote.policyHash===digest(policy) && quote.sellerId===sellerId && quote.connectedAccountId===connectedAccountId && quote.externalAccountId===externalAccountId && quote.amountCents===amountCents && Date.parse(quote.expiresAt)>tx.now && (!quote.consumedBy || quote.consumedBy===intentId),'INSTANT_PAYOUT_QUOTE_INVALID');
  const {quoteHash, ...original}=quote;original.consumedBy=null;check(quoteHash===digest(original),'INSTANT_PAYOUT_QUOTE_INVALID');
  validateInstantEligibility(tx.now,policy,eligibilityEvidence,{connectedAccountId,externalAccountId,amountCents,sellerFeeCents:quote.sellerFeeCents});return copy(quote);
}

// Stripe bills the platform separately. Accrual never invents cash movement.
// A qualified operator may join a later, exact retrieved bill transaction to
// accrued original payouts. This reducer creates no provider action.
export function settleInstantProviderFees(tx,{settlementId,platformAccountId,intentIds,evidence,approval}) {
  identifier(settlementId);identifier(platformAccountId);
  check(Array.isArray(intentIds)&&intentIds.length>0&&intentIds.length<=100&&new Set(intentIds).size===intentIds.length,'INSTANT_PROVIDER_FEE_SETTLEMENT_REQUIRED');
  const intents=intentIds.map(id=>tx.state.intents?.[id]);
  check(intents.every(i=>i?.kind==='PAYOUT'&&i.method==='instant'&&i.cashDebited&&i.platformAccountId===platformAccountId),'INSTANT_PROVIDER_FEE_SETTLEMENT_REQUIRED');
  const amount=safeSum(...intents.map(i=>i.instantQuote.providerFeeCents));cents(amount,{positive:true});
  const keyHash=digest({platformAccountId,intentIds,evidence,approval}), prior=tx.state.financeInstantFeeSettlements?.[settlementId];
  if(prior){check(prior.requestHash===keyHash,'INSTANT_PROVIDER_FEE_SETTLEMENT_CONFLICT');return copy(prior);}
  check(!intents.some(i=>i.providerFeeSettlementId),'INSTANT_PROVIDER_FEE_ALREADY_SETTLED');
  check(approval?.approved===true&&approval.platformAccountId===platformAccountId&&approval.evidenceHash===digest(evidence)&&approval.amountCents===amount,'INSTANT_PROVIDER_FEE_APPROVAL_REQUIRED');identifier(approval.evidenceRef);
  const live=intents[0].policy.environment==='stripe-production',bt=evidence?.transaction;
  check(intents.every(i=>(i.policy.environment==='stripe-production')===live)&&evidence?.provider===(intents[0].policy.environment==='synthetic'?'synthetic':'stripe')&&evidence.accountId===platformAccountId&&evidence.livemode===live&&evidence.currency==='USD'&&Number.isSafeInteger(evidence.observedAt)&&evidence.observedAt<=tx.now&&tx.now-evidence.observedAt<=intents[0].policy.maxEvidenceAgeMs&&bt?.type==='stripe_fee'&&bt.currency==='USD'&&bt.amountCents===-amount&&bt.feeCents===0&&bt.netCents===-amount&&bt.status==='available'&&bt.availableOn<=tx.now,'INSTANT_PROVIDER_FEE_EVIDENCE_MISMATCH');
  recordProviderTransaction(tx,{accountId:platformAccountId,transaction:bt,owner:settlementId,observedAt:evidence.observedAt,livemode:live});
  postJournal(tx,{id:`instant-fee:${settlementId}`,kind:'INSTANT_PROVIDER_FEE_SETTLED',intentId:settlementId,evidenceHash:digest(evidence),lines:[posting(`platform:${platformAccountId}`,'instant_provider_fee_payable',amount),posting(`platform:${platformAccountId}`,'provider_cash',-amount)]});
  for(const intent of intents)intent.providerFeeSettlementId=settlementId;
  const result={settlementId,requestHash:keyHash,amountCents:amount,transactionId:bt.id};(tx.state.financeInstantFeeSettlements??={})[settlementId]=result;return copy(result);
}
