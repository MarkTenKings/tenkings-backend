// Pure preparation only: no database, filesystem, network, authorization or writer.
import { createHash } from 'node:crypto';
import { canonicalJson } from '../../../packages/card-catalog-evidence/src/index.mjs';

export const PACKET_SHA256 = '3b27da05143c281ca3bf1905b22d19bb4c57e306caeefdea7582fb6be07c6664';
export const SET_ID = '2023_Bowman_University_Chrome_Football';
const SECTION_TABLES = {
  draft: 'SetDraft', versions: 'SetDraftVersion', sources: 'SetTaxonomySource', programs: 'SetProgram',
  cards: 'SetCard', parallels: 'SetParallel', variations: 'SetVariation', scopes: 'SetParallelScope',
  ingestions: 'SetIngestionJob', publications: 'SetCatalogEvidencePublication',
  activeSeedJobs: 'SetSeedJob', activeReplaceJobs: 'SetReplaceJob',
};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const duplicate = values => new Set(values).size !== values.length;
// These three ASCII labels are pinned by the packet. This is not a general
// replacement for taxonomyV2Utils/normalizeParallelLabel (which also decodes HTML).
const pinnedAsciiKey = label => label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** The caller supplies a count-accounted metadata snapshot, exact preparation
 * packet bytes, and local source bytes. A hash/receipt is not human authority.
 * Occupied keys fail closed; this function never proposes an update or upsert.
 * Unresolved lifecycle bindings deliberately make the result non-executable. */
