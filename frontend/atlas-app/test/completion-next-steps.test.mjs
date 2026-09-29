import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url), babel = require('next/dist/compiled/babel/core'), nextRequire = createRequire(require.resolve('next/package.json'));
const code = babel.transformSync(readFileSync(new URL('../components/CompletionNextSteps.jsx', import.meta.url), 'utf8'), {
  filename: 'CompletionNextSteps.jsx', presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } } }]], babelrc: false, configFile: false,
}).code;
const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) };
const exports = {};
vm.runInNewContext(code, { exports, require(name) {
  if (name === 'react') return react;
  if (name === 'next/link') return 'a';
  if (name.endsWith('.css')) return new Proxy({}, { get: (_, key) => key });
  return nextRequire(name.startsWith('@babel/runtime/') ? `next/dist/compiled/${name}` : name);
} });
const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : node ?? '';
const all = (node, predicate, out = []) => { if (Array.isArray(node)) node.forEach(child => all(child, predicate, out)); else if (node && typeof node === 'object') { if (predicate(node)) out.push(node); all(node.props?.children, predicate, out); } return out; };
const render = props => exports.default({ published: true, reportHref: 'https://atlasgrading.com/report/approved', ...props });

test('approved next steps expose label, NFC setup, explicit comps and report without starting work', () => {
  let opened = 0;
  const tree = render({ labelState: 'READY', marketAvailable: true, onToggleLabel: () => opened++, onToggleMarket: () => opened++ });
  assert.equal(opened, 0);
  assert.match(text(tree), /Print the label/); assert.match(text(tree), /enrolled Mac station and a qualified tag profile/);
  assert.match(text(tree), /Search on request/); assert.doesNotMatch(text(tree), /NFC verified|Printed|Searching/);
  const buttons = all(tree, node => node.type === 'button');
  assert.deepEqual(buttons.map(text), ['Open label & print', 'Review sold comps']);
  buttons[1].props.onClick(); assert.equal(opened, 1);
  const links = all(tree, node => node.type === 'a');
  assert.equal(links[0].props.href, '/station'); assert.equal(links[1].props.href, 'https://atlasgrading.com/report/approved');
  assert.equal(links[1].props.rel, 'noopener noreferrer');
});
test('pending publication exposes no label, station, comps or stale report actions', () => {
  const tree = render({ published: false, marketAvailable: true, labelState: 'READY' });
  assert.match(text(tree), /Publish the report/);
  assert.equal(all(tree, node => node.type === 'button' || node.type === 'a').length, 0);
});
test('unavailable sold search remains visible and disabled, without hiding report and setup', () => {
  const tree = render({ marketAvailable: false, onToggleLabel() {}, onToggleMarket() {} });
  assert.match(text(tree), /Search unavailable/);
  const button = all(tree, node => node.type === 'button' && text(node) === 'Review sold comps')[0];
  assert.equal(button.props.disabled, true); assert.equal(button.props['aria-expanded'], false);
  assert.equal(all(tree, node => node.type === 'a').length, 2);
});
test('failed label shows a review action and busy gating does not imply physical success', () => {
  const tree = render({ labelState: 'FAILED', disabled: true, marketAvailable: true, onToggleLabel() {}, onToggleMarket() {} });
  assert.match(text(tree), /Label needs attention/); assert.match(text(tree), /Review label issue/);
  assert.ok(all(tree, node => node.type === 'button').every(node => node.props.disabled));
  assert.doesNotMatch(text(tree), /Label printed|NFC verified/);
});
test('open tools have explicit collapse controls and a missing report URL is not invented', () => {
  const tree = render({ reportHref: null, labelOpen: true, marketOpen: true, marketAvailable: true, onToggleLabel() {}, onToggleMarket() {} });
  assert.deepEqual(all(tree, node => node.type === 'button').map(text), ['Hide label', 'Hide sold comps']);
  assert.ok(all(tree, node => node.type === 'button').every(node => node.props['aria-expanded']));
  assert.match(text(tree), /Report link unavailable/); assert.equal(all(tree, node => node.type === 'a').length, 1);
});
