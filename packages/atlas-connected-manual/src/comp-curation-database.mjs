// Unregistered native-only database capability. No environment/client creation,
// grants or I/O on import. A reviewed schema pin is REQUIRED, never learned from
// the live database by this factory. The caller owns the supplied client.
import { createHash } from 'node:crypto';
import { requireThat } from '@atlas/manual-service/contract';

const deny = ok => requireThat(ok, 503, 'COMP_DATABASE_ROLE_INVALID');
const validName = value => typeof value === 'string' && /^[a-z][a-z0-9_]{0,62}$/.test(value) && value !== 'public' && !value.startsWith('pg_');
const sha = value => createHash('sha256').update(value).digest('hex');
const stable = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(key => [key, v[key]])) : v);
export const COMP_CURATION_TABLES = Object.freeze([
  'atlas_manual.action', 'atlas_manual.approval', 'atlas_manual.card', 'atlas_manual.comp_curation',
  'atlas_manual.presentation_market', 'atlas_manual.public_report_identity', 'atlas_manual.publication',
  'atlas_manual_intake.card', 'atlas_manual_intake.discarded_card',
]);
const tableSet = new Set(COMP_CURATION_TABLES);
const schemaSet = new Set(['atlas_manual', 'atlas_manual_intake']);
// Source-body hashes from the immutable standalone baseline and unregistered
// comp-curation-proposal.sql. Full catalog metadata is separately hash-pinned.
const SOURCE_PINS = Object.freeze({
  "atlas_manual.authenticate": "41b8c6f5732117538a1f566e5e2c373c2f717db845612bb9d2448f1980052680",
  "atlas_manual.card_revision": "dceabbed4342e10971dbb2131a2ec7ef1d734cde4ed9efe9f7cfe87bbad1fb9a",
  "atlas_manual.immutable": "a06ecb8c212cb9ac364b78217a68733d4cfb4a4e12db96e2eeb2c63f19cbaa6b",
  "atlas_manual_intake.card_guard": "08cbb28f54e6e1548d9cecfa1ce75a82d1aa9f7db20b7d1be704650100923a32",
  "atlas_manual.comp_curation_guard": "81f9eb9b687a761d3d9777eb1d65c6351ed218cfff38e07701040d1c33273cfb"
});

// Explicit candidate contract; absence keeps the deployed SQL011 source pin.
export const COMP_EVIDENCE_GUARD_VERSION = 'EVIDENCE_SELECTION_V1';
const evidenceGuardSha256 = '8d2b7e0da7e1309334cce43a3c7382fdb4c63e48d771b95971aa23833a410e51';
const validGuardVersion = value => value === 'SQL011' || value === COMP_EVIDENCE_GUARD_VERSION;

/** Read-only catalog material for an OFFLINE, reviewed installation receipt.
 * Not an activation helper: this never accepts its own output as trusted. */
export async function inspectCompCurationSchema(tx) {
  const tables = await tx.$queryRawUnsafe(`/* comp-db:schema */ SELECT n.nspname||'.'||c.relname AS name,
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
    ORDER BY n.nspname,c.relname`, COMP_CURATION_TABLES);
  const functions = await tx.$queryRawUnsafe(`/* comp-db:functions */ SELECT n.nspname||'.'||p.proname AS name,
    pg_get_function_identity_arguments(p.oid) AS arguments,pg_get_userbyid(p.proowner) AS owner,
    l.lanname AS language,p.prosrc AS source,p.probin AS binary,p.prosecdef AS definer,p.proconfig AS config,
    p.provolatile AS volatility,p.proisstrict AS strict,p.proleakproof AS leakproof,
    pg_get_function_result(p.oid) AS result
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
    WHERE p.oid='atlas_manual.authenticate(text,text,jsonb,text[])'::regprocedure OR p.oid IN(
      SELECT t.tgfoid FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace s ON s.oid=c.relnamespace
      WHERE NOT t.tgisinternal AND s.nspname||'.'||c.relname=ANY($1::text[]))
    ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)`, COMP_CURATION_TABLES);
  // The installation owner is checked independently; removing its name makes
  // this pin portable from the reviewed disposable installation to a reviewed
  // migration owner, without permitting the serving role to own any object.
  const normalized = { tables: tables.map(({ owner, ...row }) => row), functions: functions.map(({ owner, ...row }) => row) };
  return { tables, functions, sha256: sha(stable(normalized)) };
}

