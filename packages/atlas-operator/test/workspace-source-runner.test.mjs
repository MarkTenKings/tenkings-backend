import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { canonical, digest } from '@atlas/service-bridge/protocol';
import { CAPTURE_TOOL_NAMES, selectedCapturePreparation } from '../src/capture-protocol.mjs';
import { MODEL, PRICING, REPORT_TOOL_NAMES } from '../src/responses.mjs';
import { createWorkspaceSourceRunner } from '../src/workspace-source-runner.mjs';

const NOW = new Date('2026-09-10T04:00:00Z'), LATER = new Date('2026-09-16T20:41:57Z');
const corners = [{ x: .1, y: .1 }, { x: .9, y: .1 }, { x: .9, y: .9 }, { x: .1, y: .9 }];
const inner = [{ x: .05, y: .05 }, { x: .95, y: .05 }, { x: .95, y: .95 }, { x: .05, y: .95 }];
const clone = value => structuredClone(value), same = (left, right) => assert.deepEqual(left, right);
const encoded = value => ({ ...value, canonical: canonical(value), contentHash: digest(canonical(value)) });
const astra = { version: 'atlas-astra-policy-v1', model: MODEL, returnedModel: MODEL, effort: 'max', serviceTier: 'default',
    maxOutputTokens: 128, requestTimeoutMs: 1000, pricingVersion: PRICING.version,
    inputNanoUsdPerToken: PRICING.inputNanoUsdPerToken, outputNanoUsdPerToken: PRICING.outputNanoUsdPerToken };

