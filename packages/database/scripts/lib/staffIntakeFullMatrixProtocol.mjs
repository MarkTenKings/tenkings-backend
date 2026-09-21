import assert from 'node:assert/strict';

export const BASELINE_COMMIT = '60572cec895ad63d4ab826cd366f6475b04e725a';
export const FROZEN_SUBSET_PROTOCOL_SHA256 = '15bc558dfde9aeb5cc94eceb3fa5c102371aa105e9b9cdb4e8a181a8d832884c';
export const DISK_FLOOR_BYTES = 2 * 1024 ** 3;
export const LAUNCH_DISK_BYTES = DISK_FLOOR_BYTES + 300 * 1024 ** 2;
export const METRICS = ['lease_ms', 'photo_verify_ms', 'save_ack_ms', 'save_tx_ms', 'queue_lock_ms', 'photo_wall_ms'];
const fullSha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const keys = (object, expected) => {
  assert.ok(object && typeof object === 'object' && !Array.isArray(object), 'Object required');
  assert.deepEqual(Object.keys(object).sort(), [...expected].sort(), 'Unsupported or missing configuration fields');
};

export function parseFullMatrixConfig(value) {
  keys(value, ['schema_version', 'refs', 'frozen_client_ledger_sha256']);
  assert.equal(value.schema_version, 1);
  keys(value.refs, ['A', 'B']);
  assert.equal(value.refs.A, BASELINE_COMMIT, 'Use the exact serving-application-equivalent baseline');
  assert.ok(fullSha(value.refs.B) && value.refs.B !== value.refs.A, 'An explicit final reviewed candidate commit is required; HEAD/branches/placeholders are forbidden');
  assert.ok(hash(value.frozen_client_ledger_sha256), 'Frozen client ledger hash required');
  return structuredClone(value);
}

export function assertSourceBinding(ref, resolvedCommit) {
  assert.ok(fullSha(ref), 'Exact commit required');
  assert.equal(resolvedCommit, ref, 'Resolved source does not match approved pin');
}

export function assertDiskAvailable(freeBytes, launch = false) {
  assert.ok(Number.isSafeInteger(freeBytes) && freeBytes >= (launch ? LAUNCH_DISK_BYTES : DISK_FLOOR_BYTES),
    launch ? 'At least 2 GiB + 300 MiB free required for launch' : 'At least 2 GiB free required before each owned setup/block');
}

export function requireSourceArtifacts(files) {
  const present = new Set(files);
  for (const name of [
    'packages/database/prisma/schema.prisma', 'packages/database/src/cardPlatformV2.ts',
    'packages/database/src/inventoryWorkflowV2Read.ts', 'packages/database/src/staffInventoryResearchV2.ts',
    'packages/database/src/index.ts', 'packages/shared/src/index.ts',
    'frontend/nextjs-app/lib/server/staffInventoryResearch.ts', 'frontend/nextjs-app/lib/server/staffInventoryResearchWorker.ts',
    'frontend/nextjs-app/pages/api/v2/admin/inventory/workspace.ts', 'frontend/nextjs-app/tsconfig.json',
  ]) assert.ok(present.has(name), `Missing pinned source artifact: ${name}`);
  assert.ok([...present].some(name => name.startsWith('packages/database/prisma/migrations/') && name.endsWith('/migration.sql')), 'Missing migration artifacts');
}

export function assertMigrationCompatibility(baseline, candidate) {
  assert.ok(baseline.length > 0 && candidate.length >= baseline.length, 'Missing migration ledger');
  assert.equal(new Set(candidate.map(row => row.path)).size, candidate.length, 'Duplicate migration artifact');
  assert.deepEqual(candidate.slice(0, baseline.length), baseline, 'Baseline migration chain must be an unchanged prefix of candidate');
}

