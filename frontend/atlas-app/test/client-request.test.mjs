import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { staffClientRequest, staffRequestDeadline, STAFF_RESPONSE_LIMIT } from '../lib/client-request.mjs';
import { GRADING_STREAM_HEADER, GRADING_STREAM_PROTOCOL } from '../lib/grading-response.mjs';
const encode = text => new TextEncoder().encode(text);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function clock() {
    let milliseconds = 0; const active = new Map(), delays = []; let id = 0;
    return { delays, active, now: () => milliseconds,
        setTimeout(callback, delay) { delays.push(delay); active.set(++id, callback); return id; },
        clearTimeout(key) { active.delete(key); },
        expire() { for (const callback of [...active.values()]) callback(); },
        advance(value) { milliseconds += value; } };
}
function response(parts = ['{"card":{"id":"one"}}'], status = 200, length = null, stream = null) {
    let index = 0; const calls = { cancel: 0, release: 0, read: 0, bodyCancel: 0 };
    const reader = { async read() { calls.read++; return index < parts.length ? { done: false, value: typeof parts[index] === 'string' ? encode(parts[index++]) : parts[index++] } : { done: true }; },
        cancel() { calls.cancel++; return new Promise(() => {}); }, releaseLock() { calls.release++; } };
    return { status, headers: { get: name => name === 'content-length' ? length : name === GRADING_STREAM_HEADER ? stream : null },
        body: { getReader: () => reader, cancel() { calls.bodyCancel++; return new Promise(() => {}); } }, reader, calls };
}
const unknown = error => error.code === 'REQUEST_OUTCOME_UNCONFIRMED' && error.status === undefined;
test('standard and exact grading deadlines preserve request interface and split UTF8 JSON', async () => {
    const timers = clock(), body = { operationId: 'same', reason: 'é' }, bytes = encode('{"card":{"name":"é"}}');
    const r = response([bytes.slice(0, 18), bytes.slice(18)]); let call;
    const result = await staffClientRequest('cards/one/grade', { body, csrf: 'token' }, { timers, now: timers.now,
        fetchImpl: async (url, options) => { call = { url, options }; return r; } });
    assert.equal(result.data.card.name, 'é'); assert.equal(result.ok, true); assert.equal(result.status, 200);
    assert.deepEqual(timers.delays, [240_000]); assert.equal(timers.active.size, 0);
    assert.equal(call.url, '/admin/api/staff/cards/one/grade'); assert.equal(call.options.body, JSON.stringify(body));
    assert.equal(call.options.headers['X-Atlas-Csrf'], 'token'); assert.equal(call.options.credentials, 'same-origin'); assert.equal(call.options.cache, 'no-store');
    assert.equal(call.options.redirect, 'error'); assert.equal(call.options.referrerPolicy, 'no-referrer');
    assert.equal(staffRequestDeadline('cards/one/grade', undefined), 15_000);
    for (const path of ['session', 'auth/request', 'auth/verify', 'cards/one/draft', 'cards/one/approve', 'cards/one/grade?x=1', 'cards/one/grade/extra']) assert.equal(staffRequestDeadline(path, body), 15_000);
});
test('deadline releases an uncooperative fetch and cancels an eventual late body without adopting it', async () => {
    const timers = clock(), pending = deferred(); let signal, sends = 0;
    const result = staffClientRequest('cards/one/draft', { body: { operationId: 'same' } }, { timers, now: timers.now,
        fetchImpl: async (_, options) => { sends++; signal = options.signal; return pending.promise; } });
    timers.expire(); await assert.rejects(result, unknown); assert.equal(signal.aborted, true); assert.equal(sends, 1);
    const late = response(); pending.resolve(late); await Promise.resolve(); await Promise.resolve();
    assert.equal(late.calls.bodyCancel, 1); assert.equal(late.calls.read, 0); assert.equal(timers.active.size, 0);
});
test('one deadline covers stalled streamed body even when read and cancel ignore abort', async () => {
    const timers = clock(), blocked = deferred(), r = response(); r.reader.read = () => blocked.promise;
    const result = staffClientRequest('session', {}, { timers, now: timers.now, fetchImpl: async () => r });
    await Promise.resolve(); timers.expire(); await assert.rejects(result, unknown);
    assert.ok(r.calls.cancel >= 1); assert.equal(timers.delays.length, 1); assert.equal(timers.active.size, 0);
    blocked.resolve({ done: false, value: encode('{"late":true}') }); await Promise.resolve();
});
test('pre-abort sends nothing and in-flight caller abort releases even an ignored fetch signal', async () => {
    const timers = clock(), controller = new AbortController(); controller.abort(); let sends = 0;
    await assert.rejects(staffClientRequest('session', { signal: controller.signal }, { timers, now: timers.now, fetchImpl: async () => { sends++; return response(); } }), e => e.name === 'AbortError' && !e.status);
    assert.equal(sends, 0); assert.equal(timers.active.size, 0);
    const active = new AbortController(), pending = deferred(); let ownSignal;
    const result = staffClientRequest('cards/one/approve', { body: {}, signal: active.signal }, { timers, now: timers.now,
        fetchImpl: async (_, options) => { ownSignal = options.signal; return pending.promise; } });
    active.abort(); await assert.rejects(result, e => e.code === 'REQUEST_CANCELLED' && !e.status);
    assert.equal(ownSignal.aborted, true); assert.equal(timers.active.size, 0);
    pending.reject(new Error('late rejection is handled')); await Promise.resolve();
});
test('caller abort while body is blocked cancels reader without waiting and removes listener', async () => {
    const timers = clock(), controller = new AbortController(), r = response(), blocked = deferred(); let added = 0, removed = 0;
    const add = controller.signal.addEventListener.bind(controller.signal), remove = controller.signal.removeEventListener.bind(controller.signal);
    controller.signal.addEventListener = (...args) => { added++; return add(...args); };
    controller.signal.removeEventListener = (...args) => { removed++; return remove(...args); };
    r.reader.read = () => blocked.promise;
    const result = staffClientRequest('session', { signal: controller.signal }, { timers, now: timers.now, fetchImpl: async () => r });
    await Promise.resolve(); controller.abort(); await assert.rejects(result, e => e.name === 'AbortError');
    assert.ok(r.calls.cancel); assert.equal(added, 1); assert.equal(removed, 1);
});
test('declared and actual oversized bodies fail unknown and stop reading', async () => {
    for (const r of [response([], 200, String(STAFF_RESPONSE_LIMIT + 1)), response([new Uint8Array(STAFF_RESPONSE_LIMIT), new Uint8Array(1), 'never'])]) {
        const timers = clock(); await assert.rejects(staffClientRequest('cards/one', {}, { timers, now: timers.now, fetchImpl: async () => r }), unknown);
        assert.ok(r.calls.cancel || r.calls.bodyCancel); assert.ok(r.calls.read <= 2); assert.equal(timers.active.size, 0);
    }
});
test('malformed JSON, invalid UTF8, missing body and invalid error envelope cannot become definitive errors', async () => {
    for (const r of [response(['{']), response([new Uint8Array([0xff])]), response(['null']), response(['[]']), response(['{"error":null}'], 403), response(['{"html":"no"}'], 502), { status: 200, body: null }]) {
        const timers = clock(); await assert.rejects(staffClientRequest('session', {}, { timers, now: timers.now, fetchImpl: async () => r }), unknown);
        assert.equal(timers.active.size, 0);
    }
});
test('valid bounded non-2xx errors retain status for existing api mapping, and network failures are unknown', async () => {
    for (const status of [400, 401, 403, 409, 429, 500, 503]) {
        const timers = clock(), data = await staffClientRequest('session', {}, { timers, now: timers.now, fetchImpl: async () => response(['{"error":"CSRF_REQUIRED"}'], status) });
        assert.deepEqual(data, { data: { error: 'CSRF_REQUIRED' }, ok: false, status });
    }
    await assert.rejects(staffClientRequest('session', {}, { fetchImpl: async () => { throw new TypeError('network'); } }), unknown);
});
test('grading keepalive whitespace is not success; its terminal envelope retains the actual result or denial', async () => {
    for (const status of [200, 400, 401, 403, 409, 429, 500, 503]) {
        const body = status === 200 ? { operation: { state: 'COMPLETED' }, card: { id: 'one' } } : { error: 'SIGN_IN_REQUIRED' };
        const timers = clock(), parts = ['\n', '\n', JSON.stringify({ protocol: GRADING_STREAM_PROTOCOL, status, body })];
        const result = await staffClientRequest('cards/one/grade', { body: { operationId: 'same' } }, { timers, now: timers.now,
            fetchImpl: async () => response(parts, 200, null, GRADING_STREAM_PROTOCOL) });
        assert.deepEqual(result, { data: body, ok: status === 200, status });
        assert.deepEqual(timers.delays, [240_000]); assert.equal(timers.active.size, 0);
    }
});
test('incomplete, unmarked, mismatched or malformed grading streams remain unknown and never clear a retained request', async () => {
    const terminal = { protocol: GRADING_STREAM_PROTOCOL, status: 200, body: { card: { id: 'one' } } };
    const attempts = [response(['\n'], 200, null, GRADING_STREAM_PROTOCOL),
        response([JSON.stringify(terminal)]), response([JSON.stringify(terminal)], 200, null, 'unknown-v2'),
        response([JSON.stringify(terminal)], 503, null, GRADING_STREAM_PROTOCOL),
        ...[{ ...terminal, status: 202 }, { ...terminal, status: '200' }, { ...terminal, extra: true },
            { ...terminal, protocol: 'unknown-v2' }, { ...terminal, body: { error: 'UNCONFIRMED' } },
            { ...terminal, status: 403, body: { error: 'private detail' } }, { ...terminal, body: null }]
            .map(body => response([JSON.stringify(body)], 200, null, GRADING_STREAM_PROTOCOL))];
    for (const r of attempts) await assert.rejects(staffClientRequest('cards/one/grade', { body: { operationId: 'same' } }, { fetchImpl: async () => r }), unknown);
    for (const [path, body] of [['session', undefined], ['cards/one/grade', undefined], ['cards/one/draft', {}]])
        await assert.rejects(staffClientRequest(path, { body }, { fetchImpl: async () => response([JSON.stringify(terminal)], 200, null, GRADING_STREAM_PROTOCOL) }), unknown);
    await assert.rejects(staffClientRequest('cards/one/grade', { body: {} }, { fetchImpl: async () => response(['{"error":"TEMPORARILY_UNAVAILABLE"}']) }), unknown);
});
test('grading heartbeat chunks cannot extend the independent deadline or authorize an automatic resend', async () => {
    const timers = clock(), r = response([], 200, null, GRADING_STREAM_PROTOCOL); let sends = 0;
    r.reader.read = async () => { timers.advance(60_000); return { done: false, value: encode('\n') }; };
    await assert.rejects(staffClientRequest('cards/one/grade', { body: { operationId: 'same' } }, { timers, now: timers.now,
        fetchImpl: async () => { sends++; return r; } }), unknown);
    assert.equal(sends, 1); assert.equal(timers.now(), 240_000); assert.equal(timers.active.size, 0);
});
test('elapsed deadline is checked after body completion even before timer callback can run', async () => {
    const timers = clock(), r = response(); const read = r.reader.read;
    r.reader.read = async () => { const value = await read(); timers.advance(15_001); return value; };
    await assert.rejects(staffClientRequest('session', {}, { timers, now: timers.now, fetchImpl: async () => r }), unknown);
});
test('existing api wrapper retains mapped message/code/status and successful result shape', async () => {
    const require = createRequire(import.meta.url), babel = require('next/dist/compiled/babel/core');
    const compiled = babel.transformSync(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
        filename: 'client.js', presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } } }]], babelrc: false, configFile: false }).code;
    let result = { ok: false, status: 403, data: { error: 'CSRF_REQUIRED' } }, received;
    const exports = {};
    vm.runInNewContext(compiled, { exports, require(name) {
        if (name === 'react') return {};
        if (name === './client-request.mjs') return { staffClientRequest: async (...args) => { received = args; return result; } };
        return require(name.startsWith('@babel/runtime/') ? `next/dist/compiled/${name}` : name);
    } });
    const options = { csrf: 'fresh', body: { operationId: 'same' } };
    await assert.rejects(exports.api('cards/one/draft', options), e => e.status === 403 && e.code === 'CSRF_REQUIRED' && e.message === 'Your session changed. Reload before saving.');
    assert.equal(received[0], 'cards/one/draft'); assert.deepEqual(received[1].body, options.body);
    result = { ok: true, status: 200, data: { card: { id: 'one' } } }; assert.deepEqual(await exports.api('cards/one'), result.data);
});
