import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { prepareSportsAdditiveTaxonomy, SET_ID } from './sports-additive-taxonomy-preparation.mjs';
import { PILOTS } from './prepare-pilot.mjs';

const read = name => JSON.parse(readFileSync(new URL(name, import.meta.url)));
const packetBytes = readFileSync(new URL('./sports-publication-pilot.unsubmitted.json', import.meta.url));
const packet = JSON.parse(packetBytes);
const reconciliation = read('./sports-reconciliation-report.unreviewed.json');
const sourceBytesById = Object.fromEntries(packet.sourceEvidence.map(s => [s.sourceId, readFileSync(s.localEvidencePath)]));
const plan = snapshot => prepareSportsAdditiveTaxonomy({ snapshot, packetBytes, sourceBytesById });
const section = (table, rows) => ({ table, totalRows: String(rows.length), returnedRows: rows.length, truncated: false, rows });
function fixture() {
  // Synthetic receipt/ancillary IDs. Card IDs and observed number/name fields
  // come from the committed reconciliation. This is never a new DB observation.
  const cards = reconciliation.rows.filter(r => r.status === 'exact_program_number_name_match').map(r => ({
    id: r.canonicalCardId, setId: SET_ID, programId: r.canonicalProgramId, cardNumber: r.printedCardNumber,
    playerName: r.observedCanonicalName, team: r.teamComparison.observed, sourceId: 'fixture-secondary-source',
  }));
  const program = packet.identityOnlyContractProbe.manifest.programs[0];
  const programs = reconciliation.programs.filter(p => p.exactLabelCanonicalProgramIds.length === 1).map((p, i) => ({
    id: p.literalHeading === program.label ? program.rowId : `fixture-program-${i}`, setId: SET_ID,
    programId: p.exactLabelCanonicalProgramIds[0], label: p.literalHeading, sourceId: 'fixture-secondary-source',
  }));
  const draft = structuredClone(reconciliation.draftMetadata.draft);
  const versions = reconciliation.draftMetadata.versionCounts.map(v => ({ ...v, id: `fixture-version-${v.version}`, draftId: draft[0].id }));
  Object.assign(versions.find(v => v.version === 6), reconciliation.draftMetadata.latestVersion);
  const sources = [{ id: 'fixture-secondary-source', setId: SET_ID, sourceKind: 'TRUSTED_SECONDARY', sourceUrlMatch: 'missing', ingestionJobId: 'fixture-approved-job' }];
  return { schemaVersion: 'tenkings-sports-taxonomy-readonly-snapshot/v1', setId: SET_ID, finishedAt: 'synthetic-test-receipt',
    checksComplete: true, status: 'observed_complete_scope', mutationCount: 0,
    transaction: { committed: true, observed: { read_only: 'on', isolation: 'repeatable read' } }, sections: {
      draft: section('SetDraft', draft), versions: section('SetDraftVersion', versions),
      sources: section('SetTaxonomySource', sources), programs: section('SetProgram', programs), cards: section('SetCard', cards),
      parallels: section('SetParallel', []), variations: section('SetVariation', []), scopes: section('SetParallelScope', []),
      ingestions: section('SetIngestionJob', []), publications: section('SetCatalogEvidencePublication', []),
      activeSeedJobs: section('SetSeedJob', []), activeReplaceJobs: section('SetReplaceJob', []),
    } };
}
const add = (snapshot, name, row) => { const s = snapshot.sections[name]; s.rows.push(row); s.totalRows = String(s.rows.length); s.returnedRows = s.rows.length; };
function expectConflict(snapshot, code) {
  const result = plan(snapshot); assert.equal(result.status, 'CONFLICT_NO_OPERATIONS');
  assert.deepEqual(result.operations, []); assert.deepEqual(result.requiredBindings, []);
  assert(result.conflicts.some(c => c.code === code), JSON.stringify(result.conflicts));
}

test('creates only two sources, three parallels and three scopes; preserves all card/program/history inputs', () => {
  const snapshot = fixture(), before = JSON.stringify(snapshot), result = plan(snapshot);
  assert.deepEqual(result.conflicts, []); assert.equal(result.executable, false); assert.equal(result.request, null);
  assert.equal(JSON.stringify(snapshot), before); assert.equal(result.preservation.cards.observedRows, 379);
  assert.equal(result.preservation.versions.observedRows, 6);
  assert.deepEqual(result.operations.map(o => [o.model, o.action]), [
    ['SetTaxonomySource','create'], ['SetTaxonomySource','create'],
    ['SetParallel','create'], ['SetParallelScope','create'], ['SetParallel','create'], ['SetParallelScope','create'], ['SetParallel','create'], ['SetParallelScope','create'],
  ]);
  for (const operation of result.operations) { assert.equal(operation.databaseRowId, null); assert.equal(operation.data.id, undefined); }
  assert.equal(result.excluded.cardOrProgramWrites, 0); assert.equal(result.excluded.sourceReclassifications, 0);
  assert.equal(result.excluded.draftVersionWrites, 0); assert.equal(result.excluded.fullCatalogCompletionRequired, false);
});

