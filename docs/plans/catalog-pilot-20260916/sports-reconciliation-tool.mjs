import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const SET_ID = '2023_Bowman_University_Chrome_Football';
export const TRANSCRIPT_SHA256 = 'f952b5d5c236c61921eebc2b13bfaead71c15867e3ba2f083fc0cac15ce5fdbf';
export const SNAPSHOT_SHA256 = 'c042a3fd5b1c5fb25c8bc218f7125663fca49ab29382d8a97d4fdce9b0523bdc';
export const VERSION_SHAPE_SHA256 = '678c9398d4b96c938b18c52f6246eed1281f5616e9ec7e9f1b770378f63d0af1';
const SOURCE_SHA256 = 'bf2f692f03dc215238001ed465d7ecda8bbf361cb459276b60482b839bc2a4ca';
const SECTIONS = ['draft', 'versions', 'sources', 'programs', 'cards', 'parallels', 'variations', 'scopes', 'ingestions', 'publications', 'activeSeedJobs', 'activeReplaceJobs'];
const need = (condition, message) => { if (!condition) throw new Error(message); };
const group = (rows, key) => {
  const map = new Map();
  for (const row of rows) { const k = key(row); map.set(k, [...(map.get(k) ?? []), row]); }
  return map;
};
const counts = (rows, key) => Object.fromEntries([...group(rows, key)].map(([key, entries]) => [key, entries.length]));

/** Exact literal comparison only. This function neither changes the input nor
 * assigns canonical identity to an unnumbered source row. Snapshot matches are
 * observations, never import, draft-payload, rights or publication approval. */
