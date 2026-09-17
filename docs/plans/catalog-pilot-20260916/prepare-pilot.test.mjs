import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { canonicalJson, lookupManifestCandidates, hashManifest } from '../../../packages/card-catalog-evidence/src/index.mjs';
import { compilePilot, PILOTS, validateTaxonomyExport, verifyPilotSources } from './prepare-pilot.mjs';

const hash = value => createHash('sha256').update(canonicalJson(value)).digest('hex');
const sourceManifest = JSON.parse(await readFile(new URL('./source-manifest.draft.json', import.meta.url), 'utf8'));
const sources = Object.fromEntries(sourceManifest.sources.map(s => [s.id, s]));
const clone = value => JSON.parse(JSON.stringify(value));
// Synthetic taxonomy IDs only. Real manufacturer facts are retained; no actual
// reviewer, rights grant, database state or publication is asserted by this test.
function fixture(pilot) {
  const p = PILOTS[pilot], setId = p.label, programId = `synthetic-test:${pilot}:program`;
  const programs = [{ id: `${programId}:row`, setId, programId, label: p.programLabel, sourceId: null }];
  const cards = p.cards.map(([cardNumber, playerName]) => ({ id: `synthetic-test:${pilot}:card:${cardNumber}`, setId, programId, cardNumber, playerName, sourceId: null }));
  const parallels = p.printings.map(v => ({ id: `synthetic-test:${pilot}:parallel:${v.key}`, setId, parallelId: v.key, label: v.parallelLabels[0], serialDenominator: v.serialDenominator, sourceId: null }));
  const scopes = parallels.map(v => ({ id: `synthetic-test:${pilot}:scope:${v.parallelId}`, setId, programId, parallelId: v.parallelId, variationId: null, formatKey: null, channelKey: null, sourceId: null }));
  const sourceRows = p.sourceIds.map(id => ({ id: `synthetic-test:${id}`, setId, sourceKind: id.includes('odds') ? 'OFFICIAL_ODDS' : 'OFFICIAL_CHECKLIST', sourceUrl: sources[id].url }));
  const snapshot = { exportedAt: '2026-09-16T00:00:00.000Z', setId,
    draft: { id: `synthetic-test:${pilot}:draft`, setId, status: 'APPROVED', archivedAt: null, currentCatalogPublicationId: null },
    latestVersion: { id: `synthetic-test:${pilot}:version`, draftId: `synthetic-test:${pilot}:draft`, version: 1, versionHash: 'a'.repeat(64), blockingErrorCount: 0 },
    latestPublication: null, blockers: [], sources: sourceRows, programs, cards, parallels, variations: [], scopes };
  const taxonomy = { schemaVersion: 'setops-catalog-taxonomy-export/v1', authority: 'unreviewed_taxonomy_snapshot', snapshot, snapshotSha256: hash(snapshot) };
  const selection = { programRowId: programs[0].id, cards: Object.fromEntries(cards.map(c => [c.cardNumber, c.id])),
    printings: Object.fromEntries(p.printings.map((v, i) => [v.key, { parallelRowId: parallels[i].id, scopeRowId: scopes[i].id }])),
    sources: Object.fromEntries(p.sourceIds.map((id, i) => [id, sourceRows[i].id])) };
  return { pilot, sources, taxonomy, selection };
}
function resign(taxonomy) { taxonomy.snapshotSha256 = hash(taxonomy.snapshot); }

