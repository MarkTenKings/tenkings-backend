import { Unavailable } from '../../components/Shell';
import { pageAccess } from '../../lib/server/runtime.mjs';
// Legacy specimen/workspace IDs are not connected-manual card IDs. Preserve the
// staff gate, then return to the current queue without translating the old ID.
export async function getServerSideProps(ctx) {
    const access = await pageAccess(ctx);
    if (!access.props?.staff) return access;
    return { redirect: { destination: '/grading', permanent: false } };
}
export default function RetiredCardPage({ unavailable, accessFailure }) {
    return unavailable ? <Unavailable accessFailure={accessFailure} /> : null;
}
