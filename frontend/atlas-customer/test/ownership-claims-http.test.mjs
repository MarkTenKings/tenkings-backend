import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { CustomerAuth } from '../lib/server/auth.mjs';
import { createOwnershipClaimsHandler } from '../lib/server/ownership-claims-http.mjs';
import { createClaimSubmissionFixture, claimFixtureId, CLAIM_SUBMISSION_CARD, pendingClaim } from './ownership-claim-submission-fixture.mjs';

function setup() {
  const fixture = createClaimSubmissionFixture({ claim: pendingClaim() }), calls = [];
  const config = { origin: 'https://atlas.example.invalid', cookies: { browser: 'customer_browser', session: 'customer_session' }, sessionKey: Buffer.alloc(32, 7) };
  const session = Buffer.alloc(32, 2).toString('base64url');
  const cookie = `customer_browser=${Buffer.alloc(32, 1).toString('base64url')}; customer_session=${session}`;
  const auth = new CustomerAuth({ config, database: { call() { assert.fail('Broad customer DB / bootstrap must not be used'); } } });
  const csrf = auth.digest('session:' + session);
  const decode = async response => { if (!response.ok) throw { status: response.status, code: 'PRIVATE_INTERNAL_DETAILS' }; return response.json(); };
  const capabilities = { readAccess: async () => ({ schema: 'atlas-ownership-customer-access-v1', accountId: fixture.accountId }), configuration: async () => fixture.config,
    resolveTarget: async (header, input) => { calls.push(['target', header, input]); return decode(await fixture.transport.resolve(input, {})); },
    lifecycle: { async call(...args) { calls.push(args); return decode(await fixture.transport.lifecycle(args[2], args[3], {})); } } };
  const state = { auth, config, assertRequest() {}, ownershipClaims: capabilities }, handler = createOwnershipClaimsHandler(state);
  async function run({ method = 'GET', path = 'claim?claimId=' + fixture.claim.claimId, body = '', headers = {}, ...extra } = {}) {
    const req = Object.assign(new EventEmitter(), { method, url: '/api/customer/ownership/' + path, body,
      headers: { cookie, ...(method === 'POST' ? { origin: config.origin, 'content-type': 'application/json', 'x-atlas-customer-csrf': csrf } : {}), ...headers }, ...extra });
    const res = Object.assign(new EventEmitter(), { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.statusCode = n; return this; }, json(value) { this.body = value; this.writableEnded = true; return this; } });
    await handler(req, res);
    assert.match(res.headers['Cache-Control'], /private, no-store/); assert.equal(res.headers['Vercel-CDN-Cache-Control'], 'no-store');
    assert.equal(req.listenerCount('aborted'), 0); assert.equal(res.listenerCount('close'), 0);
    return res;
  }
  return { fixture, calls, state, capabilities, cookie, csrf, run };
}

test('default unavailable; existing broad service or v1 reader is never an implicit fallback', async () => {
  const f = setup(); delete f.state.ownershipClaims;
  f.state.ownershipRead = { read() { assert.fail('Old reader'); } };
  for (const path of ['configuration', 'target?certificateNumber='+CLAIM_SUBMISSION_CARD.certificateNumber, 'claim?claimId='+f.fixture.claim.claimId]) {
    const r = await f.run({ path }); assert.equal(r.statusCode, 503); assert.deepEqual(r.body, { error: 'OWNERSHIP_CLAIMS_UNAVAILABLE' });
  }
});

