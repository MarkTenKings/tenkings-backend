import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { canonical, digest } from '../src/protocol.mjs';
import { enqueueWorkspaceMachineInitializationInTransaction } from '../src/workspace-initialize.mjs';

const clone = value => structuredClone(value);
const hash = value => digest(canonical(value));
function fixture() {
    const now = new Date('2026-09-09T22:00:00.000Z'), id = randomUUID(), actorId = randomUUID(), requestId = randomUUID();
    const sourceIdentity = { sourceType: 'LOCAL_FIXTURE', sourceId: `atlas-${id}`, sourceOwnerId: `atlas-staff-${actorId}` };
    const captureHash = 'a'.repeat(64), sourceConfigHash = 'b'.repeat(64), runtimeHash = 'c'.repeat(64);
    const identity = { id: actorId, role: 'REVIEWER', accessVersion: 4, revokedAt: null };
    const policy = { version: 'atlas-workspace-bridge-policy-v1', pilotId: randomUUID(), workspaceCardIds: [id, ...Array.from({ length: 9 }, () => randomUUID())],
        expiresAt: new Date(+now + 100_000).toISOString(), maxOperationsPerCard: 3, maxTotalMicroUsd: 90_000_000,
        maxCardMicroUsd: 9_000_000, reservationPerOperationMicroUsd: 100_000, maxWorkerCalls: 2, deadlineMs: 5000 };
    const operatorPolicy = { version: 'atlas-operator-control-policy-v1', pilotId: policy.pilotId, expiresAt: policy.expiresAt,
        astra: { model: 'gpt-6-astra', returnedModel: 'gpt-6-astra' } };
    const config = { mode: 'LOCAL_FIXTURE', origin: 'https://fixture.invalid', deploymentId: 'workspace-unit', releaseSha: '0'.repeat(40),
        configHash: '1'.repeat(64), clientKeyHash: '2'.repeat(64), gradingPolicyHash: '3'.repeat(64), runtimeHash };
    const bridge = { ...config, enabled: true, revision: 2, policyCanonical: canonical(policy), policyHash: hash(policy) };
    const operator = { enabled: true, mode: config.mode, configHash: runtimeHash, revision: 3,
        policyCanonical: canonical(operatorPolicy), policyHash: hash(operatorPolicy) };
    const control = { enabled: true, mode: config.mode, releaseSha: config.releaseSha, revision: 5, gradingPolicyHash: config.gradingPolicyHash };
    const workspaceControl = { enabled: true, mode: config.mode, releaseSha: config.releaseSha, configHash: '4'.repeat(64),
        cohortId: randomUUID(), maxCards: 10, astraEnabled: true, preparationEnabled: true, claimsEnabled: true, expiresAt: new Date(+now + 40_000) };
    const sourceControl = { ...workspaceControl, sourceConfigHash, pilotId: policy.pilotId, expiresAt: new Date(+now + 30_000) };
    const run = { id: randomUUID(), phase: 'CAPTURE_REVIEW', state: 'PREPARATION_READY', workspaceCardId: id, specimenId: null,
        initializationId: null, pilotId: policy.pilotId, runtimeHash, policyHash: operator.policyHash, gradingPolicyHash: config.gradingPolicyHash,
        evidenceHash: captureHash, revision: 6, leaseFence: 1, controlRevision: 2, controlState: 'RUNNING', executionMode: 'CONTINUOUS',
        stepBudget: 0, manifestHash: '5'.repeat(64), deadlineAt: new Date(+now + 20_000) };
    const claim = { id: randomUUID(), kind: 'ASTRA', actorId, fence: 1, captureRevision: 2, captureHash,
        workflowRevision: 9, runId: run.id, mode: 'CONTINUOUS' };
    const binding = { captureRevision: 2, captureHash, claimFence: 1, workflowRevision: 13 };
    const selected = { binding: { runId: run.id, expectedRevision: 6, manifestHash: run.manifestHash, evidenceHash: captureHash },
        result: { version: 'atlas-machine-capture-selection-v1', actor: 'MACHINE', status: 'PENDING_ORIGINAL_PREPARATION',
            runId: run.id, workspaceCardId: id, claimId: claim.id, claimFence: 1, captureRevision: 2, captureHash,
            workflowRevision: claim.workflowRevision, manifestHash: run.manifestHash } };
    const submitted = { disposition: 'READY_FOR_PREPARATION', runId: run.id, expectedRevision: 5,
        manifestHash: run.manifestHash, evidenceHash: captureHash };
    const step = { id: randomUUID(), runId: run.id, revision: 6, toolName: 'submit_capture_preparation',
        resultCanonical: canonical(selected), resultHash: hash(selected), requestCanonical: canonical(submitted), requestHash: hash(submitted) };
    const machine = { runId: run.id, runRevision: run.revision, leaseFence: run.leaseFence, runControlRevision: run.controlRevision,
        selectionStepId: step.id, selectionResultHash: step.resultHash };
    const operation = { id: requestId, cardId: id, actorId, operationId: randomUUID(), action: 'MACHINE_SOURCE_ACTION', inputHash: '6'.repeat(64),
        result: { requestId, action: 'INITIALIZE_REPORT', phase: 'REQUESTED', binding, payload: { machine } } };
    const workspace = { id, creatorId: actorId, cohortId: workspaceControl.cohortId, revision: 14, state: 'IN_PROGRESS', stage: 'PREPARATION',
        specimenId: id, claimFence: 1, captureHash, captureRevision: 2, claim, source: sourceIdentity,
        workspace: { pending: { requestId, action: 'INITIALIZE_REPORT', binding } } };
    const source = { id: sourceIdentity.sourceId, createdByUserId: sourceIdentity.sourceOwnerId, updatedAt: new Date(+now - 1000),
        cardProfile: 'SPORTS', capture: { original: 'synthetic-unit-validated-capture' }, reviewedDefects: [], gradeReport: null };
    const evidence = { version: 'synthetic-unit-evidence', sourceRevision: source.updatedAt.toISOString(), sourceId: source.id,
        sourceOwnerId: source.createdByUserId, originals: { FRONT: { uploadedOriginalSha256: '7'.repeat(64) }, BACK: { uploadedOriginalSha256: '8'.repeat(64) } } };
    const reportSource = src => ({ cardProfile: src.cardProfile, capture: src.capture, reviewedDefects: src.reviewedDefects, gradeReport: src.gradeReport });
    const proof = { version: 'atlas-workspace-source-admission-v1', requestId, workspaceCardId: id, actorKind: 'MACHINE',
        captureHash, claimFence: 1, sourceRevision: source.updatedAt.toISOString(), sourceHash: hash(reportSource(source)), evidenceHash: hash(evidence),
        sourceConfigHash, gradingPolicyHash: config.gradingPolicyHash,
        preparation: { preparationRelease: { fixture: 'recorded-synthetic-release' }, frontAuthorityHash: '9'.repeat(64), backAuthorityHash: 'd'.repeat(64) } };
    const admission = { requestId, cardId: id, specimenId: id, ...sourceIdentity, sourceRevision: proof.sourceRevision, sourceHash: proof.sourceHash,
        evidenceCanonical: canonical(evidence), evidenceHash: hash(evidence), admissionCanonical: canonical(proof), admissionHash: hash(proof),
        sourceConfigHash, actorKind: 'MACHINE', actorId, sessionHash: null, accessVersion: 4, createdAt: clone(now) };
    const permit = { requestId, cardId: id, runId: run.id, runRevision: 6, runControlRevision: 2, claimFence: 1, captureHash,
        selectionStepId: step.id, selectionResultHash: step.resultHash, mode: 'CONTINUOUS', state: 'ACTIVE' };
    let state = { job: null, op: null, audits: [] };
    const card = { id, ...sourceIdentity, evidenceCanonical: admission.evidenceCanonical, evidenceHash: admission.evidenceHash,
        analysisRevision: 0, draftRevision: 1 };
    const settings = { count: 10, current: true, pending: 0, otherGrading: 0, otherRuns: 0,
        usage: { total: '500000', card: '300000', operations: 0, overrun: false }, failAudit: false, cached: false };
    const events = [], writes = [], usageCalls = [];
    const row = value => ({ ...value, canonical: canonical(value), contentHash: hash(value) });
    const tx = {
        async $queryRaw(strings, ...args) {
            const q = strings.join('?');
            if (q.includes('clock_timestamp')) return [{ now: clone(now) }];
            if (q.includes('operator_workspace_count')) return [{ count: settings.count }];
            if (q.includes('workspace_pilot_subject')) { assert.deepEqual(args, [policy.pilotId, id]); return [{ id }]; }
            if (q.includes('workspace_pilot_budget_usage')) { usageCalls.push(args); return [clone(settings.usage)]; }
            if (q.includes('operator_capture_current')) return [{ current: settings.current, pending: settings.pending }];
            if (q.includes('AS "gradingCount"')) return [{ gradingCount: settings.otherGrading, runCount: settings.otherRuns }];
            const locked = { lock_workspace_private_card: row(workspace), lock_workspace_private_actor: identity,
                lock_workspace_private_run: run, lock_workspace_private_permit: permit };
            for (const [name, value] of Object.entries(locked)) if (q.includes(name)) return value ? [clone(value)] : [];
            const entries = { StaffOperatorControl: operator, StaffGradingBridgeControl: bridge, StaffControl: control,
                StaffWorkspaceControl: workspaceControl, StaffWorkspaceSourceControl: sourceControl,
                StaffWorkspaceSourceAdmission: admission, StaffWorkspaceCard: row(workspace), StaffWorkspaceOperation: row(operation),
                StaffIdentity: identity, StaffWorkspaceSourceActionPermit: permit, StaffOperatorRun: run, StaffOperatorStep: step,
                StaffMachineInitialization: state.job, StaffSpecimen: card };
            for (const [name, value] of Object.entries(entries)) if (q.includes(`"${name}"`)) return value ? [clone(value)] : [];
            throw new Error(`Unexpected unit query: ${q}`);
        },
        async $executeRaw(strings, ...args) {
            const q = strings.join('?');
            if (q.includes('pg_advisory_xact_lock') || q.includes('lock_workspace_private_controls')) return 0;
            assert(!q.includes('SET CONSTRAINTS'), 'caller must finish its source bookkeeping before deferred constraints');
            writes.push(q);
            if (q.includes('INSERT INTO atlas_staff."StaffMachineInitialization"')) {
                const names = ['id', 'specimenId', 'pilotId', 'gradingOperationId', 'runtimeHash', 'evidenceHash', 'operatorPolicyHash',
                    'bridgePolicyHash', 'gradingPolicyHash', 'sourceRevision', 'sourceHash', 'expectedReviewRevision', 'controlRevision',
                    'operatorRevision', 'bridgeRevision', 'admittedById', 'admittedAccessVersion', 'admissionReason', 'authorizationEvidenceHash',
                    'workspaceSourceRequestId', 'deadlineAt', 'createdAt'];
                assert.equal(args.length, names.length);
                state.job = { ...Object.fromEntries(names.map((name, index) => [name, clone(args[index])])), admissionKind: 'WORKSPACE_CAPTURE',
                    admittedSessionHash: null, operationsGrantId: null, expectedAnalysisRevision: 0, state: 'QUEUED',
                    dispatchedAt: null, finishedAt: null, failureCode: null }; return 1;
            }
            if (q.includes('INSERT INTO atlas_staff."StaffGradingOperation"')) {
                const names = ['id', 'specimenId', 'operationId', 'actorId', 'controlRevision', 'evidenceHash', 'expectedReviewRevision',
                    'requestCanonical', 'inputHash', 'dispatchClaimId', 'leaseExpiresAt', 'createdAt'];
                assert.equal(args.length, names.length);
                state.op = { ...Object.fromEntries(names.map((name, index) => [name, clone(args[index])])), actorKind: 'ASTRA',
                    sessionHash: null, assignmentFence: null, expectedAnalysisRevision: 0, state: 'RESERVED', leaseFence: 1 }; return 1;
            }
            if (q.includes('INSERT INTO atlas_staff."StaffAudit"')) {
                if (settings.failAudit) throw new Error('UNIT_AUDIT_COMMIT_REJECTED');
                state.audits.push({ id: args[0], event: 'WORKSPACE_MACHINE_INITIALIZATION_ADMITTED', subjectId: args[1], actorId: args[2],
                    details: JSON.parse(args[3]), createdAt: args[4] }); return 1;
            }
            throw new Error(`Unexpected unit write: ${q}`);
        },
    };
    const ports = { loadSource: async () => { events.push('load-source'); return clone(source); }, sourceEvidence: () => evidence,
        reportSource, assertSourceAdmission: async () => events.push('source-admission'),
        assertFreshDetection: async () => { events.push('fresh-detection'); if (settings.cached) throw new Error('CACHED_DETECTION_DENIED'); },
        perform: async () => { throw new Error('ENQUEUE_MUST_NOT_DISPATCH'); } };
    return { now, id, requestId, actorId, config, policy, operatorPolicy, operator, bridge, control, workspaceControl, sourceControl,
        workspace, operation, admission, identity, permit, run, step, card, source, proof, selected, evidence, settings, events, writes, usageCalls, tx, ports,
        state: () => state,
        rewriteProof() { admission.admissionCanonical = canonical(proof); admission.admissionHash = hash(proof); },
        async enqueue(input = { requestId }) {
            const before = clone(state); try { return await enqueueWorkspaceMachineInitializationInTransaction(tx, config, ports, input); }
            catch (error) { state = before; throw error; }
        } };
}

