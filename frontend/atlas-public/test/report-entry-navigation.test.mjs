import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { captureCardDetailReportEntry, readCardDetailReportEntry, REPORT_ENTRY_STORAGE_KEY } from '@atlas/site-router/report-entry';

const require = createRequire(import.meta.url), babel = require('next/dist/compiled/babel/core');
const nextRequire = createRequire(require.resolve('next/package.json'));
function compile(path) {
  return babel.transformSync(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    filename: path, presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } } }]], babelrc: false, configFile: false,
  }).code;
}
const navigationCode = compile('../components/ReportEntryNavigation.jsx'), reportCode = compile('../pages/reports/[token].jsx');
const reportPath = `/reports/ar_${'a'.repeat(24)}?v=2`, now = 1792627200000;
const cardPath = '/admin/graded-cards/95ef2d5a-0d49-425f-bd8f-30fa1e444516', origin = 'https://atlasgrading.com';
const context = () => ({ version: 1, origin, reportPath, cardPath, createdAt: now });
const element = (type, props, ...children) => ({ type, props: { ...props, children } });
const fallbackRequire = name => nextRequire(name.startsWith('@babel/runtime/') ? `next/dist/compiled/${name}` : name);

function harness(pending) {
  let cursor = 0, dirty = false;
  const slots = [], effects = [], listeners = new Map(), exports = {}, storage = new Map();
  if (pending !== undefined) storage.set(REPORT_ENTRY_STORAGE_KEY, JSON.stringify(pending));
  const browser = { location: { href: `${origin}${reportPath}` },
    sessionStorage: { getItem: key => storage.get(key) ?? null, removeItem: key => storage.delete(key) },
    history: { state: { __N: true }, replaceState(state) { this.state = state; } },
    addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key),
  };
  const react = { createElement: element,
    useState(initial) { const id = cursor++; if (!(id in slots)) slots[id] = initial; return [slots[id], value => { slots[id] = value; dirty = true; }]; },
    useEffect(fn, deps) { const id = cursor++, old = slots[id]; if (!old || deps.some((value, i) => old.deps[i] !== value)) { slots[id] = { deps }; effects.push(() => { old?.cleanup?.(); slots[id].cleanup = fn(); }); } },
  };
  vm.runInNewContext(navigationCode, { exports, window: browser, require(name) {
    if (name === 'react') return react;
    if (name === '@atlas/site-router/report-entry') return {
      captureCardDetailReportEntry: () => captureCardDetailReportEntry(browser, now),
      readCardDetailReportEntry: path => readCardDetailReportEntry(path, browser, now),
    };
    if (name.endsWith('.module.css')) return { navigation: 'navigation' };
    return fallbackRequire(name);
  } });
  const f = { browser, listeners, reportPath };
  f.beforeEffects = () => { cursor = 0; dirty = false; f.tree = exports.default({ reportPath: f.reportPath }); };
  f.render = () => { let count = 0; do { f.beforeEffects(); effects.splice(0).forEach(run => run()); assert.ok(++count < 10); } while (dirty); };
  f.close = () => slots.forEach(slot => slot?.cleanup?.());
  f.beforeEffects(); return f;
}

test('public host navigation is absent on SSR and direct/certificate/NFC entry', () => {
  const f = harness(); assert.equal(f.tree, null); f.render(); assert.equal(f.tree, null); f.close();
});

test('established local entry renders a semantic top-left return link with no public payload change', () => {
  const f = harness(context()); assert.equal(f.tree, null); f.render();
  assert.equal(f.tree.type, 'nav'); assert.equal(f.tree.props['aria-label'], 'Report navigation');
  const link = f.tree.props.children[0];
  assert.equal(link.type, 'a'); assert.equal(link.props.href, cardPath);
  assert.equal(link.props.referrerPolicy, 'no-referrer'); assert.equal(link.props.rel, 'noreferrer');
  assert.equal(link.props.children[1], ' Card Detail');
  assert.equal(f.browser.location.href, `${origin}${reportPath}`);
  assert.ok(f.listeners.has('pageshow')); f.close(); assert.equal(f.listeners.size, 0);
});

