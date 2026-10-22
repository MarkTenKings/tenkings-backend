import test from 'node:test';
import assert from 'node:assert/strict';
import { createOwnershipClaimsReader, parseOwnershipClaimsPage, ownershipClaimsRequest } from '../lib/ownership-claims-client.mjs';
import { projectOwnershipWorkflow } from '../../../packages/atlas-connected-manual/src/card-ownership-workflow-contract.mjs';
import { CLAIM_ACCOUNT, CLAIM_OTHER_ACCOUNT, claimFixtureId, claimFixtureRow, createOwnershipClaimsFixture } from './ownership-claims-fixture.mjs';
const headers = { 'content-type': 'application/json', 'cache-control': 'private, no-store, max-age=0' };
const response = (value, options = {}) => new Response(JSON.stringify(value), { headers, ...options });

test('browser parser consumes actual customer projector across independent decisions, ownership and evidence states', () => {
  for (const decision of ['PENDING', 'VERIFIED', 'REJECTED']) for (const availability of ['AVAILABLE', 'EXPIRED', 'POLICY_CHANGED', 'POLICY_UNAVAILABLE', 'UNAVAILABLE'])
    for (const owned of [false, true]) for (const cardMissing of [false, true]) {
      const raw = { actorId: CLAIM_ACCOUNT, observedAt: '2026-10-21T12:00:00.000Z', claims: [claimFixtureRow(1, { decision, availability, owned, cardMissing })], nextClaimId: null };
      const input = { afterClaimId: null, limit: 25 }, projected = projectOwnershipWorkflow('CUSTOMER', 'list_claims', raw, input);
      assert.deepEqual(parseOwnershipClaimsPage(projected, CLAIM_ACCOUNT), projected);
    }
  const f = createOwnershipClaimsFixture({ count: 8 }), parsed = parseOwnershipClaimsPage(f.page, f.accountId);
  assert.equal(parsed.claims[1].decision.state, 'VERIFIED'); assert.equal(parsed.claims[1].currentlyOwnedByYou, false);
  assert.equal(parsed.claims[7].card, null); assert.equal(parsed.claims[7].reviewStatus, 'BLOCKED');
  assert.equal(parsed.total, undefined); assert.notEqual(parsed.claims, f.page.claims);
});

test('customer cursor is scoped to account, request and exact full last-returned page', () => {
  const f = createOwnershipClaimsFixture({ count: 25, next: true });
  assert.equal(parseOwnershipClaimsPage(f.page, CLAIM_ACCOUNT).nextClaimId, claimFixtureId(25));
  assert.throws(() => parseOwnershipClaimsPage(f.page, CLAIM_OTHER_ACCOUNT), { code: 'OWNERSHIP_CLAIMS_ACCESS_ENDED' });
  assert.throws(() => parseOwnershipClaimsPage(f.page, CLAIM_ACCOUNT, { afterClaimId: claimFixtureId(1), limit: 25 }));
  for (const mutate of [v => { v.claims.pop(); }, v => { v.claims = []; }, v => { v.nextClaimId = claimFixtureId(26); },
    v => { v.claims[1] = v.claims[0]; }, v => { v.claims.reverse(); }, v => { v.claims.push(claimFixtureRow(26)); }]) {
    const changed = structuredClone(f.page); mutate(changed); assert.throws(() => parseOwnershipClaimsPage(changed, CLAIM_ACCOUNT));
  }
  for (const request of [{ afterClaimId: null, limit: 51 }, { afterClaimId: null, limit: '25' }, { afterClaimId: '../claim', limit: 25 },
    { afterClaimId: null, limit: 25, accountId: CLAIM_ACCOUNT }, { limit: 25 }]) assert.throws(() => ownershipClaimsRequest(request));
});

test('refuses private extras, unbound approved card data and inconsistent review decisions', () => {
  const f = createOwnershipClaimsFixture({ count: 1 });
  for (const mutate of [v => { v.actorId = CLAIM_ACCOUNT; }, v => { v.claims[0].ownerAccountId = CLAIM_OTHER_ACCOUNT; },
    v => { v.claims[0].card.cardId = claimFixtureId(99); }, v => { v.claims[0].card.report.publicHash = 'broken'; },
    v => { v.claims[0].decision.decidedAt = '2026-10-21T12:00:00Z'; }, v => { v.claims[0].reviewStatus = 'DECIDED'; },
    v => { v.claims[0].actions.downloadEvidence = false; }, v => { v.claims[0].actions.verify = true; },
    v => { v.claims[0].evidence.referenceId = null; }, v => { v.claims[0].currentlyOwnedByYou = 'true'; }]) {
    const changed = structuredClone(f.page); mutate(changed); assert.throws(() => parseOwnershipClaimsPage(changed, CLAIM_ACCOUNT));
  }
});

