import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { workspaceCaptureFixture, updateWorkspaceFixtureCard } from './workspace-capture-fixture.mjs';
import { projectWorkspaceControlTiming, workspaceOperatorSqlPort } from '../lib/server/access/workspace-operator.mjs';
import { workspaceReviewSession } from '../lib/server/access/workspace-review-session.mjs';
import { projectWorkspaceTiming } from '../lib/workspace-timing.mjs';

export async function workspaceTimingScenarios(scenario) {
    await scenario('durable workspace timing excludes photo queue waits and stops at a settled STEP boundary', context => workspaceCaptureFixture(context, async f => {
        const read = () => f.store.transaction(f.signed.staff, async context => workspaceOperatorSqlPort.read(context, { card: await f.card() }));
        const waiting = projectWorkspaceControlTiming(await read());
        assert.equal(waiting.totalActiveMs, 0); assert.equal(waiting.startedAt, null); assert.equal(waiting.runningSince, null);
        let { card } = await f.intake.claim(f.signed.staff, f.ids[0], { operationId: randomUUID(), expectedRevision: (await f.card()).revision, operator: 'ASTRA', mode: 'STEP' });
        const saved = await f.card(), { lease } = await f.ledger.claim(saved.claim.runId, randomUUID());
        const applied = await f.apply(lease, await f.request(lease, 'read_original_photos'));
        await f.ledger.releasePause(applied.lease);
        const raw = await read(), timing = projectWorkspaceControlTiming(raw);
        assert.equal(raw.state, 'PAUSED'); assert.equal(timing.currentStage, 'IDENTITY'); assert.equal(timing.runningSince, null);
        assert.equal(timing.pausedReason, 'PAUSED'); assert(timing.stages.find(s => s.stage === 'PHOTOS').completedAt);
        assert(timing.stages.find(s => s.stage === 'PHOTOS').activeMs > 0);
        const later = projectWorkspaceControlTiming({ ...raw, timingHistory: { ...raw.timingHistory, asOf: new Date(Date.parse(raw.timingHistory.asOf) + 300000).toISOString() } });
        assert.equal(later.totalActiveMs, timing.totalActiveMs);
        assert.equal(JSON.stringify(timing).includes('opaque-synthetic'), false);
        await assert.rejects(() => context.client.$queryRaw`SELECT atlas_staff.workspace_timing_history(${card.id}::uuid)`, /permission denied/);
        assert.equal(f.calls(), 1); assert.equal(await f.admin.staffReportApproval.count(), 0);
    }, { rosterSize: 1, captureRpc: true }));

    await scenario('explicit review pickup writes durable timing without publishing and pause remains stopped on reload', context => workspaceCaptureFixture(context, async f => {
        // A synthetic ready-for-review projection isolates the pickup boundary;
        // report publication and the complete pipeline have separate scenarios.
        await updateWorkspaceFixtureCard(f.admin, await f.card(), { state: 'HUMAN_REVIEW', stage: 'REVIEW', specimenId: f.initialized.id });
        const review = workspaceReviewSession({ store: f.store, intake: f.intake,
            projectCard: async (_context, card) => ({ ...card, workspace: { ...card.workspace, reportAccess: true } }) });
        const input = { operationId: randomUUID(), expectedRevision: (await f.card()).revision, action: 'START' };
        await review(f.signed.staff, f.ids[0], input); await review(f.signed.staff, f.ids[0], input);
        assert.equal(await f.admin.staffWorkspaceOperation.count({ where: { cardId: f.ids[0], action: 'REVIEW_SESSION' } }), 1);
        const pause = { operationId: randomUUID(), expectedRevision: (await f.card()).revision, action: 'PAUSE' };
        await review(f.signed.staff, f.ids[0], pause);
        const [{ history }] = await f.admin.$queryRaw`SELECT atlas_staff.workspace_timing_history(${f.ids[0]}::uuid) AS history`;
        const timing = projectWorkspaceTiming(history), later = projectWorkspaceTiming({ ...history, asOf: new Date(Date.parse(history.asOf) + 3600000).toISOString() });
        assert.equal(timing.currentStage, 'REVIEW'); assert.equal(timing.runningSince, null); assert.equal(timing.pausedReason, 'PAUSED');
        assert.equal(later.totalActiveMs, timing.totalActiveMs); assert.equal(timing.stages.find(s => s.stage === 'REVIEW').activeMs, timing.totalActiveMs);
        assert.equal(await f.admin.staffReportApproval.count(), 0); assert.equal(f.calls(), 0);
    }, { rosterSize: 1, report: true }));
}