test('invalid return context and a different report never render the prior card link', () => {
  for (const value of [{ ...context(), cardPath: '//evil.test/' }, { ...context(), cardPath: '/account/private' }, { ...context(), createdAt: now - 120001 }]) {
    const f = harness(value); f.render(); assert.equal(f.tree, null); f.close();
  }
  const f = harness(context()); f.render(); assert.ok(f.tree);
  f.reportPath = reportPath.replace('?v=2', '?v=1');
  f.beforeEffects(); assert.equal(f.tree, null, 'old link is hidden before the new effect'); f.close();
});

test('report host preserves exact saved report, geometry, images, publication and server payload', async () => {
  const exports = {}, images = { FRONT: { status: 'READY' }, BACK: { status: 'READY' } };
  const packet = { publicToken: `ar_${'a'.repeat(24)}`, reportNumber: 'ATLAS-ABCDEF123456', approvalVersion: 2,
    approvedAt: '2026-10-20T01:00:00.000Z', report: { identity: { playerName: 'Saved card' }, finalGrade: 8.5, findings: [{ id: 'saved-finding' }] }, geometry: { FRONT: { saved: true } } };
  const props = { packet, publicHash: 'a'.repeat(64), explanation: { saved: true }, presentation: { state: 'PUBLISHED' }, reportImages: { saved: true } };
  const before = JSON.stringify(props);
  let selector, unavailable = false;
  vm.runInNewContext(reportCode, { exports, require(name) {
    if (name === 'react') return { createElement: element };
    if (name === 'next/head') return 'Head';
    if (name === 'next/link') return 'Link';
    if (name.endsWith('/ReportGuidance')) return 'ReportGuidance';
    if (name.endsWith('/ReportEntryNavigation')) return 'ReportEntryNavigation';
    if (name.endsWith('/policy.mjs')) return { publicHeaders() {}, reportSelector: (token, version) => ({ token, version: version === undefined ? null : Number(version) }) };
    if (name.endsWith('/runtime.mjs')) return { runtime: () => ({ read: value => { selector = value; if (unavailable) throw new Error('Unavailable'); return props; } }) };
    if (name === '@atlas/manual-workspace/report-review') return { ApprovedReportView: 'ApprovedReportView' };
    if (name.endsWith('/useInspectionImages.mjs')) return { useInspectionImages: () => images };
    return fallbackRequire(name);
  } });
  const tree = exports.default(props), children = tree.props.children;
  const navigation = children.find(node => node?.type === 'ReportEntryNavigation');
  const report = children.find(node => node?.type === 'ApprovedReportView');
  assert.equal(navigation.props.reportPath, reportPath);
  for (const key of ['report', 'geometry']) assert.equal(report.props[key], packet[key]);
  for (const key of ['explanation', 'presentation']) assert.equal(report.props[key], props[key]);
  assert.equal(report.props.images, images);
  assert.deepEqual(JSON.parse(JSON.stringify(report.props.publication)), { publicToken: packet.publicToken, reportNumber: packet.reportNumber, version: 2,
    approvedAt: packet.approvedAt, reportHash: props.publicHash, url: reportPath });
  const result = await exports.getServerSideProps({ res: {}, req: {}, params: { token: packet.publicToken }, query: { v: '2', returnTo: cardPath } });
  assert.equal(result.props, props);
  assert.deepEqual(JSON.parse(JSON.stringify(selector)), { token: packet.publicToken, version: 2 });
  assert.equal(JSON.stringify(props), before);
  assert.doesNotMatch(JSON.stringify(props), /admin\/graded-cards|returnTo/);
  unavailable = true;
  const res = {}, failed = await exports.getServerSideProps({ res, req: {}, params: { token: packet.publicToken }, query: { v: '2', returnTo: cardPath } });
  assert.equal(res.statusCode, 503);
  assert.deepEqual(JSON.parse(JSON.stringify(failed.props)), { unavailable: true, unavailableReportPath: reportPath });
  const failurePage = exports.default(failed.props);
  assert.equal(failurePage.props.children.find(node => node?.type === 'ReportEntryNavigation').props.reportPath, reportPath);
  const directFailure = await exports.getServerSideProps({ res: {}, req: {}, params: { token: packet.publicToken }, query: {} });
  assert.equal(directFailure.props.unavailableReportPath, null);
});
