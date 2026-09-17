#!/usr/bin/env node
// Offline, bounded source preparation. No database, network, upload or publish API.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canonicalJson, hashManifest, printingIdentityId, validateManifest } from '../../../packages/card-catalog-evidence/src/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const normal = value => String(value ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
const need = (condition, message) => { if (!condition) throw new Error(message); };
const PINNED = {
  'sports-checklist': { sha256: 'bf2f692f03dc215238001ed465d7ecda8bbf361cb459276b60482b839bc2a4ca', bytes: 529104,
    url: 'https://cdn.shopify.com/s/files/1/0662/9749/5709/files/2023BowmanUChromeFBChecklistNEW.pdf', kind: 'OFFICIAL_CHECKLIST' },
  'sports-odds-round2': { sha256: '72acc9a8682b495c028e278baa9825286ac98bbe8192bcba742ccc85f9175cf5', bytes: 265208,
    url: 'https://cdn.shopify.com/s/files/1/0662/9749/5709/files/2023BowmanUChromeFootballRound2Odds.pdf', kind: 'OFFICIAL_PRODUCT' },
  'pokemon-checklist': { sha256: 'd597ba707c20f1f8ec11e4809bb1f6e85bb0e502c05a93df41f36116a56dc923', bytes: 2227474,
    url: 'https://assets.pokemon.com/assets/cms2/pdf/trading-card-game/checklist/bw11_web_cardlist_en.pdf', kind: 'OFFICIAL_CHECKLIST' },
};
export const PILOTS = {
  sports: {
    category: 'SPORTS', label: '2023 Bowman University Chrome Football', year: '2023', manufacturer: 'Topps', publisher: null,
    setIds: ['2023 Bowman University Chrome Football', '2023_Bowman_University_Chrome_Football'],
    sourceIds: ['sports-checklist', 'sports-odds-round2'], programLabel: 'THE BIG KAHUNA',
    cards: [['TBK-1', 'Caleb Williams'], ['TBK-2', 'Drake Maye'], ['TBK-3', 'JJ McCarthy']],
    numberingScheme: 'prefixed_insert_number', language: null,
    printings: [
      { key: 'ordinary', label: 'THE BIG KAHUNA', parallelLabels: ['THE BIG KAHUNA', 'Base'], serialDenominator: null },
      { key: 'orange', label: 'Orange Refractor', parallelLabels: ['Orange Refractor', 'THE BIG KAHUNA ORANGE REFRACTOR'], serialDenominator: 25 },
      { key: 'superfractor', label: 'Superfractor', parallelLabels: ['Superfractor', 'THE BIG KAHUNA SUPERFRACTOR'], serialDenominator: 1 },
    ],
    textDetail: 'Three source-listed Big Kahuna identities only; full product checklist is not normalized or reviewed here.',
    applicabilityDetail: 'Program vocabulary is sourced. Every exact card/printing relation remains unknown; no Cartesian-product approval.',
    facts: [
      { sourceId: 'sports-checklist', page: 10, detail: 'TBK-1 Caleb Williams; TBK-2 Drake Maye; TBK-3 JJ McCarthy. Membership in The Big Kahuna only.' },
      { sourceId: 'sports-odds-round2', page: 2, detail: 'The Big Kahuna; Orange Refractor numbered to 25; Superfractor numbered to 1. Round 2 format columns are not per-card applicability.' },
    ],
  },
  pokemon: {
    category: 'POKEMON', label: 'Black & White—Legendary Treasures', year: '2013', manufacturer: null, publisher: 'Pokémon',
    setIds: ['Black & White-Legendary Treasures'],
    sourceIds: ['pokemon-checklist'], programLabel: 'Black & White-Legendary Treasures',
    cards: [['6', 'Snivy'], ['7', 'Servine'], ['RC1', 'Snivy'], ['RC2', 'Servine']],
    numberingScheme: 'manufacturer_checklist_number_no_denominator_in_source', language: 'en',
    printings: [
      { key: 'standard', label: 'standard set', parallelLabels: ['standard set'], serialDenominator: null },
      { key: 'parallel', label: 'parallel set', parallelLabels: ['parallel set'], serialDenominator: null },
    ],
    textDetail: 'Four English checklist identities only. RC prefixes are retained; collector-number denominators are not supplied by this source.',
    applicabilityDetail: 'Literal manufacturer checklist markers only; physical finish, edition, format and channel remain unresolved.',
    facts: [
      { sourceId: 'pokemon-checklist', page: 1, detail: '6 Snivy and 7 Servine show standard-set and parallel-set markers. RC1 Snivy and RC2 Servine show the standard-set marker. No denominator is printed.' },
    ],
  },
};

