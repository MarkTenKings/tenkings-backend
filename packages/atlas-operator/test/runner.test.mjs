import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { canonical, digest } from '@atlas/service-bridge/protocol';
import { runOperator } from '../src/runner.mjs';
import { responsesTransport, openAiBinding } from '../src/provider.mjs';
import { MODEL, PRICING, buildRequest, inspectResponse, usageCeiling, appendToolResult } from '../src/responses.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let n = 0; n < 100; n++) await Promise.resolve(); };
const fail = code => { throw Object.assign(new Error(code), { code }); };
function fakeClock() {
    let time = 0, serial = 0; const timers = new Map();
    return { now: () => time, setTimeout(fn, delay) { const id = ++serial; timers.set(id, { at: time + delay, fn }); return id; },
        clearTimeout(id) { timers.delete(id); }, count: () => timers.size,
        async advance(ms) {
            const end = time + ms; await flush();
            for (;;) {
                const next = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
                if (!next) break;
                const [id, timer] = next; time = timer.at; timers.delete(id); timer.fn(); await flush();
            }
            time = end; await flush();
        } };
}

// Injected process-local ledger establishes orchestration behavior only. The
// real PostgreSQL authority/concurrency tests remain the ledger's own suite.
function fixture({ names = ['read_card_report', 'submit_for_human_review'], steps = 4, attempts = 4 } = {}) {
    const clock = fakeClock(), base = Date.now(), runId = randomUUID(), events = [], receipts = [], calls = [];
    const policy = { version: 'atlas-operator-control-policy-v1', pilotId: randomUUID(),
        expiresAt: new Date(base + 3600_000).toISOString(), prompt: 'SYNTHETIC fixture; no physical grading.',
        astra: { version: 'atlas-astra-policy-v1', model: MODEL, returnedModel: MODEL, effort: 'medium', serviceTier: 'default',
            maxOutputTokens: 2000, requestTimeoutMs: 20_000, pricingVersion: PRICING.version,
            inputNanoUsdPerToken: PRICING.inputNanoUsdPerToken, outputNanoUsdPerToken: PRICING.outputNanoUsdPerToken },
        tools: names, maxAttemptsPerCard: attempts, maxStepsPerRun: steps, maxRunMs: 60_000, leaseMs: 10_000, concurrency: 1 };
    const run = { id: runId, revision: 1, state: 'QUEUED', deadlineAt: new Date(base + 60_000),
        policyCanonical: canonical(policy), policyHash: digest(canonical(policy)), runtimeHash: 'd'.repeat(64),
        evidenceHash: 'a'.repeat(64), manifestHash: 'b'.repeat(64) };
    const manifest = { reportHash: 'c'.repeat(64) }, owner = randomUUID(); let lease, expiry = 0, current;
    let input = [{ role: 'user', content: 'Synthetic fixture only.' }];
    const binding = () => ({ runId, evidenceHash: run.evidenceHash, expectedRevision: run.revision, manifestHash: run.manifestHash });
    const authority = given => {
        assert.deepEqual(given, lease); if (clock.now() >= expiry) fail('ASTRA_LEASE_STALE');
    };
    const providerBinding = openAiBinding({ ATLAS_OPERATOR_OPENAI_PROJECT_ID: 'proj_fixture000000',
        ATLAS_OPERATOR_OPENAI_API_KEY: 'sk-synthetic-fixture-key-only-00000000' });
    const response = (name, change = {}) => ({ id: 'resp_fixture', status: 'completed', model: MODEL, service_tier: 'default',
        output: [{ type: 'reasoning', encrypted_content: 'opaque-fixture', summary: [] },
            { type: 'function_call', call_id: `call_${run.revision}`, name, arguments: canonical({ ...binding(),
                ...(name === 'submit_for_human_review' ? { reportHash: manifest.reportHash, disposition: 'READY_FOR_REVIEW', summary: 'Synthetic draft ready for human inspection.' } : {}) }) }],
        usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 }, ...change });
    const ledger = {
        async claim(id, claimedOwner) {
            assert.equal(id, runId); assert.equal(claimedOwner, owner); assert(!lease);
            events.push('claim'); lease = { runId, owner, fence: 1, revision: run.revision }; expiry = clock.now() + policy.leaseMs;
            run.state = 'RUNNING'; return { lease: { ...lease }, mode: 'WORK' };
        },
        async snapshot(given) { authority(given); events.push('snapshot'); return { run: { ...run }, policy: structuredClone(policy), now: new Date(base + clock.now()) }; },
        async renew(given) { authority(given); events.push('renew'); expiry = clock.now() + policy.leaseMs; return given; },
        async reserve(given) {
            authority(given); if (calls.length >= policy.maxAttemptsPerCard) fail('ASTRA_BUDGET_EXHAUSTED');
            assert.equal(run.state, 'RUNNING'); assert(!current || current.state === 'APPLIED');
            const request = buildRequest({ policy: policy.astra, prompt: policy.prompt, names: policy.tools, input });
            current = { attemptId: randomUUID(), dispatchClaimId: randomUUID(), requestHash: request.requestHash, request, state: 'RESERVED' };
            calls.push(current); events.push('reserve');
            return { attemptId: current.attemptId, dispatchClaimId: current.dispatchClaimId, requestHash: current.requestHash };
        },
        async takeDispatch(given, id) {
            authority(given); assert.equal(id, current.attemptId); assert.equal(current.state, 'RESERVED'); current.state = 'DISPATCHED'; events.push('dispatch');
            return { ...current.request, attemptId: id, policy: policy.astra, promptHash: digest(current.request.request.instructions),
                toolsHash: digest(canonical(current.request.request.tools)), providerBindingHash: providerBinding.bindingHash, expiresAtMs: base + 60_000 };
        },
        async recordReceipt({ attemptId, dispatchClaimId, receipt }) {
            assert.equal(attemptId, current.attemptId); assert.equal(dispatchClaimId, current.dispatchClaimId);
            receipts.push(structuredClone(receipt)); events.push('receipt');
            current.receipt = receipt; current.state = receipt.state;
            if (run.state !== 'UNKNOWN') run.state = receipt.state === 'RECEIVED' ? 'WAITING_TOOL' : 'UNKNOWN';
            return { receiptId: randomUUID(), state: current.state };
        },
        async inspectTool(given) {
            authority(given); assert.equal(run.state, 'WAITING_TOOL'); assert.equal(current.state, 'RECEIVED'); events.push('inspect');
            assert.equal(current.receipt.httpStatus, 200);
            if (usageCeiling(current.receipt.body.usage, policy.astra).envelopeExceeded) fail('ASTRA_TOOL_NOT_READY');
            const parsed = inspectResponse(current.receipt.body, policy.astra, policy.tools, binding());
            if (parsed.status !== 'TOOL_REQUESTED') fail(`ASTRA_${parsed.status}`);
            return { call: parsed.calls[0], manifest, run: { ...run }, card: { id: randomUUID() } };
        },
        async applyTool(given, id, adapter) {
            authority(given); assert.equal(id, current.attemptId); const data = await this.inspectTool(given);
            events.push('apply'); const output = await adapter(data);
            authority(given); input = appendToolResult(input, current.receipt.body, data.call, output.result);
            current.state = 'APPLIED'; run.revision++; lease = { ...lease, revision: run.revision };
            run.state = data.call.name === 'submit_for_human_review' ? 'READY_FOR_HUMAN' : 'RUNNING'; events.push('commit');
            return { state: run.state, lease: { ...lease }, output };
        },
        async stop(given, { code }) {
            assert.equal(given.fence, lease.fence); events.push(`stop:${code}`);
            if (current && ['DISPATCHED', 'RECEIVED', 'UNKNOWN'].includes(current.state)) run.state = 'UNKNOWN';
            else { if (current?.state === 'RESERVED') current.state = 'FAILED'; run.state = 'FAILED'; }
            return { state: run.state };
        },
    };
    const adapters = Object.fromEntries(names.map(name => [name, { apply: () => ({ result: { synthetic: true } }) }]));
    let fetchImpl = async () => Response.json(response(calls.length === 1 ? names[0] : 'submit_for_human_review'));
    const createProvider = ({ takeDispatch, signal }) => responsesTransport({ binding: providerBinding, takeDispatch,
        fetchImpl: (url, init) => {
            assert.equal(JSON.parse(init.body).model, MODEL); assert.equal(JSON.parse(init.body).reasoning.effort, 'medium');
            // Older transport has no parent signal; fixture still observes the
            // runner's exact cancellation signal without a network request.
            return fetchImpl(url, { ...init, runnerSignal: signal });
        }, signal });
    return { clock, ledger, run, policy, owner, runId, events, receipts, calls, adapters, response,
        setFetch(fn) { fetchImpl = fn; }, createProvider,
        start(options = {}) { return runOperator({ ledger, runId, owner, adapters, createProvider, clock, ...options }); } };
}

