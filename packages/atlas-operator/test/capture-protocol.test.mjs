import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { canonical, digest, parsePilotPolicy } from '@atlas/service-bridge/protocol';
import { createOperatorImagePacket, OPERATOR_IMAGE_DECODER } from '@atlas/service-bridge/operator-images';
import { syntheticPng } from '../../atlas-contracts/test/fixtures.mjs';
import { CAPTURE_TOOL_NAMES, CAPTURE_TOOL_SCHEMAS, parseCaptureManifest, assertCaptureScope,
    validateCaptureProposal, selectedCapturePreparation } from '../src/capture-protocol.mjs';
import { operatorAdapters } from '../src/adapters.mjs';
import { OperatorLedger } from '../src/ledger.mjs';
import { MODEL, PRICING, REPORT_TOOL_NAMES, instructionsFor, requestReservation, buildRequest, toolImageOutput } from '../src/responses.mjs';
import { parseControlPolicy, toolsForRun } from '../src/policy.mjs';
import { pauseAfterAppliedAction, planOperatorControl, projectOperatorControl, ACTIVE_RUN_STATES } from '../src/workflow-control.mjs';

const corners = [{ x: .1, y: .1 }, { x: .9, y: .1 }, { x: .9, y: .9 }, { x: .1, y: .9 }];
const astra = { version: 'atlas-astra-policy-v1', model: MODEL, returnedModel: MODEL, effort: 'max', serviceTier: 'default',
    maxOutputTokens: 128, requestTimeoutMs: 1000, pricingVersion: PRICING.version,
    inputNanoUsdPerToken: PRICING.inputNanoUsdPerToken, outputNanoUsdPerToken: PRICING.outputNanoUsdPerToken };
