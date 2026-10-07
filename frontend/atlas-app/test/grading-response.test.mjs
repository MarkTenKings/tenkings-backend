import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { createRequire } from 'node:module';
import { GRADING_STREAM_HEADER, GRADING_STREAM_PROTOCOL, gradingResponseResult } from '../lib/grading-response.mjs';
import { createGradingResponse } from '../lib/server/grading-response.mjs';
import { createHandler } from '../lib/server/http.mjs';
import { StaffGrading } from '../lib/server/access/grading.mjs';
import { BoundaryError, deny, hash, LOCAL_HOST, LOCAL_ORIGIN } from '../lib/server/policy.mjs';
import { canonical } from '../lib/server/review-contract.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
class Response extends EventEmitter {
    headers = {}; chunks = []; statusCode = 200; headersSent = false; writableEnded = false; destroyed = false;
    setHeader(key, value) { assert.equal(this.headersSent, false); this.headers[key.toLowerCase()] = value; }
    status(value) { assert.equal(this.headersSent, false); this.statusCode = value; return this; }
    write(value) { assert.equal(this.writableEnded, false); this.headersSent = true; this.chunks.push(value); return true; }
    end(value) { this.write(value); this.writableEnded = true; this.emit('finish'); }
    json(value) { this.end(JSON.stringify(value)); return this; }
    body() { return JSON.parse(this.chunks.join('')); }
}
function clock() {
    const active = new Map(), delays = []; let next = 0;
    return { active, delays, setInterval(callback, delay) { delays.push(delay); active.set(++next, callback); return next; },
        clearInterval(key) { active.delete(key); }, tick() { for (const callback of [...active.values()]) callback(); } };
}
const request = (changes = {}) => ({ url: '/api/staff/cards/sample-001/grade', method: 'POST', body: {}, socket: { remoteAddress: '127.0.0.1' },
    headers: { host: LOCAL_HOST, origin: LOCAL_ORIGIN, cookie: 'fixture-session', 'content-type': 'application/json', 'x-atlas-csrf': 'fixture-csrf' }, ...changes });
function handlerFixture(run) {
    const actor = Object.freeze({ id: 'fixture-human' });
    const auth = { async authenticate(cookie, csrf) {
        if (cookie !== 'fixture-session') deny(401, 'SIGN_IN_REQUIRED');
        if (csrf !== 'fixture-csrf') deny(403, 'CSRF_REQUIRED');
        return actor;
    } };
    return createHandler({ auth, review: {}, grading: { async run(staff, ...args) { assert.equal(staff, actor); return run(...args); } } },
        { NODE_ENV: 'development', ATLAS_LOCAL_SYNTHETIC: '1' });
}

test('grading response begins only at dispatch and sends bounded whitespace without buffering or a success receipt', () => {
    const res = new Response(), timers = clock(), stream = createGradingResponse(res, timers);
    assert.equal(stream.started, false); assert.equal(res.headersSent, false); assert.equal(timers.active.size, 0);
    stream.start(); stream.start();
    assert.equal(stream.started, true); assert.deepEqual(res.chunks, ['\n']); assert.deepEqual(timers.delays, [15_000]);
    assert.equal(res.headers[GRADING_STREAM_HEADER], GRADING_STREAM_PROTOCOL);
    assert.match(res.headers['cache-control'], /private, no-store.*no-transform/);
    assert.equal(res.headers['x-accel-buffering'], 'no'); assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
    for (let i = 0; i < 16; i++) timers.tick();
    assert.equal(res.chunks.length, 17); assert.equal(timers.active.size, 0); assert.equal(res.writableEnded, false);
    const body = { card: { id: 'one' }, operation: { state: 'UNKNOWN' } };
    stream.finish(200, body);
    assert.deepEqual(gradingResponseResult(res.body()), { data: body, status: 200, ok: true });
    assert.equal(res.eventNames().length, 0); assert.equal(timers.active.size, 0);
});

test('closed and failing sockets stop only heartbeat writes and clean up their timer', () => {
    for (const failure of ['close', 'error', 'write']) {
        const res = new Response(), timers = clock(), stream = createGradingResponse(res, timers);
        stream.start();
        if (failure === 'write') res.write = () => { throw new Error('socket closed'); };
        else res.emit(failure, new Error('socket closed'));
        timers.tick(); const count = res.chunks.length;
        assert.doesNotThrow(() => stream.finish(503, { error: 'TEMPORARILY_UNAVAILABLE' }));
        assert.equal(timers.active.size, 0); assert.equal(res.chunks.length, count); assert.equal(res.eventNames().length, 0);
    }
});

