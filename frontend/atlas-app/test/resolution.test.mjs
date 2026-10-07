import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { StaffOperationalResolutionService } from '../lib/server/access/resolution.mjs';
import { canonical } from '../lib/server/review-contract.mjs';
import { hash } from '../lib/server/policy.mjs';

const NOW = new Date('2026-09-08T23:00:00.000Z'), SHA = 'a'.repeat(64);
const clone = value => structuredClone(value);
const rejected = (work, code) => assert.rejects(async () => work(), error => !code || error.code === code || error.message === code);
function fixture(kind = 'ASTRA', { machineWorker = false } = {}) {
    const names = ['staffSpecimen', 'staffOperatorRun', 'staffOperatorAttempt', 'staffGradingOperation', 'staffGradingExecution',
        'staffMachineInitialization', 'staffAnalysisRevision', 'staffOperationalResolution', 'staffAudit'];
    let state = Object.fromEntries(names.map(name => [name, []]));
    state.providerReceipts = [{ id: randomUUID(), evidence: 'synthetic retained pre-abandon receipt' }];
    state.workerReceipts = [{ evidence: 'synthetic preserved original-worker instrumentation' }];
    const actorId = randomUUID(), specimenId = randomUUID(), pilotId = randomUUID(), runId = randomUUID(), opId = randomUUID(), jobId = randomUUID();
    const context = { now: NOW, control: { enabled: true, mode: 'LOCAL_FIXTURE', revision: 1 },
        actorKind: 'HUMAN', capability: 'OPERATIONS', capabilityUntil: new Date(+NOW + 3600_000), operationsGrantId: randomUUID(),
        identity: { id: actorId, role: 'REVIEWER', accessVersion: 1, revokedAt: null },
        session: { identityId: actorId, tokenHash: SHA, accessVersion: 1, controlRevision: 1, revokedAt: null,
            createdAt: new Date(+NOW - 60_000), expiresAt: new Date(+NOW + 1200_000) } };
    const evidenceCanonical = canonical({ version: 'synthetic-test-evidence', sourceId: 'private-source', sourceOwnerId: 'private-owner' });
    const evidenceHash = hash(evidenceCanonical);
    state.staffSpecimen.push({ id: specimenId, sourceType: 'LOCAL_FIXTURE', sourceId: 'private-source', sourceOwnerId: 'private-owner',
        evidenceCanonical, evidenceHash, analysisRevision: kind === 'ASTRA' ? 1 : 0 });
    const run = { id: runId, specimenId, pilotId, evidenceHash, state: 'UNKNOWN', revision: 2,
        policyCanonical: canonical({ version: 'synthetic-pilot', pilotId }), manifestCanonical: canonical({ version: 'atlas-operator-manifest-v1', runId, specimenId, evidenceHash, analysisRevision: 1, reviewRevision: 2 }),
        inputCanonical: canonical([{ role: 'user', content: 'synthetic offline task' }]), runtimeHash: SHA, gradingPolicyHash: SHA,
        expectedAnalysisRevision: 1, expectedReviewRevision: 2, leaseOwner: randomUUID(), leaseExpiresAt: NOW, leaseFence: 1, leaseMode: 'RECONCILE_ONLY' };
    run.policyHash = hash(run.policyCanonical); run.manifestHash = hash(run.manifestCanonical); run.inputHash = hash(run.inputCanonical);
    const attempt = { id: randomUUID(), runId, ordinal: 1, runRevision: 1, leaseFence: 1, dispatchClaimId: randomUUID(),
        requestCanonical: canonical({ model: 'gpt-6-astra', input: 'synthetic offline request' }), providerBindingHash: SHA,
        reservedMicroUsd: 1000n, usageCeilingMicroUsd: 800n, usageEnvelopeExceeded: false, actualMicroUsd: null, costEvidenceHash: null,
        state: 'UNKNOWN', resultReceiptId: null, createdAt: NOW, dispatchedAt: NOW, finishedAt: NOW };
    attempt.requestHash = hash(attempt.requestCanonical);
    const machine = kind === 'INITIALIZATION' || machineWorker;
    const op = { id: opId, specimenId, operationId: machine ? jobId : randomUUID(), actorKind: machine ? 'ASTRA' : 'HUMAN',
        actorId: machine ? `ASTRA_INITIALIZE:${jobId}` : actorId, sessionHash: machine ? null : SHA, assignmentFence: machine ? null : 1,
        controlRevision: 1, evidenceHash, expectedAnalysisRevision: 0, expectedReviewRevision: 1,
        requestCanonical: canonical({ version: 'synthetic-original-request', request: { action: { type: 'INITIALIZE' } },
            sourceId: 'private-source', sourceOwnerId: 'private-owner', sourceRevision: NOW.toISOString(), policyHash: SHA, bridgePolicyHash: SHA }),
        state: kind === 'INITIALIZATION' ? 'RESERVED' : 'UNKNOWN', dispatchClaimId: randomUUID(), leaseFence: 1,
        leaseExpiresAt: new Date(+NOW + 60_000), resultAnalysisRevision: null, failureCode: null, createdAt: NOW,
        dispatchedAt: kind === 'INITIALIZATION' ? null : NOW, finishedAt: null };
    op.inputHash = hash(op.requestCanonical);
    const execution = { operationId: opId, claimId: randomUUID(), pilotId, bridgeRevision: 1, sourceRevision: NOW.toISOString(),
        reservedMicroUsd: 2000n, actualMicroUsd: null, costEvidenceHash: null, state: 'UNKNOWN',
        failureCode: 'GRADING_OUTCOME_UNCONFIRMED', createdAt: NOW, finishedAt: NOW };
    const job = { id: jobId, specimenId, pilotId, gradingOperationId: opId, runtimeHash: SHA, evidenceHash,
        operatorPolicyHash: SHA, bridgePolicyHash: SHA, gradingPolicyHash: SHA, sourceHash: SHA, sourceRevision: NOW.toISOString(),
        expectedAnalysisRevision: 0, expectedReviewRevision: 1, controlRevision: 1, operatorRevision: 1, bridgeRevision: 1,
        admittedById: actorId, admittedSessionHash: SHA, admittedAccessVersion: 1, operationsGrantId: context.operationsGrantId,
        admissionReason: 'Synthetic admitted initialization', authorizationEvidenceHash: SHA, deadlineAt: op.leaseExpiresAt, state: kind === 'INITIALIZATION' ? 'QUEUED' : 'UNKNOWN',
        createdAt: NOW, dispatchedAt: kind === 'INITIALIZATION' ? null : NOW, finishedAt: null };
    if (kind === 'ASTRA') { state.staffOperatorRun.push(run); state.staffOperatorAttempt.push(attempt); }
    else { state.staffGradingOperation.push(op); if (kind === 'WORKER') state.staffGradingExecution.push(execution); if (machine) state.staffMachineInitialization.push(job); }
    const settings = { failAudit: false, failDefiner: false, noopDefiner: false, mutateRetained: false, failFinal: false, lostCommitReply: false };
    let writes = 0, applies = 0;
    const match = (row, where) => Object.entries(where ?? {}).every(([key, value]) => row[key] === value);
    const tx = Object.fromEntries(names.map(name => [name, {
        findUnique: async ({ where }) => clone(state[name].find(row => match(row, where)) ?? null),
        findMany: async ({ where, take }) => clone(state[name].filter(row => match(row, where)).slice(0, take)),
        create: async ({ data }) => {
            assert(['staffOperationalResolution', 'staffAudit'].includes(name), `Unexpected write ${name}`);
            if (name === 'staffAudit' && settings.failAudit) throw new Error('SYNTHETIC_AUDIT_FAILURE');
            assert(!state[name].some(row => row.id === data.id)); writes++; state[name].push(clone(data)); return clone(data);
        },
        // There deliberately is no raw UPDATE/DELETE or table-update port.
    }]));
    tx.$queryRaw = async (strings, id) => {
        assert.equal(strings.join('?'), 'SELECT * FROM atlas_staff.apply_operational_resolution(?::uuid)');
        applies++;
        if (settings.failDefiner) throw new Error('SYNTHETIC_DEFINER_FAILURE');
        const resolution = state.staffOperationalResolution.find(row => row.id === id);
        assert(resolution); assert(state.staffAudit.some(row => row.id === id));
        if (!settings.noopDefiner) {
            if (resolution.kind === 'ASTRA') state.staffOperatorRun[0].state = 'FAILED';
            else {
                state.staffGradingOperation[0].state = 'FAILED';
                if (state.staffMachineInitialization[0]) state.staffMachineInitialization[0].state = 'FAILED';
            }
        }
        if (settings.mutateRetained) (state.staffOperatorAttempt[0] ?? state.staffGradingExecution[0]).actualMicroUsd = 0n;
        return [{ state: 'FAILED' }];
    };
    const handles = new WeakSet(), staff = Object.freeze({ id: actorId, role: 'REVIEWER' }); handles.add(staff);
    const admin = { transaction: async (handle, work) => {
        if (!handles.has(handle)) throw new Error('SIGN_IN_REQUIRED');
        const before = clone(state);
        let result;
        try { result = await work({ ...context, tx }); if (settings.failFinal) throw new Error('SYNTHETIC_FINAL_AUTH_OR_CONSTRAINT_FAILURE'); }
        catch (error) { state = before; throw error; }
        if (settings.lostCommitReply) { settings.lostCommitReply = false; throw new Error('SYNTHETIC_LOST_COMMIT_REPLY'); }
        return result;
    } };
    const service = new StaffOperationalResolutionService({ admin });
    const recordId = kind === 'ASTRA' ? runId : kind === 'WORKER' ? opId : jobId;
    const inspect = () => service.inspect(staff, { kind, recordId, pilotId });
    const input = async () => ({ operationId: randomUUID(), recordId, pilotId, expectedBindingHash: (await inspect()).bindingHash,
        evidenceHash: SHA, reason: 'Human accepts abandonment after reviewing the external incident evidence.', ...(kind === 'INITIALIZATION' ? {} : { kind }) });
    const resolve = value => kind === 'INITIALIZATION' ? service.cancelUndispatchedInitialization(staff, value) : service.abandonUnknown(staff, value);
    return { service, staff, context, settings, inspect, input, resolve, recordId, pilotId, get state() { return state; }, counts: () => ({ writes, applies }) };
}