test('no taxonomy produces source-backed preparation without invented IDs, grants or review packet', () => {
  for (const pilot of Object.keys(PILOTS)) {
    const result = compilePilot({ pilot, sources });
    assert.equal(result.manifest, null); assert.equal(result.reviewPacket, null);
    assert.match(result.blockers[0], /no IDs were invented/);
    assert.ok(result.sourceArtifacts.every(s => s.ref === `catalog:sha256:${s.sha256}`));
  }
});
test('sports real-source vocabulary never promotes program odds to exact-card support', () => {
  const result = compilePilot(fixture('sports')), m = result.manifest;
  assert.ok(m); assert.equal(m.cards.length, 3); assert.equal(m.applicability.length, 9);
  assert.ok(m.applicability.every(a => a.status === 'unknown')); assert.equal(m.images.length, 0);
  assert.equal(m.coverage.images.status, 'unknown'); assert.equal(result.reviewPacket, null);
  const lookup = lookupManifestCandidates(m, { category: 'SPORTS', setId: m.set.setId, cardNumber: 'TBK-2' });
  assert.equal(lookup.totalCandidateCount, 3); assert.equal(lookup.authority, 'unreviewed_manifest');
  assert.ok(lookup.candidates.every(c => c.applicability === 'unknown'));
  assert.equal(lookupManifestCandidates(m, { category: 'SPORTS', setId: m.set.setId, cardNumber: '2' }).totalCandidateCount, 0);
  assert.equal(hashManifest(m), result.manifestSha256);
});
test('Pokemon preserves exact numbers and literal markers without physical-finish or absent-row exclusion', () => {
  const { manifest: m } = compilePilot(fixture('pokemon'));
  assert.equal(m.cards.length, 4);
  const snivy = lookupManifestCandidates(m, { category: 'POKEMON', setId: m.set.setId, cardName: 'Snivy', language: 'en' });
  assert.equal(snivy.totalCandidateCount, 4); assert.equal(snivy.outcome, 'ambiguous');
  assert.ok(snivy.candidates.every(c => c.applicability === 'unknown' && c.images.length === 0));
  assert.equal(snivy.absenceEstablishesExclusion, false);
  const rc = snivy.candidates.filter(c => c.card.number === 'RC1');
  assert.deepEqual(rc.map(c => c.recordedApplicability).sort(), ['supported', 'unknown']);
  assert.equal(lookupManifestCandidates(m, { category: 'POKEMON', setId: m.set.setId, cardNumber: '6/113' }).totalCandidateCount, 0);
});
test('tampered export and cross-set rows are refused, even if a caller rehashes cross-set content', () => {
  const { taxonomy } = fixture('sports'); taxonomy.snapshot.cards[0].cardNumber = 'changed';
  assert.throws(() => validateTaxonomyExport(taxonomy), /checksum/);
  taxonomy.snapshot.cards[0].setId = 'different-set'; resign(taxonomy);
  assert.throws(() => validateTaxonomyExport(taxonomy), /Cross-set/);
});
test('same names and numbers in another product never inherit this pilot source binding', () => {
  const f = fixture('sports'), t = f.taxonomy.snapshot; t.setId = '2023_Bowman_University_Chrome_Football_Sapphire'; t.draft.setId = t.setId;
  for (const key of ['sources', 'programs', 'cards', 'parallels', 'variations', 'scopes']) for (const row of t[key]) row.setId = t.setId;
  resign(f.taxonomy); assert.throws(() => compilePilot(f), /another year\/product/);
});
test('missing source row, mismatched official URL/classification and scope/number drift cannot compile', () => {
  for (const change of [
    f => { f.taxonomy.snapshot.sources[0].sourceKind = 'TRUSTED_SECONDARY'; },
    f => { f.taxonomy.snapshot.sources[0].sourceUrl = null; },
    f => { f.taxonomy.snapshot.parallels = []; },
    f => { f.taxonomy.snapshot.scopes[0].formatKey = 'Hobby'; },
    f => { f.taxonomy.snapshot.cards[0].cardNumber = 'TBK-01'; },
    f => { f.taxonomy.snapshot.parallels[1].serialDenominator = 99; },
  ]) {
    const f = fixture('sports'); change(f); resign(f.taxonomy); assert.throws(() => compilePilot(f));
  }
});
test('public manufacturer bytes do not grant owned-original reuse or authorize missing consumers', () => {
  const f = fixture('sports');
  const grants = Object.fromEntries(PILOTS.sports.sourceIds.map(id => [id, { basis: 'owned_original', detail: 'Synthetic denial control. Downloading a source does not confer rights.', consumers: ['inventory'] }]));
  assert.throws(() => compilePilot({ ...f, grants }), /possession is not owned_original/);
  const positive = clone(grants);
  for (const grant of Object.values(positive)) { grant.basis = 'permission'; grant.detail = 'SYNTHETIC TEST ONLY: simulated permission statement for contract shape, not actual manufacturer reuse authority.'; }
  const result = compilePilot({ ...f, grants: positive });
  assert.deepEqual(Object.keys(result.reviewPacket).sort(), ['manifest', 'reviewEvidence']);
  assert.ok(result.blockers.some(s => /human evidence/.test(s)));
  positive['sports-checklist'].consumers = [];
  assert.throws(() => compilePilot({ ...f, grants: positive }), /consumer roster/);
});
test('source byte damage and pinned metadata substitution fail before any packet', async () => {
  await assert.rejects(verifyPilotSources(sourceManifest, async () => Buffer.from('wrong source')), /Source bytes differ/);
  const changed = clone(sourceManifest); changed.sources[0].sha256 = '0'.repeat(64);
  await assert.rejects(verifyPilotSources(changed, async () => { throw Error('must not read'); }), /Pinned source metadata differs/);
});
test('archived or dirty drafts stay preparatory; exact history determines revision', () => {
  const f = fixture('sports'); f.taxonomy.snapshot.draft.archivedAt = '2026-09-16T00:00:00.000Z'; resign(f.taxonomy);
  assert.equal(compilePilot(f).manifest, null);
  f.taxonomy.snapshot.draft.archivedAt = null;
  f.taxonomy.snapshot.latestPublication = { id: 'synthetic-test:history:7', revision: 7, manifestSha256: 'b'.repeat(64) }; resign(f.taxonomy);
  const result = compilePilot(f); assert.equal(result.manifest.revision, 8); assert.equal(result.manifest.supersedes.revision, 7);
});
