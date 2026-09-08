import { randomUUID } from 'node:crypto';
import { speedsterReviewPostSchema } from '@atlas/grading-core/review-action-contract';
import { findSpeedsterPersistedTrace, parsePersistedSpeedsterReviewFindings } from '@atlas/grading-core/review-findings';
import { decodeSpeedsterTraceRleV1 } from '@atlas/grading-core/trace-codec';
import { encodeSpeedsterTraceBitmapWireV1 } from '@atlas/grading-core/trace-bitmap-wire';
import { parsePilotPolicy } from '@atlas/service-bridge/protocol';
import { deny, hash, identifier, strictObject } from '../policy.mjs';
import { canonical } from '../review-contract.mjs';
import { loadAnalysis } from './reports.mjs';
import { operatorPending } from './operator.mjs';

export function bridgeScope(context, card, assignment) {
    return { controlRevision: context.control.revision, specimenId: card.id, actorId: context.identity.id,
        sessionHash: context.session.tokenHash, assignmentFence: assignment.fence, evidenceHash: card.evidenceHash };
}
export function operationReceipt(op) {
    return { id: op.id, operationId: op.operationId, state: op.state, analysisRevision: op.resultAnalysisRevision,
        failureCode: op.failureCode, createdAt: op.createdAt.toISOString() };
}
export class StaffGrading {
    constructor({ auth, review, bridge }) { this.auth = auth; this.review = review; this.bridge = bridge; }
    async run(staff, cardId, input) {
        strictObject(input, ['operationId', 'expectedAnalysisRevision', 'analysisHash', 'expectedReviewRevision', 'reviewHash', 'evidenceHash', 'action']);
        identifier(input.operationId);
        if (!Number.isSafeInteger(input.expectedAnalysisRevision) || input.expectedAnalysisRevision < 0
            || !Number.isSafeInteger(input.expectedReviewRevision) || input.expectedReviewRevision < 1
            || ![input.reviewHash, input.evidenceHash].every(v => /^[a-f0-9]{64}$/.test(v ?? ''))
            || !(input.analysisHash === null && input.expectedAnalysisRevision === 0 || /^[a-f0-9]{64}$/.test(input.analysisHash ?? '')))
            deny(400, 'INVALID_REQUEST');
        const parsed = speedsterReviewPostSchema.safeParse({ action: input.action });
        if (!parsed.success) deny(400, 'INVALID_GRADING_ACTION');
        const claimed = await this.auth.withStaff(staff, async context => {
            const { tx, identity, session, control, now } = context;
            const assignment = await this.review.assigned(context, cardId);
            if (identity.role !== 'REVIEWER' || !assignment.canReview) deny(403, 'REVIEW_PERMISSION_REQUIRED');
            const [card] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffSpecimen" WHERE id=${cardId}::uuid FOR UPDATE`;
            if (!card) deny(404, 'CARD_NOT_FOUND');
            const prior = await tx.staffGradingOperation.findUnique({ where: { specimenId_operationId: { specimenId: cardId, operationId: input.operationId } } });
            if (prior) {
                if (prior.actorKind !== 'HUMAN' || prior.actorId !== identity.id
                    || canonical(JSON.parse(prior.requestCanonical).request) !== canonical(input)) deny(409, 'REQUEST_CONFLICT');
                return { op: prior, dispatch: false };
            }
            const bridgeControl = await tx.staffGradingBridgeControl.findUnique({ where: { id: 'active' } });
            if (!this.bridge || !bridgeControl?.enabled || bridgeControl.mode !== control.mode
                || bridgeControl.origin !== this.bridge.binding.origin || bridgeControl.clientKeyHash !== this.bridge.binding.clientKeyHash
                || bridgeControl.gradingPolicyHash !== control.gradingPolicyHash
                || hash(bridgeControl.policyCanonical) !== bridgeControl.policyHash) deny(503, 'GRADING_NOT_ENABLED');
            let policy; try { policy = parsePilotPolicy(JSON.parse(bridgeControl.policyCanonical)); } catch { deny(503, 'GRADING_NOT_ENABLED'); }
            if (!policy.specimenIds.includes(cardId) || +new Date(policy.expiresAt) <= +now) deny(409, 'PILOT_NOT_ACTIVE');
            const analysis = await loadAnalysis(context, card);
            const draft = await tx.staffReviewRevision.findUnique({ where: { specimenId_revision: { specimenId: cardId, revision: card.draftRevision } } });
            if (input.evidenceHash !== card.evidenceHash) deny(409, 'EVIDENCE_CHANGED');
            if (input.expectedAnalysisRevision !== card.analysisRevision || input.analysisHash !== (analysis?.row.sourceHash ?? null)
                || input.expectedReviewRevision !== card.draftRevision || input.reviewHash !== draft.contentHash) deny(409, 'DRAFT_CHANGED');
            if ((parsed.data.action.type === 'INITIALIZE') !== (card.analysisRevision === 0)) deny(409, 'INVALID_GRADING_TRANSITION');
            if (await tx.staffGradingOperation.count({ where: { specimenId: cardId, state: { in: ['RESERVED', 'DISPATCHED', 'UNKNOWN'] } } })
                || await operatorPending(tx,cardId))
                deny(409, 'GRADING_WORK_UNRESOLVED');
            const evidence = this.review.evidenceRecord(card);
            if (!evidence.sides.FRONT || !evidence.sides.BACK) deny(409, 'EVIDENCE_REQUIRED');
            const requestCanonical = canonical({ version: 'atlas-review-operation-v1', request: input,
                sourceId: card.sourceId, sourceOwnerId: card.sourceOwnerId,
                sourceRevision: analysis?.row.sourceRevision ?? evidence.sourceRevision,
                accessVersion: identity.accessVersion, policyHash: bridgeControl.gradingPolicyHash, bridgePolicyHash: bridgeControl.policyHash });
            const op = await tx.staffGradingOperation.create({ data: { id: randomUUID(), specimenId: cardId,
                operationId: input.operationId, actorKind: 'HUMAN', actorId: identity.id, sessionHash: session.tokenHash,
                assignmentFence: assignment.fence, controlRevision: control.revision, evidenceHash: card.evidenceHash,
                expectedAnalysisRevision: card.analysisRevision, expectedReviewRevision: card.draftRevision,
                requestCanonical, inputHash: hash(requestCanonical), state: 'RESERVED', dispatchClaimId: randomUUID(),
                leaseFence: 1, leaseExpiresAt: new Date(+now + 240_000), createdAt: now } });
            const dispatched = await tx.staffGradingOperation.update({ where: { id: op.id }, data: { state: 'DISPATCHED', dispatchedAt: now } });
            await this.auth.audit(tx, 'GRADING_DISPATCH_RESERVED', cardId, identity.id, { operationId: op.id, action: parsed.data.action.type, policyHash: bridgeControl.policyHash });
            return { op: dispatched, scope: bridgeScope(context, card, assignment), dispatch: true };
        });
        if (claimed.dispatch) {
            try { await this.bridge.call(claimed.scope, { action: 'RUN_REVIEW', operationId: claimed.op.id }); }
            catch {
                // A lost reply cannot authorize another call. The adapter may
                // already have committed; only mark a still-dispatched row.
                await this.auth.withStaff(staff, async ({ tx, now }) => {
                    const op = await tx.staffGradingOperation.findUnique({ where: { id: claimed.op.id } });
                    if (op?.state === 'DISPATCHED') await tx.staffGradingOperation.update({ where: { id: op.id }, data: { state: 'UNKNOWN', failureCode: 'BRIDGE_OUTCOME_UNCONFIRMED' } });
                });
            }
        }
        return this.status(staff, cardId, claimed.op.id);
    }
    async status(staff, cardId, operationId) {
        if (!/^[a-f0-9-]{36}$/.test(operationId ?? '')) deny(400, 'INVALID_REQUEST');
        return this.auth.withStaff(staff, async context => {
            const assignment = await this.review.assigned(context, cardId);
            const op = await context.tx.staffGradingOperation.findUnique({ where: { id: operationId } });
            if (!op || op.specimenId !== cardId) deny(404, 'OPERATION_NOT_FOUND');
            const card = await context.tx.staffSpecimen.findUnique({ where: { id: cardId } });
            return { operation: operationReceipt(op), card: await this.review.view(context, card, assignment) };
        });
    }
    async trace(staff, cardId, input) {
        strictObject(input, ['findingId', 'analysisRevision', 'analysisHash']);
        if (typeof input.findingId !== 'string' || input.findingId.length < 1 || input.findingId.length > 180) deny(400, 'INVALID_REQUEST');
        return this.auth.withStaff(staff, async context => {
            await this.review.assigned(context, cardId);
            const card = await context.tx.staffSpecimen.findUnique({ where: { id: cardId } });
            if (!card) deny(404, 'CARD_NOT_FOUND');
            const analysis = await loadAnalysis(context, card);
            if (!analysis || input.analysisRevision !== analysis.row.revision || input.analysisHash !== analysis.row.sourceHash) deny(409, 'DRAFT_CHANGED');
            const findings = parsePersistedSpeedsterReviewFindings(analysis.source.reviewedDefects);
            const trace = findSpeedsterPersistedTrace(findings, input.findingId);
            if (!trace) deny(404, 'TRACE_NOT_FOUND');
            return { traceWire: encodeSpeedsterTraceBitmapWireV1(decodeSpeedsterTraceRleV1(trace), trace.sha256),
                traceProvenance: findings.find(f => f.id === input.findingId)?.traceProvenance ?? null,
                analysisRevision: analysis.row.revision, analysisHash: analysis.row.sourceHash };
        });
    }
}
