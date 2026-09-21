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
    proposals: [{ id: 'proposal-1', side: 'FRONT', defectType: 'LIGHT_SCRATCH_SCUFF', reviewStatus: 'UNREVIEWED',
      canonicalContour: [{ x: .2, y: .2 }, { x: .22, y: .2 }, { x: .22, y: .22 }, { x: .2, y: .22 }],
      observation: 'Possible short scratch.', uncertainty: 'May be a printed line.' }] };
}
function harness(initial = {}) {
  const instances = new Map(); let current, cursor, dirty, effects = [], tree;
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
  vm.runInNewContext(compiled, { exports, crypto: { randomUUID }, require(name) {
    if (name === 'react') return react;
    if (name === '@atlas/grading-core/trace-codec') return traceCodec;
    if (name === '@atlas/grading-core/trace-bitmap-wire') return traceWire;
    if (name === '@atlas/grading-core/trace-editor') return traceEditor;
    if (name === './defect-actions.mjs') return actions;
    if (name === './astra-review-ui.mjs') return presentation;
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
    if (node.props?.ref && node.props.className === 'ad-plane') node.props.ref.current = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1270, height: 1778 }) };
    return { ...node, props: { ...node.props, children: expand(node.props.children, `${path}.children`) } };
  }
  const state = workspace(false);
  const f = { calls: [], props: { workspace: state,
    images: Object.fromEntries(['FRONT', 'BACK'].map(side => [side, { inspection: { url: `blob:${side}`, sha256: state.sides[side].frame.inspectionImageSha256 } }])),
    onEdit: async request => f.calls.push({ kind: 'edit', request }), onInspect: async () => {}, onConfirm: async () => {},
    onReviewProposal: async request => f.calls.push({ kind: 'proposal', request }), onAnalyzeDefects: async request => f.calls.push({ kind: 'analyze', request }),
    ...initial } };
  f.render = () => { let count = 0; do { dirty = false; tree = expand({ type: exports.DefectReviewWorkspace, props: f.props }); const pending = effects; effects = []; pending.forEach(run => run());
    assert.ok(++count < 20, 'effects settled'); } while (dirty); return tree; };
  f.nodes = (predicate, side) => all(side ? f.side(side) : tree, predicate);
  f.side = side => all(tree, node => node.type === 'section' && node.props['aria-label'] === `${side} defects`)[0];
  f.button = (label, side) => { const hit = f.nodes(node => node.type === 'button' && text(node) === label, side)[0]; assert.ok(hit, label); return hit; };
  f.click = async (label, side) => { const hit = f.button(label, side); assert.equal(Boolean(hit.props.disabled), false, `${label} enabled`); await hit.props.onClick(); f.render(); };
  f.has = label => text(tree).includes(label);
  f.ready = () => { f.nodes(node => node.type === 'img').forEach(node => node.props.onLoad({ currentTarget: { naturalWidth: 1350, naturalHeight: 1858 } })); f.render(); };
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
  assert.equal(f.nodes(node => node.type === 'section' && node.props['aria-label'] === 'Front Astra suggestions').length, 1);
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
    assert.equal(f.has('Astra returned no suggestions.'), false, status);
    if (['RUNNING', 'UNKNOWN', 'UNRECOGNIZED'].includes(status)) assert.equal(f.button('Find defects with Astra').props.disabled, true);
  }
});

test('an uncertain request reply requires status reconciliation; no local success or blind retry is fabricated', async () => {
  const state = workspace(false), f = harness({ workspace: state, astra: { ...astraFor(state, 'IDLE'), proposals: [] },
    onAnalyzeDefects: async () => { throw Error('lost response'); }, onRefreshAnalysis: async () => {} }); f.ready();
  await f.click('Find defects with Astra'); assert.equal(f.button('Find defects with Astra').props.disabled, true);
  assert.equal(f.has('No analysis result has been received'), true); assert.equal(f.button('Add finding', 'Front').props.disabled, false);
  f.props.astra = { ...f.props.astra, status: 'REFUSED' }; f.render();
  assert.equal(f.button('Find defects with Astra').props.disabled, false);
});

test('pending reviewed memory survives recovery without a fabricated saved state or extra grading confirmation', async () => {
  const f = harness({ reviewedMemory: { enabled: true, status: 'PENDING' }, onRetryReviewedMemory: async () => { throw Error('lost acknowledgement'); } }); f.ready();
  assert.equal(f.has('Reviewed examples are pending.'), true); assert.equal(f.has('Reviewed examples saved'), false);
  await f.click('Check example save'); assert.equal(f.has('Reviewed examples are pending.'), true);
  assert.equal(f.has('Reviewed examples saved'), false); assert.equal(f.button('Add finding', 'Front').props.disabled, false);
  f.props.reviewedMemory = { enabled: true, status: 'SAVED' }; f.render();
  assert.equal(f.has('Reviewed examples saved and available'), true);
  assert.equal(f.nodes(node => node.type === 'button' && text(node) === 'Check example save').length, 0);
  assert.equal(f.nodes(node => node.type === 'button' && text(node) === 'Confirm findings').length, 1);
});

