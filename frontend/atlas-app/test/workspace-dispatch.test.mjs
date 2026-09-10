import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { attachWorkspaceDispatch } from '../lib/server/access/workspace-dispatch.mjs';

function fixture() {
    const actorId = randomUUID(), runId = randomUUID(), cardId = randomUUID();
    const claim = { id: randomUUID(), kind: 'ASTRA', runId, actorId, accessVersion: 1, controlRevision: 1, fence: 1,
        captureRevision: 1, captureHash: 'a'.repeat(64), workflowRevision: 3 };
    const card = { id: cardId, claimFence: 1, claim: structuredClone(claim) };
    const identity = { id: actorId, role: 'REVIEWER', accessVersion: 1 };
    const f = { cardId, runId, card, identity, committed: false, transaction: false, calls: [], commands: new Map() };
    const store = { async transaction(staff, work) { assert.equal(f.committed, true); f.transaction = true;
        try { return await work({ identity, control: { revision: 1 }, tx: {
            getOperation: async (actor, operationId) => { const saved = f.commands.get(operationId); return saved?.actorId === actor ? saved : null; } },
            policy: { astraEnabled: true, expiresAt: new Date(Date.now() + 60000) }, now: new Date() }); }
        finally { f.transaction = false; } } };
    const commit = (input, action) => {
        f.committed = true;
        if (!f.commands.has(input.operationId)) f.commands.set(input.operationId, { id: randomUUID(), actorId, cardId, operationId: input.operationId,
            action, result: action === 'claim' ? { claim: structuredClone(claim) }
                : { priorClaim: structuredClone(claim), runId, action: input.action } });
        return { card: { id: cardId }, operationId: input.operationId };
    };
    f.intake = { async card() { return card; }, async claim(staff, id, input) { return commit(input, 'claim'); } };
    f.operator = { async control(staff, id, input) { return commit(input, 'OPERATOR_CONTROL'); } };
    attachWorkspaceDispatch({ intake: f.intake, operator: f.operator, store, async dispatch(input) {
        assert.equal(f.committed, true); assert.equal(f.transaction, false); f.calls.push(input);
        if (f.fail) throw new Error('provider secret must not surface');
        return f.reply ?? { state: f.settled ? 'SETTLED' : 'ACCEPTED', ...input };
    } });
    f.input = (extra = {}) => ({ operationId: randomUUID(), ...extra });
    return f;
}
test('Start Astra sends only the saved database command and run outside the committed claim transaction', async () => {
    const f = fixture(), input = f.input({ operator: 'ASTRA' });
    assert.equal((await f.intake.claim({}, f.cardId, input)).operationId, input.operationId);
    assert.deepEqual(f.calls, [{ runId: f.runId, commandId: f.commands.get(input.operationId).id }]);
});
test('lost dispatch reply replays the same exact command even after the claim points to its report successor', async () => {
    const f = fixture(), input = f.input({ operator: 'ASTRA' }); f.fail = true;
    await assert.rejects(f.intake.claim({}, f.cardId, input), /WORKSPACE_ASTRA_DISPATCH_UNCONFIRMED/);
    assert.equal(f.committed, true); f.fail = false; f.settled = true; f.card.claim.runId = randomUUID();
    assert.equal((await f.intake.claim({}, f.cardId, input)).operationId, input.operationId);
    assert.equal(f.commands.size, 1); assert.deepEqual(f.calls[0], f.calls[1]); assert.equal(f.calls[1].runId, f.runId);
});
test('human claim, pause and takeover never dispatch; Resume and STEP have distinct saved command IDs', async () => {
    const f = fixture(); await f.intake.claim({}, f.cardId, f.input({ operator: 'HUMAN' }));
    for (const action of ['PAUSE', 'TAKE_OVER']) await f.operator.control({}, f.cardId, f.input({ action }));
    assert.equal(f.calls.length, 0);
    for (const action of ['RESUME', 'STEP']) await f.operator.control({}, f.cardId, f.input({ action }));
    assert.equal(f.calls.length, 2); assert.notEqual(f.calls[0].commandId, f.calls[1].commandId);
});
test('changed original claim or wrong acknowledgment cannot clear the retained command', async () => {
    for (const change of [f => { f.card.claim.id = randomUUID(); }, f => { f.card.claim.accessVersion++; },
        f => { f.reply = { state: 'ACCEPTED', runId: f.runId, commandId: randomUUID() }; }]) {
        const f = fixture(), input = f.input({ operator: 'ASTRA' }); change(f);
        await assert.rejects(f.intake.claim({}, f.cardId, input), /WORKSPACE_ASTRA_(?:NOT_READY|DISPATCH_UNCONFIRMED)/);
        assert.equal(f.commands.size, 1);
    }
});
