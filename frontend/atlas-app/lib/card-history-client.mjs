import { atlasPublicSportsAttributesSchema } from '@atlas/grading-core/identity';
import { parseReportPresentation } from '@atlas/report-view/presentation-contract';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const CURSOR = /^[A-Za-z0-9_-]{1,768}$/;
const invalid = () => Object.assign(new Error('The saved card history could not be verified.'), { code: 'CARD_HISTORY_REPLY_INVALID' });
const check = value => { if (!value) throw invalid(); };
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const instant = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
const score = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10;
const custodyKinds = ['DEPOSIT_DECLARED', 'COLLECTED', 'ATLAS_RECEIVED', 'RETURN_DISPATCHED', 'RETURNED_TO_KIOSK', 'CUSTOMER_COLLECTED', 'MAIL_DISPATCHED', 'CUSTOMER_DELIVERED', 'DELAY_REPORTED', 'DELAY_RESOLVED'];

function cardDetails(card, snapshot) {
  const report = card.report;
  check(historyCardId(card.approvalActionId) && /^ATLAS-[A-F0-9]{12}$/.test(card.certificateNumber ?? '')
    && instant(card.approvedAt) && card.approvedAt <= snapshot && score(card.finalGrade) && card.finalGrade >= 1
    && report && ['PENDING', 'PUBLISHED'].includes(report.state) && positive(report.version) && /^ar_[A-Za-z0-9_-]{24}$/.test(report.publicToken ?? '')
    && (report.reportHash === undefined || hash(report.reportHash))
    && report.path === (report.state === 'PUBLISHED' ? `/reports/${report.publicToken}?v=${report.version}` : null));
  if (report.state === 'PENDING') check(report.publicHash == null && Object.keys(card.media ?? {}).length === 0 && card.savedComparables?.state !== 'SAVED');
  else check(report.publicHash === undefined || hash(report.publicHash));
  for (const side of ['FRONT', 'BACK']) if (card.media?.[side]) check(historyPhotoPath(card, side));
  if (card.identity?.sportsAttributes) {
    check(card.identity.category === 'SPORTS');
    try { atlasPublicSportsAttributesSchema.parse(card.identity.sportsAttributes); } catch { throw invalid(); }
  }
  const summary = card.approvedSummary;
  if (summary !== undefined) {
    check(['AVAILABLE', 'UNAVAILABLE'].includes(summary?.state));
    if (summary.state === 'AVAILABLE') check(typeof summary.ruleVersion === 'string' && summary.ruleVersion.length > 0 && summary.ruleVersion.length <= 180
      && ['atlas-final-whole-point-v1', 'atlas-final-half-point-v1', 'atlas-historical-tenth-v1'].includes(summary.finalGradePolicy)
      && ['centering', 'corners', 'edges', 'surface'].every(key => score(summary.subgrades?.[key])));
  }
  const saved = card.savedComparables;
  if (saved !== undefined) {
    check(['SAVED', 'UNAVAILABLE'].includes(saved?.state));
    if (saved.state === 'SAVED') {
      check(report.state === 'PUBLISHED' && hash(report.publicHash) && saved.selection === 'SAVED_REPORT_SELECTION' && saved.source === 'EBAY_SOLD_LISTINGS'
        && positive(saved.presentationRevision) && Array.isArray(saved.sales) && saved.sales.length > 0 && saved.sales.length <= 600
        && Date.parse(saved.observedAt) <= Date.parse(snapshot));
      try { parseReportPresentation({ version: 'atlas-report-presentation-v1', binding: { publicToken: report.publicToken, approvalVersion: report.version, publicHash: report.publicHash },
        revision: saved.presentationRevision, updatedAt: saved.observedAt, market: { observedAt: saved.observedAt, sales: saved.sales } }); } catch { throw invalid(); }
    }
  }
  if (card.submission != null) check(historyCardId(card.submission.orderId) && historyCardId(card.submission.cardId)
    && ['MAIL_IN', 'KIOSK'].includes(card.submission.channel));
}