export function fullMatrixProtocol(configuration, prior) {
  const config = parseFullMatrixConfig(configuration);
  // Preserve all prior metrics, photos, tapes, process/DB budgets and source
  // paths. Remove only assertions specific to the old reader-only comparison.
  const { reader_sha256, writer_sha256, runtime_changed_paths, schema_sha256, migration_count,
    preflight_override, preparation_adjustments, ...base } = prior;
  assert.deepEqual(base.legacy_gate_metrics, METRICS.slice(0, 5));
  assert.deepEqual(base.additional_gate_metrics, METRICS.slice(5));
  assert.deepEqual(base.p95_margin, { absolute_ms: 50, fraction: 0.1 });
  assert.equal(base.pool_connections, 8);
  return {
    ...base, refs: config.refs, frozen_client_ledger_sha256: config.frozen_client_ledger_sha256,
    status: 'Preparation only until coordinating-agent source, hash, disk and quiet-window review',
    purpose: 'Complete controlled source/DB intake matrix, optional stages off; separate wired-worker and device/provider gates remain',
    scenarios: ['idle', 'thumbnail', 'timeout', 'rate-limit'], sessions: [1, 3], order: ['A', 'B', 'B', 'A'],
    process_roles: { ...base.process_roles, driver: '1 or 3 independent sequential synthetic sessions; no DB or application imports' },
    warmups: 5, measured: 50, required_measured_saves: 3200, required_warmups: 320, required_blocks: 32,
    cap_ms: 90 * 60 * 1000, work_cap_ms: 90 * 60 * 1000 - 30000, cleanup_reserve_ms: 30000,
    minimum_free_disk_bytes: DISK_FLOOR_BYTES, launch_free_disk_bytes: LAUNCH_DISK_BYTES,
    release_pass_always_false: true, smoke: false,
    new_features_off: [...new Set([...base.new_features_off, 'STAFF_INVENTORY_RESEARCH_SALE_DETAILS'])],
    worker_wiring: 'Actual runStaffInventoryResearchWorker loop with injected dependencies, real source engine and durable claim/complete/fail writers; NOT default dependency or authenticated cron integration',
    functional_integration_gate: {
      passed: false,
      required_fixture: 'On owned PostgreSQL, invoke authenticated cron handler -> default worker dependencies -> actual research engine with ONLY external provider/photo/reference/archive transports substituted. Verify off flags dispatch no catalog/contribution/detail work, one saved input claims/completes one durable result, failure/cancellation respects lease/deadline bounds, and stored result/hash replay is exact. Existing injected-worker and pure database tests do not establish this complete wiring.',
    },
    missing_proof: ['default durable-worker/cron wiring fixture', 'real browser/camera/upload/recognition and representative simultaneous staff iPhone acceptance',
      'actual hosted request/instance/cold-start behavior', 'real-provider variance', 'larger images/catalog/sale-detail activation', 'independent all-card accuracy'],
    launch_review: 'Review final candidate and generated launch seal under existing authorization. Require new output, unchanged seal, disk reserve and coordinated quiet window. No automatic retry or threshold changes.',
    gate_rule: 'Every pooled metric/cell AND each ABBA repetition B-A <= max(50ms,10% A p95); each B loaded-idle uses the same margin. All original metrics plus direct photo wall must pass; no cross-study pooling.',
    stop_conditions: ['Any hard invariant, source/clock/raw-sample mismatch or owned child failure',
      '90-minute overall cap, with final30s reserved for owned cleanup; ordinary RPC60s and seed180s unchanged',
      'Disk floor failure or SIGINT/SIGTERM; abort owned work and retain partial evidence'],
    fixture_schema: 'Candidate full migration chain for both arms; exact unchanged baseline migration prefix and exercised-model compatibility required',
    supervision: 'Qualified owned process-group supervision retained. Shared signal/deadline abort; work ends at 89m30s, final30s reserved for bounded owned cleanup. Remove owned data only after command groups and PostgreSQL are confirmed stopped. SIGKILL/OS failure cannot be trapped.',
    setup_deadline_reason: 'Untimed seed180s; all other RPC60s. Complete matrix has its original90-minute total cap including final30s cleanup reserve.',
    feature_off_evidence: 'Clean runner and driver allowlists omit catalog, contribution and sale-detail flags; engine receives full-resolution=false. Frozen injected dependencies bypass default catalog/archive dispatch; the separate wiring fixture must prove production-default dispatch. No provider credentials forwarded.',
  };
}

