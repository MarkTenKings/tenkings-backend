import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { cardOwnershipInput, projectCollectionPreferences, projectOwnerCollectionCard, projectOwnershipResult } from '../src/card-ownership-contract.mjs';
import { cardOwnershipGrantSQL, createCardOwnershipCustomerService, createCardOwnershipReviewService } from '../src/card-ownership-service.mjs';

const aid = randomUUID(), cid = randomUUID();
const preferences = () => ({ accountId: aid, revision: 0, visibility: 'PRIVATE', offersDisabled: false });
const record = () => ({ cardId: cid, ownership: { status: 'VERIFIED', ownerAccountId: aid, revision: 1 },
  cardPreferenceRevision: 0, cardVisibility: 'PRIVATE', cardOffersDisabled: false, collectionPreferences: preferences(),
  custody: { status: 'RECORDED', currentPhysicalHolder: aid, privateAddress: 'NEVER EXPOSE' },
  approvedCard: { approvalActionId: randomUUID(), certificateNumber: 'ATLAS-123456789ABC',
    report: { publicToken: 'ar_' + 'a'.repeat(24), version: 1, publicHash: 'a'.repeat(64) } } });

test('claims accept only bounded private evidence references, never self-declared owner/authority/custody', () => {
  const input = { requestId: randomUUID(), cardId: cid, expectedOwnershipRevision: 0, evidence: { referenceId: randomUUID(), sha256: 'a'.repeat(64) } };
  assert.deepEqual(cardOwnershipInput('submit_claim', input), input);
  for (const key of ['accountId', 'ownerAccountId', 'actorId', 'authority', 'staff', 'nfcToken', 'submissionId', 'verified']) {
    assert.throws(() => cardOwnershipInput('submit_claim', { ...input, [key]: aid }), { code: 'INVALID_OWNERSHIP_REQUEST' });
  }
  assert.throws(() => cardOwnershipInput('submit_claim', { ...input, evidence: { ...input.evidence, signedUrl: 'https://private.invalid' } }));
  assert.throws(() => cardOwnershipInput('submit_claim', { ...input, evidence: { referenceId: 'ATLAS-123456789ABC', sha256: 'a'.repeat(64) } }));
});
test('transfer is revision-bound, directed and bounded in duration; money/physical delivery fields are excluded', () => {
  const input = { requestId: randomUUID(), cardId: cid, expectedOwnershipRevision: 1, recipientAccountId: aid, expiresInMinutes: 60 };
  assert.deepEqual(cardOwnershipInput('propose_transfer', input), input);
  for (const value of [0, 10081, 1.5, '60']) assert.throws(() => cardOwnershipInput('propose_transfer', { ...input, expiresInMinutes: value }));
  for (const key of ['price', 'delivered', 'paymentId']) assert.throws(() => cardOwnershipInput('propose_transfer', { ...input, [key]: true }));
  assert.throws(() => cardOwnershipInput('accept_transfer', { requestId: randomUUID(), cardId: cid, expectedOwnershipRevision: -1, transferId: randomUUID() }));
});
test('unknown ownership and another account never appear in My Collection, even with submission/staff/custody facts', () => {
  const value = record();
  value.ownership.status = 'UNKNOWN'; value.submissionAccountId = aid; value.staffAcl = [aid];
  assert.equal(projectOwnerCollectionCard(value, aid), null);
  assert.equal(projectOwnerCollectionCard(record(), randomUUID()), null);
});
test('defaults retain Open to offers while private; no implied recipient, delivery, live holder or transaction', () => {
  const value = projectOwnerCollectionCard(record(), aid);
  assert.equal(value.offers.preference, 'OPEN_TO_OFFERS'); assert.equal(value.visibility, 'PRIVATE');
  assert.deepEqual(value.eligibility, { canReceiveOffers: false, reasonCodes: ['OFFER_DELIVERY_UNAVAILABLE', 'PRIVATE_COLLECTION', 'PRIVATE_CARD'] });
  assert.deepEqual(value.custody, { status: 'RECORDED', currentPhysicalHolder: 'UNKNOWN' });
  assert.equal(value.notificationDelivery, 'NOT_REQUESTED'); assert.doesNotMatch(JSON.stringify(value), /NEVER EXPOSE|privateAddress|payment|balance/i);
});
test('card/collection opt-outs and privacy are independent and immutable projections', () => {
  for (const cardDisabled of [false, true]) for (const collectionDisabled of [false, true]) {
    const raw = record(); raw.cardOffersDisabled = cardDisabled; raw.collectionPreferences.offersDisabled = collectionDisabled;
    raw.cardVisibility = 'PUBLIC'; raw.collectionPreferences.visibility = 'PUBLIC';
    const saved = structuredClone(raw), value = projectOwnerCollectionCard(raw, aid);
    assert.equal(value.visibility, 'PUBLIC'); assert.equal(value.offers.preference, cardDisabled || collectionDisabled ? 'DISABLED' : 'OPEN_TO_OFFERS');
    assert.equal(value.eligibility.canReceiveOffers, false); assert.deepEqual(raw, saved);
  }
  const raw = record(); raw.cardVisibility = 'PUBLIC';
  assert.equal(projectOwnerCollectionCard(raw, aid).visibility, 'PRIVATE');
});
test('empty collections retain account-scoped settings and require authentic response shapes', () => {
  const raw = { accountId: aid, cards: [], preferences: preferences(), nextCardId: null };
  assert.deepEqual(projectOwnershipResult('read_collection', raw).cards, []);
  assert.equal(projectCollectionPreferences(preferences(), aid).offersDisabled, false);
  assert.throws(() => projectCollectionPreferences(preferences(), randomUUID()), { code: 'OWNERSHIP_RESPONSE_INVALID' });
  assert.throws(() => projectOwnershipResult('read_collection', { ...raw, cards: [record(), record()] }), { code: 'OWNERSHIP_RESPONSE_INVALID' });
  assert.throws(() => projectOwnerCollectionCard({ ...record(), approvedCard: null }, aid), { code: 'OWNERSHIP_RESPONSE_INVALID' });
});
test('receipt explicitly projects only recorded action references', () => {
  const raw = { eventId: randomUUID(), requestId: randomUUID(), kind: 'CLAIM_SUBMITTED', evidence: 'PRIVATE', ownerAccountId: aid };
  assert.deepEqual(Object.keys(projectOwnershipResult('submit_claim', raw)), ['eventId', 'requestId', 'kind']);
});
test('customer adapter enforces CSRF before SQL and accepts cookies, never client account capabilities', async () => {
  let transactions = 0, authorityCalls = 0;
  const service = createCardOwnershipCustomerService({ auth: { config: {}, authority() { authorityCalls++; throw Object.assign(Error('denied'), { code: 'SIGN_IN_REQUIRED' }); } }, client: { async $transaction() { transactions++; } } });
  const input = { requestId: randomUUID(), expectedPreferenceRevision: 0, visibility: 'PRIVATE', offersDisabled: false };
  await assert.rejects(service.call('', 'set_collection_preferences', input), { code: 'CSRF_REQUIRED' });
  await assert.rejects(service.call({ accountId: aid }, 'set_collection_preferences', input, 'csrf'), { code: 'SIGN_IN_REQUIRED' });
  assert.equal(transactions, 0); assert.equal(authorityCalls, 1);
});
test('staff adapter rejects copied principal/capability before transaction; grants do not expose helpers or tables', async () => {
  let transactions = 0;
  const service = createCardOwnershipReviewService({ auth: { config: {}, actors: new WeakMap() }, boundary: { async transaction() { transactions++; } } });
  await assert.rejects(service.review({ role: 'REVIEWER' }, { requestId: randomUUID(), cardId: cid, claimId: randomUUID(), expectedOwnershipRevision: 0,
    decision: 'VERIFY', evidence: { referenceId: randomUUID(), sha256: 'a'.repeat(64) } }), { code: 'SIGN_IN_REQUIRED' });
  assert.equal(transactions, 0);
  assert.match(cardOwnershipGrantSQL('atlas_fixture_owner', 'CUSTOMER'), /customer_call\(text,text,jsonb,text,jsonb\)/);
  assert.doesNotMatch(cardOwnershipGrantSQL('atlas_fixture_owner', 'CUSTOMER'), /SELECT|INSERT|UPDATE|DELETE|current_title/);
  assert.throws(() => cardOwnershipGrantSQL('x"; DROP SCHEMA atlas_manual', 'STAFF'));
});
