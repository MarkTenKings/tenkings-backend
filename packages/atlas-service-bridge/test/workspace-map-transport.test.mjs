import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { signWorkspaceRequest, verifyWorkspaceRequest } from '../src/workspace.mjs';

const config = { origin: 'https://workspace-source.example.invalid', key: Buffer.alloc(32, 37), configHash: 'a'.repeat(64), releaseSha: 'b'.repeat(40), deploymentId: 'fixture-staff' };
const request = () => ({ requestId: randomUUID(), cardId: randomUUID(), scope: { actorId: randomUUID(), sessionHash: 'c'.repeat(64), controlRevision: 3 },
    binding: { captureRevision: 1, captureHash: 'd'.repeat(64), claimFence: 2, workflowRevision: 14 } });

test('named map actions preserve exact retained human intent and cannot carry a caller-selected map binding', () => {
    for (const action of ['RESOLVE_MAP', 'REGISTER_MAP', 'CONTINUE_WITHOUT_MAP']) {
        const input = request(), signed = signWorkspaceRequest(config, action, input), verified = verifyWorkspaceRequest(config, signed.body, signed.signature);
        assert.equal(verified.claims.action, action); assert.deepEqual(verified.input, input);
        assert.throws(() => signWorkspaceRequest(config, action, { ...input, mapBinding: { revisionId: 'chosen', registration: {} } }));
        assert.throws(() => signWorkspaceRequest(config, action, { ...input, decisionId: randomUUID() }));
        assert.throws(() => signWorkspaceRequest(config, action, { ...input, scope: { actorKind: 'MACHINE', actorId: input.scope.actorId, accessVersion: 1,
            controlRevision: 3, runId: randomUUID(), runRevision: 7, leaseFence: 1, runControlRevision: 1 } }));
    }
});
