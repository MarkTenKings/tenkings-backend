import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { canonical, digest } from '../src/protocol.mjs';
import { makeMachineInitializationTransportConfig, signMachineInitializationAdmission, verifyMachineInitializationAdmission,
    signMachineInitializationExecution, verifyMachineInitializationExecution, machineInitializationClient,
    makeMachineInitializationAdmissionConfig, makeMachineInitializationExecutionConfig,
    machineInitializationAdmissionClient, machineInitializationExecutionClient,
    MACHINE_INITIALIZATION_ADMISSION_PATH as ADMIT_PATH, MACHINE_INITIALIZATION_EXECUTION_PATH as EXECUTE_PATH,
    MACHINE_INITIALIZATION_ADMISSION_SIGNATURE_HEADER as ADMIT_HEADER, MACHINE_INITIALIZATION_EXECUTION_SIGNATURE_HEADER as EXECUTE_HEADER,
} from '../src/machine-initialize-transport.mjs';

const NOW = 1_789_000_000_000, SHA = 'a'.repeat(64);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const config = () => makeMachineInitializationTransportConfig({ mode: 'PRODUCTION', origin: 'https://machine.example.test', runtimeHash: SHA,
    admissionKey: Buffer.alloc(32, 1), executionKey: Buffer.alloc(32, 2), otherKeyHashes: ['b'.repeat(64)] });
const scope = () => ({ actorId: randomUUID(), sessionHash: '1'.repeat(64), browserHash: '2'.repeat(64), accessVersion: 1, controlRevision: 3,
    staffOrigin: 'https://app.atlasgrading.com', deploymentId: 'synthetic-staff.vercel.app', releaseSha: '3'.repeat(40),
    staffConfigHash: '4'.repeat(64), operationsGrantId: randomUUID() });
const input = () => ({ jobId: randomUUID(), specimenId: randomUUID(), reason: 'Human authorizes exact synthetic job from reviewed evidence.',
    authorizationEvidenceHash: '5'.repeat(64), runtimeHash: SHA });
const execution = value => ({ jobId: value.jobId, runtimeHash: value.runtimeHash });
const admissionReply = value => ({ jobId: value.jobId, specimenId: value.specimenId, pilotId: randomUUID(), gradingOperationId: randomUUID(),
    runtimeHash: value.runtimeHash, state: 'QUEUED', deadlineAt: new Date(NOW + 100_000).toISOString() });
const executionReply = value => ({ ...execution(value), state: 'SUCCEEDED', analysisRevision: 1 });
const json = value => new Response(canonical(value), { headers: { 'content-type': 'application/json' } });
const unknown = work => assert.rejects(async () => work(), error => error.code === 'MACHINE_INITIALIZATION_OUTCOME_UNCONFIRMED'
    && error.message === 'MACHINE_INITIALIZATION_OUTCOME_UNCONFIRMED');
const signedBody = (value, key) => { const body = canonical(value); return { body, signature: createHmac('sha256', key).update(body).digest('hex') }; };

test('staff and runner purpose clients retain only their own key and cannot cross the admission boundary', async () => {
    const both = config(), i = input(), s = scope();
    const admit = makeMachineInitializationAdmissionConfig({ ...both, key: both.admissionKey, peerKeyHash: both.executionKeyHash });
    const execute = makeMachineInitializationExecutionConfig({ ...both, key: both.executionKey, peerKeyHash: both.admissionKeyHash });
    assert.equal(Object.hasOwn(admit, 'executionKey'), false); assert.equal(Object.hasOwn(execute, 'admissionKey'), false);
    assert.throws(() => signMachineInitializationExecution(admit, execution(i), NOW), /CONFIGURATION_INVALID/);
    assert.throws(() => signMachineInitializationAdmission(execute, s, i, NOW), /CONFIGURATION_INVALID/);
    const a = signMachineInitializationAdmission(admit, s, i, NOW), e = signMachineInitializationExecution(execute, execution(i), NOW);
    assert.deepEqual(verifyMachineInitializationAdmission(both, a.body, a.signature, NOW).input, i);
    assert.deepEqual(verifyMachineInitializationExecution(both, e.body, e.signature, NOW).input, execution(i));
    for (const make of [makeMachineInitializationAdmissionConfig, makeMachineInitializationExecutionConfig]) {
        assert.throws(() => make({ ...both, key: both.admissionKey, peerKeyHash: both.admissionKeyHash }), /CONFIGURATION_INVALID/);
        assert.throws(() => make({ ...both, key: both.admissionKey, peerKeyHash: both.executionKeyHash, otherKeyHashes: [both.admissionKeyHash] }), /CONFIGURATION_INVALID/);
    }
    const staff = machineInitializationAdmissionClient(admit, async () => json(admissionReply(i)));
    const runner = machineInitializationExecutionClient(execute, async () => json(executionReply(i)));
    assert.equal(Object.hasOwn(staff, 'execute'), false); assert.equal(Object.hasOwn(runner, 'admit'), false);
    assert.equal((await staff.admit(s, i)).jobId, i.jobId); assert.equal((await runner.execute(execution(i))).state, 'SUCCEEDED');
    execute.executionKey[0] ^= 1;
    assert.throws(() => machineInitializationExecutionClient(execute), /CONFIGURATION_INVALID/);
});

