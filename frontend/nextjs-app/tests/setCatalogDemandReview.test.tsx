import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { PrismaClient } from '@prisma/client';
import Inbox from '../components/admin/SetCatalogDemandInbox';
import { createSetCatalogDemandReview } from '../lib/server/setCatalogDemandReview';
import { acquireSetCatalogDemand } from '../lib/server/setCatalogDemandSources';
import { reviewer } from './catalogObservationFixtures';
const { JSDOM } = require('jsdom');
(globalThis as typeof globalThis & { React: typeof React }).React = React;

async function fixture() {
  const demand = { category: 'SPORTS' as const, year: '2024', manufacturer: 'Panini', setName: 'Prizm', language: null };
  const acquired = await acquireSetCatalogDemand(demand, 1, {
    discover: (async () => ({ candidates: [{ url: 'https://www.paniniamerica.net/2024-prizm.csv' }] })) as any,
    fetchImpl: async () => new Response('original fixture source bytes', { headers: { 'content-type': 'text/csv' } }),
    parse: (() => ({ text: '2024 Panini Prizm', rows: [{ player: 'Example Player', cardNumber: '25', parallel: 'Silver Prizm', evidenceKind: 'literal_columns' }], context: [], truncated: false })) as any,
  });
  const result = acquired.result, artifact = acquired.artifacts[0];
  const row = { demandKey: result.demandKey, demandJson: demand, state: result.state, attempt: 1, resultHash: result.snapshotHash, createdAt: new Date() };
  return { result, row, artifact };
}

test('reviewer reads a pinned immutable preparation and exact source; changed artifact or expired authority is refused', async () => {
  const f = await fixture(), old = process.env.SET_CATALOG_EVIDENCE_ENABLED; process.env.SET_CATALOG_EVIDENCE_ENABLED = 'true';
  let corrupt = false, calls = 0;
  const service = createSetCatalogDemandReview({ $queryRaw: async (sql: TemplateStringsArray) => {
    calls++; const query = sql.join('?');
    if (query.includes('SetCatalogDemandSource')) return [{ bytes: corrupt ? Buffer.from('changed') : f.artifact.bytes, sha256: f.result.sources[0].sha256 }];
    if (query.includes('SetCatalogDemandResult')) return [{ resultJson: f.result }];
    return [f.row];
  } } as unknown as PrismaClient);
  try {
    assert.equal((await service({}, reviewer)).kind, 'json');
    const pin = { demandKey: f.result.demandKey, snapshotHash: f.result.snapshotHash };
    assert.equal((await service(pin, reviewer)).kind, 'json');
    const sourcePin = { ...pin, sourceId: f.result.sources[0].sourceId };
    const read = await service(sourcePin, reviewer); assert.equal(read.kind, 'bytes'); if (read.kind === 'bytes') assert.deepEqual(read.bytes, f.artifact.bytes);
    corrupt = true; await assert.rejects(service(sourcePin, reviewer), /integrity mismatch/);
    await assert.rejects(service({ ...pin, snapshotHash: 'f'.repeat(64) }, reviewer), /integrity mismatch/);
    const prior = calls; await assert.rejects(service({}, { ...reviewer, expiresAt: new Date(0) }), /current human/); assert.equal(calls, prior);
  } finally { if (old === undefined) delete process.env.SET_CATALOG_EVIDENCE_ENABLED; else process.env.SET_CATALOG_EVIDENCE_ENABLED = old; }
});

async function mount({ pending = false, canReview = true } = {}) {
  const f = await fixture(), dom = new JSDOM('<div id="root"></div>', { url: 'https://collect.tenkings.co/admin/set-ops-review' });
  const globals = new Map<string, PropertyDescriptor | undefined>(), requests: string[] = [], downloads: Blob[] = [];
  let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(init?.method, undefined); assert.equal(init?.cache, 'no-store');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer first-human-session');
    const u = new URL(String(url), dom.window.location.href); assert.equal(u.pathname, '/api/admin/set-ops/catalog/demands'); requests.push(String(url));
    if (pending) await wait;
    return Response.json({ disposition: 'requires_authorized_review', ...(u.searchParams.has('demandKey') ? { result: f.result }
      : { items: [{ demandKey: f.result.demandKey, demand: f.result.demand, state: 'READY', attempt: 1, snapshotHash: f.result.snapshotHash, createdAt: f.row.createdAt.toISOString() }] }) });
  };
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, fetch: fetcher, IS_REACT_ACT_ENVIRONMENT: true })) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const previousCreate = URL.createObjectURL, previousRevoke = URL.revokeObjectURL;
  URL.createObjectURL = blob => { assert.ok(blob instanceof Blob); downloads.push(blob); return 'blob:fixture'; }; URL.revokeObjectURL = () => {};
  dom.window.HTMLAnchorElement.prototype.click = () => {};
  const host = dom.window.document.getElementById('root') as HTMLElement, root = createRoot(host);
  await act(async () => root.render(<Inbox token="first-human-session" canReview={canReview} />));
  return { host, requests, downloads, result: f.result, release,
    click: async (label: string) => { const b = [...host.querySelectorAll('button')].find(b => b.textContent === label); assert.ok(b); await act(async () => b.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))); },
    changeSession: async () => { await act(async () => root.render(<Inbox token="different-session" canReview />)); },
    close: async () => { await act(async () => root.unmount()); dom.window.close(); URL.createObjectURL = previousCreate; URL.revokeObjectURL = previousRevoke;
      for (const [key, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as Record<string, unknown>)[key]; }
    },
  };
}
test('prepared-source inbox exports the pinned unreviewed preparation without a publish or draft write', async () => {
  const ui = await mount();
  try {
    assert.equal(ui.requests.length, 0); await ui.click('Load prepared sets'); await ui.click('Inspect preparation');
    assert.match(ui.host.textContent!, /do not prove card applicability/); assert.match(ui.host.textContent!, /1 exact source rows/);
    await ui.click('Download preparation JSON'); assert.deepEqual(JSON.parse(await ui.downloads[0].text()), ui.result);
    assert.equal(ui.requests.length, 2); assert.match(ui.requests[1], new RegExp(`snapshotHash=${ui.result.snapshotHash}`));
  } finally { await ui.close(); }
});
test('prepared-source inbox ignores a prior human session response and is absent without review permission', async () => {
  const ui = await mount({ pending: true });
  try { await ui.click('Load prepared sets'); await ui.changeSession(); await act(async () => { ui.release(); await new Promise(r => setTimeout(r, 0)); }); assert.doesNotMatch(ui.host.textContent!, /2024 Panini Prizm/); }
  finally { await ui.close(); }
  const hidden = await mount({ canReview: false });
  try { assert.equal(hidden.host.textContent, ''); assert.equal(hidden.requests.length, 0); } finally { await hidden.close(); }
});
