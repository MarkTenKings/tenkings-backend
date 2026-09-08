import Head from 'next/head';
import { publicHeaders } from '../lib/server/policy.mjs';
import { runtime } from '../lib/server/runtime.mjs';
export async function getServerSideProps(ctx) {
    publicHeaders(ctx.res);
    try { await runtime(ctx.req).read({ token: 'ar_000000000000000000000000', version: null }); return { props: {} }; }
    catch { ctx.res.statusCode = 503; return { props: { unavailable: true } }; }
}
export default function Home({ unavailable }) {
    return <main className="public-page"><Head><title>ATLAS Grading · Reports</title><meta name="robots" content="noindex,nofollow"/></Head>
        <div className="brand">ATLAS<span>GRADING</span></div><h1>{unavailable ? 'Reports are temporarily unavailable.' : 'Every grade has a report.'}</h1>
        <p className="muted">{unavailable ? 'Please try the report link again later.' : 'Open the report link on your ATLAS label to see the approved grade and findings.'}</p>
    </main>;
}