test('grade ingress and pre-dispatch validation failures retain ordinary HTTP errors and emit no heartbeat', async () => {
    let calls = 0;
    const handler = handlerFixture(async () => { calls++; deny(400, 'INVALID_GRADING_ACTION'); });
    const attempts = [[request({ method: 'GET' }), 405], [request({ body: { tooLarge: 'x'.repeat(1_040_000) } }), 413],
        [request({ headers: { ...request().headers, host: 'other.invalid' } }), 403],
        [request({ headers: { ...request().headers, origin: 'https://other.invalid' } }), 403],
        [request({ headers: { ...request().headers, cookie: '' } }), 401],
        [request({ headers: { ...request().headers, 'x-atlas-csrf': '' } }), 403], [request(), 400]];
    for (const [req, status] of attempts) {
        const res = new Response(); await handler(req, res);
        assert.equal(res.statusCode, status); assert.equal(res.headers[GRADING_STREAM_HEADER], undefined);
        assert.equal(res.chunks.length, 1); assert.ok(res.body().error); assert.equal(res.eventNames().length, 0);
    }
    assert.equal(calls, 1);
});

test('handler awaits dispatched grading and encodes both final success and late authority/server denials', async () => {
    for (const error of [null, new BoundaryError(401, 'SIGN_IN_REQUIRED'), new BoundaryError(403, 'REVIEW_PERMISSION_REQUIRED'), new Error('private worker detail')]) {
        const dispatch = deferred(), result = deferred(); let done = false;
        const handler = handlerFixture(async (cardId, input, { onDispatched }) => {
            assert.equal(cardId, 'sample-001'); assert.deepEqual(input, {});
            onDispatched(); dispatch.resolve(); return result.promise;
        });
        const res = new Response(), pending = handler(request(), res).then(() => { done = true; });
        await dispatch.promise; assert.equal(done, false); assert.equal(res.writableEnded, false); assert.deepEqual(res.chunks, ['\n']);
        const body = { operation: { state: 'COMPLETED' }, card: { id: 'sample-001' } };
        if (error) result.reject(error); else result.resolve(body);
        await pending; assert.equal(res.statusCode, 200); assert.equal(res.writableEnded, true);
        const terminal = gradingResponseResult(res.body());
        assert.deepEqual(terminal, error ? { status: error.status ?? 503, ok: false,
            data: { error: error.code ?? 'TEMPORARILY_UNAVAILABLE' } } : { status: 200, ok: true, data: body });
        assert.doesNotMatch(res.chunks.join(''), /private worker detail/); assert.equal(res.eventNames().length, 0);
    }
});

test('browser disconnect cannot detach or resend a reserved grading request', async () => {
    const dispatch = deferred(), result = deferred(); let calls = 0, completed = false, done = false;
    const handler = handlerFixture(async (_, __, { onDispatched }) => {
        calls++; onDispatched(); dispatch.resolve(); await result.promise; completed = true;
        return { operation: { state: 'COMPLETED' } };
    });
    const res = new Response(), pending = handler(request(), res).then(() => { done = true; });
    await dispatch.promise; res.destroyed = true; res.emit('close');
    await Promise.resolve(); assert.equal(done, false); assert.equal(completed, false);
    result.resolve(); await pending;
    assert.equal(calls, 1); assert.equal(completed, true); assert.deepEqual(res.chunks, ['\n']); assert.equal(res.eventNames().length, 0);
});

test('a real HTTP response through installed Next compression delivers whitespace before the awaited result', { timeout: 5000 }, async t => {
    const compression = createRequire(import.meta.url)('next/dist/compiled/compression')(), result = deferred();
    const handler = handlerFixture(async (_, __, { onDispatched }) => { onDispatched(); return result.promise; });
    // Transport-only fixture. No database, provider or grading worker is used.
    const server = createServer((req, res) => {
        req.body = {};
        compression(req, res, () => { handler(req, res).catch(error => res.destroy(error)); });
    });
    t.after(() => { result.resolve({ operation: { state: 'UNKNOWN' } }); server.closeAllConnections(); server.close(); });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const first = deferred(), ended = deferred(), chunks = [];
    const outgoing = httpRequest({ hostname: '127.0.0.1', port: server.address().port, path: request().url, method: 'POST',
        headers: { ...request().headers, 'accept-encoding': 'gzip', 'content-length': '2' } }, incoming => {
        incoming.on('data', chunk => { chunks.push(chunk.toString()); first.resolve(incoming); });
        incoming.on('end', ended.resolve); incoming.on('error', ended.reject);
    });
    outgoing.on('error', error => { first.reject(error); ended.reject(error); });
    outgoing.end('{}');
    const incoming = await first.promise;
    assert.equal(incoming.statusCode, 200); assert.equal(incoming.headers['content-encoding'], undefined);
    assert.equal(incoming.headers[GRADING_STREAM_HEADER], GRADING_STREAM_PROTOCOL);
    assert.deepEqual(chunks, ['\n']); assert.equal(incoming.complete, false);
    result.resolve({ card: { id: 'sample-001' }, operation: { state: 'COMPLETED' } });
    await ended.promise;
    assert.equal(gradingResponseResult(JSON.parse(chunks.join(''))).data.operation.state, 'COMPLETED');
});

