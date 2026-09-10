import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { canonical, digest } from '@atlas/service-bridge/protocol';
import { requestReservation } from '../../../packages/atlas-operator/src/responses.mjs';
import { StaffWorkspaceStore } from '../lib/server/access/workspace-store.mjs';
import { StaffWorkspaceOperator } from '../lib/server/access/workspace-operator.mjs';
import { operatorFixture } from './operator-fixture.mjs';

const check = (code, work) => assert.rejects(work, error => error.code === code, code);

/** Existing owned disposable cluster and synthetic grading/operator fixture.
 * Linking its synthetic specimen exercises controls, never photo readiness. */
async function fixture(context, work, options = {}) {
    return operatorFixture(context, async f => {
        const current = await f.start(), workspaceId = randomUUID(), cohortId = randomUUID(), configHash = digest('synthetic workspace controls only');
        const staffControl = await f.admin.staffControl.findUnique({ where: { id: 'active' } });
        await f.admin.staffWorkspaceControl.create({ data: { enabled: true, mode: 'LOCAL_FIXTURE', releaseSha: staffControl.releaseSha,
            configHash, cohortId, intakeEnabled: true, claimsEnabled: true, astraEnabled: true, processingLimit: 1,
            expiresAt: new Date(Date.now() + 3600_000) } });
        const store = new StaffWorkspaceStore({ auth: context.auth, configHash });
        await store.transaction(f.signed.staff, async ({ tx, identity, control, now }) => {
            const initial = { id: workspaceId, creatorId: identity.id, cohortId, revision: 1, title: 'Synthetic operator workspace',
                state: 'DRAFT', stage: 'PHOTOS', specimenId: null, sides: {}, source: { sourceType: 'LOCAL_FIXTURE',
                    sourceId: `atlas-${workspaceId}`, sourceOwnerId: `atlas-staff-${identity.id}` },
                captureRevision: 0, captureHash: null, claimFence: 0, claim: null, startedAt: null,
                createdAt: now.toISOString(), updatedAt: now.toISOString() };
            await tx.insertCard(initial);
            await tx.updateCard({ ...initial, revision: 2, state: 'IN_PROGRESS', stage: 'INSPECTION', specimenId: current.card.id,
                captureRevision: 1, captureHash: current.card.evidenceHash, claimFence: 1, startedAt: now.toISOString(),
                claim: { id: randomUUID(), kind: 'ASTRA', actorId: identity.id, actorName: 'Synthetic reviewer', mode: 'CONTINUOUS',
                    accessVersion: identity.accessVersion, controlRevision: control.revision,
                    fence: 1, workflowRevision: 2, captureRevision: 1, captureHash: current.card.evidenceHash,
                    runId: current.run.id, claimedAt: now.toISOString() } }, 1);
        });
        const service = new StaffWorkspaceOperator({ store, projectCard: async (_context, card) => ({ id: card.id,
            revision: card.revision, state: card.state, stage: card.stage, operator: card.claim ? { kind: card.claim.kind, mode: card.claim.mode } : null }) });
        const card = async () => JSON.parse((await f.admin.staffWorkspaceCard.findUnique({ where: { id: workspaceId } })).canonical);
        const control = async (action, input = {}) => service.control(f.signed.staff, workspaceId,
            { operationId: randomUUID(), expectedRevision: (await card()).revision, action, ...input });
        const scope = () => context.auth.withStaff(f.signed.staff, async ({ identity, session }) => ({ actorId: identity.id, sessionHash: session.tokenHash }));
        const directControl = async (overrides = {}) => {
            const before = await card(), savedScope = await scope();
            const input = { workspaceId, fence: before.claimFence, action: 'PAUSE', revision: before.revision, ...savedScope, ...overrides };
            return context.client.$transaction(async tx => {
                await tx.$queryRaw`SELECT atlas_staff.control_workspace_operator(${input.workspaceId}::uuid,${input.fence}::integer,
                    ${input.action}::text,${input.actorId}::uuid,${input.sessionHash}::text,${input.revision}::integer)`;
                await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
            });
        };
        await work({ ...f, ...current, workspaceId, store, service, card, control, scope, directControl });
    }, options);
}

