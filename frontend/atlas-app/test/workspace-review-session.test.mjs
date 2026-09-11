import test from 'node:test';
import assert from 'node:assert/strict';
import { workspaceReviewSession } from '../lib/server/access/workspace-review-session.mjs';
function fixture(role = 'REVIEWER') {
    let card = { id: 'card', revision: 3, state: 'IN_PROGRESS', stage: 'REPORT', specimenId: 'report', workspace: {} }, writes = 0;
    const operations = new Map(), identity = { id: 'reviewer', role, name: 'Reviewer' };
    const now = new Date('2026-09-10T23:00:00Z');
    const tx = { getOperation: async (_, id) => operations.get(id), updateCard: async next => { card = next; writes++; },
        insertOperation: async operation => operations.set(operation.operationId, operation) };
    const store = { transaction: (_, work) => work({ tx, identity, now }) };
    const projectCard = async (_, value) => ({ ...value, state: 'HUMAN_REVIEW', workspace: { ...value.workspace, reportAccess: true } });
    const run = workspaceReviewSession({ store, intake: { card: async () => card }, projectCard });
    return { run: input => run({}, 'card', input), get card() { return card; }, get writes() { return writes; }, identity, operations };
}
test('explicit review pickup and pause persist once; replay never restarts the clock', async () => {
    const f = fixture(), input = { action: 'START', operationId: 'review-start-1', expectedRevision: 3 };
    await f.run(input); assert.equal(f.card.workspace.reviewSession.state, 'ACTIVE'); assert.equal(f.writes, 1);
    const first = f.card.workspace.reviewSession.startedAt;
    await f.run(input); assert.equal(f.writes, 1); assert.equal(f.card.workspace.reviewSession.startedAt, first);
    await f.run({ action: 'PAUSE', operationId: 'review-pause-1', expectedRevision: 4 });
    assert.equal(f.card.workspace.reviewSession.state, 'PAUSED'); assert.equal(f.operations.size, 2);
    assert.equal(f.card.specimenId, 'report');
});
test('observation, stale revisions and another reviewer cannot pick up active review', async () => {
    const observer = fixture('OBSERVER');
    await assert.rejects(observer.run({ action: 'START', operationId: 'review-start-1', expectedRevision: 3 }), /WORKSPACE_CONTROL_ACCESS_REQUIRED/);
    assert.equal(observer.writes, 0);
    const f = fixture();
    await assert.rejects(f.run({ action: 'START', operationId: 'review-start-1', expectedRevision: 2 }), error => error.code === 'WORKSPACE_REVISION_CHANGED' && error.outcome === 'NOT_DISPATCHED');
    await f.run({ action: 'START', operationId: 'review-start-1', expectedRevision: 3 });
    f.identity.id = 'other-reviewer';
    await assert.rejects(f.run({ action: 'START', operationId: 'review-start-2', expectedRevision: 4 }), /WORKSPACE_REVIEW_CLAIMED/);
    assert.equal(f.writes, 1);
});
