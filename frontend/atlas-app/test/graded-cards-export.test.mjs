import test from 'node:test';
import assert from 'node:assert/strict';
import { loadedGradedCardsCsv } from '../lib/graded-cards-export.mjs';

const card = (change = {}) => ({ cardId: 'aac6bff4-5f2a-4e5c-a9cd-4fef01f18454', certificateNumber: 'ATLAS-ABCDEF123456',
  identity: { cardName: 'Pikachu ex', category: 'POKEMON', year: '2024', manufacturer: 'Pokémon', productSet: 'Surging Sparks', cardNumber: '007/191' },
  finalGrade: 8.5, approvedAt: '2026-10-20T00:00:00.123456Z', approver: { name: 'Reviewer' }, reviewers: [{ name: 'Staff one' }, { name: 'Staff two' }],
  report: { state: 'PUBLISHED', publicToken: `ar_${'a'.repeat(24)}`, version: 2, path: `/reports/ar_${'a'.repeat(24)}?v=2` }, ...change });
function parse(csv) {
  const rows = []; let row = [], value = '', quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (c === '"') { if (quoted && csv[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { row.push(value); value = ''; }
    else if (c === '\r' && csv[i + 1] === '\n' && !quoted) { row.push(value); rows.push(row); row = []; value = ''; i++; }
    else value += c;
  }
  assert.equal(quoted, false); return rows;
}

test('CSV retains loaded order, historical grade/date/identity and exact published version using a fixed projection', () => {
  const first = card({ secret: 'NEVER_EXPORT', media: { url: 'NEVER_EXPORT' } });
  const second = card({ cardId: 'bbc6bff4-5f2a-4e5c-a9cd-4fef01f18454', finalGrade: null, report: { state: 'PENDING' }, identity: {} });
  const before = structuredClone([first, second]), csv = loadedGradedCardsCsv([first, second]), rows = parse(csv);
  assert.deepEqual([first, second], before); assert.equal(rows.length, 3); assert.equal(rows[0].length, 18);
  assert.equal(rows[1][0], first.cardId); assert.equal(rows[2][0], second.cardId);
  assert.equal(rows[1][2], 'Pikachu ex'); assert.equal(rows[1][9], '007/191'); assert.equal(rows[1][10], '8.5');
  assert.equal(rows[1][11], first.approvedAt); assert.equal(rows[1][13], 'Staff one, Staff two');
  assert.equal(rows[1][17], first.report.path); assert.equal(rows[2][10], ''); assert.equal(rows[2][17], '');
  assert.doesNotMatch(csv, /NEVER_EXPORT|ownership|valuation|price/i);
});

test('CSV preserves Unicode, commas, quotes and multiline text while neutralizing formula-leading cells', () => {
  for (const value of ['=HYPERLINK("https://example.test")', '+1+1', '-1+1', '@SUM(1)', ' \t\r\n=1', '\u0000=1']) {
    const rows = parse(loadedGradedCardsCsv([card({ identity: { cardName: value }, submission: { channel: 'KIOSK', dealer: { name: value }, customer: { name: value }, reference: value } })]));
    for (const index of [2, 14, 15, 16]) assert.equal(rows[1][index], `'${value}`);
  }
  const value = 'O’Neil, "台灣"\nSecond line';
  assert.equal(parse(loadedGradedCardsCsv([card({ identity: { playerName: value } })]))[1][2], value);
});

test('empty, duplicate, malformed or inconsistent records refuse the whole export without partial output', () => {
  for (const cards of [[], null, [card(), card()], [card({ cardId: 'bad' })], [card({ finalGrade: 11 })],
    [card({ approvedAt: 'bad' })], [card({ report: { ...card().report, version: 1 } })],
    [card({ identity: { playerName: { private: 'value' } } })], [card({ reviewers: 'bad' })]]) {
    assert.throws(() => loadedGradedCardsCsv(cards), { code: 'GRADED_CARDS_EXPORT_INVALID' });
  }
});
