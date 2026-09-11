import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createStaffInventoryPointCache, groupInventoryMapPoints, hasInventoryMapPoint, parseStaffInventoryMapPointResponse, summarizeInventoryLocations,
  type StaffInventoryMapItem, type StaffInventoryMapLocation,
} from '../lib/staffInventoryLocationsMap';
import { ONLINE_LOCATION_SLUG } from '../lib/locationUtils';

const location = (id: string, latitude: number | null = 34, longitude: number | null = -118): StaffInventoryMapLocation => ({ id, slug: id, name: `Fixture ${id}`, address: 'Isolated fixture address', locationType: 'store', latitude, longitude });
const item = (overrides: Partial<StaffInventoryMapItem> = {}): StaffInventoryMapItem => ({ location_id: 'a', quantity: 3, quantity_kind: 'on_hand', cost_cents: 101, expected_sales_cents: 300, costed_units: 3, priced_units: 3, machine_scope: null, last_count: null, ...overrides });

test('map coordinates require real finite numeric pairs in bounds and omit the online location', () => {
  assert.equal(hasInventoryMapPoint(location('zero', 0, 0)), true);
  assert.equal(hasInventoryMapPoint(location('poles', 90, -180)), true);
  for (const [latitude, longitude] of [[null, -118], [34, null], [NaN, -118], [34, Infinity], [91, 0], [0, -181]]) {
    assert.equal(hasInventoryMapPoint(location('bad', latitude, longitude)), false);
  }
  assert.equal(hasInventoryMapPoint({ ...location('online'), slug: ONLINE_LOCATION_SLUG }), false);
  assert.equal(hasInventoryMapPoint({ ...location('string'), latitude: '34' as unknown as number }), false);
});

test('the shared map response parser validates identity and numeric coordinates without changing API shape', () => {
  const point = { latitude: 0, longitude: 0, coordinateSource: 'saved' };
  assert.deepEqual(parseStaffInventoryMapPointResponse('site', { location_id: 'site', point }), point);
  assert.equal(parseStaffInventoryMapPointResponse('site', { location_id: 'other', point }), null);
  for (const body of [null, {}, { location_id: 'site', point: null }, { location_id: 'site', point: { lat: 0, lng: 0 } }, { location_id: 'site', point: { latitude: '0', longitude: 0 } }, { location_id: 'site', point: { latitude: 0, longitude: 181 } }]) assert.equal(parseStaffInventoryMapPointResponse('site', body), null);
});

test('the shared point cache keeps exact address identity, native precedence and isolated immutable values', () => {
  const cache = createStaffInventoryPointCache(), site = location('site', null, null);
  const point = { latitude: 0, longitude: 0, coordinateSource: 'address_lookup' as const };
  cache.set(site, point); point.latitude = 5;
  const saved = cache.get(site)!; assert.equal(saved.latitude, 0); saved.latitude = 10;
  assert.equal(cache.get(site)?.latitude, 0); assert.equal(cache.get({ ...site, address: 'Changed fixture address' }), undefined);
  assert.equal(cache.get({ ...site, latitude: 20, longitude: 30 })?.latitude, 20);
  cache.set(site, { latitude: Infinity, longitude: 0 }); assert.equal(cache.get(site)?.latitude, 0);
  assert.equal(createStaffInventoryPointCache().get(site), undefined, 'a new authenticated workspace has a separate cache');
});

test('on-hand values exclude machine rosters and other locations, with exact cent totals', () => {
  const [summary] = summarizeInventoryLocations([location('a')], [item(), item({ quantity: 1, cost_cents: 99, expected_sales_cents: 200, costed_units: 1, priced_units: 1 }), item({ quantity_kind: 'loaded_roster', quantity: 50, cost_cents: 10000, expected_sales_cents: 20000 }), item({ location_id: 'elsewhere', quantity: 200 })]);
  assert.equal(summary.onHandQuantity, 4);
  assert.equal(summary.machineRosterQuantity, 50);
  assert.equal(summary.costCents, 200);
  assert.equal(summary.expectedSalesCents, 500);
  assert.equal(summary.expectedProfitCents, 300);
  assert.equal(summary.expectedMarginPct, 60);
});

