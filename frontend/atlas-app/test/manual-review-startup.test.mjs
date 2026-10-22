import test from 'node:test';
import assert from 'node:assert/strict';
import { createManualClient } from '@atlas/manual-workflow/client';
import { recoverManualReview } from '../lib/manual-review-startup.mjs';

const batchReview = { key: 'b'.repeat(64), cardId: 'card', state: 'REVIEW' };
const reportHash = 'a'.repeat(64), pendingKey = 'atlas-manual-pending:v1:/admin:staff:card';
const saved = (revision, finalReview = false) => ({ card: { cardId: 'card', revision, contentHash: `source-${revision}` },
  geometry: { marker: 'current-saved-geometry' }, ...(finalReview ? { finalReview: { reportHash } } : {}) });
const committed = (command, view) => ({ card:view.card, receipt:{actionId:command.actionId,actorId:'staff',actorKind:'HUMAN',expectedRevision:command.expectedRevision,revision:command.expectedRevision+1} });
const response = (value, status = 200) => ({ ok: status < 400, status, json: async () => value });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture({ view = saved(1, true), handler, pending } = {}) {
  const values = new Map(pending ? [[pendingKey, JSON.stringify(pending)]] : []), calls = [], views = [];
  const f = { current: true, view, values, calls, views };
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const client = createManualClient({ cardId: 'card', staffId: 'staff', csrf: 'csrf', basePath: '/admin', storage,
    onView: value => { if (f.current) views.push(value); }, fetchImpl: async (url, options) => {
      calls.push({ url, method: options.method ?? 'GET', body: options.body && JSON.parse(options.body) });
      if (handler) { const result = await handler(url, options, f); if (result) return result; }
      if (url.endsWith('/view')) return response(f.view);
      throw Error(`Unexpected request ${url}`);
    } });
  f.request = async path => { calls.push({ url: path, method: 'GET' }); return { state: 'READY', reportHash }; };
  f.start = (batch = batchReview) => recoverManualReview({ client, cardId: 'card', batchReview: batch,
    request: path => f.request(path), isCurrent: () => f.current });
  return f;
}

test('an already-adopted next card uses one authoritative workspace GET and no new command', async () => {
  const f = fixture();
  assert.deepEqual(await f.start(), f.view);
  assert.deepEqual(f.calls.map(call => [call.method, call.url]), [['GET', '/admin/api/staff/manual/cards/card/view']]);
  assert.deepEqual(f.views, [f.view]);
});

test('the one workspace owner adopts only the freshly read exact batch report, without approving it', async () => {
  const f = fixture({ view: saved(1), handler: async (url, options, state) => {
    if (options.method === 'POST') { state.view = saved(2, true); return response(committed(JSON.parse(options.body),state.view)); }
  } });
  const result = await f.start();
  assert.equal(result.card.revision, 2);
  const posts = f.calls.filter(call => call.method === 'POST');
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].body.action, { type: 'BEGIN_FINAL_REVIEW', batchKey: batchReview.key, reportHash });
  assert.equal(posts[0].body.expectedRevision, 1);
  assert.equal(f.calls.filter(call => call.url.endsWith('/view')).length, 2, 'one recovery read plus the existing post-adoption authoritative read');
  assert.equal(f.values.size, 0);
});

test('a retained adoption is reconciled under its original ID before any new batch operation', async () => {
  const command = { actionId: 'retained-action', expectedRevision: 1,
    action: { type: 'BEGIN_FINAL_REVIEW', batchKey: batchReview.key, reportHash } };
  const f = fixture({ view:saved(2,true),pending: command, handler: async (url,_options,state) => url.endsWith('/actions/retained-action') ? response({ state: 'COMMITTED',result:committed(command,state.view) }) : null });
  await f.start();
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 0);
  assert.equal(f.calls.filter(call => call.url.includes('/batch/')).length, 0);
  assert.equal(f.values.size, 0);
});

