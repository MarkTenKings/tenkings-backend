import { requireThat } from '@atlas/manual-service/contract';
import { cardOwnershipInput, projectOwnershipResult } from './card-ownership-contract.mjs';

const unbox = (row, action) => {
  if (row?.result?.error) requireThat(false, row.result.error.status, row.result.error.code);
  return projectOwnershipResult(action, row?.result);
};
const bindingOf = config => Object.fromEntries(['mode', 'origin', 'deploymentId', 'releaseSha', 'configHash'].map(key => [key, config[key]]));
async function assertCustomerRole(tx) {
  const [row] = await tx.$queryRawUnsafe(`SELECT r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls
    OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid)
    OR has_database_privilege(current_user,current_database(),'CREATE')
    OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname<>'information_schema' AND has_schema_privilege(current_user,oid,'CREATE'))
    OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
      WHERE c.relkind IN ('r','p','v','m','f') AND a.attnum>0 AND NOT a.attisdropped AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'
      AND (has_column_privilege(current_user,c.oid,a.attnum,'SELECT,INSERT,UPDATE,REFERENCES') OR has_table_privilege(current_user,c.oid,'DELETE,TRUNCATE,TRIGGER'))) AS unsafe
    FROM pg_roles r WHERE r.rolname=current_user`);
  requireThat(row?.unsafe === false, 503, 'OWNERSHIP_DATABASE_ROLE_INVALID');
  const functions = await tx.$queryRawUnsafe(`SELECT n.nspname AS schema,p.proname || '(' || oidvectortypes(p.proargtypes) || ')' AS name,p.prosecdef AS definer
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'
    AND NOT (NOT p.prosecdef AND p.probin='$libdir/uuid-ossp' AND EXISTS(SELECT 1 FROM pg_depend d JOIN pg_extension e ON e.oid=d.refobjid
      WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.refclassid='pg_extension'::regclass AND d.deptype='e' AND e.extname='uuid-ossp'))
    AND p.prorettype<>'trigger'::regtype AND has_function_privilege(current_user,p.oid,'EXECUTE')`);
  requireThat(functions.length === 1 && functions[0].schema === 'atlas_ownership'
    && functions[0].name === 'customer_call(text, text, jsonb, text, jsonb)' && functions[0].definer === true, 503, 'OWNERSHIP_DATABASE_ROLE_INVALID');
}
export function cardOwnershipGrantSQL(role, audience) {
  requireThat(typeof role === 'string' && /^[a-z][a-z0-9_]{0,62}$/.test(role) && ['CUSTOMER', 'STAFF'].includes(audience), 500, 'OWNERSHIP_ROLE_INVALID');
  return `GRANT USAGE ON SCHEMA atlas_ownership TO "${role}";\nGRANT EXECUTE ON FUNCTION atlas_ownership.${audience === 'CUSTOMER' ? 'customer_call(text,text,jsonb,text,jsonb)' : 'staff_call(text,text,jsonb,text[],jsonb)'} TO "${role}";`;
}

// Unregistered proposal adapter. The auth object is the existing CustomerAuth,
// never an account/capability JSON supplied by a browser. SQL revalidates the
// session, browser, account and release under locks on every call.
export function createCardOwnershipCustomerService({ auth, client }) {
  requireThat(typeof auth?.authority === 'function' && auth.config && typeof client?.$transaction === 'function', 500, 'OWNERSHIP_ADAPTER_INVALID');
  const binding = bindingOf(auth.config);
  return Object.freeze({ async call(cookie, action, input, csrf) {
    requireThat(action !== 'review_claim', 403, 'OWNERSHIP_REVIEW_REQUIRED');
    const data = cardOwnershipInput(action, input), write = !action.startsWith('read_');
    if (write) requireThat(typeof csrf === 'string' && csrf.length > 0, 403, 'CSRF_REQUIRED');
    const handle = auth.authority(cookie, write ? csrf : undefined);
    return client.$transaction(async tx => {
      await assertCustomerRole(tx);
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '1500ms'");
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '3000ms'");
      const [row] = await tx.$queryRawUnsafe('SELECT atlas_ownership.customer_call($1,$2,$3::jsonb,$4,$5::jsonb) AS result',
        handle.sessionHash, handle.browserHash, JSON.stringify(binding), action, JSON.stringify(data));
      return unbox(row, action);
    }, { maxWait: 3000, timeout: 5000 });
  } });
}

export function createCardOwnershipReviewService({ auth, boundary }) {
  const binding = bindingOf(auth.config);
  return Object.freeze({ async review(staff, input) {
    const data = cardOwnershipInput('review_claim', input), handle = auth.actors.get(staff);
    requireThat(handle, 401, 'SIGN_IN_REQUIRED');
    return boundary.transaction(staff, async ({ tx, principal }) => {
      requireThat(principal.role === 'REVIEWER', 403, 'OWNERSHIP_REVIEW_REQUIRED');
      const [row] = await tx.$queryRawUnsafe('SELECT atlas_ownership.staff_call($1,$2,$3::jsonb,$4::text[],$5::jsonb) AS result',
        handle.sessionHash, handle.browserHash, JSON.stringify(binding), [...auth.config.phoneByHash.keys()], JSON.stringify(data));
      return unbox(row, 'review_claim');
    });
  } });
}