async function fixture({ year = '2026', authorizeCommand } = {}) {
    const cardId = randomUUID(), actorId = randomUUID(), creatorId = randomUUID(), pilotId = randomUUID(), runId = randomUUID();
    const operatorConfig = { mode: 'LOCAL_FIXTURE', releaseSha: 'a'.repeat(40), configHash: 'b'.repeat(64), buildHash: 'c'.repeat(64), providerBindingHash: 'd'.repeat(64) };
    const policy = { version: 'atlas-operator-control-policy-v1', pilotId, expiresAt: LATER.toISOString(), prompt: 'Fixture operator.', astra,
        tools: REPORT_TOOL_NAMES, captureTools: CAPTURE_TOOL_NAMES, maxAttemptsPerCard: 50, maxStepsPerRun: 64, maxRunMs: 3600000, leaseMs: 30000, concurrency: 1 };
    const budget = { version: 'atlas-workspace-bridge-policy-v1', pilotId, workspaceCardIds: [cardId, ...Array.from({ length: 9 }, () => randomUUID())],
        expiresAt: LATER.toISOString(), maxOperationsPerCard: 20, maxTotalMicroUsd: 90000000, maxCardMicroUsd: 9000000,
        reservationPerOperationMicroUsd: 100000, maxWorkerCalls: 2, deadlineMs: 200000 };
    const control = { ...operatorConfig, enabled: true, policyCanonical: canonical(policy), policyHash: digest(canonical(policy)) };
    const bridge = { enabled: true, mode: operatorConfig.mode, gradingPolicyHash: 'e'.repeat(64), policyCanonical: canonical(budget), policyHash: digest(canonical(budget)) };
    const identity = { id: actorId, role: 'REVIEWER', accessVersion: 2, revokedAt: null };
    const run = { id: runId, workspaceCardId: cardId, phase: 'CAPTURE_REVIEW', specimenId: null, initializationId: null, captureRunId: null,
        expectedAnalysisRevision: 0, expectedReviewRevision: 0, state: 'PREPARATION_READY', revision: 6, leaseFence: 3,
        controlRevision: 4, controlState: 'RUNNING', executionMode: 'CONTINUOUS', stepBudget: 0,
        pilotId, policyHash: control.policyHash, runtimeHash: operatorConfig.configHash, gradingPolicyHash: bridge.gradingPolicyHash,
        evidenceHash: 'f'.repeat(64), deadlineAt: new Date(+NOW + 3600000) };
    const card = { id: cardId, creatorId, cohortId: randomUUID(), revision: 8, state: 'IN_PROGRESS', stage: 'PREPARATION', specimenId: null,
        captureHash: run.evidenceHash, captureRevision: 1, claimFence: 2, startedAt: NOW.toISOString(),
        source: { sourceType: 'SPEEDSTER', sourceId: `atlas-${cardId}`, sourceOwnerId: `atlas-staff-${creatorId}` },
        claim: { id: randomUUID(), kind: 'ASTRA', actorId, actorName: 'Fixture human', accessVersion: 2, controlRevision: 1,
            runId, fence: 2, captureHash: run.evidenceHash, captureRevision: 1, workflowRevision: 8, mode: 'CONTINUOUS' },
        identity: { category: 'SPORTS', playerName: '', year, manufacturer: 'Fixture', productSet: 'Fixture Set' },
        workspace: { cornerShape: 'SQUARE' }, updatedAt: NOW.toISOString() };
    const assets = ['FRONT', 'BACK'].map((side, i) => ({ assetId: randomUUID(), side, view: 'ORIGINAL', sha256: String(i + 1).repeat(64),
        contentType: 'image/jpeg', byteCount: 4096, width: 800, height: 1000 }));
    const manifest = { version: 'atlas-operator-capture-manifest-v1', phase: 'CAPTURE_REVIEW', runId, workspaceCardId: cardId,
        claimId: card.claim.id, claimFence: 2, captureRevision: 1, workflowRevision: 8, evidenceHash: run.evidenceHash,
        identity: card.identity, cornerShape: 'SQUARE', assets };
    run.manifestCanonical = canonical(manifest); run.manifestHash = digest(run.manifestCanonical);
    const binding = { runId, evidenceHash: run.evidenceHash, manifestHash: run.manifestHash, expectedRevision: 5 }, steps = new Map();
    const proposal = (name, extra, ordinal) => {
        const id = randomUUID(), args = { ...binding, expectedRevision: ordinal, ...extra }, requestCanonical = canonical(args);
        const ref = { stepId: id, requestHash: digest(requestCanonical) };
        const resultCanonical = canonical({ binding: { ...binding, expectedRevision: ordinal + 1 },
            result: { actor: 'MACHINE', status: 'PROPOSED_FOR_PREPARATION', proposal: ref } });
        steps.set(id, { id, runId, toolName: name, revision: ordinal + 1, requestCanonical, requestHash: ref.requestHash,
            resultCanonical, resultHash: digest(resultCanonical) }); return ref;
    };
    const evidence = assets.map(({ assetId, side, sha256 }) => ({ assetId, side, sha256 }));
    const identityProposal = proposal('propose_capture_identity', { fields: [{ field: 'playerName', value: 'Visible Player', evidence: [evidence[0]] }], summary: 'Visible text.' }, 1);
    const boundaries = evidence.map((ref, i) => ({ side: ref.side, proposal: proposal('propose_physical_boundary',
        { side: ref.side, corners, matColor: 'BLACK', evidence: [ref], summary: 'Visible edges.' }, i + 2) }));
    const args = { ...binding, disposition: 'READY_FOR_PREPARATION', identityProposal, boundaries, summary: 'Recorded machine selection.' };
    const selection = await selectedCapturePreparation({ call: { name: 'submit_capture_preparation', args }, run: { ...run, revision: 5 }, manifest,
        tx: { staffOperatorStep: { findUnique: async ({ where }) => steps.get(where.id) } } }, async () => {});
    const selected = { id: randomUUID(), runId, revision: 6, toolName: 'submit_capture_preparation', attemptId: randomUUID(),
        requestCanonical: canonical(args), requestHash: digest(canonical(args)),
        resultCanonical: canonical({ binding: { ...binding, expectedRevision: 6 }, result: selection }), createdAt: new Date(+NOW - 1000) };
    selected.resultHash = digest(selected.resultCanonical); steps.set(selected.id, selected);
    const images = assets.map(asset => { const canonicalText = canonical({ asset }); return { canonical: canonicalText, hash: digest(canonicalText) }; });
    const f = { state: { run, card, identity, control, bridge, steps, images, operations: new Map(), permits: new Map(),
        sourceStates: new Map(), successor: null, enabled: true, now: NOW, count: 10, attempts: 0 }, calls: [], statuses: [],
        permitClaims: 0, settlements: 0, successorCalls: 0, failPermit: false, failCommit: false, beforeReply: null, behavior: null };
    const inside = new AsyncLocalStorage(), current = () => inside.getStore() ?? f.state;
    const insert = event => current().operations.set(event.id, encoded(event));
    const findEvent = key => [...current().operations.values()].find(value => value.actorId === actorId && value.operationId === key);
    const finish = (requestId, outcome) => {
        const s = current(), permit = s.permits.get(requestId); assert(permit); assert.equal(s.sourceStates.get(requestId)?.state, outcome);
        if (permit.state !== 'ACTIVE') { assert.equal(permit.state, outcome); return; }
        permit.state = outcome; f.settlements++;
        if (outcome !== 'UNKNOWN' && (permit.mode === 'STEP' || s.run.controlState === 'PAUSE_REQUESTED')) {
            s.run.controlState = 'PAUSED'; s.run.stepBudget = 0; s.run.controlRevision++;
        }
    };
    const database = {
        async $queryRaw(strings, ...values) {
            const sql = strings.join('?'), s = current();
            if (sql.includes('operator_workspace_count')) return [{ count: s.count }];
            if (sql.includes('"StaffOperatorControl"')) return [s.control];
            if (sql.includes('"StaffGradingBridgeControl"')) return [s.bridge];
            if (sql.includes('lock_workspace_private_run')) return [s.run];
            if (sql.includes('"StaffWorkspaceCard"')) return [encoded(s.card)];
            if (sql.includes('"StaffOperatorAttempt"')) return [{ count: BigInt(s.attempts) }];
            if (sql.includes('"StaffOperatorImage"')) return clone(s.images);
            if (sql.includes('"StaffOperatorStep"')) return sql.includes('"toolName"=') ? [s.steps.get(selected.id)] : [s.steps.get(values[0])];
            if (sql.includes('"StaffWorkspaceOperation"')) {
                if (sql.includes("action='MACHINE_REPORT_SUCCESSOR'")) return [...s.operations.values()].filter(value => value.action === 'MACHINE_REPORT_SUCCESSOR');
                if (sql.includes("action='OPERATOR_CONTROL'")) return [...s.operations.values()].filter(value => value.action === 'OPERATOR_CONTROL'
                    && value.result.runControlRevision === Number(values[3]) && value.actorId === values[1]);
                const result = sql.includes('"operationId"=') ? findEvent(values[1]) : s.operations.get(values[0]); return result ? [clone(result)] : [];
            }
            if (sql.includes('claim_workspace_source_permit')) {
                if (f.failPermit) throw Error('fixture denied permit');
                const requestId = values[0]; assert(!s.permits.has(requestId)); assert.equal(s.run.controlState, 'RUNNING');
                const op = s.operations.get(requestId), machine = op.result.payload.machine;
                assert.equal(s.card.workspace.pending.requestId, requestId);
                const permit = { requestId, cardId, runId, runRevision: s.run.revision, runControlRevision: s.run.controlRevision,
                    captureHash: s.card.captureHash, claimFence: s.card.claimFence, mode: s.run.executionMode,
                    state: 'ACTIVE', selectionStepId: machine.selectionStepId, selectionResultHash: machine.selectionResultHash };
                if (permit.mode === 'STEP') { assert.equal(s.run.stepBudget, 1); s.run.stepBudget = 0; s.run.controlRevision++; }
                f.permitClaims++; s.permits.set(requestId, permit); return [clone(permit)];
            }
            throw Error(`Unexpected query: ${sql}`);
        },
        async $executeRaw(strings, ...values) {
            const sql = strings.join('?'), s = current();
            if (sql.includes('pg_advisory_xact_lock')) return 1;
            if (sql.includes('SET CONSTRAINTS')) { if (f.failCommit) throw Error('fixture deferred rollback'); return 1; }
            if (sql.includes('INSERT INTO atlas_staff."StaffWorkspaceOperation"')) {
                const text = values[6], event = JSON.parse(text); assert.equal(canonical(event), text); assert.equal(digest(text), values[7]);
                assert(!s.operations.has(event.id)); assert(!findEvent(event.operationId)); insert(event); return 1;
            }
            if (sql.includes('UPDATE atlas_staff."StaffWorkspaceCard"')) {
                assert.equal(values[6], s.card.id); assert.equal(values[7], s.card.revision);
                const next = JSON.parse(values[3]); assert.equal(next.revision, s.card.revision + 1);
                assert.equal(digest(values[3]), values[4]); s.card = next; return 1;
            }
            if (sql.includes('finish_workspace_source_permit')) { finish(values[0], values[1]); return 1; }
            throw Error(`Unexpected mutation: ${sql}`);
        },
    };
    let queue = Promise.resolve();
    const client = { async $transaction(work) {
        assert(!inside.getStore(), 'never nest private source transactions');
        const previous = queue; let release; queue = new Promise(resolve => { release = resolve; }); await previous;
        const state = clone(f.state); try { const result = await inside.run(state, () => work(database)); f.state = state; return result; }
        finally { release(); }
    } };
    const authority = {
        async controls() { const s = current(); assert(s.enabled && s.now < LATER); return { now: s.now,
            staff: { mode: operatorConfig.mode, revision: 1, gradingPolicyHash: bridge.gradingPolicyHash }, source: { pilotId },
            workspace: { claimsEnabled: true, astraEnabled: true, preparationEnabled: true } }; },
        async current(_tx, request) {
            const s = current(), identity = s.identity, card = s.card;
            assert(!identity.revokedAt && identity.role === 'REVIEWER'); assert.equal(identity.id, request.scope.actorId);
            assert.equal(request.scope.actorKind, 'MACHINE'); assert.equal(request.scope.accessVersion, identity.accessVersion);
            assert.equal(request.scope.accessVersion, card.claim.accessVersion); assert.equal(request.scope.controlRevision, card.claim.controlRevision);
            assert.equal(request.binding.captureHash, card.captureHash); assert.equal(request.binding.claimFence, card.claimFence);
            assert.equal(request.binding.captureRevision, card.captureRevision);
            assert(card.revision === request.binding.workflowRevision || same(request.binding, card.workspace.pending.binding) === undefined);
            return { identity, card, staff: { revision: 1 }, originals: Object.fromEntries(assets.map(asset => [asset.side, { verification: asset }])) };
        },
        async loadInTransaction(request, tx) {
            const s = current(), op = s.operations.get(request.requestId); assert(op); assert.equal(op.action, 'MACHINE_SOURCE_ACTION');
            assert.equal(op.result.accessVersion, s.identity.accessVersion); same(op.result.binding, s.card.workspace.pending.binding);
            await authority.current(tx, request); return { request, card: clone(s.card), operation: op };
        },
        async recheck(request, _authorized, tx) { await authority.loadInTransaction(request, tx); },
    };
    const source = {};
    const requestResult = request => {
        const s = current(), op = s.operations.get(request.requestId), side = op.result.payload.side;
        return { requestId: request.requestId, cardId, captureHash: request.binding.captureHash, claimFence: request.binding.claimFence,
            action: op.result.action, ...(side ? { side } : {}), state: 'SUCCEEDED', ...(side ? {
                preparation: { manifestHash: (side === 'FRONT' ? '1' : '2').repeat(64), width: 1270, height: 1778,
                    sourceCorners: corners, matColor: 'BLACK', centeringProposal: inner },
            } : { specimenId: cardId }) };
    };
    for (const method of ['prepare', 'finalize']) source[method] = async (request, options) => {
        assert(!inside.getStore(), 'source workers must run outside the workspace transaction');
        assert(options.signal instanceof AbortSignal); assert(!f.calls.some(call => call.request.requestId === request.requestId), 'never redispatch an existing intent');
        f.calls.push({ method, request: clone(request) });
        let result = requestResult(request);
        if (f.behavior) result = await f.behavior(request, result);
        f.state.sourceStates.set(request.requestId, clone(result));
        if (method === 'finalize' && result.state === 'SUCCEEDED') {
            f.state.card = { ...f.state.card, specimenId: cardId, revision: f.state.card.revision + 1 };
        }
        await f.beforeReply?.(request, result); return result;
    };
    source.status = async request => { assert(!inside.getStore()); f.statuses.push(clone(request));
        return clone(f.state.sourceStates.get(request.requestId) ?? { ...requestResult(request), state: 'PENDING', preparation: undefined, specimenId: undefined }); };
    const enqueueSuccessor = async (_tx, config, { requestId }) => {
        same(config, operatorConfig); const s = current(); f.successorCalls++;
        if (s.successor) return s.successor;
        assert.equal(s.card.workspace.pending.requestId, requestId); assert.equal(s.permits.get(requestId).state, 'SUCCEEDED');
        assert.equal(findEvent(`source-result_${requestId}`).result.state, 'SUCCEEDED'); assert.equal(s.card.specimenId, cardId);
        s.successor = { id: randomUUID(), controlState: s.run.controlState, phase: 'REPORT_REVIEW' };
        s.card.claim.runId = s.successor.id; s.card.revision++; s.card.stage = 'INSPECTION'; delete s.card.workspace.pending;
        insert({ id: randomUUID(), actorId, cardId, operationId: `machine-report-${requestId}`, action: 'MACHINE_REPORT_SUCCESSOR',
            inputHash: digest(requestId), result: { actor: 'MACHINE', sourceRequestId: requestId, captureRunId: runId,
                reportRunId: s.successor.id, claimFence: s.card.claimFence }, createdAt: NOW.toISOString() });
        return s.successor;
    };
    const runner = createWorkspaceSourceRunner({ client, authority, source, operatorConfig, enqueueSuccessor, authorizeCommand });
    const humanControl = action => {
        const s = f.state; s.run.controlRevision++; s.run.controlState = 'RUNNING'; s.run.executionMode = action === 'STEP' ? 'STEP' : 'CONTINUOUS';
        s.run.stepBudget = action === 'STEP' ? 1 : 0; s.card.revision++;
        const event = { id: randomUUID(), actorId, cardId, action: 'OPERATOR_CONTROL', operationId: randomUUID(), inputHash: '0'.repeat(64),
            result: { action, runId, runControlRevision: s.run.controlRevision, claimFence: s.card.claimFence,
                control: { state: 'RUNNING', mode: s.run.executionMode } }, createdAt: NOW.toISOString() };
        s.operations.set(event.id, encoded(event));
    };
    return { ...f, f, runId, actorId, cardId, selected, manifest, database, client, authority, runner, humanControl, finishSource: finish,
        start: options => runner.run({ runId, ...options }) };
}

