import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import * as traceCodec from '@atlas/grading-core/trace-codec';
import * as traceWire from '@atlas/grading-core/trace-bitmap-wire';
import * as traceEditor from '@atlas/grading-core/trace-editor';
import * as actions from '../src/defect-actions.mjs';
import * as presentation from '../src/astra-review-ui.mjs';
import * as inspectionViewport from '../src/inspection-viewport.mjs';
import { workspace } from './defect-fixtures.mjs';

// The actual JSX and real trace tools run here; only React scheduling and image
// byte loading are isolated. Image integrity has its own verified-image suite.
const require = createRequire(new URL('../../../frontend/atlas-app/package.json', import.meta.url));
const babel = require('next/dist/compiled/babel/core'), nextRequire = createRequire(require.resolve('next/package.json'));
const compiled = babel.transformSync(readFileSync(new URL('../src/DefectReviewWorkspace.jsx', import.meta.url), 'utf8'), {
  filename: 'DefectReviewWorkspace.jsx', presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } } }]],
  babelrc: false, configFile: false,
}).code;
const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : node ?? '';
function all(node, predicate, found = []) {
  if (Array.isArray(node)) node.forEach(child => all(child, predicate, found));
  else if (node && typeof node === 'object') { if (predicate(node)) found.push(node); all(node.props?.children, predicate, found); }
  return found;
}
function astraFor(state, status = 'READY') {
  return { enabled: true, status, analysisId: 'analysis-1', base: Object.fromEntries(['FRONT', 'BACK'].map(side => [side, actions.defectBase(state, side)])),
    proposalReview: { analysisId: 'analysis-1', resultHash: 'f'.repeat(64), proposalIds: ['proposal-1'] },
    proposals: [{ id: 'proposal-1', side: 'FRONT', defectType: 'LIGHT_SCRATCH_SCUFF', reviewStatus: 'UNREVIEWED',
      canonicalContour: [{ x: .2, y: .2 }, { x: .22, y: .2 }, { x: .22, y: .22 }, { x: .2, y: .22 }],
      observation: 'Possible short scratch.', uncertainty: 'May be a printed line.' }] };
}
function harness(initial = {}, browser) {
  const instances = new Map(), elements = new Map(); let current, cursor, dirty, effects = [], tree;
  const memo = (make, deps) => { const i = cursor++, old = current[i]; if (!old || deps.some((value, n) => !Object.is(value, old.deps[n]))) current[i] = { deps, value: make() }; return current[i].value; };
  const react = { Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initialValue) { const i = cursor++, slots = current; if (!(i in slots)) slots[i] = typeof initialValue === 'function' ? initialValue() : initialValue;
      return [slots[i], update => { const next = typeof update === 'function' ? update(slots[i]) : update; if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true; } }]; },
    useRef(value) { const i = cursor++; if (!(i in current)) current[i] = { current: value }; return current[i]; },
    useMemo: memo, useCallback: (value, deps) => memo(() => value, deps),
    useEffect(action, deps) { const i = cursor++, slots = current, old = slots[i]; if (!old || deps.some((value, n) => !Object.is(value, old.deps[n]))) {
      slots[i] = { deps, cleanup: old?.cleanup }; effects.push(() => { slots[i].cleanup?.(); slots[i].cleanup = action(); }); } },
  };
  const exports = {};
  vm.runInNewContext(compiled, { exports, window:browser, crypto: { randomUUID }, ResizeObserver: class {
    constructor(callback) { this.callback = callback; }
    observe(element) { this.element = element; element.notifyResize = this.callback; }
    disconnect() { delete this.element.notifyResize; }
  }, require(name) {
    if (name === 'react') return react;
    if (name === '@atlas/grading-core/trace-codec') return traceCodec;
    if (name === '@atlas/grading-core/trace-bitmap-wire') return traceWire;
    if (name === '@atlas/grading-core/trace-editor') return traceEditor;
    if (name === './defect-actions.mjs') return actions;
    if (name === './astra-review-ui.mjs') return presentation;
    if (name === './inspection-viewport.mjs') return inspectionViewport;
    if (name === './verified-image.mjs') return { useVerifiedImage: image => ({ url: image?.url ?? null }) };
    return nextRequire(name.startsWith('@babel/runtime/') ? `next/dist/compiled/${name}` : name);
  } });
  function expand(node, path = 'root') {
    if (Array.isArray(node)) return node.map((child, index) => expand(child, `${path}.${index}:${child?.props?.key ?? ''}`));
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function') {
      const identity = `${path}:${node.type.name}`; if (!instances.has(identity)) instances.set(identity, []);
      current = instances.get(identity); cursor = 0; return expand(node.type(node.props), `${identity}.out`);
    }
    if (node.props?.ref && ['ad-plane', 'ad-viewport'].some(name => node.props.className?.split(' ').includes(name))) {
      if (!elements.has(path)) elements.set(path, { clientWidth: 400, clientHeight: 560, listeners: new Map(), focus() {}, scrollIntoView() {},
        addEventListener(name, handler) { this.listeners.set(name, handler); },
        removeEventListener(name, handler) { if (this.listeners.get(name) === handler) this.listeners.delete(name); },
        setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture() { return true; } });
      const element = elements.get(path), isPlane = node.props.className.split(' ').includes('ad-plane');
      element.getBoundingClientRect = () => isPlane ? f.imageRect : f.viewportRect;
      node.props.ref.current = element;
    }
    return { ...node, props: { ...node.props, children: expand(node.props.children, `${path}.children`) } };
  }
  const state = workspace(false);
  const f = { calls: [], imageRect: { left: -40, top: -40, width: 1350, height: 1858 },
    viewportRect: { left: 0, top: 0, width: 400, height: 560 }, props: { workspace: state,
    images: Object.fromEntries(['FRONT', 'BACK'].map(side => [side, { inspection: { url: `blob:${side}`, sha256: state.sides[side].frame.inspectionImageSha256 } }])),
    onEdit: async request => f.calls.push({ kind: 'edit', request }), onInspectBoth: async () => {}, onConfirm: async () => {},
    onReviewProposal: async request => f.calls.push({ kind: 'proposal', request }), onAnalyzeDefects: async request => f.calls.push({ kind: 'analyze', request }),
    ...initial } };
  f.render = () => { let count = 0; do { dirty = false; tree = expand({ type: exports.DefectReviewWorkspace, props: f.props }); const pending = effects; effects = []; pending.forEach(run => run());
    assert.ok(++count < 20, 'effects settled'); } while (dirty); return tree; };
  f.nodes = (predicate, side) => all(side ? f.side(side) : tree, predicate);
  f.side = side => all(tree, node => node.type === 'section' && node.props['aria-label'] === `${side} defects`)[0];
  f.button = (label, side) => { const hit = f.nodes(node => node.type === 'button' && text(node) === label, side)[0]; assert.ok(hit, label); return hit; };
  f.click = async (label, side) => { const hit = f.button(label, side); assert.equal(Boolean(hit.props.disabled), false, `${label} enabled`); await hit.props.onClick(); f.render(); };
  f.control = (label, side) => { const hit = f.nodes(node => node.props?.['aria-label'] === label, side)[0]; assert.ok(hit, label); return hit; };
  f.clickControl = async (label, side) => { const hit = f.control(label, side); assert.equal(Boolean(hit.props.disabled), false, `${label} enabled`); await hit.props.onClick(); f.render(); };
  f.select = (label, value, side) => { const hit = f.control(label, side); assert.equal(Boolean(hit.props.disabled), false); hit.props.onChange({ target: { value: String(value) } }); f.render(); };
  f.check = (label, checked, side) => { const owner = f.nodes(node => node.type === 'label' && text(node) === label, side)[0]; assert.ok(owner, label);
    const input = all(owner, node => node.type === 'input')[0]; assert.equal(Boolean(input.props.disabled), false); input.props.onChange({ target: { checked } }); f.render(); };
  f.key = (value, side = 'Front', event = 'onKeyDown') => { const node = f.control(`${side} image inspection`), target = node.props.ref.current;
    node.props[event]({ key: value, target, currentTarget: target, preventDefault() {} }); f.render(); };
  f.resize = (side, width, height) => { const element = f.control(`${side} image inspection`).props.ref.current;
    element.clientWidth = width; element.clientHeight = height; element.notifyResize(); f.render(); };
  f.has = label => text(tree).includes(label);
  f.ready = () => { f.nodes(node => node.type === 'img' && node.props.onLoad).forEach(node => node.props.onLoad({ currentTarget: { naturalWidth: 1350, naturalHeight: 1858 } })); f.render(); };
  f.draw = (side = 'Front') => { const plane = f.nodes(node => node.props?.className === 'ad-plane', side)[0];
    plane.props.onPointerDown({ clientX: 650, clientY: 650, button: 0, pointerId: 1, preventDefault() {}, currentTarget: { setPointerCapture() {} } });
    plane.props.onPointerMove({ clientX: 680, clientY: 680 }); plane.props.onPointerUp(); f.render(); };
  f.render(); return f;
}

