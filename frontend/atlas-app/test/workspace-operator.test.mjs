import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { StaffWorkspaceOperator, projectWorkspaceActivity, projectWorkspaceControl, projectWorkspaceSourceActivity } from '../lib/server/access/workspace-operator.mjs';
import { canonical } from '../lib/server/review-contract.mjs';
import { hash } from '../lib/server/policy.mjs';
import { planOperatorControl, projectOperatorControl } from '../../../packages/atlas-operator/src/workflow-control.mjs';

function step(name = 'propose_finding_change', overrides = {}) {
    const runId = randomUUID(), id = randomUUID(), assetId = randomUUID(), evidenceHash = 'a'.repeat(64), manifestHash = 'b'.repeat(64);
    const request = { runId, expectedRevision: 1, evidenceHash, manifestHash, findingId: 'FRONT:original:SURFACE', action: 'REMOVE',
        defectType: null, evidence: [{ assetId, sha256: 'c'.repeat(64), side: 'FRONT' }], rect: null,
        reason: 'PRINT_DESIGN', summary: 'The small mark follows the printed design.', alternativeExplanation: 'Possible scratch.' };
    const output = { binding: { runId, expectedRevision: 2, evidenceHash, manifestHash }, result: { status: 'PROPOSED_FOR_HUMAN_REVIEW' } };
    return { id, runId, revision: 2, toolName: name, createdAt: new Date(), requestCanonical: canonical(request), requestHash: hash(canonical(request)),
        resultCanonical: canonical(output), resultHash: hash(canonical(output)), ...overrides };
}

test('activity shows immutable original proposals separately from later human decisions without private continuation', () => {
    const row = step('propose_finding_change', { inputCanonical: 'private model reasoning', providerReceipt: { apiKey: 'secret' },
        decision: { decision: 'REJECTED', reason: 'Scratch confirmed on the original photo.', analysisRevision: 2 } });
    const [activity] = projectWorkspaceActivity([row]);
    assert.equal(activity.status, 'PROPOSED'); assert.equal(activity.actor, 'ASTRA');
    assert.equal(activity.proposal.action, 'REMOVE'); assert.equal(activity.proposal.reason, 'PRINT_DESIGN');
    assert.equal(activity.decision.decision, 'REJECTED'); assert.equal(activity.evidence[0].side, 'FRONT');
    assert.equal(JSON.stringify(activity).includes('private model'), false); assert.equal(JSON.stringify(activity).includes('apiKey'), false);
    assert.equal(Object.hasOwn(activity, 'requestCanonical'), false); assert.equal(Object.hasOwn(activity, 'resultCanonical'), false);
});

test('malformed/tampered, overlong and mismatched activity fails closed instead of inventing progress', () => {
    const row = step();
    assert.throws(() => projectWorkspaceActivity([{ ...row, resultCanonical: `${row.resultCanonical} ` }]), /WORKSPACE_OPERATOR_UNAVAILABLE/);
    assert.throws(() => projectWorkspaceActivity([{ ...row, runId: randomUUID() }]), /WORKSPACE_OPERATOR_UNAVAILABLE/);
    assert.throws(() => projectWorkspaceActivity(Array(101).fill(row)), /WORKSPACE_OPERATOR_UNAVAILABLE/);
    assert.throws(() => projectWorkspaceActivity([{ ...row, toolName: 'publish_report' }]), /WORKSPACE_OPERATOR_UNAVAILABLE/);
});

test('oversized recorded steps remain explicitly visible with no invented detail or silent omission', () => {
    const row = step('read_card_report', { unavailableReason: 'OVERSIZED_RECORDED_STEP', requestCanonical: null, resultCanonical: null });
    const [activity] = projectWorkspaceActivity([row]);
    assert.equal(activity.id, row.id); assert.equal(activity.status, 'UNAVAILABLE');
    assert.match(activity.summary, /too large/); assert.deepEqual(activity.evidence, []);
    assert.equal(Object.hasOwn(activity, 'proposal'), false);
});

