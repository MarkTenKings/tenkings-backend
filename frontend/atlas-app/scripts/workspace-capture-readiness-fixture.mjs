import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { canonical, digest } from '@atlas/service-bridge/protocol';
import { workspaceCaptureFixture } from './workspace-capture-fixture.mjs';

export async function workspaceCaptureReadinessScenarios(scenario) {
    await scenario('existing staff read RPC agrees with exact capture admission without exposing or broadening its roster', context => workspaceCaptureFixture(context, async f => {
        const id = f.ids[0], input = { operationId: randomUUID(), expectedRevision: (await f.card()).revision, operator: 'ASTRA' };
        const control = () => f.store.transaction(f.signed.staff, async c => {
            const [row] = await c.databaseTx.$queryRaw`SELECT atlas_staff.read_workspace_operator_control(${id}::uuid) AS control`;
            return row.control;
        });
        const setRoster = async roster => {
            const policyCanonical = canonical({ ...f.budget, workspaceCardIds: roster });
            await f.admin.staffGradingBridgeControl.update({ where: { id: 'active' }, data: {
                policyCanonical, policyHash: digest(policyCanonical), revision: { increment: 1 } } });
        };
        const initial = await control();
        assert.deepEqual(initial.captureReadiness, { ready: true, code: null });
        assert.equal(initial.state, 'UNAVAILABLE'); assert.equal(initial.pending, 0); assert.equal(initial.settled, true);
        assert.equal((await f.intake.read(f.signed.staff, id)).card.capabilities.astraClaim, true);
        await setRoster([randomUUID()]);
        const before = await f.card(), commands = await f.admin.staffWorkspaceOperation.count({ where: { cardId: id } });
        assert.deepEqual((await control()).captureReadiness, { ready: false, code: 'WORKSPACE_ASTRA_NOT_ADMITTED' });
        assert.equal((await f.intake.read(f.signed.staff, id)).card.capabilities.astraClaim, false);
        await assert.rejects(f.intake.claim(f.signed.staff, id, input), e => e.code === 'WORKSPACE_ASTRA_NOT_ADMITTED'
            && e.status === 409 && e.outcome === 'NOT_DISPATCHED');
        assert.deepEqual(await f.card(), before);
        assert.equal(await f.admin.staffWorkspaceOperation.count({ where: { cardId: id } }), commands);
        assert.equal(await f.admin.staffOperatorRun.count({ where: { workspaceCardId: id } }), 0);
        await setRoster([id, randomUUID()]);
        assert.deepEqual((await control()).captureReadiness, { ready: false, code: 'WORKSPACE_ASTRA_NOT_READY' });
        await setRoster([id]);
        await f.admin.staffOperatorControl.update({ where: { id: 'active' }, data: { enabled: false, revision: { increment: 1 } } });
        assert.deepEqual((await control()).captureReadiness, { ready: false, code: 'WORKSPACE_ASTRA_NOT_READY' });
        await f.admin.staffOperatorControl.update({ where: { id: 'active' }, data: { enabled: true, revision: { increment: 1 } } });
        assert.deepEqual((await control()).captureReadiness, { ready: true, code: null });
        await assert.rejects(f.store.transaction(f.signed.staff, c => c.databaseTx.$queryRaw`SELECT atlas_staff.workspace_capture_readiness(${id}::uuid)`), /permission denied/);
        const admitted = await f.intake.claim(f.signed.staff, id, input);
        assert.equal(admitted.card.operator.kind, 'ASTRA'); assert.equal(admitted.card.revision, before.revision + 1);
        assert.equal(await f.admin.staffOperatorRun.count({ where: { workspaceCardId: id } }), 1);
        assert.equal(await f.admin.staffOperatorAttempt.count(), 0);
        const active = await control(); assert.equal(active.state, 'QUEUED'); assert.equal(active.captureReadiness, undefined);
        const replay = await f.intake.claim(f.signed.staff, id, input);
        assert.equal(replay.operationId, admitted.operationId); assert.equal(replay.card.revision, admitted.card.revision);
        assert.equal(await f.admin.staffOperatorRun.count({ where: { workspaceCardId: id } }), 1);
    }, { rosterSize: 1, captureRpc: true }));
}
