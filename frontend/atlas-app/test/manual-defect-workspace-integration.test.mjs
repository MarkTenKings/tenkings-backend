import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import * as analysisClient from '../lib/manual-defect-analysis-client.mjs';

const require = createRequire(import.meta.url), babel = require('next/dist/compiled/babel/core'), nextRequire = createRequire(require.resolve('next/package.json'));
const compiled = babel.transformSync(readFileSync(new URL('../components/ManualCards.jsx', import.meta.url), 'utf8'), {
  filename: 'ManualCards.jsx', presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } } }]], babelrc: false, configFile: false,
}).code;
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const base = Object.fromEntries(['FRONT', 'BACK'].map(side => [side, { cardId: 'card', side, findingRevision: 1 }]));
const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : node ?? '';
const all = (node, predicate, out = []) => { if (Array.isArray(node)) node.forEach(child => all(child, predicate, out));
  else if (node && typeof node === 'object') { if (predicate(node)) out.push(node); all(node.props?.children, predicate, out); } return out; };
function harness({ journal } = {}) {
  const values = new Map(journal ? [['atlas-defect-analysis:v1:staff:card', JSON.stringify(journal)]] : []), slots = [], effects = [], timers = new Map(), cleanups = [];
  let cursor = 0, tree, viewCallback;
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), Fragment: 'fragment',
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useCallback: callback => callback,
    useEffect(callback, deps) { const i = cursor++, prior = slots[i]; if (!prior || deps.some((value, n) => value !== prior[n])) { slots[i] = deps; effects.push(callback); } },
  };
  const f = { calls: [], actions: [], pending: false, current: { card: { revision: 1, contentHash: 'one' }, geometry: { confirmed: true },
    defects: { marker: 'saved-original-defects' }, images: { marker: 'original-grants' }, identity: {}, astra: { enabled: true, status: 'IDLE', proposals: [] }, reviewedMemory: { enabled: true, status: 'UNSAVED' } } };
  f.respond = async (path, options) => path.endsWith('/view') ? f.current : { astra: f.current.astra };
  const client = { recover: async () => { viewCallback(f.current); return f.current; }, hasPending: () => f.pending,
    execute: async action => { f.actions.push(action); return f.current; },
    reviewProposal: async input => { f.actions.push({ type: 'REVIEW_PROPOSAL', input }); return f.current; },
    editDefect: async input => { f.actions.push({ type: 'EDIT_DEFECT', input }); return f.current; }, previewReport: async () => ({}) };
  const exports = {};
  vm.runInNewContext(compiled, { exports, crypto: { randomUUID }, localStorage: storage,
    setInterval: (callback, ms) => { timers.set(ms, callback); return ms; }, clearInterval: id => timers.delete(id),
    window: { addEventListener() {}, removeEventListener() {} }, require(name) {
      if (name === 'react') return react;
      if (name === 'next/router') return { useRouter: () => ({ events: { on() {}, off() {} } }) };
      if (name === 'next/link' || name === './Shell') return { default: name };
      if (name === '@atlas/manual-workflow/client') return { createManualClient: options => { viewCallback = options.onView; return client; } };
      if (name === '@atlas/manual-workspace/defects') return { DefectReviewWorkspace: 'DefectReviewWorkspace' };
      if (name === '@atlas/manual-workspace/geometry-actions') return { geometryStatus: value => value };
      if (name.startsWith('@atlas/')) return {};
      if (name === '../lib/manual-defect-analysis-client.mjs') return analysisClient;
      if (name === '../lib/routes.mjs') return { STAFF_BASE_PATH: '/admin' };
      if (name === '../lib/manual-client.mjs') return { manualMessage: error => error.code ?? 'Retained', manualRequest: async (path, options) => {
        f.calls.push({ path, options: options && structuredClone(options) }); return f.respond(path, options); } };
      return nextRequire(name.startsWith('@babel/runtime/') ? `next/dist/compiled/${name}` : name);
    } });
  f.render = () => { cursor = 0; tree = exports.ManualWorkspace({ staff: { id: 'staff', role: 'REVIEWER' }, cardId: 'card', csrf: 'csrf', onPhotos() {} }); effects.splice(0).forEach(effect => { const cleanup = effect(); if (typeof cleanup === 'function') cleanups.push(cleanup); }); };
  f.tick = async (ms = 5000) => { const tick = timers.get(ms); if (!tick) return; tick(); await flush(); f.render(); };
  f.dispose = () => cleanups.splice(0).forEach(cleanup => cleanup());
  f.defects = () => { const node = all(tree, node => node.type === 'DefectReviewWorkspace')[0]; assert.ok(node, 'defect workspace rendered'); return node.props; };
  f.button = label => all(tree, node => node.type === 'button' && text(node) === label)[0];
  f.publish = next => { f.current = next; viewCallback(next); f.render(); };
  f.render(); return f;
}

