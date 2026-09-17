import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import type { NextApiRequest, NextApiResponse } from 'next';
import { createInventoryAdminSessionRequirement } from '../lib/server/inventoryAdmin';
import { HttpError, type AdminSession } from '../lib/server/adminSessionAuthority';
import {
  PROVIDER_QUALIFICATION_ACK, PROVIDER_QUALIFICATION_PLAN_HASH, PROVIDER_QUALIFICATION_COHORTS,
  qualifyStaffResearchProvider, providerQualificationHost,
} from '../lib/server/staffResearchProviderQualification';
import installedHandler, { createProviderQualificationHandler } from '../pages/api/v2/admin/inventory/provider-qualification';

const secret = 'fixture-provider-credential-never-return';
const item = { itemId: '111111111111', title: 'Fixture card', listingType: 'sold', soldPrice: '20.00', soldCurrency: 'USD', bestOfferAccepted: false,
  thumbnailUrl: 'https://i.ebayimg.com/images/g/fixture/s-l225.jpg', fullResThumbnailUrl: 'https://i.ebayimg.com/images/g/fixture/s-l1600.jpg' };
async function fixture(items: Record<string, unknown>[] = [item]) {
  const image = await sharp({ create: { width: 20, height: 28, channels: 3, background: 'blue' } }).jpeg().toBuffer();
  const calls: { url: string; init?: RequestInit }[] = [];
  const transport = async (url: string | URL | Request, init?: RequestInit) => {
    const uri = String(url); calls.push({ url: uri, init });
    if (uri.startsWith('https://api.sold-comps.com/v1/scrape?')) return Response.json({ keyword: new URL(uri).searchParams.get('keyword'), page: 1, items, totalItems: items.length, hasNextPage: false });
    if (uri.startsWith('https://api.sold-comps.com/v1/item/')) return Response.json({ itemId: uri.match(/item\/(\d+)/)![1], title: 'Fixture card', ended: true, bestOfferAccepted: false, private_unrequested: secret });
    return new Response(new Uint8Array(image), { headers: { 'content-type': 'image/jpeg' } });
  };
  return { image, calls, transport: transport as typeof fetch };
}

test('one fixed cohort makes at most one search/detail and two exact supplied image reads; key stays server-side', async () => {
  const f = await fixture();
  const fetchImpl = (async (url, init) => {
    const response = await f.transport(url, init);
    if (String(url).includes('/item/')) return Response.json({ itemId: item.itemId, title: 'Fixture card', ended: true, bestOfferAccepted: false });
    return response;
  }) as typeof fetch;
  const report = await qualifyStaffResearchProvider('sports_anniversary', { apiKey: secret, fetchImpl });
  assert.deepEqual(report.request_counts, { search: 1, detail: 1, image: 2 });
  assert.equal(report.search.status, 'observed'); assert.equal(report.detail?.status, 'observed');
  assert.ok(report.images.every(row => row.status === 'observed' && row.width === 20 && row.height === 28 && row.sha256?.length === 64));
  assert.equal(JSON.stringify(report).includes(secret), false);
  assert.equal(report.coverage.hydrated_offer, 0); assert.equal(report.coverage.explicit_no_offer, 1);
  for (const call of f.calls) {
    assert.equal(call.init?.redirect, 'error');
    const headers = call.init?.headers as Record<string, string>;
    assert.equal(headers.Authorization, call.url.startsWith('https://api.sold-comps.com/') ? `Bearer ${secret}` : undefined);
  }
});

test('coverage observes missing, active and offer fields independently, without inventing requested cohorts', async () => {
  const f = await fixture([
    { itemId: '111111111111', listingType: 'sold', bestOfferAccepted: null },
    { itemId: '111111111112', listingType: 'active', bestOfferAccepted: true, boaHydrated: true },
    { itemId: '111111111113', bestOfferAccepted: true },
  ]);
  const report = await qualifyStaffResearchProvider('active_control', { apiKey: secret, fetchImpl: f.transport });
  assert.equal(new URL(f.calls[0].url).searchParams.get('sold'), 'false');
  assert.deepEqual(report.coverage, { explicit_sold: 1, active: 1, unknown_status: 1, explicit_no_offer: 0, missing_offer_flag: 1, hydrated_offer: 1, undisclosed_offer: 1 });
  assert.equal(report.detail?.requested_item_id, '111111111112');
  assert.equal(report.images.length, 0);
});

