import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefectAnalysisClient } from '../lib/manual-defect-analysis-client.mjs';

const id1 = '11111111-1111-4111-8111-111111111111', id2 = '22222222-2222-4222-8222-222222222222';
const base = Object.fromEntries(['FRONT', 'BACK'].map(side => [side, { side, cardId: 'card', frame: { frameId: side }, findingRevision: 1 }]));
const key = 'atlas-defect-analysis:v1:staff:card';
const storage = () => { const entries = new Map(); return { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) }; };
const result = (id = id1, status = 'READY') => ({ astra: { enabled: true, analysisId: id, status, base, proposals: [] } });
function fixture({ store = storage(), request = async () => result(), uuid = () => id1 } = {}) {
  const calls = [], values = [];
  const client = createDefectAnalysisClient({ cardId: 'card', staffId: 'staff', storage: store, uuid, onAnalysis: value => values.push(value),
    request: async (path, options) => { calls.push({ path, options: options && structuredClone(options) }); return request(path, options); } });
  return { client, store, calls, values };
}

test('the exact compact input is journaled before dispatch; provider request never receives actor authority or mutable caller input', async () => {
  const store = storage(), input = { base: structuredClone(base), actor: 'HUMAN' };
  const f = fixture({ store, request: async (_path, { body }) => {
    const saved = JSON.parse(store.getItem(key)); assert.equal(saved.phase, 'PENDING'); assert.deepEqual(saved.body, body);
    input.base.FRONT.findingRevision = 99; assert.equal(body.base.FRONT.findingRevision, 1); return result();
  } });
  await f.client.start(input); assert.deepEqual(Object.keys(f.calls[0].options.body).sort(), ['actionId', 'base']);
  assert.equal(f.client.hasPending(), false); assert.equal(JSON.parse(store.getItem(key)).phase, 'SETTLED');
  assert.equal(f.values.at(-1).status, 'READY'); assert.equal(f.calls.length, 1);
});

test('a lost POST reply survives a new browser coordinator and reconciles only the original analysis id', async () => {
  const f = fixture({ request: async () => { throw Error('lost POST response'); } });
  await assert.rejects(f.client.start({ base })); assert.equal(f.client.hasPending(), true);
  assert.equal(f.values.at(-1).status, 'UNKNOWN');
  const reloaded = fixture({ store: f.store }); await reloaded.client.refresh();
  assert.equal(reloaded.calls.length, 1); assert.equal(reloaded.calls[0].options, undefined);
  assert.equal(reloaded.calls[0].path, `/api/staff/manual-connected/cards/card/defect-analysis/${id1}`);
  assert.equal(reloaded.client.hasPending(), false); assert.equal(reloaded.values.at(-1).status, 'READY');
});

test('UNKNOWN and RUNNING cannot create a new paid id; an uncertain GET cannot turn them into failure or success', async () => {
  const f = fixture({ request: async () => result(id1, 'UNKNOWN') }); await f.client.start({ base });
  await assert.rejects(f.client.start({ base }), { code: 'MANUAL_ANALYSIS_PENDING' });
  await assert.rejects(f.client.resume(), { code: 'MANUAL_ANALYSIS_RECONCILE_REQUIRED' });
  const reload = fixture({ store: f.store, request: async () => { throw { status: 503 }; } });
  await assert.rejects(reload.client.refresh()); assert.equal(reload.client.hasPending(), true);
  assert.equal(reload.values.at(-1).status, 'UNKNOWN'); assert.equal(reload.calls[0].options, undefined);
  assert.equal(f.calls.length, 1);
});

for (const state of ['NOT_FOUND', 'PREPARED']) test(`${state} permits an explicit retry of the same id and payload after exact GET, never an automatic POST`, async () => {
  const f = fixture({ request: async () => { throw Error('lost reply'); } }); await assert.rejects(f.client.start({ base }));
  let lookups = 0;
  const recovered = fixture({ store: f.store, request: async (_path, options) => {
    if (options?.method === 'POST') return result(); lookups++;
    return state === 'NOT_FOUND' ? { state } : { state, ...result(id1, 'RUNNING') };
  } });
  await recovered.client.refresh(); assert.equal(lookups, 1); assert.equal(recovered.calls.length, 1);
  assert.equal(recovered.values.at(-1).resumeAvailable, true);
  await recovered.client.resume(); assert.equal(recovered.calls.length, 2);
  assert.deepEqual(recovered.calls[1].options.body, f.calls[0].options.body); assert.equal(recovered.client.hasPending(), false);
});

