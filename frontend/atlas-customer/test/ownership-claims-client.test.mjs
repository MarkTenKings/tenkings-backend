import test from 'node:test';
import assert from 'node:assert/strict';
import { createOwnershipClaimsReader, parseOwnershipClaimsPage, ownershipClaimsRequest, createOwnershipClaimHistoryReader, parseOwnershipClaimCurrent, parseOwnershipClaimHistory } from '../lib/ownership-claims-client.mjs';
import { projectOwnershipLifecycleRead } from '../../../packages/atlas-connected-manual/src/card-ownership-lifecycle-read-contract.mjs';
import { CLAIM_ACCOUNT, CLAIM_OTHER_ACCOUNT, claimFixtureId, claimFixtureRow, createOwnershipClaimsFixture, createOwnershipClaimHistoryFixture } from './ownership-claims-fixture.mjs';
const headers = { 'content-type': 'application/json', 'cache-control': 'private, no-store, max-age=0' };
const response = (value, options = {}) => new Response(JSON.stringify(value), { headers, ...options });

test('browser parser consumes the qualified v2 projector across current states, independent title and blocked reasons', () => {
  for (const state of ['PENDING', 'WITHDRAWN', 'VERIFIED', 'REJECTED']) for (const blocked of [[], ['EVIDENCE_EXPIRED'], ['POLICY_CHANGED'], ['POLICY_UNAVAILABLE'], ['EVIDENCE_UNAVAILABLE', 'CARD_UNAVAILABLE'], ['OWNERSHIP_CHANGED']])
    for (const owned of [false, true]) for (const cardMissing of [false, true]) {
      const raw = { actorId: CLAIM_ACCOUNT, observedAt: '2026-10-21T12:00:00.000Z', claims: [claimFixtureRow(1, { state, blocked, owned, cardMissing })], nextClaimId: null };
      const input = { afterClaimId: null, limit: 25 }, projected = projectOwnershipLifecycleRead('list_claims', raw, input);
      assert.deepEqual(parseOwnershipClaimsPage(projected, CLAIM_ACCOUNT), projected);
      const current = projectOwnershipLifecycleRead('read_claim', { actorId: raw.actorId, observedAt: raw.observedAt, claim: raw.claims[0] }, { claimId: raw.claims[0].claimId });
      assert.deepEqual(parseOwnershipClaimCurrent(current, CLAIM_ACCOUNT, { claimId: raw.claims[0].claimId }), current);
    }
  const f = createOwnershipClaimsFixture(), parsed = parseOwnershipClaimsPage(f.page, f.accountId);
  assert.equal(parsed.claims[1].state, 'VERIFIED'); assert.equal(parsed.claims[1].currentlyOwnedByYou, false);
  assert.equal(parsed.claims[7].card, null); assert.equal(parsed.claims[7].state, 'WITHDRAWN');
  assert.equal(parsed.total, undefined); assert.notEqual(parsed.claims, f.page.claims);
});

test('actual history projector keeps replacement/withdrawal and legacy origin distinct, with bounded exact cursors', async () => {
  for (const legacy of [false, true]) for (const state of ['PENDING', 'WITHDRAWN', 'VERIFIED', 'REJECTED']) {
    for (const [afterRevision, limit] of [[0, 25], [0, 1], [1, 1], [2, 1], [3, 25]]) {
      const f = createOwnershipClaimHistoryFixture({ legacy, state, afterRevision, limit });
      assert.deepEqual(parseOwnershipClaimHistory(f.history, CLAIM_ACCOUNT, f.request), f.history);
    }
  }
  const legacy = createOwnershipClaimHistoryFixture({ legacy: true, revision: 1, state: 'PENDING' });
  assert.deepEqual(parseOwnershipClaimHistory(legacy.history, CLAIM_ACCOUNT, legacy.request).transitions, []);
  const f = createOwnershipClaimHistoryFixture(); let seen;
  const read = createOwnershipClaimHistoryReader(async input => { seen = input; return response(f.history); });
  assert.deepEqual(await read({ accountId: CLAIM_ACCOUNT, ...f.request }), f.history);
  assert.deepEqual(Object.keys(seen).sort(), ['afterRevision', 'claimId', 'limit', 'signal']);
  for (const mutate of [v => { v.schema = 'atlas-ownership-claims-v1'; }, v => { v.transitions[1].claimRevision = 3; },
    v => { v.transitions[2].bundleId = claimFixtureId(42); }, v => { v.transitions[2].state = 'PENDING'; },
    v => { v.transitions[0].reviewerId = claimFixtureId(99); }, v => { v.transitions = []; }, v => { v.nextRevision = 3; },
    v => { v.origin = 'LEGACY_V1'; }, v => { v.claim.claimId = claimFixtureId(9); }]) {
    const changed = structuredClone(f.history); mutate(changed); assert.throws(() => parseOwnershipClaimHistory(changed, CLAIM_ACCOUNT, f.request));
  }
  await assert.rejects(read({ accountId: CLAIM_OTHER_ACCOUNT, ...f.request }), { code: 'OWNERSHIP_CLAIMS_ACCESS_ENDED' });
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

test('refuses v1 payloads, private extras, unbound approved card data and invented state', () => {
  const f = createOwnershipClaimsFixture({ count: 1 });
  for (const mutate of [v => { v.schema = 'atlas-ownership-claims-v1'; }, v => { v.actorId = CLAIM_ACCOUNT; }, v => { v.claims[0].ownerAccountId = CLAIM_OTHER_ACCOUNT; },
    v => { v.claims[0].card.cardId = claimFixtureId(99); }, v => { v.claims[0].card.report.publicHash = 'broken'; },
    v => { v.claims[0].claimRevision = 0; }, v => { v.claims[0].state = 'DECIDED'; }, v => { v.claims[0].requestId = claimFixtureId(99); },
    v => { v.claims[0].blockedReasons = ['DELETED']; }, v => { v.claims[0].blockedReasons = ['POLICY_CHANGED', 'POLICY_CHANGED']; },
    v => { v.claims[0].currentlyOwnedByYou = 'true'; }]) {
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