export function fullMatrixBlocks() {
  const blocks = [];
  for (const sessions of [1, 3]) for (const scenario of ['idle', 'thumbnail', 'timeout', 'rate-limit']) {
    for (const [index, arm] of ['A', 'B', 'B', 'A'].entries()) blocks.push({ ordinal: blocks.length, sessions, scenario, index, arm });
  }
  return blocks;
}

export function verifyBlockSamples(block, expected, rawSamples) {
  for (const key of ['sessions', 'scenario', 'index', 'arm']) assert.equal(block[key], expected[key], `Wrong block ${key}`);
  assert.equal(block.hard_gates_pass, true, 'Block hard gates failed');
  assert.deepEqual(block.samples, rawSamples, 'Raw NDJSON differs from report');
  assert.equal(block.samples.length, expected.sessions * 55, 'Missing/extra warmup or measured samples');
  const seen = new Set();
  for (const sample of block.samples) {
    assert.ok(Number.isInteger(sample.session) && sample.session >= 0 && sample.session < expected.sessions);
    assert.equal(typeof sample.warmup, 'boolean');
    assert.ok(Number.isInteger(sample.index) && sample.index >= 0 && sample.index < (sample.warmup ? 5 : 50));
    const key = `${sample.session}:${sample.warmup}:${sample.index}`;
    assert.ok(!seen.has(key), 'Duplicate sample'); seen.add(key);
    for (const metric of METRICS) assert.ok(Number.isFinite(sample[metric]) && sample[metric] >= 0, `Missing/invalid ${metric}`);
  }
}

export function verifyBlockEvidence(block, ref) {
  assert.ok(fullSha(ref), 'Pinned source required for evidence');
  assert.equal(block.process_identities?.length, 3, 'Three child roles required');
  const identities = new Map(block.process_identities.map(row => [row.role, row]));
  assert.equal(identities.size, 3);
  const pids = [block.driver?.process_pid];
  for (const [role, pool] of [['intake', 4], ['worker', 3], ['observer', 1]]) {
    const identity = identities.get(role);
    assert.equal(identity?.source_ref, ref, 'Role source pin differs'); assert.equal(identity?.pool, pool, 'Pool budget differs');
    pids.push(identity.pid);
    const spans = block.roles?.filter(row => row.role === role);
    assert.equal(spans?.length, 1); assert.equal(spans[0].process_pid, identity.pid);
    assert.ok(Array.isArray(spans[0].operations) && spans[0].operations.length > 0, 'Missing role trace');
    const clocks = block.clock_probes?.filter(row => row.role === role);
    assert.equal(clocks?.length, 6, 'Five initial and one final clock probe required per role');
    for (const clock of clocks) assert.ok(BigInt(clock.sent_ns) <= BigInt(clock.at_ns) && BigInt(clock.at_ns) <= BigInt(clock.received_ns), 'Unbracketed clock');
  }
  assert.equal(block.clock_probes.length, 18);
  assert.ok(pids.every(pid => Number.isInteger(pid) && pid > 0)); assert.equal(new Set(pids).size, 4, 'Four distinct process IDs required');
  for (const invariant of ['one_job_per_accepted_save', 'failed_save_no_job_or_event', 'concurrent_retry_one_job', 'history_preserved', 'original_fixture_hashes_preserved']) assert.equal(block.source_invariants?.[invariant], true, `Missing source invariant ${invariant}`);
  for (const admission of ['denied_at_three_leases_with_one_running_worker', 'terminal_write_during_pause', 'admitted_after_one_lease_released']) assert.equal(block.admission_preflight?.[admission], true, `Missing admission evidence ${admission}`);
  assert.equal(block.after?.jobs, block.before?.jobs + 1 + block.samples.length, 'Durable job cardinality differs');
  assert.equal(new Set(block.samples.map(row => row.unit_id)).size, block.samples.length, 'Duplicate accepted save identity');
  const worker = block.roles.find(row => row.role === 'worker');
  assert.deepEqual(block.claims, worker.claims); assert.deepEqual(block.provider_counts, worker.provider_counts);
  assert.equal(worker.provider_counts?.unexpected, 0);
  for (const key of ['accepted', 'completed', 'failed', 'max_running']) assert.ok(Number.isInteger(worker.claims?.[key]) && worker.claims[key] >= 0);
  assert.ok(worker.claims.max_running <= 2);
  assert.equal(worker.claims.accepted, worker.claims.completed + worker.claims.failed, 'A claimed job has no terminal outcome after teardown');
  if (block.scenario !== 'idle') {
    assert.ok(worker.claims.accepted >= 2); assert.equal(worker.claims.max_running, 2);
    assert.equal(worker.barrier_observed, true, 'Loaded block lacks worker/save overlap');
    assert.ok(worker.operations.some(row => row.kind === 'controlled_save_terminal_overlap' && row.observed === true));
  }
}

