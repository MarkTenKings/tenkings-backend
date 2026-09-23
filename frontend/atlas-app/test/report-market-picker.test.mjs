import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url), babel = require('next/dist/compiled/babel/core'), nextRequire = createRequire(require.resolve('next/package.json'));
const code = babel.transformSync(readFileSync(new URL('../components/ReportMarketPicker.jsx', import.meta.url), 'utf8'), {
  filename: 'ReportMarketPicker.jsx', presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } } }]], babelrc: false, configFile: false,
}).code;
const all = (value, match, out = []) => { if (Array.isArray(value)) value.forEach(item => all(item, match, out)); else if (value && typeof value === 'object') { if (match(value)) out.push(value); all(value.props?.children, match, out); } return out; };
const text = value => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.props?.children) : value ?? '';
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture({ available = true, pending = null } = {}) {
  const slots = [], effects = []; let cursor = 0, dirty, tree;
  const f = { clients: [], changes: [], props: { cardId: 'one', staffId: 'staff', approvalActionId: 'approval', csrf: 'csrf', available, onChange: value => f.changes.push(value) } };
  const react = { Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => { if (!Object.is(slots[index], value)) { slots[index] = value; dirty = true; } }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect(callback, deps) { const index = cursor++, previous = slots[index]; if (!previous || deps.some((value, i) => value !== previous.deps[i])) { slots[index] = { deps, cleanup: previous?.cleanup }; effects.push(() => { slots[index].cleanup?.(); slots[index].cleanup = callback(); }); } },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, window: { sessionStorage: {} }, require(name) {
    if (name === 'react') return react;
    if (name.endsWith('.css')) return new Proxy({}, { get: (_, key) => key });
    if (name === './MarketReferencePicker') return { __esModule: true, default: 'picker' };
    if (name === '../lib/manual-client.mjs') return { manualRequest() {}, manualMessage: error => error.message };
    if (name === '../lib/report-market-client.mjs') return { createReportMarketClient(options) {
      const client = { options, reads: 0, previews: 0, saved: pending, resumes: 0,
        async read() { client.reads++; return { revision: 0, approvalActionId: options.approvalActionId }; }, pending() { return client.saved; },
        async preview() { client.previews++; }, async select(input) { return f.select?.(input); },
        async resumeSelection() { client.resumes++; client.saved = null; return { revision: 1 }; } };
      f.clients.push(client); return client;
    } };
    return nextRequire(name.startsWith('@babel/runtime/') ? `next/dist/compiled/${name}` : name);
  } });
  f.render = () => { let loops = 0; do { dirty = false; cursor = 0; tree = exports.default(f.props); effects.splice(0).forEach(fn => fn()); assert.ok(++loops < 15); } while (dirty); return tree; };
  f.find = predicate => all(tree, predicate); f.text = () => text(tree); f.render(); return f;
}
test('unavailable capability makes no client and enabled mount only reads status', async () => {
  const off = fixture({ available: false }); await flush(); assert.equal(off.render(), null); assert.equal(off.clients.length, 0);
  const f = fixture(); await flush(); f.render(); assert.equal(f.clients[0].reads, 1); assert.equal(f.clients[0].previews, 0); assert.equal(f.find(node => node.type === 'picker').length, 1);
});
test('restored selection requires exact recovery before another market search', async () => {
  const f = fixture({ pending: { search: { approvalActionId: 'approval' }, selection: { selectedIds: ['one'] } } }); await flush(); f.render();
  assert.equal(f.find(node => node.type === 'picker').length, 0); assert.match(f.text(), /Resume saved selection/);
  f.find(node => node.type === 'button')[0].props.onClick(); await flush(); f.render();
  assert.equal(f.clients[0].resumes, 1); assert.equal(f.clients[0].previews, 0); assert.equal(f.find(node => node.type === 'picker').length, 1);
});
test('late selection completion cannot publish callback into another card', async () => {
  const f = fixture(); await flush(); f.render(); let finish; f.select = () => new Promise(resolve => { finish = resolve; });
  const promise = f.find(node => node.type === 'picker')[0].props.onSave({ previewId: 'saved', selectedIds: ['one'] });
  f.props.cardId = 'two'; f.render(); await flush(); f.render(); finish({ revision: 1 }); await promise;
  assert.equal(f.changes.length, 0);
});
