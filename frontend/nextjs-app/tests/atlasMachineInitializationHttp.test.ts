import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { NextApiRequest, NextApiResponse } from 'next';
import { createAtlasMachineInitializationHandler } from '../lib/server/atlasMachineInitializationHttp';
import { atlasMachineInitializationConfig } from '../lib/server/atlasMachineInitialization';
import { canonical } from '@atlas/service-bridge/protocol';

const settings = { origin: 'https://private.example.test' };
function request(kind = 'admit', patch: Record<string, unknown> = {}, chunks = [Buffer.from('{"canonical":"body"}')]) {
    return Object.assign(new EventEmitter(), { method: 'POST', url: `/api/internal/atlas/machine-initialize/${kind}`,
        headers: { host: 'private.example.test', 'x-forwarded-proto': 'https', 'content-type': 'application/json',
            [`x-atlas-machine-${kind === 'admit' ? 'admission' : 'execution'}-signature`]: 'a'.repeat(64) },
        async *[Symbol.asyncIterator]() { for (const chunk of chunks) yield chunk; }, ...patch }) as unknown as NextApiRequest;
}
function response() {
    const state = { status: 0, body: undefined as unknown, headers: {} as Record<string, string> };
    const value = Object.assign(new EventEmitter(), { writableEnded: false,
        setHeader(key: string, header: string) { state.headers[key] = header; return this; },
        status(status: number) { state.status = status; return this; },
        json(body: unknown) { state.body = body; this.writableEnded = true; return this; },
        send(body: unknown) { state.body = body; this.writableEnded = true; return this; } });
    return { state, value: value as unknown as NextApiResponse };
}
test('named machine boundaries preserve raw signed bytes and canonical response bytes', async () => {
    for (const kind of ['ADMIT', 'EXECUTE'] as const) {
        let calls = 0; const result = { z: 'last', a: 'first' };
        const handler = createAtlasMachineInitializationHandler(kind, { settings: () => settings,
            async receive(config, body, signature, signal) { calls++; assert.equal(config, settings);
                assert.equal(body, '{"canonical":"body"}'); assert.equal(signature, 'a'.repeat(64)); assert.equal(signal.aborted, false); return result; } });
        const req = request(kind.toLowerCase()), res = response(); await handler(req, res.value);
        assert.equal(calls, 1); assert.equal(res.state.status, 200); assert.equal(res.state.body, canonical(result));
        assert.equal(res.state.headers['Cache-Control'], 'private, no-store');
        assert.equal(req.listenerCount('aborted'), 0); assert.equal(res.value.listenerCount('close'), 0);
    }
});
test('wrong request target, purpose, browser credentials and streaming bounds never reach execution', async () => {
    const baseline = request('execute');
    const patches = [{ method: 'GET' }, { url: '/api/internal/atlas/machine-initialize/admit' },
        { url: '/api/internal/atlas/machine-initialize/execute?job=other' },
        ...[{ host: 'evil.test' }, { 'x-forwarded-host': 'evil.test' }, { 'x-forwarded-proto': 'http' },
            { 'x-forwarded-proto': ['https'] }, { cookie: 'staff=actor' }, { authorization: 'Bearer token' },
            { 'content-type': 'text/plain' }, { 'content-length': '8193' }, { 'content-length': 'nope' },
            { 'x-atlas-machine-execution-signature': ['a'.repeat(64)] },
            { 'x-atlas-machine-execution-signature': undefined, 'x-atlas-machine-admission-signature': 'a'.repeat(64) }]
            .map(headers => ({ headers: { ...baseline.headers, ...headers } }))];
    let calls = 0;
    const handler = createAtlasMachineInitializationHandler('EXECUTE', { settings: () => settings, async receive() { calls++; return {}; } });
    const inputs = [...patches.map(patch => request('execute', patch)), request('execute', {}, [Buffer.alloc(8193)]),
        request('execute', {}, [Buffer.from([255])]), request('execute', { headers: { ...baseline.headers, 'content-length': '1' } })];
    for (const req of inputs) { const res = response(); await handler(req, res.value);
        assert.equal(res.state.status, 503); assert.deepEqual(res.state.body, { error: 'ATLAS_MACHINE_INITIALIZATION_UNAVAILABLE' }); }
    assert.equal(calls, 0);
});
test('disconnect aborts work and private failure details are not returned', async () => {
    const req = request('execute'), res = response(); let observed = false;
    const handler = createAtlasMachineInitializationHandler('EXECUTE', { settings: () => settings,
        async receive(_settings, _body, _signature, signal) { req.emit('aborted'); observed = signal.aborted;
            throw new Error('private-worker-key-and-source'); } });
    await handler(req, res.value); assert.equal(observed, true); assert.equal(res.state.status, 503);
    assert.deepEqual(res.state.body, { error: 'ATLAS_MACHINE_INITIALIZATION_UNAVAILABLE' });
    assert.equal(req.listenerCount('aborted'), 0); assert.equal(res.value.listenerCount('close'), 0);
});
test('machine activation cannot bypass original deployment and preparation gates', () => {
    for (const env of [{ NODE_ENV: 'production' }, { NODE_ENV: 'production', ATLAS_MACHINE_INITIALIZATION_ENABLED: 'true' },
        { NODE_ENV: 'production', ATLAS_MACHINE_INITIALIZATION_ENABLED: 'true', ATLAS_OPERATOR_RUNTIME_HASH: 'a'.repeat(64), ATLAS_LOCAL_FIXTURE: 'true' }] as NodeJS.ProcessEnv[])
        assert.throws(() => atlasMachineInitializationConfig(env), /MACHINE_INITIALIZATION_NOT_ENABLED/);
    assert.throws(() => atlasMachineInitializationConfig({ NODE_ENV: 'production', ATLAS_MACHINE_INITIALIZATION_ENABLED: 'true',
        ATLAS_OPERATOR_RUNTIME_HASH: 'a'.repeat(64) }), /BRIDGE_NOT_ENABLED/);
});
