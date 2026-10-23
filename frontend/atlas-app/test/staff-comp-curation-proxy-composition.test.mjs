import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { routeEnvelope } from '@atlas/site-router/routes';
import { requireThat, canonical } from '@atlas/manual-service/contract';
import { createManualServiceProxy, createPrivateManualNonceStore } from '../../../packages/atlas-connected-manual/src/transport.mjs';
import { assertProductionStaffRequest } from '../lib/server/access/config.mjs';
import { createStaffCompCurationProxyComposition, createStaffCompCurationPrivateAdapter } from '../lib/server/staff-comp-curation-proxy-composition.mjs';
import { createStaffCompCurationResponseTransport } from '../lib/staff-comp-curation-response-transport.mjs';
import { createStaffCompCurationController } from '../lib/staff-comp-curation-controller.mjs';
import { compTransportRoute } from '../lib/staff-comp-curation-transport-contract.mjs';
import { curationFixture, deferred } from './staff-comp-curation-fixture.mjs';

async function fixture() {
  const f = await curationFixture(), hooks = {}, key = Buffer.alloc(32, 22), wireRequests = [], frontendReplies = [];
  let actor = f.staff, calls = 0;
  const auth = { async authenticate(cookie, csrf) {
    calls++; await hooks.auth?.(calls); requireThat(actor && cookie === 'synthetic=session', 401, 'SIGN_IN_REQUIRED');
    if (csrf !== undefined) requireThat(csrf === 'synthetic-csrf', 403, 'CSRF_REQUIRED'); return actor;
  } };
  const config = { mode: 'PRODUCTION', origin: 'https://atlasgrading.com', basePath: '/admin', application: 'atlas-staff',
    deploymentId: 'synthetic-comp.vercel.app', routerKey: Buffer.alloc(32, 13) };
  const store = createPrivateManualNonceStore(), nonceStore = { async consume(...args) { await hooks.nonce?.(...args); return store.consume(...args); } };
  const nativeOptions = { enabled: true, key, origin: config.origin, nonceStore,
    native: { environment: {}, auth, ...Object.fromEntries(['boundary', 'approved', 'artifacts', 'validateAccess'].map(name => [name, f.options[name]])) } };
  const native = createStaffCompCurationPrivateAdapter(nativeOptions);
  async function invoke(handler, req) {
    let status, payload; const headers = new Headers({ 'content-type': 'application/json' });
    const res = { setHeader(k, v) { headers.set(k, v); }, status(n) { status = n; return this; }, json(v) { payload = v; return this; } };
    const handled = await handler(req, res); return { status, payload, headers, handled };
  }
  const proxyOptions = { enabled: true, auth, origin: config.origin, privateOrigin: 'https://synthetic-private.atlasgrading.com', key,
    staffKeys: [Buffer.alloc(32, 11), Buffer.alloc(32, 12), config.routerKey], assertRequest(req) { assertProductionStaffRequest(req, config); },
    async fetchImpl(url, options) {
      const u = new URL(url); assert.equal(u.origin, proxyOptions.privateOrigin);
      const req = { method: options.method, url: u.pathname + u.search, headers: { ...options.headers }, rawBody: Buffer.from(options.body ?? '') };
      wireRequests.push(req); await hooks.private?.(req);
      const r = await invoke(native.handler, req); await hooks.reply?.(r);
      return new Response(JSON.stringify(r.payload), { status: r.status, headers: r.headers });
    } };
  const proxy = createStaffCompCurationProxyComposition(proxyOptions);
  async function publicRequest({ method = 'GET', path, body }, extra = {}) {
    const issuedAt = Date.now(), target = path.startsWith('/admin/') ? path : `/admin${path}`;
    const proof = createHmac('sha256', config.routerKey).update(routeEnvelope({ zone: 'staff', deployment: `https://${config.deploymentId}`, method, target, issuedAt })).digest('hex');
    const req = { method, url: path, body: body ?? '', headers: { host: 'atlasgrading.com', 'x-forwarded-host': 'atlasgrading.com', 'x-forwarded-proto': 'https',
      cookie: 'synthetic=session', 'x-atlas-route-issued': String(issuedAt), 'x-atlas-route-target': target, 'x-atlas-route-proof': proof,
      ...(method === 'POST' ? { origin: config.origin, 'content-type': 'application/json', 'x-atlas-csrf': 'synthetic-csrf' } : {}), ...extra } };
    const reply = await invoke(proxy.handler, req); frontendReplies.push(reply); return reply;
  }
  const readPath = `/api/staff/comp-curation/cards/${f.cardId}?approvalActionId=${f.actionId}&previewId=${f.previewId}`;
  const decisionPath = `/api/staff/comp-curation/cards/${f.cardId}/decision`;
  const browser = createStaffCompCurationResponseTransport({ enabled: true, staff: f.staff, async fetchImpl(path, options) {
    assert.equal(options.credentials, 'same-origin'); assert.equal(options.cache, 'no-store'); assert.equal(options.redirect, 'error');
    if (path === '/admin/api/staff/session') return new Response(JSON.stringify({ mode: actor?.mode, staff: actor, csrf: 'synthetic-csrf' }),
      { headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' } });
    const result = await publicRequest({ method: options.method, path, ...(options.body ? { body: JSON.parse(options.body) } : {}) });
    return new Response(JSON.stringify(result.payload), { status: result.status, headers: result.headers });
  } });
  return { ...f, hooks, native, nativeOptions, proxy, proxyOptions, publicRequest, invoke, readPath, decisionPath, wireRequests, frontendReplies, browser,
    get authCalls() { return calls; }, setActor(value) { actor = value; }, decision: () => f.input({ outcome: 'SKIP', selectedIds: [], reviewedIds: [], expectedPolicyHash: null }) };
}

test('default-off adapters touch no capability; strict aliases cannot register or widen routes', () => {
  const absent = new Proxy({}, { get(_value, key) { assert.equal(key, 'enabled'); return undefined; } });
  for (const factory of [createStaffCompCurationProxyComposition, createStaffCompCurationPrivateAdapter, createStaffCompCurationResponseTransport]) assert.equal(factory(absent), null);
  const card = randomUUID(), approval = randomUUID(), path = `/api/staff/comp-curation/cards/${card}?approvalActionId=${approval}&previewId=none`;
  const route = compTransportRoute(path); assert.equal(compTransportRoute(route.privatePath, { privateAlias: true }).path, path);
  for (const value of [path + '&previewId=none', path + '&actorId=' + card, path.replace(card, '../' + card), path.replace(card, encodeURIComponent('/' + card)),
    route.privatePath, '/api/staff/manual-connected/cards/' + card + '/presentation/search', path + '#x', 'https://atlasgrading.com' + path]) assert.equal(compTransportRoute(value), null);
});

test('actual browser Response→signed ingress→private HMAC/native→service/controller chain preserves private choices', async () => {
  const f = await fixture(), before = canonical({ report: f.row, market: f.market, packet: f.packet });
  const controller = createStaffCompCurationController({ staff: f.staff, cardId: f.cardId, input: { approvalActionId: f.actionId, previewId: f.previewId }, request: f.browser.request });
  assert.equal((await controller.load()).availability, 'POLICY_REQUIRED');
  const requestId = randomUUID(); const receipt = await controller.decide({ requestId, outcome: 'SKIP' });
  assert.equal(receipt.requestId, requestId); assert.equal(receipt.guidance, null); assert.equal(f.calls.insert, 1);
  assert.equal(f.wireRequests.length, 2); assert(f.wireRequests.every(req => req.url.includes('/comp-curation')));
  assert(f.wireRequests.every(req => !('authorization' in req.headers) && !('x-atlas-route-proof' in req.headers)));
  assert.equal(canonical({ report: f.row, market: f.market, packet: f.packet }), before);
  f.browser.close(); f.proxy.close(); f.native.close();
});

test('native alias admission binds exact method/path/query/body and consumes nonce once before mapping', async () => {
  const f = await fixture(); assert.equal((await f.publicRequest({ path: f.readPath })).status, 200);
  const original = f.wireRequests[0], replay = await f.invoke(f.native.handler, original);
  assert.equal(replay.status, 409); assert.equal(replay.payload.error, 'MANUAL_PRIVATE_REQUEST_REPLAYED');
  for (const change of [req => { req.url = req.url.replace('previewId=', 'previewId=x'); }, req => { req.rawBody = Buffer.from('{}'); },
    req => { req.url = req.url.replace(/previewId=[^&]+/, `previewId=${randomUUID()}`); },
    req => { req.headers.cookie = 'different=session'; }, req => { req.headers['x-atlas-manual-signature'] = '0'.repeat(64); }]) {
    const next = await fixture(); next.hooks.private = change;
    const denied = await next.publicRequest({ path: next.readPath }); assert.notEqual(denied.status, 200); assert.equal(next.calls.access, 0); assert.equal(next.calls.insert, 0);
  }
  assert.equal((await f.invoke(f.native.handler, { ...original, url: f.readPath })).handled, false);
});

test('existing signer binds noncanonical JSON raw bytes before mapping and ignores a spoofed parsed body', async () => {
  async function signed(f, input) {
    const direct = createManualServiceProxy({ origin: f.proxyOptions.privateOrigin, key: f.proxyOptions.key, fetchImpl: f.proxyOptions.fetchImpl });
    const raw = Buffer.from('  {\n' + Object.entries(input).reverse().map(([key, value]) => `  ${JSON.stringify(key)} : ${JSON.stringify(value)}`).join(',\n') + '\n}  ');
    const route = compTransportRoute(f.decisionPath); let status, payload; const headers = {};
    await direct({ method: 'POST', url: route.privatePath, headers: { cookie: 'synthetic=session', origin: f.proxyOptions.origin,
      'content-type': 'application/json', 'x-atlas-csrf': 'synthetic-csrf' }, body: raw },
    { setHeader(k, v) { headers[k] = v; }, status(n) { status = n; return this; }, send(bytes) { payload = JSON.parse(bytes); }, json(value) { payload = value; } });
    return { status, payload, raw };
  }
  const f = await fixture(), input = f.decision(); f.hooks.private = req => { req.body = { ...input, requestId: randomUUID(), outcome: 'NO_SUITABLE_COMPS' }; };
  const reply = await signed(f, input); assert.equal(reply.status, 200); assert.equal(reply.payload.result.requestId, input.requestId);
  assert.equal(reply.payload.result.outcome, 'SKIP'); assert(f.wireRequests[0].rawBody.equals(reply.raw)); assert.equal(f.calls.insert, 1);
  const other = await fixture(); other.hooks.private = req => { req.rawBody = Buffer.concat([req.rawBody, Buffer.from(' ')]); };
  const denied = await signed(other, other.decision()); assert.equal(denied.status, 401); assert.equal(denied.payload.error, 'MANUAL_PRIVATE_SIGNATURE_INVALID');
  assert.equal(other.calls.access, 0); assert.equal(other.calls.insert, 0);
});

test('original signed request changed during observed nonce await is refused before any native auth', async () => {
  for (const change of [req => { req.url += '&extra=1'; }, req => { req.headers.cookie = 'changed'; }, req => { req.rawBody = Buffer.from('x'); }]) {
    const f = await fixture(), entered = deferred(), resume = deferred();
    f.hooks.nonce = async () => { entered.resolve(); await resume.promise; };
    const pending = f.publicRequest({ path: f.readPath }); await entered.promise;
    try { assert.equal(f.authCalls, 1); change(f.wireRequests[0]); } finally { resume.resolve(); }
    const reply = await pending; assert.equal(reply.status, 503); assert.equal(f.calls.access, 0); assert.equal(f.calls.insert, 0);
  }
});

test('private success stays buffered across final frontend auth; changed actor or capability yields no private body', async () => {
  for (const change of [f => f.setActor({ ...f.staff, id: randomUUID() }), f => { f.proxyOptions.fetchImpl = async () => {}; }]) {
    const f = await fixture(), entered = deferred(), resume = deferred();
    f.hooks.auth = async n => { if (n === 4) { entered.resolve(); await resume.promise; } };
    const pending = f.publicRequest({ method: 'POST', path: f.decisionPath, body: f.decision() });
    await entered.promise; assert.equal(f.calls.insert, 1); assert.equal(f.frontendReplies.length, 0);
    change(f); resume.resolve(); const reply = await pending;
    assert([401, 503].includes(reply.status)); assert.deepEqual(Object.keys(reply.payload), ['error']); assert.equal(f.calls.insert, 1);
  }
});

test('existing proxy heartbeat remains private and final response shape stays ordinary JSON', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const f = await fixture(), entered = deferred(), resume = deferred();
  f.hooks.reply = async () => { entered.resolve(); await resume.promise; };
  const pending = f.publicRequest({ method: 'POST', path: f.decisionPath, body: f.decision() });
  await entered.promise; t.mock.timers.tick(15000); assert.equal(f.frontendReplies.length, 0);
  resume.resolve(); const reply = await pending; assert.equal(reply.status, 200); assert.equal(reply.payload.result.outcome, 'SKIP');
  assert(!reply.headers.has('x-atlas-manual-stream')); assert.equal(f.calls.insert, 1);
});

test('unknown reply does not replay; exact controller retry keeps original request ID', async () => {
  const f = await fixture(), controller = createStaffCompCurationController({ staff: f.staff, cardId: f.cardId,
    input: { approvalActionId: f.actionId, previewId: f.previewId }, request: f.browser.request });
  await controller.load(); const id = randomUUID(); let lost = false;
  f.hooks.reply = () => { if (!lost && f.calls.insert === 1) { lost = true; throw new Error('synthetic lost response'); } };
  await controller.decide({ requestId: id, outcome: 'SKIP' }); assert.equal(controller.snapshot().phase, 'UNRESOLVED'); assert.equal(f.calls.insert, 1);
  assert.equal(f.wireRequests.filter(req => req.method === 'POST').length, 1);
  await controller.retry(); assert.equal(controller.snapshot().phase, 'CONFIRMED'); assert.equal(controller.snapshot().receipt.requestId, id);
  assert.equal(f.calls.insert, 1); assert.equal(f.wireRequests.filter(req => req.method === 'POST').length, 2);
});

test('guard/CSRF/key/configuration refusal and unrelated routes cause no private dispatch', async () => {
  const f = await fixture();
  for (const extra of [{ 'x-atlas-route-proof': undefined }, { authorization: 'Bearer synthetic' }])
    assert.equal((await f.publicRequest({ path: f.readPath }, extra)).status, 403);
  assert.equal((await f.publicRequest({ method: 'POST', path: f.decisionPath, body: f.decision() }, { 'x-atlas-csrf': 'wrong' })).status, 403);
  for (const assertRequest of [() => true, async () => {}]) {
    const p = createStaffCompCurationProxyComposition({ ...f.proxyOptions, assertRequest });
    assert.equal((await f.invoke(p.handler, { method: 'GET', url: f.readPath, headers: {}, body: '' })).status, 503);
  }
  assert.throws(() => createStaffCompCurationProxyComposition({ ...f.proxyOptions, key: f.proxyOptions.staffKeys[0] }));
  assert.throws(() => createStaffCompCurationProxyComposition({ ...f.proxyOptions, privateOrigin: 'https://evil.invalid' }));
  assert.equal((await f.publicRequest({ path: `/api/staff/manual-connected/cards/${f.cardId}/presentation/search` })).handled, false);
  assert.equal(f.wireRequests.length, 0); assert.equal(f.calls.insert, 0);
});