test('dedicated config binds explicit HTTPS origin/runtime and rejects key reuse and unsafe destinations', () => {
    const c = config(); assert.notEqual(c.admissionKeyHash, c.executionKeyHash);
    for (const origin of ['http://machine.example.test', 'https://machine.example.test/path', 'https://user:secret@machine.example.test',
        'https://machine.example.test?other=1', 'https://machine.example.test/'])
        assert.throws(() => makeMachineInitializationTransportConfig({ ...c, origin }));
    for (const patch of [{ executionKey: c.admissionKey }, { admissionKey: Buffer.alloc(31) }, { runtimeHash: 'missing' },
        { otherKeyHashes: [c.admissionKeyHash] }, { otherKeyHashes: [c.executionKeyHash] }])
        assert.throws(() => makeMachineInitializationTransportConfig({ ...c, ...patch }));
    c.admissionKey[0] = 9;
    assert.throws(() => signMachineInitializationAdmission(c, scope(), input(), NOW), /CONFIGURATION_INVALID/);
});

test('admission HMAC binds exact human scope/input/path/purpose/runtime and a 30-second packet', () => {
    const c = config(), s = scope(), i = input(), nonce = randomUUID();
    const signed = signMachineInitializationAdmission(c, s, i, NOW, nonce);
    const packet = verifyMachineInitializationAdmission(c, signed.body, signed.signature, NOW + 1);
    assert.deepEqual(packet.scope, s); assert.deepEqual(packet.input, i); assert.equal(packet.path, ADMIT_PATH);
    assert.equal(packet.audience, c.origin); assert.equal(packet.nonce, nonce); assert.equal(packet.expiresAt - packet.issuedAt, 30_000);
    assert.throws(() => verifyMachineInitializationAdmission(c, signed.body, signed.signature, NOW - 1));
    assert.throws(() => verifyMachineInitializationAdmission(c, signed.body, signed.signature, NOW + 30_000));
    for (const patch of [{ purpose: 'atlas-machine-initialize-execution-v1' }, { path: EXECUTE_PATH }, { audience: 'https://other.test' },
        { nonce: 'bad' }, { expiresAt: NOW + 30_001 }, { issuedAt: NOW + 1 }, { expiresAt: NOW }]) {
        const changed = signedBody({ ...packet, ...patch }, c.admissionKey);
        assert.throws(() => verifyMachineInitializationAdmission(c, changed.body, changed.signature, NOW));
    }
});

test('execution uses a different key/purpose and cannot borrow human admission authority', () => {
    const c = config(), i = input();
    const admitted = signMachineInitializationAdmission(c, scope(), i, NOW), execute = signMachineInitializationExecution(c, execution(i), NOW);
    const packet = verifyMachineInitializationExecution(c, execute.body, execute.signature, NOW);
    assert.deepEqual(packet.input, execution(i)); assert(!Object.hasOwn(packet, 'scope')); assert.equal(packet.path, EXECUTE_PATH);
    assert.throws(() => verifyMachineInitializationExecution(c, admitted.body, admitted.signature, NOW));
    assert.throws(() => verifyMachineInitializationAdmission(c, execute.body, execute.signature, NOW));
    const wrong = signedBody({ ...packet, purpose: 'atlas-machine-initialize-admission-v1' }, c.executionKey);
    assert.throws(() => verifyMachineInitializationExecution(c, wrong.body, wrong.signature, NOW));
});

