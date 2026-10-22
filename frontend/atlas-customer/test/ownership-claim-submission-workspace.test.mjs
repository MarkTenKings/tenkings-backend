import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import * as client from '../lib/ownership-claim-submission-client.mjs';
import * as state from '../lib/ownership-claim-submission-state.mjs';
import { createClaimSubmissionFixture, CLAIM_SUBMISSION_CARD, CLAIM_SUBMISSION_OTHER_ACCOUNT, claimOriginal, claimResponse, pendingClaim } from './ownership-claim-submission-fixture.mjs';
const require = createRequire(new URL('../package.json', import.meta.url)), babel = require('next/dist/compiled/babel/core');
const file = '../components/collection/OwnershipClaimSubmissionWorkspace.jsx';
const code = babel.transformSync(readFileSync(new URL(file, import.meta.url), 'utf8'), { filename: file,
  presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } }, 'transform-runtime': { helpers: false } }]], babelrc: false, configFile: false }).code;
const flush = () => new Promise(resolve => setImmediate(resolve));
function harness() {
  let cursor = 0, mounted = true; const slots = [], effects = [], listeners = new Map();
  const changed = (a, b) => !a || a.length !== b.length || a.some((value, index) => value !== b[index]);
  const react = { Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { assert(mounted, 'No state after unmount'); slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useCallback(callback, deps) { const i = cursor++; if (changed(slots[i]?.deps, deps)) slots[i] = { deps, callback }; return slots[i].callback; },
    useEffect(callback, deps) { const i = cursor++; if (changed(slots[i]?.deps, deps)) { const old = slots[i]; slots[i] = { deps }; effects.push(() => { old?.cleanup?.(); slots[i].cleanup = callback(); }); } } };
  const exports = {}; vm.runInNewContext(code, { exports, Date, window: { addEventListener: (event, fn) => listeners.set(event, fn), removeEventListener: event => listeners.delete(event) },
    require: name => name === 'react' ? react : name.endsWith('/ownership-claim-submission-client.mjs') ? client : name.endsWith('/ownership-claim-submission-state.mjs') ? state : name.endsWith('.css') ? {} : require(name) });
  return { render(props) { cursor = 0; const tree = exports.default(props); while (effects.length) effects.shift()(); return tree; }, pagehide() { listeners.get('pagehide')?.(); },
    unmount() { for (const slot of slots) slot?.cleanup?.(); mounted = false; } };
}
const all = (tree, predicate) => !tree || typeof tree !== 'object' ? [] : [...(predicate(tree) ? [tree] : []), ...(tree.props?.children ?? []).flat(Infinity).flatMap(child => all(child, predicate))];
const words = tree => tree == null || tree === false ? '' : typeof tree !== 'object' ? String(tree) : (tree.props?.children ?? []).flat(Infinity).map(words).join(' ').replace(/\s+/g, ' ');
const button = (tree, label) => all(tree, node => node.type === 'button' && words(node) === label)[0];
function click(tree, label) { const found = button(tree, label); assert(found, label); assert(!found.props.disabled, `${label} must be enabled`); return found.props.onClick(); }
function input(tree, id, value) { const found = all(tree, node => node.props?.id === id)[0]; assert(found, id); assert(!found.props.disabled); found.props.onChange({ target: { value } }); }
function submit(tree, fieldId) { const form = all(tree, node => node.type === 'form' && all(node, child => child.props?.id === fieldId).length)[0]; assert(form); form.props.onSubmit({ preventDefault() {} }); }
function setup(options) { const f = createClaimSubmissionFixture(options), h = harness(), lost = []; const props = { customer: { id: f.accountId }, enabled: true, configuration: f.config, transport: f.transport, onAccessLost: () => lost.push(true) };
  h.render(props); return { f, h, props, lost, render: () => h.render(props) }; }
async function settled(f) { for (let i = 0; i < 100; i++) { await flush(); const tree = f.render(); if (!/(Checking card|Checking originals|Preparing upload|Uploading originals|Submitting claim|Withdrawing claim|Checking request|Checking claim|Replacing evidence)\s*…/.test(words(tree))) return tree; } throw Error('Fixture operation did not settle'); }
async function chooseCard(f) { input(f.render(), 'ownership-certificate', CLAIM_SUBMISSION_CARD.certificateNumber); submit(f.render(), 'ownership-certificate'); return settled(f); }
async function chooseFiles(f) { const tree = f.render(), select = all(tree, node => node.type === 'select')[0]; select?.props.onChange({ target: { value: f.f.config.proofKinds[0].code } });
  const upload = all(f.render(), node => node.type === 'input' && node.props.type === 'file')[0], target = { files: [claimOriginal('private-original.png')], value: 'sensitive-local-path' };
  upload.props.onChange({ target }); assert.equal(target.value, ''); return settled(f); }

test('actual component is disabled and has no working actions without explicit configuration and transport', async () => {
  const f = setup(); for (const patch of [{ enabled: false }, { configuration: null }, { transport: null }]) {
    const tree = f.h.render({ ...f.props, ...patch }); assert.match(words(tree), /Claim submission is not enabled/);
    assert.equal(all(tree, node => ['input', 'button', 'form', 'a'].includes(node.type)).length, 0);
  } await flush(); assert.equal(f.f.calls.length, 0);
});

test('real component stages original upload, server retention and explicit claim submission; dates never imply physical deletion', async () => {
  const f = setup(); let tree = await chooseCard(f); assert.match(words(tree), /Published report version 2/); assert.equal(f.f.calls.length, 1);
  tree = await chooseFiles(f); assert.match(words(tree), /private-original.png/); assert.equal(f.f.calls.some(c => c.action === 'reserve_bundle'), false);
  click(tree, 'Prepare upload'); tree = await settled(f); assert.match(words(tree), /Upload access until.*Evidence usable until.*Deletion scheduled after/);
  assert.match(words(tree), /does not confirm that physical deletion has occurred/); assert.match(words(tree), /0 of 1 originals confirmed retained/); assert.equal(button(tree, 'Submit claim'), undefined);
  click(tree, 'Upload originals'); tree = await settled(f); assert.match(words(tree), /All original files are confirmed retained by the server/);
  assert.equal(f.f.calls.some(c => c.action === 'submit_claim'), false); click(tree, 'Submit claim'); tree = await settled(f);
  assert.match(words(tree), /Claim submitted/); assert.match(words(tree), /Pending review/); assert.match(words(tree), /No current ownership is recorded/);
  assert.doesNotMatch(words(tree), /private-original.png/); assert.equal(all(tree, node => ['a', 'img'].includes(node.type)).length, 0);
});

test('lost retention response ends the upload status and recovery verifies the same original without another PUT', async () => {
  const f = setup(); await chooseCard(f); await chooseFiles(f); click(f.render(), 'Prepare upload'); await settled(f);
  f.f.faults.set('complete', async ({ next }) => { await next(); throw Error('retention response lost'); });
  click(f.render(), 'Upload originals'); let tree = await settled(f);
  assert.match(words(tree), /0 of 1 originals confirmed retained/);
  assert.doesNotMatch(words(tree), /Uploading an original|Checking an uploaded original|Original retained; checking/);
  assert.equal(button(tree, 'Verify uploaded originals').props.disabled, false);
  assert.equal(f.f.calls.filter(call => call.action === 'put').length, 1);
  assert.equal(button(tree, 'Submit claim'), undefined);
  f.f.faults.delete('complete'); click(tree, 'Verify uploaded originals');
  for (let i = 0; i < 100; i++) { await flush(); tree = f.render(); if (!/Verifying uploaded originals\s*…/.test(words(tree))) break; }
  assert.match(words(tree), /All original files are confirmed retained by the server/);
  assert.doesNotMatch(words(tree), /Uploading an original|Checking an uploaded original|Original retained; checking/);
  assert.equal(f.f.calls.filter(call => call.action === 'put').length, 1);
  assert.equal(f.f.calls.some(call => call.action === 'submit_claim'), false);
});

test('pending withdrawal and receipt recovery remain available with no configured storage or upload methods', async () => {
  const f = setup({ claim: pendingClaim() }); f.props.configuration = { ...f.f.config, canPrepareEvidence: false, proofKinds: [], formats: [], storageOrigin: null, storagePathPrefix: null };
  f.props.transport = { resolve: f.f.transport.resolve, lifecycle: f.f.transport.lifecycle };
  f.render(); input(f.render(), 'ownership-claim-reference', f.f.claim.claimId); submit(f.render(), 'ownership-claim-reference'); let tree = await settled(f);
  assert.match(words(tree), /New evidence submission is unavailable/); assert.match(words(tree), /access and review window has ended/); assert.equal(button(tree, 'Replace evidence').props.disabled, true);
  click(tree, 'Withdraw claim'); tree = f.render(); assert.equal(f.f.calls.some(c => c.action === 'withdraw_claim'), false);
  click(tree, 'Keep claim'); assert.equal(button(f.render(), 'Confirm withdrawal'), undefined);
  click(f.render(), 'Withdraw claim'); click(f.render(), 'Confirm withdrawal'); tree = await settled(f);
  assert.match(words(tree), /Claim withdrawn/); assert.match(words(tree), /Withdrawn/); assert.equal(button(tree, 'Replace evidence'), undefined);
  const requestId = f.f.calls.find(call => call.action === 'withdraw_claim').input.requestId;
  input(tree, 'ownership-request-reference', requestId); submit(f.render(), 'ownership-request-reference'); tree = await settled(f);
  assert.match(words(tree), /Claim withdrawn/); assert.equal(f.f.calls.filter(call => call.action === 'withdraw_claim').length, 1);
  assert.equal(f.f.calls.some(call => ['sign', 'put', 'complete'].includes(call.action)), false);
});

test('unknown write outcome freezes new inputs; check outcome is read-only and never silently resubmits', async () => {
  const f = setup(); await chooseCard(f); await chooseFiles(f); f.f.faults.set('reserve_bundle', async ({ next }) => { await next(); throw Error('private transport error'); });
  click(f.render(), 'Prepare upload'); let tree = await settled(f); assert.match(words(tree), /Check the request outcome/); assert.match(words(tree), /No automatic retry was sent/);
  assert.doesNotMatch(words(tree), /private transport error/); assert(all(tree, node => node.type === 'input').every(node => node.props.disabled));
  assert.equal(button(tree, 'Retry the same request'), undefined); click(tree, 'Check request outcome'); tree = await settled(f);
  assert.equal(f.f.calls.filter(c => c.action === 'reserve_bundle').length, 1); assert.match(words(tree), /0 of 1 originals confirmed retained/);
});

test('account/config replacement hides private names and references before effects; old buttons cannot act on new scope', async () => {
  const f = setup(); await chooseCard(f); const old = await chooseFiles(f), next = createClaimSubmissionFixture({ accountId: CLAIM_SUBMISSION_OTHER_ACCOUNT });
  f.props = { ...f.props, customer: { id: next.accountId }, configuration: next.config, transport: next.transport };
  let tree = f.h.render(f.props); assert.doesNotMatch(words(tree), /private-original.png|ATLAS-123456ABCDEF/); click(old, 'Prepare upload'); await flush(); assert.equal(next.calls.length, 0);
  tree = f.h.render(f.props); assert.equal(all(tree, node => node.props?.id === 'ownership-certificate')[0].props.value, '');
  // A same-object id change must also close synchronously before effect cleanup.
  f.props.customer.id = f.f.accountId; tree = f.h.render(f.props); assert.doesNotMatch(words(tree), /private-original/); assert.equal(all(tree, node => node.type === 'input').length, 0);
});

test('401/403/foreign-account responses clear fields and latch ended until a fresh customer context', async () => {
  for (const fault of [401, 403, 'foreign']) {
    const f = setup(); f.f.faults.set('resolve', async ({ next }) => fault === 'foreign' ? claimResponse({ ...(await (await next()).json()), accountId: CLAIM_SUBMISSION_OTHER_ACCOUNT }) : claimResponse({}, fault));
    let tree = await chooseCard(f); assert.match(words(tree), /Sign in again/); assert.equal(all(tree, node => ['input', 'button'].includes(node.type)).length, 0); assert.equal(f.lost.length, 1);
    f.props.enabled = false; f.render(); f.props.enabled = true; tree = f.render(); assert.match(words(tree), /Sign in again/); assert.equal(f.f.calls.length, 1);
    f.props.customer = { id: f.f.accountId }; f.render(); tree = f.render(); assert.equal(all(tree, node => node.type === 'input').length, 3);
  }
});

test('logout/pagehide/unmount abort a stalled request and permanently reject late private responses in that scope', async () => {
  for (const kind of ['logout', 'pagehide', 'unmount', 'account']) {
    const f = setup(); let release, signal;
    f.f.faults.set('resolve', ({ signal: passed }) => { signal = passed; return new Promise(resolve => { release = resolve; }); });
    input(f.render(), 'ownership-certificate', CLAIM_SUBMISSION_CARD.certificateNumber); submit(f.render(), 'ownership-certificate'); await flush();
    if (kind === 'logout') { f.props.accessState = 'ENDED'; f.render(); }
    else if (kind === 'pagehide') f.h.pagehide(); else if (kind === 'unmount') f.h.unmount();
    else { f.props.customer = { id: f.f.accountId }; f.render(); }
    assert.equal(signal.aborted, true); release(claimResponse({ accountId: f.f.accountId, private: 'late secret' })); await flush();
    if (kind !== 'unmount') { const tree = f.render(); assert.doesNotMatch(words(tree), /late secret|ATLAS-123456ABCDEF/); if (kind !== 'account') assert.match(words(tree), /Sign in again/); }
    assert.equal(f.f.calls.length, 1);
  }
});