test('bounded runner retains receipts before adapters and advances exact revisions to human handoff', async () => {
    const f = fixture(); let preparations = 0;
    f.adapters.read_card_report.prepare = async (snapshot, { signal }) => {
        assert(!signal.aborted); assert.equal(f.receipts.length, 1); assert.equal(snapshot.call.name, 'read_card_report');
        f.events.push('prepare'); preparations++; return { preserved: 'fixture-hash' };
    };
    f.adapters.read_card_report.apply = (data, prepared) => {
        assert.equal(data.run.revision, 1); assert.equal(prepared.preserved, 'fixture-hash'); return { result: { synthetic: true } };
    };
    const result = await f.start(); assert.equal(result.state, 'READY_FOR_HUMAN'); assert.equal(result.stepsApplied, 2);
    assert.equal(preparations, 1); assert.equal(f.calls.length, 2); assert(f.events.indexOf('receipt') < f.events.indexOf('prepare'));
    assert(f.events.indexOf('prepare') < f.events.indexOf('apply')); assert.equal(f.clock.count(), 0);
    assert.deepEqual((await Promise.all(result.receiptWrites)).map(x => x.state), ['PERSISTED', 'PERSISTED']);
});

test('all advertised adapters must be admitted before a reservation or provider factory', async () => {
    const f = fixture(); delete f.adapters.submit_for_human_review;
    let constructed = 0; const result = await f.start({ createProvider: () => { constructed++; } });
    assert.equal(result.state, 'FAILED'); assert.equal(result.code, 'ASTRA_ADAPTER_NOT_ADMITTED'); assert.equal(constructed, 0); assert.equal(f.calls.length, 0);
});

