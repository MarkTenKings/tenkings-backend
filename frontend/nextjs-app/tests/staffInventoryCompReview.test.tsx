import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { marketJob, marketResult, marketReview, MARKET_TIME } from './fixtures/staffInventoryMarketValue';
import type { StaffInventoryResearchReviewCommand as Command, StaffInventoryResearchReviewSnapshot as Review } from '../lib/staffInventoryMarketValue';
const { JSDOM } = require('jsdom');
(globalThis as typeof globalThis & { React: typeof React }).React = React;
const cssLoader = require.extensions['.css']; require.extensions['.css'] = module => { module.exports = {}; };
const Panel = require('../components/admin/StaffInventoryResearchPanel').default as typeof import('../components/admin/StaffInventoryResearchPanel').default;
if (cssLoader) require.extensions['.css'] = cssLoader; else delete require.extensions['.css'];
function fixture() {
  const result = marketResult(2);
  result.candidates.forEach((candidate, index) => { candidate.title = `Fixture comp ${index + 1}`; candidate.image!.storage_key = `research-evidence/${candidate.image!.sha256}.jpg`; });
  const job = marketJob(result); let review = marketReview(job);
  const original = JSON.stringify(result), posts: Command[] = [];
  return { result, job, original, posts, get review() { return review; },
    apply(command: Command, actor = 'actor-a') {
      const revision = review.revision + 1, reviewed_at = new Date(Date.parse(MARKET_TIME) + revision * 1000).toISOString();
      review = { ...review, revision, updated_at: reviewed_at, decisions: [...review.decisions.filter(decision => decision.candidate_id !== command.candidateId),
        { candidate_id: command.candidateId, decision: command.decision, actor_id: actor, reviewed_at, revision, request_id: command.requestId }] };
      return review;
    },
    read() { return Response.json({ version: review.revision > 0 ? 2 : 1, jobs: [{ ...job, result_hash: review.result_hash, review }], image_previews: Object.fromEntries(result.candidates.map(candidate => [candidate.image!.storage_key!, `https://private.fixture/${candidate.id}.jpg`])) }); },
    receipt(command: Command, outcome: 'RECORDED' | 'REPLAY' = 'RECORDED') { return Response.json({ version: 1, outcome, request_id: command.requestId, recorded_revision: command.expectedRevision + 1, review }); },
  };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
async function mount(fetcher: typeof fetch, persisted: [string, string][] = []) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://fixture.invalid/', pretendToBeVisual: true });
  const values: Record<string, unknown> = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement,
    sessionStorage: dom.window.sessionStorage, fetch: fetcher, crypto: webcrypto, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, value, writable: true });
  persisted.forEach(([key, value]) => sessionStorage.setItem(key, value));
  const container = document.getElementById('root')!, root = createRoot(container);
  let props = { unitId: 'fixture-unit', descriptionEventId: 'workflow:fixture', token: 'token-a', actorId: 'actor-a',
    inventoryPhotos: { front: 'https://private.fixture/original-front.jpg', back: 'https://private.fixture/original-back.jpg' } };
  const render = async (next: Partial<typeof props> = {}) => { props = { ...props, ...next }; await act(async () => root.render(<Panel {...props} />)); };
  await render();
  return { container, render,
    button(label: string) { const button = [...container.querySelectorAll('button')].find(button => button.textContent?.trim() === label || button.getAttribute('aria-label') === label); assert.ok(button, `Missing ${label}`); return button; },
    async click(label: string) { const button = this.button(label); assert.equal(button.disabled, false); await act(async () => button.click()); },
    storage() { return Object.keys(sessionStorage).map(key => [key, sessionStorage.getItem(key)!] as [string, string]); },
    async pointer(type: string, x: number, y: number, target = container.querySelector('[aria-label="Card and sold comp comparison"]')!) {
      await act(async () => { const event = new dom.window.Event(type, { bubbles: true, cancelable: true }); Object.assign(event, { pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y }); target.dispatchEvent(event); });
    },
    async close() { await act(async () => root.unmount()); dom.window.close(); for (const [key, descriptor] of previous) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); },
  };
}
function handler(f: ReturnType<typeof fixture>, write?: (command: Command, init: RequestInit) => Promise<Response>): typeof fetch {
  return async (url, init) => {
    if (init?.method !== 'POST') return f.read();
    assert.equal(String(url), '/api/v2/admin/inventory/research-review'); const command = JSON.parse(String(init.body)); f.posts.push(command);
    if (write) return write(command, init); f.apply(command); return f.receipt(command);
  };
}

