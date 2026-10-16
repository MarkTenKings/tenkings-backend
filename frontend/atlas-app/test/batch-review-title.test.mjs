import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url), babel = require('next/dist/compiled/babel/core');
const nextRequire = createRequire(require.resolve('next/package.json'));
// Expose only inside this test compilation; production keeps the dialog private.
const compiled = babel.transformSync(`${readFileSync(new URL('../components/BatchGrading.jsx', import.meta.url), 'utf8')}\nexport { RapidReviewDialog };`, {
  filename: 'BatchGrading.jsx', presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } } }]],
  babelrc: false, configFile: false,
}).code;
const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : node ?? '';
function find(node, matches) {
  if (Array.isArray(node)) { for (const child of node) { const match = find(child, matches); if (match) return match; } }
  else if (node && typeof node === 'object') return matches(node) ? node : find(node.props?.children, matches);
}
function harness(initialJob) {
  const slots = [], effects = [], cleanups = [], exports = {};
  let cursor = 0, tree, props = { job: initialJob, staff: { id: 'reviewer', role: 'REVIEWER' }, csrf: 'synthetic',
    busy: false, error: '', onClose() {}, onQueued() {} };
  const same = (first, second) => first && second && first.length === second.length && first.every((value, index) => Object.is(value, second[index]));
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), Fragment: 'fragment',
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useCallback(callback, deps) { const index = cursor++;
      if (!same(slots[index]?.deps, deps)) slots[index] = { callback, deps }; return slots[index].callback; },
    useEffect(callback, deps) { const index = cursor++;
      if (!same(slots[index], deps)) { slots[index] = deps; effects.push(() => { cleanups[index]?.(); cleanups[index] = callback(); }); } },
  };
  const document = { activeElement: { focus() {} }, body: { style: { overflow: '' } } };
  const modal = { opens: 0, closes: 0, showModal() { this.opens++; }, close() { this.closes++; } };
  vm.runInNewContext(compiled, { exports, document, require(name) {
    if (name === 'react') return react;
    if (name === './ManualCards') return { __esModule: true, default: 'ManualCards', ManualWorkspace: 'ManualWorkspace' };
    if (name === './RapidReviewControls') return { AtlasSoundControl: 'AtlasSoundControl' };
    if (name === '../lib/review-feedback.mjs') return { createReviewSession: staffId => ({ staffId, id: 'same-review-session' }) };
    if (name.endsWith('.module.css')) return new Proxy({}, { get: (_object, key) => key });
    if (name.startsWith('./') || name.startsWith('../') || name.startsWith('@atlas/') || name === 'next/router') return {};
    return nextRequire(name.startsWith('@babel/runtime/') ? `next/dist/compiled/${name}` : name);
  } });
  const render = () => { cursor = 0; tree = exports.RapidReviewDialog(props); tree.props.ref.current = modal;
    effects.splice(0).forEach(effect => effect()); return tree; };
  render();
  return { render, modal,
    title: () => text(find(tree, node => node.props?.id === 'rapid-review-title')),
    child: () => find(tree, node => ['ManualCards', 'ManualWorkspace'].includes(node.type)),
    changeJob(job) { props = { ...props, job }; render(); },
    dispose() { cleanups.forEach(cleanup => cleanup?.()); },
  };
}
const job = (key, reviewName, extra = {}) => ({ key, cardId: `card-${key}`, label: `Card ${key}`, reviewName, ...extra });

test('the actual persistent rapid dialog switches titles before the next workspace loads and preserves the review session', () => {
  const f = harness(job('one', 'Jaxson Dart'));
  assert.equal(f.title(), 'Review card · Jaxson Dart');
  const first = f.child().props;
  assert.deepEqual({...first.initialBatchReview},{key:'one',cardId:'card-one',state:undefined});
  first.onNameChange('Jaxson Dart corrected'); f.render();
  assert.equal(f.title(), 'Review card · Jaxson Dart corrected');
  f.changeJob(job('two', 'LaMelo Ball'));
  assert.equal(f.title(), 'Review card · LaMelo Ball');
  assert.equal(f.child().props.cardId, 'card-two');
  assert.equal(f.child().props.initialBatchReview.cardId, 'card-two');
  assert.equal(f.child().props.reviewSession, first.reviewSession);
  assert.equal(f.modal.opens, 1, 'Advancing cards must not reopen the dialog or reset the review session');
  const nextCallback = f.child().props.onNameChange;
  const workspaceKey = f.child().props.key;
  f.changeJob(job('two', 'LaMelo Ball', { revision: 2 }));
  assert.equal(f.child().props.onNameChange, nextCallback, 'Same-card title callback is stable across refreshed job objects');
  assert.equal(f.child().props.key, workspaceKey, 'Queue refresh must not remount an open workspace');
  f.dispose();
});

test('a late previous-card name cannot replace the next card or erase its corrected live name', () => {
  const f = harness(job('one', 'Jaxson Dart')), oldName = f.child().props.onNameChange;
  f.changeJob(job('two', 'LaMelo Ball'));
  oldName('Late Jaxson result'); f.render();
  assert.equal(f.title(), 'Review card · LaMelo Ball');
  f.child().props.onNameChange('LaMelo Ball corrected'); f.render();
  oldName('Still later Jaxson result'); f.render();
  assert.equal(f.title(), 'Review card · LaMelo Ball corrected');
  f.dispose();
});

test('advancing into setup uses that card name and forwards title updates through the setup-to-workspace transition', () => {
  const f = harness(job('one', 'Jaxson Dart')), oldName = f.child().props.onNameChange;
  f.changeJob(job('two', 'Pikachu', { needsSetup: true }));
  assert.equal(f.title(), 'Review card · Pikachu');
  assert.equal(f.child().type, 'ManualCards');
  assert.equal(f.child().props.embedded, true);
  const setupName = f.child().props.onNameChange;
  assert.equal(typeof setupName, 'function');
  setupName('Pikachu corrected'); f.render();
  oldName('Late Jaxson result'); f.render();
  assert.equal(f.title(), 'Review card · Pikachu corrected');
  f.changeJob(job('two', 'Pikachu', { needsSetup: false }));
  assert.equal(f.child().type, 'ManualWorkspace');
  assert.equal(f.child().props.onNameChange, setupName);
  assert.equal(f.title(), 'Review card · Pikachu corrected');
  f.child().props.onNameChange('Pikachu final identity'); f.render();
  assert.equal(f.title(), 'Review card · Pikachu final identity');
  f.dispose();
});
