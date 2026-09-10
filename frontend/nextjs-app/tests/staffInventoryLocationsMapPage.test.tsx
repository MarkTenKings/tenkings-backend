import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import type { StaffInventoryMapItem, StaffInventoryMapLocation } from '../lib/staffInventoryLocationsMap';

const { JSDOM } = require('jsdom') as { JSDOM: new (...args: unknown[]) => { window: Window & typeof globalThis & { close(): void } } };
(globalThis as typeof globalThis & { React: typeof React }).React = React;
const extensions = require.extensions as unknown as Record<string, (module: NodeModule) => void>;
extensions['.css'] = module => { module.exports = new Proxy({}, { get: (_target, key) => key === '__esModule' ? false : String(key) }); };
let loader: unknown;
const hookId = require.resolve('../hooks/useGoogleMaps');
require.cache[hookId] = { id: hookId, filename: hookId, loaded: true, exports: { useGoogleMaps: () => loader } } as NodeModule;
const StaffInventoryLocationsMap = require('../components/admin/StaffInventoryLocationsMap').default as typeof import('../components/admin/StaffInventoryLocationsMap').default;

const location = (id: string, latitude: number | null = 34, longitude: number | null = -118): StaffInventoryMapLocation => ({ id, slug: id, name: `Fixture ${id}`, address: 'Isolated address', locationType: 'store', latitude, longitude });
const item: StaffInventoryMapItem = { location_id: 'a', quantity: 3, quantity_kind: 'on_hand', cost_cents: 101, expected_sales_cents: 300, costed_units: 3, priced_units: 3, machine_scope: null, last_count: null };

async function mount(locations: StaffInventoryMapLocation[], options: { failed?: boolean; items?: StaffInventoryMapItem[] } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://isolated.invalid/admin/physical-inventory', pretendToBeVisual: true });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const set = (key: string, value: unknown) => { previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }); };
  set('window', dom.window); set('document', dom.window.document); set('navigator', dom.window.navigator); set('IS_REACT_ACT_ENVIRONMENT', true);
  set('fetch', () => { throw new Error('The map component must make no data or geocoding request'); });
  const maps: FakeMap[] = [], markers: FakeMarker[] = [], viewed: string[] = [];
  class FakeMap {
    zoom = 4;
    listeners = new Map<string, () => void>();
    cleared = false;
    fitCalls = 0;
    pans: { lat: number; lng: number }[] = [];
    constructor(public canvas: HTMLElement) { maps.push(this); }
    addListener(name: string, handler: () => void) { this.listeners.set(name, handler); }
    getZoom() { return this.zoom; }
    setZoom(zoom: number) { this.zoom = zoom; this.listeners.get('zoom_changed')?.(); }
    setCenter(_point: unknown) {}
    panTo(point: { lat: number; lng: number }) { this.pans.push(point); }
    fitBounds(_bounds: unknown, _padding: number) { this.fitCalls++; }
  }
  class FakeMarker {
    listeners = new Map<string, () => void>();
    cleared = false;
    map: FakeMap | null;
    constructor(public options: { map: FakeMap; title: string; gmpClickable: boolean; content: HTMLElement; position: { lat: number; lng: number } }) { this.map = options.map; markers.push(this); }
    addListener(name: string, handler: () => void) { this.listeners.set(name, handler); }
  }
  class Bounds { extend(_point: unknown) { return this; } }
  const googleFixture = { maps: { LatLngBounds: Bounds, event: { clearInstanceListeners(value: FakeMap | FakeMarker) { value.listeners.clear(); value.cleared = true; } } } };
  set('google', googleFixture);
  const priorMapId = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID;
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID = 'isolated-map-config';
  loader = options.failed ? { isLoaded: false, libraries: null, loadError: new Error('fixture failure') } : { isLoaded: true, loadError: null, libraries: { mapsLibrary: { Map: FakeMap }, markerLibrary: { AdvancedMarkerElement: FakeMarker } } };
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  const render = async (nextLocations: StaffInventoryMapLocation[], nextItems: StaffInventoryMapItem[] = options.items ?? [item]) => {
    await act(async () => root.render(<StaffInventoryLocationsMap locations={nextLocations} items={nextItems} onViewInventory={id => viewed.push(id)} />));
  };
  await render(locations);
  return {
    container, maps, markers, viewed, render,
    async choose(id: string) { const select = container.querySelector('select'); assert.ok(select); await act(async () => Simulate.change(select, { target: { value: id } } as unknown as Parameters<typeof Simulate.change>[1])); },
    async click(text: string) { const button = [...container.querySelectorAll('button')].find(candidate => candidate.textContent?.includes(text)); assert.ok(button, `Missing button ${text}`); await act(async () => button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))); },
    async markerClick(marker: FakeMarker) { assert.ok(marker.listeners.has('click')); await act(async () => marker.listeners.get('click')!()); },
    async close() {
      await act(async () => root.unmount());
      assert.ok(maps.every(map => map.cleared));
      assert.ok(markers.every(marker => marker.cleared && marker.map === null));
      dom.window.close();
      if (priorMapId === undefined) delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID; else process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID = priorMapId;
      for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
    },
  };
}

