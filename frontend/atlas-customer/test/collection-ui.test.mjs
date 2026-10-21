import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import * as collectionContract from '../lib/collection-contract.mjs';
import * as compContract from '../lib/sold-comp-curation.mjs';
import { createCollectionPreviewFixture } from './collection-preview-fixture.mjs';

const require = createRequire(new URL('../package.json', import.meta.url));
const babel = require('next/dist/compiled/babel/core'), React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const compile = file => babel.transformSync(readFileSync(new URL(file, import.meta.url), 'utf8'), {
  filename: file, presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } }, 'transform-runtime': { helpers: false } }]], babelrc: false, configFile: false,
}).code;
const paths = { collection: '../components/collection/MyCollection.jsx', pricing: '../components/collection/PriceEvidence.jsx' };
const compiled = Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, compile(path)]));
function load(name, react, window = {}) {
  const exports = {};
  vm.runInNewContext(compiled[name], { exports, Intl, Date, Number, window,
    fetch() { throw new Error('Unexpected network effect'); },
    require: name => name === 'react' ? react : name.endsWith('/collection-contract.mjs') ? collectionContract
      : name.endsWith('/sold-comp-curation.mjs') ? compContract : name.endsWith('.css') ? {} : require(name),
  });
  return exports.default;
}
function harness(name) {
  let cursor = 0; const slots = [], effects = [], listeners = new Map();
  const changed = (a, b) => !a || a.length !== b.length || a.some((v, i) => v !== b[i]);
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
    useId() { const index = cursor++; return `fixture-${index}`; },
    useEffect(callback, deps) { const index = cursor++; if (changed(slots[index]?.deps, deps)) { const previous = slots[index]; slots[index] = { deps }; effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = callback(); }); } },
  };
  const component = load(name, react, { addEventListener: (event, fn) => listeners.set(event, fn), removeEventListener: event => listeners.delete(event) });
  return { render(props) { cursor = 0; const tree = component(props); while (effects.length) effects.shift()(); return tree; },
    pagehide() { listeners.get('pagehide')?.(); } };
}
const all = (tree, predicate) => !tree || typeof tree !== 'object' ? [] : [...(predicate(tree) ? [tree] : []), ...(tree.props?.children ?? []).flat(Infinity).flatMap(child => all(child, predicate))];
const words = tree => tree == null || tree === false ? '' : typeof tree !== 'object' ? String(tree) : (tree.props?.children ?? []).flat(Infinity).map(words).join(' ').replace(/\s+/g, ' ');
const button = (tree, label) => all(tree, node => node.type === 'button' && words(node).includes(label))[0];
const checks = tree => all(tree, node => node.type === 'input' && node.props.type === 'checkbox');

test('real server-rendered collection shows recorded preferences and exact report links without commerce actions', () => {
  const fixture = createCollectionPreviewFixture(), Component = load('collection', React);
  const html = renderToStaticMarkup(React.createElement(Component, fixture));
  assert.match(html, /Synthetic collection card A/); assert.match(html, /Open to offers/); assert.match(html, /Current physical holder/);
  assert.match(html, new RegExp(`/reports/${fixture.snapshot.cards[0].approvedCard.report.publicToken}\\?v=1`));
  assert.match(html, /Changes are not saved/); assert.doesNotMatch(html, />Make Offer|>Buy Now|>Save|mailto:|tel:/);
});

test('collection hides private data in the first render after account/access change', () => {
  const fixture = createCollectionPreviewFixture(), h = harness('collection');
  assert.match(words(h.render(fixture)), /Synthetic collection card A/);
  assert.doesNotMatch(words(h.render({ ...fixture, accountId: '99999999-9999-4999-8999-999999999999' })), /Synthetic|ATLAS-AAAA|Open to offers/);
  assert.doesNotMatch(words(h.render({ ...fixture, accessState: 'ENDED' })), /Synthetic|ATLAS-AAAA|Open to offers/);
});

test('pagehide removes collection metadata and pricing selections', () => {
  const fixture = createCollectionPreviewFixture();
  for (const name of ['collection', 'pricing']) {
    const h = harness(name); assert.match(words(h.render(fixture)), /Synthetic/); h.pagehide();
    assert.doesNotMatch(words(h.render(fixture)), /Synthetic|ATLAS-AAAA|\$100/);
  }
});

test('privacy and opt-out controls are reversible local previews and never claim saved state', () => {
  const fixture = createCollectionPreviewFixture(), original = structuredClone(fixture), h = harness('collection');
  let tree = h.render(fixture); checks(tree)[1].props.onChange({ target: { checked: true } }); tree = h.render(fixture);
  assert.match(words(tree), /Preview only — changes have not been saved/); assert.match(words(tree), /Preview: Private · Offers disabled/);
  assert.match(words(tree), /Offer preference recorded/); assert.equal(checks(tree)[1].props.checked, true);
  button(tree, 'Reset preview').props.onClick(); tree = h.render(fixture); assert.equal(checks(tree)[1].props.checked, false);
  assert.deepEqual(fixture, original);
});

test('search and absent title joins do not guess identities from submissions', () => {
  const fixture = createCollectionPreviewFixture(), h = harness('collection'); let tree = h.render(fixture);
  all(tree, node => node.type === 'input' && node.props.type === 'search')[0].props.onChange({ target: { value: 'card B' } }); tree = h.render(fixture);
  assert.match(words(tree), /Synthetic collection card B/); assert.doesNotMatch(words(tree), /Synthetic collection card A/);
  const ssr = renderToStaticMarkup(React.createElement(load('collection', React), { ...fixture, displays: {} }));
  assert.match(ssr, /Graded card/); assert.doesNotMatch(ssr, /Synthetic collection card/);
});