test('suggestions are separate and unreviewed; adoption requires the loaded matching image and an explicit human action', async () => {
  const state = workspace(false), f = harness({ workspace: state, astra: astraFor(state) });
  assert.equal(f.button('Accept suggestion').props.disabled, true); assert.equal(f.calls.length, 0);
  f.ready(); assert.equal(f.has('Unreviewed'), true); assert.equal(f.has('May be a printed line.'), true);
  assert.equal(f.nodes(node => node.type === 'polygon').length, 1);
  assert.equal(f.nodes(node => node.type === 'section' && node.props['aria-label'] === 'Front ATLAS suggestions').length, 1);
  await f.click('Accept suggestion');
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].kind, 'proposal');
  assert.equal(f.calls[0].request.action, 'ACCEPT'); assert.equal(f.calls[0].request.actor, 'HUMAN');
  assert.deepEqual(f.calls[0].request.base, actions.defectBase(state, 'FRONT'));
  assert.equal(f.props.workspace.sides.FRONT.findings.length, 0, 'the UI does not invent a measured finding');
});

test('image/frame mismatch hides overlays and blocks adoption while manual tools and unaffected proposals remain usable', async () => {
  const state = workspace(false), f = harness({ workspace: state, astra: astraFor(state) }); f.ready();
  f.props.astra = { ...f.props.astra, base: { ...f.props.astra.base, FRONT: { ...f.props.astra.base.FRONT, frame: { ...f.props.astra.base.FRONT.frame, frameId: 'old-frame' } } } }; f.render();
  assert.equal(f.button('Accept suggestion').props.disabled, true); assert.equal(f.nodes(node => node.type === 'polygon').length, 0);
  assert.equal(f.has('earlier image or card outline'), true); assert.equal(f.button('Add finding', 'Front').props.disabled, false);
  await f.click('Add finding', 'Front'); assert.equal(f.has('Unsaved trace'), true);
});

test('a delayed analysis response and knowledge refresh cannot erase an active human trace', async () => {
  const state = workspace(false), f = harness({ workspace: state, astra: { ...astraFor(state, 'RUNNING'), proposals: [] } }); f.ready();
  await f.click('Add finding', 'Front'); f.draw();
  f.props.astra = { ...astraFor(state), knowledgeRevision: 12 }; f.render();
  assert.equal(f.has('Unsaved trace'), true); assert.equal(f.button('Accept suggestion').props.disabled, true);
  assert.equal(f.nodes(node => node.type === 'polygon').length, 0, 'proposal outlines do not obscure active trace correction');
  await f.click('Save trace', 'Front');
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].kind, 'edit');
  const pixels = traceWire.decodeSpeedsterTraceBitmapWireV1(f.calls[0].request.action.trace.traceWire);
  assert.equal(pixels[660 * 1270 + 660], 1, 'the deliberate human stroke is retained');
  assert.equal(pixels[365 * 1270 + 265], 0, 'the delayed suggested outline is not substituted');
});

test('correcting a suggestion uses real trace tools and preserves proposal identity through later result refresh', async () => {
  const state = workspace(false), f = harness({ workspace: state, astra: astraFor(state) }); f.ready();
  await f.click('Correct trace'); f.draw();
  f.props.astra = { ...f.props.astra, analysisId: 'analysis-2', proposals: [] }; f.render();
  await f.click('Save trace', 'Front');
  const { request } = f.calls[0]; assert.equal(f.calls[0].kind, 'proposal'); assert.equal(request.action, 'TRACE_SAVE');
  assert.equal(request.analysisId, 'analysis-1'); assert.equal(request.proposalId, 'proposal-1');
  assert.equal(request.trace.defectType, 'LIGHT_SCRATCH_SCUFF');
  const pixels = traceWire.decodeSpeedsterTraceBitmapWireV1(request.trace.traceWire);
  assert.equal(pixels[365 * 1270 + 265], 1); assert.equal(pixels[660 * 1270 + 660], 1);
});

test('unknown/refused analysis never blocks manual work or claims that no defects exist', async () => {
  for (const status of ['RUNNING', 'UNKNOWN', 'REFUSED', 'FAILED', 'UNRECOGNIZED']) {
    const state = workspace(false), f = harness({ workspace: state, astra: { ...astraFor(state, status), proposals: [] } }); f.ready();
    assert.equal(f.button('Add finding', 'Back').props.disabled, false, status);
    assert.equal(f.has('ATLAS returned no suggestions.'), false, status);
    if (['RUNNING', 'UNKNOWN', 'UNRECOGNIZED'].includes(status)) assert.equal(f.button('Find defects with ATLAS').props.disabled, true);
  }
});

test('an uncertain request reply requires status reconciliation; no local success or blind retry is fabricated', async () => {
  const state = workspace(false), f = harness({ workspace: state, astra: { ...astraFor(state, 'IDLE'), proposals: [] },
    onAnalyzeDefects: async () => { throw Error('lost response'); }, onRefreshAnalysis: async () => {} }); f.ready();
  await f.click('Find defects with ATLAS'); assert.equal(f.button('Find defects with ATLAS').props.disabled, true);
  assert.equal(f.has('No analysis result has been received'), true); assert.equal(f.button('Add finding', 'Front').props.disabled, false);
  f.props.astra = { ...f.props.astra, status: 'REFUSED' }; f.render();
  assert.equal(f.button('Find defects with ATLAS').props.disabled, false);
});

