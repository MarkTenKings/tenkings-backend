import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { createStationHttpServer, STATION_ORIGIN, STATION_PORT } from '../src/http.mjs';
const code = 'a'.repeat(43), credential = 'b'.repeat(43);
async function fixture() {
  const calls = [], controller = Object.fromEntries(['status','enrollmentProof','enroll','prepare','operation','acknowledge'].map(name => [name, async body => { calls.push({ name, body }); return { state: 'SETUP_PENDING' }; }]));
  const server = createStationHttpServer({ controller, pairing: { code, credential, expiresAt: Date.now() + 100000 } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  function send({ path = '/v1/status', method = 'GET', body, headers = {} } = {}) {
    return new Promise((resolve, reject) => { const req = request({ hostname: '127.0.0.1', port: server.address().port, path, method,
      headers: { Host: `127.0.0.1:${STATION_PORT}`, Origin: STATION_ORIGIN, 'x-atlas-station-token': credential,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers } }, res => { const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() })); });
      req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body)); });
  }
  return { calls, send, close: () => new Promise(resolve => server.close(resolve)) };
}
test('exact loopback Host/origin and one-use pairing gate every controller call', async () => {
  const f = await fixture(); try {
    for (const headers of [{ Origin: 'https://evil.example' }, { Host: 'localhost:47664' }, { Origin: 'https://app.atlasgrading.com' }, { Cookie: 'anything' }, { Authorization: 'Bearer anything' }]) assert.equal((await f.send({ headers })).status, 403);
    assert.equal(f.calls.length, 0);
    assert.equal((await f.send({ headers: { 'x-atlas-station-token': '' } })).status, 401);
    const pair = await f.send({ path: '/v1/pair', method: 'POST', body: { pairingCode: code } }); assert.equal(pair.status, 200); assert.equal(JSON.parse(pair.body).result.credential, credential);
    assert.equal((await f.send({ path: '/v1/pair', method: 'POST', body: { pairingCode: code } })).status, 401);
    assert.equal((await f.send()).status, 200);
  } finally { await f.close(); }
});
test('CORS/PNA is exact and arbitrary paths, methods, query inputs and headers are refused', async () => {
  const f = await fixture(); try {
    const preflight = await f.send({ path: '/v1/prepare', method: 'OPTIONS', headers: { 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,x-atlas-station-token' } });
    assert.equal(preflight.status, 204); assert.equal(preflight.headers['access-control-allow-origin'], STATION_ORIGIN); assert.equal(preflight.headers['access-control-allow-private-network'], 'true');
    assert.equal((await f.send({ method: 'OPTIONS', headers: { 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' } })).status, 403);
    for (const path of ['/v1/print', '/v1/write', '/v1/status?url=https://evil.example', '/v1/../status']) assert.notEqual((await f.send({ path })).status, 200);
    assert.equal((await f.send({ path: '/v1/prepare' })).status, 405); assert.equal(f.calls.length, 0);
  } finally { await f.close(); }
});
test('oversized body and non JSON requests never reach physical controller', async () => {
  const f = await fixture(); try {
    assert.equal((await f.send({ path: '/v1/prepare', method: 'POST', body: {}, headers: { 'content-type': 'text/plain' } })).status, 415);
    assert.equal((await f.send({ path: '/v1/prepare', method: 'POST', body: { data: 'x'.repeat(140000) } })).status, 413);
    assert.equal(f.calls.length, 0);
  } finally { await f.close(); }
});
