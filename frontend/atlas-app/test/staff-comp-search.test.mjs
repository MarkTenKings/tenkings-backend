import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createStaffCompSearchClient } from '../lib/staff-comp-search-client.mjs';
import { createStaffCompSearchController } from '../lib/staff-comp-search-controller.mjs';

function fixture() {
  const f = { staff: { id: randomUUID(), role: 'REVIEWER', mode: 'LOCAL_FIXTURE' },
    card: { cardId: randomUUID(), approvalActionId: randomUUID(), report: { state: 'PUBLISHED', publicToken: `ar_${'a'.repeat(24)}`, version: 1, publicHash: 'b'.repeat(64) } },
    values: new Map(), calls: [], live: true, blocked: false, market: { state: 'NOT_REQUESTED', refreshable: true } };
  f.storage = { getItem: key => f.values.get(key) ?? null, setItem: (key, value) => f.values.set(key, value), removeItem: key => f.values.delete(key) };
  f.ready = id => ({ state: 'READY', refreshable: true, previewId: id, approvalActionId: f.card.approvalActionId,
    preview: { binding: { publicToken: f.card.report.publicToken, approvalVersion: 1, publicHash: f.card.report.publicHash }, candidates: [] } });
  f.request = async (path, options) => {
    f.calls.push({ path, options });
    if (options.method === 'GET') { if (f.read) return f.read(); return { approvalActionId: f.card.approvalActionId, revision: 3, marketSearch: f.market }; }
    assert(path.endsWith('/market/search')); assert(f.values.size, 'persist original request before POST');
    if (f.post) return f.post(options.body);
    f.market = f.ready(options.body.requestId); return f.market;
  };
  f.options = { staff: f.staff, card: f.card, request: f.request, storage: f.storage, isCurrent: () => f.live, canSearch: () => !f.blocked, cryptoImpl: { randomUUID } };
  f.client = createStaffCompSearchClient(f.options); f.posts = () => f.calls.filter(v => v.options.method === 'POST'); return f;
}

test('construction, saved reads and controller reload only GET; explicit start binds current approval/revision', async () => {
  const f = fixture(), callbacks = [], control = createStaffCompSearchController({ ...f.options, onReady: value => callbacks.push(value) });
  assert.equal(f.calls.length, 0); await control.read(); await control.read(); assert.equal(f.posts().length, 0);
  await control.start(); assert.equal(f.posts().length, 1);
  assert.deepEqual(Object.keys(f.posts()[0].options.body).sort(), ['approvalActionId', 'expectedRevision', 'requestId']);
  assert.equal(f.posts()[0].options.body.approvalActionId, f.card.approvalActionId); assert.equal(f.posts()[0].options.body.expectedRevision, 3);
  await control.read(); assert.equal(callbacks.length, 1); assert.equal(f.posts().length, 1); assert.equal(f.values.size, 0); control.close();
});

test('lost response survives a new client; GET does not replay and retry sends exactly the original request', async () => {
  const f = fixture(); f.post = () => { throw Error('lost reply'); }; await assert.rejects(f.client.start());
  const first = structuredClone(f.posts()[0].options.body), client = createStaffCompSearchClient(f.options);
  await client.read(); assert.equal(f.posts().length, 1); await assert.rejects(client.start(), { code: 'COMP_SEARCH_RECONCILE_REQUIRED' });
  f.post = body => ({ state: 'QUEUED', refreshable: false, previewId: body.requestId, approvalActionId: f.card.approvalActionId });
  await client.retry(); assert.deepEqual(f.posts()[1].options.body, first); assert.equal(client.pending(), true);
  f.market = f.ready(first.requestId); await client.read(); assert.equal(client.pending(), false);
  f.post = undefined; await client.start(); assert.notEqual(f.posts()[2].options.body.requestId, first.requestId);
});

test('a different latest result cannot clear an uncertain original request; UNKNOWN blocks new acquisition', async () => {
  const f = fixture(); f.post = () => { throw Error('lost'); }; await assert.rejects(f.client.start());
  f.market = f.ready(randomUUID()); const read = await f.client.read(); assert.equal(read.pending, true);
  await assert.rejects(f.client.start(), { code: 'COMP_SEARCH_RECONCILE_REQUIRED' }); assert.equal(f.posts().length, 1);
  const g = fixture(); g.market = { state: 'UNKNOWN', previewId: randomUUID(), approvalActionId: g.card.approvalActionId, refreshable: false };
  await assert.rejects(g.client.start(), { code: 'COMP_SEARCH_RECONCILE_REQUIRED' }); assert.equal(g.posts().length, 0);
});

