import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createCardHistoryCompSearch } from '../lib/card-history-comp-search.mjs';

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function fixture() {
  const f = { staff: { id: randomUUID(), role: 'REVIEWER', mode: 'LOCAL_FIXTURE' }, cardId: randomUUID(), current: true,
    events: new EventTarget(), calls: [], sessions: 0, before: null, after: null, target: null };
  f.options = { enabled: true, staff: f.staff, cardId: f.cardId, events: f.events, isCurrent: () => f.current,
    async fetchImpl(path, init) {
      f.calls.push({ path, init });
      if (path === '/admin/api/staff/session') {
        const hook = ++f.sessions === 1 ? f.before : f.after;
        return hook ? hook() : json({ staff: f.staff, csrf: 'fixture-csrf', mode: 'LOCAL_FIXTURE' });
      }
      return f.target ? f.target(path, init) : json({ revision: 0, marketSearch: { state: 'NOT_REQUESTED' } });
    } };
  f.composition = createCardHistoryCompSearch(f.options);
  f.path = `/api/staff/manual-connected/cards/${f.cardId}/presentation`;
  f.body = { requestId: randomUUID(), approvalActionId: randomUUID(), expectedRevision: 0 };
  f.read = () => f.composition.request(f.path);
  f.search = () => f.composition.request(`${f.path}/market/search`, { method: 'POST', body: f.body });
  return f;
}

test('search composition is explicit/default-off and rejects all routes outside the fixed card read/search contract', async t => {
  for (const enabled of [undefined, false, 'true', 1]) assert.equal(createCardHistoryCompSearch({ enabled }), null);
  assert.throws(() => createCardHistoryCompSearch({ enabled: true }), { code: 'COMP_NOT_CONFIGURED' });
  const f = fixture(); t.after(f.composition.close); assert.equal(f.calls.length, 0);
  const cases = [
    [f.path.replace(f.cardId, randomUUID()), {}], [`${f.path}?q=x`, {}], [`https://example.test${f.path}`, {}],
    [`${f.path}/market`, {}], [`${f.path}/market/search`, {}], [`${f.path}/market/select`, { method: 'POST', body: f.body }],
    [f.path, { method: 'POST', body: f.body }], [f.path, { method: 'GET', body: {} }], [f.path, { method: 'GET', csrf: 'injected' }],
    [`${f.path}/market/search`, { method: 'POST', body: { ...f.body, selectedIds: [] } }],
    [`${f.path}/market/search`, { method: 'POST', body: { ...f.body, expectedRevision: -1 } }],
    [`${f.path}/market/search`, { method: 'POST', body: { ...f.body, afterPreviewId: '' } }],
  ];
  for (const [path, input] of cases) await assert.rejects(f.composition.request(path, input), { code: 'COMP_REQUEST_INVALID' });
  assert.equal(f.calls.length, 0);
});

test('status uses only GET and explicit search sends exactly one copied original intent with freshly verified CSRF', async t => {
  const f = fixture(); t.after(f.composition.close);
  assert.deepEqual(await f.read(), { revision: 0, marketSearch: { state: 'NOT_REQUESTED' } });
  assert.equal(f.calls.length, 3); assert(f.calls.every(c => c.init.method === 'GET'));
  const original = { ...f.body }, entered = deferred(), release = deferred(); f.sessions = 0;
  f.before = async () => { entered.resolve(); await release.promise; return json({ staff: f.staff, csrf: 'fresh-csrf', mode: 'LOCAL_FIXTURE' }); };
  f.after = () => json({ staff: f.staff, csrf: 'fresh-csrf', mode: 'LOCAL_FIXTURE' });
  const pending = f.search(); await entered.promise; f.body.requestId = randomUUID(); release.resolve(); await pending;
  const posts = f.calls.filter(c => c.init.method === 'POST'); assert.equal(posts.length, 1);
  assert.deepEqual(JSON.parse(posts[0].init.body), original); assert.equal(posts[0].init.headers['X-Atlas-Csrf'], 'fresh-csrf');
  assert(f.calls.every(c => c.init.credentials === 'same-origin' && c.init.cache === 'no-store' && c.init.redirect === 'error'));
  f.body = { ...original, afterPreviewId: randomUUID() }; f.before = null;
  await f.search();
  assert.deepEqual(JSON.parse(f.calls.findLast(c => c.init.method === 'POST').init.body), f.body, 'retained existing pagination intent remains exact');
});

