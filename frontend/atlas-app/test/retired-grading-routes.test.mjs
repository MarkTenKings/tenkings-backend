import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url), babel = require('next/dist/compiled/babel/core');
function load(page, access) {
  const exports = {}, calls = [];
  const code = babel.transformSync(readFileSync(new URL(`../pages/${page}.jsx`, import.meta.url), 'utf8'), {
    filename: `${page}.jsx`, presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } } }]],
    babelrc: false, configFile: false,
  }).code;
  vm.runInNewContext(code, { exports, require(name) {
    if (name === 'react') return { createElement: (type, props) => ({ type, props }) };
    if (name.endsWith('/components/Shell')) return { Unavailable: 'unavailable' };
    if (name.endsWith('/components/ManualCards')) return { default: 'current-cards', __esModule: true };
    if (name.endsWith('/components/BatchGrading')) return { default: 'current-intake', __esModule: true };
    if (name.endsWith('/lib/server/runtime.mjs')) return { pageAccess: async ctx => { calls.push(ctx); return access; } };
    if (name.startsWith('@babel/runtime/')) return require(`next/dist/compiled/${name}`);
    assert.fail(`Retired route loaded another dependency: ${name}`);
  } });
  return { ...exports, calls };
}

test('grading and intake render only current screens; missing capability never selects a legacy workflow', async () => {
  const staff = { id: 'reviewer' };
  for (const [page, component] of [['grading', 'current-cards'], ['add-cards', 'current-intake']]) {
    const access = { props: { staff, manualEnabled: true } }, route = load(page, access), ctx = {};
    assert.equal(await route.getServerSideProps(ctx), access);
    assert.equal(route.calls[0], ctx);
    const active = route.default(access.props);
    assert.equal(active.type, component); assert.equal(active.props.staff, staff);
    for (const manualEnabled of [false, undefined, null]) {
      const tree = route.default({ staff, manualEnabled });
      assert.equal(tree.type, 'unavailable'); assert.equal(tree.props.accessFailure.kind, 'FEATURE_DISABLED');
    }
    const failure = { kind: 'CHECK_FAILED', reference: 'opaque-reference' };
    const held = route.default({ staff, manualEnabled: true, unavailable: true, accessFailure: failure });
    assert.equal(held.type, 'unavailable'); assert.equal(held.props.accessFailure, failure);
  }
});

test('obsolete card/workspace/operations routes have no filesystem route', () => {
  for (const page of ['cards/[cardId]','workspace/[cardId]','operations'])
    assert.equal(existsSync(new URL(`../pages/${page}.jsx`,import.meta.url)),false);
});
