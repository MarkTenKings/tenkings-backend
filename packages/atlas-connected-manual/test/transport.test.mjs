import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createManualServiceProxy, assertPrivateManualRequest, createPrivateManualNonceStore,
  isManualServicePath, MANUAL_TRANSPORT_LIMITS } from '../src/transport.mjs';
import { createPrivateManualServer } from '../scripts/private-server.mjs';

const key = Buffer.alloc(32, 83), origin = 'https://app.atlasgrading.test';
const card = '0336918d-0204-47e0-acdf-6ef4b22b62c1';
const path = '/api/staff/manual-intake/cards';
const imagePath = `/api/staff/manual-connected/cards/${card}/preview-image/FRONT`;
function response() {
  return { statusCode: null, headers: {}, setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; }, json(value) { this.value = value; },
    send(value) { this.bytes = value; } };
}
function request(overrides = {}) {
  return { method: 'POST', url: path, body: { requestId: card, label: 'Transport test' }, headers: {
    cookie: 'atlas_session=secret-session; atlas_browser=secret-browser', 'x-atlas-csrf': 'secret-csrf', origin,
    'content-type': 'application/json', 'x-browser-principal': 'REVIEWER', authorization: 'Browser-supplied',
    'x-atlas-manual-signature': 'browser-supplied' }, ...overrides };
}
async function capture(req = request()) {
  let captured;
  const proxy = createManualServiceProxy({ origin: 'https://manual-private.test', key, fetchImpl: async (url, init) => {
    captured = { url, init }; return Response.json({ ok: true });
  } });
  const res = response(); assert.equal(await proxy(req, res), true); assert.equal(res.statusCode, 200);
  return { method: captured.init.method, url: new URL(captured.url).pathname + new URL(captured.url).search,
    headers: captured.init.headers, rawBody: Buffer.from(captured.init.body ?? ''), captured };
}
const verify = (req, extra = {}) => assertPrivateManualRequest(req, { key, origin,
  nonceStore: createPrivateManualNonceStore(), ...extra });

test('proxy signs only fixed HTTPS routes and exact bytes, strips browser actor/signature headers', async () => {
  const signed = await capture();
  assert.equal(signed.captured.url, `https://manual-private.test${path}`);
  assert.equal(signed.captured.init.redirect, 'manual');
  assert.equal(signed.headers.authorization, undefined); assert.equal(signed.headers['x-browser-principal'], undefined);
  assert.notEqual(signed.headers['x-atlas-manual-signature'], 'browser-supplied');
  assert.equal(signed.rawBody.toString(), JSON.stringify(request().body));
  assert.equal(await verify(signed), true);
  const second = await capture(); assert.notEqual(second.headers['x-atlas-manual-nonce'], signed.headers['x-atlas-manual-nonce']);
  for (const bad of ['/api/staff/session', '/api/staff/workspace/cards', '/api/staff/manual/cards/../cards',
    '/api/staff/manual/cards/%2e%2e', '//foreign.test/api/staff/manual/cards', `${path}#secret`, `${path}\\escape`,
    `https://foreign.test${path}`, '/api/staff/manualoperator/cards']) assert.equal(isManualServicePath(bad), false, bad);
  assert.equal(isManualServicePath(`${path}?limit=30&cursor=a%2Bb`), true);
  let calls = 0;
  const proxy = createManualServiceProxy({ origin: 'https://manual-private.test', key, fetchImpl() { calls++; } });
  assert.equal(await proxy(request({ url: '/api/staff/session' }), response()), false); assert.equal(calls, 0);
  for (const badOrigin of ['http://127.0.0.1:1234', 'https://user:secret@private.test', 'https://private.test/prefix',
    'https://private.test/?query=1', 'https://private.test/#fragment']) assert.throws(() => createManualServiceProxy({ origin: badOrigin, key }));
  assert.throws(() => createManualServiceProxy({ origin: 'https://private.test', key: 'short' }));
  assert.throws(() => createManualServiceProxy({ origin: 'https://private.test', key, timeoutMs: 210001 }));
});