test('pending reviewed memory survives recovery without a fabricated saved state or extra grading confirmation', async () => {
  const f = harness({ reviewedMemory: { enabled: true, status: 'PENDING' }, onRetryReviewedMemory: async () => { throw Error('lost acknowledgement'); } }); f.ready();
  assert.equal(f.has('Reviewed examples are pending.'), true); assert.equal(f.has('Reviewed examples saved'), false);
  await f.click('Check example save'); assert.equal(f.has('Reviewed examples are pending.'), true);
  assert.equal(f.has('Reviewed examples saved'), false); assert.equal(f.button('Add finding', 'Front').props.disabled, false);
  f.props.reviewedMemory = { enabled: true, status: 'SAVED' }; f.render();
  assert.equal(f.has('Reviewed examples saved. Evaluation and activation are separate steps.'), true);
  assert.equal(f.nodes(node => node.type === 'button' && text(node) === 'Check example save').length, 0);
  assert.equal(f.nodes(node => node.type === 'button' && text(node) === 'Confirm findings').length, 1);
});

test('feature-disabled props preserve the manual surface and reviewed revisions do not stale same-frame proposals', () => {
  const f = harness(); f.ready(); assert.equal(f.has('ATLAS defect assistance'), false); assert.equal(f.has('Reviewed examples'), false);
  const state = workspace(false), astra = astraFor(state), edited = structuredClone(state);
  edited.sides.FRONT.findingRevision++; edited.sides.FRONT.reviewRevision++;
  assert.equal(presentation.proposalFrameMatches(edited, astra, 'FRONT'), true);
  edited.sides.FRONT.cornerShape = 'ROUNDED_3_18_MM';
  assert.equal(presentation.proposalFrameMatches(edited, astra, 'FRONT'), false);
});

test('one findings confirmation carries the human-reviewed decision; pending memory does not block separate report review', async () => {
  let state = workspace(false);
  for (const side of ['FRONT', 'BACK']) state = actions.markDefectSideInspected(state, { side, base: actions.defectBase(state, side), actor: 'HUMAN', inspected: true }).state;
  let complete, confirmations = 0;
  const f = harness({ workspace: state, reviewedMemory: { enabled: true, status: 'UNSAVED' }, onContinue: async () => {},
    onConfirm: request => { confirmations++; assert.equal(request.reviewed, true); assert.equal(request.actor, 'HUMAN');
      return new Promise(resolve => { complete = () => { f.props.workspace = actions.confirmDefectFindings(state, structuredClone(request)).state;
        f.props.reviewedMemory = { enabled: true, status: 'PENDING' }; resolve(); }; }); } }); f.ready();
  assert.equal(f.has('Confirm findings also saves your reviewed outcomes'), true);
  const click = f.button('Confirm findings').props.onClick, first = click(); await click(); f.render();
  assert.equal(confirmations, 1, 'same-tick repeated clicks cannot duplicate confirmation');
  complete(); await first; f.render(); f.ready();
  assert.equal(f.has('Reviewed examples are pending.'), true);
  assert.equal(f.button('Review draft report').props.disabled, false, 'publication availability does not become report approval authority');
  assert.equal(f.nodes(node => node.type === 'button' && text(node) === 'Confirm findings').length, 0);
});

test('proposal review preserves its current base and sends once when a grader double-clicks before rendering', async () => {
  const state = workspace(false); let finish, reviews = 0;
  const f = harness({ workspace: state, astra: astraFor(state), onReviewProposal: request => { reviews++;
    assert.equal(request.action, 'REJECT'); return new Promise(resolve => { finish = resolve; }); } }); f.ready();
  const click = f.button('Reject suggestion').props.onClick, first = click(); await click(); f.render();
  assert.equal(reviews, 1); finish(); await first; f.render();
  assert.equal(f.has('Unreviewed'), true, 'a callback resolving does not fabricate a stored review disposition');
});

test('reloaded pending example publication can reconcile to saved without replaying confirmation', async () => {
  let confirmations = 0, recoveries = 0;
  const f = harness({ reviewedMemory: { enabled: true, status: 'UNKNOWN' }, onConfirm: async () => { confirmations++; },
    onRetryReviewedMemory: async () => { recoveries++; f.props.reviewedMemory = { enabled: true, status: 'SAVED' }; } }); f.ready();
  assert.equal(f.has('save status of your reviewed examples is not confirmed'), true);
  await f.click('Check example save'); assert.equal(recoveries, 1); assert.equal(confirmations, 0);
  assert.equal(f.has('Reviewed examples saved. Evaluation and activation are separate steps.'), true);
});

test('a saved empty review does not claim that new defect examples were published', () => {
  const f = harness({ reviewedMemory: { enabled: true, status: 'SAVED', exampleCount: 0 } }); f.ready();
  assert.equal(f.has('There were no defect examples to add.'), true);
  assert.equal(f.has('Reviewed examples saved. Evaluation and activation are separate steps.'), false);
});

test('ATLAS image limitations remain visible with an empty proposal list without claiming inspection completion', () => {
  const state = workspace(false), f = harness({ workspace: state, astra: { ...astraFor(state), proposals: [],
    limitations: ['Glare obscures part of the back surface.', 'A fine mark is too small to localize.'] } }); f.ready();
  assert.equal(f.has('ATLAS returned no suggestions. Inspect both sides'), true);
  assert.equal(f.has('Glare obscures part of the back surface.'), true);
  assert.equal(f.nodes(node => node.props?.['aria-label'] === 'ATLAS image limitations').length, 1);
  assert.equal(f.button('Confirm findings').props.disabled, true);
});

test('one deliberate collective confirmation carries only the exact offered scope and cannot silently open an incomplete report', async () => {
  let state = workspace(false);
  for (const side of ['FRONT', 'BACK']) state = actions.markDefectSideInspected(state, { side, base: actions.defectBase(state, side), actor: 'HUMAN', inspected: true }).state;
  state = actions.confirmDefectFindings(state, { base: { FRONT: actions.defectBase(state, 'FRONT'), BACK: actions.defectBase(state, 'BACK') }, actor: 'HUMAN', reviewed: true }).state;
  const before = structuredClone(state), astra = astraFor(state); let complete, confirmations = [];
  astra.proposals.push({ ...astra.proposals[0], id: 'rejected-1', reviewStatus: 'REJECTED' });
  const f = harness({ workspace: state, astra, onContinue: () => assert.fail('unresolved suggestions cannot open report'),
    onConfirm: input => { confirmations.push(input); return new Promise(resolve => { complete = resolve; }); } }); f.ready();
  assert.equal(f.nodes(node => node.type === 'button' && text(node) === 'Review draft report').length, 0);
  assert.equal(f.has('1 suggestions remaining for confirmation · 1 rejected suggestions'), true);
  const click = f.button('Confirm findings & accept 1 suggestions').props.onClick, first = click(); await click();
  assert.equal(confirmations.length, 1); assert.deepEqual(structuredClone(confirmations[0].proposalReview), astra.proposalReview);
  assert.equal(f.calls.length, 0, 'no per-proposal browser mutation loop or analysis');
  assert.deepEqual(state, before, 'the UI does not adopt or measure proposals itself'); complete(); await first; f.render();
  assert.equal(f.nodes(node => node.type === 'button' && text(node) === 'Review draft report').length, 0, 'acknowledgement alone does not invent changed review state');
});

