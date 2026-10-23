import { requireThat } from '@atlas/manual-service/contract';
import { cardOwnershipInput, projectOwnershipResult } from './card-ownership-contract.mjs';

const ACTIONS = new Set(['read_collection', 'read_card', 'read_preferences']);
const HASH = /^[a-f0-9]{64}$/;
const BINDING_KEYS = ['mode', 'origin', 'deploymentId', 'releaseSha', 'configHash'];
const bindingOf = config => Object.fromEntries(BINDING_KEYS.map(key => [key, config?.[key]]));
const invalid = ok => requireThat(ok, 500, 'OWNERSHIP_READ_ADAPTER_INVALID');
const roleCheck = ok => requireThat(ok, 503, 'OWNERSHIP_READ_DATABASE_ROLE_INVALID');

async function assertReaderRole(tx) {
  const rows = await tx.$queryRawUnsafe(`SELECT r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls
    OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid)
    OR has_database_privilege(current_user,current_database(),'CREATE')
    OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname<>'information_schema' AND has_schema_privilege(current_user,oid,'CREATE'))
    OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
      WHERE c.relkind IN ('r','p','v','m','f') AND a.attnum>0 AND NOT a.attisdropped AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'
      AND (has_column_privilege(current_user,c.oid,a.attnum,'SELECT,INSERT,UPDATE,REFERENCES') OR has_table_privilege(current_user,c.oid,'DELETE,TRUNCATE,TRIGGER')))
    OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='S'
      AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND has_sequence_privilege(current_user,c.oid,'USAGE,SELECT,UPDATE')) AS unsafe
    FROM pg_roles r WHERE r.rolname=current_user`);
  roleCheck(rows.length === 1 && rows[0].unsafe === false);
  const functions = await tx.$queryRawUnsafe(`SELECT n.nspname AS schema,p.proname || '(' || oidvectortypes(p.proargtypes) || ')' AS name,
    p.prosecdef AS definer,p.proconfig AS config,p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS owned
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'
    AND NOT (NOT p.prosecdef AND p.probin='$libdir/uuid-ossp' AND EXISTS(SELECT 1 FROM pg_depend d JOIN pg_extension e ON e.oid=d.refobjid
      WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.refclassid='pg_extension'::regclass AND d.deptype='e' AND e.extname='uuid-ossp'))
    AND p.prorettype<>'trigger'::regtype AND has_function_privilege(current_user,p.oid,'EXECUTE')`);
  const routine = functions[0];
  roleCheck(functions.length === 1 && routine.schema === 'atlas_ownership'
    && routine.name === 'customer_read(text, text, jsonb, text, jsonb)' && routine.definer === true
    && routine.owned === false && Array.isArray(routine.config) && routine.config.length === 1 && routine.config[0] === 'search_path=pg_catalog');
}

export function cardOwnershipReadGrantSQL(role) {
  requireThat(typeof role === 'string' && /^[a-z][a-z0-9_]{0,62}$/.test(role)
    && role !== 'public' && !role.startsWith('pg_'), 500, 'OWNERSHIP_READ_ROLE_INVALID');
  return `GRANT USAGE ON SCHEMA atlas_ownership TO "${role}";\nGRANT EXECUTE ON FUNCTION atlas_ownership.customer_read(text,text,jsonb,text,jsonb) TO "${role}";`;
}

/** Unregistered server-only adapter. Inject the existing server CustomerAuth
 * and a SEPARATE restricted reader client, never CustomerDatabase's client or
 * an auth/account object decoded from a request. authority() hashes cookies;
 * customer_read independently validates the live session in the database.
 * No HTTP/runtime wiring, media authority, provider, notification or writer.
 */
export function createCardOwnershipReadService({ auth, client }) {
  invalid(typeof auth?.authority === 'function' && auth.config && typeof client?.$transaction === 'function');
  const binding = bindingOf(auth.config), encodedBinding = JSON.stringify(binding);
  invalid(BINDING_KEYS.every(key => typeof binding[key] === 'string') && ['PRODUCTION', 'LOCAL_FIXTURE'].includes(binding.mode)
    && typeof binding.origin === 'string' && /^https?:\/\/[^\s]{1,200}$/.test(binding.origin)
    && typeof binding.deploymentId === 'string' && /^[a-z0-9.-]{1,200}$/.test(binding.deploymentId)
    && /^[a-f0-9]{40}$/.test(binding.releaseSha) && HASH.test(binding.configHash));
  const authority = auth.authority.bind(auth);
  return Object.freeze({ async read(cookieHeader, action, input) {
    requireThat(ACTIONS.has(action), 403, 'OWNERSHIP_READ_ONLY');
    const data = cardOwnershipInput(action, input);
    requireThat(typeof cookieHeader === 'string' && cookieHeader.length <= 8192, 401, 'SIGN_IN_REQUIRED');
    invalid(JSON.stringify(bindingOf(auth.config)) === encodedBinding);
    const proof = authority(cookieHeader);
    requireThat(proof && HASH.test(proof.sessionHash) && HASH.test(proof.browserHash), 401, 'SIGN_IN_REQUIRED');
    return client.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '1500ms'");
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '3000ms'");
      await assertReaderRole(tx);
      const rows = await tx.$queryRawUnsafe('SELECT atlas_ownership.customer_read($1,$2,$3::jsonb,$4,$5::jsonb) AS result',
        proof.sessionHash, proof.browserHash, encodedBinding, action, JSON.stringify(data));
      requireThat(rows.length === 1, 503, 'OWNERSHIP_RESPONSE_INVALID');
      if (rows[0]?.result?.error) {
        const { status, code } = rows[0].result.error;
        requireThat(Number.isInteger(status) && status >= 400 && status <= 599 && /^[A-Z][A-Z0-9_]{2,90}$/.test(code), 503, 'OWNERSHIP_RESPONSE_INVALID');
        requireThat(false, status, code);
      }
      return projectOwnershipResult(action, rows[0]?.result);
    }, { maxWait: 3000, timeout: 5000 });
  } });
}
