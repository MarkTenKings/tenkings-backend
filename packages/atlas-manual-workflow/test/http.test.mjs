import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkflowHandler } from '../src/http.mjs';
import { ManualServiceError } from '@atlas/manual-service/contract';

test('async host refusal is awaited before authentication, hydration or trace storage', async () => {
  let calls = 0;
  const forbidden = () => { calls++; throw new Error('must not run'); };
  const handler = createWorkflowHandler({ workflow: { service: {}, stageTrace: forbidden }, boundary: { authenticate: forbidden },
    origin: 'http://127.0.0.1:4318', assertRequest: async () => { await Promise.resolve(); throw new ManualServiceError(403, 'HOST_NOT_ALLOWED'); }, imageDescriptors: forbidden });
  const response = { setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  await handler({ url: '/api/staff/manual/cards/11111111-1111-4111-8111-111111111111/trace', method: 'POST', headers: {} }, response);
  assert.equal(response.code, 403); assert.equal(response.body.error, 'HOST_NOT_ALLOWED'); assert.equal(calls, 0);
});
test('absolute foreign-origin URL cannot reach authenticated view', async () => {
  let calls = 0;
  const handler = createWorkflowHandler({ workflow: { service: {} }, boundary: { authenticate() { calls++; } },
    origin: 'http://127.0.0.1:4318', assertRequest() {}, imageDescriptors() {} });
  const response = { setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  await handler({ url: 'https://foreign.example/api/staff/manual/cards/11111111-1111-4111-8111-111111111111/view', method: 'GET', headers: {} }, response);
  assert.equal(response.code, 400); assert.equal(calls, 0);
});
