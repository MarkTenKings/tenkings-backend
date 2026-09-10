import Link from 'next/link';
import Shell, { Notice, Unavailable } from '../components/Shell';
import PhotoIntake from '../components/PhotoIntake';
import { useStaffResource } from '../lib/client';
import { pageAccess } from '../lib/server/runtime.mjs';
export function getServerSideProps(ctx) { return pageAccess(ctx); }
export default function AddCards({ unavailable, staff }) { return unavailable ? <Unavailable /> : <IntakeLoader staff={staff} />; }
function IntakeLoader({ staff }) {
    const resource = useStaffResource('workspace');
    return <Shell staff={staff} title="Add cards"><main className="main-content">{resource.loading ? <div className="empty-state" role="status">Loading photo intake…</div> : resource.error ? <div className="empty-state"><Notice error>{resource.error}</Notice>{resource.signedOut ? <Link href="/?reauthenticate=1">Sign in again</Link> : <button onClick={resource.reload}>Retry</button>}</div> : <PhotoIntake staff={staff} readiness={resource.data.readiness} savedCards={resource.data.cards} />}</main></Shell>;
}
