import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { webcrypto, randomUUID } from 'node:crypto';
import vm from 'node:vm';
import { requireThat } from '@atlas/manual-service/contract';
import * as controller from '../lib/staff-comp-curation-controller.mjs';
import * as entry from '../lib/staff-comp-curation-entry.mjs';
import * as client from '../lib/staff-comp-curation-client.mjs';
import { compUIFixture, realSavedV2, deferred, flush } from './staff-comp-curation-ui-fixture.mjs';
const require = createRequire(new URL('../package.json', import.meta.url)), babel = require('next/dist/compiled/babel/core');
const code = babel.transformSync(readFileSync(new URL('../components/StaffCompCuration.jsx', import.meta.url), 'utf8'), {
  filename: 'StaffCompCuration.jsx', presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } }, 'transform-runtime': { helpers: false } }]], babelrc: false, configFile: false,
}).code;
const nodes = (tree, predicate) => Array.isArray(tree) ? tree.flatMap(child => nodes(child, predicate)) : !tree || typeof tree !== 'object' ? []
  : [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
const words = tree => (Array.isArray(tree) ? tree.map(words).join(' ') : tree == null || tree === false ? '' : typeof tree !== 'object' ? String(tree) : words(tree.props?.children)).replace(/\s+/g, ' ');
const button = (tree, label) => nodes(tree, n => n.type === 'button' && words(n).trim() === label)[0];
const checks = tree => nodes(tree, n => n.type === 'input' && n.props.type === 'checkbox');
function click(tree, label) { const node = button(tree, label); assert.ok(node, label); assert.ok(!node.props.disabled, label); node.props.onClick(); }
function harness() {
  const slots = [], effects = [], window = new EventTarget(); let cursor = 0, unmounted = false, afterUnmount = 0;
  const react = { Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], value => { if (unmounted) afterUnmount++; slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useEffect(fn, deps) { const i = cursor++, old = slots[i]; if (!old || deps.some((value, n) => value !== old.deps[n])) {
      slots[i] = { deps, fn }; effects.push(() => { old?.cleanup?.(); slots[i].cleanup = fn(); });
    } },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, Intl, window, AbortController, crypto: webcrypto, require(name) {
    if (name === 'react') return react;
    if (name.endsWith('.css')) return { __esModule: true, default: new Proxy({}, { get: (_target, key) => key }) };
    if (name.endsWith('/staff-comp-curation-controller.mjs')) return controller;
    if (name.endsWith('/staff-comp-curation-entry.mjs')) return entry;
    if (name.endsWith('/staff-comp-curation-client.mjs')) return client;
    return require(name);
  } });
  return { render(props, runEffects = true) { cursor = 0; const tree = exports.default(props); if (runEffects) this.effects(); return tree; },
    effects() { while (effects.length) effects.shift()(); }, replayEffects() { for (const slot of slots) if (slot?.fn) { slot.cleanup?.(); slot.cleanup = slot.fn(); } },
    pagehide() { window.dispatchEvent(new Event('pagehide')); }, unmount() { unmounted = true; for (const slot of slots) slot?.cleanup?.(); }, get afterUnmount() { return afterUnmount; } };
}
async function setup(options) {
  const f = await compUIFixture(options), h = harness(); let lost = 0;
  const props = { staff: f.staff, card: f.card, enabled: true, request: f.request, onAccessLost: () => lost++ };
  const render = (next = props, effects = true) => h.render(next, effects);
  return { f, h, props, render, lost: () => lost, async ready() { render(); await flush(); return render(); } };
}

test('actual panel is off by default and has no transport fallback, reads, candidates or working save', async () => {
  const f = await setup();
  for (const props of [{ ...f.props, enabled: undefined }, { ...f.props, request: undefined }]) {
    const tree = f.render(props); await flush(); assert.match(words(tree), /not enabled/); assert.equal(checks(tree).length, 0); assert.equal(button(tree, 'Save private selection'), undefined);
  }
  assert.equal(f.f.traffic.length, 0); f.h.unmount();
});

