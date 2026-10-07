import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { canonical, digest } from '@atlas/service-bridge/protocol';
import { OperatorLedger } from '../src/ledger.mjs';
import { MODEL, PRICING } from '../src/responses.mjs';

// Match an image-bearing continuation's size without using any real card data.
const inputCanonical = canonical([{ role: 'user', content: [{ type: 'input_image',
    image_url: `data:image/png;base64,${'A'.repeat(7_350_000)}` }] }]);
const inputHash = digest(inputCanonical);
const attemptFields = ['runId', 'dispatchClaimId', 'providerBindingHash', 'dispatchedAt', 'state',
    'resultReceiptId', 'finishedAt', 'leaseFence', 'runRevision'];
const runReceiptFields = ['id', 'state', 'policyCanonical', 'policyHash', 'runtimeHash', 'leaseFence',
    'revision', 'leaseMode', 'leaseExpiresAt', 'deadlineAt'];

function projected(row, select, allowed) {
    assert(select && Object.keys(select).length, 'database operation must explicitly project its return');
    for (const [key, enabled] of Object.entries(select)) {
        assert.equal(enabled, true); assert(allowed.includes(key), `unexpected return field: ${key}`);
        assert(Object.hasOwn(row, key), `fixture is missing selected field: ${key}`);
    }
    const result = Object.fromEntries(Object.keys(select).map(key => [key, row[key]]));
    assert(Buffer.byteLength(JSON.stringify(result)) < 8192, 'metadata return must not contain the large request/continuation');
    return result;
}