test('workspace initialization retains the original operation bytes and real admission actor without a human session or grant', async () => {
    const f = fixture(), job = await f.enqueue(), { op, audits } = f.state();
    assert.equal(job.id, f.requestId); assert.equal(job.workspaceSourceRequestId, f.requestId);
    assert.equal(job.admissionKind, 'WORKSPACE_CAPTURE'); assert.equal(job.admittedById, f.actorId);
    assert.equal(job.admittedAccessVersion, 4); assert.equal(job.admittedSessionHash, null); assert.equal(job.operationsGrantId, null);
    assert.equal(job.authorizationEvidenceHash, f.admission.admissionHash); assert.equal(job.sourceHash, f.admission.sourceHash);
    assert.equal(op.actorId, `ASTRA_INITIALIZE:${job.id}`); assert.equal(op.actorKind, 'ASTRA');
    assert.equal(op.sessionHash, null); assert.equal(op.assignmentFence, null); assert.equal(op.state, 'RESERVED');
    assert.equal(op.requestCanonical, canonical({ version: 'atlas-machine-initialize-operation-v1', jobId: job.id, runtimeHash: job.runtimeHash,
        policyHash: job.gradingPolicyHash, operatorPolicyHash: job.operatorPolicyHash, bridgePolicyHash: job.bridgePolicyHash,
        sourceId: f.card.sourceId, sourceOwnerId: f.card.sourceOwnerId, sourceRevision: job.sourceRevision, sourceHash: job.sourceHash,
        request: { action: { type: 'INITIALIZE' } } }));
    assert.equal(op.inputHash, digest(op.requestCanonical)); assert.equal(audits.length, 1); assert.equal(audits[0].actorId, f.actorId);
    for (const [key, value] of Object.entries({ requestId: f.requestId, admissionHash: f.admission.admissionHash, runId: f.run.id,
        jobId: job.id, operationId: op.id, runtimeHash: job.runtimeHash })) assert.equal(audits[0].details[key], value);
    assert.deepEqual(f.events, ['load-source', 'source-admission', 'fresh-detection']);
    assert.equal(f.card.analysisRevision, 0); assert.equal(f.permit.state, 'ACTIVE'); assert.equal(f.writes.length, 3);
});

