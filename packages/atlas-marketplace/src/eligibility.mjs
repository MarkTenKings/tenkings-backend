import { clone, hash, requireValue } from './contract.mjs';

export const SYNTHETIC_ENVIRONMENT = 'SYNTHETIC_LOCAL';

export function demoId(value, label = 'identifier') {
  requireValue(typeof value === 'string' && /^demo_[a-zA-Z0-9_-]{1,100}$/.test(value), 'SYNTHETIC_ID_REQUIRED', `${label} must identify an explicit local synthetic fixture.`);
  return value;
}

export function requiredText(value, label) {
  requireValue(typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 2000, 'EVIDENCE_REQUIRED', `${label} is required.`);
  return value;
}

function digest(value, label) {
  requireValue(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'EVIDENCE_BINDING_INVALID', `${label} must be an exact SHA-256 digest.`);
}

function localEvidenceUrl(value) {
  requireValue(typeof value === 'string' && /^\/demo\/[a-zA-Z0-9_./?-]+$/.test(value) && !value.includes('..'), 'EVIDENCE_URL_INVALID', 'Synthetic evidence must stay on the local demo route.');
}

export function assertApprovedCard(card) {
  requireValue(card && typeof card === 'object', 'APPROVAL_REQUIRED', 'An exact approved-card snapshot is required.');
  demoId(card.cardId, 'card');
  demoId(card.approvalId, 'approval');
  requiredText(card.certificateId, 'Permanent certificate');
  requireValue(Number.isSafeInteger(card.reportVersion) && card.reportVersion > 0, 'EVIDENCE_BINDING_INVALID', 'An exact report version is required.');
  digest(card.reportHash, 'Report hash');
  localEvidenceUrl(card.reportUrl);
  const identity = card.identity;
  requireValue(identity && typeof identity === 'object', 'IDENTITY_REQUIRED', 'Approved identity is required.');
  requiredText(identity.name, 'Approved name');
  requireValue(['SPORTS', 'POKEMON'].includes(identity.category), 'IDENTITY_INVALID', 'A supported approved category is required.');
  requireValue(Number.isFinite(identity.grade) && identity.grade >= 1 && identity.grade <= 10, 'IDENTITY_INVALID', 'Approved grade is invalid.');
  for (const key of ['year', 'set']) {
    requireValue(identity[key] === null || (typeof identity[key] === 'string' && identity[key].length > 0 && identity[key].length <= 200), 'IDENTITY_INVALID', `${key} must preserve its approved value or explicit unknown.`);
  }
  requireValue(identity.numberedDenominator === null || (Number.isSafeInteger(identity.numberedDenominator) && identity.numberedDenominator > 0), 'IDENTITY_INVALID', 'Numbered denominator must be known or explicitly null.');
  for (const key of ['autograph', 'relic']) requireValue([true, false, null].includes(identity[key]), 'IDENTITY_INVALID', `${key} must preserve known or unknown.`);
  for (const side of ['front', 'back']) {
    const media = card.media?.[side];
    requireValue(media && typeof media === 'object', 'MEDIA_REQUIRED', `Exact ${side} media is required.`);
    demoId(media.objectId, `${side} media`);
    digest(media.sha256, `${side} media hash`);
    localEvidenceUrl(media.url);
    requireValue(Number.isSafeInteger(media.width) && media.width > 0 && Number.isSafeInteger(media.height) && media.height > 0, 'MEDIA_INVALID', 'Recorded media dimensions are required.');
  }
  requireValue(card.media.front.objectId !== card.media.back.objectId, 'MEDIA_INVALID', 'Front and Back must identify their own retained evidence.');
  return card;
}