test('actual controller/service selection, Skip and No suitable persist separately from immutable report/pool and human price', async () => {
  const f = await setup(), before = JSON.stringify({ row: f.f.row, market: f.f.market, packet: f.f.packet });
  let tree = await f.ready(); assert.equal(checks(tree).length, 3); assert.match(words(tree), /Price guidance is unavailable/);
  for (let i = 0; i < 3; i++) { checks(tree)[i].props.onChange(); await flush(); tree = f.render(); }
  assert.match(words(tree), /3 of 5 selected/); click(tree, 'Save private selection'); await flush(); tree = f.render();
  assert.match(words(tree), /Private selection saved/); assert.equal(f.f.calls.insert, 1); assert.equal(f.f.rows.length, 1);
  const receipt = JSON.parse(f.f.rows[0].receipt); assert.equal(receipt.selected.length, 3); assert.equal(receipt.guidance.meanMinor, 2000);
  assert.doesNotMatch(words(tree), /\$20\.00/); assert.match(words(tree), /seller sets the asking price/); assert.equal(receipt.guidance.askingPriceMinor, null);
  for (const [label, outcome, text] of [['Skip for now','SKIP','Skipped for now'], ['No suitable comps','NO_SUITABLE_COMPS','No suitable comps recorded']]) {
    click(tree, 'Review saved evidence'); await flush(); f.render(); await flush(); tree = f.render();
    click(tree, label); await flush(); tree = f.render(); assert.match(words(tree), new RegExp(text)); assert.equal(JSON.parse(f.f.rows.at(-1).receipt).outcome, outcome);
  }
  assert.equal(JSON.stringify({ row: f.f.row, market: f.f.market, packet: f.f.packet }), before);
  assert.ok(f.f.traffic.every(r => r.method === 'GET' || r.path.endsWith('/decision'))); f.h.unmount();
});

test('real saved v2 projection keeps unknown designation ineligible, raw separate, and unknown accepted amount absent', async () => {
  const f = await setup(); realSavedV2(f.f);
  let tree = await f.ready(); assert.equal(checks(tree).length, 2); assert.equal(checks(tree)[0].props.disabled, true); assert.equal(checks(tree)[1].props.disabled, false);
  assert.match(words(tree), /Grade designation is not confirmed/); assert.match(words(tree), /RAW \/ condition unverified/);
  checks(tree)[1].props.onChange(); await flush(); tree = f.render(); click(tree, 'Save private selection'); await flush();
  assert.equal(JSON.parse(f.f.rows[0].receipt).selected[0].raw, true); f.h.unmount();
  const unknown = await setup(); unknown.f.preview.candidates[0].sale.priceBasis = 'accepted_offer_unknown'; unknown.f.preview.candidates[0].sale.priceMinor = null; unknown.f.savePreview();
  tree = await unknown.ready(); assert.equal(checks(tree)[0].props.disabled, true); assert.match(words(tree), /Amount unavailable/); assert.match(words(tree), /accepted offer amount was not disclosed/); assert.doesNotMatch(words(tree), /\$0\.00/); unknown.h.unmount();
});

test('mounted selection caps five, refuses mixed groups/currencies and duplicate-sale aliases, and pages saved rows', async () => {
  const f = await setup(); const original = structuredClone(f.f.preview.candidates[0]);
  f.f.preview.candidates = Array.from({ length: 23 }, (_, i) => ({ ...structuredClone(original), sale: { ...original.sale,
    id: `ui:${String(i).padStart(2, '0')}`, listingUrl: `https://www.ebay.com/itm/${123456781000 + i}` } }));
  f.f.preview.candidates[6].sale.grader = 'SGC'; f.f.preview.candidates[7].sale.currency = 'CAD';
  f.f.preview.candidates[8].sale.listingUrl = 'https://www.ebay.co.uk/itm/title/123456781009'; f.f.savePreview();
  let tree = await f.ready(); assert.equal(checks(tree).length, 20);
  checks(tree)[0].props.onChange(); await flush(); tree = f.render(); assert.equal(checks(tree)[6].props.disabled, true); assert.equal(checks(tree)[7].props.disabled, true); assert.equal(checks(tree)[8].props.disabled, true);
  for (let i = 1; i < 5; i++) { checks(tree)[i].props.onChange(); await flush(); tree = f.render(); }
  assert.match(words(tree), /5 of 5 selected/); assert.equal(checks(tree)[5].props.disabled, true);
  checks(tree)[5].props.onChange(); await flush(); tree = f.render(); assert.match(words(tree), /5 of 5 selected/);
  click(tree, 'Next sales'); await flush(); tree = f.render(); assert.equal(checks(tree).length, 3); assert.match(words(tree), /Page 2 of 2/);
  click(tree, 'Save private selection'); await flush(); assert.equal(JSON.parse(f.f.rows[0].receipt).selected.length, 5); f.h.unmount();
});