export async function assertCompCurationDatabase(tx, { role, schemaOwner, schemaSha256, guardVersion = 'SQL011' }) {
  deny(validGuardVersion(guardVersion) && validName(role) && validName(schemaOwner) && role !== schemaOwner && /^[a-f0-9]{64}$/.test(schemaSha256));
  const roles = await tx.$queryRawUnsafe(`/* comp-db:role */ SELECT current_user AS name,session_user AS session_name,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('role',pg_get_userbyid(m.roleid),'member',pg_get_userbyid(m.member),
      'admin',m.admin_option,'inherit',m.inherit_option,'set',m.set_option,'grantorSuperuser',g.rolsuper))
      FROM pg_auth_members m LEFT JOIN pg_roles g ON g.oid=m.grantor
      WHERE m.member=r.oid OR m.roleid=r.oid),'[]'::jsonb) AS memberships,
    r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls
    OR has_database_privilege(current_user,current_database(),'CREATE,TEMPORARY')
    OR EXISTS(SELECT 1 FROM pg_database WHERE datdba=r.oid)
    OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspowner=r.oid)
    OR EXISTS(SELECT 1 FROM pg_class WHERE relowner=r.oid)
    OR EXISTS(SELECT 1 FROM pg_proc WHERE proowner=r.oid) AS unsafe
    FROM pg_roles r WHERE r.rolname=current_user`);
  deny(roles.length === 1 && roles[0].name === role && roles[0].session_name === role && roles[0].unsafe === false);
  // PostgreSQL grants a CREATEROLE creator an incoming admin-only membership.
  // It gives the serving role no inherited rights; every outgoing grant and
  // every other incoming member, option or grantor remains forbidden.
  deny(Array.isArray(roles[0].memberships) && roles[0].memberships.every(m => m && m.role === role && m.member === schemaOwner
    && m.admin === true && m.inherit === false && m.set === false && m.grantorSuperuser === true));
  const schemas = await tx.$queryRawUnsafe(`/* comp-db:schemas */ SELECT nspname AS name,
    has_schema_privilege(current_user,oid,'USAGE') AS usage,has_schema_privilege(current_user,oid,'CREATE') AS create
    FROM pg_namespace WHERE left(nspname,3)<>'pg_' AND nspname<>'information_schema' ORDER BY nspname`);
  deny(schemas.filter(row => schemaSet.has(row.name)).length === 2);
  for (const row of schemas) deny(!row.create && row.usage === (schemaSet.has(row.name) || row.name === 'public'));
  const columns = await tx.$queryRawUnsafe(`/* comp-db:columns */ SELECT n.nspname||'.'||c.relname AS name,a.attname AS column,
    has_column_privilege(current_user,c.oid,a.attnum,'SELECT') AS sel,
    has_column_privilege(current_user,c.oid,a.attnum,'INSERT') AS ins,
    has_column_privilege(current_user,c.oid,a.attnum,'UPDATE') AS upd,
    has_column_privilege(current_user,c.oid,a.attnum,'REFERENCES') AS refs,
    has_table_privilege(current_user,c.oid,'DELETE,TRUNCATE,TRIGGER,MAINTAIN') AS extra
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
    WHERE c.relkind IN ('r','p','v','m','f') AND a.attnum>0 AND NOT a.attisdropped
    AND left(n.nspname,3)<>'pg_' AND n.nspname<>'information_schema' ORDER BY n.nspname,c.relname,a.attnum`);
  const seen = new Set();
  for (const row of columns) {
    const allowed = tableSet.has(row.name), insert = row.name === 'atlas_manual.comp_curation';
    const lock = ['atlas_manual.card', 'atlas_manual_intake.card'].includes(row.name) && row.column === 'id';
    deny(row.sel === allowed && row.ins === insert && row.upd === lock && !row.refs && !row.extra);
    if (allowed) seen.add(row.name);
  }
  deny(seen.size === 9);
  const sequences = await tx.$queryRawUnsafe(`/* comp-db:sequences */ WITH seq AS MATERIALIZED(
    SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='S'
    AND left(n.nspname,3)<>'pg_' AND n.nspname<>'information_schema')
    SELECT oid FROM seq WHERE has_sequence_privilege(current_user,oid,'USAGE,SELECT,UPDATE')`);
  deny(sequences.length === 0);
  const routines = await tx.$queryRawUnsafe(`/* comp-db:routines */ SELECT n.nspname||'.'||p.proname AS name,
    oidvectortypes(p.proargtypes) AS arguments FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE left(n.nspname,3)<>'pg_' AND n.nspname<>'information_schema' AND has_function_privilege(current_user,p.oid,'EXECUTE')
    AND NOT (NOT p.prosecdef AND p.probin='$libdir/uuid-ossp' AND EXISTS(SELECT 1 FROM pg_depend d JOIN pg_extension e ON e.oid=d.refobjid
      WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.refclassid='pg_extension'::regclass AND d.deptype='e' AND e.extname='uuid-ossp'))`);
  deny(routines.length === 1 && routines[0].name === 'atlas_manual.authenticate' && routines[0].arguments === 'text, text, jsonb, text[]');
  const schema = await inspectCompCurationSchema(tx);
  deny(schema.tables.length === 9 && schema.sha256 === schemaSha256);
  for (const table of schema.tables) deny(table.owner === schemaOwner && table.kind === 'r' && !table.rls && !table.force_rls
    && table.triggers.every(trigger => trigger.enabled === 'O') && table.constraints.every(c => c.validated)
    && table.indexes.every(i => i.valid && i.ready));
  for (const fn of schema.functions) deny(fn.owner === schemaOwner);
  for (const [name, legacyHash] of Object.entries(SOURCE_PINS)) {
    const hash = name === 'atlas_manual.comp_curation_guard' && guardVersion === COMP_EVIDENCE_GUARD_VERSION ? evidenceGuardSha256 : legacyHash;
    const found = schema.functions.filter(fn => fn.name === name); deny(found.length === 1 && sha(found[0].source) === hash);
  }
  return schema.sha256;
}