test('side-by-side originals, explicit decisions and restored exclusions use saved projection without changing AI evidence', async () => {
  const f = fixture(), ui = await mount(handler(f));
  try {
    const compare = ui.container.querySelector('[aria-label="Card and sold comp comparison"]')!;
    assert.match(compare.textContent!, /Your card.*eBay sold comp/s);
    assert.equal(compare.querySelector('img')!.src, 'https://private.fixture/original-front.jpg');
    await ui.click('Back'); assert.equal(compare.querySelector('img')!.src, 'https://private.fixture/original-back.jpg');
    assert.match(ui.container.textContent!, /2 AI-selected sold comps/);
    await ui.click('Confirm comp →'); assert.match(ui.container.textContent!, /Partially staff-reviewed · 1 of 2/); assert.match(ui.container.textContent!, /Comp 2 of 2/);
    await ui.click('Exclude comp ←');
    assert.match(ui.container.textContent!, /Fewer than two eligible comparisons/); assert.doesNotMatch(ui.container.textContent!, /\$0\.00/);
    const selected = ui.container.querySelector('[aria-label="Eligible selected comps"]')!;
    assert.equal(selected.querySelectorAll('article').length, 1); assert.equal(selected.querySelector('article')!.getAttribute('aria-label'), 'Fixture comp 1');
    assert.match(ui.container.textContent!, /Staff-excluded comps 1|Staff-excluded comps1/); assert.match(compare.textContent!, /Staff excluded/);
    await ui.click('Restore and confirm comp →');
    assert.match(ui.container.textContent!, /\$20\.03 ÷ 2 sales = \$10\.02/); assert.match(ui.container.textContent!, /Staff-reviewed selection · 2 of 2/);
    assert.equal(ui.container.querySelector('[aria-label="Included in market estimate"]')!.querySelectorAll('article').length, 2);
    assert.deepEqual(f.posts.map(post => post.expectedRevision), [0, 1, 2]); assert.deepEqual(f.posts.map(post => post.candidateId), [f.result.selected_candidate_ids[0], f.result.selected_candidate_ids[1], f.result.selected_candidate_ids[1]]);
    assert.equal(JSON.stringify(f.result), f.original); assert.equal(ui.storage().length, 0);
  } finally { await ui.close(); }
});

test('double taps and uncertain saves retain exact bytes across remount; explicit replay adopts newer saved review', async () => {
  const f = fixture(), response = deferred<Response>(); let bytes = '';
  const ui = await mount(handler(f, async (command, init) => { bytes = String(init.body); f.apply(command); return response.promise; }));
  let saved: [string, string][];
  try {
    await act(async () => { ui.button('Exclude comp ←').click(); ui.button('Confirm comp →').click(); });
    assert.equal(f.posts.length, 1); assert.match(ui.container.textContent!, /2 AI-selected sold comps/, 'No optimistic projection');
    await act(async () => response.resolve(Response.json({ message: 'unknown response' }, { status: 503 })));
    saved = ui.storage(); assert.equal(saved.length, 1); assert.equal(saved[0][1].includes('token-a'), false); assert.equal(saved[0][1].includes('original-front'), false);
    assert.equal(ui.button('Confirm comp →').disabled, true);
  } finally { await ui.close(); }
  // A legitimate later decision supersedes the first, while its replay still acknowledges its original revision.
  f.apply({ ...f.posts[0], requestId: webcrypto.randomUUID(), expectedRevision: 1, decision: 'confirmed' }, 'actor-b');
  const resumed = await mount(handler(f, async (command, init) => { assert.equal(String(init.body), bytes); return f.receipt(command, 'REPLAY'); }), saved!);
  try { await resumed.click('Retry saved decision'); assert.equal(f.posts.length, 2); assert.match(resumed.container.textContent!, /Saved decision recovered/); assert.equal(resumed.storage().length, 0); assert.match(resumed.container.textContent!, /\$20\.03 ÷ 2 sales = \$10\.02/); }
  finally { await resumed.close(); }
});

test('409 rereads current review and preserves rejected command before a deliberate new decision', async () => {
  const f = fixture(); let reads = 0;
  const fetcher = handler(f, async command => {
    if (f.posts.length === 1) { f.apply({ ...command, requestId: webcrypto.randomUUID(), candidateId: f.result.selected_candidate_ids[1] }, 'actor-b'); return Response.json({ message: 'Review changed' }, { status: 409 }); }
    f.apply(command); return f.receipt(command);
  });
  const ui = await mount(async (url, init) => { if (init?.method !== 'POST') reads++; return fetcher(url, init); });
  try {
    await ui.click('Exclude comp ←'); assert.equal(reads, 2); assert.match(ui.container.textContent!, /The research or review changed/);
    assert.equal(ui.button('Confirm comp →').disabled, true); await ui.click('Use latest review');
    assert.equal(ui.storage().filter(([key]) => key.includes(':rejected:')).length, 1);
    await ui.click('Confirm comp →'); assert.equal(f.posts[1].expectedRevision, 1); assert.notEqual(f.posts[1].requestId, f.posts[0].requestId);
  } finally { await ui.close(); }
});

