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
  await client.query('BEGIN');
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('atlas-standalone-schema-v1',0))");
    const { rows: [ledger] } = await client.query("SELECT to_regclass('atlas_staff._standalone_migrations') IS NOT NULL AS exists");
    if (ledger.exists) {
      const { rows } = await client.query('SELECT version,checksum FROM atlas_staff._standalone_migrations ORDER BY version');
      if (rows.length !== 1 || rows[0].version !== manifest.version || rows[0].checksum !== manifest.sqlSha256)
        throw new Error('STANDALONE_MIGRATION_LEDGER_INVALID');
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
