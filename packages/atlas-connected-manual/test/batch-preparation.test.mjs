import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMachineReport, createBatchPreparation } from '../src/batch-preparation.mjs';
import { workspace } from '../../atlas-manual-workspace/test/defect-fixtures.mjs';
import { runDefectMeasurement } from '../../atlas-manual-workspace/src/defect-actions.mjs';
import { decodeSpeedsterTraceRleV1 } from '@atlas/grading-core/trace-codec';

const SIDES = ['FRONT', 'BACK'];
const quad = [{ x: .04, y: .03 }, { x: .96, y: .03 }, { x: .96, y: .97 }, { x: .04, y: .97 }];
function fixture() {
  const card = { cardId: 'synthetic-card', revision: 1, contentHash: 'a'.repeat(64), draft: { source: { sourceHash: 'b'.repeat(64) } } };
  const state = { defects: workspace(false), geometry: { profile: 'SPORTS', sides: Object.fromEntries(SIDES.map(side => [side, { printed: { quad }, prepared: { id: side } }])) },
    identity: { playerName: 'Synthetic player', year: '2026', manufacturer: 'Fixture', productSet: 'Evidence test' } };
  const analysis = { status: 'READY', analysisId: 'synthetic-analysis', limitations: ['Synthetic verification only'], proposals: SIDES.map((side, index) => ({
    id: `proposal-${index}`, side, defectType: 'LIGHT_SCRATCH_SCUFF', reviewStatus: 'UNREVIEWED',
    canonicalContour: [{ x: .2, y: .2 }, { x: .22, y: .2 }, { x: .22, y: .22 }, { x: .2, y: .22 }],
    areaMm2: 9999999, proposedGrade: 1,
  })) };
  const inputs = [];
  const measure = async ({ workspace, side }) => {
    inputs.push(structuredClone(workspace));
    assert.equal(workspace.sides[side].pending.actor, 'ENGINE');
    assert.equal(workspace.confirmation, null); assert.equal(workspace.sides[side].inspection, null);
    assert.deepEqual(workspace.sides[side].humanEditedIds, []);
    return runDefectMeasurement(workspace, side, async input => ({ receipt: { fixture: 'synthetic-cpu-result' },
      defects: [...input.findings, ...input.marks.map(mark => {
        const pixels = decodeSpeedsterTraceRleV1(mark.finalTrace).reduce((sum, pixel) => sum + pixel, 0);
        return { ...mark, side, origin: 'SMART_MARK', confidence: 1, supportingViewIds: [], reviewResult: 'SMART_MARKED',
          measurementRegions: [{ zone: 'SURFACE', canonicalContour: quad, measurement: { pixelCount: pixels,
            widthMm: 1, heightMm: 1, areaMm2: pixels * .0025, zonePercent: .01, multiplier: 1, weightedAreaMm2: pixels * .0025, subgradeEffect: 0 } }] };
      })] }));
  };
  return { card, state, analysis, measure, inputs };
}
test('machine draft uses measured contours and current deterministic score without manufacturing human review', async () => {
  const f = fixture(), before = structuredClone(f.state), report = await buildMachineReport(f);
  assert.equal(report.version, 'atlas-machine-provisional-report-v1'); assert.equal(report.authority, 'MACHINE_PROPOSAL');
  assert.equal(report.certification, null); assert.equal(report.findings.length, 2);
  assert.equal(report.findings.every(finding => finding.origin === 'DETECTOR' && finding.reviewResult === 'UNREVIEWED'), true);
  assert.equal(report.proposedGrade, 10); assert.equal(report.measurementReceipts.length, 2);
  assert.deepEqual(f.state, before); assert.equal(JSON.stringify(report).includes('manualInspection'), false);
  assert.deepEqual(report.limitations, f.analysis.limitations);
});
test('a clean machine proposal still remains uncertified and uninspected', async () => {
  const f = fixture(); f.analysis.proposals = []; const report = await buildMachineReport(f);
  assert.equal(report.proposedGrade, 10); assert.equal(report.certification, null); assert.deepEqual(report.measurementReceipts, []);
  assert.equal(f.inputs.length, 0); assert.equal(report.findings.length, 0);
});
test('manual findings, existing inspection and nonready analysis cannot be replaced by machine drafting', async () => {
  const f = fixture(); f.state.defects = workspace();
  await assert.rejects(buildMachineReport(f), error => error.code === 'BATCH_HUMAN_WORK_PRESENT');
  const waiting = fixture(); waiting.analysis.status = 'RUNNING';
  await assert.rejects(buildMachineReport(waiting), error => error.code === 'BATCH_ANALYSIS_NOT_READY');
});
test('missing CPU receipt and cancellation refuse review readiness', async () => {
  const f = fixture(), measure = f.measure;
  f.measure = async input => ({ ...await measure(input), receipt: null });
  await assert.rejects(buildMachineReport(f), error => error.code === 'BATCH_MEASUREMENT_UNVERIFIED');
  await assert.rejects(buildMachineReport({ ...fixture(), signal: AbortSignal.abort() }), error => error.code === 'BATCH_INTERRUPTED');
});
test('preparation pauses safely for missing identity without calling human actions', async () => {
  let initialized = false;
  const connected = {
    open: async () => ({ card: { ready: true, sourceHash: 'b'.repeat(64), sides: { FRONT: { upload: { uploadId: 'front' } }, BACK: { upload: { uploadId: 'back' } } } },
      manual: null, identification: { state: 'COMPLETE' }, details: {} }),
    initialize: async () => { initialized = true; },
  };
  const result = await createBatchPreparation({ connected }).run({}, { cardId: 'synthetic-card', sourceHash: 'b'.repeat(64), uploads: { FRONT: 'front', BACK: 'back' }, stage: 'PREPARE' });
  assert.equal(result.code, 'BATCH_IDENTITY_NEEDS_REVIEW'); assert.equal(initialized, false);
});
