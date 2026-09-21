import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reconcileSports, SET_ID, readPinnedJson, TRANSCRIPT_SHA256 } from './sports-reconciliation-tool.mjs';

const transcript = readPinnedJson(new URL('./sports-complete-checklist.unreviewed.json', import.meta.url), TRANSCRIPT_SHA256);
function fixture() {
  // Deliberately synthetic IDs. Fixtures are not canonical or approval evidence.
  const source = structuredClone(transcript);
  source.programs = [{ localProgramRef: 'source-program-01', literalHeading: 'BOWMAN CHROME PROSPECTS' }];
  source.rows = [structuredClone(source.rows[0])];
  const sections = Object.fromEntries(['draft', 'versions', 'sources', 'programs', 'cards', 'parallels', 'variations', 'scopes', 'ingestions', 'publications', 'activeSeedJobs', 'activeReplaceJobs'].map(name => [name, { rows: [], totalRows: '0', returnedRows: 0, truncated: false }]));
  sections.programs.rows = [{ id: 'fixture-program', setId: SET_ID, programId: 'fixture-base', label: 'BOWMAN CHROME PROSPECTS' }];
  sections.cards.rows = [{ id: 'fixture-card', setId: SET_ID, programId: 'fixture-base', cardNumber: '1', playerName: 'Caleb Williams', team: 'USC' }];
  for (const name of ['programs', 'cards']) { sections[name].totalRows = '1'; sections[name].returnedRows = 1; }
  return { source, snapshot: { schemaVersion: 'tenkings-sports-taxonomy-readonly-snapshot/v1', setId: SET_ID,
    status: 'observed_complete_scope', checksComplete: true,
    transaction: { committed: true, observed: { read_only: 'on', isolation: 'repeatable read' } }, sections } };
}

test('exact match preserves inputs and grants no review, draft-payload or import authority', () => {
  const { source, snapshot } = fixture(); const before = JSON.stringify({ source, snapshot });
  const result = reconcileSports(source, snapshot);
  assert.equal(result.rows[0].status, 'exact_program_number_name_match');
  assert.equal(result.scope.draftPayloadCompared, false);
  assert.equal(result.scope.canonicalIdentityAssignedToSource, false);
  assert.equal(result.scope.humanApproved, false);
  assert.equal(result.inputs.snapshotSha256, null); // Only byte-verified CLI supplies file hashes.
  assert.equal(JSON.stringify({ source, snapshot }), before);
});

test('same number with a wrong name is an explicit conflict', () => {
  const { source, snapshot } = fixture(); snapshot.sections.cards.rows[0].playerName = 'Different Player';
  assert.equal(reconcileSports(source, snapshot).rows[0].status, 'same_program_number_name_conflict');
});

test('another heading cannot supply a matching number/name', () => {
  const { source, snapshot } = fixture(); snapshot.sections.programs.rows[0].label = 'BOWMAN CHROME PROSPECTS I AUTOGRAPH PARALLEL';
  const result = reconcileSports(source, snapshot);
  assert.equal(result.rows[0].status, 'no_exact_program_label_in_snapshot');
  assert.equal(result.rows[0].canonicalCardId, null);
});

test('unnumbered row stays unresolved even beside the same player in the exact program', () => {
  const { source, snapshot } = fixture(); source.rows[0].printedCardNumber = null;
  const row = reconcileSports(source, snapshot).rows[0];
  assert.equal(row.status, 'unnumbered_source_identity_unresolved');
  assert.equal(row.printedCardNumber, null); assert.equal(row.canonicalCardId, null); assert.equal(row.canonicalProgramId, null);
});

test('incomplete, hidden or miscounted sections cannot establish missing-number findings', () => {
  for (const change of ['truncated', 'fieldTruncation', 'withheldFields', 'countMismatch', 'missing']) {
    const { source, snapshot } = fixture(); snapshot.sections.cards.rows = []; snapshot.sections.cards.totalRows = '0'; snapshot.sections.cards.returnedRows = 0;
    if (change === 'missing') delete snapshot.sections.sources;
    else if (change === 'countMismatch') snapshot.sections.cards.totalRows = '1';
    else snapshot.sections.cards[change] = true;
    const result = reconcileSports(source, snapshot);
    assert.equal(result.scope.completeEnumeratedMetadata, false, change);
    assert.equal(result.rows[0].status, 'number_unobserved_in_incomplete_snapshot', change);
  }
});