test('source coordinator: exact Front, Back, initialization sequence and immutable machine receipts use no human flags', async () => {
    const f = await fixture(), before = clone(f.f.state.card.claim), result = await f.start();
    assert.equal(result.state, 'READY'); assert.equal(result.actions, 3); assert.equal(result.reportRunId, f.f.state.successor.id);
    assert.deepEqual(f.f.calls.map(call => [call.method, f.f.state.operations.get(call.request.requestId).result.payload.side]),
        [['prepare', 'FRONT'], ['prepare', 'BACK'], ['finalize', undefined]]);
    assert.equal(f.f.permitClaims, 3); assert.equal(f.f.settlements, 3);
    for (const { request } of f.f.calls) {
        same(Object.keys(request.scope).sort(), ['actorKind', 'actorId', 'accessVersion', 'controlRevision', 'runId', 'runRevision', 'leaseFence', 'runControlRevision'].sort());
        assert.equal(request.scope.actorId, f.actorId); assert.equal(request.scope.accessVersion, 2); assert.equal(request.scope.actorKind, 'MACHINE');
        const op = f.f.state.operations.get(request.requestId); assert.equal(op.id, op.result.requestId); same(op.result.binding, request.binding);
    }
    const workspace = f.f.state.card.workspace;
    assert.equal(f.f.state.card.identity.playerName, ''); assert.equal(workspace.identity, undefined);
    assert.equal(workspace.machineCapture.identity.playerName, 'Visible Player');
    assert.equal(workspace.preparation.FRONT.actor, 'MACHINE'); assert.equal(workspace.centering.BACK.actor, 'MACHINE');
    assert.equal(workspace.centering.BACK.confirmed, undefined); assert.equal(workspace.pending, undefined);
    assert(!JSON.stringify(workspace).includes('sessionHash')); assert(!JSON.stringify(workspace).includes('https://'));
    same({ ...f.f.state.card.claim, runId: before.runId }, before);
    const replay = await f.start(); assert.equal(replay.state, 'READY'); assert.equal(replay.actions, 0); assert.equal(f.f.calls.length, 3);
});