test('actual staff parent refreshes analysis assistance without replacing a newer saved finding edit or leaving its editor', async () => {
  const f = harness(); await flush(); f.render(); const old = structuredClone(f.current); let complete;
  f.respond = (path, options) => {
    if (options?.method === 'POST') return new Promise(resolve => { complete = () => resolve({ astra: { enabled: true, status: 'READY', analysisId: options.body.actionId, base, proposals: [] } }); });
    return old;
  };
  const analysis = f.defects().onAnalyzeDefects({ base, actor: 'HUMAN' });
  f.defects().onEditingChange(true); f.publish({ ...f.current, card: { revision: 2, contentHash: 'two' }, defects: { marker: 'new-human-trace' } });
  complete(); await analysis; f.render();
  assert.equal(f.defects().workspace.marker, 'new-human-trace'); assert.equal(f.defects().astra.status, 'READY');
  assert.equal(f.button('Photos').props.disabled, true, 'analysis completion does not clear the active editor');
  assert.equal(f.actions.length, 0, 'analysis never confirms, inspects or measures a finding');
});

test('exact NOT_FOUND remains recoverable after a stale assistance view and only explicit resume POSTs the same request', async () => {
  const f = harness(); await flush(); f.render(); const saved = f.current; let first = true;
  f.respond = async (path, options) => {
    if (path.endsWith('/view')) return saved;
    if (options?.method === 'POST' && first) { first = false; throw Error('Lost result'); }
    if (options?.method === 'POST') return { astra: { enabled: true, status: 'READY', analysisId: options.body.actionId, base, proposals: [] } };
    return { state: 'NOT_FOUND' };
  };
  await assert.rejects(f.defects().onAnalyzeDefects({ base })); f.render(); await f.defects().onRefreshAnalysis(); f.render();
  assert.equal(f.defects().astra.status, 'UNKNOWN'); assert.equal(f.defects().astra.resumeAvailable, true);
  const before = f.calls.filter(call => call.options?.method === 'POST'); assert.equal(before.length, 1);
  await f.defects().onResumeAnalysis(); f.render();
  const posts = f.calls.filter(call => call.options?.method === 'POST'); assert.equal(posts.length, 2);
  assert.deepEqual(posts[0].options.body, posts[1].options.body);
  assert.equal(f.defects().astra.status, 'READY', 'an older same-card view cannot undo acknowledged analysis');
});

test('proposal acceptance and correction use the normal side measurement; rejection sends no measurement', async () => {
  const f = harness(); await flush(); f.render();
  for (const action of ['ACCEPT', 'TRACE_SAVE', 'REJECT']) {
    f.actions.length = 0;
    const input = { side: 'FRONT', base: base.FRONT, analysisId: 'analysis', proposalId: 'proposal', action };
    await f.defects().onReviewProposal(input); await flush();
    assert.equal(f.actions[0].type, 'REVIEW_PROPOSAL'); assert.equal(f.actions[0].input, input);
    assert.equal(f.actions.length, action === 'REJECT' ? 1 : 2);
    if (action !== 'REJECT') assert.deepEqual(JSON.parse(JSON.stringify(f.actions[1])), { type: 'MEASURE_SIDE', side: 'FRONT' });
  }
});

test('publication acknowledgement for older findings cannot mark a new manual revision saved', async () => {
  const f = harness(); await flush(); f.render(); let finish;
  f.respond = (path, options) => options?.method === 'POST' ? new Promise(resolve => { finish = resolve; }) : f.current;
  const saving = f.defects().onRetryReviewedMemory();
  f.publish({ ...f.current, card: { revision: 2, contentHash: 'two' }, reviewedMemory: { enabled: true, status: 'UNSAVED' }, defects: { marker: 'changed-after-confirmation' } });
  finish({ reviewedMemory: { enabled: true, status: 'SAVED' } }); await saving; f.render();
  assert.equal(f.defects().reviewedMemory.status, 'UNSAVED'); assert.equal(f.defects().workspace.marker, 'changed-after-confirmation');
  assert.equal(f.actions.length, 0);
});

