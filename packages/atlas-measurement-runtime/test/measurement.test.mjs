import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { measureDefectWorkspaceEdit } from '../src/index.mjs';
import { runMeasurementWorker } from '../src/process.mjs';
import { applyDefectMeasurement, defectBase, discardPendingDefectEdit, replaceDefectFrame,
  markDefectSideInspected, confirmDefectFindings } from '../../atlas-manual-workspace/src/defect-actions.mjs';
import { workspace, edit, measurements, traceAction, clone } from '../../atlas-manual-workspace/test/defect-fixtures.mjs';

const python = process.env.ATLAS_MEASUREMENT_PYTHON;
if (!python?.startsWith('/')) throw new Error('Set ATLAS_MEASUREMENT_PYTHON to the absolute pinned CPU Python environment');
const limits = { maxInputBytes: 8_000_000, maxOutputBytes: 8_000_000, maxFindings: 128, timeoutMs: 15000 };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const run = (state, overrides = {}) => measureDefectWorkspaceEdit({ workspace: state, side: 'FRONT', limits, pythonExecutable: python, ...overrides });
const settle = async state => applyDefectMeasurement(state, await run(state)).state;
const pixels = finding => finding.measurementRegions ? finding.measurementRegions.reduce((sum, region) => sum + region.measurement.pixelCount, 0) : finding.measurement.pixelCount;

test('actual checked CPU binds source hashes and remeasures a type correction, preserving exact holes and Back', async () => {
  const initial = workspace(), before = clone(initial);
  const pending = edit(initial, { type: 'CHANGE_TYPE', defectId: measurements.FRONT.id, defectType: 'FRAYING' });
  const result = await run(pending), next = applyDefectMeasurement(pending, result).state;
  assert.deepEqual(initial, before);
  assert.deepEqual(next.sides.BACK, initial.sides.BACK);
  assert.equal(next.sides.FRONT.findings[0].defectType, 'FRAYING');
  assert.equal(next.sides.FRONT.findings[0].origin, 'DETECTOR');
  assert.equal(next.sides.FRONT.findings[0].reviewResult, 'TYPE_CORRECTED');
  assert.equal(pixels(next.sides.FRONT.findings[0]), 340);
  assert.deepEqual(next.sides.FRONT.findings[0].detectorMask, initial.sides.FRONT.findings[0].detectorMask);
  assert.equal(result.receipt.version, 'atlas-manual-cpu-measurement-v1');
  const sources = JSON.parse(await readFile(new URL('../engine-source.json', import.meta.url))).sources;
  assert.deepEqual(result.receipt.identity.sources, sources);
  for (const [name, expected] of Object.entries(sources)) assert.equal(hash(await readFile(new URL(`../../../backend/ai-grader-speedster-service/${name}`, import.meta.url))), expected);
  assert.equal(result.receipt.identity.opencv, '4.10.0');
  assert.equal(result.receipt.identity.numpy, '1.26.4');
  assert.ok(!JSON.stringify(result.receipt).includes('runs'));
  assert.ok(!JSON.stringify(result.receipt).includes('/Users/'));
});

test('actual CPU add/reshape/type/remove/undo changes pixel ownership for the whole active side', async () => {
  let state = await settle(edit(workspace(false), traceAction('FRONT', null, [600, 600, 20, 20], 'FRONT:first')));
  assert.equal(pixels(state.sides.FRONT.findings[0]), 400);
  state = await settle(edit(state, traceAction('FRONT', null, [610, 600, 20, 20], 'FRONT:second')));
  const total = () => state.sides.FRONT.findings.filter(f => f.reviewResult !== 'REMOVED').reduce((sum, f) => sum + pixels(f), 0);
  assert.equal(total(), 600);
  assert.equal(state.sides.FRONT.findings.find(f => f.id === 'FRONT:first').origin, 'SMART_MARK');
  state = await settle(edit(state, { type: 'REMOVE', defectIds: ['FRONT:first'] }));
  assert.equal(total(), 400);
  state = await settle(edit(state, { type: 'UNDO', defectIds: ['FRONT:first'] }));
  assert.equal(total(), 600);
  state = await settle(edit(state, { type: 'CHANGE_TYPE', defectId: 'FRONT:first', defectType: 'PEELING_HEAVY_DAMAGE' }));
  assert.equal(total(), 600);
  state = await settle(edit(state, traceAction('FRONT', 'FRONT:first', [100, 100, 5, 5])));
  assert.equal(total(), 425);
  assert.equal(state.sides.FRONT.findings.find(f => f.id === 'FRONT:first').defectType, 'PEELING_HEAVY_DAMAGE');
  assert.equal(state.sides.FRONT.findings.find(f => f.id === 'FRONT:first').reviewResult, 'TYPE_CORRECTED');
});

test('actual detector-to-trace reshape retains detector provenance and invalidates stale fingerprints', async () => {
  const initial = clone(workspace());
  initial.sides.FRONT.findings[0].featureFingerprint = [1, 2, 3];
  initial.sides.FRONT.findings[0].featureFingerprintTraceSha256 = 'a'.repeat(64);
  const next = await settle(edit(initial, traceAction('FRONT', measurements.FRONT.id, [100, 100, 10, 10])));
  const finding = next.sides.FRONT.findings[0];
  assert.equal(finding.origin, 'DETECTOR');
  assert.equal(finding.detectorMask, undefined); assert.ok(finding.finalTrace);
  assert.equal(pixels(finding), 100);
  assert.equal(finding.featureFingerprint, undefined); assert.equal(finding.featureFingerprintTraceSha256, undefined);
  assert.ok(next.sides.FRONT.humanEditedIds.includes(finding.id));
});

