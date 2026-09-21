import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import * as defectAnalysisClient from '../lib/manual-defect-analysis-client.mjs';

const require = createRequire(import.meta.url);
const babel = require('next/dist/compiled/babel/core');
const nextRequire = createRequire(require.resolve('next/package.json'));
const compiled = babel.transformSync(readFileSync(new URL('../components/ManualCards.jsx', import.meta.url), 'utf8'), {
  filename: 'ManualCards.jsx', presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } } }]],
  babelrc: false, configFile: false,
}).code;
const key = 'atlas-connected-command:reviewer:card';
const command = { path: '/api/staff/manual-connected/cards/card/details', body: { actionId: 'first', expectedRevision: 1, changes: { name: 'First' } } };
const storage = (initial = command) => { const values = new Map(initial ? [[key, JSON.stringify(initial)]] : []); return {
  getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k),
}; };
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function harness(store, post, { readCard } = {}) {
  const slots = [], effects = []; let cursor = 0, tree;
  const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), Fragment: 'fragment',
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useEffect(action, deps) { const i = cursor++, before = slots[i]; if (!before || deps.some((v, n) => v !== before[n])) { slots[i] = deps; effects.push(action); } },
    useCallback: action => action,
  };
  const card = { revision: 1, card: { ready: false, sourceHash: 'source', sides: { FRONT: { version: 0 }, BACK: { version: 0 } } },
    identification: { state: 'UNAVAILABLE' }, details: { fields: {}, profile: 'SPORTS' } };
  const exports = {};
  vm.runInNewContext(compiled, { exports, crypto: { randomUUID }, localStorage: store, setInterval, clearInterval,
    window: { addEventListener() {}, removeEventListener() {} },
    require(name) {
      if (name === 'react') return react;
      if (name === 'next/router') return { useRouter: () => ({ events: { on() {}, off() {} } }) };
      if (name === 'next/link' || name === './Shell') return { default: name };
      if (name === '@atlas/manual-intake/client') return { createBrowserIntakeJournal: () => ({ close() {} }), createIntakeClient: () => ({ pending: async () => [] }) };
      if (name.startsWith('@atlas/')) return {};
      if (name === '../lib/routes.mjs') return { STAFF_BASE_PATH: '/admin' };
      if (name === '../lib/manual-defect-analysis-client.mjs') return defectAnalysisClient;
      if (name === '../lib/manual-client.mjs') return { manualMessage: () => 'Retained', manualRequest: async (path, options = {}) => {
        if (options.method === 'POST') return post(path, options);
        return path.endsWith('/session') ? { staff: { id: 'reviewer' }, csrf: 'csrf' } : readCard ? readCard() : card;
      } };
      return nextRequire(name.startsWith('@babel/runtime/') ? `next/dist/compiled/${name}` : name);
    },
  });
  const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : node ?? '';
  function find(node, matches) {
    if (Array.isArray(node)) { for (const child of node) { const hit = find(child, matches); if (hit) return hit; } }
    else if (node && typeof node === 'object') { if (matches(node)) return node; return find(node.props?.children, matches); }
  }
  const button = label => find(tree, node => node.type === 'button' && text(node) === label);
  const field = label => find(tree, node => node.props?.['aria-label'] === label);
  const render = () => { cursor = 0; tree = exports.default({ staff: { id: 'reviewer', role: 'REVIEWER' }, cardId: 'card' }); for (const effect of effects.splice(0)) effect(); };
  return { render, click(label) { const target = button(label); assert.ok(target, label); assert.notEqual(target.props.disabled, true, label); target.props.onClick(); },
    has(label) { return Boolean(button(label)); }, disabled(label) { return button(label)?.props.disabled === true; }, text: () => text(tree), field,
    change(label, value) { const target = field(label); assert.ok(target, label); target.props.onChange({ target: { value } }); } };
}

for (const status of [200, 409]) test(`actual photo/details recovery preserves a newer uncertain save after an older ${status} reply`, async () => {
  const store = storage(); let finish;
  const late = harness(store, () => new Promise((resolve, reject) => { finish = () => status === 200 ? resolve({}) : reject({ status }); }));
  const fast = harness(store, async () => ({}));
  late.render(); fast.render(); await flush(); late.render(); fast.render();
  late.click('Resume saved request'); fast.click('Resume saved request'); await flush();
  assert.equal(store.getItem(key), null, 'the first recovery finished');
  const newer = { ...command, body: { ...command.body, actionId: 'second', changes: { name: 'Second' } } };
  store.setItem(key, JSON.stringify(newer));
  finish(); await flush(); late.render();
  assert.deepEqual(JSON.parse(store.getItem(key)), newer, 'late completion must retain the exact next command');
  assert.equal(late.has('Resume saved request'), true, 'the pending command remains visible');
});

