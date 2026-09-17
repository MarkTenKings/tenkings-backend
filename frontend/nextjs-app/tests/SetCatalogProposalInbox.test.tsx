import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import Inbox from '../components/admin/SetCatalogProposalInbox';
import { createCatalogProposalInbox } from '../lib/server/staffInventoryCatalogObservations';
import { proposalRow, reviewer } from './catalogObservationFixtures';
const { JSDOM } = require('jsdom');
(globalThis as typeof globalThis & { React: typeof React }).React = React;

async function mount({ pending = false, canReview = true } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://collect.tenkings.co/admin/set-ops-review' });
  const globals = new Map<string, PropertyDescriptor | undefined>(), requests: { url: string; token: string | null }[] = [], downloads: { blob: Blob; filename?: string }[] = [];
  const row = proposalRow(), oldFlag = process.env.SET_CATALOG_EVIDENCE_ENABLED; process.env.SET_CATALOG_EVIDENCE_ENABLED = 'true';
  const service = createCatalogProposalInbox({ $queryRaw: async () => [row] } as unknown as PrismaClient);
  let release: (() => void) | undefined;
  const deferred = new Promise<void>(resolve => { release = resolve; });
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(init?.cache, 'no-store'); assert.equal(init?.method, undefined);
    const requestUrl = new URL(String(url), dom.window.location.href); assert.equal(requestUrl.pathname, '/api/admin/set-ops/catalog/proposals');
    requests.push({ url: String(url), token: new Headers(init?.headers).get('Authorization') });
    if (pending) await deferred;
    const params = Object.fromEntries(requestUrl.searchParams);
    return Response.json(params.proposalId ? await service.detail(params as { proposalId: string; proposalSha256: string }, reviewer) : await service.list(params, reviewer));
  };
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, fetch: fetcher, IS_REACT_ACT_ENVIRONMENT: true })) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const oldCreate = URL.createObjectURL, oldRevoke = URL.revokeObjectURL;
  URL.createObjectURL = blob => { assert.ok(blob instanceof Blob); downloads.push({ blob }); return `blob:fixture-${downloads.length}`; }; URL.revokeObjectURL = () => {};
  dom.window.HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) { downloads.at(-1)!.filename = this.download; };
  const host = dom.window.document.getElementById('root') as HTMLElement, root = createRoot(host);
  await act(async () => root.render(<Inbox token="first-human-session" canReview={canReview} />));
  const button = (label: string) => { const b = [...host.querySelectorAll('button')].find(b => b.textContent === label); assert.ok(b, label); return b; };
  return { host, requests, downloads, row, button, release: () => release!(),
    click: async (label: string) => { await act(async () => button(label).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))); },
    changeSession: async (token?: string, permitted = true) => { await act(async () => root.render(<Inbox token={token} canReview={permitted} />)); },
    close: async () => { await act(async () => root.unmount()); dom.window.close(); URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke;
      if (oldFlag === undefined) delete process.env.SET_CATALOG_EVIDENCE_ENABLED; else process.env.SET_CATALOG_EVIDENCE_ENABLED = oldFlag;
      for (const [key, value] of globals) { if (value) Object.defineProperty(globalThis, key, value); else delete (globalThis as Record<string, unknown>)[key]; }
    },
  };
}

test('human selection exports exact canonical bytes and incomplete review links without staging or publication', async () => {
  const ui = await mount();
  try {
    assert.equal(ui.requests.length, 0, 'inbox is manually loaded'); assert.equal(ui.button('Export selected proposals').disabled, true);
    await ui.click('Load proposals'); assert.match(ui.host.textContent!, /Identity can be uncertain/); assert.match(ui.host.textContent!, /original-capture lineage and dimensions are unknown/);
    await ui.click('Select exact proposal'); assert.equal(ui.requests.length, 2); assert.match(ui.requests[1].url, new RegExp(`proposalSha256=${ui.row.proposalSha256}`));
    assert.ok(ui.requests.every(r => r.token === 'Bearer first-human-session'));
    await ui.click('Download exact proposal JSON');
    const bytes = await ui.downloads[0].blob.text(); assert.equal(createHash('sha256').update(bytes).digest('hex'), ui.row.proposalSha256);
    await ui.click('Export selected proposals'); const packet = JSON.parse(await ui.downloads[1].blob.text());
    assert.equal(packet.proposals[0].canonicalProposalJson, bytes); assert.equal(packet.proposals[0].proposalSha256, ui.row.proposalSha256);
    assert.deepEqual(packet.reviewEvidence.observations, [{ proposalId: ui.row.id, proposalSha256: ui.row.proposalSha256, sourceIds: [], reviewNote: '' }]);
    assert.equal(packet.disposition, 'requires_authorized_review'); assert.equal(ui.requests.length, 2, 'exports never call publication/media/staging APIs');
    await ui.changeSession('second-human-session'); assert.equal(ui.button('Export selected proposals').disabled, true); assert.doesNotMatch(ui.host.textContent!, /Synthetic card/);
  } finally { await ui.close(); }
});
test('late private responses from a prior human session cannot populate a fresh login', async () => {
  const ui = await mount({ pending: true });
  try {
    await ui.click('Load proposals'); assert.equal(ui.requests.length, 1);
    await ui.changeSession('different-human-session');
    await act(async () => { ui.release(); await new Promise(resolve => setTimeout(resolve, 0)); });
    assert.doesNotMatch(ui.host.textContent!, /Synthetic card/); assert.equal(ui.button('Export selected proposals').disabled, true);
  } finally { await ui.close(); }
});
test('inbox and requests are absent without human review permission', async () => {
  const ui = await mount({ canReview: false });
  try { assert.equal(ui.host.textContent, ''); assert.equal(ui.requests.length, 0); }
  finally { await ui.close(); }
});
