import { createHash } from 'node:crypto';
import { requireThat } from '@atlas/manual-service/contract';

const actions = new Set(['read','location_configure','membership_configure','custody_record','bind_manual','return_label']);
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
    if (action === 'return_label') requireThat(input && Object.keys(input).length === 1 && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(input.orderId ?? ''), 400, 'INVALID_DEALER_OPERATION');
    const handle = auth.actors.get(staff); requireThat(handle, 401, 'SIGN_IN_REQUIRED');
    return boundary.transaction(staff, async ({ tx, principal }) => {
      requireThat(principal.role === 'REVIEWER', 403, 'STAFF_REQUIRED');
      const [row] = await tx.$queryRawUnsafe('SELECT atlas_dealer.staff_call($1,$2,$3,$4::jsonb,$5::text[],$6::jsonb) AS result',
        action, handle.sessionHash, handle.browserHash, JSON.stringify(binding), [...auth.config.phoneByHash.keys()], JSON.stringify(input));
      requireThat(row?.result, 503, 'DEALER_OPERATIONS_UNAVAILABLE');
      if (row.result.error) requireThat(false, row.result.error.status, row.result.error.code);
      if (action === 'return_label') {
        const label = row.result;
        requireThat(label.orderId === input.orderId && label.leg === 'RETURN' && label.mimeType === 'application/pdf'
          && typeof label.labelBase64 === 'string' && label.labelBase64.length <= 5592408 && /^[A-Za-z0-9+/]+={0,2}$/.test(label.labelBase64), 409, 'LABEL_NOT_READY');
        const bytes = Buffer.from(label.labelBase64, 'base64');
        requireThat(bytes.length <= 4 * 1024 * 1024 && bytes.subarray(0, 5).toString('ascii') === '%PDF-'
          && bytes.toString('base64') === label.labelBase64 && createHash('sha256').update(bytes).digest('hex') === label.labelSha256, 409, 'LABEL_NOT_READY');
        return { orderId: input.orderId, leg: 'RETURN', mimeType: label.mimeType, labelBase64: label.labelBase64, labelSha256: label.labelSha256 };
      }
      return row.result;
    });
  } });
}