// A local fixture assertion is deliberately incapable of authorizing a real card.
// The future real adapter must be separately qualified; it is not implemented here.
export function assertEligibility(assertion, { cardId, sellerId, now }) {
  requireValue(assertion?.environment === SYNTHETIC_ENVIRONMENT, 'ELIGIBILITY_UNAVAILABLE', 'Real seller/title/custody authority is disabled pending Fingerprint and policy qualification.');
  demoId(cardId, 'card');
  demoId(sellerId, 'seller');
  demoId(assertion.assertionId, 'assertion');
  requireValue(Number.isSafeInteger(now), 'TIME_INVALID', 'A trusted transaction clock is required.');
  const issued = Date.parse(assertion.issuedAt);
  const expires = Date.parse(assertion.expiresAt);
  requireValue(Number.isFinite(issued) && Number.isFinite(expires) && issued <= now && expires > now && expires > issued, 'ELIGIBILITY_EXPIRED', 'Seller authority must be current at the transaction.');
  requireValue(assertion.cardId === cardId && assertion.sellerId === sellerId, 'ELIGIBILITY_MISMATCH', 'Seller authority does not match this card and seller.');
  requiredText(assertion.authorityRevision, 'Authority revision');
  requireValue(assertion.title?.status === 'VERIFIED' && assertion.title.ownerId === sellerId, 'TITLE_REQUIRED', 'Current recorded title is required separately from custody and staff access.');
  requiredText(assertion.title.evidenceRef, 'Title evidence');
  requireValue(assertion.consignment?.status === 'ACTIVE' && assertion.consignment.sellerId === sellerId, 'CONSIGNMENT_REQUIRED', 'Active seller consignment is required.');
  requiredText(assertion.consignment.evidenceRef, 'Consignment evidence');
  requiredText(assertion.consignment.policyId, 'Consignment policy');
  requiredText(assertion.consignment.holdConsentRef, 'Explicit Hold and list consent');
  requireValue(assertion.custody?.cardId === cardId && assertion.custody.custodian === 'ATLAS' && assertion.custody.status === 'HELD', 'CUSTODY_REQUIRED', 'The pilot requires recorded ATLAS physical custody.');
  requiredText(assertion.custody.locationRef, 'Custody location');
  requiredText(assertion.custody.evidenceRef, 'Custody evidence');
  requireValue(assertion.seller?.accountId === sellerId && assertion.seller.paymentsEligible === true && assertion.seller.currency === 'USD', 'SELLER_INELIGIBLE', 'Eligible seller account authority is required.');
  demoId(assertion.seller.connectedAccountId, 'Synthetic connected account');
  assertApprovedCard(assertion.approvedCard);
  requireValue(assertion.approvedCard.cardId === cardId, 'EVIDENCE_BINDING_INVALID', 'Approved media/report must belong to the exact permanent card.');
  return clone(assertion);
}

export function eligibilityBinding(assertion) {
  requireValue(assertion?.title && assertion?.consignment && assertion?.custody && assertion?.seller && assertion?.approvedCard, 'ELIGIBILITY_UNAVAILABLE', 'The complete retained authority assertion is required.');
  return {
    cardId: assertion.cardId,
    sellerId: assertion.sellerId,
    authorityRevision: assertion.authorityRevision,
    titleRef: assertion.title.evidenceRef,
    consignmentRef: assertion.consignment.evidenceRef,
    consignmentPolicyId: assertion.consignment.policyId,
    holdConsentRef: assertion.consignment.holdConsentRef,
    custodyRef: assertion.custody.evidenceRef,
    custodyLocationRef: assertion.custody.locationRef,
    connectedAccountId: assertion.seller.connectedAccountId,
    approvedCardHash: hash(assertion.approvedCard),
  };
}

export function createUnavailableEligibilityAdapter() {
  return Object.freeze({
    async read() { return { available: false, reason: 'REAL_AUTHORITY_DISABLED_PENDING_FINGERPRINT_AND_POLICY' }; },
  });
}

export function createSyntheticEligibilityAdapter({ enabled = false, fixtures = [], clock = Date.now, assertionTtlMs } = {}) {
  requireValue(enabled === true, 'SYNTHETIC_ADAPTER_DISABLED', 'Local fixture authority requires explicit enablement.');
  requireValue(Number.isSafeInteger(assertionTtlMs) && assertionTtlMs > 0, 'POLICY_REQUIRED', 'The synthetic assertion lifetime must be explicit.');
  const records = new Map(fixtures.map((fixture) => [demoId(fixture.cardId), clone(fixture)]));
  requireValue(records.size === fixtures.length, 'FIXTURE_CONFLICT', 'A card may have only one local authority fixture.');
  return Object.freeze({
    async read({ cardId, sellerId }) {
      const fixture = records.get(cardId);
      if (!fixture || fixture.sellerId !== sellerId) return { available: false, reason: 'NO_SYNTHETIC_AUTHORITY' };
      const now = clock();
      const assertion = { ...clone(fixture), issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + assertionTtlMs).toISOString() };
      return { available: true, assertion: assertEligibility(assertion, { cardId, sellerId, now }) };
    },
  });
}