test('mount with an unknown saved analysis performs exact GET only and leaves manual review usable', async () => {
  const id = '33333333-3333-4333-8333-333333333333';
  const f = harness({ journal: { version: 1, phase: 'PENDING', canResume: false, body: { actionId: id, base } } });
  f.respond = async () => ({ astra: { enabled: true, analysisId: id, status: 'UNKNOWN', base, proposals: [] } });
  await flush(); f.render();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].path.endsWith(`/${id}`), true);
  assert.equal(f.calls[0].options.method, undefined); assert.equal(f.defects().astra.status, 'UNKNOWN');
  assert.equal(f.button('Photos').props.disabled, false); assert.equal(f.actions.length, 0);
});

test('an image-grant refresh begun before publication acknowledgement cannot revert saved examples to pending', async () => {
  const f = harness(); await flush(); f.render();
  f.publish({ ...f.current, reviewedMemory: { enabled: true, status: 'PENDING' } });
  const earlier = structuredClone(f.current); let finish, reads = 0;
  f.respond = (path, options) => {
    if (options?.method === 'POST') { f.current = { ...f.current, reviewedMemory: { enabled: true, status: 'SAVED' } }; return { reviewedMemory: f.current.reviewedMemory }; }
    if (reads++ === 0) return new Promise(resolve => { finish = resolve; });
    return f.current;
  };
  const loading = f.button('Reload images').props.onClick();
  await f.defects().onRetryReviewedMemory(); f.render(); assert.equal(f.defects().reviewedMemory.status, 'SAVED');
  finish(earlier); await loading; f.render(); assert.equal(f.defects().reviewedMemory.status, 'SAVED');
});


test('accepted background analysis refreshes with GET only and preserves an active human edit', async () => {
  const f = harness(); await flush(); f.render(); let analysisId;
  f.respond = async (path, options) => {
    if (path.endsWith('/view')) return f.current;
    if (options?.method === 'POST') { analysisId = options.body.actionId; return { astra: { enabled: true, status: 'RUNNING', backgroundAccepted: true, analysisId, base, proposals: [] } }; }
    assert.equal(path.endsWith('/' + analysisId), true);
    return { astra: { enabled: true, status: 'READY', analysisId, base, proposals: [] } };
  };
  await f.defects().onAnalyzeDefects({ base }); f.render(); assert.equal(f.defects().astra.status, 'RUNNING');
  f.defects().onEditingChange(true); f.publish({ ...f.current, card: { revision: 2, contentHash: 'edited' }, defects: { marker: 'unsaved-editor-still-open' } });
  const before = f.calls.length; await f.tick();
  assert.equal(f.calls.length, before + 1); assert.equal(f.calls.at(-1).options.method, undefined);
  assert.equal(f.defects().astra.status, 'READY'); assert.equal(f.defects().workspace.marker, 'unsaved-editor-still-open');
  assert.equal(f.button('Photos').props.disabled, true); assert.equal(f.actions.length, 0);
  await f.tick(); assert.equal(f.calls.length, before + 1, 'settled analysis stops polling');
  assert.equal(f.calls.filter(call => call.options?.method === 'POST').length, 1);
  f.dispose();
});

test('status polling pauses after session denial and unmount removes its timer', async () => {
  const id = '44444444-4444-4444-8444-444444444444';
  const f = harness({ journal: { version: 1, phase: 'PENDING', canResume: false, body: { actionId: id, base } } });
  let reads = 0;
  f.respond = async () => {
    if (reads++ === 0) return { astra: { enabled: true, status: 'RUNNING', backgroundAccepted: true, analysisId: id, base, proposals: [] } };
    throw { status: 401, code: 'SIGN_IN_REQUIRED' };
  };
  await flush(); f.render(); await f.tick(); const count = f.calls.length;
  await f.tick(); assert.equal(f.calls.length, count); assert.equal(count, 2);
  assert.equal(f.calls.every(call => call.options.method === undefined), true);
  f.dispose(); await f.tick(); assert.equal(f.calls.length, count);
});

test('exhausted background collection stops automatic browser polling without starting another analysis', async () => {
  const id = '44444444-4444-4444-8444-444444444444';
  const f = harness({ journal: { version: 1, phase: 'PENDING', canResume: false, body: { actionId: id, base } } });
  f.respond = async () => ({ astra: { enabled: true, status: 'UNKNOWN', backgroundAccepted: true,
    collectionStopped: true, analysisId: id, base, proposals: [] } });
  await flush(); f.render(); const count = f.calls.length;
  await f.tick(); await f.tick();
  assert.equal(f.calls.length, count); assert.equal(f.defects().astra.collectionStopped, true);
  assert.equal(f.calls.every(call => call.options.method === undefined), true);
  f.dispose();
});
