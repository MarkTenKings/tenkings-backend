import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { compFoundationDefinition, assertRegisteredCompFoundation, COMP_FOUNDATION_VERSION, COMP_SCHEMA_SHA256 } from './comp-foundation-fixture.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const prefix = [
  'dae816990ab42d99204bf07f2a009af4e4ca92ccaab154da213137492be84396',
  '550d947fb3dc00cd56358896a755f3e2825b48fe37b7fa3124e86f90e2cfa586',
  '7f8bd1c94defc85ad6c8b97256745297acc740c532a16912b73dd5785d1e066a',
  'f76f882edb3bad6f36e423bf388380a16f8602de29eddb32a647dc8916763089',
  'e073b918aa83aecc52453deb10ba6abbc603b167881fde347518dc12fd37d5b0',
  '4ff9745a5553fe8252f37b1c311ea8b63c1f4b1f4c5636bed4ada92924ad26e3',
  '734094259335780542e0b53ae5b4d663a057283d670d700119f4cbc4cf05f063',
  '5b014085bd88f1422da1f02ba7d8ddc5455073d5e79775e6d04e6a5218b3392b',
  'a6de21a978dc5b3bb5e21dbdf408d60709fa2c724a3e17376ff11502e6ef42a9',
];
test('011 removes exactly two outer lines, retaining baseline,002–010 and every proposal body byte', async () => {
  const { proposal, migration, migrations } = await compFoundationDefinition();
  assert.equal(migrations.length, 10); assert.strictEqual(migrations[9], migration);
  assert.equal(migration.version, COMP_FOUNDATION_VERSION); assert.equal(Buffer.byteLength(migration.sql), 6748);
  assert.deepEqual(migrations.slice(0, 9).map(m => m.sqlSha256), prefix);
  assert.equal(hash(await readFile(new URL('../sql/baseline.sql', import.meta.url))), '68afb04dff6bb81a4b42a9de1412fc8322c6b0696d94e833df03e3183dadde8f');
  assert.equal(migration.sql, proposal.replace('\nBEGIN;\nCREATE TABLE', '\nCREATE TABLE').replace(/COMMIT;\n$/, ''));
  assert.deepEqual([...migration.sql.matchAll(/AS \$\$([\s\S]*?)\$\$/g)].map(m => m[1]), [...proposal.matchAll(/AS \$\$([\s\S]*?)\$\$/g)].map(m => m[1]));
  const top = migration.sql.replace(/--[^\n]*/g, '').replace(/\$\$[\s\S]*?\$\$/g, '$$BODY$$');
  assert.doesNotMatch(top, /(?:^|;)\s*(?:BEGIN|COMMIT|GRANT|INSERT|UPDATE|DELETE|TRUNCATE|DROP|CREATE ROLE|ALTER ROLE)\b|IF NOT EXISTS/i);
  assert.deepEqual([...top.matchAll(/CREATE TABLE ([a-z_.]+)/g)].map(m => m[1]), ['atlas_manual.comp_curation']);
  assert.equal([...top.matchAll(/CREATE TRIGGER /g)].length, 3);
  const grants = await readFile(new URL('../grants.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(grants, /comp_curation|compCuration/);
  assert.equal(hash(await readFile(new URL('../../atlas-connected-manual/sql/comp-curation-role-proposal.sql', import.meta.url))), 'f7378ae825f6629eec5c3911adec4a344e1fa834170f398efb9920d2376a3d92');
});

test('test-only compatibility refuses wrong search path, missing/tampered ledger and unreviewed catalog without mutation', async () => {
  const { migrations } = await compFoundationDefinition();
  const baseline = JSON.parse(await readFile(new URL('../baseline.manifest.json', import.meta.url), 'utf8'));
  const full = [{ version: baseline.version, checksum: baseline.sqlSha256 }, ...migrations.map(m => ({ version: m.version, checksum: m.sqlSha256 }))];
  for (const mode of ['path', 'missing', 'tampered', 'catalog']) {
    const ledger = structuredClone(full), calls = [];
    if (mode === 'missing') ledger.pop();
    if (mode === 'tampered') ledger.at(-1).checksum = '0'.repeat(64);
    await assert.rejects(assertRegisteredCompFoundation(async sql => {
      calls.push(sql); assert.match(sql, /^(?:\/\* comp-db:(?:schema|functions) \*\/ )?SELECT /);
      if (sql.includes('current_setting')) return { rows: [{ path: mode === 'path' ? 'public' : 'pg_catalog' }] };
      if (sql.includes('_standalone_migrations')) return { rows: ledger };
      assert.equal(mode, 'catalog'); return { rows: [] };
    }));
    if (mode === 'path') assert.equal(calls.length, 1);
    if (mode === 'missing' || mode === 'tampered') assert.equal(calls.length, 2);
    if (mode === 'catalog') assert.equal(calls.length, 4);
  }
  assert.equal(COMP_SCHEMA_SHA256, 'a1bbdf297ec7c426358a9f6dee0fd90fb23a109bb92007f0b2ccfa5b3b842ff7');
});
