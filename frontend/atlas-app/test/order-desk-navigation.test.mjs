import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import * as desk from '../lib/order-desk-client.mjs';
import * as operations from '../lib/customer-operations.mjs';
import * as routes from '../lib/routes.mjs';

const require = createRequire(import.meta.url), babel = require('next/dist/compiled/babel/core');
const nextRequire = createRequire(require.resolve('next/package.json'));
const compile = file => babel.transformSync(readFileSync(new URL(file, import.meta.url), 'utf8'), {
  filename: file, presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } } }]],
  babelrc: false, configFile: false,
}).code;
const source = compile('../components/OrderDesk.jsx');
const pageSource = compile('../pages/customer-operations.jsx');
const operationsSource = compile('../components/CustomerOperations.jsx');
const storage = () => {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const elements = (node, predicate, result = []) => {
  if (Array.isArray(node)) node.forEach(value => elements(value, predicate, result));
  else if (node && typeof node === 'object') { if (predicate(node)) result.push(node); elements(node.props?.children, predicate, result); }
  return result;
};
function evaluate(code, react, overrides = {}) {
  const exports = {};
  vm.runInNewContext(code, { exports, AbortController, URL, URLSearchParams, Intl, crypto: { randomUUID }, ...overrides,
    require(name) {
      if (name === 'react') return react;
      if (name === 'next/link') return 'a';
      if (name.endsWith('/order-desk-client.mjs')) return desk;
      if (name.endsWith('/customer-operations.mjs')) return operations;
      if (name.endsWith('/routes.mjs')) return routes;
      if (name === '../lib/client') return overrides.client ?? { api: () => { throw Error('Unexpected API request'); } };
      if (name === '../lib/server/runtime.mjs') return { pageAccess: overrides.pageAccess };
      if (name === './OrderDesk') return { __esModule: true, default: 'OrderDesk' };
      if (name === '../components/CustomerOperations') return { __esModule: true, default: 'CustomerOperations' };
      if (name.endsWith('/Shell')) return { __esModule: true, default: 'Shell', Unavailable: 'Unavailable' };
      if (name.endsWith('.module.css')) return {};
      return nextRequire(name.startsWith('@babel/runtime/') ? `next/dist/compiled/${name}` : name);
    } });
  return exports;
}
function hooks() {
  let cursor = 0, dirty = false;
  const slots = [], effects = [];
  const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const id = cursor++; if (!(id in slots)) slots[id] = typeof initial === 'function' ? initial() : initial;
      return [slots[id], next => { const value = typeof next === 'function' ? next(slots[id]) : next;
        if (!Object.is(value, slots[id])) { slots[id] = value; dirty = true; } }]; },
    useRef(initial) { const id = cursor++; if (!(id in slots)) slots[id] = { current: initial }; return slots[id]; },
    useEffect(fn, deps) { const id = cursor++, old = slots[id];
      if (!old || deps.some((value, index) => value !== old.deps[index])) {
        slots[id] = { deps, cleanup: old?.cleanup };
        effects.push(() => { old?.cleanup?.(); slots[id].cleanup = fn(); });
      }
    },
  };
  return { react, render(fn) { let result, count = 0;
    do { dirty = false; cursor = 0; result = fn(); effects.splice(0).forEach(effect => effect()); assert.ok(++count < 30); } while (dirty);
    return result;
  }, dispose() { slots.forEach(slot => slot?.cleanup?.()); } };
}
async function fixture({ initialOrderId = null, retained = null, queueHold = null, detailHold = null, ackHold = null, sessionHold = null } = {}) {
  const state = hooks(), sessionStorage = storage(), localStorage = storage(), timers = new Set(), listeners = new Map();
  const staff = { id: randomUUID(), role: 'REVIEWER', mode: 'LOCAL_FIXTURE' };
  if (retained) desk.retainedSelection(sessionStorage, staff.id, retained);
  const queueOrder = { id: randomUUID(), reference: 'FIRST-PAGE-ORDER', customer: { name: 'First page customer' } };
  const f = { staff, queueOrder, calls: [], sessionStorage, localStorage, queueHold, detailHold, initialOrderId,
    queue: { orders: [queueOrder], counts: { all: 31, new: 1 }, nextCursor: 'second-page' }, details: {}, actionCalls: [] };
  const request = async (path, options = {}) => {
    f.calls.push({ path, ...options });
    if (ackHold && path === 'session') return sessionHold ? sessionHold.promise : { staff, csrf: 'fixture-csrf' };
    if (ackHold && options.body) {
      assert.equal(path, `${desk.orderDetailPath(initialOrderId)}/acknowledge`);
      return ackHold.promise;
    }
    assert.equal(options.body, undefined, 'navigation must never dispatch an acknowledgment/custody mutation');
    if (path.startsWith(`${desk.ORDER_DESK_BASE}?`)) {
      if (f.queueHold) return f.queueHold.promise;
      if (f.queueError) throw f.queueError;
      return structuredClone(f.queue);
    }
    const id = path.slice(`${desk.ORDER_DESK_BASE}/orders/`.length);
    assert.equal(path, desk.orderDetailPath(id));
    if (f.detailHold) return f.detailHold.promise;
    if (f.detailError) throw f.detailError;
    return { order: structuredClone(f.details[id] ?? { id, reference: `EXACT-${id}`, customer: { name: 'Linked private customer' }, cards: [] }) };
  };
  const exports = evaluate(source, state.react, {
    navigator: { locks: { request: async (_key, _options, work) => work({}) } },
    window: { sessionStorage, localStorage, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) },
    document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
    setTimeout(fn) { timers.add(fn); return fn; }, clearTimeout(fn) { timers.delete(fn); },
    setInterval(fn) { timers.add(fn); return fn; }, clearInterval(fn) { timers.delete(fn); },
  });
  f.render = () => { f.tree = state.render(() => exports.default({ staff, initialOrderId: f.initialOrderId, request,
    onAction: (...args) => { f.actionCalls.push(args); } })); return f.tree.props; };
  f.props = () => f.tree.props;
  f.flush = async () => { for (let i = 0; i < 5; i++) { await new Promise(setImmediate); f.render(); } };
  f.dispose = () => state.dispose();
  f.render(); await f.flush(); return f;
}