test('wrong initial actor or access refusal ends the capability before any target call', async () => {
  for (const before of [f => json({ staff: { ...f.staff, id: randomUUID() }, csrf: 'csrf', mode: 'LOCAL_FIXTURE' }),
    () => json({ error: 'ACCESS_ENDED' }, 401), f => json({ staff: f.staff, csrf: '', mode: 'LOCAL_FIXTURE' })]) {
    const f = fixture(); f.before = () => before(f);
    await assert.rejects(f.search(), { code: 'COMP_ACCESS_ENDED' }); assert.equal(f.calls.length, 1);
    await assert.rejects(f.read(), { code: 'COMP_ACCESS_ENDED' }); assert.equal(f.calls.length, 1); f.composition.close();
  }
});

test('final actor/CSRF/mode drift refuses successful bytes after one POST without replay', async () => {
  for (const after of [f => ({ staff: { ...f.staff, id: randomUUID() }, csrf: 'fixture-csrf', mode: 'LOCAL_FIXTURE' }),
    f => ({ staff: f.staff, csrf: 'changed-csrf', mode: 'LOCAL_FIXTURE' }), f => ({ staff: f.staff, csrf: 'fixture-csrf', mode: 'OTHER' })]) {
    const f = fixture(); f.after = () => json(after(f));
    await assert.rejects(f.search(), { code: 'COMP_ACCESS_ENDED' }); assert.equal(f.calls.length, 3);
    assert.equal(f.calls.filter(c => c.init.method === 'POST').length, 1); assert.equal(f.composition.isCurrent(), false); f.composition.close();
  }
});

test('only a verified final session can expose a definitive target denial; unknown/malformed outcomes carry no target HTTP status', async () => {
  for (const finalFailure of [false, true]) {
    const f = fixture(); f.target = () => json({ error: 'PRESENTATION_REVISION_STALE' }, 409);
    if (finalFailure) f.after = () => new Response('not-json', { status: 200 });
    await assert.rejects(f.search(), error => finalFailure ? error.code === 'REQUEST_OUTCOME_UNCONFIRMED' && !error.status
      : error.code === 'PRESENTATION_REVISION_STALE' && error.status === 409);
    assert.equal(f.calls.filter(c => c.init.method === 'POST').length, 1); f.composition.close();
  }
  const f = fixture(); f.target = () => new Response('{"error":"bad error"}', { status: 409 });
  await assert.rejects(f.search(), error => error.code === 'REQUEST_OUTCOME_UNCONFIRMED' && !error.status);
  assert.equal(f.calls.length, 2); f.composition.close();
});

test('scope mutation during initial session refuses a target; mutation during target refuses a final session', async () => {
  for (const stage of ['before', 'target']) for (const mutate of [f => { f.options.enabled = false; }, f => { f.options.cardId = randomUUID(); },
    f => { f.options.staff = { ...f.staff }; }, f => { f.staff.mode = 'OTHER'; }, f => { f.current = false; }]) {
    const f = fixture(), entered = deferred(), release = deferred();
    f[stage] = async () => { entered.resolve(); await release.promise; return stage === 'before'
      ? json({ staff: f.staff, csrf: 'fixture-csrf', mode: 'LOCAL_FIXTURE' }) : json({ state: 'QUEUED' }); };
    const pending = f.search(); await entered.promise; mutate(f); release.resolve();
    await assert.rejects(pending, { code: 'COMP_ACCESS_ENDED' }); assert.equal(f.calls.length, stage === 'before' ? 1 : 2); f.composition.close();
  }
});

test('pagehide and external cancellation release ignored-signal fetches and never adopt late results or replay', async () => {
  for (const hide of [true, false]) {
    const f = fixture(), entered = deferred(), release = deferred(), controller = new AbortController();
    f.target = async () => { entered.resolve(); await release.promise; return json({ state: 'QUEUED' }); };
    const pending = f.composition.request(`${f.path}/market/search`, { method: 'POST', body: f.body, signal: controller.signal });
    await entered.promise; if (hide) f.events.dispatchEvent(new Event('pagehide')); else controller.abort();
    await assert.rejects(pending, { code: hide ? 'COMP_ACCESS_ENDED' : 'REQUEST_CANCELLED' });
    release.resolve(); await new Promise(setImmediate); assert.equal(f.calls.length, 2);
    assert.equal(f.calls.filter(c => c.init.method === 'POST').length, 1); f.composition.close();
  }
});
