import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as scoring from '@atlas/grading-core/scoring';
import { calculateSpeedsterReview } from '@atlas/grading-core/review';
import * as traceCodec from '@atlas/grading-core/trace-codec';
import { explainAtlasManualReport } from '@atlas/grading-core/manual-report';
import * as presentation from '../src/report-review-ui.mjs';
import * as optionalPresentation from '../src/report-presentation-ui.mjs';
import * as viewportMath from '../src/inspection-viewport.mjs';
import * as inspectionPreview from '../src/inspection-preview.mjs';
import * as spatialNavigation from '../src/report-spatial-navigation.mjs';
import * as fingerprint from '../src/report-fingerprint.mjs';
import * as gradeStory from '../src/grade-calculation-story.mjs';
import * as wholeCardLayout from '../src/whole-card-layout.mjs';
import * as scanMotion from '../src/evidence-scan-motion.mjs';
import * as edgeTour from '../src/evidence-edge-tour.mjs';
import * as cornerTour from '../src/evidence-corner-tour.mjs';
import * as tourSound from '../src/evidence-tour-sound.mjs';
import * as filmSelector from '../../atlas-report-view/src/film-selector.mjs';
import { defectBase, markDefectSideInspected, confirmDefectFindings, previewDefectReport } from '../src/defect-actions.mjs';
import { workspace } from './defect-fixtures.mjs';

const require = createRequire(new URL('../../../frontend/atlas-app/package.json', import.meta.url));
const babel = require('next/dist/compiled/babel/core'), nextRequire = createRequire(require.resolve('next/package.json'));
const sources = Object.fromEntries(['ReportSpatialOverlay', 'ReportPrecisionOverlay', 'ReportFingerprint', 'ReportInspectionImage', 'FindingCallouts', 'ApprovedWholeCard', 'TourSoundButton', 'ReportEvidenceScan', 'ApprovedReportTour', 'PublicEvidenceExplorer', 'ReportPresentation', 'GradeCalculationStory', 'FinalReportReview'].map(name => [name, babel.transformSync(readFileSync(new URL(`../src/${name}.jsx`, import.meta.url), 'utf8'), {
  filename: `${name}.jsx`, presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } } }]], babelrc: false, configFile: false,
}).code]));
const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : node ?? '';
const all = (node, predicate, out = []) => { if (Array.isArray(node)) node.forEach(child => all(child, predicate, out)); else if (node && typeof node === 'object') { if (predicate(node)) out.push(node); all(node.props?.children, predicate, out); } return out; };

function fixture() {
  let state = workspace();
  for (const side of ['FRONT', 'BACK']) state = markDefectSideInspected(state, { side, base: defectBase(state, side), actor: 'HUMAN', inspected: true }).state;
  state = confirmDefectFindings(state, { base: { FRONT: defectBase(state, 'FRONT'), BACK: defectBase(state, 'BACK') }, actor: 'HUMAN', reviewed: true }).state;
  const quad = [{ x: .04, y: .03 }, { x: .96, y: .03 }, { x: .96, y: .97 }, { x: .04, y: .97 }];
  const report = previewDefectReport(state, { identity: { playerName: 'Synthetic report', year: '2026', manufacturer: 'Fixture', productSet: 'Local only' }, centeringQuads: { FRONT: quad, BACK: quad }, draftRevision: 10 });
  return { workspace: structuredClone(state), preview: { reportHash: 'f'.repeat(64), review: { report, explanation: explainAtlasManualReport(report) } },
    images: Object.fromEntries(['FRONT', 'BACK'].map(side => [side, { inspection: { sha256: state.sides[side].frame.inspectionImageSha256, url: `blob:${side}` } }])), children: 'SEPARATE_APPROVAL_SLOT' };
}

function harness(props = fixture(), { publicView = false, machine = false, fragment = '', reducedMotion = false, controlledFrames = false, desktop = false } = {}) {
  const instances = new Map(), elements = new Map(); let current, cursor, dirty, effects = [], tree, used = new Set();
  const frames = new Map(); let frameId = 0, frameTime = 0;
  const frameGlobals = controlledFrames ? {
    requestAnimationFrame: callback => { const id = ++frameId; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id),
  } : {};
  const listeners = new Map(), listenerSets = new Map(), browser = { location: { hash: fragment }, matchMedia: query => ({ matches: query.includes('reduced-motion') ? reducedMotion : !desktop }),
    addEventListener(name, fn) { if (!listenerSets.has(name)) listenerSets.set(name, new Set()); listenerSets.get(name).add(fn); listeners.set(name, () => listenerSets.get(name)?.forEach(callback => callback())); },
    removeEventListener(name, fn) { listenerSets.get(name)?.delete(fn); }, print() {} };
  const memo = (make, deps) => { const i = cursor++, old = current[i]; if (!old || deps.some((v, j) => !Object.is(v, old.deps[j]))) current[i] = { deps, value: make() }; return current[i].value; };
  const react = { useId: () => 'fixture-whole-card', Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const i = cursor++, slots = current; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], change => { const next = typeof change === 'function' ? change(slots[i]) : change; if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true; } }]; },
    useRef(initial) { const i = cursor++; if (!(i in current)) current[i] = { current: initial }; return current[i]; }, useMemo: memo, useCallback: (callback, deps) => memo(() => callback, deps),
    useEffect(callback, deps) { const i = cursor++, slots = current, prior = slots[i]; if (!prior || deps.some((v, j) => !Object.is(v, prior.deps[j]))) { slots[i] = { deps, cleanup: prior?.cleanup }; effects.push(() => { slots[i].cleanup?.(); slots[i].cleanup = callback(); }); } },
  };
  const modules = {};
  for (const [name, code] of Object.entries(sources)) {
    const exports = {}; vm.runInNewContext(code, { exports, window: browser, AbortController, ...frameGlobals, setTimeout: (...args) => setTimeout(...args).unref(), clearTimeout, ResizeObserver: class { constructor(callback) { this.callback = callback; } observe(element) { element.resize = this.callback; } disconnect() {} }, require(name) {
      if (name === 'react') return react;
      if (name === 'gsap') return { gsap: {} };
      if (name === '@atlas/grading-core/scoring') return scoring;
      if (name === 'react-dom') return { flushSync: callback => callback() };
      if (name === '@atlas/grading-core/trace-codec') return traceCodec;
      if (name === './inspection-viewport.mjs') return viewportMath;
      if (name === './inspection-preview.mjs') return inspectionPreview;
      if (name === './report-review-ui.mjs') return presentation;
      if (name === './report-spatial-navigation.mjs') return spatialNavigation;
      if (name === './report-fingerprint.mjs') return { ...fingerprint, animateFingerprint: options => fingerprint.animateFingerprint({ ...options, request: frameGlobals.requestAnimationFrame, cancel: frameGlobals.cancelAnimationFrame }) };
      if (name === './grade-calculation-story.mjs') return gradeStory;
      if (name === './GradeCalculationStory.jsx') return modules.GradeCalculationStory;
      if (name === './ReportFingerprint.jsx') return modules.ReportFingerprint;
      if (name === './ReportSpatialOverlay.jsx') return modules.ReportSpatialOverlay;
      if (name === './ReportPrecisionOverlay.jsx') return modules.ReportPrecisionOverlay;
      if (name === './evidence-scan-motion.mjs') return scanMotion;
      if (name === './evidence-edge-tour.mjs') return edgeTour;
      if (name === './evidence-corner-tour.mjs') return cornerTour;
      if (name === './evidence-tour-sound.mjs') return tourSound;
      if (name === './TourSoundButton.jsx') return modules.TourSoundButton;
      if (name === './ReportEvidenceScan.jsx') return modules.ReportEvidenceScan;
      if (name === './ApprovedReportTour.jsx') return modules.ApprovedReportTour;
      if (name === '../../atlas-report-view/src/film-selector.mjs') return filmSelector;
      if (name === './whole-card-layout.mjs') return wholeCardLayout;
      if (name === './report-presentation-image.mjs') return { usePresentationImage: () => null };
      if (name === './FindingCallouts.jsx') return modules.FindingCallouts;
      if (name === './ApprovedWholeCard.jsx') return modules.ApprovedWholeCard;
      if (name === './PublicEvidenceExplorer.jsx') return modules.PublicEvidenceExplorer;
      if (name === './report-presentation-ui.mjs') return optionalPresentation;
      if (name === './ReportPresentation.jsx') return modules.ReportPresentation;
      if (name === './verified-image.mjs') return { useVerifiedImage: image => ({ url: image?.url }) };
      if (name === './VerifiedImageCacheBoundary.jsx') return { VerifiedImageCacheBoundary: ({ children }) => children };
      if (name === './ReportInspectionImage.jsx') return modules.ReportInspectionImage;
      return nextRequire(name.startsWith('@babel/runtime/') ? `next/dist/compiled/${name}` : name);
    } }); modules[name] = exports;
  }
  function expand(node, path = 'root') {
    if (Array.isArray(node)) return node.map((child, i) => expand(child, `${path}.${i}`));
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function') { const key = `${path}:${node.type.name}`; used.add(key); if (!instances.has(key)) instances.set(key, []); current = instances.get(key); cursor = 0; return expand(node.type(node.props), `${key}.out`); }
    if (node.props.ref && (node.type === 'canvas' || node.props.className === 'rr-fingerprint-layer')) {
      if (!elements.has(path)) {
        const context = { save() {}, restore() {}, translate() {}, scale() {}, clearRect() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}, createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} };
        elements.set(path, { getContext: () => context, style: { setProperty(key, value) { this[key] = value; } } });
      }
      node.props.ref.current = elements.get(path);
    }
    if (node.props.ref && ['rr-viewport', 'rr-viewport rr-clean-viewport', 'rr-plane', 'rr-slab-plane'].includes(node.props.className)) {
      if (!elements.has(path)) elements.set(path, { clientWidth: 400, clientHeight: 540, listeners: new Map(), focus() {}, scrollIntoView(options) { this.scrollOptions = options; },
        style: { setProperty(name, value) { this[name] = value; } }, addEventListener(name, fn) { this.listeners.set(name, fn); }, removeEventListener(name) { this.listeners.delete(name); }, setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture() { return true; } });
      const element = elements.get(path); element.getBoundingClientRect = () => node.props.className === 'rr-plane' ? f.imageRect : f.viewportRect; node.props.ref.current = element;
    }
    return { ...node, props: { ...node.props, children: expand(node.props.children, `${path}.children`) } };
  }
  const f = { props, browser, listeners, readyValues: [], imageRect: { left: -40, top: -40, width: 1350, height: 1858 }, viewportRect: { left: 0, top: 0, width: 400, height: 540 } };
  f.props.onReadyChange = value => f.readyValues.push(value);
  f.render = () => { let rounds = 0; do { dirty = false; used = new Set(); tree = expand({ type: modules.FinalReportReview[machine ? 'MachineReportReview' : publicView ? 'ApprovedReportView' : 'FinalReportReview'], props: f.props }); for (const [key, slots] of instances) if (!used.has(key)) { slots.forEach(slot => slot?.cleanup?.()); instances.delete(key); } const pending = effects; effects = []; pending.forEach(callback => callback()); assert.ok(++rounds < 20); } while (dirty); return tree; };
  f.unmount = () => { instances.forEach(slots => slots.forEach(slot => slot?.cleanup?.())); instances.clear(); };
  f.nodes = predicate => all(tree, predicate); f.has = value => text(tree).includes(value);
  f.control = label => { const node = f.nodes(node => node.props?.['aria-label'] === label)[0]; assert.ok(node, label); return node; };
  f.button = label => { const node = f.nodes(node => node.type === 'button' && text(node) === label)[0]; assert.ok(node, label); return node; };
  f.click = label => { const node = f.button(label); assert.equal(Boolean(node.props.disabled), false); node.props.onClick(); f.render(); };
  f.ready = side => { f.nodes(node => node.type === 'img' && typeof node.props.onLoad === 'function' && (side ? node.props.alt.startsWith(side) : /^(Front|Back)/.test(node.props.alt))).forEach(node => node.props.onLoad({ currentTarget: { naturalWidth: 1350, naturalHeight: 1858 } })); f.render(); };
  f.pendingFrames = () => frames.size;
  f.frame = (elapsed = 1000) => { frameTime += elapsed; const scheduled = [...frames]; frames.clear(); scheduled.forEach(([, callback]) => callback(frameTime)); f.render(); };
  f.finishMotion = () => { let count = 0; while (frames.size) { assert.ok(++count < 30, 'animation terminates'); f.frame(); } };
  f.render(); return f;
}

