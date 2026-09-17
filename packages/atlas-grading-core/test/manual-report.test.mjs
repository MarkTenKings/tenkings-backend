import test from 'node:test';
import assert from 'node:assert/strict';
import { previewAtlasManualReport } from '../dist/manual-report.js';
import { previewAtlasReport } from '../dist/report.js';
import { calculateSpeedsterReview } from '../dist/review.js';
import { measureSpeedsterCenteringBorders } from '../dist/scoring.js';

const quad = [{ x: .04, y: .03 }, { x: .96, y: .03 }, { x: .96, y: .97 }, { x: .04, y: .97 }];
const frontHash = 'a'.repeat(64), backHash = 'b'.repeat(64);
const finding = {
  id: 'FRONT:human-1:SURFACE', side: 'FRONT', zone: 'SURFACE', defectType: 'LIGHT_SCRATCH_SCUFF',
  confidence: .9, canonicalContour: [{ x: .2, y: .2 }, { x: .3, y: .2 }, { x: .3, y: .3 }],
  sourceViewId: 'FRONT:ORIGINAL', supportingViewIds: [], reviewResult: 'SMART_MARKED', origin: 'SMART_MARK',
  measurement: { widthMm: 1, heightMm: 1, areaMm2: 1, zonePercent: 2, multiplier: 1, weightedAreaMm2: 1, subgradeEffect: 0 },
};
function source() {
  return {
    cardProfile: 'SPORTS', identity: { playerName: 'Synthetic Player', year: '2026', manufacturer: 'Fixture', productSet: 'Local test' },
    draftRevision: 7,
    findingRevisions: { front: 3, back: 2 },
    capture: { front: { centeringQuad: structuredClone(quad), inspectionImageSha256: frontHash },
      back: { centeringQuad: structuredClone(quad), inspectionImageSha256: backHash } },
    reviewedDefects: [structuredClone(finding)],
    manualInspection: { method: 'HUMAN', front: { inspected: true, imageSha256: frontHash, findingRevision: 3 },
      back: { inspected: true, imageSha256: backHash, findingRevision: 2 } },
  };
}

test('manual content uses unchanged deterministic math without detector provenance or approval', () => {
  const input = source(), before = structuredClone(input), report = previewAtlasManualReport(input);
  const centeringBorders = measureSpeedsterCenteringBorders(quad);
  const { grade } = calculateSpeedsterReview({ front: { centeringBorders }, back: { centeringBorders } }, input.reviewedDefects);
  assert.deepEqual(report.grade, grade);
  assert.deepEqual(report.grade, previewAtlasReport({ ...input, gradeReport: { ...grade, detectorVersion: 'legacy-parity-fixture' } }).grade);
  assert.equal(report.inspection.method, 'HUMAN');
  assert.equal(report.findings[0].reviewResult, 'SMART_MARKED');
  for (const field of ['detectorVersion', 'approval', 'certificate', 'publishedLesson']) assert.equal(report[field], undefined);
  assert.deepEqual(input, before);
});

test('an empty result is not evidence of a human inspection', () => {
  const input = source(); input.reviewedDefects = [];
  delete input.manualInspection;
  assert.throws(() => previewAtlasManualReport(input), /INSPECTION_REQUIRED/);
  input.manualInspection = source().manualInspection;
  delete input.manualInspection.back;
  assert.throws(() => previewAtlasManualReport(input), /INSPECTION_REQUIRED/);
  input.manualInspection.back = { ...source().manualInspection.back, inspected: false };
  assert.throws(() => previewAtlasManualReport(input), /INSPECTION_REQUIRED/);
  input.manualInspection.back.inspected = true;
  const report = previewAtlasManualReport(input);
  assert.equal(report.findingCounts.total, 0);
  assert.equal(report.inspection.front.inspected, true);
  assert.equal(report.inspection.back.inspected, true);
  input.manualInspection.method = 'SAM';
  assert.throws(() => previewAtlasManualReport(input), /INSPECTION_REQUIRED/);
});

