import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url), babel = require('next/dist/compiled/babel/core'), nextRequire = createRequire(require.resolve('next/package.json'));
const code = babel.transformSync(readFileSync(new URL('../components/DealerOfferPicker.jsx', import.meta.url), 'utf8'), {
  filename: 'DealerOfferPicker.jsx', presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } } }]], babelrc: false, configFile: false,
}).code;
const all = (value, match, out = []) => { if (Array.isArray(value)) value.forEach(item => all(item, match, out)); else if (value && typeof value === 'object') { if (match(value)) out.push(value); all(value.props?.children, match, out); } return out; };
const text = value => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.props?.children) : value ?? '';
const flush = () => new Promise(resolve => setImmediate(resolve));
const offer = { id: 'one', dealerName: 'Fixture shop', amountMinor: 4000, currency: 'USD', kind: 'indicative', terms: 'Fixture inspection conditions', expiresAt: '2026-09-25T00:00:00.000Z', source: { reference: 'Fixture written terms', receivedAt: '2026-09-24T00:00:00.000Z' } };
function fixture() {
  const slots = [], effects = []; let cursor = 0, dirty, tree;
  const f = { clients: [], changes: [], source: { revision: 0, sourceHash: 'a'.repeat(64), offers: [offer], selectedIds: [] },
    props: { cardId: 'card', staffId: 'staff', approvalActionId: 'approval', csrf: 'csrf', available: true, onChange: result => f.changes.push(result) } };
  const react = { Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => { if (!Object.is(slots[index], value)) { slots[index] = value; dirty = true; } }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect(callback, deps) { const index = cursor++, previous = slots[index]; if (!previous || deps.some((value, i) => value !== previous.deps[i])) { slots[index] = { deps, cleanup: previous?.cleanup }; effects.push(() => { slots[index].cleanup?.(); slots[index].cleanup = callback(); }); } },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, Intl, Date, window: { sessionStorage: {} }, require(name) {
    if (name === 'react') return react;
    if (name.endsWith('.css')) return new Proxy({}, { get: (_, key) => key });
    if (name === '../lib/manual-client.mjs') return { manualRequest() {} };
    if (name === '../lib/dealer-offers-client.mjs') return { createDealerOffersClient(options) {
      const client = { reads: 0, selections: [], resumes: 0, saved: null,
        async read() { client.reads++; return f.read ? f.read(options) : { ...f.source, approvalActionId: options.approvalActionId }; },
        pending() { return client.saved; }, async select(input) { client.selections.push(input); client.saved = { ...input, approvalActionId: options.approvalActionId };
          if (f.select) return f.select(input); client.saved = null; return { presentation: { dealerOffers: f.source.offers.filter(value => input.selectedIds.includes(value.id)) } }; },
        async resume() { client.resumes++; client.saved = null; return { presentation: { dealerOffers: [offer] } }; } };
      f.clients.push(client); return client;
    } };
    return nextRequire(name.startsWith('@babel/runtime/') ? `next/dist/compiled/${name}` : name);
  } });
  f.render = () => { let loops = 0; do { dirty = false; cursor = 0; tree = exports.default(f.props); effects.splice(0).forEach(fn => fn()); assert.ok(++loops < 15); } while (dirty); return tree; };
  f.find = predicate => all(tree, predicate); f.text = () => text(tree); f.button = label => f.find(node => node.type === 'button' && text(node) === label)[0];
  f.render(); return f;
}
test('dealer picker only reads on mount and shows sourced terms, amount, kind and expiry without preselecting', async () => {
  const f = fixture(); await flush(); f.render(); assert.equal(f.clients[0].reads, 1); assert.deepEqual(f.clients[0].selections, []);
  assert.match(f.text(), /Indicative offer/); assert.match(f.text(), /\$40.00/); assert.match(f.text(), /Fixture written terms/); assert.match(f.text(), /2026-09-25/);
  assert.equal(f.find(node => node.type === 'input')[0].props.checked, false); assert.equal(f.button('Publish selected offers').props.disabled, true);
});
test('absent sourced terms provide actual required inputs and a contact link without a fictional offer', async () => {
  const f = fixture(); f.source.offers = []; await flush(); f.render();
  assert.match(f.text(), /No active offer is configured/); assert.match(f.text(), /buying authorization/); assert.match(f.text(), /source reference/);
  assert.equal(f.find(node => node.type === 'input').length, 0); assert.equal(f.button('Publish selected offers'), undefined);
  assert.equal(f.find(node => node.type === 'a')[0].props.href, '/dealers?service=buy');
});
test('uncertain offer publication locks the original choice and exposes only exact saved recovery', async () => {
  const f = fixture(); await flush(); f.render(); f.find(node => node.type === 'input')[0].props.onChange({ target: { checked: true } }); f.render();
  f.select = async () => { throw new Error('lost reply'); }; f.button('Publish selected offers').props.onClick(); await flush(); f.render();
  assert.ok(f.button('Check saved offer selection')); assert.equal(f.find(node => node.type === 'input').length, 0); assert.equal(f.clients[0].selections.length, 1);
  f.button('Check saved offer selection').props.onClick(); await flush(); f.render(); assert.equal(f.clients[0].resumes, 1); assert.match(f.text(), /Dealer offers published/);
});
test('late dealer status for a previous staff account is discarded', async () => {
  const f = fixture(); let resolve; f.read = () => new Promise(done => { resolve = done; }); await flush();
  f.props.staffId = 'different'; f.source.offers = []; f.read = null; f.render(); await flush(); f.render();
  resolve({ ...f.source, offers: [offer] }); await flush(); f.render(); assert.equal(f.find(node => node.type === 'input').length, 0);
});
