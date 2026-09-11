import assert from 'node:assert/strict';
import test from 'node:test';
import type { NextApiRequest, NextApiResponse } from 'next';
import { createInventoryLocationMapHandler } from '../pages/api/v2/admin/inventory/location-map';
import { HttpError, type AdminSession } from '../lib/server/adminSessionAuthority';
import { createInventoryAdminSessionRequirement } from '../lib/server/inventoryAdmin';
import { geocodeLocationAddress } from '../lib/server/locationGeocoding';
import { createHash } from 'node:crypto';
import { ONLINE_LOCATION_SLUG } from '../lib/locationUtils';
import { createStaffInventoryLocator } from '../lib/staffInventoryGeolocation';
import { parseStaffInventoryMapPointResponse } from '../lib/staffInventoryLocationsMap';

const id = '11111111-1111-4111-8111-111111111111';
const admin = { sessionId: 'fixture-admin', tokenHash: 'fixture-hash', authority: 'auth-service', user: { id: 'fixture-admin' } } as AdminSession;
type Deps = Parameters<typeof createInventoryLocationMapHandler>[0];
function setup(overrides: Partial<Deps> = {}) {
  let reads = 0, geocodes = 0;
  const deps: Deps = {
    requireAdmin: async () => admin,
    readLocation: async requested => { reads++; assert.equal(requested, id); return { id, slug: 'internal-hq', address: 'Private fixture address', latitude: null, longitude: null }; },
    geocode: async (address, options) => { geocodes++; assert.equal(address, 'Private fixture address'); assert.equal(options?.requireCompleteMatch, true); assert.ok(options?.signal); return { latitude: 38.5, longitude: -121.5, city: null, state: null, zip: null, mapsUrl: null }; },
    ...overrides,
  };
  return { deps, counts: () => ({ reads, geocodes }) };
}
async function call(deps: Deps, options: { method?: string; query?: unknown; headers?: unknown } = {}) {
  const output = { code: 0, body: undefined as any, headers: {} as Record<string, string> };
  const res = { setHeader(key: string, value: string) { output.headers[key] = value; }, status(code: number) { output.code = code; return this; }, json(body: unknown) { output.body = body; return this; } } as unknown as NextApiResponse;
  await createInventoryLocationMapHandler(deps)({ method: options.method ?? 'GET', query: options.query ?? { location_id: id }, headers: options.headers ?? { authorization: 'Bearer fixture-admin' } } as NextApiRequest, res);
  assert.equal(output.headers['Cache-Control'], 'private, no-store');
  assert.equal(output.headers['X-Robots-Tag'], 'noindex, nofollow');
  return output;
}

test('internal HQ map points require a human inventory admin before any data/provider access', async () => {
  for (const status of [401, 403]) {
    const s = setup({ requireAdmin: async () => { throw new HttpError(status, 'Private forbidden details'); } });
    const output = await call(s.deps);
    assert.equal(output.code, status); assert.deepEqual(s.counts(), { reads: 0, geocodes: 0 });
    assert.ok(!JSON.stringify(output).includes('Private forbidden details'));
  }
  const financial = 'fixture-financial-read-token-'.repeat(2);
  const s = setup({ requireAdmin: createInventoryAdminSessionRequirement({ readTokenHash: () => createHash('sha256').update(financial).digest('hex'), requireAdmin: async () => admin }) });
  for (const headers of [{ authorization: `Bearer ${financial}` }, { authorization: 'Bearer fixture-admin', 'x-operator-key': 'fixture' }]) {
    assert.equal((await call(s.deps, { headers })).code, 403);
  }
  assert.deepEqual(s.counts(), { reads: 0, geocodes: 0 });
});

test('map lookup accepts only GET with one existing location ID, never an arbitrary geocode address', async () => {
  const s = setup();
  assert.equal((await call(s.deps, { method: 'POST' })).code, 405);
  for (const query of [{}, { location_id: [id] }, { location_id: 'bad' }, { location_id: id, address: 'Attacker-selected query' }]) assert.equal((await call(s.deps, { query })).code, 400);
  assert.deepEqual(s.counts(), { reads: 0, geocodes: 0 });
});

