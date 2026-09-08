// Owned disposable PostgreSQL tests only. No optical/model/device acceptance.
import { randomUUID } from 'node:crypto';
import { ScopedGradingBridge } from '../../../packages/atlas-service-bridge/src/executor.mjs';
import { fixtureAnalysis, FIXTURE_GRADING_POLICY } from '../lib/server/access/fixture-analysis.mjs';
import { StaffGrading } from '../lib/server/access/grading.mjs';
import { DurableReviewStore } from '../lib/server/access/review.mjs';
import { fixtureEvidence } from '../lib/server/access/fixture.mjs';
import { canonical } from '../lib/server/review-contract.mjs';
import { hash } from '../lib/server/policy.mjs';
import { calculateSpeedsterReview, removeSpeedsterDefect } from '@atlas/grading-core/review';
import { measureSpeedsterCenteringBorders } from '@atlas/grading-core/scoring';

export const gradingInput = (card, action = { type: 'INITIALIZE' }) => ({ operationId: randomUUID(),
    expectedAnalysisRevision: card.grading.analysisRevision, analysisHash: card.grading.analysisHash,
    expectedReviewRevision: card.draft.revision, reviewHash: card.reviewHash, evidenceHash: card.evidenceHash, action });
export async function bridgeFixture(context, options = {}) {
    const { admin, identities, config: staffConfig, auth } = context;
    const specimenIds = Array.from({ length: 10 }, () => randomUUID()), sources = new Map(), sourceRevision = new Date().toISOString();
    const policy = { version: 'atlas-grading-bridge-policy-v1', pilotId: randomUUID(), specimenIds,
        expiresAt: new Date(Date.now() + 600_000).toISOString(), maxOperationsPerCard: 10, maxTotalMicroUsd: 1_000_000,
        maxCardMicroUsd: options.maxCardMicroUsd ?? 100_000, reservationPerOperationMicroUsd: 10_000, maxWorkerCalls: 4, deadlineMs: 10_000 };
    const policyCanonical = canonical(policy), policyHash = hash(policyCanonical);
    const base = await admin.staffSpecimen.findFirst({ where: { sourceId: 'sample-001' } });
    await admin.$executeRaw`CREATE TABLE public."AtlasBridgeTestSource" (id text PRIMARY KEY, owner text NOT NULL, payload text NOT NULL, "updatedAt" timestamp(3) NOT NULL)`;
    await admin.$transaction(async tx => {
        for (const [index, id] of specimenIds.entries()) {
            const sourceId = `bridge-fixture-${id}`, sourceOwnerId = 'fictional-source-owner';
            const evidenceCanonical = canonical({ ...JSON.parse(base.evidenceCanonical), sourceRevision });
            const evidenceHash = hash(evidenceCanonical);
            const analysis = fixtureAnalysis({ title: `Synthetic bridge ${index + 1}`, set: 'Isolated database test' }, evidenceHash);
            const full = JSON.parse(analysis.sourceCanonical), initial = { ...full, reviewedDefects: [], gradeReport: null };
            sources.set(sourceId, { full, evidenceCanonical });
            await tx.$executeRaw`INSERT INTO public."AtlasBridgeTestSource" VALUES (${sourceId},${sourceOwnerId},${canonical(initial)},(${new Date(sourceRevision)}::timestamptz AT TIME ZONE 'UTC'))`;
            await tx.staffSpecimen.create({ data: { id, sourceType: 'LOCAL_FIXTURE', sourceId, sourceOwnerId,
                title: full.identity.playerName, subtitle: 'Synthetic bridge', evidenceCanonical, evidenceHash } });
            const draft = { revision: 1, evidenceRevision: 1, evidenceHash, observations: { FRONT: '', BACK: '' },
                reviewedSides: [], identityReviewed: false, disposition: 'IN_REVIEW', savedAt: null, savedBy: null };
            await tx.staffReviewRevision.create({ data: { specimenId: id, revision: 1, evidenceRevision: 1, evidenceHash,
                canonical: canonical(draft), contentHash: hash(canonical(draft)) } });
            for (const identity of identities) await tx.staffAssignment.create({ data: { specimenId: id, identityId: identity.id,
                canReview: identity.role === 'REVIEWER', expiresAt: new Date(Date.now() + 600_000) } });
        }
        await tx.staffControl.update({ where: { id: 'active' }, data: { gradingPolicyHash: FIXTURE_GRADING_POLICY, revision: { increment: 1 } } });
        await tx.staffGradingBridgeControl.create({ data: { enabled: true, mode: 'LOCAL_FIXTURE', origin: 'https://bridge.example.test',
            deploymentId: 'local-bridge-fixture', releaseSha: '0'.repeat(40), configHash: 'c'.repeat(64), clientKeyHash: 'd'.repeat(64), gradingPolicyHash: FIXTURE_GRADING_POLICY, policyCanonical, policyHash } });
        await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
    });
    let calls = 0;
    const ports = {
        async loadSource(tx, card) {
            const [row] = await tx.$queryRaw`SELECT * FROM public."AtlasBridgeTestSource" WHERE id=${card.sourceId} AND owner=${card.sourceOwnerId}`;
            if (!row) throw new Error('SYNTHETIC_SOURCE_MISSING');
            return { ...JSON.parse(row.payload), id: row.id, createdByUserId: row.owner, updatedAt: row.updatedAt };
        },
        sourceEvidence: source => JSON.parse(sources.get(source.id).evidenceCanonical),
        assertSourceAdmission: source => { if (!sources.has(source.id)) throw new Error('SYNTHETIC_ONLY'); },
        reportSource: source => ({ cardProfile: source.cardProfile, identity: source.identity, capture: source.capture,
            reviewedDefects: source.reviewedDefects, gradeReport: source.gradeReport }),
        async readEvidence() { throw new Error('NO_REAL_STORAGE_PORT'); },
        async perform({ source, action, beforeSessionLock, afterPersist }) {
            calls++; await options.beforePerform?.();
            const full = sources.get(source.id).full;
            const findings = action.type === 'INITIALIZE' ? full.reviewedDefects
                : action.type === 'REMOVE' ? removeSpeedsterDefect(source.reviewedDefects, action.defectIds[0]) : source.reviewedDefects;
            const capture = Object.fromEntries(['front', 'back'].map(side => [side, { centeringBorders: measureSpeedsterCenteringBorders(source.capture[side].centeringQuad) }]));
            const review = calculateSpeedsterReview(capture, findings);
            const data = { reviewedDefects: review.defects, gradeReport: { ...review.grade, detectorVersion: full.gradeReport.detectorVersion },
                ...(action.type === 'INITIALIZE' ? { detectionPair: { synthetic: true, noDetectorCalled: true } } : {}) };
            const identity = { sessionId: source.id, createdByUserId: source.createdByUserId };
            await admin.$transaction(async tx => {
                await beforeSessionLock(tx, identity, source.updatedAt, data);
                const updatedAt = new Date(+source.updatedAt + 1);
                const count = await tx.$executeRaw`UPDATE public."AtlasBridgeTestSource" SET payload=${canonical({ ...ports.reportSource(source), ...data })},"updatedAt"=(${updatedAt}::timestamptz AT TIME ZONE 'UTC')
                    WHERE id=${source.id} AND "updatedAt"=(${source.updatedAt}::timestamptz AT TIME ZONE 'UTC')`;
                if (count !== 1) throw new Error('SYNTHETIC_SOURCE_CONFLICT');
                await afterPersist(tx, identity, source.updatedAt, data);
                await options.afterPersist?.(tx);
                await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
            });
        },
    };
    const bridgeConfig = { mode: 'LOCAL_FIXTURE', origin: 'https://bridge.example.test', deploymentId: 'local-bridge-fixture',
        releaseSha: '0'.repeat(40), configHash: 'c'.repeat(64), clientKeyHash: 'd'.repeat(64), gradingPolicyHash: FIXTURE_GRADING_POLICY };
    const service = new ScopedGradingBridge({ client: admin, config: bridgeConfig, ports });
    const bridge = { binding: { origin: bridgeConfig.origin, clientKeyHash: bridgeConfig.clientKeyHash }, async call(scope, payload) {
        const claims = { ...scope, deploymentId: staffConfig.deploymentId, releaseSha: staffConfig.releaseSha };
        await options.beforeDispatch?.({ claims, payload });
        const result = await service.run(claims, payload.operationId);
        if (options.loseReply) throw new Error('SYNTHETIC_LOST_REPLY'); return result;
    } };
    const review = new DurableReviewStore({ auth, evidence: fixtureEvidence() });
    const grading = new StaffGrading({ auth, review, bridge });
    return { specimenIds, policy, ports, service, grading, review, calls: () => calls };
}
