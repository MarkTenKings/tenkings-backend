import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
const { JSDOM } = require('jsdom');
(globalThis as typeof globalThis & { React: typeof React }).React = React;
const imagePath = require.resolve('next/image'), cachedImage = require.cache[imagePath];
require.cache[imagePath] = { id: imagePath, filename: imagePath, loaded: true, exports: { __esModule: true,
  default: ({ unoptimized: _unoptimized, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { unoptimized: boolean }) => React.createElement('img', props) } } as NodeModule;
const Review = require('../components/admin/SetCatalogEvidenceReview').default as typeof import('../components/admin/SetCatalogEvidenceReview').default;
if (cachedImage) require.cache[imagePath] = cachedImage; else delete require.cache[imagePath];

async function mount() {
  const { fixture } = await import(pathToFileURL(resolve(dirname(require.resolve('@tenkings/card-catalog-evidence')), '../tests/fixtures.mjs')).href);
  const manifest = fixture('SPORTS'), packet = { manifest, reviewEvidence: { sources: [], images: [] } };
  let previews = 0, writes = 0, objectUrls = 0;
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://collect.tenkings.co/admin/set-ops-review', pretendToBeVisual: true });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const fetcher: typeof fetch = async (url, init) => {
    if (String(url).endsWith('/preview')) return Response.json({ manifest, manifestSha256: String(++previews).repeat(64), verificationSha256: 'b'.repeat(64), verification: {}, expectedCurrent: null, expectedHistory: null, previousManifest: null, excerpts: [] });
    if (String(url).includes('/media?ref=')) return new Response('synthetic test bytes');
    if (String(url).endsWith('/publication') && init?.method === 'POST') { writes++; return Response.json({ current: false, outcome: 'replay' }); }
    throw new Error(`Unexpected request ${url}`);
  };
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, fetch: fetcher, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const oldCreate = URL.createObjectURL, oldRevoke = URL.revokeObjectURL;
  URL.createObjectURL = () => `blob:catalog-fixture-${++objectUrls}`; URL.revokeObjectURL = () => {};
  const host = dom.window.document.getElementById('root') as HTMLElement, root = createRoot(host);
  await act(async () => root.render(<Review token="fixture-human" setId={manifest.set.setId} canReview canApprove />));
  const button = (text: string) => { const found = [...host.querySelectorAll('button')].find(b => b.textContent === text); assert.ok(found); return found; };
  const click = async (text: string) => { await act(async () => button(text).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))); };
  const input = host.querySelector<HTMLInputElement>('input[accept]')!;
  Object.defineProperty(input, 'files', { configurable: true, value: [{ size: 100, text: async () => JSON.stringify(packet) }] });
  await act(async () => Simulate.change(input));
  await click('Validate and prepare full review');
  const checkbox = () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  const rendered = async (valid = true, image = host.querySelector('img')!) => {
    Object.defineProperty(image, 'naturalWidth', { configurable: true, value: valid ? 30 : 0 });
    Object.defineProperty(image, 'naturalHeight', { configurable: true, value: valid ? 40 : 0 });
    await act(async () => Simulate.load(image));
  };
  return { host, click, button, checkbox, rendered, writes: () => writes,
    check: async () => { await act(async () => Simulate.change(checkbox(), { target: { checked: true } } as never)); },
    error: async () => { await act(async () => Simulate.error(host.querySelector('img')!)); },
    close: async () => { await act(async () => root.unmount()); dom.window.close(); URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke;
      for (const [key, value] of previous) { if (value) Object.defineProperty(globalThis, key, value); else delete (globalThis as Record<string, unknown>)[key]; }
    },
  };
}

test('downloading a blob cannot unlock review; failed image decoding keeps publication blocked', async () => {
  const ui = await mount();
  try {
    assert.ok(ui.host.querySelector('img')); assert.equal(ui.checkbox().disabled, true);
    assert.equal(ui.button('Publish reviewed catalog evidence').disabled, true);
    await ui.click('Publish reviewed catalog evidence'); assert.equal(ui.writes(), 0);
    await ui.rendered(false); assert.equal(ui.checkbox().disabled, true);
    assert.match(ui.host.querySelector('[role="alert"]')!.textContent!, /Publication is blocked/);
  } finally { await ui.close(); }
});
test('successful image rendering enables explicit review; image errors clear prior confirmation', async () => {
  const ui = await mount();
  try {
    await ui.rendered(); assert.equal(ui.checkbox().disabled, false);
    assert.equal(ui.button('Publish reviewed catalog evidence').disabled, true);
    await ui.check(); assert.equal(ui.button('Publish reviewed catalog evidence').disabled, false);
    await ui.error(); assert.equal(ui.checkbox().checked, false); assert.equal(ui.checkbox().disabled, true);
    assert.equal(ui.button('Publish reviewed catalog evidence').disabled, true); assert.equal(ui.writes(), 0);
  } finally { await ui.close(); }
});
test('preparing another preview cannot inherit a prior image load or review confirmation', async () => {
  const ui = await mount();
  try {
    await ui.rendered(); await ui.check(); const oldImage = ui.host.querySelector('img')!;
    await ui.click('Validate and prepare full review');
    assert.notEqual(ui.host.querySelector('img')!.src, oldImage.src);
    assert.equal(ui.checkbox().checked, false); assert.equal(ui.checkbox().disabled, true);
    await ui.rendered(true, oldImage); assert.equal(ui.checkbox().disabled, true);
    await ui.rendered(); assert.equal(ui.checkbox().disabled, false); assert.equal(ui.button('Publish reviewed catalog evidence').disabled, true);
  } finally { await ui.close(); }
});
