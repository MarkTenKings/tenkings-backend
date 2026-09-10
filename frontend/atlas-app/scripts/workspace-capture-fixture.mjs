// Owned disposable PostgreSQL, synthetic PNGs and responses only. This tests
// fresh workspace binding and ledgers, never optical or live grading readiness.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { canonical, digest } from '@atlas/service-bridge/protocol';
import { OperatorEvidenceBridge, operatorEvidenceClient, verifyOperatorEvidenceRequest } from '@atlas/service-bridge/operator-evidence';
import { createOperatorImagePacket, OPERATOR_IMAGE_DECODER } from '@atlas/service-bridge/operator-images';
import { syntheticPng } from '../../../packages/atlas-contracts/test/fixtures.mjs';
import { enqueueCaptureOperatorRunInTransaction, enqueueCaptureOperatorRun, enqueueOperatorRunInTransaction } from '../../../packages/atlas-operator/src/ledger.mjs';
import { operatorAdapters } from '../../../packages/atlas-operator/src/adapters.mjs';
import { CAPTURE_TOOL_NAMES } from '../../../packages/atlas-operator/src/capture-protocol.mjs';
import { StaffWorkspaceStore } from '../lib/server/access/workspace-store.mjs';
import { StaffWorkspaceIntake } from '../lib/server/access/workspace-intake.mjs';
import { StaffWorkspaceOperator } from '../lib/server/access/workspace-operator.mjs';
import { operatorFixture } from './operator-fixture.mjs';