test('unknown pending saves remain retained and prevent a fresh adoption', async () => {
  const command = { actionId: 'retained-action', expectedRevision: 1, action: { type: 'INSPECT_SIDE', side: 'FRONT' } };
  const f = fixture({ view: saved(1), pending: command, handler: async url => {
    if (url.includes('/actions/')) throw Error('offline saved-status read');
  } });
  await assert.rejects(f.start(), /offline/);
  assert.deepEqual(JSON.parse(f.values.get(pendingKey)), command);
  assert.equal(f.calls.filter(call => call.method === 'POST' || call.url.includes('/batch/')).length, 0);
});
test('a new pending command arriving during recovery blocks adoption without erasing its journal',async()=>{
  const command={actionId:'newer-action',expectedRevision:1,action:{type:'INSPECT_SIDE',side:'FRONT'}};
  const f=fixture({view:saved(1),handler:async(url,_options,state)=>{
    if(url.endsWith('/view'))state.values.set(pendingKey,JSON.stringify(command));
  }});
  await assert.rejects(f.start(),{code:'MANUAL_COMMAND_PENDING'});
  assert.deepEqual(JSON.parse(f.values.get(pendingKey)),command);
  assert.equal(f.calls.length,1);assert.equal(f.calls.some(call=>call.method==='POST'),false);
});
test('a committed adoption with a failed refresh is recovered by read without issuing a second adoption',async()=>{
  let failRead=false;
  const f=fixture({view:saved(1),handler:async(url,options,state)=>{
    if(options.method==='POST'){
      state.view=saved(2,true);failRead=true;
      return response(committed(JSON.parse(options.body),state.view));
    }
    if(url.endsWith('/view')&&failRead){failRead=false;throw Error('refresh offline');}
  }});
  await assert.rejects(f.start(),{code:'MANUAL_SAVED_REFRESH_REQUIRED',committed:true});
  assert.equal(f.values.size,0);assert.equal(f.calls.filter(call=>call.method==='POST').length,1);
  assert.equal((await f.start()).card.revision,2);
  assert.equal(f.calls.filter(call=>call.method==='POST').length,1);
});

for (const [status, code] of [[401, 'SIGN_IN_REQUIRED'], [403, 'MANUAL_EDIT_FORBIDDEN'], [404, 'MANUAL_CARD_NOT_FOUND'], [409, 'MANUAL_PHOTOS_CHANGED']]) {
  test(`startup preserves ${code} and never adopts after a refused authoritative read`, async () => {
    const f = fixture({ handler: async () => response({ error: code }, status) });
    await assert.rejects(f.start(), { status, code });
    assert.equal(f.calls.length, 1); assert.equal(f.views.length, 0);
  });
}

test('a denied fresh batch read is surfaced without changing the recovered card', async () => {
  const f = fixture({ view: saved(1) });
  f.request = async () => { throw { status: 401, code: 'SIGN_IN_REQUIRED' }; };
  await assert.rejects(f.start(), { status: 401, code: 'SIGN_IN_REQUIRED' });
  assert.equal(f.calls.some(call => call.method === 'POST'), false);
});

test('changing card or authorization during workspace recovery cannot publish or adopt the old result', async () => {
  const wait = deferred(), f = fixture({ view: saved(1), handler: async url => url.endsWith('/view') ? wait.promise : null });
  const opening = f.start(); await tick(); f.current = false; wait.resolve(response(f.view));
  assert.equal(await opening, null); assert.equal(f.calls.length, 1); assert.equal(f.views.length, 0);
});

test('changing card or authorization during batch lookup prevents a late adoption dispatch', async () => {
  const wait = deferred(), f = fixture({ view: saved(1) }); f.request = () => wait.promise;
  const opening = f.start(); await tick(); f.current = false; wait.resolve({ state: 'READY', reportHash });
  assert.equal(await opening, null); assert.equal(f.calls.some(call => call.method === 'POST'), false);
});

test('a stale batch adoption resumes authoritative current work without another adoption', async () => {
  const f = fixture({ view: saved(1), handler: async (url, options, state) => {
    if (options.method === 'POST') { state.view = saved(3, true); return response({ error: 'BATCH_REVIEW_STALE' }, 409); }
  } });
  assert.equal((await f.start()).card.revision, 3);
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 1); assert.equal(f.values.size, 0);
});

