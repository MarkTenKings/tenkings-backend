import { cents, clone, hash, requireValue } from './contract.mjs';
import { assertEligibility, demoId, eligibilityBinding, requiredText, SYNTHETIC_ENVIRONMENT } from './eligibility.mjs';

export function assertListingPolicy(policy) {
  requireValue(policy?.environment === SYNTHETIC_ENVIRONMENT, 'POLICY_REQUIRED', 'An explicit synthetic policy is required; no commercial fee or protection terms are assumed.');
  demoId(policy.id, 'policy');
  requiredText(policy.version, 'Policy version');
  requiredText(policy.approvalRef, 'Policy approval reference');
  cents(policy.feeCents);
  requiredText(policy.feeDisclosure, 'Seller fee disclosure');
  requireValue(policy.fulfillmentRoute === 'ATLAS_HELD', 'FULFILLMENT_UNAVAILABLE', 'Only ATLAS-held fulfillment is in this pilot.');
  for (const field of ['protectionTerms', 'returnsTerms', 'transferReleaseTerms', 'payoutTerms']) requiredText(policy[field], field);
  requireValue(Number.isSafeInteger(policy.reservationTtlMs) && policy.reservationTtlMs > 0 && policy.reservationTtlMs <= 86400000, 'POLICY_REQUIRED', 'A positive bounded reservation lifetime is required.');
  return policy;
}

const IMMUTABLE_FIELDS = ['id', 'version', 'environment', 'cardId', 'sellerId', 'connectedAccountId', 'currency', 'askingPriceCents', 'feeCents', 'sellerNetCents', 'approvedCard', 'authority', 'policy', 'createdAt'];
export function listingBindingHash(listing) {
  return hash(Object.fromEntries(IMMUTABLE_FIELDS.map((field) => [field, listing[field]])));
}

export function assertListingBinding(listing) {
  requireValue(listing && listing.environment === SYNTHETIC_ENVIRONMENT && listing.bindingHash === listingBindingHash(listing), 'LISTING_BINDING_INVALID', 'The saved listing/report/media/terms binding changed.');
  return listing;
}

export function assertCurrentListingAuthority(listing, eligibility, now) {
  assertEligibility(eligibility, { cardId: listing.cardId, sellerId: listing.sellerId, now });
  requireValue(hash(eligibilityBinding(eligibility)) === hash(listing.authority), 'LISTING_AUTHORITY_CHANGED', 'Seller, title, consent, custody or approved evidence changed; this listing must be reviewed again.');
}

export function assertCurrentHoldConsent(tx, listing) {
  const consent = tx.state.consent[listing.cardId];
  requireValue(consent?.choice === 'HOLD_AND_LIST' && consent.sellerId === listing.sellerId && consent.evidenceRef === listing.authority.holdConsentRef, 'HOLD_CONSENT_REQUIRED', 'Current explicit Hold and list consent is required.');
}

export function createListing(tx, input) {
  demoId(input.requestId, 'request');
  demoId(input.listingId, 'listing');
  demoId(input.sellerId, 'seller');
  const eligibility = input.eligibility;
  const policy = assertListingPolicy(input.policy);
  requireValue(eligibility, 'ELIGIBILITY_UNAVAILABLE', 'Seller/title/custody authority is required.');
  const requestHash = hash({ listingId: input.listingId, sellerId: input.sellerId, askingPriceCents: input.askingPriceCents, cardId: eligibility?.cardId, authority: eligibility ? eligibilityBinding(eligibility) : null, policy: input.policy });
  const receiptKey = `listing:${input.requestId}`;
  const receipt = tx.state.receipts[receiptKey];
  if (receipt) {
    requireValue(receipt.requestHash === requestHash, 'IDEMPOTENCY_CONFLICT', 'This listing request already has different immutable inputs.');
    return clone(receipt.result);
  }
  const authority = assertEligibility(eligibility, { cardId: eligibility?.cardId, sellerId: input.sellerId, now: tx.now });
  requireValue(authority.consignment.policyId === policy.id, 'POLICY_MISMATCH', 'Consignment must bind the selected listing policy.');
  const consent = tx.state.consent[authority.cardId];
  requireValue(consent?.choice === 'HOLD_AND_LIST' && consent.sellerId === input.sellerId && consent.evidenceRef === authority.consignment.holdConsentRef, 'HOLD_CONSENT_REQUIRED', 'Record explicit Hold and list consent before listing this card.');
  const askingPriceCents = cents(input.askingPriceCents, { positive: true });
  requireValue(policy.feeCents < askingPriceCents, 'SELLER_NET_INVALID', 'The quoted seller fee must leave a positive net.');
  requireValue(!tx.state.listings[input.listingId], 'LISTING_ID_CONFLICT', 'This listing identity is already used.');
  const conflicts = Object.values(tx.state.listings).some((listing) => listing.cardId === authority.cardId && ['ACTIVE', 'RESERVED', 'SOLD'].includes(listing.status));
  requireValue(!conflicts, 'CARD_UNAVAILABLE', 'The permanent card already has an active, reserved or sold listing.');
  const listing = {
    id: input.listingId, version: 1, environment: SYNTHETIC_ENVIRONMENT,
    cardId: authority.cardId, sellerId: input.sellerId, connectedAccountId: authority.seller.connectedAccountId,
    currency: 'USD', askingPriceCents, feeCents: policy.feeCents, sellerNetCents: askingPriceCents - policy.feeCents,
    approvedCard: clone(authority.approvedCard), authority: eligibilityBinding(authority), policy: clone(policy), createdAt: new Date(tx.now).toISOString(),
  };
  listing.bindingHash = listingBindingHash(listing);
  listing.status = 'ACTIVE';
  listing.activeReservationId = null;
  tx.state.listings[listing.id] = listing;
  tx.state.receipts[receiptKey] = { requestHash, result: clone(listing) };
  tx.emit('LISTING_CREATED', { listingId: listing.id, cardId: listing.cardId, policyVersion: policy.version, environment: SYNTHETIC_ENVIRONMENT });
  return clone(listing);
}