test('untrusted observation text cannot carry signed URLs, local paths or provider credentials into activity', () => {
    for (const summary of ['Inspect https://private.invalid/image?signature=private', '/Users/private/secrets', 'Bearer secret-token']) {
        const row = step(), request = JSON.parse(row.requestCanonical); request.summary = summary;
        row.requestCanonical = canonical(request); row.requestHash = hash(row.requestCanonical);
        const [activity] = projectWorkspaceActivity([row]); assert.match(activity.summary, /withheld/);
        assert.equal(JSON.stringify(activity).includes(summary), false);
    }
});

test('centering activity exposes actual recorded deterministic measurements and original-photo regions retain exact coordinates', () => {
    const row = step('measure_centering'), request = JSON.parse(row.requestCanonical); request.side = 'BACK'; delete request.summary;
    row.requestCanonical = canonical(request); row.requestHash = hash(row.requestCanonical);
    const result = JSON.parse(row.resultCanonical); result.result = { side: 'BACK', borders: { leftMm: 2, rightMm: 3, topMm: 2, bottomMm: 2 },
        leftRightBalance: [40, 60], topBottomBalance: [50, 50], score: 9 };
    row.resultCanonical = canonical(result); row.resultHash = hash(row.resultCanonical);
    const [activity] = projectWorkspaceActivity([row]); assert.deepEqual(activity.measurements.borders, result.result.borders);
    assert.equal(activity.measurements.score, 9); assert.equal(activity.stage, 'CENTERING');
    const crop = step('inspect_region'), cropRequest = JSON.parse(crop.requestCanonical);
    Object.assign(cropRequest, { ...cropRequest.evidence[0], sourceSha256: cropRequest.evidence[0].sha256, rect: { x: 30, y: 40, width: 50, height: 60 } });
    crop.requestCanonical = canonical(cropRequest); crop.requestHash = hash(crop.requestCanonical);
    assert.deepEqual(projectWorkspaceActivity([crop])[0].evidence[0].rect, cropRequest.rect);
});

test('capture activity shows original photos and machine boundary selections without implying prepared or approved evidence', () => {
    const row = step('propose_physical_boundary'), request = JSON.parse(row.requestCanonical);
    Object.assign(request, { side: 'FRONT', corners: [{ x: .1, y: .1 }, { x: .9, y: .1 }, { x: .9, y: .9 }, { x: .1, y: .9 }], matColor: 'BLACK' });
    row.requestCanonical = canonical(request); row.requestHash = hash(row.requestCanonical);
    const [proposal] = projectWorkspaceActivity([row]);
    assert.equal(proposal.stage, 'PREPARATION'); assert.equal(proposal.status, 'PROPOSED');
    assert.deepEqual(proposal.proposal.corners, request.corners); assert.equal(proposal.proposal.matColor, 'BLACK');
    const handoff = step('submit_capture_preparation'), output = JSON.parse(handoff.resultCanonical), args = JSON.parse(handoff.requestCanonical);
    args.disposition = 'READY_FOR_PREPARATION'; delete args.summary;
    output.result = { actor: 'MACHINE', status: 'PENDING_ORIGINAL_PREPARATION', identityProposal: null,
        boundaries: [{ proposal: { stepId: row.id, requestHash: row.requestHash, resultHash: row.resultHash } }],
        internalStorageKey: '/private/secret/key' };
    handoff.requestCanonical = canonical(args); handoff.requestHash = hash(handoff.requestCanonical);
    handoff.resultCanonical = canonical(output); handoff.resultHash = hash(handoff.resultCanonical);
    const [activity] = projectWorkspaceActivity([handoff]);
    assert.equal(activity.selection.actor, 'MACHINE'); assert.equal(activity.selection.status, 'PENDING_ORIGINAL_PREPARATION');
    assert.match(activity.summary, /validation is still required/); assert.equal(JSON.stringify(activity).includes('/private/'), false);
    assert.equal(Object.hasOwn(activity, 'reportHash'), false);
    assert.deepEqual(activity.selection.proposals, [{ stepId: row.id, requestHash: row.requestHash }]);
});

