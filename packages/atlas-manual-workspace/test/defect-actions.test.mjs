import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDefectWorkspace, parseDefectWorkspace, serializeDefectWorkspace, defectBase, defectStatus,
  beginDefectEdit, runDefectMeasurement, applyDefectMeasurement, markDefectSideInspected, confirmDefectFindings,
  adoptDefectProposals, beginDefectMapFilter, discardPendingDefectEdit, replaceDefectFrame, previewDefectReport,
} from '../src/defect-actions.mjs';
import { workspace, measurements, traceAction, edit, clone, unchangedMeasurement } from './defect-fixtures.mjs';

const id = measurements.FRONT.id;
const inspect = (state, side) => markDefectSideInspected(state, { side, base: defectBase(state, side), actor: 'HUMAN', inspected: true }).state;
const confirm = state => confirmDefectFindings(state, { actor: 'HUMAN', reviewed: true,
  base: { FRONT: defectBase(state, 'FRONT'), BACK: defectBase(state, 'BACK') } }).state;
const settle = async state => applyDefectMeasurement(state, await runDefectMeasurement(state, 'FRONT', unchangedMeasurement)).state;

test('empty human workspace needs both actual inspection actions; never invents detector results or approval', () => {
  let state = workspace(false);
  assert.deepEqual(state.sides.FRONT.source, { method: 'HUMAN' });
  assert.equal(defectStatus(state).canConfirm, false);
  assert.throws(() => confirm(state), /INSPECTION_REQUIRED/);
  state = inspect(state, 'FRONT'); assert.throws(() => confirm(state), /INSPECTION_REQUIRED/);
  state = inspect(state, 'BACK'); state = confirm(state);
  assert.equal(defectStatus(state).confirmed, true);
  assert.equal(defectStatus(state).reportApproval, false);
  assert.equal(defectStatus(state).learningPublished, false);
  assert.deepEqual(state.sides.FRONT.findings, []);
  assert.equal(state.sides.FRONT.inspection.findingRevision, state.sides.FRONT.findingRevision);
});

test('type correction is a pending candidate, fences inspection immediately and preserves Back', async () => {
  let state = inspect(inspect(workspace(), 'FRONT'), 'BACK');
  const before = clone(state), base = defectBase(state, 'FRONT');
  state = edit(state, { type: 'CHANGE_TYPE', defectId: id, defectType: 'LIGHT_SCRATCH_SCUFF' });
  assert.equal(state.sides.FRONT.findings[0].defectType, 'VISIBLE_WHITENING');
  assert.equal(state.sides.FRONT.pending.action.defectType, 'LIGHT_SCRATCH_SCUFF');
  assert.equal(state.sides.FRONT.findingRevision, before.sides.FRONT.findingRevision + 1);
  assert.equal(state.sides.FRONT.inspection, null);
  assert.deepEqual(state.sides.BACK, before.sides.BACK);
  assert.throws(() => inspect(state, 'FRONT'), /MEASUREMENT_PENDING/);
  assert.throws(() => beginDefectEdit(state, { side: 'FRONT', base, actor: 'HUMAN', action: { type: 'REMOVE', defectIds: [id] } }), /STALE/);
  state = await settle(state);
  assert.equal(state.sides.FRONT.findings[0].defectType, 'LIGHT_SCRATCH_SCUFF');
  assert.equal(state.sides.FRONT.findings[0].reviewResult, 'TYPE_CORRECTED');
  assert.equal(state.sides.FRONT.findings[0].origin, 'DETECTOR');
  assert.deepEqual(state.sides.BACK, before.sides.BACK);
});

test('remove and undo preserve private prior state, require CPU and advance revisions even to equal values', async () => {
  let state = await settle(edit(workspace(), { type: 'CHANGE_TYPE', defectId: id, defectType: 'LIGHT_SCRATCH_SCUFF' }));
  const before = clone(state.sides.FRONT.findings), rev = state.sides.FRONT.findingRevision;
  state = await settle(edit(state, { type: 'REMOVE', defectIds: [id] }));
  assert.equal(state.sides.FRONT.findings[0].reviewResultBeforeRemoval, 'TYPE_CORRECTED');
  assert.throws(() => edit(state, { type: 'REMOVE', defectIds: [id] }), /REMOVED/);
  state = await settle(edit(state, { type: 'UNDO', defectIds: [id] }));
  assert.deepEqual(state.sides.FRONT.findings, before);
  assert.equal(state.sides.FRONT.findingRevision, rev + 2);
  assert.throws(() => edit(state, { type: 'UNDO', defectIds: [id] }), /NOT_REMOVED/);
});

