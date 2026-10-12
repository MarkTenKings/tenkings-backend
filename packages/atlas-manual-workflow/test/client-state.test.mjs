import test from 'node:test';
import assert from 'node:assert/strict';
import { createManualClient } from '../src/client.mjs';

const response = (value, status = 200) => ({ ok: status < 400, status, json: async () => value });
const state = revision => ({ card: { revision }, geometry: { saved: revision }, defects: { saved: revision }, identity: {} });
const full = revision => ({ ...state(revision), images: { exactCurrent: revision }, provisional: { revision } });
function fixture(fetchImpl) {
  const values = new Map(), views = [];
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const client = createManualClient({ cardId: 'card', staffId: 'staff', csrf: 'csrf', storage, fetchImpl, onView: view => views.push(view) });
  return { client, values, views };
}

test('geometry chain waits for each durable save and current base while loading photographs only at its boundary', async () => {
  const calls = [], commands = []; let revision = 1;
  const f = fixture(async (url, options) => {
    calls.push(url);
    if (url.endsWith('/view')) return response(full(revision));
    if (url.endsWith('/view?scope=state')) return response(state(revision));
    assert.equal(options.method, 'POST');
    const command = JSON.parse(options.body); commands.push(command);
    assert.equal(command.expectedRevision, revision); revision++;
    return response({ card: { revision } });
  });
  await f.client.load();
  assert.deepEqual(await f.client.execute({ type: 'GEOMETRY_EDIT' }, { refresh: 'state' }), state(2));
  assert.deepEqual(f.client.current(), state(2));
  assert.deepEqual(f.views, [full(1)], 'partial reads never publish stale photograph or report metadata');
  await f.client.execute({ type: 'PREPARE_SIDE', side: 'FRONT' }, { refresh: 'state' });
  await f.client.execute({ type: 'GEOMETRY_EDIT' });
  assert.deepEqual(commands.map(command => command.expectedRevision), [1, 2, 3]);
  assert.equal(new Set(commands.map(command => command.actionId)).size, 3);
  assert.equal(calls.filter(url => url.endsWith('/view')).length, 2);
  assert.equal(calls.filter(url => url.endsWith('?scope=state')).length, 2);
  assert.deepEqual(f.views, [full(1), full(4)]); assert.deepEqual(f.client.current(), full(4));
  assert.equal(f.values.size, 0);
});

test('skipped final geometry edit can complete the sequence with an explicit current photograph reload', async () => {
  let revision = 1;
  const f = fixture(async (url, options) => options.method === 'POST' ? response({ card: { revision: ++revision } })
    : response(url.endsWith('?scope=state') ? state(revision) : full(revision)));
  await f.client.load(); await f.client.execute({ type: 'PREPARE_SIDE', side: 'FRONT' }, { refresh: 'state' });
  assert.deepEqual(await f.client.load(), full(2)); assert.deepEqual(f.views, [full(1), full(2)]);
});

for (const failAt of ['save reply', 'state read']) test(`uncertain ${failAt} reconciles the exact command and performs a full authoritative read`, async () => {
  let revision = 1; const posts = [], reads = [], statuses = [];
  const f = fixture(async (url, options) => {
    if (options.method === 'POST') {
      posts.push(JSON.parse(options.body)); revision++;
      if (failAt === 'save reply') throw Error('Synthetic lost reply');
      return response({ card: { revision } });
    }
    if (url.includes('/actions/')) { statuses.push(url); revision = 4; return response({ state: 'COMMITTED', result: { card: { revision: 2 } } }); }
    reads.push(url);
    if (url.endsWith('?scope=state')) return response({ error: 'MANUAL_TEMPORARILY_UNAVAILABLE' }, 503);
    return response(full(revision));
  });
  await f.client.load();
  assert.deepEqual(await f.client.execute({ type: 'PREPARE_SIDE', side: 'FRONT' }, { refresh: 'state' }), full(4));
  assert.equal(posts.length, 1); assert.equal(statuses[0].endsWith(posts[0].actionId), true);
  assert.equal(reads.filter(url => url.endsWith('?scope=state')).length, failAt === 'state read' ? 1 : 0);
  assert.deepEqual(f.views, [full(1), full(4)]); assert.equal(f.values.size, 0);
});

test('state source conflict refreshes full current data, surfaces refusal and does not replay the saved action', async () => {
  let revision = 1, posts = 0;
  const f = fixture(async (url, options) => {
    if (options.method === 'POST') { posts++; return response({ card: { revision: ++revision } }); }
    return url.endsWith('?scope=state') ? response({ error: 'MANUAL_PHOTOS_CHANGED' }, 409) : response(full(revision));
  });
  await f.client.load();
  await assert.rejects(f.client.execute({ type: 'GEOMETRY_EDIT' }, { refresh: 'state' }), { status: 409, code: 'MANUAL_PHOTOS_CHANGED' });
  assert.equal(posts, 1); assert.equal(f.values.size, 0); assert.deepEqual(f.client.current(), full(2));
});

test('invalid refresh never journals or dispatches a mutation', async () => {
  const f = fixture(async () => { throw Error('Must not fetch'); });
  await assert.rejects(f.client.execute({ type: 'GEOMETRY_EDIT' }, { refresh: 'optimistic' }), /Invalid save refresh/);
  assert.equal(f.values.size, 0);
});
