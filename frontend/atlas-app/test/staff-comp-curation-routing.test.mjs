import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../lib/server/http.mjs';
import { createPageAccess } from '../lib/server/page-access.mjs';
import { BoundaryError } from '../lib/server/policy.mjs';

const cardId = '11111111-1111-4111-8111-111111111111';
function response() {
  return { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; },
    status(n) { this.statusCode = n; return this; }, json(v) { this.body = v; return this; } };
}
const request = (url, method = 'GET') => ({ url, method, headers: {}, socket: { remoteAddress: '127.0.0.1' } });

test('private comp aliases cannot reach the browser generic proxy, even while curation is absent', async () => {
  let admitted = 0;
  const handler = createHandler({ auth: {}, assertRequest() { admitted++; },
    connectedManual: { handler() { assert.fail('Private comp alias reached generic proxy'); } } });
  const suffixes = ['', '/decision', '?approvalActionId=bad', '/decision?unexpected=1'];
  for (const prefix of ['', '/admin']) for (const suffix of suffixes) for (const method of ['GET', 'POST']) {
    const res = response(); await handler(request(`${prefix}/api/staff/manual-connected/cards/${cardId}/comp-curation${suffix}`, method), res);
    assert.equal(res.statusCode, 404); assert.deepEqual(res.body, { error: 'NOT_FOUND' });
  }
  assert.equal(admitted, 16);
});

test('public curation dispatch stays dedicated and ordinary saved-market reads retain the existing proxy', async () => {
  let curationCalls = 0, manualCalls = 0;
  const state = { auth: {}, assertRequest() {}, connectedManual: { handler(_req, res) {
    manualCalls++; res.status(200).json({ existing: true }); return true;
  } } };
  const handler = createHandler(state);
  const path = `/api/staff/comp-curation/cards/${cardId}?approvalActionId=bad`;
  let res = response(); await handler(request(path), res);
  assert.equal(res.statusCode, 503); assert.equal(manualCalls, 0);
  state.compCuration = { async handler(req, output) { curationCalls++; assert.equal(req.url, path); output.status(400).json({ error: 'COMP_REQUEST_INVALID' }); } };
  res = response(); await handler(request(path), res);
  assert.equal(res.statusCode, 400); assert.equal(curationCalls, 1); assert.equal(manualCalls, 0);
  res = response(); await handler(request(`/api/staff/manual-connected/cards/${cardId}/presentation/market`), res);
  assert.equal(res.statusCode, 200); assert.equal(manualCalls, 1); assert.equal(curationCalls, 1);
  state.assertRequest = () => { throw new BoundaryError(403, 'HOST_NOT_ALLOWED'); };
  res = response(); await handler(request(path), res);
  assert.equal(res.statusCode, 403); assert.equal(curationCalls, 1);
});

test('only the requesting authenticated page receives an exact-true advisory curation flag', async () => {
  let flagReads = 0, sessions = 0;
  const staff = { id: cardId, role: 'REVIEWER' };
  const state = { auth: { async maybeAuthenticate() { sessions++; return staff; } }, compCuration: {
    get configuredForDisplay() { flagReads++; return true; }, privateCredential: 'MUST_NOT_LEAVE_SERVER',
  } };
  const access = createPageAccess({ resolveRuntime: () => state, environment: () => ({}), log() {} });
  const ctx = () => ({ req: request('/graded-cards/' + cardId), res: response() });
  assert.equal((await access(ctx())).props.compCurationConfiguredForDisplay, undefined);
  assert.equal(flagReads, 0);
  const enabled = await access(ctx(), { includeCompCuration: true });
  assert.equal(enabled.props.compCurationConfiguredForDisplay, true); assert.equal(flagReads, 1);
  assert.doesNotMatch(JSON.stringify(enabled), /MUST_NOT_LEAVE_SERVER|privateCredential/);
  state.compCuration = { configuredForDisplay: 'true' };
  assert.equal((await access(ctx(), { includeCompCuration: true })).props.compCurationConfiguredForDisplay, false);
  state.auth.maybeAuthenticate = async () => null;
  state.compCuration = { get configuredForDisplay() { assert.fail('Display flag read before staff auth'); } };
  assert.deepEqual(await access(ctx(), { includeCompCuration: true }), { redirect: { destination: '/', permanent: false } });
  assert.deepEqual(await access(ctx(), { authenticated: false, includeCompCuration: true }), { props: { mode: 'SYNTHETIC_LOCAL' } });
  assert.equal(sessions, 3);
});