export function prepareSportsAdditiveTaxonomy({ snapshot, packetBytes, sourceBytesById } = {}) {
  const conflicts = [];
  const fail = (code, target, detail) => conflicts.push({ code, target, detail });
  const result = { schemaVersion: 'tenkings-sports-additive-taxonomy-preparation/v1',
    authority: 'offline_preparation_not_import_or_approval', status: 'CONFLICT_NO_OPERATIONS',
    executable: false, request: null, writer: null, setId: SET_ID, conflicts, operations: [],
    requiredBindings: [], applicability: [], grants: null, reviewer: null, images: [],
    rightsVerified: false, humanApproved: false, databaseMutations: 0 };
  if (!(Buffer.isBuffer(packetBytes) || typeof packetBytes === 'string') || sha(packetBytes) !== PACKET_SHA256) {
    fail('PACKET_PIN_MISMATCH', 'packet', 'Exact immutable selected-pilot packet bytes required.'); return result;
  }
  const packet = JSON.parse(Buffer.from(packetBytes).toString('utf8'));
  for (const source of packet.sourceEvidence) {
    const bytes = sourceBytesById?.[source.sourceId];
    if (!(Buffer.isBuffer(bytes) || bytes instanceof Uint8Array) || bytes.length !== source.byteSize || sha(bytes) !== source.sha256) {
      fail('SOURCE_BYTES_MISMATCH', source.sourceId, 'Exact locally pinned source bytes required; this does not establish host staging or rights.');
    }
  }
  if (!snapshot || snapshot.schemaVersion !== 'tenkings-sports-taxonomy-readonly-snapshot/v1' || snapshot.setId !== SET_ID) {
    fail('SNAPSHOT_SCOPE_MISMATCH', 'snapshot', 'Exact sports metadata snapshot required.'); return result;
  }
  const serialized = JSON.stringify(snapshot);
  if (Buffer.byteLength(serialized) > 2 * 1024 * 1024) {
    fail('SNAPSHOT_TOO_LARGE', 'snapshot', 'Snapshot must not exceed 2 MiB.'); return result;
  }
  if (!snapshot.checksComplete || snapshot.status !== 'observed_complete_scope' || snapshot.outputTruncated
    || snapshot.mutationCount !== 0 || snapshot.transaction?.committed !== true
    || snapshot.transaction?.observed?.read_only !== 'on' || snapshot.transaction?.observed?.isolation !== 'repeatable read') {
    fail('INCOMPLETE_SNAPSHOT', 'snapshot', 'Complete read-only repeatable-read receipt required.');
  }
  const sections = snapshot.sections ?? {};
  for (const [name, table] of Object.entries(SECTION_TABLES)) {
    const s = sections[name];
    if (!s || s.table !== table || !Array.isArray(s.rows) || s.rows.length > 5000
      || !/^\d+$/.test(String(s.totalRows)) || Number(s.totalRows) !== s.rows.length || s.returnedRows !== s.rows.length
      || s.truncated !== false || s.fieldTruncation || s.withheldFields) {
      fail('INCOMPLETE_SECTION', name, 'Missing, truncated, withheld or unaccounted rows cannot establish absence.'); continue;
    }
    if (s.rows.some(row => !row || typeof row.id !== 'string' || !row.id || (row.setId != null && row.setId !== SET_ID))
      || duplicate(s.rows.map(row => row?.id))) fail('INVALID_SECTION_IDENTITY', name, 'Cross-set, missing or duplicate row identity.');
  }
  if (conflicts.length) return result;
  const rows = Object.fromEntries(Object.entries(SECTION_TABLES).map(([name]) => [name, sections[name].rows]));
  const text = value => typeof value === 'string' && value.length > 0 && value.length <= 512;
  const nullableText = value => value === null || text(value);
  if (rows.parallels.some(p => !text(p.parallelId) || !text(p.label))
    || rows.scopes.some(s => !text(s.scopeKey) || !text(s.programId) || !text(s.parallelId)
      || !nullableText(s.variationId) || !nullableText(s.formatKey) || !nullableText(s.channelKey))) {
    fail('MISSING_KEY_METADATA', 'parallels/scopes', 'Omitted key/dimension fields cannot establish a free target key.');
  }
  const binding = packet.existingSetOpsBinding;
  const draft = rows.draft[0];
  const latest = [...rows.versions].sort((a, b) => Number(b.version) - Number(a.version))[0];
  if (rows.draft.length !== 1 || draft.id !== binding.draftId || draft.status !== 'APPROVED' || draft.archivedAt !== null
    || draft.currentCatalogPublicationId !== null || !latest || latest.id !== binding.draftVersionId
    || latest.versionHash !== binding.legacyVersionHash || Number(latest.version) !== binding.version
    || Number(latest.blockingErrorCount) !== 0 || rows.versions.some(v => v.draftId !== draft.id)
    || rows.activeSeedJobs.length || rows.activeReplaceJobs.length || rows.publications.length) {
    fail('BASELINE_CHANGED', 'draft', 'Refresh preparation after draft/version/publication or active work changes; never rewrite its history.');
  }
  if (rows.cards.length !== 379 || rows.programs.length !== 10 || rows.versions.length !== 6
    || duplicate(rows.programs.map(p => p.programId)) || duplicate(rows.cards.map(c => `${c.programId}::${c.cardNumber}`))) {
    fail('IDENTITY_ROSTER_CHANGED', 'cards/programs/versions', 'This proposal preserves the observed 379-card, ten-program, six-version baseline. Reconcile changes separately.');
  }
  const selectedProgram = packet.identityOnlyContractProbe.manifest.programs[0];
  if (rows.programs.filter(p => p.programId === selectedProgram.programId || p.label === selectedProgram.label).length !== 1
    || !rows.programs.some(p => p.id === selectedProgram.rowId && p.programId === selectedProgram.programId && p.label === selectedProgram.label)) {
    fail('PROGRAM_BINDING_MISMATCH', selectedProgram.programId, 'Existing exact program row, key and label required.');
  }
  for (const card of packet.selectedIdentities) {
    if (!rows.cards.some(c => c.id === card.cardId && c.programId === card.programId && c.cardNumber === card.number && c.playerName === card.name)) {
      fail('CARD_BINDING_MISMATCH', card.number, 'Existing canonical card ID, program, printed number and name must agree.');
    }
  }
  for (const source of rows.sources) {
    if (!['missing', 'pinned_sports_checklist', 'pinned_sports_odds', 'other_url_withheld'].includes(source.sourceUrlMatch)) {
      fail('SOURCE_URL_UNACCOUNTED', source.id, 'Exact URL match classification is missing.');
    } else if (source.sourceUrlMatch.startsWith('pinned_sports_')) {
      fail('SOURCE_ALREADY_PRESENT', source.id, 'Exact source URL is already occupied. Review/reuse separately; never create a duplicate or reclassify this row.');
    }
  }
  const printings = packet.printingVocabularyEvidence.map(p => ({ ...p, proposedParallelId: pinnedAsciiKey(p.label),
    proposedScopeKey: [selectedProgram.programId, pinnedAsciiKey(p.label), 'none', 'any', 'any'].join('::') }));
  for (const printing of printings) {
    if (rows.parallels.some(p => p.parallelId === printing.proposedParallelId
      || (typeof p.label === 'string' && pinnedAsciiKey(p.label) === printing.proposedParallelId))) {
      fail('PARALLEL_ALREADY_PRESENT', printing.key, 'Proposed parallel key/label is occupied. Do not fill, overwrite, relabel or deduplicate existing metadata.');
    }
    if (rows.scopes.some(s => s.scopeKey === printing.proposedScopeKey
      || (s.programId === selectedProgram.programId && s.parallelId === printing.proposedParallelId
        && s.variationId === null && s.formatKey === null && s.channelKey === null))) {
      fail('SCOPE_ALREADY_PRESENT', printing.key, 'Proposed scope is occupied. Do not silently reuse or alter it.');
    }
  }
  if (conflicts.length) return result;
  const preservation = {};
  for (const [name, table] of Object.entries(SECTION_TABLES)) {
    preservation[name] = { table, observedRows: rows[name].length,
      metadataSha256: sha(canonicalJson([...rows[name]].sort((a, b) => a.id.localeCompare(b.id)))),
      actionOnExistingRows: 'none' };
  }
  result.status = 'PREPARED_UNSUBMITTED_LIFECYCLE_BINDINGS_REQUIRED';
  result.provenance = { packetSha256: PACKET_SHA256, snapshotObservedAt: snapshot.finishedAt,
    snapshotCanonicalSha256: sha(canonicalJson(snapshot)), rawSnapshotSha256: null,
    localSourceBytesVerified: true, serverStagingVerified: false };
  result.preservation = preservation;
  result.existingBinding = { setId: SET_ID, draftId: draft.id, draftVersionId: latest.id, versionHash: latest.versionHash,
    programRowId: selectedProgram.rowId, programId: selectedProgram.programId,
    cards: packet.selectedIdentities.map(c => ({ cardId: c.cardId, number: c.number, name: c.name })) };
  result.requiredBindings = packet.sourceEvidence.map(source => ({ ref: `pending-ingestion:${source.sourceId}`,
    field: 'ingestionJobId', value: null, required: true, constraint: 'A distinct real pending ingestion job (QUEUED/PARSED/REVIEW_REQUIRED) for this exact set/source and pinned bytes, verified in the future transaction.',
    reason: 'ingestionJobId=null is immediately visible to published taxonomy readers. No existing secondary/approved job may be borrowed.',
    sourceUrl: source.url, sourceSha256: source.sha256 }));
  for (const source of packet.sourceEvidence) {
    const checklist = source.sourceId === 'sports-checklist';
    result.operations.push({ ref: `source:${source.sourceId}`, model: 'SetTaxonomySource', action: 'create',
      databaseRowId: null, data: { setId: SET_ID, artifactType: checklist ? 'CHECKLIST' : 'ODDS',
        sourceKind: checklist ? 'OFFICIAL_CHECKLIST' : 'OFFICIAL_ODDS', sourceLabel: `pinned-pilot-additive:${source.sourceId}`,
        sourceUrl: source.url, parserVersion: 'catalog-pilot-additive-preparation-v1', sourceTimestamp: null, parserConfidence: null,
        metadataJson: { authority: 'unreviewed_source_transcription', sourcePinMatched: true, sourceProvider: 'Topps',
          sourceId: source.sourceId, sourceSha256: source.sha256, sourceByteSize: source.byteSize,
          sourceRef: source.sourceRef, sourcePage: checklist ? 10 : 2, localBytesVerifiedInPreparation: true,
          sourceBytesVerifiedAtServer: false, rightsVerified: false, humanReviewed: false,
          sourceRows: checklist ? packet.selectedIdentities.map(c => c.sourceEvidence[0])
            : printings.map(p => ({ sourcePage: p.sourcePage, literalSourceRow: p.literalExtractedLine, serialDenominator: p.serialDenominator })) } },
      requiredBindings: { ingestionJobId: `pending-ingestion:${source.sourceId}` } });
  }
  for (const printing of printings) {
    result.operations.push({ ref: `parallel:${printing.key}`, model: 'SetParallel', action: 'create', databaseRowId: null,
      data: { setId: SET_ID, parallelId: printing.proposedParallelId, label: printing.label,
        serialDenominator: printing.serialDenominator, serialText: null, finishFamily: null, visualCuesJson: null },
      requiredBindings: { sourceId: 'source:sports-odds-round2' } });
    result.operations.push({ ref: `scope:${printing.key}`, model: 'SetParallelScope', action: 'create', databaseRowId: null,
      data: { setId: SET_ID, scopeKey: printing.proposedScopeKey, programId: selectedProgram.programId,
        parallelId: printing.proposedParallelId, variationId: null, formatKey: null, channelKey: null },
      requiredBindings: { sourceId: 'source:sports-odds-round2' } });
  }
  result.applicability = packet.applicabilityDraft.map(row => ({ ...row }));
  result.printingMapping = printings.map(p => ({ key: p.key, proposedParallelId: p.proposedParallelId, proposedScopeKey: p.proposedScopeKey,
    parallelRowId: null, scopeRowId: null, printingId: null, language: null, edition: null, format: null, channel: null, variationId: null,
    programRowId: selectedProgram.rowId, scopeMeaning: 'Program-level source vocabulary only. none/any are legacy storage sentinels, not evidence of all-card/all-format applicability.' }));
  result.excluded = { otherNumberedCards: 376, unresolvedUnnumberedRows: 171,
    fullCatalogCompletionRequired: false, inferredNumberAssignments: 0, oddsRows: 0, cardOrProgramWrites: 0,
    draftVersionWrites: 0, legacyBridges: 0, sourceReclassifications: 0, publications: 0 };
  return result;
}