test('unknown and absent evidence remain unknown while an evidenced zero and loss are preserved', () => {
  const [empty] = summarizeInventoryLocations([location('a')], []);
  assert.equal(empty.groupCount, 0);
  assert.equal(empty.costCents, null);
  assert.equal(empty.expectedSalesCents, null);
  const [unknown] = summarizeInventoryLocations([location('a')], [item(), item({ cost_cents: null, costed_units: 0 })]);
  assert.equal(unknown.costCents, null);
  assert.equal(unknown.costedQuantity, 3);
  assert.equal(unknown.expectedSalesCents, 600);
  assert.equal(unknown.expectedProfitCents, null);
  const [zero] = summarizeInventoryLocations([location('a')], [item({ cost_cents: 0, expected_sales_cents: 0 })]);
  assert.equal(zero.costCents, 0);
  assert.equal(zero.expectedProfitCents, 0);
  assert.equal(zero.expectedMarginPct, null);
  const [loss] = summarizeInventoryLocations([location('a')], [item({ cost_cents: 400 })]);
  assert.equal(loss.expectedProfitCents, -100);
});

test('safe integer overflow never becomes a rounded cost or expected value', () => {
  const [summary] = summarizeInventoryLocations([location('a')], [item({ cost_cents: Number.MAX_SAFE_INTEGER, expected_sales_cents: Number.MAX_SAFE_INTEGER }), item()]);
  assert.equal(summary.costCents, null);
  assert.equal(summary.expectedSalesCents, null);
  assert.equal(summary.expectedProfitCents, null);
});

test('machine count observations are deduplicated by evidence identity and never counted as on-hand inventory', () => {
  const observation = { event_id: 'count-1', at: '2026-09-10T10:00:00Z', quantity: 7 };
  const machine = item({ quantity_kind: 'loaded_roster', machine_scope: { machine_id: 'fixture-machine', product_id: 'fixture-product', door_id: null }, last_count: observation });
  const [summary] = summarizeInventoryLocations([location('a')], [machine, machine, { ...machine, last_count: { ...observation, event_id: 'count-2', quantity: 2, at: '2026-09-10T11:00:00Z' }, machine_scope: { ...machine.machine_scope!, product_id: 'other-product' } }]);
  assert.equal(summary.onHandQuantity, 0);
  assert.equal(summary.machineRosterQuantity, 9);
  assert.equal(summary.machineCount, 1);
  assert.equal(summary.costCents, null);
  assert.equal(summary.counts.length, 2);
  assert.equal(summary.counts[0].quantity, 2);
  assert.equal(summary.counts[0].scope.product_id, 'other-product');
});

test('overlapping points group at low zoom and split at street zoom without creating coordinates', () => {
  const points = [location('b', 34.002, -118.002), location('a'), location('far', 42, -73), location('missing', null)];
  const overview = groupInventoryMapPoints(points, 4);
  assert.equal(overview.length, 2);
  assert.deepEqual(overview[0].locations.map(point => point.id), ['a', 'b']);
  assert.deepEqual(overview[0].position, { lat: 34, lng: -118 });
  assert.equal(groupInventoryMapPoints(points, 18).length, 3);
  assert.deepEqual(groupInventoryMapPoints([...points].reverse(), 4), overview);
});

test('exact shared coordinates remain one group and every location stays selectable at maximum zoom', () => {
  const [group] = groupInventoryMapPoints([location('b'), location('a')], 22);
  assert.deepEqual(group.locations.map(point => point.id), ['a', 'b']);
  assert.deepEqual(group.position, { lat: 34, lng: -118 });
});

test('grouping handles the antimeridian and polar coordinates without dropping real locations', () => {
  const groups = groupInventoryMapPoints([location('east', 0, 179.9), location('west', 0, -179.9), location('north', 90, 0)], 2);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.flatMap(group => group.locations.map(point => point.id)).sort(), ['east', 'north', 'west']);
  assert.equal(groups[0].locations.length, 2);
});