test('late result after pending discard, same-byte replacement or newer Front action cannot apply', async () => {
  let state = edit(workspace(), { type: 'REMOVE', defectIds: [id] });
  const result = await runDefectMeasurement(state, 'FRONT', unchangedMeasurement);
  const discarded = discardPendingDefectEdit(state, { side: 'FRONT', base: defectBase(state, 'FRONT'), actor: 'HUMAN' }).state;
  assert.throws(() => applyDefectMeasurement(discarded, result), /STALE/);
  const replacement = { ...state.sides.FRONT.frame, imageVersion: 2, preparationVersion: 2 };
  const replaced = replaceDefectFrame(state, { side: 'FRONT', base: defectBase(state, 'FRONT'), frame: replacement, cornerShape: 'SQUARE' }).state;
  assert.throws(() => applyDefectMeasurement(replaced, result), /STALE/);
  assert.deepEqual(replaced.sides.BACK, state.sides.BACK);
  const newer = edit(discarded, { type: 'CHANGE_TYPE', defectId: id, defectType: 'FRAYING' });
  assert.throws(() => applyDefectMeasurement(newer, result), /STALE/);
});

test('independent Back inspection does not stale an active Front measurement', async () => {
  const state = edit(workspace(), { type: 'REMOVE', defectIds: [id] });
  const result = await runDefectMeasurement(state, 'FRONT', unchangedMeasurement);
  const newer = inspect(state, 'BACK');
  const applied = applyDefectMeasurement(newer, result).state;
  assert.deepEqual(applied.sides.BACK, newer.sides.BACK);
});

test('late maps and proposals cannot remove human-edited DETECTOR origin or reviewed lists', async () => {
  let state = workspace(), oldBase = defectBase(state, 'FRONT');
  state = await settle(edit(state, { type: 'CHANGE_TYPE', defectId: id, defectType: 'FRAYING' }));
  const map = { revisionId: 'synthetic-map', sha256: 'a'.repeat(64) };
  assert.throws(() => beginDefectMapFilter(state, { side: 'FRONT', base: oldBase, removedFindingIds: [id], map }), /STALE/);
  assert.throws(() => beginDefectMapFilter(state, { side: 'FRONT', base: defectBase(state, 'FRONT'), removedFindingIds: [id], map }), /HUMAN_FINDING_PROTECTED/);
  assert.throws(() => adoptDefectProposals(state, { side: 'FRONT', base: defectBase(state, 'FRONT'), findings: [],
    source: { method: 'DETECTOR', version: 'fixture', id: 'new' } }), /HUMAN_FINDING_PROTECTED/);
  const inspected = inspect(workspace(), 'FRONT');
  assert.throws(() => beginDefectMapFilter(inspected, { side: 'FRONT', base: defectBase(inspected, 'FRONT'), removedFindingIds: [id], map }), /HUMAN_FINDING_PROTECTED/);
});

test('an evaluated untouched map removal remains a pending CPU action with exact map provenance', async () => {
  const state = workspace(), map = { revisionId: 'synthetic-map', sha256: 'a'.repeat(64) };
  const pending = beginDefectMapFilter(state, { side: 'FRONT', base: defectBase(state, 'FRONT'), removedFindingIds: [id], map }).state;
  assert.equal(pending.sides.FRONT.pending.actor, 'ENGINE');
  assert.deepEqual(pending.sides.FRONT.source.map, map);
  const measured = await settle(pending);
  assert.equal(measured.sides.FRONT.findings[0].reviewResult, 'REMOVED');
  assert.deepEqual(measured.sides.BACK, state.sides.BACK);
});

test('failed measurement retains candidate; malformed, foreign-side or missing exact trace results refuse', async () => {
  const pending = edit(workspace(false), traceAction());
  const before = clone(pending);
  await assert.rejects(runDefectMeasurement(pending, 'FRONT', async () => { throw Error('CPU failed'); }), /CPU failed/);
  assert.deepEqual(pending, before);
  await assert.rejects(runDefectMeasurement(pending, 'FRONT', async () => ({ defects: [] })), /MEASUREMENT_MISSING/);
  await assert.rejects(runDefectMeasurement(pending, 'FRONT', async () => ({ defects: [measurements.BACK] })), /SIDE_MISMATCH/);
  await assert.rejects(runDefectMeasurement(pending, 'FRONT', async () => ({ defects: [], traceErrors: [{}] })), /MEASUREMENT_INVALID/);
});

test('trace saves enforce side, source, exact wire/hash, crop, target and duplicate identity', () => {
  const state = workspace();
  assert.throws(() => edit(state, traceAction('BACK')), /SIDE_MISMATCH/);
  assert.throws(() => edit(state, traceAction('FRONT', measurements.BACK.id)), /NOT_FOUND/);
  assert.throws(() => edit(state, traceAction('FRONT', null, undefined, id)), /ID_CONFLICT/);
  const badSource = traceAction(); badSource.trace.traceProvenance.sourceViewId = 'BACK:inspection';
  assert.throws(() => edit(state, badSource), /PROVENANCE_INVALID/);
  const badHash = traceAction(); badHash.trace.traceProvenance.finalTraceSha256 = 'a'.repeat(64);
  assert.throws(() => edit(state, badHash), /PROVENANCE_INVALID/);
  const badCrop = traceAction(); badCrop.trace.traceProvenance.cropTransform.crop.width = 1270;
  assert.throws(() => edit(state, badCrop), /PROVENANCE_INVALID/);
  const corrupt = traceAction(); corrupt.trace.traceWire.dataBase64 = 'A'.repeat(corrupt.trace.traceWire.dataBase64.length);
  assert.throws(() => edit(state, corrupt));
});

