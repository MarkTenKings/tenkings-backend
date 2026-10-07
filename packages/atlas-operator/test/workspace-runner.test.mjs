import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { consumeWorkspaceQueue } from '../src/workspace-runner.mjs';

function fixture({ limit = 1, outcome = 'READY_FOR_HUMAN' } = {}) {
    const events = [], claims = [], operations = [], runs = new Map();
    let remaining = 10;
    const queue = {
        async admission() { return { enabled: true, processingLimit: limit, remaining, expiresAt: new Date(Date.now() + 60_000).toISOString() }; },
        async claimNext(input) {
            events.push('claim'); operations.push(input.operationId);
            const claim = { cardId: randomUUID(), claimId: randomUUID(), claimFence: 1, captureRevision: 2,
                captureHash: 'a'.repeat(64), workflowRevision: 4 };
            claims.push(claim); runs.set(claim.cardId, randomUUID()); remaining--; return claim;
        },
        async prepare(claim) { events.push('prepare'); return { state: 'READY', runId: runs.get(claim.cardId) }; },
        async settle(claim, result) { assert(claims.includes(claim)); events.push('settle');
            assert.equal(Object.hasOwn(result, 'report'), false);
            return { settled: !['RECONCILIATION_REQUIRED'].includes(result.state),
                cardState: result.state === 'READY_FOR_HUMAN' ? 'HUMAN_REVIEW'
                    : ['PAUSED', 'NOT_STARTED'].includes(result.state) ? 'IN_PROGRESS' : 'NEEDS_ATTENTION' }; },
    };
    return { queue, events, claims, operations, runs, start(options = {}) {
        return consumeWorkspaceQueue({ queue, operationId: 'synthetic-queue-invocation',
            executeInitialization: async () => { throw new Error('unexpected initialization'); },
            executeRun: async ({ runId }) => { events.push('run'); return { runId, state: outcome, code: null,
                report: 'must never cross into queue settlement', receiptWrites: [] }; }, ...options });
    } };
}

test('ten photos may wait but the first-card processing limit permits exactly one card', async () => {
    const f = fixture(), result = await f.start();
    assert.equal(result.state, 'BOUND_REACHED'); assert.equal(result.cards.length, 1);
    assert.equal(result.cards[0].cardState, 'HUMAN_REVIEW');
    assert.deepEqual(f.events, ['claim', 'prepare', 'run', 'settle']);
    assert.equal(JSON.stringify(result).includes('must never'), false);
});

test('shared-queue consumer is sequential, rechecks admission and never scales beyond ten', async () => {
    const f = fixture({ limit: 10 }), result = await f.start();
    assert.equal(result.cards.length, 10); assert.equal(new Set(f.operations).size, 10);
    assert.deepEqual(f.events, Array.from({ length: 10 }, () => ['claim', 'prepare', 'run', 'settle']).flat());
    const g = fixture({ limit: 10 }); let reads = 0;
    const read = g.queue.admission; g.queue.admission = async () => ({ ...await read(), enabled: ++reads === 1 });
    assert.equal((await g.start()).state, 'INACTIVE'); assert.equal(g.claims.length, 1);
});

test('step mode and paused work stop after the first admitted action without claiming another card', async () => {
    for (const options of [{ mode: 'STEP' }, {}]) {
        const f = fixture({ limit: 10, outcome: 'PAUSED' }), result = await f.start(options);
        assert.equal(result.state, 'PAUSED'); assert.equal(f.claims.length, 1);
    }
    const f = fixture({ limit: 10 }); const result = await f.start({ mode: 'STEP' });
    assert.equal(result.cards.length, 1);
});

test('unknown prepare or runner outcomes are retained with the exact claim and never automatically retried', async () => {
    for (const phase of ['prepare', 'run']) {
        const f = fixture({ limit: 10 });
        if (phase === 'prepare') f.queue.prepare = async () => { f.events.push('prepare'); throw new Error('private provider error'); };
        const result = await f.start(phase === 'run' ? { executeRun: async () => { f.events.push('run'); throw new Error('private key'); } } : {});
        assert.equal(result.state, 'HELD'); assert.equal(result.cards[0].state, 'RECONCILIATION_REQUIRED');
        assert.equal(f.claims.length, 1); assert.equal(f.events.filter(x => x === phase).length, 1);
        assert.equal(JSON.stringify(result).includes('private'), false);
    }
});