export async function workspaceOperatorScenarios(scenario) {
    await scenario('workspace pause cancels only an undispatched reservation and recovers one immutable control operation', context => fixture(context, async f => {
        const reserved = await f.ledger.reserve(f.lease), before = await f.admin.staffOperatorAttempt.findUnique({ where: { id: reserved.attemptId } });
        const operationId = randomUUID(), first = await f.control('PAUSE', { operationId }), replay = await f.control('PAUSE', { operationId, expectedRevision: 2 });
        assert.deepEqual(replay, first); assert.equal(first.control.state, 'PAUSED'); assert.equal(first.control.pending, 0);
        const after = await f.admin.staffOperatorAttempt.findUnique({ where: { id: reserved.attemptId } });
        assert.equal(after.state, 'FAILED'); assert.equal(after.dispatchedAt, null); assert.equal(after.requestCanonical, before.requestCanonical);
        assert.equal(after.reservedMicroUsd, before.reservedMicroUsd); assert.equal(after.actualMicroUsd, null);
        assert.equal(await f.admin.staffWorkspaceOperation.count({ where: { cardId: f.workspaceId } }), 1);
        assert.equal(await f.admin.staffAudit.count({ where: { subjectId: f.workspaceId, event: 'WORKSPACE_OPERATOR_CONTROL' } }), 1);
        await check('ASTRA_LEASE_STALE', () => f.ledger.takeDispatch(f.lease, reserved.attemptId));
        assert.equal((await f.ledger.claim(f.run.id, randomUUID())).mode, 'PAUSED'); assert.equal(f.calls(), 0);
        await assert.rejects(() => context.client.staffOperatorAttempt.findMany());
    }));

    await scenario('workspace pause during dispatch commits the recorded action before releasing its lease', context => fixture(context, async f => {
        const request = await f.request(f.lease, 'read_card_report', {}, { deferReceipt: true });
        const paused = await f.control('PAUSE'); assert.equal(paused.control.state, 'PAUSE_REQUESTED'); assert.equal(paused.control.pending, 1);
        await assert.rejects(() => f.control('TAKE_OVER'), /unresolved work prevents takeover/);
        await f.ledger.recordReceipt(request);
        const applied = await f.ledger.applyTool(f.lease, request.attemptId, async () => ({ synthetic: true }));
        assert.equal(applied.state, 'PAUSED');
        const committed = await f.admin.staffOperatorRun.findUnique({ where: { id: f.run.id } });
        assert.equal(committed.leaseOwner, f.lease.owner); assert.equal(committed.controlState, 'PAUSED');
        assert.equal(await f.admin.staffOperatorStep.count({ where: { runId: f.run.id } }), 1);
        assert.deepEqual(await f.ledger.releasePause(applied.lease), { state: 'PAUSED' });
        const released = await f.admin.staffOperatorRun.findUnique({ where: { id: f.run.id } });
        assert.equal(released.leaseOwner, null); assert.equal(+released.deadlineAt, +f.run.deadlineAt);
        const view = await f.service.activity(f.signed.staff, f.workspaceId);
        assert.equal(view.control.pending, 0); assert.equal(view.control.canStep, true); assert.equal(view.activity.length, 1);
        assert(!JSON.stringify(view).includes('opaque-synthetic-continuation')); assert.equal(f.calls(), 1);
    }));

    await scenario('workspace unknown paid work remains held through pause and blocks step or takeover', context => fixture(context, async f => {
        const request = await f.request(f.lease, 'read_card_report', {}, { unknown: true });
        const before = await f.admin.staffOperatorAttempt.findUnique({ where: { id: request.attemptId } });
        const paused = await f.control('PAUSE'); assert.equal(paused.control.state, 'PAUSE_REQUESTED'); assert.equal(paused.control.pending, 1);
        assert.equal(paused.control.canStep || paused.control.canTakeOver, false);
        await assert.rejects(() => f.control('STEP'), /cannot resume/);
        await assert.rejects(() => f.control('TAKE_OVER'), /unresolved work prevents takeover/);
        const after = await f.admin.staffOperatorAttempt.findUnique({ where: { id: request.attemptId } });
        assert.deepEqual(after, before); assert.equal(after.usageCeilingMicroUsd, null);
        const [usage] = await f.admin.$queryRaw`SELECT * FROM atlas_staff.pilot_budget_usage(${f.run.pilotId}::uuid,${f.run.specimenId}::uuid)`;
        assert.equal(usage.total, String(requestReservation(f.policy.astra) + 10_000));
        assert.equal((await f.admin.staffOperatorRun.findUnique({ where: { id: f.run.id } })).state, 'UNKNOWN'); assert.equal(f.calls(), 1);
    }));

    await scenario('workspace STEP permits one provider action and stops before a second reservation', context => fixture(context, async f => {
        await f.control('PAUSE'); const step = await f.control('STEP'); assert.equal(step.control.mode, 'STEP');
        const claimed = await f.ledger.claim(f.run.id, randomUUID()); assert.equal(claimed.mode, 'WORK'); assert.equal(claimed.lease.fence, 2);
        const request = await f.request(claimed.lease);
        const dispatched = await f.admin.staffOperatorRun.findUnique({ where: { id: f.run.id } }); assert.equal(dispatched.stepBudget, 0);
        await check('ASTRA_WORKFLOW_PAUSED', () => f.ledger.reserve(claimed.lease));
        const applied = await f.ledger.applyTool(claimed.lease, request.attemptId, async () => ({ synthetic: true }));
        assert.equal(applied.state, 'PAUSED'); await f.ledger.releasePause(applied.lease);
        assert.equal((await f.service.activity(f.signed.staff, f.workspaceId)).control.canStep, true);
        assert.equal(await f.admin.staffOperatorAttempt.count({ where: { runId: f.run.id } }), 1); assert.equal(f.calls(), 1);
        assert.equal(await f.admin.staffReportApproval.count(), 0);
    }));

    await scenario('restricted machine credential cannot rearm STEP or resume a human pause directly', context => fixture(context, async f => {
        await f.control('PAUSE'); const paused = await f.admin.staffOperatorRun.findUnique({ where: { id: f.run.id } });
        for (const data of [{ controlState: 'RUNNING', stepBudget: 1 }, { controlState: 'RUNNING' }, { stepBudget: 1 }])
            await assert.rejects(() => f.client.$transaction(async tx => {
                await tx.staffOperatorRun.update({ where: { id: f.run.id }, data: { ...data, controlRevision: { increment: 1 } } });
                await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
            }), /human|control|permit/);
        assert.deepEqual(await f.admin.staffOperatorRun.findUnique({ where: { id: f.run.id } }), paused);
        assert.equal(await f.admin.staffOperatorAttempt.count({ where: { runId: f.run.id } }), 0);
    }));

    await scenario('conflicting late receipt after an applied paused step blocks resume even with no pending attempts', context => fixture(context, async f => {
        await f.control('PAUSE'); await f.control('STEP');
        const { lease } = await f.ledger.claim(f.run.id, randomUUID()), request = await f.request(lease);
        const applied = await f.ledger.applyTool(lease, request.attemptId, async () => ({ synthetic: true }));
        await f.ledger.releasePause(applied.lease);
        const conflict = structuredClone(request.receipt); conflict.body.id = 'resp_synthetic_conflicting_late_response';
        conflict.bodyHash = digest(canonical(conflict.body));
        await f.ledger.recordReceipt({ ...request, receipt: conflict });
        const run = await f.admin.staffOperatorRun.findUnique({ where: { id: f.run.id } });
        assert.equal(run.state, 'UNKNOWN'); assert.equal(run.controlState, 'PAUSED');
        const view = await f.service.activity(f.signed.staff, f.workspaceId);
        assert.equal(view.control.pending, 0); assert.equal(view.control.canResume || view.control.canStep || view.control.canTakeOver, false);
        await assert.rejects(() => f.control('STEP'), /cannot resume/);
        await assert.rejects(() => f.control('RESUME'), /cannot resume/);
        await assert.rejects(() => f.control('TAKE_OVER'), /unresolved work prevents takeover/);
        assert.equal(await f.admin.staffOperatorReceipt.count({ where: { attemptId: request.attemptId } }), 2);
        assert.equal(await f.admin.staffOperatorStep.count({ where: { runId: f.run.id } }), 1); assert.equal(f.calls(), 1);
    }));

    await scenario('settled workspace takeover preserves original proposals and fences late machine effects', context => fixture(context, async f => {
        const manifest = JSON.parse(f.run.manifestCanonical), asset = manifest.assets.find(a => a.side === 'FRONT');
        const report = JSON.parse((await f.admin.staffAnalysisRevision.findUnique({ where: { specimenId_revision: {
            specimenId: f.run.specimenId, revision: 1 } } })).reportCanonical);
        const request = await f.request(f.lease, 'propose_finding_change', { findingId: report.findings[0].id, action: 'RETAIN',
            defectType: null, evidence: [{ assetId: asset.assetId, sha256: asset.sha256, side: asset.side }], rect: null,
            reason: 'PHYSICAL_DAMAGE', summary: 'Synthetic original observation for comparison.', alternativeExplanation: null });
        const applied = await f.ledger.applyTool(f.lease, request.attemptId, async () => ({ status: 'PROPOSED_FOR_HUMAN_REVIEW' }));
        const originalStep = await f.admin.staffOperatorStep.findFirst({ where: { runId: f.run.id } }), before = await f.card();
        const taken = await f.control('TAKE_OVER'); assert.equal(taken.card.operator.kind, 'HUMAN');
        const after = await f.card(); assert.equal(after.claimFence, before.claimFence + 1); assert.equal(after.startedAt, before.startedAt);
        const run = await f.admin.staffOperatorRun.findUnique({ where: { id: f.run.id } });
        assert.equal(run.state, 'FAILED'); assert.equal(run.controlState, 'TAKEN_OVER'); assert.equal(run.leaseOwner, null);
        assert.match(run.inputCanonical, /opaque-synthetic-continuation/);
        await check('ASTRA_LEASE_STALE', () => f.ledger.reserve(applied.lease));
        await check('ASTRA_LEASE_STALE', () => f.ledger.applyTool(applied.lease, request.attemptId, () => { throw Error('Must never apply'); }));
        await f.ledger.recordReceipt(request); // Late exact replay may retain its receipt, never regain a tool lease.
        assert.deepEqual(await f.admin.staffOperatorStep.findUnique({ where: { id: originalStep.id } }), originalStep);
        const view = await f.service.activity(f.signed.staff, f.workspaceId);
        assert.equal(view.activity[0].proposal.action, 'RETAIN'); assert.equal(view.control.canTakeOver, false);
        assert.equal(await f.admin.staffReportApproval.count(), 0); assert.equal(f.calls(), 1);
    }, { tools: ['propose_finding_change'] }));

    await scenario('workspace SQL control rejects changed actor session claim or revision and needs the exact same-transaction action', context => fixture(context, async f => {
        const before = await f.admin.staffOperatorRun.findUnique({ where: { id: f.run.id } });
        for (const overrides of [{ actorId: randomUUID() }, { sessionHash: 'f'.repeat(64) }, { fence: 2 }, { revision: 1 }])
            await assert.rejects(() => f.directControl(overrides), /control unavailable/);
        await assert.rejects(() => f.directControl(), /requires its exact immutable human command/);
        assert.deepEqual(await f.admin.staffOperatorRun.findUnique({ where: { id: f.run.id } }), before);
        assert.equal(await f.admin.staffWorkspaceOperation.count({ where: { cardId: f.workspaceId } }), 0);
        assert.equal(await f.admin.staffAudit.count({ where: { subjectId: f.workspaceId, event: 'WORKSPACE_OPERATOR_CONTROL' } }), 0);
    }));

    await scenario('revoked staff session cannot control a workspace through either service or direct SQL', context => fixture(context, async f => {
        const scope = await f.scope(), card = await f.card();
        await context.auth.logout(f.signed.cookie, f.signed.csrf);
        await check('SIGN_IN_REQUIRED', () => f.control('PAUSE'));
        await assert.rejects(() => context.client.$queryRaw`SELECT atlas_staff.control_workspace_operator(${f.workspaceId}::uuid,
            ${card.claimFence}::integer,'PAUSE',${scope.actorId}::uuid,${scope.sessionHash}::text,${card.revision}::integer)`, /control unavailable/);
        assert.equal((await f.admin.staffOperatorRun.findUnique({ where: { id: f.run.id } })).controlState, 'RUNNING');
    }));
}