test('a failed conflict refresh cannot unlock decisions until a fresh snapshot is loaded', async () => {
  const f = fixture(); let reads = 0;
  const fetcher = handler(f, async command => { f.apply({ ...command, requestId: webcrypto.randomUUID() }, 'actor-b'); return Response.json({}, { status: 409 }); });
  const ui = await mount(async (url, init) => {
    if (init?.method !== 'POST' && ++reads === 2) return Response.json({}, { status: 503 });
    return fetcher(url, init);
  });
  try {
    await ui.click('Exclude comp ←'); assert.match(ui.container.textContent!, /Research is temporarily unavailable/);
    assert.equal(ui.container.querySelector('[aria-label="Review selected sold comps"]'), null); assert.equal(f.posts.length, 1); assert.equal(ui.storage().length, 1);
    await ui.click('Refresh research'); assert.equal(reads, 3); assert.equal(ui.button('Restore and confirm comp →').disabled, true);
    await ui.click('Use latest review'); assert.equal(ui.button('Restore and confirm comp →').disabled, false); assert.equal(f.posts.length, 1);
  } finally { await ui.close(); }
});

test('horizontal swipe decisions match accessible buttons while vertical/cancel/zoom/interactive gestures never save', async () => {
  const f = fixture(), ui = await mount(handler(f));
  try {
    await ui.pointer('pointerdown', 20, 30); await ui.pointer('pointermove', 100, 90); await ui.pointer('pointerup', 150, 90); assert.equal(f.posts.length, 0);
    await ui.pointer('pointerdown', 20, 30); await ui.pointer('pointercancel', 20, 30); await ui.pointer('pointerup', 150, 30); assert.equal(f.posts.length, 0);
    const button = ui.button('Back'); await ui.pointer('pointerdown', 20, 30, button); await ui.pointer('pointerup', 150, 30, button); assert.equal(f.posts.length, 0);
    await ui.click('Enlarge front of your inventory card'); assert.equal(document.activeElement?.textContent, 'Close enlarged photo');
    await ui.pointer('pointerdown', 20, 30); await ui.pointer('pointerup', 150, 30); assert.equal(f.posts.length, 0); await ui.click('Close enlarged photo');
    const image = ui.button('Enlarge front of your inventory card').querySelector('img')!;
    await ui.pointer('pointerdown', 20, 30, image); await ui.pointer('pointerup', 150, 35, image); assert.equal(f.posts[0].decision, 'confirmed');
    await ui.click('Enlarge front of your inventory card'); assert.equal(ui.container.querySelector('[aria-label^="Enlarged "]'), null, 'Synthetic click after swipe must not open zoom');
    await ui.pointer('pointerdown', 150, 30); await ui.pointer('pointerup', 20, 30); assert.equal(f.posts[1].decision, 'excluded');
    assert.equal(ui.button('Next comp').disabled, true); await ui.click('Previous comp'); assert.equal(ui.button('Previous comp').disabled, true);
    assert.match(ui.container.textContent!, /Comp 1 of 2 · 1 confirmed · 1 excluded · 0 awaiting review/); assert.match(ui.container.textContent!, /Staff decision saved/);
  } finally { await ui.close(); }
});

test('late mutation receipts cannot enter a different actor/session and the old command stays recoverable', async () => {
  const f = fixture(), response = deferred<Response>(); let signal: AbortSignal | undefined;
  const ui = await mount(handler(f, async (_command, init) => { signal = init.signal ?? undefined; return response.promise; }));
  try {
    await ui.click('Exclude comp ←'); await ui.render({ token: 'token-b', actorId: 'actor-b' }); assert.equal(signal?.aborted, true);
    const command = f.posts[0]; f.apply(command);
    await act(async () => response.resolve(f.receipt(command)));
    assert.match(ui.container.textContent!, /2 AI-selected sold comps/); assert.doesNotMatch(ui.container.textContent!, /Comp excluded\. The saved value/);
    assert.equal(ui.storage().length, 1); assert.equal(ui.button('Confirm comp →').disabled, false);
  } finally { await ui.close(); }
});

