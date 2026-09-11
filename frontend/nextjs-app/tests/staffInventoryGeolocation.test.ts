import assert from 'node:assert/strict';
import test from 'node:test';
import { createStaffInventoryLocator, matchStaffInventoryLocation, staffInventoryLocationKind, type StaffIntakeLocation, type StaffLocationFix, type StaffLocationProgress } from '../lib/staffInventoryGeolocation';
import { ONLINE_LOCATION_SLUG } from '../lib/locationUtils';
import { createStaffInventoryPointCache, parseStaffInventoryMapPointResponse } from '../lib/staffInventoryLocationsMap';

const NOW = 1_800_000_000_000;
const fix = (overrides: Partial<StaffLocationFix> = {}): StaffLocationFix => ({ latitude: 0, longitude: 0, accuracy: 20, timestamp: NOW, ...overrides });
const location = (id: string, overrides: Partial<StaffIntakeLocation> = {}): StaffIntakeLocation => ({ id, name: `Fixture ${id}`, slug: id, address: 'Disposable fixture address', locationType: 'store', latitude: 0, longitude: 0, ...overrides });
const signal = () => new AbortController().signal;
const deferred = <T>() => { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('GPS distinguishes contained and editable nearby suggestions without choosing an ambiguous site', () => {
  const near = location('near'), far = location('far', { longitude: 1 });
  const contained = matchStaffInventoryLocation(fix(), [near, far], NOW);
  assert.equal(contained.location, near); assert.equal(contained.confidence, 'contained'); assert.equal(contained.status, 'matched');
  const ambiguous = matchStaffInventoryLocation(fix({ accuracy: 50 }), [near, location('overlapping', { longitude: 0.0016 })], NOW);
  assert.equal(ambiguous.location, null); assert.match(ambiguous.message, /more than one/);
  const edge = matchStaffInventoryLocation(fix(), [location('edge', { longitude: 0.00125 })], NOW);
  assert.equal(edge.location?.id, 'edge'); assert.equal(edge.confidence, 'nearby'); assert.match(edge.message, /Suggested nearby/);
  assert.equal(matchStaffInventoryLocation(fix(), [location('beyond-edge', { longitude: 0.0015 })], NOW).location, null, 'an overlapping uncertainty circle does not select a site outside its radius');
  assert.equal(matchStaffInventoryLocation(fix(), [location('outside', { longitude: 0.02, geofenceRadiusM: 50_000 })], NOW).location, null, 'configured radii remain capped at 1 km');
  assert.equal(matchStaffInventoryLocation(fix(), [location('small', { geofenceRadiusM: 10 })], NOW).location, null);
});

test('accuracy is bounded by the existing site radius while invalid, stale and future fixes remain manual', () => {
  const sites = [location('known')];
  for (const override of [{ accuracy: -1 }, { accuracy: NaN }, { latitude: Infinity }, { latitude: 91 }, { longitude: -181 }, { timestamp: NaN }]) {
    const result = matchStaffInventoryLocation(fix(override), sites, NOW);
    assert.equal(result.location, null); assert.equal(result.status, 'invalid');
  }
  for (const timestamp of [NOW - 300_001, NOW + 30_001]) assert.equal(matchStaffInventoryLocation(fix({ timestamp }), sites, NOW).status, 'stale');
  assert.equal(matchStaffInventoryLocation(fix({ accuracy: 151 }), sites, NOW).status, 'inaccurate');
  assert.equal(matchStaffInventoryLocation(fix({ accuracy: 140 }), sites, NOW).location, sites[0], 'a reading inside the existing 150 m radius is not rejected by an unrelated 100 m limit');
  assert.equal(matchStaffInventoryLocation(fix({ accuracy: 400 }), [location('wide', { geofenceRadiusM: 500 })], NOW).confidence, 'contained');
  assert.equal(matchStaffInventoryLocation(fix({ accuracy: 1001 }), [location('capped', { geofenceRadiusM: 50_000 })], NOW).status, 'inaccurate');
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

test('an inaccurate fix is not reused when the next card starts a location attempt', async () => {
  let gps = 0;
  const locate = createStaffInventoryLocator({ now: () => NOW, getPosition: async () => fix({ accuracy: ++gps === 1 ? 500 : 10 }), resolvePoint: async () => null });
  assert.equal((await locate([location('site')], signal())).status, 'inaccurate');
  const result = await locate([location('site')], signal());
  assert.equal(result.location?.id, 'site'); assert.match(result.message, /accuracy about 10 m/); assert.equal(gps, 2);
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
  assert.equal((await locate([location('site')], controller.signal)).status, 'cancelled');
});

test('a cancelled late GPS success cannot replace the next attempt cached position', async () => {
  let gps = 0; const first = deferred<StaffLocationFix>(), controller = new AbortController();
  const locate = createStaffInventoryLocator({ now: () => NOW, getPosition: () => ++gps === 1 ? first.promise : Promise.resolve(fix({ longitude: 1 })), resolvePoint: async () => null });
  const sites = [location('old'), location('current', { longitude: 1 })];
  const cancelled = locate(sites, controller.signal); controller.abort();
  assert.equal((await locate(sites, signal())).location?.id, 'current');
  assert.equal((await cancelled).status, 'cancelled'); first.resolve(fix());
  assert.equal((await locate(sites, signal())).location?.id, 'current'); assert.equal(gps, 2);
});

test('a cancelled late permission failure cannot poison the next attempt', async () => {
  let gps = 0; const first = deferred<StaffLocationFix>(), controller = new AbortController();
  const locate = createStaffInventoryLocator({ now: () => NOW, getPosition: () => ++gps === 1 ? first.promise : Promise.resolve(fix()), resolvePoint: async () => null });
  const sites = [location('site')], cancelled = locate(sites, controller.signal); controller.abort();
  assert.equal((await locate(sites, signal())).location?.id, 'site');
  assert.equal((await cancelled).status, 'cancelled'); first.reject({ code: 1 });
  assert.equal((await locate(sites, signal())).location?.id, 'site'); assert.equal(gps, 2);
});

test('unresolved unrelated locations retain a disclosed editable nearby suggestion', async () => {
  let lookups = 0;
  const locate = createStaffInventoryLocator({ now: () => NOW, getPosition: async () => fix(), resolvePoint: async () => { lookups++; return null; } });
  for (const address of ['Unknown fixture address', '']) {
    const result = await locate([location('known'), location('unmapped', { latitude: null, longitude: null, address })], signal());
    assert.equal(result.location?.id, 'known'); assert.equal(result.confidence, 'nearby'); assert.equal(result.unresolvedLocations, 1); assert.match(result.message, /could not be checked/); assert.match(result.message, /before saving/);
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
  let lookups = 0, requestSignal: AbortSignal | undefined; const first = deferred<{ latitude: number; longitude: number }>(), controller = new AbortController();
  const locate = createStaffInventoryLocator({ now: () => NOW, getPosition: async () => fix(), resolvePoint: async (_id, receivedSignal) => { lookups++; if (lookups === 1) { requestSignal = receivedSignal; return first.promise; } return { latitude: 0, longitude: 0 }; } });
  const sites = [location('site', { latitude: null, longitude: null })], cancelled = locate(sites, controller.signal);
  await Promise.resolve(); await Promise.resolve(); controller.abort(); first.resolve({ latitude: 0, longitude: 0 });
  assert.equal((await cancelled).status, 'cancelled'); assert.equal(requestSignal?.aborted, true);
  assert.equal((await locate(sites, signal())).location?.id, 'site'); assert.equal(lookups, 2);
});

test('11 saved and 21 address-derived API points produce a nearby intake suggestion with safe progress', async () => {
  const native = Array.from({ length: 11 }, (_, i) => location(`saved-${i}`, { longitude: i + 10 }));
  const addressed = Array.from({ length: 21 }, (_, i) => location(`address-${i}`, { latitude: null, longitude: null }));
  const before = structuredClone([...native, ...addressed]);
  const progress: StaffLocationProgress[] = [];
  let requests = 0;
  const locate = createStaffInventoryLocator({ now: () => NOW, getPosition: async () => fix({ accuracy: 120 }), resolvePoint: async id => {
    requests++;
    return parseStaffInventoryMapPointResponse(id, { location_id: id, point: { latitude: 0, longitude: id === 'address-0' ? 0.0005 : 40, coordinateSource: 'address_lookup' } });
  } });
  const result = await locate([...native, ...addressed], signal(), false, value => progress.push(value));
  assert.equal(result.location?.id, 'address-0'); assert.equal(result.location?.coordinateSource, 'address_lookup');
  assert.equal(result.status, 'matched'); assert.equal(result.confidence, 'nearby'); assert.equal(result.accuracyM, 120); assert.equal(result.unresolvedLocations, 0);
  assert.match(result.message, /accuracy about 120 m/);
  assert.equal(requests, 21); assert.deepEqual([...native, ...addressed], before);
  assert.equal(progress[0].phase, 'locating'); assert.equal(progress.at(-1)?.phase, 'matching'); assert.equal(progress.at(-1)?.checkedLocations, 32);
  assert.ok(progress.every(value => value.totalLocations === 32 && !('latitude' in value) && !('longitude' in value)));
});

test('the whole address batch stops at one deadline, aborts pending reads and ignores late results', { timeout: 1000 }, async () => {
  const pointCache = createStaffInventoryPointCache(), pending = deferred<{ latitude: number; longitude: number }>();
  const requests: AbortSignal[] = [], progress: StaffLocationProgress[] = [];
  const unresolved = Array.from({ length: 21 }, (_, i) => location(`missing-${i}`, { latitude: null, longitude: null }));
  const locate = createStaffInventoryLocator({ now: () => NOW, resolutionBudgetMs: 20, pointCache, getPosition: async () => fix(), resolvePoint: async (_id, receivedSignal) => { requests.push(receivedSignal); return pending.promise; } });
  const result = await locate([location('known'), ...unresolved], signal(), false, value => progress.push(value));
  assert.equal(result.location?.id, 'known'); assert.equal(result.confidence, 'nearby'); assert.equal(result.unresolvedLocations, 21);
  assert.equal(requests.length, 3); assert.ok(requests.every(value => value.aborted));
  const reported = progress.length;
  pending.resolve({ latitude: 0, longitude: 0 }); await Promise.resolve(); await Promise.resolve();
  assert.equal(pointCache.get(unresolved[0]), undefined); assert.equal(progress.length, reported, 'late workers cannot update the completed attempt');
});

test('map and intake share successful address points while changed addresses and native points stay authoritative', async () => {
  const pointCache = createStaffInventoryPointCache(), site = location('site', { latitude: null, longitude: null });
  pointCache.set(site, { latitude: 0, longitude: 0, coordinateSource: 'address_lookup' });
  let reads = 0;
  const locate = createStaffInventoryLocator({ now: () => NOW, pointCache, getPosition: async () => fix(), resolvePoint: async () => { reads++; return { latitude: 0, longitude: 0, coordinateSource: 'address_lookup' }; } });
  assert.equal((await locate([site], signal())).location?.id, 'site'); assert.equal(reads, 0);
  assert.equal((await locate([{ ...site, address: 'Changed fixture address' }], signal())).location?.id, 'site'); assert.equal(reads, 1);
  assert.equal(pointCache.get({ ...site, address: 'Changed fixture address' })?.coordinateSource, 'address_lookup');
  assert.equal((await locate([{ ...site, latitude: 1, longitude: 1 }], signal())).location, null, 'native source coordinates override an old address lookup');
});

test('address resolution runs while a phone refines its position and a rival remains ambiguous', async () => {
  const gps = deferred<StaffLocationFix>(); let reads = 0;
  const locate = createStaffInventoryLocator({ now: () => NOW, getPosition: () => gps.promise, resolvePoint: async () => { reads++; return { latitude: 0, longitude: 0.001 }; } });
  const finding = locate([location('saved'), location('resolved', { latitude: null, longitude: null })], signal());
  await Promise.resolve(); assert.equal(reads, 1, 'reads do not wait behind phone acquisition');
  gps.resolve(fix()); const result = await finding;
  assert.equal(result.location, null); assert.equal(result.status, 'ambiguous'); assert.match(result.message, /accuracy about 20 m/);
});

test('an explicit HQ address is checked before slow remote sites without changing rival matching', { timeout: 1000 }, async () => {
  const requests: string[] = [];
  const remote = Array.from({ length: 20 }, (_, i) => location(`remote-${i}`, { latitude: null, longitude: null }));
  const hq = location('z-hq', { latitude: null, longitude: null, locationType: 'hq' });
  const locate = createStaffInventoryLocator({ now: () => NOW, resolutionBudgetMs: 20, getPosition: async () => fix(), resolvePoint: async id => {
    requests.push(id);
    return id === hq.id ? { latitude: 0, longitude: 0, coordinateSource: 'address_lookup' } : new Promise(() => {});
  } });
  const result = await locate([...remote, hq], signal());
  assert.equal(requests[0], hq.id); assert.equal(result.location?.id, hq.id); assert.equal(result.confidence, 'nearby'); assert.equal(result.unresolvedLocations, 20);
  const ambiguous = await locate([location('nearby-store'), ...remote, hq], signal());
  assert.equal(ambiguous.location, null); assert.equal(ambiguous.status, 'ambiguous', 'HQ lookup priority never wins a conflicting location match');
});