test('a reconciliation-only fresh claim never reserves, dispatches, renews or executes a tool', async () => {
    const f = fixture(); const claim = f.ledger.claim;
    f.ledger.claim = async (...args) => ({ ...await claim(...args), mode: 'RECONCILE_ONLY' });
    const result = await f.start(); assert.equal(result.state, 'RECONCILIATION_REQUIRED'); assert.deepEqual(f.events, ['claim']);
});

test('serialized heartbeats cover slow provider and slow preparation, then stop before revision mutation', async () => {
    const f = fixture(), providerGate = deferred(), prepareGate = deferred(); let prepared = false;
    f.setFetch(async () => { if (f.calls.length === 1) await providerGate.promise; return Response.json(f.response(f.calls.length === 1 ? 'read_card_report' : 'submit_for_human_review')); });
    f.adapters.read_card_report.prepare = async () => { prepared = true; await prepareGate.promise; return {}; };
    const pending = f.start(); await flush(); await f.clock.advance(11_000);
    assert.equal(f.calls.length, 1); assert(f.events.filter(x => x === 'renew').length >= 4);
    providerGate.resolve(); await flush(); assert(prepared); await f.clock.advance(11_000);
    assert(f.events.filter(x => x === 'renew').length >= 8); prepareGate.resolve();
    const result = await pending; assert.equal(result.state, 'READY_FOR_HUMAN'); assert.equal(f.clock.count(), 0);
});

test('lease loss aborts external work, retains its late receipt and never applies or retries', async () => {
    const f = fixture(), gate = deferred(); let signal;
    f.setFetch(async (_url, init) => { signal = init.runnerSignal; await gate.promise; return Response.json(f.response('read_card_report')); });
    const renew = f.ledger.renew; let renewals = 0;
    f.ledger.renew = async given => { if (++renewals > 1) fail('ASTRA_LEASE_STALE'); return renew(given); };
    const pending = f.start(); await flush(); await f.clock.advance(4000); const result = await pending;
    assert(signal.aborted); assert.equal(result.state, 'RECONCILIATION_REQUIRED'); assert.equal(f.calls.length, 1); assert(!f.events.includes('apply'));
    gate.resolve(); assert.deepEqual((await Promise.all(result.receiptWrites)).map(x => x.state), ['PERSISTED']);
    assert.equal(f.receipts.length, 1); assert.equal(f.run.state, 'UNKNOWN'); assert(!f.events.includes('apply'));
});

