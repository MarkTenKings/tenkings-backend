import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import * as client from '../lib/ownership-claims-client.mjs';
import { CLAIM_ACCOUNT, CLAIM_OTHER_ACCOUNT, createOwnershipClaimsFixture, createOwnershipClaimHistoryFixture } from './ownership-claims-fixture.mjs';
const require = createRequire(new URL('../package.json', import.meta.url)), babel = require('next/dist/compiled/babel/core');
const file = '../components/collection/OwnershipClaimsWorkspace.jsx';
const code = babel.transformSync(readFileSync(new URL(file, import.meta.url), 'utf8'), {
  filename: file, presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } }, 'transform-runtime': { helpers: false } }]], babelrc: false, configFile: false,
}).code;
const flush = () => new Promise(resolve => setImmediate(resolve));
function harness() {
  let cursor = 0, mounted = true; const slots = [], effects = [], listeners = new Map();
  const changed = (a, b) => !a || a.length !== b.length || a.some((value, index) => value !== b[index]);
  const react = {
    Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { assert(mounted, 'No state after unmount'); slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useCallback(callback, deps) { const i = cursor++; if (changed(slots[i]?.deps, deps)) slots[i] = { deps, callback }; return slots[i].callback; },
    useEffect(callback, deps) { const i = cursor++; if (changed(slots[i]?.deps, deps)) { const old = slots[i]; slots[i] = { deps }; effects.push(() => { old?.cleanup?.(); slots[i].cleanup = callback(); }); } },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, AbortController, Promise, Date,
    window: { addEventListener: (event, fn) => listeners.set(event, fn), removeEventListener: event => listeners.delete(event) },
    require: name => name === 'react' ? react : name.endsWith('/ownership-claims-client.mjs') ? client : name.endsWith('.css') ? {} : require(name),
  });
  return { render(props) { cursor = 0; const tree = exports.default(props); while (effects.length) effects.shift()(); return tree; },
    pagehide() { listeners.get('pagehide')?.(); }, unmount() { for (const slot of slots) slot?.cleanup?.(); mounted = false; } };
}
const all = (tree, predicate) => !tree || typeof tree !== 'object' ? [] : [...(predicate(tree) ? [tree] : []), ...(tree.props?.children ?? []).flat(Infinity).flatMap(child => all(child, predicate))];
const words = tree => tree == null || tree === false ? '' : typeof tree !== 'object' ? String(tree) : (tree.props?.children ?? []).flat(Infinity).map(words).join(' ').replace(/\s+/g, ' ');
const rows = tree => all(tree, node => node.type === 'li' && node.props['data-claim-row']);
const button = (tree, label) => all(tree, node => node.type === 'button' && words(node) === label)[0];
const click = (tree, label) => { assert(button(tree, label), label); button(tree, label).props.onClick(); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function setup() {
  const requests = [], lost = [], props = { customer: { id: CLAIM_ACCOUNT }, enabled: true,
    readPage: input => { const d = deferred(); requests.push({ input, ...d }); return d.promise; }, onAccessLost: () => lost.push(true) };
  return { props, requests, lost, h: harness(), page: createOwnershipClaimsFixture({ count: 8 }).page };
}
async function ready(f, page = f.page) { f.h.render(f.props); await flush(); f.requests.at(-1).resolve(page); await flush(); return f.h.render(f.props); }

test('disabled default and missing transport perform no reads and never imply empty history', async () => {
  const f = setup();
  for (const props of [{ ...f.props, enabled: undefined }, { ...f.props, readPage: undefined }]) {
    const tree = f.h.render(props); await flush(); assert.match(words(tree), /Claim history is not enabled/); assert.equal(rows(tree).length, 0);
    assert.doesNotMatch(words(tree), /No submitted claims/); assert.equal(all(tree, x => ['button', 'a', 'input'].includes(x.type)).length, 0);
  }
  assert.equal(f.requests.length, 0);
});

test('actual component separates recorded current states, independent title and blocked evidence with no fake actions', async () => {
  const f = setup(), tree = await ready(f), claims = rows(tree);
  assert.equal(claims.length, 8); assert.match(words(claims[0]), /Pending/);
  assert.match(words(claims[1]), /Verified.*No current ownership is recorded/);
  assert.match(words(claims[2]), /Verified.*Current ownership is recorded/);
  assert.match(words(claims[3]), /Rejected/); assert.match(words(claims[4]), /Pending.*Review blocked.*Evidence access has expired/);
  assert.match(words(claims[5]), /earlier review policy/); assert.match(words(claims[6]), /review policy is unavailable/);
  assert.match(words(claims[7]), /Card details unavailable.*Withdrawn.*Evidence is unavailable/);
  assert.match(words(tree), /A verified claim records a review decision/); assert.match(words(tree), /up to 25 claims/);
  assert.equal(all(tree, node => ['input', 'a', 'form', 'img'].includes(node.type)).length, 0);
  assert.deepEqual(all(tree, x => x.type === 'button').map(words), ['Refresh page']);
});

test('account/session replacement hides private rows synchronously and rejects old buttons and late replies', async () => {
  const f = setup(), first = createOwnershipClaimsFixture({ count: 25, next: true }).page;
  const oldTree = await ready(f, first), next = { ...f.props, customer: { id: CLAIM_OTHER_ACCOUNT } };
  assert.equal(rows(f.h.render(next)).length, 0); await flush(); const current = f.requests[1];
  click(oldTree, 'Next page'); await flush(); assert.equal(f.requests.length, 2); assert.equal(current.input.signal.aborted, false);
  assert.equal(current.input.afterClaimId, null); assert.equal(current.input.accountId, CLAIM_OTHER_ACCOUNT);
  current.resolve(createOwnershipClaimsFixture({ accountId: CLAIM_OTHER_ACCOUNT, count: 1 }).page); await flush();
  assert.equal(rows(f.h.render(next)).length, 1);
  const replacement = { ...next, customer: { id: CLAIM_OTHER_ACCOUNT } };
  assert.equal(rows(f.h.render(replacement)).length, 0); await flush();
  const older = f.requests[2], final = { ...replacement, customer: { id: CLAIM_ACCOUNT } };
  assert.equal(rows(f.h.render(final)).length, 0); await flush(); older.resolve(f.page); await flush(); assert.equal(rows(f.h.render(final)).length, 0);
  f.requests[3].resolve(f.page); await flush(); assert.equal(rows(f.h.render(final)).length, 8);
});

test('pagination replaces rows; retry retains its exact cursor; stale overlapping responses cannot win', async () => {
  const f = setup(), first = createOwnershipClaimsFixture({ count: 25, next: true }).page;
  let tree = await ready(f, first); click(tree, 'Next page'); assert.equal(rows(f.h.render(f.props)).length, 0); await flush();
  assert.equal(f.requests[1].input.afterClaimId, first.nextClaimId); f.requests[1].reject(Error('PRIVATE NETWORK ERROR')); await flush();
  tree = f.h.render(f.props); assert.match(words(tree), /unavailable/); assert.doesNotMatch(words(tree), /PRIVATE NETWORK|No submitted claims/);
  click(tree, 'Try again'); await flush(); assert.equal(f.requests[2].input.afterClaimId, first.nextClaimId);
  f.requests[2].resolve(createOwnershipClaimsFixture({ after: 25, count: 1 }).page); await flush(); tree = f.h.render(f.props);
  assert.equal(rows(tree).length, 1); assert.doesNotMatch(words(tree), /ATLAS-000000000001/);
  click(tree, 'Refresh page'); await flush(); const older = f.requests[3]; click(tree, 'First page'); await flush();
  assert.equal(older.input.signal.aborted, true); assert.equal(f.requests[4].input.afterClaimId, null);
  f.requests[4].resolve(createOwnershipClaimsFixture({ count: 0 }).page); await flush(); older.resolve(first); await flush();
  tree = f.h.render(f.props); assert.equal(rows(tree).length, 0); assert.match(words(tree), /No submitted claims were found/);
});

test('in-place customer ID changes also hide the previous account before effects', async () => {
  const f = setup(), previous = await ready(f); f.props.customer.id = CLAIM_OTHER_ACCOUNT;
  assert.equal(rows(f.h.render(f.props)).length, 0); await flush();
  click(previous, 'Refresh page'); await flush(); assert.equal(f.requests.length, 2);
  assert.equal(f.requests[1].input.accountId, CLAIM_OTHER_ACCOUNT);
  f.requests[1].resolve(createOwnershipClaimsFixture({ accountId: CLAIM_OTHER_ACCOUNT, count: 1 }).page); await flush();
  assert.equal(rows(f.h.render(f.props)).length, 1);
});

test('401,403 and account-mismatched successes clear history and latch access ended until a new session', async () => {
  for (const failure of [401, 403, 'foreign']) {
    const f = setup(); await ready(f); click(f.h.render(f.props), 'Refresh page'); await flush();
    if (failure === 'foreign') f.requests[1].resolve({ ...f.page, accountId: CLAIM_OTHER_ACCOUNT });
    else f.requests[1].reject(Object.assign(Error('PRIVATE FAILURE'), { status: failure }));
    await flush(); let tree = f.h.render(f.props); assert.equal(rows(tree).length, 0); assert.match(words(tree), /Sign in again/);
    assert.equal(all(tree, x => x.type === 'button').length, 0); assert.equal(f.lost.length, 1);
    f.h.render({ ...f.props, enabled: false }); f.h.render(f.props); await flush(); assert.equal(f.requests.length, 2);
    const next = { ...f.props, customer: { id: CLAIM_ACCOUNT } }; tree = f.h.render(next); assert.equal(rows(tree).length, 0);
    await flush(); assert.equal(f.requests.length, 3); f.requests[2].resolve(f.page); await flush(); assert.equal(rows(f.h.render(next)).length, 8);
  }
});

test('logout, pagehide and unmount cancel reads and prevent private data resurrection', async () => {
  for (const mode of ['logout', 'pagehide', 'unmount']) {
    const f = setup(); f.h.render(f.props); await flush();
    if (mode === 'logout') f.h.render({ ...f.props, accessState: 'ENDED' });
    else if (mode === 'pagehide') f.h.pagehide(); else f.h.unmount();
    assert.equal(f.requests[0].input.signal.aborted, true); f.requests[0].resolve(f.page); await flush();
    if (mode !== 'unmount') { const tree = f.h.render(f.props); assert.equal(rows(tree).length, 0); assert.match(words(tree), /Sign in again/); await flush(); assert.equal(f.requests.length, 1); }
  }
});

test('injected readers cannot bypass cursor or exact schema validation; feature disable tears down private rows', async () => {
  const f = setup(); await ready(f); click(f.h.render(f.props), 'Refresh page'); await flush();
  f.requests[1].resolve({ ...f.page, nextClaimId: f.page.claims.at(-1).claimId }); await flush();
  assert.match(words(f.h.render(f.props)), /unavailable/); assert.equal(rows(f.h.render(f.props)).length, 0);
  click(f.h.render(f.props), 'Try again'); await flush(); f.requests[2].resolve(f.page); await flush();
  assert.equal(rows(f.h.render(f.props)).length, 8);
  const off = { ...f.props, enabled: false }; assert.equal(rows(f.h.render(off)).length, 0); assert.equal(f.requests[2].input.signal.aborted, true);
  assert.match(words(f.h.render(off)), /not enabled/);
});

function withHistory() {
  const f = setup(); f.historyRequests = [];
  f.props.readHistory = input => { const d = deferred(); f.historyRequests.push({ input, ...d }); return d.promise; };
  return f;
}
test('history replaces current state with newer withdrawal while past submission and replacement stay distinct', async () => {
  const f = withHistory(); let tree = await ready(f, createOwnershipClaimsFixture({ count: 1 }).page);
  click(tree, 'View recorded changes'); await flush(); tree = f.h.render(f.props); assert.match(words(tree), /Loading recorded changes/);
  const result = createOwnershipClaimHistoryFixture().history; f.historyRequests[0].resolve(result); await flush(); tree = f.h.render(f.props);
  assert.equal(rows(tree).length, 1); const text = words(tree);
  assert.match(text, /Withdrawn.*Current claim revision 3/); assert.match(text, /Claim submitted Revision 1 · Pending/);
  assert.match(text, /Evidence replaced Revision 2 · Pending/); assert.match(text, /Claim withdrawn Revision 3 · Withdrawn/);
  assert.match(text, /Past actions below do not replace the current state/);
  click(tree, 'Close changes'); tree = f.h.render(f.props); assert.match(words(tree), /Withdrawn.*Current claim revision 3/); assert.doesNotMatch(words(tree), /Claim submitted/);
  click(tree, 'View recorded changes'); await flush(); f.historyRequests[1].resolve(createOwnershipClaimHistoryFixture({ revision: 1, state: 'PENDING' }).history); await flush();
  tree = f.h.render(f.props); assert.match(words(tree), /Recorded changes are unavailable/); assert.match(words(tree), /Withdrawn.*Current claim revision 3/);
});

test('history pagination replaces its bounded page and refresh clears it; old page controls cannot reopen private rows', async () => {
  const f = withHistory(); let tree = await ready(f, createOwnershipClaimsFixture({ count: 1 }).page);
  click(tree, 'View recorded changes'); await flush(); f.historyRequests[0].resolve(createOwnershipClaimHistoryFixture({ revision: 27, limit: 25 }).history); await flush();
  tree = f.h.render(f.props); assert.match(words(tree), /Revision 25/); assert.doesNotMatch(words(tree), /Revision 26/);
  click(tree, 'Next changes'); await flush(); assert.equal(f.historyRequests[1].input.afterRevision, 25);
  f.historyRequests[1].resolve(createOwnershipClaimHistoryFixture({ revision: 27, afterRevision: 25, limit: 25 }).history); await flush();
  const old = tree = f.h.render(f.props); assert.match(words(tree), /Revision 26/); assert.doesNotMatch(words(tree), /Claim submitted/);
  click(tree, 'Refresh page'); await flush(); assert.equal(f.historyRequests[1].input.signal.aborted, true); assert.equal(rows(f.h.render(f.props)).length, 0);
  click(old, 'View recorded changes'); await flush(); assert.equal(f.historyRequests.length, 2);
  f.requests[1].resolve(createOwnershipClaimsFixture({ count: 1 }).page); await flush(); assert.doesNotMatch(words(f.h.render(f.props)), /Evidence replaced/);
});

test('history legacy disclosure and unavailable retry do not invent legacy events or deletion', async () => {
  const f = withHistory(), page = createOwnershipClaimsFixture({ count: 1 }).page; page.claims[0].bundleId = null;
  let tree = await ready(f, page); click(tree, 'View recorded changes'); await flush(); f.historyRequests[0].reject(Error('PRIVATE')); await flush();
  tree = f.h.render(f.props); assert.match(words(tree), /Recorded changes are unavailable/); assert.doesNotMatch(words(tree), /PRIVATE/);
  click(tree, 'Try history again'); await flush(); assert.equal(f.historyRequests[1].input.afterRevision, 0);
  f.historyRequests[1].resolve(createOwnershipClaimHistoryFixture({ legacy: true, revision: 1, state: 'PENDING' }).history); await flush(); tree = f.h.render(f.props);
  assert.match(words(tree), /began before v2 history/); assert.match(words(tree), /No recorded v2 changes/); assert.doesNotMatch(words(tree), /Claim submitted/);
  assert.match(words(await ready(setup())), /Evidence access has expired. This does not confirm deletion/);
});

test('history session loss clears the whole page; account/reader/pagehide/unmount changes cancel and reject late history', async () => {
  for (const mode of ['foreign', '401', '403', 'account', 'reader', 'pagehide', 'unmount']) {
    const f = withHistory(); const old = await ready(f, createOwnershipClaimsFixture({ count: 1 }).page);
    click(old, 'View recorded changes'); await flush(); const pending = f.historyRequests[0];
    let props = f.props;
    if (mode === 'account') props = { ...f.props, customer: { id: CLAIM_OTHER_ACCOUNT } };
    if (mode === 'reader') props = { ...f.props, readHistory: null };
    if (['account', 'reader'].includes(mode)) f.h.render(props);
    if (mode === 'pagehide') f.h.pagehide(); if (mode === 'unmount') f.h.unmount();
    if (['401', '403'].includes(mode)) pending.reject({ status: Number(mode) });
    else pending.resolve(createOwnershipClaimHistoryFixture({ accountId: mode === 'foreign' ? CLAIM_OTHER_ACCOUNT : CLAIM_ACCOUNT }).history);
    await flush();
    if (mode !== 'unmount') {
      const tree = f.h.render(props); assert.doesNotMatch(words(tree), /Claim submitted|Claim withdrawn/);
      if (['401', '403', 'foreign', 'pagehide'].includes(mode)) { assert.equal(rows(tree).length, 0); assert.match(words(tree), /Sign in again/); }
    }
    if (!['401', '403', 'foreign'].includes(mode)) assert.equal(pending.input.signal.aborted, true);
  }
});
