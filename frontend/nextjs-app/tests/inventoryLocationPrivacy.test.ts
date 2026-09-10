import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@tenkings/database';
import { Prisma } from '@prisma/client';
import { ADMIN_USER_IDS } from '../constants/admin';
import { HttpError } from '../lib/server/adminSessionAuthority';
import { createInventoryAdminSessionRequirement } from '../lib/server/inventoryAdmin';
import { isInternalLocation } from '../lib/locationVisibility';
import { listActiveKingsHuntLocations, getKingsHuntLocationBySlug, detectKingsHuntLocations } from '../lib/server/kingsHunt';
import { createAdminLocationsHandler } from '../pages/api/admin/locations';
import locationsHandler from '../pages/api/locations';
import detailHandler from '../pages/api/locations/[locationId]';
import statusHandler from '../pages/api/locations/[locationId]/status';
import liveStatusHandler from '../pages/api/locations/[locationId]/live-status';
import photoHandler from '../pages/api/location-photo/[slug]';
import huntDetailHandler from '../pages/api/kingshunt/[slug]';
import huntDetectHandler from '../pages/api/kingshunt/detect';
import huntSessionHandler from '../pages/api/kingshunt/session';
import huntCheckpointHandler from '../pages/api/kingshunt/checkpoint';
import kioskDisplayHandler from '../pages/api/kiosk/display';

const UUID = '11111111-1111-4111-8111-111111111111';
const SECOND = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'fixture-mobile-admin-token';
const ADMIN = { sessionId: 'fixture-session', tokenHash: createHash('sha256').update(TOKEN).digest('hex'), authority: 'local-database' as const, user: { id: 'fixture-location-admin', phone: '+15555550100', displayName: 'Fixture admin' } };
const HQ = { id: UUID, name: 'Fixture private HQ', slug: 'fixture-private-hq', address: 'Fixture private address', locationType: 'hq', locationStatus: 'internal', machinePhotoUrl: 'https://fixture.invalid/private-photo', recentRips: [], landmarks: [], liveRips: [] };
const PUBLIC = { ...HQ, id: SECOND, name: 'Fixture shop', slug: 'fixture-shop', address: 'Fixture public address', locationType: 'store', locationStatus: 'active', latitude: 1, longitude: 1, city: 'Fixture city', state: 'CA', zip: '00000', mapsUrl: 'https://fixture.invalid/map' };
const request = (method = 'GET', body?: unknown, query: Record<string, string> = {}, headers: Record<string, string> = {}) => ({ method, body, query, headers } as NextApiRequest);
function response() {
  const result = { code: 0, body: undefined as any, headers: {} as Record<string, string> };
  const res = { setHeader(name: string, value: string) { result.headers[name] = value; }, status(code: number) { result.code = code; return this; }, json(body: unknown) { result.body = body; return this; } } as unknown as NextApiResponse;
  return { result, res };
}
function stubDelegate(t: TestContext, delegate: any, method: string, implementation: (...args: any[]) => any) {
  const original = delegate[method];
  const stub = t.mock.fn(implementation);
  // Prisma delegates are dynamic proxies, not ordinary own-method descriptors.
  delegate[method] = stub;
  t.after(() => { delegate[method] = original; });
  return stub;
}
function allowAdmin(t: TestContext) {
  ADMIN_USER_IDS.push(ADMIN.user.id);
  t.after(() => ADMIN_USER_IDS.splice(ADMIN_USER_IDS.indexOf(ADMIN.user.id), 1));
  stubDelegate(t, prisma.session, 'findUnique', async () => ({ id: ADMIN.sessionId, tokenHash: ADMIN.tokenHash, user: ADMIN.user, createdAt: new Date('2026-01-01T00:00:00Z'), expiresAt: new Date('2099-01-01T00:00:00Z') }));
  return { authorization: `Bearer ${TOKEN}` };
}
const uniqueConflict = () => new Prisma.PrismaClientKnownRequestError('Fixture unique collision', { code: 'P2002', clientVersion: 'fixture' });
const locationBody = (overrides = {}) => ({ action: 'location', request_id: UUID, inventoryRequestId: UUID, inventoryKind: 'hq', name: HQ.name, address: HQ.address, ...overrides });
function locationStore() {
  const rows = new Map<string, any>();
  let creates = 0, geocodes = 0;
  const deps: Parameters<typeof createAdminLocationsHandler>[0] = {
    requireAdmin: async () => ADMIN,
    locations: {
      async findUnique({ where }: any) { return rows.get(where.id) ?? null; },
      async findMany() { return [...rows.values()]; },
      async create({ data }: any) {
        if (rows.has(data.id) || [...rows.values()].some(row => row.slug === data.slug)) throw uniqueConflict();
        creates++;
        const row = { ...data }; rows.set(data.id, row);
        return { id: row.id, name: row.name, slug: row.slug, address: row.address };
      },
    } as unknown as Pick<typeof prisma.location, 'findMany' | 'findUnique' | 'create'>,
    geocode: async () => { geocodes++; return null; },
  };
  return { deps, rows, counts: () => ({ creates, geocodes }) };
}

