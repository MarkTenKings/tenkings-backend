import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { routeEnvelope } from '@atlas/site-router/routes';
import { canonical } from '@atlas/manual-service/contract';
import { createStaffCompCurationHandler } from '../lib/server/staff-comp-curation-http.mjs';
import { assertProductionStaffRequest } from '../lib/server/access/config.mjs';
import { deferred, httpFixture } from './staff-comp-curation-fixture.mjs';

test('actual saved service → private HTTP read/decide; exact replay and protected documents unchanged', async () => {
  const f = await httpFixture(), before = canonical({ publication: f.row, market: f.market, packet: f.packet });
  const read = await f.request({ method: 'GET', path: f.readPath });
  assert.equal(read.status, 200); assert.match(read.headers.get('cache-control'), /private, no-store/);
  const state = (await read.json()).result; assert.equal(state.revision, 0); assert.equal(state.preview.candidates.length, 3);
  const input = f.input();
  const save = await f.request({ method: 'POST', path: f.decisionPath, body: input });
  assert.equal(save.status, 200); const body = await save.json();
  assert.equal(body.staff.id, f.actorId); assert.equal(body.result.guidance.meanMinor, 2000);
  assert.equal(body.result.guidance.listingPrice, null); assert.equal(body.result.policy.rightsStatus, 'UNRESOLVED');
  const replay = await f.request({ method: 'POST', path: f.decisionPath, body: input });
  assert.deepEqual(await replay.json(), body); assert.equal(f.calls.insert, 1);
  assert.equal(canonical({ publication: f.row, market: f.market, packet: f.packet }), before);
  assert.equal(f.authCalls, 6); assert.equal(f.guardCalls, 9);
});
test('strict routes/methods/GET framing; framework empty GET forms work and never decide', async () => {
  const f = await httpFixture();
  for (const body of [undefined, '', {}, Buffer.alloc(0)]) assert.equal((await f.request({ method: 'GET', path: f.readPath }, { body })).status, 200);
  for (const [change, status] of [[{ body: { actorId: f.actorId } }, 400], [{ body: 'x' }, 400],
    [{ headers: { cookie: 'fixture=session', 'content-length': '1' } }, 400], [{ headers: { 'transfer-encoding': 'chunked' } }, 400],
    [{ rawBody: Buffer.from('x') }, 400], [{ readableLength: 1 }, 400]]) {
    assert.equal((await f.request({ method: 'GET', path: f.readPath }, change)).status, status);
  }
  for (const path of [f.readPath + '&actorId=' + f.actorId, f.readPath + '&previewId=none', f.readPath.replace(f.cardId, '../x')])
    assert.notEqual((await f.request({ method: 'GET', path })).status, 200);
  assert.equal((await f.request({ method: 'GET', path: f.decisionPath })).status, 405);
  assert.equal(f.calls.insert, 0);
});
test('POST requires exact input, real cookie/CSRF/origin; configured server capability cannot drift', async () => {
  const f = await httpFixture(), input = f.input();
  for (const extra of [{ actorId: f.actorId }, { priceMinor: 1 }, { policy: {} }])
    assert.equal((await f.request({ method: 'POST', path: f.decisionPath, body: { ...input, ...extra } })).status, 400);
  for (const headers of [{ cookie: 'fixture=session', 'content-type': 'application/json', origin: f.options.origin },
    { cookie: 'fixture=session', 'content-type': 'application/json', origin: 'https://foreign.invalid', 'x-atlas-csrf': 'fixture-csrf' }])
    assert.equal((await f.request({ method: 'POST', path: f.decisionPath, body: input }, { headers })).status, 403);
  f.options.service = {}; assert.equal((await f.request({ method: 'GET', path: f.readPath })).status, 503); assert.equal(f.calls.insert, 0);
  let status, payload; const res = { setHeader() {}, status(v) { status = v; return this; }, json(v) { payload = v; } };
  await createStaffCompCurationHandler()({}, res); assert.equal(status, 503); assert.equal(payload.error, 'COMP_NOT_CONFIGURED');
});
test('latest pending approval, revoked ACL and account change refuse; post-commit refusal never asserts rollback', async () => {
  const f = await httpFixture(); f.row.state = 'PENDING';
  assert.equal((await f.request({ method: 'GET', path: f.readPath })).status, 409);
  assert.equal((await f.request({ method: 'POST', path: f.decisionPath, body: f.input() })).status, 409); assert.equal(f.calls.insert, 0);
  f.row.state = 'PUBLISHED'; f.card.owner_id = randomUUID();
  assert.equal((await f.request({ method: 'GET', path: f.readPath })).status, 404); f.card.owner_id = f.actorId;
  f.hooks.auth = n => { if (n === f.authCalls && f.calls.insert === 1) f.setActor({ ...f.staff, id: randomUUID() }); };
  const response = await f.request({ method: 'POST', path: f.decisionPath, body: f.input() });
  assert.equal(response.status, 401); assert.deepEqual(Object.keys(await response.json()), ['error']); assert.equal(f.calls.insert, 1);
});
test('Skip/No suitable remain usable with no saved pool or policy; no acquisition capability is consulted', async () => {
  const f = await httpFixture({ policyDisabled: true });
  for (const outcome of ['SKIP', 'NO_SUITABLE_COMPS']) {
    const body = f.input({ outcome, previewId: null, expectedPreviewHash: null, expectedPolicyHash: null, selectedIds: [], reviewedIds: [] });
    const response = await f.request({ method: 'POST', path: f.decisionPath, body }); assert.equal(response.status, 200);
    const result = (await response.json()).result; assert.equal(result.guidance, null); assert.equal(result.source, null); assert.equal(result.policy, null);
  }
  assert.equal(f.calls.artifact, 0); assert.equal(f.calls.insert, 2);
});

