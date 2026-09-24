import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const require = createRequire(new URL('../package.json', import.meta.url));
const nextRequire = createRequire(require.resolve('next/package.json'));
const code = require('next/dist/compiled/babel/core').transformSync(readFileSync(new URL('../components/intake/CustomerIntake.jsx', import.meta.url), 'utf8'), {
  filename: 'CustomerIntake.jsx', presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } } }]], babelrc: false, configFile: false,
}).code;
const all = (node, match) => Array.isArray(node) ? node.flatMap(value => all(value, match)) : node && typeof node === 'object'
  ? [...(match(node) ? [node] : []), ...all(node.props?.children, match)] : [];
const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : node ?? '';
test('resuming a reviewed cart opens payment reconciliation without attempting a frozen review mutation', async () => {
  let cursor = 0, tree; const slots = [], pending = [], calls = [];
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((value, i) => value !== b[i]);
  const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const id = cursor++; if (!(id in slots)) slots[id] = initial; return [slots[id], value => { slots[id] = typeof value === 'function' ? value(slots[id]) : value; }]; },
    useRef(initial) { const id = cursor++; if (!(id in slots)) slots[id] = { current: initial }; return slots[id]; },
    useCallback(value, deps) { const id = cursor++; if (changed(slots[id]?.deps, deps)) slots[id] = { value, deps }; return slots[id].value; },
    useEffect(fn, deps) { const id = cursor++; if (changed(slots[id]?.deps, deps)) { const old = slots[id]; slots[id] = { deps }; pending.push(() => { old?.cleanup?.(); slots[id].cleanup = fn(); }); } },
  };
  const draft = { id: 'saved-draft', revision: 5, state: 'REVIEW', intakeMethod: 'MAIL_IN', kioskId: null, cards: [{ id: 'saved-card' }] };
  function CommerceCheckout() {} function Stub() {}
  const exports = {};
  vm.runInNewContext(code, { exports, setInterval: () => 1, clearInterval() {}, document: { visibilityState: 'visible' }, window: { sessionStorage: {} },
    require(name) {
      if (name.startsWith('next/dist/compiled/@babel/runtime/')) return nextRequire(name);
      if (name.startsWith('@babel/runtime/')) return nextRequire(`next/dist/compiled/${name}`);
      if (name === 'react') return react;
      if (name.endsWith('/client.mjs')) return { request: async (path, options) => { calls.push({ path, options }); assert.equal(path, '/intake/drafts'); return { drafts: [draft] }; } };
      if (name.endsWith('/intake-journal.mjs')) return { createBrowserIntakeJournal: () => ({ close() {} }), createCustomerUploader: () => ({ resume: async () => {}, dispose() {}, whenIdle: async () => {} }) };
      if (name.endsWith('/ProfileFields.jsx')) return { default: Stub, completeProfile: () => true, emptyProfile: {}, __esModule: true };
      if (name.endsWith('/CommerceCheckout.jsx')) return { default: CommerceCheckout, __esModule: true };
      return { default: Stub, __esModule: true };
    } });
  const render = () => { cursor = 0; tree = exports.default({ customer: { id: 'customer', profile: {} }, csrf: 'csrf' }); while (pending.length) pending.shift()(); };
  render(); await new Promise(resolve => setImmediate(resolve)); render();
  const button = all(tree, node => node.type === 'button' && text(node).startsWith('Resume '))[0]; assert.ok(button);
  button.props.onClick(); render();
  const checkout = all(tree, node => node.type === CommerceCheckout)[0]; assert.equal(checkout.props.draft.id, draft.id);
  assert.equal(calls.length, 1); assert.equal(calls[0].options.body, undefined);
});
