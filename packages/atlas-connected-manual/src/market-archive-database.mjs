// Cold read-only startup fence for the separately reviewed archive-search SQL.
// The existing native database validator still owns the wider role contract.
import { createHash } from 'node:crypto';
import { requireThat } from '@atlas/manual-service/contract';
const deny = ok => requireThat(ok, 503, 'MARKET_ARCHIVE_DATABASE_INVALID');
const sha = value => createHash('sha256').update(value).digest('hex');
const stable = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(key => [key, v[key]])) : v);
const ARCHIVE_MARKET_TABLES = Object.freeze(['atlas_manual_connected.market_job']);
// Source pins are from the immutable baseline plus the inert proposal, never
// learned from the running database. The full catalog needs its reviewed pin.
const SOURCE_PINS = Object.freeze({
  "atlas_manual.immutable": "a06ecb8c212cb9ac364b78217a68733d4cfb4a4e12db96e2eeb2c63f19cbaa6b",
  "atlas_manual_connected.market_job_guard": "509b133ce90e80f1e68eb2ec72e7db76f5f9413d9952fc3b04b0393af6e1e11d",
  "atlas_manual_connected.display_owner_current": "1985dc2286f2de55dada1c14055d0f1a88b275fb590a770c2700bdee9327604f",
  "atlas_manual_connected.market_archive_search_guard": "68e34910409967fc0fd54b6f802b48e7f4442da866e2e3267f82ff77501cfe2c"
});

export async function inspectArchiveMarketSearchSchema(tx) {
  const tables = await tx.$queryRawUnsafe(`/* archive-market-db:schema */ SELECT n.nspname||'.'||c.relname AS name,
    pg_get_userbyid(c.relowner) AS owner,c.relkind AS kind,c.relrowsecurity AS rls,c.relforcerowsecurity AS force_rls,
    (SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,
      'identity',a.attidentity,'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum)
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS columns,
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('name',k.conname,'type',k.contype,'deferrable',k.condeferrable,
      'deferred',k.condeferred,'validated',k.convalidated,'definition',pg_get_constraintdef(k.oid,false)) ORDER BY k.conname),'[]'::jsonb)
      FROM pg_constraint k WHERE k.conrelid=c.oid) AS constraints,
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('name',ic.relname,'valid',i.indisvalid,'ready',i.indisready,
      'definition',pg_get_indexdef(i.indexrelid)) ORDER BY ic.relname),'[]'::jsonb)
      FROM pg_index i JOIN pg_class ic ON ic.oid=i.indexrelid WHERE i.indrelid=c.oid) AS indexes,
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,'type',t.tgtype,
      'definition',pg_get_triggerdef(t.oid,false)) ORDER BY t.tgname),'[]'::jsonb)
      FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal) AS triggers
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname||'.'||c.relname=ANY($1::text[])
    ORDER BY n.nspname,c.relname`, ARCHIVE_MARKET_TABLES);
  const functions = await tx.$queryRawUnsafe(`/* archive-market-db:functions */ SELECT n.nspname||'.'||p.proname AS name,
    pg_get_function_identity_arguments(p.oid) AS arguments,pg_get_userbyid(p.proowner) AS owner,
    l.lanname AS language,p.prosrc AS source,p.probin AS binary,p.prosecdef AS definer,p.proconfig AS config,
    p.provolatile AS volatility,p.proisstrict AS strict,p.proleakproof AS leakproof,
    pg_get_function_result(p.oid) AS result
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
    WHERE n.nspname='atlas_manual_connected' AND p.proname='display_owner_current' OR p.oid IN(
      SELECT t.tgfoid FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace s ON s.oid=c.relnamespace
      WHERE NOT t.tgisinternal AND s.nspname||'.'||c.relname=ANY($1::text[]))
    ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)`, ARCHIVE_MARKET_TABLES);
  // The installation owner is checked independently; removing its name makes
  // this pin portable from the reviewed disposable installation to a reviewed
  // migration owner, without permitting the serving role to own any object.
  const normalized = { tables: tables.map(({ owner, ...row }) => row), functions: functions.map(({ owner, ...row }) => row) };
  return { tables, functions, sha256: sha(stable(normalized)) };
}