test('full report keeps approval readiness separate until both exact photographs load', () => {
  const f = harness(); assert.equal(f.readyValues.at(-1), false); assert.equal(f.has('DRAFT GRADE'), true);
  f.ready('Front'); assert.equal(f.readyValues.at(-1), false); f.ready('Back'); assert.equal(f.readyValues.at(-1), true);
  assert.equal(f.has('How this grade is calculated'), true); assert.equal(f.has('rounded directly from'), true);
  assert.equal(f.nodes(node => node.type === 'img' && typeof node.props.onLoad === 'function').length, 2);
});

test('selecting an included finding focuses its side and renders core measurements without changing report bytes', () => {
  const f = harness(), before = structuredClone(f.props.preview); f.ready();
  const buttons = f.nodes(node => node.type === 'button' && node.props['aria-label']?.startsWith('Back 1 ·')); assert.equal(buttons.length, 1);
  buttons[0].props.onClick(); f.render();
  assert.equal(f.has('Selected finding'), false); assert.ok(parseFloat(text(f.control('Current zoom'))) > 1);
  assert.ok(f.control('Selected finding calculation')); assert.equal(f.has('Measured area'), true); assert.equal(f.has('Marginal unrounded overall effect'), true);
  const expected = f.props.preview.review.explanation.findings.find(finding => finding.side === 'BACK').regions[0].weightedAreaMm2;
  assert.ok(f.nodes(node => node.type === 'data' && node.props.value === expected).length > 0);
  assert.deepEqual(f.props.preview, before);
});

test('compact dock supports 16x, shared layers, side switching and optional comparison without changing evidence', () => {
  const f = harness(), before = structuredClone(f.props.workspace); f.ready();
  assert.equal(f.control('Back report image').props.hidden, true);
  for (let i = 0; i < 7; i++) { f.control('Zoom in').props.onClick(); f.render(); }
  assert.equal(parseFloat(text(f.control('Current zoom'))), 16);
  const toggle = label => f.nodes(node => node.type === 'label' && text(node).includes(label))[0].props.children.flat(Infinity).find(node => node?.type === 'input');
  toggle('Defect markings').props.onChange({ target: { checked: false } }); f.render();
  assert.equal(f.nodes(node => node.props.className === 'rr-finding-markers').length, 0);
  toggle('Compare front & back').props.onChange({ target: { checked: true } }); f.render();
  assert.equal(f.control('Back report image').props.hidden, false);
  toggle('Compare front & back').props.onChange({ target: { checked: false } }); f.render();
  f.click('Back'); assert.equal(f.control('Front report image').props.hidden, true);
  assert.equal(f.control('Back report image').props.hidden, false);
  assert.equal(f.nodes(node => node.props.className === 'rr-crop').length, 0);
  assert.deepEqual(f.props.workspace, before);
});

test('numbered photo buttons select exact findings and keyboard navigation never confirms evidence', () => {
  const f = harness(), before = structuredClone(f.props.preview); f.ready();
  const marker = f.nodes(node => node.type === 'button' && node.props['aria-label']?.startsWith('Inspect Front finding 1:'))[0];
  assert.ok(marker); let stopped = false;
  marker.props.onClick({ stopPropagation() { stopped = true; } }); f.render();
  assert.equal(stopped, true); assert.ok(f.control('Selected finding overview'));
  assert.equal(f.control('Front report image').props.hidden, false);
  assert.ok(parseFloat(text(f.control('Current zoom'))) > 1);
  f.nodes(node => node.props.className?.startsWith('rr-report rr-inspect'))[0].props.onKeyDown({ key: ']', target: { tagName: 'DIV' }, preventDefault() {}, stopPropagation() {} }); f.render();
  assert.ok(f.control('Selected finding overview')); assert.deepEqual(f.props.preview, before);
  f.click('Front'); f.click('Back');
  assert.equal(f.nodes(node => node.props?.['aria-label'] === 'Selected finding overview').length, 0);
  assert.deepEqual(f.props.preview, before);
});

test('stale report frame, revision, missing projection or changed source suppress the approval slot', () => {
  for (const alter of [f => { delete f.props.preview.review; }, f => { f.props.current = false; },
    f => { f.props.workspace.sides.FRONT.findingRevision++; }, f => { f.props.workspace.sides.FRONT.frame.inspectionImageSha256 = 'f'.repeat(64); }]) {
    const f = harness(); alter(f); f.render(); assert.equal(f.has('SEPARATE_APPROVAL_SLOT'), false); assert.equal(f.readyValues.at(-1), false); assert.equal(f.has('Return to Findings'), true);
  }
});

test('wrong image hash or dimensions cannot enable final approval readiness', () => {
  const props = fixture(); props.images.FRONT.inspection.sha256 = 'e'.repeat(64); const f = harness(props); f.ready();
  assert.equal(f.readyValues.at(-1), false); assert.equal(f.has('saved photograph is unavailable'), true);
  const g = harness(); g.ready('Back'); g.nodes(node => node.type === 'img' && node.props.alt.startsWith('Front'))[0].props.onLoad({ currentTarget: { naturalWidth: 1270, naturalHeight: 1778 } }); g.render();
  assert.equal(g.readyValues.at(-1), false); assert.equal(g.has('unexpected dimensions'), true);
});

test('trace hit testing preserves holes and outside-card clicks do not select a finding', () => {
  const findings = fixture().preview.review.report.findings, finding = findings[0];
  const mask = presentation.reportFindingMask(finding), spans = [...traceCodec.speedsterTraceRleV1Spans(mask)];
  assert.ok(spans.length); const point = { x: spans[0].x, y: spans[0].y };
  assert.equal(presentation.reportFindingAt([finding], point).id, finding.id);
  assert.equal(presentation.reportFindingAt([finding], { x: 1269, y: 1777 }), null);
  assert.equal(presentation.reportFindingAt([finding], null), null);
  assert.equal(presentation.reportFindingAt([{ ...finding, reviewResult: 'REMOVED' }], point), null);
});

test('new final grade uses the authoritative half-point field and historical reports retain their original grade', () => {
  assert.equal(presentation.reportAwardedGrade({ version: 'atlas-manual-draft-report-v2', finalGradePolicy: 'atlas-final-half-point-v1', finalGrade: 9.5, grade: { overall: { displayGrade: 9.7 } } }), 9.5);
  assert.equal(presentation.reportAwardedGrade({ version: 'atlas-manual-draft-report-v1', finalGrade: 10, grade: { overall: { displayGrade: 9.8 } } }), 9.8);
  assert.equal(presentation.reportAwardedGrade({ version: 'atlas-manual-draft-report-v2', finalGradePolicy: 'unknown', finalGrade: 10 }), null);
  const props = fixture(), report = props.preview.review.report;
  report.version = 'atlas-manual-draft-report-v1'; delete report.finalGrade; delete report.finalGradePolicy;
  // Reconstruct the retained historical rule explicitly; a newly calculated
  // ATLAS report cannot become historical merely by changing its shape tag.
  report.ruleVersion = 'TK_SPEEDSTER_2026_07_31';
  const centeringBorders = scoring.measureSpeedsterCenteringBorders([{ x: .04, y: .03 }, { x: .96, y: .03 }, { x: .96, y: .97 }, { x: .04, y: .97 }]);
  const historical = calculateSpeedsterReview({ front: { centeringBorders }, back: { centeringBorders } }, report.findings);
  report.grade = historical.grade; report.findings = historical.defects;
  props.preview.review.explanation = explainAtlasManualReport(report);
  const f = harness(props); assert.equal(f.has('Original historical grade'), true); assert.equal(f.has('retains its original tenth-point policy'), true);
  assert.equal(f.has('Final ATLAS grade, rounded to the nearest half point'), false);
});

test('finding filters and next/previous retain side numbering and never change approval evidence', () => {
  const f = harness(), before = structuredClone(f.props.preview); f.ready();
  f.control('Filter findings by side').props.onChange({ target: { value: 'BACK' } }); f.render();
  assert.equal(f.nodes(node => node.type === 'button' && node.props['aria-label']?.startsWith('Front 1 ·')).length, 0);
  assert.equal(f.nodes(node => node.type === 'button' && node.props['aria-label']?.startsWith('Back 1 ·')).length, 1);
  f.click('Browse next'); assert.ok(parseFloat(text(f.control('Current zoom'))) > 1);
  assert.equal(f.button('Browse next').props.disabled,true); assert.equal(f.button('Previous finding').props.disabled,true);
  assert.equal(f.readyValues.at(-1), true); assert.deepEqual(f.props.preview, before);
  f.control('Filter findings by category').props.onChange({ target: { value: 'centering' } }); f.render();
  assert.equal(f.button('Browse next').props.disabled, true); assert.equal(f.has('Centering uses the saved border geometry'), true);
});