export const POKEMON_TRANSCRIPTION_SHA256 = 'e318dad8f283abb15c8d0a65736c81f1744a9d681c9bc3375836481c4d6345c1';
export const POKEMON_MAPPING_RECEIPT_SHA256 = '9c1a77a7993b8fd49f360e7d4ea82285845a83d80cd03ae5f102c22d70c55495';

/** Deterministic, unsubmitted worksheet from the unchanged transcription bytes.
 * This supplies a new key, not a database row, import, source-byte verification,
 * inferred subset/printing, manufacturer reuse grant or human approval. */
export function prepareCompletePokemonChecklist(transcriptionBytes) {
  need(Buffer.isBuffer(transcriptionBytes) || typeof transcriptionBytes === 'string', 'Exact transcription bytes are required.');
  const bytes = Buffer.from(transcriptionBytes);
  need(sha(bytes) === POKEMON_TRANSCRIPTION_SHA256, 'Pinned complete Pokémon transcription bytes differ.');
  const draft = JSON.parse(bytes.toString('utf8')), p = PILOTS.pokemon, pin = PINNED['pokemon-checklist'];
  const numbers = [...Array.from({ length: 113 }, (_, i) => String(i + 1)), ...Array.from({ length: 25 }, (_, i) => `RC${i + 1}`)];
  need(draft.canonicalSetId === null && draft.programId === null && draft.draftId === null
    && draft.source.sha256 === pin.sha256 && draft.source.url === pin.url && draft.source.byteSize === pin.bytes
    && draft.rows.length === numbers.length && draft.rows.every((row, i) => row.number === numbers[i]), 'Complete source roster or provenance differs.');
  const setId = p.setIds[0];
  return {
    schemaVersion: 'tenkings-complete-checklist-import-draft/v1',
    status: 'UNSUBMITTED_NEW_SET_BINDING_NO_DATABASE_RECORD', authority: 'unreviewed_source_transcription',
    transcriptionSha256: POKEMON_TRANSCRIPTION_SHA256, mappingReceiptSha256: POKEMON_MAPPING_RECEIPT_SHA256,
    binding: { setId, displayLabel: p.label, programLabel: p.programLabel, proposedProgramId: 'black-white-legendary-treasures',
      draftId: null, programRowId: null, separateRcProgram: null, databaseRecordCreated: false },
    requestDraft: {
      setId, datasetType: 'PLAYER_WORKSHEET', sourceUrl: pin.url, sourceProvider: 'Pokémon',
      parserVersion: 'catalog-pilot-complete-pokemon-transcription-v1',
      sourceQuery: { pilot: 'pokemon', product: p.label, program: p.programLabel, scope: 'complete 138 printed rows on the pinned English page' },
      sourceFetchMeta: { setId, sourceId: 'pokemon-checklist', url: pin.url, sha256: pin.sha256, byteSize: pin.bytes,
        sourceKind: 'OFFICIAL_CHECKLIST', sourcePage: 1, sourceManifestSha256: draft.source.sourceManifestSha256,
        transcriptionSha256: POKEMON_TRANSCRIPTION_SHA256, mappingReceiptSha256: POKEMON_MAPPING_RECEIPT_SHA256,
        displaySourceLabel: p.label, printedRowCount: 138, fullCardPrintingUniverse: 'unknown',
        sourceBytesVerifiedByPreparation: false, humanReviewed: false, rightsVerified: false, grant: null, images: [] },
      rawPayload: { setId, sourceUrl: pin.url, programs: [{ label: p.programLabel, cards: draft.rows.map(row => ({
        cardNumber: row.number, playerName: row.name, team: null, isRookie: null,
        metadata: { authority: 'unreviewed_source_transcription', sourceId: 'pokemon-checklist', sourceUrl: pin.url,
          sourceSha256: pin.sha256, sourceKind: 'OFFICIAL_CHECKLIST', sourcePage: row.sourcePage,
          sourceColumn: row.sourceColumn, sourceRowOrdinal: row.rowOrdinal, transcriptionSha256: POKEMON_TRANSCRIPTION_SHA256,
          printedNumber: row.number, printedName: row.name, literalChecklistMarkers: structuredClone(row.literalChecklistMarkers),
          literalRarityMarker: structuredClone(row.literalRarityMarker), language: 'en',
          numberingScheme: p.numberingScheme, collectorNumberDenominator: null, physicalFinish: null,
          edition: null, format: null, channel: null, humanReviewed: false },
      })) }] },
    },
    limits: ['Complete printed roster only; no all-printings completeness claim.',
      'No separately named RC program is established by this page.',
      'Literal symbols do not establish physical finish, denominator, edition, format, channel or odds.',
      'The shared publication recipe still selects only 6, 7, RC1 and RC2; this does not enlarge that selection.'],
    grant: null, images: [], reviewer: null, publication: null,
  };
}

