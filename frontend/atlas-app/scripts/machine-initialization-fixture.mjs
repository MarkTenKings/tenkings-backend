import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { operatorFixture } from './operator-fixture.mjs';
import { MachineInitializationBridge, enqueueMachineInitialization } from '../../../packages/atlas-service-bridge/src/machine-initialize.mjs';
import { enqueueOperatorRun } from '../../../packages/atlas-operator/src/ledger.mjs';
import { canonical, requireBridge } from '../../../packages/atlas-service-bridge/src/protocol.mjs';

const reason = 'Explicit owned synthetic admission; no worker or model request.';
const authorizationEvidenceHash = '9'.repeat(64);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function fixture(context, work, options = {}) {
    return operatorFixture(context, async f => {
        const config = { ...f.bridge.service.config, runtimeHash: f.config.configHash };
        const control = await f.admin.staffControl.findUnique({ where: { id: 'active' } });
        const identity = await f.admin.staffIdentity.findUnique({ where: { id: f.signed.staff.id } });
        const grant = await f.admin.staffOperationsGrant.create({ data: { id: randomUUID(), identityId: identity.id,
            accessVersion: identity.accessVersion, controlRevision: control.revision, mode: control.mode, origin: control.origin,
            deploymentId: control.deploymentId, releaseSha: control.releaseSha, configHash: control.configHash,
            authorizationEvidenceHash, createdAt: new Date(Date.now()-1000), expiresAt: new Date(Date.now()+600_000) } });
        // Explicit private-side fixture admission port. Actual current auth and
        // grant rows are re-read under the common lock; SQL independently guards
        // the resulting immutable job/audit. No fake Ten Kings user is created.
        const admission = { async transaction(staff, work) {
            const handle = f.auth.actors.get(staff); requireBridge(handle, 'MACHINE_ADMISSION_REQUIRED');
            return f.admin.$transaction(async tx => {
                await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0))`;
                const [currentControl] = await tx.$queryRaw`SELECT * FROM atlas_staff.lock_control()`;
                const [{ now }] = await tx.$queryRaw`SELECT clock_timestamp() AS now`;
                const current = await f.auth.current({ tx, control: currentControl, now }, handle.sessionHash, handle.browserHash);
                const [currentGrant] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffOperationsGrant" WHERE id=${grant.id}::uuid FOR SHARE`;
                requireBridge(current && currentGrant.revokedAt === null && currentGrant.expiresAt > now, 'MACHINE_ADMISSION_REQUIRED');
                const result = await work({ tx, control: currentControl, identity: current.identity, session: current.session,
                    actorKind: 'HUMAN', capability: 'OPERATIONS', capabilityUntil: currentGrant.expiresAt, operationsGrantId: currentGrant.id });
                await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`; return result;
            }, { timeout: 10_000 });
        } };
        const ports = { ...f.bridge.ports, async perform(input) {
            await options.beforePerform?.(f);
            return f.bridge.ports.perform({ ...input, afterPersist: async (tx, identity, expected, data) => {
                const admitted = { ...data, detectionPair: { operationId: 'explicit-synthetic-fresh-detection',
                    captureBindingSha256: '4'.repeat(64), memorySnapshotSha256: '5'.repeat(64),
                    frontReceiptHmacSha256: '6'.repeat(64), backReceiptHmacSha256: '7'.repeat(64) } };
                await input.afterPersist(tx, identity, expected, admitted);
                await options.afterPersist?.(tx);
            } });
        } };
        const service = new MachineInitializationBridge({ client: f.admin, config, ports });
        const enqueue = (index = 0, input = {}) => enqueueMachineInitialization({ admin: admission, staff: f.signed.staff, config, ports },
            { jobId: randomUUID(), specimenId: f.bridge.specimenIds[index], reason, authorizationEvidenceHash, ...input });
        const run = job => service.run({ jobId: job.id, runtimeHash: config.runtimeHash });
        await work({ ...f, machineConfig: config, admission, grant, ports, service, enqueue, run });
    });
}

export async function machineInitializationScenarios(scenario) {
    await scenario('machine admission and fresh grading atomically preserve machine provenance without a human or public approval', context => fixture(context, async f => {
        const job = await f.enqueue();
        assert.equal(job.state, 'QUEUED'); assert.equal(f.bridge.calls(), 0);
        const retained = await f.enqueue(0, { jobId: job.id }); assert.equal(retained.gradingOperationId, job.gradingOperationId);
        await assert.rejects(() => f.enqueue(0, { jobId: job.id, reason: 'Changed admission' }), /MACHINE_ADMISSION_CONFLICT/);
        const result = await f.run(job); assert.deepEqual(result, { state: 'SUCCEEDED', analysisRevision: 1 });
        assert.equal(f.bridge.calls(), 1);
        const fresh = new MachineInitializationBridge({ client: f.admin, config: f.machineConfig, ports: f.ports });
        assert.deepEqual(await fresh.run({ jobId: job.id, runtimeHash: f.machineConfig.runtimeHash }), result); assert.equal(f.bridge.calls(), 1);
        const card = await f.admin.staffSpecimen.findUnique({ where: { id: job.specimenId } });
        const analysis = await f.admin.staffAnalysisRevision.findUnique({ where: { operationId: job.gradingOperationId } });
        const review = await f.admin.staffReviewRevision.findUnique({ where: { specimenId_revision: { specimenId: card.id, revision: card.draftRevision } } });
        assert.equal(card.analysisRevision, 1); assert.equal(card.draftRevision, 2); assert.equal(review.savedById, null);
        assert.deepEqual(JSON.parse(review.canonical).reviewedSides, []); assert.equal(JSON.parse(review.canonical).identityReviewed, false);
        assert.equal(JSON.parse(analysis.admissionCanonical).machineInitialization.jobId, job.id);
        const execution = await f.admin.staffGradingExecution.findUnique({ where: { operationId: job.gradingOperationId } });
        assert.equal(execution.state, 'COMMITTED'); assert.equal(execution.actualMicroUsd, null); assert.equal(execution.reservedMicroUsd, 10_000n);
        assert.equal(await f.admin.staffReportApproval.count(), 0); assert.equal(await f.admin.staffPublicReport.count(), 0);
        const run = await enqueueOperatorRun(f.admin, f.config, card.id, { machineInitializationId: job.id });
        assert.equal((await enqueueOperatorRun(f.admin, f.config, card.id, { machineInitializationId: job.id })).id, run.id);
        assert.equal(await f.admin.staffOperatorRun.count(), 1);
        assert.equal(run.expectedAnalysisRevision, 1); assert.equal(run.expectedReviewRevision, 2);
        assert.equal((await f.ledger.claim(run.id, randomUUID())).mode, 'WORK');
    }));
    await scenario('concurrent machine initialization claims dispatch the original fixture worker once', context => fixture(context, async f => {
        const job = await f.enqueue();
        const results = await Promise.all([f.run(job), f.run(job)]);
        assert(results.some(row => row.state === 'SUCCEEDED')); assert(results.every(row => ['SUCCEEDED','UNKNOWN'].includes(row.state)));
        assert.equal(f.bridge.calls(), 1); assert.equal(await f.admin.staffGradingExecution.count(), 1);
        assert.equal(await f.admin.staffAnalysisRevision.count({ where: { specimenId: job.specimenId } }), 1);
    }));
    await scenario('fresh detection denial before machine admission or claim creates no paid execution', context => fixture(context, async f => {
        const original = f.ports.assertFreshDetection;
        f.ports.assertFreshDetection = async () => requireBridge(false, 'FRESH_DETECTION_REQUIRED');
        await assert.rejects(() => f.enqueue(), /FRESH_DETECTION_REQUIRED/); assert.equal(await f.admin.staffMachineInitialization.count(), 0);
        f.ports.assertFreshDetection = original;
        const job = await f.enqueue(); f.ports.assertFreshDetection = async () => requireBridge(false, 'FRESH_DETECTION_REQUIRED');
        await assert.rejects(() => f.run(job), /FRESH_DETECTION_REQUIRED/);
        assert.equal(await f.admin.staffGradingExecution.count(), 0); assert.equal(f.bridge.calls(), 0);
        assert.equal((await f.admin.staffMachineInitialization.findUnique({ where: { id: job.id } })).state, 'QUEUED');
        await assert.rejects(() => f.client.staffMachineInitialization.findMany());
        await assert.rejects(() => context.client.staffMachineInitialization.create({ data: { ...job, id: randomUUID() } }));
    }));
    await scenario('machine source analysis review and audit roll back together while the unknown worker cost stays held', context => fixture(context, async f => {
        const job = await f.enqueue();
        const before = await f.admin.$queryRaw`SELECT payload,"updatedAt" FROM public."AtlasBridgeTestSource" WHERE id=(SELECT "sourceId" FROM atlas_staff."StaffSpecimen" WHERE id=${job.specimenId}::uuid)`;
        const result = await f.run(job); assert.equal(result.state, 'UNKNOWN');
        const after = await f.admin.$queryRaw`SELECT payload,"updatedAt" FROM public."AtlasBridgeTestSource" WHERE id=(SELECT "sourceId" FROM atlas_staff."StaffSpecimen" WHERE id=${job.specimenId}::uuid)`;
        assert.deepEqual(after, before); assert.equal(await f.admin.staffAnalysisRevision.count({ where: { specimenId: job.specimenId } }), 0);
        assert.equal((await f.admin.staffSpecimen.findUnique({ where: { id: job.specimenId } })).analysisRevision, 0);
        assert.equal((await f.admin.staffGradingExecution.findUnique({ where: { operationId: job.gradingOperationId } })).state, 'UNKNOWN');
        const [usage] = await f.admin.$queryRaw`SELECT * FROM atlas_staff.pilot_budget_usage(${job.pilotId}::uuid,${job.specimenId}::uuid)`;
        assert.equal(usage.card, '10000');
        assert.equal((await f.run(job)).state, 'UNKNOWN'); assert.equal(f.bridge.calls(), 1);
    }, { afterPersist: () => { throw new Error('SYNTHETIC_MACHINE_ATOMIC_ROLLBACK'); } }));
    await scenario('operator revocation during machine work prevents a late result from committing', async context => {
        const begun = deferred(), release = deferred();
        await fixture(context, async f => {
            const job = await f.enqueue(), pending = f.run(job); await begun.promise;
            await f.admin.staffOperatorControl.update({ where: { id: 'active' }, data: { enabled: false, revision: { increment: 1 } } });
            release.resolve(); const result = await pending; assert.equal(result.state, 'UNKNOWN');
            assert.equal(await f.admin.staffAnalysisRevision.count({ where: { specimenId: job.specimenId } }), 0);
            assert.equal((await f.admin.staffGradingExecution.findUnique({ where: { operationId: job.gradingOperationId } })).state, 'UNKNOWN');
        }, { beforePerform: async () => { begun.resolve(); await release.promise; } });
    });
    await scenario('SQL rejects invented machine authority and an admission without its exact immutable audit', context => fixture(context, async f => {
        const job = await f.enqueue();
        await assert.rejects(() => f.admin.staffMachineInitialization.update({ where: { id: job.id }, data: { admittedById: randomUUID() } }));
        const op = await f.admin.staffGradingOperation.findUnique({ where: { id: job.gradingOperationId } });
        await assert.rejects(() => f.admin.$transaction(async tx => {
            await tx.staffGradingOperation.create({ data: { ...op, id: randomUUID(), operationId: randomUUID(), dispatchClaimId: randomUUID() } });
            await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
        }));
        const other = f.bridge.specimenIds[1];
        const forgedAuthority = { transaction: (staff, work) => f.admission.transaction(staff, c => work({ ...c, operationsGrantId: randomUUID() })) };
        await assert.rejects(() => enqueueMachineInitialization({ admin: forgedAuthority, staff: f.signed.staff, config: f.machineConfig, ports: f.ports },
            { jobId: randomUUID(), specimenId: other, reason, authorizationEvidenceHash }));
        assert.equal(await f.admin.staffMachineInitialization.count(), 1); assert.equal(await f.admin.staffGradingExecution.count(), 0);
    }));
}