test('deep links select only a finding in the exact report and honor reduced motion', () => {
  const props = fixture(), finding = props.preview.review.report.findings.find(value => value.side === 'BACK');
  const fragment = presentation.reportFindingFragment(props.preview.reportHash, finding.id);
  const f = harness(props, { fragment, reducedMotion: true }); f.ready();
  assert.ok(parseFloat(text(f.control('Current zoom'))) > 1);
  assert.equal(f.control('Back report inspection').props.ref.current.scrollOptions.behavior, 'auto');
  assert.equal(f.nodes(node => node.type === 'a' && node.props.href === fragment).length, 1);
  const wrong = harness(fixture(), { fragment: fragment.replace('f'.repeat(64), 'a'.repeat(64)) }); wrong.ready();
  assert.equal(parseFloat(text(wrong.control('Current zoom'))), 1);
  assert.equal(presentation.reportFindingFromFragment(fragment + '&finding=another', props.preview.reportHash, props.preview.review.report.findings), null);
});

test('touch pinch changes view without selecting a finding and keyboard remains available', () => {
  const f = harness(), before = structuredClone(f.props.preview); f.ready();
  const event = (id, x, y) => ({ pointerId: id, pointerType: 'touch', button: 0, clientX: x, clientY: y, preventDefault() {}, currentTarget: f.control('Front report inspection').props.ref.current });
  f.control('Front report inspection').props.onPointerDown(event(1, 100, 200));
  f.control('Front report inspection').props.onPointerDown(event(2, 200, 200));
  f.control('Front report inspection').props.onPointerMove(event(2, 300, 200)); f.render();
  assert.equal(parseFloat(text(f.control('Current zoom'))), 2);
  f.control('Front report inspection').props.onPointerUp(event(2, 300, 200));
  f.control('Front report inspection').props.onPointerUp(event(1, 100, 200)); f.render();
  assert.equal(f.nodes(node => node.props?.['aria-label'] === 'Selected finding calculation').length, 0);
  const viewport = f.control('Front report inspection').props.ref.current;
  f.control('Front report inspection').props.onKeyDown({ key: '0', target: viewport, currentTarget: viewport, preventDefault() {} }); f.render();
  assert.equal(parseFloat(text(f.control('Current zoom'))), 1); assert.deepEqual(f.props.preview, before);
});

test('explicit precision and print disclosure preserve original report and approval state', () => {
  const f = harness(), before = structuredClone(f.props.preview); f.ready();
  f.click('Show full precision'); assert.ok(f.nodes(node => node.props?.className?.includes('rr-precision')).length > 0);
  assert.equal(f.readyValues.at(-1), true);
  f.listeners.get('beforeprint')(); f.render();
  assert.equal(f.nodes(node => node.props?.className === 'rr-category-disclosure' && node.props.open === true).length, 4);
  f.listeners.get('afterprint')(); f.render(); assert.deepEqual(f.props.preview, before);
});

test('approved public rendering has the same verified viewer without staff approval or removed history', () => {
  const fixtureProps = fixture(), { report, explanation } = fixtureProps.preview.review;
  const props = { report, explanation, images: fixtureProps.images, publication: { version: 1, approvedAt: '2026-09-22T00:00:00Z', reportHash: fixtureProps.preview.reportHash, reportNumber: 'ATLAS-TEST' } };
  const f = harness(props, { publicView: true }); assert.equal(f.has('APPROVED GRADE'), true);
  assert.equal(f.nodes(node => node.props?.className === 'rr-approval').length, 0);
  assert.equal(f.has('rejected suggestions'), false); assert.equal(f.button('Print approved report').props.disabled, true);
  f.ready(); assert.equal(f.button('Print approved report').props.disabled, false);
  assert.equal(f.has('ATLAS-TEST'), true);
  const bad = harness({ ...props, publication: { ...props.publication, reportHash: 'not-a-hash' } }, { publicView: true });
  assert.equal(bad.has('approved evidence could not be verified'), true);
});

test('geometry layers bind staff printed coordinates to the exact report frame', () => {
  const props = fixture(), report = props.preview.review.report, quad = [{ x: .05, y: .04 }, { x: .95, y: .04 }, { x: .95, y: .96 }, { x: .05, y: .96 }];
  props.geometry = { sides: Object.fromEntries(['FRONT', 'BACK'].map(side => [side, { prepared: { frame: { id: side, inspection: { sha256: report.inspection[side.toLowerCase()].imageSha256 }, rectified: { sha256: 'a'.repeat(64) } } }, printed: { frameId: side, frameSha256: 'a'.repeat(64), quad } }])) };
  const f = harness(props); f.ready();
  const printed = f.nodes(node => node.type === 'label' && text(node).includes('Printed border'))[0].props.children.flat(Infinity).find(node => node?.type === 'input');
  assert.equal(printed.props.disabled, false); assert.equal(printed.props.checked, true);
  assert.equal(f.nodes(node => node.props?.className === 'rr-printed-line').length, 2);
  printed.props.onChange({ target: { checked: false } }); f.render();
  assert.equal(f.nodes(node => node.props?.className === 'rr-printed-line').length, 0);
  assert.deepEqual(presentation.reportDisplayGeometry(props.geometry, report).FRONT.printedQuad, quad);
  props.geometry.sides.FRONT.prepared.frame.inspection.sha256 = 'b'.repeat(64);
  assert.equal(presentation.reportDisplayGeometry(props.geometry, report).FRONT, null);
});

test('minimap and crop coordinates preserve verified image bounds at fit and deep zoom', () => {
  const size = { width: 400, height: 540 };
  assert.deepEqual(presentation.reportMinimap({ zoom: 1, pan: { x: 0, y: 0 } }, size), { x: 0, y: 0, width: 1, height: 1 });
  const map = presentation.reportMinimap({ zoom: 16, pan: { x: 0, y: 0 } }, size);
  assert.ok(map.width < .1 && map.height < .1 && map.x > .4 && map.y > .4);
  for (const box of [{ x: 0, y: 0, width: .001, height: .001 }, { x: .99, y: .99, width: .01, height: .01 }]) {
    const crop = presentation.reportCropBounds(box); assert.ok(crop.x >= 40 && crop.y >= 40 && crop.x + crop.width <= 1310 && crop.y + crop.height <= 1818);
  }
});

test('public finding links retain the approved version and refuse foreign or mismatched URLs', () => {
  const fragment = presentation.reportFindingFragment('a'.repeat(64), 'FRONT:one');
  assert.equal(presentation.reportFindingLink({ version: 3, url: '/reports/am_test?v=3' }, fragment), '/reports/am_test?v=3' + fragment);
  assert.equal(presentation.reportFindingLink({ version: 3, url: 'https://example.com/reports/am_test?v=3' }, fragment), fragment);
  assert.equal(presentation.reportFindingLink({ version: 3, url: '/reports/am_test?v=4' }, fragment), fragment);
  assert.equal(presentation.reportFindingLink({ version: 3, url: 'javascript:alert(1)' }, fragment), fragment);
});

test('a newly matched report image cannot inherit readiness from the previous verified hash', () => {
  const f = harness(); f.ready(); assert.equal(f.readyValues.at(-1), true);
  const nextHash = '9'.repeat(64);
  f.props.preview.review.report.inspection.front.imageSha256 = nextHash;
  f.props.workspace.sides.FRONT.frame.inspectionImageSha256 = nextHash;
  f.props.images.FRONT.inspection = { sha256: nextHash, url: 'blob:new-front' };
  f.render(); assert.equal(f.readyValues.at(-1), false);
  f.ready('Front'); assert.equal(f.readyValues.at(-1), true);
});

test('print appendix includes every numbered finding despite screen filters and preserves exact report metadata', () => {
  const props = fixture(); props.approved = true;
  props.publication = { version: 3, reportNumber: 'ATLAS-012345ABCDEF', approvedAt: '2026-09-22T00:00:00Z', reportHash: props.preview.reportHash };
  const before = structuredClone(props.preview), f = harness(props); f.ready();
  const entries = presentation.reportFindingEntries(props.preview.review.report.findings);
  f.control('Filter findings by side').props.onChange({ target: { value: 'BACK' } }); f.render();
  assert.ok(f.nodes(node => node.type === 'button' && node.props['aria-label']?.startsWith('Front 1 ·')).length === 0);
  f.listeners.get('beforeprint')(); f.render();
  for (const entry of entries) assert.equal(f.nodes(node => node.props?.['aria-label'] === `${entry.label} calculation`).length, 1);
  assert.equal(f.nodes(node => node.props?.className === 'rr-print-findings-intro').length, 1);
  assert.equal(f.nodes(node => node.props?.className === 'rr-report-reference' && node.props.open).length, 1);
  assert.equal(f.has(props.preview.reportHash), true); assert.equal(f.has('ATLAS-012345ABCDEF'), true); assert.equal(f.has('Version 3'), true);
  for (const finding of props.preview.review.explanation.findings) for (const region of finding.regions) {
    assert.ok(f.nodes(node => node.type === 'data' && node.props.value === region.weightedAreaMm2).length > 0);
    assert.ok(f.nodes(node => node.type === 'data' && node.props.value === region.marginalOverallEffect).length > 0);
  }
  f.listeners.get('afterprint')(); f.render();
  assert.equal(f.control('Filter findings by side').props.value, 'BACK');
  assert.equal(f.nodes(node => node.props?.className === 'rr-print-findings').length, 0);
  assert.equal(f.readyValues.at(-1), true); assert.deepEqual(props.preview, before);
});

function presentedReport() {
  const f = fixture(), { report, explanation } = f.preview.review, token = `ar_${'a'.repeat(24)}`;
  const publication = { version: 1, approvedAt: '2026-09-22T00:00:00Z', reportHash: f.preview.reportHash, reportNumber: 'ATLAS-TEST', url: `/reports/${token}?v=1` };
  return { report, explanation, images: f.images, publication, presentation: {
    version: 'atlas-report-presentation-v1', revision: 1, updatedAt: '2026-09-22T00:00:00Z',
    binding: { publicToken: token, approvalVersion: 1, publicHash: f.preview.reportHash },
    identityDetails: { category: 'Basketball', variant: 'Silver', cardType: 'Rookie' },
    slabPhoto: { url: `/api/reports/${token}/presentation/image?v=1&revision=1`, width: 800, height: 1200, alt: 'Actual slab photo' },
  } };
}

