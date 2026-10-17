import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parsePublicManualReport } from '../src/manual-public-contract.mjs';
import { explainAtlasManualReport } from '@atlas/grading-core/manual-report';

const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Synthetic saved packet captured through the parser before whole-number
// policy support. Field order is part of the persisted public hash.
function historicalPacket() {
  const side = () => ({ centering: { score: 8.8, leftRightBalance: [61,39], topBottomBalance: [50,50] },
    corners: { score: 10, weightedDamagePercent: 0 }, edges: { score: 10, weightedDamagePercent: 0 },
    surface: { score: 10, weightedDamagePercent: 0 } });
  const image = sha256 => ({ sha256, byteCount: 100, width: 1350, height: 1858, contentType: 'image/webp' });
  const geometry = () => ({ physicalQuad: [{ x:0,y:0 },{ x:1,y:0 },{ x:1,y:1 },{ x:0,y:1 }],
    printedQuad: [{ x:.061,y:.03 },{ x:.961,y:.03 },{ x:.961,y:.97 },{ x:.061,y:.97 }] });
  return { version: 'atlas-public-manual-report-v2', publicToken: `ar_${'A'.repeat(24)}`, reportNumber: 'ATLAS-AABBCCDDEEFF',
    approvalVersion: 1, approvedAt: '2026-10-01T00:00:00.000Z', mode: 'LOCAL_FIXTURE',
    reportHash: 'd9af800cc554d43562811cfa113700916af4f1bab9dbcd37ccefe13db750f15f',
    report: { version: 'atlas-manual-draft-report-v2', ruleVersion: 'ATLAS_2026_10_13_CATEGORY_DAMAGE_V1', cardProfile: 'SPORTS',
      identity: { playerName: 'Synthetic', year: '2026', manufacturer: 'Fixture', productSet: 'Report explanation',
        parallel: null, insert: null, cardNumber: null }, draftRevision: 7,
      inspection: { method: 'HUMAN', front: { inspected: true, imageSha256: 'a'.repeat(64), findingRevision: 3 },
        back: { inspected: true, imageSha256: 'b'.repeat(64), findingRevision: 2 } },
      grade: { front: side(), back: side(), subgrades: { centering: 8.8, corners: 10, edges: 10, surface: 10 },
        overall: { displayGrade: 9.7, rawGrade: 9.7 } },
      finalGrade: 9.5, finalGradePolicy: 'atlas-final-half-point-v1', findings: [],
      findingCounts: { total: 0, included: 0, removed: 0, unreviewed: 0 } },
    images: { FRONT: image('a'.repeat(64)), BACK: image('b'.repeat(64)) }, geometry: { FRONT: geometry(), BACK: geometry() } };
}

test('historical half-point public parsing preserves exact packet bytes, hash and saved explanation', () => {
  const packet = historicalPacket(), bytes = JSON.stringify(packet);
  const historicalHash = '70d1a74aa39aaabd23df186d4a77ba1fd037980327cfd3d0dbe06ca6c6d8b430';
  assert.equal(sha(packet), historicalHash);
  const parsed = parsePublicManualReport(packet);
  assert.equal(JSON.stringify(parsed), bytes); assert.equal(sha(parsed), historicalHash);
  const explanation = explainAtlasManualReport(parsed.report);
  assert.equal(explanation.overall.finalGrade, 9.5);
  assert.equal(explanation.policy.finalGradePolicy, 'atlas-final-half-point-v1');
  assert.match(explanation.policy.finalGradeFormula, /nearest 0\.5; exact quarter-point/);
  assert.equal(JSON.stringify(packet), bytes); assert.equal(sha(parsed), historicalHash);
});

test('whole-number public packet preserves its own bytes and hash and verifies under its recorded policy', () => {
  const packet = historicalPacket();
  Object.assign(packet, { publicToken: `ar_${'B'.repeat(24)}`, approvalVersion: 2, approvedAt: '2026-10-17T00:00:00.000Z' });
  Object.assign(packet.report, { finalGrade: 10, finalGradePolicy: 'atlas-final-whole-point-v1' });
  packet.reportHash = sha(packet.report);
  const bytes = JSON.stringify(packet), publicHash = sha(packet), parsed = parsePublicManualReport(packet);
  assert.equal(JSON.stringify(parsed), bytes); assert.equal(sha(parsed), publicHash);
  const explanation = explainAtlasManualReport(parsed.report);
  assert.equal(explanation.overall.rawGrade, 9.7); assert.equal(explanation.overall.displayGrade, 9.7);
  assert.equal(explanation.overall.finalGrade, 10);
  assert.equal(explanation.policy.finalGradePolicy, 'atlas-final-whole-point-v1');
  assert.match(explanation.policy.finalGradeFormula, /nearest whole number/);
  assert.equal(sha(parsed), publicHash);
});

test('public policy dispatch rejects unknown rules, fractional new awards and substituted rounding', () => {
  for (const modify of [r => { r.finalGradePolicy = 'unknown'; },
    r => { r.finalGradePolicy = 'atlas-final-whole-point-v1'; },
    r => { r.finalGrade = 10; },
    r => { r.finalGradePolicy = 'atlas-final-whole-point-v1'; r.finalGrade = 9; },
    r => { r.finalGradePolicy = 'atlas-final-whole-point-v1'; r.finalGrade = 0; r.grade.overall.rawGrade = 0; },
    r => { r.finalGradePolicy = 'atlas-final-whole-point-v1'; r.finalGrade = 1; r.grade.overall.rawGrade = .99; },
    r => { r.finalGradePolicy = 'atlas-final-whole-point-v1'; r.finalGrade = 10; r.grade.overall.rawGrade = 10.0001; },
    r => { r.finalGradePolicy = 'atlas-final-whole-point-v1'; r.finalGrade = 10; r.grade.overall.rawGrade = NaN; }]) {
    const packet = historicalPacket(); modify(packet.report);
    assert.throws(() => parsePublicManualReport(packet));
  }
  for (const [raw, award] of [[1,1], [8.35,8], [8.45,8], [8.499999999999998,8], [8.5,9], [9.49,9], [9.5,10], [10,10]]) {
    const packet = historicalPacket(); Object.assign(packet.report, { finalGradePolicy: 'atlas-final-whole-point-v1', finalGrade: award });
    packet.report.grade.overall.rawGrade = raw;
    assert.equal(parsePublicManualReport(packet).report.finalGrade, award);
  }
  // Parser admission for historical half-point data is deliberately unchanged;
  // independent report explanation still proves authoritative scoring math.
  const legacyBoundary = historicalPacket(); legacyBoundary.report.finalGrade = 0; legacyBoundary.report.grade.overall.rawGrade = 0;
  assert.equal(parsePublicManualReport(legacyBoundary).report.finalGrade, 0);
});
