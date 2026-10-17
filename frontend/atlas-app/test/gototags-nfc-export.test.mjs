import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildNfcBatch, nfcBatchCsv } from '../lib/gototags-nfc-export.mjs';

function sheet(number = 1, count = 2) {
  const sheetId = randomUUID();
  return { sheetId, number, revision: 1, state: 'OPEN', items: Array.from({ length: count }, (_, i) => ({
    itemId: randomUUID(), cardId: randomUUID(), approvalActionId: randomUUID(), approvalVersion: 2,
    sheetId, slot: i + 1, state: 'READY', purpose: 'ORIGINAL', originalItemId: null, labelHash: 'a'.repeat(64),
    snapshot: { identity: { playerName: `Player ${number}-${i}` }, grade: 9.5, reportNumber: `ATLAS-${number}-${i}`, approvalVersion: 2,
      reportHref: `https://atlasgrading.com/reports/ar_${String(number * 50 + i).padStart(24, '0')}?v=2` },
  })) };
}
const parse = csv => csv.trimEnd().split('\r\n').map(line => [...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(match => match[1].replaceAll('""', '"')));

test('GoToTags CSV preserves exact approved URLs and selected sheet/slot order with permanent lock requested', () => {
  const a = sheet(2), b = sheet(1), original = structuredClone([a, b]); a.items.reverse();
  const batch = buildNfcBatch([a, b]), selected = [a.items[0].itemId, b.items[0].itemId];
  const [headers, ...rows] = parse(nfcBatchCsv(batch, selected));
  assert.deepEqual(headers.slice(0, 4), ['correlationId', 'ndef.lock', 'ndef.records.0.type', 'ndef.records.0.url']);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row.slice(1, 4)), [['TRUE', 'WEBSITE', b.items[0].snapshot.reportHref], ['TRUE', 'WEBSITE', a.items[0].snapshot.reportHref]]);
  assert.equal(rows[0][0], `atlas-${b.items[0].itemId}`); assert.equal(rows[0][4], b.items[0].cardId);
  assert.equal(rows[0][5], b.items[0].approvalActionId); assert.equal(rows[0][7], b.items[0].itemId);
  assert.deepEqual(rows.map(row => row.slice(8, 10)), [['1', '1'], ['2', '2']]);
  assert.deepEqual(b, original[1]); assert.equal(batch.rows[0].grade, 9.5);
});

test('superseded, unready and replacement labels are visibly excluded, never encoded', () => {
  const source = sheet(1, 4); source.items[1].state = 'SUPERSEDED'; source.items[2].purpose = 'REPRINT'; source.items[2].originalItemId = source.items[0].itemId;
  source.items[3].state = 'PENDING_RENDER'; source.items[3].snapshot = null;
  const batch = buildNfcBatch([source]); assert.equal(batch.rows.length, 1); assert.equal(batch.excluded.length, 3);
  assert.match(batch.excluded[0].reason, /Approval changed/); assert.match(batch.excluded[1].reason, /Replacement label/);
  assert.throws(() => nfcBatchCsv(batch, [source.items[1].itemId]), { code: 'NFC_BATCH_SELECTION_INVALID' });
});

test('invalid, unversioned, normalized or unrelated-origin URLs are rejected without rewriting', () => {
  const source = sheet(), href = source.items[0].snapshot.reportHref;
  for (const invalid of [href.replace('https:', 'http:'), href.replace('atlasgrading.com', 'example.com'), `${href}#fragment`, `${href}&v=2`,
    href.replace('?v=2', '?v=3'), href.replace('?v=2', '?v=02'), href.replace('?v=2', ''), ` ${href}`, `${href}\n`,
    href.replace('/reports/', '/reports/../reports/'), href.replace('https://', 'https://name@'), href.replace('atlasgrading.com', 'atlasgrading.com:443')]) {
    const bad = structuredClone(source); bad.items[0].snapshot.reportHref = invalid;
    assert.throws(() => buildNfcBatch([bad]), { code: 'NFC_BATCH_URL_INVALID' }, invalid);
  }
});

test('mismatched approval, wrong sheet, duplicate slot or identity never produces a batch', () => {
  const mutations = [
    s => { s.items[0].snapshot.approvalVersion = 3; }, s => { s.items[0].sheetId = randomUUID(); },
    s => { s.items[0].cardId = 'not-a-card'; }, s => { s.items[1].slot = 1; },
    s => { s.items[1].itemId = s.items[0].itemId; }, s => { s.items[0].purpose = 'UNKNOWN'; },
    s => { s.items[0].labelHash = ''; }, s => { s.items[0].originalItemId = randomUUID(); },
  ];
  for (const mutate of mutations) { const value = sheet(); mutate(value); assert.throws(() => buildNfcBatch([value]), { code: 'NFC_BATCH_INVALID' }); }
  const duplicateCard = sheet(); duplicateCard.items[1].cardId = duplicateCard.items[0].cardId;
  assert.throws(() => buildNfcBatch([duplicateCard]), { code: 'NFC_BATCH_DUPLICATE' });
  const duplicateReport = sheet(); duplicateReport.items[1].snapshot.reportHref = duplicateReport.items[0].snapshot.reportHref;
  assert.throws(() => buildNfcBatch([duplicateReport]), { code: 'NFC_BATCH_DUPLICATE' });
});

test('CSV identity text is quoted and inert while the NFC URL remains byte-for-byte unchanged', () => {
  const value = sheet(1, 1); value.items[0].snapshot.identity.playerName = '=PLAYER("A", "B")';
  const batch = buildNfcBatch([value]), rows = parse(nfcBatchCsv(batch, [value.items[0].itemId]));
  assert.equal(rows[1][10], '\'=PLAYER("A", "B")'); assert.equal(rows[1][3], value.items[0].snapshot.reportHref);
  assert.throws(() => nfcBatchCsv(batch, []), { code: 'NFC_BATCH_SELECTION_INVALID' });
  assert.throws(() => nfcBatchCsv(batch, [value.items[0].itemId, value.items[0].itemId]), { code: 'NFC_BATCH_SELECTION_INVALID' });
});

test('a recovered layout is the same approved card for NFC, while replacement labels remain excluded', () => {
  const value = sheet(1, 2), recovered = value.items[0];
  recovered.purpose = 'LAYOUT_RETRY'; recovered.originalItemId = randomUUID();
  value.items[1].purpose = 'REPRINT'; value.items[1].originalItemId = recovered.itemId;
  value.items[1].cardId = recovered.cardId; value.items[1].snapshot = structuredClone(recovered.snapshot);
  const batch = buildNfcBatch([value]);
  assert.equal(batch.rows.length, 1); assert.equal(batch.rows[0].itemId, recovered.itemId);
  assert.equal(batch.rows[0].reportHref, recovered.snapshot.reportHref); assert.equal(batch.rows[0].grade, 9.5);
  assert.equal(batch.excluded.length, 1);
  for (const invalid of [null, recovered.itemId, 'invalid']) {
    const bad = structuredClone(value); bad.items[0].originalItemId = invalid;
    assert.throws(() => buildNfcBatch([bad]), { code: 'NFC_BATCH_INVALID' });
  }
  value.items[1].purpose = 'LAYOUT_RETRY';
  assert.throws(() => buildNfcBatch([value]), { code: 'NFC_BATCH_DUPLICATE' });
});
