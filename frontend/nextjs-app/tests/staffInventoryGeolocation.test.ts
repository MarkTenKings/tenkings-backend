import assert from 'node:assert/strict';
import test from 'node:test';
import { createStaffInventoryLocator, matchStaffInventoryLocation, staffInventoryLocationKind, type StaffIntakeLocation, type StaffLocationFix } from '../lib/staffInventoryGeolocation';
import { ONLINE_LOCATION_SLUG } from '../lib/locationUtils';

const NOW = 1_800_000_000_000;
const fix = (overrides: Partial<StaffLocationFix> = {}): StaffLocationFix => ({ latitude: 0, longitude: 0, accuracy: 20, timestamp: NOW, ...overrides });
const location = (id: string, overrides: Partial<StaffIntakeLocation> = {}): StaffIntakeLocation => ({ id, name: `Fixture ${id}`, slug: id, address: 'Disposable fixture address', locationType: 'store', latitude: 0, longitude: 0, ...overrides });
const signal = () => new AbortController().signal;
const deferred = <T>() => { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('GPS matches only one complete accuracy circle and never chooses the nearest ambiguous site', () => {
  const near = location('near'), far = location('far', { longitude: 1 });
  assert.equal(matchStaffInventoryLocation(fix(), [near, far], NOW).location, near);
  const ambiguous = matchStaffInventoryLocation(fix({ accuracy: 50 }), [near, location('overlapping', { longitude: 0.0016 })], NOW);
  assert.equal(ambiguous.location, null); assert.match(ambiguous.message, /more than one/);
  assert.equal(matchStaffInventoryLocation(fix(), [location('edge', { longitude: 0.00125 })], NOW).location, null);
  assert.equal(matchStaffInventoryLocation(fix(), [location('outside', { longitude: 0.02, geofenceRadiusM: 50_000 })], NOW).location, null, 'configured radii remain capped at 1 km');
  assert.equal(matchStaffInventoryLocation(fix(), [location('small', { geofenceRadiusM: 10 })], NOW).location, null);
});

test('inaccurate, invalid, stale and future GPS fixes remain manual with no fabricated point', () => {
  const sites = [location('known')];
  for (const override of [{ accuracy: 101 }, { accuracy: -1 }, { accuracy: NaN }, { latitude: Infinity }, { latitude: 91 }, { longitude: -181 }, { timestamp: NOW - 300_001 }, { timestamp: NOW + 30_001 }, { timestamp: NaN }]) {
    const result = matchStaffInventoryLocation(fix(override), sites, NOW);
    assert.equal(result.location, null); assert.match(result.message, /not precise enough/);
  }
  assert.equal(matchStaffInventoryLocation(fix({ accuracy: 100, timestamp: NOW - 300_000 }), sites, NOW).location, sites[0]);
  for (const sites of [[], [location('unknown', { latitude: null, longitude: null })], [location('online', { slug: ONLINE_LOCATION_SLUG })]]) {
    assert.equal(matchStaffInventoryLocation(fix(), sites, NOW).location, null);
  }
});

test('location custody type requires an explicit supported type or one held-stock kind', () => {
  const held = (kind: string, override = {}) => ({ location_id: 'site', custody_id: `${kind}:site`, quantity_kind: 'on_hand', ...override });
  for (const kind of ['hq', 'store', 'kiosk']) assert.equal(staffInventoryLocationKind(location('site', { locationType: kind }), [held('hq'), held('kiosk')]), kind);
  for (const locationType of ['arena', 'mall', 'casino', null, 'machine']) {
    const site = location('site', { locationType });
    assert.equal(staffInventoryLocationKind(site, []), '');
    assert.equal(staffInventoryLocationKind(site, [held('store'), held('store'), held('hq', { location_id: 'elsewhere' }), held('kiosk', { quantity_kind: 'loaded_roster' })]), 'store');
    assert.equal(staffInventoryLocationKind(site, [held('store'), held('kiosk')]), '');
    assert.equal(staffInventoryLocationKind(site, [held('machine'), held('transit'), held('hq', { custody_id: null })]), '');
  }
});

test('locator caches fresh fixes and successful address matches by exact location and address', async () => {
  let now = NOW, gps = 0, lookups = 0;
  const site = location('site', { latitude: null, longitude: null }), before = structuredClone(site);
  const locate = createStaffInventoryLocator({ now: () => now, getPosition: async () => { gps++; return fix({ timestamp: now }); }, resolvePoint: async id => { lookups++; assert.equal(id, site.id); return { latitude: 0, longitude: 0, coordinateSource: 'address_lookup' }; } });
  assert.equal((await locate([site], signal())).location?.coordinateSource, 'address_lookup');
  assert.equal((await locate([site], signal())).location?.id, site.id);
  assert.equal(gps, 1); assert.equal(lookups, 1); assert.deepEqual(site, before);
  await locate([{ ...site, address: 'Changed fixture address' }], signal()); assert.equal(lookups, 2);
  now += 300_001; await locate([site], signal()); assert.equal(gps, 2); assert.equal(lookups, 2);
  await locate([location('saved'), location('online', { slug: ONLINE_LOCATION_SLUG, latitude: null })], signal());
  assert.equal(lookups, 2, 'saved and online locations do not need address resolution');
});

test('an explicit retry obtains a fresh fix after an inaccurate result', async () => {
  let gps = 0;
  const locate = createStaffInventoryLocator({ now: () => NOW, getPosition: async () => fix({ accuracy: ++gps === 1 ? 500 : 10 }), resolvePoint: async () => { assert.fail('saved point'); } });
  assert.equal((await locate([location('site')], signal())).location, null);
  assert.equal((await locate([location('site')], signal(), true)).location?.id, 'site');
  assert.equal(gps, 2);
});

test('permission denial is requested only once per locator session until explicit retry', async () => {
  let gps = 0;
  const locate = createStaffInventoryLocator({ now: () => NOW, getPosition: async () => { if (++gps === 1) throw { code: 1 }; return fix(); }, resolvePoint: async () => { assert.fail('saved point'); } });
  assert.match((await locate([location('site')], signal())).message, /access is off/);
  assert.match((await locate([location('site')], signal())).message, /access is off/); assert.equal(gps, 1);
  assert.equal((await locate([location('site')], signal(), true)).location?.id, 'site');
  assert.equal((await locate([location('site')], signal())).location?.id, 'site'); assert.equal(gps, 2);
  const other = createStaffInventoryLocator({ now: () => NOW, getPosition: async () => { gps++; return fix(); }, resolvePoint: async () => null });
  await other([location('site')], signal()); assert.equal(gps, 3, 'a separate entry session has separate permission state');
});

test('a transient GPS failure stays manual and can recover without exposing provider details', async () => {
  let attempts = 0;
  const locate = createStaffInventoryLocator({ now: () => NOW, getPosition: async () => { if (++attempts === 1) throw { code: 2, message: 'private device detail' }; return fix(); }, resolvePoint: async () => null });
  const failed = await locate([location('site')], signal());
  assert.equal(failed.location, null); assert.match(failed.message, /could not find/); assert.ok(!failed.message.includes('private'));
  assert.equal((await locate([location('site')], signal())).location?.id, 'site'); assert.equal(attempts, 2);
});

test('pre-aborted attempts never request GPS or resolve a location', async () => {
  const controller = new AbortController(); controller.abort();
  const locate = createStaffInventoryLocator({ getPosition: async () => { assert.fail('aborted GPS request'); }, resolvePoint: async () => { assert.fail('aborted address request'); } });
  assert.deepEqual(await locate([location('site')], controller.signal), { location: null, message: '' });
});

test('a cancelled late GPS success cannot replace the next attempt cached position', async () => {
  let gps = 0; const first = deferred<StaffLocationFix>(), controller = new AbortController();
  const locate = createStaffInventoryLocator({ now: () => NOW, getPosition: () => ++gps === 1 ? first.promise : Promise.resolve(fix({ longitude: 1 })), resolvePoint: async () => null });
  const sites = [location('old'), location('current', { longitude: 1 })];
  const cancelled = locate(sites, controller.signal); controller.abort();
  assert.equal((await locate(sites, signal())).location?.id, 'current');
  first.resolve(fix()); assert.deepEqual(await cancelled, { location: null, message: '' });
  assert.equal((await locate(sites, signal())).location?.id, 'current'); assert.equal(gps, 2);
});

test('a cancelled late permission failure cannot poison the next attempt', async () => {
  let gps = 0; const first = deferred<StaffLocationFix>(), controller = new AbortController();
  const locate = createStaffInventoryLocator({ now: () => NOW, getPosition: () => ++gps === 1 ? first.promise : Promise.resolve(fix()), resolvePoint: async () => null });
  const sites = [location('site')], cancelled = locate(sites, controller.signal); controller.abort();
  assert.equal((await locate(sites, signal())).location?.id, 'site');
  first.reject({ code: 1 }); assert.deepEqual(await cancelled, { location: null, message: '' });
  assert.equal((await locate(sites, signal())).location?.id, 'site'); assert.equal(gps, 2);
});

test('unresolved or absent physical location points prevent a false unique match', async () => {
  let lookups = 0;
  const locate = createStaffInventoryLocator({ now: () => NOW, getPosition: async () => fix(), resolvePoint: async () => { lookups++; return null; } });
  for (const address of ['Unknown fixture address', '']) {
    const result = await locate([location('known'), location('unmapped', { latitude: null, longitude: null, address })], signal());
    assert.equal(result.location, null); assert.match(result.message, /could not be checked/);
  }
  assert.equal(lookups, 1, 'blank addresses are not submitted');
});

test('address resolution is bounded at three concurrent reads, validates points and retries failures', async () => {
  let active = 0, peak = 0, lookups = 0; const point = deferred<null>();
  const sites = Array.from({ length: 7 }, (_, i) => location(`site-${i}`, { latitude: null, longitude: null }));
  const locate = createStaffInventoryLocator({ now: () => NOW, getPosition: async () => fix(), resolvePoint: async () => { active++; peak = Math.max(peak, active); lookups++; await point.promise; active--; return null; } });
  const waiting = locate(sites, signal()); await Promise.resolve(); await Promise.resolve(); assert.equal(active, 3);
  point.resolve(null); assert.equal((await waiting).location, null); assert.equal(peak, 3); assert.equal(lookups, 7);
  let attempts = 0;
  const recovering = createStaffInventoryLocator({ now: () => NOW, getPosition: async () => fix(), resolvePoint: async () => {
    if (++attempts === 1) throw new Error('private provider detail');
    if (attempts === 2) return { latitude: 200, longitude: 0 };
    return { latitude: 0, longitude: 0, coordinateSource: 'address_lookup' };
  } });
  const failed = await recovering([sites[0]], signal()); assert.equal(failed.location, null); assert.ok(!failed.message.includes('private'));
  assert.equal((await recovering([sites[0]], signal())).location, null);
  assert.equal((await recovering([sites[0]], signal())).location?.id, sites[0].id); assert.equal(attempts, 3);
});

test('aborted address completion is not cached and later attempts resolve again', async () => {
  let lookups = 0; const first = deferred<{ latitude: number; longitude: number }>(), controller = new AbortController();
  const locate = createStaffInventoryLocator({ now: () => NOW, getPosition: async () => fix(), resolvePoint: async (_id, receivedSignal) => { lookups++; if (lookups === 1) { assert.equal(receivedSignal, controller.signal); return first.promise; } return { latitude: 0, longitude: 0 }; } });
  const sites = [location('site', { latitude: null, longitude: null })], cancelled = locate(sites, controller.signal);
  await Promise.resolve(); await Promise.resolve(); controller.abort(); first.resolve({ latitude: 0, longitude: 0 });
  assert.deepEqual(await cancelled, { location: null, message: '' });
  assert.equal((await locate(sites, signal())).location?.id, 'site'); assert.equal(lookups, 2);
});