test('source coordinator: each STEP needs a new real human permit and covers only one source action', async () => {
    const f = await fixture(); f.f.state.run.controlState = 'PAUSED'; f.f.state.run.executionMode = 'STEP';
    assert.equal((await f.start()).state, 'PAUSED'); assert.equal(f.f.calls.length, 0);
    for (let i = 0; i < 3; i++) {
        f.humanControl('STEP'); const result = await f.start(); assert.equal(result.actions, 1);
        assert.equal(result.state, i === 2 ? 'READY' : 'PAUSED'); assert.equal(f.f.calls.length, i + 1);
        if (i < 2) { assert.equal((await f.start()).state, 'PAUSED'); assert.equal(f.f.calls.length, i + 1); }
    }
    assert.equal(f.f.state.successor.controlState, 'PAUSED'); assert.equal(f.f.permitClaims, 3);
});

test('source coordinator: concurrent runners share one intent and only its winner may dispatch', async () => {
    const f = await fixture(); let release, reached;
    const entered = new Promise(resolve => { reached = resolve; }), wait = new Promise(resolve => { release = resolve; });
    f.f.behavior = async (_request, result) => { if (f.f.calls.length === 1) { reached(); await wait; } return result; };
    const first = f.start(); await entered; const second = await f.start(); assert.equal(second.state, 'HELD');
    assert.equal(f.f.calls.length, 1); assert.equal(f.f.statuses.length, 1); release(); assert.equal((await first).state, 'READY');
    assert.equal(f.f.calls.length, 3); assert.equal(f.f.permitClaims, 3);
});

