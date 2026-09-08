import Head from 'next/head';
import GradedReport from '@atlas/report-view/GradedReport';
import { publicHeaders, reportSelector } from '../../lib/server/policy.mjs';
import { runtime } from '../../lib/server/runtime.mjs';
export async function getServerSideProps(ctx) {
    publicHeaders(ctx.res);
    let selector;
    try { selector = reportSelector(ctx.params.token, ctx.query.v); }
    catch { return { notFound: true }; }
    try {
        const result = await runtime(ctx.req).read(selector);
        return result ? { props: result } : { notFound: true };
    } catch { ctx.res.statusCode = 503; return { props: { unavailable: true } }; }
}
export default function Report({ packet, publicHash, unavailable }) {
    if (unavailable) return <main className="public-page"><Head><title>ATLAS · Report unavailable</title></Head><div className="brand">ATLAS</div><h1>This report is temporarily unavailable.</h1><p className="muted">Please try this link again later.</p></main>;
    const { identity } = packet.report;
    return <main className="public-page"><Head><title>{`${identity.playerName ?? identity.cardName} · ${packet.reportNumber} · ATLAS`}</title><meta name="robots" content="noindex,nofollow"/></Head>
        <header className="public-header"><div className="brand">ATLAS<span>GRADING</span></div><span className="report-number">{packet.reportNumber}<small>Approved version {packet.approvalVersion}</small></span></header>
        {packet.mode === 'LOCAL_FIXTURE' && <div className="demo-notice">SYNTHETIC DEMONSTRATION · This is not a physical card grade.</div>}
        <section className="card-heading"><p className="eyebrow">HUMAN-APPROVED REPORT</p><h1>{identity.playerName ?? identity.cardName}</h1>
            <p className="muted">{[identity.year, identity.manufacturer, identity.productSet, identity.parallel, identity.insert, identity.cardNumber].filter(Boolean).join(' · ')}</p></section>
        <GradedReport report={packet.report} approved synthetic={packet.mode === 'LOCAL_FIXTURE'}/>
        <footer className="report-footer"><p>Approved {new Date(packet.approvedAt).toISOString().slice(0, 10)} · Version {packet.approvalVersion}</p>
            <p>This page records the approved grading report. NFC and physical slab finishing are separate steps.</p>
            <details><summary>Report reference</summary><p>{publicHash}</p></details></footer>
    </main>;
}
