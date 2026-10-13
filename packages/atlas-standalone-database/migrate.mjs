import { registeredMigrations, validateLedger } from './registered-migrations.mjs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const digest = value => createHash('sha256').update(value).digest('hex');

/** Caller owns the explicit connection and release authorization. No environment
 * lookup, default URL, credential discovery or legacy-migration fallback. */
export async function applyStandaloneBaseline(client) {
  const [sql, manifestText] = await Promise.all([
    readFile(new URL('./sql/baseline.sql', import.meta.url), 'utf8'),
    readFile(new URL('./baseline.manifest.json', import.meta.url), 'utf8'),
  ]);
  const manifest = JSON.parse(manifestText);
  if (manifest.version !== 'atlas-standalone-baseline-v1' || digest(sql) !== manifest.sqlSha256)
    throw new Error('STANDALONE_BASELINE_CHECKSUM_INVALID');
  const migrations = await registeredMigrations();
  await client.query('BEGIN');
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('atlas-standalone-schema-v1',0))");
    const { rows: [ledger] } = await client.query("SELECT to_regclass('atlas_staff._standalone_migrations') IS NOT NULL AS exists");
    if (ledger.exists) {
      const { rows } = await client.query('SELECT version,checksum FROM atlas_staff._standalone_migrations ORDER BY version');
      validateLedger(rows, manifest, migrations);
      await client.query('COMMIT');
      return { status: 'NO_OP', version: manifest.version, checksum: manifest.sqlSha256 };
    }
    const { rows } = await client.query("SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname<>'information_schema' AND nspname<>'public'");
    const { rows: publicObjects } = await client.query("SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' UNION ALL SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' UNION ALL SELECT t.oid FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' UNION ALL SELECT oid FROM pg_foreign_server");
    if (rows.length || publicObjects.length) throw new Error('STANDALONE_REQUIRES_EMPTY_DATABASE');
    await client.query(sql);
    await client.query('CREATE TABLE atlas_staff._standalone_migrations (version text PRIMARY KEY,checksum text NOT NULL CHECK(checksum ~ \'^[a-f0-9]{64}$\'),applied_at timestamptz NOT NULL DEFAULT clock_timestamp())');
    await client.query('INSERT INTO atlas_staff._standalone_migrations(version,checksum) VALUES($1,$2)', [manifest.version, manifest.sqlSha256]);
    await client.query('COMMIT');
    return { status: 'APPLIED', version: manifest.version, checksum: manifest.sqlSha256 };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}

/** Apply only the registered additive suffix; no credentials, defaults, or legacy chain. */
export async function applyStandaloneMigrations(client) {
 const baseline = await applyStandaloneBaseline(client);
 const manifest = JSON.parse(await readFile(new URL('./baseline.manifest.json', import.meta.url), 'utf8'));
 const migrations = await registeredMigrations();
 await client.query('BEGIN');
 try {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('atlas-standalone-schema-v1',0))");
  const {rows} = await client.query('SELECT version,checksum FROM atlas_staff._standalone_migrations ORDER BY version');
  const actual = validateLedger(rows, manifest, migrations), applied = [];
  for (const migration of migrations) {
   if (actual.has(migration.version)) continue;
   await client.query(migration.sql);
   await client.query('INSERT INTO atlas_staff._standalone_migrations(version,checksum) VALUES($1,$2)', [migration.version,migration.sqlSha256]);
   applied.push({version:migration.version,checksum:migration.sqlSha256});
  }
  await client.query('COMMIT');
  return {status:applied.length ? 'APPLIED' : 'NO_OP', baseline, applied};
 } catch (error) { await client.query('ROLLBACK'); throw error; }
}