test('undispatched initialization cancellation is terminal, audited and never claims a worker', async () => {
    const f = fixture('INITIALIZATION'), input = await f.input(); const result = await f.resolve(input);
    assert.equal(result.state, 'FAILED'); assert.equal(result.disposition, 'CANCELLED_BEFORE_DISPATCH');
    assert.equal(f.state.staffMachineInitialization[0].state, 'FAILED'); assert.equal(f.state.staffGradingOperation[0].state, 'FAILED');
    assert.equal(f.state.staffGradingExecution.length, 0); assert.equal(f.state.staffOperatorRun.length, 0);
    assert.equal(f.state.staffOperationalResolution[0].reason, input.reason); assert.equal(f.state.staffAudit[0].actorId, f.context.identity.id);
    assert.equal(f.state.staffOperationalResolution[0].operationsGrantId, f.context.operationsGrantId);
    assert.deepEqual(result.holds, { scope: 'TARGET', records: 0, reservedMicroUsd: '0', unsettledMicroUsd: '0', actualMicroUsd: '0', accountingChanged: false });
});

test('ASTRA abandonment preserves every attempt, receipt, invoice and held usage', async () => {
    const f = fixture(), input = await f.input(), attempts = clone(f.state.staffOperatorAttempt), receipts = clone(f.state.providerReceipts);
    const result = await f.resolve(input);
    assert.equal(result.state, 'FAILED'); assert.equal(result.holds.unsettledMicroUsd, '800'); assert.equal(result.holds.reservedMicroUsd, '1000');
    assert.match(result.summary, /Human inspection or recapture/); assert.match(result.summary, /No retry was scheduled/);
    assert.deepEqual(f.state.staffOperatorAttempt, attempts); assert.deepEqual(f.state.providerReceipts, receipts);
    assert.equal(f.state.staffAudit.length, 1); assert.equal(f.state.staffOperationalResolution.length, 1);
});

