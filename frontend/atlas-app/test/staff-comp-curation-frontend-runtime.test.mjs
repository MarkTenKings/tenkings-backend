import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { routeEnvelope } from '@atlas/site-router/routes';
import { requireThat } from '@atlas/manual-service/contract';
import { createPrivateManualNonceStore } from '../../../packages/atlas-connected-manual/src/transport.mjs';
import { assertProductionStaffRequest, makeAccessConfig, ACCESS_COOKIES } from '../lib/server/access/config.mjs';
import { createStaffCompCurationPrivateAdapter } from '../lib/server/staff-comp-curation-private-adapter.mjs';
import { createStaffCompCurationFrontendRuntime, isStaffCompCurationPublicPath, isStaffCompCurationPrivateAlias } from '../lib/server/staff-comp-curation-frontend-runtime.mjs';
import { curationFixture, deferred } from './staff-comp-curation-fixture.mjs';

function response() {
  return { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; },
    status(n) { this.statusCode = n; return this; }, json(v) { this.body = v; return this; } };
}
async function fixture() {
  const f = await curationFixture(), hooks = {}, wire = [], key = Buffer.alloc(32, 22);
  const config = makeAccessConfig({ mode: 'PRODUCTION', origin: 'https://atlasgrading.com', basePath: '/admin',
    deploymentId: 'synthetic-comp.vercel.app', releaseSha: 'a'.repeat(40), databaseUrl: 'postgresql://not-connected',
    accountSid: 'AC' + '1'.repeat(32), serviceSid: 'VA' + '2'.repeat(32), providerLifetimeMs: 600000,
    sessionKey: Buffer.alloc(32, 11), phoneKey: Buffer.alloc(32, 12), routerKey: Buffer.alloc(32, 13),
    approvedPhones: new Set(), cookies: ACCESS_COOKIES });
  let actor = f.staff, authCalls = 0;
  const auth = { config, async authenticate(cookie, csrf) {
    await hooks.auth?.(++authCalls); requireThat(actor && cookie === 'synthetic=session', 401, 'SIGN_IN_REQUIRED');
    if (csrf !== undefined) requireThat(csrf === 'synthetic-csrf', 403, 'CSRF_REQUIRED'); return actor;
  } };
  const native = createStaffCompCurationPrivateAdapter({ enabled: true, key, origin: config.origin, nonceStore: createPrivateManualNonceStore(),
    native: { environment: {}, auth, ...Object.fromEntries(['boundary', 'approved', 'artifacts', 'validateAccess'].map(name => [name, f.options[name]])) } });
  const env = { ATLAS_STAFF_COMP_CURATION: '1', ATLAS_MANUAL_ENABLED: 'true', ATLAS_MANUAL_SERVICE_ORIGIN: 'https://synthetic-private.atlasgrading.com',
    ATLAS_MANUAL_SERVICE_KEY: key.toString('base64') };
  const options = { env, auth, staffConfig: config, assertRequest(req) { assertProductionStaffRequest(req, config); },
    async fetchImpl(url, init) {
      const u = new URL(url); assert.equal(u.origin, env.ATLAS_MANUAL_SERVICE_ORIGIN);
      const req = { method: init.method, url: u.pathname + u.search, headers: { ...init.headers }, rawBody: Buffer.from(init.body ?? '') };
      wire.push(req); await hooks.fetch?.(); const out = response(); await native.handler(req, out);
      return new Response(JSON.stringify(out.body), { status: out.statusCode, headers: { 'content-type': 'application/json', ...out.headers } });
    } };
  const runtime = createStaffCompCurationFrontendRuntime(options); assert(runtime);
  const readPath = `/api/staff/comp-curation/cards/${f.cardId}?approvalActionId=${f.actionId}&previewId=${f.previewId}`;
  const decisionPath = `/api/staff/comp-curation/cards/${f.cardId}/decision`;
  function request(path = readPath, body) {
    const method = body ? 'POST' : 'GET', target = path.startsWith('/admin/') ? path : '/admin' + path, issuedAt = Date.now();
    const proof = createHmac('sha256', config.routerKey).update(routeEnvelope({ zone: 'staff', deployment: 'https://' + config.deploymentId, method, target, issuedAt })).digest('hex');
    return { url: path, method, body: body ?? '', headers: { host: 'atlasgrading.com', 'x-forwarded-host': 'atlasgrading.com', 'x-forwarded-proto': 'https',
      cookie: 'synthetic=session', 'x-atlas-route-issued': String(issuedAt), 'x-atlas-route-target': target, 'x-atlas-route-proof': proof,
      ...(body ? { origin: config.origin, 'content-type': 'application/json', 'x-atlas-csrf': 'synthetic-csrf' } : {}) } };
  }
  async function invoke(req = request()) { const out = response(); out.handled = await runtime.handler(req, out); return out; }
  return { ...f, options, env, config, auth, hooks, runtime, wire, invoke, request, readPath, decisionPath, native,
    get authCalls() { return authCalls; }, setActor(value) { actor = value; },
    decision: () => f.input({ outcome: 'SKIP', selectedIds: [], reviewedIds: [], expectedPolicyHash: null }),
    close() { runtime.close(); native.close(); } };
}