export function reconcileSports(transcript, snapshot, versionShape = null) {
  need(transcript?.source?.sha256 === SOURCE_SHA256 && transcript?.source?.byteSize === 529104
    && transcript?.source?.pageCount === 18, 'Wrong pinned manufacturer source.');
  need(snapshot?.schemaVersion === 'tenkings-sports-taxonomy-readonly-snapshot/v1'
    && snapshot.setId === SET_ID, 'Wrong exact-set snapshot.');
  need(snapshot.transaction?.committed === true && snapshot.transaction?.observed?.read_only === 'on'
    && snapshot.transaction?.observed?.isolation === 'repeatable read', 'Read-only snapshot guards missing.');
  need(Array.isArray(transcript.rows) && transcript.rows.length <= 1000
    && Array.isArray(transcript.programs), 'Invalid source roster.');
  const sections = snapshot.sections ?? {};
  for (const name of SECTIONS) {
    const section = sections[name];
    need(!section || (Array.isArray(section.rows) && section.rows.length <= 5000), `Invalid ${name} section.`);
    for (const row of section?.rows ?? []) {
      need(row.setId == null || row.setId === SET_ID, 'Cross-set row cannot be reconciled.');
    }
  }
  const complete = snapshot.checksComplete === true && snapshot.status === 'observed_complete_scope'
    && !snapshot.outputTruncated && SECTIONS.every(name => {
      const s = sections[name];
      return s && !s.truncated && !s.fieldTruncation && !s.withheldFields
        && Number(s.totalRows) === s.rows.length && s.returnedRows === s.rows.length;
    });
  const canonicalPrograms = sections.programs?.rows ?? [];
  const canonicalCards = sections.cards?.rows ?? [];
  const programByLabel = group(canonicalPrograms, p => p.label);
  const cardsByKey = group(canonicalCards, c => JSON.stringify([c.programId, c.cardNumber]));
  const sourcePrograms = new Map(transcript.programs.map(p => [p.localProgramRef, p]));
  need(sourcePrograms.size === transcript.programs.length, 'Duplicate source program reference.');
  const usedCardIds = new Set();
  const rows = transcript.rows.map(source => {
    const sourceProgram = sourcePrograms.get(source.localProgramRef);
    need(sourceProgram && Number.isInteger(source.rowOrdinal) && typeof source.printedName === 'string', 'Invalid source row provenance.');
    const matches = programByLabel.get(sourceProgram.literalHeading) ?? [];
    const row = { sourceRowOrdinal: source.rowOrdinal, sourcePage: source.sourcePage,
      localProgramRef: source.localProgramRef, printedCardNumber: source.printedCardNumber,
      printedName: source.printedName, exactProgramLabelMatches: matches.length,
      canonicalProgramId: null, canonicalCardId: null };
    if (source.printedCardNumber === null) {
      return { ...row, status: 'unnumbered_source_identity_unresolved' };
    }
    need(typeof source.printedCardNumber === 'string' && source.printedCardNumber.length > 0, 'Invalid printed card number.');
    if (!matches.length) return { ...row, status: complete ? 'no_exact_program_label_in_snapshot' : 'program_unobserved_in_incomplete_snapshot' };
    if (matches.length !== 1) return { ...row, status: 'ambiguous_exact_program_label' };
    row.canonicalProgramId = matches[0].programId;
    const candidates = cardsByKey.get(JSON.stringify([matches[0].programId, source.printedCardNumber])) ?? [];
    if (!candidates.length) return { ...row, status: complete ? 'number_not_found_in_exact_program_snapshot' : 'number_unobserved_in_incomplete_snapshot' };
    if (candidates.length !== 1) return { ...row, status: 'ambiguous_canonical_number_key' };
    const candidate = candidates[0];
    usedCardIds.add(candidate.id);
    row.canonicalCardId = candidate.id;
    row.observedCanonicalName = candidate.playerName;
    row.status = candidate.playerName === source.printedName ? 'exact_program_number_name_match' : 'same_program_number_name_conflict';
    // Trademark-only is a diagnostic label, never a normalized write or alias.
    const printedTeam = source.printedTeamColumn;
    const observedTeam = candidate.team ?? null;
    row.teamComparison = { printed: printedTeam, observed: observedTeam,
      status: printedTeam === observedTeam ? 'literal_equal'
        : observedTeam === null ? 'canonical_team_unrecorded'
          : printedTeam.replace(/[®™]/g, '') === observedTeam ? 'trademark_only_difference' : 'other_literal_difference' };
    return row;
  });
  need(new Set(rows.map(r => r.sourceRowOrdinal)).size === rows.length, 'Duplicate source row ordinal.');
  const programs = transcript.programs.map(p => {
    const roster = rows.filter(r => r.localProgramRef === p.localProgramRef);
    const matches = programByLabel.get(p.literalHeading) ?? [];
    return { localProgramRef: p.localProgramRef, literalHeading: p.literalHeading,
      sourceRowCount: roster.length, exactLabelCanonicalProgramIds: matches.map(p => p.programId),
      statusCounts: counts(roster, r => r.status) };
  });
  if (versionShape) {
    need(versionShape.schemaVersion === 'tenkings-sports-version-shape/v1' && versionShape.setId === SET_ID
      && versionShape.checksComplete === true && !versionShape.truncated
      && versionShape.transaction?.committed === true && versionShape.transaction?.observed?.read_only === 'on'
      && versionShape.transaction?.observed?.isolation === 'repeatable read'
      && versionShape.totalRows === '2' && versionShape.returnedRows === 2
      && Array.isArray(versionShape.rows) && versionShape.rows.length === 2, 'Incomplete version-shape receipt.');
    for (const shape of versionShape.rows) {
      const observed = sections.versions?.rows.find(v => v.id === shape.id);
      need(observed && observed.versionHash === shape.versionHash && Number(observed.version) === shape.version
        && Number(observed.rowCount) === shape.rowCount && shape.embeddedSetIdMatches === true
        && shape.rowsType === 'array' && shape.rowsArrayCount === shape.rowCount, 'Version-shape identity/hash/count drift.');
    }
    need(new Set(versionShape.rows.map(v => v.version)).size === 2, 'Duplicate version-shape identity.');
  }
  const latestVersion = [...(sections.versions?.rows ?? [])].sort((a, b) => Number(b.version)-Number(a.version))[0] ?? null;
  return {
    schemaVersion: 'tenkings-sports-source-taxonomy-reconciliation/v1',
    authority: 'offline_metadata_comparison_not_import_or_approval', setId: SET_ID,
    inputs: { transcriptSha256: null, snapshotSha256: null, versionShapeSha256: null,
      snapshotStartedAt: snapshot.startedAt, snapshotFinishedAt: snapshot.finishedAt },
    scope: { completeEnumeratedMetadata: complete, draftPayloadCompared: false,
      canonicalIdentityAssignedToSource: false, rightsReviewed: false, humanApproved: false,
      limits: 'Exact SetProgram labels and SetCard number/name fields only. No fuzzy normalization, cross-program join, inferred number, source reclassification or draft replacement. No latest-version dataJson was read.' },
    summary: { sourceRows: rows.length, observedCanonicalPrograms: canonicalPrograms.length,
      observedCanonicalCards: canonicalCards.length, statusCounts: counts(rows, r => r.status),
      teamComparisonCounts: counts(rows.filter(r => r.teamComparison), r => r.teamComparison.status),
      observedCanonicalCardsWithoutNumberedSourceKey: canonicalCards.filter(c => !usedCardIds.has(c.id)).length },
    snapshotScope: Object.fromEntries(SECTIONS.map(name => {
      const s = sections[name]; return [name, s ? { totalRows: s.totalRows, returnedRows: s.returnedRows,
        truncated: !!s.truncated, fieldTruncation: !!s.fieldTruncation, withheldFields: s.withheldFields ?? 0 } : { missing: true }];
    })),
    draftMetadata: { draft: sections.draft?.rows ?? [], latestVersion,
      versionCounts: (sections.versions?.rows ?? []).map(v => ({ version: Number(v.version), rowCount: Number(v.rowCount), versionHash: v.versionHash })).sort((a,b) => a.version-b.version),
      versionShapeSummary: versionShape?.rows.map(v => ({ id: v.id, version: v.version, versionHash: v.versionHash, datasetType: v.datasetType, rowsArrayCount: v.rowsArrayCount })) ?? null,
      caveat: versionShape ? 'Bound metadata establishes the recorded dataset type and array length. A PARALLEL_DB row count is separate from SetCard identity count; full row payloads were not compared.' : 'Version rowCount is metadata, potentially for another dataset; it does not identify the payload or prove that the approved version contains the 379 canonical cards.' },
    sourceMetadata: (sections.sources?.rows ?? []).map(s => ({ id: s.id, sourceKind: s.sourceKind,
      artifactType: s.artifactType, sourceUrlMatch: s.sourceUrlMatch })),
    programs, rows,
    observedCanonicalCardsWithoutNumberedSourceKey: canonicalCards.filter(c => !usedCardIds.has(c.id)).map(c => ({ id: c.id, programId: c.programId, cardNumber: c.cardNumber, playerName: c.playerName })),
  };
}