test('lost claim or settlement replies cannot trigger another claim or imply human approval', async () => {
    const f = fixture({ limit: 10 }); f.queue.claimNext = async () => { f.events.push('claim'); throw new Error('lost'); };
    assert.equal((await f.start()).state, 'HELD'); assert.deepEqual(f.events, ['claim']);
    const g = fixture({ limit: 10 }); g.queue.settle = async () => ({ settled: true, cardState: 'APPROVED' });
    assert.equal((await g.start()).state, 'HELD'); assert.equal(g.claims.length, 1);
});

test('recapture and expert attention can advance to another card only after a confirmed settled boundary', async () => {
    const f = fixture({ limit: 2, outcome: 'NEEDS_RECAPTURE' });
    assert.equal((await f.start()).cards.length, 2);
    const g = fixture({ limit: 2, outcome: 'NEEDS_RECAPTURE' });
    g.queue.settle = async () => ({ settled: false, cardState: 'NEEDS_ATTENTION' });
    assert.equal((await g.start()).cards.length, 1);
});

test('uninitialized captures cannot invent a post-report run or supply both execution paths', async () => {
    const f = fixture();
    f.queue.prepare = async () => ({ state: 'READY', runId: randomUUID(), initializationId: randomUUID() });
    assert.equal((await f.start()).cards[0].state, 'RECONCILIATION_REQUIRED'); assert.equal(f.events.includes('run'), false);
    const g = fixture(); let initialized = 0; const id = randomUUID();
    g.queue.prepare = async () => ({ state: 'READY', initializationId: id });
    const result = await g.start({ executeInitialization: async input => { initialized++; assert.equal(input.initializationId, id);
        return { initializationId: id, runId: randomUUID(), state: 'READY_FOR_HUMAN' }; } });
    assert.equal(initialized, 1); assert.equal(result.cards[0].cardState, 'HUMAN_REVIEW');
});

test('continuous fresh-photo queue executes capture then exact original preparation and report initialization once', async () => {
    const f = fixture(), captureRunId = randomUUID(), initializationId = randomUUID(); let preparation = 0;
    f.queue.prepare = async (_claim, input) => {
        f.events.push('prepare'); preparation++;
        if (preparation === 1) { assert.equal(input.captureRunId, undefined); return { state: 'CAPTURE_REVIEW', runId: captureRunId }; }
        assert.equal(input.captureRunId, captureRunId); return { state: 'READY', initializationId };
    };
    const result = await f.start({ executeRun: async ({ runId }) => { assert.equal(runId, captureRunId); f.events.push('capture');
        return { runId, state: 'PREPARATION_READY' }; }, executeInitialization: async input => {
        assert.equal(input.initializationId, initializationId); f.events.push('initialize');
        return { initializationId, runId: randomUUID(), state: 'READY_FOR_HUMAN' };
    } });
    assert.deepEqual(f.events, ['claim','prepare','capture','prepare','initialize','settle']);
    assert.equal(result.cards[0].cardState, 'HUMAN_REVIEW'); assert.equal(preparation, 2);
});

test('supervised capture handoff cannot spend its completed step on a source preparation action', async () => {
    const f = fixture(), runId = randomUUID(); let preparation = 0;
    f.queue.prepare = async () => { preparation++; return { state: 'CAPTURE_REVIEW', runId }; };
    f.queue.settle = async (_claim, result) => { assert.equal(result.state, 'PREPARATION_READY'); assert.equal(result.runId, runId);
        return { settled: true, cardState: 'IN_PROGRESS' }; };
    const result = await f.start({ mode: 'STEP', executeRun: async () => ({ runId, state: 'PREPARATION_READY' }) });
    assert.equal(result.state, 'HELD'); assert.equal(preparation, 1); assert.equal(result.cards[0].state, 'PREPARATION_READY');
});

test('unknown original preparation after capture handoff stops the same claim and cannot initialize or retry', async () => {
    const f = fixture(), runId = randomUUID(); let preparation = 0, initialized = 0;
    f.queue.prepare = async () => ++preparation === 1 ? { state: 'CAPTURE_REVIEW', runId }
        : { state: 'RECONCILIATION_REQUIRED', code: 'ASTRA_WORKSPACE_OUTCOME_UNCONFIRMED' };
    const result = await f.start({ executeRun: async () => ({ runId, state: 'PREPARATION_READY' }),
        executeInitialization: async () => { initialized++; throw Error('must not initialize'); } });
    assert.equal(result.state, 'HELD'); assert.equal(preparation, 2); assert.equal(initialized, 0); assert.equal(f.claims.length, 1);
});