test('family recognition uses raw paths and reserves malformed private queries with either exact base path', () => {
  const id = randomUUID();
  for (const prefix of ['', '/admin']) {
    for (const suffix of ['', '/', '/cards/invalid', '?bad=%GG', '/cards/' + id + '/decision?extra=1'])
      assert(isStaffCompCurationPublicPath(prefix + '/api/staff/comp-curation' + suffix));
    for (const suffix of ['', '/decision', '?bad=%GG', '/decision?extra=1', '/unknown'])
      assert(isStaffCompCurationPrivateAlias(prefix + `/api/staff/manual-connected/cards/${id}/comp-curation` + suffix));
  }
  for (const value of [null, {}, '', '//api/staff/comp-curation', 'https://atlasgrading.com/api/staff/comp-curation',
    '/other/../api/staff/comp-curation', '/admin/admin/api/staff/comp-curation', '/api/staff/comp-curation-extra', '/api/staff/comp%2Dcuration'])
    assert.equal(isStaffCompCurationPublicPath(value), false);
  for (const value of ['/api/staff/comp-curation/cards/' + id, `/api/staff/manual-connected/cards/${id}/presentation/market`,
    `/api/staff/manual-connected/cards/${id}/comp-curation-extra`, '/admin/../api/staff/manual-connected/cards/x/comp-curation'])
    assert.equal(isStaffCompCurationPrivateAlias(value), false);
});

test('absent/exact disabled flag and malformed configuration return null without auth, ingress or fetch', async () => {
  for (const value of [undefined, null, {}, { env: {} }, ...[true, 'true', '0', '01', ' 1', 1].map(flag => ({ env: { ATLAS_STAFF_COMP_CURATION: flag } }))])
    assert.equal(createStaffCompCurationFrontendRuntime(value), null);
  const f = await fixture();
  const malformed = [o => { o.env.ATLAS_MANUAL_ENABLED = '1'; }, o => { o.env.ATLAS_MANUAL_SERVICE_ORIGIN += '/'; },
    o => { o.env.ATLAS_MANUAL_SERVICE_ORIGIN = 'https://outside.invalid'; }, o => { o.env.ATLAS_MANUAL_SERVICE_KEY += '\n'; },
    o => { o.env.ATLAS_MANUAL_SERVICE_KEY = o.staffConfig.sessionKey.toString('base64'); }, o => { o.auth = {}; },
    o => { o.assertRequest = null; }, o => { o.fetchImpl = 1; }, o => { o.staffConfig = { ...o.staffConfig, basePath: '/other' }; }];
  for (const mutate of malformed) { const o = { ...f.options, env: { ...f.env } }; mutate(o); assert.equal(createStaffCompCurationFrontendRuntime(o), null); }
  assert.equal(f.authCalls, 0); assert.equal(f.wire.length, 0); f.close();
});

test('configuration hint/construction stay pure; actual signed proxy→native/service read and Skip retain policy null', async () => {
  const f = await fixture(); assert.equal(f.runtime.configuredForDisplay, true); assert.equal(f.runtime.configuredForDisplay, true);
  assert.equal(f.authCalls, 0); assert.equal(f.wire.length, 0);
  const read = await f.invoke(f.request('/admin' + f.readPath)); assert.equal(read.statusCode, 200);
  assert.equal(read.body.result.availability, 'POLICY_REQUIRED');
  const input = f.decision(), saved = await f.invoke(f.request(f.decisionPath, input));
  assert.equal(saved.statusCode, 200); assert.equal(saved.body.result.requestId, input.requestId); assert.equal(saved.body.result.guidance, null);
  assert.equal(f.calls.insert, 1); assert.equal(f.wire.length, 2);
  assert.match(saved.headers['Cache-Control'], /private.*no-store/);
  f.close(); f.close(); assert.equal(f.runtime.configuredForDisplay, false);
  assert.equal((await f.invoke()).statusCode, 503); assert.equal(f.wire.length, 2);
});