function checkedEvent(event, card, snapshot) {
  check(typeof event?.eventId === 'string' && /^(approval|publication|custody):[a-f0-9-]{36}$/.test(event.eventId)
    && historyCardId(event.eventId.split(':')[1]) && instant(event.recordedAt) && event.recordedAt <= snapshot
    && (event.occurredAt === undefined || instant(event.occurredAt)));
  if (event.category === 'GRADING') {
    const published = event.kind === 'REPORT_PUBLISHED', report = event.report;
    check((published || event.kind === 'REPORT_APPROVED') && event.verification === 'VERIFIED_RECORD'
      && event.eventId.startsWith(published ? 'publication:' : 'approval:')
      && positive(report?.version) && report.version <= card.report.version && score(report.finalGrade) && report.finalGrade >= 1
      && (published ? historyReportPath(event, card.report.publicToken) : report.path == null));
    if (event.source) {
      check(event.source.cardId === card.cardId && event.source.type === (published ? 'PUBLICATION' : 'APPROVAL')
        && historyCardId(event.source.approvalActionId) && event.eventId === `${published ? 'publication' : 'approval'}:${event.source.approvalActionId}`
        && hash(event.source.reportHash));
      if (event.source.approvalActionId === card.approvalActionId) check(report.version === card.report.version && report.finalGrade === card.finalGrade
        && event.source.reportHash === card.report.reportHash && (!published || card.report.state === 'PUBLISHED' && event.source.publicHash === card.report.publicHash));
    }
  } else {
    check(event.category === 'CUSTODY' && event.eventId.startsWith('custody:') && custodyKinds.includes(event.kind)
      && event.verification === (event.kind === 'DEPOSIT_DECLARED' ? 'SUBMITTER_REPORTED' : 'VERIFIED_RECORD') && positive(event.sequence));
    if (event.source) check(event.source.cardId === card.cardId && event.source.type === 'CUSTODY'
      && historyCardId(event.source.eventId) && event.eventId === `custody:${event.source.eventId}`);
  }
}

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
    || !instant(value.history.snapshot)
    || !Array.isArray(value.history.events) || value.history.events.length > 100
    || value.history.events.some(event => typeof event?.eventId !== 'string' || event.eventId.length > 200
      || !['GRADING', 'CUSTODY'].includes(event.category)
      || !['VERIFIED_RECORD', 'SUBMITTER_REPORTED'].includes(event.verification)
      || typeof event.recordedAt !== 'string' || !Number.isFinite(Date.parse(event.recordedAt))
      || event.occurredAt != null && (typeof event.occurredAt !== 'string' || !Number.isFinite(Date.parse(event.occurredAt))))
    || !(value.history.nextCursor === null || typeof value.history.nextCursor === 'string' && CURSOR.test(value.history.nextCursor))) throw invalid();
  cardDetails(value.card, value.history.snapshot);
  const seen = new Set(); let previous = null;
  for (const event of value.history.events) {
    checkedEvent(event, value.card, value.history.snapshot);
    const key = `${event.recordedAt}|${event.eventId}`;
    check(!seen.has(event.eventId) && (!previous || key < previous)); seen.add(event.eventId); previous = key;
  }
  return value;
}

export function mergeCardHistory(previous, next) {
  if (!previous) return next;
  if (previous.card.cardId !== next.card.cardId || previous.card.approvalActionId !== next.card.approvalActionId
    || previous.history.snapshot !== next.history.snapshot) throw invalid();
  for (const field of ['certificateNumber', 'approvedAt', 'finalGrade', 'identity', 'report', 'approvedSummary', 'savedComparables', 'submission'])
    check(JSON.stringify(previous.card[field]) === JSON.stringify(next.card[field]));
  const known = new Map(previous.history.events.map(event => [event.eventId, event]));
  const last = previous.history.events.at(-1), boundary = last ? `${last.recordedAt}|${last.eventId}` : null;
  for (const event of next.history.events) {
    if (known.has(event.eventId)) check(JSON.stringify(known.get(event.eventId)) === JSON.stringify(event));
    else if (boundary) check(`${event.recordedAt}|${event.eventId}` < boundary);
  }
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
