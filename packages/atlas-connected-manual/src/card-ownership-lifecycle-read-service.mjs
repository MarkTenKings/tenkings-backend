// Unregistered server-only reader. No environment, clients, network, grants or
// runtime work is created on import. Never pass a lifecycle writer connection.
import { requireThat } from '@atlas/manual-service/contract';
import { ownershipLifecycleReadInput, ownershipLifecycleReaderUI, projectOwnershipLifecycleRead } from './card-ownership-lifecycle-read-contract.mjs';

const HASH = /^[a-f0-9]{64}$/;
const BINDING_KEYS = ['mode', 'origin', 'deploymentId', 'releaseSha', 'configHash'];
const bindingOf = config => Object.fromEntries(BINDING_KEYS.map(k => [k, config?.[k]]));
const valid = ok => requireThat(ok, 500, 'OWNERSHIP_LIFECYCLE_READ_ADAPTER_INVALID');
const response = ok => requireThat(ok, 503, 'OWNERSHIP_LIFECYCLE_READ_RESPONSE_INVALID');

async function assertReaderRole(tx) {
  const role = ok => requireThat(ok, 503, 'OWNERSHIP_LIFECYCLE_READ_DATABASE_ROLE_INVALID');
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
  role(rows.length === 1 && rows[0].unsafe === false);
  const routines = await tx.$queryRawUnsafe(`SELECT n.nspname AS schema,p.proname || '(' || oidvectortypes(p.proargtypes) || ')' AS name,
    p.prosecdef AS definer,p.proconfig AS config,p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS owned
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'
    AND NOT (NOT p.prosecdef AND p.probin='$libdir/uuid-ossp' AND EXISTS(SELECT 1 FROM pg_depend d JOIN pg_extension e ON e.oid=d.refobjid
      WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.refclassid='pg_extension'::regclass AND d.deptype='e' AND e.extname='uuid-ossp'))
    AND (p.prorettype<>'trigger'::regtype OR n.nspname IN ('atlas_ownership','atlas_ownership_evidence','atlas_ownership_proof','atlas_ownership_lifecycle','atlas_ownership_lifecycle_reader'))
    AND has_function_privilege(current_user,p.oid,'EXECUTE')`);
  role(routines.length === 1 && routines[0].schema === 'atlas_ownership_lifecycle_reader'
    && routines[0].name === 'customer_read(text, text, jsonb, text, jsonb)' && routines[0].definer === true
    && routines[0].owned === false && JSON.stringify(routines[0].config) === '["search_path=pg_catalog"]');
}

/** A text proposal only, for a NEW separately restricted reader role. */
export function cardOwnershipLifecycleReadGrantSQL(role) {
  valid(typeof role === 'string' && /^[a-z][a-z0-9_]{0,62}$/.test(role) && role !== 'public' && !role.startsWith('pg_'));
  return `GRANT USAGE ON SCHEMA atlas_ownership_lifecycle_reader TO "${role}";\nGRANT EXECUTE ON FUNCTION atlas_ownership_lifecycle_reader.customer_read(text,text,jsonb,text,jsonb) TO "${role}";`;
}

/** uiConfig defaults unavailable. Deliberately configured management reads do
 * not require an active proof policy or storage capability. CustomerAuth only
 * derives session/browser digests; the sole SQL routine checks LIVE authority
 * on each request and again after locks/projection. No caller account argument.
 */
export function createCardOwnershipLifecycleReadService({ customerAuth, client, uiConfig = null }) {
  valid(customerAuth?.config && typeof customerAuth.authority === 'function' && typeof client?.$transaction === 'function');
  const binding = bindingOf(customerAuth.config), encoded = JSON.stringify(binding);
  valid(BINDING_KEYS.every(k => typeof binding[k] === 'string') && ['PRODUCTION', 'LOCAL_FIXTURE'].includes(binding.mode)
    && /^https?:\/\/[^\s]{1,200}$/.test(binding.origin) && /^[a-z0-9.-]{1,200}$/.test(binding.deploymentId)
    && /^[a-f0-9]{40}$/.test(binding.releaseSha) && HASH.test(binding.configHash));
  const ui = ownershipLifecycleReaderUI(uiConfig);
  async function read(cookie, action, input) {
    const data = ownershipLifecycleReadInput(action, input);
    requireThat(typeof cookie === 'string' && cookie.length <= 8192, 401, 'SIGN_IN_REQUIRED');
    valid(JSON.stringify(bindingOf(customerAuth.config)) === encoded);
    const handle = customerAuth.authority(cookie);
    requireThat(handle && HASH.test(handle.sessionHash) && HASH.test(handle.browserHash), 401, 'SIGN_IN_REQUIRED');
    return client.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '1500ms'");
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '5000ms'");
      await assertReaderRole(tx);
      const rows = await tx.$queryRawUnsafe('SELECT atlas_ownership_lifecycle_reader.customer_read($1,$2,$3::jsonb,$4,$5::jsonb) AS result',
        handle.sessionHash, handle.browserHash, encoded, action, JSON.stringify(data));
      response(rows.length === 1 && rows[0]?.result && typeof rows[0].result === 'object');
      const value = rows[0].result;
      if (Object.hasOwn(value, 'error')) {
        response(Object.keys(value).length === 1 && value.error && Object.keys(value.error).length === 2);
        const { status, code } = value.error;
        response(Number.isInteger(status) && status >= 400 && status <= 599 && typeof code === 'string' && /^[A-Z][A-Z0-9_]{2,90}$/.test(code));
        requireThat(false, status, code);
      }
      return projectOwnershipLifecycleRead(action, value, data, ui);
    }, { maxWait: 3000, timeout: 8000 });
  }
  return Object.freeze({ read,
    readAccess: cookie => read(cookie, 'read_access', {}),
    configuration: cookie => read(cookie, 'configuration', {}),
    resolveTarget: (cookie, input) => read(cookie, 'resolve_certificate', input),
    listClaims: (cookie, input) => read(cookie, 'list_claims', input),
    readClaim: (cookie, input) => read(cookie, 'read_claim', input),
    listHistory: (cookie, input) => read(cookie, 'list_history', input),
  });
}