test('private signature binds method/path/query/body/cookie/CSRF/content-type/origin, and rejects missing headers', async () => {
  const signed = await capture();
  const variants = [
    { ...signed, url: `${path}?limit=1` },
    { ...signed, url: `${path}/${card}` },
    { ...signed, method: 'GET', rawBody: Buffer.alloc(0) },
    { ...signed, rawBody: Buffer.from('{"different":true}') },
    ...['cookie', 'x-atlas-csrf', 'content-type'].map(name => ({ ...signed, headers: { ...signed.headers,
      [name]: name === 'content-type' ? 'application/json; charset=utf-8' : 'different' } })),
    { ...signed, headers: { ...signed.headers, origin: 'https://foreign.test' } },
  ];
  for (const value of variants) await assert.rejects(verify(value));
  await assert.rejects(verify({ ...signed, headers: {} }), { code: 'MANUAL_PRIVATE_SIGNATURE_REQUIRED' });
  await assert.rejects(verify(signed, { key: Buffer.alloc(32, 84) }), { code: 'MANUAL_PRIVATE_SIGNATURE_INVALID' });
  await assert.rejects(verify({ ...signed, rawBody: undefined }), { code: 'MANUAL_RAW_BODY_REQUIRED' });
  await assert.rejects(verify({ ...signed, rawHeaders: ['Cookie', signed.headers.cookie, 'cookie', signed.headers.cookie] }),
    { code: 'MANUAL_TRANSPORT_HEADER_INVALID' });
  await assert.rejects(verify({ ...signed, headers: { ...signed.headers, cookie: [signed.headers.cookie] } }),
    { code: 'MANUAL_TRANSPORT_HEADER_INVALID' });
});

test('nonce admission is atomic, bounded, timestamp-limited and reusable only after full expiry', async () => {
  const signed = await capture(), sent = Number(signed.headers['x-atlas-manual-timestamp']);
  const nonceStore = createPrivateManualNonceStore();
  const concurrent = await Promise.allSettled([verify(signed, { nonceStore }), verify(signed, { nonceStore })]);
  assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(concurrent.find(result => result.status === 'rejected').reason.code, 'MANUAL_PRIVATE_REQUEST_REPLAYED');
  await assert.rejects(verify(signed, { now: () => sent + 60001 }), { code: 'MANUAL_PRIVATE_REQUEST_EXPIRED' });
  await assert.rejects(verify(signed, { now: () => sent - 60001 }), { code: 'MANUAL_PRIVATE_REQUEST_EXPIRED' });
  let now = 1000; const bounded = createPrivateManualNonceStore({ capacity: 1, now: () => now });
  assert.equal(bounded.consume('first', 1200), true);
  assert.equal(bounded.consume('first', 1200), false);
  assert.throws(() => bounded.consume('second', 1400), { code: 'MANUAL_REPLAY_STORE_FULL' });
  now = 1200; assert.equal(bounded.consume('first', 1200), false);
  now = 1201; assert.equal(bounded.consume('second', 1400), true);
});

test('request limits and JSON/CSRF/method checks reject before network dispatch', async () => {
  let calls = 0;
  const proxy = createManualServiceProxy({ origin: 'https://private.test', key, fetchImpl() { calls++; } });
  for (const [req, code] of [
    [request({ body: { value: 'x'.repeat(MANUAL_TRANSPORT_LIMITS.requestBytes) } }), 'REQUEST_TOO_LARGE'],
    [request({ body: 'not JSON' }), 'MANUAL_JSON_INVALID'],
    [request({ method: 'DELETE' }), 'MANUAL_METHOD_NOT_ALLOWED'],
    [request({ method: 'GET', body: {} }), 'MANUAL_REQUEST_INVALID'],
    [request({ headers: { ...request().headers, 'x-atlas-csrf': '' } }), 'CSRF_REQUIRED'],
    [request({ headers: { ...request().headers, 'content-type': 'text/plain' } }), 'MANUAL_JSON_REQUIRED'],
  ]) {
    const res = response(); await proxy(req, res); assert.equal(res.value.error, code);
  }
  assert.equal(calls, 0);
});

