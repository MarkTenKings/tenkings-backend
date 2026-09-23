import BatchGrading from '../components/BatchGrading';
import { Unavailable } from '../components/Shell';
import { pageAccess } from '../lib/server/runtime.mjs';
export function getServerSideProps(ctx) { return pageAccess(ctx); }
export default function BatchPage({ staff, unavailable, manualEnabled }) {
  return unavailable || !manualEnabled ? <Unavailable /> : <BatchGrading staff={staff} />;
}
