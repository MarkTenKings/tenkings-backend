import test from 'node:test';
import assert from 'node:assert/strict';
import { CustomerAuth } from '../lib/server/auth.mjs';
import { createOwnershipClaimsHandler } from '../lib/server/ownership-claims-http.mjs';
import { createOwnershipClaimsTransport } from '../lib/ownership-claims-transport.mjs';
import { createClaimSubmissionClient } from '../lib/ownership-claim-submission-client.mjs';
import { createClaimSubmissionState } from '../lib/ownership-claim-submission-state.mjs';
import { createClaimSubmissionFixture, claimOriginal, CLAIM_SUBMISSION_CARD, claimFixtureId } from './ownership-claim-submission-fixture.mjs';

import { projectOwnershipLifecycleRead } from '../../../packages/atlas-connected-manual/src/card-ownership-lifecycle-read-contract.mjs';
import { createOwnershipClaimsReader, createOwnershipClaimHistoryReader } from '../lib/ownership-claims-client.mjs';

function loopback() {
  const f = createClaimSubmissionFixture(), network = [], config = { origin: 'https://atlas.example.invalid', cookies: { browser: 'browser', session: 'session' }, sessionKey: Buffer.alloc(32, 7) };
  const session = Buffer.alloc(32, 2).toString('base64url'), cookie = `browser=${Buffer.alloc(32, 1).toString('base64url')}; session=${session}`;
  const auth = new CustomerAuth({ config, database: { call() { assert.fail('No database or bootstrap'); } } });
  const csrf = auth.digest('session:' + session);
  const decode = async r => { if (!r.ok) throw { status: r.status }; return r.json(); };
  const handler = createOwnershipClaimsHandler({ auth, config, assertRequest() {}, ownershipClaims: {
    readAccess: async () => ({ schema: 'atlas-ownership-customer-access-v1', accountId: f.accountId }),
    configuration: async () => f.config, resolveTarget: async (_cookie, input) => decode(await f.transport.resolve(input, {})),
    listClaims: async (_cookie, input) => projectOwnershipLifecycleRead('list_claims', { actorId: f.accountId, observedAt: '2026-10-21T12:00:00.000Z',
      claims: f.claim && (!input.afterClaimId || f.claim.claimId > input.afterClaimId) ? [f.claim] : [], nextClaimId: null }, input),
    listHistory: async (_cookie, input) => projectOwnershipLifecycleRead('list_history', { actorId: f.accountId, observedAt: '2026-10-21T12:00:00.000Z', claim: f.claim,
      submittedAt: '2026-10-21T11:00:00.000Z', origin: 'PROOF_V2', transitions: [...f.receipts.values()].filter(r => r.claimId === input.claimId && r.claimRevision > input.afterRevision)
        .sort((a,b) => a.claimRevision-b.claimRevision).map(r => ({ claimRevision: r.claimRevision, action: r.action, state: r.state, bundleId: r.bundleId, occurredAt: '2026-10-21T12:00:00.000Z' })), nextRevision: null }, input),
    readClaim: async (_cookie, input) => decode(await f.transport.lifecycle('read_claim', input, {})),
    lifecycle: { call: async (_cookie, _csrf, action, input) => decode(await f.transport.lifecycle(action, input, {})) },
    proof: { sign: async (_cookie, _csrf, input, opts) => decode(await f.transport.sign(input, opts)), complete: async (_cookie, _csrf, input, opts) => decode(await f.transport.complete(input, opts)) },
    uploadBoundary: { origin: f.config.storageOrigin, pathPrefix: f.config.storagePathPrefix },
  } });
  const transport = createOwnershipClaimsTransport({ csrf: () => csrf, storageOrigin: f.config.storageOrigin, storagePathPrefix: f.config.storagePathPrefix,
    async fetchImpl(url, options) {
      network.push({ url, options });
      if (options.method === 'PUT') return f.transport.put({ url, ...options });
      assert(url.startsWith('/account/api/customer/ownership/')); assert.equal(options.credentials, 'same-origin');
      const req = { method: options.method, url: url.slice('/account'.length), headers: { ...options.headers, cookie,
        ...(options.method === 'POST' ? { origin: config.origin } : {}) }, body: options.body ? JSON.parse(options.body) : '' };
      const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.statusCode = n; return this; }, json(value) { this.value = value; } };
      await handler(req, res); return new Response(JSON.stringify(res.value), { status: res.statusCode, headers: { ...res.headers, 'content-type': 'application/json' } });
    } });
  const client = createClaimSubmissionClient({ accountId: f.accountId, configuration: f.config, transport });
  const state = createClaimSubmissionState({ client, accountId: f.accountId, now: f.now, uuid: f.uuid });
  return { f, state, transport, network };
}
async function prepare(h) { await h.state.lookup(CLAIM_SUBMISSION_CARD.certificateNumber); await h.state.selectFiles([claimOriginal()]); await h.state.reserve(h.f.config.proofKinds[0].code); }