test('failed auth/rate-limit/provider responses never schedule detail/images or leak bodies', async () => {
  for (const status of [401, 429, 500]) {
    let count = 0;
    const report = await qualifyStaffResearchProvider('pokemon', { apiKey: secret, fetchImpl: (async () => { count++; return new Response(secret, { status }); }) as typeof fetch });
    assert.equal(count, 1); assert.equal(report.search.status, 'failed'); assert.equal(JSON.stringify(report).includes(secret), false);
  }
});

test('wrong-query, escaped credential, oversized or redirected source bodies fail closed', async () => {
  const payload = { keyword: PROVIDER_QUALIFICATION_COHORTS[1].keyword, page: 1, totalItems: 0, hasNextPage: false, items: [] };
  for (const response of [
    Response.json({ ...payload, keyword: 'foreign query' }),
    new Response(JSON.stringify({ ...payload, extra: secret }).replace('fixture', '\\u0066ixture'), { headers: { 'content-type': 'application/json' } }),
    new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': String(6 * 1024 * 1024) } }),
    new Response(null, { status: 302, headers: { location: 'https://other.example' } }),
  ]) {
    let count = 0; const report = await qualifyStaffResearchProvider('pokemon', { apiKey: secret, fetchImpl: (async () => { count++; return response; }) as typeof fetch });
    assert.equal(count, 1); assert.equal(report.search.status, 'failed'); assert.equal(JSON.stringify(report).includes(secret), false);
  }
});

test('hanging fetch is bounded even when injected transport ignores abort', async () => {
  const started = Date.now();
  const report = await qualifyStaffResearchProvider('pokemon', { apiKey: secret, timeoutMs: 15, fetchImpl: (() => new Promise(() => {})) as typeof fetch });
  assert.equal(report.search.status, 'failed'); assert.ok(Date.now() - started < 1000);
  assert.deepEqual(report.request_counts, { search: 1, detail: 0, image: 0 });
});

