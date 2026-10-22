// Closed transport values, never authority. No network, storage or mutation.
import { requireThat } from '@atlas/manual-service/contract';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const record = v => v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;
const exact = (v, names) => record(v) && Reflect.ownKeys(v).length === names.length
  && names.every(k => Object.hasOwn(Object.getOwnPropertyDescriptor(v, k) ?? {}, 'value'));
const id = v => typeof v === 'string' && UUID.test(v);
const revision = v => Number.isSafeInteger(v) && v >= 0 && v <= 2147483647;
const visibility = v => v === 'PRIVATE' || v === 'PUBLIC';
const date = v => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(v) && Number.isFinite(Date.parse(v));
const input = ok => requireThat(ok, 400, 'INVALID_OWNERSHIP_PREFERENCES');
const response = ok => requireThat(ok, 503, 'OWNERSHIP_PREFERENCES_RESPONSE_INVALID');
const shapes = Object.freeze({ read_access: [], read_preferences: [], read_card: ['cardId'], recover_request: ['requestId'],
  set_collection_preferences: ['requestId', 'expectedPreferenceRevision', 'visibility', 'offersDisabled'],
  set_card_preferences: ['requestId', 'cardId', 'expectedOwnershipRevision', 'expectedPreferenceRevision', 'visibility', 'offersDisabled'] });
export const OWNERSHIP_PREFERENCES_ACTIONS = Object.freeze(Object.keys(shapes));
export const isOwnershipPreferenceWrite = action => action === 'set_collection_preferences' || action === 'set_card_preferences';
export function ownershipPreferencesInput(action, value) {
  requireThat(Object.hasOwn(shapes, action), 403, 'OWNERSHIP_PREFERENCES_ONLY');
  input(exact(value, shapes[action]));
  const copy = Object.fromEntries(shapes[action].map(k => [k, value[k]]));
  for (const k of ['requestId', 'cardId']) if (Object.hasOwn(copy, k)) input(id(copy[k]));
  for (const k of ['expectedOwnershipRevision', 'expectedPreferenceRevision']) if (Object.hasOwn(copy, k))
    input(revision(copy[k]) && copy[k] < 2147483647);
  if (isOwnershipPreferenceWrite(action)) input(visibility(copy.visibility) && typeof copy.offersDisabled === 'boolean');
  return Object.freeze(copy);
}
const preference = (v, accountId) => {
  response(exact(v, ['accountId', 'revision', 'visibility', 'offersDisabled']) && v.accountId === accountId
    && revision(v.revision) && visibility(v.visibility) && typeof v.offersDisabled === 'boolean');
  return { accountId, revision: v.revision, visibility: v.visibility, offersDisabled: v.offersDisabled };
};
const sameInput = (a, b) => Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(k => a[k] === b[k]);

/** expectedAccountId must come from a separate live SQL access read, not from
 * this result or the browser. Receipt and current state are different schemas. */
export function projectOwnershipPreferences(action, value, rawInput, expectedAccountId) {
  const request = ownershipPreferencesInput(action, rawInput);
  response(record(value) && id(expectedAccountId) && value.accountId === expectedAccountId && date(value.observedAt));
  const base = { accountId: expectedAccountId, observedAt: value.observedAt };
  if (isOwnershipPreferenceWrite(action) && Object.hasOwn(value, 'observedPreferenceRevision')) {
    response(exact(value, ['accountId', 'observedAt', 'requestId', 'action', 'cardId', 'input', 'observedPreferenceRevision'])
      && value.requestId === request.requestId && value.action === action && value.cardId === (request.cardId ?? null)
      && revision(value.observedPreferenceRevision) && value.observedPreferenceRevision > request.expectedPreferenceRevision);
    let original; try { original = ownershipPreferencesInput(action, value.input); } catch { response(false); }
    response(sameInput(original, request));
    return { schema: 'atlas-ownership-preferences-stale-v1', ...base, outcome: 'NOT_APPLIED_STALE', requestId: request.requestId,
      action, cardId: request.cardId ?? null, input: original, observedPreferenceRevision: value.observedPreferenceRevision };
  }
  if (action === 'read_access') {
    response(exact(value, ['accountId', 'observedAt']));
    return { schema: 'atlas-ownership-preferences-access-v1', ...base };
  }
  if (action === 'read_preferences' || action === 'read_card') {
    response(exact(value, ['accountId', 'observedAt', 'collectionPreferences', 'cardPreferences']));
    const collectionPreferences = preference(value.collectionPreferences, expectedAccountId);
    let cardPreferences = null;
    if (action === 'read_card') {
      const c = value.cardPreferences;
      response(exact(c, ['cardId', 'ownershipRevision', 'revision', 'visibility', 'offersDisabled']) && c.cardId === request.cardId
        && revision(c.ownershipRevision) && c.ownershipRevision > 0 && revision(c.revision) && visibility(c.visibility) && typeof c.offersDisabled === 'boolean');
      cardPreferences = { cardId: c.cardId, ownershipRevision: c.ownershipRevision, revision: c.revision, visibility: c.visibility, offersDisabled: c.offersDisabled };
    } else response(value.cardPreferences === null);
    return { schema: 'atlas-ownership-preferences-current-v1', ...base, collectionPreferences, cardPreferences,
      effective: { visibility: collectionPreferences.visibility === 'PRIVATE' || cardPreferences?.visibility === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC',
        preference: collectionPreferences.offersDisabled || cardPreferences?.offersDisabled ? 'DISABLED' : 'OPEN_TO_OFFERS',
        canReceiveOffers: false, notificationDelivery: 'NOT_REQUESTED' } };
  }
  response(exact(value, ['accountId', 'observedAt', 'requestId', 'receipt']) && value.requestId === request.requestId);
  if (value.receipt === null) {
    response(action === 'recover_request');
    return { schema: 'atlas-ownership-preferences-receipt-v1', ...base, requestId: request.requestId, outcome: 'ABSENT', receipt: null };
  }
  const r = value.receipt;
  response(exact(r, ['eventId', 'requestId', 'action', 'kind', 'cardId', 'input', 'preferenceRevision', 'recordedAt'])
    && id(r.eventId) && r.requestId === request.requestId && isOwnershipPreferenceWrite(r.action) && date(r.recordedAt)
    && Date.parse(r.recordedAt) <= Date.parse(value.observedAt)
    && r.kind === (r.action === 'set_card_preferences' ? 'CARD_PREFERENCES_SET' : 'COLLECTION_PREFERENCES_SET'));
  let savedInput;
  try { savedInput = ownershipPreferencesInput(r.action, r.input); } catch { response(false); }
  response(savedInput.requestId === r.requestId && revision(r.preferenceRevision) && r.preferenceRevision === savedInput.expectedPreferenceRevision + 1
    && r.cardId === (r.action === 'set_card_preferences' ? savedInput.cardId : null));
  if (action !== 'recover_request') response(r.action === action && sameInput(savedInput, request));
  return { schema: 'atlas-ownership-preferences-receipt-v1', ...base, requestId: request.requestId, outcome: 'RECORDED',
    receipt: { eventId: r.eventId, requestId: r.requestId, action: r.action, kind: r.kind, cardId: r.cardId,
      input: savedInput, preferenceRevision: r.preferenceRevision, recordedAt: r.recordedAt } };
}
