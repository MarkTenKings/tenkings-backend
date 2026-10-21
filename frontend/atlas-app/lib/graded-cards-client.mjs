import { validGradedCardsQueryPath } from './routes.mjs';

export const GRADED_CARDS_BASE = 'manual-connected/graded-cards';
const cardIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const cursorPattern = /^[A-Za-z0-9_-]{1,512}$/;
export function gradedCardsPath({ q = '', category = '', from = '', to = '', cursor, limit = 24 } = {}) {
  const query = new URLSearchParams();
  if (q.trim()) query.set('q', q.trim().slice(0, 120));
  if (category) query.set('category', category);
  if (from) query.set('from', from);
  if (to) query.set('to', to);
  query.set('limit', String(limit));
  if (cursor) query.set('cursor', cursor);
  const path = `${GRADED_CARDS_BASE}?${query}`;
  if (!validGradedCardsQueryPath(path)) throw Object.assign(new Error('Check the approval dates and search filters.'), { code: 'GRADED_CARDS_FILTER_INVALID' });
  return path;
}
// Read the submitted controls, including native date-picker/autofill values
// that may arrive without a delegated React change event.
export function gradedCardsFormFilters(data) {
  const filters = Object.fromEntries(['q', 'category', 'from', 'to'].map(name => [name, data.get(name) ?? '']));
  if (Object.values(filters).some(value => typeof value !== 'string'))
    throw Object.assign(new Error('Check the approval dates and search filters.'), { code: 'GRADED_CARDS_FILTER_INVALID' });
  filters.q = filters.q.trim();
  gradedCardsPath(filters);
  return filters;
}
export function readGradedCardsPage(value) {
  if (value?.schemaVersion !== 1 || !Array.isArray(value.cards) || value.cards.length > 50
    || value.cards.some(card => !cardIdPattern.test(card?.cardId ?? ''))
    || !(value.nextCursor === null || typeof value.nextCursor === 'string' && cursorPattern.test(value.nextCursor))) {
    throw Object.assign(new Error('The graded-card archive reply could not be verified.'), { code: 'GRADED_CARDS_REPLY_INVALID' });
  }
  return { cards: value.cards, nextCursor: value.nextCursor };
}
export function mergeGradedCards(previous, incoming) {
  return [...new Map([...previous, ...incoming].map(card => [card.cardId, card])).values()];
}
export const gradedCardTitle = card => card?.identity?.playerName || card?.identity?.cardName || 'Identity not recorded';
export const gradedCardSubtitle = card => [card?.identity?.year, card?.identity?.manufacturer, card?.identity?.productSet].filter(Boolean).join(' · ');
export const gradedCardVariation = card => [card?.identity?.parallel, card?.identity?.insert, card?.identity?.cardNumber && `#${card.identity.cardNumber}`].filter(Boolean).join(' · ');
// Historical approved values are displayed as saved, never rounded again.
export const recordedGrade = card => Number.isFinite(card?.finalGrade) && card.finalGrade >= 1 && card.finalGrade <= 10 ? String(card.finalGrade) : 'Not recorded';
export const approvedDate = value => value && Number.isFinite(new Date(value).getTime())
  ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(value)) : 'Not recorded';
export function approvedReportPath(card) {
  if (card?.report?.state !== 'PUBLISHED') return null;
  const match = /^\/reports\/(ar_[A-Za-z0-9_-]{24})\?v=([1-9][0-9]{0,9})$/.exec(card.report.path ?? '');
  return match && match[1] === card.report.publicToken && Number(match[2]) === card.report.version ? card.report.path : null;
}
export function gradedCardPath(card) { return cardIdPattern.test(card?.cardId ?? '') ? `/manual/${card.cardId}` : null; }
export const submissionOrigin = card => card?.submission?.channel === 'MAIL_IN' ? 'Mail-in'
  : card?.submission?.channel === 'KIOSK' ? card.submission.dealer?.name || 'Card shop' : 'No linked submission';
export const archiveAccessFailure = error => error?.status === 401 || error?.status === 403
  || ['SIGN_IN_REQUIRED', 'MANUAL_STAFF_CHANGED', 'STAFF_ACCESS_NOT_ENABLED'].includes(error?.code);
export function gradedCardsMessage(error) {
  if (archiveAccessFailure(error)) return 'Your staff access needs to be checked. Sign in again to open graded cards.';
  if (error?.code === 'GRADED_CARDS_FILTER_INVALID') return error.message;
  return 'The graded-card archive could not be read. Try again to load the saved cards.';
}