test('collective confirmation requires the current server roster and both inspected images', async () => {
  let state = workspace(false);
  for (const side of ['FRONT', 'BACK']) state = actions.markDefectSideInspected(state, { side, base: actions.defectBase(state, side), actor: 'HUMAN', inspected: true }).state;
  for (const proposalReview of [undefined, { analysisId: 'old', resultHash: 'f'.repeat(64), proposalIds: ['proposal-1'] }, { analysisId: 'analysis-1', resultHash: 'f'.repeat(64), proposalIds: [] }]) {
    const f = harness({ workspace: state, astra: { ...astraFor(state), proposalReview }, onConfirm: () => assert.fail('invalid roster') }); f.ready();
    assert.equal(f.button('Confirm findings & accept 1 suggestions').props.disabled, true);
    await f.button('Confirm findings & accept 1 suggestions').props.onClick();
  }
  const f = harness({ workspace: state, astra: astraFor(state) });
  assert.equal(f.button('Confirm findings & accept 1 suggestions').props.disabled, true); f.ready();
  assert.equal(f.button('Confirm findings & accept 1 suggestions').props.disabled, false);
});

test('saved suggestions stay reviewable when a new provider request is unavailable', async () => {
  const state = workspace(false), f = harness({ workspace: state, astra: { ...astraFor(state), requestAvailable: false } }); f.ready();
  assert.equal(f.button('Find defects with ATLAS').props.disabled, true);
  assert.equal(f.button('Accept suggestion').props.disabled, false);
  await f.click('Reject suggestion'); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].kind, 'proposal');
  assert.equal(f.calls[0].request.action, 'REJECT');
  assert.equal(presentation.collectiveProposalReview(state, f.props.astra).ready, true);
});


test('background acceptance explains ATLAS’s first inspection without asking the human to inspect first', () => {
  const state = workspace(false), f = harness({ workspace: state, astra: { ...astraFor(state, 'RUNNING'), backgroundAccepted: true, proposals: [] } });
  assert.equal(f.has('ATLAS has accepted the card for analysis.'), true);
  assert.equal(f.has('this can take several minutes'), true);
  assert.equal(f.button('Find defects with ATLAS').props.disabled, true);
  assert.equal(f.calls.length, 0);
});

test('exhausted background collection reports uncertainty and does not offer paid replacement', () => {
  const state = workspace(false), f = harness({ workspace: state,
    astra: { ...astraFor(state, 'UNKNOWN'), backgroundAccepted: true, collectionStopped: true, proposals: [] } });
  assert.equal(f.has('automatic checking stopped'), true);
  assert.equal(f.has('Checking the saved request again'), false);
  assert.equal(f.has('Start a new ATLAS analysis'), false);
  assert.equal(f.button('Find defects with ATLAS').props.disabled, true);
  assert.equal(f.calls.length, 0);
});

test('a retained unknown needs an explicit new-analysis click and verified current images', async () => {
  const state = workspace(false), calls = [], f = harness({ workspace: state,
    astra: { ...astraFor(state, 'UNKNOWN'), proposals: [], replacement: { analysisId: 'analysis-1', outcomeHash: 'a'.repeat(64) } },
    onReplaceAnalysis: async input => calls.push(input) });
  assert.equal(f.button('Start a new ATLAS analysis').props.disabled, true); assert.equal(calls.length, 0);
  f.ready(); await f.click('Start a new ATLAS analysis');
  assert.equal(calls.length, 1); assert.deepEqual(calls[0].base.FRONT, actions.defectBase(state, 'FRONT'));
  assert.equal(f.calls.length, 0, 'the ordinary start callback is never used for replacement');
});

test('accepted background work offers no replacement and a manual trace blocks replacing old unknown work', async () => {
  const state = workspace(false), astra = { ...astraFor(state, 'UNKNOWN'), proposals: [], replacement: { analysisId: 'analysis-1', outcomeHash: 'a'.repeat(64) } };
  const accepted = harness({ workspace: state, astra: { ...astra, backgroundAccepted: true }, onReplaceAnalysis: async () => assert.fail() });
  assert.equal(accepted.has('Start a new ATLAS analysis'), false);
  const editable = harness({ workspace: state, astra, onReplaceAnalysis: async () => assert.fail() }); editable.ready();
  await editable.click('Add finding', 'Front');
  assert.equal(editable.button('Start a new ATLAS analysis').props.disabled, true);
});

test('a durably refused concurrent action offers status recovery without another paid start', async () => {
  const state = workspace(false); let refreshes = 0;
  const f = harness({ workspace: state, astra: { ...astraFor(state, 'REFUSED'), proposals: [], followLatest: true },
    onRefreshAnalysis: async () => { refreshes++; } }); f.ready();
  assert.equal(f.button('Find defects with ATLAS').props.disabled, true);
  assert.equal(f.button('Check analysis status').props.disabled, false);
  await f.click('Check analysis status');
  assert.equal(refreshes, 1); assert.equal(f.calls.length, 0);
});

test('Inspect suggestion and finding focus the view without accepting, measuring, inspecting or saving', async () => {
  const state = workspace(true), before = structuredClone(state), f = harness({ workspace: state, astra: astraFor(state) });
  assert.equal(f.control('Inspect Front suggestion 1').props.disabled, true);
  f.ready(); await f.clickControl('Inspect Front suggestion 1');
  assert.ok(f.control('Front defect zoom').props.value > 1);
  assert.equal(f.has('Inspecting Front suggestion 1'), true);
  assert.equal(f.nodes(node => node.type === 'polygon' && node.props.className === 'ad-proposal-active').length, 1);
  await f.clickControl('Inspect Front finding 1');
  assert.equal(f.has('Inspecting Front finding 1'), true);
  assert.equal(f.calls.length, 0); assert.deepEqual(f.props.workspace, before);
  assert.equal(f.button('Confirm findings & accept 1 suggestions').props.disabled, true);
});

test('padding clicks never draw and a scaled padded image saves the independently expected canonical pixels', async () => {
  const f = harness(); f.ready(); await f.click('Add finding', 'Front');
  f.imageRect = { left: 100, top: 200, width: 675, height: 929 };
  const plane = () => f.nodes(node => node.props.className === 'ad-plane', 'Front')[0];
  const down = (x, y) => plane().props.onPointerDown({ clientX: x, clientY: y, button: 0, pointerId: 1, preventDefault() {}, currentTarget: plane().props.ref.current });
  down(110, 664.5); plane().props.onPointerMove({ clientX: 118, clientY: 680 }); plane().props.onPointerUp(); f.render();
  assert.equal(f.button('Save trace', 'Front').props.disabled, true, 'outside left card edge remains blank');
  down(437.5, 664.5); plane().props.onPointerMove({ clientX: 442.5, clientY: 664.5 }); plane().props.onPointerUp(); f.render();
  await f.click('Save trace', 'Front');
  const pixels = traceWire.decodeSpeedsterTraceBitmapWireV1(f.calls[0].request.action.trace.traceWire);
  assert.equal(pixels[889 * 1270 + 635], 1, 'padded image midpoint maps to canonical635,889');
  assert.equal(pixels[889 * 1270], 0, 'margin click did not clamp to left card edge');
  assert.equal(pixels[664 * 1270 + 437], 0, 'screen coordinates were not stored as canonical pixels');
  assert.equal(f.calls.length, 1);
});