test('WORKER abandonment retains UNKNOWN execution and also terminates its machine job if present', async () => {
    for (const machineWorker of [false, true]) {
        const f = fixture('WORKER', { machineWorker }), input = await f.input(), execution = clone(f.state.staffGradingExecution);
        const result = await f.resolve(input); assert.equal(result.state, 'FAILED'); assert.equal(result.holds.unsettledMicroUsd, '2000');
        assert.deepEqual(f.state.staffGradingExecution, execution); assert.equal(f.state.staffGradingExecution[0].state, 'UNKNOWN');
        if (machineWorker) assert.equal(f.state.staffMachineInitialization[0].state, 'FAILED');
    }
});

test('fresh-authority replay succeeds before terminal-state gating without a second SQL application', async () => {
    for (const kind of ['INITIALIZATION', 'ASTRA', 'WORKER']) {
        const f = fixture(kind), input = await f.input(), result = await f.resolve(input);
        f.context.session.tokenHash = 'b'.repeat(64); // Same human, new valid server session.
        assert.deepEqual(await f.resolve(input), result); assert.deepEqual(f.counts(), { writes: 2, applies: 1 });
        assert.equal(f.state.staffOperationalResolution[0].sessionHash, SHA);
    }
});

test('late provider and worker receipts remain retainable and do not invalidate an identical resolution replay', async () => {
    for (const kind of ['ASTRA', 'WORKER']) {
        const f = fixture(kind), input = await f.input(); await f.resolve(input);
        f.state.providerReceipts.push({ id: randomUUID(), evidence: 'synthetic late provider receipt' });
        f.state.workerReceipts.push({ evidence: 'synthetic late worker side receipt' });
        if (kind === 'ASTRA') {
            f.state.staffOperatorAttempt[0].resultReceiptId = f.state.providerReceipts[1].id;
            f.state.staffOperatorAttempt[0].usageCeilingMicroUsd = 900n;
        }
        const result = await f.resolve(input); assert.equal(result.state, 'FAILED');
        assert.equal(f.state.providerReceipts.length, 2); assert.equal(f.state.workerReceipts.length, 2);
        assert.equal(f.counts().applies, 1); assert.equal(result.holds.unsettledMicroUsd, kind === 'ASTRA' ? '900' : '2000');
    }
});

