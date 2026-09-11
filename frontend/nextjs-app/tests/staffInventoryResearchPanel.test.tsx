import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
const { JSDOM } = require('jsdom');
(globalThis as typeof globalThis & { React: typeof React }).React = React;
const cssLoader = require.extensions['.css']; require.extensions['.css'] = module => { module.exports = {}; };
const Panel = require('../components/admin/StaffInventoryResearchPanel').default as typeof import('../components/admin/StaffInventoryResearchPanel').default;
if (cssLoader) require.extensions['.css'] = cssLoader; else delete require.extensions['.css'];
const job = { job_id: '11111111-1111-4111-8111-111111111111', unit_id: 'fixture-unit', description_event_id: 'fixture-description', description_hash: 'a'.repeat(64), input_hash: 'b'.repeat(64), status: 'queued', attempt_count: 0, max_attempts: 3, can_retry: false, result: null };
async function mount(fetchImpl: typeof fetch) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://fixture.invalid/' });
  const values: Record<string, unknown> = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, fetch: fetchImpl, crypto: webcrypto, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, value, writable: true });
  const container = document.getElementById('root')!, root = createRoot(container);
  await act(async () => { root.render(<Panel unitId="fixture-unit" token="fixture-admin" descriptionEventId="fixture-description" />); });
  return { container, async close() { await act(async () => root.unmount()); dom.window.close(); for (const [key, descriptor] of previous) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } };
}
test('research progress is a private read and never a save dependency', async () => {
  let calls = 0;
  const ui = await mount(async (url, init) => { calls++; assert.match(String(url), /research\?unit_id=fixture-unit/); assert.equal((init?.headers as any).Authorization, 'Bearer fixture-admin'); assert.equal(init?.method, undefined); return Response.json({ version: 1, jobs: [job], image_previews: {} }); });
  try { assert.match(ui.container.textContent!, /Queued/); assert.match(ui.container.textContent!, /keep adding inventory or close this page/); assert.equal(calls, 1); } finally { await ui.close(); }
});
test('old description results and unavailable reads cannot replace the current card', async () => {
  const ui = await mount(async () => Response.json({ version: 1, jobs: [{ ...job, description_event_id: 'old-revision' }] }));
  try { assert.match(ui.container.textContent!, /Not researched/); assert.doesNotMatch(ui.container.textContent!, /Queued/); } finally { await ui.close(); }
  const unavailable = await mount(async () => Response.json({ message: 'unsafe detail' }, { status: 503 }));
  try { assert.match(unavailable.container.textContent!, /Your inventory is saved/); assert.doesNotMatch(unavailable.container.textContent!, /unsafe detail/); } finally { await unavailable.close(); }
});
test('retry sends only the exact failed revision and does not update prices or inventory', async () => {
  let posted: any;
  const ui = await mount(async (_, init) => { if (init?.method === 'POST') { posted = JSON.parse(String(init.body)); return Response.json({ outcome: 'QUEUED' }); } return Response.json({ version: 1, jobs: [{ ...job, status: 'failed', attempt_count: 3, can_retry: true, error: { message: 'Provider is temporarily unavailable.' } }] }); });
  try {
    await act(async () => ui.container.querySelector('button')!.click());
    assert.ok(posted); assert.equal(posted.jobId, job.job_id); assert.equal(posted.inputHash, job.input_hash); assert.equal(posted.expectedAttemptCount, 3);
    assert.deepEqual(Object.keys(posted).sort(), ['requestId', 'jobId', 'unitId', 'descriptionEventId', 'inputHash', 'expectedAttemptCount'].sort());
  } finally { await ui.close(); }
});
