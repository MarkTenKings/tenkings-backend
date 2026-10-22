import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import * as traceCodec from '@atlas/grading-core/trace-codec';
import * as traceWire from '@atlas/grading-core/trace-bitmap-wire';
import * as traceEditor from '@atlas/grading-core/trace-editor';
import * as findingImpact from '../src/finding-impact.mjs';
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
    if (name === './finding-impact.mjs') return findingImpact;
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
      element.getBoundingClientRect = () => isPlane ? f.imageRect : node.props.className.includes('ad-clean-viewport') ? { ...f.viewportRect, left: 420 } : f.viewportRect;
      node.props.ref.current = element;
    }
    return { ...node, props: { ...node.props, children: expand(node.props.children, `${path}.children`) } };
  }
  const state = workspace(false);
  const f = { calls: [], imageRect: { left: -40, top: -40, width: 1350, height: 1858 },
    viewportRect: { left: 0, top: 0, width: 400, height: 560 }, props: { workspace: state,
    images: Object.fromEntries(['FRONT', 'BACK'].map(side => [side, { inspection: { url: `blob:${side}`, sha256: state.sides[side].frame.inspectionImageSha256 } }])),
    side: 'FRONT', findingId: null, onSideChange: side => { f.props.side = side; f.props.findingId = null; }, onSelectFinding: finding => { f.props.findingId = finding?.id ?? null; }, onEdit: async request => f.calls.push({ kind: 'edit', request }),
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
  f.pointer = (pane, event, values) => { const node = f.control(pane); node.props[event]({ button: 0, pointerId: 1, preventDefault() {}, stopPropagation() {}, currentTarget: node.props.ref.current, ...values }); f.render(); };
  f.draw = (side = 'Front') => { f.pointer(`${side} image inspection`, 'onPointerDown', { clientX: 650, clientY: 650 }); f.pointer(`${side} image inspection`, 'onPointerMove', { clientX: 680, clientY: 680 }); f.pointer(`${side} image inspection`, 'onPointerUp', {}); };
  f.wheel = (pane, deltaY = -150, x = 200, y = 260) => { const element = f.control(pane).props.ref.current; const rect = element.getBoundingClientRect(); element.listeners.get('wheel')({ deltaY, clientX: rect.left + x, clientY: rect.top + y, preventDefault() {} }); f.render(); };
  f.planes = () => f.nodes(node => node.props?.className?.split(' ').includes('ad-plane'));
  f.view = () => f.planes()[0].props.style;
  f.render(); return f;
}

test('one active side defaults to marked and clean photographs with visible controls', () => {
  const f = harness({ workspace: workspace() }); f.ready();
  assert.equal(f.nodes(n => n.type === 'img').length, 2);
  assert.deepEqual(f.nodes(n => n.type === 'img').map(n => n.props.src), ['blob:FRONT', 'blob:FRONT']);
  assert.equal(f.button('Side-by-side').props['aria-pressed'], true);
  assert.ok(f.button('Fit')); assert.equal(f.side('Back'), undefined);
  assert.equal(f.nodes(n => n.type === 'details' && text(n).includes('Tools')).length, 0);
  assert.equal(f.calls.length, 0);
});

test('readiness requires both current-side photograph decodes but never the opposite side', () => {
  const readiness = [], f = harness({ onReadyChange: ready => readiness.push(ready) });
  const photos = f.nodes(n => n.type === 'img');
  photos[0].props.onLoad({ currentTarget: { naturalWidth: 1350, naturalHeight: 1858 } }); f.render();
  assert.equal(readiness.at(-1), false);
  photos[1].props.onLoad({ currentTarget: { naturalWidth: 1350, naturalHeight: 1858 } }); f.render();
  assert.equal(readiness.at(-1), true);
  assert.equal(f.calls.length, 0);
});

test('image mismatch hides authoritative markings and disables edits and side approval', () => {
  const state = workspace(), review = [];
  const f = harness({ workspace: state, images: { FRONT: { inspection: { url: 'blob:bad', sha256: '0'.repeat(64) } } }, renderReviewActions: value => { review.push(value); return null; } }); f.ready();
  assert.equal(f.nodes(n => n.props.className === 'ad-exact-trace').length, 0);
  assert.equal(f.button('Add finding').props.disabled, true); assert.equal(review.at(-1).disabled, true);
});

test('every exact current-side trace remains visible while a finding focuses both views', async () => {
  const state = workspace(), original = state.sides.FRONT.findings[0];
  const more = structuredClone(state); more.sides.FRONT.findings.push({ ...structuredClone(original), id: 'second-front' });
  const f = harness({ workspace: more }); f.ready();
  const paths = () => f.nodes(n => n.props.className === 'ad-exact-trace').map(n => n.props.d);
  const before = paths(), full = f.view();
  assert.equal(before.length, 2);
  await f.clickControl('Inspect Front finding 1');
  assert.deepEqual(paths(), before, 'focusing never changes exact source paths');
  assert.notDeepEqual(f.view(), full); assert.deepEqual(f.planes()[0].props.style, f.planes()[1].props.style);
  assert.equal(f.calls.length, 0, 'inspection does not save a decision');
  await f.click('Fit'); assert.deepEqual(f.view(), full); assert.equal(f.props.findingId, null);
});

test('direct trace selection and keyboard selection focus the same exact finding', () => {
  const f = harness({ workspace: workspace() }); f.ready();
  const marker = f.nodes(n => n.props['data-finding-id'])[0];
  marker.props.onKeyDown({ key: 'Enter', preventDefault() {}, stopPropagation() {} }); f.render();
  assert.equal(f.props.findingId, f.props.workspace.sides.FRONT.findings[0].id);
  assert.ok(f.has('Measured area')); assert.equal(f.calls.length, 0);
});

test('wheel zoom from either pane is synchronized and anchored to matching local coordinates', () => {
  const a = harness(), b = harness(); a.ready(); b.ready();
  a.wheel('Front image inspection', -200, 100, 160); b.wheel('Front clean comparison', -200, 100, 160);
  assert.deepEqual({ ...a.view() }, { ...b.view() }); assert.deepEqual(b.planes()[0].props.style, b.planes()[1].props.style);
  assert.notEqual(a.view().width, 367.99999999999994);
});

test('clean photograph drag pans both panes and never paints into a trace', async () => {
  const f = harness(); f.ready(); f.wheel('Front clean comparison', -400);
  await f.click('Add finding'); const before = f.view();
  f.pointer('Front clean comparison', 'onPointerDown', { clientX: 600, clientY: 260 });
  f.pointer('Front clean comparison', 'onPointerMove', { clientX: 650, clientY: 300 });
  f.pointer('Front clean comparison', 'onPointerUp', {});
  assert.notDeepEqual(f.view(), before); assert.deepEqual(f.planes()[0].props.style, f.planes()[1].props.style);
  assert.equal(f.button('Save trace').props.disabled, true, 'clean pane cannot create damage pixels');
});

test('two-finger pinch in either pane scales the common camera', () => {
  for (const pane of ['Front image inspection', 'Front clean comparison']) {
    const f = harness(); f.ready(); const x = pane.includes('clean') ? 420 : 0, before = f.view();
    f.pointer(pane, 'onPointerDown', { pointerId: 1, clientX: x + 130, clientY: 230 });
    f.pointer(pane, 'onPointerDown', { pointerId: 2, isPrimary: false, clientX: x + 230, clientY: 230 });
    f.pointer(pane, 'onPointerMove', { pointerId: 2, clientX: x + 330, clientY: 230 });
    assert.ok(f.view().width > before.width); assert.deepEqual(f.planes()[0].props.style, f.planes()[1].props.style);
    f.pointer(pane, 'onPointerUp', { pointerId: 2 }); f.pointer(pane, 'onPointerUp', { pointerId: 1 });
  }
});

test('keyboard zoom, pan, and Fit remain equivalent in both photographs', () => {
  const f = harness(); f.ready(); const original = f.view();
  const node = f.control('Front clean comparison'), element = node.props.ref.current;
  node.props.onKeyDown({ key: '+', target: element, currentTarget: element, preventDefault() {} }); f.render();
  assert.ok(f.view().width > original.width);
  f.key('ArrowLeft'); assert.deepEqual(f.planes()[0].props.style, f.planes()[1].props.style);
  f.key('0'); assert.deepEqual(f.view(), original);
});

test('switching side verifies its own photos and never displays the prior side traces', async () => {
  const ready = [], f = harness({ workspace: workspace(), onReadyChange: value => ready.push(value) }); f.ready();
  await f.click('Back');
  assert.equal(ready.at(-1), false); assert.equal(f.side('Front'), undefined);
  assert.equal(f.nodes(n => n.props['data-finding-id']).length, 0);
  f.ready(); assert.equal(ready.at(-1), true);
  assert.deepEqual(f.nodes(n => n.type === 'img').map(n => n.props.src), ['blob:BACK', 'blob:BACK']);
});

test('trace save preserves real raster, provenance, and source side', async () => {
  const f = harness(); f.ready(); await f.click('Add finding'); f.draw();
  assert.equal(f.button('Front').props.disabled, true, 'unsaved trace blocks side navigation');
  await f.click('Save trace');
  assert.equal(f.calls.length, 1); const request = f.calls[0].request;
  assert.equal(request.side, 'FRONT'); assert.equal(request.actor, 'HUMAN'); assert.equal(request.action.type, 'TRACE_SAVE');
  const pixels = traceWire.decodeSpeedsterTraceBitmapWireV1(request.action.trace.traceWire);
  assert.equal(pixels[660 * 1270 + 660], 1); assert.equal(pixels[100 * 1270 + 100], 0);
  assert.equal(request.action.trace.traceProvenance.sourceViewId, 'FRONT:inspection');
  assert.equal(Object.hasOwn(request, 'finalObservation'), false);
  assert.equal(f.button('Front').props.disabled, false);
});

test('failed save retains editable pixels and does not release approval or navigation', async () => {
  const reviews = [], f = harness({ onEdit: async () => { throw new Error('offline'); }, renderReviewActions: value => { reviews.push(value); return null; } });
  f.ready(); await f.click('Add finding'); f.draw(); await f.click('Save trace');
  assert.ok(f.has('Your current work is retained')); assert.equal(f.button('Save trace').props.disabled, false);
  assert.equal(reviews.at(-1).disabled, true); assert.equal(f.button('Back').props.disabled, true);
  await f.click('Cancel trace'); assert.equal(f.button('Back').props.disabled, false);
});

test('correcting a selected finding retains its exact trace and durable finding identity', async () => {
  const state = workspace(), f = harness({ workspace: state }); f.ready();
  await f.clickControl('Inspect Front finding 1'); await f.click('Edit trace'); await f.click('Save trace');
  const action = f.calls[0].request.action;
  assert.equal(action.findingId, state.sides.FRONT.findings[0].id);
  assert.equal(action.trace.traceWire.rleSha256, state.sides.FRONT.findings[0].detectorMask.sha256);
});

test('remove and restore use the current action base and do not require per-finding acceptance', async () => {
  const state = workspace(), f = harness({ workspace: state }); f.ready(); await f.clickControl('Inspect Front finding 1'); await f.click('Remove finding');
  assert.deepEqual(f.calls[0].request.base, actions.defectBase(state, 'FRONT'));
  assert.equal(f.calls[0].request.action.type, 'REMOVE'); assert.equal(f.props.findingId, null);
  const removed = structuredClone(state); removed.sides.FRONT.findings[0].reviewResultBeforeRemoval = removed.sides.FRONT.findings[0].reviewResult; removed.sides.FRONT.findings[0].reviewResult = 'REMOVED';
  const g = harness({ workspace: removed }); g.ready(); assert.equal(g.nodes(n => n.props['data-finding-id']).length, 0);
  await g.click('Restore finding'); assert.equal(g.calls[0].request.action.type, 'UNDO');
});

test('excluded old geometry is optional history and cannot disable current side approval', () => {
  const state = structuredClone(workspace()), slot = state.sides.FRONT, finding = slot.findings[0];
  finding.reviewResult='UNREVIEWED';finding.finalTrace=finding.detectorMask;finding.measurementRegions=[];delete finding.zone;delete finding.measurement;delete finding.canonicalContour;
  finding.traceProvenance={version:'speedster-trace-provenance-v1',sourceViewId:finding.sourceViewId,
    cropTransform:{version:'speedster-canonical-crop-affine-v1',crop:{x:0,y:0,width:1269,height:1777}},highlighterStrokes:[],finalTraceSha256:finding.finalTrace.sha256};
  const sourceImage={version:1,originalSha256:slot.frame.originalSha256,frameId:'working-FRONT',frameSha256:'a'.repeat(64),width:1600,height:2400,coordinateSpace:'ORIENTED_DECODED'};
  const sourceQuad=[{x:.125,y:.1},{x:.875,y:.1},{x:.875,y:.9},{x:.125,y:.9}],sx=1269/1200,sy=1777/1920;
  const sourceFrame={id:slot.frame.frameId,version:1,rectified:{sha256:slot.frame.rectifiedImageSha256,width:1270,height:1778},
    inspection:{sha256:slot.frame.inspectionImageSha256,width:1350,height:1858,cardBounds:{x:40,y:40,width:1270,height:1778}},sourceToRectified:[sx,0,-200*sx,0,sy,-240*sy,0,0,1]};
  finding.geometryExclusion={version:'atlas-geometry-exclusion-v1',reason:'TRACE_OUTSIDE_CORRECTED_CARD',sourceImage,sourceQuad,sourceFrame,sourceTraceSha256:finding.finalTrace.sha256};
  slot.humanEditedIds=[finding.id];slot.frame.preparationVersion=2;slot.frame.frameId='corrected-FRONT';

  const reviews = [], f = harness({ workspace: state, renderReviewActions: value => { reviews.push(value); return null; } }); f.ready();
  assert.equal(f.nodes(n => n.props['data-finding-id']).length, 0);
  assert.ok(f.has('Removed / excluded (1)')); assert.ok(f.has('No saved findings on front.'));
  assert.equal(reviews.at(-1).disabled, false); assert.equal(f.has('Original observations'), false);
});

test('zero saved findings visibly separates current suggestions and explains approval outside the collapsed list', () => {
  const state = workspace(false), astra = astraFor(state), original = astra.proposals[0], reviews = [];
  astra.proposals.push({ ...original, id: 'proposal-2' }, { ...original, id: 'proposal-3', canonicalContour: null },
    { ...original, id: 'back-only', side: 'BACK' }, { ...original, id: 'already-dismissed', reviewStatus: 'REJECTED' });
  const f = harness({ workspace: state, astra, renderReviewActions: value => { reviews.push(value); return null; } }); f.ready();
  const header = f.nodes(n => n.type === 'header' && n.props.className === 'ad-review-toolbar')[0];
  assert.ok(text(header).includes('0 saved findings · 3 AI suggestions'));
  assert.ok(f.has('No saved findings on front.')); assert.equal(f.has('Additional suggestions'), false);
  assert.equal(f.nodes(n => n.props.className === 'ad-exact-trace').length, 0);
  assert.equal(f.nodes(n => n.props.className === 'ad-proposal-outline').length, 2, 'unrenderable suggestions stay listed without inventing a trace');
  const details = f.nodes(n => n.type === 'details' && n.props.className === 'ad-proposals')[0];
  assert.ok(text(details).includes('AI suggestions (3)')); assert.equal(Boolean(details.props.open), false);
  const help = f.control('Front suggestion review');
  assert.equal(all(details, n => n.props['aria-label'] === 'Front suggestion review').length, 0, 'instructions remain visible when the list is collapsed');
  assert.ok(text(help).includes('Blue dashed outlines mark AI suggestions.'));
  for (const action of ['Add suggestion', 'Correct trace', 'Dismiss suggestion', 'Add finding']) assert.ok(text(help).includes(action));
  assert.ok(text(help).includes('Approving both sides confirms only saved findings. Suggestions left unadded are excluded.'));
  assert.equal(reviews.at(-1).message, 'Front · 0 saved findings · 3 AI suggestions');
  assert.equal(reviews.at(-1).disabled, false, 'copy does not add an approval gate or accept suggestions');
  assert.equal(f.calls.length, 0);
});

test('suggestion counts and instructions follow current side, frame and unresolved status', () => {
  const state = workspace(false), astra = astraFor(state), f = harness({ workspace: state, astra }); f.ready();
  assert.ok(f.has('0 saved findings · 1 AI suggestion'));
  f.props.side = 'BACK'; f.render(); f.ready();
  assert.equal(f.has('AI suggestions ('), false); assert.equal(f.nodes(n => n.props.className === 'ad-suggestion-help').length, 0);
  f.props.side = 'FRONT'; f.props.astra = { ...astra, status: 'STALE' }; f.render(); f.ready();
  assert.equal(f.has('AI suggestions ('), false); assert.equal(f.nodes(n => n.props.className === 'ad-proposal-outline').length, 0);
  f.props.astra = structuredClone(astra); f.props.astra.base.FRONT.frame.frameId = 'an-earlier-frame'; f.render();
  assert.equal(f.nodes(n => n.props.className === 'ad-suggestion-help').length, 0);
  f.props.astra = { ...astra, proposals: astra.proposals.map(proposal => ({ ...proposal, reviewStatus: 'ACCEPTED' })) }; f.render();
  assert.equal(f.has('AI suggestions ('), false); assert.equal(f.nodes(n => n.props.className === 'ad-suggestion-help').length, 0);
  assert.equal(f.calls.length, 0);
});

test('ready analysis copy describes saved-roster approval without automatic suggestion acceptance', () => {
  const state = workspace(false), astra = astraFor(state), ready = presentation.astraReviewState(state, astra);
  assert.equal(ready.status, 'READY');
  assert.ok(ready.message.includes('Add or correct suggestions to save them, dismiss unwanted suggestions, and add any missed damage before confirming.'));
  assert.ok(ready.message.includes('Approving both sides confirms only saved findings; suggestions left unadded are excluded.'));
  assert.equal(ready.message.includes('accepts the remaining'), false);
  assert.ok(presentation.astraReviewState(state, { ...astra, proposals: [] }).message.includes('ATLAS returned no suggestions.'));
});

test('new current suggestions require deliberate adoption without blocking or changing the current roster', async () => {
  const state = workspace(), reviews = [], f = harness({ workspace: state, astra: astraFor(state), renderReviewActions: value => { reviews.push(value); return null; } }); f.ready();
  assert.ok(f.has('1 saved finding · 1 AI suggestion')); assert.equal(f.nodes(n => n.props.className === 'ad-exact-trace').length, 1);
  assert.equal(reviews.at(-1).disabled, false); assert.equal(f.calls.length, 0);
  await f.click('Add suggestion'); assert.equal(f.calls[0].kind, 'proposal'); assert.equal(f.calls[0].request.action, 'ACCEPT');
  assert.ok(f.has('1 saved finding · 1 AI suggestion'), 'counts wait for the authoritative refreshed roster');
  assert.equal(f.nodes(n => n.props.className === 'ad-exact-trace').length, 1);
});

test('late model results do not replace an unsaved manual trace', async () => {
  const state = workspace(false), f = harness({ workspace: state }); f.ready(); await f.click('Add finding'); f.draw();
  f.props.astra = astraFor(state); f.render();
  assert.equal(f.button('Add suggestion').props.disabled, true); await f.click('Save trace');
  const pixels = traceWire.decodeSpeedsterTraceBitmapWireV1(f.calls[0].request.action.trace.traceWire);
  assert.equal(pixels[660 * 1270 + 660], 1); assert.equal(pixels[365 * 1270 + 265], 0);
});

test('resize and camera changes retain completed unsaved strokes', async () => {
  const f = harness(); f.ready(); await f.click('Add finding'); f.draw();
  f.resize('Front', 500, 660); f.wheel('Front clean comparison', -100); await f.click('Save trace');
  assert.equal(traceWire.decodeSpeedsterTraceBitmapWireV1(f.calls[0].request.action.trace.traceWire)[660 * 1270 + 660], 1);
});

test('read-only review permits inspection and synchronized camera movement without mutation controls', async () => {
  const f = harness({ workspace: workspace(), readOnly: true }); f.ready();
  await f.clickControl('Inspect Front finding 1'); f.wheel('Front clean comparison');
  assert.equal(f.button('Edit trace').props.disabled, true); assert.equal(f.button('Remove finding').props.disabled, true); assert.equal(f.button('Add finding').props.disabled, true);
  assert.equal(f.calls.length, 0);
});

test('a trace saved before a measurement failure retries the exact retained change without another trace write', async () => {
  const f = harness(); let edits = 0, retries = 0;
  f.props.onEdit = async request => {
    edits++;
    f.props.workspace = actions.beginDefectEdit(f.props.workspace, structuredClone(request)).state;
    throw Error('measurement not acknowledged');
  };
  f.props.onRetry = async side => { assert.equal(side, 'FRONT'); retries++; };
  f.ready(); await f.click('Add finding'); f.draw(); await f.click('Save trace');
  assert.equal(edits, 1); assert.ok(f.has('Your current work is retained')); f.ready();
  assert.equal(f.button('Save trace').props.disabled, false, 'same saved trace is retryable despite its older editor base');
  const pendingHash = f.props.workspace.sides.FRONT.pending.action.trace.traceWire.rleSha256;
  await f.click('Save trace'); assert.equal(edits, 1); assert.equal(retries, 1);
  assert.equal(f.props.workspace.sides.FRONT.pending.action.trace.traceWire.rleSha256, pendingHash);
});

test('duplicate trace saves are suppressed while the original durable save is in flight', async () => {
  let finish; const f = harness({ onEdit: () => new Promise(resolve => { finish = resolve; }) });
  f.ready(); await f.click('Add finding'); f.draw(); const save = f.button('Save trace').props.onClick;
  const first = save(); f.render(); assert.equal(f.button('Saving…').props.disabled, true);
  const second = save(); assert.equal(await second, false); finish(); await first; f.render();
  assert.equal(f.nodes(n => n.props['aria-label'] === 'Front trace editor').length, 0);
});

test('provider failure is visible, retry is optional, and review remains usable during retry', async () => {
  let complete;
  const state = workspace(false), astra = astraFor(state, 'REFUSED');
  Object.assign(astra, { code: 'DEFECT_ANALYSIS_PROVIDER_HTTP_ERROR', httpStatus: 500, proposals: [] });
  const f = harness({ workspace: state, astra, onAnalyzeDefects: () => new Promise(resolve => { complete = resolve; }),
    renderReviewActions: options => ({ type: 'button', props: { disabled: options.disabled, children: 'Approve findings' } }) });
  f.ready();
  assert.ok(f.has('provider error 500')); assert.ok(f.has('no AI result was returned'));
  const retry = f.button('Retry AI inspection').props.onClick(); f.render();
  assert.equal(f.button('Retry AI inspection').props.disabled, true);
  assert.equal(f.button('Approve findings').props.disabled, false);
  assert.equal(f.button('Add finding').props.disabled, false);
  assert.equal(f.button('Back').props.disabled, false);
  complete(); await retry; f.render();
  assert.equal(f.button('Retry AI inspection').props.disabled, false);
});

test('accepted or uncertain requests offer status reads without a new dispatch and never gate review', async () => {
  for (const status of ['RUNNING', 'UNKNOWN']) {
    const state = workspace(false), astra = { ...astraFor(state, status), backgroundAccepted: true, proposals: [] };
    let reads = 0;
    const f = harness({ workspace: state, astra, onRefreshAnalysis: async () => { reads++; } });
    f.ready(); await f.click('Check AI status');
    assert.equal(reads, 1); assert.equal(f.calls.length, 0);
    assert.equal(f.nodes(n => n.type === 'button' && /Retry AI|Start new AI/.test(text(n))).length, 0);
    assert.equal(f.button('Add finding').props.disabled, false);
  }
});
