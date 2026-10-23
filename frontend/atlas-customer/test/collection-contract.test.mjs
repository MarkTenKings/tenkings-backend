import test from 'node:test';
import assert from 'node:assert/strict';
import { collectionCardDisplay, collectionScopeKey, parseOwnerCollection, previewCollectionSettings } from '../lib/collection-contract.mjs';
import { projectOwnerCollectionCard, projectOwnershipResult } from '../../../packages/atlas-connected-manual/src/card-ownership-contract.mjs';

const accountId = '11111111-1111-4111-8111-111111111111', cardId = '22222222-2222-4222-8222-222222222222';
const preferences = () => ({ accountId, revision: 0, visibility: 'PRIVATE', offersDisabled: false });
function record() {
  return { cardId, ownership: { status: 'VERIFIED', ownerAccountId: accountId, revision: 1 }, cardVisibility: 'PRIVATE', cardPreferenceRevision: 0,
    cardOffersDisabled: false, collectionPreferences: preferences(), custody: { status: 'RECORDED', holderAccountId: accountId },
    approvedCard: { approvalActionId: '33333333-3333-4333-8333-333333333333', certificateNumber: 'ATLAS-ABCDEF123456',
      report: { publicToken: `ar_${'A'.repeat(24)}`, version: 1, publicHash: 'a'.repeat(64) } } };
}
function fixture() { return projectOwnershipResult('read_collection', { accountId, preferences: preferences(), cards: [record()], nextCardId: null }); }

test('the actual ownership projector roundtrips through the private browser boundary', () => {
  const value = parseOwnerCollection(fixture(), accountId), card = value.cards[0];
  assert.equal(card.visibility, 'PRIVATE'); assert.equal(card.offers.preference, 'OPEN_TO_OFFERS');
  assert.equal(card.eligibility.canReceiveOffers, false); assert.equal(card.notificationDelivery, 'NOT_REQUESTED');
  assert.equal(card.custody.currentPhysicalHolder, 'UNKNOWN');
});

test('unknown title never becomes owned from submission, custody, NFC or staff access', () => {
  const value = record(); value.ownership = { status: 'UNKNOWN', ownerAccountId: null, revision: 0 };
  value.customerAccountId = accountId; value.submission = { accountId }; value.nfcVerified = true; value.staffOwnerId = accountId;
  assert.equal(projectOwnerCollectionCard(value, accountId), null);
  const wire = fixture(); wire.cards[0].ownership = value.ownership;
  assert.throws(() => parseOwnerCollection(wire, accountId), { code: 'COLLECTION_OWNER_MISMATCH' });
});

test('no private card fields survive an account switch or a forged mixed-owner response', () => {
  const wire = fixture(), other = '44444444-4444-4444-8444-444444444444';
  assert.throws(() => parseOwnerCollection(wire, other), { code: 'COLLECTION_ACCOUNT_MISMATCH' });
  wire.cards[0].ownership.ownerAccountId = other;
  assert.throws(() => parseOwnerCollection(wire, accountId), { code: 'COLLECTION_OWNER_MISMATCH' });
});

test('allowlisted projection strips staff/contact/custody evidence and raw private fields', () => {
  const wire = fixture(); wire.staffPhone = 'PRIVATE PHONE'; wire.cards[0].email = 'private@example.invalid';
  wire.cards[0].custody.address = 'PRIVATE ADDRESS'; wire.cards[0].approvedCard.internalNotes = 'PRIVATE NOTE';
  const serialized = JSON.stringify(parseOwnerCollection(wire, accountId));
  assert.doesNotMatch(serialized, /PRIVATE PHONE|PRIVATE ADDRESS|PRIVATE NOTE|private@example/);
});

test('card and collection opt-outs remain independent from visibility and delivery', () => {
  for (const collectionDisabled of [false, true]) for (const cardDisabled of [false, true]) for (const publicCollection of [false, true]) {
    const raw = record(); raw.collectionPreferences.offersDisabled = collectionDisabled;
    raw.collectionPreferences.visibility = publicCollection ? 'PUBLIC' : 'PRIVATE'; raw.cardVisibility = 'PUBLIC'; raw.cardOffersDisabled = cardDisabled;
    const wire = projectOwnershipResult('read_collection', { accountId, preferences: raw.collectionPreferences, cards: [raw], nextCardId: null });
    const card = parseOwnerCollection(wire, accountId).cards[0];
    assert.equal(card.offers.preference, collectionDisabled || cardDisabled ? 'DISABLED' : 'OPEN_TO_OFFERS');
    assert.equal(card.visibility, publicCollection ? 'PUBLIC' : 'PRIVATE');
    assert.equal(card.eligibility.canReceiveOffers, false);
  }
});

