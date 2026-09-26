import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMachineReport, createBatchPreparation } from '../src/batch-preparation.mjs';
import { workspace } from '../../atlas-manual-workspace/test/defect-fixtures.mjs';
import { runDefectMeasurement } from '../../atlas-manual-workspace/src/defect-actions.mjs';
import { decodeSpeedsterTraceRleV1 } from '@atlas/grading-core/trace-codec';
import { createBatchWorker } from '@atlas/batch-grading';

const SIDES = ['FRONT', 'BACK'];
const quad = [{ x: .04, y: .03 }, { x: .96, y: .03 }, { x: .96, y: .97 }, { x: .04, y: .97 }];
function fixture() {
  const card = { cardId: 'synthetic-card', revision: 1, contentHash: 'a'.repeat(64), draft: { source: { sourceHash: 'b'.repeat(64) } } };
  const state = { defects: workspace(false), geometry: { profile: 'SPORTS', sides: Object.fromEntries(SIDES.map(side => [side, { physical: { quad }, printed: { quad }, prepared: { id: side } }])) },
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
test('ambiguous geometry produces a tentative machine report with final-review warning and original authority', async () => {
  const f = fixture();
  f.state.geometry.sides.FRONT.physical = { quad, actor: 'ENGINE', proposal: { id: 'physical', ambiguous: false } };
  f.state.geometry.sides.FRONT.printed = { quad, actor: 'ENGINE', proposal: { id: 'competing-real-candidate', ambiguous: true } };
  f.state.geometry.sides.BACK.physical = { quad, actor: 'ENGINE', proposal: { id: 'back', ambiguous: false } };
  const before = structuredClone(f.state), report = await buildMachineReport(f);
  assert.equal(report.certification, null); assert.equal(report.proposedGrade, 10);
  assert.equal(report.geometryReview.requiresHumanConfirmation, true);
  assert.deepEqual(report.geometryReview.sides.FRONT, { machineUsable: true, ambiguous: true, confirmed: false, unresolved: [] });
  assert.match(report.limitations.at(-1), /competing plausible outlines on FRONT/);
  assert.deepEqual(f.state, before);
});
test('missing printed geometry still measures real proposals but cannot fabricate centering or an overall grade', async () => {
  const f = fixture(); f.state.geometry.sides.BACK.printed = null;
  const before = structuredClone(f.state), report = await buildMachineReport(f);
  assert.equal(report.grade, null); assert.equal(report.proposedGrade, null);
  assert.equal(report.calculationState, 'GEOMETRY_UNRESOLVED');
  assert.deepEqual(report.unresolvedGeometry, [{ side: 'BACK', code: 'PRINTED_GEOMETRY_UNRESOLVED' }]);
  assert.equal(report.geometry.BACK.centeringQuad, null);
  assert.deepEqual(report.geometry.FRONT.centeringQuad, quad);
  assert.equal(report.findings.length, 2); assert.equal(report.measurementReceipts.length, 2);
  assert.ok(report.findings.every(finding => finding.origin === 'DETECTOR' && finding.reviewResult === 'UNREVIEWED'));
  assert.equal(report.geometryReview.sides.BACK.machineUsable, true);
  assert.match(report.limitations.at(-1), /overall grade remain unavailable/);
  assert.equal(report.certification, null); assert.deepEqual(f.state, before);
});
test('a proposal outside a rounded corner is retained for human review while real in-card defects are measured', async () => {
  const f = fixture();
  f.state.defects = structuredClone(f.state.defects);
  f.state.defects.sides.FRONT.cornerShape = 'ROUNDED_3_18_MM';
  const original = f.analysis.proposals[0];
  const outside = { ...original, id: 'outside-rounded-corner', canonicalContour: [
    { x: .987, y: .994 }, { x: .991, y: .994 }, { x: .991, y: .998 }, { x: .987, y: .998 },
  ] };
  const inside = { ...original, id: 'measurable-corner', canonicalContour: [
    { x: .976, y: .978 }, { x: .981, y: .978 }, { x: .981, y: .983 }, { x: .976, y: .983 },
  ] };
  f.analysis.proposals.push(outside, inside);
  const before = structuredClone({ analysis: f.analysis, state: f.state }), report = await buildMachineReport(f);
  assert.equal(report.findings.length, 3); assert.equal(report.measurementReceipts.length, 3);
  assert.deepEqual(report.unmeasurableProposals, [{ ...outside, reason: 'NO_IN_CARD_RASTER_PIXELS' }]);
  assert.equal(report.measurementReceipts.some(receipt => receipt.proposalId === inside.id), true);
  assert.equal(report.measurementReceipts.some(receipt => receipt.proposalId === outside.id), false);
  assert.match(report.limitations.at(-1), /manual workspace before certification/);
  assert.equal(report.certification, null); assert.deepEqual(f.analysis, before.analysis);
  assert.deepEqual(f.state, before.state);
});
test('a valid subpixel contour remains unmeasurable evidence without fabricating a finding', async () => {
  const f = fixture();
  f.analysis.proposals = [{ ...f.analysis.proposals[0], canonicalContour: [
    { x: .50001, y: .50001 }, { x: .50002, y: .50001 }, { x: .50002, y: .50002 },
  ] }];
  const report = await buildMachineReport(f);
  assert.equal(report.findings.length, 0); assert.equal(f.inputs.length, 0);
  assert.deepEqual(report.unmeasurableProposals, [{ ...f.analysis.proposals[0], reason: 'NO_IN_CARD_RASTER_PIXELS' }]);
});
for (const canonicalContour of [null, [], [{ x: 0, y: 0 }, { x: NaN, y: .2 }, { x: .2, y: .2 }],
  [{ x: 2, y: 0 }, { x: 2, y: .2 }, { x: 2, y: .3 }]]) test('malformed contour cannot become an excluded machine proposal', async () => {
  const f = fixture(); f.analysis.proposals[0].canonicalContour = canonicalContour;
  await assert.rejects(buildMachineReport(f), error => error.code === 'BATCH_ANALYSIS_INVALID_CONTOUR');
  assert.equal(f.inputs.length, 0);
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

test('preparation persists machine identification capacity backoff without requiring human resume', async () => {
  let machineCalls = 0;
  const sourceHash = 'b'.repeat(64), uploads = { FRONT: 'front', BACK: 'back' };
  const connected = {
    open: async () => ({ card: { ready: true, sourceHash, sides: Object.fromEntries(SIDES.map(side => [side, { upload: { uploadId: uploads[side] } }])) },
      manual: null, identification: { state: 'UNKNOWN' } }),
    identification: {
      async runMachine() { machineCalls++; return { state: 'RETRY_WAIT', retryAfterMs: 30000 }; },
      async run() { assert.fail('batch must use the durable machine continuation'); },
    },
    async initialize() { assert.fail('identification has not completed'); },
  };
  const result = await createBatchPreparation({ connected }).run({}, { cardId: 'synthetic-card', sourceHash, uploads, stage: 'PREPARE' });
  assert.deepEqual(result, { kind: 'WAIT', retryAfterMs: 30000 }); assert.equal(machineCalls, 1);
});

for (const cacheState of ['READY', 'NEEDS_REVIEW']) test(`PREPARE admits ${cacheState} physical/prepared evidence with missing printed borders`, async () => {
  const f = fixture(), uploads = { FRONT: 'front', BACK: 'back' }, calls = [];
  f.state.geometry.sides.BACK.printed = null;
  const job = { cardId: f.card.cardId, sourceHash: f.card.draft.source.sourceHash, uploads, stage: 'PREPARE' };
  const opened = { card: { ready: true, sourceHash: job.sourceHash,
    sides: Object.fromEntries(SIDES.map(side => [side, { upload: { uploadId: uploads[side] } }])) },
    revision: 4, manual: null, identification: { state: 'COMPLETE' }, details: {
      fields: { name: 'Synthetic player', category: 'Sports cards', manufacturer: 'Fixture', card_number: '1', year: '2026', set_name: 'Evidence test', variant: '', card_type: '' },
      profile: 'SPORTS', layoutType: null, cornerShape: 'SQUARE', matColor: 'BLACK', parallel: '', insert: '', touched: [], sourceHash: job.sourceHash,
    } };
  const connected = { open: async () => opened,
    earlyGeometry: { async ensure() { calls.push('geometry'); return { earlyGeometry: {
      FRONT: { state: 'READY', machineUsable: true },
      BACK: { state: cacheState, machineUsable: true, unresolved: ['PRINTED_GEOMETRY_UNRESOLVED'] },
    } }; } },
    async initialize(_staff, cardId, input) { calls.push('initialize'); assert.equal(cardId, job.cardId);
      assert.deepEqual(input, { sourceHash: job.sourceHash, detailsRevision: 4 }); },
    workflow: { service: { read: async () => f.card }, hydrate: async () => f.state },
  };
  const before = structuredClone(f.state), result = await createBatchPreparation({ connected }).run({}, job);
  assert.deepEqual(result, { kind: 'CONTINUE', evidence: { manualRevision: f.card.revision, manualContentHash: f.card.contentHash } });
  assert.deepEqual(calls, ['geometry', 'initialize']); assert.deepEqual(f.state, before);
});

test('REPORT persists measured partial report and enters final review when printed geometry is missing', async () => {
  const f = fixture(), uploads = { FRONT: 'front', BACK: 'back' }, writes = [];
  f.state.geometry.sides.BACK.printed = null;
  const job = { cardId: f.card.cardId, sourceHash: f.card.draft.source.sourceHash, uploads, stage: 'REPORT',
    analysisActionId: 'same-analysis-action', evidence: { manualRevision: f.card.revision, manualContentHash: f.card.contentHash } };
  const connected = { open: async () => ({ card: { ready: true, sourceHash: job.sourceHash,
    sides: Object.fromEntries(SIDES.map(side => [side, { upload: { uploadId: uploads[side] } }])) } }),
    workflow: { service: { read: async () => f.card }, hydrate: async () => f.state },
    assistance: { async status() { return { astra: f.analysis }; } },
  };
  const result = await createBatchPreparation({ connected, measure: f.measure,
    artifacts: { async write(report, binding) { writes.push({ report, binding }); return { key: 'partial-report' }; } } }).run({}, job);
  assert.equal(result.kind, 'REVIEW'); assert.equal(result.evidence.proposedGrade, null);
  assert.equal(result.evidence.calculationState, 'GEOMETRY_UNRESOLVED'); assert.equal(result.evidence.findingCount, 2);
  assert.deepEqual(result.evidence.unresolvedGeometry, [{ side: 'BACK', code: 'PRINTED_GEOMETRY_UNRESOLVED' }]);
  assert.equal(writes.length, 1); assert.equal(writes[0].report.grade, null);
  assert.equal(writes[0].report.measurementReceipts.length, 2); assert.equal(writes[0].report.certification, null);
  assert.equal(writes[0].binding.kind, 'BATCH_REPORT');
});

for (const status of ['READY', 'RUNNING', 'UNKNOWN', 'PREPARED', 'NOT_FOUND']) test(`machine analysis reconciles exact saved ${status} state before dispatch`, async () => {
  const f = fixture(), uploads = { FRONT: 'front', BACK: 'back' }, calls = [];
  const job = { cardId: f.card.cardId, sourceHash: f.card.draft.source.sourceHash, uploads, stage: 'ANALYZE',
    analysisActionId: 'same-analysis-action', evidence: { manualRevision: f.card.revision, manualContentHash: f.card.contentHash } };
  const opened = { card: { ready: true, sourceHash: job.sourceHash,
    sides: Object.fromEntries(SIDES.map(side => [side, { upload: { uploadId: uploads[side] } }])) } };
  const connected = { open: async () => opened, workflow: { service: { read: async () => f.card }, hydrate: async () => f.state },
    assistance: {
      async status(_actor, cardId, actionId) { calls.push(['status', cardId, actionId]); return { state: status, astra: { status, analysisId: actionId } }; },
      async analyzeMachine(_actor, cardId, input) { calls.push(['analyze', cardId, input.actionId]); return { state: 'DISPATCHED', astra: { status: 'RUNNING' } }; },
    } };
  const result = await createBatchPreparation({ connected }).run({}, job);
  assert.deepEqual(calls[0], ['status', job.cardId, job.analysisActionId]);
  assert.equal(calls.length, ['PREPARED', 'NOT_FOUND'].includes(status) ? 2 : 1);
  assert.equal(result.kind, status === 'READY' ? 'CONTINUE' : status === 'UNKNOWN' ? 'ATTENTION' : 'WAIT');
  if (status === 'READY') assert.equal(result.evidence.analysisId, job.analysisActionId);
});

for (const stage of ['PREPARE', 'ANALYZE']) test(`shutdown during real ${stage} preparation reads prevents provider admission and retains the same stage`, async () => {
  const f = fixture(), staff = { id: 'synthetic-staff' }, uploads = { FRONT: 'front', BACK: 'back' };
  const job = { cardId: f.card.cardId, sourceHash: f.card.draft.source.sourceHash, uploads, stage,
    analysisActionId: 'same-analysis-action', evidence: { manualRevision: f.card.revision, manualContentHash: f.card.contentHash } };
  let entered, release, claims = 0, effects = 0;
  const reading = new Promise(resolve => { entered = resolve; }), pending = new Promise(resolve => { release = resolve; });
  const delayedRead = async value => { entered(); await pending; return value; };
  const opened = { card: { ready: true, sourceHash: job.sourceHash,
    sides: Object.fromEntries(SIDES.map(side => [side, { upload: { uploadId: uploads[side] } }])) },
    manual: stage === 'ANALYZE' ? {} : null, identification: { state: 'NOT_STARTED' } };
  const connected = { open: async () => stage === 'PREPARE' ? delayedRead(opened) : opened,
    identification: { async run() { effects++; throw Error('identification must not start after stop'); } },
    workflow: { service: { read: async () => f.card }, hydrate: () => delayedRead(f.state) },
    assistance: { async analyzeMachine() { effects++; throw Error('analysis must not start after stop'); } } };
  const finished = [];
  const worker = createBatchWorker({ concurrency: 1, prepare: createBatchPreparation({ connected }), repository: {
    async claim() { claims++; return job; }, async renew() { return true; },
    async finish(_staff, value, outcome) { finished.push({ value, outcome }); return true; },
  } });
  try {
    worker.wake(staff); await reading;
    let stopped = false;
    const stopping = worker.stop().then(() => { stopped = true; });
    assert.equal(stopped, false); release(); await stopping;
    assert.equal(effects, 0); assert.equal(claims, 1); assert.equal(finished.length, 1);
    assert.equal(finished[0].value.stage, stage); assert.equal(finished[0].outcome.kind, 'WAIT');
    assert.equal(worker.status().active, 0);
  } finally { release(); await worker.stop(); }
});