test('actual CustomerAuth and exact v2 read/withdraw dispatch preserve blocked management without upload capability', async () => {
  const f = setup(); f.fixture.config = { ...f.fixture.config, canPrepareEvidence: false, proofKinds: [], formats: [], storageOrigin: null, storagePathPrefix: null };
  assert.equal((await f.run({ path: 'configuration' })).body.canPrepareEvidence, false);
  const read = await f.run(); assert.equal(read.statusCode, 200); assert.equal(read.body.claim.state, 'PENDING');
  const input = { requestId: claimFixtureId(400), claimId: f.fixture.claim.claimId, expectedClaimRevision: 1 };
  const result = await f.run({ method: 'POST', path: 'withdraw', body: input });
  assert.equal(result.statusCode, 200); assert.equal(result.body.receipt.state, 'WITHDRAWN'); assert.equal(result.body.receipt.claimRevision, 2);
  assert.deepEqual(f.calls.at(-1), [f.cookie, f.csrf, 'withdraw_claim', input]); assert.equal(result.headers['Set-Cookie'], undefined);
  const recovered = await f.run({ path: 'request?requestId='+input.requestId }); assert.equal(recovered.body.receipt.action, 'withdraw_claim');
});

test('fixed route grammar rejects actions, foreign identity, aliases, duplicate selectors, reviewer and history dispatch', async () => {
  const f = setup();
  for (const path of ['claim?claimId='+f.fixture.claim.claimId+'&accountId='+f.fixture.accountId,
    'claim?claimId='+f.fixture.claim.claimId+'&claimId='+f.fixture.claim.claimId, 'claim?', 'claim?%63laimId='+f.fixture.claim.claimId,
    'claim?claimId='+f.fixture.claim.claimId+'#fragment', 'target?certificateNumber=atlas-123456ABCDEF']) assert.equal((await f.run({ path })).statusCode, 400, path);
  for (const path of ['review', 'claims', 'queue', 'read_plan', 'retain_object', 'claim/extra']) assert.equal((await f.run({ path })).statusCode, 404, path);
  assert.equal((await f.run({ method: 'POST', body: {}, path: 'claim?claimId='+f.fixture.claim.claimId })).statusCode, 405);
  const base = { requestId: claimFixtureId(400), claimId: f.fixture.claim.claimId, expectedClaimRevision: 1 };
  for (const key of ['accountId', 'action', 'binding', 'observation', 'key']) assert.equal((await f.run({ method: 'POST', path: 'withdraw', body: { ...base, [key]: 'forged' } })).statusCode, 400);
  assert.equal(f.calls.length, 0);
});

test('cookie, actual CSRF, origin, bearer, framing and metadata size refusals dispatch nothing', async () => {
  const f = setup(), body = { requestId: claimFixtureId(400), claimId: f.fixture.claim.claimId, expectedClaimRevision: 1 };
  for (const [headers, status] of [[{ cookie: '' }, 401], [{ 'x-atlas-customer-csrf': '' }, 403], [{ 'x-atlas-customer-csrf': 'forged' }, 403],
    [{ origin: 'https://other.invalid' }, 403], [{ 'sec-fetch-site': 'cross-site' }, 403], [{ authorization: 'Bearer fake' }, 403],
    [{ 'content-type': 'text/plain' }, 403], [{ 'content-encoding': 'gzip' }, 400], [{ 'transfer-encoding': 'chunked' }, 400], [{ 'content-length': '8193' }, 413]]) {
    assert.equal((await f.run({ method: 'POST', path: 'withdraw', body, headers })).statusCode, status);
  }
  assert.equal((await f.run({ method: 'POST', path: 'withdraw', body: { excess: 'x'.repeat(8192) } })).statusCode, 413);
  for (const body of [[], { accountId: f.fixture.accountId }, 'payload']) assert.equal((await f.run({ body })).statusCode, 400);
  assert.equal(f.calls.length, 0);
});

test('empty framework GET bodies work; accountless, malformed or private extra results never cross boundary', async () => {
  const f = setup(); for (const body of [undefined, null, '', {}]) assert.equal((await f.run({ body })).statusCode, 200);
  for (const mutate of [v => { delete v.accountId; }, v => { v.accountId = 'invalid'; }, v => { v.privateKey = 'secret'; }, v => { v.claim.claimRevision = 0; }]) {
    f.capabilities.lifecycle.call = async () => { const v = f.fixture.project('read_claim', { claimId: f.fixture.claim.claimId }, { claim: f.fixture.claim }); mutate(v); return v; };
    const r = await f.run(); assert.equal(r.statusCode, 503); assert.deepEqual(r.body, { error: 'OWNERSHIP_CLAIMS_UNAVAILABLE' });
  }
});