test('simultaneous exact HQ creation retries return one row and one recorded outcome', async () => {
  const store = locationStore(), handler = createAdminLocationsHandler(store.deps);
  const outputs = [response(), response()];
  await Promise.all(outputs.map(output => handler(request('POST', locationBody()), output.res)));
  assert.deepEqual(outputs.map(o => o.result.code).sort(), [200, 201]);
  assert.deepEqual(outputs.map(o => o.result.body.outcome).sort(), ['RECORDED', 'REPLAY']);
  assert.deepEqual(outputs[0].result.body.location, outputs[1].result.body.location);
  assert.deepEqual(store.counts(), { creates: 1, geocodes: 0 });
  const row = store.rows.get(UUID);
  assert.equal(row.locationType, 'hq'); assert.equal(row.locationStatus, 'internal');
  assert.equal(row.latitude, null); assert.equal(row.longitude, null); assert.equal(row.geofenceRadiusM, null); assert.equal(row.machineGeofenceM, null);
  for (const output of outputs) assert.equal(output.result.headers['Cache-Control'], 'private, no-store');
  const retry = response(); await handler(request('POST', locationBody()), retry.res); assert.equal(retry.result.body.outcome, 'REPLAY');
});

test('location retries reject changed intent, slug collisions and incomplete retry identity', async () => {
  const store = locationStore(), handler = createAdminLocationsHandler(store.deps);
  const outputs = [response(), response()];
  await Promise.all(outputs.map((output, index) => handler(request('POST', locationBody(index ? { address: 'Different fixture address' } : {})), output.res)));
  assert.deepEqual(outputs.map(o => o.result.code).sort(), [201, 409]); assert.equal(store.counts().creates, 1);
  const collision = response(); await handler(request('POST', locationBody({ request_id: SECOND, inventoryRequestId: SECOND })), collision.res); assert.equal(collision.result.code, 409); assert.equal(store.counts().creates, 1);
  for (const changes of [{ inventoryRequestId: undefined }, { inventoryKind: undefined }, { request_id: SECOND }, { latitude: 1 }, { inventoryRequestId: undefined, request_id: undefined, action: undefined }]) {
    const invalid = response(); await handler(request('POST', locationBody(changes)), invalid.res); assert.equal(invalid.result.code, 400);
  }
  assert.equal(store.counts().creates, 1);
});

test('admin location creation rejects anonymous and read-only capability calls before storage', async () => {
  const store = locationStore();
  store.deps.requireAdmin = async () => { throw new HttpError(401, 'Sign in'); };
  const denied = response(); await createAdminLocationsHandler(store.deps)(request('POST', locationBody()), denied.res); assert.equal(denied.result.code, 401);
  const readToken = 'fixture-location-financial-token-'.repeat(2), hash = createHash('sha256').update(readToken).digest('hex');
  store.deps.requireAdmin = createInventoryAdminSessionRequirement({ readTokenHash: () => hash, requireAdmin: async () => ADMIN });
  const reader = response(); await createAdminLocationsHandler(store.deps)(request('POST', locationBody(), {}, { authorization: `Bearer ${readToken}` }), reader.res); assert.equal(reader.result.code, 403);
  assert.equal(store.counts().creates, 0);
});