export async function verifyPilotSources(sourceManifest, read = readFile) {
  need(sourceManifest?.schema === 'tenkings-source-discovery-draft-v1', 'Unrecognized source discovery manifest.');
  need(Array.isArray(sourceManifest.sources), 'Source roster missing.');
  const checked = {};
  for (const [id, pin] of Object.entries(PINNED)) {
    const matches = sourceManifest.sources.filter(s => s.id === id);
    need(matches.length === 1, `Expected one source: ${id}.`);
    const s = matches[0];
    need(s.url === pin.url && s.sha256 === pin.sha256 && s.byte_size === pin.bytes, `Pinned source metadata differs: ${id}.`);
    const bytes = await read(s.local_evidence_path);
    need(bytes.length === pin.bytes && sha(bytes) === pin.sha256, `Source bytes differ: ${id}.`);
    checked[id] = { ...s, sourceRef: `catalog:sha256:${pin.sha256}` };
  }
  return checked;
}

export function validateTaxonomyExport(value) {
  need(value?.schemaVersion === 'setops-catalog-taxonomy-export/v1' && value.authority === 'unreviewed_taxonomy_snapshot', 'Expected an unreviewed taxonomy export.');
  need(sha(canonicalJson(value.snapshot)) === value.snapshotSha256, 'Taxonomy export checksum differs.');
  const s = value.snapshot;
  need(s.setId === s.draft?.setId, 'Taxonomy set/draft mismatch.');
  for (const key of ['sources', 'programs', 'cards', 'parallels', 'variations', 'scopes']) {
    need(Array.isArray(s[key]) && s[key].length <= 5000, `Invalid bounded taxonomy roster: ${key}.`);
    need(new Set(s[key].map(r => r.id)).size === s[key].length, `Duplicate taxonomy IDs: ${key}.`);
    need(s[key].every(r => r.setId === s.setId), `Cross-set taxonomy row: ${key}.`);
  }
  return s;
}