function fixture(cornerShape = 'SQUARE') {
    const run = { id: randomUUID(), workspaceCardId: randomUUID(), phase: 'CAPTURE_REVIEW', specimenId: null,
        initializationId: null, captureRunId: null, expectedAnalysisRevision: 0, expectedReviewRevision: 0,
        evidenceHash: 'a'.repeat(64), revision: 5, leaseOwner: randomUUID(), leaseFence: 1, state: 'RUNNING',
        pilotId: randomUUID(), controlState: 'RUNNING', controlRevision: 1, executionMode: 'CONTINUOUS', stepBudget: 0 };
    const claim = { id: randomUUID(), kind: 'ASTRA', runId: run.id, fence: 3, workflowRevision: 2, captureRevision: 2, captureHash: run.evidenceHash };
    const card = { id: run.workspaceCardId, state: 'IN_PROGRESS', claim, captureHash: run.evidenceHash, captureRevision: 2, claimFence: 3,
        identity: { category: 'SPORTS', playerName: '' }, workspace: cornerShape === null ? {} : { cornerShape } };
    const bytes = ['FRONT', 'BACK'].map((_, i) => syntheticPng(8,10,i ? 20 : 200));
    const assets = ['FRONT', 'BACK'].map((side, i) => ({ assetId: randomUUID(), side, view: 'ORIGINAL', sha256: digest(bytes[i]),
        byteCount: bytes[i].length, width: 8, height: 10, contentType: 'image/png' }));
    const manifest = { version: 'atlas-operator-capture-manifest-v1', phase: 'CAPTURE_REVIEW', runId: run.id,
        workspaceCardId: card.id, claimId: claim.id, claimFence: 3, captureRevision: 2, workflowRevision: 2,
        evidenceHash: run.evidenceHash, identity: { category: 'SPORTS', playerName: '' }, cornerShape, assets };
    run.manifestCanonical = canonical(manifest); run.manifestHash = digest(run.manifestCanonical);
    const binding = { runId: run.id, evidenceHash: run.evidenceHash, manifestHash: run.manifestHash, expectedRevision: 5 };
    const refs = assets.map(({ assetId, sha256, side }) => ({ assetId, sha256, side }));
    const steps = new Map(), rows = assets.map(asset => { const text = canonical({ asset }); return { imageId: randomUUID(), canonical: text, hash: digest(text) }; });
    const tx = { staffOperatorStep: { findUnique: async ({ where }) => steps.get(where.id) },
        staffOperatorImageDelivery: { findMany: async () => rows.map(row => ({ imageId: row.imageId })) },
        staffOperatorImage: { findMany: async () => rows }, staffAnalysisRevision: { findUnique: async () => { throw new Error('capture must not read report'); } } };
    const data = { run, card, manifest, tx, attempt: { id: randomUUID() }, now: new Date(), stepId: randomUUID() };
    const evidenceClient = { async read(claims, request) { return { claims, request }; }, verify(receipt, claims, request) {
        assert.deepEqual(receipt, { claims, request });
        if (request === null) return { image: null };
        const index = assets.findIndex(a => a.assetId === request.assetId), asset = assets[index];
        return { image: createOperatorImagePacket({ imageId: randomUUID(), request, asset, orientation: 1, decoder: OPERATOR_IMAGE_DECODER, bytes: bytes[index] }) };
    } };
    const adapters = operatorAdapters({ evidenceClient });
    const proposal = (name, extra, ordinal) => {
        const id = randomUUID(), args = { ...binding, expectedRevision: ordinal, ...extra }, requestCanonical = canonical(args);
        const reference = { stepId: id, requestHash: digest(requestCanonical) };
        const resultCanonical = canonical({ binding: { ...binding, expectedRevision: ordinal + 1 },
            result: { actor: 'MACHINE', status: 'PROPOSED_FOR_PREPARATION', proposal: reference } });
        steps.set(id, { id, runId: run.id, toolName: name, revision: ordinal + 1, requestCanonical,
            requestHash: reference.requestHash, resultCanonical, resultHash: digest(resultCanonical) }); return reference;
    };
    const identityProposal = proposal('propose_capture_identity', { fields: [{ field: 'playerName', value: 'Visible synthetic player', evidence: [refs[0]] }], summary: 'Visible original text.' }, 1);
    const boundaries = refs.map((ref, i) => ({ side: ref.side, proposal: proposal('propose_physical_boundary', {
        side: ref.side, corners, matColor: 'BLACK', evidence: [ref], summary: 'Visible physical edge.' }, 2 + i) }));
    return { ...data, data, bytes, assets, binding, refs, steps, rows, adapters, identityProposal, boundaries,
        call(name, args = {}) { return { name, callId: `call_${name}`, args: { ...binding, ...args } }; },
        async apply(call) {
            const snapshot = { ...data, call, attemptId: data.attempt.id };
            const prepared = await adapters[call.name].prepare(snapshot, {});
            return adapters[call.name].apply(snapshot, prepared);
        } };
}
const submit = f => f.call('submit_capture_preparation', { disposition: 'READY_FOR_PREPARATION', identityProposal: f.identityProposal,
    boundaries: f.boundaries, summary: 'Machine proposals ready for original worker validation.' });

test('capture manifest cannot contain fabricated specimen/report or substituted side/category', () => {
    const f = fixture(); assert.deepEqual(parseCaptureManifest(f.manifest), f.manifest); assertCaptureScope(f.run, f.card, f.manifest);
    for (const update of [{ specimenId: randomUUID() }, { reportHash: 'b'.repeat(64) }, { sourceHash: 'c'.repeat(64) },
        { assets: [f.assets[0], f.assets[0]] }, { identity: { category: 'SPORTS', cardName: 'wrong category' } }])
        assert.throws(() => parseCaptureManifest({ ...f.manifest, ...update }));
    for (const update of [{ claimFence: 4 }, { captureHash: 'f'.repeat(64) }, { claim: { ...f.card.claim, runId: randomUUID() } },
        { claim: { ...f.card.claim, kind: 'HUMAN' } }]) assert.throws(() => assertCaptureScope(f.run, { ...f.card, ...update }, f.manifest));
});