test('independent invoice accounting survives abandonment and replay without clearing reservation history', async () => {
    const f = fixture(), input = await f.input(); f.state.staffOperatorAttempt[0].actualMicroUsd = 700n;
    f.state.staffOperatorAttempt[0].costEvidenceHash = 'c'.repeat(64);
    const result = await f.resolve(input);
    assert.equal(result.holds.actualMicroUsd, '700'); assert.equal(result.holds.unsettledMicroUsd, '0'); assert.equal(result.holds.reservedMicroUsd, '1000');
    assert.equal(f.state.staffOperatorAttempt[0].costEvidenceHash, 'c'.repeat(64));
});

test('a conflicting replay cannot change the recorded reason, evidence, target or binding', async () => {
    const f = fixture(), input = await f.input(); await f.resolve(input);
    for (const change of [{ reason: 'Different later instruction' }, { evidenceHash: 'b'.repeat(64) },
        { expectedBindingHash: 'c'.repeat(64) }, { recordId: randomUUID() }, { pilotId: randomUUID() }, { kind: 'WORKER' }])
        await rejected(() => f.resolve({ ...input, ...change }), 'RESOLUTION_OPERATION_CONFLICT');
    assert.deepEqual(f.counts(), { writes: 2, applies: 1 }); assert.equal(f.state.staffOperationalResolution[0].reason, input.reason);
});