function sourceActivity(action = 'MACHINE_SOURCE_ACTION', state = 'SUCCEEDED') {
    const machine = { runId: randomUUID(), selectionStepId: randomUUID(), selectionResultHash: 'd'.repeat(64) };
    return { id: randomUUID(), cardId: randomUUID(), action, createdAt: new Date().toISOString(), result: {
        actor: 'MACHINE', requestId: randomUUID(), action: 'PREPARE_SIDE', revision: 12,
        ...(action === 'MACHINE_SOURCE_ACTION' ? { phase: 'REQUESTED', payload: { side: 'FRONT', machine } }
            : { ...machine, state, side: 'FRONT' }) } };
}

test('source activity distinguishes retained requests, confirmed results and unresolved outcomes without provider payloads', () => {
    const requested = sourceActivity(), complete = sourceActivity('MACHINE_SOURCE_RESULT'), unknown = sourceActivity('MACHINE_SOURCE_RESULT', 'UNKNOWN');
    const corners = [{ x: .1, y: .1 }, { x: .9, y: .1 }, { x: .9, y: .9 }, { x: .1, y: .9 }];
    complete.result.preparation = { manifestHash: 'b'.repeat(64), width: 1270, height: 1778,
        sourceCorners: corners, matColor: 'BLACK', centeringProposal: null, url: 'https://private.invalid/receipt', workerReceipt: 'SECRET' };
    unknown.result.preparation = complete.result.preparation;
    const activities = projectWorkspaceSourceActivity([requested, complete, unknown]);
    assert.deepEqual(activities.map(row => row.status), ['REQUESTED', 'RECORDED', 'UNKNOWN']);
    assert.equal(activities[0].actor, 'ASTRA'); assert.match(activities[0].summary, /^Requested/);
    assert.deepEqual(activities[1].preparation.sourceCorners, corners); assert.equal(activities[1].preparation.centeringProposal, null);
    assert.equal(activities[1].selection.stepId, complete.result.selectionStepId);
    assert.match(activities[2].summary, /unconfirmed/); assert.equal(Object.hasOwn(activities[2], 'preparation'), false);
    assert.equal(JSON.stringify(activities).includes('https:'), false); assert.equal(JSON.stringify(activities).includes('SECRET'), false);
});

test('report successor activity records machine linkage without manufacturing inspection or human approval', () => {
    const row = sourceActivity('MACHINE_REPORT_SUCCESSOR');
    row.result = { actor: 'MACHINE', revision: 13, claimFence: 1, sourceRequestId: randomUUID(), captureRunId: randomUUID(), reportRunId: randomUUID(),
        grade: 10, humanApproved: true };
    const [activity] = projectWorkspaceSourceActivity([row]);
    assert.equal(activity.stage, 'INSPECTION'); assert.equal(activity.status, 'RECORDED');
    assert.equal(activity.runId, row.result.reportRunId); assert.equal(activity.captureRunId, row.result.captureRunId);
    assert.match(activity.summary, /^Linked/); assert.equal(Object.hasOwn(activity, 'grade'), false);
    assert.equal(Object.hasOwn(activity, 'humanApproved'), false);
});

test('source activity rejects malformed provenance and geometry instead of converting them into progress', () => {
    const row = sourceActivity('MACHINE_SOURCE_RESULT');
    for (const result of [{ ...row.result, actor: 'HUMAN' }, { ...row.result, state: 'RUNNING' },
        { ...row.result, selectionResultHash: 'invalid' }, { ...row.result, side: 'PAIR' },
        { ...row.result, preparation: { manifestHash: 'a'.repeat(64), width: 1270, height: 1778, sourceCorners: [], matColor: 'BLACK', centeringProposal: null } }])
        assert.throws(() => projectWorkspaceSourceActivity([{ ...row, result }]), /WORKSPACE_OPERATOR_UNAVAILABLE/);
    assert.throws(() => projectWorkspaceSourceActivity(Array(101).fill(row)), /WORKSPACE_OPERATOR_UNAVAILABLE/);
});