const quad = [{ x: .1, y: .1 }, { x: .9, y: .1 }, { x: .9, y: .9 }, { x: .1, y: .9 }];
async function updateCard(tx, card, change) {
    const value = { ...card, ...change, revision: card.revision + 1, updatedAt: new Date().toISOString() }, text = canonical(value);
    await tx.staffWorkspaceCard.update({ where: { id: card.id }, data: { revision: value.revision, state: value.state,
        stage: value.stage, specimenId: value.specimenId, canonical: text, contentHash: digest(text), updatedAt: new Date(value.updatedAt) } });
    return value;
}
async function fixture(context, work, options = {}) {
    return operatorFixture(context, async f => {
        const initialized = options.report ? await f.initialize() : null;
        const cohortId = randomUUID(), configHash = digest('synthetic fresh workspace operator'), objects = new Map(), byteRoster = new Map();
        const staffControl = await f.admin.staffControl.findUnique({ where: { id: 'active' } });
        await f.admin.staffWorkspaceControl.create({ data: { enabled: true, mode: 'LOCAL_FIXTURE', releaseSha: staffControl.releaseSha,
            configHash, cohortId, intakeEnabled: true, claimsEnabled: true, astraEnabled: true, processingLimit: 1,
            preparationEnabled: options.preparationEnabled ?? false,
            expiresAt: new Date(Date.now() + 600_000) } });
        const store = new StaffWorkspaceStore({ auth: context.auth, configHash });
        // The original public intake always selects SPEEDSTER. Only this owned
        // database fixture switches the initial persisted namespace to the
        // explicitly supported LOCAL_FIXTURE bridge type, before insertion.
        const intakeStore = options.sourceType === 'LOCAL_FIXTURE' ? { transaction: (staff, work) => store.transaction(staff, context => work({
            ...context, tx: { ...context.tx, insertCard: card => context.tx.insertCard({ ...card, source: { ...card.source, sourceType: 'LOCAL_FIXTURE' } }) },
        })) } : store;
        const intake = new StaffWorkspaceIntake({ store: intakeStore,
            source: { reserve: ({ cardId, creatorId }) => ({ sourceType: 'SPEEDSTER', sourceId: `atlas-${cardId}`, sourceOwnerId: `atlas-staff-${creatorId}` }),
                ...(options.captureRpc ? { async assertClaimable(context, { card, operator, claim }) {
                    if (operator !== 'ASTRA') return null;
                    const [row] = await context.databaseTx.$queryRaw`SELECT atlas_staff.enqueue_workspace_capture(${card.id}::uuid,
                        ${context.identity.id}::uuid,${context.session.tokenHash},${canonical(claim)}) AS id`;
                    return { runId: row.id };
                } } : {}) },
            storage: { async grant({ upload }) {
                objects.set(upload.objectRef, byteRoster.get(upload.sha256));
                return { id: upload.id, url: 'https://synthetic-storage.example.test/no-network', method: 'PUT',
                    headers: { 'Content-Type': upload.contentType }, expiresAt: new Date(Date.now() + 60_000).toISOString() };
            }, async verify({ upload }) {
                const bytes = objects.get(upload.objectRef); assert(bytes);
                return { objectRef: upload.objectRef, sha256: digest(bytes), byteCount: bytes.length, contentType: 'image/png', width: 8, height: 10 };
            } } });
        const createQueued = async index => {
            let { card } = await intake.create(f.signed.staff, { operationId: randomUUID(), title: `Synthetic new photograph ${index + 1}`,
                identity: options.identity ?? { category: 'SPORTS', playerName: 'Synthetic supplied identity' } });
            for (const [sideIndex, side] of ['FRONT', 'BACK'].entries()) {
                const bytes = syntheticPng(8, 10, 10 + index * 20 + sideIndex * 5); byteRoster.set(digest(bytes), bytes);
                const planned = await intake.planUpload(f.signed.staff, card.id, { operationId: randomUUID(), expectedRevision: card.revision,
                    side, file: { name: `${side}.png`, contentType: 'image/png', byteCount: bytes.length, sha256: digest(bytes) } });
                ({ card } = await intake.completeUpload(f.signed.staff, card.id, { operationId: randomUUID(), expectedRevision: planned.card.revision,
                    uploadId: planned.upload.id }));
            }
            ({ card } = await intake.queue(f.signed.staff, card.id, { operationId: randomUUID(), expectedRevision: card.revision, pairConfirmed: true }));
            return card.id;
        };
        const ids = [];
        for (let index = 0; index < (options.rosterSize ?? 10); index++) ids.push(await createQueued(index));
        const { specimenIds: _oldSpecimens, ...limits } = f.budget;
        const budget = { ...limits, version: 'atlas-workspace-bridge-policy-v1', workspaceCardIds: ids, maxTotalMicroUsd: 90_000_000, maxCardMicroUsd: 90_000_000 };
        const policy = { ...f.policy, astra: { ...f.policy.astra, effort: options.effort ?? f.policy.astra.effort }, captureTools: [...CAPTURE_TOOL_NAMES] };
        await f.admin.staffGradingBridgeControl.update({ where: { id: 'active' }, data: {
            policyCanonical: canonical(budget), policyHash: digest(canonical(budget)), revision: { increment: 1 } } });
        await f.admin.staffOperatorControl.update({ where: { id: 'active' }, data: {
            policyCanonical: canonical(policy), policyHash: digest(canonical(policy)), revision: { increment: 1 } } });
        const card = async (id = ids[0]) => JSON.parse((await f.admin.staffWorkspaceCard.findUnique({ where: { id } })).canonical);
        const service = new StaffWorkspaceOperator({ store, projectCard: (context, value) => intake.project(context, value) });
        const control = async action => service.control(f.signed.staff, ids[0], { operationId: randomUUID(), expectedRevision: (await card()).revision, action });
        const claim = async (mode = 'CONTINUOUS') => {
            await intake.claim(f.signed.staff, ids[0], { operationId: randomUUID(), expectedRevision: (await card()).revision, operator: 'ASTRA', mode });
            const run = await f.admin.$transaction(async tx => {
                await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0))`;
                const current = JSON.parse((await tx.staffWorkspaceCard.findUnique({ where: { id: ids[0] } })).canonical);
                const next = await updateCard(tx, current, { workspace: { cornerShape: 'SQUARE' }, claim: { ...current.claim, runId: randomUUID() } });
                const run = await enqueueCaptureOperatorRunInTransaction(tx, f.config, next);
                await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`; return run;
            });
            const { lease, mode: claimedMode } = await f.ledger.claim(run.id, randomUUID()); assert.equal(claimedMode, 'WORK'); return { run, lease };
        };
        const key = randomBytes(32), imageConfig = { mode: 'LOCAL_FIXTURE', origin: 'https://workspace-evidence.example.test',
            deploymentId: 'synthetic-workspace-capture', releaseSha: '0'.repeat(40), configHash: digest('synthetic capture evidence'),
            clientKeyHash: digest(key), key, gradingPolicyHash: f.bridge.service.config.gradingPolicyHash };
        const { key: _key, gradingPolicyHash: _policy, ...imageControl } = imageConfig;
        await f.admin.staffOperatorImageControl.create({ data: { ...imageControl, enabled: true } });
        let reads = 0, afterRead;
        const imageBridge = new OperatorEvidenceBridge({ client: f.admin, config: imageConfig, ports: {
            async loadCapture(_tx, { workspace, originals }) { return { captureHash: workspace.captureHash, originals }; },
            async readCapture(descriptor) { reads++; await afterRead?.(); return objects.get(descriptor.objectRef); },
            async render({ sourceBytes, asset, request }) {
                assert.equal(digest(sourceBytes), asset.sha256);
                return createOperatorImagePacket({ imageId: randomUUID(), request, asset, orientation: 1, decoder: OPERATOR_IMAGE_DECODER, bytes: sourceBytes });
            } } });
        const imageClient = operatorEvidenceClient({ origin: imageConfig.origin, key, runtimeHash: f.config.configHash }, async (_url, request) => {
            const claims = verifyOperatorEvidenceRequest(imageConfig, request.body, request.headers['x-atlas-operator-evidence-signature']);
            const result = await imageBridge.read(claims);
            return new Response(result.text, { status: 200, headers: { 'content-type': 'application/json', 'x-atlas-operator-evidence-signature': result.signature } });
        });
        const adapters = operatorAdapters({ evidenceClient: imageClient });
        const apply = async (lease, attempt) => {
            const snapshot = await f.ledger.inspectTool(lease, attempt.attemptId), adapter = adapters[snapshot.call.name];
            const prepared = await adapter.prepare(snapshot, {});
            return f.ledger.applyTool(lease, attempt.attemptId, data => adapter.apply(data, prepared));
        };
        const prepareProposals = async current => {
            let lease = (await apply(current.lease, await f.request(current.lease, 'read_original_photos'))).lease;
            const manifest = JSON.parse(current.run.manifestCanonical), refs = manifest.assets.map(({ assetId, sha256, side }) => ({ assetId, sha256, side }));
            const identity = await apply(lease, await f.request(lease, 'propose_capture_identity', { fields: [
                { field: 'playerName', value: 'Recorded synthetic player', evidence: [refs[0]] }], summary: 'Observed synthetic original text.' })); lease = identity.lease;
            const boundaries = [];
            for (const reference of refs) {
                const proposed = await apply(lease, await f.request(lease, 'propose_physical_boundary', {
                    side: reference.side, corners: quad, matColor: 'BLACK', evidence: [reference], summary: 'Observed synthetic physical edge.' }));
                boundaries.push({ side: reference.side, proposal: proposed.output.result.proposal }); lease = proposed.lease;
            }
            return { lease, identityProposal: identity.output.result.proposal, boundaries };
        };
        const submit = async proposals => {
            const request = await f.request(proposals.lease, 'submit_capture_preparation', { disposition: 'READY_FOR_PREPARATION',
                identityProposal: proposals.identityProposal, boundaries: proposals.boundaries, summary: 'Synthetic selections await original worker preparation.' });
            return { ...await apply(proposals.lease, request), request };
        };
        await work({ ...f, budget, policy, ids, initialized, card, createQueued, service, control, claim, apply, adapters, prepareProposals, submit, intake, store,
            reads: () => reads, afterRead: callback => { afterRead = callback; } });
    });
}

