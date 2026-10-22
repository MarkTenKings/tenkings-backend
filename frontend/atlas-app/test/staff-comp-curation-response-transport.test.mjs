import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createStaffCompCurationResponseTransport } from '../lib/staff-comp-curation-response-transport.mjs';
import { createHandler } from '../lib/server/http.mjs';
import { deferred } from './staff-comp-curation-fixture.mjs';
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' } });
const cardId = randomUUID(), market = `/api/staff/manual-connected/cards/${cardId}/presentation/market`;
function fixture(fetchTarget) {
  const staff = { id: randomUUID(), role: 'REVIEWER', mode: 'SYNTHETIC' }, events = new EventTarget(), calls = [], hooks = {};
  let actor = staff, csrf = 'synthetic-csrf';
  // Exercise the existing HTTP session projection, including the intentional
  // top-level SYNTHETIC_LOCAL versus actor.SYNTHETIC local wire convention.
  const session = createHandler({ origin: 'http://localhost:4318', auth: { async bootstrap() {
    await hooks.session?.(); return { staff: actor, csrf, browserToken: 'synthetic' };
  } }, assertRequest() {}, clientAddress: () => 'synthetic' });
  const options = { enabled: true, staff, events, async fetchImpl(path, init) {
    calls.push({ path, init }); assert.equal(init.credentials, 'same-origin'); assert.equal(init.cache, 'no-store');
    assert.equal(init.redirect, 'error'); assert.equal(init.referrerPolicy, 'no-referrer');
    if (path !== '/admin/api/staff/session') return fetchTarget?.(path, init) ?? json({ state: 'NOT_REQUESTED' });
    let status, body; const headers = new Headers({ 'content-type': 'application/json' });
    await session({ method: 'GET', url: '/api/staff/session', headers: {}, socket: {} }, {
      setHeader(k, v) { headers.set(k, String(v)); }, status(v) { status = v; return this; }, json(v) { body = v; } });
    return new Response(JSON.stringify(body), { status, headers });
  } };
  const transport = createStaffCompCurationResponseTransport(options);
  return { staff, calls, events, options, transport, hooks, setActor(value) { actor = value; }, setCsrf(value) { csrf = value; } };
}

test('existing session wire and exact saved GET return a bounded private Response without an acquisition', async () => {
  const f = fixture(); const session = await f.transport.request({ method: 'GET', path: '/api/staff/session' });
  assert.equal((await session.json()).mode, 'SYNTHETIC_LOCAL');
  const response = await f.transport.request({ method: 'GET', path: market }); assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { state: 'NOT_REQUESTED' }); assert.match(response.headers.get('cache-control'), /private, no-store/);
  assert.equal(f.calls.length, 4); assert(f.calls.every(call => call.init.method === 'GET'));
  for (const path of [market + '?image=abc', market + '/search', market.replace('/market', '/select'), '/api/staff/auth/logout', '//foreign.invalid', 'https://foreign.invalid/'])
    await assert.rejects(f.transport.request({ method: 'GET', path }), { code: 'COMP_REQUEST_INVALID' });
  assert.equal(f.calls.length, 4); f.transport.close();
});

test('missing explicit fetch is unavailable and disabled never consults global fetch', () => {
  assert.equal(createStaffCompCurationResponseTransport(), null);
  assert.throws(() => createStaffCompCurationResponseTransport({ enabled: true, staff: { id: randomUUID(), role: 'REVIEWER', mode: 'SYNTHETIC' } }), { code: 'COMP_ACCESS_ENDED' });
});

test('foreign account or changed capability after target body prevents any private Response', async () => {
  for (const change of [f => f.setActor({ ...f.staff, id: randomUUID() }), f => { f.options.fetchImpl = () => {}; }, f => { f.options.staff = { ...f.staff }; }]) {
    const entered = deferred(), resume = deferred(); let f;
    f = fixture(async () => { entered.resolve(); await resume.promise; return json({ private: 'must not escape' }); });
    const read = f.transport.request({ method: 'GET', path: market }); await entered.promise; change(f); resume.resolve();
    await assert.rejects(read, { code: 'COMP_ACCESS_ENDED' }); assert.equal(f.transport.assertScope(f.staff), false);
  }
});