test('focus, zoom, overlay visibility and expanded side switching preserve both unsaved traces', async () => {
  const state = workspace(false), f = harness({ workspace: state, astra: astraFor(state) }); f.ready();
  await f.click('Add finding', 'Front'); f.draw('Front');
  await f.click('Add finding', 'Back'); f.draw('Back');
  f.select('Front defect zoom', 16); f.check('Hide overlays', true, 'Front');
  await f.clickControl('Inspect Front suggestion 1');
  await f.clickControl('Expand Front inspection'); assert.equal(f.side('Back').props.hidden, true);
  await f.click('Inspect Back'); assert.equal(f.side('Front').props.hidden, true);
  assert.equal(f.button('Save trace', 'Back').props.disabled, false);
  await f.click('Inspect Front'); await f.clickControl('Return to paired inspection', 'Front');
  f.props.astra = { ...f.props.astra, knowledgeRevision: 77 }; f.render();
  assert.equal(f.side('Back').props.hidden, false); assert.equal(f.calls.length, 0);
  await f.click('Save trace', 'Front'); await f.click('Save trace', 'Back');
  assert.equal(f.calls.length, 2);
  for (const { request } of f.calls) {
    const pixels = traceWire.decodeSpeedsterTraceBitmapWireV1(request.action.trace.traceWire);
    assert.equal(pixels[660 * 1270 + 660], 1);
    assert.equal(pixels[365 * 1270 + 265], 0, 'focusing never substitutes ATLAS contour pixels');
  }
});