export { fixture as workspaceCaptureFixture, updateCard as updateWorkspaceFixtureCard };

export async function workspaceCaptureScenarios(scenario) {
    await scenario('bridge SQL shape accepts one or ten workspace UUIDs and rejects empty oversized duplicate invalid or legacy-nine rosters', context => fixture(context, async f => {
        const original = await f.admin.staffGradingBridgeControl.findUnique({ where: { id: 'active' } });
        const update = policy => f.admin.staffGradingBridgeControl.update({ where: { id: 'active' }, data: {
            policyCanonical: canonical(policy), policyHash: digest(canonical(policy)), revision: { increment: 1 } } });
        for (const length of [1, 10]) {
            await update({ ...f.budget, workspaceCardIds: f.ids.slice(0, length) });
            const [{ count }] = await f.admin.$queryRaw`SELECT atlas_staff.operator_workspace_count(${f.budget.pilotId}::uuid) AS count`;
            assert.equal(count, length);
        }
        for (const workspaceCardIds of [[], [...f.ids, randomUUID()], [f.ids[0], f.ids[0]], ['invalid'], [null], {}, null])
            await assert.rejects(() => update({ ...f.budget, workspaceCardIds }), /StaffGradingBridgeControl_shape/);
        await assert.rejects(() => update({ ...f.bridge.policy, specimenIds: f.bridge.specimenIds.slice(0, 9) }), /StaffGradingBridgeControl_shape/);
        await update(f.bridge.policy); // The original exact-ten specimen policy still passes.
        await update(f.budget);
        for (const data of [{ configHash: 'invalid' }, { releaseSha: 'invalid' }, { policyHash: '0'.repeat(64) }])
            await assert.rejects(() => f.admin.staffGradingBridgeControl.update({ where: { id: 'active' },
                data: { ...data, revision: { increment: 1 } } }), /StaffGradingBridgeControl_shape/);
        await assert.rejects(() => f.admin.staffGradingBridgeControl.update({ where: { id: 'active' }, data: { revision: 0 } }), /control revision must advance once/);
        const retained = await f.admin.staffGradingBridgeControl.findUnique({ where: { id: 'active' } });
        assert.equal(retained.policyCanonical, original.policyCanonical); assert.equal(retained.policyHash, original.policyHash);
        assert.equal(await f.admin.staffOperatorRun.count(), 0); assert.equal(await f.admin.staffWorkspaceCard.count({ where: { state: 'WAITING' } }), 10);
        await assert.rejects(() => f.client.$queryRaw`SELECT atlas_staff.workspace_pilot_ids_valid('[]'::jsonb)`, /permission denied/);
    }));

    await scenario('first verified workspace requires the complete explicit roster and continued intake preserves its claim and processing limit', context => fixture(context, async f => {
        const first = await f.card(), update = ids => f.admin.staffGradingBridgeControl.update({ where: { id: 'active' }, data: {
            policyCanonical: canonical({ ...f.budget, workspaceCardIds: ids }), policyHash: digest(canonical({ ...f.budget, workspaceCardIds: ids })),
            revision: { increment: 1 } } });
        const claim = async id => f.intake.claim(f.signed.staff, id, { operationId: randomUUID(), expectedRevision: (await f.card(id)).revision,
            operator: 'ASTRA', mode: 'CONTINUOUS' });
        await update([first.id, randomUUID()]);
        await assert.rejects(() => claim(first.id), /admitted verified photo pair/);
        assert.equal((await f.card()).state, 'WAITING'); assert.equal(await f.admin.staffOperatorRun.count(), 0);
        await update([first.id]);
        await claim(first.id);
        const active = await f.card(), run = await f.admin.staffOperatorRun.findUnique({ where: { id: active.claim.runId } });
        assert.equal(active.id, first.id); assert.equal(active.captureHash, first.captureHash); assert.equal(run.phase, 'CAPTURE_REVIEW');
        assert.equal(run.specimenId, null); assert.equal(JSON.parse(run.policyCanonical).astra.effort, 'max');
        const second = await f.createQueued(1);
        assert.equal((await f.card(second)).state, 'WAITING'); assert.deepEqual(await f.card(), active);
        const [{ count }] = await f.admin.$queryRaw`SELECT atlas_staff.operator_workspace_count(${f.budget.pilotId}::uuid) AS count`;
        assert.equal(count, 1); await assert.rejects(() => claim(second));
        await update([second]); // Another verified card cannot substitute for the admitted run's workspace.
        await assert.rejects(() => f.ledger.claim(run.id, randomUUID()), /ASTRA_CAPTURE_NOT_CURRENT|ASTRA_RUN_NOT_CURRENT|ASTRA_PILOT_NOT_ACTIVE|ASTRA_CAPTURE_NOT_ADMITTED|ASTRA_RUN_SCOPE_CHANGED/);
        await update([first.id, second]);
        await assert.rejects(() => claim(second)); // Capacity remains ten; processing remains one.
        assert.equal(await f.admin.staffOperatorRun.count(), 1); assert.equal((await f.card(second)).state, 'WAITING');
        const control = await f.admin.staffWorkspaceControl.findUnique({ where: { id: 'active' } });
        assert.equal(control.maxCards, 10); assert.equal(control.processingLimit, 1); assert.equal(control.intakeEnabled, true);
        assert.deepEqual(await f.card(), active);
    }, { rosterSize: 1, effort: 'max', captureRpc: true }));

    await scenario('capture operator enqueues exact new original pair without specimen report or broad machine workspace access', context => fixture(context, async f => {
        const beforeAnalyses = await f.admin.staffAnalysisRevision.count(), { run, lease } = await f.claim();
        assert.equal(run.phase, 'CAPTURE_REVIEW'); assert.equal(run.specimenId, null); assert.equal(run.expectedAnalysisRevision, 0);
        assert.equal(run.expectedReviewRevision, 0); assert.equal(run.initializationId, null);
        const manifest = JSON.parse(run.manifestCanonical); assert.equal(manifest.assets.length, 2);
        assert(manifest.assets.every(asset => asset.view === 'ORIGINAL')); assert.equal(Object.hasOwn(manifest, 'reportHash'), false);
        assert.equal(await f.admin.staffAnalysisRevision.count(), beforeAnalyses); assert.equal(f.calls(), 0);
        assert.equal((await enqueueCaptureOperatorRun(f.admin, f.config, f.ids[0])).id, run.id);
        await assert.rejects(() => f.client.staffWorkspaceCard.findMany()); await assert.rejects(() => f.client.staffWorkspaceOperation.findMany());
        const pointer = (await f.card()).sides.FRONT;
        await assert.rejects(() => f.admin.staffWorkspaceOperation.update({ where: { id: pointer.verificationId }, data: { contentHash: 'f'.repeat(64) } }));
        const request = await f.request(lease, 'read_original_photos');
        f.afterRead(async () => { await f.admin.staffWorkspaceControl.update({ where: { id: 'active' }, data: { astraEnabled: false, revision: { increment: 1 } } }); });
        await assert.rejects(() => f.apply(lease, request), /ASTRA_CAPTURE_SCOPE_CHANGED/);
        assert.equal(await f.admin.staffOperatorImage.count(), 0); assert.equal(await f.admin.staffOperatorStep.count(), 0);
        assert.equal((await f.admin.staffOperatorAttempt.findUnique({ where: { id: request.attemptId } })).state, 'RECEIVED');
    }));

    await scenario('capture proposals and source handoff commit exact image delivery and immutable machine provenance', context => fixture(context, async f => {
        const current = await f.claim(), proposals = await f.prepareProposals(current), terminal = await f.submit(proposals);
        assert.equal(terminal.state, 'PREPARATION_READY'); assert.equal(terminal.output.result.actor, 'MACHINE');
        assert.equal(terminal.output.result.printedFrameSelection, 'REQUIRE_VALIDATED_WORKER_PROPOSAL');
        assert.equal(terminal.output.result.status, 'PENDING_ORIGINAL_PREPARATION'); assert.equal(f.reads(), 2);
        const outbox = await f.admin.staffOperatorOutbox.findFirst({ where: { runId: current.run.id } }), payload = JSON.parse(outbox.payload);
        assert.equal(outbox.type, 'CAPTURE_PREPARATION_READY'); assert.equal(payload.actor, 'MACHINE');
        const selected = await f.admin.staffOperatorStep.findUnique({ where: { id: payload.selectionStepId } });
        assert.equal(payload.selectionResultHash, selected.resultHash); assert.equal(selected.toolName, 'submit_capture_preparation');
        assert.equal(await f.admin.staffOperatorImage.count(), 2); assert.equal(await f.admin.staffOperatorImageDelivery.count(), 8);
        const activity = await f.service.activity(f.signed.staff, f.ids[0]); assert.equal(activity.activity.length, 5);
        assert.equal(activity.activity[0].type, 'read_original_photos'); assert.equal(activity.activity.at(-1).selection.actor, 'MACHINE');
        assert.equal(JSON.stringify(activity).includes('opaque-synthetic-continuation'), false);
        assert.equal(await f.admin.staffReportApproval.count(), 0); assert.equal((await f.card()).specimenId, null);
        await assert.rejects(() => f.ledger.reserve(terminal.lease), /ASTRA_LEASE_STALE/);
    }));

    await scenario('terminal capture STEP releases its lease and a late conflicting receipt blocks new source permits', context => fixture(context, async f => {
        const current = await f.claim(), proposals = await f.prepareProposals(current);
        await f.control('PAUSE'); await f.control('STEP');
        const { lease } = await f.ledger.claim(current.run.id, randomUUID()), terminal = await f.submit({ ...proposals, lease });
        assert.equal(terminal.state, 'PREPARATION_READY'); assert.equal(terminal.requiresPauseRelease, true);
        await f.ledger.releasePause(terminal.lease);
        const paused = await f.admin.staffOperatorRun.findUnique({ where: { id: current.run.id } });
        assert.equal(paused.state, 'PREPARATION_READY'); assert.equal(paused.controlState, 'PAUSED'); assert.equal(paused.leaseOwner, null);
        const view = await f.service.activity(f.signed.staff, f.ids[0]); assert(view.control.canStep);
        const conflict = structuredClone(terminal.request.receipt); conflict.body.id = 'resp_synthetic_terminal_capture_conflict';
        conflict.bodyHash = digest(canonical(conflict.body)); await f.ledger.recordReceipt({ ...terminal.request, receipt: conflict });
        assert.equal((await f.admin.staffOperatorRun.findUnique({ where: { id: current.run.id } })).state, 'UNKNOWN');
        await assert.rejects(() => f.control('STEP'), /cannot resume/); await assert.rejects(() => f.control('TAKE_OVER'), /unresolved work prevents takeover/);
        assert.equal(await f.admin.staffOperatorReceipt.count({ where: { attemptId: terminal.request.attemptId } }), 2);
    }));

    await scenario('SQL independently rejects invented selected geometry identity provenance or worker completion', context => fixture(context, async f => {
        const current = await f.claim(), proposals = await f.prepareProposals(current);
        const request = await f.request(proposals.lease, 'submit_capture_preparation', { disposition: 'READY_FOR_PREPARATION',
            identityProposal: proposals.identityProposal, boundaries: proposals.boundaries, summary: 'Synthetic selected proposals.' });
        const snapshot = await f.ledger.inspectTool(proposals.lease, request.attemptId), adapter = f.adapters.submit_capture_preparation;
        const prepared = await adapter.prepare(snapshot, {});
        for (const mutate of [result => { result.actor = 'HUMAN'; }, result => { result.boundaries[0].corners[0].x += .01; },
            result => { result.identity.playerName = 'Invented replacement'; },
            result => { result.boundaries[1].proposal.resultHash = 'f'.repeat(64); },
            result => { result.printedFrameSelection = 'WORKER_ALREADY_SUCCEEDED'; }]) {
            await assert.rejects(() => f.ledger.applyTool(proposals.lease, request.attemptId, async data => {
                const output = await adapter.apply(data, prepared); mutate(output.result); return output;
            }), /capture|selection|machine|proposal/i);
            assert.equal(await f.admin.staffOperatorOutbox.count({ where: { runId: current.run.id } }), 0);
            assert.equal(await f.admin.staffOperatorStep.count({ where: { runId: current.run.id } }), 4);
            assert.equal((await f.admin.staffOperatorAttempt.findUnique({ where: { id: request.attemptId } })).state, 'RECEIVED');
        }
        assert.equal((await f.apply(proposals.lease, request)).state, 'PREPARATION_READY');
    }));

    await scenario('linked report successor retains capture provider and grading cost in one workspace pilot ledger', context => fixture(context, async f => {
        const current = await f.claim(), terminal = await f.submit(await f.prepareProposals(current));
        const before = await f.admin.$queryRaw`SELECT * FROM atlas_staff.workspace_pilot_budget_usage(${current.run.pilotId}::uuid,${f.ids[0]}::uuid)`;
        assert.equal(before[0].attempts, 5); assert.equal(before[0].card, '100000'); assert.equal(before[0].total, '110000');
        const successor = await f.admin.$transaction(async tx => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0))`;
            const workspace = JSON.parse((await tx.staffWorkspaceCard.findUnique({ where: { id: f.ids[0] } })).canonical);
            const linked = await updateCard(tx, workspace, { specimenId: f.initialized.id });
            const run = await enqueueOperatorRunInTransaction(tx, f.config, f.initialized.id, { workspaceCardId: linked.id, captureRunId: current.run.id });
            await updateCard(tx, linked, { claim: { ...linked.claim, runId: run.id } });
            await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`; return run;
        });
        assert.equal(successor.phase, 'REPORT_REVIEW'); assert.equal(successor.captureRunId, current.run.id);
        const { lease } = await f.ledger.claim(successor.id, randomUUID()), request = await f.request(lease, 'read_card_report');
        const [after] = await f.admin.$queryRaw`SELECT * FROM atlas_staff.workspace_pilot_budget_usage(${current.run.pilotId}::uuid,${f.ids[0]}::uuid)`;
        assert.equal(after.attempts, 6); assert.equal(after.card, '130000'); assert.equal(after.total, '130000'); assert.equal(after.operations, 1);
        assert.equal(await f.admin.staffOperatorStep.count({ where: { runId: current.run.id } }), 5);
        assert.equal((await f.admin.staffOperatorAttempt.findUnique({ where: { id: request.attemptId } })).state, 'RECEIVED');
        await assert.rejects(() => f.ledger.reserve(terminal.lease), /ASTRA_STORED_EVIDENCE_INVALID|ASTRA_CAPTURE_SCOPE_CHANGED/);
    }, { report: true }));

    await scenario('staff capture RPC atomically binds the exact current human claim and original photos without runner admission privileges', context => fixture(context, async f => {
        const before = await f.card(), input = { operationId: randomUUID(), expectedRevision: before.revision, operator: 'ASTRA', mode: 'STEP' };
        await f.intake.claim(f.signed.staff, before.id, input);
        const card = await f.card(), run = await f.admin.staffOperatorRun.findUnique({ where: { id: card.claim.runId } });
        assert.equal(run.phase, 'CAPTURE_REVIEW'); assert.equal(run.specimenId, null); assert.equal(run.stepBudget, 1); assert.equal(run.executionMode, 'STEP');
        const manifest = JSON.parse(run.manifestCanonical); assert.equal(canonical(manifest), run.manifestCanonical);
        assert.equal(digest(run.manifestCanonical), run.manifestHash); assert.equal(canonical(JSON.parse(run.inputCanonical)), run.inputCanonical);
        assert.equal(manifest.claimId, card.claim.id); assert.equal(manifest.claimFence, card.claimFence); assert.equal(manifest.evidenceHash, card.captureHash);
        assert.equal(manifest.workflowRevision, card.claim.workflowRevision);
        assert.equal(card.claim.accessVersion, (await f.admin.staffIdentity.findUnique({ where: { id: f.signed.staff.id } })).accessVersion);
        await f.intake.claim(f.signed.staff, before.id, input); assert.equal(await f.admin.staffOperatorRun.count(), 1);
        await assert.rejects(() => f.client.$queryRaw`SELECT atlas_staff.enqueue_workspace_capture(${card.id}::uuid,${card.claim.actorId}::uuid,
            ${f.auth.actors.get(f.signed.staff).sessionHash},${canonical({ ...card.claim, runId: null })})`);
        assert.equal(f.calls(), 0); assert.equal((await f.ledger.claim(run.id, randomUUID())).mode, 'WORK');
        await assert.rejects(async () => f.intake.claim(f.signed.staff, f.ids[1], { ...input, operationId: randomUUID(), expectedRevision: (await f.card(f.ids[1])).revision }));
    }, { captureRpc: true }));

    await scenario('capture RPC rejects an orphan enqueue and changed actor access or session without creating a run', context => fixture(context, async f => {
        const card = await f.card(), identity = await f.admin.staffIdentity.findUnique({ where: { id: f.signed.staff.id } });
        const staff = await f.admin.staffControl.findUnique({ where: { id: 'active' } }), sessionHash = f.auth.actors.get(f.signed.staff).sessionHash;
        const claim = { id: randomUUID(), kind: 'ASTRA', actorId: identity.id, actorName: identity.name, accessVersion: identity.accessVersion,
            controlRevision: staff.revision, mode: 'CONTINUOUS', fence: card.claimFence + 1, workflowRevision: card.revision + 1,
            captureRevision: card.captureRevision, captureHash: card.captureHash, runId: null, claimedAt: new Date().toISOString() };
        const call = (value = claim, token = sessionHash) => f.admin.$transaction(async tx => {
            await tx.$queryRaw`SELECT atlas_staff.enqueue_workspace_capture(${card.id}::uuid,${identity.id}::uuid,${token},${canonical(value)})`;
            await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
        });
        await assert.rejects(() => call(), /capture|claim|authority/i);
        await assert.rejects(() => call({ ...claim, id: '-'.repeat(36) }), /current human authority/);
        await assert.rejects(() => call({ ...claim, accessVersion: claim.accessVersion + 1 }), /current human authority/);
        await assert.rejects(() => call(claim, 'f'.repeat(64)), /current human authority/);
        assert.equal(await f.admin.staffOperatorRun.count(), 0); assert.equal((await f.card()).claim, null);
    }, { captureRpc: true }));
}