test('the measured result cannot apply after edit discard and exact CPU receipt survives human confirmation', async () => {
  const pending = edit(workspace(false), traceAction());
  const result = await run(pending);
  const discarded = discardPendingDefectEdit(pending, { side: 'FRONT', base: defectBase(pending, 'FRONT'), actor: 'HUMAN' }).state;
  assert.throws(() => applyDefectMeasurement(discarded, result), /STALE/);
  let state = applyDefectMeasurement(pending, result).state;
  for (const side of ['FRONT', 'BACK']) state = markDefectSideInspected(state, { side, base: defectBase(state, side), actor: 'HUMAN', inspected: true }).state;
  state = confirmDefectFindings(state, { base: { FRONT: defectBase(state, 'FRONT'), BACK: defectBase(state, 'BACK') }, actor: 'HUMAN', reviewed: true }).state;
  assert.deepEqual(state.sides.FRONT.measurement.receipt, result.receipt);
});

test('material-only CPU remeasurement preserves original review metadata and masks', async () => {
  const initial = await settle(edit(workspace(), { type: 'CHANGE_TYPE', defectId: measurements.FRONT.id, defectType: 'FRAYING' }));
  const pending = replaceDefectFrame(initial, { side: 'FRONT', base: defectBase(initial, 'FRONT'), frame: initial.sides.FRONT.frame, cornerShape: 'ROUNDED_3_18_MM' }).state;
  const next = await settle(pending);
  assert.equal(next.sides.FRONT.findings[0].reviewResult, 'TYPE_CORRECTED');
  assert.equal(next.sides.FRONT.findings[0].origin, 'DETECTOR');
  assert.deepEqual(next.sides.FRONT.findings[0].detectorMask, initial.sides.FRONT.findings[0].detectorMask);
  assert.deepEqual(next.sides.BACK, initial.sides.BACK);
});

test('caller state and resource limits are captured before asynchronous filesystem/CPU work', async () => {
  const state = clone(edit(workspace(false), traceAction())), limitInput = { ...limits };
  const promise = run(state, { limits: limitInput });
  state.cardId = 'mutated'; state.sides.FRONT.frame.inspectionImageSha256 = 'e'.repeat(64);
  state.sides.FRONT.pending.action.trace.defectType = 'DENT_MATERIAL_DAMAGE';
  limitInput.maxOutputBytes = 1; limitInput.timeoutMs = 1;
  const result = await promise;
  assert.equal(result.base.cardId, 'synthetic-card'); assert.equal(result.findings[0].defectType, 'VISIBLE_WHITENING');
  assert.equal(result.base.frame.inspectionImageSha256, '3'.repeat(64));
});

test('input/output limits and invalid/pre-aborted signals fail explicitly and clean temporary artifacts', async () => {
  const pending = edit(workspace(false), traceAction()), before = new Set((await readdir(tmpdir())).filter(name => name.startsWith('atlas-measurement-')));
  await assert.rejects(run(pending, { limits: { ...limits, maxInputBytes: 1 } }), /MEASUREMENT_LIMIT/);
  await assert.rejects(run(pending, { limits: { ...limits, maxOutputBytes: 1 } }), /MEASUREMENT_LIMIT/);
  await assert.rejects(run(pending, { signal: {} }), /MEASUREMENT_INVALID/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(run(pending, { signal: controller.signal }), /MEASUREMENT_CANCELLED/);
  await assert.rejects(run(pending, { limits: { ...limits, timeoutMs: 0 } }), /MEASUREMENT_LIMIT/);
  const after = (await readdir(tmpdir())).filter(name => name.startsWith('atlas-measurement-'));
  assert.ok(after.every(name => before.has(name)));
});

test('timeout and cancellation actually terminate/reap a blocked child before rejection', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'atlas-measurement-process-test-'));
  try {
    const worker = join(directory, 'blocked.py'), pidFile = join(directory, 'pid');
    await writeFile(worker, 'import json,os,sys,time\nfrom pathlib import Path\nr=json.load(sys.stdin)\nPath(r["pidFile"]).write_text(str(os.getpid()))\ntime.sleep(30)\n');
    await assert.rejects(runMeasurementWorker(python, worker, { pidFile }, { timeoutMs: 250 }), /MEASUREMENT_TIMEOUT/);
    let pid = Number(await readFile(pidFile, 'utf8'));
    assert.throws(() => process.kill(pid, 0), error => error.code === 'ESRCH');
    const controller = new AbortController();
    const waiting = runMeasurementWorker(python, worker, { pidFile }, { timeoutMs: 10000, signal: controller.signal });
    const caught = assert.rejects(waiting, /MEASUREMENT_CANCELLED/);
    for (let i = 0; i < 100; i++) {
      const current = Number(await readFile(pidFile, 'utf8'));
      if (current !== pid) { pid = current; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    controller.abort(); await caught;
    assert.throws(() => process.kill(pid, 0), error => error.code === 'ESRCH');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('worker rejects changed CPU source manifest before accepting or writing an output', async () => {
  const worker = fileURLToPath(new URL('../../../backend/ai-grader-speedster-service/manual_measurement_worker.py', import.meta.url));
  await assert.rejects(runMeasurementWorker(python, worker, { expectedSources: {} }, { timeoutMs: 10000 }), /MEASUREMENT_SOURCE_MISMATCH/);
});