function gradingFixture({ commitError = false, loseReply = false } = {}) {
    const log = [], staff = {}, cardId = randomUUID(), now = new Date(), gradingPolicyHash = 'e'.repeat(64);
    const input = { operationId: randomUUID(), expectedAnalysisRevision: 0, analysisHash: null, expectedReviewRevision: 1,
        reviewHash: 'a'.repeat(64), evidenceHash: 'b'.repeat(64), action: { type: 'INITIALIZE' } };
    const card = { id: cardId, sourceId: 'synthetic', sourceOwnerId: 'synthetic-owner', analysisRevision: 0, draftRevision: 1, evidenceHash: input.evidenceHash };
    const policyCanonical = canonical({ version: 'atlas-grading-bridge-policy-v1', pilotId: randomUUID(),
        specimenIds: [cardId, ...Array.from({ length: 9 }, () => randomUUID())], expiresAt: new Date(+now + 600_000).toISOString(),
        maxOperationsPerCard: 10, maxTotalMicroUsd: 100_000, maxCardMicroUsd: 100_000,
        reservationPerOperationMicroUsd: 10_000, maxWorkerCalls: 4, deadlineMs: 200_000 });
    const control = { mode: 'LOCAL_FIXTURE', revision: 1, gradingPolicyHash }, binding = { origin: 'https://bridge.invalid', clientKeyHash: 'd'.repeat(64) };
    let row;
    const tx = { async $queryRaw(sql) { return sql.join('?').includes('StaffSpecimen') ? [card] : [{ count: 0 }]; },
        staffGradingOperation: { async findUnique() { return row ?? null; }, async count() { return 0; },
            async create({ data }) { row = data; log.push('reserved'); return row; },
            async update({ data }) { row = { ...row, ...data }; log.push(data.state); return row; } },
        staffGradingBridgeControl: { async findUnique() { return { enabled: true, mode: control.mode, ...binding,
            gradingPolicyHash, policyCanonical, policyHash: hash(policyCanonical) }; } },
        staffReviewRevision: { async findUnique() { return { contentHash: input.reviewHash }; } } };
    const auth = { async withStaff(actual, work) {
        assert.equal(actual, staff); const prior = row;
        const value = await work({ tx, now, control, identity: { id: 'synthetic-reviewer', role: 'REVIEWER', accessVersion: 1 }, session: { tokenHash: 'c'.repeat(64) } });
        if (commitError) { row = prior; log.push('rollback'); deny(401, 'SIGN_IN_REQUIRED'); }
        log.push('commit'); return value;
    }, async audit() { log.push('audit'); } };
    const review = { async assigned() { return { canReview: true, fence: 1 }; }, evidenceRecord() { return { sides: { FRONT: {}, BACK: {} }, sourceRevision: now.toISOString() }; } };
    const bridge = { binding, async call() { log.push('bridge'); if (loseReply) throw Error('lost reply'); } };
    const grading = new StaffGrading({ auth, review, bridge });
    grading.status = async () => { log.push('status'); return { operation: row }; };
    return { grading, staff, cardId, input, log };
}

test('real grading notifies transport after committed dispatch; duplicate and failed reservations never start it', async () => {
    const f = gradingFixture(); let notifications = 0;
    const options = { onDispatched() { notifications++; f.log.push('transport'); throw Error('socket failed'); } };
    await f.grading.run(f.staff, f.cardId, f.input, options);
    assert.deepEqual(f.log, ['reserved', 'DISPATCHED', 'audit', 'commit', 'transport', 'bridge', 'status']);
    await f.grading.run(f.staff, f.cardId, f.input, options);
    assert.equal(notifications, 1); assert.equal(f.log.filter(value => value === 'bridge').length, 1);
    const failed = gradingFixture({ commitError: true });
    await assert.rejects(failed.grading.run(failed.staff, failed.cardId, failed.input, options), { message: 'SIGN_IN_REQUIRED' });
    assert.equal(notifications, 1); assert.ok(failed.log.includes('rollback')); assert.ok(!failed.log.includes('bridge'));
    await assert.rejects(f.grading.run(f.staff, f.cardId, {}, options), { message: 'INVALID_REQUEST' });
    assert.equal(notifications, 1);
});

test('a transport callback failure preserves the original lost-bridge recovery and one exact dispatch', async () => {
    const f = gradingFixture({ loseReply: true });
    const result = await f.grading.run(f.staff, f.cardId, f.input, { onDispatched() { throw Error('socket closed'); } });
    assert.equal(result.operation.state, 'UNKNOWN'); assert.equal(result.operation.failureCode, 'BRIDGE_OUTCOME_UNCONFIRMED');
    assert.deepEqual(f.log, ['reserved', 'DISPATCHED', 'audit', 'commit', 'bridge', 'UNKNOWN', 'commit', 'status']);
});
