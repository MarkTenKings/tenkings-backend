import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { staffApiPath, validGradedCardsQueryPath } from '../lib/routes.mjs';
import { approvedDate, approvedReportPath, gradedCardPath, gradedCardsFormFilters, gradedCardsPath, mergeGradedCards, readGradedCardsPage, recordedGrade, submissionOrigin } from '../lib/graded-cards-client.mjs';

test('archive cards open the dedicated saved-card detail and reject malformed destinations', () => {
  const cardId = 'aac6bff4-5f2a-4e5c-a9cd-4fef01f18454';
  assert.equal(gradedCardPath({ cardId }), `/graded-cards/${cardId}`);
  for (const value of [undefined, '', '../manual', `${cardId}?edit=1`]) assert.equal(gradedCardPath({ cardId: value }), null);
});

test('archive search encodes literal Unicode text and uses bounded server filters', () => {
  for (const q of ['O’Neil / 台灣', '100% & paid', 'Pikachu ex', 'mark+desk@example.test', 'ATLAS-0001']) {
    const path = gradedCardsPath({ q, category: 'POKEMON', from: '2026-10-01', to: '2026-10-20', cursor: 'eyJhIjoxfQ' });
    assert.equal(validGradedCardsQueryPath(path), true);
    assert.equal(staffApiPath(path), `/admin/api/staff/${path}`);
    const query = new URLSearchParams(path.split('?')[1]);
    assert.equal(query.get('q'), q); assert.equal(query.get('limit'), '24');
  }
  assert.equal(new URLSearchParams(gradedCardsPath({ q: ` ${'x'.repeat(130)} ` }).split('?')[1]).get('q').length, 120);
});
test('archive query rejects duplicates, alternate encoding, unknown filters, bad dates and unbounded cursors', () => {
  for (const query of ['q=one&q=two', 'q=one%20two', 'q=%00', 'q=%', 'q=+one', 'category=OTHER', 'limit=51', 'limit=01', 'from=2026-02-30', 'from=2026-10-20&to=2026-10-01', 'cursor=a%3D', `cursor=${'a'.repeat(513)}`, 'ownerId=someone', 'q=hello#fragment']) {
    assert.throws(() => staffApiPath(`manual-connected/graded-cards?${query}`), /INVALID_STAFF_PATH/, query);
  }
  assert.throws(() => gradedCardsPath({ from: '2026-02-30' }), /Check the approval dates/);
  assert.throws(() => staffApiPath('other?q=mark%40example.test'), /INVALID_STAFF_PATH/);
});
test('submitted native date values form a valid inclusive query without prior change events', () => {
  const form = new FormData();
  form.set('q', '  Second page specimen  '); form.set('category', 'SPORTS');
  form.set('from', '2026-10-02'); form.set('to', '2026-10-02');
  const filters = gradedCardsFormFilters(form);
  assert.deepEqual(filters, { q: 'Second page specimen', category: 'SPORTS', from: '2026-10-02', to: '2026-10-02' });
  const query = new URLSearchParams(gradedCardsPath(filters).split('?')[1]);
  assert.equal(query.get('from'), '2026-10-02'); assert.equal(query.get('to'), '2026-10-02');
  form.set('to', '2026-10-01');
  assert.throws(() => gradedCardsFormFilters(form), /Check the approval dates/);
  assert.deepEqual(gradedCardsFormFilters(new FormData()), { q: '', category: '', from: '', to: '' });
});
test('archive pages require bounded results and deduplicate immutable physical card IDs', () => {
  const first = { cardId: randomUUID(), finalGrade: 8.5 }, second = { cardId: randomUUID(), finalGrade: 10 };
  const page = { schemaVersion: 1, cards: [first], nextCursor: 'eyJhIjoxfQ' };
  assert.deepEqual(readGradedCardsPage(page), { cards: [first], nextCursor: page.nextCursor });
  assert.deepEqual(mergeGradedCards([first], [second, { ...first, finalGrade: 9 }]), [{ ...first, finalGrade: 9 }, second]);
  for (const value of [{ ...page, schemaVersion: 2 }, { ...page, cards: [{}] }, { ...page, cards: Array(51).fill(first) }, { ...page, nextCursor: '../other' }]) assert.throws(() => readGradedCardsPage(value));
});
test('saved historical grades and explicit absence remain unchanged by new award policy', () => {
  for (const finalGrade of [8, 8.5, 9.7, 10]) assert.equal(recordedGrade({ finalGrade }), String(finalGrade));
  for (const finalGrade of [null, undefined, NaN, 0, 11]) assert.equal(recordedGrade({ finalGrade }), 'Not recorded');
  assert.equal(approvedDate('2026-10-17T00:30:00Z'), 'Oct 17, 2026');
  assert.equal(approvedDate(null), 'Not recorded');
});
test('public report links bind the exact published token and version', () => {
  const token = `ar_${'a'.repeat(24)}`, path = `/reports/${token}?v=2`;
  const card = { report: { state: 'PUBLISHED', publicToken: token, version: 2, path } };
  assert.equal(approvedReportPath(card), path);
  for (const change of [{ state: 'PENDING' }, { version: 1 }, { publicToken: `ar_${'b'.repeat(24)}` }, { path: 'https://hostile.example/report' }, { path: `${path}&other=1` }]) assert.equal(approvedReportPath({ report: { ...card.report, ...change } }), null);
});
test('submission origin never claims customer ownership or ATLAS custody', () => {
  assert.equal(submissionOrigin({}), 'No linked submission');
  assert.equal(submissionOrigin({ submission: { channel: 'MAIL_IN' } }), 'Mail-in');
  assert.equal(submissionOrigin({ submission: { channel: 'KIOSK', dealer: { name: 'Recorded shop' } } }), 'Recorded shop');
});
