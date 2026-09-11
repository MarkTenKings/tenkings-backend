import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createStaffInventoryPointCache, type StaffInventoryMapLocation, type StaffInventoryPointCache } from '../lib/staffInventoryLocationsMap';
import { createStaffInventoryLocator } from '../lib/staffInventoryGeolocation';
const { JSDOM } = require('jsdom');
(globalThis as any).React = React;
(require.extensions as any)['.css'] = (module: NodeModule) => { module.exports = new Proxy({}, { get: (_, key) => key === '__esModule' ? false : String(key) }); };
const dynamicId = require.resolve('next/dynamic');
let mapProps: any;
require.cache[dynamicId] = { id: dynamicId, filename: dynamicId, loaded: true, exports: () => (props: unknown) => { mapProps = props; return <div>Fixture map</div>; } } as NodeModule;
const Browser = require('../components/admin/StaffInventoryLocationBrowser').default;
const id = '11111111-1111-4111-8111-111111111111';
const location: StaffInventoryMapLocation = { id, slug: 'fixture-hq', name: 'Fixture HQ', address: 'Fixture address', locationType: 'hq' };
async function mount(fetcher: typeof fetch, pointCache?: StaffInventoryPointCache) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://fixture.invalid', pretendToBeVisual: true });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, fetch: fetcher, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const root = createRoot(document.getElementById('root')!); const viewed: string[] = [];
  const render = async (locations = [location]) => { await act(async () => root.render(<Browser locations={locations} items={[]} token="fixture-admin" pointCache={pointCache} onViewInventory={(key: string) => viewed.push(key)} />)); };
  await render();
  return { render, viewed,
    async click(label: string) { const button = [...document.querySelectorAll('button')].find(b => b.textContent?.includes(label)); assert.ok(button, label); await act(async () => button.click()); },
    async close() { await act(async () => root.unmount()); dom.window.close(); for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } },
  };
}
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
test('map resolves only on demand and caches address matches across inventory refreshes and view switches', async () => {
  const requests: string[] = [];
  const ui = await mount(async (url, options) => {
    requests.push(String(url)); assert.equal((options?.headers as any).Authorization, 'Bearer fixture-admin');
    return json({ location_id: id, point: { latitude: 38, longitude: -121, coordinateSource: 'address_lookup' } });
  });
  try {
    assert.equal(requests.length, 0); await ui.click('Fixture HQ'); assert.deepEqual(ui.viewed, [id]);
    await ui.click('Map'); assert.equal(requests.length, 1); assert.equal(mapProps.locations[0].coordinateSource, 'address_lookup');
    await ui.render([{ ...location }]); await ui.click('List'); await ui.click('Map'); assert.equal(requests.length, 1);
    await ui.render([{ ...location, address: 'Changed fixture address' }]); assert.equal(requests.length, 2);
  } finally { await ui.close(); }
});
test('saved coordinates bypass lookup while failed address matches stay selectable and explicitly retry', async () => {
  let calls = 0;
  const ui = await mount(async () => { calls++; return json({ location_id: id, point: null, message: 'Check the address.' }); });
  try {
    await ui.render([{ ...location, latitude: 38, longitude: -121 }]); await ui.click('Map'); assert.equal(calls, 0);
    await ui.render(); assert.equal(calls, 1); assert.equal(mapProps.locationErrors[id], 'Check the address.');
    assert.equal(mapProps.locations.length, 1); await ui.click('Retry map points'); assert.equal(calls, 2);
  } finally { await ui.close(); }
});
test('switching away aborts unfinished lookup and ignores its late result', async () => {
  let signal: AbortSignal | undefined, finish: ((response: Response) => void) | undefined;
  const ui = await mount(async (_url, options) => { signal = options?.signal as AbortSignal; return new Promise(resolve => { finish = resolve; }); });
  try {
    await ui.click('Map'); assert.ok(signal); await ui.click('List'); assert.equal(signal.aborted, true);
    await act(async () => finish!(json({ location_id: id, point: { latitude: 38, longitude: -121, coordinateSource: 'address_lookup' } })));
    await ui.click('Map'); assert.equal(mapProps.locations[0].latitude, undefined); assert.equal(mapProps.resolvingLocationIds[0], id);
  } finally { await ui.close(); }
});

test('the map reuses an intake point and shares its next successful lookup back to intake', async () => {
  const pointCache = createStaffInventoryPointCache();
  pointCache.set(location, { latitude: 38, longitude: -121, coordinateSource: 'address_lookup' });
  let calls = 0;
  const ui = await mount(async () => { calls++; return json({ location_id: id, point: { latitude: 38, longitude: -121, coordinateSource: 'address_lookup' } }); }, pointCache);
  try {
    await ui.click('Map'); assert.equal(calls, 0); assert.equal(mapProps.locations[0].latitude, 38);
    const changed = { ...location, address: 'Changed fixture address' };
    await ui.render([changed]); assert.equal(calls, 1);
    const now = Date.now();
    const locate = createStaffInventoryLocator({ now: () => now, pointCache, getPosition: async () => ({ latitude: 38, longitude: -121, accuracy: 10, timestamp: now }), resolvePoint: async () => { assert.fail('the map point is already cached'); } });
    assert.equal((await locate([changed], new AbortController().signal)).location?.id, id);
  } finally { await ui.close(); }
});