test('responses are bounded before sending, redirects refused and large images explicitly require direct access', async () => {
  const run = async (makeResponse, req = request()) => {
    const res = response();
    await createManualServiceProxy({ origin: 'https://private.test', key, fetchImpl: makeResponse })(req, res);
    return res;
  };
  let res = await run(async () => new Response(null, { status: 307, headers: { location: 'https://foreign.test' } }));
  assert.equal(res.value.error, 'MANUAL_SERVICE_REDIRECT_REFUSED'); assert.equal(res.headers.location, undefined);
  res = await run(async () => new Response('{}', { headers: { 'content-type': 'text/html' } }));
  assert.equal(res.value.error, 'MANUAL_SERVICE_RESPONSE_INVALID');
  res = await run(async () => new Response('x'.repeat(MANUAL_TRANSPORT_LIMITS.jsonResponseBytes + 1), {
    headers: { 'content-type': 'application/json' } }));
  assert.equal(res.value.error, 'MANUAL_SERVICE_RESPONSE_TOO_LARGE'); assert.equal(res.bytes, undefined);
  const imageRequest = request({ method: 'GET', url: imagePath, body: undefined });
  res = await run(async () => new Response(Buffer.alloc(MANUAL_TRANSPORT_LIMITS.imageResponseBytes), {
    headers: { 'content-type': 'image/png', 'set-cookie': 'not-forwarded=1' } }), imageRequest);
  assert.equal(res.statusCode, 200); assert.equal(res.bytes.length, MANUAL_TRANSPORT_LIMITS.imageResponseBytes);
  assert.equal(res.headers['set-cookie'], undefined); assert.match(res.headers['content-security-policy'], /sandbox/);
  res = await run(async () => new Response(Buffer.alloc(MANUAL_TRANSPORT_LIMITS.imageResponseBytes + 1), {
    headers: { 'content-type': 'image/png' } }), imageRequest);
  assert.equal(res.statusCode, 413); assert.equal(res.value.error, 'MANUAL_IMAGE_DIRECT_REQUIRED'); assert.equal(res.bytes, undefined);
  res = await run(async () => new Response('small but oversized declaration', {
    headers: { 'content-type': 'image/png', 'content-length': String(20 * 1024 * 1024) } }), imageRequest);
  assert.equal(res.value.error, 'MANUAL_IMAGE_DIRECT_REQUIRED');
  res = await run(async () => new Response('svg', { headers: { 'content-type': 'image/svg+xml' } }), imageRequest);
  assert.equal(res.value.error, 'MANUAL_SERVICE_RESPONSE_INVALID');
});

test('timeout bounds fetch and body streaming even when injected fetch ignores abort', async () => {
  let cancelled = 0;
  for (const fetchImpl of [() => new Promise(() => {}), async () => new Response(new ReadableStream({ start() {}, cancel() { cancelled++; } }),
    { headers: { 'content-type': 'application/json' } })]) {
    const res = response(); const before = Date.now();
    await createManualServiceProxy({ origin: 'https://private.test', key, fetchImpl, timeoutMs: 20 })(request(), res);
    assert.equal(res.statusCode, 504); assert.equal(res.value.error, 'MANUAL_SERVICE_TIMEOUT');
    assert.ok(Date.now() - before < 1000);
  }
  assert.equal(cancelled, 1);
});

test('uncertain replies are never automatically retried; explicit replay preserves exact action bytes with a fresh transport nonce', async () => {
  const attempts = [];
  const proxy = createManualServiceProxy({ origin: 'https://private.test', key, fetchImpl: async (_url, init) => {
    attempts.push(init); throw new Error('Synthetic lost reply after dispatch');
  } });
  for (let i = 1; i <= 2; i++) {
    const res = response(); await proxy(request(), res);
    assert.equal(res.value.error, 'MANUAL_SERVICE_UNAVAILABLE'); assert.equal(attempts.length, i);
  }
  assert.deepEqual(attempts[0].body, attempts[1].body);
  assert.notEqual(attempts[0].headers['x-atlas-manual-nonce'], attempts[1].headers['x-atlas-manual-nonce']);
});

