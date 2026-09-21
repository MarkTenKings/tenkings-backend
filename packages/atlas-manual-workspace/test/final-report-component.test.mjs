import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as traceCodec from '@atlas/grading-core/trace-codec';
import { explainAtlasManualReport } from '@atlas/grading-core/manual-report';
import * as presentation from '../src/report-review-ui.mjs';
import * as viewportMath from '../src/inspection-viewport.mjs';
import { defectBase, markDefectSideInspected, confirmDefectFindings, previewDefectReport } from '../src/defect-actions.mjs';
import { workspace } from './defect-fixtures.mjs';

const require = createRequire(new URL('../../../frontend/atlas-app/package.json', import.meta.url));
const babel = require('next/dist/compiled/babel/core'), nextRequire = createRequire(require.resolve('next/package.json'));
const sources = Object.fromEntries(['ReportInspectionImage', 'FinalReportReview'].map(name => [name, babel.transformSync(readFileSync(new URL(`../src/${name}.jsx`, import.meta.url), 'utf8'), {
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

function harness(props = fixture()) {
  const instances = new Map(), elements = new Map(); let current, cursor, dirty, effects = [], tree;
  const memo = (make, deps) => { const i = cursor++, old = current[i]; if (!old || deps.some((v, j) => !Object.is(v, old.deps[j]))) current[i] = { deps, value: make() }; return current[i].value; };
  const react = { Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const i = cursor++, slots = current; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], change => { const next = typeof change === 'function' ? change(slots[i]) : change; if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true; } }]; },
    useRef(initial) { const i = cursor++; if (!(i in current)) current[i] = { current: initial }; return current[i]; }, useMemo: memo, useCallback: (callback, deps) => memo(() => callback, deps),
    useEffect(callback, deps) { const i = cursor++, slots = current, prior = slots[i]; if (!prior || deps.some((v, j) => !Object.is(v, prior.deps[j]))) { slots[i] = { deps, cleanup: prior?.cleanup }; effects.push(() => { slots[i].cleanup?.(); slots[i].cleanup = callback(); }); } },
  };
  const modules = {};
  for (const [name, code] of Object.entries(sources)) {
    const exports = {}; vm.runInNewContext(code, { exports, ResizeObserver: class { constructor(callback) { this.callback = callback; } observe(element) { element.resize = this.callback; } disconnect() {} }, require(name) {
      if (name === 'react') return react;
      if (name === '@atlas/grading-core/trace-codec') return traceCodec;
      if (name === './inspection-viewport.mjs') return viewportMath;
      if (name === './report-review-ui.mjs') return presentation;
      if (name === './verified-image.mjs') return { useVerifiedImage: image => ({ url: image?.url }) };
      if (name === './ReportInspectionImage.jsx') return modules.ReportInspectionImage;
      return nextRequire(name.startsWith('@babel/runtime/') ? `next/dist/compiled/${name}` : name);
    } }); modules[name] = exports;
  }
  function expand(node, path = 'root') {
    if (Array.isArray(node)) return node.map((child, i) => expand(child, `${path}.${i}`));
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function') { const key = `${path}:${node.type.name}`; if (!instances.has(key)) instances.set(key, []); current = instances.get(key); cursor = 0; return expand(node.type(node.props), `${key}.out`); }
    if (node.props.ref && ['rr-viewport', 'rr-plane'].includes(node.props.className)) {
      if (!elements.has(path)) elements.set(path, { clientWidth: 400, clientHeight: 540, listeners: new Map(), focus() {}, scrollIntoView() {},
        addEventListener(name, fn) { this.listeners.set(name, fn); }, removeEventListener(name) { this.listeners.delete(name); }, setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture() { return true; } });
      const element = elements.get(path); element.getBoundingClientRect = () => node.props.className === 'rr-plane' ? f.imageRect : f.viewportRect; node.props.ref.current = element;
    }
    return { ...node, props: { ...node.props, children: expand(node.props.children, `${path}.children`) } };
  }
  const f = { props, readyValues: [], imageRect: { left: -40, top: -40, width: 1350, height: 1858 }, viewportRect: { left: 0, top: 0, width: 400, height: 540 } };
  f.props.onReadyChange = value => f.readyValues.push(value);
  f.render = () => { let rounds = 0; do { dirty = false; tree = expand({ type: modules.FinalReportReview.FinalReportReview, props: f.props }); const pending = effects; effects = []; pending.forEach(callback => callback()); assert.ok(++rounds < 20); } while (dirty); return tree; };
  f.nodes = predicate => all(tree, predicate); f.has = value => text(tree).includes(value);
  f.control = label => { const node = f.nodes(node => node.props?.['aria-label'] === label)[0]; assert.ok(node, label); return node; };
  f.button = label => { const node = f.nodes(node => node.type === 'button' && text(node) === label)[0]; assert.ok(node, label); return node; };
  f.click = label => { const node = f.button(label); assert.equal(Boolean(node.props.disabled), false); node.props.onClick(); f.render(); };
  f.ready = side => { f.nodes(node => node.type === 'img' && (!side || node.props.alt.startsWith(side))).forEach(node => node.props.onLoad({ currentTarget: { naturalWidth: 1350, naturalHeight: 1858 } })); f.render(); };
  f.render(); return f;
}

test('full report keeps approval readiness separate until both exact photographs load', () => {
  const f = harness(); assert.equal(f.readyValues.at(-1), false); assert.equal(f.has('DRAFT GRADE'), true);
  f.ready('Front'); assert.equal(f.readyValues.at(-1), false); f.ready('Back'); assert.equal(f.readyValues.at(-1), true);
  assert.equal(f.has('How this grade is calculated'), true); assert.equal(f.has('rounded directly from'), true);
  assert.equal(f.nodes(node => node.type === 'img').length, 2);
});

test('selecting an included finding focuses its side and renders core measurements without changing report bytes', () => {
  const f = harness(), before = structuredClone(f.props.preview); f.ready();
  const buttons = f.nodes(node => node.type === 'button' && text(node).startsWith('Back 1 ·')); assert.equal(buttons.length, 1);
  buttons[0].props.onClick(); f.render();
  assert.equal(f.has('Selected finding'), false); assert.ok(f.control('Back report zoom').props.value > 1);
  assert.ok(f.control('Selected finding calculation')); assert.equal(f.has('Measured area'), true); assert.equal(f.has('Marginal unrounded overall effect'), true);
  const expected = f.props.preview.review.explanation.findings.find(finding => finding.side === 'BACK').regions[0].weightedAreaMm2;
  assert.ok(f.nodes(node => node.type === 'data' && node.props.value === expected).length > 0);
  assert.deepEqual(f.props.preview, before);
});

test('report viewer supports 16x, overlays, expansion and image-only magnifier with no command interface', () => {
  const f = harness(), before = structuredClone(f.props.workspace); f.ready();
  f.control('Front report zoom').props.onChange({ target: { value: '16' } }); f.render(); assert.equal(f.control('Front report zoom').props.value, 16);
  f.click('Hide findings'); assert.equal(f.nodes(node => node.props.className === 'rr-finding-markers').length, 1);
  f.click('Expand image'); assert.equal(f.control('Back report image').props.hidden, true); f.click('Return to pair'); assert.equal(f.control('Back report image').props.hidden, false);
  f.click('3× magnifier'); f.control('Front report inspection').props.onPointerMove({ clientX: 200, clientY: 200 }); f.render();
  const lens = f.nodes(node => node.props.className === 'rr-magnifier')[0]; assert.ok(lens.props.style.backgroundImage.includes('blob:FRONT'));
  assert.deepEqual(f.props.workspace, before);
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
  props.preview.review.explanation = explainAtlasManualReport(report);
  const f = harness(props); assert.equal(f.has('Original historical grade'), true); assert.equal(f.has('retains its original tenth-point policy'), true);
  assert.equal(f.has('Final ATLAS grade, rounded to the nearest half point'), false);
});
