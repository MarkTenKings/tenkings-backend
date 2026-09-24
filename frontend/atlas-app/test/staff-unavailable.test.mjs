import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as routes from '../lib/routes.mjs';
const require = createRequire(import.meta.url), babel = require('next/dist/compiled/babel/core');
const compile = (source, filename) => babel.transformSync(source, { filename,
  presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } } }]], babelrc: false, configFile: false }).code;
const compiled = compile(readFileSync(new URL('../components/Shell.jsx', import.meta.url), 'utf8'), 'Shell.jsx');
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree && typeof tree === 'object' ? text(tree.props?.children) : tree ?? '';
function all(tree, predicate, result = []) {
  if (Array.isArray(tree)) tree.forEach(node => all(node, predicate, result));
  else if (tree && typeof tree === 'object') { if (predicate(tree)) result.push(tree); all(tree.props?.children, predicate, result); }
  return result;
}
function render(accessFailure) {
  const exports = {}, navigation = [], forbidden = () => assert.fail('Recovery UI must not issue API calls, credentials, or effects');
  vm.runInNewContext(compiled, { exports, window: { location: { href: 'https://atlasgrading.com/admin/manual?tab=intake', assign: value => navigation.push(value) } },
    require(name) {
      if (name === 'react') return { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), useState: forbidden };
      if (name === 'next/link') return 'link'; if (name === 'next/head') return 'head'; if (name === 'next/router') return { useRouter: forbidden };
      if (name === '../lib/routes.mjs') return routes;
      if (name === '../lib/client') return { api: forbidden };
      if (name === '@atlas/finishing-station/browser') return { clearStationBrowserCredential: forbidden };
      if (name === '../lib/workspace-client.mjs' || name.endsWith('.module.css') || name === './AtlasBrand') return {};
      return require(name.startsWith('@babel/runtime/') ? `next/dist/compiled/${name}` : name);
    } });
  const tree = exports.Unavailable({ accessFailure }); return { tree, navigation };
}
test('unknown and transient failures explain the access check and offer only user-driven GET navigation', () => {
  for (const accessFailure of [undefined, { kind: 'CHECK_FAILED', reference: 'ad39a84d-a916-4f65-a671-03f713624f47' }]) {
    const f = render(accessFailure); assert.match(text(f.tree), /couldn’t check your staff access/); assert.doesNotMatch(text(f.tree), /not enabled here/);
    assert.equal(f.navigation.length, 0);
    const retry = all(f.tree, node => node.type === 'button' && text(node) === 'Try again')[0];
    assert.equal(retry.props.type, 'button'); retry.props.onClick();
    assert.deepEqual(f.navigation, ['https://atlasgrading.com/admin/manual?tab=intake']);
    const link = all(f.tree, node => node.type === 'a')[0]; assert.equal(link.props.href, '/admin?reauthenticate=1');
  }
});
test('explicit disabled deployment points to the active workspace and configuration failures remain distinct', () => {
  const disabled = render({ kind: 'DISABLED' }); assert.match(text(disabled.tree), /Staff access is not enabled here/);
  assert.equal(all(disabled.tree, node => node.type === 'a')[0].props.href, 'https://atlasgrading.com/admin?reauthenticate=1');
  const configuration = render({ kind: 'CONFIGURATION' }); assert.match(text(configuration.tree), /needs configuration/);
  const feature = render({ kind: 'FEATURE_DISABLED' }); assert.match(text(feature.tree), /This workspace is not enabled/);
  assert.doesNotMatch(text(feature.tree), /Staff access is not enabled/);
});
test('diagnostic UI displays only a valid opaque reference, never arbitrary reason/code text', () => {
  const f = render({ kind: 'CHECK_FAILED', reference: 'private-token-sentinel', code: 'private-token-sentinel', message: 'private-token-sentinel' });
  assert.doesNotMatch(text(f.tree), /private-token-sentinel/);
  assert.match(text(render({ kind: 'CHECK_FAILED', reference: 'ad39a84d-a916-4f65-a671-03f713624f47' }).tree), /Reference: ad39a84d/);
});
test('every staff page forwards the safe category without rendering its protected workspace on failure', () => {
  const pages = ['index.jsx', 'grading.jsx', 'add-cards.jsx', 'manual/index.jsx', 'manual/[cardId].jsx', 'batch.jsx', 'station.jsx', 'workspace/[cardId].jsx', 'cards/[cardId].jsx', 'operations.jsx'];
  for (const page of pages) {
    const exports = {}, code = compile(readFileSync(new URL('../pages/' + page, import.meta.url), 'utf8'), page);
    vm.runInNewContext(code, { exports, require(name) {
      if (name === 'react') return { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) };
      if (name.endsWith('/components/Shell')) return { default: 'shell', Unavailable: 'unavailable', Notice: 'notice', __esModule: true };
      if (name.startsWith('@babel/runtime/')) return require(`next/dist/compiled/${name}`);
      return {};
    } });
    const failure = { kind: 'CHECK_FAILED', reference: 'ad39a84d-a916-4f65-a671-03f713624f47' };
    const tree = exports.default({ unavailable: true, accessFailure: failure });
    assert.equal(tree.type, 'unavailable', page); assert.equal(tree.props.accessFailure, failure, page);
  }
});