test('source coordinator: lost source reply is recovered by status on the same retained request', async () => {
    const f = await fixture(); let lost = true;
    f.f.beforeReply = async () => { if (lost) { lost = false; throw Error('lost reply with private transport detail'); } };
    const held = await f.start(); assert.equal(held.state, 'HELD'); assert.equal(held.actions, 1);
    assert(!JSON.stringify(held).includes('private')); const requestId = f.f.state.card.workspace.pending.requestId;
    const recovered = await f.start(); assert.equal(recovered.state, 'READY'); assert.equal(recovered.actions, 2);
    assert.equal(f.f.statuses[0].requestId, requestId); assert.equal(f.f.calls.filter(call => call.request.requestId === requestId).length, 1);
});

test('source coordinator: source host may settle and pause its STEP permit before a lost reply is recovered', async () => {
    const f = await fixture(); f.humanControl('STEP'); let lose = true;
    f.f.beforeReply = async (request, result) => {
        f.finishSource(request.requestId, result.state);
        if (lose) { lose = false; throw Error('lost settled source reply'); }
    };
    assert.equal((await f.start()).state, 'HELD'); assert.equal(f.f.state.run.controlState, 'PAUSED');
    assert(f.f.state.card.workspace.pending); const result = await f.start();
    assert.equal(result.state, 'PAUSED'); assert.equal(result.actions, 0); assert.equal(f.f.calls.length, 1);
    assert.equal(f.f.state.card.workspace.pending, undefined); assert.equal(f.f.state.card.workspace.preparation.FRONT.status, 'PREPARED');
    f.humanControl('STEP'); assert.equal((await f.start()).state, 'PAUSED'); assert.equal(f.f.calls.length, 2);
});