test('bindings cannot silently turn missing ingestion IDs into published null-source rows', () => {
  const result = plan(fixture()); assert.equal(result.requiredBindings.length, 2);
  for (const source of result.operations.filter(o => o.model === 'SetTaxonomySource')) {
    assert.equal('ingestionJobId' in source.data, false);
    assert(result.requiredBindings.some(b => b.required && b.value === null && b.ref === source.requiredBindings.ingestionJobId));
    assert.equal(source.data.metadataJson.humanReviewed, false); assert.equal(source.data.metadataJson.rightsVerified, false);
  }
  for (const operation of result.operations.filter(o => o.model !== 'SetTaxonomySource')) {
    assert.equal(operation.requiredBindings.sourceId, 'source:sports-odds-round2'); assert.equal('sourceId' in operation.data, false);
  }
  assert.equal(result.reviewer, null); assert.equal(result.grants, null); assert.deepEqual(result.images, []);
});

test('three source-denominator rows agree with existing compiler, with no finish/odds/dimension or applicability inference', () => {
  const result = plan(fixture()), parallels = result.operations.filter(o => o.model === 'SetParallel');
  assert.deepEqual(parallels.map(o => [o.data.label,o.data.serialDenominator]), PILOTS.sports.printings.map(p => [p.label,p.serialDenominator]));
  assert.deepEqual(parallels.map(o => o.data.parallelId), ['the-big-kahuna','orange-refractor','superfractor']);
  for (const op of parallels) for (const field of ['serialText','finishFamily','visualCuesJson']) assert.equal(op.data[field], null);
  for (const op of result.operations.filter(o => o.model === 'SetParallelScope')) {
    assert.equal(op.data.scopeKey, `${op.data.programId}::${op.data.parallelId}::none::any::any`);
    assert.equal(op.data.variationId, null); assert.equal(op.data.formatKey, null); assert.equal(op.data.channelKey, null);
  }
  assert.equal(result.applicability.length, 9);
  assert.equal(new Set(result.applicability.map(a => `${a.cardId}/${a.printingKey}`)).size, 9);
  for (const row of result.applicability) { assert.equal(row.status, 'unknown'); assert.equal(row.printingId, null); assert.deepEqual(row.sourceIds, []); }
});

test('existing exact source URL of either correct or wrong classification conflicts; no reclassification or duplicate', () => {
  for (const kind of ['TRUSTED_SECONDARY','OFFICIAL_CHECKLIST','OFFICIAL_ODDS']) {
    const s = fixture(); s.sections.sources.rows[0].sourceKind = kind;
    for (const tag of ['pinned_sports_checklist','pinned_sports_odds']) {
      s.sections.sources.rows[0].sourceUrlMatch = tag; expectConflict(s, 'SOURCE_ALREADY_PRESENT');
    }
  }
  const s = fixture(); delete s.sections.sources.rows[0].sourceUrlMatch; expectConflict(s, 'SOURCE_URL_UNACCOUNTED');
});

test('occupied parallel keys/labels and scope keys/tuples conflict even when apparently compatible', () => {
  for (const existing of [{ parallelId: 'orange-refractor', label: 'Orange Refractor', serialDenominator: 25 },
    { parallelId: 'orange-refractor', label: 'Wrong', serialDenominator: 99 },
    { parallelId: 'other-key', label: 'Orange Refractor', serialDenominator: 25 },
    { parallelId: 'other-key', label: 'ORANGE   REFRACTOR', serialDenominator: 25 }]) {
    const s = fixture(); add(s, 'parallels', { id: 'fixture-occupied', setId: SET_ID, ...existing }); expectConflict(s, 'PARALLEL_ALREADY_PRESENT');
  }
  for (const scopeKey of ['the-big-kahuna::orange-refractor::none::any::any', 'unexpected-scope-key']) {
    const s = fixture(); add(s, 'scopes', { id: 'fixture-scope', setId: SET_ID, scopeKey, programId: 'the-big-kahuna', parallelId: 'orange-refractor', variationId: null, formatKey: null, channelKey: null });
    expectConflict(s, 'SCOPE_ALREADY_PRESENT');
  }
});