test('delayed A cannot erase or redisplay itself after a second client has finished A and then finished B', async () => {
  const store = storage(); let release;
  const slow = fixture({ store, request: () => new Promise(resolve => { release = resolve; }) });
  const first = slow.client.start({ base });
  const fast = fixture({ store }); await fast.client.refresh();
  const later = fixture({ store, uuid: () => id2, request: async () => result(id2) }); await later.client.start({ base });
  const latest = store.getItem(key); release(result(id1)); await first;
  assert.equal(store.getItem(key), latest); assert.equal(JSON.parse(latest).body.actionId, id2);
  assert.equal(slow.values.some(value => value.status === 'READY'), false, 'the stale terminal result cannot replace the later UI');
});

test('late failure A cannot turn settled B back into UNKNOWN', async () => {
  const store = storage(); let reject;
  const slow = fixture({ store, request: () => new Promise((_yes, no) => { reject = no; }) }); const first = slow.client.start({ base });
  const fast = fixture({ store }); await fast.client.refresh();
  const later = fixture({ store, uuid: () => id2, request: async () => result(id2) }); await later.client.start({ base });
  const latest = store.getItem(key); reject(Error('late failure')); await assert.rejects(first);
  assert.equal(store.getItem(key), latest); assert.equal(slow.values.some(value => value.status === 'UNKNOWN'), false);
});

test('a latest-status GET begun before a new recorded analysis cannot overwrite it', async () => {
  const store = storage(); let release;
  const reader = fixture({ store, request: () => new Promise(resolve => { release = resolve; }) }); const read = reader.client.refresh();
  const writer = fixture({ store, request: async () => result(id1, 'RUNNING') }); await writer.client.start({ base });
  release(result(id2)); await read; assert.equal(reader.values.length, 0); assert.equal(writer.client.hasPending(), true);
});

test('response identity mismatch and generic HTTP refusals remain uncertain until exact status is available', async () => {
  for (const reply of [async () => result(id2), async () => { throw { status: 409 }; }, async () => ({ astra: { status: 'READY' } })]) {
    const f = fixture({ request: reply }); await assert.rejects(f.client.start({ base }));
    assert.equal(f.client.hasPending(), true); assert.equal(f.values.at(-1).status, 'UNKNOWN');
    assert.equal(JSON.parse(f.store.getItem(key)).body.actionId, id1);
  }
});

test('definite saved refusal settles the original request and permits a later deliberate new request', async () => {
  let ids = 0;
  const f = fixture({ uuid: () => ids++ ? id2 : id1, request: async (_path, { body }) => result(body.actionId, 'REFUSED') });
  await f.client.start({ base }); assert.equal(f.client.hasPending(), false); assert.equal(f.values.at(-1).status, 'REFUSED');
  await f.client.start({ base }); assert.equal(f.calls.length, 2); assert.equal(f.calls[1].options.body.actionId, id2);
});

test('same-coordinator concurrent starts dispatch once, and disposal preserves the journal without updating an unmounted card', async () => {
  let finish;
  const f = fixture({ request: () => new Promise(resolve => { finish = resolve; }) }); const first = f.client.start({ base });
  await assert.rejects(f.client.start({ base }), { code: 'MANUAL_ANALYSIS_BUSY' });
  f.client.dispose(); finish(result()); await first; assert.equal(f.calls.length, 1); assert.equal(f.values.length, 1);
  assert.equal(f.client.hasPending(), false);
});

test('corrupt or foreign-card journals never issue a request or select a caller-supplied endpoint', async () => {
  for (const saved of ['{', JSON.stringify({ version: 1, phase: 'PENDING', canResume: true, body: { actionId: id1, base: { ...base, FRONT: { ...base.FRONT, cardId: 'foreign' } }, path: 'https://example.invalid' } })]) {
    const f = fixture(); f.store.setItem(key, saved);
    await assert.rejects(f.client.refresh(), { code: 'MANUAL_ANALYSIS_JOURNAL_INVALID' });
    assert.equal(f.calls.length, 0); assert.equal(f.store.getItem(key), saved);
  }
});