test('duplicate/missing/cross-side batch targets and caller-authored measurement fields fail before CPU', () => {
  const state = workspace();
  for (const action of [
    { type: 'REMOVE', defectIds: [id, id] }, { type: 'REMOVE', defectIds: ['missing'] },
    { type: 'REMOVE', defectIds: [id, measurements.BACK.id] },
    { type: 'CHANGE_TYPE', defectId: id, defectType: 'VISIBLE_WHITENING', measurement: { areaMm2: 0 } },
  ]) assert.throws(() => edit(state, action));
  assert.throws(() => beginDefectEdit(state, { side: 'FRONT', base: defectBase(state, 'FRONT'), actor: 'ASTRA', action: { type: 'REMOVE', defectIds: [id] } }), /HUMAN_REQUIRED/);
});

test('bulk confirmation preserves type/trace/removal dispositions and makes only unreviewed accepted', async () => {
  let state = await settle(edit(workspace(), { type: 'CHANGE_TYPE', defectId: id, defectType: 'FRAYING' }));
  state = confirm(inspect(inspect(state, 'FRONT'), 'BACK'));
  assert.equal(state.sides.FRONT.findings[0].reviewResult, 'TYPE_CORRECTED');
  assert.equal(state.sides.BACK.findings[0].reviewResult, 'ACCEPTED');
  assert.equal(state.sides.FRONT.measurement.receipt.test, 'state-only-stub');
  assert.equal(defectStatus(state).confirmed, true);
  state = edit(state, { type: 'REMOVE', defectIds: [id] });
  assert.equal(state.confirmation, null);
  assert.equal(state.sides.BACK.inspection.inspected, true);
});

test('report uses unchanged core and allows identity/border changes without repeating inspection', () => {
  const state = confirm(inspect(inspect(workspace(false), 'FRONT'), 'BACK'));
  const quad = [{ x: .04, y: .03 }, { x: .96, y: .03 }, { x: .96, y: .97 }, { x: .04, y: .97 }];
  const input = { identity: { playerName: 'Synthetic Player', year: '2026', manufacturer: 'Fixture', productSet: 'Fixture' }, centeringQuads: { FRONT: quad, BACK: quad } };
  const report = previewDefectReport(state, input);
  assert.equal(report.inspection.method, 'HUMAN'); assert.equal(report.findingCounts.total, 0);
  const next = previewDefectReport(state, { ...input, draftRevision: state.draftRevision + 1, identity: { ...input.identity, playerName: 'Corrected' } });
  assert.deepEqual(next.inspection, report.inspection); assert.equal(next.identity.playerName, 'Corrected');
  assert.throws(() => previewDefectReport(workspace(false), input), /CONFIRMATION_REQUIRED/);
});

test('exact artifact roundtrip preserves source/removal/trace authority and rejects forged inspection', async () => {
  const state = await settle(edit(workspace(), { type: 'REMOVE', defectIds: [id] }));
  assert.deepEqual(parseDefectWorkspace(serializeDefectWorkspace(state)), state);
  const bad = clone(state); bad.sides.FRONT.inspection = { inspected: true, imageSha256: 'e'.repeat(64), findingRevision: bad.sides.FRONT.findingRevision };
  assert.throws(() => parseDefectWorkspace(bad), /INSPECTION_STALE/);
  const noMask = clone(state); delete noMask.sides.FRONT.findings[0].detectorMask;
  assert.throws(() => parseDefectWorkspace(noMask), /EXACT_MASK_REQUIRED/);
});

test('material-only revision retains exact source findings as pending remeasurement', () => {
  const state = workspace();
  const next = replaceDefectFrame(state, { side: 'FRONT', base: defectBase(state, 'FRONT'), frame: state.sides.FRONT.frame, cornerShape: 'ROUNDED_3_18_MM' }).state;
  assert.deepEqual(next.sides.FRONT.findings, state.sides.FRONT.findings);
  assert.equal(next.sides.FRONT.pending.action.type, 'REMEASURE');
  assert.deepEqual(next.sides.BACK, state.sides.BACK);
  const discarded = discardPendingDefectEdit(next, { side: 'FRONT', base: defectBase(next, 'FRONT'), actor: 'HUMAN' }).state;
  assert.equal(discarded.sides.FRONT.cornerShape, 'SQUARE');
  assert.deepEqual(discarded.sides.FRONT.findings, state.sides.FRONT.findings);
  assert.ok(discarded.sides.FRONT.findingRevision > next.sides.FRONT.findingRevision);
});

test('defect actions only import the existing pure grading-core contracts and never old orchestration', () => {
  const source = readFileSync(new URL('../src/defect-actions.mjs', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/from ['"]([^'"]+)['"]/g)].map(match => match[1]);
  assert.ok(imports.length > 0 && imports.every(path => path.startsWith('@atlas/grading-core/')));
  assert.ok(!/atlas-operator|atlasWorkspace|sam3_detector|fetch\(/.test(source));
});
