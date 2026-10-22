// Inert, unregistered preference-only capability. No clients, grants, environment
// or network work is created here. Expected body pins are reviewed source bytes,
// never learned from a live database.
import { requireThat } from '@atlas/manual-service/contract';
import { ownershipPreferencesInput, projectOwnershipPreferences, isOwnershipPreferenceWrite } from './card-ownership-preferences-contract.mjs';

export const OWNERSHIP_PREFERENCES_ROUTINE_PINS = Object.freeze([
  {
    "schema": "atlas_ownership_preferences",
    "name": "customer_call(text, text, jsonb, text, jsonb)",
    "definer": true,
    "config": [
      "search_path=pg_catalog"
    ],
    "bodySha256": "596992afa04adab0550ef87bc6356141bc871639757f01abbefeb952093eecf8"
  },
  {
    "schema": "atlas_ownership",
    "name": "customer_call(text, text, jsonb, text, jsonb)",
    "definer": true,
    "config": [
      "search_path=pg_catalog"
    ],
    "bodySha256": "e708d6090a424679b7a1353af0f6daaac2415cc46e0f3fe3f27eb354b2eb810b"
  },
  {
    "schema": "atlas_ownership",
    "name": "input_valid(text, jsonb)",
    "definer": false,
    "config": [
      "search_path=pg_catalog"
    ],
    "bodySha256": "54204918d222b3ba12c99007ade958d71cfd1a85b5d19e70106b46b2862b1365"
  },
  {
    "schema": "atlas_ownership",
    "name": "current_title(uuid)",
    "definer": false,
    "config": [
      "search_path=pg_catalog"
    ],
    "bodySha256": "bfb4d522e0bc64e92c82dc30ecc8288a5db24e770a98b714acafc8e67e281465"
  },
  {
    "schema": "atlas_ownership",
    "name": "preferences(uuid, uuid)",
    "definer": false,
    "config": [
      "search_path=pg_catalog"
    ],
    "bodySha256": "9208363c22e652e272f4a01fc0a1b0d93be0669b4f2644520b8ab084a6b7ce3c"
  },
  {
    "schema": "atlas_ownership",
    "name": "card_projection(uuid, uuid, text)",
    "definer": false,
    "config": [
      "search_path=pg_catalog"
    ],
    "bodySha256": "9caafbf905a230f0eda8fe7964ad30e57b950e931b9bee59accb28837cea476a"
  },
  {
    "schema": "atlas_ownership",
    "name": "receipt(atlas_ownership.event)",
    "definer": false,
    "config": [
      "search_path=pg_catalog"
    ],
    "bodySha256": "60a8d611aadb761e4ee6ae627a3baa7182f740addb3628a27ab5fe2b240a5f06"
  },
  {
    "schema": "atlas_customer",
    "name": "current_account(text, text, integer)",
    "definer": false,
    "config": [
      "search_path=pg_catalog, atlas_customer"
    ],
    "bodySha256": "70182db9fe224f1eefdd401be9df73de3e8b6d1d365491387d10fa72797c53e0"
  },
  {
    "schema": "atlas_customer",
    "name": "problem(integer, text)",
    "definer": false,
    "config": [
      "search_path=pg_catalog"
    ],
    "bodySha256": "1024c9966298044f3aa76b420e575e47eb34b9afadb5682feb0147cb961d94d9"
  }
].map(row => Object.freeze({ ...row, config: Object.freeze(row.config) })));
const ROUTINES = OWNERSHIP_PREFERENCES_ROUTINE_PINS;
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const NAME = /^[a-z][a-z0-9_]{0,62}$/;
const KEYS = ['mode', 'origin', 'deploymentId', 'releaseSha', 'configHash'];
const bindingOf = c => Object.fromEntries(KEYS.map(k => [k, c?.[k]]));
const need = ok => requireThat(ok, 503, 'OWNERSHIP_PREFERENCES_UNAVAILABLE');
const role = ok => requireThat(ok, 503, 'OWNERSHIP_PREFERENCES_DATABASE_ROLE_INVALID');
const response = ok => requireThat(ok, 503, 'OWNERSHIP_PREFERENCES_RESPONSE_INVALID');

