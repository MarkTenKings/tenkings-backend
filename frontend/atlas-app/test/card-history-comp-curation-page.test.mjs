import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import * as composition from '../lib/card-history-comp-curation.mjs';
import * as searchComposition from '../lib/card-history-comp-search.mjs';
import * as history from '../lib/card-history-client.mjs';

const require = createRequire(import.meta.url), babel = require('next/dist/compiled/babel/core');
const code = babel.transformSync(readFileSync(new URL('../pages/graded-cards/[cardId].jsx', import.meta.url), 'utf8'), {
  filename: 'CardHistoryPage.jsx', presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } } }]], babelrc: false, configFile: false }).code;
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function harness() {
  const slots = [], effects = [], events = new EventTarget(), calls = [];
  let cursor = 0, dirty = false, disposed = false;
  const react = {
    createElement(type, props, ...children) { return { type, props: { ...props, children } }; },
    useRef(initial) { const id = cursor++; return slots[id] ??= { current: initial }; },
    useState(initial) { const id = cursor++; if (!(id in slots)) slots[id] = initial; return [slots[id], value => {
      if (disposed) return;
      const next = typeof value === 'function' ? value(slots[id]) : value;
      if (!Object.is(next, slots[id])) { slots[id] = next; dirty = true; }
    }]; },
    useEffect(setup, deps) { const id = cursor++, old = slots[id];
      if (!old || deps.some((v, i) => !Object.is(v, old.deps[i]))) {
        const slot = { deps, setup, cleanup: old?.cleanup }; slots[id] = slot;
        effects.push(() => { old?.cleanup?.(); slot.cleanup = setup(); });
      }
    },
  };
  const f = { props: { staff: { id: randomUUID(), role: 'REVIEWER', mode: 'LOCAL_FIXTURE' }, cardId: randomUUID(), enabled: true },
    access: null, accessCalls: [], calls, events, hold: null };
  const fetch = async (path, init) => {
    calls.push({ path, init });
    if (path === '/admin/api/staff/session') return json({ staff: f.props.staff, csrf: 'fixture-csrf', mode: 'LOCAL_FIXTURE' });
    if (f.hold) { f.hold.entered.resolve(); await f.hold.release.promise; }
    return json({ state: 'NOT_REQUESTED' });
  };
  const exports = {};
  new Function('exports', 'require', 'window', 'fetch', code)(exports, name => {
    if (name === 'react') return react;
    if (name.endsWith('/components/CardHistory')) return { __esModule: true, default: 'CardHistory' };
    if (name.endsWith('/components/Shell')) return { __esModule: true, default: 'Shell', Unavailable: 'Unavailable' };
    if (name.endsWith('/card-history-client.mjs')) return history;
    if (name.endsWith('/card-history-comp-curation.mjs')) return composition;
    if (name.endsWith('/card-history-comp-search.mjs')) return searchComposition;
    if (name.endsWith('/lib/server/runtime.mjs')) return { pageAccess: async (ctx, options) => { f.accessCalls.push({ ctx, options }); return f.access; } };
    if (name.endsWith('.module.css')) return {};
    if (name.startsWith('@babel/runtime/')) return require(`next/dist/compiled/${name}`);
    throw Error(name);
  }, events, fetch);
  f.page = exports;
  f.renderOnly = () => { cursor = 0; dirty = false; f.tree = exports.CardHistoryCuration(f.props); return f.tree.props; };
  f.flush = () => { let count = 0; do { f.renderOnly(); effects.splice(0).forEach(work => work()); assert(++count < 20); } while (dirty); return f.tree.props; };
  f.replay = () => { for (const slot of slots) if (slot?.setup) { slot.cleanup?.(); slot.cleanup = slot.setup(); } return f.flush(); };
  f.dispose = () => { disposed = true; for (const slot of slots) slot?.cleanup?.(); };
  f.target = () => ({ method: 'GET', path: `/api/staff/manual-connected/cards/${f.props.cardId}/presentation/market` });
  return f;
}

