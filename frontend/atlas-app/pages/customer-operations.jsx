import CustomerOperations from '../components/CustomerOperations';
import { Unavailable } from '../components/Shell';
import { pageAccess } from '../lib/server/runtime.mjs';
import { selectedOrderFromQuery } from '../lib/order-desk-client.mjs';
export async function getServerSideProps(ctx) {
  const result = await pageAccess(ctx);
  if (result.props?.staff && result.props.manualEnabled && result.props.customerOperationsEnabled)
    result.props.initialOrderId = selectedOrderFromQuery(ctx.query?.orderId);
  return result;
}
export default function CustomerOperationsPage({ staff, unavailable, accessFailure, manualEnabled, customerOperationsEnabled, initialOrderId = null }) {
  return unavailable || !manualEnabled || !customerOperationsEnabled ? <Unavailable accessFailure={accessFailure ?? (!unavailable ? { kind: 'FEATURE_DISABLED' } : undefined)}/> : <CustomerOperations key={`${staff.id}:${initialOrderId ?? ''}`} staff={staff} initialOrderId={initialOrderId}/>;
}
