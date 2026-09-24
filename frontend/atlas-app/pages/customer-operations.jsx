import CustomerOperations from '../components/CustomerOperations';
import { Unavailable } from '../components/Shell';
import { pageAccess } from '../lib/server/runtime.mjs';
export function getServerSideProps(ctx) { return pageAccess(ctx); }
export default function CustomerOperationsPage({ staff, unavailable, accessFailure, manualEnabled, customerOperationsEnabled }) {
  return unavailable || !manualEnabled || !customerOperationsEnabled ? <Unavailable accessFailure={accessFailure ?? (!unavailable ? { kind: 'FEATURE_DISABLED' } : undefined)}/> : <CustomerOperations staff={staff}/>;
}