test('ambiguous program labels and duplicate canonical numbers never resolve a card', () => {
  const { source, snapshot } = fixture(); snapshot.sections.cards.rows.push({ ...snapshot.sections.cards.rows[0], id: 'fixture-duplicate' });
  assert.equal(reconcileSports(source, snapshot).rows[0].status, 'ambiguous_canonical_number_key');
  snapshot.sections.programs.rows.push({ ...snapshot.sections.programs.rows[0], id: 'fixture-other-program', programId: 'fixture-other' });
  assert.equal(reconcileSports(source, snapshot).rows[0].status, 'ambiguous_exact_program_label');
});

test('wrong manufacturer pin, wrong set, cross-set rows and missing read-only guard reject', () => {
  for (const kind of ['pin', 'set', 'row', 'guard']) {
    const { source, snapshot } = fixture();
    if (kind === 'pin') source.source.sha256 = '0'.repeat(64);
    if (kind === 'set') snapshot.setId = 'Other';
    if (kind === 'row') snapshot.sections.cards.rows[0].setId = 'Other';
    if (kind === 'guard') snapshot.transaction.observed.read_only = 'off';
    assert.throws(() => reconcileSports(source, snapshot));
  }
});

test('team diagnostics separate literal, trademark-only and merged-marker differences', () => {
  const { source, snapshot } = fixture(); source.rows[0].printedTeamColumn = 'The University of Oklahoma®';
  snapshot.sections.cards.rows[0].team = 'The University of Oklahoma';
  assert.equal(reconcileSports(source, snapshot).rows[0].teamComparison.status, 'trademark_only_difference');
  snapshot.sections.cards.rows[0].team += '1st';
  assert.equal(reconcileSports(source, snapshot).rows[0].teamComparison.status, 'other_literal_difference');
});

test('frozen actual report accounts for every source row and all 171 blank numbers without assigned IDs', () => {
  const report = JSON.parse(readFileSync(new URL('./sports-reconciliation-report.unreviewed.json', import.meta.url)));
  assert.equal(report.rows.length, transcript.rows.length);
  for (const [index, row] of report.rows.entries()) {
    const source = transcript.rows[index];
    assert.deepEqual([row.sourceRowOrdinal, row.sourcePage, row.localProgramRef, row.printedCardNumber, row.printedName],
      [source.rowOrdinal, source.sourcePage, source.localProgramRef, source.printedCardNumber, source.printedName]);
    if (source.printedCardNumber === null) {
      assert.equal(row.status, 'unnumbered_source_identity_unresolved'); assert.equal(row.canonicalCardId, null); assert.equal(row.canonicalProgramId, null);
    }
  }
  assert.equal(report.summary.statusCounts.exact_program_number_name_match, 379);
  assert.equal(report.summary.statusCounts.unnumbered_source_identity_unresolved, 171);
  assert.equal(report.summary.teamComparisonCounts.other_literal_difference, 4);
  assert.equal(report.draftMetadata.latestVersion.rowCount, '61');
  assert.deepEqual(report.draftMetadata.versionShapeSummary.map(v => [v.version, v.datasetType, v.rowsArrayCount]), [[4, 'PARALLEL_DB', 61], [6, 'PARALLEL_DB', 61]]);
  assert.equal(report.scope.draftPayloadCompared, false);
});

test('derived version shape must bind exact version IDs, hashes and row counts', () => {
  const { source, snapshot } = fixture();
  snapshot.sections.versions.rows = [4, 6].map(v => ({ id: `fixture-version-${v}`, version: String(v), versionHash: `fixture-hash-${v}`, rowCount: '61' }));
  snapshot.sections.versions.totalRows = '2'; snapshot.sections.versions.returnedRows = 2;
  const shape = { schemaVersion: 'tenkings-sports-version-shape/v1', setId: SET_ID, checksComplete: true, truncated: false,
    transaction: structuredClone(snapshot.transaction), totalRows: '2', returnedRows: 2,
    rows: [4, 6].map(v => ({ id: `fixture-version-${v}`, version: v, versionHash: `fixture-hash-${v}`, rowCount: 61,
      embeddedSetIdMatches: true, rowsType: 'array', rowsArrayCount: 61, datasetType: 'PARALLEL_DB' })) };
  assert.equal(reconcileSports(source, snapshot, shape).draftMetadata.versionShapeSummary[1].datasetType, 'PARALLEL_DB');
  shape.rows[1].versionHash = 'wrong';
  assert.throws(() => reconcileSports(source, snapshot, shape), /drift/);
});