test('actual resize effects retain the focused target through expansion, hidden sides and return', async () => {
  const state = workspace(false), f = harness({ workspace: state, astra: astraFor(state) }); f.ready();
  await f.clickControl('Inspect Front suggestion 1');
  const beforeZoom = f.control('Front defect zoom').props.value;
  const centered = () => {
    const style = f.nodes(node => node.props.className === 'ad-plane', 'Front')[0].props.style;
    const [, px, py] = style.transform.match(/translate\(([-\d.]+)px,([-\d.]+)px\)/);
    const x = Number(px) + style.width * ((40 + .21 * 1270) / 1350 - .5);
    const y = Number(py) + style.height * ((40 + .21 * 1778) / 1858 - .5);
    assert.ok(Math.abs(x) < .00001 && Math.abs(y) < .00001, `focused target offset ${x},${y}`);
    assert.doesNotMatch(style.transform, /scale\(/, 'SVG non-scaling strokes have no scaled CSS ancestor');
  };
  centered(); await f.clickControl('Expand Front inspection'); f.resize('Front', 1000, 780); centered();
  assert.equal(f.control('Front defect zoom').props.value, beforeZoom);
  await f.click('Inspect Back'); f.resize('Front', 0, 0); centered();
  await f.click('Inspect Front'); f.resize('Front', 1000, 780); centered();
  await f.clickControl('Return to paired inspection', 'Front'); f.resize('Front', 400, 560); centered();
  assert.equal(f.calls.length, 0);
});

test('resize cancels only the current pointer gesture and retains completed unsaved trace pixels', async () => {
  const f = harness(); f.ready(); await f.click('Add finding', 'Front'); f.draw();
  const plane = () => f.nodes(node => node.props.className === 'ad-plane', 'Front')[0];
  plane().props.onPointerDown({ clientX: 850, clientY: 850, button: 0, pointerId: 1, preventDefault() {}, currentTarget: plane().props.ref.current });
  plane().props.onPointerMove({ clientX: 880, clientY: 880 }); f.render();
  f.resize('Front', 1000, 780); plane().props.onPointerUp(); f.render();
  await f.click('Save trace', 'Front');
  const pixels = traceWire.decodeSpeedsterTraceBitmapWireV1(f.calls[0].request.action.trace.traceWire);
  assert.equal(pixels[660 * 1270 + 660], 1);
  assert.equal(pixels[860 * 1270 + 860], 0, 'unfinished stroke across a layout change is not invented');
  assert.equal(f.calls.length, 1);
});

test('keyboard, wheel, temporary overlay hiding and image-only magnifier are display-only', async () => {
  const state = workspace(false), f = harness({ workspace: state, astra: astraFor(state) }); f.ready();
  f.key('+'); assert.equal(f.control('Front defect zoom').props.value, 1.5);
  f.key('ArrowRight');
  assert.match(f.nodes(node => node.props.className === 'ad-plane', 'Front')[0].props.style.transform, /translate\(-[0-9.]+px,0px\)/);
  f.key('h'); assert.equal(f.nodes(node => node.type === 'polygon').length, 0);
  f.key('h', 'Front', 'onKeyUp'); assert.equal(f.nodes(node => node.type === 'polygon').length, 1);
  const viewport = f.control('Front image inspection').props.ref.current, wheel = viewport.listeners.get('wheel'); assert.equal(typeof wheel, 'function');
  wheel({ clientX: 200, clientY: 280, deltaY: -100, deltaMode: 0, preventDefault() {} }); f.render();
  assert.ok(f.control('Front defect zoom').props.value > 1.5);
  f.check('3× magnifier', true, 'Front');
  const plane = f.nodes(node => node.props.className === 'ad-plane', 'Front')[0]; plane.props.onPointerMove({ clientX: 100, clientY: 200 }); f.render();
  const lens = f.nodes(node => node.props.className === 'ad-magnifier', 'Front')[0]; assert.ok(lens);
  assert.equal(lens.props.style.backgroundImage, 'url("blob:FRONT")');
  assert.equal(lens.props.style.backgroundSize, '4050px 5574px');
  assert.equal(lens.props.style.backgroundPosition, '-320px -620px');
  f.key('Home'); assert.equal(f.control('Front defect zoom').props.value, 1);
  assert.equal(f.nodes(node => node.props.className === 'ad-magnifier').length, 0);
  assert.equal(f.calls.length, 0);
});

test('Pan image and held Space move the view without adding pixels to an active trace', async () => {
  const f = harness(); f.ready(); await f.click('Add finding', 'Front'); f.select('Front defect zoom', 4);
  const drag = () => { const plane = f.nodes(node => node.props.className === 'ad-plane', 'Front')[0];
    plane.props.onPointerDown({ clientX: 650, clientY: 650, button: 0, pointerId: 1, preventDefault() {}, currentTarget: plane.props.ref.current });
    plane.props.onPointerMove({ clientX: 680, clientY: 680 }); plane.props.onPointerUp(); f.render(); };
  await f.click('Pan image', 'Front'); drag(); assert.equal(f.button('Save trace', 'Front').props.disabled, true);
  await f.click('Pan image', 'Front'); f.key(' '); drag(); f.key(' ', 'Front', 'onKeyUp');
  assert.equal(f.button('Save trace', 'Front').props.disabled, true);
  f.draw(); assert.equal(f.button('Save trace', 'Front').props.disabled, false);
  assert.equal(f.calls.length, 0);
});

test('retained old-frame removed observation cannot inspect or restore stale coordinates and explains how to retrace',async()=>{
  const state=structuredClone(workspace()),slot=state.sides.FRONT,finding=slot.findings[0];
  finding.reviewResult='REMOVED';finding.reviewResultBeforeRemoval='UNREVIEWED';finding.finalTrace=finding.detectorMask;finding.measurementRegions=[];delete finding.zone;delete finding.measurement;delete finding.canonicalContour;
  finding.traceProvenance={version:'speedster-trace-provenance-v1',sourceViewId:finding.sourceViewId,
    cropTransform:{version:'speedster-canonical-crop-affine-v1',crop:{x:0,y:0,width:1269,height:1777}},highlighterStrokes:[],finalTraceSha256:finding.finalTrace.sha256};
  const sourceImage={version:1,originalSha256:slot.frame.originalSha256,frameId:'working-FRONT',frameSha256:'a'.repeat(64),width:1600,height:2400,coordinateSpace:'ORIENTED_DECODED'};
  const sourceQuad=[{x:.125,y:.1},{x:.875,y:.1},{x:.875,y:.9},{x:.125,y:.9}],sx=1269/1200,sy=1777/1920;
  const sourceFrame={id:slot.frame.frameId,version:1,rectified:{sha256:slot.frame.rectifiedImageSha256,width:1270,height:1778},
    inspection:{sha256:slot.frame.inspectionImageSha256,width:1350,height:1858,cardBounds:{x:40,y:40,width:1270,height:1778}},sourceToRectified:[sx,0,-200*sx,0,sy,-240*sy,0,0,1]};
  finding.geometryExclusion={version:'atlas-geometry-exclusion-v1',reason:'TRACE_OUTSIDE_CORRECTED_CARD',sourceImage,sourceQuad,sourceFrame,sourceTraceSha256:finding.finalTrace.sha256};
  slot.humanEditedIds=[finding.id];slot.frame.preparationVersion=2;slot.frame.frameId='corrected-FRONT';const f=harness({workspace:state});f.ready();
  assert.equal(f.has('Removed · retained in previous image frame'),true);
  assert.equal(f.control('Inspect Front finding 1').props.disabled,true);f.control('Inspect Front finding 1').props.onClick();f.render();
  const choose=f.nodes(node=>node.type==='button'&&node.props.className==='ad-finding-name','Front')[0];choose.props.onClick();f.render();
  assert.equal(f.has('Add a new trace to restore this finding on the current photograph'),true);
  assert.equal(f.button('Restore finding','Front').props.disabled,true);await f.button('Restore finding','Front').props.onClick();
  assert.equal(f.calls.length,0);
  f.props.focusedReview={side:'FRONT',findingId:finding.id,renderActions:()=>null,onApprove:async()=>{}};f.render();f.ready();
  assert.equal(all(f.control('Selected finding measurements','Front'),n=>n.type==='dt'&&text(n)==='Region bounds').length,0,'old-frame observations do not claim current calibrated bounds');
});
test('saved examples distinguish retained old-frame observations without offering a publication retry',()=>{
  const memory=presentation.reviewedMemoryState({enabled:true,status:'SAVED',exampleCount:2,retainedObservationCount:1});
  assert.equal(memory.mayRecover,false);assert.match(memory.message,/Reviewed examples saved/);assert.match(memory.message,/1 original-frame observation remains retained and was not added as current-frame lessons/);
});


test('one visible attestation requires both verified photos and persists both sides before confirmation',async()=>{
 const f=harness();let resolve,calls=0;
 f.props.onInspectBoth=()=>{calls++;return new Promise(done=>{resolve=done;});};f.render();
 const label='I inspected both Front and Back';
 assert.equal(f.nodes(n=>n.type==='input'&&n.props['aria-label']?.startsWith('I inspected')).length,1);
 assert.equal(f.control(label).props.disabled,true);await f.control(label).props.onChange();assert.equal(calls,0);
 f.ready();assert.equal(f.control(label).props.disabled,false);
 const pending=f.control(label).props.onChange();await f.control(label).props.onChange();f.render();assert.equal(calls,1);assert.equal(f.button('Confirming…').props.disabled,true);
 let state=f.props.workspace;for(const side of ['FRONT','BACK'])state=actions.markDefectSideInspected(state,{side,base:actions.defectBase(state,side),actor:'HUMAN',inspected:true}).state;
 f.props.workspace=state;resolve();await pending;f.render();
 assert.equal(f.control(label).props.checked,true);assert.equal(f.button('Confirm findings').props.disabled,false);
 f.props.workspace=workspace(false);f.props.onInspectBoth=async()=>{throw Error('save failed');};f.render();f.ready();await f.control(label).props.onChange();f.render();
 assert.equal(f.control(label).props.checked,false);assert.equal(f.button('Confirm findings').props.disabled,true);assert.ok(f.has('Inspection was not saved for both sides'));
});

test('read-only review keeps inspection available while every mutation stays disabled', async () => {
  const state=workspace(),f=harness({workspace:state,readOnly:true,astra:astraFor(state),onReviewFinding:async()=>{throw Error('must not save');}});
  f.ready();assert.equal(f.has('Read-only review.'),true);
  assert.equal(f.button('Add finding','Front').props.disabled,true);
  assert.equal(f.button('Find defects with ATLAS').props.disabled,true);
  const inspection=f.control('I inspected both Front and Back');assert.equal(inspection.props.disabled,true);
  await inspection.props.onChange();assert.equal(f.calls.length,0,'handler also guards programmatic invocation');
  await f.clickControl('Inspect Front finding 1');
  assert.equal(f.button('Edit trace','Front').props.disabled,true);assert.equal(f.button('Reject finding','Front').props.disabled,true);
  assert.equal(f.button('Accept finding','Front').props.disabled,true);
});

test('learning lifecycle names saved feedback, preparation, holds and activation separately',()=>{
  for(const [stage,activation,expected] of [['QUEUED','INACTIVE','Preparing examples'],['RUNNING','INACTIVE','Preparing examples'],['PREPARED','INACTIVE','Prepared for evaluation'],['HELD','INACTIVE','held'],['PREPARED','ACTIVE','Active lesson']]) {
    const value=presentation.reviewedMemoryState({enabled:true,status:'SAVED',feedbackStatus:'SAVED',preparationStatus:stage,activationStatus:activation,exampleCount:2});
    assert.ok(value.message.toLowerCase().includes(expected.toLowerCase()),value.message);
    if(activation!=='ACTIVE')assert.equal(value.message.includes('Active lesson'),false);
  }
});
test('held learning gives the required human or operator action without offering an ineffective retry',()=>{
  for(const code of ['MANUAL_MACHINE_ACCESS_REVOKED','MEMORY_HISTORICAL_AUTHORITY_REQUIRED','MEMORY_EVIDENCE_INVALID']) {
    const memory={enabled:true,status:'PENDING',feedbackStatus:'SAVED',preparationStatus:'HELD',activationStatus:'INACTIVE',code};
    const value=presentation.reviewedMemoryState(memory);
    assert.equal(value.mayRecover,false);
    assert.ok(value.message.includes(code==='MEMORY_EVIDENCE_INVALID'?'operator must inspect':'authorized reviewer must review and confirm'));
    const f=harness({reviewedMemory:memory,onRetryReviewedMemory:async()=>{throw Error('Held work cannot be blindly retried');}});
    assert.equal(f.has('Retry saving examples'),false);
    assert.equal(f.has('Feedback saved'),true);
  }
});


const focusedActions = options => ({type:'button',props:{children:'Approve',disabled:options.disabled,onClick:options.approve}});
test('focused finding edit uses one Approve to save exact trace then review, with no extra Save or attestation',async()=>{
 const state=workspace(),id=state.sides.FRONT.findings[0].id,calls=[];
 const f=harness({workspace:state,focusedReview:{side:'FRONT',findingId:id,renderActions:focusedActions,onApprove:async value=>calls.push({type:'approve',value})},onEdit:async value=>calls.push({type:'save',value})});
 assert.equal(f.button('Approve').props.disabled,true);f.ready();
 assert.equal(f.nodes(n=>n.type==='input'&&n.props['aria-label']==='I inspected both Front and Back').length,0);
 await f.click('Edit trace','Front');assert.equal(f.nodes(n=>n.type==='button'&&text(n)==='Save trace').length,0);
 assert.equal(calls.length,0);await f.click('Approve');
 assert.deepEqual(calls.map(value=>value.type),['save','approve']);assert.equal(calls[0].value.action.findingId,id);assert.equal(calls[1].value.findingId,id);
 assert.deepEqual(JSON.parse(JSON.stringify(calls[1].value.inspectionHashes)),Object.fromEntries(['FRONT','BACK'].map(side=>[side,state.sides[side].frame.inspectionImageSha256])));
 assert.equal(f.has('Unsaved trace'),false);
});
test('focused failed save retains the draft and cannot accept; retry runs one save and one approval',async()=>{
 let fails=true,approvals=0,saves=0;
 const f=harness({focusedReview:{side:'FRONT',findingId:null,renderActions:focusedActions,onApprove:async()=>{approvals++;}},onEdit:async()=>{saves++;if(fails)throw Error('offline');}});f.ready();
 await f.click('Add finding','Front');assert.equal(f.button('Approve').props.disabled,true);f.draw();
 await f.click('Approve');assert.equal(approvals,0);assert.equal(f.has('Unsaved trace'),true);assert.equal(f.has('Your current work is retained'),true);
 fails=false;await f.click('Approve');assert.equal(saves,2);assert.equal(approvals,1);assert.equal(f.has('Unsaved trace'),false);
});
test('focused Add returns to the unchanged next finding selected by its parent after approving the new trace',async()=>{
 const state=workspace(),original=state.sides.FRONT.findings[0],approvals=[];
 const f=harness({workspace:state,focusedReview:{side:'FRONT',findingId:original.id,renderActions:focusedActions,
   onApprove:async value=>{approvals.push(value.findingId);f.props.focusedReview={...f.props.focusedReview,findingId:original.id};}},
   onEdit:async input=>{const saved=structuredClone(f.props.workspace);saved.sides.FRONT.findings.push({...structuredClone(original),id:input.action.trace.id});f.props.workspace=saved;}});
 f.ready();await f.click('Add finding','Front');f.draw();await f.click('Approve');
 assert.equal(approvals.length,1);assert.notEqual(approvals[0],original.id,'the new trace was explicitly approved');
 await f.click('Approve');
 assert.equal(approvals[1],original.id,'the next approval follows the parent selection, even when its ID did not change');
});
test('focused browsing to another finding changes focus without saving; missing Back evidence blocks approval',async()=>{
 const state=workspace(),f=harness({workspace:state,focusedReview:{side:'FRONT',findingId:state.sides.FRONT.findings[0].id,renderActions:focusedActions,onApprove:async()=>{throw Error('must not approve');}}});f.ready();
 f.props.focusedReview={...f.props.focusedReview,side:'BACK',findingId:state.sides.BACK.findings[0].id};f.render();
 assert.equal(f.side('Front').props.hidden,true);assert.equal(f.side('Back').props.hidden,false);assert.equal(f.calls.length,0);
 f.props.images={...f.props.images,BACK:{inspection:{url:'blob:wrong',sha256:'0'.repeat(64)}}};f.render();
 assert.equal(f.button('Approve','Back').props.disabled,true);await f.button('Approve','Back').props.onClick();assert.equal(f.calls.length,0);
});

test('focused measurement failure retries the exact saved trace without resending the edit or approving early',async()=>{
 let saves=0,retries=0,approvals=0;
 const f=harness({focusedReview:{side:'FRONT',findingId:null,renderActions:focusedActions,onApprove:async()=>{approvals++;}},onRetry:async()=>{retries++;},onEdit:async input=>{saves++;f.props.workspace=actions.beginDefectEdit(f.props.workspace,JSON.parse(JSON.stringify(input))).state;throw Error('measurement held');}});f.ready();
 await f.click('Add finding','Front');f.draw();await f.click('Approve');assert.equal(approvals,0);assert.equal(saves,1);
 assert.ok(f.props.workspace.sides.FRONT.pending,'trace was saved before measurement failed');f.ready();await f.click('Approve');assert.equal(retries,1);assert.equal(saves,1);assert.equal(approvals,1);assert.equal(f.has('Unsaved trace'),false);
});


test('focused selected trace uses its true raster boundary and clean view shares the exact camera and image',async()=>{
 const state=workspace(),id=state.sides.FRONT.findings[0].id;
 const f=harness({workspace:state,focusedReview:{side:'FRONT',findingId:id,renderActions:focusedActions,onApprove:async()=>{}}});f.ready();
 assert.equal(f.nodes(n=>n.props?.className==='ad-exact-outline','Front').length,1);
 assert.equal(f.nodes(n=>n.props?.className==='ad-selected-callout','Front').length,1);
 const marked=()=>f.nodes(n=>n.props?.className==='ad-plane','Front')[0];
 const initial=JSON.stringify(marked().props.style);
 await f.click('Clean photo','Front');assert.equal(f.nodes(n=>n.props?.className==='ad-exact-outline','Front').length,0);assert.equal(JSON.stringify(marked().props.style),initial);
 await f.click('Marked photo','Front');await f.click('Compare','Front');
 const clean=f.nodes(n=>n.props?.className==='ad-plane ad-clean-plane','Front')[0];assert.deepEqual(clean.props.style,marked().props.style);
 assert.equal(f.nodes(n=>n.type==='img'&&n.props.alt==='Front clean inspection image','Front')[0].props.src,f.nodes(n=>n.type==='img'&&n.props.alt==='Front inspection image','Front')[0].props.src);
 assert.equal(f.calls.length,0);
});
test('focused navigation is explicit and bounded and locks during a local trace',async()=>{
 const state=workspace(),ids=['FRONT','BACK'].map(side=>state.sides[side].findings[0].id),calls=[];
 const f=harness({workspace:state,focusedReview:{side:'FRONT',findingId:ids[0],renderActions:focusedActions,onApprove:async()=>{},navigation:{index:0,total:2,items:ids.map((id,i)=>({id,side:i?'BACK':'FRONT',label:'Finding '+(i+1)})),onPrevious:()=>calls.push('previous'),onNext:()=>calls.push('next'),onSelect:id=>calls.push(id)}}});f.ready();
 assert.equal(f.button('Previous finding').props.disabled,true);await f.button('Previous finding').props.onClick();assert.deepEqual(calls,[]);
 await f.click('Next finding');assert.deepEqual(calls,['next']);assert.equal(f.calls.length,0);
 await f.click('Edit trace','Front');assert.equal(f.button('Next finding').props.disabled,true);await f.button('Next finding').props.onClick();assert.deepEqual(calls,['next']);
 await f.click('Cancel trace','Front');f.props.focusedReview.navigation={...f.props.focusedReview.navigation,index:1};f.render();assert.equal(f.button('Next finding').props.disabled,true);
});

test('focused red outline equals the saved mask pixel boundary, including holes and disconnected islands',()=>{
 const state=workspace(),finding=state.sides.FRONT.findings[0],before=JSON.stringify(state);
 const f=harness({workspace:state,focusedReview:{side:'FRONT',findingId:finding.id,renderActions:focusedActions,onApprove:async()=>{}}});f.ready();
 const outline=f.nodes(n=>n.props?.className==='ad-exact-outline','Front')[0];assert.equal(outline.props.viewBox,'0 0 1270 1778');
 const path=all(outline,n=>n.type==='path')[0].props.d,actual=new Set(),expected=new Set();
 for(const part of path.matchAll(/M(\d+) (\d+)([HV])(\d+)/g)){const x=Number(part[1]),y=Number(part[2]),axis=part[3],end=Number(part[4]);
  for(let n=axis==='H'?x:y;n<end;n++)actual.add(axis==='H'?`H:${n}:${y}`:`V:${x}:${n}`);
 }
 const pixels=traceCodec.decodeSpeedsterTraceRleV1(finding.finalTrace??finding.detectorMask);
 for(let y=0;y<1778;y++)for(let x=0;x<1270;x++)if(pixels[y*1270+x]){
  if(x===0||!pixels[y*1270+x-1])expected.add(`V:${x}:${y}`);
  if(x===1269||!pixels[y*1270+x+1])expected.add(`V:${x+1}:${y}`);
  if(y===0||!pixels[(y-1)*1270+x])expected.add(`H:${x}:${y}`);
  if(y===1777||!pixels[(y+1)*1270+x])expected.add(`H:${x}:${y+1}`);
 }
 assert.ok(actual.size>0);assert.deepEqual([...actual].sort(),[...expected].sort());assert.equal(JSON.stringify(state),before);assert.equal(f.calls.length,0);
});

test('desktop comparison shares camera through zoom and resize and disappears when the exact image binding fails',()=>{
 const state=workspace(),id=state.sides.FRONT.findings[0].id;
 const f=harness({workspace:state,focusedReview:{side:'FRONT',findingId:id,renderActions:focusedActions,onApprove:async()=>{}}},{matchMedia:query=>({matches:query.includes('min-width')})});f.ready();
 assert.ok(f.button('Single view','Front'));f.select('Front defect zoom',4,'Front');f.resize('Front',300,420);
 const marked=f.nodes(n=>n.props?.className==='ad-plane','Front')[0],clean=f.nodes(n=>n.props?.className==='ad-plane ad-clean-plane','Front')[0];assert.deepEqual(clean.props.style,marked.props.style);
 f.props.images={...f.props.images,FRONT:{inspection:{url:'blob:wrong',sha256:'0'.repeat(64)}}};f.render();
 assert.equal(f.nodes(n=>n.type==='img'&&n.props.alt==='Front clean inspection image','Front').length,0);assert.equal(f.nodes(n=>n.props?.className==='ad-exact-outline','Front').length,0);assert.equal(f.button('Approve','Front').props.disabled,true);assert.equal(f.calls.length,0);
});

test('focused selected readout keeps one direct Add/Edit/Reject row and moves type changes into Tools without saving on open',async()=>{
 const state=workspace(),id=state.sides.FRONT.findings[0].id;
 const f=harness({workspace:state,focusedReview:{side:'FRONT',findingId:id,renderActions:focusedActions,onApprove:async()=>{}}});f.ready();
 const panel=f.nodes(n=>n.props?.className==='ad-review-panel','Front')[0];
 const summary=all(panel,n=>n.props?.['aria-label']==='Selected finding measurements')[0];
 const row=all(summary,n=>n.props?.className==='am-side-actions ad-focused-finding-actions')[0];
 assert.deepEqual(all(row,n=>n.type==='button').map(text),['Add finding','Edit trace','Reject finding']);
 for(const label of ['Add finding','Edit trace','Reject finding'])assert.equal(all(panel,n=>n.type==='button'&&text(n)===label).length,1);
 assert.equal(all(panel,n=>n.type==='select'&&n.props['aria-label']==='Front finding type').length,0);
 const tools=f.nodes(n=>n.type==='details'&&n.props.className==='ad-focused-tools','Front')[0];
 assert.equal(all(tools,n=>n.type==='select'&&n.props['aria-label']==='Front finding type').length,1);
 assert.equal(f.calls.length,0);await f.click('Edit trace','Front');await f.click('Cancel trace','Front');assert.equal(f.calls.length,0);
 const type=f.control('Front finding type');await type.props.onChange({target:{value:'VISIBLE_WHITENING'}});f.render();
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].request.action.type,'CHANGE_TYPE');assert.equal(f.calls[0].request.action.defectId,id);
 const ordinary=harness({workspace:state});ordinary.ready();await ordinary.clickControl('Inspect Front finding 1');
 const ordinaryPanel=ordinary.nodes(n=>n.props?.className==='ad-review-panel','Front')[0];
 assert.equal(all(ordinaryPanel,n=>n.type==='select'&&n.props['aria-label']==='Front finding type').length,1,'ordinary review retains its direct type control');
});