const replacement = { analysisId: id1, outcomeHash: 'a'.repeat(64) };
const replaceable = () => ({ ...result(id1, 'UNKNOWN'), astra: { ...result(id1, 'UNKNOWN').astra, replacement } });

test('a verified unknown outcome offers only an explicit linked new action; lost reply recovers that same new action', async () => {
  const store = storage();
  const f = fixture({ store, uuid: () => id2, request: async (_path, options) => {
    if (!options) return replaceable();
    assert.deepEqual(options.body.replacement, replacement); assert.equal(options.body.actionId, id2);
    assert.deepEqual(JSON.parse(store.getItem(key)).body, options.body);
    throw Error('lost replacement reply');
  } });
  await f.client.refresh(); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].options, undefined);
  await assert.rejects(f.client.replace({ base }));
  assert.equal(f.client.hasPending(), true); assert.equal(JSON.parse(store.getItem(key)).body.actionId, id2);
  const reload = fixture({ store, request: async (path, options) => {
    assert.equal(path.endsWith('/' + id2), true); assert.equal(options, undefined); return result(id2);
  } });
  await reload.client.refresh(); assert.equal(reload.client.hasPending(), false);
  assert.equal(reload.calls.length, 1); assert.deepEqual(JSON.parse(store.getItem(key)).body.replacement, replacement);
});

test('unknown without proof and accepted background requests cannot create a replacement', async () => {
  for (const astra of [result(id1, 'UNKNOWN').astra, { ...replaceable().astra, backgroundAccepted: true },
    { ...replaceable().astra, status: 'RUNNING' }, { ...replaceable().astra, replacement: { ...replacement, outcomeHash: 'invalid' } }]) {
    const f = fixture({ uuid: () => id2, request: async () => ({ astra }) });
    await f.client.refresh(); await assert.rejects(f.client.replace({ base }), { code: 'MANUAL_ANALYSIS_RECONCILE_REQUIRED' });
    assert.equal(f.calls.length, 1); assert.equal(f.store.getItem(key), null);
  }
});

test('a stale replacement control cannot overwrite another tab’s newer pending action', async () => {
  const store = storage(), f = fixture({ store, uuid: () => id2, request: async () => replaceable() });
  await f.client.refresh();
  const later = { version: 1, phase: 'PENDING', canResume: false, body: { actionId: id2, base, replacement } };
  store.setItem(key, JSON.stringify(later));
  await assert.rejects(f.client.replace({ base }), { code: 'MANUAL_ANALYSIS_RECONCILE_REQUIRED' });
  assert.deepEqual(JSON.parse(store.getItem(key)), later); assert.equal(f.calls.length, 1);
});

test('an accepted analysis remains GET-reconcilable after a transient status failure', async () => {
  let count = 0;
  const f = fixture({ request: async () => {
    if (count++ === 0) return { astra: { ...result(id1, 'RUNNING').astra, backgroundAccepted: true } };
    if (count === 2) throw { status: 503 };
    return result();
  } });
  await f.client.start({ base }); await assert.rejects(f.client.refresh());
  assert.equal(f.client.current().backgroundAccepted, true); assert.equal(f.client.current().status, 'UNKNOWN');
  await f.client.refresh(); assert.equal(f.client.current().status, 'READY'); assert.equal(f.client.hasPending(), false);
  assert.deepEqual(f.calls.map(call => call.options?.method ?? 'GET'), ['POST', 'GET', 'GET']);
});

const gateRefusal = () => ({ state: 'REFUSED', followLatest: true,
  astra: { ...result(id2, 'REFUSED').astra, resumeAvailable: false } });

test('a durably gate-refused action follows the accepted analysis through GET only and retires only its settled journal', async () => {
  let count = 0;
  const f = fixture({ uuid: () => id2, request: async (path, options) => {
    if (options?.method === 'POST') return gateRefusal();
    assert.equal(path, '/api/staff/manual-connected/cards/card/defect-analysis');
    return count++ === 0 ? { astra: { ...result(id1, 'RUNNING').astra, backgroundAccepted: true } } : result(id1);
  } });
  await f.client.start({ base });
  assert.equal(f.store.getItem(key), null); assert.equal(f.client.current().analysisId, id1);
  assert.equal(f.client.current().backgroundAccepted, true); assert.equal(f.client.current().resumeAvailable, false);
  await assert.rejects(f.client.start({ base }), { code: 'MANUAL_ANALYSIS_PENDING' });
  await assert.rejects(f.client.resume(), { code: 'MANUAL_ANALYSIS_RECONCILE_REQUIRED' });
  await f.client.refresh(); assert.equal(f.client.current().status, 'READY');
  assert.deepEqual(f.calls.map(call => call.options?.method ?? 'GET'), ['POST', 'GET', 'GET']);
});