test('actual private HTTP host requires transport admission then independently authenticates cookie and CSRF', async t => {
  let authCalls = 0, writes = 0; const principal = Object.freeze({ id: 'opaque-server-only' });
  const boundary = { async authenticate(cookie, csrf) {
    authCalls++;
    if (cookie !== request().headers.cookie || csrf !== undefined && csrf !== 'secret-csrf') throw Object.assign(new Error(), { status: 401, code: 'SIGN_IN_REQUIRED' });
    return principal;
  } };
  const connected = { workflow: { service: {} }, intake: {
    async create(staff, body) { assert.equal(staff, principal); writes++; return { cardId: card, label: body.label }; },
  }, async intakeImage() { return { contentType: 'image/png', bytes: Buffer.alloc(20 * 1024 * 1024) }; } };
  const server = createPrivateManualServer({ connected, boundary, origin, key });
  assert.throws(() => createPrivateManualServer({ connected, boundary, origin, key: 'short' }));
  assert.throws(() => createPrivateManualServer({ connected, boundary, origin: 'http://foreign.test', key }));
  assert.equal(server.listening, false);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    assert.equal(server.listening, false); });
  const localOrigin = `http://127.0.0.1:${server.address().port}`;
  let captured;
  const proxy = createManualServiceProxy({ origin: 'https://private.test', key, fetchImpl: async (url, init) => {
    captured = init; return fetch(localOrigin + new URL(url).pathname, init);
  } });
  let res = response(); await proxy(request(), res);
  assert.equal(res.statusCode, 200); assert.deepEqual(JSON.parse(res.bytes), { cardId: card, label: 'Transport test' });
  assert.equal(authCalls, 1); assert.equal(writes, 1);
  const replay = await fetch(localOrigin + path, captured);
  assert.equal(replay.status, 409); assert.equal((await replay.json()).error, 'MANUAL_PRIVATE_REQUEST_REPLAYED');
  assert.equal(authCalls, 1); assert.equal(writes, 1);
  const direct = await fetch(localOrigin + path, { method: 'POST', headers: request().headers, body: '{}' });
  assert.equal(direct.status, 401); assert.equal(authCalls, 1);
  res = response(); await proxy(request({ headers: { ...request().headers, cookie: 'forged', 'x-browser-principal': 'REVIEWER' } }), res);
  assert.equal(res.statusCode, 401); assert.equal(authCalls, 2); assert.equal(writes, 1);
  const oversized = await fetch(localOrigin + path, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: 'x'.repeat(MANUAL_TRANSPORT_LIMITS.requestBytes + 1) });
  assert.equal(oversized.status, 413); assert.equal((await oversized.json()).error, 'REQUEST_TOO_LARGE');
  const chunked = await new Promise((resolve, reject) => {
    const req = httpRequest(localOrigin + path, { method: 'POST', headers: { 'content-type': 'application/json',
      'transfer-encoding': 'chunked' } }, result => {
      const chunks = []; result.on('data', chunk => chunks.push(chunk));
      result.on('end', () => resolve({ status: result.statusCode, body: JSON.parse(Buffer.concat(chunks)) }));
    });
    req.on('error', reject); req.write(Buffer.alloc(MANUAL_TRANSPORT_LIMITS.requestBytes)); req.end('x');
  });
  assert.equal(chunked.status, 413); assert.equal(chunked.body.error, 'REQUEST_TOO_LARGE');
  const unrelated = await fetch(localOrigin + '/api/staff/session'); assert.equal(unrelated.status, 404);
  res = response(); await proxy(request({ method: 'GET', url: imagePath, body: undefined }), res);
  assert.equal(res.statusCode, 413); assert.equal(JSON.parse(res.bytes).error, 'MANUAL_IMAGE_DIRECT_REQUIRED');
  assert.equal(server.listening, true);
});
