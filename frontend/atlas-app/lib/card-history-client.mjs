const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const CURSOR = /^[A-Za-z0-9_-]{1,768}$/;
const invalid = () => Object.assign(new Error('The saved card history could not be verified.'), { code: 'CARD_HISTORY_REPLY_INVALID' });

export const historyCardId = value => typeof value === 'string' && UUID.test(value) ? value : null;
export const cardHistoryPagePath = cardId => historyCardId(cardId) ? `/graded-cards/${cardId}` : null;
export function cardHistoryPath(cardId, { cursor, limit = 50 } = {}) {
  if (!historyCardId(cardId) || !Number.isInteger(limit) || limit < 1 || limit > 100
    || cursor !== undefined && (typeof cursor !== 'string' || !CURSOR.test(cursor))) throw invalid();
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor) query.set('cursor', cursor);
  return `manual-connected/cards/${cardId}/provenance?${query}`;
}

export function readCardHistory(value, cardId) {
  if (value?.schemaVersion !== 1 || !historyCardId(cardId) || value.card?.cardId !== cardId
    || value.ownership?.status !== 'UNKNOWN' || value.ownership?.verification !== 'UNKNOWN'
    || value.custody?.currentPhysicalHolder !== 'UNKNOWN' || !['RECORDED', 'UNKNOWN'].includes(value.custody?.status)
    || value.history?.scope !== 'RECORDED_ATLAS_EVENTS' || value.history?.complete !== false
    || typeof value.history.snapshot !== 'string' || !Number.isFinite(Date.parse(value.history.snapshot))
    || !Array.isArray(value.history.events) || value.history.events.length > 100
    || value.history.events.some(event => typeof event?.eventId !== 'string' || event.eventId.length > 200
      || !['GRADING', 'CUSTODY'].includes(event.category)
      || !['VERIFIED_RECORD', 'SUBMITTER_REPORTED'].includes(event.verification)
      || typeof event.recordedAt !== 'string' || !Number.isFinite(Date.parse(event.recordedAt))
      || event.occurredAt != null && (typeof event.occurredAt !== 'string' || !Number.isFinite(Date.parse(event.occurredAt))))
    || !(value.history.nextCursor === null || typeof value.history.nextCursor === 'string' && CURSOR.test(value.history.nextCursor))) throw invalid();
  return value;
}

export function mergeCardHistory(previous, next) {
  if (!previous) return next;
  if (previous.card.cardId !== next.card.cardId || previous.card.approvalActionId !== next.card.approvalActionId
    || previous.history.snapshot !== next.history.snapshot) throw invalid();
  return { ...previous, history: { ...previous.history, nextCursor: next.history.nextCursor,
    events: [...new Map([...previous.history.events, ...next.history.events].map(event => [event.eventId, event])).values()] } };
}

export function historyReportPath(event, token) {
  const value = event?.report?.path;
  return typeof value === 'string' && /^ar_[A-Za-z0-9_-]{24}$/.test(token ?? '')
    && value === `/reports/${token}?v=${event.report.version}` && Number.isInteger(event.report.version) && event.report.version > 0 ? value : null;
}
export function historyPhotoPath(card, side) {
  const token = card?.report?.publicToken, version = card?.report?.version, url = card?.media?.[side]?.url;
  return ['FRONT', 'BACK'].includes(side) && card?.report?.state === 'PUBLISHED'
    && /^ar_[A-Za-z0-9_-]{24}$/.test(token ?? '') && Number.isInteger(version) && version > 0
    && url === `/api/reports/${token}/images/${side}?v=${version}` ? url : null;
}
const labels = { REPORT_APPROVED: 'Grade approved', REPORT_PUBLISHED: 'Report published' };
export function historyEventTitle(event) {
  if (labels[event.kind]) return labels[event.kind];
  return event.category === 'CUSTODY' ? 'Custody record' : 'Atlas record';
}
export function historyEventDetail(event) {
  if (event.kind === 'REPORT_APPROVED' || event.kind === 'REPORT_PUBLISHED') {
    const grade = typeof event.report?.finalGrade === 'number' ? ` · ATLAS ${event.report.finalGrade}` : '';
    return `Report version ${event.report?.version ?? 'not recorded'}${grade}`;
  }
  return typeof event.kind === 'string' ? event.kind.toLowerCase().split('_').map(word => word[0]?.toUpperCase() + word.slice(1)).join(' ') : 'Recorded handling event';
}