test('lost enqueue reply recovers the one retained UNKNOWN job without reading or dispatching another source', async () => {
    const f = fixture(); await f.enqueue(); f.state().job.state = 'UNKNOWN'; f.source.gradeReport = { synthetic: 'later-result' };
    f.settings.cached = true; f.events.length = 0;
    const job = await f.enqueue(); assert.equal(job.state, 'UNKNOWN'); assert.equal(f.writes.length, 3);
    assert.equal(f.state().audits.length, 1); assert.deepEqual(f.events, []);
    f.state().job.workspaceSourceRequestId = randomUUID(); await assert.rejects(f.enqueue(), /MACHINE_ADMISSION_CONFLICT/);
});

test('a human request, fake session, changed current actor or a foreign recorded intent cannot admit a machine job', async () => {
    for (const alter of [f => { f.admission.actorKind = 'HUMAN'; }, f => { f.admission.sessionHash = 'e'.repeat(64); },
        f => { f.operation.action = 'MANUAL_ACTION'; }, f => { f.operation.actorId = randomUUID(); },
        f => { f.identity.revokedAt = f.now; }, f => { f.identity.accessVersion++; }, f => { f.identity.role = 'OPERATIONS'; }]) {
        const f = fixture(); alter(f); await assert.rejects(f.enqueue(), /WORKSPACE_MACHINE_/); assert.equal(f.state().job, null);
        assert.deepEqual(f.events, []);
    }
});

