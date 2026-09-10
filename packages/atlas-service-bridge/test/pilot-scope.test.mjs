import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { requirePilotCards, pilotSubject } from '../src/pilot-scope.mjs';

const policy = (length, workspace = true) => ({ version: workspace ? 'atlas-workspace-bridge-policy-v1' : 'atlas-grading-bridge-policy-v1',
    pilotId: randomUUID(), [workspace ? 'workspaceCardIds' : 'specimenIds']: Array.from({ length }, randomUUID),
    expiresAt: '2026-09-16T01:00:00.000Z', maxOperationsPerCard: 20, maxTotalMicroUsd: 90_000_000,
    maxCardMicroUsd: 90_000_000, reservationPerOperationMicroUsd: 100_000, maxWorkerCalls: 2, deadlineMs: 200_000 });

test('verified count must equal the exact admitted workspace roster, while legacy still requires ten', async () => {
    for (const length of [1, 10]) {
        const p = policy(length);
        for (const count of [0, length, length + 1]) {
            const tx = { async $queryRaw(strings, ...args) {
                assert(strings.join('?').includes('operator_workspace_count')); assert.deepEqual(args, [p.pilotId]); return [{ count }];
            } };
            if (count === length) await requirePilotCards(tx, p, 'LOCAL_FIXTURE');
            else await assert.rejects(requirePilotCards(tx, p, 'LOCAL_FIXTURE'), /PILOT_WORKSPACE_ROSTER_INCOMPLETE/);
        }
        const card = { id: randomUUID() };
        for (const id of [p.workspaceCardIds[0], randomUUID(), null]) {
            const subject = await pilotSubject({ $queryRaw: async () => [{ id }] }, p, card);
            assert.deepEqual(subject, id === p.workspaceCardIds[0] ? { specimenId: card.id, workspaceCardId: id } : null);
        }
    }
    const legacy = policy(10, false);
    await requirePilotCards({ $queryRaw: async () => [{ count: 10 }] }, legacy, 'LOCAL_FIXTURE');
    await assert.rejects(requirePilotCards({ $queryRaw: async () => [{ count: 9 }] }, legacy, 'LOCAL_FIXTURE'), /PILOT_TEN_CARDS_REQUIRED/);
    for (const invalid of [policy(0), policy(11), policy(9, false)])
        await assert.rejects(requirePilotCards({ $queryRaw: async () => assert.fail('invalid roster queried') }, invalid, 'LOCAL_FIXTURE'),
            /BRIDGE_PILOT_POLICY_INVALID/);
});
