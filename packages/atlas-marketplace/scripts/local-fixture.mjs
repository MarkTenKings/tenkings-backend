import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createMarketplacePilot } from '../src/service.mjs';
import { createSyntheticEligibilityAdapter } from '../src/eligibility.mjs';
import { createSyntheticProvider, SYNTHETIC_FINANCE_POLICY } from '../src/provider-synthetic.mjs';
import { makeSyntheticEligibility, makeSyntheticPolicy, makeSyntheticQuote } from '../test/listing-fixtures.mjs';

export const actors = Object.freeze({ seller: { id: 'demo_seller', role: 'SELLER' }, buyer: { id: 'demo_buyer', role: 'BUYER' }, alternateBuyer: { id: 'demo_other_buyer', role: 'BUYER' }, staff: { id: 'demo_staff', role: 'STAFF' } });
export const demoRequestId = () => `demo_${randomUUID().replaceAll('-', '')}`;
export function createLocalFixture({ store, clock = Date.now, assets = true }) {
  const eligibilityFixture = makeSyntheticEligibility();
  if (assets) {
    const sha = file => createHash('sha256').update(readFileSync(new URL(`../ui/${file}`, import.meta.url))).digest('hex');
    eligibilityFixture.approvedCard.reportHash = sha('report.html');
    eligibilityFixture.approvedCard.media.front.sha256 = sha('front.svg');
    eligibilityFixture.approvedCard.media.back.sha256 = sha('back.svg');
  }
  const listingPolicy = makeSyntheticPolicy();
  const financePolicy = { ...SYNTHETIC_FINANCE_POLICY, version: listingPolicy.version };
  const fulfillmentPolicy = { environment: 'SYNTHETIC_LOCAL', id: listingPolicy.id, version: listingPolicy.version, approvalRef: 'demo_policy_fixture_only', packingProtocolRef: 'demo_packing_fixture', coverageTermsRef: 'demo_no_actual_coverage', returnsTermsRef: 'demo_returns_fixture', appealsTermsRef: 'demo_appeals_fixture', transferTermsRef: 'demo_release_fixture', missingScanAfterMs: 1000, returnWindowMs: 0 };
  const provider = createSyntheticProvider({ store, clock, enabled: true });
  if (!store.read(state => state.syntheticProvider?.accounts.demo_platform)) provider.configureAccount({ accountId: 'demo_platform' });
  if (!store.read(state => state.syntheticProvider?.accounts.demo_connected)) provider.configureAccount({ accountId: 'demo_connected', verifiedExternalAccountIds: ['demo_bank'] });
  const eligibility = createSyntheticEligibilityAdapter({ enabled: true, fixtures: [eligibilityFixture], clock, assertionTtlMs: 60000 });
  const quoteProvider = async ({ listing, now }) => makeSyntheticQuote(listing, { quoteId: demoRequestId(), expiresAt: new Date(now + 300000).toISOString() });
  const service = createMarketplacePilot({ enabled: true, environment: 'SYNTHETIC_LOCAL', store, provider, eligibility, quoteProvider, listingPolicy, financePolicy, fulfillmentPolicy, platformAccountId: 'demo_platform', clock });
  return { service, provider, eligibility, eligibilityFixture, listingPolicy, financePolicy, fulfillmentPolicy, quoteProvider };
}
export function syntheticFulfillmentEvidence(order, action) {
  const evidence = { environment: 'SYNTHETIC_LOCAL', orderId: order.orderId, cardId: order.cardId, ref: `demo_${action.toLowerCase()}_evidence` };
  for (const key of ['intakeFrontRef', 'intakeBackRef', 'holderConditionRef', 'packingPhotoRef', 'fittedInsertRef', 'firstSealRef', 'secondSealRef', 'cleanLabelAreaRef', 'resaleInstructionsRef', 'replacementKitRef', 'carrierRef', 'trackingRef', 'coverageRef', 'dispatchReceiptRef', 'deliveryProofRef', 'releaseReviewRef']) evidence[key] = `demo_${key}`;
  return evidence;
}