test('workspace source controls, cohort membership and current claim are rechecked before any original source read', async () => {
    for (const alter of [f => { f.workspaceControl.preparationEnabled = false; }, f => { f.workspaceControl.astraEnabled = false; },
        f => { f.sourceControl.sourceConfigHash = 'e'.repeat(64); }, f => { f.sourceControl.pilotId = randomUUID(); },
        f => { f.workspace.claim.runId = randomUUID(); }, f => { f.workspace.claim.kind = 'HUMAN'; },
        f => { f.workspace.claimFence++; }, f => { f.workspace.workspace.pending.requestId = randomUUID(); },
        f => { f.settings.current = false; }, f => { f.settings.count = 9; }]) {
        const f = fixture(); alter(f); await assert.rejects(f.enqueue()); assert.equal(f.state().job, null); assert.deepEqual(f.events, []);
    }
});

test('active consumed STEP permits and requested pauses settle their one action while unknown or paused authority is held', async () => {
    const f = fixture(); f.permit.mode = 'STEP'; f.run.executionMode = 'STEP'; f.run.controlRevision = f.permit.runControlRevision + 1;
    f.run.controlState = 'PAUSE_REQUESTED'; const job = await f.enqueue(); assert.equal(job.state, 'QUEUED');
    assert.equal(f.run.stepBudget, 0); assert.equal(f.run.controlState, 'PAUSE_REQUESTED'); assert.equal(f.permit.state, 'ACTIVE');
    for (const alter of [f => { f.permit.state = 'UNKNOWN'; }, f => { f.permit.state = 'SUCCEEDED'; },
        f => { f.run.controlState = 'PAUSED'; }, f => { f.run.controlState = 'TAKEN_OVER'; }, f => { f.run.state = 'UNKNOWN'; },
        f => { f.settings.pending = 1; }, f => { f.permit.selectionResultHash = 'e'.repeat(64); },
        f => { f.permit.runControlRevision++; }]) {
        const g = fixture(); alter(g); await assert.rejects(g.enqueue(), /WORKSPACE_MACHINE_/); assert.equal(g.state().job, null);
    }
});

