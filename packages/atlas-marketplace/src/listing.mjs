import { cents, clone, hash, requireValue } from './contract.mjs';
import { assertEligibility, eligibilityBinding, requiredText } from './eligibility.mjs';
import { authorityContext, contextFor, domainId, authorityId } from './authority-context.mjs';
import { assertFeeSchedule, assertSellerFeeQuote } from './fee-policy.mjs';

export function assertListingPolicy(policy, suppliedContext) {
  const context = authorityContext(suppliedContext);
  requireValue(policy?.environment === context.environment, 'POLICY_REQUIRED', 'An explicit synthetic policy is required; no commercial fee or protection terms are assumed.');
  domainId(policy.id, 'policy', context);
  requiredText(policy.version, 'Policy version');
  requiredText(policy.approvalRef, 'Policy approval reference');
  if (policy.feeSchedule) {
    assertFeeSchedule(policy.feeSchedule, context);
    requireValue(policy.feeDisclosure === policy.feeSchedule.disclosure, 'FEE_POLICY_MISMATCH');
    requireValue(!Object.hasOwn(policy, 'feeCents'), 'FEE_POLICY_AMBIGUOUS', 'A scheduled policy cannot also specify a fixed listing fee.');
  } else cents(policy.feeCents);
  requiredText(policy.feeDisclosure, 'Seller fee disclosure');
  requireValue(policy.fulfillmentRoute === 'ATLAS_HELD', 'FULFILLMENT_UNAVAILABLE', 'Only ATLAS-held fulfillment is in this pilot.');
  for (const field of ['protectionTerms', 'returnsTerms', 'transferReleaseTerms', 'payoutTerms']) requiredText(policy[field], field);
  requireValue(Number.isSafeInteger(policy.reservationTtlMs) && policy.reservationTtlMs > 0 && policy.reservationTtlMs <= 86400000, 'POLICY_REQUIRED', 'A positive bounded reservation lifetime is required.');
  return policy;
}

const IMMUTABLE_FIELDS = ['id', 'version', 'environment', 'cardId', 'sellerId', 'connectedAccountId', 'currency', 'askingPriceCents', 'feeCents', 'sellerNetCents', 'approvedCard', 'authority', 'policy', 'createdAt'];
export function listingBindingHash(listing) {
  return hash(Object.fromEntries([...IMMUTABLE_FIELDS, ...(listing.feeQuote ? ['feeQuote'] : [])].map((field) => [field, listing[field]])));
}

export function assertListingBinding(listing, suppliedContext) {
  const context = authorityContext(suppliedContext);
  requireValue(listing && listing.environment === context.environment && listing.bindingHash === listingBindingHash(listing), 'LISTING_BINDING_INVALID', 'The saved listing/report/media/terms binding changed.');
  return listing;
}

export function assertCurrentListingAuthority(listing, eligibility, now, context) {
  assertEligibility(eligibility, { cardId: listing.cardId, sellerId: listing.sellerId, now, context });
  requireValue(hash(eligibilityBinding(eligibility)) === hash(listing.authority), 'LISTING_AUTHORITY_CHANGED', 'Seller, title, consent, custody or approved evidence changed; this listing must be reviewed again.');
}

export function assertCurrentHoldConsent(tx, listing) {
  const consent = tx.state.consent[listing.cardId];
  requireValue(consent?.choice === 'HOLD_AND_LIST' && consent.sellerId === listing.sellerId && consent.evidenceRef === listing.authority.holdConsentRef, 'HOLD_CONSENT_REQUIRED', 'Current explicit Hold and list consent is required.');
}

export function isLocallyVoidedPayment(tx, intent) {
  return intent?.kind === 'PAYMENT' && intent.status === 'VOIDED' && intent.locallyVoided === true && intent.dispatchCount === 0 && intent.objectId === null && intent.confirmed === false && intent.terminalUnpaid === false
    && intent.dispatchedAt === undefined && intent.reconciledAt === undefined && Number.isSafeInteger(intent.voidedAt) && intent.voidedAt >= 0 && intent.voidedAt <= tx.now
    && !tx.state.journals.some(row => row.intentId === intent.id) && !tx.state.financeObservations?.[intent.id] && !Object.values(tx.state.financeObjects ?? {}).includes(intent.id) && tx.state.financeOrders?.[intent.orderId]?.confirmed !== true;
}