test('even valid MACs cannot bypass exact shape, source IDs, authority or runtime validation', () => {
    const c = config(), s = scope(), i = input(), signed = signMachineInitializationAdmission(c, s, i, NOW);
    const packet = JSON.parse(signed.body);
    for (const patch of [{ input: { ...i, runtimeHash: 'b'.repeat(64) } }, { input: { ...i, jobId: 'bad' } },
        { input: { ...i, reason: ' ' } }, { input: { ...i, reason: 'x'.repeat(501) } }, { input: { ...i, authorizationEvidenceHash: 'no' } },
        { input: { ...i, retry: true } }, { scope: { ...s, actorId: 'ASTRA' } }, { scope: { ...s, operationsGrantId: 'bad' } },
        { scope: { ...s, accessVersion: 0 } }, { scope: { ...s, staffOrigin: 'http://app.atlasgrading.com' } },
        { scope: { ...s, role: 'ADMIN' } }]) {
        const changed = signedBody({ ...packet, ...patch }, c.admissionKey);
        assert.throws(() => verifyMachineInitializationAdmission(c, changed.body, changed.signature, NOW));
    }
    const changed = signedBody({ ...packet, input: { ...i, specimenId: randomUUID() } }, c.admissionKey);
    assert.throws(() => verifyMachineInitializationAdmission(c, changed.body, signed.signature, NOW));
});

test('canonical JSON and byte bounds are enforced before returning authenticated claims', () => {
    const c = config(), signed = signMachineInitializationAdmission(c, scope(), input(), NOW);
    for (const body of [` ${signed.body}`, JSON.stringify(JSON.parse(signed.body), null, 2), '{', 'x'.repeat(8193)]) {
        const signature = createHmac('sha256', c.admissionKey).update(body).digest('hex');
        assert.throws(() => verifyMachineInitializationAdmission(c, body, signature, NOW));
    }
    assert.throws(() => verifyMachineInitializationAdmission(c, signed.body, 'malformed', NOW));
    const local = makeMachineInitializationTransportConfig({ ...c, mode: 'LOCAL_FIXTURE' });
    const s = { ...scope(), staffOrigin: 'http://127.0.0.1:4318' };
    const localSigned = signMachineInitializationAdmission(local, s, input(), NOW);
    assert.equal(verifyMachineInitializationAdmission(local, localSigned.body, localSigned.signature, NOW).scope.staffOrigin, s.staffOrigin);
    assert.throws(() => signMachineInitializationAdmission(c, s, input(), NOW));
});

test('fixed client sends one exact request without cookies/redirects and honors 20s/220s bounds', async () => {
    const c = config(), s = scope(), i = input(), calls = [], deadlines = [], cleared = [];
    const timers = { setTimeout(_callback, ms) { deadlines.push(ms); return ms; }, clearTimeout(id) { cleared.push(id); } };
    const replies = [admissionReply(i), executionReply(i)];
    const client = machineInitializationClient(c, async (url, init) => {
        calls.push({ url, init }); assert.equal(init.method, 'POST'); assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error');
        assert.equal(init.cache, 'no-store'); assert(init.signal instanceof AbortSignal);
        assert.deepEqual(Object.keys(init.headers).sort(), ['content-type', calls.length === 1 ? ADMIT_HEADER : EXECUTE_HEADER].sort());
        const packet = JSON.parse(init.body);
        if (calls.length === 1) verifyMachineInitializationAdmission(c, init.body, init.headers[ADMIT_HEADER], packet.issuedAt);
        else verifyMachineInitializationExecution(c, init.body, init.headers[EXECUTE_HEADER], packet.issuedAt);
        return json(replies[calls.length - 1]);
    }, { timers });
    assert.deepEqual(await client.admit(s, i), replies[0]); assert.deepEqual(await client.execute(execution(i)), replies[1]);
    assert.deepEqual(calls.map(call => call.url), [c.origin + ADMIT_PATH, c.origin + EXECUTE_PATH]);
    assert.deepEqual(deadlines, [20_000, 220_000]); assert.deepEqual(cleared, deadlines);
    assert(!JSON.stringify(client.binding).includes(c.admissionKey.toString('base64')));
});

test('operatorRunId is accepted only on actual SUCCEEDED response and is never inferred', async () => {
    const c = config(), i = input(), runId = randomUUID();
    const success = executionReply(i);
    assert.equal((await machineInitializationClient(c, async () => json(success)).execute(execution(i))).operatorRunId, undefined);
    const linked = { ...success, operatorRunId: runId };
    assert.deepEqual(await machineInitializationClient(c, async () => json(linked)).execute(execution(i)), linked);
    for (const invalid of [{ ...execution(i), state: 'UNKNOWN', operatorRunId: runId }, { ...success, operatorRunId: 'invented' },
        { ...execution(i), state: 'SUCCEEDED' }, { ...success, analysisRevision: 2 }, { ...success, fakeGrade: 10 }])
        await unknown(() => machineInitializationClient(c, async () => json(invalid)).execute(execution(i)));
});

