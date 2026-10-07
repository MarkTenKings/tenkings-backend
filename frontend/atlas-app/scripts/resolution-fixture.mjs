// Inactive owned disposable PostgreSQL scenarios. Import/register only after
// the lead selects M11 SQL + generated schema + exact role-grant integration.
// This module starts no DB, network, worker, process, or provider on import.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../.generated/staff-database/index.js';
import { operatorFixture } from './operator-fixture.mjs';
import { StaffOperationsAuthority, makeOperationsAuthorityConfig } from '../lib/server/access/operations-authority.mjs';
import { StaffOperationalResolutionService } from '../lib/server/access/resolution.mjs';
import { canonical } from '../lib/server/review-contract.mjs';
import { hash } from '../lib/server/policy.mjs';
import { enqueueOperatorRun } from '../../../packages/atlas-operator/src/ledger.mjs';
import { MachineInitializationBridge, enqueueMachineInitialization } from '../../../packages/atlas-service-bridge/src/machine-initialize.mjs';

const incident = 'e'.repeat(64), reason = 'Human discards unapplied synthetic work after inspecting explicit incident evidence.';
async function fixture(context, work) {
    return operatorFixture(context, async f => {
        const control = await f.admin.staffControl.findUnique({ where: { id: 'active' } });
        const identity = await f.admin.staffIdentity.findUnique({ where: { id: f.signed.staff.id } });
        const grant = await f.admin.staffOperationsGrant.create({ data: { id: randomUUID(), identityId: identity.id,
            accessVersion: identity.accessVersion, controlRevision: control.revision, mode: control.mode, origin: control.origin,
            deploymentId: control.deploymentId, releaseSha: control.releaseSha, configHash: control.configHash,
            authorizationEvidenceHash: incident, createdAt: new Date(Date.now()-1000), expiresAt: new Date(Date.now()+600_000) } });
        const operationsClient = new PrismaClient({ datasources: { db: { url: f.db.operationsUrl } } });
        const authority = new StaffOperationsAuthority({ client: operationsClient, auth: f.auth,
            config: makeOperationsAuthorityConfig({ databaseUrl: f.db.operationsUrl, staffConfig: context.config }) });
        const resolution = new StaffOperationalResolutionService({ admin: authority });
        const machineConfig = { ...f.bridge.service.config, runtimeHash: f.config.configHash };
        // Existing original-service fixture ports; the paid perform port is
        // replaced with an explicit synthetic uncertain return, never a worker.
        const ports = { ...f.bridge.ports, async perform() { throw new Error('SYNTHETIC_UNCERTAIN_WORKER'); } };
        const machine = new MachineInitializationBridge({ client: f.admin, config: machineConfig, ports });
        const admission = { async transaction(staff, work) {
            const handle = f.auth.actors.get(staff); assert(handle);
            return f.admin.$transaction(async tx => {
                await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0))`;
                const [currentControl] = await tx.$queryRaw`SELECT * FROM atlas_staff.lock_control()`;
                const [{ now }] = await tx.$queryRaw`SELECT clock_timestamp() AS now`;
                const current = await f.auth.current({ tx, control: currentControl, now }, handle.sessionHash, handle.browserHash);
                const [currentGrant] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffOperationsGrant" WHERE id=${grant.id}::uuid FOR SHARE`;
                assert(current && !currentGrant.revokedAt && currentGrant.expiresAt > now);
                const result = await work({ tx, now, control: currentControl, identity: current.identity, session: current.session,
                    actorKind: 'HUMAN', capability: 'OPERATIONS', capabilityUntil: currentGrant.expiresAt, operationsGrantId: grant.id });
                await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`; return result;
            });
        } };
        const enqueue = (index = 0) => enqueueMachineInitialization({ admin: admission, staff: f.signed.staff, config: machineConfig, ports },
            { jobId: randomUUID(), specimenId: f.bridge.specimenIds[index], reason, authorizationEvidenceHash: incident });
        const input = async (kind, recordId, pilotId = f.budget.pilotId) => ({ operationId: randomUUID(), recordId, pilotId,
            expectedBindingHash: (await resolution.inspect(f.signed.staff, { kind, recordId, pilotId })).bindingHash,
            evidenceHash: incident, reason, ...(kind === 'INITIALIZATION' ? {} : { kind }) });
        const abandon = value => resolution.abandonUnknown(f.signed.staff, value);
        const cancel = value => resolution.cancelUndispatchedInitialization(f.signed.staff, value);
        const unknown = async () => {
            const begun = await f.start(), attempt = await f.request(begun.lease, 'read_card_report', {}, { deferReceipt: true });
            await f.expire(begun.run.id); await f.ledger.claim(begun.run.id, randomUUID());
            return { ...begun, attempt };
        };
        try { await work({ ...f, grant, authority, operationsClient, resolution, machine, machineConfig, enqueue, input, abandon, cancel, unknown }); }
        finally { await operationsClient.$disconnect(); }
    });
}
const usage = async (f, specimenId) => (await f.admin.$queryRaw`SELECT * FROM atlas_staff.pilot_budget_usage(${f.budget.pilotId}::uuid,${specimenId}::uuid)`)[0];

export async function resolutionScenarios(scenario) {
    await scenario('human cancellation atomically fails only queued initialization without a paid execution', context => fixture(context, async f => {
        const job = await f.enqueue(), value = await f.input('INITIALIZATION', job.id);
        const before = await usage(f, job.specimenId), result = await f.cancel(value);
        assert.equal(result.state, 'FAILED'); assert.equal(result.disposition, 'CANCELLED_BEFORE_DISPATCH');
        assert.equal((await f.admin.staffMachineInitialization.findUnique({ where: { id: job.id } })).state, 'FAILED');
        const op = await f.admin.staffGradingOperation.findUnique({ where: { id: job.gradingOperationId } });
        assert.equal(op.state, 'FAILED'); assert.equal(op.dispatchedAt, null);
        assert.equal(await f.admin.staffGradingExecution.count(), 0); assert.equal(await f.admin.staffAnalysisRevision.count({ where: { specimenId: job.specimenId } }), 0);
        assert.deepEqual(await usage(f, job.specimenId), before); assert.deepEqual(await f.cancel(value), result);
        await assert.rejects(() => f.enqueue(), /resolved evidence/);
        assert.equal((await f.machine.run({ jobId: job.id, runtimeHash: f.machineConfig.runtimeHash })).state, 'UNKNOWN');
        assert.equal(await f.admin.staffGradingExecution.count(), 0);
        assert.equal(await f.admin.staffOperationalResolution.count(), 1);
    }));
    await scenario('human Astra abandonment retains held attempts and permits late immutable provider receipt without tool application', context => fixture(context, async f => {
        const { run, attempt, lease } = await f.unknown(), value = await f.input('ASTRA', run.id);
        const before = await f.admin.staffOperatorAttempt.findMany({ where: { runId: run.id } }), budget = await usage(f, run.specimenId);
        const result = await f.abandon(value); assert.equal(result.state, 'FAILED');
        assert.deepEqual(await f.admin.staffOperatorAttempt.findMany({ where: { runId: run.id } }), before);
        assert.deepEqual(await usage(f, run.specimenId), budget);
        assert.equal((await f.admin.staffOperatorRun.findUnique({ where: { id: run.id } })).revision, run.revision);
        await f.ledger.recordReceipt(attempt);
        assert.equal(await f.admin.staffOperatorReceipt.count(), 1);
        const received = await f.admin.staffOperatorAttempt.findUnique({ where: { id: attempt.attemptId } });
        assert.equal(received.state, 'RECEIVED'); assert(received.usageCeilingMicroUsd > 0n); assert.equal(received.actualMicroUsd, null);
        assert.equal((await f.abandon(value)).state, 'FAILED');
        await assert.rejects(() => f.ledger.applyTool(lease, attempt.attemptId, () => { throw Error('MUST_NOT_APPLY'); }));
        await assert.rejects(() => enqueueOperatorRun(f.admin, f.config, run.specimenId), /resolved evidence/);
        assert.equal(await f.admin.staffOperatorStep.count(), 0);
    }));
    await scenario('human worker abandonment leaves UNKNOWN execution and immutable invoice cost intact', context => fixture(context, async f => {
        const job = await f.enqueue();
        assert.equal((await f.machine.run({ jobId: job.id, runtimeHash: f.machineConfig.runtimeHash })).state, 'UNKNOWN');
        await f.admin.staffGradingExecution.update({ where: { operationId: job.gradingOperationId }, data: { actualMicroUsd: 12_345n, costEvidenceHash: incident } });
        const before = await f.admin.staffGradingExecution.findUnique({ where: { operationId: job.gradingOperationId } }), budget = await usage(f, job.specimenId);
        const value = await f.input('WORKER', job.gradingOperationId), result = await f.abandon(value);
        assert.equal(result.holds.actualMicroUsd, '12345');
        assert.deepEqual(await f.admin.staffGradingExecution.findUnique({ where: { operationId: job.gradingOperationId } }), before);
        assert.equal(before.state, 'UNKNOWN'); assert.deepEqual(await usage(f, job.specimenId), budget);
        assert.equal((await f.admin.staffMachineInitialization.findUnique({ where: { id: job.id } })).state, 'FAILED');
        assert.equal(await f.admin.staffAnalysisRevision.count({ where: { specimenId: job.specimenId } }), 0);
        await assert.rejects(() => f.enqueue(), /resolved evidence/);
        await assert.rejects(() => f.admin.staffGradingExecution.update({ where: { operationId: job.gradingOperationId }, data: { state: 'COMMITTED', failureCode: null } }));
    }));
    await scenario('resolution immutable audit failures roll back parent transition and retain every reservation', context => fixture(context, async f => {
        const { run } = await f.unknown(), value = await f.input('ASTRA', run.id), before = await usage(f, run.specimenId);
        await f.sql(`CREATE FUNCTION atlas_staff.fixture_reject_resolution() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
          IF NEW.event='OPERATIONAL_RESOLUTION_RECORDED' THEN RAISE EXCEPTION 'SYNTHETIC_RESOLUTION_AUDIT_ROLLBACK'; END IF; RETURN NEW; END $$;
          CREATE TRIGGER fixture_reject_resolution BEFORE INSERT ON atlas_staff."StaffAudit" FOR EACH ROW EXECUTE FUNCTION atlas_staff.fixture_reject_resolution();`);
        await assert.rejects(() => f.abandon(value), /SYNTHETIC_RESOLUTION_AUDIT_ROLLBACK/);
        assert.equal((await f.admin.staffOperatorRun.findUnique({ where: { id: run.id } })).state, 'UNKNOWN');
        assert.equal(await f.admin.staffOperationalResolution.count(), 0); assert.deepEqual(await usage(f, run.specimenId), before);
    }));
    await scenario('restricted roles and stale resolution receipts cannot invoke abandonment or mutate retained authority', context => fixture(context, async f => {
        const { run } = await f.unknown(), value = await f.input('ASTRA', run.id);
        await assert.rejects(() => f.resolution.abandonUnknown({ ...f.signed.staff }, value), /SIGN_IN_REQUIRED/);
        await assert.rejects(() => f.abandon({ ...value, pilotId: randomUUID() }), /RESOLUTION_PILOT_CHANGED/);
        await assert.rejects(() => f.abandon({ ...value, expectedBindingHash: '0'.repeat(64) }), /RESOLUTION_BINDING_CHANGED/);
        const result = await f.abandon(value);
        for (const client of [context.client, f.client]) {
            await assert.rejects(() => client.$queryRaw`SELECT * FROM atlas_staff.apply_operational_resolution(${result.resolutionId}::uuid)`);
            await assert.rejects(() => client.$queryRaw`SELECT * FROM atlas_staff."StaffOperationalResolution"`);
        }
        await assert.rejects(() => f.operationsClient.$executeRaw`UPDATE atlas_staff."StaffOperatorRun" SET state='FAILED' WHERE id=${run.id}::uuid`);
        await assert.rejects(() => f.operationsClient.$queryRaw`SELECT atlas_staff.assert_resolution_proof(${result.resolutionId}::uuid)`);
        await assert.rejects(() => f.operationsClient.$queryRaw`SELECT * FROM atlas_staff.apply_operational_resolution(${result.resolutionId}::uuid)`, /same-transaction/);
        await assert.rejects(() => f.abandon({ ...value, reason: 'Changed human reason' }), /RESOLUTION_OPERATION_CONFLICT/);
        await f.admin.staffOperationsGrant.update({ where: { id: f.grant.id }, data: { revokedAt: new Date() } });
        await assert.rejects(() => f.abandon(value), /FRESH_HUMAN_OPERATIONS_REQUIRED/);
        await assert.rejects(() => f.operationsClient.$queryRaw`SELECT * FROM atlas_staff.apply_operational_resolution(${result.resolutionId}::uuid)`, /same-transaction/);
    }));
    await scenario('direct resolution insertion needs its exact audit and same-transaction transition; mismatched bindings roll back', context => fixture(context, async f => {
        const { run } = await f.unknown(), value = await f.input('ASTRA', run.id);
        // Exercise SQL independently of the service's refusal to construct an
        // incomplete/malicious fact. The real authority still surrounds writes.
        const raw = async ({ omitAudit = false, mutate = row => row, apply = true } = {}) => f.authority.transaction(f.signed.staff, async c => {
            const bytes = hash(canonical({ purpose: 'atlas-operational-resolution-id-v1', actorId: c.identity.id, operationId: value.operationId }));
            const id = `${bytes.slice(0,8)}-${bytes.slice(8,12)}-4${bytes.slice(13,16)}-8${bytes.slice(17,20)}-${bytes.slice(20,32)}`;
            const row = mutate({ id, kind: 'ASTRA', recordId: run.id, specimenId: run.specimenId, pilotId: value.pilotId,
                operationId: value.operationId, actorId: c.identity.id, sessionHash: c.session.tokenHash, accessVersion: c.identity.accessVersion,
                controlRevision: c.control.revision, operationsGrantId: c.operationsGrantId,
                inputHash: hash(canonical({ version: 'atlas-operational-resolution-input-v1', ...value })),
                bindingHash: value.expectedBindingHash, sourceEvidenceHash: run.evidenceHash, evidenceHash: incident, reason, createdAt: c.now });
            await c.tx.staffOperationalResolution.create({ data: row });
            if (!omitAudit) await c.tx.staffAudit.create({ data: { id, event: 'OPERATIONAL_RESOLUTION_RECORDED', subjectId: row.recordId,
                actorId: c.identity.id, createdAt: c.now, details: canonical({ version: 'atlas-operational-resolution-audit-v1',
                    resolutionId: id, kind: row.kind, recordId: row.recordId, specimenId: row.specimenId, pilotId: row.pilotId,
                    inputHash: row.inputHash, bindingHash: row.bindingHash, sourceEvidenceHash: row.sourceEvidenceHash, evidenceHash: row.evidenceHash, reason: row.reason }) } });
            if (apply) await c.tx.$queryRaw`SELECT * FROM atlas_staff.apply_operational_resolution(${id}::uuid)`;
        });
        await assert.rejects(() => raw({ omitAudit: true }), /same-transaction/);
        await assert.rejects(() => raw({ apply: false }), /atomically discard/);
        for (const key of ['bindingHash', 'sourceEvidenceHash', 'inputHash']) await assert.rejects(() => raw({ mutate: row => ({ ...row, [key]: '0'.repeat(64) }) }), /binding mismatch/);
        assert.equal(await f.admin.staffOperationalResolution.count(), 0);
        assert.equal((await f.admin.staffOperatorRun.findUnique({ where: { id: run.id } })).state, 'UNKNOWN');
    }));
    await scenario('current human grant revocation after SQL application rolls back resolution at deferred proof', context => fixture(context, async f => {
        const { run } = await f.unknown(), value = await f.input('ASTRA', run.id);
        // Explicit owner transaction solely to simulate an offline revocation
        // between apply and deferred checks in this isolated database case.
        const ownerAuthority = { transaction: (staff, work) => f.admin.$transaction(async tx => {
            const handle = f.auth.actors.get(staff); assert(handle);
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0))`;
            const [control] = await tx.$queryRaw`SELECT * FROM atlas_staff.lock_control()`;
            const [{ now }] = await tx.$queryRaw`SELECT clock_timestamp() AS now`;
            const current = await f.auth.current({ tx, control, now }, handle.sessionHash, handle.browserHash);
            const result = await work({ tx, now, control, identity: current.identity, session: current.session,
                actorKind: 'HUMAN', capability: 'OPERATIONS', capabilityUntil: f.grant.expiresAt, operationsGrantId: f.grant.id });
            await tx.staffOperationsGrant.update({ where: { id: f.grant.id }, data: { revokedAt: now } });
            await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`; return result;
        }) };
        await assert.rejects(() => new StaffOperationalResolutionService({ admin: ownerAuthority }).abandonUnknown(f.signed.staff, value), /fresh human operations authority/);
        assert.equal(await f.admin.staffOperationalResolution.count(), 0);
        assert.equal((await f.admin.staffOperatorRun.findUnique({ where: { id: run.id } })).state, 'UNKNOWN');
        assert.equal((await f.admin.staffOperationsGrant.findUnique({ where: { id: f.grant.id } })).revokedAt, null);
    }));
}