/** Requires an independently reviewed installation hash. SQL011 cannot pass.
 * No migrations, roles, writes, transactions or provider calls are performed. */
export async function assertArchiveMarketSearchDatabase(tx, { schemaSha256 }) {
  deny(/^[a-f0-9]{64}$/.test(schemaSha256 ?? ''));
  const [identity] = await tx.$queryRawUnsafe(`/* archive-market-db:role */ SELECT current_user AS name,
    session_user AS session_name,r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls AS unsafe
    FROM pg_roles r WHERE r.rolname=current_user`);
  deny(identity && identity.name === identity.session_name && identity.unsafe === false);
  const schema = await inspectArchiveMarketSearchSchema(tx);
  deny(schema.sha256 === schemaSha256 && schema.tables.length === 1);
  const table = schema.tables[0];
  deny(table.name === ARCHIVE_MARKET_TABLES[0] && table.owner !== identity.name && table.kind === 'r' && !table.rls && !table.force_rls
    && table.constraints.every(c => c.validated) && table.indexes.every(i => i.valid && i.ready)
    && table.triggers.every(t => t.enabled === 'O'));
  for (const name of ['archive_authority','archive_authority_hash']) {
    const found = table.columns.filter(c => c.name === name);
    deny(found.length === 1 && found[0].type === 'text' && !found[0].notNull && found[0].default === null
      && found[0].identity === '' && found[0].generated === '');
  }
  for (const name of ['market_job_origin_check','market_job_archive_authority_check'])
    deny(table.constraints.filter(c => c.name === name && c.type === 'c' && !c.deferrable).length === 1);
  for (const name of ['market_job_guard','market_archive_search_guard'])
    deny(table.triggers.filter(t => t.name === name).length === 1);
  deny(schema.functions.length === Object.keys(SOURCE_PINS).length);
  for (const [name, hash] of Object.entries(SOURCE_PINS)) {
    const found = schema.functions.filter(f => f.name === name);
    deny(found.length === 1 && sha(found[0].source) === hash && found[0].owner === table.owner);
    const fn = found[0], auth = name.endsWith('.display_owner_current');
    deny(fn.language === (auth ? 'sql' : 'plpgsql') && fn.definer === auth && fn.volatility === (auth ? 's' : 'v')
      && !fn.strict && !fn.leakproof && fn.binary === null && stable(fn.config) === stable(name === 'atlas_manual.immutable' ? null : ['search_path=pg_catalog'])
      && fn.result === (auth ? 'boolean' : 'trigger') && fn.arguments === (auth ? 'owner uuid, version integer' : ''));
  }
  const rights = await tx.$queryRawUnsafe(`/* archive-market-db:authority-rights */ SELECT a.attname AS name,
    has_column_privilege(current_user,a.attrelid,a.attnum,'SELECT') AS sel,
    has_column_privilege(current_user,a.attrelid,a.attnum,'INSERT') AS ins,
    has_column_privilege(current_user,a.attrelid,a.attnum,'UPDATE') AS upd,
    has_column_privilege(current_user,a.attrelid,a.attnum,'REFERENCES') AS refs,
    has_table_privilege(current_user,a.attrelid,'DELETE,TRUNCATE,TRIGGER,MAINTAIN') AS extra
    FROM pg_attribute a WHERE a.attrelid='atlas_manual_connected.market_job'::regclass
    AND a.attname IN('archive_authority','archive_authority_hash') AND NOT a.attisdropped ORDER BY a.attname`);
  deny(rights.length === 2 && rights.every(r => r.sel === true && r.ins === true && r.upd === false && r.refs === false && r.extra === false));
  return schema.sha256;
}
