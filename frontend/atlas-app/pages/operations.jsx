import Link from 'next/link';
import Shell, { Unavailable } from '../components/Shell';
import OperationsWorkspace from '../components/OperationsWorkspace';
import { pageAccess, runtime } from '../lib/server/runtime.mjs';

export async function getServerSideProps(ctx) {
    const access = await pageAccess(ctx);
    if (!access.props?.staff) return access;
    try {
        const state = runtime(ctx.req);
        if (!state.operations) return { props: { ...access.props, operationsUnavailable: true } };
        const staff = await state.auth.authenticate(ctx.req.headers.cookie);
        // A reviewer role in page props is never operations authority. This
        // named read rechecks the fresh human operations grant on the server.
        await state.operations.roster(staff);
        return access;
    } catch {
        return { props: { ...access.props, operationsUnavailable: true } };
    }
}

export default function OperationsPage({ unavailable, operationsUnavailable, staff }) {
    if (unavailable) return <Unavailable />;
    return <Shell staff={staff} title="Operations"><main className="main-content">
        <div className="page-heading"><div><p className="eyebrow">STAFF ADMINISTRATION</p><h1>Operations</h1>
            <p className="muted">Prepare the ten-card pilot and manage its staff, intake and recorded costs.</p></div>
            <Link href="/grading" className="text-button">Review queue →</Link></div>
        {operationsUnavailable ? <section className="empty-state"><h2>Operations access is unavailable.</h2>
            <p>This workspace requires an enabled operations service and a current human operations grant.</p>
            <Link href="/">Sign in again</Link></section> : <OperationsWorkspace />}
    </main></Shell>;
}
