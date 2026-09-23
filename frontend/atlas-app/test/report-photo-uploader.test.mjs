import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url), babel = require('next/dist/compiled/babel/core'), nextRequire = createRequire(require.resolve('next/package.json'));
const code = babel.transformSync(readFileSync(new URL('../components/ReportPhotoUploader.jsx', import.meta.url), 'utf8'), {
  filename: 'ReportPhotoUploader.jsx', presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } } }]], babelrc: false, configFile: false,
}).code;
const all = (value, match, out = []) => { if (Array.isArray(value)) value.forEach(item => all(item, match, out)); else if (value && typeof value === 'object') { if (match(value)) out.push(value); all(value.props?.children, match, out); } return out; };
const text = value => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.props?.children) : value ?? '';
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const slots = [], effects = [], clients = [], changes = []; let cursor = 0, dirty, tree;
  const f = { clients, changes, props: { cardId: 'card-one', staffId: 'staff', csrf: 'csrf', available: true, onChange: value => changes.push(value) } };
  const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => { if (!Object.is(slots[index], value)) { slots[index] = value; dirty = true; } }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect(callback, deps) { const index = cursor++, previous = slots[index]; if (!previous || deps.some((value, i) => value !== previous.deps[i])) { slots[index] = { deps, cleanup: previous?.cleanup }; effects.push(() => { slots[index].cleanup?.(); slots[index].cleanup = callback(); }); } },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, window: { sessionStorage: {} }, require(name) {
    if (name === 'react') return react;
    if (name.endsWith('.css')) return new Proxy({}, { get: (_, key) => key });
    if (name === '../lib/manual-client.mjs') return { manualRequest() {}, manualMessage: error => error.code ?? 'Failed' };
    if (name === '../lib/report-photo-client.mjs') return { createReportPhotoClient(options) {
      const client = { options, current: { approvalActionId: 'approval', revision: 0, presentation: null }, pendingValue: null, uploads: [],
        read() { return f.read ? f.read(client) : Promise.resolve(client.current); }, pending() { return client.pendingValue; },
        async upload(file, current, alt) { client.uploads.push({ file, current, alt }); return f.upload ? f.upload(client) : { ...current, revision: 1, presentation: { slabPhoto: { url: '/photo.webp', alt } } }; },
        async resume() { return client.current; }, async remove() { return { ...client.current, revision: 2 }; } };
      clients.push(client); return client;
    } };
    return nextRequire(name.startsWith('@babel/runtime/') ? `next/dist/compiled/${name}` : name);
  } });
  f.render = () => { let loops = 0; do { dirty = false; cursor = 0; tree = exports.default(f.props); effects.splice(0).forEach(fn => fn()); assert.ok(++loops < 15); } while (dirty); return tree; };
  f.find = predicate => all(tree, predicate); f.text = () => text(tree); f.render(); return f;
}
test('unavailable capability hides optional upload and dispatches no request', async () => {
  const f = fixture(); f.props.available = false; f.render(); await flush(); f.render();
  assert.equal(f.render(), null); assert.equal(f.clients.length, 1); assert.equal(f.clients[0].uploads.length, 0);
});
test('one photo selection saves automatically and late old-card completion cannot overwrite the new card', async () => {
  const f = fixture(); await flush(); f.render(); let finish;
  f.upload = () => new Promise(resolve => { finish = resolve; });
  f.find(node => node.type === 'input')[0].props.onChange({ target: { files: [{ name: 'original.heic' }], value: 'selected' } }); f.render();
  assert.equal(f.clients[0].uploads.length, 1); assert.match(f.text(), /Saving photo/);
  f.props.cardId = 'card-two'; f.render(); await flush(); f.render();
  finish({ revision: 1, approvalActionId: 'old', presentation: { slabPhoto: { url: '/wrong-card.webp', alt: 'Wrong card' } } }); await flush(); f.render();
  assert.equal(f.find(node => node.type === 'img').length, 0); assert.equal(f.changes.length, 0); assert.equal(f.find(node => node.type === 'input')[0].props.disabled, false);
});
test('a saved uncertain request shows exact recovery and disables a second operation while saving', async () => {
  const f = fixture(); await flush(); f.render(); let finish;
  f.upload = client => { client.pendingValue = { kind: 'upload', input: { approvalActionId: 'approval', expectedRevision: 0 } }; return new Promise(resolve => { finish = resolve; }); };
  const input = f.find(node => node.type === 'input')[0]; input.props.onChange({ target: { files: [{}], value: '' } }); f.render();
  assert.equal(f.find(node => node.type === 'input')[0].props.disabled, true); input.props.onChange({ target: { files: [{}], value: '' } }); assert.equal(f.clients[0].uploads.length, 1);
  finish({ revision: 0, approvalActionId: 'approval', presentation: null }); await flush(); f.render(); assert.match(f.text(), /Resume saved upload/);
});