test('all public location and Kings Hunt list/detect/detail reads exclude HQ regardless of status/casing', async t => {
  const internalRows = [HQ, { ...HQ, locationType: ' HQ ', locationStatus: 'active' }, { ...HQ, locationType: 'store', locationStatus: ' INTERNAL ' }];
  let current = HQ;
  stubDelegate(t, prisma.location, 'findMany', async () => [PUBLIC, ...internalRows]);
  stubDelegate(t, prisma.location, 'findUnique', async () => current);
  const calls = t.mock.method(globalThis, 'fetch', async () => { assert.fail('private addresses must never reach a vendor'); });
  const all = response(); await locationsHandler(request('GET', undefined, { includeInactive: 'true' }), all.res);
  assert.equal(all.result.code, 200); assert.deepEqual(all.result.body.locations.map((l: any) => l.id), [PUBLIC.id]);
  const hqFilter = response(); await locationsHandler(request('GET', undefined, { includeInactive: 'true', locationType: 'hq' }), hqFilter.res);
  assert.ok(hqFilter.result.body.locations.every((l: any) => !isInternalLocation(l)));
  assert.deepEqual((await listActiveKingsHuntLocations()).map(l => l.id), [PUBLIC.id]);
  assert.deepEqual((await detectKingsHuntLocations(1, 1)).detected.map(l => l.locationId), [PUBLIC.id]);
  for (const privateRow of internalRows) {
    current = privateRow;
    assert.equal(await getKingsHuntLocationBySlug(HQ.slug), null);
    for (const query of [{ locationId: HQ.slug }, { locationId: HQ.id }]) {
      const detail = response(); await detailHandler(request('GET', undefined, query), detail.res); assert.equal(detail.result.code, 404); assert.equal(detail.result.headers['Cache-Control'], 'private, no-store');
    }
    const hunt = response(); await huntDetailHandler(request('GET', undefined, { slug: HQ.slug }), hunt.res); assert.equal(hunt.result.code, 404);
    const photo = response(); await photoHandler(request('GET', undefined, { slug: HQ.slug }), photo.res); assert.equal(photo.result.code, 404);
    const live = response(); await liveStatusHandler(request('GET', undefined, { locationId: HQ.slug }), live.res); assert.equal(live.result.code, 404);
  }
  assert.equal(calls.mock.callCount(), 0);
  const detection = response(); await huntDetectHandler(request('POST', { lat: 1, lng: 1 }), detection.res); assert.equal(detection.result.headers['Cache-Control'], 'private, no-store');
});

test('cached public live status cannot bypass a later internal-location change', async t => {
  let current = { ...PUBLIC, locationType: 'event', slug: 'fixture-cache-transition' };
  stubDelegate(t, prisma.location, 'findUnique', async () => current);
  const initial = response(); await liveStatusHandler(request('GET', undefined, { locationId: current.slug }), initial.res); assert.equal(initial.result.code, 200);
  current = { ...current, locationStatus: 'internal' };
  const hidden = response(); await liveStatusHandler(request('GET', undefined, { locationId: current.slug }), hidden.res); assert.equal(hidden.result.code, 404); assert.equal(hidden.result.headers['Cache-Control'], 'private, no-store');
});