function validateGrant(grant, sourceId) {
  need(grant && ['licensed', 'permission'].includes(grant.basis), `${sourceId}: manufacturer PDF reuse needs documented licensed/permission basis; possession is not owned_original.`);
  need(typeof grant.detail === 'string' && grant.detail.trim().length >= 40 && grant.detail.length <= 1000, `${sourceId}: provide the specific grant evidence, scope and rights holder in detail.`);
  need(Array.isArray(grant.consumers) && grant.consumers.length > 0 && grant.consumers.length <= 2
    && grant.consumers.every(c => ['inventory', 'atlas'].includes(c)) && new Set(grant.consumers).size === grant.consumers.length, `${sourceId}: explicit unique app-consumer roster required.`);
  need(Object.keys(grant).sort().join(',') === 'basis,consumers,detail', `${sourceId}: unexpected grant fields.`);
  return grant;
}

/** Compiler output remains unreviewed. The real host rechecks all taxonomy and
 * grants; export hashes and caller-supplied rights text are not authentication. */
export function compilePilot({ pilot, sources, taxonomy = null, selection = null, grants = null }) {
  const p = PILOTS[pilot]; need(p, 'Choose sports or pokemon.');
  const sourceRows = p.sourceIds.map(id => {
    const original = sources[id], pin = PINNED[id];
    need(original?.sha256 === pin.sha256 && original.url === pin.url && original.byte_size === pin.bytes, `Verified source metadata required: ${id}.`);
    return { sourceId: id, kind: pin.kind, sourceRef: `catalog:sha256:${pin.sha256}`, sourceUrl: pin.url,
      sha256: pin.sha256, parentSourceIds: [], originKeys: [`manufacturer-source:sha256:${pin.sha256}`] };
  });
  const report = { schemaVersion: 'tenkings-pilot-preparation/v1', status: 'DRAFT_REQUIRES_HUMAN_REVIEW', pilot,
    product: p.label, facts: p.facts.map(f => ({ ...f, sourceSha256: PINNED[f.sourceId].sha256 })),
    draftRows: { programLabel: p.programLabel,
      cards: p.cards.map(([number, name]) => ({ number, name, numberingScheme: p.numberingScheme, sourceId: p.sourceIds[0] })),
      printings: p.printings.map(v => ({ key: v.key, label: v.label, serialDenominator: v.serialDenominator,
        language: p.language, edition: null, format: null, channel: null })),
      applicability: p.cards.flatMap(([number]) => p.printings.map(v => ({ number, printingKey: v.key,
        status: pilot === 'pokemon' && (v.key === 'standard' || !number.startsWith('RC')) ? 'supported' : 'unknown',
        meaning: pilot === 'pokemon' ? 'Literal manufacturer row marker only; not physical finish confirmation.' : 'Program odds do not establish per-card printing applicability.' }))),
    },
    sourceArtifacts: p.sourceIds.map(id => ({ sourceId: id, ref: `catalog:sha256:${PINNED[id].sha256}`, sha256: PINNED[id].sha256,
      byteSize: PINNED[id].bytes, localPath: sources[id].local_evidence_path })),
    blockers: [], missingImages: 'No demonstrated image reuse rights or acquired images. Image coverage is unknown.',
    authority: 'unreviewed_offline_preparation', manifest: null, reviewPacket: null };
  if (!taxonomy) { report.blockers.push('Exact existing SetOps taxonomy export is required; no IDs were invented.'); return report; }
  const t = validateTaxonomyExport(taxonomy);
  need(p.setIds.includes(t.setId), 'Exact source-product SetOps binding is not in this reviewed preparation recipe; do not reuse another year/product mapping.');
  report.taxonomySnapshotSha256 = taxonomy.snapshotSha256;
  if (t.draft.archivedAt || t.draft.status !== 'APPROVED' || !t.latestVersion || t.latestVersion.blockingErrorCount
    || !Array.isArray(t.blockers) || t.blockers.length) {
    report.blockers.push('Prepare an active, approved latest clean SetOps draft and finish its seed/replacement work before evidence review.'); return report;
  }
  need(t.latestVersion.draftId === t.draft.id && /^[a-f0-9]{64}$/.test(t.latestVersion.versionHash), 'Exact latest draft/version binding missing.');
  if (!selection) {
    report.blockers.push('Explicit exact-row selection is required; name/number similarities are not automatic mapping authority.');
    report.selectionTemplate = { programRowId: null, cards: Object.fromEntries(p.cards.map(([n]) => [n, null])),
      printings: Object.fromEntries(p.printings.map(v => [v.key, { parallelRowId: null, scopeRowId: null }])),
      sources: Object.fromEntries(p.sourceIds.map(id => [id, null])) };
    return report;
  }
  const one = (rows, id, message) => { const row = rows.find(r => r.id === id); need(row, message); return row; };
  const program = one(t.programs, selection.programRowId, 'Selected program row is missing.');
  need(normal(program.label) === normal(p.programLabel), 'Selected program label is not supported by this narrow source recipe; reconcile the real taxonomy before preparing.');
  const cards = p.cards.map(([number, name]) => {
    const row = one(t.cards, selection.cards?.[number], `Selected card row missing: ${number}.`);
    need(row.programId === program.programId && row.cardNumber === number && row.playerName === name, `Exact card identity differs: ${number}.`);
    return { cardId: row.id, programId: program.programId, number, name, numberingScheme: p.numberingScheme, sourceIds: [p.sourceIds[0]] };
  });
  const printings = p.printings.map(spec => {
    const chosen = selection.printings?.[spec.key], parallel = one(t.parallels, chosen?.parallelRowId, `Parallel row missing: ${spec.key}.`);
    const scope = one(t.scopes, chosen?.scopeRowId, `Scope row missing: ${spec.key}.`);
    need(spec.parallelLabels.some(label => normal(label) === normal(parallel.label)), `Parallel label is unsupported: ${spec.key}.`);
    need(parallel.serialDenominator === spec.serialDenominator, `Serial-denominator evidence differs: ${spec.key}.`);
    need(scope.programId === program.programId && scope.parallelId === parallel.parallelId && scope.variationId === null, `Printing scope differs: ${spec.key}.`);
    // Null stays unknown. This recipe proves no edition/channel/format wildcard.
    need(scope.formatKey === null && scope.channelKey === null, `Review exact format/channel separately before using this recipe: ${spec.key}.`);
    const row = { programId: program.programId, parallelId: parallel.parallelId, parallelRowId: parallel.id,
      variationId: null, variationRowId: null, scopeRowId: scope.id, label: spec.label, language: p.language,
      edition: null, format: null, channel: null, sourceIds: [pilot === 'sports' ? 'sports-odds-round2' : 'pokemon-checklist'], diagnostics: [] };
    return { printingId: printingIdentityId(p.category, t.setId, row), ...row };
  });
  const sourceMappings = sourceRows.map(source => {
    const row = one(t.sources, selection.sources?.[source.sourceId], `Taxonomy source row missing: ${source.sourceId}.`);
    const allowed = source.kind === 'OFFICIAL_PRODUCT' ? ['OFFICIAL_CHECKLIST', 'OFFICIAL_ODDS'] : ['OFFICIAL_CHECKLIST'];
    need(row.sourceUrl === source.sourceUrl && allowed.includes(row.sourceKind), `Taxonomy source URL/classification differs: ${source.sourceId}.`);
    return { sourceId: source.sourceId, taxonomySourceId: row.id,
      classificationNote: `Manufacturer source bytes pinned by SHA-256. Exact ${row.sourceKind} taxonomy source URL matches. Review the complete PDF and page-specific preparation facts.` };
  });
  const prior = t.latestPublication ? { publicationId: t.latestPublication.id, setId: t.setId,
    revision: t.latestPublication.revision, manifestSha256: t.latestPublication.manifestSha256 } : null;
  const manifest = { schemaVersion: 'setops-catalog-evidence/v1',
    set: { category: p.category, setId: t.setId, label: p.label, year: p.year, manufacturer: p.manufacturer, publisher: p.publisher, sourceIds: [p.sourceIds[0]] },
    setOps: { draftId: t.draft.id, draftVersionId: t.latestVersion.id, legacyVersionHash: t.latestVersion.versionHash },
    revision: prior ? prior.revision + 1 : 1, supersedes: prior,
    coverage: { text: { status: 'partial', detail: p.textDetail, sourceIds: [p.sourceIds[0]] },
      applicability: { status: 'partial', detail: p.applicabilityDetail, sourceIds: p.sourceIds },
      images: { status: 'unknown', detail: report.missingImages, sourceIds: [] } },
    sources: sourceRows, programs: [{ programId: program.programId, rowId: program.id, label: program.label, sourceIds: [p.sourceIds[0]] }],
    cards, printings, applicability: cards.flatMap(card => printings.map((printing, i) => {
      const supported = pilot === 'pokemon' && (p.printings[i].key === 'standard' || !card.number.startsWith('RC'));
      return { cardId: card.cardId, printingId: printing.printingId, status: supported ? 'supported' : 'unknown',
        sourceIds: supported ? ['pokemon-checklist'] : [], note: supported
          ? 'Supports the literal checklist marker for this exact row only. Physical finish and unresolved scope still require review.'
          : 'No per-card evidence establishes this printing relationship. Missing entries or program odds cannot establish exclusion or support.' };
    })), aliases: [], images: [] };
  report.manifest = validateManifest(manifest); report.manifestSha256 = hashManifest(manifest);
  report.sourceMappings = sourceMappings;
  if (!grants) { report.blockers.push('Document specific manufacturer-source reuse permission/license for each source and intended consumer before creating a loadable review packet.'); return report; }
  need(Object.keys(grants).sort().join(',') === [...p.sourceIds].sort().join(','), 'Provide exactly the required source-grant roster.');
  const reviewEvidence = { sources: sourceMappings.map(mapping => ({ ...mapping, grant: validateGrant(grants[mapping.sourceId], mapping.sourceId) })), images: [] };
  report.reviewPacket = { manifest: report.manifest, reviewEvidence };
  report.blockers.push('Pending authenticated human evidence/grant review. Offline validation is not publication.');
  return report;
}