test('full card details preserve exact saved identity; optional metadata cannot replace approved name or set', () => {
  const props = presentedReport(), before = structuredClone(props.report);
  props.report.identity.parallel = 'Prizm'; props.report.identity.insert = 'Special insert'; props.report.identity.cardNumber = '001';
  props.presentation.identityDetails.name = 'Incorrect override'; props.presentation.identityDetails.productSet = 'Wrong set';
  const f = harness(props, { publicView: true });
  assert.ok(f.control('Card details')); for (const label of ['Basketball','Silver','Rookie','Prizm','Special insert','001','Local only']) assert.equal(f.has(label), true, label);
  assert.equal(f.has('Incorrect override'), false); assert.equal(f.has('Wrong set'), false);
  assert.equal(f.has('MARKET ESTIMATE'), false); assert.equal(f.has('YOUR NEXT MOVE'), false);
  assert.deepEqual(props.report.grade, before.grade);
  const historical = harness(); assert.ok(historical.control('Card details')); assert.equal(historical.has('Silver'), false);
});

test('presentation with a different report version or hash is omitted while the exact approved report remains readable', () => {
  for (const update of [value => value.binding.approvalVersion++, value => { value.binding.publicHash = 'b'.repeat(64); }, value => { value.binding.publicToken = `ar_${'b'.repeat(24)}`; }]) {
    const props = presentedReport(); update(props.presentation); const f = harness(props, { publicView: true });
    assert.equal(f.has('APPROVED GRADE'), true); assert.equal(f.has('Silver'), false);
    assert.equal(f.nodes(node => node.props.className === 'rr-slab-hero').length, 0);
  }
});

test('actual slab photo is optional and failure never changes calibrated-image readiness or the saved grade', () => {
  const props = presentedReport(), before = structuredClone(props.report), f = harness(props, { publicView: true }); f.ready();
  assert.equal(f.button('Print approved report').props.disabled, false);
  const hero = f.control('Graded card photograph'); assert.ok(hero);
  f.nodes(node => node.type === 'img' && node.props.alt === 'Actual slab photo')[0].props.onError(); f.render();
  assert.equal(f.nodes(node => node.props.className === 'rr-slab-hero').length, 0);
  assert.equal(f.button('Print approved report').props.disabled, false); assert.deepEqual(props.report, before);
});

test('photo tilt is bounded, leaves touch scrolling alone, resets for paper and honors reduced motion', () => {
  const props = presentedReport(), f = harness(props, { publicView: true }), hero = f.control('Graded card photograph');
  const plane = f.nodes(node => node.props.className === 'rr-slab-plane')[0].props.ref.current;
  const event = pointerType => ({ pointerType, clientX: 5000, clientY: 5000, currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 400 }) } });
  hero.props.onPointerMove(event('touch')); assert.equal(plane.style['--rr-tilt-x'], undefined);
  hero.props.onPointerMove(event('mouse')); assert.equal(plane.style['--rr-tilt-x'], '-4deg'); assert.equal(plane.style['--rr-tilt-y'], '4deg');
  f.listeners.get('beforeprint')(); f.render(); assert.equal(plane.style['--rr-tilt-x'], '0deg');
  assert.equal(f.nodes(node => node.props.className === 'rr-card-details').length, 1);
  const reduced = harness(presentedReport(), { publicView: true, reducedMotion: true }); reduced.control('Graded card photograph').props.onPointerMove(event('mouse'));
  assert.equal(reduced.nodes(node => node.props.className === 'rr-slab-plane')[0].props.ref.current.style['--rr-tilt-x'], undefined);
});

test('market references sort recent sales with original grader/currency, undisclosed offers stay unknown and empty sections stay hidden', () => {
  const props = presentedReport(); delete props.presentation.slabPhoto;
  props.presentation.market = { observedAt: '2026-09-22T00:00:00Z', sales: [
    { id: 'old', title: 'Older sale', listingUrl: 'https://www.ebay.com/itm/123', soldAt: '2026-08-22T00:00:00Z', grader: 'PSA', grade: '9', priceMinor: 10000, currency: 'USD', priceBasis: 'sold' },
    { id: 'recent', title: 'Recent undisclosed sale', listingUrl: 'https://www.ebay.com/itm/456', soldAt: '2026-09-20T00:00:00Z', grader: 'CGC', grade: '9.5', priceMinor: null, currency: 'USD', priceBasis: 'accepted_offer_unknown' },
  ] };
  props.presentation.dealerOffers = [{ id: 'expired', dealerName: 'Expired shop', dealerUrl: '/dealers?dealer=shop&service=buy', expiresAt: '2001-01-01T00:00:00Z', amountMinor: 999999, currency: 'USD', kind: 'firm', terms: 'Terms' }];
  props.presentation.dealerDirectory = { url: '/dealers?service=buy' };
  const before = structuredClone(props.report), f = harness(props, { publicView: true });
  const rows = all(f.control('eBay sold reference table'), node => node.type === 'tbody')[0].props.children[0]; assert.ok(text(rows[0]).includes('Recent undisclosed'));
  assert.equal(f.has('Amount undisclosed'), true); assert.equal(f.has('USD 100.00'), true);
  assert.equal(f.has('Expired shop'), false); assert.equal(f.has('MARKET ESTIMATE'), false);
  f.control('Filter sales by grader').props.onChange({ target: { value: 'PSA' } }); f.render();
  assert.equal(f.has('Recent undisclosed sale'), false); assert.equal(f.has('Older sale'), true);
  assert.ok(f.nodes(node => node.type === 'a' && node.props.href === '/dealers?service=buy').length);
  assert.deepEqual(props.report, before);
});

test('machine packet exposes proposed evidence and one deliberate review slot only after both verified photographs', () => {
  const source=fixture(), original=source.preview.review.report;
  const {inspection,...rest}=original;
  const report={...rest,version:'atlas-machine-provisional-report-v1',authority:'MACHINE_PROPOSAL',certification:null,proposedGrade:original.finalGrade,
    findings:original.findings.map(f=>({...f,origin:'DETECTOR',reviewResult:'UNREVIEWED'})),
    geometry:Object.fromEntries(['FRONT','BACK'].map(side=>[side,{frame:{inspectionImageSha256:inspection[side.toLowerCase()].imageSha256},centeringQuad:[]}]))};
  const props={packet:{report,reportHash:source.preview.reportHash,explanation:source.preview.review.explanation,images:source.images},children:'EXPLICIT_HUMAN_APPROVAL'};
  const f=harness(props,{machine:true});
  assert.equal(f.has('ATLAS PROPOSAL · HUMAN REVIEW'),true); assert.equal(f.has('PROPOSED GRADE'),true);
  assert.equal(f.has('Exact confirmed markings'),false); assert.equal(f.has('Proposed'),true);
  assert.equal(f.readyValues.at(-1),false); f.ready('Front'); assert.equal(f.readyValues.at(-1),false);
  f.ready('Back'); assert.equal(f.readyValues.at(-1),true);
  assert.equal(report.inspection,undefined); assert.equal(report.certification,null);
  props.packet={...props.packet,report:{...report,geometry:{...report.geometry,FRONT:{...report.geometry.FRONT,frame:{inspectionImageSha256:'9'.repeat(64)}}}}};
  f.render(); assert.equal(f.readyValues.at(-1),false);
});

test('partial machine and corrected reports show verified evidence and measured findings without inventing grades or approval readiness',()=>{
  for(const corrected of [false,true]){
    const source=fixture(),original=source.preview.review.report,{inspection,...rest}=original;
    const report={...rest,version:corrected?'atlas-review-provisional-report-v1':'atlas-machine-provisional-report-v1',
      authority:corrected?'HUMAN_REVIEW_DRAFT':'MACHINE_PROPOSAL',certification:null,grade:null,proposedGrade:null,
      calculationState:'GEOMETRY_UNRESOLVED',unresolvedGeometry:[{side:'BACK',code:'PRINTED_GEOMETRY_UNRESOLVED'}],
      geometry:Object.fromEntries(['FRONT','BACK'].map(side=>[side,{frame:{inspectionImageSha256:inspection[side.toLowerCase()].imageSha256},centeringQuad:null}]))};
    report.limitations=['Capture glare may obscure damage.'];
    if(corrected)report.originalMachineEvidence={limitations:['Original unresolved border warning.']};
    const before=structuredClone(report),f=harness({packet:{report,reportHash:source.preview.reportHash,explanation:null,images:source.images},children:'OPEN_GEOMETRY'},{machine:true});
    assert.equal(f.has('Capture glare may obscure damage.'),true);
    if(corrected)assert.equal(f.has('Original machine warnings · historical evidence'),true);
    assert.equal(f.has('PARTIAL REPORT'),true);assert.equal(f.has('OPEN_GEOMETRY'),true);assert.equal(f.has('Centering needs review'),true);
    assert.equal(f.has('How this grade is calculated'),false);assert.equal(f.has('ATLAS / 10'),false);assert.equal(f.has('unavailable until the missing centering geometry is resolved'),true);
    f.ready();assert.equal(f.readyValues.at(-1),false,'verified photos cannot make an incomplete grade approvable');
    const finding=report.findings.find(value=>value.side==='BACK');
    f.control('Back 1 · '+finding.defectType.toLowerCase().replaceAll('_',' ')).props.onClick();f.render();
    assert.ok(f.control('Selected finding measurements'));assert.equal(f.has('Measured area'),true);assert.equal(f.has('Marginal unrounded overall effect'),false);
    const area=presentation.reportFindingRegions(finding)[0].measurement.areaMm2;
    assert.ok(f.nodes(node=>node.type==='data'&&node.props.value===area).length);
    f.listeners.get('beforeprint')();f.render();assert.ok(f.control('All included finding measurements'));
    assert.deepEqual(report,before);
  }
});
test('malformed partial packets never display fabricated grades or accept stale explanation',()=>{
  for(const alter of [report=>{report.proposedGrade=10;},report=>{report.unresolvedGeometry=[];},report=>{report.geometry.FRONT.frame.inspectionImageSha256='wrong';}]){
    const source=fixture(),original=source.preview.review.report;
    const report={...original,version:'atlas-machine-provisional-report-v1',authority:'MACHINE_PROPOSAL',certification:null,
      grade:null,proposedGrade:null,calculationState:'GEOMETRY_UNRESOLVED',unresolvedGeometry:[{side:'BACK',code:'PRINTED_GEOMETRY_UNRESOLVED'}],
      geometry:Object.fromEntries(['FRONT','BACK'].map(side=>[side,{frame:{inspectionImageSha256:original.inspection[side.toLowerCase()].imageSha256},centeringQuad:null}]))};
    alter(report);const f=harness({packet:{report,reportHash:source.preview.reportHash,explanation:source.preview.review.explanation,images:source.images},children:'APPROVAL_SLOT'},{machine:true});
    assert.equal(f.has('APPROVAL_SLOT'),false);assert.equal(f.readyValues.at(-1),false);assert.equal(presentation.reportAwardedGrade(report),null);
  }
});
test('an excluded old-frame removed trace supplies neither current report bounds nor measurements',()=>{
  const finding={...fixture().preview.review.report.findings[0],reviewResult:'REMOVED',geometryExclusion:{version:'atlas-geometry-exclusion-v1'}};
  assert.equal(presentation.reportFindingBounds(finding),null);assert.equal(presentation.reportFindingMask(finding),null);
  assert.deepEqual(presentation.reportFindingRegions(finding),[]);
});