test('HQ detail requires the mobile allowlist and edits preserve privacy under concurrent flag changes', async t => {
  const headers = allowAdmin(t);
  let row = { ...HQ };
  let staleFlags = false;
  stubDelegate(t, prisma.location, 'findUnique', async () => row);
  const updates = stubDelegate(t, prisma.location, 'update', async ({ where, data }: any) => {
    if (staleFlags) throw new Prisma.PrismaClientKnownRequestError('Fixture stale flags', { code: 'P2025', clientVersion: 'fixture' });
    assert.equal(where.locationType, row.locationType); assert.equal(where.locationStatus, row.locationStatus);
    row = { ...row, ...data }; return row;
  });
  const detail = response(); await detailHandler(request('GET', undefined, { locationId: HQ.slug }, headers), detail.res); assert.equal(detail.result.code, 200); assert.equal(detail.result.body.id, HQ.id);
  const publish = response(); await detailHandler(request('PUT', { locationType: 'store', locationStatus: 'active' }, { locationId: HQ.slug }, headers), publish.res); assert.equal(publish.result.code, 400); assert.equal(updates.mock.callCount(), 0);
  const stillPrivate = response(); await detailHandler(request('PUT', { locationStatus: 'active' }, { locationId: HQ.slug }, headers), stillPrivate.res); assert.equal(stillPrivate.result.code, 200); assert.equal(isInternalLocation(row), true);
  const removeLastFlag = response(); await detailHandler(request('PUT', { locationType: 'store' }, { locationId: HQ.slug }, headers), removeLastFlag.res); assert.equal(removeLastFlag.result.code, 400);
  row = { ...HQ, locationType: 'store' };
  const publishStatus = response(); await statusHandler(request('PATCH', { status: 'active' }, { locationId: HQ.slug }, headers), publishStatus.res); assert.equal(publishStatus.result.code, 400);
  assert.equal(updates.mock.callCount(), 1);
  staleFlags = true;
  const stale = response(); await detailHandler(request('PUT', { name: 'Changed fixture label' }, { locationId: HQ.slug }, headers), stale.res); assert.equal(stale.result.code, 409);
});

test('all location mutation entry points deny operator keys before any write', async t => {
  const write = stubDelegate(t, prisma.location, 'create', async () => { assert.fail('operator cannot create locations'); });
  const update = stubDelegate(t, prisma.location, 'update', async () => { assert.fail('operator cannot change locations'); });
  const read = stubDelegate(t, prisma.location, 'findUnique', async () => { assert.fail('operator cannot reach location write lookup'); });
  for (const [handler, method] of [[locationsHandler, 'POST'], [detailHandler, 'PUT'], [statusHandler, 'PATCH']] as const) {
    const output = response(); await handler(request(method, locationBody(), { locationId: HQ.slug }, { 'x-operator-key': 'fixture' }), output.res);
    assert.equal(output.result.code, 403); assert.equal(output.result.headers['Cache-Control'], 'private, no-store');
  }
  assert.equal(write.mock.callCount() + update.mock.callCount() + read.mock.callCount(), 0);
});

test('HQ cannot be probed through kiosk display or Kings Hunt sessions/checkpoints', async t => {
  stubDelegate(t, prisma.location, 'findUnique', async () => HQ);
  stubDelegate(t, prisma.location, 'findFirst', async () => HQ);
  stubDelegate(t, prisma.navigationSession, 'findUnique', async () => ({ location: HQ }));
  const creates = stubDelegate(t, prisma.navigationSession, 'create', async () => { assert.fail('private navigation session'); });
  const updates = stubDelegate(t, prisma.navigationSession, 'update', async () => { assert.fail('private navigation update'); });
  const visits = stubDelegate(t, prisma.locationVisit, 'create', async () => { assert.fail('private visit'); });
  const sessions = stubDelegate(t, prisma.kioskSession, 'findFirst', async () => { assert.fail('private kiosk session'); });
  for (const body of [{ locationId: HQ.id, entryMethod: 'manual' }, { sessionId: 'fixture-existing' }]) {
    const output = response(); await huntSessionHandler(request('POST', body), output.res); assert.equal(output.result.code, 404);
  }
  const checkpoint = response(); await huntCheckpointHandler(request('POST', { sessionId: 'fixture-existing', checkpointId: 'fixture-point', checkpointsReached: 1 }), checkpoint.res); assert.equal(checkpoint.result.code, 404);
  const display = response(); await kioskDisplayHandler(request('GET', undefined, { slug: HQ.slug }), display.res); assert.equal(display.result.code, 404);
  assert.equal(creates.mock.callCount() + updates.mock.callCount() + visits.mock.callCount() + sessions.mock.callCount(), 0);
});