async function readJson(path) { need((await stat(path)).size <= 3 * 1024 * 1024, 'JSON input exceeds 3 MiB.'); return JSON.parse(await readFile(path, 'utf8')); }
async function main() {
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i += 2) {
    need(['--pilot', '--source-manifest', '--taxonomy', '--selection', '--grants', '--out'].includes(args[i]) && args[i + 1] && !Object.hasOwn(options, args[i]), 'Use --pilot sports|pokemon --out DIRECTORY [--source-manifest FILE] [--taxonomy FILE --selection FILE --grants FILE].');
    options[args[i]] = args[i + 1];
  }
  need(options['--pilot'] && options['--out'], '--pilot and --out are required.');
  const sourceManifest = await readJson(options['--source-manifest'] ?? join(here, 'source-manifest.draft.json'));
  const sources = await verifyPilotSources(sourceManifest);
  const report = compilePilot({ pilot: options['--pilot'], sources,
    taxonomy: options['--taxonomy'] ? await readJson(options['--taxonomy']) : null,
    selection: options['--selection'] ? await readJson(options['--selection']) : null,
    grants: options['--grants'] ? await readJson(options['--grants']) : null });
  const out = resolve(options['--out']); await mkdir(out, { recursive: true, mode: 0o700 });
  const write = (name, value) => writeFile(join(out, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  await write('preparation.json', report);
  if (report.selectionTemplate) await write('selection.template.json', report.selectionTemplate);
  if (report.manifest) await write('candidate-manifest.unreviewed.json', report.manifest);
  if (report.reviewPacket) await write('review-packet.unreviewed.json', report.reviewPacket);
  console.log(JSON.stringify({ status: report.status, pilot: report.pilot, manifestPrepared: Boolean(report.manifest),
    reviewPacketPrepared: Boolean(report.reviewPacket), blockers: report.blockers, output: out }, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