test('focused region bounds use saved calibrated mask extents while area remains measured and draft values are labelled Saved',async()=>{
 const state=workspace(),finding=state.sides.FRONT.findings[0];
 const f=harness({workspace:state,focusedReview:{side:'FRONT',findingId:finding.id,renderActions:focusedActions,onApprove:async()=>{}}});f.ready();
 const pixels=traceCodec.decodeSpeedsterTraceRleV1(finding.finalTrace??finding.detectorMask);
 let left=1270,top=1778,right=0,bottom=0;
 for(let y=0;y<1778;y++)for(let x=0;x<1270;x++)if(pixels[y*1270+x]){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1);}
 const expected=`${((right-left)/20).toLocaleString('en-US',{maximumFractionDigits:3})} × ${((bottom-top)/20).toLocaleString('en-US',{maximumFractionDigits:3})} mm`;
 const value=label=>{const summary=f.control('Selected finding measurements','Front');const pair=all(summary,n=>n.type==='div'&&all(n,c=>c.type==='dt'&&text(c)===label).length)[0];assert.ok(pair,label);return text(all(pair,n=>n.type==='dd')[0]);};
 const area=(finding.measurementRegions??[{measurement:finding.measurement}]).reduce((sum,r)=>sum+r.measurement.areaMm2,0).toLocaleString('en-US',{maximumFractionDigits:6})+' mm²';
 assert.equal(value('Region bounds'),expected);assert.equal(value('Measured area'),area);
 await f.click('Edit trace','Front');f.draw();assert.equal(value('Saved region bounds'),expected);assert.equal(value('Saved area'),area);
 assert.ok(all(f.control('Selected finding measurements','Front'),n=>n.type==='dt').every(n=>text(n).startsWith('Saved')));
 await f.click('Cancel trace','Front');f.props.workspace=actions.beginDefectEdit(state,{side:'FRONT',base:actions.defectBase(state,'FRONT'),actor:'HUMAN',action:{type:'CHANGE_TYPE',defectId:finding.id,defectType:'VISIBLE_WHITENING'}}).state;f.render();
 assert.equal(value('Saved region bounds'),expected);assert.equal(value('Saved area'),area);assert.equal(f.button('Edit trace','Front').props.disabled,true);
});