test('actual page parses a single valid order hint only after authorized feature access and remounts when the linked order changes', async () => {
  const react = hooks().react, first = randomUUID(), second = randomUUID(), staff = { id: randomUUID(), role: 'REVIEWER' };
  let access = { props: { staff, manualEnabled: true, customerOperationsEnabled: true } }, calls = 0;
  const page = evaluate(pageSource, react, { pageAccess: async () => { calls++; return structuredClone(access); } });
  assert.equal((await page.getServerSideProps({ query: { orderId: first } })).props.initialOrderId, first);
  for (const bad of [undefined, '', [first], [first, second], `../${first}`, `${first}?extra=true`]) {
    assert.equal((await page.getServerSideProps({ query: { orderId: bad } })).props.initialOrderId, null);
  }
  const a = page.default({ ...access.props, initialOrderId: first }), b = page.default({ ...access.props, initialOrderId: second });
  assert.equal(a.props.initialOrderId, first); assert.equal(b.props.initialOrderId, second); assert.notEqual(a.props.key, b.props.key);
  access = { props: { staff, manualEnabled: true, customerOperationsEnabled: false } };
  assert.equal((await page.getServerSideProps({ query: { orderId: first } })).props.initialOrderId, undefined);
  access = { redirect: { destination: '/sign-in', permanent: false } };
  assert.equal((await page.getServerSideProps({ query: { orderId: first } })).props, undefined);
  assert.equal(calls, 9);
});

