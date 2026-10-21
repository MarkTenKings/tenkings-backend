import { requireThat } from '@atlas/manual-service/contract';

// Pure transport contract. Ownership authority is deliberately not accepted as
// request input; a certificate, report token, NFC link or staff ACL is not title.
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ROUTE = /^\/api\/staff\/manual-connected\/cards\/([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\/provenance$/;
const EVENT = /^(?:approval|publication|custody):[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const check = value => requireThat(value, 400, 'INVALID_CARD_PROVENANCE_QUERY');
export const provenanceId = value => typeof value === 'string' && UUID.test(value);
export const provenanceInstant = value => typeof value === 'string' && INSTANT.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
export const provenanceEventId = value => typeof value === 'string' && EVENT.test(value);
export const cardProvenanceRoute = path => typeof path === 'string' ? ROUTE.exec(path)?.[1] ?? null : null;
const object = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).every(key => keys.includes(key));

export function cardProvenanceInput(cardId, input = {}) {
  check(provenanceId(cardId) && object(input, ['cursor', 'limit']));
  const limit = typeof input.limit === 'string' && /^(?:[1-9][0-9]?|100)$/.test(input.limit) ? Number(input.limit) : input.limit ?? 50;
  check(Number.isInteger(limit) && limit >= 1 && limit <= 100);
  let page = null;
  if (input.cursor !== undefined && input.cursor !== null) {
    check(typeof input.cursor === 'string' && /^[A-Za-z0-9_-]{1,768}$/.test(input.cursor));
    try {
      const bytes = Buffer.from(input.cursor, 'base64url');
      check(bytes.toString('base64url') === input.cursor);
      page = JSON.parse(bytes.toString('utf8'));
    } catch { check(false); }
    check(object(page, ['v', 'cardId', 'snapshot', 'recordedAt', 'eventId']) && Object.keys(page).length === 5
      && page.v === 1 && page.cardId === cardId && provenanceInstant(page.snapshot)
      && provenanceInstant(page.recordedAt) && page.recordedAt <= page.snapshot && provenanceEventId(page.eventId));
  }
  return { cardId, limit, page };
}

export function cardProvenanceQuery(url) {
  const cardId = cardProvenanceRoute(url.pathname), input = {};
  check(cardId && !/%(?![a-fA-F0-9]{2})/.test(url.search));
  for (const [key, value] of url.searchParams) {
    check(['cursor', 'limit'].includes(key) && !Object.hasOwn(input, key) && value.length <= (key === 'cursor' ? 768 : 3));
    input[key] = value;
  }
  cardProvenanceInput(cardId, input);
  return { cardId, input };
}

export const PROVENANCE_CUSTODY_KINDS = Object.freeze(['DEPOSIT_DECLARED', 'COLLECTED', 'ATLAS_RECEIVED', 'RETURN_DISPATCHED',
  'RETURNED_TO_KIOSK', 'CUSTOMER_COLLECTED', 'MAIL_DISPATCHED', 'CUSTOMER_DELIVERED', 'DELAY_REPORTED', 'DELAY_RESOLVED']);
// Future reviewed claims must distinguish these states. None is manufactured
// from grading/submission/custody records by this read-only foundation.
export const OWNERSHIP_VERIFICATION = Object.freeze(['VERIFIED', 'OWNER_REPORTED', 'UNKNOWN']);
export const unknownOwnership = () => ({ status: 'UNKNOWN', verification: 'UNKNOWN', history: [], reason: 'NO_REVIEWED_OWNERSHIP_RECORD' });