test('source admission and selected step hashes cannot be relabeled as human or already prepared evidence', async () => {
    for (const alter of [f => { f.admission.admissionHash = 'e'.repeat(64); }, f => { f.proof.actorKind = 'HUMAN'; f.rewriteProof(); },
        f => { f.proof.preparation.frontAuthorityHash = 'invented'; f.rewriteProof(); },
        f => { f.proof.sourceRevision = f.now.toISOString(); f.rewriteProof(); },
        f => { f.selected.result.actor = 'HUMAN'; f.step.resultCanonical = canonical(f.selected); f.step.resultHash = hash(f.selected);
            f.permit.selectionResultHash = f.step.resultHash; f.operation.result.payload.machine.selectionResultHash = f.step.resultHash; },
        f => { f.selected.result.status = 'PREPARED'; f.step.resultCanonical = canonical(f.selected); f.step.resultHash = hash(f.selected);
            f.permit.selectionResultHash = f.step.resultHash; f.operation.result.payload.machine.selectionResultHash = f.step.resultHash; }]) {
        const f = fixture(); alter(f); await assert.rejects(f.enqueue(), /WORKSPACE_MACHINE_/); assert.equal(f.state().job, null);
    }
});

test('changed original bytes or source revision, an old report, and prior detection checkpoints all reject fresh initialization', async () => {
    for (const alter of [f => { f.source.updatedAt = f.now; }, f => { f.source.capture.original = 'substituted'; },
        f => { f.source.reviewedDefects.push({ ignored: true }); }, f => { f.source.gradeReport = { synthetic: 'old' }; },
        f => { f.settings.cached = true; }, f => { f.card.analysisRevision = 1; },
        f => { f.ports.assertSourceAdmission = async () => { throw new Error('SOURCE_RELEASE_DENIED'); }; }]) {
        const f = fixture(); alter(f); await assert.rejects(f.enqueue()); assert.equal(f.state().job, null); assert.equal(f.writes.length, 0);
    }
});

