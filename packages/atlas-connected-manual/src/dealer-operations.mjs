import { requireThat } from '@atlas/manual-service/contract';

const actions = new Set(['read','location_configure','membership_configure','custody_record','bind_manual']);
export function dealerStaffGrantSQL(role) {
  requireThat(/^[a-z][a-z0-9_]{0,62}$/.test(role));
  return `GRANT USAGE ON SCHEMA atlas_dealer TO "${role}";\nGRANT EXECUTE ON FUNCTION atlas_dealer.staff_call(text,text,text,jsonb,text[],jsonb) TO "${role}";`;
}
/** Original WeakMap staff capability, reauthenticated by the existing manual
 * boundary and by the narrow SQL function. No browser-supplied principal. */
export function createDealerStaffService({ auth, boundary }) {
  const binding = Object.fromEntries(['mode','origin','deploymentId','releaseSha','configHash'].map(name => [name, auth.config[name]]));
  return Object.freeze({ async call(staff, action, input) {
    requireThat(actions.has(action), 404, 'NOT_FOUND');
    const handle = auth.actors.get(staff); requireThat(handle, 401, 'SIGN_IN_REQUIRED');
    return boundary.transaction(staff, async ({ tx, principal }) => {
      requireThat(principal.role === 'REVIEWER', 403, 'STAFF_REQUIRED');
      const [row] = await tx.$queryRawUnsafe('SELECT atlas_dealer.staff_call($1,$2,$3,$4::jsonb,$5::text[],$6::jsonb) AS result',
        action, handle.sessionHash, handle.browserHash, JSON.stringify(binding), [...auth.config.phoneByHash.keys()], JSON.stringify(input));
      requireThat(row?.result, 503, 'DEALER_OPERATIONS_UNAVAILABLE');
      if (row.result.error) requireThat(false, row.result.error.status, row.result.error.code);
      return row.result;
    });
  } });
}