test('source coordinator: unknown outcome retains pending and its immutable permit without advancing or retrying', async () => {
    const f = await fixture(); f.f.behavior = async (_request, result) => ({ requestId: result.requestId, cardId: result.cardId,
        captureHash: result.captureHash, claimFence: result.claimFence, action: result.action, side: result.side,
        state: 'UNKNOWN', failureCode: 'WORKSPACE_WORKER_OUTCOME_UNCONFIRMED' });
    const result = await f.start(); assert.equal(result.state, 'NEEDS_ATTENTION'); assert.equal(f.f.calls.length, 1);
    const pending = clone(f.f.state.card.workspace.pending), permit = f.f.state.permits.get(pending.requestId);
    assert.equal(permit.state, 'UNKNOWN'); assert.equal((await f.start()).state, 'NEEDS_ATTENTION');
    same(f.f.state.card.workspace.pending, pending); assert.equal(f.f.calls.length, 1); assert.equal(f.f.statuses.length, 1);
});

test('source coordinator: a known failure settles once and cannot buy another attempt for the same selection', async () => {
    const f = await fixture(); f.f.behavior = async (_request, result) => ({ requestId: result.requestId, cardId: result.cardId,
        captureHash: result.captureHash, claimFence: result.claimFence, action: result.action, side: result.side,
        state: 'FAILED', failureCode: 'WORKSPACE_MACHINE_PHYSICAL_REVIEW_REQUIRED' });
    assert.equal((await f.start()).state, 'NEEDS_ATTENTION'); assert.equal(f.f.state.card.workspace.pending, undefined);
    assert.equal((await f.start()).state, 'NEEDS_ATTENTION'); assert.equal(f.f.calls.length, 1); assert.equal(f.f.statuses.length, 0);
});

