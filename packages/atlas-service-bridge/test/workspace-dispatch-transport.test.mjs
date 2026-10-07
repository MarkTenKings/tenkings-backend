import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { signWorkspaceRequest, verifyWorkspaceRequest } from '../src/workspace.mjs';

test('signed workspace dispatch binds one saved command and run; browser authority or source selectors are refused', () => {
    const config = { origin: 'https://private.example', key: randomBytes(32), configHash: 'a'.repeat(64),
        releaseSha: 'b'.repeat(40), deploymentId: 'current-staff-release' }, input = { runId: randomUUID(), commandId: randomUUID() };
    const signed = signWorkspaceRequest(config, 'EXECUTE_ASTRA', input, 10000);
    assert.deepEqual(verifyWorkspaceRequest(config, signed.body, signed.signature, 10001).input, input);
    for (const extra of [{ sourceId: 'original' }, { actorId: randomUUID() }, { mode: 'CONTINUOUS' }, { approved: true }])
        assert.throws(() => signWorkspaceRequest(config, 'EXECUTE_ASTRA', { ...input, ...extra }, 10000));
    for (const invalid of [{ runId: input.runId }, { ...input, commandId: 'missing-command' }])
        assert.throws(() => signWorkspaceRequest(config, 'EXECUTE_ASTRA', invalid, 10000));
    const changed = JSON.parse(signed.body); changed.input.commandId = randomUUID();
    assert.throws(() => verifyWorkspaceRequest(config, JSON.stringify(changed), signed.signature, 10001));
    assert.throws(() => verifyWorkspaceRequest({ ...config, deploymentId: 'another-release' }, signed.body, signed.signature, 10001));
    assert.throws(() => verifyWorkspaceRequest(config, signed.body, signed.signature, 40000));
});
