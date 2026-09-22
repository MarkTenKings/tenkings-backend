/** Offline replay only. Versioned application source is copied into a private
 * temporary directory; external providers/storage are injected or fail closed. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

export const RESEARCH_REPLAY_BASELINE = '38c95335';
export const replayHash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const fileMap = {
  engine: 'frontend/nextjs-app/lib/server/staffInventoryResearch.ts',
  schema: 'packages/shared/src/staffInventoryResearch.ts',
  price: 'frontend/nextjs-app/lib/server/staffInventoryResearchPrice.ts',
  decisions: 'frontend/nextjs-app/lib/server/staffInventoryResearchDecisions.ts',
  evidence: 'frontend/nextjs-app/lib/server/staffInventoryResearchEvidence.ts',
  scopeEffect: 'frontend/nextjs-app/lib/server/cardCatalogScopeEffect.ts',
  saleDetails: 'packages/shared/src/staffInventoryResearchSaleDetails.ts',
};
const recoveryDisabled = 'export function applyStaffInventoryResearchRecoveryContext(){throw Error("Frozen replay does not admit recovery enrichment")}\n';
const git = (root: string, args: string[]) => execFileSync('/usr/bin/git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
export async function loadResearchReplayVersions(root: string) {
  const baselineCommit = git(root, ['rev-parse', `${RESEARCH_REPLAY_BASELINE}^{commit}`]).trim();
  const candidateCommit = git(root, ['rev-parse', 'HEAD']).trim();
  // These existing pure package dependencies are shared only when their source
  // and package manifest are unchanged from the actual serving baseline.
  if (git(root, ['diff', baselineCommit, '--', 'packages/ebay-sold-comps-v2']).trim()) throw Error('Shared parser changed; freeze a versioned parser before replay.');
  const directory = await mkdtemp(join(tmpdir(), 'tk-research-replay-'));
  const resolver = createRequire(join(root, fileMap.engine));
  const hashes: Record<string, Record<string, string>> = { baseline: {}, candidate: {} };
  const runtimeImports = new Map([
    ['../staffInventoryResearch', 'schema'], ['./staffInventoryResearchPrice', 'price'],
    ['./staffInventoryResearchDecisions', 'decisions'], ['./cardCatalogScopeEffect', 'scopeEffect'], ['./staffInventoryResearchEvidence', 'evidence'],
    ['./staffInventoryResearchSaleDetails', 'saleDetails'],
    // The fixed baseline tapes contain no recognition/recovery receipt. Fail
    // closed if a caller tries to enrich them, rather than loading live shared
    // recovery logic or silently treating a supplied assessment as valid.
    ['./staffInventoryResearchRecoveryContext', 'no-recovery'],
    ['./staffInventoryIdentification', 'no-io'], ['./storage', 'no-io'],
  ]);
  try {
    for (const version of ['baseline', 'candidate'] as const) {
      await writeFile(join(directory, `${version}-no-io.ts`), 'export function readStaffInventoryPhoto(){throw Error("Replay storage is disabled")}\nexport function getStorageMode(){throw Error("Replay storage is disabled")}\n', { mode: 0o600 });
      if (version === 'candidate') {
        await writeFile(join(directory, 'candidate-no-recovery.ts'), recoveryDisabled, { mode: 0o600 });
        hashes.candidate['replay:recovery-disabled'] = replayHash(recoveryDisabled);
      }
      for (const [name, path] of Object.entries(fileMap)) {
        if (version === 'baseline' && ['decisions', 'evidence', 'scopeEffect', 'saleDetails'].includes(name)) continue;
        let source = version === 'baseline' ? git(root, ['show', `${baselineCommit}:${path}`]) : await readFile(join(root, path), 'utf8');
        hashes[version][path] = replayHash(source);
        // Resolve only known relative dependencies; unexpected imports stop the
        // replay instead of giving copied code network/database access.
        source = source.replace(/\bimport\s+type\s+[^;]+;/g, '').replace(/\bfrom\s+(['"])([^'"]+)\1/g, (_all, quote: string, specifier: string) => {
          const local = runtimeImports.get(specifier);
          const target = local ? `./${version}-${local}.ts` : specifier.startsWith('node:') ? specifier
            : specifier.startsWith('.') ? (() => { throw Error(`Unreviewed replay import ${specifier}`); })()
              : resolver.resolve(specifier);
          return `from ${quote}${target}${quote}`;
        });
        if (name === 'engine') source += '\nexport { comparisonAssessment as replayComparison, titleMatches as replayTitle, conditionMatches as replayCondition };\n';
        await writeFile(join(directory, `${version}-${name}.ts`), source, { mode: 0o600 });
      }
    }
    const loadedBaseline = await import(pathToFileURL(join(directory, 'baseline-engine.ts')).href);
    const baseline = loadedBaseline.researchStaffInventoryCard ? loadedBaseline : loadedBaseline.default;
    const loadedCandidate = await import(pathToFileURL(join(directory, 'candidate-engine.ts')).href);
    const candidate = loadedCandidate.researchStaffInventoryCard ? loadedCandidate : loadedCandidate.default;
    return { baseline, candidate, baselineCommit, candidateCommit, hashes, close: () => rm(directory, { recursive: true, force: true }) };
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
}

type ReplayCase = { id: string; positive: boolean; expectedMatch: boolean; expectedEstimate: boolean; description: Record<string, unknown>; title: string; grade: number | null; patch?: Record<string, unknown> };
export const RESEARCH_REPLAY_CASES: ReplayCase[] = [
  { id: 'anniversary_design_year', positive: true, expectedMatch: true, expectedEstimate: true, description: { name: 'Bo Bichette', year: '2020', manufacturer: 'Topps', set_name: 'Topps', card_number: '85A-BB', card_type: 'Baseball' }, title: '2020 Topps Bo Bichette #85A-BB 1985 35th Anniversary PSA 9', grade: 9 },
  { id: 'psa_nm_mt', positive: true, expectedMatch: true, expectedEstimate: true, description: { name: 'Ken Griffey Jr', year: '1989', manufacturer: 'Donruss', set_name: 'Donruss Baseball', card_number: '33', card_type: 'Baseball' }, title: '1989 Donruss Ken Griffey Jr #33 PSA NM-MT 8', grade: 8 },
  { id: 'descriptive_sport_suffix', positive: true, expectedMatch: true, expectedEstimate: true, description: { name: 'Jayson Tatum', year: '2023', manufacturer: 'Panini', set_name: 'Contenders Basketball', card_number: '77', card_type: 'Basketball' }, title: '2023 Panini Contenders Jayson Tatum #77 Raw', grade: null },
].map(value => value as ReplayCase);

function allCases(): ReplayCase[] {
  const [anniversary, grade, sport] = RESEARCH_REPLAY_CASES;
  const exact = { ...sport, description: { ...sport.description, set_name: 'Contenders' } };
  return [...RESEARCH_REPLAY_CASES,
    { ...anniversary, id: 'wrong_release', positive: false, expectedMatch: false, expectedEstimate: false, title: anniversary.title.replace('2020', '2021') },
    { ...grade, id: 'wrong_grade', positive: false, expectedMatch: false, expectedEstimate: false, title: grade.title.replace('NM-MT 8', 'NM-MT 9') },
    { ...sport, id: 'wrong_product', positive: false, expectedMatch: false, expectedEstimate: false, title: sport.title.replace('Jayson Tatum', 'Jayson Tatum Optic') },
    { ...sport, id: 'wrong_card_number', positive: false, expectedMatch: false, expectedEstimate: false, title: sport.title.replace('#77', '#78') },
    { ...sport, id: 'wrong_parallel', positive: false, expectedMatch: false, expectedEstimate: false, description: { ...sport.description, variant: 'Blue Ice' }, title: sport.title + ' Red Ice' },
    { ...sport, id: 'choice_listing', positive: false, expectedMatch: false, expectedEstimate: false, title: sport.title + ' Choose Your Card' },
    { ...sport, id: 'price_range', positive: false, expectedMatch: false, expectedEstimate: false, patch: { soldPrice: '10.00-20.00' } },
    { ...exact, id: 'missing_offer_flag', positive: false, expectedMatch: true, expectedEstimate: false, patch: { bestOfferAccepted: undefined } },
    { ...exact, id: 'missing_sold_status', positive: false, expectedMatch: true, expectedEstimate: false, patch: { listingType: undefined } },
    { ...exact, id: 'active_listing', positive: false, expectedMatch: true, expectedEstimate: false, patch: { listingType: 'active' } },
  ];
}

export async function replaySyntheticResearch(versions: Awaited<ReturnType<typeof loadResearchReplayVersions>>) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw Error('Replay cannot use real network transport'); };
  try {
  const photos = await Promise.all(['white', 'blue', 'red', 'green'].map(background => sharp({ create: { width: 100, height: 140, channels: 3, background } }).jpeg().toBuffer()));
  const key = (bytes: Buffer) => `inventory-photos/11111111-1111-4111-8111-111111111111/${replayHash(bytes)}.jpg`;
  const now = '2026-09-16T00:00:00.000Z';
  const rows: any[] = [];
  for (const example of allCases()) {
    const input = { schema_version: 1, unit_id: `replay-${example.id}`, description_event_id: 'replay-description', description_hash: 'b'.repeat(64),
      description: { category: 'Sports cards', variant: null, ...example.description }, front_photo_key: key(photos[0]), back_photo_key: key(photos[1]) };
    const query = versions.baseline.buildStaffInventoryResearchQuery(input.description);
    const source = { keyword: query, page: 1, hasNextPage: false, totalItems: 2, items: [0, 1].map(index => ({
      itemId: `11111111111${index}`, url: `https://www.ebay.com/itm/11111111111${index}`, title: example.title, condition: example.grade === null ? 'Ungraded' : 'Graded',
      soldPrice: index ? '10.02' : '10.01', soldCurrency: 'USD', bestOfferAccepted: false, listingType: 'sold', endedAt: '2026-09-09', thumbnailUrl: `https://i.ebayimg.com/images/g/replay${index}/s-l400.jpg`, ...example.patch,
    })) };
    const variant = String(input.description.variant ?? 'Base');
    const reference = { id: 'catalog:replay', kind: 'catalog', trust: 'published_catalog', catalog_id: 'replay-catalog',
      identity: { ...input.description, variant: undefined, card_type: undefined }, variant_name: variant, variant_kind: variant === 'Base' ? 'BASE' : 'PARALLEL',
      source_url: null, source_sha256: 'c'.repeat(64), captured_at: now, distinguishing_features: ['A printed circular fixture mark'], image: null };
    // The model tape deliberately asserts a match for controls, testing that
    // deterministic guards reject it. These synthetic labels are not accuracy truth.
    const analysis = { identity: { status: variant === 'Base' ? 'base' : 'variant', variant_name: variant, suggestion: null, reason: 'Synthetic exact identity and printed fixture mark.', reference_ids: [reference.id],
      photo_features: [{ side: 'back', photo_sha256: replayHash(photos[1]), reference_id: reference.id, evidence_type: 'catalog_feature', reference_feature: reference.distinguishing_features[0], observation: 'Back: printed circular fixture mark.' }] },
      target_condition: { status: example.grade === null ? 'raw' : 'graded', grader: example.grade === null ? null : 'PSA', numeric_grade: example.grade, photo_evidence: example.grade === null ? 'Both fixture photos show a raw card.' : `Front: PSA ${example.grade}.` }, refinement: null,
      comparisons: source.items.map(item => ({ candidate_id: `ebay:${item.itemId}`, classification: 'matched', identity_match: true, variant_match: true, visual_match: true, condition_match: true, reason: 'The synthetic model tape proposes a complete match.' })) };
    const row: any = { id: example.id, evidence_kind: 'synthetic_frozen_provider_and_model_tape', input_sha256: replayHash(JSON.stringify(input)), source_sha256: replayHash(JSON.stringify(source)), image_sha256: photos.map(replayHash),
      expected: { match: example.expectedMatch, estimate: example.expectedEstimate }, baseline: {}, candidate: {} };
    for (const selection of ['decisions', 'estimate'] as const) {
      const model = { ...analysis, selected_candidate_ids: selection === 'estimate' ? source.items.map(item => `ebay:${item.itemId}`) : [] };
      row[`${selection}_model_sha256`] = replayHash(JSON.stringify(model));
      for (const version of ['baseline', 'candidate'] as const) {
        let providerCalls = 0, modelCalls = 0;
        try {
          const result = await versions[version].researchStaffInventoryCard(structuredClone(input), {
            env: { OPENAI_API_KEY: 'fixture-model-credential', SOLDCOMPS_API_KEY: 'fixture-provider-credential', STAFF_INVENTORY_RESEARCH_FULL_RES_IMAGES: 'false' }, now: () => new Date(now),
            loadPhoto: async (photoKey: string) => { const bytes = photoKey === input.front_photo_key ? photos[0] : photos[1]; return { key: photoKey, sha256: replayHash(bytes), bytes }; },
            loadReferences: async () => [JSON.parse(JSON.stringify(reference))],
            fetchImpl: async (url: string, init: RequestInit) => {
              if (String(url).startsWith('https://api.sold-comps.com/v1/scrape?')) { providerCalls++; if (providerCalls !== 1) throw Error('Unexpected replay source request'); return Response.json(source); }
              if (url === 'https://api.openai.com/v1/responses') { modelCalls++; if (modelCalls !== 1) throw Error('Unexpected replay model request'); return Response.json({ model: 'gpt-6-astra', status: 'completed', error: null, incomplete_details: null,
                output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(model) }] }] }); }
              const index = source.items.findIndex(item => item.thumbnailUrl === url);
              if (index < 0 || (init.headers as Record<string, string>).Authorization) throw Error('Unplanned replay transport');
              return new Response(new Uint8Array(photos[2 + index]), { headers: { 'content-type': 'image/jpeg' } });
            },
          });
          row[version][selection] = { status: 'returned', engine_version: result.engine_version, classifications: result.comparison_assessments.map((value: any) => value.classification),
            source_eligible: result.candidates.map((value: any) => value.source_eligible), source_reasons: result.candidates.map((value: any) => value.exclusion_reason), selected_count: result.selected_candidate_ids.length, estimate_status: result.estimate.status, value_cents: result.estimate.value_cents, provider_calls: providerCalls, model_calls: modelCalls };
        } catch (error) { row[version][selection] = { status: 'rejected', error_code: error && typeof error === 'object' && 'code' in error ? String(error.code) : 'replay_failed', provider_calls: providerCalls, model_calls: modelCalls }; }
      }
    }
    row.passed = (row.candidate.decisions.status === 'returned' && row.candidate.decisions.classifications.every((value: string) => (value === 'matched') === example.expectedMatch))
      && (row.candidate.estimate.status === 'returned' && row.candidate.estimate.estimate_status === 'estimated') === example.expectedEstimate;
    rows.push(row);
  }
  return { evidence_kind: 'synthetic_mechanism_qualification', cases: rows, passed: rows.every(row => row.passed), accuracy_claim: false };
  } finally { globalThis.fetch = originalFetch; }
}

/** Existing snapshots retain post-filter decisions, not the original model
 * proposal or raw provider payload. Recheck exact stored evidence without
 * manufacturing those missing facts or declaring new verified estimates. */