test('clean comparison uses identical verified photograph and camera; blueprint includes disconnected trace pixels',()=>{
 const f=harness();f.ready();f.control('Inspect Front finding 1: visible whitening').props.onClick({stopPropagation(){}});f.render();
 const toggle=label=>f.nodes(node=>node.type==='label'&&text(node).includes(label))[0].props.children.flat(Infinity).find(node=>node?.type==='input');
 toggle('Unmarked defect comparison').props.onChange({target:{checked:true}});toggle('Measurement callouts').props.onChange({target:{checked:true}});f.render();
 const planes=f.nodes(node=>node.props.className==='rr-plane'),active=planes[0],clean=planes[1];
 assert.deepEqual(clean.props.style,active.props.style);
 const images=all(clean,node=>node.type==='img');assert.equal(images.length,1);assert.equal(images[0].props.src,'blob:FRONT');
 assert.equal(all(clean,node=>node.type==='canvas'||node.type==='svg'||node.type==='button').length,0);
 assert.ok(presentation.reportMarkedSpan(f.props.preview.review.report.findings[0]).mm>15.1);assert.ok(f.has('maximum marked span'));assert.ok(f.has('not additive'));assert.ok(f.control('Front finding dimensions and grade effect'));
 f.control('Zoom in').props.onClick();f.render();const changed=f.nodes(node=>node.props.className==='rr-plane');assert.deepEqual(changed[0].props.style,changed[1].props.style);
});

test('card identity is available directly from the inspection dock',()=>{
 const f=harness();f.click('Card details');assert.ok(f.nodes(node=>node.props.className==='rr-inline-details').length);assert.ok(f.has('Synthetic report'));
});


test('rapid finding selection follows its actual side with comparison explicitly optional',()=>{
 const props=fixture();props.inspectionMode='findings';const f=harness(props);f.ready();
 assert.equal(f.control('Front report image').props.hidden,false);assert.equal(f.control('Back report image').props.hidden,true);
 f.control('Inspect Back finding 1: visible whitening').props.onClick({stopPropagation(){}});f.render();
 assert.equal(f.control('Front report image').props.hidden,true);assert.equal(f.control('Back report image').props.hidden,false);
 assert.equal(f.nodes(node=>node.props['aria-label']==='Back clean close-up; same photograph, zoom and position').length,0);
 const toggle=f.nodes(node=>node.type==='label'&&text(node).includes('Unmarked defect comparison'))[0].props.children.flat(Infinity).find(node=>node?.type==='input');
 toggle.props.onChange({target:{checked:true}});f.render();
 const clean=f.control('Back clean close-up; same photograph, zoom and position');
 assert.equal(all(clean,n=>n.type==='img')[0].props.src,'blob:BACK');
 const active=f.control('Back report inspection');assert.deepEqual(all(active,n=>n.props.className==='rr-plane')[0].props.style,all(clean,n=>n.props.className==='rr-plane')[0].props.style);
});


test('clean photo removes saved markings and guides, retains camera, and restores the exact evidence view', () => {
  const f = harness(); f.ready(); f.click('Browse next');
  const before = structuredClone(f.props.preview), camera = f.nodes(node => node.props.className === 'rr-plane')[0].props.style;
  f.click('Clean photo');
  assert.equal(f.button('Clean photo').props['aria-pressed'], true);
  assert.equal(f.nodes(node => node.props.className === 'rr-finding-markers').length, 0);
  assert.equal(f.nodes(node => node.type === 'polygon' || node.props.className === 'rr-blueprint').length, 0);
  assert.deepEqual(f.nodes(node => node.props.className === 'rr-plane')[0].props.style, camera);
  assert.equal(f.readyValues.at(-1), true);
  f.click('Clean photo');
  assert.ok(f.nodes(node => node.props.className === 'rr-finding-markers').length > 0);
  assert.deepEqual(f.props.preview, before);
});

test('report details stay disclosed on screen and fully open for print without changing evidence', () => {
  const f = harness(); f.ready(); const before = structuredClone(f.props.preview);
  const disclosures = () => f.nodes(node => ['rr-calculation', 'rr-provenance', 'rr-machine-details rr-identity-disclosure'].includes(node.props.className));
  assert.equal(disclosures().length, 3);
  assert.ok(disclosures().every(node => node.type === 'details' && !node.props.open));
  f.listeners.get('beforeprint')(); f.render();
  assert.ok(disclosures().every(node => node.props.open));
  f.listeners.get('afterprint')(); f.render();
  assert.ok(disclosures().every(node => !node.props.open));
  assert.deepEqual(f.props.preview, before);
});


test('returning to a Back inspection without a selected finding restores the Back photograph and camera', () => {
  const source=fixture(), original=source.preview.review.report, {inspection,...rest}=original;
  const report={...rest,version:'atlas-machine-provisional-report-v1',authority:'MACHINE_PROPOSAL',certification:null,proposedGrade:original.finalGrade,
    geometry:Object.fromEntries(['FRONT','BACK'].map(side=>[side,{frame:{inspectionImageSha256:inspection[side.toLowerCase()].imageSha256},centeringQuad:[]}]))};
  const context={side:'BACK',findingId:null,imageSha256:inspection.back.imageSha256,view:{zoom:4,pan:{x:0,y:0}},size:{width:400,height:540}};
  const props={packet:{report,reportHash:source.preview.reportHash,explanation:source.preview.review.explanation,images:source.images},initialInspection:context};
  const f=harness(props,{machine:true}); f.ready();
  assert.equal(f.control('Front report image').props.hidden,true);
  assert.equal(f.control('Back report image').props.hidden,false);
  assert.equal(f.button('Back').props['aria-pressed'],true);
  assert.equal(parseFloat(text(f.control('Current zoom'))),4);
});

function historicalPublicReport(key = 'abomasnow') {
  const source = JSON.parse(readFileSync(new URL('../../../docs/atlas/design/first-look/reports/approved.json', import.meta.url), 'utf8')).reports.find(entry => entry.key === key);
  const { packet } = source;
  return { report: packet.report, explanation: source.explanation, geometry: packet.geometry,
    images: Object.fromEntries(['FRONT', 'BACK'].map(side => [side, { inspection: {
      sha256: packet.report.inspection[side.toLowerCase()].imageSha256, url: `blob:${key}-${side}`,
    } }])), publication: { version: packet.approvalVersion, approvedAt: packet.approvedAt,
      reportNumber: packet.reportNumber, reportHash: source.publicHash, url: source.source } };
}
const publicSection = f => f.control('Explore approved report evidence').props['data-section'];
const planeIn = node => all(node, value => value.props?.className === 'rr-plane')[0];
const activePhoto = (f, side = 'Back') => f.control(`${side} report inspection`);
const selectedPublicId = f => f.control('All findings').props.value;
const selectPublicId = (f, id) => { f.control('All findings').props.onChange({ target: { value: id } }); f.render(); };
const publicFindingButton = (f, number) => f.nodes(node => node.type === 'button'
  && node.props['aria-label']?.startsWith(`Inspect Back ${number}:`))[0];