test('changed side findings, replaced photo and malformed hashes invalidate old inspection', () => {
  const input = source(); input.draftRevision += 1; input.findingRevisions.front += 1;
  assert.throws(() => previewAtlasManualReport(input), /INSPECTION_STALE/);
  input.manualInspection.front.findingRevision = input.findingRevisions.front;
  input.capture.front.inspectionImageSha256 = 'c'.repeat(64);
  assert.throws(() => previewAtlasManualReport(input), /INSPECTION_STALE/);
  input.capture.front.inspectionImageSha256 = frontHash;
  input.manualInspection.back.imageSha256 = frontHash;
  assert.throws(() => previewAtlasManualReport(input), /INSPECTION_STALE/);
  input.manualInspection.back.imageSha256 = backHash;
  input.capture.front.inspectionImageSha256 = 'bad';
  assert.throws(() => previewAtlasManualReport(input), /IMAGE_INVALID/);
});

test('draft report preserves reviewed, unreviewed and removed states without bulk acceptance', () => {
  const input = source();
  input.reviewedDefects.push({ ...structuredClone(finding), id: 'FRONT:proposal-2:SURFACE', reviewResult: 'UNREVIEWED', origin: 'DETECTOR' });
  const before = previewAtlasManualReport(input);
  assert.equal(before.findingCounts.unreviewed, 1);
  input.reviewedDefects[0].reviewResult = 'REMOVED'; input.draftRevision += 1; input.findingRevisions.front += 1;
  assert.throws(() => previewAtlasManualReport(input), /INSPECTION_STALE/);
  input.manualInspection.front.findingRevision = input.findingRevisions.front;
  const after = previewAtlasManualReport(input);
  assert.deepEqual(after.findingCounts, { total: 2, included: 1, removed: 1, unreviewed: 1 });
  assert.equal(after.findings[1].reviewResult, 'UNREVIEWED');
  assert.notDeepEqual(after.grade, before.grade);
});

test('identity and printed-border edits preserve both inspections; Front edits preserve Back', () => {
  const input = source(), original = previewAtlasManualReport(input);
  input.draftRevision += 1;
  input.identity.playerName = 'Corrected Player';
  input.capture.front.centeringQuad[0].x = .08;
  input.capture.front.centeringQuad[3].x = .08;
  const corrected = previewAtlasManualReport(input);
  assert.deepEqual(corrected.inspection, original.inspection);
  assert.notDeepEqual(corrected.grade, original.grade);
  assert.equal(corrected.identity.playerName, 'Corrected Player');
  input.reviewedDefects[0].defectType = 'VISIBLE_WHITENING';
  input.draftRevision += 1; input.findingRevisions.front += 1;
  assert.throws(() => previewAtlasManualReport(input), /INSPECTION_STALE/);
  input.manualInspection.front.findingRevision = input.findingRevisions.front;
  assert.deepEqual(previewAtlasManualReport(input).inspection.back, original.inspection.back);
  // Undo to byte-identical content is still a new edit with a new side revision.
  input.reviewedDefects[0].defectType = finding.defectType;
  input.draftRevision += 1; input.findingRevisions.front += 1;
  assert.throws(() => previewAtlasManualReport(input), /INSPECTION_STALE/);
});

test('unsupported category, invalid centering, duplicate IDs and invalid revisions cannot produce a draft', () => {
  const input = source(); input.cardProfile = 'OTHER';
  assert.throws(() => previewAtlasManualReport(input), /IDENTITY_INVALID/);
  input.cardProfile = 'SPORTS'; input.capture.front.centeringQuad = [{ x: 0, y: 0 }];
  assert.throws(() => previewAtlasManualReport(input));
  input.capture.front.centeringQuad = quad;
  input.reviewedDefects.push(structuredClone(finding));
  assert.throws(() => previewAtlasManualReport(input), /FINDING_ID_CONFLICT/);
  input.reviewedDefects.pop();
  for (const revision of [0, -1, 1.5, NaN, Infinity, '7', Number.MAX_SAFE_INTEGER + 1]) {
    input.draftRevision = revision;
    assert.throws(() => previewAtlasManualReport(input), /REVISION_INVALID/);
  }
});

test('manual path preserves the existing rejection of unmeasurable borderless centering', () => {
  const input = source();
  input.capture.front.centeringQuad = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  assert.throws(() => previewAtlasManualReport(input), /positive total/);
});
