import test from 'node:test';
import assert from 'node:assert/strict';
import { createAstraDefectProvider, RESPONSE_ENDPOINT } from '../src/provider.mjs';
import { preparedFixture, responseFixture } from './fixtures.mjs';
import { LIMITS } from '../src/index.mjs';

const apiKey = 'sk-offline_fixture_key_1234567890123456';
test('provider uses exact request bytes once, fixed endpoint/model, no ambient credentials or retry', async () => {
  const prepared = preparedFixture(); let calls = 0;
  const provider = createAstraDefectProvider({ apiKey, projectId: 'proj_fixture12345', fetchImpl: async (url, options) => {
    calls++; assert.equal(url, RESPONSE_ENDPOINT); assert.equal(options.body, prepared.requestText); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, `Bearer ${apiKey}`); assert.equal(options.headers['OpenAI-Project'], 'proj_fixture12345');
    assert.equal(options.headers['X-Client-Request-Id'], prepared.evidence.analysisId);
    return new Response(JSON.stringify(responseFixture(prepared.evidence)), { headers: { 'content-type': 'application/json', 'x-request-id': 'req_fixture' } });
  } });
  const result = await provider.dispatch(prepared); assert.equal(result.state, 'RECEIVED'); assert.equal(result.providerRequestId, 'req_fixture');
  assert(result.bytes.length > 0); await assert.rejects(provider.dispatch(prepared), { code: 'DEFECT_ANALYSIS_ALREADY_DISPATCHED' }); assert.equal(calls, 1);
});

test('timeout after possible dispatch is UNKNOWN and does not create a second paid request', async () => {
  const prepared = preparedFixture(); let calls = 0;
  const provider = createAstraDefectProvider({ apiKey, timeoutMs: 10, fetchImpl: () => { calls++; return new Promise(() => {}); } });
  const result = await provider.dispatch(prepared); assert.equal(result.state, 'UNKNOWN'); assert.equal(calls, 1);
  await assert.rejects(provider.dispatch(prepared), { code: 'DEFECT_ANALYSIS_ALREADY_DISPATCHED' }); assert.equal(calls, 1);
});

test('a never-ending body read is bounded, with safe observed provider identity retained', async () => {
  const provider = createAstraDefectProvider({ apiKey, timeoutMs: 10, fetchImpl: async () => new Response(new ReadableStream({ start() {} }),
    { headers: { 'x-request-id': 'req_body_timeout' } }) });
  const result = await provider.dispatch(preparedFixture()); assert.equal(result.state, 'UNKNOWN'); assert.equal(result.providerRequestId, 'req_body_timeout');
});

test('complete HTTP error bodies remain available for immutable evidence and accounting', async () => {
  let calls = 0; const bytes = '{"error":{"message":"fixture"},"usage":null}';
  const provider = createAstraDefectProvider({ apiKey, fetchImpl: async () => { calls++; return new Response(bytes, { status: 429, headers: { 'content-type': 'application/json' } }); } });
  const result = await provider.dispatch(preparedFixture()); assert.equal(result.state, 'RECEIVED'); assert.equal(result.httpStatus, 429);
  assert.equal(result.bytes.toString(), bytes); assert.equal(calls, 1);
});

test('aborted or expired before dispatch never calls fetch', async () => {
  let calls = 0; const provider = createAstraDefectProvider({ apiKey, fetchImpl: async () => { calls++; return new Response(); } });
  const controller = new AbortController(); controller.abort(); const prepared = preparedFixture();
  await assert.rejects(provider.dispatch(prepared, { signal: controller.signal }));
  await assert.rejects(provider.dispatch(prepared, { deadlineMs: Date.now() - 1 }), { code: 'DEFECT_ANALYSIS_REQUEST_EXPIRED' }); assert.equal(calls, 0);
});

test('oversized and invalid provider response headers stop without retaining unbounded body', async () => {
  for (const response of [new Response('x', { headers: { 'content-length': String(LIMITS.responseBytes + 1) } }),
    new Response('x', { headers: { 'x-request-id': 'bad request id' } }), new Response('x'.repeat(LIMITS.responseBytes + 1))]) {
    const provider = createAstraDefectProvider({ apiKey, fetchImpl: async () => response });
    assert.equal((await provider.dispatch(preparedFixture())).state, 'UNKNOWN');
  }
});