test('actual customer-operations wrapper forwards the hint into the existing order desk without granting observer operations', () => {
  const state = hooks(), initialOrderId = randomUUID(), staff = { id: randomUUID(), role: 'REVIEWER' }, localStorage = storage();
  const exports = evaluate(operationsSource, state.react, { window: { localStorage, addEventListener() {}, removeEventListener() {} },
    client: { api: () => { throw Error('Navigation must not write'); }, useStaffResource: () => ({ loading: false, data: {}, session: { staff }, reload() {} }) } });
  const wrapper = exports.default({ staff, initialOrderId }); assert.equal(wrapper.props.initialOrderId, initialOrderId);
  const tree = state.render(() => exports.Operations({ staff, initialOrderId }));
  const target = elements(tree, element => element.type === 'OrderDesk')[0];
  assert.equal(target.props.initialOrderId, initialOrderId); assert.equal(target.props.staff, staff);
  const observer = exports.default({ staff: { ...staff, role: 'OBSERVER' }, initialOrderId });
  assert.equal(elements(observer, element => element.type === 'OrderDesk' || element.type === exports.Operations).length, 0);
  assert.equal(localStorage.values.size, 0); state.dispose();
});

test('actual order desk opens linked order outside the first page despite a different retained selection, with reads only', async t => {
  const linked = randomUUID(), retained = randomUUID(), f = await fixture({ initialOrderId: linked, retained }); t.after(f.dispose);
  assert.equal(f.props().selectedId, linked); assert.equal(f.props().mobileDetail, true);
  assert.equal(f.props().details[linked].id, linked);
  assert.equal(f.props().queue.orders.some(order => order.id === linked), false);
  assert.ok(f.calls.some(call => call.path === desk.orderDetailPath(linked)));
  assert.equal(f.calls.some(call => call.path === desk.orderDetailPath(retained)), false);
  assert.equal(f.calls.some(call => call.path.includes('cursor=')), false);
  assert.equal(f.calls.some(call => call.body || call.method === 'POST'), false);
  assert.equal(f.actionCalls.length, 0); assert.equal(f.localStorage.values.size, 0);
});

test('invalid order query is ignored by the actual component and does not become a detail API path', async t => {
  const retained = randomUUID(), f = await fixture({ initialOrderId: `${randomUUID()}/acknowledge`, retained }); t.after(f.dispose);
  assert.equal(f.props().selectedId, retained); assert.equal(f.props().details[retained].id, retained);
  assert.equal(f.calls.some(call => call.path.endsWith('/acknowledge')), false);
  assert.equal(f.actionCalls.length, 0);
});

test('detail access loss clears previously loaded customer details and queue data', async t => {
  const linked = randomUUID(), f = await fixture({ initialOrderId: linked }); t.after(f.dispose);
  assert.equal(f.props().details[linked].customer.name, 'Linked private customer');
  f.detailError = { status: 403 };
  await f.props().onReadDetail(linked); await f.flush();
  assert.equal(f.props().accessLost, true); assert.equal(Object.keys(f.props().details).length, 0);
  assert.equal(f.props().queue.orders.length, 0); assert.equal(f.props().disabled, true);
  assert.equal(f.props().selectedId, null); assert.equal(f.props().mobileDetail, false);
  assert.equal(Object.keys(f.props().detailErrors).length, 0);
  assert.equal(f.props().updating, false); assert.equal(f.props().loading, false); assert.equal(f.props().updatedAt, null);
  assert.match(f.props().error, /Sign in again/);
  const readCount = f.calls.length;
  f.detailError = null; f.props().onRefresh(); await f.props().onReadDetail(linked); f.props().onSelect(linked); await f.flush();
  assert.equal(f.calls.length, readCount, 'access loss requires reauthentication before more reads');
  assert.equal(f.props().selectedId, null);
});

test('queue access loss cannot be undone by an older in-flight linked-order reply', async t => {
  const linked = randomUUID(), detailHold = deferred(), queueHold = deferred();
  const f = await fixture({ initialOrderId: linked, detailHold, queueHold }); t.after(f.dispose);
  queueHold.reject({ status: 401 }); await f.flush();
  assert.equal(f.props().accessLost, true);
  assert.ok(f.calls.every(call => call.signal.aborted), 'access loss aborts both concurrent reads');
  detailHold.resolve({ order: { id: linked, reference: 'STALE-PRIVATE-ORDER', customer: { name: 'Must stay cleared' }, cards: [] } });
  await f.flush();
  assert.equal(Object.keys(f.props().details).length, 0, 'an older successful read must not restore private order data after access loss');
  assert.equal(f.props().queue.orders.length, 0); assert.equal(f.props().accessLost, true);
});

