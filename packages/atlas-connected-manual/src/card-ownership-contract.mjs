import { requireThat } from '@atlas/manual-service/contract';

// These parsers/projectors are transport boundaries, never an authorization
// capability. Only the separately authenticated SQL writer can establish title.
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const object = value => value && Object.getPrototypeOf(value) === Object.prototype;
const id = value => typeof value === 'string' && UUID.test(value);
const revision = value => Number.isSafeInteger(value) && value >= 0 && value < 2147483647;
const check = value => requireThat(value, 400, 'INVALID_OWNERSHIP_REQUEST');
const response = value => requireThat(value, 503, 'OWNERSHIP_RESPONSE_INVALID');
const fields = (value, names) => check(object(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name)));
const evidence = value => {
  fields(value, ['referenceId', 'sha256']);
  check(id(value.referenceId) && typeof value.sha256 === 'string' && HASH.test(value.sha256));
  return { referenceId: value.referenceId, sha256: value.sha256 };
};

export function cardOwnershipInput(action, input) {
  const common = ['requestId', 'cardId'];
  const shapes = {
    read_card: ['cardId'], read_collection: ['afterCardId', 'limit'], read_preferences: [],
    submit_claim: [...common, 'expectedOwnershipRevision', 'evidence'],
    review_claim: [...common, 'claimId', 'expectedOwnershipRevision', 'decision', 'evidence'],
    propose_transfer: [...common, 'expectedOwnershipRevision', 'recipientAccountId', 'expiresInMinutes'],
    accept_transfer: [...common, 'expectedOwnershipRevision', 'transferId'],
    cancel_transfer: [...common, 'expectedOwnershipRevision', 'transferId'],
    set_card_preferences: [...common, 'expectedOwnershipRevision', 'expectedPreferenceRevision', 'visibility', 'offersDisabled'],
    set_collection_preferences: ['requestId', 'expectedPreferenceRevision', 'visibility', 'offersDisabled'],
  };
  check(Object.hasOwn(shapes, action)); fields(input, shapes[action]);
  const result = { ...input };
  for (const name of ['requestId', 'cardId', 'claimId', 'transferId', 'recipientAccountId']) if (name in result) check(id(result[name]));
  for (const name of ['expectedOwnershipRevision', 'expectedPreferenceRevision']) if (name in result) check(revision(result[name]));
  if ('visibility' in result) check(['PRIVATE', 'PUBLIC'].includes(result.visibility) && typeof result.offersDisabled === 'boolean');
  if ('evidence' in result) result.evidence = evidence(result.evidence);
  if ('decision' in result) check(['VERIFY', 'REJECT'].includes(result.decision));
  if ('expiresInMinutes' in result) check(Number.isInteger(result.expiresInMinutes) && result.expiresInMinutes >= 1 && result.expiresInMinutes <= 10080);
  if (action === 'read_collection') check((result.afterCardId === null || id(result.afterCardId)) && Number.isInteger(result.limit) && result.limit >= 1 && result.limit <= 50);
  return result;
}

export function projectCollectionPreferences(record, viewerAccountId) {
  response(id(viewerAccountId) && object(record) && record.accountId === viewerAccountId && revision(record.revision)
    && ['PRIVATE', 'PUBLIC'].includes(record.visibility) && typeof record.offersDisabled === 'boolean');
  return { schema: 'atlas-collection-preferences-v1', accountId: viewerAccountId, revision: record.revision,
    visibility: record.visibility, offersDisabled: record.offersDisabled };
}

export function projectOwnerCollectionCard(record, viewerAccountId) {
  response(id(viewerAccountId) && object(record));
  if (record.ownership?.status !== 'VERIFIED' || record.ownership.ownerAccountId !== viewerAccountId) return null;
  const own = record.ownership, approved = record.approvedCard, report = approved?.report;
  response(id(record.cardId) && revision(own.revision) && own.revision > 0 && revision(record.cardPreferenceRevision)
    && ['PRIVATE', 'PUBLIC'].includes(record.cardVisibility) && typeof record.cardOffersDisabled === 'boolean'
    && id(approved?.approvalActionId) && /^ATLAS-[A-F0-9]{12}$/.test(approved?.certificateNumber)
    && /^ar_[A-Za-z0-9_-]{24}$/.test(report?.publicToken) && revision(report?.version) && report.version > 0 && HASH.test(report?.publicHash));
  const collection = projectCollectionPreferences(record.collectionPreferences, viewerAccountId);
  const reasons = ['OFFER_DELIVERY_UNAVAILABLE'];
  if (collection.visibility === 'PRIVATE') reasons.push('PRIVATE_COLLECTION');
  if (record.cardVisibility === 'PRIVATE') reasons.push('PRIVATE_CARD');
  if (collection.offersDisabled) reasons.push('COLLECTION_OFFERS_DISABLED');
  if (record.cardOffersDisabled) reasons.push('CARD_OFFERS_DISABLED');
  // Current legal title does not establish present physical possession. This
  // foundation has no offer delivery/negotiation service or listing authority.
  return { schema: 'atlas-owner-collection-card-v1', cardId: record.cardId,
    ownership: { status: 'VERIFIED', ownerAccountId: viewerAccountId, revision: own.revision },
    visibility: collection.visibility === 'PUBLIC' && record.cardVisibility === 'PUBLIC' ? 'PUBLIC' : 'PRIVATE',
    cardVisibility: record.cardVisibility, cardPreferenceRevision: record.cardPreferenceRevision,
    offers: { preference: collection.offersDisabled || record.cardOffersDisabled ? 'DISABLED' : 'OPEN_TO_OFFERS',
      collectionDisabled: collection.offersDisabled, cardDisabled: record.cardOffersDisabled },
    eligibility: { canReceiveOffers: false, reasonCodes: reasons }, notificationDelivery: 'NOT_REQUESTED',
    custody: { status: record.custody?.status === 'RECORDED' ? 'RECORDED' : 'UNKNOWN', currentPhysicalHolder: 'UNKNOWN' },
    approvedCard: { approvalActionId: approved.approvalActionId, certificateNumber: approved.certificateNumber,
      report: { publicToken: report.publicToken, version: report.version, publicHash: report.publicHash } } };
}

export function projectOwnershipResult(action, value) {
  response(object(value));
  if (action === 'read_preferences') return projectCollectionPreferences(value.preferences, value.accountId);
  if (action === 'read_card') {
    const card = projectOwnerCollectionCard(value.card, value.accountId); response(card); return card;
  }
  if (action === 'read_collection') {
    response(id(value.accountId) && Array.isArray(value.cards) && value.cards.length <= 50
      && (value.nextCardId === null || id(value.nextCardId)));
    const preferences = projectCollectionPreferences(value.preferences, value.accountId);
    response(value.cards.every(card => {
      const perCard = projectCollectionPreferences(card.collectionPreferences, value.accountId);
      return perCard.revision === preferences.revision && perCard.visibility === preferences.visibility && perCard.offersDisabled === preferences.offersDisabled;
    }));
    const cards = value.cards.map(card => projectOwnerCollectionCard(card, value.accountId));
    response(cards.every(Boolean) && new Set(cards.map(card => card.cardId)).size === cards.length);
    return { schema: 'atlas-owner-collection-v1', accountId: value.accountId,
      preferences, cards, nextCardId: value.nextCardId };
  }
  response(id(value.eventId) && id(value.requestId) && typeof value.kind === 'string');
  // No evidence references, actor IDs, payment-like amounts or private claims
  // leave a mutation receipt. Replaying returns this exact recorded outcome.
  return { eventId: value.eventId, requestId: value.requestId, kind: value.kind };
}
