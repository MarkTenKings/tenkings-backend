// Browser display boundary only. Ownership must be established by the server's
// card-ownership contract, never by a submission, staff ACL, custody or tag scan.
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const revision = value => Number.isSafeInteger(value) && value >= 0;
const visibility = value => value === 'PRIVATE' || value === 'PUBLIC';
const check = (value, code = 'COLLECTION_PROJECTION_INVALID') => { if (!value) throw Object.assign(new Error(code), { code }); };

export function parseCollectionPreferences(value, accountId) {
  check(uuid(accountId) && value?.schema === 'atlas-collection-preferences-v1' && value.accountId === accountId,
    'COLLECTION_ACCOUNT_MISMATCH');
  check(revision(value.revision) && visibility(value.visibility) && typeof value.offersDisabled === 'boolean');
  return { schema: value.schema, accountId, revision: value.revision, visibility: value.visibility, offersDisabled: value.offersDisabled };
}

export function parseOwnerCollectionCard(value, accountId, preferences) {
  check(value?.schema === 'atlas-owner-collection-card-v1' && uuid(value.cardId));
  check(uuid(accountId) && value.ownership?.status === 'VERIFIED' && value.ownership.ownerAccountId === accountId,
    'COLLECTION_OWNER_MISMATCH');
  const collection = parseCollectionPreferences(preferences, accountId);
  check(revision(value.ownership.revision) && value.ownership.revision > 0 && revision(value.cardPreferenceRevision)
    && visibility(value.visibility) && visibility(value.cardVisibility));
  check(typeof value.offers?.cardDisabled === 'boolean' && value.offers.collectionDisabled === collection.offersDisabled);
  const effectiveVisibility = collection.visibility === 'PRIVATE' || value.cardVisibility === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC';
  const preference = collection.offersDisabled || value.offers.cardDisabled ? 'DISABLED' : 'OPEN_TO_OFFERS';
  check(value.visibility === effectiveVisibility && value.offers.preference === preference);
  // The current foundation has no offer engine or delivery capability. A
  // future enabled contract needs its own reviewed parser and service wiring.
  check(value.eligibility?.canReceiveOffers === false && value.notificationDelivery === 'NOT_REQUESTED'
    && Array.isArray(value.eligibility.reasonCodes) && value.eligibility.reasonCodes.includes('OFFER_DELIVERY_UNAVAILABLE')
    && value.eligibility.reasonCodes.length <= 20 && value.eligibility.reasonCodes.every(code => /^[A-Z][A-Z0-9_]{0,79}$/.test(code)));
  check(['UNKNOWN', 'RECORDED'].includes(value.custody?.status) && value.custody.currentPhysicalHolder === 'UNKNOWN');
  const approval = value.approvedCard, report = approval?.report;
  check(uuid(approval?.approvalActionId) && typeof approval.certificateNumber === 'string'
    && approval.certificateNumber.length > 0 && approval.certificateNumber.length <= 100
    && !/[\u0000-\u001f\u007f]/.test(approval.certificateNumber)
    && /^ar_[A-Za-z0-9_-]{24}$/.test(report?.publicToken ?? '') && revision(report?.version) && report.version > 0
    && /^[a-f0-9]{64}$/.test(report?.publicHash ?? ''));
  return {
    schema: value.schema, cardId: value.cardId,
    ownership: { status: 'VERIFIED', ownerAccountId: accountId, revision: value.ownership.revision },
    visibility: effectiveVisibility, cardVisibility: value.cardVisibility, cardPreferenceRevision: value.cardPreferenceRevision,
    offers: { preference, collectionDisabled: collection.offersDisabled, cardDisabled: value.offers.cardDisabled },
    eligibility: { canReceiveOffers: false, reasonCodes: [...new Set(value.eligibility.reasonCodes)] },
    notificationDelivery: 'NOT_REQUESTED', custody: { status: value.custody.status, currentPhysicalHolder: 'UNKNOWN' },
    approvedCard: { approvalActionId: approval.approvalActionId, certificateNumber: approval.certificateNumber,
      report: { publicToken: report.publicToken, version: report.version, publicHash: report.publicHash } },
  };
}

/** A bounded UI input, not a new endpoint or an authorization capability. */
export function parseOwnerCollection(value, accountId) {
  check(value?.schema === 'atlas-owner-collection-v1' && value.accountId === accountId, 'COLLECTION_ACCOUNT_MISMATCH');
  const preferences = parseCollectionPreferences(value.preferences, accountId);
  check(Array.isArray(value.cards) && value.cards.length <= 200 && (value.nextCardId === null || uuid(value.nextCardId)));
  const cards = value.cards.map(card => parseOwnerCollectionCard(card, accountId, preferences));
  check(new Set(cards.map(card => card.cardId)).size === cards.length);
  return { schema: value.schema, accountId, preferences, cards, nextCardId: value.nextCardId };
}

export function collectionScopeKey(collection) {
  return JSON.stringify([collection.accountId, collection.preferences.revision, collection.cards.map(card => [
    card.cardId, card.ownership.revision, card.cardPreferenceRevision, card.approvedCard.approvalActionId,
    card.approvedCard.report.version, card.approvedCard.report.publicHash,
  ])]);
}

/** Optional identity joins must come from a separately authorized approved-card
 * reader. A title for another approval/report is deliberately not displayed. */
export function collectionCardDisplay(card, supplied) {
  const report = card.approvedCard.report;
  const bound = supplied?.cardId === card.cardId && supplied.approvalActionId === card.approvedCard.approvalActionId
    && supplied.report?.publicToken === report.publicToken && supplied.report?.version === report.version
    && supplied.report?.publicHash === report.publicHash;
  const title = bound && typeof supplied.title === 'string' && supplied.title.trim().length > 0
    && supplied.title.length <= 500 && !/[\u0000-\u001f\u007f]/.test(supplied.title) ? supplied.title.trim() : 'Graded card';
  const grade = bound && Number.isFinite(supplied.finalGrade) && supplied.finalGrade >= 1 && supplied.finalGrade <= 10 ? supplied.finalGrade : null;
  return { title, grade, certificateNumber: card.approvedCard.certificateNumber,
    reportPath: `/reports/${report.publicToken}?v=${report.version}` };
}

export function previewCollectionSettings(collection, draft = {}) {
  const collectionVisibility = draft.visibility ?? collection.preferences.visibility;
  const offersDisabled = draft.offersDisabled ?? collection.preferences.offersDisabled;
  check(visibility(collectionVisibility) && typeof offersDisabled === 'boolean');
  const changes = draft.cards ?? {};
  check(changes && typeof changes === 'object' && !Array.isArray(changes)
    && Object.keys(changes).every(id => collection.cards.some(card => card.cardId === id)));
  return { persistence: 'PREVIEW_ONLY', visibility: collectionVisibility, offersDisabled,
    cards: collection.cards.map(card => {
      const change = changes[card.cardId] ?? {}, cardVisibility = change.visibility ?? card.cardVisibility;
      const cardDisabled = change.offersDisabled ?? card.offers.cardDisabled;
      check(visibility(cardVisibility) && typeof cardDisabled === 'boolean');
      return { cardId: card.cardId, cardVisibility, cardDisabled,
        visibility: collectionVisibility === 'PRIVATE' || cardVisibility === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC',
        preference: offersDisabled || cardDisabled ? 'DISABLED' : 'OPEN_TO_OFFERS',
        canReceiveOffers: false, notificationDelivery: 'NOT_REQUESTED' };
    }) };
}