test('linked-order access loss cannot be undone by an older in-flight queue reply', async t => {
  const linked = randomUUID(), detailHold = deferred(), queueHold = deferred();
  const f = await fixture({ initialOrderId: linked, detailHold, queueHold }); t.after(f.dispose);
  detailHold.reject({ status: 403 }); await f.flush();
  assert.equal(f.props().accessLost, true);
  assert.ok(f.calls.every(call => call.signal.aborted), 'access loss aborts both concurrent reads');
  queueHold.resolve(structuredClone(f.queue)); await f.flush();
  assert.equal(f.props().queue.orders.length, 0, 'an older queue must not restore private rows after access loss');
  assert.equal(Object.keys(f.props().details).length, 0); assert.equal(f.props().accessLost, true);
});

for (const outcome of ['unknown', 'accepted']) test(`read access loss preserves the exact ${outcome} outcome of an acknowledgment already dispatched`, async t => {
  const linked = randomUUID(), ackHold = deferred(), f = await fixture({ initialOrderId: linked, ackHold }); t.after(f.dispose);
  const acknowledgment = f.props().onAcknowledge(linked); await f.flush();
  const store = desk.acknowledgmentJournal(f.localStorage, f.staff.id), saved = store.read();
  assert.equal(saved.orderId, linked); assert.equal(saved.accepted, false); assert.equal(f.props().ackBusy, true);
  const writes = f.calls.filter(call => call.body); assert.equal(writes.length, 1);
  assert.equal(writes[0].body.requestId, saved.requestId); assert.equal(writes[0].signal, undefined);
  f.queueError = { status: 401 }; f.props().onRefresh(); await f.flush();
  assert.equal(f.props().accessLost, true); assert.equal(f.props().ackBusy, true);
  assert.deepEqual(store.read(), saved, 'clearing read data must not discard the dispatched request');
  const readCount = f.calls.length;
  if (outcome === 'unknown') ackHold.reject(new Error('The response connection was lost.'));
  else ackHold.resolve({ orderId: linked, requestId: saved.requestId, outcome: 'ACKNOWLEDGED', acknowledgment: { acknowledgedAt: '2026-10-20T12:00:00.000Z', acknowledgedBy: { id: f.staff.id } } });
  await acknowledgment; await f.flush();
  assert.deepEqual(store.read(), { ...saved, accepted: outcome === 'accepted' });
  assert.equal(f.props().pendingAck.requestId, saved.requestId); assert.equal(f.props().pendingAck.accepted, outcome === 'accepted');
  assert.equal(f.props().ackBusy, false); assert.equal(f.props().accessLost, true);
  assert.equal(Object.keys(f.props().details).length, 0); assert.equal(f.props().queue.orders.length, 0);
  await f.props().onCheckAcknowledgment(); await f.props().onAcknowledge(linked, true); await f.flush();
  assert.equal(f.calls.length, readCount, 'failed access cannot launch recovery reads or retry writes before reauthentication');
});

test('read access loss during acknowledgment session preflight prevents a new write', async t => {
  const linked = randomUUID(), ackHold = deferred(), sessionHold = deferred();
  const f = await fixture({ initialOrderId: linked, ackHold, sessionHold }); t.after(f.dispose);
  const acknowledgment = f.props().onAcknowledge(linked); await f.flush();
  f.queueError = { status: 403 }; f.props().onRefresh(); await f.flush();
  sessionHold.resolve({ staff: f.staff, csrf: 'fixture-csrf' }); await acknowledgment; await f.flush();
  assert.equal(f.props().accessLost, true); assert.equal(f.calls.filter(call => call.body).length, 0);
  assert.equal(f.localStorage.values.size, 0); assert.equal(f.props().pendingAck, null);
});