test('capture tools require explicit admission, preserve old report prompt bytes and reserve the same ceiling', () => {
    const f = fixture(), policy = { version: 'atlas-operator-control-policy-v1', pilotId: f.run.pilotId,
        expiresAt: new Date(Date.now() + 60_000).toISOString(), prompt: 'Reviewed synthetic pilot.', astra,
        tools: [...REPORT_TOOL_NAMES], captureTools: [...CAPTURE_TOOL_NAMES], maxAttemptsPerCard: 20,
        maxStepsPerRun: 20, maxRunMs: 60_000, leaseMs: 10_000, concurrency: 1 };
    assert.deepEqual(toolsForRun(parseControlPolicy(policy), f.run), [...CAPTURE_TOOL_NAMES]);
    const { captureTools, ...old } = policy; assert.deepEqual(parseControlPolicy(old), old);
    assert.throws(() => toolsForRun(old, f.run), /ASTRA_CAPTURE_NOT_ADMITTED/);
    assert.throws(() => parseControlPolicy({ ...policy, tools: ['read_original_photos'] }));
    assert.throws(() => parseControlPolicy({ ...policy, captureTools: ['read_card_report'] }));
    assert.equal(instructionsFor(policy.prompt), instructionsFor(policy.prompt, 'REPORT_REVIEW'));
    const request = buildRequest({ policy: astra, prompt: policy.prompt, phase: 'CAPTURE_REVIEW', names: captureTools,
        input: [{ role: 'user', content: 'Synthetic capture.' }] });
    assert.notEqual(request.request.instructions, instructionsFor(policy.prompt));
    assert.equal(requestReservation(astra), 23_059_600);
    assert(request.request.tools.every(tool => CAPTURE_TOOL_NAMES.includes(tool.name)));
});

test('original photographs use actual signed image lineage and never read an analysis report', async () => {
    const f = fixture(), call = f.call('read_original_photos'), result = await f.apply(call);
    assert.equal(result.images.length, 2); assert.equal(result.result.preparation, 'NOT_STARTED');
    assert.equal(Object.hasOwn(result.result, 'reportHash'), false);
    const projected = toolImageOutput(call, result.images); assert(projected.roster.every(image => image.sourceView === 'ORIGINAL'));
    assert.throws(() => toolImageOutput({ ...call, name: 'read_card_report' }, result.images), /ASTRA_OVERVIEW_REQUIRED/);
});

test('physical boundary proposals use deterministic convex geometry and reject model grades or human flags', async () => {
    const f = fixture(), args = { side: 'FRONT', corners, matColor: 'BLACK', evidence: [f.refs[0]], summary: 'Observed edge.' };
    const call = f.call('propose_physical_boundary', args), output = await f.apply(call);
    assert.equal(output.result.actor, 'MACHINE'); assert.equal(output.result.status, 'PROPOSED_FOR_PREPARATION');
    assert.deepEqual(output.result.proposal, { stepId: f.data.stepId, requestHash: digest(canonical(call.args)) });
    for (const changed of [{ corners: [corners[0], corners[2], corners[1], corners[3]] }, { evidence: [f.refs[1]] }])
        assert.throws(() => validateCaptureProposal(f.call(call.name, { ...args, ...changed }), f.manifest), /ASTRA_CAPTURE_BOUNDARY_INVALID/);
    for (const changed of [{ grade: 10 }, { confirmed: true }, { actor: 'HUMAN' }, { sourceUrl: 'https://example.test' }])
        assert.throws(() => CAPTURE_TOOL_SCHEMAS[call.name].parse({ ...call.args, ...changed }));
});

test('identity hypotheses retain unknowns and cannot change human-supplied category or invent delivered evidence', async () => {
    const f = fixture(), args = { fields: [{ field: 'playerName', value: null, evidence: [f.refs[0]] }], summary: 'Text is unclear.' };
    assert.equal((await f.apply(f.call('propose_capture_identity', args))).result.actor, 'MACHINE');
    await assert.rejects(f.apply(f.call('propose_capture_identity', { ...args,
        fields: [{ field: 'cardName', value: 'Pokemon hypothesis', evidence: [f.refs[0]] }] })), /ASTRA_IDENTITY_CATEGORY_CHANGED/);
    f.rows.length = 0;
    await assert.rejects(f.apply(f.call('propose_capture_identity', args)), /ASTRA_PROPOSAL_IMAGE_NOT_DELIVERED/);
});

