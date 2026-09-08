import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { canonical, digest, keys, parsePilotPolicy, signRequest, verifyRequest } from '../src/protocol.mjs';
import { boundedBytes, boundedWorkerFetch, bridgeClient } from '../src/transport.mjs';
const config = () => ({ origin: 'https://bridge.example.test', key: randomBytes(32), deploymentId: 'staff-release.vercel.app', releaseSha: 'a'.repeat(40) });
const scope = () => ({ controlRevision: 1, specimenId: randomUUID(), actorId: randomUUID(), sessionHash: 'b'.repeat(64), assignmentFence: 2, evidenceHash: 'c'.repeat(64) });
test('MAC binds exact purpose, destination, actor, case, payload, lifetime and canonical bytes', () => {
    const c = config(), s = scope(), payload = { action: 'RUN_REVIEW', operationId: randomUUID() };
    const packet = signRequest(c, s, payload, 100_000);
    assert.deepEqual(verifyRequest(c, packet.body, packet.signature, 100_001).payload, payload);
    assert.throws(() => verifyRequest(c, packet.body, packet.signature, 130_000));
    assert.throws(() => verifyRequest(c, packet.body, packet.signature, 99_999));
    assert.throws(() => verifyRequest({ ...c, origin: 'https://other.example.test' }, packet.body, packet.signature, 100_001));
    assert.throws(() => verifyRequest({ ...c, key: randomBytes(32) }, packet.body, packet.signature, 100_001));
    assert.throws(() => verifyRequest(c, packet.body.replace(s.specimenId, randomUUID()), packet.signature, 100_001));
    assert.throws(() => verifyRequest(c, packet.body + '\n', packet.signature, 100_001));
    assert.throws(() => signRequest(c, s, { ...payload, url: 'https://elsewhere.example.test' }));
    assert.throws(() => keys({ 'a|b': 1 }, ['a', 'b']));
});
test('policy requires exactly ten distinct cards and bounded nonzero reservations', () => {
    const policy = { version: 'atlas-grading-bridge-policy-v1', pilotId: randomUUID(), specimenIds: Array.from({ length: 10 }, randomUUID),
        expiresAt: '2026-09-09T01:00:00.000Z', maxOperationsPerCard: 20, maxTotalMicroUsd: 1_000_000,
        maxCardMicroUsd: 100_000, reservationPerOperationMicroUsd: 10_000, maxWorkerCalls: 4, deadlineMs: 200_000 };
    assert.equal(parsePilotPolicy(policy), policy);
    for (const update of [{ specimenIds: policy.specimenIds.slice(0, 9) }, { specimenIds: Array(10).fill(policy.specimenIds[0]) },
        { reservationPerOperationMicroUsd: 0 }, { maxWorkerCalls: 5 }, { deadlineMs: 200_001 }, { arbitraryTool: 'run' }])
        assert.throws(() => parsePilotPolicy({ ...policy, ...update }));
});
test('private client has one destination, one call and no redirect/retry on uncertainty', async () => {
    const c = config(); let calls = 0;
    const client = bridgeClient(c, async (url, init) => {
        calls++; assert.equal(url, c.origin + '/api/internal/atlas/bridge'); assert.equal(init.redirect, 'error');
        const verified = verifyRequest(c, init.body, init.headers['x-atlas-signature']);
        assert.equal(verified.payload.action, 'RUN_REVIEW'); throw new Error('lost reply');
    });
    await assert.rejects(client.call(scope(), { action: 'RUN_REVIEW', operationId: randomUUID() }), /lost reply/);
    assert.equal(calls, 1); assert.equal(client.binding.clientKeyHash, digest(c.key));
});
test('bounded readers cancel excess streams and reject invalid declared sizes', async () => {
    await assert.rejects(boundedBytes(new Response('12345'), 4), /TOO_LARGE/);
    await assert.rejects(boundedBytes(new Response('123', { headers: { 'content-length': 'huge' } }), 4), /INVALID/);
    assert.equal((await boundedBytes(new Response('1234'), 4)).toString(), '1234');
});
test('worker wrapper retains source body and rejects destinations or calls beyond reservation', async () => {
    let calls = 0;
    const request = boundedWorkerFetch({ serviceUrl: 'https://worker.example.test/api', maxCalls: 2,
        signal: AbortSignal.timeout(5000), fetchImpl: async (url, init) => { calls++; assert.equal(init.redirect, 'error');
            assert.equal(init.body, canonical({ side: 'FRONT' })); return Response.json({ defects: [] }); } });
    const init = { method: 'POST', body: canonical({ side: 'FRONT' }) };
    await assert.rejects(request('https://other.example.test/api/measure', init));
    await request('https://worker.example.test/api/measure', init); await request('https://worker.example.test/api/detect', init);
    await assert.rejects(request('https://worker.example.test/api/detect', init), /CALL_LIMIT/); assert.equal(calls, 2);
});
