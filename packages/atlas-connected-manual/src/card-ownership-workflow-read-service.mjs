import { requireThat } from '@atlas/manual-service/contract';
import { ownershipWorkflowInput, projectOwnershipWorkflow } from './card-ownership-workflow-contract.mjs';
const HASH = /^[a-f0-9]{64}$/;
const KEYS = ['mode', 'origin', 'deploymentId', 'releaseSha', 'configHash'];
const bindingOf = config => Object.fromEntries(KEYS.map(k => [k, config?.[k]]));
const invalid = ok => requireThat(ok, 500, 'OWNERSHIP_WORKFLOW_ADAPTER_INVALID');
const roleCheck = ok => requireThat(ok, 503, 'OWNERSHIP_WORKFLOW_DATABASE_ROLE_INVALID');
async function assertReaderRole(tx, audience) {
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
  roleCheck(functions.length === 1 && routine.schema === 'atlas_ownership_workflow'
    && routine.name === (audience === 'CUSTOMER' ? 'customer_read(text, text, jsonb, text, jsonb)' : 'reviewer_read(text, text, jsonb, text[], text, jsonb)') && routine.definer === true
    && routine.owned === false && Array.isArray(routine.config) && routine.config.length === 1 && routine.config[0] === 'search_path=pg_catalog');
}

/** Proposal text only; requires a fresh restricted role, never an evidence or
 * CustomerDatabase role. Startup checks refuse any additional capabilities. */
export function cardOwnershipWorkflowReadGrantSQL(role, audience) {
  requireThat(typeof role === 'string' && /^[a-z][a-z0-9_]{0,62}$/.test(role) && role !== 'public' && !role.startsWith('pg_')
    && ['CUSTOMER', 'REVIEWER'].includes(audience), 500, 'OWNERSHIP_WORKFLOW_ROLE_INVALID');
  const signature = audience === 'CUSTOMER' ? 'customer_read(text,text,jsonb,text,jsonb)' : 'reviewer_read(text,text,jsonb,text[],text,jsonb)';
  return `GRANT USAGE ON SCHEMA atlas_ownership_workflow TO "${role}";\nGRANT EXECUTE ON FUNCTION atlas_ownership_workflow.${signature} TO "${role}";`;
}

/** Server-only and unregistered. CustomerAuth derives cookie digests; the SQL
 * independently validates live customer sessions. Reviewer handles must come
 * from DurableStaffAuth's server-held WeakMap. No client capability is trusted.
 * Reads take authorization share locks, not PostgreSQL READ ONLY transactions.
 */
export function createCardOwnershipWorkflowReadService({ auth, client, audience }) {
  invalid(['CUSTOMER', 'REVIEWER'].includes(audience) && auth?.config && typeof client?.$transaction === 'function');
  invalid(audience === 'CUSTOMER' ? typeof auth.authority === 'function'
    : typeof auth.authenticate === 'function' && auth.actors instanceof WeakMap && auth.config.phoneByHash instanceof Map);
  const binding = bindingOf(auth.config), encoded = JSON.stringify(binding);
  invalid(KEYS.every(k => typeof binding[k] === 'string') && ['PRODUCTION', 'LOCAL_FIXTURE'].includes(binding.mode)
    && /^https?:\/\/[^\s]{1,200}$/.test(binding.origin) && /^[a-z0-9.-]{1,200}$/.test(binding.deploymentId)
    && /^[a-f0-9]{40}$/.test(binding.releaseSha) && HASH.test(binding.configHash));
  const phones = audience === 'REVIEWER' ? [...auth.config.phoneByHash.keys()].sort() : null;
  if (phones) invalid(phones.length > 0 && phones.every(x => HASH.test(x)));
  return Object.freeze({ async read(cookie, action, input) {
    const data = ownershipWorkflowInput(audience, action, input);
    requireThat(typeof cookie === 'string' && cookie.length <= 8192, 401, 'SIGN_IN_REQUIRED');
    invalid(JSON.stringify(bindingOf(auth.config)) === encoded && (!phones || JSON.stringify([...auth.config.phoneByHash.keys()].sort()) === JSON.stringify(phones)));
    const handle = audience === 'CUSTOMER' ? auth.authority(cookie) : auth.actors.get(await auth.authenticate(cookie));
    requireThat(handle && HASH.test(handle.sessionHash) && HASH.test(handle.browserHash), 401, 'SIGN_IN_REQUIRED');
    return client.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '1500ms'");
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '5000ms'");
      await assertReaderRole(tx, audience);
      const args = [handle.sessionHash, handle.browserHash, encoded, ...(phones ? [phones] : []), action, JSON.stringify(data)];
      const query = audience === 'CUSTOMER' ? 'SELECT atlas_ownership_workflow.customer_read($1,$2,$3::jsonb,$4,$5::jsonb) AS result'
        : 'SELECT atlas_ownership_workflow.reviewer_read($1,$2,$3::jsonb,$4::text[],$5,$6::jsonb) AS result';
      const rows = await tx.$queryRawUnsafe(query, ...args);
      requireThat(rows.length === 1 && rows[0]?.result && typeof rows[0].result === 'object', 503, 'OWNERSHIP_WORKFLOW_RESPONSE_INVALID');
      const value = rows[0].result;
      if (value.error) {
        const { status, code } = value.error;
        requireThat(Number.isInteger(status) && status >= 400 && status <= 599 && /^[A-Z][A-Z0-9_]{2,90}$/.test(code), 503, 'OWNERSHIP_WORKFLOW_RESPONSE_INVALID');
        requireThat(false, status, code);
      }
      return projectOwnershipWorkflow(audience, action, value, data);
    }, { maxWait: 3000, timeout: 8000 });
  } });
}