test('mismatched receipt cannot clear the pending command or recalculate the value', async () => {
  const f = fixture(), ui = await mount(handler(f, async command => { f.apply(command); return Response.json({ version: 1, outcome: 'RECORDED', request_id: webcrypto.randomUUID(), recorded_revision: 1, review: f.review }); }));
  try { await ui.click('Exclude comp ←'); assert.match(ui.container.textContent!, /This decision could not be confirmed/); assert.match(ui.container.textContent!, /2 AI-selected sold comps/); assert.equal(ui.storage().length, 1); assert.ok(ui.button('Retry saved decision')); }
  finally { await ui.close(); }
});

test('review snapshots must bind every job field before value or review controls render', async () => {
  for (const wrong of [{ job_id: '22222222-2222-4222-8222-222222222222' }, { unit_id: 'other-unit' }, { description_event_id: 'other-event' }, { input_hash: '0'.repeat(64) }, { result_hash: '0'.repeat(64) }]) {
    const f = fixture(), ui = await mount(async () => Response.json({ version: 1, jobs: [{ ...f.job, result_hash: f.review.result_hash, review: { ...f.review, ...wrong } }], image_previews: {} }));
    try { assert.match(ui.container.textContent!, /Research is temporarily unavailable/); assert.equal(ui.container.querySelector('[aria-label="Review selected sold comps"]'), null); assert.equal(ui.container.querySelector('[aria-label="Included in market estimate"]'), null); }
    finally { await ui.close(); }
  }
});

test('reviewed response version cannot omit its positive bound review and fall back to the AI value', async () => {
  for (const mutate of [() => ({ review: null }), () => ({ result_hash: null }), (f: ReturnType<typeof fixture>) => ({ review: f.review })]) {
    const f = fixture(), ui = await mount(async () => Response.json({ version: 2, jobs: [{ ...f.job, result_hash: f.review.result_hash, review: f.review, ...mutate(f) }], image_previews: {} }));
    try { assert.match(ui.container.textContent!, /Research is temporarily unavailable/); assert.equal(ui.container.querySelector('[aria-label="Review selected sold comps"]'), null); assert.doesNotMatch(ui.container.textContent!, /\$10\.02/); }
    finally { await ui.close(); }
  }
});

test('receipts require a valid selected-comp projection and the recorded actor and revision before clearing recovery', async () => {
  for (const corrupt of [
    (review: Review, f: ReturnType<typeof fixture>) => ({ ...review, revision: 2, updated_at: new Date(Date.parse(MARKET_TIME) + 2000).toISOString(), decisions: [...review.decisions, { ...review.decisions[0], candidate_id: f.result.candidates[2].id, revision: 2, reviewed_at: new Date(Date.parse(MARKET_TIME) + 2000).toISOString(), request_id: webcrypto.randomUUID() }] }),
    (review: Review) => ({ ...review, decisions: review.decisions.map(decision => ({ ...decision, actor_id: 'another-actor' })) }),
    (review: Review) => ({ ...review, revision: 2, decisions: review.decisions.map(decision => ({ ...decision, revision: 2 })) }),
  ]) {
    const f = fixture(), ui = await mount(handler(f, async command => { f.apply(command); return Response.json({ version: 1, outcome: 'RECORDED', request_id: command.requestId, recorded_revision: 1, review: corrupt(f.review, f) }); }));
    try { await ui.click('Exclude comp ←'); assert.match(ui.container.textContent!, /This decision could not be confirmed/); assert.match(ui.container.textContent!, /2 AI-selected sold comps/); assert.equal(ui.storage().length, 1); assert.ok(ui.button('Retry saved decision')); }
    finally { await ui.close(); }
  }
});

test('a receipt body that arrives after its deadline cannot be adopted or erase recovery', async () => {
  const f = fixture(), body = deferred<unknown>(); let timeout!: () => void, signal: AbortSignal | null | undefined;
  const originalTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((callback: () => void, delay: number, ...args: unknown[]) => {
    if (delay === 20000) { timeout = callback; return originalTimeout(() => undefined, 60000); }
    return originalTimeout(callback, delay, ...args);
  }) as typeof setTimeout;
  const ui = await mount(handler(f, async (command, init) => { signal = init.signal; f.apply(command); return { ok: true, status: 200, json: () => body.promise } as Response; }));
  try {
    await ui.click('Exclude comp ←'); await act(async () => timeout()); assert.equal(signal?.aborted, true);
    await act(async () => body.resolve({ version: 1, outcome: 'RECORDED', request_id: f.posts[0].requestId, recorded_revision: 1, review: f.review }));
    assert.match(ui.container.textContent!, /This decision could not be confirmed/); assert.match(ui.container.textContent!, /2 AI-selected sold comps/); assert.equal(ui.storage().length, 1);
  } finally { await ui.close(); globalThis.setTimeout = originalTimeout; }
});
