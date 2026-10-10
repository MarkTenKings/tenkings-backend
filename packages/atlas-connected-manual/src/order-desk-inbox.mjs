import { requireThat } from '@atlas/manual-service/contract';

const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);

export function orderDeskInboxGrantSQL(role) {
  requireThat(/^[a-z][a-z0-9_]{0,62}$/.test(role));
  return `GRANT USAGE ON SCHEMA atlas_dealer TO "${role}";\nGRANT EXECUTE ON FUNCTION atlas_dealer.staff_order_acknowledge(text,text,jsonb,text[],jsonb) TO "${role}";`;
}

/** Only the original, reauthenticated staff capability can acknowledge an
 * order. Actor identity and the permanent timestamp are database-owned. */
export function createOrderDeskInboxService({ auth, boundary }) {
  const binding = Object.fromEntries(['mode', 'origin', 'deploymentId', 'releaseSha', 'configHash'].map(name => [name, auth.config[name]]));
  return Object.freeze({
    async acknowledge(staff, input) {
      requireThat(input && !Array.isArray(input) && Object.keys(input).length === 2
        && uuid(input.orderId) && uuid(input.requestId), 400, 'INVALID_ORDER_ACKNOWLEDGMENT');
      const handle = auth.actors.get(staff);
      requireThat(handle, 401, 'SIGN_IN_REQUIRED');
      return boundary.transaction(staff, async ({ tx, principal }) => {
        requireThat(principal.role === 'REVIEWER', 403, 'STAFF_REQUIRED');
        const [row] = await tx.$queryRawUnsafe('SELECT atlas_dealer.staff_order_acknowledge($1,$2,$3::jsonb,$4::text[],$5::jsonb) AS result',
          handle.sessionHash, handle.browserHash, JSON.stringify(binding), [...auth.config.phoneByHash.keys()], JSON.stringify(input));
        requireThat(row?.result, 503, 'ORDER_ACKNOWLEDGMENT_UNAVAILABLE');
        const result = row.result;
        if (result.error) requireThat(false, result.error.status, result.error.code);
        const ack = result.acknowledgment;
        requireThat(result.orderId === input.orderId && result.requestId === input.requestId
          && ['ACKNOWLEDGED', 'ALREADY_ACKNOWLEDGED'].includes(result.outcome)
          && uuid(ack?.requestId) && typeof ack.acknowledgedAt === 'string' && Number.isFinite(Date.parse(ack.acknowledgedAt))
          && uuid(ack.acknowledgedBy?.id) && typeof ack.acknowledgedBy.name === 'string'
          && (result.outcome !== 'ACKNOWLEDGED' || (ack.requestId === input.requestId && ack.acknowledgedBy.id === principal.id)),
        503, 'ORDER_ACKNOWLEDGMENT_UNCONFIRMED');
        return { orderId: input.orderId, requestId: input.requestId, outcome: result.outcome,
          acknowledgment: { requestId: ack.requestId, acknowledgedAt: ack.acknowledgedAt,
            acknowledgedBy: { id: ack.acknowledgedBy.id, name: ack.acknowledgedBy.name } } };
      });
    },
  });
}
