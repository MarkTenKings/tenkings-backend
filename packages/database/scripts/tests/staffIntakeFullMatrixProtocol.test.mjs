import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { BASELINE_COMMIT, FROZEN_SUBSET_PROTOCOL_SHA256, DISK_FLOOR_BYTES, LAUNCH_DISK_BYTES, METRICS, parseFullMatrixConfig, assertSourceBinding, assertDiskAvailable, requireSourceArtifacts, assertMigrationCompatibility, fullMatrixProtocol, fullMatrixBlocks, verifyBlockSamples, verifyBlockEvidence, analyzeFullMatrix } from '../lib/staffIntakeFullMatrixProtocol.mjs';

const priorBytes = await readFile(new URL('../../../../docs/plans/2026-09-16-intake-pagination-comparison-protocol.json', import.meta.url));
const prior = JSON.parse(priorBytes);
// Synthetic non-runnable protocol input for pure checks; final reviewed candidate remains unset in the template.
const config = { schema_version: 1, refs: { A: BASELINE_COMMIT, B: 'b'.repeat(40) }, frozen_client_ledger_sha256: prior.frozen_client_ledger_sha256 };
const matrix = () => fullMatrixBlocks().map(block => ({ ...block, hard_gates_pass: true, samples: Array.from({ length: block.sessions }, (_, session) => [true, false].flatMap(warmup => Array.from({ length: warmup ? 5 : 50 }, (_, index) => ({ session, warmup, index, unit_id: `${session}:${warmup}:${index}`, ...Object.fromEntries(METRICS.map(metric => [metric, 100])) })))).flat() }));
function evidence(block) {
  const claims = { accepted: 2, max_running: 2, completed: 1, failed: 1 };
  const provider_counts = { unexpected: 0 };
  return { ...block, before: { jobs: 272 }, after: { jobs: 273 + block.samples.length },
    process_identities: ['intake', 'worker', 'observer'].map((role, index) => ({ role, pid: 102 + index, pool: [4, 3, 1][index], source_ref: config.refs.B })),
    driver: { process_pid: 101 },
    roles: ['intake', 'worker', 'observer'].map((role, index) => ({ role, process_pid: 102 + index, operations: [{ kind: 'controlled_save_terminal_overlap', observed: true }], claims, provider_counts, barrier_observed: true })),
    claims, provider_counts,
    clock_probes: ['intake', 'worker', 'observer'].flatMap(role => Array.from({ length: 6 }, () => ({ role, sent_ns: '100', at_ns: '101', received_ns: '102' }))),
    source_invariants: Object.fromEntries(['one_job_per_accepted_save', 'failed_save_no_job_or_event', 'concurrent_retry_one_job', 'history_preserved', 'original_fixture_hashes_preserved'].map(key => [key, true])),
    admission_preflight: { denied_at_three_leases_with_one_running_worker: true, terminal_write_during_pause: true, admitted_after_one_lease_released: true } };
}
const setMetric = (blocks, predicate, metric, value) => { for (const block of blocks.filter(predicate)) for (const sample of block.samples) sample[metric] = value; };