test('recorded revision changes discard an earlier settings preview before rendering', () => {
  const fixture = createCollectionPreviewFixture(), h = harness('collection'); let tree = h.render(fixture);
  checks(tree)[1].props.onChange({ target: { checked: true } }); tree = h.render(fixture); assert.equal(checks(tree)[1].props.checked, true);
  fixture.snapshot.preferences.revision++; tree = h.render(fixture); assert.equal(checks(tree)[1].props.checked, false);
  assert.doesNotMatch(words(tree), /Preview only — changes have not been saved/);
});

test('a new authorized account never sees the previous account search text on its first render', () => {
  const fixture = createCollectionPreviewFixture(), h = harness('collection'); let tree = h.render(fixture);
  all(tree, node => node.type === 'input' && node.props.type === 'search')[0].props.onChange({ target: { value: 'PRIVATE PREVIOUS SEARCH' } });
  tree = h.render(fixture);
  const next = structuredClone(fixture); next.accountId = '99999999-9999-4999-8999-999999999999';
  next.snapshot.accountId = next.accountId; next.snapshot.preferences.accountId = next.accountId;
  next.snapshot.cards.forEach(card => { card.ownership.ownerAccountId = next.accountId; });
  tree = h.render(next);
  assert.equal(all(tree, node => node.type === 'input' && node.props.type === 'search')[0].props.value, '');
});

test('actual price controls exclude undisclosed/lot amounts and explain the three selected references', () => {
  const fixture = createCollectionPreviewFixture(), h = harness('pricing'); let tree = h.render(fixture);
  assert.equal(checks(tree)[3].props.disabled, true); assert.equal(checks(tree)[4].props.disabled, true);
  for (let i = 0; i < 3; i++) { checks(tree)[i].props.onChange({ target: { checked: true } }); tree = h.render(fixture); }
  button(tree, 'selected sales').props.onClick(); tree = h.render(fixture);
  assert.match(words(tree), /Selected-sale mean \$100\.00/); assert.match(words(tree), /\$100\.00 \+ \$110\.00 \+ \$90\.00/);
  assert.match(words(tree), /seller chooses the asking price/); assert.match(words(tree), /approved report and saved market snapshot are unchanged/);
});

test('mixed graders cause an actionable local error; Skip produces no price', () => {
  const fixture = createCollectionPreviewFixture(), h = harness('pricing'); let tree = h.render(fixture);
  for (const i of [0, 5]) { checks(tree)[i].props.onChange({ target: { checked: true } }); tree = h.render(fixture); }
  button(tree, 'selected sales').props.onClick(); tree = h.render(fixture);
  assert.match(words(tree), /Choose sales from one grading company/); assert.doesNotMatch(words(tree), /Selected-sale mean/);
  button(tree, 'Skip comps').props.onClick(); tree = h.render(fixture); assert.match(words(tree), /No price is suggested/);
  assert.doesNotMatch(words(tree), /Selected-sale mean/);
});

test('new source/approval and access loss remove earlier pricing decisions immediately', () => {
  const fixture = createCollectionPreviewFixture(), h = harness('pricing'); let tree = h.render(fixture);
  checks(tree)[0].props.onChange({ target: { checked: true } }); tree = h.render(fixture); button(tree, 'selected sale').props.onClick(); tree = h.render(fixture);
  assert.match(words(tree), /Selected-sale mean/);
  const next = structuredClone(fixture); next.source.sourceHash = 'd'.repeat(64);
  assert.doesNotMatch(words(h.render(next)), /Selected-sale mean/);
  next.binding.report.version++; assert.doesNotMatch(words(h.render(next)), /Synthetic sold|Selected-sale mean/);
  assert.doesNotMatch(words(h.render({ ...fixture, accessState: 'ENDED' })), /Synthetic sold|Selected-sale mean/);
});

test('price review selection belongs to its current account scope and missing scope is refused', () => {
  const fixture = createCollectionPreviewFixture(), h = harness('pricing'); let tree = h.render(fixture);
  checks(tree)[0].props.onChange({ target: { checked: true } }); tree = h.render(fixture);
  button(tree, 'selected sale').props.onClick(); tree = h.render(fixture); assert.match(words(tree), /Selected-sale mean/);
  tree = h.render({ ...fixture, accountId: '99999999-9999-4999-8999-999999999999' });
  assert.doesNotMatch(words(tree), /Selected-sale mean/); assert.equal(checks(tree)[0].props.checked, false);
  assert.doesNotMatch(words(h.render({ ...fixture, accountId: null })), /Synthetic sold/);
});

test('pagination is visibly partial; empty collection never invents ownership', () => {
  const fixture = createCollectionPreviewFixture(), Component = load('collection', React);
  fixture.snapshot.nextCardId = fixture.snapshot.cards.at(-1).cardId;
  let html = renderToStaticMarkup(React.createElement(Component, fixture)); assert.match(html, /on this page/); assert.match(html, /current page only/);
  fixture.snapshot.cards = []; fixture.snapshot.nextCardId = null;
  html = renderToStaticMarkup(React.createElement(Component, fixture)); assert.match(html, /No verified cards yet/); assert.doesNotMatch(html, /Synthetic collection/);
});