test('a provider ignoring abort cannot hold the runner indefinitely', async () => {
    const f = fixture(), gate = deferred(); f.setFetch(() => gate.promise);
    const pending = f.start(); await flush(); await f.clock.advance(20_001); const result = await pending;
    assert.equal(result.state, 'RECONCILIATION_REQUIRED'); assert.equal(result.code, 'ASTRA_EXTERNAL_TIMEOUT');
    assert.equal(f.calls.length, 1); assert.equal(f.clock.count(), 0); assert(!f.events.includes('apply'));
    gate.resolve(Response.json(f.response('read_card_report'))); await Promise.all(result.receiptWrites); assert.equal(f.receipts.length, 1);
});

test('caller cancellation before claim spends nothing and after dispatch persists only its receipt', async () => {
    const early = fixture(), a = new AbortController(); a.abort();
    assert.equal((await early.start({ signal: a.signal })).code, 'ASTRA_RUNNER_STOPPED'); assert.deepEqual(early.events, []);
    const f = fixture(), b = new AbortController(), gate = deferred(); f.setFetch(() => gate.promise);
    const pending = f.start({ signal: b.signal }); await flush(); b.abort(); const result = await pending;
    assert.equal(result.state, 'RECONCILIATION_REQUIRED'); assert.equal(f.calls.length, 1);
    gate.resolve(Response.json(f.response('read_card_report'))); await Promise.all(result.receiptWrites); assert(!f.events.includes('apply'));
});