test('a stalled response body is cancelled within the same timeout', async () => {
  let cancelled = false;
  const report = await qualifyStaffResearchProvider('pokemon', { apiKey: secret, timeoutMs: 15, fetchImpl: (async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-type': 'application/json' } })) as typeof fetch });
  assert.equal(report.search.status, 'failed'); assert.equal(cancelled, true);
  assert.deepEqual(report.request_counts, { search: 1, detail: 0, image: 0 });
});

test('unsafe URLs, wrong detail identity, MIME mismatch and invalid image bytes cannot produce image evidence', async () => {
  const unsafe = await fixture([{ ...item, fullResThumbnailUrl: 'https://seller.example/image.jpg' }]);
  const omitted = await qualifyStaffResearchProvider('pokemon', { apiKey: secret, fetchImpl: unsafe.transport });
  assert.equal(omitted.request_counts.image, 0);
  const f = await fixture();
  const report = await qualifyStaffResearchProvider('pokemon', { apiKey: secret, fetchImpl: (async (url, init) => {
    if (String(url).includes('/item/')) return Response.json({ itemId: '111111111112' });
    if (String(url).startsWith('https://i.ebayimg.com')) return new Response(new Uint8Array(f.image), { headers: { 'content-type': 'image/png' } });
    return f.transport(url, init);
  }) as typeof fetch });
  assert.equal(report.detail?.status, 'failed'); assert.ok(report.images.every(row => row.status === 'failed' && !row.sha256));
});

const actor: AdminSession = { sessionId: 'fixture-session', tokenHash: 'fixture-hash', authority: 'auth-service', expiresAt: new Date('2099-01-01'), user: { id: 'fixture-admin', phone: null, displayName: null } };
const body = { cohort: 'pokemon', plan_sha256: PROVIDER_QUALIFICATION_PLAN_HASH, acknowledge: PROVIDER_QUALIFICATION_ACK };
const env = { NODE_ENV: 'production', STAFF_RESEARCH_PROVIDER_QUALIFICATION_ENABLED: 'true', SOLDCOMPS_API_KEY: secret };
const request = (patch: Partial<NextApiRequest> = {}) => ({ method: 'POST', body, query: {}, headers: { host: 'collect.tenkings.co', authorization: 'Bearer fixture-human', origin: 'https://collect.tenkings.co', 'content-type': 'application/json' }, ...patch } as NextApiRequest);
function response() {
  const result = { code: 0, body: undefined as any, headers: {} as Record<string, string> };
  const res = { setHeader(k: string, v: string) { result.headers[k] = v; }, status(code: number) { result.code = code; return this; }, json(value: unknown) { result.body = value; return this; } } as unknown as NextApiResponse;
  return { result, res };
}
test('API requires human auth before plan/gate disclosure; operator and expired authority never invoke provider', async () => {
  const auth = createInventoryAdminSessionRequirement({ readTokenHash: () => undefined, requireAdmin: async () => actor });
  for (const [requireAdmin, req, expected] of [
    [async () => { throw new HttpError(401, secret); }, request({ method: 'GET' }), 401],
    [auth, request({ headers: { ...request().headers, 'x-operator-key': 'forged' } }), 403],
    [async () => ({ ...actor, authority: 'operator-key' as const }), request(), 401],
    [async () => ({ ...actor, expiresAt: new Date(0) }), request(), 401],
    [async () => ({ ...actor, expiresAt: new Date('invalid') }), request(), 401],
  ] as const) {
    const route = createProviderQualificationHandler({ requireAdmin, env: () => env, run: async () => assert.fail('unauthorized provider') });
    const out = response(); await route(req, out.res); assert.equal(out.result.code, expected); assert.equal(JSON.stringify(out.result.body).includes(secret), false);
  }
});
test('installed endpoint rejects anonymous and static operator requests before runtime credentials or database access', async () => {
  for (const [headers, expected] of [[{ host: 'collect.tenkings.co' }, 401], [{ host: 'collect.tenkings.co', 'x-operator-key': 'fixture-operator' }, 403]] as const) {
    const out = response(); await installedHandler(request({ method: 'GET', headers }), out.res); assert.equal(out.result.code, expected);
  }
});
test('GET is provider-free and disabled execution cannot be bypassed by a valid acknowledgment', async () => {
  const route = createProviderQualificationHandler({ requireAdmin: async () => actor, env: () => ({ ...env, STAFF_RESEARCH_PROVIDER_QUALIFICATION_ENABLED: undefined }), run: async () => assert.fail('disabled provider') });
  const get = response(); await route(request({ method: 'GET' }), get.res); assert.equal(get.result.code, 200); assert.equal(get.result.body.enabled, false);
  assert.equal(get.result.headers['Cache-Control'], 'private, no-store'); assert.equal(JSON.stringify(get.result.body).includes(secret), false);
  const post = response(); await route(request(), post.res); assert.equal(post.result.code, 503);
});
test('POST rejects extra URLs, stale plan, missing acknowledgment/origin, arbitrary host and methods before provider', async () => {
  const route = createProviderQualificationHandler({ requireAdmin: async () => actor, env: () => env, run: async () => assert.fail('invalid provider') });
  for (const [req, expected] of [
    [request({ body: { ...body, url: 'https://attacker.example' } }), 400], [request({ body: { ...body, plan_sha256: '0'.repeat(64) } }), 400],
    [request({ body: { ...body, acknowledge: '' } }), 400], [request({ body: { ...body, cohort: 'other' } }), 400],
    [request({ query: { key: 'forged' } }), 400], [request({ headers: { ...request().headers, origin: undefined } }), 403],
    [request({ headers: { ...request().headers, host: 'tenkings.co' } }), 404], [request({ method: 'DELETE' }), 405],
  ] as const) { const out = response(); await route(req, out.res); assert.equal(out.result.code, expected); }
  assert.equal(providerQualificationHost('collect.tenkings.co.attacker.example', true), false);
  assert.equal(providerQualificationHost('localhost:3000', true), false);
});
test('explicit authorized execution is one run; overlap and cooldown do not repeat paid work', async () => {
  let calls = 0, release: () => void = () => {};
  const deferred = new Promise<void>(resolve => { release = resolve; });
  const route = createProviderQualificationHandler({ requireAdmin: async () => actor, env: () => env, run: async (cohort, options) => {
    calls++; assert.equal(cohort, 'pokemon'); assert.equal(options.apiKey, secret); await deferred; return { schema_version: 2 } as any;
  } });
  const first = response(), promise = route(request(), first.res);
  await Promise.resolve(); await Promise.resolve();
  const overlap = response(); await route(request(), overlap.res); assert.equal(overlap.result.code, 429);
  release(); await promise; assert.equal(first.result.code, 200);
  const repeat = response(); await route(request(), repeat.res); assert.equal(repeat.result.code, 429); assert.equal(calls, 1);
});