const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(p * values.length) - 1];
export function analyzeFullMatrix(blocks) {
  const expected = fullMatrixBlocks();
  assert.equal(blocks.length, expected.length, 'Complete 32-block matrix required');
  for (const [i, block] of blocks.entries()) verifyBlockSamples(block, expected[i], block.samples);
  const comparisons = [];
  for (const sessions of [1, 3]) for (const scenario of ['idle', 'thumbnail', 'timeout', 'rate-limit']) for (const metric of METRICS) {
    const selected = blocks.filter(block => block.sessions === sessions && block.scenario === scenario);
    const values = block => block.samples.filter(sample => !sample.warmup).map(sample => sample[metric]);
    const stats = arm => { const all = selected.filter(block => block.arm === arm).flatMap(values); return { n: all.length, p50: percentile(all, .5), p95: percentile(all, .95), max: Math.max(...all) }; };
    const A = stats('A'), B = stats('B'), margin = Math.max(50, .1 * A.p95);
    const repetitions = [[0, 1], [3, 2]].map(([a, b]) => {
      const baseline = percentile(values(selected.find(block => block.index === a)), .95), candidate = percentile(values(selected.find(block => block.index === b)), .95);
      return { baseline_p95: baseline, candidate_p95: candidate, pass: candidate - baseline <= Math.max(50, .1 * baseline) };
    });
    comparisons.push({ sessions, scenario, metric, A, B, margin_ms: margin, pass: B.p95 - A.p95 <= margin && repetitions.every(row => row.pass), repetitions });
  }
  const headroom = comparisons.filter(row => row.scenario !== 'idle').map(row => {
    const idle = comparisons.find(other => other.sessions === row.sessions && other.scenario === 'idle' && other.metric === row.metric);
    return { sessions: row.sessions, scenario: row.scenario, metric: row.metric,
      idle_p95: idle.B.p95, loaded_p95: row.B.p95, pass: row.B.p95 - idle.B.p95 <= Math.max(50, .1 * idle.B.p95) };
  });
  const measured_saves = blocks.reduce((n, block) => n + block.samples.filter(sample => !sample.warmup).length, 0);
  const warmup_saves = blocks.reduce((n, block) => n + block.samples.filter(sample => sample.warmup).length, 0);
  assert.equal(measured_saves, 3200); assert.equal(warmup_saves, 320);
  const passes = predicate => comparisons.filter(predicate).every(row => row.pass) && headroom.filter(predicate).every(row => row.pass);
  return { complete: true, complete_matrix: true, pass: false, full_release_pass: false, functional_integration_pass: false,
    controlled_timing_pass: passes(() => true), legacy_timing_pass: passes(row => row.metric !== 'photo_wall_ms'),
    photo_wall_pass: passes(row => row.metric === 'photo_wall_ms'), measured_saves, warmup_saves, comparisons, headroom };
}
