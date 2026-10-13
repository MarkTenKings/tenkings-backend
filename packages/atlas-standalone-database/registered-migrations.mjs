import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const digest = text => createHash('sha256').update(text).digest('hex');
export async function registeredMigrations() {
 const manifest = JSON.parse(await readFile(new URL('./migrations.manifest.json', import.meta.url), 'utf8'));
 if (manifest.version !== 'atlas-standalone-migrations-v1' || !Array.isArray(manifest.migrations)
   || new Set(manifest.migrations.map(m=>m.version)).size !== manifest.migrations.length) throw Error('STANDALONE_MIGRATION_REGISTRY_INVALID');
 return Promise.all(manifest.migrations.map(async m => {
  if (!/^atlas-standalone-[0-9]{3}-[a-z-]+$/.test(m.version) || !/^sql\/[0-9]{3}-[a-z-]+\.sql$/.test(m.file)) throw Error('STANDALONE_MIGRATION_REGISTRY_INVALID');
  const sql = await readFile(new URL(m.file, import.meta.url), 'utf8');
  if (digest(sql) !== m.sqlSha256) throw Error('STANDALONE_MIGRATION_CHECKSUM_INVALID');
  return {...m, sql};
 }));
}
export function validateLedger(rows, baseline, migrations) {
 const actual = new Map(rows.map(row => [row.version, row.checksum]));
 if (actual.size !== rows.length || actual.get(baseline.version) !== baseline.sqlSha256
   || rows.length > migrations.length + 1) throw Error('STANDALONE_MIGRATION_LEDGER_INVALID');
 let missing = false;
 for (const migration of migrations) {
  if (!actual.has(migration.version)) { missing = true; continue; }
  if (missing || actual.get(migration.version) !== migration.sqlSha256) throw Error('STANDALONE_MIGRATION_LEDGER_INVALID');
 }
 if (rows.some(row => row.version !== baseline.version && !migrations.some(m => m.version === row.version))) throw Error('STANDALONE_MIGRATION_LEDGER_INVALID');
 return actual;
}