test('actual SSR page trusts only exact admitted boolean, never a URL flag, and preserves denied/invalid access', async () => {
  const f = harness(), ctx = { params: { cardId: f.props.cardId }, query: { compCurationConfiguredForDisplay: 'true', compSearchEnabled: 'true' } };
  for (const flag of [undefined, false, 'true', 1, true]) {
    f.access = { props: { staff: f.props.staff, manualEnabled: true, compSearchEnabled: true, ...(flag === undefined ? {} : { compCurationConfiguredForDisplay: flag }) } };
    const result = await f.page.getServerSideProps(ctx);
    assert.deepEqual(f.accessCalls.at(-1), { ctx, options: { includeCompCuration: true, includeCompSearch: true } });
    assert.equal(result.props.compCurationConfiguredForDisplay, flag === true);
    const page = f.page.default(result.props); assert.equal(page.props.enabled, flag === true);
    assert.equal(result.props.compSearchEnabled, false); assert.equal(page.props.compSearchEnabled, false);
  }
  for (const flag of [undefined, false, 'true', 1, true]) {
    f.access = { props: { staff: f.props.staff, manualEnabled: true, compCurationConfiguredForDisplay: false,
      compSearchConfiguredForDisplay: flag } };
    const result = await f.page.getServerSideProps(ctx);
    assert.equal(result.props.compSearchEnabled, flag === true);
    const page = f.page.default(result.props);
    assert.equal(page.props.compSearchEnabled, flag === true); assert.equal(page.props.enabled, false);
  }
  for (const access of [{ props: { unavailable: true } }, { props: { staff: f.props.staff, manualEnabled: false } }, { redirect: { destination: '/', permanent: false } }]) {
    f.access = access; assert.equal(await f.page.getServerSideProps(ctx), access);
  }
  f.access = { props: { staff: f.props.staff, manualEnabled: true } };
  assert.deepEqual(await f.page.getServerSideProps({ params: { cardId: [f.props.cardId] } }), { notFound: true });
  assert.equal(f.page.default({ ...f.access.props, staff: { ...f.props.staff, role: 'OBSERVER' } }).type, 'Shell');
  assert.equal(f.page.default({ unavailable: true }).type, 'Unavailable');
  assert.equal(f.calls.length, 0); f.dispose();
});

test('actual page wrapper keeps same real request capability on ordinary renders and remains inert until used', async t => {
  const f = harness(); t.after(f.dispose);
  assert.equal(f.renderOnly().compCurationEnabled, false);
  const first = f.flush(); assert.equal(first.compCurationEnabled, true);
  for (let n = 0; n < 4; n++) assert.equal(f.flush().compCurationRequest, first.compCurationRequest);
  assert.equal(f.calls.length, 0);
  const response = await first.compCurationRequest(f.target()); assert.equal((await response.json()).state, 'NOT_REQUESTED');
  assert.equal(f.calls.length, 3); assert(f.calls.every(c => c.init.method === 'GET'));
  const pageA = f.page.default({ ...f.props, manualEnabled: true }), pageB = f.page.default({ ...f.props, cardId: randomUUID(), manualEnabled: true });
  assert.notEqual(pageA.props.key, pageB.props.key);
});

test('flag/card/account/actor changes hide old request before effects and reject retained handlers', async () => {
  for (const change of [f => { f.props.enabled = false; }, f => { f.props.cardId = randomUUID(); },
    f => { f.props.staff = { ...f.props.staff }; }, f => { f.props.staff.id = randomUUID(); }, f => { f.props.staff.mode = 'PRODUCTION'; }]) {
    const f = harness(), first = f.flush(), target = f.target(); change(f);
    assert.equal(f.renderOnly().compCurationEnabled, false); assert.equal(f.tree.props.compCurationRequest, undefined);
    await assert.rejects(first.compCurationRequest(target), { code: 'COMP_ACCESS_ENDED' }); assert.equal(f.calls.length, 0);
    f.flush(); f.dispose();
  }
});

