import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import * as label from '../../../packages/atlas-finishing/src/label.mjs';
import { samplePlan } from '../../../packages/atlas-finishing/test/manual-fixture.mjs';
const require = createRequire(new URL('../package.json', import.meta.url));
const babel = require('next/dist/compiled/babel/core'), nextRequire = createRequire(require.resolve('next/package.json'));
const code = babel.transformSync(readFileSync(new URL('../components/ManualFinishing.jsx', import.meta.url), 'utf8'), {
  filename: 'ManualFinishing.jsx', presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } } }]], babelrc: false, configFile: false,
}).code;
const all = (value, match, out = []) => { if (Array.isArray(value)) value.forEach(v => all(v, match, out)); else if (value && typeof value === 'object') { if (match(value)) out.push(value); all(value.props?.children, match, out); } return out; };
const text = value => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.props?.children) : value ?? '';
function fixture(props = { plan: samplePlan() }) {
  const slots = [], effects = [], prints = [], dialogs = []; let cursor, dirty, tree;
  const makeNode = () => ({ nodes: [], append(value) { this.nodes.push(value); }, replaceChildren() { this.nodes = []; } });
  const windowObject = () => ({ closed: false, close() { this.closed = true; }, focus() {}, document: { head: makeNode(), body: makeNode(), createElement: makeNode, importNode: value => value },
    print() { prints.push(this.document.body.nodes.map(node => node.nodes[0].source).join('')); } });
  const f = { props, prints, dialogs, popupAllowed: true, windowObject };
  const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const id = cursor++; if (!(id in slots)) slots[id] = initial; return [slots[id], value => { if (!Object.is(slots[id], value)) { slots[id] = value; dirty = true; } }]; },
    useRef(initial) { const id = cursor++; if (!(id in slots)) slots[id] = { current: initial }; return slots[id]; },
    useEffect(callback, deps) { const id = cursor++; if (!slots[id] || deps.some((value, i) => value !== slots[id][i])) { slots[id] = deps; effects.push(callback); } },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, window: { open: () => f.popupAllowed ? windowObject() : null },
    document: { createElement: () => ({ getContext: () => ({ font: '', measureText(value) { return { width: value.length * Number(this.font.split(' ')[1].replace('px', '')) * .52 }; } }) }) },
    DOMParser: class { parseFromString(source) { return { querySelector: () => null, documentElement: { source } }; } },
    require(name) { if (name === 'react') return react; if (name === '@atlas/finishing/label') return label; if (name.endsWith('.css')) return new Proxy({}, { get: (_, key) => key }); if (name === 'qrcode') return require(name);
      return nextRequire(name.startsWith('@babel/runtime/') ? `next/dist/compiled/${name}` : name); },
  });
  f.render = () => { let loops = 0; do { dirty = false; cursor = 0; tree = exports.default({ ...f.props, onPrintDialog: event => dialogs.push(event) }); const pending = effects.splice(0); pending.forEach(fn => fn()); assert.ok(++loops < 20); } while (dirty); return tree; };
  f.find = predicate => all(tree, predicate); f.text = () => text(tree); f.print = () => { const button = f.find(node => node.type === 'button')[0]; assert.equal(Boolean(button.props.disabled), false); button.props.onClick(); f.render(); };
  f.render(); return f;
}
test('approved manual label shows full identity/half-point grade and only print-dialog evidence', () => {
  const f = fixture(); assert.match(f.text(), /Label ready/); assert.match(f.text(), /NFC setup pending/); assert.equal(f.prints.length, 0);
  f.print(); assert.equal(f.prints.length, 1); assert.match(f.prints[0], />9.5<\/text>/); assert.equal(f.dialogs[0].state, 'DIALOG_OPENED');
  assert.match(f.text(), /Print dialog opened/); assert.doesNotMatch(f.text(), /NFC verified|Label printed/);
});
test('rapid plan changes cannot print stale SVG under the next report identity', () => {
  const f = fixture({ plan: samplePlan(), autoPrintWindow: null });
  f.props = { plan: samplePlan({ version: 4, identity: { ...samplePlan().label.identity, playerName: 'Next Example' } }), autoPrintWindow: f.windowObject() }; f.render();
  assert.equal(f.prints.length, 1); assert.match(f.prints[0], /Next Example/); assert.match(f.prints[0], /version 4/); assert.doesNotMatch(f.prints[0], /Example Player/);
  f.render(); assert.equal(f.prints.length, 1);
});
test('popup failure shows a retry and invalid/no plans cannot print', () => {
  const f = fixture(); f.popupAllowed = false; f.print(); assert.equal(f.prints.length, 0); assert.match(f.text(), /Allow the label print window/);
  const bad = fixture({ plan: null }); assert.equal(Boolean(bad.find(node => node.type === 'button')[0].props.disabled), true); assert.match(bad.text(), /could not be prepared/);
});
test('unrenderable full identity closes the owned preparation popup without printing', () => {
  const f = fixture(), popup = f.windowObject();
  f.props = { plan: samplePlan({ identity: { ...samplePlan().label.identity, playerName: 'W'.repeat(180) } }), autoPrintWindow: popup };
  f.render(); assert.equal(popup.closed, true); assert.equal(f.prints.length, 0);
  assert.match(f.text(), /needs a reviewed label layout/); assert.match(f.text(), /NFC setup pending/);
});