function fixture({ role = 'REVIEWER', state = 'RUNNING', pending = [] } = {}) {
    const actorId = randomUUID(), cardId = randomUUID(), now = new Date(), runId = randomUUID(); let mutations = 0;
    const claim = { id: randomUUID(), kind: 'ASTRA', actorId, actorName: 'Staff grader', mode: 'CONTINUOUS', fence: 1,
        accessVersion: 1, controlRevision: 1, workflowRevision: 3, captureRevision: 2, captureHash: 'a'.repeat(64), runId, claimedAt: now.toISOString() };
    let saved = { card: { id: cardId, revision: 3, state: 'IN_PROGRESS', stage: 'INSPECTION', claimFence: 1, claim,
        captureRevision: 2, captureHash: 'a'.repeat(64), startedAt: now.toISOString(), sourceOwnerId: 'private-source-owner' },
        operations: [], pending, run: { id: runId, state, revision: 1, controlState: 'RUNNING', controlRevision: 1,
            executionMode: 'CONTINUOUS', stepBudget: 0, leaseOwner: randomUUID(), leaseFence: 1,
            inputCanonical: 'private-model-continuation', deadlineAt: new Date(+now + 60_000) } };
    const policy = { astraEnabled: true, expiresAt: new Date(+now + 60_000) };
    const identity = { id: actorId, name: 'Reviewer', role, accessVersion: 1 }, staffControl = { revision: 1 };
    const store = { async transaction(_staff, work) {
        const data = structuredClone(saved);
        const context = { data, identity, control: staffControl, now, policy,
            tx: { getCard: async id => id === cardId ? data.card : null,
                getOperation: async (actor, operationId) => data.operations.find(op => op.actorId === actor && op.operationId === operationId),
                updateCard: async (row, expected) => { assert.equal(data.card.revision, expected); data.card = row; },
                insertOperation: async row => { data.operations.push(row); } } };
        const result = await work(context); saved = data; return result;
    } };
    const runPort = { activity: async () => [], read: async context => projectOperatorControl(context.data.run, context.data.pending),
        control: async (context, { action }) => {
            mutations++; const plan = planOperatorControl(context.data.run, context.data.pending, action);
            for (const attempt of context.data.pending) if (plan.cancelAttemptIds.includes(attempt.id)) attempt.state = 'FAILED';
            Object.assign(context.data.run, plan.runUpdate);
            return { ...projectOperatorControl(context.data.run, context.data.pending), runRevision: context.data.run.revision };
        } };
    const service = new StaffWorkspaceOperator({ store, runPort, projectCard: async (_context, card) => ({ id: card.id,
        revision: card.revision, state: card.state, operator: { kind: card.claim.kind, name: card.claim.actorName } }) });
    return { service, policy, identity, staffControl, cardId, actorId, runPort, get saved() { return saved; }, get mutations() { return mutations; },
        control(action, expectedRevision = saved.card.revision, operationId = randomUUID()) {
            return service.control({}, cardId, { action, expectedRevision, operationId });
        } };
}

test('same control operation recovers its committed result after a lost response without repeating a mutation', async () => {
    const f = fixture(), operationId = randomUUID();
    const first = await f.control('PAUSE', 3, operationId), again = await f.control('PAUSE', 3, operationId);
    assert.deepEqual(again, first); assert.equal(f.mutations, 1); assert.equal(f.saved.operations.length, 1);
    assert.equal(f.saved.operations[0].result.runId, f.saved.run.id);
    assert.equal(f.saved.operations[0].result.runControlRevision, f.saved.run.controlRevision);
    await assert.rejects(f.control('STEP', 4, operationId), /WORKSPACE_REQUEST_CONFLICT/);
    await assert.rejects(f.control('RESUME', 3), /WORKSPACE_REVISION_CHANGED/);
});

