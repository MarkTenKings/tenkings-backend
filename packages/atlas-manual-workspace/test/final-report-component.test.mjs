import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as traceCodec from '@atlas/grading-core/trace-codec';
import { explainAtlasManualReport } from '@atlas/grading-core/manual-report';
import * as presentation from '../src/report-review-ui.mjs';
import * as optionalPresentation from '../src/report-presentation-ui.mjs';
import * as viewportMath from '../src/inspection-viewport.mjs';
import { defectBase, markDefectSideInspected, confirmDefectFindings, previewDefectReport } from '../src/defect-actions.mjs';
import { workspace } from './defect-fixtures.mjs';

const require = createRequire(new URL('../../../frontend/atlas-app/package.json', import.meta.url));
const babel = require('next/dist/compiled/babel/core'), nextRequire = createRequire(require.resolve('next/package.json'));
const sources = Object.fromEntries(['ReportInspectionImage', 'ReportPresentation', 'FinalReportReview'].map(name => [name, babel.transformSync(readFileSync(new URL(`../src/${name}.jsx`, import.meta.url), 'utf8'), {
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

function harness(props = fixture(), { publicView = false, machine = false, fragment = '', reducedMotion = false } = {}) {
  const instances = new Map(), elements = new Map(); let current, cursor, dirty, effects = [], tree;
  const listeners = new Map(), listenerSets = new Map(), browser = { location: { hash: fragment }, matchMedia: query => ({ matches: query.includes('reduced-motion') ? reducedMotion : true }),
    addEventListener(name, fn) { if (!listenerSets.has(name)) listenerSets.set(name, new Set()); listenerSets.get(name).add(fn); listeners.set(name, () => listenerSets.get(name)?.forEach(callback => callback())); },
    removeEventListener(name, fn) { listenerSets.get(name)?.delete(fn); }, print() {} };
  const memo = (make, deps) => { const i = cursor++, old = current[i]; if (!old || deps.some((v, j) => !Object.is(v, old.deps[j]))) current[i] = { deps, value: make() }; return current[i].value; };
  const react = { Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const i = cursor++, slots = current; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], change => { const next = typeof change === 'function' ? change(slots[i]) : change; if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true; } }]; },
    useRef(initial) { const i = cursor++; if (!(i in current)) current[i] = { current: initial }; return current[i]; }, useMemo: memo, useCallback: (callback, deps) => memo(() => callback, deps),
    useEffect(callback, deps) { const i = cursor++, slots = current, prior = slots[i]; if (!prior || deps.some((v, j) => !Object.is(v, prior.deps[j]))) { slots[i] = { deps, cleanup: prior?.cleanup }; effects.push(() => { slots[i].cleanup?.(); slots[i].cleanup = callback(); }); } },
  };
  const modules = {};
  for (const [name, code] of Object.entries(sources)) {
    const exports = {}; vm.runInNewContext(code, { exports, window: browser, setTimeout: (...args) => setTimeout(...args).unref(), clearTimeout, ResizeObserver: class { constructor(callback) { this.callback = callback; } observe(element) { element.resize = this.callback; } disconnect() {} }, require(name) {
      if (name === 'react') return react;
      if (name === 'react-dom') return { flushSync: callback => callback() };
      if (name === '@atlas/grading-core/trace-codec') return traceCodec;
      if (name === './inspection-viewport.mjs') return viewportMath;
      if (name === './report-review-ui.mjs') return presentation;
      if (name === './report-presentation-ui.mjs') return optionalPresentation;
      if (name === './ReportPresentation.jsx') return modules.ReportPresentation;
      if (name === './verified-image.mjs') return { useVerifiedImage: image => ({ url: image?.url }) };
      if (name === './ReportInspectionImage.jsx') return modules.ReportInspectionImage;
      return nextRequire(name.startsWith('@babel/runtime/') ? `next/dist/compiled/${name}` : name);
    } }); modules[name] = exports;
  }
  function expand(node, path = 'root') {
    if (Array.isArray(node)) return node.map((child, i) => expand(child, `${path}.${i}`));
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function') { const key = `${path}:${node.type.name}`; if (!instances.has(key)) instances.set(key, []); current = instances.get(key); cursor = 0; return expand(node.type(node.props), `${key}.out`); }
    if (node.props.ref && ['rr-viewport', 'rr-plane', 'rr-slab-plane'].includes(node.props.className)) {
      if (!elements.has(path)) elements.set(path, { clientWidth: 400, clientHeight: 540, listeners: new Map(), focus() {}, scrollIntoView(options) { this.scrollOptions = options; },
        style: { setProperty(name, value) { this[name] = value; } }, addEventListener(name, fn) { this.listeners.set(name, fn); }, removeEventListener(name) { this.listeners.delete(name); }, setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture() { return true; } });
      const element = elements.get(path); element.getBoundingClientRect = () => node.props.className === 'rr-plane' ? f.imageRect : f.viewportRect; node.props.ref.current = element;
    }
    return { ...node, props: { ...node.props, children: expand(node.props.children, `${path}.children`) } };
  }
  const f = { props, browser, listeners, readyValues: [], imageRect: { left: -40, top: -40, width: 1350, height: 1858 }, viewportRect: { left: 0, top: 0, width: 400, height: 540 } };
  f.props.onReadyChange = value => f.readyValues.push(value);
  f.render = () => { let rounds = 0; do { dirty = false; tree = expand({ type: modules.FinalReportReview[machine ? 'MachineReportReview' : publicView ? 'ApprovedReportView' : 'FinalReportReview'], props: f.props }); const pending = effects; effects = []; pending.forEach(callback => callback()); assert.ok(++rounds < 20); } while (dirty); return tree; };
  f.nodes = predicate => all(tree, predicate); f.has = value => text(tree).includes(value);
  f.control = label => { const node = f.nodes(node => node.props?.['aria-label'] === label)[0]; assert.ok(node, label); return node; };
  f.button = label => { const node = f.nodes(node => node.type === 'button' && text(node) === label)[0]; assert.ok(node, label); return node; };
  f.click = label => { const node = f.button(label); assert.equal(Boolean(node.props.disabled), false); node.props.onClick(); f.render(); };
  f.ready = side => { f.nodes(node => node.type === 'img' && typeof node.props.onLoad === 'function' && (side ? node.props.alt.startsWith(side) : /^(Front|Back)/.test(node.props.alt))).forEach(node => node.props.onLoad({ currentTarget: { naturalWidth: 1350, naturalHeight: 1858 } })); f.render(); };
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

test('finding filters and next/previous retain side numbering and never change approval evidence', () => {
  const f = harness(), before = structuredClone(f.props.preview); f.ready();
  f.control('Filter findings by side').props.onChange({ target: { value: 'BACK' } }); f.render();
  assert.equal(f.nodes(node => node.type === 'button' && node.props['aria-label']?.startsWith('Front 1 ·')).length, 0);
  assert.equal(f.nodes(node => node.type === 'button' && node.props['aria-label']?.startsWith('Back 1 ·')).length, 1);
  f.click('Next finding'); assert.ok(f.control('Back report zoom').props.value > 1); f.click('Previous finding');
  assert.equal(f.readyValues.at(-1), true); assert.deepEqual(f.props.preview, before);
  f.control('Filter findings by category').props.onChange({ target: { value: 'centering' } }); f.render();
  assert.equal(f.button('Next finding').props.disabled, true); assert.equal(f.has('Centering uses the saved border geometry'), true);
});

test('deep links select only a finding in the exact report and honor reduced motion', () => {
  const props = fixture(), finding = props.preview.review.report.findings.find(value => value.side === 'BACK');
  const fragment = presentation.reportFindingFragment(props.preview.reportHash, finding.id);
  const f = harness(props, { fragment, reducedMotion: true }); f.ready();
  assert.ok(f.control('Back report zoom').props.value > 1);
  assert.equal(f.control('Back report inspection').props.ref.current.scrollOptions.behavior, 'auto');
  assert.equal(f.nodes(node => node.type === 'a' && node.props.href === fragment).length, 1);
  const wrong = harness(fixture(), { fragment: fragment.replace('f'.repeat(64), 'a'.repeat(64)) }); wrong.ready();
  assert.equal(wrong.control('Back report zoom').props.value, 1);
  assert.equal(presentation.reportFindingFromFragment(fragment + '&finding=another', props.preview.reportHash, props.preview.review.report.findings), null);
});

test('touch pinch changes view without selecting a finding and keyboard remains available', () => {
  const f = harness(), before = structuredClone(f.props.preview); f.ready();
  const event = (id, x, y) => ({ pointerId: id, pointerType: 'touch', button: 0, clientX: x, clientY: y, preventDefault() {}, currentTarget: f.control('Front report inspection').props.ref.current });
  f.control('Front report inspection').props.onPointerDown(event(1, 100, 200));
  f.control('Front report inspection').props.onPointerDown(event(2, 200, 200));
  f.control('Front report inspection').props.onPointerMove(event(2, 300, 200)); f.render();
  assert.equal(f.control('Front report zoom').props.value, 2);
  f.control('Front report inspection').props.onPointerUp(event(2, 300, 200));
  f.control('Front report inspection').props.onPointerUp(event(1, 100, 200)); f.render();
  assert.equal(f.nodes(node => node.props?.['aria-label'] === 'Selected finding calculation').length, 0);
  const viewport = f.control('Front report inspection').props.ref.current;
  f.control('Front report inspection').props.onKeyDown({ key: '0', target: viewport, currentTarget: viewport, preventDefault() {} }); f.render();
  assert.equal(f.control('Front report zoom').props.value, 1); assert.deepEqual(f.props.preview, before);
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
  const f = harness(props); f.ready(); assert.equal(f.button('Printed border').props.disabled, false); f.click('Printed border');
  assert.equal(f.nodes(node => node.props?.className === 'rr-printed-line').length, 1);
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
  assert.equal(f.has('ASTRA PROPOSAL · HUMAN REVIEW'),true); assert.equal(f.has('PROPOSED GRADE'),true);
  assert.equal(f.has('Exact confirmed markings'),false); assert.equal(f.has('Proposed'),true);
  assert.equal(f.readyValues.at(-1),false); f.ready('Front'); assert.equal(f.readyValues.at(-1),false);
  f.ready('Back'); assert.equal(f.readyValues.at(-1),true);
  assert.equal(report.inspection,undefined); assert.equal(report.certification,null);
  props.packet={...props.packet,report:{...report,geometry:{...report.geometry,FRONT:{...report.geometry.FRONT,frame:{inspectionImageSha256:'9'.repeat(64)}}}}};
  f.render(); assert.equal(f.readyValues.at(-1),false);
});
