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
    if (!options) return { approvalActionId: f.approvalActionId, revision: f.revision, presentation: null, ...(f.marketSearch ? {marketSearch:f.marketSearch} : {}) };
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
    f.search = body => ({ state, previewId: body.requestId });
    if (state === 'UNKNOWN') assert.equal((await f.client.preview()).state, state);
    else await assert.rejects(f.client.preview(), { code: `MARKET_SEARCH_${state}` });
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

test('proven pre-dispatch revision refusal cannot strand a saved search or automatically spend on a replacement', async () => {
  const f = fixture(); f.search = () => { throw Object.assign(new Error(), { code: 'PRESENTATION_REVISION_STALE', status: 409 }); };
  await assert.rejects(f.client.preview(), { code: 'MARKET_SEARCH_REVIEW_REQUIRED' }); assert.equal(f.client.pending(), null); assert.equal(f.searches, 1);
  const refused = f.calls.at(-1).options.body.requestId; f.search = undefined; f.revision = 1;
  await f.client.preview(); assert.equal(f.searches, 2); assert.notEqual(f.client.pending().search.requestId, refused);
  assert.equal(f.client.pending().search.expectedRevision, 1);
});


test('latest saved approval result can be selected across a new session without buying a search', async () => {
  const f = fixture(), previewId = randomUUID();
  f.marketSearch = { state: 'READY', approvalActionId: f.approvalActionId, previewId, refreshable: true, preview: { binding: { approvalVersion: 1 } } };
  const status = await f.client.read(); assert.equal(status.marketSearch.previewId, previewId); assert.equal(f.values.size, 0);
  await f.client.select({ previewId, selectedIds: ['ebay:123456789012'] });
  assert.equal(f.searches, 0); assert.equal(f.selections, 1); assert.equal(f.calls.at(-1).options.body.previewId, previewId);
});
test('queued requests survive reload until a saved read confirms the same result; only explicit refresh buys another', async () => {
  const f = fixture(); f.search = body => ({ state: 'QUEUED', previewId: body.requestId, refreshable: false });
  const queued = await f.client.preview(); f.client = createReportMarketClient(f.options);
  f.marketSearch = { state: 'READY', approvalActionId: f.approvalActionId, previewId: queued.previewId, refreshable: true, preview: { binding: { approvalVersion: 1 } } };
  await f.client.read(); assert.equal(f.searches, 1);
  const refresh = await f.client.preview(); assert.notEqual(refresh.previewId, queued.previewId); assert.equal(f.searches, 2);
});
test('latest saved preview cannot replace an unresolved publication intent', async () => {
  const f = fixture(), original = await f.client.preview(); f.select = () => { throw Error('lost reply'); };
  await assert.rejects(f.client.select({ previewId: original.previewId, selectedIds: ['ebay:123456789012'] }));
  const retained = structuredClone(f.client.pending());
  f.marketSearch = { state: 'READY', approvalActionId: f.approvalActionId, previewId: randomUUID(), preview: {} };
  await f.client.read(); await assert.rejects(f.client.select({ previewId: f.marketSearch.previewId, selectedIds: ['other'] }), { code: 'MARKET_PREVIEW_MISMATCH' });
  assert.deepEqual(f.client.pending(), retained); assert.equal(f.selections, 1);
});


test('authoritative refreshable terminal failure allows a new id only on explicit refresh', async () => {
  const f = fixture(); f.search = body => ({ state: 'QUEUED', previewId: body.requestId, refreshable: false });
  const first = await f.client.preview(); f.client = createReportMarketClient(f.options);
  f.marketSearch = { state: 'FAILED', approvalActionId: f.approvalActionId, previewId: first.previewId, refreshable: true };
  await f.client.read(); assert.equal(f.searches, 1);
  const second = await f.client.preview(); assert.notEqual(second.previewId, first.previewId); assert.equal(f.searches, 2);
});
test('a newer unknown job fences an explicit refresh after an earlier ready result', async () => {
  const f = fixture(), first = await f.client.preview();
  f.marketSearch = { state: 'UNKNOWN', approvalActionId: f.approvalActionId, previewId: randomUUID(), refreshable: false };
  const result = await f.client.preview(); assert.equal(result.state, 'UNKNOWN'); assert.equal(f.searches, 1);
  assert.equal(f.client.pending().search.requestId, first.previewId);
});


test('saved-response retry retains new action id and original preview across reload and selection', async () => {
  const f = fixture(), original = randomUUID();
  f.marketSearch = { state: 'FAILED', approvalActionId: f.approvalActionId, previewId: original, refreshable: true, refreshAction: 'RETRY_SAVED_RESPONSE' };
  f.search = body => ({ state: 'QUEUED', requestId: body.requestId, previewId: original, refreshable: false });
  const result = await f.client.preview(); assert.equal(result.previewId, original); assert.notEqual(f.client.pending().search.requestId, original);
  const retryAction = f.client.pending().search.requestId; assert.equal(f.client.pending().previewId, original);
  f.client = createReportMarketClient(f.options); assert.equal(f.client.pending().search.requestId, retryAction);
  f.marketSearch = { state: 'READY', approvalActionId: f.approvalActionId, previewId: original, refreshable: true, preview: {} };
  await f.client.read(); await f.client.select({ previewId: original, selectedIds: ['ebay:123456789012'] });
  assert.equal(f.calls.at(-1).options.body.previewId, original); assert.equal(f.selections, 1); assert.equal(f.values.size, 0);
});
test('a mismatched recovery response cannot silently replace the saved preview', async () => {
  const f = fixture(); f.search = () => ({ state: 'QUEUED', requestId: randomUUID(), previewId: randomUUID(), refreshable: false });
  await assert.rejects(f.client.preview(), { code: 'MARKET_PREVIEW_MISMATCH' }); assert.equal(f.client.pending().previewId, undefined);
});


test('confirmed expired provider evidence buys no search on read and uses a new id only on explicit fresh search', async () => {
  const f = fixture(), first = await f.client.preview();
  f.client = createReportMarketClient(f.options);
  f.marketSearch = { state: 'FAILED', approvalActionId: f.approvalActionId, previewId: first.previewId,
    reason: 'MARKET_PREVIEW_EXPIRED', refreshable: true, refreshAction: 'SEARCH_AGAIN' };
  await f.client.read(); assert.equal(f.searches, 1); assert.equal(f.client.pending().search.requestId, first.previewId);
  f.search = body => ({ state: 'QUEUED', requestId: body.requestId, previewId: body.requestId, refreshable: false });
  const fresh = await f.client.preview(); assert.notEqual(fresh.previewId, first.previewId); assert.equal(f.searches, 2);
  assert.equal(f.client.pending().search.requestId, fresh.previewId); assert.equal(f.client.pending().previewId, undefined);
});