test('missing pool, missing review policy, non-ready pool and failed read are distinct with no acquisition', async () => {
  for (const mode of ['none', 'policy', 'pending', 'failed']) {
    const f = await setup({ policyDisabled: mode === 'policy' }); if (mode === 'none') f.f.setPool(false);
    if (mode === 'pending') f.f.market.state = 'STARTED'; if (mode === 'failed') f.f.metadataHooks.status = () => { throw new Error('private internal message'); };
    const tree = await f.ready(); assert.equal(checks(tree).length, 0);
    assert.match(words(tree), new RegExp({ none: 'No saved pool', policy: 'policy is unavailable', pending: 'pool is not ready', failed: 'could not be read' }[mode]));
    assert.doesNotMatch(words(tree), /private internal message/);
    if (['none','policy'].includes(mode)) { click(tree, 'No suitable comps'); await flush(); assert.equal(f.f.rows.length, 1); assert.equal(JSON.parse(f.f.rows[0].receipt).guidance, null); }
    else assert.equal(button(tree, 'Skip for now'), undefined);
    assert.ok(f.f.traffic.every(r => !/search|\/presentation\/select/.test(r.path))); f.h.unmount();
  }
});

test('lost mutation response keeps exact pending request; GET confirms only exact receipt and explicit retry replays same ID', async () => {
  for (const newer of [false, true]) {
    const f = await setup(); let tree = await f.ready(); checks(tree)[0].props.onChange(); await flush(); tree = f.render();
    let lose = true; f.f.hooks.response = ({ method }) => { if (method === 'POST' && lose) { lose = false; throw new Error('lost'); } };
    click(tree, 'Save private selection'); await flush(); tree = f.render(); assert.match(words(tree), /Save outcome not confirmed/); assert.equal(checks(tree).length, 0);
    assert.equal(button(tree, 'Skip for now'), undefined); assert.equal(f.f.calls.insert, 1);
    if (newer) await f.f.service.decide(f.f.staff, f.f.card.cardId, f.f.input({ expectedSelectionRevision: 1, selectedIds: [f.f.preview.candidates[0].sale.id], reviewedIds: [f.f.preview.candidates[0].sale.id] }));
    click(tree, 'Check recorded decision'); await flush(); tree = f.render();
    assert.equal(f.f.traffic.filter(r => r.method === 'POST').length, 1);
    if (newer) {
      assert.match(words(tree), /Save outcome not confirmed/); click(tree, 'Retry this same save'); await flush(); tree = f.render();
      const posts = f.f.traffic.filter(r => r.method === 'POST'); assert.deepEqual(posts[0].body, posts[1].body); assert.equal(f.f.calls.insert, 2);
    }
    assert.match(words(tree), /Private selection saved/); assert.match(words(tree), /Revision 1/); f.h.unmount();
  }
});

test('pre-effect account, role, mode, source, approval, report and request changes hide private rows and fence old handlers', async () => {
  const cases = [p => ({ ...p, staff: { ...p.staff } }), p => ({ ...p, staff: { ...p.staff, id: randomUUID() } }),
    p => ({ ...p, staff: { ...p.staff, role: 'OPERATOR' } }), p => ({ ...p, staff: { ...p.staff, mode: 'OTHER' } }),
    p => ({ ...p, card: { ...p.card } }), p => ({ ...p, card: { ...p.card, approvalActionId: randomUUID() } }),
    p => ({ ...p, card: { ...p.card, sourceHash: 'f'.repeat(64) } }), p => ({ ...p, card: { ...p.card, sourceRevision: p.card.sourceRevision + 1 } }),
    p => ({ ...p, card: { ...p.card, report: { ...p.card.report, reportHash: 'e'.repeat(64) } } }),
    p => ({ ...p, card: { ...p.card, report: { ...p.card.report, publicHash: 'd'.repeat(64) } } }),
    p => ({ ...p, request: input => p.request(input) }), p => ({ ...p, enabled: false }), p => ({ ...p, accessState: 'ENDED' })];
  for (const change of cases) {
    const f = await setup(), tree = await f.ready(), stale = button(tree, 'Skip for now').props.onClick;
    const next = change(f.props), hidden = f.render(next, false); assert.equal(checks(hidden).length, 0); assert.doesNotMatch(words(hidden), /2026 Fixture Local only/);
    stale(); await flush(); assert.equal(f.f.calls.insert, 0); f.h.effects(); f.h.unmount();
  }
});

