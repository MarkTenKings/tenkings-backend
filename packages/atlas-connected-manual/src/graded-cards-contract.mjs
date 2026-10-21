import { canonical, digest, requireThat } from '@atlas/manual-service/contract';

// Shared by the signed staff proxy and private handler. Keep this dependency
// graph limited to pure validation: no service, database, media or provider.
export const GRADED_CARDS_PATH = '/api/staff/manual-connected/graded-cards';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const check = value => requireThat(value, 400, 'INVALID_GRADED_CARDS_QUERY');
const shape = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).every(key => keys.includes(key));
const date = value => DATE.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
export const gradedCardsInstant = value => typeof value === 'string' && INSTANT.test(value) && Number.isFinite(Date.parse(value)) && date(value.slice(0, 10));

export function gradedCardsListInput(input = {}) {
  check(shape(input, ['q', 'category', 'from', 'to', 'cursor', 'limit']));
  const q = input.q ?? '', category = input.category ?? '', from = input.from ?? '', to = input.to ?? '';
  check(typeof q === 'string' && q.length <= 120 && !/[\x00-\x1f\x7f]/.test(q));
  check(['', 'SPORTS', 'POKEMON'].includes(category));
  check(typeof from === 'string' && typeof to === 'string' && (!from || date(from)) && (!to || date(to)) && (!from || !to || from <= to));
  const limit = typeof input.limit === 'string' && /^[1-9][0-9]?$/.test(input.limit) ? Number(input.limit) : input.limit ?? 24;
  check(Number.isInteger(limit) && limit >= 1 && limit <= 50);
  const filters = { q: q.trim(), category, from, to }, filter = digest(canonical(filters));
  let page = null;
  if (input.cursor !== undefined && input.cursor !== null) {
    check(typeof input.cursor === 'string' && /^[A-Za-z0-9_-]{1,512}$/.test(input.cursor));
    try {
      const bytes = Buffer.from(input.cursor, 'base64url');
      check(bytes.toString('base64url') === input.cursor);
      page = JSON.parse(bytes.toString('utf8'));
    } catch { check(false); }
    check(shape(page, ['v', 'filter', 'snapshot', 'approvedAt', 'cardId']) && Object.keys(page).length === 5
      && page.v === 1 && page.filter === filter && gradedCardsInstant(page.snapshot) && gradedCardsInstant(page.approvedAt)
      && UUID.test(page.cardId ?? '') && page.approvedAt <= page.snapshot);
  }
  return { ...filters, limit, page };
}

export function gradedCardsQuery(url) {
  const input = {};
  for (const [key, value] of url.searchParams) {
    check(['q', 'category', 'from', 'to', 'cursor', 'limit'].includes(key) && !Object.hasOwn(input, key)
      && value.length <= (key === 'cursor' ? 512 : 120));
    input[key] = value;
  }
  gradedCardsListInput(input);
  return input;
}