test('StrictMode effect replay creates a fresh live request while old and unmounted handlers remain inert', async () => {
  const f = harness(), first = f.flush().compCurationRequest, next = f.replay().compCurationRequest;
  assert.notEqual(next, first); await assert.rejects(first(f.target()), { code: 'COMP_ACCESS_ENDED' });
  assert.equal((await next(f.target())).status, 200); f.dispose();
  const calls = f.calls.length; await assert.rejects(next(f.target()), { code: 'COMP_ACCESS_ENDED' }); assert.equal(f.calls.length, calls);
});

test('observed held read aborts on pagehide; a flag toggle cannot reopen that lifetime', async () => {
  const f = harness(), request = f.flush().compCurationRequest;
  f.hold = { entered: deferred(), release: deferred() };
  const pending = request(f.target()); await f.hold.entered.promise;
  f.events.dispatchEvent(new Event('pagehide')); f.flush();
  await assert.rejects(pending, { code: 'COMP_ACCESS_ENDED' }); assert.equal(f.tree.props.compCurationEnabled, false);
  f.props.enabled = false; f.flush(); f.props.enabled = true; f.flush(); assert.equal(f.tree.props.compCurationEnabled, false);
  f.hold.release.resolve(); await new Promise(setImmediate); assert.equal(f.calls.length, 2); f.dispose();
});

test('absent and nonboolean page capability never mounts an optional transport', () => {
  for (const enabled of [undefined, false, 'true', 1]) {
    const f = harness(); f.props.enabled = enabled;
    assert.equal(f.flush().compCurationEnabled, false); assert.equal(f.tree.props.compCurationRequest, undefined);
    assert.equal(f.calls.length, 0); f.dispose();
  }
});

test('search requires an independent opt-in and toggling it preserves the curation request capability', async t => {
  const f = harness(); t.after(f.dispose);
  const original = f.flush(); assert.equal(original.compSearchEnabled, false); assert.equal(original.compSearchRequest, undefined);
  for (const flag of ['true', 1, false]) { f.props.compSearchEnabled = flag; assert.equal(f.flush().compSearchEnabled, false); }
  f.props.compSearchEnabled = true;
  const enabled = f.flush(); assert.equal(enabled.compSearchEnabled, true); assert.equal(enabled.compCurationRequest, original.compCurationRequest);
  assert.equal(f.calls.length, 0); assert.equal(f.flush().compSearchRequest, enabled.compSearchRequest);
  assert.deepEqual(await enabled.compSearchRequest(`/api/staff/manual-connected/cards/${f.props.cardId}/presentation`), { state: 'NOT_REQUESTED' });
  assert.equal(f.calls.length, 3); assert(f.calls.every(c => c.init.method === 'GET'));
  f.props.compSearchEnabled = false;
  assert.equal(f.renderOnly().compSearchEnabled, false);
  await assert.rejects(enabled.compSearchRequest(`/api/staff/manual-connected/cards/${f.props.cardId}/presentation`), { code: 'COMP_ACCESS_ENDED' });
  assert.equal(f.flush().compCurationRequest, original.compCurationRequest); assert.equal(f.calls.length, 3);
});

test('search can be locally composed without curation, but account/card changes and pagehide end retained handlers', async () => {
  for (const change of [f => { f.props.cardId = randomUUID(); }, f => { f.props.staff = { ...f.props.staff }; },
    f => { f.props.staff.id = randomUUID(); }, f => f.events.dispatchEvent(new Event('pagehide'))]) {
    const f = harness(); f.props.enabled = false; f.props.compSearchEnabled = true;
    const first = f.flush(), path = `/api/staff/manual-connected/cards/${f.props.cardId}/presentation`;
    assert.equal(first.compCurationEnabled, false); assert.equal(first.compSearchEnabled, true);
    change(f); assert.equal(f.renderOnly().compSearchEnabled, false);
    await assert.rejects(first.compSearchRequest(path), { code: 'COMP_ACCESS_ENDED' }); assert.equal(f.calls.length, 0); f.dispose();
  }
  const f = harness(); f.props.compSearchEnabled = true; f.flush(); f.events.dispatchEvent(new Event('pagehide')); f.flush();
  f.props.compSearchEnabled = false; f.flush(); f.props.compSearchEnabled = true;
  assert.equal(f.flush().compSearchEnabled, false); assert.equal(f.calls.length, 0); f.dispose();
});