/** Prisma-compatible transaction-only wrapper for createDurableStaffBoundary.
 * Every transaction rechecks exact privileges/schema before and after work.
 * No raw client escapes, no staff identity is accepted here, and close never
 * disconnects a caller-owned client or promises a committed action rolled back.
 */
export function createCompCurationDatabase(options) {
  const keys = ['client', 'role', 'schemaOwner', 'schemaSha256', 'guardVersion'];
  deny(options && Object.getPrototypeOf(options) === Object.prototype && Reflect.ownKeys(options).every(key => keys.includes(key)));
  const { client, role, schemaOwner, schemaSha256, guardVersion = 'SQL011' } = options, transaction = client?.$transaction;
  deny(validGuardVersion(guardVersion) && typeof transaction === 'function' && validName(role) && validName(schemaOwner) && role !== schemaOwner && /^[a-f0-9]{64}$/.test(schemaSha256));
  let closed = false;
  const current = () => deny(!closed && options.client === client && client.$transaction === transaction
    && (options.guardVersion ?? 'SQL011') === guardVersion && options.guardVersion !== null
    && options.role === role && options.schemaOwner === schemaOwner && options.schemaSha256 === schemaSha256
    && Reflect.ownKeys(options).every(key => keys.includes(key)));
  return Object.freeze({
    async $transaction(work) {
      current(); deny(typeof work === 'function');
      const value = await Reflect.apply(transaction, client, [async tx => {
        current();
        await tx.$executeRawUnsafe("SET LOCAL search_path=pg_catalog");
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout='1500ms'");
        await tx.$executeRawUnsafe("SET LOCAL statement_timeout='3000ms'");
        await assertCompCurationDatabase(tx, { role, schemaOwner, schemaSha256, guardVersion }); current();
        const result = await work(tx); current();
        await assertCompCurationDatabase(tx, { role, schemaOwner, schemaSha256, guardVersion }); current();
        await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
        return result;
      }, { maxWait: 3000, timeout: 8000 }]);
      current(); return value;
    },
    close() { closed = true; },
  });
}