test('source coordinator: current phase, claim, actor, access version, expiry, cohort and operator config deny before writes', async () => {
    for (const change of [
        s => { s.run.state = 'RUNNING'; }, s => { s.card.claim.kind = 'HUMAN'; }, s => { s.card.state = 'WAITING'; },
        s => { s.identity.accessVersion++; }, s => { s.identity.role = 'OBSERVER'; }, s => { s.identity.revokedAt = NOW; },
        s => { s.now = LATER; }, s => { s.run.deadlineAt = NOW; }, s => { s.count = 9; },
        s => { s.control.configHash = '0'.repeat(64); }, s => { s.attempts = 1; }, s => { s.card.claimFence++; },
    ]) { const f = await fixture(); change(f.f.state); const result = await f.start();
        assert.equal(result.state, 'HELD'); assert.equal(f.f.calls.length, 0); assert.equal(f.f.state.operations.size, 0); }
});

test('source coordinator: proposal and delivery corruption is rejected before creating a source permit', async () => {
    for (const change of [
        (f, s) => { s.steps.get(f.selected.id).resultHash = '0'.repeat(64); },
        (_f, s) => { [...s.steps.values()][0].requestCanonical = '{}'; },
        (_f, s) => { s.images = []; },
        (_f, s) => { s.card.identity.playerName = 'Changed after run'; },
    ]) { const f = await fixture(); change(f, f.f.state); assert.equal((await f.start()).state, 'HELD');
        assert.equal(f.f.permitClaims, 0); assert.equal(f.f.state.operations.size, 0); }
});