test('capture identity preserves accepted machine values and explicit human clears with an observable conflict hold', async () => {
    for (const actor of ['MACHINE', 'HUMAN']) {
        const f = fixture();
        f.manifest.identity.playerName = 'Accepted visible player'; f.card.identity.playerName = 'Accepted visible player';
        f.card.identityAuthority = { playerName: { actor } };
        const args = { fields: [{ field: 'playerName', value: 'Another player', evidence: [f.refs[0]] }], summary: 'Conflicting visible text.' };
        await assert.rejects(f.apply(f.call('propose_capture_identity', args)), /ASTRA_CAPTURE_IDENTITY_CONFLICT/);
        await assert.rejects(f.apply(submit(f)), /ASTRA_CAPTURE_IDENTITY_CONFLICT/);
        args.fields[0].value = 'Accepted visible player';
        assert.equal((await f.apply(f.call('propose_capture_identity', args))).result.actor, 'MACHINE');
    }
    for (const remove of [false, true]) {
        const f = fixture(); f.card.identityAuthority = { playerName: { actor: 'HUMAN' } };
        if (remove) { delete f.card.identity.playerName; delete f.manifest.identity.playerName; }
        const before = structuredClone(f.manifest.identity);
        await assert.rejects(f.apply(submit(f)), /ASTRA_CAPTURE_IDENTITY_CONFLICT/);
        const selection = (await f.apply({ ...submit(f), args: { ...submit(f).args, identityProposal: null } })).result;
        assert.deepEqual(selection.identity, before);
        assert.equal(f.card.identityAuthority.playerName.actor, 'HUMAN');
    }
});

test('source handoff selects exact immutable machine proposals and retains worker preparation as unresolved', async () => {
    const f = fixture(), output = await f.apply(submit(f)), selection = output.result;
    assert.equal(selection.version, 'atlas-machine-capture-selection-v1'); assert.equal(selection.actor, 'MACHINE');
    assert.equal(selection.identity.playerName, 'Visible synthetic player'); assert.equal(selection.boundaries.length, 2);
    assert.equal(selection.printedFrameSelection, 'REQUIRE_VALIDATED_WORKER_PROPOSAL');
    assert.equal(selection.status, 'PENDING_ORIGINAL_PREPARATION');
    for (const forbidden of ['confirmed','specimenId','reportHash','grade','humanActorId']) assert.equal(Object.hasOwn(selection, forbidden), false);
    assert.equal(selection.boundaries[0].proposal.resultHash, f.steps.get(f.boundaries[0].proposal.stepId).resultHash);
});

test('unspecified shape uses the existing preparation default only in a machine selection; explicit choices and manifest stay exact', async () => {
    for (const shape of [null, 'SQUARE', 'ROUNDED_3_18_MM']) {
        const f = fixture(shape), original = f.run.manifestCanonical;
        assertCaptureScope(f.run, f.card, f.manifest);
        const read = await f.apply(f.call('read_original_photos')); assert.equal(read.result.cornerShape, shape);
        const selection = (await f.apply(submit(f))).result;
        assert.equal(selection.cornerShape, shape ?? 'ROUNDED_3_18_MM'); assert.equal(selection.actor, 'MACHINE');
        assert.equal(selection.cornerShapeBasis, shape === null ? 'PREPARATION_DEFAULT' : undefined);
        assert.equal(selection.status, 'PENDING_ORIGINAL_PREPARATION');
        assert.equal(selection.printedFrameSelection, 'REQUIRE_VALIDATED_WORKER_PROPOSAL');
        assert.equal(f.run.manifestCanonical, original); assert.equal(canonical(f.manifest), original);
        assert.equal(f.card.workspace.cornerShape, shape ?? undefined);
        assert.equal(Object.hasOwn(selection, 'confirmed'), false);
    }
});