test('human takeover advances exact ownership fence while preserving capture, prior claim and original machine record', async () => {
    const f = fixture(), before = structuredClone(f.saved), result = await f.control('TAKE_OVER');
    assert.equal(result.card.operator.kind, 'HUMAN'); assert.equal(f.saved.card.claimFence, 2);
    assert.equal(f.saved.card.claim.actorId, f.actorId); assert.equal(f.saved.card.claim.mode, 'MANUAL');
    assert.equal(f.saved.card.captureHash, before.card.captureHash); assert.equal(f.saved.card.startedAt, before.card.startedAt);
    assert.deepEqual(f.saved.operations[0].result.priorClaim, before.card.claim);
    assert.equal(f.saved.run.state, 'FAILED'); assert.equal(f.saved.run.leaseOwner, null);
    assert.equal(f.saved.run.inputCanonical, before.run.inputCanonical); assert.equal(+f.saved.run.deadlineAt, +before.run.deadlineAt);
    assert.equal(JSON.stringify(result).includes('private-'), false);
});

test('in-flight takeover rolls back while pause retains pending work and unknown cost', async () => {
    const attempt = { id: randomUUID(), state: 'DISPATCHED', reservedMicroUsd: 23_060_000n };
    const f = fixture({ pending: [attempt] }), before = structuredClone(f.saved);
    await assert.rejects(f.control('TAKE_OVER'), /ASTRA_WORK_UNRESOLVED/);
    assert.deepEqual(f.saved, before);
    const result = await f.control('PAUSE'); assert.equal(result.control.state, 'PAUSE_REQUESTED');
    assert.equal(result.control.pending, 1); assert.equal(result.control.canTakeOver, false);
    assert.deepEqual(f.saved.pending, before.pending); assert.equal(f.saved.run.leaseOwner, before.run.leaseOwner);
});

test('observation grants no control, expired admission permits stopping but forbids new steps', async () => {
    const observer = fixture({ role: 'OBSERVER' });
    const view = await observer.service.activity({}, observer.cardId); assert.equal(view.control.canPause, false);
    await assert.rejects(observer.control('PAUSE'), /WORKSPACE_CONTROL_ACCESS_REQUIRED/); assert.equal(observer.mutations, 0);
    const f = fixture(); f.policy.astraEnabled = false; f.policy.expiresAt = new Date(0);
    assert.equal((await f.control('PAUSE')).control.state, 'PAUSED');
    await assert.rejects(f.control('STEP'), /WORKSPACE_ASTRA_NOT_READY/);
    assert.equal((await f.control('TAKE_OVER')).card.operator.kind, 'HUMAN');
});

test('bad control projections do not invent readiness and observers receive no enabled buttons', () => {
    assert.throws(() => projectWorkspaceControl(undefined), /WORKSPACE_OPERATOR_UNAVAILABLE/);
    const control = { runId: null, state: 'PAUSED', mode: 'STEP', pending: 0, settled: true,
        canPause: false, canResume: true, canStep: true, canTakeOver: true };
    assert.equal(projectWorkspaceControl(control, { canControl: false }).canTakeOver, false);
    assert.equal(projectWorkspaceControl({ ...control, settled: false }).canTakeOver, false);
});

test('another current reviewer can pause and take over but cannot commit Resume or STEP for the original claimant', async () => {
    const f = fixture(); f.identity.id = randomUUID();
    const running = await f.service.activity({}, f.cardId); assert.equal(running.control.canPause, true);
    await f.control('PAUSE'); const before = structuredClone(f.saved), mutations = f.mutations;
    const paused = await f.service.activity({}, f.cardId);
    assert.equal(paused.control.canResume, false); assert.equal(paused.control.canStep, false); assert.equal(paused.control.canTakeOver, true);
    for (const action of ['RESUME', 'STEP']) await assert.rejects(f.control(action), /WORKSPACE_CLAIM_CONFLICT/);
    assert.deepEqual(f.saved, before); assert.equal(f.mutations, mutations);
    await f.control('TAKE_OVER'); assert.equal(f.saved.card.claim.actorId, f.identity.id); assert.equal(f.saved.card.claim.kind, 'HUMAN');
});
test('revoked and re-enabled claimant generations cannot commit another step and controls retain the real run baseline', async () => {
    for (const field of ['accessVersion', 'controlRevision']) {
        const f = fixture(); await f.control('PAUSE');
        assert.equal(f.saved.operations[0].result.runRevision, f.saved.run.revision);
        if (field === 'accessVersion') f.identity.accessVersion++; else f.staffControl.revision++;
        const before = structuredClone(f.saved), mutations = f.mutations;
        for (const action of ['RESUME', 'STEP']) await assert.rejects(f.control(action), /WORKSPACE_CLAIM_CONFLICT/);
        assert.deepEqual(f.saved, before); assert.equal(f.mutations, mutations);
        assert.equal((await f.service.activity({}, f.cardId)).control.canStep, false);
    }
});