function fixture() {
    const now = new Date('2026-09-11T07:06:40.000Z'), pilotId = randomUUID();
    const policy = { version: 'atlas-operator-control-policy-v1', pilotId,
        expiresAt: new Date(+now + 3_600_000).toISOString(), prompt: 'Synthetic projection test.',
        astra: { version: 'atlas-astra-policy-v1', model: MODEL, returnedModel: MODEL, effort: 'max', serviceTier: 'default',
            maxOutputTokens: 2000, requestTimeoutMs: 180_000, pricingVersion: PRICING.version,
            inputNanoUsdPerToken: PRICING.inputNanoUsdPerToken, outputNanoUsdPerToken: PRICING.outputNanoUsdPerToken },
        tools: ['read_card_report'], maxAttemptsPerCard: 10, maxStepsPerRun: 10, maxRunMs: 600_000,
        leaseMs: 30_000, concurrency: 1 };
    const policyCanonical = canonical(policy), current = { id: randomUUID(), specimenId: randomUUID(), pilotId,
        phase: 'REPORT_REVIEW', state: 'RUNNING', revision: 3, controlRevision: 7,
        leaseOwner: randomUUID(), leaseFence: 2, leaseMode: 'WORK', leaseExpiresAt: new Date(+now + 10_000),
        deadlineAt: new Date(+now + 60_000), policyCanonical, policyHash: digest(policyCanonical),
        runtimeHash: 'b'.repeat(64), gradingPolicyHash: 'c'.repeat(64), evidenceHash: 'd'.repeat(64),
        expectedAnalysisRevision: 1, expectedReviewRevision: 2,
        manifestCanonical: '{}', manifestHash: digest('{}'), inputCanonical, inputHash };
    const card = { id: current.specimenId, evidenceHash: current.evidenceHash, analysisRevision: 1, draftRevision: 2 };
    const config = { configHash: current.runtimeHash, providerBindingHash: 'e'.repeat(64) };
    const attempt = { id: randomUUID(), runId: current.id, dispatchClaimId: randomUUID(),
        providerBindingHash: config.providerBindingHash, dispatchedAt: new Date(+now - 10_000), state: 'DISPATCHED',
        resultReceiptId: null, finishedAt: null, leaseFence: current.leaseFence, runRevision: current.revision,
        requestCanonical: inputCanonical, reservedMicroUsd: 25_000_000n,
        usageCeilingMicroUsd: null, usageEnvelopeExceeded: false };
    const f = { now, policy, current, card, attempt, config, receipts: [], writes: [], fullRunReads: 0, gradingPending: 0,
        control: { enabled: true, policyHash: current.policyHash, configHash: current.runtimeHash } };
    function write(row, args, name) {
        const result = projected({ ...row, ...args.data }, args.select, ['id']);
        assert.equal(args.where.id, row.id);
        f.writes.push(name); Object.assign(row, args.data); return result;
    }
    const tx = {
        $queryRaw: async (strings, ...values) => {
            const sql = strings.join('?');
            if (sql.includes('"StaffOperatorRun"')) {
                assert(sql.includes('SELECT *')); assert(sql.includes('FOR UPDATE'));
                assert.equal(values[0], current.id); f.fullRunReads++; return [current];
            }
            if (sql.includes('"StaffOperatorAttempt"')) {
                assert(sql.includes('FOR UPDATE')); assert.equal(values[0], attempt.id);
                const fields = sql.match(/SELECT\s+([\s\S]+?)\s+FROM/)[1].split(',').map(name => name.trim().replaceAll('"', ''));
                return [projected(attempt, Object.fromEntries(fields.map(name => [name, true])), attemptFields)];
            }
            assert(sql.includes('lock_operator_specimen')); assert.equal(values[0], current.specimenId); return [card];
        },
        staffGradingOperation: { count: async () => f.gradingPending },
        staffOperatorAttempt: { update: async args => write(attempt, args, 'attempt') },
        staffOperatorRun: {
            update: async args => write(current, args, 'run'),
            findUnique: async ({ where, select }) => {
                assert.equal(where.id, current.id); return projected(current, select,
                    attempt.resultReceiptId ? ['id', 'state'] : runReceiptFields);
            },
        },
        staffOperatorControl: { findUnique: async ({ where, select }) => {
            assert.equal(where.id, 'active');
            return f.control && projected(f.control, select, ['enabled', 'policyHash', 'configHash']);
        } },
        staffOperatorReceipt: {
            findUnique: async ({ where, select }) => {
                assert.equal(where.attemptId_hash.attemptId, attempt.id);
                const prior = f.receipts.find(row => row.hash === where.attemptId_hash.hash);
                // Exercise the projection contract even on an initial miss.
                const result = projected(prior ?? { id: randomUUID() }, select, ['id']);
                return prior ? result : null;
            },
            create: async ({ data, select }) => {
                const result = projected(data, select, ['id']); f.writes.push('receipt'); f.receipts.push(data); return result;
            },
        },
    };
    const context = { tx, now, policy, control: f.control, bridge: { gradingPolicyHash: current.gradingPolicyHash },
        budget: { specimenIds: [current.specimenId] } };
    const ledger = new OperatorLedger({ client: null, config });
    // Only substitute the database transaction; run(), leased(), renewal and
    // receipt logic all execute their real checks against projected rows.
    ledger.transaction = async (work, options) => {
        if (options) assert.deepEqual(options, { active: false }); return work(context);
    };
    const lease = { runId: current.id, owner: current.leaseOwner, fence: current.leaseFence, revision: current.revision };
    function receipt(body = { model: MODEL, service_tier: 'default',
        usage: { input_tokens: 500, output_tokens: 100, total_tokens: 600 } }) {
        return { state: 'RECEIVED', attemptId: attempt.id, startedAt: attempt.dispatchedAt.toISOString(),
            receivedAt: now.toISOString(), httpStatus: 200, body, bodyHash: digest(JSON.stringify(body)) };
    }
    return Object.assign(f, { ledger, lease, context, receipt,
        record: value => ledger.recordReceipt({ attemptId: attempt.id, dispatchClaimId: attempt.dispatchClaimId, receipt: value }) });
}

