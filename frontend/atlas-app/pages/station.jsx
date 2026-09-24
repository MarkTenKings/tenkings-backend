import FinishingStation from '../components/FinishingStation';
import { Unavailable } from '../components/Shell';
import { pageAccess } from '../lib/server/runtime.mjs';
export function getServerSideProps(context) { return pageAccess(context); }
export default function StationPage({ staff, unavailable, accessFailure, manualEnabled }) {
  return unavailable || !manualEnabled ? <Unavailable accessFailure={accessFailure ?? (!unavailable ? { kind: 'FEATURE_DISABLED' } : undefined)}/> : <FinishingStation key={staff.id} staff={staff}/>;
}
