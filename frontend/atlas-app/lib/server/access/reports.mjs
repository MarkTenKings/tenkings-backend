import { randomBytes, randomUUID } from 'node:crypto';
import { parsePublicReport } from '@atlas/report-view/public-contract';
import { previewAtlasReport, finalizeAtlasReportContent, presentAtlasFindings } from '@atlas/grading-core/report';
import { deny, hash, identifier, strictObject } from '../policy.mjs';
import { canonical } from '../review-contract.mjs';
import { operatorPending } from './operator.mjs';

const controlPublicOrigin = mode => mode === 'PRODUCTION' ? 'https://atlasgrading.com' : 'http://127.0.0.1:4319';
function checkedJSON(text, digest, failure = 'REPORT_UNAVAILABLE') {
    if (hash(text) !== digest) deny(503, failure);
    let value; try { value = JSON.parse(text); } catch { deny(503, failure); }
    if (canonical(value) !== text) deny(503, failure);
    return value;
}
export async function loadAnalysis(context, card) {
    if (!card.analysisRevision) return null;
    const row = await context.tx.staffAnalysisRevision.findUnique({ where: { specimenId_revision: { specimenId: card.id, revision: card.analysisRevision } } });
    if (!row || row.evidenceHash !== card.evidenceHash || row.mode !== context.control.mode) deny(503, 'REPORT_UNAVAILABLE');
    const source = checkedJSON(row.sourceCanonical, row.sourceHash);
    const report = checkedJSON(row.reportCanonical, row.reportHash);
    const admission = checkedJSON(row.admissionCanonical, row.admissionHash);
    if (canonical(previewAtlasReport(source)) !== row.reportCanonical || admission.purpose !== 'atlas-analysis-admission-v1'
        || admission.evidenceHash !== card.evidenceHash || admission.sourceHash !== row.sourceHash || admission.mode !== row.mode)
        deny(503, 'REPORT_UNAVAILABLE');
    return { row, source, report, admission };
}
function projectedReport(report, visibility) {
    return { version: report.version, ruleVersion: report.ruleVersion, cardProfile: report.cardProfile,
        identity: report.identity, detectorVersion: report.detectorVersion, grade: report.grade,
        findings: presentAtlasFindings(report.findings, visibility),
        findingCounts: visibility === 'DRAFT' ? report.findingCounts : { included: report.findingCounts.included } };
}
function approvalBlock(context, card, assignment, draft, analysis, pending) {
    if (!analysis) return 'GRADING_NOT_READY';
    if (pending) return 'GRADING_WORK_UNRESOLVED';
    if (!context.control.gradingPolicyHash || analysis.admission.policyHash !== context.control.gradingPolicyHash) return 'GRADING_POLICY_CHANGED';
    if (context.identity.role !== 'REVIEWER' || !assignment.canReview || !context.identity.certificationUntil
        || context.identity.certificationUntil <= context.now) return 'TRAINED_REVIEWER_REQUIRED';
    if (+context.session.createdAt + 15 * 60_000 <= +context.now) return 'FRESH_SIGN_IN_REQUIRED';
    if (draft.disposition !== 'READY_FOR_HUMAN' || !draft.identityReviewed || draft.reviewedSides.length !== 2) return 'REVIEW_CHECKLIST_REQUIRED';
    return null;
}
export async function gradingView(context, card, assignment, draft) {
    const analysis = await loadAnalysis(context, card);
    const pending = await context.tx.staffGradingOperation.count({ where: { specimenId: card.id, state: { in: ['RESERVED', 'DISPATCHED', 'UNKNOWN'] } } })
        + await operatorPending(context.tx,card.id);
    const publication = await context.tx.staffPublicReport.findUnique({ where: { specimenId: card.id } });
    const approval = publication ? await context.tx.staffReportApproval.findUnique({ where: { id: publication.currentApprovalId } }) : null;
    const matchesCurrent = Boolean(approval && approval.analysisRevision === card.analysisRevision && approval.reviewRevision === card.draftRevision
        && approval.evidenceHash === card.evidenceHash);
    const bridge = await context.tx.staffGradingBridgeControl.findUnique({ where: { id: 'active' } });
    const operations = await context.tx.staffGradingOperation.findMany({ where: { specimenId: card.id }, orderBy: { createdAt: 'desc' }, take: 5 });
    return { analysisRevision: analysis?.row.revision ?? 0, analysisHash: analysis?.row.sourceHash ?? null,
        reportHash: analysis?.row.reportHash ?? null, report: matchesCurrent ? checkedJSON(approval.publicCanonical, approval.publicHash).report : analysis ? projectedReport(analysis.report, 'DRAFT') : null,
        reviewFindings: analysis ? presentAtlasFindings(analysis.report.findings, 'DRAFT') : [],
        cornerShape: analysis?.source.capture?.cornerShape ?? null,
        mode: analysis?.row.mode ?? null, pendingOperations: pending,
        correctionsEnabled: Boolean(bridge?.enabled && bridge.mode === context.control.mode && bridge.gradingPolicyHash === context.control.gradingPolicyHash),
        operations: operations.map(op => ({ id: op.id, state: op.state, failureCode: op.failureCode, createdAt: op.createdAt.toISOString() })),
        approvalBlock: matchesCurrent ? 'ALREADY_APPROVED' : approvalBlock(context, card, assignment, draft, analysis, pending),
        published: approval ? { approvalId: approval.id, version: approval.version, publicToken: publication.publicToken,
            reportNumber: publication.reportNumber, approvedAt: approval.approvedAt.toISOString(), matchesCurrent,
            path: `/reports/${publication.publicToken}?v=${approval.version}`,
            href: `${controlPublicOrigin(context.control.mode)}/reports/${publication.publicToken}?v=${approval.version}` } : null };
}

