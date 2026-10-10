import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID, webcrypto } from 'node:crypto';
import { acknowledgmentConfirmed, acknowledgmentJournal, mergeOrderPage, orderDeskPath, orderLabelBytes, orderMoney, orderPhotoPath, retainedSelection, stageLabel } from '../lib/order-desk-client.mjs';
import { staffApiPath, validOrderDeskQueryPath } from '../lib/routes.mjs';
const storage = () => { const rows = new Map(); return { getItem: k => rows.get(k) ?? null, setItem: (k, v) => rows.set(k, v), removeItem: k => rows.delete(k) }; };

test('order desk queries safely encode customer text while unrelated paths keep the existing strict boundary', () => {
  for (const q of ['Maya Chen', 'mark+desk@example.com', 'O’Neil / 台灣', '100% & paid', 'O\'Brien']) {
    const path = orderDeskPath({ q }); assert.equal(validOrderDeskQueryPath(path), true); assert.equal(staffApiPath(path), `/admin/api/staff/${path}`);
    assert.equal(new URLSearchParams(path.split('?')[1]).get('q'), q);
  }
  assert.equal(new URLSearchParams(orderDeskPath({ q: 'x'.repeat(121) }).split('?')[1]).get('q').length, 120);
  for (const path of ['manual-connected/order-desk?q=first&q=second', 'manual-connected/order-desk?view=none', 'manual-connected/order-desk?limit=51', 'manual-connected/order-desk?limit=01', 'manual-connected/order-desk?stage=GUESSED', 'manual-connected/order-desk?unknown=true', 'manual-connected/order-desk?q=%', 'manual-connected/order-desk?q=%00', 'manual-connected/order-desk?q=one%20two', 'manual-connected/order-desk?q=x#hash', 'manual-connected/order-desk?cursor=abc%3D', 'other?q=mark%40example.com']) assert.throws(() => staffApiPath(path), /INVALID_STAFF_PATH/, path);
  assert.equal(staffApiPath('manual-connected/dealer-operations'), '/admin/api/staff/manual-connected/dealer-operations');
});

test('customer photo URLs stay authenticated and bind exact order, card, side and size', () => {
  const order = randomUUID(), card = randomUUID();
  assert.equal(orderPhotoPath(order, card, 'BACK', 'detail'), `/admin/api/staff/manual-connected/order-desk/orders/${order}/cards/${card}/photos/BACK?size=detail`);
  for (const args of [['../other', card], [order, 'x'], [order, card, 'front'], [order, card, 'FRONT', 'original']]) assert.equal(orderPhotoPath(...args), null);
});

test('paid amount is never fabricated from card count or interpreted as zero when absent', () => {
  assert.equal(orderMoney(null), 'Not recorded'); assert.equal(orderMoney(undefined), 'Not recorded');
  assert.equal(orderMoney(0), '$0.00'); assert.equal(orderMoney(8640), '$86.40');
  assert.equal(stageLabel('MIXED'), 'Mixed card stages'); assert.equal(stageLabel('invented'), 'Stage not available');
});

test('pagination deduplicates exact order IDs while retaining the latest returned record', () => {
  const a = { id: randomUUID(), reference: 'A' }, b = { id: randomUUID(), reference: 'B' };
  assert.deepEqual(mergeOrderPage([a], [b, { ...a, reference: 'updated' }], true), [{ ...a, reference: 'updated' }, b]);
  assert.deepEqual(mergeOrderPage([a], [b]), [b]);
});

test('uncertain acknowledgment survives reload with exact identity and is isolated by staff', () => {
  const local = storage(), staffId = randomUUID(), orderId = randomUUID(), requestId = randomUUID();
  const row = { version: 1, staffId, orderId, requestId, accepted: false }, journal = acknowledgmentJournal(local, staffId);
  assert.equal(journal.read(), null); journal.save(row);
  assert.deepEqual(acknowledgmentJournal(local, staffId).read(), row); assert.equal(acknowledgmentJournal(local, randomUUID()).read(), null);
  journal.save({ ...row, accepted: true }); assert.equal(journal.read().requestId, requestId);
  journal.clear(); assert.equal(journal.read(), null);
});

test('unreadable or blocked acknowledgment storage prevents a usable mutation journal', () => {
  const local = storage(), staffId = randomUUID(), journal = acknowledgmentJournal(local, staffId);
  local.setItem(journal.key, '{'); assert.throws(() => journal.read(), /could not be read/);
  local.setItem(journal.key, JSON.stringify({ version: 1, staffId: randomUUID(), orderId: randomUUID(), requestId: randomUUID(), accepted: false })); assert.throws(() => journal.read(), /needs review/);
  const blocked = acknowledgmentJournal({ ...storage(), setItem() {} }, staffId);
  assert.throws(() => blocked.save({ version: 1, staffId, orderId: randomUUID(), requestId: randomUUID(), accepted: false }), /Nothing was sent/);
});

test('shared acknowledgment requires saved staff and timestamp, independent of reading or selection', () => {
  assert.equal(acknowledgmentConfirmed({ opened: true }), false); assert.equal(acknowledgmentConfirmed({ acknowledgment: null }), false);
  assert.equal(acknowledgmentConfirmed({ acknowledgment: { acknowledgedAt: '2026-10-09T00:00:00Z', acknowledgedBy: { id: randomUUID(), name: 'Reviewer' } } }), true);
  assert.equal(acknowledgmentConfirmed({ acknowledgment: { acknowledgedAt: '2026-10-09T00:00:00Z', acknowledgedBy: { name: 'Reviewer' } } }), false);
});

test('selection stores only valid order identity and no mutation or customer data', () => {
  const session = storage(), staffId = randomUUID(), orderId = randomUUID();
  assert.equal(retainedSelection(session, staffId), null); retainedSelection(session, staffId, orderId);
  assert.equal(retainedSelection(session, staffId), orderId); retainedSelection(session, staffId, 'invalid'); assert.equal(retainedSelection(session, staffId), orderId);
});

test('inbound label download validates exact order, direction, PDF bytes and saved hash', async () => {
  const bytes = new Uint8Array(Buffer.from('%PDF-1.7\nSynthetic inbound\n%%EOF')), orderId = randomUUID();
  const label = { orderId, leg: 'INBOUND', mimeType: 'application/pdf', bytes, labelSha256: createHash('sha256').update(bytes).digest('hex') };
  assert.deepEqual(await orderLabelBytes(label, orderId, 'INBOUND', webcrypto.subtle), bytes);
  for (const change of [{ orderId: randomUUID() }, { leg: 'RETURN' }, { mimeType: 'text/html' }, { bytes: new Uint8Array([1, 2]) }, { labelSha256: 'f'.repeat(64) }]) await assert.rejects(orderLabelBytes({ ...label, ...change }, orderId, 'INBOUND', webcrypto.subtle), /could not be verified/);
});