test('a photo replacement refuses the prior report rather than opening it against new photos', async () => {
  const f = fixture({ view: saved(1), handler: async (url, options, state) => {
    if (options.method === 'POST') { state.view = saved(2); return response({ error: 'MANUAL_PHOTOS_CHANGED' }, 409); }
  } });
  await assert.rejects(f.start(), { status: 409, code: 'MANUAL_PHOTOS_CHANGED' });
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
  assert.equal(f.views.at(-1).card.contentHash, 'source-2');
  assert.equal(f.views.at(-1).finalReview, undefined);
});

test('a mismatched card binding is refused before reads and the direct-card caller needs no batch state', async () => {
  const f = fixture();
  await assert.rejects(f.start({ ...batchReview, cardId: 'old-card' }), { code: 'BATCH_REVIEW_STALE' });
  assert.equal(f.calls.length, 0);
  assert.deepEqual(await f.start(null), f.view); assert.equal(f.calls.length, 1);
});

test('a partial machine report is not fabricated into an adoption', async () => {
  const f = fixture({ view: saved(1) }); f.request = async () => ({ state: 'PENDING' });
  assert.deepEqual(await f.start(), f.view);
  assert.equal(f.calls.some(call => call.method === 'POST'), false);
});

function directView() {
  const view = saved(1); view.card.draft = { source: { sourceHash: 'c'.repeat(64) } };
  view.batchReview = { ...batchReview, sourceHash: view.card.draft.source.sourceHash,
    manualRevision: view.card.revision, manualContentHash: view.card.contentHash };
  return view;
}
test('direct entry discovers only the recovered source-bound report and uses the same durable adoption', async () => {
  const f = fixture({ view: directView(), handler: async (_url, options, state) => {
    if (options.method === 'POST') { state.view = saved(2, true); return response(committed(JSON.parse(options.body), state.view)); }
  } });
  await f.start(null);
  assert.deepEqual(f.calls.filter(call => call.method === 'POST').map(call => call.body.action),
    [{ type: 'BEGIN_FINAL_REVIEW', batchKey: batchReview.key, reportHash }]);
  assert.equal(f.calls.some(call => call.url.endsWith('/cards/batch')), false);
  assert.equal(f.values.size, 0);
});
test('discovered context must match the exact recovered card, source and manual base', async () => {
  for (const [key, value] of [['cardId', 'other'], ['key', '../other'], ['state', 'RUNNING'], ['sourceHash', 'd'.repeat(64)],
    ['manualRevision', 2], ['manualContentHash', 'changed']]) {
    const view = directView(); view.batchReview[key] = value; const f = fixture({ view });
    await assert.rejects(f.start(null), { code: 'BATCH_REVIEW_STALE' }); assert.equal(f.calls.length, 1);
  }
});
test('current approval, prior adoption and missing context retain ordinary direct recovery without a report read', async () => {
  for (const change of [view => { view.approval = { sourceHash: view.card.contentHash }; },
    view => { view.finalReview = { reportHash }; }, view => { view.batchReview = null; }]) {
    const view = directView(); change(view); const f = fixture({ view });
    assert.deepEqual(await f.start(null), view); assert.equal(f.calls.length, 1);
  }
});
test('direct entry preserves an unknown pending command and never discovers or adopts another report', async () => {
  const command = { actionId: 'retained-action', expectedRevision: 1, action: { type: 'CONFIRM_GEOMETRY' } };
  const f = fixture({ view: directView(), pending: command, handler: async url => {
    if (url.includes('/actions/')) throw Error('status unavailable');
  } });
  await assert.rejects(f.start(null), /status unavailable/);
  assert.deepEqual(JSON.parse(f.values.get(pendingKey)), command);
  assert.equal(f.calls.some(call => call.method === 'POST' || call.url.includes('/batch/')), false);
});