test('wrong pilot, changed immutable binding, missing record and altered canonical request fail before writes', async () => {
    for (const change of [input => { input.pilotId = randomUUID(); }, input => { input.expectedBindingHash = 'b'.repeat(64); },
        input => { input.recordId = randomUUID(); }]) {
        const f = fixture(), input = await f.input(); change(input); await rejected(() => f.resolve(input)); assert.equal(f.counts().writes, 0);
    }
    const f = fixture(), input = await f.input(); f.state.staffOperatorAttempt[0].requestCanonical = '{}';
    await rejected(() => f.resolve(input), 'RESOLUTION_LEDGER_INVALID'); assert.equal(f.counts().writes, 0);
});

test('dispatched, executed or committed initialization cannot be cancelled', async () => {
    for (const change of [f => { f.state.staffMachineInitialization[0].dispatchedAt = NOW; },
        f => { f.state.staffGradingOperation[0].dispatchedAt = NOW; }, f => { f.state.staffGradingOperation[0].state = 'SUCCEEDED'; },
        f => { f.state.staffGradingOperation[0].resultAnalysisRevision = 1; },
        f => { f.state.staffGradingExecution.push({ operationId: f.state.staffGradingOperation[0].id, claimId: randomUUID(), pilotId: f.pilotId,
            bridgeRevision: 1, sourceRevision: NOW.toISOString(), reservedMicroUsd: 2000n, actualMicroUsd: null, state: 'RUNNING' }); }, f => { f.state.staffSpecimen[0].analysisRevision = 1; },
        f => { f.state.staffAnalysisRevision.push({ operationId: f.state.staffGradingOperation[0].id }); }]) {
        const f = fixture('INITIALIZATION'), input = await f.input(); change(f);
        await rejected(() => f.resolve(input)); assert.equal(f.counts().writes, 0);
    }
});

test('successful or active automation and committed worker analysis cannot be abandoned', async () => {
    for (const target of ['READY_FOR_HUMAN', 'RUNNING', 'WAITING_TOOL', 'FAILED']) {
        const f = fixture(), input = await f.input(); f.state.staffOperatorRun[0].state = target;
        await rejected(() => f.resolve(input), 'RESOLUTION_REQUIRES_UNKNOWN_UNCOMMITTED'); assert.equal(f.counts().writes, 0);
    }
    for (const change of [f => { f.state.staffGradingExecution[0].state = 'COMMITTED'; }, f => { f.state.staffGradingExecution[0].state = 'RUNNING'; },
        f => { f.state.staffAnalysisRevision.push({ operationId: f.state.staffGradingOperation[0].id }); }]) {
        const f = fixture('WORKER'), input = await f.input(); change(f); await rejected(() => f.resolve(input)); assert.equal(f.counts().writes, 0);
    }
});

test('fabricated handles and stale operations authority cannot inspect, mutate or replay', async () => {
    const f = fixture();
    for (const handle of [{ ...f.staff }, { id: f.context.identity.id, role: 'ADMIN' }, null, 'session-cookie'])
        await rejected(() => f.service.inspect(handle, { kind: 'ASTRA', recordId: f.recordId, pilotId: f.pilotId }), 'SIGN_IN_REQUIRED');
    for (const change of [f => { f.context.actorKind = 'ASTRA'; }, f => { f.context.capability = 'REVIEWER'; },
        f => { f.context.session.createdAt = new Date(+NOW - 300001); }, f => { f.context.control.enabled = false; },
        f => { f.context.session.accessVersion++; }, f => { f.context.capabilityUntil = NOW; }]) {
        const g = fixture(), input = await g.input(); await g.resolve(input); change(g);
        await rejected(() => g.resolve(input), 'FRESH_HUMAN_OPERATIONS_REQUIRED'); assert.equal(g.counts().applies, 1);
    }
});

