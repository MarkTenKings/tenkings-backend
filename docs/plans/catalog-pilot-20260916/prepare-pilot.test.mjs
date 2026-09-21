import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { canonicalJson, lookupManifestCandidates, hashManifest } from '../../../packages/card-catalog-evidence/src/index.mjs';
import { compilePilot, PILOTS, validateTaxonomyExport, verifyPilotSources, prepareCompletePokemonChecklist, POKEMON_TRANSCRIPTION_SHA256 } from './prepare-pilot.mjs';

const hash = value => createHash('sha256').update(canonicalJson(value)).digest('hex');
const sourceManifest = JSON.parse(await readFile(new URL('./source-manifest.draft.json', import.meta.url), 'utf8'));
const sources = Object.fromEntries(sourceManifest.sources.map(s => [s.id, s]));
const clone = value => JSON.parse(JSON.stringify(value));
// Synthetic taxonomy IDs only. Real manufacturer facts are retained; no actual
// reviewer, rights grant, database state or publication is asserted by this test.
function fixture(pilot) {
  const p = PILOTS[pilot], setId = p.setIds[0], programId = `synthetic-test:${pilot}:program`;
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
test('Pokemon compiler binds the normalized new key while retaining the source display label', () => {
  const f = fixture('pokemon'), result = compilePilot(f);
  assert.equal(result.manifest.set.setId, 'Black & White-Legendary Treasures');
  assert.equal(result.manifest.set.label, 'Black & White—Legendary Treasures');
  assert.equal(result.manifest.programs[0].label, 'Black & White-Legendary Treasures');
  assert.equal(result.reviewPacket, null);
  for (const setId of ['Black & White—Legendary Treasures', '2013_Pokemon_Legendary_Treasures', 'Radiant Collection']) {
    const other = fixture('pokemon'), t = other.taxonomy.snapshot; t.setId = setId; t.draft.setId = setId;
    for (const key of ['sources', 'programs', 'cards', 'parallels', 'variations', 'scopes']) for (const row of t[key]) row.setId = setId;
    resign(other.taxonomy); assert.throws(() => compilePilot(other), /another year\/product/);
  }
  f.taxonomy.snapshot.programs[0].label = 'Radiant Collection'; resign(f.taxonomy);
  assert.throws(() => compilePilot(f), /program label/);
});
test('complete Pokemon preparation preserves every immutable row and never fabricates DB or review authority', async () => {
  const bytes = await readFile(new URL('./pokemon-complete-checklist.unreviewed.json', import.meta.url));
  const originalHash = createHash('sha256').update(bytes).digest('hex'), original = JSON.parse(bytes);
  const prepared = prepareCompletePokemonChecklist(bytes), request = prepared.requestDraft;
  assert.equal(originalHash, POKEMON_TRANSCRIPTION_SHA256);
  assert.equal(request.setId, PILOTS.pokemon.setIds[0]); assert.equal(request.sourceFetchMeta.setId, request.setId);
  assert.equal(request.rawPayload.setId, request.setId); assert.equal(request.rawPayload.programs.length, 1);
  const cards = request.rawPayload.programs[0].cards;
  assert.equal(cards.length, 138);
  assert.deepEqual(cards.map(card => [card.cardNumber, card.playerName]), original.rows.map(row => [row.number, row.name]));
  for (const [i, card] of cards.entries()) {
    assert.deepEqual(card.metadata.literalChecklistMarkers, original.rows[i].literalChecklistMarkers);
    assert.deepEqual(card.metadata.literalRarityMarker, original.rows[i].literalRarityMarker);
    assert.deepEqual([card.metadata.physicalFinish, card.metadata.collectorNumberDenominator, card.metadata.edition,
      card.metadata.format, card.metadata.channel], [null, null, null, null, null]);
  }
  assert.equal(cards.find(card => card.cardNumber === 'RC11').metadata.literalRarityMarker.label, 'rare');
  assert.equal(prepared.binding.draftId, null); assert.equal(prepared.binding.programRowId, null);
  assert.equal(prepared.binding.databaseRecordCreated, false); assert.equal(prepared.reviewer, null);
  assert.equal(prepared.grant, null); assert.equal(prepared.publication, null); assert.deepEqual(prepared.images, []);
  assert.equal(request.sourceFetchMeta.sourceBytesVerifiedByPreparation, false);
  assert.equal(request.sourceFetchMeta.humanReviewed, false); assert.equal(PILOTS.pokemon.cards.length, 4);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), originalHash);
  const artifact = JSON.parse(await readFile(new URL('./pokemon-complete-import.unreviewed.json', import.meta.url), 'utf8'));
  assert.deepEqual(artifact, prepared);
  for (const mutate of [draft => { draft.rows.pop(); }, draft => { draft.source.sha256 = 'f'.repeat(64); },
    draft => { draft.rows[113].number = 'RC1/RC25'; }]) {
    const changed = clone(original); mutate(changed);
    assert.throws(() => prepareCompletePokemonChecklist(JSON.stringify(changed)), /transcription bytes differ/);
  }
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
  assert.ok(result.blockers.some(s => /authenticated human review/.test(s)));
  positive['sports-checklist'].consumers = [];
  assert.throws(() => compilePilot({ ...f, grants: positive }), /consumer roster/);
});
test('explicit source-fact-use proposals prepare review packets without manufacturer license claims', async () => {
  for (const pilot of ['sports', 'pokemon']) {
    const sourceFactUse = JSON.parse(await readFile(new URL(`./${pilot}-source-fact-use.proposed.json`, import.meta.url), 'utf8'));
    const result = compilePilot({ ...fixture(pilot), sourceFactUse });
    assert.equal(result.status, 'DRAFT_REQUIRES_HUMAN_REVIEW');
    assert.equal(result.reviewPacket.reviewEvidence.schemaVersion, 'setops-catalog-review-evidence/v2');
    for (const source of result.reviewPacket.reviewEvidence.sources) {
      assert.equal(source.factUse.purpose, 'catalog_facts'); assert.equal(source.factUse.sourceSha256, sources[source.sourceId].sha256);
      assert.equal('grant' in source, false); assert.equal('basis' in source.factUse, false);
    }
    assert.deepEqual(result.reviewPacket.reviewEvidence.images, []);
    assert.ok(result.blockers.some(s => /neither publication nor a legal attestation/.test(s)));
  }
});
test('fact-use proposals reject version, roster, checksum, ownership, consumer and mixed-mode changes', async () => {
  const original = JSON.parse(await readFile(new URL('./sports-source-fact-use.proposed.json', import.meta.url), 'utf8'));
  for (const change of [
    p => { delete p.schemaVersion; }, p => { p.schemaVersion = 'setops-catalog-source-fact-use-proposal/v2'; },
    p => { p.authority = 'approved'; }, p => { delete p.uses['sports-checklist']; },
    p => { p.uses.extra = clone(p.uses['sports-checklist']); },
    p => { p.uses['sports-checklist'].sourceSha256 = '0'.repeat(64); },
    p => { p.uses['sports-checklist'].basis = 'owned_original'; },
    p => { p.uses['sports-checklist'].purpose = 'image_reuse'; },
    p => { p.uses['sports-checklist'].consumers = ['inventory', 'inventory']; },
    p => { p.uses['sports-checklist'].consumers = ['public']; },
  ]) { const sourceFactUse = clone(original); change(sourceFactUse); assert.throws(() => compilePilot({ ...fixture('sports'), sourceFactUse })); }
  assert.throws(() => compilePilot({ ...fixture('sports'), sourceFactUse: original, grants: {} }), /do not mix/);
  const missingMapping = fixture('sports'); missingMapping.taxonomy.snapshot.parallels = []; resign(missingMapping.taxonomy);
  assert.throws(() => compilePilot({ ...missingMapping, sourceFactUse: original }));
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