test('explicit injected transport receives no account authority and normalizes a private bounded Response', async () => {
  assert.throws(() => createOwnershipClaimsReader(), { code: 'OWNERSHIP_CLAIMS_ADAPTER_INVALID' });
  const f = createOwnershipClaimsFixture(), calls = [];
  const read = createOwnershipClaimsReader(async input => { calls.push(input); return response(f.page); });
  assert.deepEqual(await read({ accountId: f.accountId }), f.page); assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0]).sort(), ['afterClaimId', 'limit', 'signal']);
  assert.equal(calls[0].afterClaimId, null); assert.equal(calls[0].limit, 25); assert(calls[0].signal instanceof AbortSignal);
});

test('empty is distinct from unavailable, access ended and malformed private responses', async () => {
  const empty = createOwnershipClaimsFixture({ count: 0 }).page;
  assert.deepEqual((await createOwnershipClaimsReader(async () => response(empty))({ accountId: CLAIM_ACCOUNT })).claims, []);
  for (const status of [401, 403, 404, 500, 503]) await assert.rejects(createOwnershipClaimsReader(async () => response({ private: 'do not render' }, { status }))({ accountId: CLAIM_ACCOUNT }),
    { code: [401, 403].includes(status) ? 'OWNERSHIP_CLAIMS_ACCESS_ENDED' : 'OWNERSHIP_CLAIMS_UNAVAILABLE' });
  for (const get of [() => response(empty, { headers: { ...headers, 'cache-control': 'public,max-age=30' } }),
    () => response(empty, { headers: { ...headers, 'content-type': 'text/html' } }), () => response({ text: 'x'.repeat(262145) }),
    () => new Response('{bad', { headers }), () => new Response(new Uint8Array([0xff]), { headers })]) {
    await assert.rejects(createOwnershipClaimsReader(async () => get())({ accountId: CLAIM_ACCOUNT }), { code: 'OWNERSHIP_CLAIMS_UNAVAILABLE' });
  }
  await assert.rejects(createOwnershipClaimsReader(async () => response({ ...empty, accountId: CLAIM_OTHER_ACCOUNT }))({ accountId: CLAIM_ACCOUNT }), { code: 'OWNERSHIP_CLAIMS_ACCESS_ENDED' });
});

test('abort refuses dispatch, delayed noncompliant response, and in-flight body bytes', async () => {
  const f = createOwnershipClaimsFixture(), stopped = new AbortController(); stopped.abort();
  await assert.rejects(createOwnershipClaimsReader(() => assert.fail('dispatch'))({ accountId: CLAIM_ACCOUNT, signal: stopped.signal }), { code: 'OWNERSHIP_CLAIMS_CANCELLED' });
  const controller = new AbortController(); let finish, seen;
  const pending = createOwnershipClaimsReader(input => { seen = input.signal; return new Promise(resolve => { finish = resolve; }); })({ accountId: CLAIM_ACCOUNT, signal: controller.signal });
  await new Promise(resolve => setImmediate(resolve));
  controller.abort(); assert.equal(seen.aborted, true); finish(response(f.page));
  await assert.rejects(pending, { code: 'OWNERSHIP_CLAIMS_CANCELLED' });
  const bodyController = new AbortController(); let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  const bodyRead = createOwnershipClaimsReader(async () => new Response(body, { headers }))({ accountId: CLAIM_ACCOUNT, signal: bodyController.signal });
  await new Promise(resolve => setImmediate(resolve)); bodyController.abort();
  await assert.rejects(bodyRead, { code: 'OWNERSHIP_CLAIMS_CANCELLED' }); assert.equal(cancelled, true);
});

test('abort settles a noncompliant unresolved transport and cancels its late response', async () => {
  const controller = new AbortController(); let finish, cancelled = false;
  const read = createOwnershipClaimsReader(() => new Promise(resolve => { finish = resolve; }))({ accountId: CLAIM_ACCOUNT, signal: controller.signal });
  await new Promise(resolve => setImmediate(resolve)); controller.abort();
  await assert.rejects(read, { code: 'OWNERSHIP_CLAIMS_CANCELLED' });
  finish(new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers }));
  await new Promise(resolve => setImmediate(resolve)); assert.equal(cancelled, true);
});

test('25-second timeout settles stalled transport and body even if stream cancellation never resolves', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const stalled = createOwnershipClaimsReader(() => new Promise(() => {}))({ accountId: CLAIM_ACCOUNT });
  await new Promise(resolve => setImmediate(resolve)); t.mock.timers.tick(25000); await assert.rejects(stalled, { code: 'OWNERSHIP_CLAIMS_UNAVAILABLE' });
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; return new Promise(() => {}); } });
  const stream = createOwnershipClaimsReader(async () => new Response(body, { headers }))({ accountId: CLAIM_ACCOUNT });
  await new Promise(resolve => setImmediate(resolve)); t.mock.timers.tick(25000);
  await assert.rejects(stream, { code: 'OWNERSHIP_CLAIMS_UNAVAILABLE' }); assert.equal(cancelled, true);
});