test('a stale rendered recovery button cannot redispatch a replaced journal command', async () => {
  const store = storage(); let posts = 0;
  const f = harness(store, async () => { posts++; return {}; });
  f.render(); await flush(); f.render();
  const newer = { ...command, body: { ...command.body, actionId: 'second' } };
  store.setItem(key, JSON.stringify(newer));
  f.click('Resume saved request'); await flush(); f.render();
  assert.equal(posts, 0);
  assert.deepEqual(JSON.parse(store.getItem(key)), newer);
  assert.equal(f.has('Resume saved request'), true);
});

test('an unavailable photo/details reply retains the exact original request for retry', async () => {
  const store = storage(), original = store.getItem(key);
  const f = harness(store, async () => { throw { status: 503 }; });
  f.render(); await flush(); f.render(); f.click('Resume saved request'); await flush(); f.render();
  assert.equal(store.getItem(key), original);
  assert.equal(f.has('Resume saved request'), true);
});

const pokemonCard = () => ({ revision: 7,
  card: { ready: true, sourceHash: 'pokemon-source', sides: { FRONT: { version: 1 }, BACK: { version: 1 } } },
  identification: { state: 'COMPLETE' },
  details: { profile: 'POKEMON', layoutType: 'TRAINER', fields: { name: 'Saved name', set_name: 'Saved set' } },
});

for (const { label, field } of [
  { label: 'Card family', field: 'profile' },
  { label: 'Pokémon card kind', field: 'layoutType' },
]) test(`actual card details keep a cleared saved ${field} blank and save explicit null`, async () => {
  const store = storage(null), posts = []; let card = pokemonCard();
  const f = harness(store, async (path, options) => {
    posts.push({ path, body: JSON.parse(JSON.stringify(options.body)) });
    card = { ...card, revision: 8, details: { ...card.details, [field]: null } };
    return {};
  }, { readCard: () => card });
  f.render(); await flush(); f.render();
  assert.equal(f.field('Card family').props.value, 'POKEMON');
  assert.equal(f.field('Pokémon card kind').props.value, 'TRAINER');
  f.change(label, ''); f.render();
  assert.equal(f.field(label).props.value, '', 'the explicit clear must not fall back to the saved value');
  assert.equal(Boolean(f.field('Pokémon card kind')), field !== 'profile', 'layout visibility follows the edited family');
  f.click('Save details'); await flush(); f.render();
  assert.equal(posts.length, 1);
  assert.match(posts[0].body.actionId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(posts[0], { path: '/api/staff/manual-connected/cards/card/details',
    body: { actionId: posts[0].body.actionId, expectedRevision: 7, changes: { [field]: null } } });
  assert.equal(f.field(label).props.value, '');
  assert.equal(store.getItem(key), null, 'the acknowledged clear completes its exact command');
});

test('actual pending null selections and empty text survive a later recognition refresh', async () => {
  const store = storage(null), posts = []; let finishIdentification;
  let card = { ...pokemonCard(), identification: { state: 'NOT_STARTED' } };
  const f = harness(store, async (path, options) => {
    if (path.endsWith('/identify')) return new Promise(resolve => { finishIdentification = resolve; });
    posts.push({ path, body: JSON.parse(JSON.stringify(options.body)) });
    return {};
  }, { readCard: () => card });
  f.render(); await flush(); f.render();
  assert.equal(typeof finishIdentification, 'function', 'recognition is in flight while details are editable');
  f.change('Pokémon card kind', ''); f.change('Card family', ''); f.change('Name', ''); f.render();
  card = { ...pokemonCard(), revision: 9, details: { ...pokemonCard().details,
    fields: { name: 'Recognized name', set_name: 'Recognized set' } } };
  finishIdentification({}); await flush(); f.render();
  assert.equal(f.field('Card family').props.value, '');
  assert.equal(f.field('Pokémon card kind'), undefined);
  assert.equal(f.field('Name').props.value, '');
  assert.equal(f.field('Product / set').props.value, 'Recognized set', 'untouched fields receive the new recognition');
  f.click('Save details'); await flush(); f.render();
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0], { path: '/api/staff/manual-connected/cards/card/details',
    body: { actionId: posts[0].body.actionId, expectedRevision: 9,
      changes: { layoutType: null, profile: null, name: '' } } });
});

