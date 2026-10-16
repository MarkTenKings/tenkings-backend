import test from 'node:test';
import assert from 'node:assert/strict';
import { createManualClient } from '../src/client.mjs';

const response = (value, status = 200) => ({ ok: status < 400, status, json: async () => value });
const state = revision => ({ card: { cardId: 'card', revision, contentHash: String(revision).padStart(64, '0'), draft: {} }, geometry: { saved: revision }, defects: { saved: revision }, identity: {} });
const full = revision => ({ ...state(revision), images: { exactCurrent: revision }, provisional: { revision } });
const committed = command => ({ card: state(command.expectedRevision + 1).card, receipt: {
  actionId: command.actionId, actorId: 'staff', actorKind: 'HUMAN', expectedRevision: command.expectedRevision,
  revision: command.expectedRevision + 1, requestHash: 'a'.repeat(64), recordedAt: '2026-10-16T19:00:00.000Z',
} });
function fixture(fetchImpl) {
  const values = new Map(), views = [], notices = [];
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const client = createManualClient({ cardId: 'card', staffId: 'staff', csrf: 'csrf', storage, fetchImpl,
    onView: view => views.push(view), onStatus: status => notices.push(status) });
  return { client, values, views, notices };
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
    return response(committed(command));
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
  const f = fixture(async (url, options) => {
    if (options.method === 'POST') { revision++; return response(committed(JSON.parse(options.body))); }
    return response(url.endsWith('?scope=state') ? state(revision) : full(revision));
  });
  await f.client.load(); await f.client.execute({ type: 'PREPARE_SIDE', side: 'FRONT' }, { refresh: 'state' });
  assert.deepEqual(await f.client.load(), full(2)); assert.deepEqual(f.views, [full(1), full(2)]);
});

test('uncertain save reply reconciles the exact command and performs a full authoritative read', async () => {
  let revision = 1; const posts = [], reads = [], statuses = [];
  const f = fixture(async (url, options) => {
    if (options.method === 'POST') {
      posts.push(JSON.parse(options.body)); revision++;
      throw Error('Synthetic lost reply');
    }
    if (url.includes('/actions/')) { statuses.push(url); revision = 4; return response({ state: 'COMMITTED', result: committed(posts[0]) }); }
    reads.push(url);
    if (url.endsWith('?scope=state')) return response({ error: 'MANUAL_TEMPORARILY_UNAVAILABLE' }, 503);
    return response(full(revision));
  });
  await f.client.load();
  assert.deepEqual(await f.client.execute({ type: 'PREPARE_SIDE', side: 'FRONT' }, { refresh: 'state' }), full(4));
  assert.equal(posts.length, 1); assert.equal(statuses[0].endsWith(posts[0].actionId), true);
  assert.equal(reads.filter(url => url.endsWith('?scope=state')).length, 0);
  assert.deepEqual(f.views, [full(1), full(4)]); assert.equal(f.values.size, 0);
});

for (const failure of [
  { status: 503, error: 'MANUAL_TEMPORARILY_UNAVAILABLE' },
  { status: 409, error: 'MANUAL_PHOTOS_CHANGED' },
]) test(`committed action followed by ${failure.error} during state refresh waits for read-only recovery`, async () => {
  let revision = 1, posts = 0, statuses = 0, fullReads = 0;
  const f = fixture(async (url, options) => {
    if (options.method === 'POST') { posts++; revision++; return response(committed(JSON.parse(options.body))); }
    if (url.includes('/actions/')) { statuses++; throw Error('Known committed work must not require status reconciliation'); }
    if (url.endsWith('?scope=state')) return response({ error: failure.error }, failure.status);
    fullReads++; return response(full(revision));
  });
  await f.client.load();
  await assert.rejects(f.client.execute({ type: 'GEOMETRY_EDIT' }, { refresh: 'state' }), error =>
    error.code === 'MANUAL_SAVED_REFRESH_REQUIRED' && error.committed === true
      && error.status === failure.status && error.cause.code === failure.error);
  assert.equal(f.client.needsRefresh(), true); assert.equal(f.client.hasPending(), false);
  assert.equal(f.values.size, 0); assert.deepEqual(f.client.current(), full(1));
  assert.equal(fullReads, 1); assert.equal(f.notices.at(-1), 'Saved; refreshing…');
  await assert.rejects(f.client.execute({ type: 'PREPARE_SIDE', side: 'FRONT' }), /Refresh/);
  await assert.rejects(f.client.editDefect({ side: 'FRONT', action: { type: 'TRACE_SAVE' } }), /Refresh/);
  await assert.rejects(f.client.reviewProposal({ side: 'FRONT', action: 'TRACE_SAVE' }), /Refresh/);
  assert.equal(posts, 1); assert.equal(statuses, 0);
  assert.deepEqual(await f.client.recover(), full(2));
  assert.equal(f.client.needsRefresh(), false); assert.equal(f.notices.at(-1), 'Saved');
  assert.equal(posts, 1); assert.equal(statuses, 0); assert.equal(fullReads, 2);
  assert.deepEqual(f.views, [full(1), full(2)]);
});

test('invalid refresh never journals or dispatches a mutation', async () => {
  const f = fixture(async () => { throw Error('Must not fetch'); });
  await assert.rejects(f.client.execute({ type: 'GEOMETRY_EDIT' }, { refresh: 'optimistic' }), /Invalid save refresh/);
  assert.equal(f.values.size, 0);
});