test('unknown and failed operator runs never display as running or completed', () => {
    const base = { runId: randomUUID(), state: 'RUNNING', mode: 'CONTINUOUS', pending: 1, settled: false,
        canPause: true, canResume: false, canStep: false, canTakeOver: false };
    for (const runState of ['UNKNOWN', 'FAILED', 'NEEDS_RECAPTURE', 'NEEDS_EXPERT'])
        assert.equal(projectWorkspaceControl({ ...base, runState }).state, 'NEEDS_ATTENTION');
    assert.equal(projectWorkspaceControl({ ...base, runState: 'READY_FOR_HUMAN', pending: 0 }).state, 'WAITING_REVIEW');
    assert.equal(projectWorkspaceControl({ ...base, canRecover: true }, { canControl: false }).canRecover, false);
});

test('saved-response recovery binds one durable command, preserves the claim and is idempotent across a release revision', async () => {
    const f = fixture({ state: 'UNKNOWN', pending: [{ id: randomUUID(), state: 'RECEIVED' }] });
    const original = structuredClone(f.saved.card.claim), recoveryId = randomUUID(), operationId = randomUUID();
    f.staffControl.revision = 2;
    let calls = 0, command;
    f.runPort.control = async (context, { card, action, commandId }) => {
        assert.equal(action, 'RECOVER'); assert.notEqual(commandId, operationId); calls++; command = commandId;
        context.data.run.state = 'QUEUED'; context.data.run.controlRevision++;
        return { runId: original.runId, state: 'QUEUED', mode: 'CONTINUOUS', pending: 1, settled: false,
            canPause: true, canResume: false, canStep: false, canTakeOver: false, canRecover: false,
            runRevision: 1, controlRevision: 2, recoveryId, recoveredClaim: { ...card.claim, controlRevision: 2, mode: 'CONTINUOUS' } };
    };
    await f.control('RECOVER', 3, operationId);
    const operation = f.saved.operations[0];
    assert.equal(operation.id, command); assert.equal(operation.operationId, operationId);
    assert.equal(operation.result.recoveryId, recoveryId); assert.deepEqual(operation.result.originalClaim, original);
    assert.deepEqual(operation.result.priorClaim, f.saved.card.claim);
    assert.equal(f.saved.card.claim.fence, original.fence); assert.equal(f.saved.card.claim.controlRevision, 2);
    await f.control('RECOVER', 3, operationId); assert.equal(calls, 1); assert.equal(f.saved.operations.length, 1);
    assert.equal(f.saved.pending[0].state, 'RECEIVED');
});

test('recovery rejects revoked generations, other claimants and changed photo ownership', async () => {
    for (const mutate of [f => f.identity.accessVersion++, f => { f.identity.id = randomUUID(); }, f => { f.saved.card.captureHash = 'd'.repeat(64); }]) {
        const f = fixture({ state: 'UNKNOWN' }); mutate(f); let calls = 0;
        f.runPort.control = async () => { calls++; throw Error('unexpected recovery'); };
        await assert.rejects(f.control('RECOVER'), /WORKSPACE_CLAIM_(CONFLICT|CHANGED)/);
        assert.equal(calls, 0); assert.equal(f.saved.operations.length, 0);
    }
});