test('invalid in-place actor plus assertScope immediately aborts an observed stalled body', async () => {
  let cancelled = 0, targetSignal; const entered = deferred();
  const f = fixture(async (_path, init) => { targetSignal = init.signal; return new Response(new ReadableStream({
    pull() { entered.resolve(); return new Promise(() => {}); }, cancel() { cancelled++; },
  }), { headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' } }); });
  const read = f.transport.request({ method: 'GET', path: market }); await entered.promise;
  delete f.staff.role; assert.equal(f.transport.assertScope(f.staff), false); assert.equal(targetSignal.aborted, true);
  await assert.rejects(read, { code: 'COMP_ACCESS_ENDED' }); assert.equal(cancelled, 1);
});

test('pagehide cancels unresolved fetch and rejects late private data without another dispatch', async () => {
  const entered = deferred(), resume = deferred(); let cancelled = 0, targetSignal;
  const f = fixture(async (_path, init) => { targetSignal = init.signal; entered.resolve(); await resume.promise;
    return new Response(new ReadableStream({ cancel() { cancelled++; } }), { headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' } }); });
  const read = f.transport.request({ method: 'GET', path: market }); await entered.promise;
  f.events.dispatchEvent(new Event('pagehide')); await assert.rejects(read, { code: 'COMP_ACCESS_ENDED' }); assert.equal(targetSignal.aborted, true);
  resume.resolve(); await new Promise(resolve => setImmediate(resolve)); assert.equal(cancelled, 1); assert.equal(f.calls.length, 2);
});

test('deadline settles a genuinely entered noncompliant transport; abort settles a stalled body', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const entered = deferred(), f = fixture(() => { entered.resolve(); return new Promise(() => {}); });
  const read = f.transport.request({ method: 'GET', path: market }); await entered.promise; assert.equal(f.calls.length, 2);
  t.mock.timers.tick(25000); await assert.rejects(read, { code: 'COMP_CANCELLED' }); assert.equal(f.calls.length, 2);
  let cancelled = 0; const bodyEntered = deferred(), other = fixture(() => new Response(new ReadableStream({
    pull() { bodyEntered.resolve(); return new Promise(() => {}); }, cancel() { cancelled++; },
  }), { headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' } }));
  const controller = new AbortController(), pending = other.transport.request({ method: 'GET', path: market, signal: controller.signal });
  await bodyEntered.promise; controller.abort(); await assert.rejects(pending, { code: 'COMP_CANCELLED' }); assert.equal(cancelled, 1);
});

test('actual CSRF is attached once; changed final CSRF after a write refuses without replay', async () => {
  let f, posts = 0;
  f = fixture((_path, init) => { posts++; assert.equal(init.method, 'POST'); assert.equal(init.headers['X-Atlas-Csrf'], 'synthetic-csrf');
    f.setCsrf('new-session-csrf'); return json({ error: 'COMP_SOURCE_CHANGED' }, 409); });
  const input = { requestId: randomUUID(), approvalActionId: randomUUID(), expectedSelectionRevision: 0, previewId: null,
    expectedPreviewHash: null, outcome: 'SKIP', selectedIds: [], reviewedIds: [], expectedPolicyHash: null };
  await assert.rejects(f.transport.request({ method: 'POST', path: `/api/staff/comp-curation/cards/${cardId}/decision`, body: input }), { code: 'COMP_ACCESS_ENDED' });
  assert.equal(posts, 1); assert.equal(f.calls.length, 3);
});

test('401/403 clear scope; overflowing or invalid response remains unavailable', async () => {
  for (const status of [401, 403]) {
    const f = fixture(() => json({ error: 'SIGN_IN_REQUIRED' }, status));
    await assert.rejects(f.transport.request({ method: 'GET', path: market }), { code: 'COMP_ACCESS_ENDED' }); assert.equal(f.transport.assertScope(f.staff), false);
  }
  for (const response of [() => new Response('{}', { headers: { 'content-type': 'application/json' } }),
    () => new Response(new Uint8Array(2097153), { headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' } }),
    () => json({ error: 'wrong', private: 'never' }, 409)]) {
    const f = fixture(response); await assert.rejects(f.transport.request({ method: 'GET', path: market }), { code: 'COMP_UNAVAILABLE' });
  }
});
