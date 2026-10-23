// Test-only exact installation assertion. Import is inert; never installs,
// repairs, grants or adopts an observed schema as a trusted expected value.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { applyStandaloneBaseline } from '../migrate.mjs';
import { registeredMigrations, validateLedger } from '../registered-migrations.mjs';
import { inspectCompCurationSchema, COMP_CURATION_TABLES } from '../../atlas-connected-manual/src/comp-curation-database.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const COMP_FOUNDATION_VERSION = 'atlas-standalone-011-comp-curation';
export const COMP_PROPOSAL_SHA256 = '3eb42a3f93e4caf7b9e1a53cecd5290ad6b0aaf22cbe35bd039951f8e6cbf0d2';
export const COMP_MIGRATION_SHA256 = 'aa19879134c9ad6261fa33ad96ed0f5be6ee2e498b601c3e2f12deee407fe36a';
// Separately reviewed owned PG17 catalog, restricted-role-pg-03. This pin is
// retained across registration, not calculated from the database being tested.
export const COMP_SCHEMA_SHA256 = 'a1bbdf297ec7c426358a9f6dee0fd90fb23a109bb92007f0b2ccfa5b3b842ff7';

export async function compFoundationDefinition() {
  const proposal = await readFile(new URL('../../atlas-connected-manual/sql/comp-curation-proposal.sql', import.meta.url), 'utf8');
  assert.equal(hash(proposal), COMP_PROPOSAL_SHA256);
  const lines = proposal.match(/[^\n]*\n/g);
  assert.equal(lines.join(''), proposal); assert.equal(lines[4], 'BEGIN;\n'); assert.equal(lines.at(-1), 'COMMIT;\n');
  const sql = [...lines.slice(0, 4), ...lines.slice(5, -1)].join('');
  assert.equal(hash(sql), COMP_MIGRATION_SHA256);
  const registered = await registeredMigrations(), index = registered.findIndex(m => m.version === COMP_FOUNDATION_VERSION);
  assert(index >= 0); const migrations = registered.slice(0, index + 1), migration = migrations.at(-1);
  assert(migration); assert.equal(migration.sql, sql, '011 removes only outer transaction lines');
  return { proposal, migration, migrations };
}

/** TEST ONLY: install the explicit registered prefix through011 in an owned
 * fixture. Never chooses latest, rewinds a newer ledger, or changes runtime API. */
export async function applyCompFoundation(client) {
  await applyStandaloneBaseline(client);
  const { migrations } = await compFoundationDefinition();
  const baseline = JSON.parse(await readFile(new URL('../baseline.manifest.json', import.meta.url), 'utf8'));
  await client.query('BEGIN');
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('atlas-standalone-schema-v1',0))");
    const { rows } = await client.query('SELECT version,checksum FROM atlas_staff._standalone_migrations ORDER BY version');
    const actual = validateLedger(rows, baseline, migrations), applied = [];
    for (const migration of migrations) {
      if (actual.has(migration.version)) continue;
      await client.query(migration.sql);
      await client.query('INSERT INTO atlas_staff._standalone_migrations(version,checksum) VALUES($1,$2)', [migration.version,migration.sqlSha256]);
      applied.push(migration.version);
    }
    await client.query('COMMIT'); return { status: applied.length ? 'APPLIED' : 'NO_OP', through: COMP_FOUNDATION_VERSION, applied };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}

/** query(sql,...values) -> {rows}. Caller supplies an owned administrative
 * transaction/session with search_path=pg_catalog. Every statement is a read.
 * Role grants remain the responsibility of the separate restricted-role test. */
export async function assertRegisteredCompFoundation(query) {
  const { migration, migrations } = await compFoundationDefinition();
  const baseline = JSON.parse(await readFile(new URL('../baseline.manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual((await query("SELECT current_setting('search_path') AS path")).rows, [{ path: 'pg_catalog' }]);
  const { rows: ledger } = await query('SELECT version,checksum FROM atlas_staff._standalone_migrations ORDER BY version');
  assert.equal(validateLedger(ledger, baseline, migrations).size, migrations.length + 1);
  assert.equal(ledger.find(row => row.version === migration.version)?.checksum, COMP_MIGRATION_SHA256);
  const schema = await inspectCompCurationSchema({ $queryRawUnsafe: async (sql, ...values) => (await query(sql, ...values)).rows });
  assert.equal(schema.sha256, COMP_SCHEMA_SHA256, 'Registered schema must preserve separately reviewed comp catalog');
  assert.deepEqual(schema.tables.map(table => table.name), COMP_CURATION_TABLES);
  const immutable = schema.functions.filter(fn => fn.name === 'atlas_manual.immutable');
  assert.equal(immutable.length, 1); assert.equal(typeof immutable[0].owner, 'string'); assert(immutable[0].owner);
  for (const object of [...schema.tables, ...schema.functions]) assert.equal(object.owner, immutable[0].owner, object.name);
  return { version: migration.version, checksum: migration.sqlSha256, ledgerRows: ledger.length, schemaSha256: schema.sha256 };
}

/** Retain future fixture dependencies without touching historical receipts. */
export async function captureCompFoundation(output) {
  const { migrations } = await compFoundationDefinition();
  const paths = ['migrations.manifest.json', 'baseline.manifest.json', 'sql/baseline.sql', 'migrate.mjs',
    'registered-migrations.mjs', 'test/comp-foundation-fixture.mjs',
    '../atlas-connected-manual/src/comp-curation-database.mjs', '../atlas-connected-manual/sql/comp-curation-proposal.sql',
    ...migrations.map(m => m.file)];
  const refs = [];
  for (const path of paths) {
    const body = await readFile(new URL('../' + path, import.meta.url));
    const saved = resolve(output, 'comp-foundation-source-' + path.replaceAll('/', '_'));
    await writeFile(saved, body, { flag: 'wx', mode: 0o600 }); refs.push({ path, sha256: hash(body), saved });
  }
  await writeFile(resolve(output, 'comp-foundation-sources.json'), JSON.stringify(refs, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return refs;
}