const rejectedCard = () => ({ ...pokemonCard(), identification: { state: 'UNKNOWN', attemptId: 'rejected-attempt',
  rejection: { code: 'API_CREDIT_BALANCE_EXHAUSTED', canRetry: true } } });

test('a verified credit rejection explains the billing failure without automatically retrying', async () => {
  const store = storage(null); let posts = 0;
  const f = harness(store, async () => { posts++; return {}; }, { readCard: rejectedCard });
  f.render(); await flush(); f.render(); await flush(); f.render();
  assert.match(f.text(), /identification request was rejected because the ATLAS API credit balance was exhausted/);
  assert.match(f.text(), /original photos are saved/);
  assert.equal(f.has('Retry identification'), true);
  assert.equal(posts, 0);
  assert.equal(store.getItem(key), null);
});

test('explicit identification retry journals one action and resumes that same action after a lost reply', async () => {
  const store = storage(null), posts = []; let card = rejectedCard();
  const f = harness(store, async (path, options) => {
    posts.push({ path, body: JSON.parse(JSON.stringify(options.body)) });
    assert.deepEqual(JSON.parse(store.getItem(key)), posts.at(-1), 'journal exists before dispatch');
    if (posts.length === 1) throw { status: 503 };
    card = pokemonCard();
    return { state: 'COMPLETE' };
  }, { readCard: () => card });
  f.render(); await flush(); f.render(); f.click('Retry identification'); await flush(); f.render();
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0], { path: '/api/staff/manual-connected/cards/card/identify', body: {
    actionId: posts[0].body.actionId, expectedAttemptId: 'rejected-attempt', sourceHash: 'pokemon-source',
  } });
  assert.match(posts[0].body.actionId, /^[0-9a-f-]{36}$/);
  assert.equal(f.disabled('Retry identification'), true);
  assert.equal(f.has('Resume saved request'), true);
  f.click('Resume saved request'); await flush(); f.render();
  assert.deepEqual(posts[1], posts[0], 'resuming cannot create a replacement action');
  assert.equal(store.getItem(key), null);
  assert.equal(f.has('Retry identification'), false);
});

test('a second retry click before rerender cannot dispatch another action', async () => {
  const store = storage(null), posts = []; let finish;
  const f = harness(store, async (path, options) => {
    posts.push({ path, body: JSON.parse(JSON.stringify(options.body)) });
    return new Promise(resolve => { finish = resolve; });
  }, { readCard: rejectedCard });
  f.render(); await flush(); f.render(); f.click('Retry identification'); f.click('Retry identification'); await flush();
  assert.equal(posts.length, 1);
  assert.deepEqual(JSON.parse(store.getItem(key)), posts[0]);
  finish({ state: 'UNKNOWN' }); await flush(); f.render();
});

test('unconfirmed or non-retryable identification outcomes offer no retry action', async () => {
  for (const identification of [
    { state: 'UNKNOWN', attemptId: 'uncertain' },
    { state: 'UNKNOWN', attemptId: 'rejected', rejection: { code: 'API_REQUEST_REJECTED', canRetry: false } },
    { state: 'UNKNOWN', attemptId: 'rejected', rejection: { code: 'API_CREDIT_BALANCE_EXHAUSTED', canRetry: false } },
  ]) {
    const f = harness(storage(null), async () => { assert.fail('must not dispatch'); },
      { readCard: () => ({ ...pokemonCard(), identification }) });
    f.render(); await flush(); f.render();
    assert.equal(f.has('Retry identification'), false);
  }
});

test('unsaved human card details disable identification retry and remain visible', async () => {
  const f = harness(storage(null), async () => { assert.fail('must not dispatch'); }, { readCard: rejectedCard });
  f.render(); await flush(); f.render();
  f.change('Name', 'Human correction'); f.render();
  assert.equal(f.disabled('Retry identification'), true);
  assert.equal(f.field('Name').props.value, 'Human correction');
});
