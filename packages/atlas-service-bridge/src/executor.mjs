import { randomUUID } from 'node:crypto';
import { previewAtlasReport } from '@atlas/grading-core/report';
import { speedsterReviewPostSchema } from '@atlas/grading-core/review-action-contract';
import { canonical, digest, parsePilotPolicy, requireBridge } from './protocol.mjs';

const activeStates = ['DISPATCHED', 'UNKNOWN'];
function checked(text, expected) {
    requireBridge(typeof text === 'string' && digest(text) === expected, 'BRIDGE_STORED_EVIDENCE_INVALID');
    const value = JSON.parse(text); requireBridge(canonical(value) === text, 'BRIDGE_STORED_EVIDENCE_INVALID'); return value;
}

/** Private legacy-side adapter. Ports retain the complete existing grading
 * service. No staff HTTP handler, admin cookie or arbitrary provider tool. */
export class ScopedGradingBridge {
    constructor({ client, config, ports }) { this.client = client; this.config = config; this.ports = ports; }
    async transaction(work) {
        return this.client.$transaction(async tx => {
            const result = await work(tx); await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`; return result;
        }, { maxWait: 5000, timeout: 10_000 });
    }
    async authorize(tx, claims) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1', 0))`;
        const [bridge] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffGradingBridgeControl" WHERE id='active' FOR SHARE`;
        const [control] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffControl" WHERE id='active' FOR SHARE`;
        const [{ now }] = await tx.$queryRaw`SELECT clock_timestamp() AS now`;
        requireBridge(bridge?.enabled && bridge.mode === this.config.mode && bridge.origin === this.config.origin
            && bridge.deploymentId === this.config.deploymentId && bridge.releaseSha === this.config.releaseSha
            && bridge.configHash === this.config.configHash && bridge.clientKeyHash === this.config.clientKeyHash
            && bridge.gradingPolicyHash === this.config.gradingPolicyHash,
        'BRIDGE_NOT_ENABLED');
        const policy = parsePilotPolicy(checked(bridge.policyCanonical, bridge.policyHash));
        requireBridge(control?.enabled && control.mode === bridge.mode && control.revision === claims.controlRevision
            && control.deploymentId === claims.deploymentId && control.releaseSha === claims.releaseSha,
        'STAFF_ACCESS_NOT_ENABLED');
        const [identity] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffIdentity" WHERE id=${claims.actorId}::uuid FOR SHARE`;
        const [session] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffSession" WHERE "tokenHash"=${claims.sessionHash} FOR SHARE`;
        const browsers = session ? await tx.$queryRaw`SELECT * FROM atlas_staff."StaffBrowser" WHERE "tokenHash"=${session.browserHash} FOR SHARE` : [];
        const browser = browsers[0];
        const [assignment] = await tx.$queryRaw`SELECT * FROM atlas_staff.lock_assignment(${claims.specimenId}::uuid,${claims.actorId}::uuid)`;
        const [card] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffSpecimen" WHERE id=${claims.specimenId}::uuid FOR UPDATE`;
        requireBridge(identity && !identity.revokedAt && session?.identityId === identity.id && !session.revokedAt
            && session.accessVersion === identity.accessVersion && session.controlRevision === control.revision
            && +session.expiresAt > +now && browser?.controlRevision === control.revision && +browser.expiresAt > +now
            && assignment && !assignment.revokedAt && assignment.fence === claims.assignmentFence && +assignment.expiresAt > +now
            && card?.evidenceHash === claims.evidenceHash && card.sourceType === (bridge.mode === 'PRODUCTION' ? 'SPEEDSTER' : 'LOCAL_FIXTURE'),
        'BRIDGE_SCOPE_REVOKED');
        return { tx, now, bridge, control, policy, identity, session, assignment, card };
    }
    async operation(context, operationId, { committing = false } = {}) {
        const { tx, card, identity, session, assignment, control, bridge, now } = context;
        const [op] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffGradingOperation" WHERE id=${operationId}::uuid FOR UPDATE`;
        requireBridge(op?.specimenId === card.id && op.actorKind === 'HUMAN' && op.actorId === identity.id
            && op.sessionHash === session.tokenHash && op.assignmentFence === assignment.fence
            && op.controlRevision === control.revision && op.evidenceHash === card.evidenceHash,
        'GRADING_OPERATION_SCOPE_INVALID');
        const request = checked(op.requestCanonical, op.inputHash);
        requireBridge(speedsterReviewPostSchema.safeParse({ action: request.request?.action }).success, 'GRADING_ACTION_INVALID');
        requireBridge(request.version === 'atlas-review-operation-v1' && request.sourceId === card.sourceId
            && request.sourceOwnerId === card.sourceOwnerId && request.accessVersion === identity.accessVersion,
        'GRADING_OPERATION_SCOPE_INVALID');
        if (committing) requireBridge(activeStates.includes(op.state) && +op.leaseExpiresAt > +now
            && identity.role === 'REVIEWER' && assignment.canReview && request.policyHash === bridge.gradingPolicyHash
            && request.bridgePolicyHash === bridge.policyHash && control.gradingPolicyHash === bridge.gradingPolicyHash && card.analysisRevision === op.expectedAnalysisRevision
            && card.draftRevision === op.expectedReviewRevision, 'GRADING_OPERATION_STALE');
        return { op, request };
    }
    async readEvidence(claims, side) {
        requireBridge(['FRONT', 'BACK'].includes(side));
        const binding = await this.transaction(async tx => {
            const context = await this.authorize(tx, claims);
            const evidence = checked(context.card.evidenceCanonical, context.card.evidenceHash);
            // Rebuild from the preserved manifest before allowing its storage key.
            const source = await this.ports.loadSource(tx, context.card);
            requireBridge(canonical(this.ports.sourceEvidence(source, evidence.sourceRevision)) === context.card.evidenceCanonical, 'EVIDENCE_CHANGED');
            requireBridge(evidence.sides[side], 'EVIDENCE_REQUIRED'); return evidence.sides[side];
        });
        const bytes = Buffer.from(await this.ports.readEvidence(binding));
        requireBridge(bytes.length === binding.byteCount && digest(bytes) === binding.sha256, 'EVIDENCE_BYTES_CHANGED');
        await this.transaction(tx => this.authorize(tx, claims));
        return { bytes, contentType: binding.contentType };
    }
    async run(claims, operationId) {
        let claim;
        try { claim = await this.transaction(async tx => {
            const context = await this.authorize(tx, claims);
            const { op, request } = await this.operation(context, operationId);
            const [prior] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffGradingExecution" WHERE "operationId"=${op.id}::uuid`;
            if (prior || !activeStates.includes(op.state)) return { prior: true, state: op.state };
            // UNKNOWN without a claim can mean the HTTP request was never
            // received. That uncertainty is not permission to dispatch it now.
            requireBridge(op.state === 'DISPATCHED', 'GRADING_RECONCILIATION_REQUIRED');
            await this.operation(context, operationId, { committing: true });
            const { policy, now, card, bridge } = context;
            requireBridge(policy.specimenIds.includes(card.id) && +new Date(policy.expiresAt) > +now, 'PILOT_NOT_ACTIVE');
            const [{ count }] = await tx.$queryRaw`SELECT count(*)::int AS count FROM atlas_staff."StaffSpecimen"
                WHERE id::text = ANY(${policy.specimenIds}::text[]) AND "sourceType"=${card.sourceType}`;
            requireBridge(count === 10, 'PILOT_TEN_CARDS_REQUIRED');
            const [usage] = await tx.$queryRaw`SELECT * FROM atlas_staff.pilot_budget_usage(${policy.pilotId}::uuid,${card.id}::uuid)`;
            const reserve = BigInt(policy.reservationPerOperationMicroUsd);
            requireBridge(!usage.overrun && BigInt(usage.total) + reserve <= BigInt(policy.maxTotalMicroUsd)
                && BigInt(usage.card) + reserve <= BigInt(policy.maxCardMicroUsd)
                && usage.operations < policy.maxOperationsPerCard, 'PILOT_BUDGET_EXHAUSTED');
            const source = await this.ports.loadSource(tx, card);
            requireBridge(source.updatedAt.toISOString() === request.sourceRevision
                && canonical(this.ports.sourceEvidence(source, checked(card.evidenceCanonical, card.evidenceHash).sourceRevision)) === card.evidenceCanonical, 'SOURCE_REVISION_CHANGED');
            try { this.ports.assertSourceAdmission(source); } catch { requireBridge(false, 'PREPARATION_RELEASE_NOT_ADMITTED'); }
            if (request.request.action.type === 'INITIALIZE') requireBridge(op.expectedAnalysisRevision === 0
                && Array.isArray(source.reviewedDefects) && source.reviewedDefects.length === 0
                && (!source.gradeReport || Object.keys(source.gradeReport).length === 0), 'FRESH_DETECTION_REQUIRED');
            else requireBridge(op.expectedAnalysisRevision > 0, 'GRADING_NOT_READY');
            const claimId = randomUUID();
            await tx.$executeRaw`INSERT INTO atlas_staff."StaffGradingExecution"
                ("operationId","claimId","pilotId","bridgeRevision","sourceRevision","reservedMicroUsd",state,"createdAt")
                VALUES (${op.id}::uuid,${claimId}::uuid,${policy.pilotId}::uuid,${bridge.revision},${request.sourceRevision},${reserve},'RUNNING',(${now}::timestamptz AT TIME ZONE 'UTC'))`;
            return { context: { card, policy, bridge }, op, request, source, claimId, prior: false };
        }); } catch (error) {
            const knownPreflight = new Set(['PILOT_NOT_ACTIVE', 'PILOT_TEN_CARDS_REQUIRED', 'PILOT_BUDGET_EXHAUSTED',
                'SOURCE_REVISION_CHANGED', 'PREPARATION_RELEASE_NOT_ADMITTED', 'FRESH_DETECTION_REQUIRED', 'GRADING_NOT_READY',
                'GRADING_OPERATION_STALE']);
            if (!knownPreflight.has(error.code)) throw error;
            return this.transaction(async tx => {
                const context = await this.authorize(tx, claims);
                const { op } = await this.operation(context, operationId);
                const [execution] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffGradingExecution" WHERE "operationId"=${operationId}::uuid`;
                if (!execution && op.state === 'DISPATCHED') {
                    await tx.$executeRaw`UPDATE atlas_staff."StaffGradingOperation" SET state='FAILED',"failureCode"=${error.code},"finishedAt"=(${context.now}::timestamptz AT TIME ZONE 'UTC') WHERE id=${operationId}::uuid`;
                    return { state: 'FAILED', failureCode: error.code };
                }
                return { state: op.state };
            });
        }
        if (claim.prior) return { state: claim.state };
        const signal = AbortSignal.timeout(claim.context.policy.deadlineMs);
        let committed = false;
        try {
            let committingContext;
            await this.ports.perform({ source: claim.source, action: claim.request.request.action,
                policy: claim.context.policy, signal,
                beforeSessionLock: async (tx, identity, expectedUpdatedAt) => {
                    signal.throwIfAborted();
                    const context = await this.authorize(tx, claims);
                    await this.operation(context, operationId, { committing: true });
                    const [execution] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffGradingExecution" WHERE "operationId"=${operationId}::uuid FOR UPDATE`;
                    requireBridge(execution?.claimId === claim.claimId && execution.state === 'RUNNING'
                        && context.bridge.revision === claim.context.bridge.revision
                        && +new Date(context.policy.expiresAt) > +context.now
                        && identity.sessionId === claim.source.id && identity.createdByUserId === claim.source.createdByUserId
                        && expectedUpdatedAt.toISOString() === claim.request.sourceRevision, 'GRADING_EXECUTION_STALE');
                    committingContext = context;
                },
                afterPersist: async (tx, _identity, _expectedUpdatedAt, data) => {
                    const context = committingContext;
                    requireBridge(context?.tx === tx && !committed, 'GRADING_TRANSACTION_REQUIRED');
                    const { card, now, bridge } = context;
                    const saved = await this.ports.loadSource(tx, card);
                    requireBridge(canonical(this.ports.sourceEvidence(saved, checked(card.evidenceCanonical, card.evidenceHash).sourceRevision)) === card.evidenceCanonical, 'EVIDENCE_CHANGED');
                    const sourceCanonical = canonical(this.ports.reportSource(saved)), sourceHash = digest(sourceCanonical);
                    const reportCanonical = canonical(previewAtlasReport(JSON.parse(sourceCanonical)));
                    const [old] = card.analysisRevision ? await tx.$queryRaw`SELECT * FROM atlas_staff."StaffAnalysisRevision"
                        WHERE "specimenId"=${card.id}::uuid AND revision=${card.analysisRevision}` : [];
                    const previous = old ? checked(old.admissionCanonical, old.admissionHash) : null;
                    const detectionPair = data.detectionPair ?? previous?.detectionPair;
                    requireBridge(detectionPair && (!previous || previous.policyHash === bridge.gradingPolicyHash), 'DETECTION_ADMISSION_REQUIRED');
                    const admissionCanonical = canonical({ purpose: 'atlas-analysis-admission-v1', mode: bridge.mode,
                        evidenceHash: card.evidenceHash, sourceHash, policyHash: bridge.gradingPolicyHash, bridgePolicyHash: bridge.policyHash,
                        sourceId: card.sourceId, sourceOwnerId: card.sourceOwnerId, operationId,
                        bridgeRevision: bridge.revision, detectionPair });
                    const revision = card.analysisRevision + 1;
                    await tx.$executeRaw`INSERT INTO atlas_staff."StaffAnalysisRevision"
                        ("operationId","specimenId",revision,"evidenceHash","sourceCanonical","sourceHash","reportCanonical","reportHash",
                        "admissionCanonical","admissionHash","sourceRevision",mode,"createdAt")
                        VALUES (${operationId}::uuid,${card.id}::uuid,${revision},${card.evidenceHash},${sourceCanonical},${sourceHash},
                        ${reportCanonical},${digest(reportCanonical)},${admissionCanonical},${digest(admissionCanonical)},${saved.updatedAt.toISOString()},${bridge.mode},(${now}::timestamptz AT TIME ZONE 'UTC'))`;
                    const [row] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffReviewRevision" WHERE "specimenId"=${card.id}::uuid AND revision=${card.draftRevision}`;
                    const previousDraft = checked(row.canonical, row.contentHash);
                    const draft = { ...previousDraft, revision: card.draftRevision + 1, reviewedSides: [], identityReviewed: false,
                        disposition: 'IN_REVIEW', savedAt: now.toISOString(), savedBy: context.identity.name };
                    const reviewCanonical = canonical(draft);
                    await tx.$executeRaw`INSERT INTO atlas_staff."StaffReviewRevision"
                        ("specimenId",revision,"evidenceRevision","evidenceHash","contentHash","analysisRevision",canonical,"savedById","savedAt")
                        VALUES (${card.id}::uuid,${draft.revision},${card.evidenceRevision},${card.evidenceHash},${digest(reviewCanonical)},
                        ${revision},${reviewCanonical},${context.identity.id}::uuid,(${now}::timestamptz AT TIME ZONE 'UTC'))`;
                    await tx.$executeRaw`UPDATE atlas_staff."StaffSpecimen" SET "analysisRevision"=${revision},"draftRevision"=${draft.revision} WHERE id=${card.id}::uuid`;
                    await tx.$executeRaw`UPDATE atlas_staff."StaffGradingOperation" SET state='SUCCEEDED',"resultAnalysisRevision"=${revision},
                        "failureCode"=NULL,"finishedAt"=(${now}::timestamptz AT TIME ZONE 'UTC') WHERE id=${operationId}::uuid`;
                    await tx.$executeRaw`UPDATE atlas_staff."StaffGradingExecution" SET state='COMMITTED',"finishedAt"=(${now}::timestamptz AT TIME ZONE 'UTC') WHERE "operationId"=${operationId}::uuid`;
                    await tx.$executeRaw`INSERT INTO atlas_staff."StaffAudit" (id,event,"subjectId","actorId",details,"createdAt")
                        VALUES (${randomUUID()}::uuid,'GRADING_REVISION_COMMITTED',${card.id},${context.identity.id}::uuid,
                        ${canonical({ operationId, analysisRevision: revision, sourceHash, reportHash: digest(reportCanonical), action: claim.request.request.action.type })},(${now}::timestamptz AT TIME ZONE 'UTC'))`;
                    // This flag is informational only; the database result below
                    // is the authority if the enclosing commit fails.
                    committed = true;
                } });
        } catch {
            // Preserve any completed transaction. Anything else remains held
            // for reconciliation; a worker could have charged before failing.
        }
        return this.transaction(async tx => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1', 0))`;
            const [op] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffGradingOperation" WHERE id=${operationId}::uuid FOR UPDATE`;
            const [execution] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffGradingExecution" WHERE "operationId"=${operationId}::uuid FOR UPDATE`;
            requireBridge(execution?.claimId === claim.claimId, 'GRADING_EXECUTION_STALE');
            if (op.state === 'SUCCEEDED') return { state: 'SUCCEEDED', analysisRevision: op.resultAnalysisRevision };
            const [{ now }] = await tx.$queryRaw`SELECT clock_timestamp() AS now`;
            if (op.state === 'DISPATCHED') await tx.$executeRaw`UPDATE atlas_staff."StaffGradingOperation" SET state='UNKNOWN',"failureCode"='GRADING_OUTCOME_UNCONFIRMED' WHERE id=${op.id}::uuid`;
            if (execution.state === 'RUNNING') await tx.$executeRaw`UPDATE atlas_staff."StaffGradingExecution" SET state='UNKNOWN',"failureCode"='GRADING_OUTCOME_UNCONFIRMED',"finishedAt"=(${now}::timestamptz AT TIME ZONE 'UTC') WHERE "operationId"=${op.id}::uuid`;
            return { state: 'UNKNOWN' };
        });
    }
}
