import assert from 'node:assert/strict';
import { test } from 'node:test';
import { request as httpRequest } from 'node:http';
import { randomBytes, createHmac } from 'node:crypto';
import { once } from 'node:events';
import { createPrivateServer } from '../src/http.mjs';

async function fixture(work) {
    const key = randomBytes(32), calls = [], errors = [];
    const server = createPrivateServer({ origin: 'https://private.example', health: { service: 'fixture' }, onError: code => errors.push(code),
        routes: new Map([['/workspace/v1', { key, signatureHeader: 'x-atlas-workspace-signature',
            responseSignatureHeader: 'x-atlas-workspace-response', maximumBytes: 64, maximumResponseBytes: 64,
            async receive(body, signature) { calls.push({ body, signature }); return { bytes: Buffer.from('{"state":"PENDING"}'),
                contentType: 'application/json', signature: 'a'.repeat(64) }; } }]]) });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const send = ({ body = '{"request":"fixture"}', path = '/workspace/v1', method = 'POST', headers = {} } = {}) => new Promise((resolve, reject) => {
        const signed = createHmac('sha256', key).update(body).digest('hex');
        const request = httpRequest({ host: '127.0.0.1', port: server.address().port, path, method,
            headers: { host: 'private.example', 'x-forwarded-proto': 'https', 'content-type': 'application/json',
                'x-atlas-workspace-signature': signed, ...headers } }, response => {
            const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve({
                status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }));
        }); request.on('error', reject); request.end(method === 'GET' ? undefined : body);
    });
    try { await work({ send, calls, errors }); }
    finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
test('actual HTTP request authenticates once and returns the original signed response', async () => fixture(async ({ send, calls }) => {
    const result = await send(); assert.equal(result.status, 200); assert.equal(calls.length, 1);
    assert.equal(result.headers['x-atlas-workspace-response'], 'a'.repeat(64));
    assert.equal(result.headers['cache-control'], 'private, no-store');
    assert.equal(result.body, '{"state":"PENDING"}');
}));
test('bad authentication never reaches the private database/service callback and never echoes bodies', async () => fixture(async ({ send, calls }) => {
    for (const signature of ['', 'b'.repeat(64), 'short', '0'.repeat(65)]) {
        const result = await send({ body: '{"private":"do-not-echo"}', headers: { 'x-atlas-workspace-signature': signature } });
        assert.equal(result.status, 503); assert(!result.body.includes('do-not-echo'));
    }
    assert.equal(calls.length, 0);
}));
test('host, origin, query, method and ambiguous headers cannot select another private route', async () => fixture(async ({ send, calls }) => {
    for (const input of [{ path: '/workspace/v1?x=1' }, { path: '/workspace/v1/' }, { method: 'PUT' },
        { headers: { host: 'other.example' } }, { headers: { 'x-forwarded-host': 'other.example' } },
        { headers: { 'x-forwarded-proto': 'http' } }, { headers: { cookie: 'session=fixture' } },
        { headers: { authorization: 'Bearer fixture' } }, { headers: { origin: 'https://staff.example' } },
        { headers: { 'content-type': 'application/json; charset=utf-8' } }, { headers: { 'content-encoding': 'gzip' } },
        { headers: { 'x-atlas-workspace-signature': ['a'.repeat(64), 'a'.repeat(64)] } }]) {
        assert.equal((await send(input)).status, 503);
    }
    assert.equal(calls.length, 0);
}));
test('bounded body and unauthenticated health never invoke source work', async () => fixture(async ({ send, calls }) => {
    assert.equal((await send({ body: 'x'.repeat(65) })).status, 503);
    const health = await send({ method: 'GET', path: '/health' });
    assert.equal(health.status, 200); assert.deepEqual(JSON.parse(health.body), { service: 'fixture' });
    assert.equal(calls.length, 0);
}));
