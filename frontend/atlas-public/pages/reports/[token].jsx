import Head from 'next/head';
import Link from 'next/link';
import GradedReport from '@atlas/report-view/GradedReport';
import ApprovedPhotographs from '../../components/ApprovedPhotographs';
import { publicHeaders, reportSelector } from '../../lib/server/policy.mjs';
import { runtime } from '../../lib/server/runtime.mjs';
import { ApprovedReportView } from '@atlas/manual-workspace/report-review';
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
export default function Report({ packet, publicHash, explanation, presentation, unavailable }) {
    if (unavailable) return <main className="public-page"><Head><title>ATLAS · Report unavailable</title></Head><Link className="atlas-brand" href="/" aria-label="ATLAS home"><img src="/brand/atlas-brand.png" alt="ATLAS · Know what you have"/></Link><h1>This report is temporarily unavailable.</h1><p className="muted">Please try this link again later.</p></main>;
    const { identity } = packet.report;
    if (packet.version === 'atlas-public-manual-report-v2') {
        const path = `/reports/${packet.publicToken}?v=${packet.approvalVersion}`;
        const images = Object.fromEntries(['FRONT','BACK'].map(side => [side, { inspection: {
            url: `/api/reports/${packet.publicToken}/images/${side}?v=${packet.approvalVersion}`,
            sha256: packet.images[side].sha256, byteCount: packet.images[side].byteCount } }]));
        return <main className="public-manual-report"><Head><title>{`${identity.playerName ?? identity.cardName} · ${packet.reportNumber} · ATLAS`}</title><meta name="robots" content="noindex,nofollow"/></Head>
            {packet.mode === 'LOCAL_FIXTURE' && <div className="demo-notice">SYNTHETIC DEMONSTRATION · This is not a physical card grade.</div>}
            <ApprovedReportView report={packet.report} explanation={explanation} images={images} geometry={packet.geometry} brandSrc="/brand/atlas-brand.png" presentation={presentation}
                publication={{ reportNumber: packet.reportNumber, version: packet.approvalVersion, approvedAt: packet.approvedAt, reportHash: publicHash, url: path }}/>
            <footer className="report-footer"><p>This is the saved human-approved report. Physical slab finishing and NFC are separate steps.</p></footer>
        </main>;
    }
    return <main className="public-page"><Head><title>{`${identity.playerName ?? identity.cardName} · ${packet.reportNumber} · ATLAS`}</title><meta name="robots" content="noindex,nofollow"/></Head>
        <header className="public-header"><Link className="atlas-brand" href="/" aria-label="ATLAS home"><img src="/brand/atlas-brand.png" alt="ATLAS · Know what you have"/></Link><span className="report-number">{packet.reportNumber}<small>Approved version {packet.approvalVersion}</small></span></header>
        {packet.mode === 'LOCAL_FIXTURE' && <div className="demo-notice">SYNTHETIC DEMONSTRATION · This is not a physical card grade.</div>}
        <section className="card-heading"><p className="eyebrow">HUMAN-APPROVED REPORT</p><h1>{identity.playerName ?? identity.cardName}</h1>
            <p className="muted">{[identity.year, identity.manufacturer, identity.productSet, identity.parallel, identity.insert, identity.cardNumber].filter(Boolean).join(' · ')}</p></section>
        <GradedReport report={packet.report} approved synthetic={packet.mode === 'LOCAL_FIXTURE'}/>
        <ApprovedPhotographs packet={packet} publicHash={publicHash}/>
        <footer className="report-footer"><p>Approved {new Date(packet.approvedAt).toISOString().slice(0, 10)} · Version {packet.approvalVersion}</p>
            <p>This page records the approved grading report. NFC and physical slab finishing are separate steps.</p>
            <details><summary>Report reference</summary><p>{publicHash}</p></details></footer>
    </main>;
}