test('attempt recovery projects only the exact review and keeps financial uncertainty separate from pending work', () => {
    const review = { attemptId: randomUUID(), reviewHash: 'a'.repeat(64), reservedMicroUsd: '23650000',
        dispatchedAt: new Date().toISOString(), requestCanonical: 'private continuation', dispatchClaimId: 'private claim' };
    const value = { runId: randomUUID(), state: 'NEEDS_ATTENTION', runState: 'UNKNOWN', mode: 'CONTINUOUS', pending: 1,
        settled: false, canAbandon: true, attemptRecovery: review, unconfirmedCost: { attempts: 1, reservedMicroUsd: '23650000' } };
    const projected = projectWorkspaceControl(value);
    assert.equal(projected.canAbandon, true); assert.equal(projected.pending, 1);
    assert.deepEqual(projected.attemptRecovery, { attemptId: review.attemptId, reviewHash: review.reviewHash,
        reservedMicroUsd: review.reservedMicroUsd, dispatchedAt: review.dispatchedAt });
    assert(!JSON.stringify(projected).includes('private'));
    const observer = projectWorkspaceControl(value, { canControl: false });
    assert.equal(observer.canAbandon, false); assert.equal(observer.attemptRecovery, null);
    assert.deepEqual(observer.unconfirmedCost, value.unconfirmedCost);
    assert.equal(projectWorkspaceControl({ ...value, pending: 0, settled: true, canAbandon: false, attemptRecovery: null }).pending, 0);
    for (const change of [{ reviewHash: 'bad' }, { reservedMicroUsd: '-1' }, { dispatchedAt: 'invalid' }])
        assert.throws(() => projectWorkspaceControl({ ...value, attemptRecovery: { ...review, ...change } }), /WORKSPACE_OPERATOR_UNAVAILABLE/);
    assert.throws(() => projectWorkspaceControl({ ...value, unconfirmedCost: { attempts: 0, reservedMicroUsd: '10' } }), /WORKSPACE_OPERATOR_UNAVAILABLE/);
});

test('pausing an uncertain request returns a fresh recovery review and retains the original audit projection', async () => {
    const f = fixture({ state: 'UNKNOWN', pending: [{ id: randomUUID(), state: 'DISPATCHED' }] });
    const mutate = f.runPort.control, read = f.runPort.read, attemptId = f.saved.pending[0].id;
    const review = context => ({ canAbandon: true, attemptRecovery: { attemptId,
        reviewHash: hash(canonical({ revision: context.data.card.revision, commands: context.data.operations.length })),
        reservedMicroUsd: '23650000', dispatchedAt: new Date().toISOString() } });
    let firstReview, reads = 0;
    f.runPort.control = async (context, input) => {
        const result = await mutate(context, input); firstReview = review(context);
        return { ...result, ...firstReview };
    };
    f.runPort.read = async context => { reads++; return { ...await read(context), ...review(context) }; };
    const result = await f.control('PAUSE');
    assert.equal(reads, 1); assert.equal(result.control.canAbandon, true);
    assert.notEqual(result.control.attemptRecovery.reviewHash, firstReview.attemptRecovery.reviewHash);
    assert.equal(result.control.attemptRecovery.reviewHash,
        hash(canonical({ revision: f.saved.card.revision, commands: f.saved.operations.length })));
    assert.deepEqual(f.saved.operations[0].result.control.attemptRecovery, firstReview.attemptRecovery);
    assert.equal(f.saved.pending[0].state, 'DISPATCHED');
});

