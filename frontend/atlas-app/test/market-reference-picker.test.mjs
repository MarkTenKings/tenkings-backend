import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url), babel = require('next/dist/compiled/babel/core'), nextRequire = createRequire(require.resolve('next/package.json'));
const code = babel.transformSync(readFileSync(new URL('../components/MarketReferencePicker.jsx', import.meta.url), 'utf8'), {
  filename: 'MarketReferencePicker.jsx', presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } } }]], babelrc: false, configFile: false,
}).code;
const all = (value, match, out = []) => { if (Array.isArray(value)) value.forEach(item => all(item, match, out)); else if (value && typeof value === 'object') { if (match(value)) out.push(value); all(value.props?.children, match, out); } return out; };
const text = value => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.props?.children) : value ?? '';
const flush = () => new Promise(resolve => setImmediate(resolve));
const ready = () => ({ state: 'READY', previewId: 'retained-source-one', preview: { query: 'Fixture card identity', atlasGrade: 9.5, retrievedAt: '2026-09-22T00:00:00Z',
  candidates: [{ sale: { id: 'ebay:123456789012', title: 'Fixture sold card', grader: 'PSA', grade: '9', soldAt: '2026-09-21T00:00:00Z', priceMinor: 4000, currency: 'USD', priceBasis: 'sold' }, match: 'UNKNOWN', requiresReview: true }], excluded: {} } });
function fixture() {
  const slots = [], effects = []; let cursor = 0, dirty, tree;
  const f = { searches: 0, saves: [], props: { scopeKey: 'card:approval-one', available: true } };
  f.props.onPreview = async () => { f.searches++; return f.search ? f.search() : ready(); };
  f.props.onSave = async input => { f.saves.push(input); return f.save?.(input); };
  const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => { if (!Object.is(slots[index], value)) { slots[index] = value; dirty = true; } }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect(callback, deps) { const index = cursor++, previous = slots[index]; if (!previous || deps.some((value, i) => value !== previous.deps[i])) { slots[index] = { deps, cleanup: previous?.cleanup }; effects.push(() => { slots[index].cleanup?.(); slots[index].cleanup = callback(); }); } },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, Intl, Date, structuredClone, require(name) {
    if (name === 'react') return react;
    if (name.endsWith('.css')) return new Proxy({}, { get: (_, key) => key });
    return nextRequire(name.startsWith('@babel/runtime/') ? `next/dist/compiled/${name}` : name);
  } });
  f.render = () => { let loops = 0; do { dirty = false; cursor = 0; tree = exports.default(f.props); effects.splice(0).forEach(fn => fn()); assert.ok(++loops < 15); } while (dirty); return tree; };
  f.find = predicate => all(tree, predicate); f.text = () => text(tree); f.button = label => f.find(node => node.type === 'button' && text(node) === label)[0];
  f.render(); return f;
}
test('optional picker performs no lookup on mount and never preselects even a priced graded sale', async () => {
  const f = fixture(); assert.equal(f.searches, 0); assert.equal(f.saves.length, 0);
  f.button('Find sold cards').props.onClick(); f.render(); await flush(); f.render();
  assert.equal(f.searches, 1); assert.equal(f.find(node => node.type === 'input')[0].props.checked, false);
  assert.match(f.text(), /Variant needs review/); assert.match(f.text(), /ATLAS 9.5/); assert.match(f.text(), /PSA 9/); assert.match(f.text(), /\$40.00/);
  f.props.available = false; assert.equal(f.render(), null); assert.equal(f.searches, 1);
});
test('uncertain save keeps the exact selection locked and retries only its saved ids', async () => {
  const f = fixture(); f.button('Find sold cards').props.onClick(); await flush(); f.render();
  f.find(node => node.type === 'input')[0].props.onChange({ target: { checked: true } }); f.render();
  f.save = async () => { throw new Error('lost reply'); };
  f.button('Publish references').props.onClick(); f.render(); await flush(); f.render();
  assert.equal(f.find(node => node.type === 'input')[0].props.disabled, true); assert.equal(f.button('Refresh sales').props.disabled, true);
  assert.equal(f.saves.length, 1); assert.deepEqual(f.saves[0], { previewId: 'retained-source-one', selectedIds: ['ebay:123456789012'] });
  f.save = async () => ({ state: 'SAVED' }); f.button('Retry saved selection').props.onClick(); await flush(); f.render();
  assert.deepEqual(f.saves[1], f.saves[0]); assert.match(f.text(), /Sales references published/);
});
test('a late search for a different approval cannot appear in the current report', async () => {
  const f = fixture(); let finish; f.search = () => new Promise(resolve => { finish = resolve; });
  f.button('Find sold cards').props.onClick(); f.render(); f.props.scopeKey = 'card:approval-two'; f.render();
  finish(ready()); await flush(); f.render(); assert.equal(f.find(node => node.type === 'table').length, 0);
  assert.equal(f.button('Find sold cards').props.disabled, false);
});


test('quota refusal explains the account action without suggesting unknown-search recovery', async () => {
  const f = fixture(); f.search = async () => ({ state: 'UNAVAILABLE', reason: 'PROVIDER_QUOTA_REACHED' });
  f.button('Find sold cards').props.onClick(); await flush(); f.render();
  assert.match(f.text(), /quota is exhausted/); assert.match(f.text(), /up to 40/); assert.doesNotMatch(f.text(), /saved search is not confirmed/);
  assert.equal(f.searches, 1); assert.equal(f.find(node => node.type === 'table').length, 0);
});