export function createListing(tx, input) {
  const context = contextFor(tx);
  domainId(input.requestId, 'request', context);
  domainId(input.listingId, 'listing', context);
  authorityId(input.sellerId, 'seller', context);
  const eligibility = input.eligibility;
  const policy = assertListingPolicy(input.policy, context);
  requireValue(eligibility, 'ELIGIBILITY_UNAVAILABLE', 'Seller/title/custody authority is required.');
  const requestHash = hash({ listingId: input.listingId, sellerId: input.sellerId, askingPriceCents: input.askingPriceCents, cardId: eligibility?.cardId, authority: eligibility ? eligibilityBinding(eligibility) : null, policy: input.policy, ...(input.feeQuote ? {feeQuoteHash:hash(input.feeQuote)} : {}) });
  const receiptKey = `listing:${input.requestId}`;
  const receipt = tx.state.receipts[receiptKey];
  if (receipt) {
    requireValue(receipt.requestHash === requestHash, 'IDEMPOTENCY_CONFLICT', 'This listing request already has different immutable inputs.');
    return clone(receipt.result);
  }
  const authority = assertEligibility(eligibility, { cardId: eligibility?.cardId, sellerId: input.sellerId, now: tx.now, context });
  requireValue(authority.consignment.policyId === policy.id, 'POLICY_MISMATCH', 'Consignment must bind the selected listing policy.');
  const consent = tx.state.consent[authority.cardId];
  requireValue(consent?.choice === 'HOLD_AND_LIST' && consent.sellerId === input.sellerId && consent.evidenceRef === authority.consignment.holdConsentRef, 'HOLD_CONSENT_REQUIRED', 'Record explicit Hold and list consent before listing this card.');
  const askingPriceCents = cents(input.askingPriceCents, { positive: true });
  const feeQuote = policy.feeSchedule ? assertSellerFeeQuote(input.feeQuote, {policy,cardId:authority.cardId,sellerId:input.sellerId,askingPriceCents}, tx.now, context) : null;
  const feeCents = feeQuote?.feeCents ?? policy.feeCents;
  requireValue(feeCents < askingPriceCents, 'SELLER_NET_INVALID', 'The quoted seller fee must leave a positive net.');
  requireValue(!tx.state.listings[input.listingId], 'LISTING_ID_CONFLICT', 'This listing identity is already used.');
  const conflicts = Object.values(tx.state.listings).some((listing) => listing.cardId === authority.cardId && ['ACTIVE', 'RESERVED', 'SOLD'].includes(listing.status));
  requireValue(!conflicts, 'CARD_UNAVAILABLE', 'The permanent card already has an active, reserved or sold listing.');
  const listing = {
    id: input.listingId, version: 1, environment: context.environment,
    cardId: authority.cardId, sellerId: input.sellerId, connectedAccountId: authority.seller.connectedAccountId,
    currency: 'USD', askingPriceCents, feeCents, sellerNetCents: askingPriceCents - feeCents,
    ...(feeQuote ? {feeQuote:clone(feeQuote)} : {}),
    approvedCard: clone(authority.approvedCard), authority: eligibilityBinding(authority), policy: clone(policy), createdAt: new Date(tx.now).toISOString(),
  };
  listing.bindingHash = listingBindingHash(listing);
  listing.status = 'ACTIVE';
  listing.activeReservationId = null;
  tx.state.listings[listing.id] = listing;
  tx.state.receipts[receiptKey] = { requestHash, result: clone(listing) };
  tx.emit('LISTING_CREATED', { listingId: listing.id, cardId: listing.cardId, policyVersion: policy.version, environment: context.environment });
  return clone(listing);
}