test('in-place identity/source mutation is checked after await and old read/save replies never resurrect after account or access loss', async () => {
  for (const phase of ['entry', 'read', 'save']) {
    const f = await setup(), gate = deferred(), entered = deferred(); let tree;
    if (phase === 'entry') f.f.metadataHooks.status = () => { entered.resolve(); return gate.promise; };
    if (phase === 'read') f.f.hooks.response = ({ method }) => { if (method === 'GET') { entered.resolve(); return gate.promise; } };
    if (phase === 'save') { tree = await f.ready(); f.f.hooks.response = ({ method }) => { if (method === 'POST') { entered.resolve(); return gate.promise; } }; click(tree, 'Skip for now'); }
    else f.render();
    await entered.promise;
    const next = { ...f.props, accessState: 'ENDED' }; const hidden = f.render(next, false); assert.equal(checks(hidden).length, 0);
    f.h.effects(); assert.ok(f.f.traffic.some(r => r.signal.aborted)); gate.resolve(); await flush(); assert.match(words(f.render(next)), /Access ended/);
    assert.equal(checks(f.render(f.props)).length, 0); f.h.unmount();
  }
  const f = await setup(), gate = deferred(); f.f.metadataHooks.status = () => gate.promise; f.render(); await flush();
  f.props.card.sourceHash = 'f'.repeat(64); gate.resolve(); await flush(); assert.equal(checks(f.render()).length, 0); assert.equal(f.f.exchanges.length, 0); f.h.unmount();
});

test('401/403 and pagehide clear private state, notify host once, abort reads and latch until a new account context', async () => {
  for (const code of [401, 403]) {
    const f = await setup(); await f.ready(); f.f.setActor(null);
    // Auth fixture maps null to 401; explicit private 403 exercises the same
    // real browser parser/controller path without changing service behavior.
    if (code === 403) f.f.hooks.auth = () => requireThat(false, 403, 'STAFF_REQUIRED');
    click(f.render(), 'Skip for now'); await flush(); assert.match(words(f.render()), /Access ended/); assert.equal(f.lost(), 1); assert.equal(checks(f.render()).length, 0); f.h.unmount();
  }
  const f = await setup(); await f.ready(); f.h.pagehide(); assert.match(words(f.render()), /Access ended/); assert.equal(checks(f.render()).length, 0); f.h.unmount();
});

test('service stale-approval refusal and mismatched successful source response remove all price/selection display', async () => {
  const f = await setup(); f.f.row.state = 'PENDING'; const tree = await f.ready(); assert.match(words(tree), /could not be read/); assert.equal(checks(tree).length, 0); assert.equal(f.f.calls.insert, 0); f.h.unmount();
  const bad = await setup(); bad.props.card.sourceHash = 'f'.repeat(64); const refused = await bad.ready(); assert.match(words(refused), /could not be verified/); assert.equal(checks(refused).length, 0); assert.equal(bad.f.calls.insert, 0); bad.h.unmount();
});

test('StrictMode effect setup/cleanup/setup creates a fresh live owner without reviving the cancelled first read', async () => {
  const f = await setup(); f.render(); f.h.replayEffects(); await flush();
  const tree = f.render(); assert.equal(checks(tree).length, 3); click(tree, 'Skip for now'); await flush();
  assert.match(words(f.render()), /Skipped for now/); assert.equal(f.f.calls.insert, 1); f.h.unmount();
});

test('observed deferred controller reads and committed saves are fenced across actor/source/request replacement, pagehide and unmount', async () => {
  for (const phase of ['read', 'save']) for (const change of ['actor', 'source', 'request', 'pagehide', 'unmount']) {
    const f = await setup(), entered = deferred(), gate = deferred(); let tree;
    if (phase === 'save') tree = await f.ready();
    f.f.hooks.response = ({ method }) => { if (method === (phase === 'read' ? 'GET' : 'POST')) { entered.resolve(); return gate.promise; } };
    if (phase === 'save') click(tree, 'Skip for now'); else f.render();
    await entered.promise; const original = f.f.traffic.at(-1); let next = f.props;
    if (change === 'actor') next = { ...f.props, staff: { ...f.props.staff } };
    if (change === 'source') next = { ...f.props, card: { ...f.props.card, sourceHash: 'f'.repeat(64) } };
    if (change === 'request') next = { ...f.props, request: input => f.props.request(input) };
    if (change === 'pagehide') f.h.pagehide(); else if (change === 'unmount') f.h.unmount();
    else { assert.equal(checks(f.render(next, false)).length, 0); f.h.effects(); }
    assert.equal(original.signal.aborted, true); gate.resolve(); await flush();
    if (change !== 'unmount') assert.doesNotMatch(words(f.render(next)), /Skipped for now/);
    assert.equal(f.h.afterUnmount, 0); assert.equal(f.f.traffic.filter(r => r.method === 'POST').length, phase === 'save' ? 1 : 0); f.h.unmount();
  }
});