test('failed gate handoff survives reload as SETTLED and restores explicit no-ID replacement by latest GET', async () => {
  const store = storage(), first = fixture({ store, uuid: () => id2, request: async (_path, options) => {
    if (options?.method === 'POST') return gateRefusal(); throw { status: 503 };
  } });
  await assert.rejects(first.client.start({ base }));
  const saved = store.getItem(key), record = JSON.parse(saved);
  assert.equal(record.phase, 'SETTLED'); assert.equal(record.followLatest, true);
  assert.equal(first.client.current().status, 'REFUSED'); assert.equal(first.client.current().followLatest, true);
  await assert.rejects(first.client.start({ base }), { code: 'MANUAL_ANALYSIS_PENDING' });
  const denied = fixture({ store, request: async () => { throw { status: 401 }; } });
  await assert.rejects(denied.client.refresh()); assert.equal(store.getItem(key), saved);
  assert.equal(denied.client.current().followLatest, true);
  assert.equal(denied.calls[0].path, '/api/staff/manual-connected/cards/card/defect-analysis');
  const recovered = fixture({ store, uuid: () => id2, request: async (_path, options) => {
    if (!options) return replaceable(); assert.deepEqual(options.body.replacement, replacement); return result(id2, 'RUNNING');
  } });
  await recovered.client.refresh(); assert.equal(store.getItem(key), null);
  assert.deepEqual(recovered.client.current().replacement, replacement); assert.equal(recovered.calls.length, 1);
  await recovered.client.replace({ base }); assert.equal(recovered.calls.length, 2);
  assert.equal(recovered.calls[1].options.method, 'POST');
});

test('a delayed refusal handoff never erases or projects over another tab’s newer journal', async () => {
  const store = storage(); let release;
  const f = fixture({ store, uuid: () => id2, request: async (_path, options) => options?.method === 'POST'
    ? gateRefusal() : new Promise(resolve => { release = resolve; }) });
  const work = f.client.start({ base });
  for (let i = 0; i < 10 && !release; i++) await Promise.resolve();
  assert.equal(typeof release, 'function');
  const newer = JSON.stringify({ version: 1, phase: 'PENDING', canResume: false, body: { actionId: id1, base } });
  store.setItem(key, newer); release(result(id1)); await work;
  assert.equal(store.getItem(key), newer);
  assert.equal(f.values.some(value => value.analysisId === id1), false);
  assert.equal(f.calls.filter(call => call.options?.method === 'POST').length, 1);
});

test('latest-only tracking never fabricates the saved body needed to resume another PREPARED analysis', async () => {
  const f = fixture({ uuid: () => id2, request: async (_path, options) => options?.method === 'POST' ? gateRefusal()
    : { state: 'PREPARED', astra: { ...result(id1, 'UNKNOWN').astra, resumeAvailable: true } } });
  await f.client.start({ base }); assert.equal(f.client.current().resumeAvailable, false);
  await f.client.refresh(); assert.equal(f.client.current().resumeAvailable, false);
  await assert.rejects(f.client.resume(), { code: 'MANUAL_ANALYSIS_RECONCILE_REQUIRED' });
  assert.equal(f.calls.filter(call => call.options?.method === 'POST').length, 1);
});

test('a follow-latest marker on an unconfirmed action cannot retire the pending journal', async () => {
  const f = fixture({ request: async () => ({ ...result(id1, 'RUNNING'), state: 'DISPATCHED', followLatest: true }) });
  await assert.rejects(f.client.start({ base }), { code: 'MANUAL_ANALYSIS_RESPONSE_INVALID' });
  assert.equal(f.client.hasPending(), true); assert.equal(JSON.parse(f.store.getItem(key)).body.actionId, id1);
  assert.equal(f.calls.length, 1);
});