test('new report versions retain recorded explicit card opt-out', () => {
  const raw = record(); raw.cardOffersDisabled = true; raw.cardPreferenceRevision = 1;
  const before = projectOwnerCollectionCard(raw, accountId); raw.approvedCard.report.version = 2; raw.approvedCard.report.publicHash = 'b'.repeat(64);
  const after = projectOwnerCollectionCard(raw, accountId);
  assert.deepEqual(before.offers, after.offers); assert.equal(after.cardPreferenceRevision, 1);
});

test('settings preview has no writes, preserves source, and cannot enable delivery', () => {
  const collection = parseOwnerCollection(fixture(), accountId), original = structuredClone(collection);
  const preview = previewCollectionSettings(collection, { visibility: 'PUBLIC', cards: { [cardId]: { visibility: 'PUBLIC', offersDisabled: true } } });
  assert.equal(preview.persistence, 'PREVIEW_ONLY'); assert.equal(preview.cards[0].visibility, 'PUBLIC');
  assert.equal(preview.cards[0].preference, 'DISABLED'); assert.equal(preview.cards[0].canReceiveOffers, false);
  assert.deepEqual(collection, original);
  assert.throws(() => previewCollectionSettings(collection, { cards: { other: { visibility: 'PUBLIC' } } }));
});

test('private collection overrides a public card without erasing its own preference', () => {
  const collection = parseOwnerCollection(fixture(), accountId);
  const hidden = previewCollectionSettings(collection, { cards: { [cardId]: { visibility: 'PUBLIC' } } });
  assert.equal(hidden.cards[0].cardVisibility, 'PUBLIC'); assert.equal(hidden.cards[0].visibility, 'PRIVATE');
  assert.equal(hidden.cards[0].preference, 'OPEN_TO_OFFERS');
});

test('stale or inconsistent effective settings and invented delivery are rejected', () => {
  for (const mutate of [v => { v.cards[0].visibility = 'PUBLIC'; }, v => { v.cards[0].offers.preference = 'DISABLED'; },
    v => { v.cards[0].eligibility.canReceiveOffers = true; }, v => { v.cards[0].notificationDelivery = 'SENT'; },
    v => { v.cards[0].approvedCard.report.publicHash = 'invalid'; }, v => { v.cards.push(v.cards[0]); }]) {
    const wire = fixture(); mutate(wire); assert.throws(() => parseOwnerCollection(wire, accountId));
  }
});

test('empty collections still carry account-scoped private/open defaults and pagination is explicit', () => {
  const wire = fixture(); wire.cards = []; const value = parseOwnerCollection(wire, accountId);
  assert.equal(value.preferences.visibility, 'PRIVATE'); assert.equal(value.preferences.offersDisabled, false);
  wire.nextCardId = cardId; assert.equal(parseOwnerCollection(wire, accountId).nextCardId, cardId);
  wire.nextCardId = 'unsafe'; assert.throws(() => parseOwnerCollection(wire, accountId));
});

test('display joins require the exact approval, version and public hash', () => {
  const card = parseOwnerCollection(fixture(), accountId).cards[0];
  const display = { cardId, approvalActionId: card.approvedCard.approvalActionId, report: { ...card.approvedCard.report }, title: 'Approved card title', finalGrade: 9 };
  assert.equal(collectionCardDisplay(card, display).title, 'Approved card title');
  assert.equal(collectionCardDisplay(card, display).reportPath, `/reports/${card.approvedCard.report.publicToken}?v=1`);
  display.report.version = 2; assert.equal(collectionCardDisplay(card, display).title, 'Graded card');
  assert.equal(collectionCardDisplay(card, display).grade, null);
});

test('privacy drafts invalidate on ownership, preference and approval revisions', () => {
  const value = parseOwnerCollection(fixture(), accountId), originalKey = collectionScopeKey(value);
  for (const mutate of [v => v.cards[0].ownership.revision++, v => v.cards[0].cardPreferenceRevision++,
    v => v.preferences.revision++, v => v.cards[0].approvedCard.report.version++]) {
    const changed = structuredClone(value); mutate(changed); assert.notEqual(collectionScopeKey(changed), originalKey);
  }
});
