import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { calculateSpeedsterReview } from '@atlas/grading-core/review';
import { previewAtlasReport } from '@atlas/grading-core/report';
import { measureSpeedsterCenteringBorders } from '@atlas/grading-core/scoring';
import { ATLAS_RULE_VERSION } from '@atlas/grading-core/atlas-policy';
import { gradingView, StaffReports } from '../lib/server/access/reports.mjs';
import { hash } from '../lib/server/policy.mjs';
import { canonical } from '../lib/server/review-contract.mjs';

const quad = [{ x: .04, y: .03 }, { x: .96, y: .03 }, { x: .96, y: .97 }, { x: .04, y: .97 }];
const now = new Date('2026-09-30T17:00:00.000Z');

function fixture(mode) {
    const cardId = randomUUID(), operationId = randomUUID(), evidenceHash = 'e'.repeat(64), policyHash = 'p'.repeat(64);
    const centeringBorders = measureSpeedsterCenteringBorders(quad);
    const { grade } = calculateSpeedsterReview({ front: { centeringBorders }, back: { centeringBorders } }, []);
    const source = { cardProfile: 'SPORTS', identity: { playerName: 'Synthetic Player', year: '2026', manufacturer: 'Fixture', productSet: 'Local test' },
        capture: { front: { centeringQuad: quad }, back: { centeringQuad: quad } }, reviewedDefects: [],
        gradeReport: { ...grade, detectorVersion: 'legacy-policy-fixture' } };
    const report = previewAtlasReport(source);
    assert.notEqual(report.ruleVersion, ATLAS_RULE_VERSION);
    const sourceCanonical = canonical(source), reportCanonical = canonical(report);
    const admissionCanonical = canonical({ purpose: 'atlas-analysis-admission-v1', mode, evidenceHash, sourceHash: hash(sourceCanonical), policyHash });
    const card = { id: cardId, analysisRevision: 1, draftRevision: 1, evidenceHash };
    const analysis = { specimenId: cardId, revision: 1, evidenceHash, mode, sourceCanonical, sourceHash: hash(sourceCanonical),
        reportCanonical, reportHash: hash(reportCanonical), admissionCanonical, admissionHash: hash(admissionCanonical) };
    const draft = { disposition: 'READY_FOR_HUMAN', identityReviewed: true, reviewedSides: ['FRONT', 'BACK'] };
    const reviewRow = { contentHash: 'a'.repeat(64) };
    const assignment = { canReview: true, fence: 1 };
    let writes = 0;
    const tx = {
        async $queryRaw(strings) {
            const sql = strings.join('?');
            if (sql.includes('"StaffSpecimen"')) return [card];
            if (sql.includes('operator_work_pending') || sql.includes('operator_proposals_pending')) return [{ count: 0 }];
            if (sql.includes('read_operator_proposals')) return [];
            throw Error(`Unexpected query: ${sql}`);
        },
        staffAnalysisRevision: { findUnique: async () => analysis },
        staffReviewRevision: { findUnique: async () => reviewRow },
        staffGradingOperation: { count: async () => 0, findMany: async () => [] },
        staffGradingBridgeControl: { findUnique: async () => ({ enabled: false }) },
        staffProposalDecision: { findMany: async () => [] },
        staffPublicReport: { findUnique: async () => null, create: async () => { writes++; throw Error('Must not publish'); } },
        staffReportApproval: { findUnique: async () => null, create: async () => { writes++; throw Error('Must not approve'); } },
    };
    const context = { tx, now, control: { mode, revision: 1, gradingPolicyHash: policyHash },
        identity: { id: randomUUID(), role: 'REVIEWER', certificationUntil: new Date(+now + 60_000) },
        session: { createdAt: new Date(+now - 60_000), tokenHash: 's'.repeat(64) } };
    const staff = {}, auth = { withStaff: async (actual, work) => { assert.equal(actual, staff); return work(context); } };
    const review = { assigned: async () => assignment, revisionRecord: () => draft };
    const input = { operationId, expectedAnalysisRevision: 1, analysisHash: analysis.sourceHash,
        expectedReviewRevision: 1, reviewHash: reviewRow.contentHash, evidenceHash };
    return { card, assignment, draft, context, staff, service: new StaffReports({ auth, review }), input, writes: () => writes };
}

test('production legacy report remains visible but cannot receive a new old-policy approval', async () => {
    const f = fixture('PRODUCTION');
    const view = await gradingView(f.context, f.card, f.assignment, f.draft);
    assert.notEqual(view.report.ruleVersion, ATLAS_RULE_VERSION);
    assert.equal(view.approvalBlock, 'GRADING_POLICY_CHANGED');
    await assert.rejects(f.service.approve(f.staff, f.card.id, f.input), { message: 'GRADING_POLICY_CHANGED' });
    assert.equal(f.writes(), 0);
});

test('local fixture can still review a historical report under its existing policy', async () => {
    const f = fixture('LOCAL_FIXTURE');
    const view = await gradingView(f.context, f.card, f.assignment, f.draft);
    assert.equal(view.approvalBlock, null);
});
