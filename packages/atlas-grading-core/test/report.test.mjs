import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { previewAtlasReport, finalizeAtlasReportContent, presentAtlasFindings } from '../dist/report.js';
import { calculateSpeedsterReview } from '../dist/review.js';
import { measureSpeedsterCenteringBorders } from '../dist/scoring.js';
const quad = [{ x: 0.04, y: 0.03 }, { x: 0.96, y: 0.03 }, { x: 0.96, y: 0.97 }, { x: 0.04, y: 0.97 }];
const finding = { id: 'FRONT:detector-1:SURFACE', side: 'FRONT', zone: 'SURFACE', defectType: 'LIGHT_SCRATCH_SCUFF',
  confidence: 0.9, canonicalContour: [{ x: 0.2, y: 0.2 }, { x: 0.3, y: 0.2 }, { x: 0.3, y: 0.3 }],
  sourceViewId: 'FRONT:DIRECTIONAL', supportingViewIds: ['FRONT:MICRO_DEFECT'], reviewResult: 'UNREVIEWED',
  measurement: { widthMm: 1, heightMm: 1, areaMm2: 1, zonePercent: 2, multiplier: 1, weightedAreaMm2: 1, subgradeEffect: 0 } };
function source() {
  const capture = { front: { centeringQuad: quad }, back: { centeringQuad: quad } };
  const centeringBorders = measureSpeedsterCenteringBorders(quad);
  const { grade } = calculateSpeedsterReview({ front: { centeringBorders }, back: { centeringBorders } }, [finding]);
  return { cardProfile: 'SPORTS', identity: { playerName: 'Synthetic Player', year: '2026', manufacturer: 'Fixture', productSet: 'Local test' },
    capture, reviewedDefects: [structuredClone(finding)], gradeReport: { ...grade, detectorVersion: 'synthetic-unit-fixture' } };
}
test('historical canonical modules moved byte-for-byte; no grading formula fork', () => {
  const manifest = JSON.parse(readFileSync(new URL('../extraction-manifest.json', import.meta.url)));
  for (const module of manifest.unchangedModules) {
    const filename = module.canonical.split('/').at(-1);
    assert.equal(createHash('sha256').update(readFileSync(new URL(`../src/${filename}`, import.meta.url))).digest('hex'), module.sha256);
  }
});
test('draft recalculates the existing rule and preserves unreviewed findings without approval', () => {
  const input = source(), report = previewAtlasReport(input);
  assert.deepEqual(report.grade, { front: input.gradeReport.front, back: input.gradeReport.back, subgrades: input.gradeReport.subgrades, overall: input.gradeReport.overall });
  assert.equal(report.findingCounts.unreviewed, 1); assert.equal(report.findings[0].reviewResult, 'UNREVIEWED');
  assert.equal(report.approval, undefined); assert.equal(report.certificate, undefined);
  assert.deepEqual(input.reviewedDefects, [finding]);
  assert.equal(presentAtlasFindings(report.findings, 'DRAFT').length, 1);
  assert.equal(presentAtlasFindings(report.findings, 'APPROVED').length, 0);
});
test('human-final content accepts remaining unreviewed findings without changing source or grade', () => {
  const input = source(), preview = previewAtlasReport(input), final = finalizeAtlasReportContent(input);
  assert.deepEqual(final.grade, preview.grade); assert.equal(final.findings[0].reviewResult, 'ACCEPTED');
  assert.equal(input.reviewedDefects[0].reviewResult, 'UNREVIEWED'); assert.equal(final.approval, undefined);
  assert.equal(presentAtlasFindings(final.findings, 'APPROVED').length, 1);
});
test('stored score, missing detection and invalid geometry cannot fabricate report validity', () => {
  const incorrect = source(); incorrect.gradeReport.overall.displayGrade = 10;
  assert.throws(() => previewAtlasReport(incorrect), /GRADE_MISMATCH/);
  const missing = source(); delete missing.gradeReport.detectorVersion;
  assert.throws(() => previewAtlasReport(missing), /DETECTION_REQUIRED/);
  const bad = source(); bad.capture.front.centeringQuad = [{ x: 0.1, y: 0.1 }];
  assert.throws(() => previewAtlasReport(bad));
  const duplicate = source(); duplicate.reviewedDefects.push(structuredClone(finding));
  assert.throws(() => previewAtlasReport(duplicate), /FINDING_ID_CONFLICT/);
});
test('presentation excludes Memory/internal fields and hidden states', () => {
  const report = finalizeAtlasReportContent(source());
  const privateFinding = { ...report.findings[0], memoryProposal: { exemplarSessionId: 'private-history' }, featureFingerprint: [1, 2],
    operatorNotes: 'private-staff-note', findingProvenance: { private: true }, measurement: { ...report.findings[0].measurement, private: 'detail' } };
  const visible = presentAtlasFindings([privateFinding, { ...privateFinding, id: 'removed', reviewResult: 'REMOVED' }], 'APPROVED');
  assert.equal(visible.length, 1); assert(!JSON.stringify(visible).includes('private'));
  assert.equal(visible[0].memoryProposal, undefined); assert.equal(visible[0].featureFingerprint, undefined);
  assert.throws(() => presentAtlasFindings([privateFinding], 'typo'), /VISIBILITY_INVALID/);
});