test('unrelated/private routes never dispatch; malformed public routes remain unhandled for caller refusal', async () => {
  const f = await fixture();
  for (const path of ['/api/staff/session', `/api/staff/manual-connected/cards/${f.cardId}/comp-curation`, f.readPath + '&extra=1']) {
    const r = await f.invoke(f.request(path)); assert.equal(r.handled, false); assert.equal(r.body, undefined);
  }
  assert.equal(f.authCalls, 0); assert.equal(f.wire.length, 0); f.close();
});

test('real signed ingress, method, CSRF and synchronous guard contracts refuse before native dispatch', async () => {
  const f = await fixture();
  for (const mutate of [req => { req.headers['x-atlas-route-proof'] = '0'.repeat(64); }, req => { req.headers['x-atlas-csrf'] = 'wrong'; },
    req => { req.headers.origin = 'https://outside.invalid'; }]) {
    const req = f.request(f.decisionPath, f.decision()); mutate(req); const r = await f.invoke(req); assert.notEqual(r.statusCode, 200);
  }
  for (const req of [f.request(f.decisionPath), f.request(f.readPath, f.decision())])
    assert.equal((await f.invoke(req)).statusCode, 405);
  assert.equal(f.wire.length, 0); f.close();
  for (const guard of [() => true, async () => { throw Error('synthetic rejected guard'); }]) {
    const g = await fixture(); const rt = createStaffCompCurationFrontendRuntime({ ...g.options, assertRequest: guard }), out = response();
    await rt.handler(g.request(), out); assert.equal(out.statusCode, 503); assert.equal(g.authCalls, 0); assert.equal(g.wire.length, 0); rt.close(); g.close();
  }
});

test('current config/capability drift across observed initial auth prevents private dispatch', async () => {
  for (const mutate of [f => { f.env.ATLAS_STAFF_COMP_CURATION = '0'; }, f => { f.options.staffConfig = { ...f.config }; },
    f => { f.options.assertRequest = () => {}; }, f => { f.options.fetchImpl = async () => {}; },
    f => { f.auth.authenticate = async () => f.staff; }, f => { f.auth.config = { ...f.config }; },
    f => { f.config.routerKey[0] ^= 1; }, f => { f.env.ATLAS_MANUAL_SERVICE_KEY = Buffer.alloc(32, 23).toString('base64'); }]) {
    const f = await fixture(), entered = deferred(), resume = deferred();
    f.hooks.auth = async n => { if (n === 1) { entered.resolve(); await resume.promise; } };
    const pending = f.invoke(); await entered.promise; mutate(f); resume.resolve(); const r = await pending;
    assert.equal(r.statusCode, 503); assert.deepEqual(r.body, { error: 'COMP_NOT_CONFIGURED' });
    assert.equal(f.wire.length, 0); assert.equal(f.runtime.configuredForDisplay, false); f.close();
  }
});

test('private write response is buffered across actual final auth; drift does not retry or disclose receipt', async () => {
  for (const mutate of [f => { f.env.ATLAS_MANUAL_ENABLED = 'false'; }, f => { f.options.env = { ...f.env }; }, f => f.runtime.close()]) {
    const f = await fixture(), entered = deferred(), resume = deferred();
    f.hooks.auth = async n => { if (n === 4) { entered.resolve(); await resume.promise; } };
    const out = response(), pending = f.runtime.handler(f.request(f.decisionPath, f.decision()), out);
    await entered.promise; assert.equal(f.calls.insert, 1); assert.equal(out.body, undefined); mutate(f); resume.resolve(); await pending;
    assert.equal(out.statusCode, 503); assert.deepEqual(out.body, { error: 'COMP_NOT_CONFIGURED' }); assert.equal(f.wire.length, 1); f.close();
  }
});

test('current actor changes in final live auth refuse private output despite valid configuration', async () => {
  const f = await fixture(); f.hooks.auth = n => { if (n === 4) f.setActor({ ...f.staff, id: randomUUID() }); };
  const out = await f.invoke(f.request(f.decisionPath, f.decision()));
  assert.equal(out.statusCode, 401); assert.equal(out.body.error, 'SIGN_IN_REQUIRED'); assert.equal(f.calls.insert, 1); assert.equal(f.wire.length, 1); f.close();
});
