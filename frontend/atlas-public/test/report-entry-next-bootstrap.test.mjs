import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { captureCardDetailReportEntry, readCardDetailReportEntry, REPORT_ENTRY_HISTORY_KEY, REPORT_ENTRY_STORAGE_KEY } from '@atlas/site-router/report-entry';

const require = createRequire(import.meta.url), babel = require('next/dist/compiled/babel/core');
const Router = require('next/dist/shared/lib/router/router').default;
const nextRequire = createRequire(require.resolve('next/package.json'));
const code = babel.transformSync(readFileSync(new URL('../components/ReportEntryNavigation.jsx', import.meta.url), 'utf8'), {
  filename: 'ReportEntryNavigation.jsx', presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } } }]], babelrc: false, configFile: false,
}).code;
const origin = 'https://atlasgrading.com', token = `ar_${'a'.repeat(24)}`, reportPath = `/reports/${token}?v=2`;
const cardPath = '/admin/graded-cards/95ef2d5a-0d49-425f-bd8f-30fa1e444516', now = 1792627200000;
const context = () => ({ version: 1, origin, reportPath, cardPath, createdAt: now });

function browser(saved) {
  const values = new Map(), listeners = new Map(), replacements = [];
  return { location: new URL(origin + reportPath), __NEXT_DATA__: { gssp: true }, replacements,
    sessionStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) },
    history: { state: { __N: true, key: 'previous-document', ...(saved ? { [REPORT_ENTRY_HISTORY_KEY]: saved } : {}) },
      replaceState(state, title, url) { this.state = state; replacements.push({ state, url }); } },
    addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener(name) { listeners.delete(name); },
  };
}

// Execute the actual page module before creating Next's actual Pages Router,
// matching next/dist/client/index.js hydrate() entrypoint ordering. No mocked
// replaceState lifecycle: the installed production router performs that write.
function loadNavigation(b, time = now + 1) {
  const exports = {}, slots = [], effects = []; let cursor = 0;
  const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const id = cursor++; if (!(id in slots)) slots[id] = initial; return [slots[id], value => { slots[id] = value; }]; },
    useEffect(fn) { const id = cursor++; if (!(id in slots)) { slots[id] = true; effects.push(fn); } },
  };
  vm.runInNewContext(code, { exports, require(name) {
    if (name === 'react') return react;
    if (name === '@atlas/site-router/report-entry') return { captureCardDetailReportEntry: () => captureCardDetailReportEntry(b, time), readCardDetailReportEntry: path => readCardDetailReportEntry(path, b, time) };
    if (name.endsWith('.module.css')) return { navigation: 'navigation' };
    return nextRequire(name.startsWith('@babel/runtime/') ? `next/dist/compiled/${name}` : name);
  }, window: b });
  return () => { cursor = 0; exports.default({ reportPath }); effects.splice(0).forEach(effect => effect()); cursor = 0; return exports.default({ reportPath }); };
}

async function nextBootstrap(b) {
  const previous = { window: globalThis.window, self: globalThis.self, nodeEnv: process.env.NODE_ENV };
  globalThis.window = b; globalThis.self = b; process.env.NODE_ENV = 'production';
  try {
    const router = new Router('/reports/[token]', { token, v: '2' }, reportPath, {
      initialProps: { __N_SSP: true, pageProps: {} }, pageLoader: { getMiddleware: async () => [] },
      App() {}, Component() {}, wrapApp: app => app, subscription() {}, isFallback: false, isPreview: false,
    });
    await router._initialMatchesMiddlewarePromise;
    assert.equal(b.replacements.length, 1);
    assert.equal(b.history.state.as, reportPath);
    assert.equal(b.history.state.__N, true);
    assert.equal(b.history.state[REPORT_ENTRY_HISTORY_KEY], undefined, 'Next bootstrap discards custom history fields');
  } finally {
    if (previous.window === undefined) delete globalThis.window; else globalThis.window = previous.window;
    if (previous.self === undefined) delete globalThis.self; else globalThis.self = previous.self;
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous.nodeEnv;
  }
}

test('real Next bootstrap reproduces the old reload failure; prebootstrap capture preserves the rendered return link', async () => {
  const withoutCapture = browser(context());
  await nextBootstrap(withoutCapture);
  assert.equal(readCardDetailReportEntry(reportPath, withoutCapture, now + 1), null, 'old effect-only reader loses the return');

  const reloaded = browser(context()), render = loadNavigation(reloaded);
  await nextBootstrap(reloaded);
  const tree = render();
  assert.equal(tree.type, 'nav'); assert.equal(tree.props.children[0].props.href, cardPath);
  assert.deepEqual(reloaded.history.state[REPORT_ENTRY_HISTORY_KEY], context());
  assert.equal(reloaded.history.state.as, reportPath, 'Next state retained alongside restored entry');
  assert.equal(reloaded.location.href, origin + reportPath);
  assert.equal(reloaded.sessionStorage.getItem(REPORT_ENTRY_STORAGE_KEY), null);
});

test('real Next bootstrap leaves direct/new-tab/NFC and expired entry navigation empty', async () => {
  for (const saved of [undefined, { ...context(), reportPath: reportPath.replace('?v=2', '?v=1') }, { ...context(), createdAt: now - 30 * 60 * 1000 - 1 }]) {
    const b = browser(saved), render = loadNavigation(b);
    await nextBootstrap(b); assert.equal(render(), null);
    assert.equal(b.sessionStorage.getItem(REPORT_ENTRY_STORAGE_KEY), null);
  }
});
