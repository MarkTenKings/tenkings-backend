import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { createServer } from 'node:http';
import { createManualServiceProxy } from '../src/transport.mjs';
import { readManualResponse, MANUAL_STREAM_HEADER, MANUAL_STREAM_PROTOCOL } from '@atlas/manual-service/response';

function request() { return Object.assign(new EventEmitter(), { method: 'POST', url: '/api/staff/manual-intake/cards',
  body: { requestId: 'exact-request' }, headers: { cookie: 'ordinary-staff', 'x-atlas-csrf': 'csrf', origin: 'https://atlasgrading.com', 'content-type': 'application/json' } }); }
function response() {
  return Object.assign(new EventEmitter(), { headers: {}, chunks: [], statusCode: 200,
    setHeader(name, value) { assert.equal(this.headersSent, undefined, 'Cannot change headers after streaming'); this.headers[name.toLowerCase()] = value; },
    status(status) { this.statusCode = status; return this; },
    write(bytes) { this.headersSent = true; this.chunks.push(bytes); this.emit('chunk'); },
    end(bytes) { this.chunks.push(bytes); this.writableEnded = true; this.emit('finish'); },
    send(bytes) { this.end(bytes); }, json(body) { this.end(JSON.stringify(body)); },
    asFetch() { return new Response(this.chunks.join(''), { status: this.statusCode, headers: this.headers }); } });
}
const options = { origin: 'https://manual-private.atlasgrading.com', key: Buffer.alloc(32, 87), heartbeatMs: 5, timeoutMs: 1000 };

test('slow success and refusals produce liveness before final JSON, retain exact terminal status and dispatch once', async () => {
  for (const status of [200, 401, 409, 422, 503]) {
    let release, calls = 0;
    const held = new Promise(resolve => { release = resolve; }), req = request(), res = response();
    const pending = createManualServiceProxy({ ...options, fetchImpl: () => { calls++; return held; } })(req, res);
    await once(res, 'chunk');
    assert.equal(res.chunks.join(''), '\n'); assert.equal(res.writableEnded, undefined);
    assert.equal(res.headers[MANUAL_STREAM_HEADER], MANUAL_STREAM_PROTOCOL);
    assert.match(res.headers['cache-control'], /no-transform/); assert.equal(res.headers['x-accel-buffering'], 'no');
    const body = status === 200 ? { saved: 'exact-request' } : { error: 'ACTUAL_REFUSAL', fields: { card: 'Review' } };
    release(Response.json(body, { status })); await pending;
    const result = readManualResponse(res.asFetch());
    if (status === 200) assert.deepEqual(await result, body);
    else await assert.rejects(result, error => error.status === status && error.fields.card === 'Review');
    assert.equal(calls, 1); assert.equal(req.listenerCount('aborted'), 0); assert.equal(res.listenerCount('close'), 0);
  }
});

test('a slow timeout is terminal504, while disconnect clears liveness and aborts only its single transport', async () => {
  let signal, calls = 0;
  const proxy = createManualServiceProxy({ ...options, timeoutMs: 25, fetchImpl: (_url, init) => {
    calls++; signal = init.signal; return new Promise(() => {});
  } });
  const first = response(); await proxy(request(), first);
  await assert.rejects(readManualResponse(first.asFetch()), { status: 504, code: 'MANUAL_SERVICE_TIMEOUT' });
  assert.equal(signal.aborted, true); assert.equal(calls, 1);
  const req = request(), second = response(), pending = proxy(req, second);
  await once(second, 'chunk'); second.destroyed = true; second.emit('close'); await pending;
  const count = second.chunks.length; await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(second.chunks.length, count); assert.equal(second.writableEnded, undefined);
  assert.equal(signal.aborted, true); assert.equal(calls, 2);
  assert.equal(req.listenerCount('aborted'), 0); assert.equal(second.listenerCount('close'), 0);
});

test('request refusal stays before heartbeat and invalid upstream JSON cannot become streamed success', async () => {
  let calls = 0;
  const invalid = request(); invalid.headers['x-atlas-csrf'] = '';
  const refused = response(); await createManualServiceProxy({ ...options, fetchImpl() { calls++; } })(invalid, refused);
  assert.equal(calls, 0); assert.equal(refused.headers[MANUAL_STREAM_HEADER], undefined);
  assert.equal(refused.statusCode, 403);
  let release; const held = new Promise(resolve => { release = resolve; }), res = response();
  const pending = createManualServiceProxy({ ...options, fetchImpl: () => held })(request(), res);
  await once(res, 'chunk'); release(new Response('not JSON', { headers: { 'Content-Type': 'application/json' } })); await pending;
  await assert.rejects(readManualResponse(res.asFetch()), { status: 502, code: 'MANUAL_SERVICE_RESPONSE_INVALID' });
});

test('actual HTTP response sends a heartbeat before upstream completion and carries one parseable terminal refusal', async t => {
  let release;
  const upstream = new Promise(resolve => { release = resolve; });
  const proxy = createManualServiceProxy({ ...options, fetchImpl: () => upstream });
  const server = createServer(async (req, res) => {
    req.body = {}; req.headers.origin = 'https://atlasgrading.com'; req.headers['x-atlas-csrf'] = 'csrf';
    res.status = status => { res.statusCode = status; return res; };
    res.send = bytes => res.end(bytes); res.json = body => res.end(JSON.stringify(body));
    await proxy(req, res);
  });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); assert.equal(server.listening, false); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const reply = await fetch(`http://127.0.0.1:${server.address().port}/api/staff/manual-intake/cards`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  assert.equal(reply.status, 200); assert.equal(reply.headers.get(MANUAL_STREAM_HEADER), MANUAL_STREAM_PROTOCOL);
  const reader = reply.body.getReader(), first = await reader.read(); assert.equal(new TextDecoder().decode(first.value), '\n');
  release(Response.json({ error: 'MANUAL_DETAILS_STALE' }, { status: 409 }));
  const chunks = [first.value]; for (;;) { const next = await reader.read(); if (next.done) break; chunks.push(next.value); }
  reader.releaseLock();
  await assert.rejects(readManualResponse(new Response(Buffer.concat(chunks), { status: reply.status, headers: reply.headers })),
    { status: 409, code: 'MANUAL_DETAILS_STALE' });
});
