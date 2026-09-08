import { previewAtlasReport } from '@atlas/grading-core/report';
import { calculateSpeedsterReview } from '@atlas/grading-core/review';
import { measureSpeedsterCenteringBorders } from '@atlas/grading-core/scoring';
import { canonical } from '../review-contract.mjs';
import { hash } from '../policy.mjs';
export const FIXTURE_GRADING_POLICY = hash('ATLAS synthetic workflow test; no photographs, detection or Astra run');

export function fixtureAnalysis(card, evidenceHash) {
    const centeringQuad = [{ x: 0.04, y: 0.03 }, { x: 0.96, y: 0.03 }, { x: 0.96, y: 0.97 }, { x: 0.04, y: 0.97 }];
    const centeringBorders = measureSpeedsterCenteringBorders(centeringQuad);
    const findings = [{ id: 'FRONT:fixture-1:SURFACE', side: 'FRONT', zone: 'SURFACE', defectType: 'LIGHT_SCRATCH_SCUFF',
        confidence: 0.9, canonicalContour: [{ x: 0.2, y: 0.2 }, { x: 0.3, y: 0.2 }, { x: 0.3, y: 0.3 }],
        sourceViewId: 'FRONT:NORMALIZED', supportingViewIds: ['FRONT:ORIGINAL'], reviewResult: 'UNREVIEWED',
        measurement: { widthMm: 1, heightMm: 1, areaMm2: 1, zonePercent: 2, multiplier: 1, weightedAreaMm2: 1, subgradeEffect: 0 } }];
    const { grade } = calculateSpeedsterReview({ front: { centeringBorders }, back: { centeringBorders } }, findings);
    const source = { cardProfile: 'SPORTS', identity: { playerName: card.title, year: '2026', manufacturer: 'Synthetic illustration', productSet: card.set },
        capture: { front: { centeringQuad }, back: { centeringQuad } }, reviewedDefects: findings,
        gradeReport: { ...grade, detectorVersion: 'SYNTHETIC_NO_DETECTION_OR_ASTRA' } };
    const sourceCanonical = canonical(source), sourceHash = hash(sourceCanonical), reportCanonical = canonical(previewAtlasReport(source));
    const admissionCanonical = canonical({ purpose: 'atlas-analysis-admission-v1', mode: 'LOCAL_FIXTURE', evidenceHash,
        sourceHash, policyHash: FIXTURE_GRADING_POLICY, synthetic: true });
    return { revision: 1, evidenceHash, sourceCanonical, sourceHash, reportCanonical, reportHash: hash(reportCanonical),
        admissionCanonical, admissionHash: hash(admissionCanonical), sourceRevision: 'local-illustration-v1', mode: 'LOCAL_FIXTURE' };
}