test('renew validates the complete image continuation but returns only metadata from its write', async () => {
    for (const mode of ['WORK', 'RECONCILE_ONLY']) {
        const f = fixture(); f.current.leaseMode = mode;
        if (mode === 'RECONCILE_ONLY') f.current.deadlineAt = new Date(+f.now + 20_000);
        const before = { input: f.current.inputCanonical, hash: f.current.inputHash, revision: f.current.revision,
            fence: f.current.leaseFence };
        assert.equal(await f.ledger.renew(f.lease), f.lease);
        assert.equal(f.fullRunReads, 1); assert.deepEqual(f.writes, ['run']);
        assert.equal(+f.current.leaseExpiresAt, +f.now + (mode === 'WORK' ? 30_000 : 20_000));
        assert.deepEqual({ input: f.current.inputCanonical, hash: f.current.inputHash, revision: f.current.revision,
            fence: f.current.leaseFence }, before);
    }
});

test('projected renewal still rejects corrupt payloads, changed authority/evidence and stale leases before writing', async () => {
    const cases = [
        [f => { f.current.inputCanonical = `${f.current.inputCanonical} `; }, 'ASTRA_STORED_EVIDENCE_INVALID'],
        [f => { f.current.inputCanonical = ' {"private":true}'; f.current.inputHash = digest(f.current.inputCanonical); }, 'ASTRA_STORED_EVIDENCE_INVALID'],
        [f => { f.current.manifestHash = 'f'.repeat(64); }, 'ASTRA_STORED_EVIDENCE_INVALID'],
        ...['policyHash', 'runtimeHash', 'gradingPolicyHash', 'pilotId'].map(field =>
            [f => { f.current[field] = 'changed'; }, 'ASTRA_RUN_NOT_CURRENT']),
        [f => { f.current.deadlineAt = f.now; }, 'ASTRA_RUN_NOT_CURRENT'],
        [f => { f.context.budget.specimenIds = []; }, 'ASTRA_RUN_NOT_CURRENT'],
        ...['evidenceHash', 'analysisRevision', 'draftRevision'].map(field =>
            [f => { f.card[field] = 'changed'; }, 'ASTRA_EVIDENCE_CHANGED']),
        [f => { f.gradingPending = 1; }, 'ASTRA_GRADING_UNRESOLVED'],
        ...['leaseOwner', 'leaseFence', 'revision'].map(field =>
            [f => { f.current[field] = 'changed'; }, 'ASTRA_LEASE_STALE']),
        [f => { f.current.leaseExpiresAt = f.now; }, 'ASTRA_LEASE_STALE'],
        [f => { f.current.state = 'READY_FOR_HUMAN'; }, 'ASTRA_LEASE_STALE'],
    ];
    for (const [change, code] of cases) {
        const f = fixture(); change(f);
        await assert.rejects(f.ledger.renew(f.lease), error => error.code === code);
        assert.deepEqual(f.writes, []);
    }
});

test('projected receipt persistence saves exact evidence, accounts usage and advances a current lease', async () => {
    const f = fixture(), receipt = f.receipt(), result = await f.record(receipt);
    assert.equal(result.state, 'RECEIVED'); assert.equal(result.receiptId, f.receipts[0].id);
    assert.equal(f.receipts[0].canonical, canonical(receipt)); assert.equal(f.receipts[0].hash, digest(canonical(receipt)));
    assert.equal(f.attempt.resultReceiptId, result.receiptId); assert.equal(f.attempt.state, 'RECEIVED');
    assert.equal(f.attempt.usageCeilingMicroUsd, 20_000n); assert.equal(f.attempt.usageEnvelopeExceeded, false);
    assert.equal(f.current.state, 'WAITING_TOOL'); assert.equal(f.current.failureCode, null);
    assert.equal(f.current.inputCanonical, inputCanonical); assert.equal(f.attempt.requestCanonical, inputCanonical);
    assert.equal(f.attempt.reservedMicroUsd, 25_000_000n);
    assert.deepEqual(f.writes, ['receipt', 'attempt', 'run']); assert.equal(f.fullRunReads, 0);
});