const nearPublic = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`);

test('public overview exposes every finding directly; comparison and return preserve all labels and identity', () => {
  const props = historicalPublicReport(), before = structuredClone(props.report), f = harness(props, { publicView: true }); f.ready();
  f.click('Back 13');
  assert.equal(publicSection(f), 'whole'); assert.equal(selectedPublicId(f), '');
  const allLabels = () => f.nodes(node => node.type === 'button' && node.props['aria-label']?.startsWith('Inspect Back '));
  assert.equal(allLabels().length, 13, 'all individual labels are visible without expanding a group');
  assert.equal(f.nodes(node => node.props.className?.includes('rr-spatial-area')).length, 0);
  assert.equal(f.has('Show areas'), false);
  const button = publicFindingButton(f, 1), first = props.report.findings[0]; assert.ok(button);
  const silhouette = all(button, node => node.type === 'path')[0].props.d;
  const expected = presentation.reportTraceSpans(presentation.reportFindingMask(first))
    .map(span => `M${span.x} ${span.y}h${span.width}v1h${-span.width}Z`).join('');
  assert.equal(silhouette, expected, 'silhouette retains every saved row span');
  button.props.onClick(); f.render();
  assert.equal(publicSection(f), 'finding'); assert.equal(selectedPublicId(f), first.id);
  const sections = () => f.nodes(node => ['rr-public-finding-navigation', 'rr-public-viewers'].includes(node.props.className)).map(node => node.props.className);
  assert.deepEqual(sections(), ['rr-public-finding-navigation', 'rr-public-viewers'], 'one navigator stays above the close-up');
  const marked = planeIn(activePhoto(f)), clean = planeIn(f.control('Back clean close-up; same photograph, zoom and position'));
  assert.equal(JSON.stringify(marked.props.style), JSON.stringify(clean.props.style));
  assert.equal(all(marked, node => node.type === 'img')[0].props.src, all(clean, node => node.type === 'img')[0].props.src);
  assert.ok(parseFloat(text(f.control('Current zoom'))) > 1);
  f.click('Whole card'); assert.equal(publicSection(f), 'whole'); assert.equal(selectedPublicId(f), '');
  assert.deepEqual(sections(), ['rr-public-viewers', 'rr-public-finding-navigation']);
  assert.equal(planeIn(activePhoto(f)).props.style.width, planeIn(activePhoto(f, 'Front')).props.style.width);
  assert.equal(allLabels().length, 13); assert.equal(publicFindingButton(f, 1).props['aria-pressed'], true);
  f.click('Findings 13'); assert.equal(selectedPublicId(f), first.id);
  const element = activePhoto(f).props.ref.current;
  activePhoto(f).props.onKeyDown({ key: 'Escape', target: element, currentTarget: element, preventDefault() {}, stopPropagation() {} }); f.render();
  assert.equal(publicSection(f), 'whole'); assert.equal(selectedPublicId(f), '');
  assert.equal(allLabels().length, 13);
  assert.equal(publicFindingButton(f, 1).props['aria-pressed'], true); assert.deepEqual(props.report, before);
});

test('public Findings opens the populated opposite side and an empty report keeps truthful photograph and centering views', () => {
  const f = harness(historicalPublicReport(), { publicView: true }); f.ready();
  assert.equal(f.control('Front report image').props.hidden, true);
  assert.equal(f.nodes(node => node.type === 'image' && node.props.href === 'blob:abomasnow-FRONT').length, 1);
  f.click('Findings 13'); assert.equal(f.control('Back report image').props.hidden, false);
  assert.equal(selectedPublicId(f), f.props.report.findings[0].id);
  const empty = harness(historicalPublicReport('dart'), { publicView: true }); empty.ready();
  const before = structuredClone(empty.props.report);
  assert.equal(empty.nodes(node => node.props['aria-label'] === 'All findings').length, 0);
  assert.equal(empty.has('No included damage findings on Front.'), true);
  empty.click('Findings 0'); empty.click('Explore centering →');
  assert.equal(publicSection(empty), 'centering'); assert.ok(empty.control('Front saved centering ratios'));
  empty.click('Whole card'); assert.equal(publicSection(empty), 'whole');
  assert.equal(empty.nodes(node => node.props.className?.includes('rr-spatial-target')).length, 0);
  assert.deepEqual(empty.props.report, before);
});

test('public deep links select the exact saved finding only for the matching public report hash', () => {
  const props = historicalPublicReport(), finding = props.report.findings[8];
  const fragment = presentation.reportFindingFragment(props.publication.reportHash, finding.id);
  const f = harness(props, { publicView: true, fragment }); f.ready();
  assert.equal(publicSection(f), 'finding'); assert.equal(selectedPublicId(f), finding.id);
  assert.equal(f.control('Back report image').props.hidden, false);
  assert.equal(f.nodes(node => node.type === 'a' && node.props.href.endsWith(fragment)).length, 1);
  const wrong = harness(historicalPublicReport(), { publicView: true,
    fragment: presentation.reportFindingFragment('1'.repeat(64), finding.id) }); wrong.ready();
  assert.equal(publicSection(wrong), 'whole'); assert.equal(selectedPublicId(wrong), '');
  const wrongImage = historicalPublicReport(); wrongImage.images.BACK.inspection.sha256 = '2'.repeat(64);
  const denied = harness(wrongImage, { publicView: true, fragment }); denied.ready();
  assert.equal(denied.button('Print approved report').props.disabled, true);
  assert.equal(all(denied.control('Back report image'), node => node.type === 'canvas').length, 0);
  assert.equal(denied.has('saved photograph is unavailable'), true);
});

test('public printing retains decoded viewers, fits both sides, prints every finding and restores overview/selection', () => {
  const props = historicalPublicReport(), before = structuredClone(props.report), f = harness(props, { publicView: true }); f.ready();
  f.click('Back 13');
  const refs = ['Front', 'Back'].map(side => activePhoto(f, side).props.ref.current);
  const entries = presentation.reportFindingEntries(props.report.findings);
  const checkPrint = () => {
    f.listeners.get('beforeprint')(); f.render();
    for (const [index, side] of ['Front', 'Back'].entries()) {
      assert.equal(activePhoto(f, side).props.ref.current, refs[index], 'viewer survives beforeprint');
      assert.equal(f.control(`${side} report image`).props.hidden, false);
      const photo = all(activePhoto(f, side), node => node.type === 'img' && node.props.alt.includes('saved inspection'))[0];
      assert.equal(photo.props.style.visibility, 'visible');
      assert.ok(planeIn(activePhoto(f, side)).props.style.width < 400, 'paper uses whole-card framing');
    }
    assert.equal(f.button('Print approved report').props.disabled, false);
    assert.equal(f.nodes(node => node.props.className === 'rr-viewport rr-clean-viewport').length, 0);
    for (const entry of entries) assert.equal(f.nodes(node => node.props['aria-label'] === `${entry.label} calculation`).length, 1);
    assert.equal(f.has(props.publication.reportHash), true);
    f.listeners.get('afterprint')(); f.render();
    assert.equal(f.button('Print approved report').props.disabled, false);
  };
  checkPrint(); assert.equal(publicSection(f), 'whole'); assert.ok(publicFindingButton(f, 1));
  selectPublicId(f, props.report.findings[12].id); checkPrint();
  assert.equal(publicSection(f), 'finding'); assert.equal(selectedPublicId(f), props.report.findings[12].id);
  assert.ok(f.control('Back clean close-up; same photograph, zoom and position'));
  assert.deepEqual(props.report, before);
});

test('public centering instruments preserve saved outlines and calibrated extent without half-pixel correction', () => {
  const props = historicalPublicReport(), before = structuredClone(props.geometry), f = harness(props, { publicView: true }); f.ready();
  const expected = { Front: { Top: 3, Right: 2.75, Bottom: 2.75, Left: 2.7 }, Back: { Top: 3.8, Right: 3.2, Bottom: 3.65, Left: 3.35 } };
  for (const side of ['Front', 'Back']) {
    if (side === 'Back') { f.click('Back 13'); assert.equal(publicSection(f), 'centering', 'side switching retains centering mode'); }
    else f.click('Centering');
    const photo = activePhoto(f, side), overlay = all(photo, node => node.props['aria-label'] === 'Saved border measurements in millimeters')[0]; assert.ok(overlay);
    const labels = all(overlay, node => node.props.className === 'rr-instrument-label');
    assert.equal(labels.length, 4);
    for (const label of labels) {
      const name = text(all(label, node => node.type === 'small')[0]);
      nearPublic(parseFloat(text(all(label, node => node.type === 'b')[0])), expected[side][name]);
    }
    const saved = props.geometry[side.toUpperCase()];
    assert.equal(all(photo, node => node.props.className === 'rr-physical-line')[0].props.points,
      saved.physicalQuad.map(point => `${point.x * 1270},${point.y * 1778}`).join(' '));
    assert.equal(all(photo, node => node.props.className === 'rr-printed-line')[0].props.points,
      saved.printedQuad.map(point => `${point.x * 1270},${point.y * 1778}`).join(' '));
    const scale = viewportMath.fitInspectionScale({ width: 400, height: 540 }, 64);
    const right = all(overlay, node => node.props.className === 'rr-instrument-underlay')[1].props.d.match(/^M([^ ]+) ([^L]+)L([^ ]+) ([^ ]+)/);
    nearPublic(Number(right[1]), 200 + (1310 - 675) * scale);
    nearPublic(Number(right[3]), 200 + (40 + saved.printedQuad[1].x * 1270 - 675) * scale);
    const readout = f.control(`${side} saved centering ratios`);
    const recorded = props.explanation.sides[side.toUpperCase()].centering;
    assert.ok(text(readout).includes(recorded.leftRightBalance[0].toLocaleString('en-US', { maximumFractionDigits: 4 })));
  }
  assert.deepEqual(props.geometry, before);
});

test('public clean-pane wheel, pan and pinch update the same camera and reject cross-pane pointer mixing', () => {
  const props = historicalPublicReport(), before = structuredClone(props.report), f = harness(props, { publicView: true }); f.ready(); f.click('Findings 13');
  const clean = () => f.control('Back clean close-up; same photograph, zoom and position');
  const equalCameras = () => assert.equal(JSON.stringify(planeIn(activePhoto(f)).props.style), JSON.stringify(planeIn(clean()).props.style));
  equalCameras();
  const cleanElement = clean().props.ref.current;
  const event = (id, x, y, element = cleanElement) => ({ pointerId: id, pointerType: 'touch', button: 0,
    clientX: x, clientY: y, preventDefault() {}, currentTarget: element });
  const beforeWheel = planeIn(clean()).props.style.width;
  cleanElement.listeners.get('wheel')({ deltaY: 120, deltaMode: 0, clientX: 180, clientY: 260, preventDefault() {}, currentTarget: cleanElement }); f.render();
  assert.notEqual(planeIn(clean()).props.style.width, beforeWheel); equalCameras();
  const panStart = planeIn(clean()).props.style.transform;
  clean().props.onPointerDown(event(1, 100, 200));
  activePhoto(f).props.onPointerDown(event(2, 200, 200, activePhoto(f).props.ref.current));
  const width = planeIn(clean()).props.style.width;
  clean().props.onPointerMove(event(1, 130, 180)); f.render();
  assert.equal(planeIn(clean()).props.style.width, width, 'a finger on the other pane cannot create a pinch');
  assert.notEqual(planeIn(clean()).props.style.transform, panStart); equalCameras();
  clean().props.onPointerUp(event(1, 130, 180)); f.render();
  clean().props.onPointerDown(event(3, 100, 200)); clean().props.onPointerDown(event(4, 200, 200));
  clean().props.onPointerMove(event(4, 250, 200)); f.render();
  assert.ok(planeIn(clean()).props.style.width > width); equalCameras();
  clean().props.onPointerUp(event(4, 250, 200)); clean().props.onPointerUp(event(3, 100, 200)); f.render();
  assert.equal(selectedPublicId(f), props.report.findings[0].id); assert.deepEqual(props.report, before);
});

test('public motion retreats, locates and approaches; gestures, reselection and reduced motion cancel stale animation', () => {
  const props = historicalPublicReport(), f = harness(props, { publicView: true, controlledFrames: true }); f.ready(); f.click('Findings 13');
  assert.equal(f.control('Back report image').props['data-motion-phase'], 'approach'); f.finishMotion();
  selectPublicId(f, props.report.findings[1].id);
  assert.equal(f.control('Back report image').props['data-motion-phase'], 'retreat');
  f.frame(); f.frame(); assert.equal(f.control('Back report image').props['data-motion-phase'], 'locate');
  nearPublic(parseFloat(text(f.control('Current zoom'))), 1);
  f.frame(); f.frame(); assert.equal(f.control('Back report image').props['data-motion-phase'], 'approach');
  f.finishMotion(); assert.equal(f.control('Back report image').props['data-motion-phase'], 'idle');
  selectPublicId(f, props.report.findings[2].id); assert.ok(f.pendingFrames() > 0);
  const viewport = activePhoto(f), element = viewport.props.ref.current;
  const event = { pointerId: 7, pointerType: 'touch', button: 0, clientX: 120, clientY: 200, currentTarget: element, preventDefault() {} };
  viewport.props.onPointerDown(event); f.render(); assert.equal(f.pendingFrames(), 0);
  assert.equal(f.control('Back report image').props['data-motion-phase'], 'idle');
  activePhoto(f).props.onPointerCancel(event); f.render();
  selectPublicId(f, props.report.findings[3].id); selectPublicId(f, props.report.findings[4].id);
  assert.equal(f.pendingFrames(), 1, 'only the most recent itinerary is scheduled'); f.finishMotion();
  assert.equal(selectedPublicId(f), props.report.findings[4].id);
  const target = viewportMath.focusInspectionBounds(presentation.reportFindingBounds(props.report.findings[4]), { width: 400, height: 540 });
  const scale = viewportMath.fitInspectionScale({ width: 400, height: 540 });
  nearPublic(planeIn(activePhoto(f)).props.style.width, 1350 * scale * target.zoom);
  const reduced = harness(historicalPublicReport(), { publicView: true, controlledFrames: true, reducedMotion: true }); reduced.ready(); reduced.click('Findings 13');
  assert.equal(reduced.pendingFrames(), 0); assert.equal(reduced.control('Back report image').props['data-motion-phase'], 'idle');
  assert.ok(parseFloat(text(reduced.control('Current zoom'))) > 1);
});

const activeFingerprint = f => f.nodes(node => node.props.className === 'rr-fingerprint-layer' && !node.props.hidden)[0];
const openFingerprint = f => { f.control('ATLAS Card fingerprint').props.onClick(); f.render(); };
const awaitFingerprint = async f => {
  for (let i = 0; i < 300; i++) { f.render(); if (activeFingerprint(f)?.props['data-status'] === 'ready') return; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.fail('fingerprint did not prepare');
};

test('public fingerprint waits for the exact photo, shows honest empty sides and leaves all evidence unchanged', () => {
  const props = historicalPublicReport(), before = structuredClone(props), f = harness(props, { publicView: true });
  assert.equal(f.control('ATLAS Card fingerprint').props.disabled, true); f.ready();
  assert.equal(publicSection(f), 'whole', 'report arrival never hides findings for an intro');
  openFingerprint(f); assert.equal(publicSection(f), 'fingerprint');
  assert.equal(activeFingerprint(f).props['data-status'], 'empty'); assert.equal(f.has('No recorded defects on this side'), true);
  assert.equal(f.button('Play tide').props.disabled, true); assert.equal(f.button('Print approved report').props.disabled, false);
  f.click('Back 13'); assert.equal(publicSection(f), 'fingerprint'); assert.equal(activeFingerprint(f).props['data-status'], 'preparing');
  f.click('Centering'); assert.equal(publicSection(f), 'centering'); assert.equal(activeFingerprint(f), undefined);
  f.click('Whole card'); assert.equal(f.nodes(node => node.type === 'button' && node.props['aria-label']?.startsWith('Inspect Back ')).length, 13);
  assert.deepEqual(props.report, before.report); assert.deepEqual(props.images, before.images); assert.deepEqual(props.explanation, before.explanation);
  f.unmount();
  const bad = historicalPublicReport(); bad.images.FRONT.inspection.sha256 = 'a'.repeat(64);
  const denied = harness(bad, { publicView: true }); denied.ready(); assert.equal(denied.control('ATLAS Card fingerprint').props.disabled, true);
  assert.equal(denied.nodes(node => node.props.className === 'rr-fingerprint-layer' && !node.props.hidden).length, 0); denied.unmount();
});

test('real public tide returns to the same photograph, cancels on navigation/print/unmount and never changes paper findings', async () => {
  const props = historicalPublicReport(), before = structuredClone(props.report), f = harness(props, { publicView: true, controlledFrames: true }); f.ready(); f.click('Back 13'); f.finishMotion();
  const url = all(activePhoto(f), node => node.type === 'img')[0].props.src;
  openFingerprint(f); await awaitFingerprint(f); assert.equal(f.pendingFrames(), 1);
  f.finishMotion(); assert.equal(activeFingerprint(f).props.ref.current.style['--rr-fingerprint-amount'], '1');
  f.click('← Return to photograph'); f.finishMotion(); assert.equal(publicSection(f), 'whole');
  assert.equal(all(activePhoto(f), node => node.type === 'img')[0].props.src, url);
  assert.equal(f.nodes(node => node.type === 'button' && node.props['aria-label']?.startsWith('Inspect Back ')).length, 13);
  openFingerprint(f); assert.equal(f.pendingFrames(), 1); f.click('Findings 13'); f.finishMotion(); assert.equal(publicSection(f), 'finding');
  openFingerprint(f); f.frame(500); f.listeners.get('beforeprint')(); f.render();
  assert.equal(f.pendingFrames(), 0); assert.equal(f.nodes(node => node.props.className === 'rr-fingerprint-layer').length, 0);
  for (const { label } of presentation.reportFindingEntries(props.report.findings)) assert.equal(f.nodes(node => node.props['aria-label'] === `${label} calculation`).length, 1);
  f.listeners.get('afterprint')(); f.render(); assert.equal(f.button('Print approved report').props.disabled, false);
  f.click('Whole card'); openFingerprint(f); await awaitFingerprint(f); f.unmount(); assert.equal(f.pendingFrames(), 0);
  assert.deepEqual(props.report, before);
});

test('reduced-motion public fingerprint renders a direct state and source replacement cannot reuse old artwork', async () => {
  const f = harness(historicalPublicReport(), { publicView: true, controlledFrames: true, reducedMotion: true }); f.ready(); f.click('Back 13');
  openFingerprint(f); await awaitFingerprint(f); assert.equal(f.pendingFrames(), 0);
  assert.equal(activeFingerprint(f).props.ref.current.style['--rr-fingerprint-amount'], '1');
  f.click('Play tide'); assert.equal(f.pendingFrames(), 0); assert.equal(publicSection(f), 'fingerprint');
  f.props.report = { ...f.props.report, findings: f.props.report.findings.slice(1) };
  f.props.explanation = { ...f.props.explanation, findings: f.props.explanation.findings.slice(1) }; f.render();
  assert.equal(activeFingerprint(f).props['data-status'], 'preparing');
  assert.equal(all(activeFingerprint(f), node => node.type === 'canvas')[0].props.style.visibility, 'hidden');
  f.click('← Return to photograph'); assert.equal(publicSection(f), 'whole'); assert.equal(f.pendingFrames(), 0); f.unmount();
});

test('desktop whole card preserves both verified photographs, every direct shape, and original category zoom', () => {
  const props = historicalPublicReport(), before = structuredClone(props), f = harness(props, { publicView: true, desktop: true }); f.ready();
  for (const side of ['Front', 'Back']) assert.equal(f.control(`${side} report image`).props.hidden, true, 'exact inspector stays mounted for drill-in');
  assert.equal(f.nodes(node => node.type === 'image' && /blob:/.test(node.props.href)).length, 2);
  const shapes = () => f.nodes(node => node.props.className === 'finding-hit');
  assert.equal(shapes().length, 13);
  assert.equal(f.nodes(node => node.type === 'button' && node.props['aria-label']?.startsWith('Inspect Back ')).length, 13);
  assert.equal(f.nodes(node => node.props.className?.includes('rr-spatial-area')).length, 0);
  f.click('Surface');
  const frontWidth = planeIn(activePhoto(f, 'Front')).props.style.width;
  f.control('Photograph to zoom').props.onChange({ target: { value: 'BACK' } }); f.render();
  f.control('Zoom in').props.onClick(); f.render();
  assert.equal(planeIn(activePhoto(f, 'Front')).props.style.width, frontWidth);
  assert.ok(planeIn(activePhoto(f, 'Back')).props.style.width > frontWidth);
  f.click('Whole card');
  const shape = shapes().find(node => node.props['data-finding-id'] === props.report.findings[5].id);
  assert.ok(shape); shape.props.onClick(); f.render();
  assert.equal(publicSection(f), 'finding'); assert.equal(selectedPublicId(f), props.report.findings[5].id);
  assert.equal(shapes().length, 0, 'detail uses exact trace without enlarged overview targets');
  assert.ok(f.control('Back clean close-up; same photograph, zoom and position'));
  f.click('Whole card'); assert.equal(shapes().length, 13);
  assert.deepEqual(props.report, before.report); assert.deepEqual(props.geometry, before.geometry);
});

test('category inspection fields preserve saved memberships and original numbers on drill-in', () => {
  const props = historicalPublicReport(), before = structuredClone(props.report), f = harness(props, { publicView: true, desktop: true }); f.ready();
  const entries = presentation.reportFindingEntries(props.report.findings);
  for (const category of ['corners', 'edges', 'surface']) {
    f.click(category[0].toUpperCase() + category.slice(1));
    const plan = category === 'corners' ? cornerTour.createCornerTour(props.report.findings) : category === 'edges' ? edgeTour.createEdgeTour(props.report.findings) : null;
    const ids = plan && new Set(plan.hits.map(hit => hit.finding.id));
    const expected = entries.filter(entry => ids ? ids.has(entry.finding.id) : entry.categories.includes(category));
    const options = () => all(f.control('All findings'), node => node.type === 'option' && node.props.value);
    assert.deepEqual(options().map(node => node.props.value), expected.map(entry => entry.finding.id));
    assert.ok(expected.every(entry => options().some(node => node.props.value === entry.finding.id && text(node).startsWith(entry.label))));
    if (plan) {
      assert.equal(f.nodes(node => node.props.className === 'rr-evidence-edge-scan').length, 2);
      assert.equal(f.nodes(node => node.props.className === 'rr-public-shape-target').length, 0);
      assert.equal(f.has('original grading categories retained'), true);
    }
    selectPublicId(f, expected[0].finding.id);
    assert.equal(publicSection(f), 'finding'); assert.ok(expected.some(entry => entry.finding.id === selectedPublicId(f)));
    f.click(`← ${category[0].toUpperCase() + category.slice(1)}`); assert.equal(publicSection(f), category);
  }
  f.click('Whole card');
  assert.equal(f.nodes(node => node.type === 'button' && node.props['aria-label']?.startsWith('Inspect Back ')).length, 13);
  assert.deepEqual(props.report, before);
});

test('public grade science uses actual saved weights, deductions, raw grade and rounding; category link opens evidence', () => {
  const props = historicalPublicReport(), before = structuredClone(props.report), f = harness(props, { publicView: true, desktop: true }); f.ready(); f.click('Grade science');
  assert.equal(publicSection(f), 'science');
  const story = f.control('A grade you can follow'), model = gradeStory.gradeStoryModel(props.explanation);
  assert.ok(model); assert.equal(model.raw, 9.85); assert.equal(model.final, 10); assert.equal(text(story).includes('9.35'), false);
  for (const value of [model.raw, model.final, model.deduction]) assert.ok(all(story, node => node.type === 'data' && node.props.value === value).length > 0);
  for (const row of model.rows) {
    const button = all(story, node => node.props.className === 'rr-grade-row' && node.props['aria-label'].startsWith(`${row.label}:`))[0];
    assert.ok(text(button).includes(`${row.weight * 100}%`));
    assert.ok(all(button, node => node.type === 'data' && node.props.value === row.score).length);
    assert.ok(all(button, node => node.type === 'data' && node.props.value === row.deduction).length);
  }
  assert.ok(text(story).includes(props.explanation.policy.finalGradeFormula));
  f.click('View centering measurements'); assert.equal(publicSection(f), 'centering');
  assert.deepEqual(props.report, before);
});

test('actual public grade animation restarts while playing, pauses, resumes and completes at the saved final grade', () => {
  const props = historicalPublicReport(), f = harness(props, { publicView: true, desktop: true, controlledFrames: true }); f.ready(); f.click('Grade science'); f.finishMotion();
  const story = () => f.control('A grade you can follow');
  f.click('Replay calculation'); assert.equal(story().props['data-motion'], 'playing');
  f.frame(); f.frame(); f.click('Restart calculation');
  assert.equal(story().props['data-motion'], 'playing'); assert.ok(f.pendingFrames() > 0, 'restart schedules a fresh animation');
  f.frame(); f.frame(); f.click('Pause calculation'); assert.equal(story().props['data-motion'], 'paused'); assert.equal(f.pendingFrames(), 0);
  f.click('Resume calculation'); assert.ok(f.pendingFrames() > 0); f.finishMotion();
  assert.equal(story().props['data-motion'], 'complete'); assert.equal(story().props['data-final'], true);
  assert.ok(text(story()).includes(`Final grade ${props.explanation.overall.finalGrade} · calculation complete`));
  const reduced = harness(historicalPublicReport(), { publicView: true, controlledFrames: true, reducedMotion: true }); reduced.ready(); reduced.click('Grade science'); reduced.click('Replay calculation');
  assert.equal(reduced.control('A grade you can follow').props['data-motion'], 'complete'); assert.equal(reduced.pendingFrames(), 0);
});

test('new report calculations show the global factor, policy bands and base weighted-area allowance on screen and paper', () => {
  const props = fixture(), before = structuredClone(props.preview), explanation = props.preview.review.explanation;
  assert.equal(explanation.policy.globalDamageMultiplier, 1.5);
  assert.equal(explanation.policy.conditionBands.find(band => band.score === 10).upperPercent, .01);
  const f = harness(props); f.ready();
  const values = node => all(node, item => item.type === 'data').map(item => item.props.value);
  const verifyCategories = () => {
    const scales = f.nodes(node => node.props.className === 'rr-threshold-scale');
    assert.equal(scales.filter(node => text(node).includes('10 band: ≤0.01%')).length, 6);
    assert.equal(scales.filter(node => text(node).includes('10 band: ≤55%')).length, 2);
    for (const [index, threshold] of f.nodes(node => node.props.className === 'rr-threshold'
      && text(node).includes('Scoring category damage')).entries()) {
      const scale = all(threshold, node => node.props.className === 'rr-threshold-scale')[0];
      assert.equal(text(all(scale, node => node.type === 'span').at(-1)), '0.1%');
      assert.ok(Math.abs(parseFloat(all(threshold, node => node.props.className === 'rr-threshold-ten')[0].props.style.width) - 10) < 1e-12);
      assert.ok(Math.abs(values(threshold)[0] - (index < 4 ? 0 : .025420940874)) < 1e-12, 'the scale shows adjusted scoring damage');
      assert.ok(Math.abs(parseFloat(all(threshold, node => node.props.className === 'rr-threshold-fill')[0].props.style.width)
        - (index < 4 ? 0 : 25.420940874)) < 1e-9, 'the marker uses the adjusted percentage');
    }
    const baseEquations = f.nodes(node => node.type === 'p' && text(node).startsWith('Weighted damage:') && text(node).includes('× 100'));
    assert.equal(baseEquations.length, 2);
    for (const equation of baseEquations) assert.deepEqual(values(equation), [.85, 5015.55, explanation.sides.FRONT.SURFACE.weightedDamagePercent]);
    const equations = f.nodes(node => node.type === 'p' && text(node).startsWith('Scoring damage:'));
    assert.equal(equations.length, 6);
    for (const [index, zone] of ['CORNERS', 'CORNERS', 'EDGES', 'EDGES', 'SURFACE', 'SURFACE'].entries()) {
      const value = explanation.sides[index % 2 ? 'BACK' : 'FRONT'][zone];
      assert.deepEqual(values(equations[index]), [value.weightedDamagePercent, 1.5, value.scoringDamagePercent]);
    }
    const allowances = f.nodes(node => node.type === 'p' && text(node).startsWith('Grade-10 allowance:'));
    assert.equal(allowances.length, 2);
    for (const allowance of allowances) {
      assert.ok(text(allowance).includes('before the global multiplier'));
      assert.ok(Math.abs(values(allowance)[0] - .33437) < 1e-12);
    }
    const policy = f.nodes(node => node.props.className === 'rr-policy')[0];
    assert.ok(all(policy, node => node.type === 'td' && text(node) === '9.5').length === 1);
  };
  verifyCategories();
  const finding = f.nodes(node => node.type === 'button' && node.props['aria-label']?.startsWith('Back 1 ·'))[0];
  finding.props.onClick(); f.render();
  const region = explanation.findings[1].regions[0];
  const equation = all(f.control('Selected finding calculation'), node => node.type === 'p' && text(node).includes('Scoring damage after global multiplier'))[0];
  assert.deepEqual(values(equation), [region.weightedDamagePercent, 1.5, region.scoringDamagePercent]);
  f.listeners.get('beforeprint')(); f.render(); verifyCategories();
  const printed = f.nodes(node => node.props.className === 'rr-print-findings')[0];
  assert.equal(all(printed, node => node.type === 'p' && text(node).includes('Scoring damage after global multiplier')).length, 2);
  f.listeners.get('afterprint')(); f.render();
  assert.deepEqual(props.preview, before); assert.equal(f.readyValues.at(-1), true);
});

test('saved historical reports keep original condition scale, arithmetic and allowance without a global policy field', () => {
  const props = historicalPublicReport(), before = structuredClone(props);
  assert.equal(props.explanation.policy.globalDamageMultiplier, undefined);
  const f = harness(props, { publicView: true }); f.ready(); f.click('Grade science');
  const thresholds = f.nodes(node => node.props.className === 'rr-threshold' && text(node).includes('Weighted category damage'));
  assert.equal(thresholds.length, 6);
  for (const threshold of thresholds) {
    assert.ok(text(threshold).includes('10 band: ≤0.2%'));
    const scale = all(threshold, node => node.props.className === 'rr-threshold-scale')[0];
    assert.equal(text(all(scale, node => node.type === 'span').at(-1)), '10%');
    assert.equal(all(threshold, node => node.props.className === 'rr-threshold-ten')[0].props.style.width, '2%');
  }
  assert.equal(f.has('before the global multiplier'), false);
  const equations = f.nodes(node => node.type === 'p' && text(node).startsWith('Weighted damage:') && text(node).includes('× 100'));
  assert.equal(equations.length, 3);
  assert.ok(equations.every(node => !text(node).includes('× 100 × ')));
  const allowances = f.nodes(node => node.type === 'p' && text(node).startsWith('Grade-10 allowance:'));
  assert.equal(allowances.length, 3);
  for (const [index, zone] of ['CORNERS', 'EDGES', 'SURFACE'].entries()) {
    const actual = all(allowances[index], node => node.type === 'data')[0].props.value;
    assert.ok(Math.abs(actual - props.explanation.sides.BACK[zone].tenBandMaxWeightedAreaMm2) < 1e-12);
  }
  f.click('Findings 13');
  const equation = all(f.control('Selected finding calculation'), node => node.type === 'p' && text(node).includes('Share of the edges area'))[0];
  assert.ok(equation); assert.equal(text(equation).includes('× 100 × '), false);
  assert.deepEqual(props.report, before.report); assert.deepEqual(props.explanation, before.explanation);
});

test('changing the bound inspection source suppresses the previous whole-card photograph immediately', () => {
  const props = historicalPublicReport('maye'), f = harness(props, { publicView: true, desktop: true }); f.ready();
  assert.equal(f.nodes(node => node.props.className === 'rr-approved-whole').length, 1);
  const oldURL = props.images.FRONT.inspection.url;
  f.props.report = { ...props.report, inspection: { ...props.report.inspection, front: { ...props.report.inspection.front, imageSha256: '9'.repeat(64) } } };
  f.props.images = { ...props.images, FRONT: { inspection: { sha256: '9'.repeat(64), url: 'blob:replacement-front' } } };
  f.render();
  assert.equal(f.nodes(node => node.props.className === 'rr-approved-whole').length, 0);
  assert.equal(f.nodes(node => node.type === 'image' && node.props.href === oldURL).length, 0);
  f.ready('Front');
  assert.equal(f.nodes(node => node.type === 'image' && node.props.href === 'blob:replacement-front').length, 1);
  assert.equal(f.nodes(node => node.type === 'image' && node.props.href === oldURL).length, 0);
  f.unmount();
});

test('whole-card pause and centering choices survive original-photo inspection and other report tabs', () => {
  const f = harness(historicalPublicReport('maye'), { publicView: true, desktop: true }); f.ready();
  f.click('Ⅱ Pause'); f.click('Centering on');
  f.nodes(node => node.type === 'button' && node.props.className?.startsWith('fc-label'))[0].props.onClick(); f.render();
  assert.equal(publicSection(f), 'finding');
  f.click('← Whole card'); assert.ok(f.button('▶ Play')); assert.ok(f.button('Centering off'));
  f.click('Surface'); f.click('Whole card'); assert.ok(f.button('▶ Play')); assert.ok(f.button('Centering off'));
  f.unmount();
});
