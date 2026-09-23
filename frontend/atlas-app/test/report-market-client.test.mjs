import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createReportMarketClient } from '../lib/report-market-client.mjs';

function fixture() {
  const values = new Map(), calls = [], staffId = randomUUID(), cardId = randomUUID(), approvalActionId = randomUUID();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const f = { values, calls, revision: 0, searches: 0, selections: 0, approvalActionId, storage };
  f.request = async (url, options) => {
    calls.push({ url, options });
    if (!options) return { approvalActionId: f.approvalActionId, revision: f.revision, presentation: null };
    assert.ok(values.size, 'persist exact request before mutation');
    if (url.endsWith('/search')) { f.searches++; if (f.search) return f.search(options.body);
      return { state: 'READY', previewId: options.body.requestId, preview: { binding: { approvalVersion: 1 } } }; }
    assert.ok(url.endsWith('/select')); f.selections++; if (f.select) return f.select(options.body);
    return { approvalActionId: f.approvalActionId, revision: f.revision + 1, presentation: { market: { sales: options.body.selectedIds.map(id => ({ id })) } } };
  };
  f.options = { staffId, cardId, approvalActionId, storage, request: f.request, cryptoImpl: { randomUUID } };
  f.client = createReportMarketClient(f.options); return f;
}
test('search is explicit, approval/revision-bound and selection sends only saved preview and ids', async () => {
  const f = fixture(); assert.equal(f.calls.length, 0); const result = await f.client.preview();
  assert.equal(f.searches, 1); assert.equal(f.calls[0].options, undefined); assert.equal(f.client.pending().search.expectedRevision, 0);
  f.revision = 2; await f.client.select({ previewId: result.previewId, selectedIds: ['ebay:123456789012'] });
  const input = f.calls.at(-1).options.body; assert.equal(input.expectedRevision, 2);
  assert.deepEqual(Object.keys(input).sort(), ['approvalActionId', 'expectedRevision', 'previewId', 'requestId', 'selectedIds']); assert.equal(f.values.size, 0);
});
test('uncertain search and reload replay one saved request; PENDING or UNKNOWN never creates another request id', async () => {
  const f = fixture(); f.search = () => { throw new Error('lost reply'); }; await assert.rejects(f.client.preview());
  const first = structuredClone(f.calls.at(-1).options.body); f.client = createReportMarketClient(f.options);
  for (const state of ['PENDING', 'UNKNOWN']) {
    f.search = body => ({ state, previewId: body.requestId }); await assert.rejects(f.client.preview(), { code: `MARKET_SEARCH_${state}` });
    assert.deepEqual(f.calls.at(-1).options.body, first);
  }
  f.search = undefined; const result = await f.client.preview(); assert.equal(result.previewId, first.requestId);
  // A refresh after an observed READY result is another explicit search.
  const second = await f.client.preview(); assert.notEqual(second.previewId, first.requestId);
});
test('lost selection reply survives reload, rejects replacement and resumes exactly once saved', async () => {
  const f = fixture(), preview = await f.client.preview(); f.select = () => { throw new Error('lost selection reply'); };
  await assert.rejects(f.client.select({ previewId: preview.previewId, selectedIds: ['ebay:123456789012'] }));
  const selected = structuredClone(f.client.pending().selection); f.client = createReportMarketClient(f.options);
  await assert.rejects(f.client.preview(), { code: 'MARKET_SELECTION_PENDING' });
  await assert.rejects(f.client.select({ previewId: preview.previewId, selectedIds: ['different'] }), { code: 'MARKET_SELECTION_PENDING' });
  f.select = undefined; await f.client.resumeSelection(); assert.deepEqual(f.calls.at(-1).options.body, selected); assert.equal(f.values.size, 0);
});
test('wrong or unconfirmed selection responses retain original request; changed approval needs verified reconciliation', async () => {
  const f = fixture(), preview = await f.client.preview();
  f.select = () => ({ approvalActionId: f.approvalActionId, revision: 1, presentation: { market: { sales: [{ id: 'wrong' }] } } });
  await assert.rejects(f.client.select({ previewId: preview.previewId, selectedIds: ['ebay:123456789012'] }), { code: 'MARKET_COMMIT_UNCONFIRMED' });
  assert.ok(f.client.pending().selection); await assert.rejects(f.client.reconcileSuperseded(), { code: 'MARKET_REQUEST_CURRENT' });
  f.approvalActionId = randomUUID(); const current = createReportMarketClient({ ...f.options, approvalActionId: f.approvalActionId });
  await current.reconcileSuperseded(); assert.equal(f.values.size, 0);
});
test('staff-scoped storage and disabled storage prevent an untracked provider request', async () => {
  const f = fixture(); await f.client.preview();
  const other = createReportMarketClient({ ...f.options, staffId: randomUUID() }); assert.equal(other.pending(), null);
  const broken = createReportMarketClient({ ...f.options, storage: { ...f.storage, getItem: () => null, setItem: () => { throw new Error('storage unavailable'); } } });
  await assert.rejects(broken.preview(), /storage unavailable/); assert.equal(f.searches, 1);
});
test('only definitive post-receipt stale refusals release a selection for fresh review', async () => {
  for (const code of ['MARKET_PREVIEW_EXPIRED', 'PRESENTATION_REVISION_STALE', 'PRESENTATION_APPROVAL_STALE']) {
    const f = fixture(), preview = await f.client.preview();
    f.select = () => { throw Object.assign(new Error(code), { code, status: 409 }); };
    await assert.rejects(f.client.select({ previewId: preview.previewId, selectedIds: ['ebay:123456789012'] }), { code: 'MARKET_SELECTION_REVIEW_REQUIRED' });
    assert.equal(f.client.pending(), null);
  }
});