function changeListing(tx, input, operation, action) {
  const context = contextFor(tx);
  for (const key of ['requestId', 'listingId']) domainId(input[key], key, context);
  authorityId(input.sellerId, 'seller', context);
  const request = { listingId: input.listingId, sellerId: input.sellerId, expectedVersion: input.expectedVersion, expectedBindingHash: input.expectedBindingHash, ...(operation === 'revise' ? { askingPriceCents: input.askingPriceCents, ...(input.feeQuote ? {feeQuoteHash:hash(input.feeQuote)} : {}) } : {}) };
  const requestHash = hash(request), key = `listing-${operation}:${input.requestId}`, prior = tx.state.receipts[key];
  if (prior) {
    requireValue(prior.requestHash === requestHash, 'IDEMPOTENCY_CONFLICT');
    return clone(prior.result);
  }
  const listing = assertListingBinding(tx.state.listings[input.listingId], context);
  requireValue(listing.sellerId === input.sellerId, 'LISTING_UNAUTHORIZED');
  requireValue(listing.version === input.expectedVersion && listing.bindingHash === input.expectedBindingHash, 'LISTING_CHANGED', 'Review the latest listing before changing it.');
  requireValue(listing.status === 'ACTIVE' && listing.activeReservationId === null, 'LISTING_CHANGE_UNAVAILABLE', 'Only an available listing without an active checkout can change.');
  requireValue(!Object.values(tx.state.reservations).some(row => row.listingId === listing.id && row.status !== 'RELEASED'), 'LISTING_FINANCIAL_EXPOSURE');
  requireValue(!Object.values(tx.state.orders).some(row => row.listingId === listing.id), 'LISTING_FINANCIAL_EXPOSURE');
  const associated = Object.values(tx.state.intents).filter(row => row.listingId === listing.id || row.order?.listingId === listing.id);
  requireValue(associated.every(row => isLocallyVoidedPayment(tx,row) || row.kind === 'PAYMENT' && row.status === 'CANCELED' && row.terminalUnpaid === true && row.confirmed === false && typeof row.objectId === 'string' && row.objectId.length > 0 && Number.isSafeInteger(row.reconciledAt) && row.reconciledAt >= 0 && row.reconciledAt <= tx.now), 'LISTING_FINANCIAL_EXPOSURE', 'Unresolved or confirmed money prevents a listing change.');
  const result = action(listing);
  tx.state.receipts[key] = { requestHash, result: clone(result) };
  tx.emit(operation === 'revise' ? 'LISTING_REVISED' : 'LISTING_WITHDRAWN', { listingId: listing.id, cardId: listing.cardId, version: result.version, bindingHash: result.bindingHash, environment: context.environment });
  return clone(result);
}

export function reviseListing(tx, input) {
  return changeListing(tx, input, 'revise', listing => {
    assertCurrentListingAuthority(listing, input.eligibility, tx.now, contextFor(tx));
    assertCurrentHoldConsent(tx, listing);
    const price = cents(input.askingPriceCents, { positive: true });
    const feeQuote = listing.policy.feeSchedule ? assertSellerFeeQuote(input.feeQuote, {policy:listing.policy,cardId:listing.cardId,sellerId:listing.sellerId,askingPriceCents:price,listingId:listing.id,listingVersion:listing.version,listingHash:listing.bindingHash},tx.now,contextFor(tx)) : null;
    const feeCents=feeQuote?.feeCents ?? listing.feeCents;
    requireValue(price > feeCents, 'SELLER_NET_INVALID');
    requireValue(price !== listing.askingPriceCents, 'LISTING_UNCHANGED');
    requireValue(Number.isSafeInteger(listing.version + 1), 'LISTING_VERSION_OVERFLOW');
    const revisions = tx.state.listingRevisions ??= {};
    const key = `${listing.id}:${listing.version}`;
    requireValue(!revisions[key], 'LISTING_REVISION_CONFLICT');
    revisions[key] = clone(listing);
    listing.version += 1;
    listing.askingPriceCents = price;
    listing.feeCents = feeCents;
    listing.sellerNetCents = price - feeCents;
    if(feeQuote) listing.feeQuote=clone(feeQuote);
    listing.bindingHash = listingBindingHash(listing);
    return listing;
  });
}

export function withdrawListing(tx, input) {
  return changeListing(tx, input, 'withdraw', listing => {
    listing.status = 'WITHDRAWN';
    listing.withdrawnAt = new Date(tx.now).toISOString();
    return listing;
  });
}
