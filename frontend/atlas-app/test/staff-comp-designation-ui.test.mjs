import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(new URL('../package.json', import.meta.url)), babel = require('next/dist/compiled/babel/core');
const code = babel.transformSync(readFileSync(new URL('../components/StaffCompDesignationReview.jsx', import.meta.url), 'utf8'), {
  filename: 'StaffCompDesignationReview.jsx', presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } }, 'transform-runtime': { helpers: false } }]], babelrc: false, configFile: false,
}).code;
const nodes = (tree, predicate) => Array.isArray(tree) ? tree.flatMap(n => nodes(n, predicate)) : !tree || typeof tree !== 'object' ? []
  : [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
const words = tree => Array.isArray(tree) ? tree.map(words).join(' ') : tree == null || tree === false ? '' : typeof tree === 'object' ? words(tree.props.children) : String(tree);
test('label review fetches only on explicit opening and requires decoded verified photo, choice and acknowledgement', () => {
  const slots = [], cleanups = []; let cursor = 0, descriptor, photo = { url: null, error: null, retry() {} };
  const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useEffect(work) { const i = cursor++; if (!(i in slots)) { slots[i] = true; cleanups.push(work()); } },
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = value; }]; } };
  const exports = {};
  vm.runInNewContext(code, { exports, require(name) {
    if (name === 'react') return react;
    if (name === '@atlas/manual-workspace/report-review') return { useVerifiedImage(value) { descriptor = value; return photo; } };
    if (name.endsWith('.css')) return { __esModule: true, default: {} }; return require(name);
  } });
  const row = { id: 'synthetic-sale', title: 'Synthetic saved sale', designationReview: { proofHash: '1'.repeat(64), photoSha256: '2'.repeat(64), labelText: 'Synthetic label', allowedDesignations: ['STANDARD'] } };
  const chosen = [], props = { row, cardId: 'card', previewId: 'preview', onChoose: value => chosen.push(value) };
  const render = () => { cursor = 0; return exports.default(props); };
  const button = (tree, label) => nodes(tree, n => n.type === 'button' && words(n).trim() === label)[0];
  let tree = render(); assert.equal(descriptor, null); assert.equal(chosen.length, 0);
  button(tree, 'Review saved label').props.onClick(); tree = render();
  assert.match(descriptor.url, /presentation\/market\/archive-image\?preview=preview&image=/);
  assert.equal(descriptor.sha256, row.designationReview.photoSha256);
  assert(button(tree, 'Use this reviewed sale').props.disabled);
  photo = { ...photo, url: 'blob:verified' }; tree = render();
  assert(nodes(tree, n => n.type === 'select')[0].props.disabled);
  nodes(tree, n => n.type === 'img')[0].props.onLoad(); tree = render();
  const select = nodes(tree, n => n.type === 'select')[0]; assert.equal(select.props.value, ''); assert.equal(select.props.disabled, false);
  select.props.onChange({ target: { value: 'STANDARD' } }); tree = render();
  assert(button(tree, 'Use this reviewed sale').props.disabled);
  nodes(tree, n => n.type === 'input')[0].props.onChange({ target: { checked: true } }); tree = render();
  assert.equal(button(tree, 'Use this reviewed sale').props.disabled, false);
  const retainedChoose = button(tree, 'Use this reviewed sale').props.onClick;
  nodes(tree, n => n.type === 'img')[0].props.onError(); tree = render(); assert(button(tree, 'Use this reviewed sale').props.disabled);
  retainedChoose(); button(tree, 'Use this reviewed sale').props.onClick(); assert.equal(chosen.length, 0);
  button(tree, 'Retry saved photograph').props.onClick(); tree = render(); nodes(tree, n => n.type === 'img')[0].props.onLoad(); tree = render();
  nodes(tree, n => n.type === 'input')[0].props.onChange({ target: { checked: true } }); tree = render();
  button(tree, 'Use this reviewed sale').props.onClick(); tree = render();
  assert.equal(chosen.length, 1); assert.deepEqual(JSON.parse(JSON.stringify(chosen[0])), { id: row.id, designation: 'STANDARD', photoSha256: row.designationReview.photoSha256, proofHash: row.designationReview.proofHash });
  assert.equal(descriptor, null); assert(button(tree, 'Review saved label'));
  retainedChoose(); assert.equal(chosen.length, 1);
  for (const cleanup of cleanups) cleanup?.(); retainedChoose(); assert.equal(chosen.length, 1);
});