test('projected receipt replay is idempotent even after application and never rewrites the original receipt', async () => {
    const f = fixture(), receipt = f.receipt(), first = await f.record(receipt);
    f.attempt.state = 'APPLIED'; f.writes.length = 0;
    assert.deepEqual(await f.record(receipt), { receiptId: first.receiptId, state: 'APPLIED' });
    assert.equal(f.receipts.length, 1); assert.equal(f.attempt.resultReceiptId, first.receiptId); assert.deepEqual(f.writes, []);
});

test('late or revoked receipts retain admitted-policy accounting without gaining tool authority', async () => {
    const changes = [
        f => { f.control.enabled = false; }, f => { f.control = null; },
        f => { f.control.policyHash = 'f'.repeat(64); }, f => { f.control.configHash = 'f'.repeat(64); },
        f => { f.current.leaseFence++; }, f => { f.current.revision++; },
        f => { f.current.leaseMode = 'RECONCILE_ONLY'; }, f => { f.current.leaseExpiresAt = f.now; },
        f => { f.current.deadlineAt = f.now; }, f => { f.current.state = 'UNKNOWN'; },
    ];
    for (const change of changes) {
        const f = fixture(), originalFinished = new Date(+f.now - 5000); f.attempt.finishedAt = originalFinished; change(f);
        assert.equal((await f.record(f.receipt())).state, 'RECEIVED');
        assert.equal(f.attempt.finishedAt, originalFinished); assert.equal(f.attempt.usageCeilingMicroUsd, 20_000n);
        assert.equal(f.current.state, 'UNKNOWN'); assert.equal(f.current.failureCode, 'ASTRA_LATE_RECEIPT');
        assert.equal(f.attempt.reservedMicroUsd, 25_000_000n);
    }
});

test('unknown receipts and unusable provider usage keep the original cost hold', async () => {
    const unknown = fixture(), value = { state: 'UNKNOWN', attemptId: unknown.attempt.id,
        startedAt: unknown.attempt.dispatchedAt.toISOString(), receivedAt: unknown.now.toISOString(),
        httpStatus: null, failureCode: 'ASTRA_OUTCOME_UNCONFIRMED' };
    unknown.control = null;
    assert.equal((await unknown.record(value)).state, 'UNKNOWN');
    assert.equal(unknown.attempt.resultReceiptId, null); assert.equal(unknown.attempt.usageCeilingMicroUsd, null);
    assert.equal(unknown.current.state, 'UNKNOWN'); assert.equal(unknown.current.failureCode, value.failureCode);
    for (const body of [{ model: MODEL, service_tier: 'default', usage: {} },
        { model: 'different-model', service_tier: 'default', usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } }]) {
        const f = fixture(); await f.record(f.receipt(body));
        assert.equal(f.attempt.usageCeilingMicroUsd, null); assert.equal(f.attempt.reservedMicroUsd, 25_000_000n);
    }
    assert.equal(unknown.attempt.reservedMicroUsd, 25_000_000n);
});

test('a conflicting saved receipt remains separate and preserves the original result and accounting', async () => {
    for (const state of ['WAITING_TOOL', 'PREPARATION_READY']) {
        const f = fixture(), original = await f.record(f.receipt());
        f.current.state = state; f.attempt.state = 'APPLIED'; f.writes.length = 0;
        const conflict = await f.record(f.receipt({ model: MODEL, service_tier: 'default', usage: {} }));
        assert.notEqual(conflict.receiptId, original.receiptId); assert.equal(conflict.state, 'APPLIED');
        assert.equal(f.receipts.length, 2); assert.equal(f.attempt.resultReceiptId, original.receiptId);
        assert.equal(f.attempt.usageCeilingMicroUsd, 20_000n); assert.equal(f.current.state, 'UNKNOWN');
        assert.equal(f.current.failureCode, 'ASTRA_CONFLICTING_RECEIPT'); assert.deepEqual(f.writes, ['receipt', 'run']);
    }
});