test('explicit attempt abandonment binds the reviewed incident to one durable STEP command and preserves prior work', async () => {
    const attempt = { id: randomUUID(), state: 'DISPATCHED', reservedMicroUsd: 23_650_000n },
        f = fixture({ state: 'UNKNOWN', pending: [attempt] }), before = structuredClone(f.saved);
    f.staffControl.revision = 2;
    const input = { operationId: randomUUID(), expectedRevision: 3, action: 'ABANDON_AND_STEP',
        recovery: { reviewHash: 'a'.repeat(64), reason: 'Continue one step and retain the unconfirmed request.' } };
    const abandonmentId = randomUUID(); let calls = 0;
    f.runPort.control = async (context, { card, action, commandId, recovery }) => {
        calls++; assert.equal(action, input.action); assert.deepEqual(recovery, input.recovery); assert.notEqual(commandId, input.operationId);
        context.data.pending[0].state = 'ABANDONED';
        Object.assign(context.data.run, { state: 'RUNNING', controlRevision: 2, executionMode: 'STEP', stepBudget: 1 });
        return { runId: before.run.id, runRevision: before.run.revision, state: 'RUNNING', mode: 'STEP',
            stepBudget: 1, controlRevision: 2, pending: 0, settled: true, abandonmentId,
            recoveredClaim: { ...card.claim, controlRevision: 2, mode: 'STEP' } };
    };
    await f.service.control({}, f.cardId, input);
    const saved = f.saved.operations[0];
    assert.equal(saved.result.abandonmentId, abandonmentId); assert.deepEqual(saved.result.recovery, input.recovery);
    assert.deepEqual(saved.result.originalClaim, before.card.claim); assert.deepEqual(saved.result.priorClaim, f.saved.card.claim);
    assert.equal(f.saved.card.startedAt, before.card.startedAt); assert.equal(f.saved.card.captureHash, before.card.captureHash);
    assert.equal(f.saved.run.inputCanonical, before.run.inputCanonical); assert.equal(f.saved.run.revision, before.run.revision);
    assert.equal(f.saved.pending[0].reservedMicroUsd, before.pending[0].reservedMicroUsd);
    await f.service.control({}, f.cardId, input); assert.equal(calls, 1); assert.equal(f.saved.operations.length, 1);
    await assert.rejects(() => f.service.control({}, f.cardId, { ...input, recovery: { ...input.recovery, reason: 'Different incident' } }), /WORKSPACE_REQUEST_CONFLICT/);
});

test('attempt abandonment rejects malformed review, nonowners and a wider-than-one-step RPC result', async () => {
    const base = { operationId: randomUUID(), expectedRevision: 3, action: 'ABANDON_AND_STEP',
        recovery: { reviewHash: 'a'.repeat(64), reason: 'Keep the old request and continue once.' } };
    for (const recovery of [undefined, {}, { ...base.recovery, reviewHash: 'invalid' }, { ...base.recovery, reason: '' },
        { ...base.recovery, reason: 'A\nB' }, { ...base.recovery, override: true }]) {
        const f = fixture({ state: 'UNKNOWN' }); let calls = 0;
        f.runPort.control = async () => { calls++; };
        await assert.rejects(async () => f.service.control({}, f.cardId, { ...base, recovery }));
        assert.equal(calls, 0); assert.equal(f.saved.operations.length, 0);
    }
    for (const mutate of [f => { f.identity.id = randomUUID(); }, f => { f.identity.accessVersion++; },
        f => { f.policy.astraEnabled = false; }]) {
        const f = fixture({ state: 'UNKNOWN' }); mutate(f);
        f.runPort.control = async () => assert.fail('Unadmitted abandonment reached SQL port');
        await assert.rejects(() => f.service.control({}, f.cardId, base)); assert.equal(f.saved.operations.length, 0);
    }
    const f = fixture({ state: 'UNKNOWN' }), before = structuredClone(f.saved);
    f.runPort.control = async (_context, { card }) => ({ runId: before.run.id, runRevision: 1,
        state: 'RUNNING', mode: 'CONTINUOUS', pending: 0, settled: true, stepBudget: 0,
        abandonmentId: randomUUID(), recoveredClaim: { ...card.claim, mode: 'CONTINUOUS' } });
    await assert.rejects(() => f.service.control({}, f.cardId, base), /WORKSPACE_CLAIM_CHANGED/);
    assert.deepEqual(f.saved, before);
});


test('unavailable crop outcomes never claim an image was inspected', () => {
    const row = step('inspect_region'), output = JSON.parse(row.resultCanonical);
    output.result = { status: 'REGION_NOT_AVAILABLE', code: 'ASTRA_CROP_OUTSIDE_SOURCE' };
    row.resultCanonical = canonical(output); row.resultHash = hash(row.resultCanonical);
    const [event] = projectWorkspaceActivity([row]);
    assert.match(event.summary, /extended beyond/); assert.deepEqual(event.evidence, []);
    assert.equal(event.status, 'RECORDED');
});