export class StaffReports {
    constructor({ auth, review }) { this.auth = auth; this.review = review; }
    receipt(approval) {
        const published = checkedJSON(approval.publicCanonical, approval.publicHash);
        return { approvalId: approval.id, version: approval.version, analysisHash: approval.analysisHash, reviewHash: approval.reviewHash,
            publicHash: approval.publicHash, approvedAt: approval.approvedAt.toISOString(), path: `/reports/${published.publicToken}?v=${approval.version}` };
    }
    async approve(staff, cardId, input) {
        strictObject(input, ['operationId', 'expectedAnalysisRevision', 'analysisHash', 'expectedReviewRevision', 'reviewHash', 'evidenceHash']);
        identifier(input.operationId);
        if (!['expectedAnalysisRevision', 'expectedReviewRevision'].every(k => Number.isSafeInteger(input[k]) && input[k] > 0)
            || !['analysisHash', 'reviewHash', 'evidenceHash'].every(k => typeof input[k] === 'string' && /^[a-f0-9]{64}$/.test(input[k]))) deny(400, 'INVALID_REQUEST');
        return this.auth.withStaff(staff, async context => {
            const { tx, identity, session, now, control } = context;
            const assignment = await this.review.assigned(context, cardId);
            const rows = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffSpecimen" WHERE id=${cardId}::uuid FOR UPDATE`;
            const card = rows[0]; if (!card) deny(404, 'CARD_NOT_FOUND');
            const inputHash = hash(canonical({ cardId, input }));
            const prior = await tx.staffReportApproval.findUnique({ where: { actorId_operationId: { actorId: identity.id, operationId: input.operationId } } });
            if (prior) {
                if (prior.inputHash !== inputHash || prior.specimenId !== cardId) deny(409, 'REQUEST_CONFLICT');
                return { card: await this.review.view(context, card, assignment), approval: this.receipt(prior) };
            }
            const analysis = await loadAnalysis(context, card);
            const reviewRow = await tx.staffReviewRevision.findUnique({ where: { specimenId_revision: { specimenId: cardId, revision: card.draftRevision } } });
            const draft = this.review.revisionRecord(reviewRow);
            if (card.evidenceHash !== input.evidenceHash) deny(409, 'EVIDENCE_CHANGED');
            if (!analysis || analysis.row.revision !== input.expectedAnalysisRevision || analysis.row.sourceHash !== input.analysisHash
                || card.draftRevision !== input.expectedReviewRevision || reviewRow.contentHash !== input.reviewHash) deny(409, 'DRAFT_CHANGED');
            const pending = await tx.staffGradingOperation.count({ where: { specimenId: cardId, state: { in: ['RESERVED', 'DISPATCHED', 'UNKNOWN'] } } })
                + await operatorPending(tx,cardId);
            const blocked = approvalBlock(context, card, assignment, draft, analysis, pending);
            if (blocked) deny(409, blocked);
            const existing = await tx.staffPublicReport.findUnique({ where: { specimenId: cardId } });
            const previous = existing ? await tx.staffReportApproval.findUnique({ where: { id: existing.currentApprovalId } }) : null;
            if (previous?.analysisRevision === card.analysisRevision && previous.reviewRevision === card.draftRevision)
                deny(409, 'ALREADY_APPROVED');
            const version = previous ? previous.version + 1 : 1;
            const publicToken = existing?.publicToken ?? `ar_${randomBytes(18).toString('base64url')}`;
            const reportNumber = existing?.reportNumber ?? `ATLAS-${randomBytes(6).toString('hex').toUpperCase()}`;
            const final = finalizeAtlasReportContent(analysis.source);
            const descriptors = this.review.evidenceRecord(card).sides;
            const images = Object.fromEntries(['FRONT', 'BACK'].map(side => {
                const { sourceRef, ...metadata } = descriptors[side]; return [side, metadata];
            }));
            const published = { version: 'atlas-public-report-v1', publicToken, reportNumber, approvalVersion: version,
                approvedAt: now.toISOString(), mode: analysis.row.mode, evidenceHash: card.evidenceHash, analysisHash: analysis.row.sourceHash,
                report: projectedReport(final, 'APPROVED'), images };
            const publicCanonical = canonical(parsePublicReport(published)), approvalId = randomUUID();
            const approval = await tx.staffReportApproval.create({ data: { id: approvalId, specimenId: cardId, version,
                analysisRevision: card.analysisRevision, reviewRevision: card.draftRevision, evidenceHash: card.evidenceHash,
                analysisHash: analysis.row.sourceHash, reviewHash: reviewRow.contentHash, publicCanonical, publicHash: hash(publicCanonical),
                actorId: identity.id, sessionHash: session.tokenHash, accessVersion: identity.accessVersion, assignmentFence: assignment.fence,
                controlRevision: control.revision, operationId: input.operationId, inputHash, approvedAt: now } });
            for (const side of ['FRONT', 'BACK']) {
                const descriptorCanonical = canonical(descriptors[side]);
                await tx.staffApprovedImage.create({ data: { approvalId, side, descriptorCanonical, descriptorHash: hash(descriptorCanonical) } });
            }
            if (existing) await tx.staffPublicReport.update({ where: { specimenId: cardId }, data: { currentApprovalId: approvalId } });
            else await tx.staffPublicReport.create({ data: { specimenId: cardId, publicToken, reportNumber, currentApprovalId: approvalId, createdAt: now } });
            await this.auth.audit(tx, 'ATLAS_REPORT_APPROVED', cardId, identity.id, { approvalId, version,
                analysisRevision: card.analysisRevision, reviewRevision: card.draftRevision, publicHash: hash(publicCanonical), assignmentFence: assignment.fence });
            return { card: await this.review.view(context, card, assignment), approval: this.receipt(approval) };
        });
    }
}