async function assertRole(tx, servingRole, schemaOwner) {
  const rows = await tx.$queryRawUnsafe(`SELECT current_user AS name,session_user AS session,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('role',pg_get_userbyid(m.roleid),'member',pg_get_userbyid(m.member),
      'admin',m.admin_option,'inherit',m.inherit_option,'set',m.set_option,'grantorSuperuser',g.rolsuper))
      FROM pg_auth_members m LEFT JOIN pg_roles g ON g.oid=m.grantor
      WHERE m.member=r.oid OR m.roleid=r.oid),'[]'::jsonb) AS memberships,
    r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls
    OR NOT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_namespace cn ON cn.oid=c.relnamespace JOIN pg_namespace pn ON pn.oid=p.pronamespace
      WHERE cn.nspname='atlas_ownership' AND c.relname='event' AND c.relkind='r' AND t.tgname='immutable' AND NOT t.tgisinternal AND t.tgenabled='O'
      AND t.tgtype=27 AND t.tgqual IS NULL AND t.tgnargs=0 AND octet_length(t.tgargs)=0
      AND pn.nspname='atlas_manual' AND p.proname='immutable' AND p.pronargs=0 AND p.prorettype='trigger'::regtype
      AND pg_get_userbyid(c.relowner)=$1 AND pg_get_userbyid(p.proowner)=$1
      AND NOT p.prosecdef AND p.proconfig IS NULL AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='a06ecb8c212cb9ac364b78217a68733d4cfb4a4e12db96e2eeb2c63f19cbaa6b')
    OR has_database_privilege(current_user,current_database(),'CREATE,TEMPORARY')
    OR EXISTS(SELECT 1 FROM pg_database WHERE datname=current_database() AND datdba=r.oid)
    OR EXISTS(SELECT 1 FROM pg_namespace n WHERE left(n.nspname,3)<>'pg_' AND n.nspname<>'information_schema'
      AND (n.nspowner=r.oid OR has_schema_privilege(current_user,n.oid,'CREATE') OR
       (n.nspname NOT IN ('public','atlas_ownership_preferences') AND has_schema_privilege(current_user,n.oid,'USAGE'))))
    OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE left(n.nspname,3)<>'pg_' AND n.nspname<>'information_schema'
      AND (c.relowner=r.oid OR (c.relkind IN ('r','p','v','m','f') AND (
       has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') OR EXISTS(
        SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
        AND has_column_privilege(current_user,c.oid,a.attnum,'SELECT,INSERT,UPDATE,REFERENCES'))))
       OR (c.relkind='S' AND has_sequence_privilege(current_user,c.oid,'USAGE,SELECT,UPDATE'))))
    OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE left(n.nspname,3)<>'pg_'
      AND n.nspname<>'information_schema' AND p.proowner=r.oid) AS unsafe
    FROM pg_roles r WHERE r.rolname=current_user`, schemaOwner);
  role(rows.length === 1 && rows[0].name === servingRole && rows[0].session === servingRole && rows[0].unsafe === false);
  // Permit only PostgreSQL's incoming admin-only grant to the reviewed owner.
  // The serving role must never inherit or SET ROLE through any membership.
  role(Array.isArray(rows[0].memberships) && rows[0].memberships.every(m => m && m.role === servingRole && m.member === schemaOwner
    && m.admin === true && m.inherit === false && m.set === false && m.grantorSuperuser === true));
  const executable = await tx.$queryRawUnsafe(`SELECT n.nspname AS schema,p.proname || '(' || oidvectortypes(p.proargtypes) || ')' AS name
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE left(n.nspname,3)<>'pg_' AND n.nspname<>'information_schema'
    AND NOT (NOT p.prosecdef AND p.probin='$libdir/uuid-ossp' AND EXISTS(SELECT 1 FROM pg_depend d JOIN pg_extension e ON e.oid=d.refobjid
      WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.refclassid='pg_extension'::regclass AND d.deptype='e' AND e.extname='uuid-ossp'))
    AND (p.prorettype<>'trigger'::regtype OR n.nspname LIKE 'atlas_ownership%') AND has_function_privilege(current_user,p.oid,'EXECUTE')`);
  role(executable.length === 1 && executable[0].schema === ROUTINES[0].schema && executable[0].name === ROUTINES[0].name);
  const definitions = await tx.$queryRawUnsafe(`SELECT n.nspname AS schema,p.proname || '(' || oidvectortypes(p.proargtypes) || ')' AS name,
    p.prosecdef AS definer,p.proconfig AS config,pg_get_userbyid(p.proowner) AS owner,
    encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') AS "bodySha256"
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('atlas_ownership_preferences','atlas_ownership','atlas_customer')`);
  for (const expected of ROUTINES) {
    const found = definitions.filter(v => v.schema === expected.schema && v.name === expected.name);
    role(found.length === 1 && found[0].owner === schemaOwner && found[0].definer === expected.definer
      && JSON.stringify(found[0].config) === JSON.stringify(expected.config) && found[0].bodySha256 === expected.bodySha256);
  }
}