test('audit, definer, final authorization and deferred failures roll back the entire resolution', async () => {
    for (const flag of ['failAudit', 'failDefiner', 'failFinal']) {
        const f = fixture(), input = await f.input(); f.settings[flag] = true;
        await rejected(() => f.resolve(input)); assert.equal(f.state.staffOperationalResolution.length, 0); assert.equal(f.state.staffAudit.length, 0);
        assert.equal(f.state.staffOperatorRun[0].state, 'UNKNOWN'); assert.equal(f.state.staffOperatorAttempt[0].actualMicroUsd, null);
    }
});

test('a forged SQL success or accidental cost clearing is detected and rolled back', async () => {
    for (const flag of ['noopDefiner', 'mutateRetained']) {
        const f = fixture(), input = await f.input(); f.settings[flag] = true;
        await rejected(() => f.resolve(input), flag === 'noopDefiner' ? 'RESOLUTION_OUTCOME_UNCONFIRMED' : 'RESOLUTION_RETENTION_CHANGED');
        assert.equal(f.state.staffOperatorRun[0].state, 'UNKNOWN'); assert.equal(f.state.staffOperationalResolution.length, 0);
        assert.equal(f.state.staffOperatorAttempt[0].actualMicroUsd, null);
    }
});

test('lost committed reply is resolved by immutable replay without reapplying the definer', async () => {
    const f = fixture(), input = await f.input(); f.settings.lostCommitReply = true;
    await rejected(() => f.resolve(input), 'SYNTHETIC_LOST_COMMIT_REPLY'); assert.equal(f.state.staffOperatorRun[0].state, 'FAILED');
    assert.equal((await f.resolve(input)).state, 'FAILED'); assert.equal(f.counts().applies, 1);
});

test('only exact named inputs are accepted; no retry, cost, actor or approval fields can be supplied', async () => {
    const f = fixture(), input = await f.input();
    for (const extra of [{ actualMicroUsd: '0' }, { retry: true }, { actorId: f.context.identity.id }, { approve: true }])
        await rejected(() => f.resolve({ ...input, ...extra }), 'INVALID_REQUEST');
    await rejected(() => f.resolve({ ...input, reason: ' ' }), 'RESOLUTION_REQUEST_INVALID');
    await rejected(() => f.resolve({ ...input, evidenceHash: 'external-url' }), 'RESOLUTION_REQUEST_INVALID');
    assert.equal(f.counts().writes, 0); assert(!JSON.stringify(await f.inspect()).includes('private-source'));
});


test('the five immutable machine admission facts are part of the human-confirmed binding', async () => {
    for (const [key, changed] of Object.entries({ admittedSessionHash: 'b'.repeat(64), admittedAccessVersion: 2,
        operationsGrantId: randomUUID(), admissionReason: 'Different admission reason', authorizationEvidenceHash: 'c'.repeat(64) })) {
        const f = fixture('INITIALIZATION'), input = await f.input();
        f.state.staffMachineInitialization[0][key] = changed;
        await rejected(() => f.resolve(input), 'RESOLUTION_BINDING_CHANGED');
        assert.deepEqual(f.counts(), { writes: 0, applies: 0 });
    }
});
test('resolution and exact audit retain source evidence separately from incident evidence', async () => {
    const f = fixture(), input = await f.input(); await f.resolve(input);
    const row = f.state.staffOperationalResolution[0], audit = JSON.parse(f.state.staffAudit[0].details);
    assert.equal(row.sourceEvidenceHash, f.state.staffSpecimen[0].evidenceHash);
    assert.equal(audit.sourceEvidenceHash, row.sourceEvidenceHash);
    assert.equal(row.evidenceHash, input.evidenceHash); assert.notEqual(row.sourceEvidenceHash, row.evidenceHash);
});