test('source coordinator: incomplete selected identity cannot consume a source permit or create an unresolvable request', async () => {
    const f = await fixture({ year: '' }), result = await f.start();
    assert.equal(result.state, 'HELD'); assert.equal(result.code, 'ASTRA_SOURCE_IDENTITY_REQUIRED');
    assert.equal(f.f.permitClaims, 0); assert.equal(f.f.state.operations.size, 0); assert.equal(f.f.calls.length, 0);
});

test('source coordinator: invalid source geometry, mismatched binding or extra secret fields retain the unresolved intent', async () => {
    for (const change of [
        result => ({ ...result, requestId: randomUUID() }), result => ({ ...result, url: 'https://private.invalid/secret' }),
        result => ({ ...result, preparation: { ...result.preparation, centeringProposal: null } }),
        result => ({ ...result, preparation: { ...result.preparation, sourceCorners: inner } }),
        result => ({ ...result, preparation: { ...result.preparation, confirmed: true } }),
    ]) { const f = await fixture(); f.f.behavior = async (_request, result) => change(result);
        const held = await f.start(); assert.equal(held.state, 'HELD'); assert(f.f.state.card.workspace.pending);
        assert.equal(f.f.calls.length, 1); assert.equal(f.f.state.operations.size, 1); assert.equal(f.f.settlements, 0);
        assert(!JSON.stringify(held).includes('secret'));
    }
});

test('source coordinator: pause or revocation during the current action cannot begin Back or initialization', async () => {
    const f = await fixture(); f.f.beforeReply = async () => { f.f.state.run.controlState = 'PAUSE_REQUESTED'; f.f.state.run.controlRevision++; };
    assert.equal((await f.start()).state, 'PAUSED'); assert.equal(f.f.calls.length, 1);
    const g = await fixture(); g.f.beforeReply = async () => { g.f.state.identity.revokedAt = NOW; };
    assert.equal((await g.start()).state, 'HELD'); assert(g.f.state.card.workspace.pending); assert.equal(g.f.calls.length, 1);
    assert.equal((await g.start()).state, 'HELD'); assert.equal(g.f.statuses.length, 0);
});

test('source coordinator: permit/deferred failure rolls back intent and workspace atomically before any external call', async () => {
    for (const setting of ['failPermit', 'failCommit']) {
        const f = await fixture(), original = clone(f.f.state.card); f.f[setting] = true;
        assert.equal((await f.start()).state, 'HELD'); same(f.f.state.card, original);
        assert.equal(f.f.state.operations.size, 0); assert.equal(f.f.state.permits.size, 0); assert.equal(f.f.calls.length, 0);
    }
});

test('source coordinator: caller stop is finite even for an uncooperative source and leaves the committed request recoverable', async () => {
    const f = await fixture(), controller = new AbortController();
    f.f.behavior = async () => { setImmediate(() => controller.abort()); return new Promise(() => {}); };
    const result = await f.start({ signal: controller.signal }); assert.equal(result.state, 'HELD'); assert.equal(result.actions, 1);
    assert.equal(f.f.calls.length, 1); assert(f.f.state.card.workspace.pending); assert.equal(f.f.state.operations.size, 1);
    assert.equal((await f.start({ signal: controller.signal })).state, 'STOPPED'); assert.equal(f.f.calls.length, 1);
});


test('fixed command guard runs inside the original transaction before any fresh intent or permit', async () => {
    const commandId = randomUUID(); let checks = 0;
    const f = await fixture({ async authorizeCommand(tx, input) {
        checks++; assert.equal(input.commandId, commandId); assert.equal(input.intent, null);
        assert(tx && input.run && input.card);
        throw Object.assign(new Error('stale human command'), { code: 'ASTRA_DISPATCH_COMMAND_CHANGED' });
    } });
    await assert.rejects(() => f.start()); assert.equal(checks, 0);
    const before = clone(f.f.state), result = await f.start({ commandId });
    assert.equal(result.state, 'HELD'); assert.equal(result.code, 'ASTRA_DISPATCH_COMMAND_CHANGED'); assert.equal(checks, 1);
    assert.deepEqual(f.f.state, before); assert.equal(f.f.calls.length, 0); assert.equal(f.f.permitClaims, 0);
});