test('unknown replies, HTTP rejection, wrong model and missing usage never reach an adapter', async () => {
    for (const kind of ['lost', 'http', 'model', 'usage', 'incomplete', 'text']) {
        const f = fixture();
        f.setFetch(async () => {
            if (kind === 'lost') throw new Error('synthetic lost reply');
            if (kind === 'http') return Response.json({ error: 'fixture' }, { status: 429 });
            return Response.json(f.response('read_card_report', kind === 'model' ? { model: 'another-model' }
                : kind === 'usage' ? { usage: null } : kind === 'incomplete' ? { status: 'incomplete' }
                    : { output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Approved' }] }] }));
        });
        const result = await f.start(); assert.equal(result.state, 'RECONCILIATION_REQUIRED', kind);
        assert.equal(f.receipts.length, 1, kind); assert.equal(f.calls.length, 1, kind); assert(!f.events.includes('apply'), kind);
    }
});

test('receipt failure prevents tools, remains unresolved, and is never automatically retried', async () => {
    const f = fixture(); let writes = 0;
    f.ledger.recordReceipt = async () => { writes++; throw new Error('synthetic lost database reply'); };
    const result = await f.start(); assert.equal(result.state, 'RECONCILIATION_REQUIRED'); assert.equal(writes, 1);
    assert.deepEqual((await Promise.all(result.receiptWrites)).map(x => x.state), ['UNCONFIRMED']); assert(!f.events.includes('inspect'));
});

test('preparation failure and unknown apply outcome never redispatch or replay the adapter', async () => {
    for (const kind of ['prepare', 'apply']) {
        const f = fixture(); let applications = 0;
        if (kind === 'prepare') f.adapters.read_card_report.prepare = async () => { throw new Error('synthetic decoder failure'); };
        else f.ledger.applyTool = async () => { applications++; throw new Error('synthetic unknown commit reply'); };
        const result = await f.start(); assert.equal(result.state, 'RECONCILIATION_REQUIRED'); assert.equal(f.calls.length, 1);
        assert.equal(applications, kind === 'apply' ? 1 : 0);
    }
});

test('step and attempt limits terminate durably without another provider request', async () => {
    for (const [options, code] of [[{ steps: 1 }, 'ASTRA_STEP_LIMIT'], [{ attempts: 1 }, 'ASTRA_BUDGET_EXHAUSTED']]) {
        const f = fixture(options); const result = await f.start(); assert.equal(result.state, 'FAILED'); assert.equal(result.code, code);
        assert.equal(result.stepsApplied, 1); assert.equal(f.calls.length, 1);
    }
});

test('policy/model substitution fails before spend and a changed run policy cannot continue', async () => {
    const f = fixture(); f.policy.astra.model = 'another-model'; f.run.policyCanonical = canonical(f.policy); f.run.policyHash = digest(f.run.policyCanonical);
    assert.equal((await f.start()).state, 'FAILED'); assert.equal(f.calls.length, 0);
    const g = fixture(); g.adapters.read_card_report.apply = () => {
        g.policy.prompt = 'Changed'; g.run.policyCanonical = canonical(g.policy); g.run.policyHash = digest(g.run.policyCanonical); return { result: {} };
    };
    const result = await g.start(); assert.equal(result.code, 'ASTRA_RUNNER_POLICY_CHANGED'); assert.equal(g.calls.length, 1);
});

test('deadline is bounded from database time even when external preparation keeps renewing', async () => {
    const f = fixture(), gate = deferred(); f.run.deadlineAt = new Date(Date.now() + 12_000);
    f.adapters.read_card_report.prepare = () => gate.promise;
    const pending = f.start(); await flush(); await f.clock.advance(12_100); const result = await pending;
    assert.equal(result.state, 'RECONCILIATION_REQUIRED'); assert.equal(result.code, 'ASTRA_RUN_DEADLINE');
    assert.equal(f.calls.length, 1); assert(!f.events.includes('apply'));
    gate.resolve({}); await flush(); assert(!f.events.includes('apply')); assert.equal(f.clock.count(), 0);
});

test('a lost claim reply is bounded and cannot be reported as an unclaimed job', async () => {
    const f = fixture(), gate = deferred(), claim = f.ledger.claim;
    f.ledger.claim = async (...args) => { const value = await claim(...args); await gate.promise; return value; };
    const pending = f.start(); await flush(); await f.clock.advance(15_001); const result = await pending;
    assert.equal(result.state, 'RECONCILIATION_REQUIRED'); assert.equal(result.code, 'ASTRA_LEDGER_TIMEOUT');
    assert.equal(f.calls.length, 0); gate.resolve(); await flush(); assert.equal(f.calls.length, 0);
});

test('snapshot round-trip delay cannot extend the database-observed deadline', async () => {
    const f = fixture(), gate = deferred(), snapshot = f.ledger.snapshot;
    f.run.deadlineAt = new Date(Date.now() + 4000);
    f.ledger.snapshot = async (...args) => { const value = await snapshot(...args); await gate.promise; return value; };
    const pending = f.start(); await flush(); await f.clock.advance(5000); gate.resolve(); const result = await pending;
    assert.equal(result.state, 'FAILED'); assert.equal(result.code, 'ASTRA_RUN_DEADLINE'); assert.equal(f.calls.length, 0);
});

test('stop and receipt persistence have bounded waits and cannot turn unknown work into success', async () => {
    const f = fixture(), writeGate = deferred(), stopGate = deferred();
    f.ledger.recordReceipt = () => writeGate.promise; f.ledger.stop = () => stopGate.promise;
    const pending = f.start(); await flush(); await f.clock.advance(30_001); const result = await pending;
    assert.equal(result.state, 'RECONCILIATION_REQUIRED'); assert(!f.events.includes('apply')); assert.equal(f.clock.count(), 0);
    assert.deepEqual((await Promise.all(result.receiptWrites)).map(x => x.state), ['UNCONFIRMED']); writeGate.resolve({}); stopGate.resolve({ state: 'UNKNOWN' });
});

test('a provider cannot obtain multiple dispatch grants or return a receipt without one', async () => {
    for (const repeated of [false, true]) {
        const f = fixture(); const result = await f.start({ createProvider: ({ takeDispatch }) => ({ dispatch: async id => {
            if (repeated) { await takeDispatch(id); await takeDispatch(id); }
            return { state: 'RECEIVED', attemptId: id, httpStatus: 200 };
        } }) });
        assert.equal(result.state, repeated ? 'RECONCILIATION_REQUIRED' : 'FAILED'); assert(!f.events.includes('apply'));
        assert.equal(f.events.filter(x => x === 'dispatch').length, repeated ? 1 : 0);
    }
});