test('saved-response recovery retains original preview and never claims to be a new pool', async () => {
  const f = fixture(), original = randomUUID();
  f.market = { state: 'FAILED', previewId: original, approvalActionId: f.card.approvalActionId, refreshable: true, refreshAction: 'RETRY_SAVED_RESPONSE' };
  assert.equal((await f.client.read()).retrySavedResponse, true);
  f.post = body => ({ state: 'QUEUED', previewId: original, requestId: body.requestId, approvalActionId: f.card.approvalActionId, refreshable: false });
  await f.client.start(); const saved = JSON.parse([...f.values.values()][0]); assert.equal(saved.previewId, original);
  f.market = f.ready(original); assert.equal((await f.client.read()).pending, false); assert.equal(f.posts().length, 1);
});

test('selected draft blocks before and after status read; storage failure and existing public save prevent POST', async () => {
  const f = fixture(); f.blocked = true; await assert.rejects(f.client.start(), { code: 'COMP_SEARCH_SELECTION_PENDING' }); assert.equal(f.calls.length, 0);
  f.blocked = false; f.read = () => { f.blocked = true; return { approvalActionId: f.card.approvalActionId, revision: 3, marketSearch: f.market }; };
  await assert.rejects(f.client.start(), { code: 'COMP_SEARCH_SELECTION_PENDING' }); assert.equal(f.posts().length, 0);
  const g = fixture(); g.storage.setItem = () => { throw Error('blocked storage'); }; await assert.rejects(g.client.start(), { code: 'COMP_SEARCH_STORAGE_UNAVAILABLE' }); assert.equal(g.posts().length, 0);
  const h = fixture(); h.values.set(`atlas-report-market:${h.staff.id}:${h.card.cardId}`, JSON.stringify({ version: 1, cardId: h.card.cardId, staffId: h.staff.id,
    search: { requestId: randomUUID(), approvalActionId: h.card.approvalActionId, expectedRevision: 0 }, selection: { selectedIds: ['saved'] } }));
  await assert.rejects(h.client.start(), { code: 'COMP_SEARCH_SELECTION_PENDING' }); assert.equal(h.posts().length, 0);
});

test('scope/access changes during awaited status cannot dispatch; late READY cannot reach another card', async () => {
  const f = fixture(); f.read = () => { f.live = false; return { approvalActionId: f.card.approvalActionId, revision: 3, marketSearch: f.market }; };
  await assert.rejects(f.client.start(), { code: 'COMP_ACCESS_ENDED' }); assert.equal(f.posts().length, 0);
  const g = fixture(); let finish; g.read = () => new Promise(resolve => { finish = resolve; }); const ready = [], lost = [];
  const control = createStaffCompSearchController({ ...g.options, onReady: value => ready.push(value), onAccessLost: () => lost.push(true) });
  const run = control.read(); g.live = false; finish({ approvalActionId: g.card.approvalActionId, revision: 0, marketSearch: g.ready(randomUUID()) }); await run;
  assert.equal(ready.length, 0); assert.equal(lost.length, 1); assert.equal(g.posts().length, 0);
});

test('only exact pre-reservation stale rejection clears intent; malformed/wrong report response remains unresolved', async () => {
  const f = fixture(); f.post = () => { throw Object.assign(Error(), { status: 409, code: 'PRESENTATION_REVISION_STALE' }); };
  await assert.rejects(f.client.start()); assert.equal(f.values.size, 0); assert.equal(f.posts().length, 1);
  const g = fixture(); g.post = body => { const value = g.ready(body.requestId); value.preview.binding.publicHash = 'c'.repeat(64); return value; };
  await assert.rejects(g.client.start(), { code: 'COMP_SEARCH_APPROVAL_CHANGED' }); assert.equal(g.client.pending(), true); assert.equal(g.posts().length, 1);
});
