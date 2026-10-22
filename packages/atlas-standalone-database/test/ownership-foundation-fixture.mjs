// Test-only compatibility assertion. Never installs or repairs an existing schema.
// Import is inert; query must be the explicit owned fixture's administrative client.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { registeredMigrations, validateLedger } from '../registered-migrations.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const COLLECTION_FOUNDATION_VERSION = 'atlas-standalone-010-collection-foundation';
export const COLLECTION_COMPONENTS = Object.freeze([
  ['card-ownership-proposal.sql', '00720728d42a1276d50c70998d22e9e309cec2b1bb5cdd9ba8c7126e16fc36a2'],
  ['card-ownership-reader-proposal.sql', '696d8e4c152222dca60042e14904fc9cc89b2d09540f320de76f18cbbb74921b'],
  ['card-ownership-preferences-proposal.sql', '869a61cdd1b3828c3f95f70fd91ab3da14b2de0a34ee836eaa3b63b2cb42844a'],
].map(Object.freeze));
const signatures = Object.freeze({
  'atlas_ownership.input_valid': 'text, jsonb', 'atlas_ownership.current_title': 'uuid',
  'atlas_ownership.preferences': 'uuid, uuid', 'atlas_ownership.card_projection': 'uuid, uuid, text',
  'atlas_ownership.receipt': 'atlas_ownership.event', 'atlas_ownership.customer_call': 'text, text, jsonb, text, jsonb',
  'atlas_ownership.staff_call': 'text, text, jsonb, text[], jsonb',
  'atlas_ownership.customer_read': 'text, text, jsonb, text, jsonb',
  'atlas_ownership_preferences.customer_call': 'text, text, jsonb, text, jsonb',
});
export async function collectionFoundationDefinition() {
  const components = [];
  for (const [name, sha256] of COLLECTION_COMPONENTS) {
    const sql = await readFile(new URL('../../atlas-connected-manual/sql/' + name, import.meta.url), 'utf8');
    assert.equal(hash(sql), sha256, name); components.push({ name, sha256, sql });
  }
  const sql = '-- Additive collection foundation. No roles, grants, seeds, reviewer authority or activation.\n'
    + '-- Component comments below describe their retained proposal provenance; executable bytes are unchanged.\n'
    + components.map(c => `\n-- BEGIN RETAINED COMPONENT ${c.name} SHA256 ${c.sha256}\n${c.sql}-- END RETAINED COMPONENT ${c.name}\n`).join('');
  const migrations = await registeredMigrations(), migration = migrations.find(m => m.version === COLLECTION_FOUNDATION_VERSION);
  assert(migration); assert.equal(migration.sql, sql, '010 must retain complete component bytes');
  const routines = components.flatMap(c => [...c.sql.matchAll(/CREATE FUNCTION ([a-z_]+\.[a-z_]+)\([\s\S]*?\) RETURNS([\s\S]*?) AS \$\$([\s\S]*?)\$\$;/g)]
    .map(([, name, header, source]) => ({ name, arguments: signatures[name], source,
      definer: /SECURITY DEFINER/.test(header), config: ['search_path=pg_catalog'], language: /LANGUAGE sql\b/.test(header) ? 'sql' : 'plpgsql' })));
  assert.equal(routines.length, 9); assert(routines.every(r => r.arguments));
  return { components, migration, migrations, routines: routines.sort((a, b) => a.name.localeCompare(b.name)) };
}

export async function assertRegisteredOwnershipFoundation(query) {
  const { migration, migrations, routines } = await collectionFoundationDefinition();
  const baseline = JSON.parse(await readFile(new URL('../baseline.manifest.json', import.meta.url), 'utf8'));
  const { rows: ledger } = await query('SELECT version,checksum FROM atlas_staff._standalone_migrations ORDER BY version');
  assert.equal(validateLedger(ledger, baseline, migrations).size, migrations.length + 1);
  assert.equal(ledger.find(r => r.version === migration.version)?.checksum, migration.sqlSha256);
  const { rows } = await query(`SELECT n.nspname||'.'||p.proname AS name,oidvectortypes(p.proargtypes) AS arguments,
    p.prosrc AS source,p.prosecdef AS definer,p.proconfig AS config,l.lanname AS language,
    pg_get_userbyid(p.proowner) AS owner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname IN ('atlas_ownership','atlas_ownership_preferences')
    ORDER BY n.nspname,p.proname`);
  const { rows: owners } = await query(`SELECT pg_get_userbyid(p.proowner) AS owner FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='atlas_manual' AND p.proname='immutable' AND p.pronargs=0`);
  assert.equal(owners.length, 1); assert(rows.every(r => r.owner === owners[0].owner));
  assert.deepEqual(rows.map(({ owner, ...row }) => row).sort((a, b) => a.name.localeCompare(b.name)), routines);
  return { version: migration.version, checksum: migration.sqlSha256, ledgerRows: ledger.length };
}

/** Save the precise new fixture dependency closure before starting its cluster. */
export async function captureOwnershipFoundation(output) {
  const { migrations } = await collectionFoundationDefinition();
  const paths = ['migrations.manifest.json', 'baseline.manifest.json', 'sql/baseline.sql', 'migrate.mjs',
    'registered-migrations.mjs', 'test/ownership-foundation-fixture.mjs', ...migrations.map(m => m.file)];
  const refs = [];
  for (const path of paths) {
    const body = await readFile(new URL('../' + path, import.meta.url));
    const saved = resolve(output, 'foundation-source-' + path.replaceAll('/', '_'));
    await writeFile(saved, body, { flag: 'wx', mode: 0o600 }); refs.push({ path, sha256: hash(body), saved });
  }
  await writeFile(resolve(output, 'foundation-sources.json'), JSON.stringify(refs, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return refs;
}
