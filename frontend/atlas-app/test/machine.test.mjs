import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { canonical, digest } from '@atlas/service-bridge/protocol';
import { makeMachineInitializationAdmissionConfig, verifyMachineInitializationAdmission } from '@atlas/service-bridge/machine-initialize-transport';
import { StaffMachinePreparation, machineAdmissionRuntimeSettings } from '../lib/server/access/machine.mjs';
import { deny } from '../lib/server/policy.mjs';
const H = 'a'.repeat(64);
function fixture() {
    const staff = Object.freeze({ id: randomUUID() }), specimenId = randomUUID(), now = new Date();
    const jobs = new Map(), state = { active: true, open: false, calls: 0, after: () => {}, run: null };
    const settings = makeMachineInitializationAdmissionConfig({ mode: 'PRODUCTION', origin: 'https://machine.example.test',
        runtimeHash: H, key: Buffer.alloc(32, 1), peerKeyHash: digest(Buffer.alloc(32, 2)) });
    const context = { now, actorKind: 'HUMAN', capability: 'OPERATIONS', capabilityUntil: new Date(+now + 300000), operationsGrantId: randomUUID(),
        identity: { id: staff.id, accessVersion: 1 }, session: { tokenHash: H, browserHash: 'b'.repeat(64) },
        control: { mode: 'PRODUCTION', revision: 1, origin: 'https://atlasgrading.com', deploymentId: 'staff.vercel.app',
            releaseSha: 'a'.repeat(40), configHash: H }, tx: {
            staffMachineInitialization: { async findUnique({ where }) { return jobs.get(where.id) ?? null; } },
            staffOperatorRun: { async findUnique() { return state.run; } },
            staffSpecimen: { async findUnique({ where }) { return where.id === specimenId ? { id: specimenId, analysisRevision: 0, sourceType: 'SPEEDSTER' } : null; } },
        } };
    const admin = { async transaction(actor, fn) { if (actor !== staff || !state.active) deny(403, 'FRESH_HUMAN_OPERATIONS_REQUIRED');
        state.open = true; try { return await fn(context); } finally { state.open = false; } } };
    const fetchImpl = async (_url, options) => {
        assert.equal(state.open, false); state.calls++;
        const packet = verifyMachineInitializationAdmission(settings, options.body, options.headers['x-atlas-machine-admission-signature']);
        assert.equal(packet.scope.actorId, staff.id); assert.equal(packet.scope.operationsGrantId, context.operationsGrantId);
        const i = packet.input, job = { id: i.jobId, specimenId, pilotId: randomUUID(), gradingOperationId: randomUUID(),
            runtimeHash: H, state: 'QUEUED', deadlineAt: new Date(Date.now() + 60000), admittedById: staff.id,
            admissionReason: i.reason, authorizationEvidenceHash: i.authorizationEvidenceHash };
        jobs.set(job.id, job); state.after();
        return new Response(canonical({ jobId: job.id, specimenId, pilotId: job.pilotId, gradingOperationId: job.gradingOperationId,
            runtimeHash: H, state: job.state, deadlineAt: job.deadlineAt.toISOString() }), { headers: { 'content-type': 'application/json' } });
    };
    const input = { jobId: randomUUID(), specimenId, reason: 'Explicit synthetic supervised preparation.', authorizationEvidenceHash: H };
    return { state, jobs, staff, context, input, admin, settings, service: new StaffMachinePreparation({ admin, settings, fetchImpl }) };
}
test('fresh operations admission calls one private purpose outside transaction then reads durable result', async () => {
    const f = fixture(), result = await f.service.admit(f.staff, f.input);
    assert.equal(f.state.calls, 1); assert.equal(result.jobId, f.input.jobId); assert.equal(result.state, 'QUEUED');
    assert.equal(result.operatorRun, null); assert.equal(Object.hasOwn(f.service.client, 'execute'), false);
    assert.equal(JSON.stringify(result).includes(f.input.reason), false);
});
test('lost admission response recovers exact retained job under fresh authority even with admission disabled', async () => {
    const f = fixture(); f.state.after = () => { throw new Error('synthetic lost response'); };
    await assert.rejects(f.service.admit(f.staff, f.input), /OUTCOME_UNCONFIRMED/);
    const disabled = new StaffMachinePreparation({ admin: f.admin });
    const recovered = await disabled.admit(f.staff, f.input); assert.equal(recovered.jobId, f.input.jobId); assert.equal(f.state.calls, 1);
    f.state.run = { id: randomUUID(), state: 'READY_FOR_HUMAN' };
    assert.deepEqual((await disabled.status(f.staff, f.input.jobId)).operatorRun, f.state.run);
    await assert.rejects(disabled.admit(f.staff, { ...f.input, reason: 'different' }), /MACHINE_ADMISSION_CONFLICT/);
    f.state.active = false; await assert.rejects(disabled.admit(f.staff, f.input), /FRESH_HUMAN_OPERATIONS_REQUIRED/);
});
test('revoked human after bridge commit prevents returning a new receipt; opaque handle cannot be fabricated', async () => {
    const f = fixture();
    await assert.rejects(f.service.admit({ ...f.staff }, f.input), /FRESH_HUMAN_OPERATIONS_REQUIRED/);
    assert.equal(f.state.calls, 0); f.state.after = () => { f.state.active = false; };
    await assert.rejects(f.service.admit(f.staff, f.input), /FRESH_HUMAN_OPERATIONS_REQUIRED/);
    assert.equal(f.jobs.size, 1);
});
test('new admission rejects changed source and unavailable configuration before any external request', async () => {
    const f = fixture();
    await assert.rejects(f.service.admit(f.staff, { ...f.input, specimenId: randomUUID() }), /MACHINE_INITIALIZATION_STALE/);
    await assert.rejects(new StaffMachinePreparation({ admin: f.admin }).admit(f.staff, f.input), /MACHINE_ADMISSION_NOT_CONFIGURED/);
    await assert.rejects(f.service.admit(f.staff, { ...f.input, execute: true }), /INVALID_REQUEST/);
    assert.equal(f.state.calls, 0);
});
test('production staff settings never borrow execution key or enable through fixture flags', () => {
    const staff = { mode: 'PRODUCTION', sessionKey: Buffer.alloc(32, 3), phoneKey: Buffer.alloc(32, 4) };
    const env = { NODE_ENV: 'production', VERCEL_ENV: 'production', ATLAS_MACHINE_INITIALIZATION_ENABLED: 'true',
        ATLAS_MACHINE_INITIALIZATION_ORIGIN: 'https://machine.example.test', ATLAS_OPERATOR_RUNTIME_HASH: H,
        ATLAS_MACHINE_ADMISSION_KEY: Buffer.alloc(32, 1).toString('base64'), ATLAS_MACHINE_EXECUTION_KEY_HASH: digest(Buffer.alloc(32, 2)) };
    assert.equal(Object.hasOwn(machineAdmissionRuntimeSettings(env, staff), 'executionKey'), false);
    for (const patch of [{ VERCEL_ENV: 'preview' }, { ATLAS_LOCAL_FIXTURE: 'true' }, { ATLAS_MACHINE_EXECUTION_KEY: 'not-for-staff' }])
        assert.throws(() => machineAdmissionRuntimeSettings({ ...env, ...patch }, staff), /MACHINE_ADMISSION_NOT_CONFIGURED/);
    assert.throws(() => machineAdmissionRuntimeSettings({ ...env, ATLAS_MACHINE_ADMISSION_KEY: staff.sessionKey.toString('base64') }, staff));
    assert.equal(machineAdmissionRuntimeSettings({}, staff), null);
});