test('service errors remain sanitized and cannot masquerade as confirmed refusal', async () => {
  const f = setup();
  for (const status of [401, 403, 404, 409, 429, 500]) {
    f.capabilities.lifecycle.call = async () => { throw Object.assign(Error('PRIVATE COOKIE/SQL'), { status, code: 'PRIVATE_DETAILS' }); };
    const r = await f.run(); assert.equal(r.statusCode, status === 500 ? 503 : status);
    assert.deepEqual(Object.keys(r.body), ['error']); assert.doesNotMatch(JSON.stringify(r.body), /PRIVATE|CONFIRMED_REFUSAL/);
  }
});

test('independent live account binding rejects foreign capability responses and post-dispatch account loss', async () => {
  const f = setup();
  f.capabilities.lifecycle.call = async () => ({ ...f.fixture.project('read_claim', { claimId: f.fixture.claim.claimId }, { claim: f.fixture.claim }), accountId: claimFixtureId(999) });
  assert.deepEqual((await f.run()).body, { error: 'OWNERSHIP_CLAIMS_UNAVAILABLE' });
  f.capabilities.resolveTarget = async () => ({ schema: 'atlas-ownership-claim-target-v1', accountId: claimFixtureId(999), observedAt: '2026-10-21T12:00:00Z', card: CLAIM_SUBMISSION_CARD, canSubmit: false, expectedOwnershipRevision: null });
  assert.deepEqual((await f.run({ path: 'target?certificateNumber='+CLAIM_SUBMISSION_CARD.certificateNumber })).body, { error: 'OWNERSHIP_CLAIMS_UNAVAILABLE' });
  const g = setup(); let checks = 0;
  g.capabilities.readAccess = async () => { if (++checks > 1) throw { status: 401 }; return { schema: 'atlas-ownership-customer-access-v1', accountId: g.fixture.accountId }; };
  const input = { requestId: claimFixtureId(410), claimId: g.fixture.claim.claimId, expectedClaimRevision: 1 };
  const r = await g.run({ method: 'POST', path: 'withdraw', body: input });
  assert.equal(r.statusCode, 401); assert.deepEqual(r.body, { error: 'SIGN_IN_REQUIRED' });
  assert.equal(g.fixture.claim.state, 'WITHDRAWN'); // Refusal to disclose does not undo an already completed mutation.
  delete g.capabilities.readAccess; const count = g.calls.length;
  assert.equal((await g.run({ method: 'POST', path: 'withdraw', body: { ...input, requestId: claimFixtureId(411) } })).statusCode, 503);
  assert.equal(g.calls.length, count);
});

test('proof methods receive only closed IDs and no default storage or ingestor authority', async () => {
  const f = setup(), body = { bundleId: claimFixtureId(401), objectId: claimFixtureId(402) };
  assert.equal((await f.run({ method: 'POST', path: 'sign', body })).statusCode, 503);
  let call;
  f.capabilities.proof = { async complete(...args) { call = args; return { schema: 'atlas-ownership-proof-retained-v2', accountId: f.fixture.accountId,
    ...body, state: 'RETAINED', byteCount: 10, sha256: 'a'.repeat(64), declaredType: 'image/png' }; } };
  assert.equal((await f.run({ method: 'POST', path: 'complete', body })).statusCode, 200);
  assert.deepEqual(call.slice(0, 3), [f.cookie, f.csrf, body]); assert(call[3].signal instanceof AbortSignal);
  assert.equal((await f.run({ method: 'POST', path: 'complete', body: { ...body, observation: {} } })).statusCode, 400);
});