test('unmapped locations remain selectable and their inventory action opens the exact location', async () => {
  const ui = await mount([location('a', null), location('b', null)]);
  try {
    assert.match(ui.container.textContent!, /Map point unavailable/);
    assert.equal(ui.maps.length, 0);
    await ui.choose('b');
    assert.ok(ui.container.querySelector('[aria-label="Fixture b inventory summary"]'));
    await ui.click('View inventory');
    assert.deepEqual(ui.viewed, ['b']);
  } finally { await ui.close(); }
});

test('a loader failure preserves all location selection and recorded value details', async () => {
  const ui = await mount([location('a'), location('b')], { failed: true });
  try {
    assert.match(ui.container.textContent!, /Map temporarily unavailable/);
    assert.match(ui.container.textContent!, /\$1\.01/);
    assert.match(ui.container.textContent!, /\$1\.99/);
    await ui.choose('b');
    assert.match(ui.container.textContent!, /No stock recorded here yet/);
    await ui.click('View inventory');
    assert.deepEqual(ui.viewed, ['b']);
  } finally { await ui.close(); }
});

test('pins have accessible descriptions; selection and fit work without a data refresh moving the viewport', async () => {
  const locations = [location('a'), location('b', 42, -73)];
  const ui = await mount(locations);
  try {
    const marker = ui.markers.find(candidate => candidate.options.title.startsWith('Fixture b.'))!;
    assert.ok(marker);
    assert.equal(marker.options.gmpClickable, true);
    await ui.markerClick(marker);
    assert.ok(ui.container.querySelector('[aria-label="Fixture b inventory summary"]'));
    assert.deepEqual(ui.maps[0].pans.at(-1), { lat: 42, lng: -73 });
    assert.equal(ui.maps[0].zoom, 13);
    const panCount = ui.maps[0].pans.length, fitCount = ui.maps[0].fitCalls;
    await ui.render(locations.map(point => ({ ...point })), [{ ...item, cost_cents: 100 }]);
    assert.equal(ui.maps[0].pans.length, panCount);
    assert.equal(ui.maps[0].fitCalls, fitCount);
    await ui.click('Fit all locations');
    assert.equal(ui.maps[0].fitCalls, fitCount + 1);
  } finally { await ui.close(); }
});

test('co-located pins expose every exact location and never displace its coordinate', async () => {
  const ui = await mount([location('a'), location('b')]);
  try {
    const cluster = [...ui.markers].reverse().find(marker => marker.map !== null)!;
    assert.match(cluster.options.title, /2 nearby locations: Fixture a, Fixture b/);
    assert.deepEqual(cluster.options.position, { lat: 34, lng: -118 });
    await ui.markerClick(cluster);
    assert.ok(ui.container.querySelector('[aria-label="Nearby locations"]'));
    await ui.click('Fixture b');
    assert.ok(ui.container.querySelector('[aria-label="Fixture b inventory summary"]'));
    await ui.click('View inventory');
    assert.deepEqual(ui.viewed, ['b']);
  } finally { await ui.close(); }
});

test('machine roster stock is never displayed as held stock or valued as remaining inventory', async () => {
  const ui = await mount([location('a', null)], { items: [{ ...item, quantity_kind: 'loaded_roster', quantity: 50 }] });
  try {
    assert.match(ui.container.textContent!, /50 in machine loading rosters/);
    assert.match(ui.container.textContent!, /No held-stock records/);
    assert.doesNotMatch(ui.container.textContent!, /\$1\.01|Expected gross profit/);
  } finally { await ui.close(); }
});
