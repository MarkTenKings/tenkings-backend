import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { canonical, digest, parsePilotPolicy, pilotDollarLimitsAllow } from '../src/protocol.mjs';

const policy = () => ({ version: 'atlas-workspace-bridge-policy-v1', pilotId: randomUUID(), workspaceCardIds: [randomUUID()],
    expiresAt: '2026-09-16T20:41:57.000Z', maxOperationsPerCard: 10, maxTotalMicroUsd: 90_000_000,
    maxCardMicroUsd: 45_000_000, reservationPerOperationMicroUsd: 10_000, maxWorkerCalls: 4, deadlineMs: 200_000 });

test('historical policies retain their exact bytes and original dollar refusal', () => {
    const p = policy(), text = canonical(p), hash = digest(text);
    assert.equal(parsePilotPolicy(p), p);
    assert.equal(pilotDollarLimitsAllow(p, { total: '89999999', card: '44999999', overrun: false }, 1n), true);
    assert.equal(pilotDollarLimitsAllow(p, { total: '89999999', card: '44999999', overrun: false }, 2n), false);
    assert.equal(pilotDollarLimitsAllow(p, { total: '0', card: '0', overrun: true }), false);
    assert.equal(canonical(p), text); assert.equal(digest(canonical(p)), hash);
    assert.equal(Object.hasOwn(p, 'budgetEnforcement'), false);
});

test('explicit accounting mode preserves usage and admits dollars above every historical cap', () => {
    const p = { ...policy(), budgetEnforcement: 'ACCOUNTING_ONLY', maxTotalMicroUsd: 1, maxCardMicroUsd: 2 };
    const usage = { total: '90000000123', card: '50000000001', overrun: true }, before = structuredClone(usage);
    const text = canonical(p);
    assert.equal(pilotDollarLimitsAllow(p, usage, 23_650_000n), true);
    assert.deepEqual(usage, before); assert.equal(canonical(p), text);
    const { budgetEnforcement: _mode, ...enforced } = p;
    assert.throws(() => parsePilotPolicy(enforced), /BRIDGE_PILOT_POLICY_INVALID/);
});

test('null, misspelled or coercible modes never disable dollar enforcement', () => {
    for (const budgetEnforcement of [null, undefined, false, true, 0, '', 'accounting_only', 'ENFORCED', {}, ['ACCOUNTING_ONLY']]) {
        const p = { ...policy(), budgetEnforcement };
        assert.throws(() => parsePilotPolicy(p), /BRIDGE_PILOT_POLICY_INVALID/);
        assert.throws(() => pilotDollarLimitsAllow(p, { total: '0', card: '0', overrun: false }));
    }
});

test('accounting mode retains scope, expiry shape, count, worker and representation bounds', () => {
    const p = { ...policy(), budgetEnforcement: 'ACCOUNTING_ONLY' };
    for (const change of [{ workspaceCardIds: [] }, { workspaceCardIds: [p.workspaceCardIds[0], p.workspaceCardIds[0]] },
        { pilotId: 'another-pilot' }, { expiresAt: 'tomorrow' }, { maxOperationsPerCard: 101 }, { maxOperationsPerCard: 0 },
        { maxWorkerCalls: 5 }, { deadlineMs: 200001 }, { reservationPerOperationMicroUsd: 0 },
        { reservationPerOperationMicroUsd: 1e12 + 1 }, { maxCardMicroUsd: NaN }, { maxTotalMicroUsd: null }, { maxCardMicroUsd: 1.5 }])
        assert.throws(() => parsePilotPolicy({ ...p, ...change }));
});

test('accounting mode cannot turn malformed accounting into zero exposure', () => {
    const p = { ...policy(), budgetEnforcement: 'ACCOUNTING_ONLY' };
    for (const total of [null, undefined, '', '-1', '1.5', {}, [], NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
        assert.throws(() => pilotDollarLimitsAllow(p, { total, card: '0', overrun: false }));
    for (const overrun of [null, undefined, 0, 'false'])
        assert.throws(() => pilotDollarLimitsAllow(p, { total: '0', card: '0', overrun }));
    for (const reserve of [null, undefined, -1n, 1.5, '']) {
        if (reserve === undefined) continue; // Omitted reserve is the explicit zero default.
        assert.throws(() => pilotDollarLimitsAllow(p, { total: '0', card: '0', overrun: false }, reserve));
    }
    assert.equal(pilotDollarLimitsAllow(p, { total: 0, card: 0n, overrun: false }), true);
});