test('capture, source and infrastructure charges use the original per-workspace pilot usage without a new budget', async () => {
    const f = fixture(); f.settings.usage.total = '89900000'; f.settings.usage.card = '8900000';
    const job = await f.enqueue(); assert.equal(job.pilotId, f.policy.pilotId);
    assert.deepEqual(f.usageCalls, [[f.policy.pilotId, f.id]]); assert.equal(f.settings.usage.total, '89900000');
    for (const alter of [f => { f.settings.usage.total = '89900001'; }, f => { f.settings.usage.card = '8900001'; },
        f => { f.settings.usage.overrun = true; }, f => { f.settings.usage.operations = 3; }]) {
        const g = fixture(); alter(g); await assert.rejects(g.enqueue(), /PILOT_BUDGET_EXHAUSTED/); assert.equal(g.writes.length, 0);
    }
});

test('other unresolved grading or report work blocks admission while the settled capture remains linked', async () => {
    for (const field of ['otherGrading', 'otherRuns']) {
        const f = fixture(); f.settings[field] = 1; await assert.rejects(f.enqueue(), /MACHINE_OTHER_WORK_UNRESOLVED/);
        assert.deepEqual(f.events, []); assert.equal(f.writes.length, 0);
    }
});

test('the job deadline cannot extend capture or source authority and expired authority never enqueues', async () => {
    for (const field of ['run', 'sourceControl', 'workspaceControl']) {
        const f = fixture(), key = field === 'run' ? 'deadlineAt' : 'expiresAt'; f[field][key] = new Date(+f.now + 2000);
        assert.equal(+(await f.enqueue()).deadlineAt, +f.now + 2000);
        const g = fixture(); g[field][key] = clone(g.now); await assert.rejects(g.enqueue()); assert.equal(g.writes.length, 0);
    }
});

test('caller transaction rollback prevents a job without its immutable audit and source bookkeeping can finish before commit', async () => {
    const f = fixture(); f.settings.failAudit = true; await assert.rejects(f.enqueue(), /UNIT_AUDIT_COMMIT_REJECTED/);
    assert.deepEqual(f.state(), { job: null, op: null, audits: [] });
    f.settings.failAudit = false; await f.enqueue(); assert.equal(f.state().audits.length, 1); assert.equal(f.permit.state, 'ACTIVE');
});

test('enqueue input accepts only the retained request ID and cannot select an actor, source, grant or job ID', async () => {
    for (const key of ['actorId', 'specimenId', 'jobId', 'operationsGrantId', 'sessionHash']) {
        const f = fixture(); await assert.rejects(f.enqueue({ requestId: f.requestId, [key]: randomUUID() })); assert.equal(f.writes.length, 0);
    }
});