test('submission cannot select future, cross-run, changed, human or unobserved proposals', async () => {
    for (const mutate of [row => { row.runId = randomUUID(); }, row => { row.revision = 100; }, row => { row.requestHash = 'f'.repeat(64); },
        row => { const result = JSON.parse(row.resultCanonical); result.result.actor = 'HUMAN'; row.resultCanonical = canonical(result); row.resultHash = digest(row.resultCanonical); }]) {
        const f = fixture(); mutate(f.steps.get(f.boundaries[0].proposal.stepId));
        await assert.rejects(f.apply(submit(f)), /ASTRA_CAPTURE_PROPOSAL_CHANGED/);
    }
    const f = fixture(); f.boundaries.pop(); await assert.rejects(f.apply(submit(f)), /ASTRA_CAPTURE_SELECTION_INCOMPLETE/);
    const g = fixture(); g.boundaries[1].side = 'FRONT'; await assert.rejects(g.apply(submit(g)), /ASTRA_CAPTURE_SELECTION_INCOMPLETE/);
});

test('capture reservation shares workspace costs and cannot spend after preparation handoff', async () => {
    const f = fixture(), ledger = new OperatorLedger({ client: null, config: {} }); let inserted = false, usage = { total: 89_000_000n, card: 1n, attempts: 2, overrun: false };
    const context = { ...f.data, input: [], policy: { astra, prompt: 'Synthetic.', captureTools: [...CAPTURE_TOOL_NAMES], maxStepsPerRun: 20, maxAttemptsPerCard: 20 },
        budget: { maxTotalMicroUsd: 90_000_000, maxCardMicroUsd: 90_000_000 }, now: new Date(),
        tx: { staffOperatorAttempt: { count: async () => 0 }, $queryRaw: async strings => {
            assert(strings.join('').includes('workspace_pilot_budget_usage')); return [usage]; }, $executeRaw: async () => { inserted = true; } } };
    ledger.transaction = async work => work(context); ledger.leased = async () => context;
    await assert.rejects(ledger.reserve({}), /ASTRA_BUDGET_EXHAUSTED/); assert.equal(inserted, false);
    f.run.state = 'PREPARATION_READY'; usage = { ...usage, total: 0n };
    await assert.rejects(ledger.reserve({}), /ASTRA_STEP_LIMIT/); assert.equal(inserted, false);
});

test('capture terminal supports separate supervised source permits without reopening provider work', () => {
    const f = fixture(), run = { ...f.run, state: 'PREPARATION_READY', controlState: 'PAUSED', executionMode: 'STEP', stepBudget: 0 };
    assert.equal(ACTIVE_RUN_STATES.includes(run.state), false);
    assert(projectOperatorControl(run, []).canStep);
    const step = planOperatorControl(run, [], 'STEP'); assert.equal(step.runUpdate.stepBudget, 1);
    assert.equal(Object.hasOwn(step.runUpdate, 'state'), false); assert.equal(Object.hasOwn(step.runUpdate, 'deadlineAt'), false);
    assert(pauseAfterAppliedAction({ ...run, controlState: 'RUNNING' }, 'PREPARATION_READY'));
    assert.throws(() => planOperatorControl(run, [{ state: 'UNKNOWN' }], 'STEP'), /ASTRA_CONTROL_NOT_SETTLED/);
});

test('workspace pilot discriminator accepts one through ten fresh IDs while retaining exact budgets and object bytes', () => {
    const policy = { version: 'atlas-workspace-bridge-policy-v1', pilotId: randomUUID(), workspaceCardIds: Array.from({ length: 10 }, randomUUID),
        expiresAt: '2026-09-10T01:00:00.000Z', maxOperationsPerCard: 20, maxTotalMicroUsd: 90_000_000,
        maxCardMicroUsd: 90_000_000, reservationPerOperationMicroUsd: 1_000_000, maxWorkerCalls: 4, deadlineMs: 200_000 };
    assert.equal(parsePilotPolicy(policy), policy);
    const first = { ...policy, workspaceCardIds: policy.workspaceCardIds.slice(0, 1) };
    assert.equal(parsePilotPolicy(first), first);
    for (const changed of [{ workspaceCardIds: [] }, { workspaceCardIds: [...policy.workspaceCardIds, randomUUID()] },
        { workspaceCardIds: Array(10).fill(policy.workspaceCardIds[0]) },
        { specimenIds: policy.workspaceCardIds }, { maxCardMicroUsd: 90_000_001 }, { fresh: true }])
        assert.throws(() => parsePilotPolicy({ ...policy, ...changed }));
});