test('saved coordinate pairs bypass the provider, including legitimate zero coordinates', async () => {
  const s = setup({ readLocation: async () => ({ id, slug: 'fixture', address: null, latitude: 0, longitude: 0 }) });
  const output = await call(s.deps);
  assert.equal(output.code, 200); assert.deepEqual(output.body.point, { latitude: 0, longitude: 0, coordinateSource: 'saved' });
  assert.equal(s.counts().geocodes, 0);
});

test('a private address may resolve after authorization with explicit address-lookup provenance', async () => {
  const s = setup(); const output = await call(s.deps);
  assert.equal(output.code, 200); assert.deepEqual(output.body, { location_id: id, point: { latitude: 38.5, longitude: -121.5, coordinateSource: 'address_lookup' } });
  assert.deepEqual(s.counts(), { reads: 1, geocodes: 1 });
});

test('the actual authenticated location-map response feeds the intake matcher without coordinate renaming', async () => {
  const s = setup(); const now = Date.now();
  const locate = createStaffInventoryLocator({ now: () => now, getPosition: async () => ({ latitude: 38.5, longitude: -121.5, accuracy: 120, timestamp: now }), resolvePoint: async requested => {
    const output = await call(s.deps, { query: { location_id: requested } });
    assert.equal(output.code, 200); return parseStaffInventoryMapPointResponse(requested, output.body);
  } });
  const result = await locate([{ id, name: 'Fixture HQ', slug: 'internal-hq', address: 'Private fixture address', locationType: 'hq' }], new AbortController().signal);
  assert.equal(result.location?.id, id); assert.equal(result.location?.coordinateSource, 'address_lookup'); assert.equal(result.confidence, 'contained'); assert.equal(result.accuracyM, 120);
  assert.deepEqual(s.counts(), { reads: 1, geocodes: 1 });
});

test('missing, online, and addressless locations do not geocode', async () => {
  for (const location of [null, { id, slug: ONLINE_LOCATION_SLUG, address: 'Not a physical location', latitude: 2, longitude: 2 }, { id, slug: 'fixture', address: ' ', latitude: null, longitude: null }]) {
    const s = setup({ readLocation: async () => location }); const output = await call(s.deps);
    assert.equal(output.code, location ? 200 : 404); assert.equal(s.counts().geocodes, 0);
    if (location) assert.equal(output.body.point, null);
  }
});

test('provider failure or malformed coordinates never produces a fabricated point or exposes details', async () => {
  for (const result of [null, { latitude: NaN, longitude: 0 }, { latitude: 100, longitude: 0 }, { latitude: 0, longitude: Infinity }]) {
    const s = setup({ geocode: async () => result as any }); const output = await call(s.deps);
    assert.equal(output.code, 200); assert.equal(output.body.point, null);
  }
  const s = setup({ geocode: async () => { throw new Error('secret-provider-key'); } }); const output = await call(s.deps);
  assert.equal(output.code, 503); assert.ok(!JSON.stringify(output).includes('secret-provider-key'));
});

test('strict address lookup rejects partial matches and malformed geometry, forwards cancellation', async t => {
  const oldFetch = globalThis.fetch, oldKey = process.env.GOOGLE_MAPS_API_KEY;
  process.env.GOOGLE_MAPS_API_KEY = 'fixture-key';
  t.after(() => { globalThis.fetch = oldFetch; if (oldKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY; else process.env.GOOGLE_MAPS_API_KEY = oldKey; });
  const controller = new AbortController();
  let body: any = { status: 'OK', results: [{ geometry: { location: { lat: 38, lng: -121 } } }] };
  globalThis.fetch = async (_url, options) => { assert.equal(options?.signal, controller.signal); return { ok: true, json: async () => body } as Response; };
  assert.equal((await geocodeLocationAddress('Fixture address', { signal: controller.signal, requireCompleteMatch: true }))?.latitude, 38);
  for (const result of [{ status: 'ZERO_RESULTS', results: [] }, { status: 'OK', results: [{ partial_match: true, geometry: { location: { lat: 38, lng: -121 } } }] }, { status: 'OK', results: [{ geometry: { location: { lat: Infinity, lng: 5 } } }] }]) {
    body = result; assert.equal(await geocodeLocationAddress('Fixture address', { signal: controller.signal, requireCompleteMatch: true }), null);
  }
});