export function readPinnedJson(path, expectedSha256) {
  const bytes = readFileSync(path);
  need(bytes.length <= 2 * 1024 * 1024, 'Input exceeds 2 MiB.');
  need(createHash('sha256').update(bytes).digest('hex') === expectedSha256, 'Input byte hash differs from reviewed pin.');
  return JSON.parse(bytes);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [snapshotPath, shapePath, outputPath, ...extra] = process.argv.slice(2);
  need(snapshotPath && shapePath && outputPath && !extra.length, 'Usage: node sports-reconciliation-tool.mjs SNAPSHOT_PATH VERSION_SHAPE_PATH NEW_REPORT_PATH');
  const transcript = readPinnedJson(new URL('./sports-complete-checklist.unreviewed.json', import.meta.url), TRANSCRIPT_SHA256);
  const snapshot = readPinnedJson(snapshotPath, SNAPSHOT_SHA256);
  const versionShape = readPinnedJson(shapePath, VERSION_SHAPE_SHA256);
  const report = reconcileSports(transcript, snapshot, versionShape);
  report.inputs.transcriptSha256 = TRANSCRIPT_SHA256;
  report.inputs.snapshotSha256 = SNAPSHOT_SHA256;
  report.inputs.versionShapeSha256 = VERSION_SHAPE_SHA256;
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  process.stdout.write(`${JSON.stringify(report.summary)}\n`);
}