test('feature-disabled props preserve the manual surface and reviewed revisions do not stale same-frame proposals', () => {
  const f = harness(); f.ready(); assert.equal(f.has('Astra defect assistance'), false); assert.equal(f.has('Reviewed examples'), false);
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
  assert.equal(f.has('Reviewed examples saved and available'), true);
});

test('a saved empty review does not claim that new defect examples were published', () => {
  const f = harness({ reviewedMemory: { enabled: true, status: 'SAVED', exampleCount: 0 } }); f.ready();
  assert.equal(f.has('There were no defect examples to add.'), true);
  assert.equal(f.has('Reviewed examples saved and available'), false);
});

test('Astra image limitations remain visible with an empty proposal list without claiming inspection completion', () => {
  const state = workspace(false), f = harness({ workspace: state, astra: { ...astraFor(state), proposals: [],
    limitations: ['Glare obscures part of the back surface.', 'A fine mark is too small to localize.'] } }); f.ready();
  assert.equal(f.has('Astra returned no suggestions. Inspect both sides'), true);
  assert.equal(f.has('Glare obscures part of the back surface.'), true);
  assert.equal(f.nodes(node => node.props?.['aria-label'] === 'Astra image limitations').length, 1);
  assert.equal(f.button('Confirm findings').props.disabled, true);
});


test('background acceptance explains Astra’s first inspection without asking the human to inspect first', () => {
  const state = workspace(false), f = harness({ workspace: state, astra: { ...astraFor(state, 'RUNNING'), backgroundAccepted: true, proposals: [] } });
  assert.equal(f.has('Astra has accepted the card for analysis.'), true);
  assert.equal(f.has('this can take several minutes'), true);
  assert.equal(f.button('Find defects with Astra').props.disabled, true);
  assert.equal(f.calls.length, 0);
});

test('exhausted background collection reports uncertainty and does not offer paid replacement', () => {
  const state = workspace(false), f = harness({ workspace: state,
    astra: { ...astraFor(state, 'UNKNOWN'), backgroundAccepted: true, collectionStopped: true, proposals: [] } });
  assert.equal(f.has('automatic checking stopped'), true);
  assert.equal(f.has('Checking the saved request again'), false);
  assert.equal(f.has('Start a new Astra analysis'), false);
  assert.equal(f.button('Find defects with Astra').props.disabled, true);
  assert.equal(f.calls.length, 0);
});

test('a retained unknown needs an explicit new-analysis click and verified current images', async () => {
  const state = workspace(false), calls = [], f = harness({ workspace: state,
    astra: { ...astraFor(state, 'UNKNOWN'), proposals: [], replacement: { analysisId: 'analysis-1', outcomeHash: 'a'.repeat(64) } },
    onReplaceAnalysis: async input => calls.push(input) });
  assert.equal(f.button('Start a new Astra analysis').props.disabled, true); assert.equal(calls.length, 0);
  f.ready(); await f.click('Start a new Astra analysis');
  assert.equal(calls.length, 1); assert.deepEqual(calls[0].base.FRONT, actions.defectBase(state, 'FRONT'));
  assert.equal(f.calls.length, 0, 'the ordinary start callback is never used for replacement');
});

test('accepted background work offers no replacement and a manual trace blocks replacing old unknown work', async () => {
  const state = workspace(false), astra = { ...astraFor(state, 'UNKNOWN'), proposals: [], replacement: { analysisId: 'analysis-1', outcomeHash: 'a'.repeat(64) } };
  const accepted = harness({ workspace: state, astra: { ...astra, backgroundAccepted: true }, onReplaceAnalysis: async () => assert.fail() });
  assert.equal(accepted.has('Start a new Astra analysis'), false);
  const editable = harness({ workspace: state, astra, onReplaceAnalysis: async () => assert.fail() }); editable.ready();
  await editable.click('Add finding', 'Front');
  assert.equal(editable.button('Start a new Astra analysis').props.disabled, true);
});

test('a durably refused concurrent action offers status recovery without another paid start', async () => {
  const state = workspace(false); let refreshes = 0;
  const f = harness({ workspace: state, astra: { ...astraFor(state, 'REFUSED'), proposals: [], followLatest: true },
    onRefreshAnalysis: async () => { refreshes++; } }); f.ready();
  assert.equal(f.button('Find defects with Astra').props.disabled, true);
  assert.equal(f.button('Check analysis status').props.disabled, false);
  await f.click('Check analysis status');
  assert.equal(refreshes, 1); assert.equal(f.calls.length, 0);
});
