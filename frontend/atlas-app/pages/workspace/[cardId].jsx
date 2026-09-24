import Link from 'next/link';
import Shell, { Notice, Unavailable } from '../../components/Shell';
import CardGradingWorkspace from '../../components/CardGradingWorkspace';
import { useStaffResource } from '../../lib/client';
import { pageAccess } from '../../lib/server/runtime.mjs';
export async function getServerSideProps(ctx) {
    const access = await pageAccess(ctx);
    if (!access.props?.staff) return access;
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(ctx.params.cardId)) return { notFound: true };
    return { props: { ...access.props, cardId: ctx.params.cardId } };
}
export default function WorkspacePage({ unavailable, accessFailure, staff, cardId }) { return unavailable ? <Unavailable accessFailure={accessFailure} /> : <WorkspaceLoader key={cardId} staff={staff} cardId={cardId} />; }
function WorkspaceLoader({ staff, cardId }) {
    const resource = useStaffResource(`workspace/cards/${cardId}`);
    return <Shell staff={staff} workspace title="Card grading"><main className="workspace-content">{resource.loading ? <div className="empty-state" role="status">Loading saved card…</div> : resource.error ? <div className="empty-state"><Notice error>{resource.error}</Notice>{resource.signedOut ? <Link href="/?reauthenticate=1">Sign in again</Link> : <button onClick={resource.reload}>Reload saved card</button>}</div> : <CardGradingWorkspace initial={resource.data.card} staff={staff} csrf={resource.session.csrf} readiness={resource.data.readiness} />}</main></Shell>;
}
