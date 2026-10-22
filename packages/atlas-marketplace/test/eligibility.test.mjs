import test from 'node:test';
import assert from 'node:assert/strict';
import { assertEligibility, createSyntheticEligibilityAdapter, createUnavailableEligibilityAdapter } from '../src/eligibility.mjs';
import { makeSyntheticEligibility, FIXTURE_NOW } from './listing-fixtures.mjs';

const check = (fixture) => assertEligibility(fixture, { cardId: 'demo_card', sellerId: 'demo_seller', now: FIXTURE_NOW });

test('real authority stays unavailable and synthetic adapter requires explicit enablement', async () => {
  assert.equal((await createUnavailableEligibilityAdapter().read({ cardId: 'actual-card' })).available, false);
  assert.throws(() => createSyntheticEligibilityAdapter(), { code: 'SYNTHETIC_ADAPTER_DISABLED' });
  assert.throws(() => check(makeSyntheticEligibility({ environment: 'PRODUCTION' })), { code: 'ELIGIBILITY_UNAVAILABLE' });
  assert.throws(() => assertEligibility(makeSyntheticEligibility({ cardId: '67d99e9c-f03d-45c7-8f71-0f52659fccac' }), { cardId: '67d99e9c-f03d-45c7-8f71-0f52659fccac', sellerId: 'demo_seller', now: FIXTURE_NOW }), { code: 'SYNTHETIC_ID_REQUIRED' });
});

test('custody, title, consignment and payment capability are independent requirements', () => {
  for (const [key, value, code] of [
    ['title', { ownerId: 'demo_seller', evidenceRef: 'demo_staff_assignment', status: 'UNKNOWN' }, 'TITLE_REQUIRED'],
    ['custody', { cardId: 'demo_card', custodian: 'DEALER', status: 'HELD' }, 'CUSTODY_REQUIRED'],
    ['consignment', { sellerId: 'demo_seller', status: 'UNKNOWN' }, 'CONSIGNMENT_REQUIRED'],
    ['seller', { accountId: 'demo_seller', paymentsEligible: false, currency: 'USD' }, 'SELLER_INELIGIBLE'],
  ]) assert.throws(() => check(makeSyntheticEligibility({ [key]: value })), { code });
  const missingConsent = makeSyntheticEligibility();
  delete missingConsent.consignment.holdConsentRef;
  assert.throws(() => check(missingConsent), { code: 'EVIDENCE_REQUIRED' });
});

test('exact approval/media and current assertion are required; outputs do not alias input', async () => {
  const fixture = makeSyntheticEligibility();
  fixture.approvedCard.media.back.sha256 = 'not-a-hash';
  assert.throws(() => check(fixture), { code: 'EVIDENCE_BINDING_INVALID' });
  assert.throws(() => check(makeSyntheticEligibility({ expiresAt: new Date(FIXTURE_NOW).toISOString() })), { code: 'ELIGIBILITY_EXPIRED' });
  assert.throws(() => check(makeSyntheticEligibility({ issuedAt: new Date(FIXTURE_NOW + 1).toISOString() })), { code: 'ELIGIBILITY_EXPIRED' });
  const remote = makeSyntheticEligibility();
  remote.approvedCard.media.front.url = 'https://atlasgrading.com/real-card.jpg';
  assert.throws(() => check(remote), { code: 'EVIDENCE_URL_INVALID' });
  const adapter = createSyntheticEligibilityAdapter({ enabled: true, fixtures: [makeSyntheticEligibility()], clock: () => FIXTURE_NOW, assertionTtlMs: 1000 });
  const result = await adapter.read({ cardId: 'demo_card', sellerId: 'demo_seller' });
  result.assertion.title.status = 'UNKNOWN';
  assert.equal((await adapter.read({ cardId: 'demo_card', sellerId: 'demo_seller' })).assertion.title.status, 'VERIFIED');
  assert.equal((await adapter.read({ cardId: 'demo_card', sellerId: 'demo_other' })).available, false);
});
