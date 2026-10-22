import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { collectionFoundationDefinition, assertRegisteredOwnershipFoundation } from './ownership-foundation-fixture.mjs';

const prefix = [
  'dae816990ab42d99204bf07f2a009af4e4ca92ccaab154da213137492be84396',
  '550d947fb3dc00cd56358896a755f3e2825b48fe37b7fa3124e86f90e2cfa586',
  '7f8bd1c94defc85ad6c8b97256745297acc740c532a16912b73dd5785d1e066a',
  'f76f882edb3bad6f36e423bf388380a16f8602de29eddb32a647dc8916763089',
  'e073b918aa83aecc52453deb10ba6abbc603b167881fde347518dc12fd37d5b0',
  '4ff9745a5553fe8252f37b1c311ea8b63c1f4b1f4c5636bed4ada92924ad26e3',
  '734094259335780542e0b53ae5b4d663a057283d670d700119f4cbc4cf05f063',
  '5b014085bd88f1422da1f02ba7d8ddc5455073d5e79775e6d04e6a5218b3392b',
];
test('010 retains complete qualified component bytes and unchanged002–009; no top-level seeds, roles or grants', async () => {
  const { migration, migrations, routines } = await collectionFoundationDefinition();
  assert.equal(migrations.length, 9); assert.strictEqual(migrations[8], migration);
  assert.deepEqual(migrations.slice(0, 8).map(m => m.sqlSha256), prefix);
  const topLevel = migration.sql.replace(/--[^\n]*/g, '').replace(/\$\$[\s\S]*?\$\$/g, '$$BODY$$');
  assert.doesNotMatch(topLevel, /(?:^|;)\s*(?:GRANT|INSERT|UPDATE|DELETE|TRUNCATE|DROP|CREATE ROLE|ALTER ROLE)\b|IF NOT EXISTS/i);
  assert.deepEqual([...topLevel.matchAll(/CREATE TABLE ([a-z_.]+)/g)].map(m => m[1]), ['atlas_ownership.reviewer_authority', 'atlas_ownership.event']);
  assert.doesNotMatch(topLevel, /CREATE SCHEMA atlas_ownership_(?:evidence|proof|lifecycle)/);
  assert.equal(routines.length, 9); assert(routines.every(r => r.config[0] === 'search_path=pg_catalog'));
  const grants = await readFile(new URL('../grants.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(grants, /cardOwnership|atlas_ownership/);
});
test('fixture compatibility requires exact complete ledger and installed source, owner, signature and security before omitting duplicate install', async () => {
  const { migrations, routines } = await collectionFoundationDefinition();
  const baseline = JSON.parse(await readFile(new URL('../baseline.manifest.json', import.meta.url), 'utf8'));
  const valid = { ledger: [{ version: baseline.version, checksum: baseline.sqlSha256 }, ...migrations.map(m => ({ version: m.version, checksum: m.sqlSha256 }))],
    routines: routines.map(r => ({ ...r, owner: 'reviewed_fixture_owner' })) };
  const query = v => async sql => {
    assert(sql.startsWith('SELECT '));
    return { rows: sql.includes('_standalone_migrations') ? v.ledger : sql.includes("n.nspname IN ('atlas_ownership'") ? v.routines : [{ owner: 'reviewed_fixture_owner' }] };
  };
  assert.equal((await assertRegisteredOwnershipFoundation(query(valid))).ledgerRows, 10);
  const bad = [v => v.ledger.pop(), v => { v.ledger[1].checksum = '0'.repeat(64); }, v => v.routines.pop(),
    ...['source', 'owner', 'arguments', 'language'].map(key => v => { v.routines[0][key] = 'drift'; }),
    v => { v.routines[0].definer = !v.routines[0].definer; }, v => { v.routines[0].config = ['search_path=public']; }];
  for (const change of bad) { const v = structuredClone(valid); change(v); await assert.rejects(assertRegisteredOwnershipFoundation(query(v))); }
});