test('incomplete, truncated, withheld, miscounted, cross-set and duplicate snapshots cannot establish absence', () => {
  for (const mutate of [s => delete s.sections.sources, s => s.sections.cards.truncated = true,
    s => s.sections.sources.fieldTruncation = true, s => s.sections.sources.withheldFields = 1,
    s => s.sections.cards.totalRows = '380', s => s.sections.parallels.returnedRows = 1,
    s => s.sections.cards.table = 'WrongTable']) {
    const s = fixture(); mutate(s); expectConflict(s, 'INCOMPLETE_SECTION');
  }
  for (const mutate of [s => s.sections.cards.rows[0].setId = 'OtherSet', s => s.sections.cards.rows[1].id = s.sections.cards.rows[0].id,
    s => s.sections.cards.rows[0] = null]) {
    const s = fixture(); mutate(s); expectConflict(s, 'INVALID_SECTION_IDENTITY');
  }
  const s = fixture(); s.transaction.observed.read_only = 'off'; expectConflict(s, 'INCOMPLETE_SNAPSHOT');
  const missingKey = fixture(); add(missingKey, 'parallels', { id: 'fixture-missing-key', setId: SET_ID, label: 'Orange Refractor' });
  expectConflict(missingKey, 'MISSING_KEY_METADATA');
});

test('wrong selected card/program and baseline drift produce no partial source creates', () => {
  for (const field of ['id','programId','cardNumber','playerName']) {
    const s = fixture(); s.sections.cards.rows.find(c => c.cardNumber === 'TBK-1')[field] = 'wrong'; expectConflict(s, 'CARD_BINDING_MISMATCH');
  }
  const s = fixture(); s.sections.programs.rows.find(p => p.programId === 'the-big-kahuna').id = 'wrong'; expectConflict(s, 'PROGRAM_BINDING_MISMATCH');
  const changed = fixture(); changed.sections.versions.rows.find(v => Number(v.version) === 6).versionHash = 'wrong'; expectConflict(changed, 'BASELINE_CHANGED');
  const active = fixture(); add(active, 'activeSeedJobs', { id: 'fixture-active', draftId: active.sections.draft.rows[0].id }); expectConflict(active, 'BASELINE_CHANGED');
});

test('wrong source bytes or modified evidence packet cannot propose operations or supported relations', () => {
  const badSources = { ...sourceBytesById, 'sports-odds-round2': Buffer.from('different source') };
  const badSource = prepareSportsAdditiveTaxonomy({ snapshot: fixture(), packetBytes, sourceBytesById: badSources });
  assert(badSource.conflicts.some(c => c.code === 'SOURCE_BYTES_MISMATCH')); assert.deepEqual(badSource.operations, []);
  const altered = structuredClone(packet); altered.applicabilityDraft[0].status = 'supported';
  const badPacket = prepareSportsAdditiveTaxonomy({ snapshot: fixture(), packetBytes: JSON.stringify(altered), sourceBytesById });
  assert.equal(badPacket.conflicts[0].code, 'PACKET_PIN_MISMATCH'); assert.deepEqual(badPacket.operations, []);
});

test('frozen generated actual proposal is bounded, uses actual existing IDs and still has no request or grant', () => {
  const actual = read('./sports-additive-taxonomy-proposal.unsubmitted.json');
  assert.equal(actual.operations.length, 8); assert.deepEqual(actual.conflicts, []);
  assert.equal(actual.provenance.rawSnapshotSha256, packet.provenance.taxonomySnapshotSha256);
  assert.deepEqual(actual.existingBinding.cards, packet.selectedIdentities.map(c => ({ cardId: c.cardId, number: c.number, name: c.name })));
  assert.equal(actual.preservation.cards.observedRows, 379); assert.equal(actual.preservation.sources.observedRows, 6);
  assert.equal(actual.preservation.scopes.observedRows, 0); assert.equal(actual.requiredBindings.length, 2);
  assert.equal(actual.executable, false); assert.equal(actual.request, null); assert.equal(actual.grants, null); assert.equal(actual.reviewer, null);
  for (const [i, source] of packet.sourceEvidence.entries()) {
    const op = actual.operations[i]; assert.equal(op.data.sourceUrl, source.url);
    assert.equal(op.data.metadataJson.sourceSha256, createHash('sha256').update(sourceBytesById[source.sourceId]).digest('hex'));
  }
});