// Read-only qualification entry point; no application action or client creation.
export { assertRole as assertCardOwnershipPreferencesRole };

/** Text only. Does not create a role, subtract inherited rights, or execute. */
export function cardOwnershipPreferencesGrantSQL(servingRole) {
  need(typeof servingRole === 'string' && NAME.test(servingRole) && servingRole !== 'public' && !servingRole.startsWith('pg_'));
  return `GRANT USAGE ON SCHEMA atlas_ownership_preferences TO "${servingRole}";\nGRANT EXECUTE ON FUNCTION atlas_ownership_preferences.customer_call(text,text,jsonb,text,jsonb) TO "${servingRole}";`;
}

export function createCardOwnershipPreferencesService(options) {
  need(options && Object.getPrototypeOf(options) === Object.prototype
    && Reflect.ownKeys(options).length === 4 && ['customerAuth', 'client', 'servingRole', 'schemaOwner'].every(k => Object.hasOwn(Object.getOwnPropertyDescriptor(options, k) ?? {}, 'value')));
  const { customerAuth: auth, client, servingRole, schemaOwner } = options;
  need(typeof servingRole === 'string' && NAME.test(servingRole) && typeof schemaOwner === 'string' && NAME.test(schemaOwner)
    && servingRole !== schemaOwner && ![servingRole, schemaOwner].some(n => n === 'public' || n.startsWith('pg_'))
    && typeof auth?.authority === 'function' && typeof client?.$transaction === 'function'
    && client !== auth.database && client !== auth.database?.client);
  const config = auth.config, authority = auth.authority, transaction = client.$transaction, digest = auth.digest;
  const encoded = JSON.stringify(bindingOf(config));
  need(config && KEYS.every(k => typeof config[k] === 'string') && ['PRODUCTION', 'LOCAL_FIXTURE'].includes(config.mode)
    && /^https?:\/\/[^\s]{1,200}$/.test(config.origin) && /^[a-z0-9.-]{1,200}$/.test(config.deploymentId)
    && /^[a-f0-9]{40}$/.test(config.releaseSha) && HASH.test(config.configHash)
    && JSON.stringify(bindingOf(config.binding)) === encoded && typeof digest === 'function'
    && Buffer.isBuffer(config.sessionKey) && config.sessionKey.length >= 32
    && config.cookies && ['browser','session'].every(k => typeof config.cookies[k] === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(config.cookies[k]))
    && config.cookies.browser !== config.cookies.session);
  const cookies = JSON.stringify([config.cookies.browser, config.cookies.session]), key = Buffer.from(config.sessionKey); let closed = false;
  const current = () => need(!closed && options.customerAuth === auth && options.client === client && options.servingRole === servingRole && options.schemaOwner === schemaOwner && auth.config === config && auth.authority === authority && auth.digest === digest && client.$transaction === transaction
    && JSON.stringify(bindingOf(config)) === encoded && JSON.stringify(bindingOf(config.binding)) === encoded
    && JSON.stringify([config.cookies?.browser, config.cookies?.session]) === cookies && Buffer.isBuffer(config.sessionKey) && config.sessionKey.equals(key));
  async function call(cookie, action, input, csrf) {
    current(); const data = ownershipPreferencesInput(action, input), writing = isOwnershipPreferenceWrite(action);
    requireThat(typeof cookie === 'string' && cookie.length <= 8192, 401, 'SIGN_IN_REQUIRED');
    if (writing) requireThat(typeof csrf === 'string' && csrf.length > 0 && csrf.length <= 512, 403, 'CSRF_REQUIRED');
    const proof = Reflect.apply(authority, auth, [cookie, writing ? csrf : undefined]);
    requireThat(proof && HASH.test(proof.sessionHash) && HASH.test(proof.browserHash), 401, 'SIGN_IN_REQUIRED');
    const value = await Reflect.apply(transaction, client, [async tx => {
      current();
      await tx.$executeRawUnsafe("SET LOCAL search_path='pg_catalog'");
      await tx.$executeRawUnsafe("SET LOCAL timezone='UTC'");
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout='1500ms'");
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout='5000ms'");
      await assertRole(tx, servingRole, schemaOwner); current();
      async function query(verb, payload) {
        current();
        const rows = await tx.$queryRawUnsafe('SELECT atlas_ownership_preferences.customer_call($1,$2,$3::jsonb,$4,$5::jsonb) AS result',
          proof.sessionHash, proof.browserHash, encoded, verb, JSON.stringify(payload));
        current(); response(rows.length === 1 && rows[0]?.result && typeof rows[0].result === 'object');
        const v = rows[0].result;
        if (Object.hasOwn(v, 'error')) {
          response(Object.keys(v).length === 1 && v.error && Object.keys(v.error).length === 2
            && Number.isInteger(v.error.status) && v.error.status >= 400 && v.error.status <= 599 && /^[A-Z][A-Z0-9_]{2,90}$/.test(v.error.code));
          // Throw INSIDE the transaction, including final auth failure after an
          // appended event. No catch translates uncertainty into a rollback claim.
          requireThat(false, v.error.status, v.error.code);
        }
        return v;
      }
      const before = await query('read_access', {}); response(UUID.test(before.accountId ?? ''));
      projectOwnershipPreferences('read_access', before, {}, before.accountId);
      const result = action === 'read_access' ? before : await query(action, data);
      const projected = projectOwnershipPreferences(action, result, data, before.accountId);
      await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
      await assertRole(tx, servingRole, schemaOwner); current();
      const after = await query('read_access', {});
      projectOwnershipPreferences('read_access', after, {}, before.accountId); current();
      return projected;
    }, { maxWait: 3000, timeout: 8000 }]);
    // Failure here can follow a commit. Callers MUST treat a missing receipt as
    // UNKNOWN and recover/retry only the original immutable request.
    current(); return value;
  }
  return Object.freeze({ call, readAccess: cookie => call(cookie, 'read_access', {}),
    readPreferences: cookie => call(cookie, 'read_preferences', {}), readCard: (cookie, input) => call(cookie, 'read_card', input),
    recoverRequest: (cookie, input) => call(cookie, 'recover_request', input),
    setCollectionPreferences: (cookie, csrf, input) => call(cookie, 'set_collection_preferences', input, csrf),
    setCardPreferences: (cookie, csrf, input) => call(cookie, 'set_card_preferences', input, csrf),
    close() { closed = true; key.fill(0); } });
}