test('receipt scope checks still reject mismatched dispatch/binding and never-dispatched attempts before writing', async () => {
    for (const change of [f => { f.config.providerBindingHash = 'f'.repeat(64); },
        f => { f.attempt.dispatchedAt = null; }, f => { f.attempt.state = 'RESERVED'; }]) {
        const f = fixture(), receipt = f.receipt(); change(f);
        await assert.rejects(f.record(receipt), /ASTRA_RECEIPT_SCOPE_INVALID/); assert.deepEqual(f.writes, []);
    }
    const f = fixture();
    await assert.rejects(f.ledger.recordReceipt({ attemptId: f.attempt.id, dispatchClaimId: randomUUID(), receipt: f.receipt() }),
        /ASTRA_RECEIPT_SCOPE_INVALID/); assert.deepEqual(f.writes, []);
});

test('a late abandoned response retains exact evidence and cost without changing the separately admitted run', async () => {
    for (const runState of ['RUNNING', 'WAITING_TOOL', 'UNKNOWN', 'PREPARATION_READY', 'READY_FOR_HUMAN']) {
        const f = fixture(); f.attempt.state = 'ABANDONED'; f.current.state = runState;
        f.current.revision++; f.current.leaseFence++;
        const runBefore = structuredClone(f.current), requestBefore = f.attempt.requestCanonical;
        const receipt = f.receipt(), saved = await f.record(receipt);
        assert.equal(saved.state, 'ABANDONED'); assert.equal(f.attempt.state, 'ABANDONED');
        assert.equal(f.attempt.resultReceiptId, saved.receiptId); assert.equal(f.attempt.usageCeilingMicroUsd, 20_000n);
        assert.equal(f.attempt.reservedMicroUsd, 25_000_000n); assert.equal(f.attempt.requestCanonical, requestBefore);
        assert.deepEqual(f.current, runBefore); assert.deepEqual(f.writes, ['receipt', 'attempt']);
        f.writes.length = 0;
        assert.deepEqual(await f.record(receipt), saved); assert.deepEqual(f.writes, []);
        const conflict = await f.record(f.receipt({ model: MODEL, service_tier: 'default', usage: {} }));
        assert.equal(conflict.state, 'ABANDONED'); assert.notEqual(conflict.receiptId, saved.receiptId);
        assert.equal(f.attempt.resultReceiptId, saved.receiptId); assert.equal(f.attempt.usageCeilingMicroUsd, 20_000n);
        assert.deepEqual(f.current, runBefore); assert.deepEqual(f.writes, ['receipt']);
    }
});

test('an abandoned unknown result keeps its reservation and can later record genuine usage without regaining execution', async () => {
    const f = fixture(); f.attempt.state = 'ABANDONED';
    const runBefore = structuredClone(f.current);
    const unknown = { state: 'UNKNOWN', attemptId: f.attempt.id, startedAt: f.attempt.dispatchedAt.toISOString(),
        receivedAt: f.now.toISOString(), httpStatus: null, failureCode: 'ASTRA_OUTCOME_UNCONFIRMED' };
    assert.equal((await f.record(unknown)).state, 'ABANDONED');
    assert.equal(f.attempt.resultReceiptId, null); assert.equal(f.attempt.usageCeilingMicroUsd, null);
    assert.equal(f.attempt.reservedMicroUsd, 25_000_000n); assert.deepEqual(f.current, runBefore);
    const finishedAt = f.attempt.finishedAt;
    assert.equal((await f.record(f.receipt())).state, 'ABANDONED');
    assert.equal(f.attempt.finishedAt, finishedAt); assert.equal(f.attempt.usageCeilingMicroUsd, 20_000n);
    assert.equal(f.attempt.reservedMicroUsd, 25_000_000n); assert.deepEqual(f.current, runBefore);
});