async function invoke(handler, req) {
  let status, body; const headers = {};
  await handler(req, { setHeader(k, v) { headers[k] = v; }, status(v) { status = v; return this; }, json(v) { body = v; } });
  return { status, body, headers };
}
test('predicate/Promise ingress guards fail before auth/service; exact trusted this and synchronous void required', async () => {
  for (const guard of [() => true, () => false, () => Promise.resolve(), () => Promise.reject(new Error('synthetic rejected guard'))]) {
    const f = await httpFixture(), handler = createStaffCompCurationHandler({ ...f.options, assertRequest: guard });
    const response = await invoke(handler, { method: 'GET', url: f.readPath, headers: { cookie: 'fixture=session' }, body: '' });
    assert.equal(response.status, 503); assert.equal(f.authCalls, 0); assert.equal(f.calls.access, 0);
  }
  const f = await httpFixture(), trusted = { ...f.options, assertRequest() { assert.equal(this, trusted); } };
  assert.equal((await invoke(createStaffCompCurationHandler(trusted), { method: 'GET', url: f.readPath, headers: { cookie: 'fixture=session' }, body: '' })).status, 200);
});
test('actual signed staff ingress guard binds request path/method/deployment and denies direct unsigned/bearer access', async () => {
  const f = await httpFixture(), config = { mode: 'PRODUCTION', origin: 'https://atlasgrading.com', basePath: '/admin', application: 'atlas-staff',
    deploymentId: 'synthetic-curation.vercel.app', routerKey: Buffer.alloc(32, 13) };
  const handler = createStaffCompCurationHandler({ ...f.options, origin: config.origin, assertRequest(req) { assertProductionStaffRequest(req, config); } });
  const issuedAt = Date.now(), target = `/admin${f.readPath}`;
  const proof = createHmac('sha256', config.routerKey).update(routeEnvelope({ zone: 'staff', deployment: `https://${config.deploymentId}`, method: 'GET', target, issuedAt })).digest('hex');
  const req = { method: 'GET', url: f.readPath, body: '', headers: { host: 'atlasgrading.com', 'x-forwarded-host': 'atlasgrading.com', 'x-forwarded-proto': 'https',
    cookie: 'fixture=session', 'x-atlas-route-issued': String(issuedAt), 'x-atlas-route-target': target, 'x-atlas-route-proof': proof } };
  assert.equal((await invoke(handler, req)).status, 200); const calls = f.authCalls;
  for (const change of [{ 'x-atlas-route-proof': undefined }, { 'x-atlas-route-target': '/admin/api/staff/session' },
    { 'x-atlas-route-proof': '0'.repeat(64) }, { authorization: 'Bearer synthetic' }, { host: 'other.vercel.app' }])
    assert.equal((await invoke(handler, { ...req, headers: { ...req.headers, ...change } })).status, 403);
  assert.equal((await invoke(handler, { ...req, method: 'POST' })).status, 403);
  assert.equal(f.authCalls, calls); assert.equal(f.calls.insert, 0);
});
test('observed pending final authentication cannot return private data after captured configuration/capability drift', async () => {
  for (const change of [f => { f.options.origin = 'https://changed.invalid'; }, f => { f.options.assertRequest = () => {}; },
    f => { f.options.service = { ...f.service }; }, f => { f.options.auth = { ...f.options.auth }; },
    f => { f.options.auth.authenticate = async () => f.staff; }]) {
    const f = await httpFixture(), entered = deferred(), release = deferred();
    f.hooks.auth = async n => { if (n === 2) { entered.resolve(); await release.promise; } };
    const reading = f.request({ method: 'GET', path: f.readPath }); await entered.promise;
    assert.equal(f.authCalls, 2); assert(f.calls.access >= 2); change(f); release.resolve();
    const response = await reading; assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: 'COMP_NOT_CONFIGURED' });
    assert.equal(f.calls.insert, 0);
  }
});
