import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readCardHistory, mergeCardHistory } from '../lib/card-history-client.mjs';

const hash = 'a'.repeat(64), snapshot = '2026-10-21T00:00:00.000000Z', approvedAt = '2026-10-20T00:00:00.000000Z';
function fixture() {
  const cardId = randomUUID(), approvalActionId = randomUUID(), publicToken = `ar_${'a'.repeat(24)}`;
  const card = { cardId, approvalActionId, certificateNumber: 'ATLAS-ABCDEF123456', identity: { category: 'SPORTS', playerName: 'Saved card' }, finalGrade: 8.5, approvedAt,
    report: { state: 'PUBLISHED', version: 2, publicToken, publicHash: hash, reportHash: hash, path: `/reports/${publicToken}?v=2` },
    media: { FRONT: { url: `/api/reports/${publicToken}/images/FRONT?v=2` } },
    approvedSummary: { state: 'AVAILABLE', ruleVersion: 'SAVED_RULE', finalGradePolicy: 'atlas-final-half-point-v1', subgrades: { centering: 9.1, corners: 8.5, edges: 8.2, surface: 8.3 } },
    savedComparables: { state: 'SAVED', selection: 'SAVED_REPORT_SELECTION', source: 'EBAY_SOLD_LISTINGS', presentationRevision: 3, observedAt: '2026-10-20T10:00:00.000Z',
      sales: [{ id: 'sale-1', title: 'Saved eBay sale', listingUrl: 'https://www.ebay.com/itm/123456789012', soldAt: '2026-10-01T00:00:00.000Z',
        grader: 'PSA', grade: '9', priceMinor: 12345, currency: 'USD', priceBasis: 'sold' }] } };
  const event = { eventId: `publication:${approvalActionId}`, kind: 'REPORT_PUBLISHED', category: 'GRADING', verification: 'VERIFIED_RECORD',
    occurredAt: '2026-10-20T01:00:00.000000Z', recordedAt: '2026-10-20T01:00:00.000000Z',
    source: { type: 'PUBLICATION', cardId, approvalActionId, publicHash: hash, reportHash: hash },
    report: { version: 2, finalGrade: 8.5, approvedAt, path: card.report.path } };
  return { schemaVersion: 1, card, ownership: { status: 'UNKNOWN', verification: 'UNKNOWN', history: [] }, custody: { status: 'UNKNOWN', currentPhysicalHolder: 'UNKNOWN' },
    history: { scope: 'RECORDED_ATLAS_EVENTS', complete: false, snapshot, events: [event], nextCursor: null } };
}

test('client preserves saved half-point award, decimal categories and disclosed sale amount without inventing value', () => {
  const value = fixture(); assert.equal(readCardHistory(value, value.card.cardId), value);
  assert.equal(value.card.finalGrade, 8.5); assert.equal(value.card.approvedSummary.subgrades.centering, 9.1);
  assert.equal(value.card.savedComparables.sales[0].priceMinor, 12345);
  value.card.savedComparables.sales[0].priceMinor = null; value.card.savedComparables.sales[0].priceBasis = 'accepted_offer_unknown';
  assert.equal(readCardHistory(value, value.card.cardId).card.savedComparables.sales[0].priceMinor, null);
});

test('client refuses cross-card, wrong version, source hash, future record and unsafe public links', () => {
  for (const change of [value => value.history.events[0].source.cardId = randomUUID(), value => value.history.events[0].report.version = 1,
    value => value.history.events[0].source.reportHash = 'b'.repeat(64), value => value.card.report.publicHash = 'b'.repeat(64),
    value => value.card.report.path = 'https://attacker.invalid', value => value.card.media.FRONT.url += '&x=1',
    value => value.history.events[0].recordedAt = '2026-10-22T01:00:00.000000Z', value => value.history.snapshot = '2026-02-30T00:00:00.000000Z',
    value => value.history.events[0].kind = 'OWNERSHIP_TRANSFER', value => value.card.approvedSummary.subgrades.surface = 11,
    value => value.card.savedComparables.sales[0].listingUrl = 'javascript:alert(1)',
    value => value.card.savedComparables.sales[0].imageUrl = 'https://private.invalid/photo.jpg',
    value => value.card.savedComparables.sales[0].priceBasis = 'accepted_offer_unknown',
    value => value.card.savedComparables.observedAt = '2026-10-22T00:00:00.000Z',
    value => value.card.savedComparables.selection = 'UNSELECTED_CANDIDATES']) {
    const value = fixture(); change(value); assert.throws(() => readCardHistory(value, value.card.cardId), { code: 'CARD_HISTORY_REPLY_INVALID' });
  }
});

test('unpublished snapshots cannot carry public photos, saved sale sections or report links', () => {
  const value = fixture(); value.history.events = []; value.card.report.state = 'PENDING'; value.card.report.path = null;
  assert.throws(() => readCardHistory(value, value.card.cardId));
  delete value.card.report.publicHash; value.card.media = {}; value.card.savedComparables = { state: 'UNAVAILABLE' };
  assert.equal(readCardHistory(value, value.card.cardId), value);
  value.card.report.path = `/reports/${value.card.report.publicToken}?v=2`; assert.throws(() => readCardHistory(value, value.card.cardId));
});

test('snapshot pagination refuses approval/version/detail swaps and conflicting duplicate events', () => {
  const first = fixture(), next = structuredClone(first);
  assert.equal(mergeCardHistory(first, next).history.events.length, 1);
  for (const change of [value => value.card.report.version = 3, value => value.card.report.publicToken = `ar_${'b'.repeat(24)}`,
    value => value.card.report.publicHash = 'b'.repeat(64), value => value.card.finalGrade = 9,
    value => value.card.approvedSummary.subgrades.centering = 10, value => value.card.savedComparables.presentationRevision++,
    value => value.card.identity.playerName = 'Changed identity', value => value.history.events[0].report.finalGrade = 9]) {
    const swapped = structuredClone(next); change(swapped); assert.throws(() => mergeCardHistory(first, swapped), { code: 'CARD_HISTORY_REPLY_INVALID' });
  }
  const older = structuredClone(first.history.events[0]); older.eventId = `publication:${randomUUID()}`; older.recordedAt = '2026-10-19T00:00:00.000000Z';
  next.history.events = [older]; assert.equal(mergeCardHistory(first, next).history.events.length, 2);
  older.recordedAt = snapshot; assert.throws(() => mergeCardHistory(first, next));
});

test('historical replies without optional summary/comps fields retain their original meaning', () => {
  const value = fixture(); delete value.card.approvedSummary; delete value.card.savedComparables;
  assert.equal(readCardHistory(value, value.card.cardId).card.identity.sportsAttributes, undefined);
  value.card.approvedSummary = { state: 'UNAVAILABLE' }; value.card.savedComparables = { state: 'UNAVAILABLE' };
  assert.equal(readCardHistory(value, value.card.cardId), value);
});
