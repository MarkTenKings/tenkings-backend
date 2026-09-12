import test from 'node:test';
import assert from 'node:assert/strict';
import { createManualClient } from '../src/client.mjs';

const key = 'atlas-manual-pending:v1:staff:card';
const initial = { actionId: 'old-action', expectedRevision: 1, action: { type: 'MEASURE_SIDE', side: 'FRONT' } };
const current = revision => ({ card: { revision }, defects: { saved: revision } });
const response = (value, status = 200) => ({ ok: status < 400, status, json: async () => value });
function memory() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key) };
}
function gate() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
const client = (storage, fetchImpl) => createManualClient({ cardId: 'card', staffId: 'staff', csrf: 'csrf', storage, fetchImpl });

test('delayed old recovery finish cannot remove a new action from another recovery client; uncertain new action replays exact bytes', async () => {
  const storage = memory(); storage.setItem(key, JSON.stringify(initial));
  const oldFinishing = gate(), releaseOld = gate(), newPosted = gate(), releaseNew = gate();
  let oldViews = 0;
  const old = client(storage, async url => {
    if (url.endsWith('/view')) {
      if (++oldViews === 2) { oldFinishing.resolve(); await releaseOld.promise; }
      return response(current(2));
    }
    return response({ state: 'COMMITTED' });
  });
  const recovering = old.recover(); await oldFinishing.promise;
  const sent = [];
  const fresh = client(storage, async (url, options) => {
    if (url.endsWith('/view')) return response(current(2));
    if (url.endsWith(`/actions/${initial.actionId}`)) return response({ state: 'COMMITTED' });
    if (options.method === 'POST') { sent.push(options.body); newPosted.resolve(); await releaseNew.promise; }
    throw Error('Synthetic uncertain new reply');
  });
  await fresh.recover(); assert.equal(storage.getItem(key), null);
  const saving = fresh.execute({ type: 'INSPECT_SIDE', side: 'BACK', inspected: true });
  const failedSave = assert.rejects(saving, /uncertain/);
  await newPosted.promise;
  const newPending = storage.getItem(key); assert.notEqual(JSON.parse(newPending).actionId, initial.actionId);
  releaseOld.resolve(); await recovering;
  assert.equal(storage.getItem(key), newPending); assert.equal(fresh.hasPending(), true);
  releaseNew.resolve(); await failedSave; assert.equal(storage.getItem(key), newPending);
  const resumed = client(storage, async (url, options) => {
    if (url.endsWith('/view')) return response(current(3));
    if (options.method !== 'POST') return response({ state: 'NOT_FOUND' });
    sent.push(options.body); return response({ card: { revision: 3 } });
  });
  await resumed.recover();
  assert.equal(sent.length, 2); assert.equal(sent[1], sent[0]); assert.equal(sent[1], newPending);
  assert.equal(storage.getItem(key), null);
});

test('definite send refusal clears only its exact journal; same-ID changed revision or payload remains', async () => {
  for (const change of [command => ({ ...command, expectedRevision: command.expectedRevision + 1 }),
    command => ({ ...command, action: { ...command.action, side: 'BACK' } })]) {
    const storage = memory(); let replacement;
    const c = client(storage, async (url, options) => {
      if (url.endsWith('/view')) return response(current(2));
      replacement = JSON.stringify(change(JSON.parse(options.body))); storage.setItem(key, replacement);
      return response({ error: 'MANUAL_REVISION_CONFLICT' }, 409);
    });
    await c.load(); await assert.rejects(c.execute({ type: 'MEASURE_SIDE', side: 'FRONT' }), { status: 409 });
    assert.equal(storage.getItem(key), replacement);
  }
});

test('definite recovery refusal preserves a newer journal but removes the exact refused command', async () => {
  for (const replace of [true, false]) {
    const storage = memory(); storage.setItem(key, JSON.stringify(initial)); let replacement;
    const c = client(storage, async url => {
      if (url.endsWith('/view')) return response(current(2));
      if (replace) { replacement = JSON.stringify({ ...initial, actionId: 'new-action' }); storage.setItem(key, replacement); }
      return response({ error: 'MANUAL_REVISION_CONFLICT' }, 409);
    });
    await assert.rejects(c.recover(), { status: 409 });
    assert.equal(storage.getItem(key), replace ? replacement : null);
  }
});

test('uncertain retries retain the originally journaled payload after the caller mutates its action object', async () => {
  const storage = memory(), action = { type: 'MEASURE_SIDE', side: 'FRONT' }, sent = [];
  const c = client(storage, async (url, options) => {
    if (url.endsWith('/view')) return response(current(2));
    if (options.method === 'POST') {
      sent.push(options.body);
      if (sent.length === 1) { action.side = 'BACK'; throw Error('Synthetic lost reply'); }
      return response({ card: { revision: 2 } });
    }
    return response({ state: 'NOT_FOUND' });
  });
  await c.load(); await c.execute(action);
  assert.equal(sent.length, 2); assert.equal(sent[1], sent[0]); assert.equal(JSON.parse(sent[1]).action.side, 'FRONT');
  assert.equal(storage.getItem(key), null);
});

for (const waitAt of ['initial view', 'trace']) test(`a command journaled during the awaited ${waitAt} remains recoverable without another dispatch`, async () => {
  const storage = memory(), started = gate(), release = gate(); let actionPosts = 0;
  const c = client(storage, async (url, options) => {
    if (url.endsWith('/view')) {
      if (waitAt === 'initial view') { started.resolve(); await release.promise; }
      return response(current(1));
    }
    if (url.endsWith('/trace')) {
      started.resolve(); await release.promise;
      return response({ type: 'DEFECT_EDIT', side: 'FRONT', base: {}, edit: { type: 'TRACE_SAVE' } });
    }
    if (options.method === 'POST') actionPosts++;
    throw Error('Synthetic unknown reply');
  });
  if (waitAt === 'trace') await c.load();
  const saving = waitAt === 'trace'
    ? c.editDefect({ side: 'FRONT', base: {}, action: { type: 'TRACE_SAVE', findingId: 'finding', trace: [] } })
    : c.execute({ type: 'INSPECT_SIDE', side: 'FRONT' });
  const rejected = assert.rejects(saving, /pending/);
  await started.promise;
  const newer = JSON.stringify({ ...initial, actionId: 'other-uncertain-command' });
  storage.setItem(key, newer); release.resolve(); await rejected;
  assert.equal(actionPosts, 0);
  assert.equal(storage.getItem(key), newer);
});