test('fixed 32-block two-repetition matrix has exactly 3200 measured and 320 warmups, never a release pass', () => {
  const blocks = matrix(), result = analyzeFullMatrix(blocks);
  assert.equal(blocks.length, 32);
  for (const sessions of [1, 3]) for (const scenario of ['idle', 'thumbnail', 'timeout', 'rate-limit']) assert.deepEqual(blocks.filter(row => row.sessions === sessions && row.scenario === scenario).map(row => row.arm), ['A', 'B', 'B', 'A']);
  assert.equal(result.measured_saves, 3200); assert.equal(result.warmup_saves, 320);
  assert.equal(result.comparisons.length, 48); assert.equal(result.headroom.length, 36);
  assert.equal(result.comparisons.flatMap(row => row.repetitions).length, 96);
  assert.equal(result.controlled_timing_pass, true); assert.equal(result.pass, false); assert.equal(result.full_release_pass, false); assert.equal(result.functional_integration_pass, false);
});
test('missing final cell, reordered scope and failed hard gate cannot complete', () => {
  const blocks = matrix(); assert.throws(() => analyzeFullMatrix(blocks.slice(0, -1)), /32-block/);
  [blocks[0], blocks[1]] = [blocks[1], blocks[0]]; assert.throws(() => analyzeFullMatrix(blocks), /Wrong block/);
  const failed = matrix(); failed[31].hard_gates_pass = false; assert.throws(() => analyzeFullMatrix(failed), /hard gates/);
});
test('raw sample loss, duplicates, scope drift and nonfinite metrics fail closed', () => {
  const block = matrix()[0], expected = fullMatrixBlocks()[0];
  assert.throws(() => verifyBlockSamples(block, expected, block.samples.slice(1)), /Raw NDJSON/);
  const lost = structuredClone(block); lost.samples.pop(); assert.throws(() => verifyBlockSamples(lost, expected, lost.samples), /Missing/);
  const duplicate = structuredClone(block); duplicate.samples[1] = duplicate.samples[0]; assert.throws(() => verifyBlockSamples(duplicate, expected, duplicate.samples), /Duplicate/);
  const bad = structuredClone(block); bad.samples[0].lease_ms = NaN; assert.throws(() => verifyBlockSamples(bad, expected, bad.samples), /lease_ms/);
});
test('absolute margin remains inclusive 50ms; a greater candidate tail fails', () => {
  const blocks = matrix(); setMetric(blocks, row => row.arm === 'B', 'lease_ms', 150);
  assert.equal(analyzeFullMatrix(blocks).controlled_timing_pass, true);
  setMetric(blocks, row => row.arm === 'B', 'lease_ms', 150.001);
  assert.equal(analyzeFullMatrix(blocks).controlled_timing_pass, false);
});
test('relative margin remains 10 percent for a slower baseline', () => {
  const blocks = matrix(); setMetric(blocks, () => true, 'save_ack_ms', 1000); setMetric(blocks, row => row.arm === 'B', 'save_ack_ms', 1100);
  assert.equal(analyzeFullMatrix(blocks).controlled_timing_pass, true);
  setMetric(blocks, row => row.arm === 'B', 'save_ack_ms', 1100.001); assert.equal(analyzeFullMatrix(blocks).controlled_timing_pass, false);
});
test('pooled success cannot conceal a failed second repetition', () => {
  const blocks = matrix(); setMetric(blocks, row => row.arm === 'A' && row.index === 0, 'lease_ms', 1000);
  setMetric(blocks, row => row.arm === 'B' && row.index === 2, 'lease_ms', 151);
  const result = analyzeFullMatrix(blocks), row = result.comparisons[0];
  assert.ok(row.B.p95 - row.A.p95 <= row.margin_ms); assert.equal(row.repetitions[1].pass, false); assert.equal(result.controlled_timing_pass, false);
});
test('candidate loaded headroom may fail while every A/B comparison passes', () => {
  const blocks = matrix(); setMetric(blocks, row => row.scenario !== 'idle', 'lease_ms', 151);
  const result = analyzeFullMatrix(blocks); assert.ok(result.comparisons.every(row => row.pass)); assert.equal(result.headroom[0].pass, false); assert.equal(result.controlled_timing_pass, false);
});
test('direct photo wall remains an additional gate alongside the unchanged summed metric', () => {
  const blocks = matrix(); setMetric(blocks, row => row.arm === 'B', 'photo_wall_ms', 151);
  const result = analyzeFullMatrix(blocks); assert.equal(result.legacy_timing_pass, true); assert.equal(result.photo_wall_pass, false); assert.equal(result.controlled_timing_pass, false);
});
test('four roles, pools, bracketed clocks, exact jobs, terminal outcomes and loaded overlap are mandatory', () => {
  const good = evidence(matrix()[5]); verifyBlockEvidence(good, config.refs.B);
  const mutations = [row => { row.process_identities[0].pid = 101; }, row => { row.process_identities[0].pool = 5; }, row => { row.process_identities[0].source_ref = BASELINE_COMMIT; }, row => { row.clock_probes.pop(); }, row => { row.clock_probes[0].at_ns = '999'; }, row => { row.source_invariants.history_preserved = false; }, row => { row.admission_preflight.terminal_write_during_pause = false; }, row => { row.after.jobs++; }, row => { row.claims.failed = 0; }, row => { row.roles[1].barrier_observed = false; }, row => { row.roles[1].provider_counts.unexpected = 1; }];
  for (const mutate of mutations) { const bad = structuredClone(good); mutate(bad); assert.throws(() => verifyBlockEvidence(bad, config.refs.B)); }
});
test('source refs require explicit final SHA and exact resolution; arbitrary config overrides are refused', () => {
  assert.deepEqual(parseFullMatrixConfig(config), config);
  for (const B of [null, 'HEAD', 'main', '12e13992', BASELINE_COMMIT]) assert.throws(() => parseFullMatrixConfig({ ...config, refs: { ...config.refs, B } }));
  assert.throws(() => parseFullMatrixConfig({ ...config, measured: 2 }));
  assert.throws(() => parseFullMatrixConfig({ ...config, frozen_client_ledger_sha256: '' }));
  assertSourceBinding(BASELINE_COMMIT, BASELINE_COMMIT); assert.throws(() => assertSourceBinding(BASELINE_COMMIT, config.refs.B));
});
test('missing source artifacts and rewritten/missing migration prefix are refused', () => {
  assert.throws(() => requireSourceArtifacts([]), /Missing pinned source/);
  const required = ['packages/database/prisma/schema.prisma', 'packages/database/src/cardPlatformV2.ts', 'packages/database/src/inventoryWorkflowV2Read.ts', 'packages/database/src/staffInventoryResearchV2.ts', 'packages/database/src/index.ts', 'packages/shared/src/index.ts', 'frontend/nextjs-app/lib/server/staffInventoryResearch.ts', 'frontend/nextjs-app/lib/server/staffInventoryResearchWorker.ts', 'frontend/nextjs-app/pages/api/v2/admin/inventory/workspace.ts', 'frontend/nextjs-app/tsconfig.json'];
  assert.throws(() => requireSourceArtifacts(required), /Missing migration/);
  requireSourceArtifacts([...required, 'packages/database/prisma/migrations/1/migration.sql']);
  const baseline = [{ path: '1/migration.sql', sha256: 'first' }];
  assertMigrationCompatibility(baseline, [...baseline, { path: '2/migration.sql', sha256: 'second' }]);
  assert.throws(() => assertMigrationCompatibility(baseline, []));
  assert.throws(() => assertMigrationCompatibility(baseline, [{ ...baseline[0], sha256: 'changed' }]));
  assert.throws(() => assertMigrationCompatibility(baseline, [...baseline, ...baseline]));
});
test('launch reserve and operational disk floor cannot be relaxed or omitted', () => {
  assertDiskAvailable(DISK_FLOOR_BYTES); assertDiskAvailable(LAUNCH_DISK_BYTES, true);
  for (const bytes of [undefined, NaN, -1, DISK_FLOOR_BYTES - 1]) assert.throws(() => assertDiskAvailable(bytes));
  assert.throws(() => assertDiskAvailable(LAUNCH_DISK_BYTES - 1, true)); assert.throws(() => assertDiskAvailable(DISK_FLOOR_BYTES, true));
});
test('preregistered photos, tapes, pools, thresholds and untouched driver/role/IPC remain frozen', async () => {
  assert.equal(createHash('sha256').update(priorBytes).digest('hex'), FROZEN_SUBSET_PROTOCOL_SHA256);
  const protocol = fullMatrixProtocol(config, prior);
  for (const key of ['legacy_gate_metrics', 'additional_gate_metrics', 'p95_margin', 'pool_connections', 'provider_delay_ms', 'intake_photo_pixels', 'listing_photo_pixels', 'listing_photo_count', 'seed_units', 'seed_pending', 'seed_completed', 'ipc_deadlines_ms', 'frozen_script_sha256']) assert.deepEqual(protocol[key], prior[key]);
  for (const [name, hash] of Object.entries(prior.frozen_script_sha256)) assert.equal(createHash('sha256').update(await readFile(new URL(`../../../../frontend/nextjs-app/scripts/${name}`, import.meta.url))).digest('hex'), hash);
  assert.equal(protocol.cap_ms, 90 * 60 * 1000); assert.equal(protocol.work_cap_ms, protocol.cap_ms - 30000);
  assert.equal(protocol.launch_free_disk_bytes, LAUNCH_DISK_BYTES); assert.equal(protocol.functional_integration_gate.passed, false); assert.equal(protocol.release_pass_always_false, true);
  assert.ok(protocol.new_features_off.includes('STAFF_INVENTORY_RESEARCH_SALE_DETAILS'));
  const altered = structuredClone(prior); altered.p95_margin.absolute_ms = 51; assert.throws(() => fullMatrixProtocol(config, altered));
});