export function replayHistoricalResearch(snapshot: any, versions: Awaited<ReturnType<typeof loadResearchReplayVersions>>) {
  if (!Array.isArray(snapshot.jobs) || snapshot.jobs.length > 10000) throw Error('Invalid bounded research snapshot');
  const rows: any[] = [];
  const canonical = (value: any): string => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
    : value && typeof value === 'object' ? '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}' : JSON.stringify(value);
  for (const job of snapshot.jobs) {
    if (!job.result) continue;
    const input = typeof job.input === 'string' ? JSON.parse(job.input) : job.input;
    const result = typeof job.result === 'string' ? JSON.parse(job.result) : job.result;
    if (replayHash(canonical(input)) !== job.inputHash || replayHash(canonical(result)) !== job.resultHash) throw Error('Snapshot evidence hash mismatch');
    for (const candidate of result.candidates) {
      const stored = result.comparison_assessments?.find((value: any) => value.candidate_id === candidate.id);
      const row: any = { input_hash: job.inputHash, result_hash: job.resultHash, candidate_hash: replayHash(canonical(candidate)), missing_original_model_proposal: true, missing_raw_source_payload: true, baseline: {}, candidate: {} };
      for (const version of ['baseline', 'candidate'] as const) {
        const decision = versions[version].replayComparison(structuredClone(candidate), input.description, result.target_condition, stored ? structuredClone(stored) : undefined);
        row[version] = { classification: decision.classification, title_eligible_without_catalog: versions[version].replayTitle(input.description, candidate), condition_matched: versions[version].replayCondition(result.target_condition, candidate) };
      }
      rows.push(row);
    }
  }
  return { evidence_kind: 'stored_terminal_evidence_recheck', candidates: rows, candidate_count: rows.length,
    title_gate_changes: rows.filter(row => row.baseline.title_eligible_without_catalog !== row.candidate.title_eligible_without_catalog).length,
    condition_gate_changes: rows.filter(row => row.baseline.condition_matched !== row.candidate.condition_matched).length,
    classification_changes: rows.filter(row => row.baseline.classification !== row.candidate.classification).length,
    classification_transitions: rows.reduce((counts: Record<string, number>, row) => { const key = `${row.baseline.classification}->${row.candidate.classification}`; counts[key] = (counts[key] ?? 0) + 1; return counts; }, {}),
    accuracy_claim: false, final_estimate_replay: 'unavailable_without_original_source_and_model_evidence' };
}
