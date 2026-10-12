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

test('view overlaps independent reads while retaining one authorized snapshot and waiting for all results', async () => {
  const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
  const hydrated = deferred(), approved = deferred(), imagesDone = deferred(), extrasDone = deferred();
  const calls = [], card = { cardId: '11111111-1111-4111-8111-111111111111', revision: 7 }, state = { geometry: {} }, staff = {};
  const response = { setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  const handler = createWorkflowHandler({ origin: 'http://127.0.0.1:4318', assertRequest() {},
    boundary: { async authenticate() { return staff; } },
    workflow: { service: { async read() { calls.push('card'); return card; }, async latestApproval() { calls.push('approval'); return approved.promise; } },
      async hydrate(input) { assert.equal(input, card); calls.push('hydrate'); return hydrated.promise; } },
    async imageDescriptors(input) { assert.equal(input.card, card); assert.equal(input.state, state); assert.equal(input.staff, staff); calls.push('images'); return imagesDone.promise; },
    async workspaceExtras(input) { assert.equal(input.card, card); assert.equal(input.state, state); calls.push('extras'); return extrasDone.promise; },
  });
  const pending = handler({ url: `/api/staff/manual/cards/${card.cardId}/view`, method: 'GET', headers: {} }, response);
  await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(calls, ['card', 'hydrate', 'approval']);
  hydrated.resolve(state); approved.resolve(null);
  await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(calls, ['card', 'hydrate', 'approval', 'images', 'extras']);
  imagesDone.resolve({ FRONT: {} }); await new Promise(resolve => setImmediate(resolve)); assert.equal(response.body, undefined);
  extrasDone.resolve({ astra: { status: 'IDLE' } }); await pending;
  assert.deepEqual(response.body, { card, ...state, images: { FRONT: {} }, approval: null, astra: { status: 'IDLE' } });
});

test('state view authenticates and reads only current verified core state without image, report or ancillary work', async () => {
  const cardId = '11111111-1111-4111-8111-111111111111', staff = {}, calls = [];
  const state = { card: { cardId, revision: 4 }, geometry: {}, defects: {}, identity: {} };
  const forbidden = () => { throw Error('Full view work must not run'); };
  const handler = createWorkflowHandler({ origin: 'http://127.0.0.1:4318', assertRequest() { calls.push('boundary'); },
    boundary: { async authenticate() { calls.push('authenticate'); return staff; } },
    workflow: { service: { read: forbidden, latestApproval: forbidden }, hydrate: forbidden,
      async readState(actor, id) { assert.equal(actor, staff); assert.equal(id, cardId); calls.push('state'); return state; } },
    imageDescriptors: forbidden, workspaceExtras: forbidden,
  });
  const response = { headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  await handler({ url: `/api/staff/manual/cards/${cardId}/view?scope=state`, method: 'GET', headers: {} }, response);
  assert.equal(response.code, 200); assert.equal(response.headers['Cache-Control'], 'no-store'); assert.deepEqual(response.body, state);
  assert.deepEqual(calls, ['boundary', 'authenticate', 'state']);
  for (const query of ['?scope=state&images=inspection', '?scope=unknown', '?scope=state&scope=state']) {
    calls.length = 0;
    await handler({ url: `/api/staff/manual/cards/${cardId}/view${query}`, method: 'GET', headers: {} }, response);
    assert.equal(response.code, 400); assert.deepEqual(calls, ['boundary']);
  }
});
