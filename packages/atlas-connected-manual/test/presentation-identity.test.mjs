import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical, digest } from '@atlas/manual-service/contract';
import { approvedIdentityDetails, readApprovedIdentityDetails } from '../src/presentation-identity.mjs';
import { publicationFixture } from './publication-fixture.mjs';

async function fixture() {
  const f = await publicationFixture(), sourceHash = 'e'.repeat(64);
  f.draft.source.detailsRevision = 3; f.draft.source.sourceHash = sourceHash;
  const result = JSON.parse(f.row.result); result.card.draft = f.draft; result.card.contentHash = digest(canonical(f.draft));
  result.receipt.approval.sourceHash = result.card.contentHash; f.row.source_hash = result.card.contentHash; f.row.result = canonical(result);
  const details = { fields: { name: f.full.identity.playerName, category: 'Sports cards', manufacturer: f.full.identity.manufacturer,
    year: f.full.identity.year, set_name: f.full.identity.productSet, card_number: f.full.identity.cardNumber ?? '', variant: 'Silver', card_type: 'Rookie' },
    profile: 'SPORTS', layoutType: null, cornerShape: 'ROUNDED_3_18_MM', matColor: 'BLACK', parallel: '', insert: '', touched: [], sourceHash };
  f.row.details_revision = 3; f.row.details_content = canonical(details); f.row.details_content_hash = digest(f.row.details_content);
  return { row: f.row, details, publication: { card_id: f.cardId, action_id: f.actionId }, packet: { reportHash: f.row.report_hash, report: { identity: f.full.identity, cardProfile: 'SPORTS' } } };
}
test('only exact approved intake details enrich identity and packet/report remain unchanged', async () => {
  const f = await fixture(), before = structuredClone(f.packet);
  assert.deepEqual(approvedIdentityDetails(f.row, f.packet, f.publication), { category: 'Sports cards', manufacturer: 'Fixture', variant: 'Silver', cardType: 'Rookie' });
  assert.deepEqual(f.packet, before);
});
test('later details, changed identity, changed source and wrong approval omit enrichment', async () => {
  for (const change of [f => { f.row.details_revision++; }, f => { f.details.fields.name = 'Different card'; },
    f => { f.details.fields.card_number = 'Other number'; }, f => { f.details.sourceHash = 'a'.repeat(64); },
    f => { f.packet.report.identity.playerName = 'Edited after intake'; }, f => { f.publication.action_id = 'different'; },
    f => { f.packet.reportHash = 'd'.repeat(64); }]) {
    const f = await fixture(); change(f); f.row.details_content = canonical(f.details); f.row.details_content_hash = digest(f.row.details_content);
    assert.equal(approvedIdentityDetails(f.row, f.packet, f.publication), null);
  }
});
test('unverifiable approval action or detail bytes never leak current identity fields', async () => {
  for (const change of [f => { f.row.result = '{}'; }, f => { f.row.details_content_hash = 'a'.repeat(64); },
    f => { f.row.source_hash = 'a'.repeat(64); }, f => { f.row.report += ' '; }]) {
    const f = await fixture(); change(f); assert.equal(approvedIdentityDetails(f.row, f.packet, f.publication), null);
  }
});
test('read helper only selects exact card/action and missing or unavailable optional history leaves report alone', async () => {
  const f = await fixture(), queries = [];
  const client = { $transaction: callback => callback({ $queryRawUnsafe: (sql, ...params) => { queries.push({ sql, params }); return [f.row]; } }) };
  assert.equal((await readApprovedIdentityDetails({ client, publication: f.publication, packet: f.packet })).variant, 'Silver');
  assert.deepEqual(queries[0].params, [f.publication.card_id, f.publication.action_id]); assert.match(queries[0].sql, /^SELECT/); assert.doesNotMatch(queries[0].sql, /UPDATE|INSERT/);
  assert.equal(await readApprovedIdentityDetails({ ...f, client: { $transaction: () => { throw new Error('unavailable'); } } }), null);
});
