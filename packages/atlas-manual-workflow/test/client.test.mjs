import assert from 'node:assert/strict';
import test from 'node:test';
import { createManualClient } from '../src/client.mjs';

const storage = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key), values }; };
const response = (value, status = 200) => ({ ok: status < 400, status, json: async () => value });
const current = revision => ({ card: { revision }, defects: { saved: revision } });
function client(store, fetchImpl, onView = () => {}) {
  return createManualClient({ cardId: 'card', staffId: 'staff', csrf: 'csrf', storage: store, fetchImpl, onView });
}
test('lost reply reconciles the same action and reloads latest view rather than its old receipt', async () => {
  const store = storage(), posted = [], views = []; let revision = 3;
  const c = client(store, async (url, options) => {
    if (url.endsWith('/view')) return response(current(revision));
    if (options.method === 'POST') { posted.push(JSON.parse(options.body)); revision = 6; throw new Error('lost response after commit'); }
    return response({ state: 'COMMITTED', result: { card: { revision: 4 } } });
  }, value => views.push(value));
  await c.load(); await c.execute({ type: 'INSPECT_SIDE' });
  assert.equal(posted.length, 1); assert.equal(posted[0].expectedRevision, 3);
  assert.equal(c.current().card.revision, 6); assert.equal(views.at(-1).card.revision, 6); assert.equal(store.values.size, 0);
});
test('unknown save blocks new edits and survives client recreation with exact same ID and payload', async () => {
  const store = storage(), posted = [];
  const c = client(store, async (url, options) => {
    if (url.endsWith('/view')) return response(current(1));
    if (options.method === 'POST') posted.push(JSON.parse(options.body));
    throw new Error('offline');
  });
  await c.load(); await assert.rejects(c.execute({ type: 'MEASURE_SIDE', side: 'FRONT' }));
  assert.equal(store.values.size, 1); await assert.rejects(c.execute({ type: 'INSPECT_SIDE' }), /pending/);
  let revision = 1;
  const resumed = client(store, async (url, options) => {
    if (url.endsWith('/view')) return response(current(revision));
    if (!options.method) return response({ state: 'NOT_FOUND' });
    posted.push(JSON.parse(options.body)); revision = 2; return response({ card: { revision } });
  });
  await resumed.recover(); assert.equal(posted.length, 2); assert.deepEqual(posted[1], posted[0]);
  assert.equal(store.values.size, 0); assert.equal(resumed.current().card.revision, 2);
});
test('confirmed rejection clears only the rejected command and retains refreshed server state', async () => {
  const store = storage(); let calls = 0;
  const c = client(store, async (url, options) => {
    if (url.endsWith('/view')) return response(current(++calls));
    return response({ error: 'ATLAS_DEFECT_STALE' }, 409);
  });
  await c.load(); await assert.rejects(c.execute({ type: 'INSPECT_SIDE' }), error => error.code === 'ATLAS_DEFECT_STALE');
  assert.equal(store.values.size, 0); assert.equal(c.current().card.revision, 2);
});
test('unresolved replay loads saved pending candidate before surfacing a retry failure', async () => {
  const store = storage(); store.setItem('atlas-manual-pending:v1:staff:card', JSON.stringify({ actionId: 'same-id', expectedRevision: 2, action: { type: 'MEASURE_SIDE' } }));
  const c = client(store, async url => url.endsWith('/view') ? response(current(2)) : response({ error: 'unavailable' }, 503));
  await assert.rejects(c.recover()); assert.equal(c.current().card.revision, 2); assert.equal(c.hasPending(), true);
});