test('a replayed admission may report its existing job state without inventing a new worker or run', async () => {
    const c = config(), i = input();
    for (const state of ['QUEUED', 'DISPATCHED', 'SUCCEEDED', 'UNKNOWN', 'FAILED']) {
        const reply = { ...admissionReply(i), state }; let calls = 0;
        const result = await machineInitializationClient(c, async () => { calls++; return json(reply); }).admit(scope(), i);
        assert.equal(result.state, state); assert.equal(calls, 1); assert(!Object.hasOwn(result, 'operatorRunId'));
    }
});

test('wrong job/runtime/source binding and all HTTP/transport errors remain generic uncertainty without retry', async () => {
    const c = config(), i = input();
    for (const response of [() => new Response('private incident details', { status: 500 }), () => new Response('', { status: 302 }),
        () => new Response('{}', { status: 202 }), () => json({ ...executionReply(i), jobId: randomUUID() }),
        () => json({ ...executionReply(i), runtimeHash: 'b'.repeat(64) }), () => { throw new Error('PRIVATE_KEY_VALUE'); }]) {
        let calls = 0;
        await unknown(() => machineInitializationClient(c, async () => { calls++; return response(); }).execute(execution(i))); assert.equal(calls, 1);
    }
    await unknown(() => machineInitializationClient(c, async () => json({ ...admissionReply(i), specimenId: randomUUID() })).admit(scope(), i));
});

test('noncanonical, invalid UTF8, malformed/oversized response bodies and wrong media type are rejected', async () => {
    const c = config(), i = input();
    for (const response of [
        new Response(' ' + canonical(executionReply(i)), { headers: { 'content-type': 'application/json' } }),
        new Response(Buffer.from([255]), { headers: { 'content-type': 'application/json' } }),
        new Response('{', { headers: { 'content-type': 'application/json' } }),
        new Response('x'.repeat(4097), { headers: { 'content-type': 'application/json' } }),
        new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '4097' } }),
        new Response('{}', { headers: { 'content-type': 'text/plain' } }),
    ]) await unknown(() => machineInitializationClient(c, async () => response).execute(execution(i)));
});

test('parent abort prevents an initial call and bounds a noncooperative in-flight fetch', async () => {
    const c = config(), i = input(), already = new AbortController(); already.abort(); let calls = 0;
    await unknown(() => machineInitializationClient(c, async () => { calls++; return json(executionReply(i)); }).execute(execution(i), { signal: already.signal }));
    assert.equal(calls, 0);
    const parent = new AbortController(), gate = deferred();
    const pending = machineInitializationClient(c, async () => { calls++; return gate.promise; }).execute(execution(i), { signal: parent.signal });
    await flush(); parent.abort(); await unknown(() => pending); assert.equal(calls, 1);
    gate.resolve(json(executionReply(i))); await flush(); assert.equal(calls, 1);
});

test('fixed deadline bounds uncooperative fetch with no retry and clears its timer', async () => {
    const c = config(), i = input(), gate = deferred(); let fire, duration, cleared = false, calls = 0;
    const timers = { setTimeout(callback, ms) { fire = callback; duration = ms; return 1; }, clearTimeout() { cleared = true; } };
    const pending = machineInitializationClient(c, async () => { calls++; return gate.promise; }, { timers }).execute(execution(i));
    await flush(); assert.equal(duration, 220_000); fire(); await unknown(() => pending); assert(cleared); assert.equal(calls, 1);
    gate.resolve(json(executionReply(i)));
});

test('abort cancels a streaming body instead of retaining the response reader', async () => {
    const c = config(), i = input(), controller = new AbortController(); let cancelled = false;
    const body = new ReadableStream({ start(stream) { stream.enqueue(Buffer.from('{')); }, cancel() { cancelled = true; } });
    const pending = machineInitializationClient(c, async () => new Response(body, { headers: { 'content-type': 'application/json' } }))
        .execute(execution(i), { signal: controller.signal });
    await flush(); controller.abort(); await unknown(() => pending); await flush(); assert(cancelled);
});

test('bad input/configuration cannot reach fetch or supply a caller-selected URL, cookie or retry', async () => {
    const c = config(), i = input(); let calls = 0;
    const client = machineInitializationClient(c, async () => { calls++; return json(executionReply(i)); });
    for (const patch of [{ url: 'https://other.test' }, { cookie: 'secret' }, { retry: true }, { runtimeHash: 'b'.repeat(64) }])
        assert.throws(() => client.execute({ ...execution(i), ...patch }));
    assert.equal(calls, 0); assert.notEqual(digest(c.admissionKey), digest(c.executionKey));
});