test('in-process actual auth → HTTP → v2 projections → browser state completes explicit original upload/submit', async () => {
  const h = loopback(); await prepare(h); assert.equal(h.state.snapshot().bundle.allRetained, false);
  await h.state.upload(); assert.equal(h.state.snapshot().bundle.allRetained, true);
  await h.state.submit(); assert.equal(h.state.snapshot().claim.state, 'PENDING'); assert.equal(h.state.snapshot().claim.currentlyOwnedByYou, false);
  assert.equal(h.network.filter(c => c.options.method === 'PUT').length, 1);
  for (const { options } of h.network) { assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store'); assert.equal(options.referrerPolicy, 'no-referrer'); }
  const put = h.network.find(c => c.options.method === 'PUT'); assert.equal(put.options.credentials, 'omit');
  assert.equal(put.options.headers['x-atlas-customer-csrf'], undefined); assert.equal(put.options.headers.cookie, undefined);
});

test('server-side success with lost response stays UNKNOWN and recovery reads without mutation replay', async () => {
  const h = loopback(); await prepare(h); await h.state.upload();
  h.f.faults.set('submit_claim', async ({ next }) => { await next(); throw Error('lost after commit'); });
  await h.state.submit(); assert.equal(h.state.snapshot().status, 'UNKNOWN');
  const writes = () => h.f.calls.filter(c => c.action === 'submit_claim').length; assert.equal(writes(), 1);
  await h.state.recover(); assert.equal(h.state.snapshot().receipt.state, 'PENDING'); assert.equal(h.state.snapshot().claim.state, 'PENDING'); assert.equal(writes(), 1);
});

test('plain conflict cannot become confirmed refusal; exact request remains recoverable', async () => {
  const h = loopback(); h.f.faults.set('reserve_bundle', () => new Response('{}', { status: 409 })); await prepare(h);
  assert.equal(h.state.snapshot().status, 'UNKNOWN'); assert(h.state.snapshot().pendingRequestId);
  await h.state.recover(); assert.equal(h.state.snapshot().recoveryMissing, true);
  assert.equal(h.f.calls.filter(c => c.action === 'reserve_bundle').length, 1);
});

test('transport has no default fetch, validates exact actions/IDs, and fetch cancellation never retries', async () => {
  assert.throws(() => createOwnershipClaimsTransport()); let calls = 0, token = 'first';
  const t = createOwnershipClaimsTransport({ csrf: () => token, fetchImpl: async (_url, options) => { calls++; assert.equal(options.headers['x-atlas-customer-csrf'], token); throw Error('lost'); } });
  assert.throws(() => t.lifecycle('review_claim', {})); assert.throws(() => t.resolve({ certificateNumber: CLAIM_SUBMISSION_CARD.certificateNumber, accountId: claimFixtureId(1) }));
  const input = { bundleId: claimFixtureId(2), objectId: claimFixtureId(3) };
  await assert.rejects(t.sign(input)); assert.equal(calls, 1); token = 'rotated'; await assert.rejects(t.complete(input)); assert.equal(calls, 2);
  const abort = new AbortController(); abort.abort(); await assert.rejects(t.sign(input, { signal: abort.signal })); assert.equal(calls, 2);
});

test('direct object PUT refuses other origins/keys, auth headers, nonoriginal bodies and credentials', () => {
  let calls = 0; const t = createOwnershipClaimsTransport({ csrf: () => 'unused', fetchImpl() { calls++; }, storageOrigin: 'https://private.invalid', storagePathPrefix: '/bucket/' });
  const input = { method: 'PUT', url: `https://private.invalid/bucket/atlas-ownership-proof/v2/${claimFixtureId(1)}/${claimFixtureId(2)}?signed=yes`, body: claimOriginal(),
    credentials: 'omit', redirect: 'error', cache: 'no-store', headers: { 'content-type': 'application/octet-stream', 'if-none-match': '*', 'x-amz-checksum-sha256': 'a'.repeat(43)+'=',
      'x-amz-meta-atlas-kind': 'ownership-proof-v2', 'x-amz-meta-atlas-binding-sha256': 'a'.repeat(64) } };
  for (const patch of [{ url: input.url.replace('private.invalid', 'other.invalid') }, { url: input.url.replace('/v2/', '/v1/') },
    { body: 'base64' }, { credentials: 'include' }, { headers: { ...input.headers, authorization: 'Bearer leaked' } }]) assert.throws(() => t.put({ ...input, ...patch }));
  assert.equal(calls, 0); t.put(input); assert.equal(calls, 1);
});


test('restricted read chain shows current replacement/withdrawal while recovering the original submit receipt unchanged', async () => {
  const h = loopback(); await prepare(h); await h.state.upload(); await h.state.submit();
  const original = structuredClone(h.state.snapshot().receipt), originalBundleId = h.f.claim.bundleId;
  // Synthetic fixture-only retained replacement, no storage or provider operation.
  const replacement = structuredClone(h.f.bundles.get(originalBundleId)); replacement.bundleId = h.f.uuid(); replacement.requestId = h.f.uuid(); replacement.consumed = false;
  h.f.bundles.set(replacement.bundleId, replacement);
  const replaced = await (await h.transport.lifecycle('replace_evidence', { requestId: h.f.uuid(), claimId: h.f.claim.claimId, expectedClaimRevision: 1, bundleId: replacement.bundleId })).json();
  assert.equal(replaced.receipt.claimRevision, 2);
  await h.transport.lifecycle('withdraw_claim', { requestId: h.f.uuid(), claimId: h.f.claim.claimId, expectedClaimRevision: 2 });
  const before = h.network.length;
  const page = await createOwnershipClaimsReader(h.transport.listClaims)({ accountId: h.f.accountId });
  const history = await createOwnershipClaimHistoryReader(h.transport.listHistory)({ accountId: h.f.accountId, claimId: h.f.claim.claimId });
  const recovered = await (await h.transport.lifecycle('recover_request', { requestId: original.requestId })).json();
  const current = await (await h.transport.lifecycle('read_claim', { claimId: h.f.claim.claimId })).json();
  assert.deepEqual(recovered.receipt, original); assert.equal(recovered.receipt.state, 'PENDING'); assert.equal(recovered.receipt.claimRevision, 1);
  assert.equal(page.claims[0].state, 'WITHDRAWN'); assert.equal(current.claim.claimRevision, 3); assert.equal(current.claim.bundleId, replacement.bundleId);
  assert.deepEqual(history.transitions.map(t => [t.action, t.state, t.bundleId]), [['submit_claim', 'PENDING', originalBundleId], ['replace_evidence', 'PENDING', replacement.bundleId], ['withdraw_claim', 'WITHDRAWN', replacement.bundleId]]);
  for (const call of h.network.slice(before)) { assert.equal(call.options.method, 'GET'); assert.equal(call.options.headers['x-atlas-customer-csrf'], undefined); assert.doesNotMatch(call.url, /accountId|reviewer/); }
});

test('read transport requires only explicit GET inputs; account identity and mutation fields stay local', async () => {
  const calls = [], t = createOwnershipClaimsTransport({ csrf: () => assert.fail('No CSRF read on GET'), fetchImpl: async (...args) => { calls.push(args); return new Response('{}'); } });
  const id = claimFixtureId(2), signal = new AbortController().signal;
  await t.listClaims({ afterClaimId: id, limit: 50, signal }); await t.listHistory({ claimId: id, afterRevision: 2, limit: 1, signal });
  assert.equal(calls[0][0], '/account/api/customer/ownership/claims?limit=50&afterClaimId='+id);
  assert.equal(calls[1][0], `/account/api/customer/ownership/history?claimId=${id}&afterRevision=2&limit=1`);
  for (const [,opts] of calls) { assert.equal(opts.method, 'GET'); assert.equal(opts.signal, signal); assert.equal(opts.body, undefined); }
  assert.throws(() => t.listClaims({ accountId: id })); assert.throws(() => t.listHistory({ claimId: id, requestId: id })); assert.equal(calls.length, 2);
});
